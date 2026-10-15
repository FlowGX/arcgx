import { OverlayChannel, createLogger, envNumber } from '@arcgx/shared';
import type { GameItem, ItemDetection } from '@arcgx/shared';

import type { ArcGx } from '../index.js';
import type { CaptureManager } from '../capture/manager.js';
import { DEFAULT_PANEL, PAINEIS_DE_SCAN, PANELS, cellsOf, panelRect, type PanelSpec } from './panels.js';

const log = createLogger('scan-loop');

/** Leitura de HUD vinda do worker de OCR. */
export interface HudLeitura {
  contadores: Record<string, { ocupado: number; capacidade: number }>;
  total: number | null;
  ms: number;
  indisponivel?: boolean;
}

export interface ScanCellView {
  index: number;
  /** painel a que a célula pertence */
  regiao?: string;
  /** retangulo em pixels do frame capturado */
  x: number;
  y: number;
  width: number;
  height: number;
  itemId: string | null;
  score: number;
  runnerUp: string | null;
}

export interface ScanResultView {
  cells: ScanCellView[];
  cols: number;
  rows: number;
  /** true quando a grade veio do detector e não da geometria em cache */
  detected: boolean;
  /** true quando o classificador não está disponível */
  degraded: boolean;
  ms: number;
  hz: number;
  timestamp: number;
  /**
   * Células com item, já resolvidas contra o catálogo local.
   *
   * ## ## ## Por que isto existia só agora
   *
   * O overlay lia `result.detections` e o loop transmitia `result.cells`.
   * Os dois nomes nunca casaram, entao `detections` chegava `undefined`, o
   * `.map` do renderer nao rodava e **nao aparecia badge nenhum** — sem erro
   * no console, sem aviso no painel. O `CLEAR` ja transmitia no formato certo
   * (`{ t, detections, ms }`), o que deixava o contrato ambiguo: os dois
   * lados compilavam, porque `ScanResultView` e `ScanResult` sao assignable.
   */
  detections: ItemDetection[];
  /**
   * Contadores e total do cabecalho do jogo.
   *
   * `null` enquanto nenhum quadro com OCR chegou. O overlay trata como "ainda
   * nao leu" — mostrar `0/0` num slot cheio seria pior que nao mostrar nada.
   */
  hud: HudLeitura | null;
  /** false quando o jogo saiu de foco e o overlay tem de sumir */
  visivel?: boolean;
  /** painel que `cols`/`rows` descrevem */
  painel?: string | null;
}

interface WorkerPayload {
  cells: {
    index: number;
    regiao: string;
    rect: { x: number; y: number; width: number; height: number };
    itemId: string | null;
    score: number;
    runnerUp: string | null;
    familia?: string | null;
    levelVariant?: boolean;
  }[];
  grid: { cols: number; rows: number } | null;
  fallback: boolean;
  ms: number;
  via?: 'encoder' | 'dhash' | 'nenhum';
  painel?: string | null;
  /** contadores e total do cabecalho; ausente nos quadros que nao pediram OCR */
  hud?: {
    contadores: Record<string, { ocupado: number; capacidade: number }>;
    total: number | null;
    ms: number;
    indisponivel?: boolean;
  };
}

/**
 * Loop de leitura.
 *
 * ## Ritmo
 *
 * A taxa vem de `scannerTargetHz` (padrão 4 Hz), **não** de `overlayHz`. São
 * coisas diferentes: o overlay é repintar o HUD, que é barato; o scan é ler
 * frame, recortar células e casar itens, que não é. Como o WGC guarda
 * apenas o último frame, poll mais rápido que o scan não acumula nada — só
 * joga trabalho fora, a 8 MB por leitura.
 *
 * ## Guarda de foco
 *
 * Nada é lido sem o jogo em primeiro plano. Fora dele não há inventário na
 * tela, e o custo não se justifica.
 */
export class ScanLoop {
  private timer: NodeJS.Timeout | null = null;
  private panelId: string;
  private busy = false;
  private running = false;

  private lastResult: ScanResultView | null = null;
  private lastWhy: string | null = null;
  private lastWhyAt = 0;
  private scans = 0;
  private windowStart = 0;
  private hz = 0;

  /**
   * Intervalo minimo entre dois OCR, em ms.
   *
   * 500 ms = 2 Hz. O texto do painel so muda quando o jogador mexe em item ou
   * o contador do jogo anda; 60 Hz de OCR seria 150 ms por quadro jogados fora
   * para mostrar a mesma palavra.
   */
  private readonly intervaloOcrMs = 500;
  private ultimoOcr = 0;
  private lastError: string | null = null;

  /** Catálogo resolvido por id — o scan só lê, nunca escreve aqui. */
  private readonly cacheItem = new Map<string, GameItem>();

  /** Evita repetir o mesmo resumo a 30 Hz; só loga quando o resultado muda. */
  private ultimoResumo = '';

  /** ultima leitura de HUD valida, preservada entre quadros sem OCR */
  private ultimoHud: HudLeitura | null = null;

  /**
   * O jogo esta em foco agora?
   *
   * Quando vira falso, o overlay precisa **sumir**. O scan ja parava, mas as
   * badges ficavam na tela com o numero congelado sobre o desktop — e o
   * jogador via o que era leitura do inventario dele flutuando sobre o
   * Explorer. Pior: os numeros ficariam ali, envelhecendo em silencio, sem
   * nenhuma marca de que envelheceram.
   */
  private jogoEmFoco = false;

  constructor(
    private readonly gx: ArcGx,
    private readonly capture: CaptureManager,
    private readonly request: <T>(payload: Record<string, unknown>) => Promise<T>,
  ) {
    this.panelId = envString('ARC_PANEL', DEFAULT_PANEL.id);
  }

  /* ------------------------------------------------------------- estado */

  get enabled(): boolean {
    return this.timer !== null;
  }

  /**
   * Os painéis varridos, na ordem em que o payload os descreve.
   *
   * O primeiro é o principal: é dele que a grade `grid` sai. Todos entram no
   * mesmo request para não repetir o frame de 8 MB por contêiner.
   */
  private get paineisVaridos(): PanelSpec[] {
    return PAINEIS_DE_SCAN;
  }

  get panel(): PanelSpec {
    return PANELS[this.panelId] ?? PANELS[DEFAULT_PANEL.id]!;
  }

  setPanel(id: string): boolean {
    if (!PANELS[id]) return false;
    this.panelId = id;
    log.info(`painel: ${PANELS[id]!.label}`);
    return true;
  }

  get result(): ScanResultView | null {
    return this.lastResult;
  }

  get error(): string | null {
    return this.lastError;
  }

  get measuredHz(): number {
    return this.hz;
  }

  /* ------------------------------------------------------------- ciclo */

  start(): void {
    if (this.timer) return;
    const period = Math.round(1000 / this.targetHz());
    this.running = true;
    this.windowStart = Date.now();
    this.timer = setInterval(() => void this.tick(), period);
    log.info(`loop em ${this.targetHz()} Hz (${this.paineisVaridos.length} painéis)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  private targetHz(): number {
    return envNumber('ARC_SCAN_HZ', this.gx.store.config.scannerTargetHz ?? 4);
  }

  /* --------------------------------------------------------- visibilidade */

  /**
   * Avisa o overlay quando o jogo entra ou sai de foco.
   *
   * Manda um resultado **vazio** com `visivel: false` quando sai, e
   * `visivel: true` quando volta. Vazio e nao "null" porque o overlay ja trata
   * resultado ausente como "ainda nao leu" — e aqui a intencao e justamente
   * limpar.
   */
  private publicarFoco(emFoco: boolean): void {
    if (emFoco === this.jogoEmFoco) return;
    this.jogoEmFoco = emFoco;
    if (emFoco) return; // o proximo tick preenche
    this.ultimoHud = null;
    this.lastResult = null;
    this.gx.overlay.broadcast(OverlayChannel.SCAN_RESULT, {
      t: Date.now(),
      detections: [],
      ms: 0,
      visivel: false,
    });
  }

  /**
   * Mantem a ultima leitura valida entre quadros sem OCR.
   *
   * O OCR roda a 2 Hz e o scan a 30. Sem isto o contador apareceria em 2
   * quadros e sumiria nos outros 13 — piscar e pior do que nao piscar, porque
   * o usuario para de confiar no numero.
   */
  private absorverHud(hud: WorkerPayload['hud']): HudLeitura | null {
    if (hud && !hud.indisponivel) this.ultimoHud = hud;
    return this.ultimoHud;
  }

  /* ------------------------------------------------------------ catálogo */

  /**
   * Resolve as células com item contra o catálogo local.
   *
   * O worker devolve `itemId`; quem sabe nome, tier e preço é o `LocalDb`.
   * O cache existe porque isto roda a 4 Hz sobre as mesmas 1.106 entradas — o
   * `getItem` é SQLite síncrono, e 20 chamadas por tique de 250 ms não são
   * "de graça", só são pequenas. Cacheadas, somem.
   *
   * Célula ambígua chega com `itemId: null` e sai daqui sem detecção, que é o
   * comportamento certo: sem nome não há o que desenhar.
   */
  private resolverDeteccoes(payload: WorkerPayload): ItemDetection[] {
    const out: ItemDetection[] = [];
    for (const c of payload.cells) {
      if (!c.itemId) continue;
      const item = this.cacheItem.get(c.itemId) ?? this.buscarItem(c.itemId);
      if (!item) continue;
      out.push({
        cell: { index: c.index, rect: c.rect },
        item,
        confidence: c.score,
        galleryHit: c.itemId,
        familia: c.familia ?? null,
        levelVariant: c.levelVariant ?? false,
        runnerUp: c.runnerUp,
      });
    }
    return out;
  }

  private buscarItem(id: string): GameItem | null {
    let item: GameItem | null = null;
    try {
      const row = this.gx.db.getItem(id) as
        | { id: string; name: string; tier: string; category?: string | null; baseValue?: number | null }
        | undefined;
      if (row) {
        item = {
          id: row.id,
          name: row.name,
          tier: row.tier as GameItem['tier'],
          category: row.category ?? undefined,
          baseValue: row.baseValue ?? undefined,
        };
      }
    } catch {
      // Item fora do catálogo: o overlay não tem o que mostrar com ele.
      item = null;
    }
    if (item) this.cacheItem.set(id, item);
    return item;
  }

  /* ------------------------------------------------------------- tick */

  /**
   * ## Por que isso existe
   *
   * O tick saía em três pontos por `return` mudo. Com o loop "funcionando" e
   * o log em silêncio, "não faz o scan" tinha três causas possíveis — jogo sem
   * foco, nenhum frame chegando, ou worker morto — e nenhuma forma de saber
   * qual. Mudar o motivo loga uma vez por estado, não a cada tick.
   */
  private why(motivo: string): void {
    if (this.lastWhy === motivo && Date.now() - this.lastWhyAt < 5000) return;
    this.lastWhy = motivo;
    this.lastWhyAt = Date.now();
    const s = this.capture.stats;
    log.info(`scan parado: ${motivo} | frames=${s.frames} fps=${s.avgFps} vram=${s.vramMb}MB`);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.busy) return;

    // 1. o jogo está em foco?
    if (!this.capture.isRunning) return this.why('captura parada');
    const emFoco = this.capture.isGameFocused();
    this.publicarFoco(emFoco);
    if (!emFoco) return this.why('jogo sem foco');

    // 2. frame novo
    const frame = this.capture.takeFrame();
    if (!frame) return this.why('sem frame novo');

    /**
     * Todas as grades medidas, num request só.
     *
     * Mandar um request por painel custaria 8 MB de transfer por contêiner por
     * tique — cinco painéis seriam 40 MB a 4 Hz, mais bandwidth que a
     * inferência. E cinco sessões de ONNX em vez de um lote, que é onde a
     * economia real está: 20 células num `run` custam 15,6 ms contra 2,2 ms
     * por chamada isolada.
     */
    const regioes = this.paineisVaridos.map((p) => ({
      id: p.id,
      rect: panelRect(p, frame.width, frame.height),
      cols: p.cols,
      rows: p.rows,
      cells: cellsOf(p, frame.width, frame.height),
    }));
    const principal = this.paineisVaridos[0]!;
    const roi = regioes[0]!.rect;

    /**
     * ## O OCR não custa o mesmo que a varredura, e não roda todo quadro
     *
     * Medido no frame real, mesma imagem e mesmas 8 células ocupadas:
     *
     *     varredura inteira      246 ms   (OCR na tela toda)
     *     varredura sem OCR      90 ms   (OCR só no painel)
     *     encoder + busca        45 ms
     *
     * O encoder virou barato — 8 células, um lote, 45 ms — e o OCR virou o
     * gargalo, 4x o resto junto. Rodando a cada quadro ele comia o orçamento
     * inteiro do overlay.
     */
    const agora = Date.now();
    const querOcr = agora - this.ultimoOcr >= this.intervaloOcrMs;
    if (querOcr) this.ultimoOcr = agora;

    this.busy = true;
    try {
      const payload = (await this.request({
        type: 'scan',
        frame: { width: frame.width, height: frame.height, pixels: frame.data },
        roi,
        regioes,
        // `gridCols`/`gridRows` descrevem o painel principal. Vinham fixos em
        // 4 e 5 para todos — errado no USO RAPIDO (3x2) e no BOLSO SEGURO
        // (3x1).
        gridCols: principal.cols,
        gridRows: principal.rows,
        // O recorte agora é escolhido pelo leitor (`shared/src/hud.ts`); o main
        // só decide **quando** pedir. Antes mandava `ocrRoi`, e um retângulo de
        // 0x0 fazia o worker passar o frame inteiro para o motor — 180 ms por
        // quadro, que era o gargalo do scan.
        querOcr,
      })) as WorkerPayload;

      const now = Date.now();
      this.scans++;
      if (now - this.windowStart >= 1000) {
        this.hz = Math.round((this.scans * 1000) / (now - this.windowStart));
        this.scans = 0;
        this.windowStart = now;
      }

      const r: ScanResultView = {
        cells: payload.cells.map((c) => ({
          index: c.index,
          regiao: c.regiao,
          x: c.rect.x,
          y: c.rect.y,
          width: c.rect.width,
          height: c.rect.height,
          itemId: c.itemId,
          score: c.score,
          runnerUp: c.runnerUp,
        })),
        cols: payload.grid?.cols ?? 0,
        rows: payload.grid?.rows ?? 0,
        detected: !payload.fallback,
        degraded: payload.fallback,
        ms: payload.ms,
        hz: this.hz,
        timestamp: now,
        detections: this.resolverDeteccoes(payload),
        hud: this.absorverHud(payload.hud),
        visivel: true,
        painel: payload.painel ?? principal.id,
      };
      this.lastResult = r;
      this.lastError = null;

      /**
       * Resumo do que saiu, uma vez por resultado mudado.
       *
       * Sem isto, "o overlay não mostra nada" e "o classificador errou tudo"
       * são a mesma tela: nenhuma badge e nenhum erro. O log diz qual dos dois
       * é — `deteccoes=0` com `via=encoder` é catálogo; `deteccoes=0` com
       * `via=dhash` é galeria que não carregou.
       *
       * O HUD entra porque ele **falha em silencio por natureza**: um contador
       * que não leu e um contador que leu zero, e a tela mostra os dois do
       * mesmo jeito.
       */
      const chave =
        `${r.detections.length}:${payload.cells.map((c) => c.itemId ?? '').join(',')}` +
        `:${JSON.stringify(r.hud?.contadores ?? {})}` +
        `:${r.hud?.total ?? ''}`;
      if (chave !== this.ultimoResumo) {
        this.ultimoResumo = chave;
        const amostra = r.detections
          .slice(0, 4)
          .map((d) => `${d.item.id}@${d.confidence.toFixed(2)}`)
          .join(' ');
        const hudTxt = r.hud
          ? [
              Object.entries(r.hud.contadores)
                .map(([id, c]) => `${id}=${c.ocupado}/${c.capacidade}`)
                .join(' '),
              `total=${r.hud.total}`,
              `ocr=${r.hud.ms.toFixed(0)}ms`,
              r.hud.indisponivel ? 'INDISPONIVEL' : '',
            ]
              .filter(Boolean)
              .join(' ')
          : 'hud=(nenhum)';

        log.info(
          `via=${payload.via ?? '?'} grade=${r.cols}x${r.rows} ` +
            `deteccoes=${r.detections.length}/${r.cells.length} ` +
            `${r.ms.toFixed(0)}ms | hud ${hudTxt} | ${amostra}`,
        );
      }

      this.gx.overlay.broadcast(OverlayChannel.SCAN_RESULT, r);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      log.warn('scan falhou', this.lastError);
    } finally {
      this.busy = false;
    }
  }
}

function envString(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}