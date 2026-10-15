import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker as WorkerThread, parentPort, workerData } from 'node:worker_threads';

import type { Rect } from '@arcgx/shared';
import type {
  BgraFrame,
  OcrRequest,
  ScanCell,
  ScanPayload,
  ScanRequest,
  WorkerInit,
  WorkerRequest,
  WorkerResponse,
  TextBox,
} from './protocol.js';
import { ItemClassifier } from './classifier.js';
import { EncoderClassifier, type CellImage, type SearchResult } from './encoder-classifier.js';
import type { LeituraHud } from './ocr-numeros.js';

const init = workerData as WorkerInit;
let provider: 'auto' | 'cpu' = init.provider ?? 'auto';
const threads = init.threads ?? Math.max(1, Math.floor(os.cpus().length / 2));

const requireCjs = createRequire(import.meta.url);

/* --------------------------------------------------------------- addons */

/** Superfície do @arcgx/cell-vision, gerada pelo build nativo. */
interface CellVisionAddon {
  prepareClassifierBatch(
    frame: Uint8Array,
    width: number,
    height: number,
    roi: { x: number; y: number; width: number; height: number },
    cellSize?: number,
  ): {
    data: Float32Array;
    cells: { index: number; x: number; y: number; width: number; height: number; confidence: number }[];
    cellSize: number;
    cols: number;
    rows: number;
    ms: number;
  };
}

let visionAddon: CellVisionAddon | null = null;

function loadVision(): CellVisionAddon | null {
  if (visionAddon) return visionAddon;
  for (const candidate of [
    '@arcgx/cell-vision',
    '../../cell-vision/index.js',
    '../../packages/native/cell-vision/index.js',
  ]) {
    try {
      visionAddon = requireCjs(candidate) as CellVisionAddon;
      return visionAddon;
    } catch {
      /* proximo candidato */
    }
  }
  return null;
}

/* ------------------------------------------------------------ ONNX Runtime */

import type { InferenceSession } from 'onnxruntime-common';

type OrtModule = typeof import('onnxruntime-node');
type OrtSession = InferenceSession;
type OrtOptions = InferenceSession.SessionOptions;

let ortPromise: Promise<OrtModule> | null = null;
const sessions = new Map<string, OrtSession>();

const loadOrt = (): Promise<OrtModule> => (ortPromise ??= import('onnxruntime-node'));

/**
 * `enableMemPattern: false` é requisito do EP DirectML: o padrão de memória é
 * montado para memória do host e quebra quando o tensor vive na VRAM.
 */
function sessionOptions(): OrtOptions {
  if (provider === 'cpu') {
    return {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      executionMode: 'sequential',
      intraOpNumThreads: threads,
      enableCpuMemArena: false,
      enableMemPattern: false,
      logSeverityLevel: 3,
    } as unknown as NonNullable<OrtOptions>;
  }
  return {
    executionProviders: ['dml', 'cpu'],
    graphOptimizationLevel: 'all',
    executionMode: 'sequential',
    intraOpNumThreads: threads,
    enableMemPattern: false,
    extra: { session: { 'dml.enable_mem_pattern': '0' } },
    logSeverityLevel: 3,
  } as unknown as NonNullable<OrtOptions>;
}

async function getSession(file: string): Promise<OrtSession> {
  const cached = sessions.get(file);
  if (cached) return cached;

  const ort = await loadOrt();
  const full = path.join(init.modelsDir, file);
  const wanted = provider;

  let session: OrtSession;
  try {
    session = await ort.InferenceSession.create(full, sessionOptions());
  } catch (err) {
    if (wanted === 'cpu') throw err;
    console.warn(`[${init.kind}] DirectML falhou (${(err as Error).message}); caindo para CPU`);
    provider = 'cpu';
    session = await ort.InferenceSession.create(full, sessionOptions());
  }

  sessions.set(file, session);
  return session;
}

async function disposeSessions(): Promise<void> {
  for (const [name, session] of sessions) {
    try {
      await session.release?.();
    } catch {
      /* ignore */
    }
    sessions.delete(name);
  }
}

/* ---------------------------------------------------------------- imagem */

/** Copia só a ROI — evita materializar o frame inteiro em memória nova. */
function crop(frame: BgraFrame, roi: Rect): BgraFrame {
  const x0 = Math.max(0, Math.min(frame.width - 1, Math.round(roi.x)));
  const y0 = Math.max(0, Math.min(frame.height - 1, Math.round(roi.y)));
  const w = Math.max(1, Math.min(frame.width - x0, Math.round(roi.width)));
  const h = Math.max(1, Math.min(frame.height - y0, Math.round(roi.height)));

  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * frame.width + x0) * 4;
    out.set(frame.pixels.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, pixels: out };
}

/** Grade regular na ROI. Usada só quando o detector nativo não carrega. */
function gridCells(roi: Rect, cols: number, rows: number): { index: number; rect: Rect }[] {
  const cells: { index: number; rect: Rect }[] = [];
  const cw = roi.width / cols;
  const ch = roi.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ index: r * cols + c, rect: { x: roi.x + c * cw, y: roi.y + r * ch, width: cw, height: ch } });
    }
  }
  return cells;
}

/**
 * ## ## ## O addon nativo foi desligado de proposito
 *
 * `@arcgx/ocr` nunca funcionou. O `IBuffer` que ele entrega a WinRT tem
 * `Length = 0`, a imagem nao chega ao recognizer, e ele devolve zero palavras
 * em 9,7 ms **sem erro**. `ocrSupport()` respondia `available: true` porque so
 * checava se as APIs existem — o app publicava `engine: 'windows'` com zero
 * palavras como se estivesse saudavel, e todo contador falhava em silencio.
 *
 * `tools/ocr-probe.mjs` reproduz o diagnostico em quatro linhas, sem depender
 * do jogo estar aberto.
 *
 * ## ## ## Por que o Tesseract roda em thread separada
 *
 * Ele carrega um WASM de 3 MB e leva ~200 ms na primeira leitura. Dentro da
 * thread de scan isso segura o loop inteiro. Num `worker_thread` proprio ele
 * trava, se quiser, e nao leva o scan junto.
 */

const REQUEST_OCR = 'ocr:ler-numeros';

let ocrChild: WorkerThread | null = null;
let ocrChildPromise: Promise<WorkerThread | null> | null = null;

/**
 * id -> resolver.
 *
 * Guarda o `resolve`, e nao so a promessa: o teto abaixo precisa **resolver**
 * a promessa, e nao apenas apagar a entrada do mapa. Guardar so o resolve e
 * guardar a promessa e a mesma coisa com nomes diferentes.
 */
const leiturasPendentes = new Map<number, (r: LeituraHud | null) => void>();
let proximoIdOcr = 1;

function subirOcrChild(resourcesDir: string): Promise<WorkerThread | null> {
  if (ocrChildPromise) return ocrChildPromise;
  ocrChildPromise = (async () => {
    try {
      // Caminho explicito: `subirOcrChild` e funcao solta, e `this.script`
      // ali seria `undefined` — o Worker criado nao teria script nenhum e
      // morreria com um erro que nao aponta para a causa.
      const aqui = path.dirname(fileURLToPath(import.meta.url));
      const w = new WorkerThread(path.join(aqui, 'ocr-worker.js'), {
        workerData: { kind: 'ocr-numeros', resourcesDir },
      });
      w.on('message', (msg: { id: number; payload?: LeituraHud | null }) => {
        const r = leiturasPendentes.get(msg.id);
        if (r) {
          leiturasPendentes.delete(msg.id);
          r(msg.payload ?? null);
        }
      });
      w.on('error', (err) => console.warn(`[ocr] thread caiu: ${err.message}`));
      ocrChild = w;
      return w;
    } catch (err) {
      console.warn(`[ocr] nao subiu: ${(err as Error).message}`);
      return null;
    }
  })();
  return ocrChildPromise;
}

/**
 * Le os contadores e o total, com teto de 4 s.
 *
 * O teto existe porque um `postMessage` sem resposta trava o scan para sempre,
 * e nao ha como cancelar do outro lado. Perder o numero do quadro e melhor do
 * que perder o loop.
 */
async function lerNumeros(resourcesDir: string, frame: BgraFrame): Promise<LeituraHud | null> {
  const w = await subirOcrChild(resourcesDir);
  if (!w) return null;

  const id = proximoIdOcr++;
  const promessa = new Promise<LeituraHud | null>((resolve) => {
    leiturasPendentes.set(id, resolve);
  });

  // O frame vai inteiro e o leitor escolhe os recorte: 8 MB por transferencia,
  // mas isso roda a 2 Hz, nao a 30.
  w.postMessage({ type: REQUEST_OCR, id, frame });

  const teto = setTimeout(() => {
    const r = leiturasPendentes.get(id);
    if (r) {
      leiturasPendentes.delete(id);
      console.warn('[ocr] leitura demorou demais; descartada');
      r(null);
    }
  }, 4000);

  const leitura = await promessa;
  clearTimeout(teto);
  return leitura;
}

/**
 * Recorta um retângulo do frame para um buffer contíguo.
 *
 * O OCR não aceita stride: precisa de `width * 4` bytes por linha sem
 * preenchimento. O `crop` acima serve para detecção, que varre linha a linha;
 * aqui é preciso copiar de verdade.
 */
function cropTight(frame: BgraFrame, roi: Rect): { pixels: Uint8Array; width: number; height: number } {
  const x0 = Math.max(0, Math.min(frame.width - 1, Math.round(roi.x)));
  const y0 = Math.max(0, Math.min(frame.height - 1, Math.round(roi.y)));
  const w = Math.max(1, Math.min(frame.width - x0, Math.round(roi.width)));
  const h = Math.max(1, Math.min(frame.height - y0, Math.round(roi.height)));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * frame.width + x0) * 4;
    out.set(frame.pixels.subarray(src, src + w * 4), y * w * 4);
  }
  return { pixels: out, width: w, height: h };
}

/* -------------------------------------------------------------- handlers */

let classifier: ItemClassifier | null = null;
let classifierTried = false;

function loadClassifier(): ItemClassifier | null {
  if (classifier || classifierTried) return classifier;
  classifierTried = true;
  try {
    // `require` não existe em módulo ESM — o `requireCjs` do topo do arquivo é
    // que funciona. Sem isto a galeria nunca carrega e o classificador
    // degrada para "tudo desconhecido" sem erro visível.
    const fs = requireCjs('node:fs');
    const path = requireCjs('node:path');
    const file = path.join(init.modelsDir, 'gallery.json');
    const gallery = JSON.parse(fs.readFileSync(file, 'utf8'));
    const clf = new ItemClassifier();
    clf.load(gallery);
    classifier = clf;
    console.warn(`[scan] galeria carregada: ${clf.size} icones`);
  } catch (err) {
    console.warn(`[scan] galeria indisponivel: ${(err as Error).message}`);
  }
  return classifier;
}

/* ------------------------------------------------------- encoder (embeddings) */

let encoder: EncoderClassifier | null = null;
let encoderPromise: Promise<EncoderClassifier | null> | null = null;

/**
 * Carrega a galeria de embeddings uma vez por worker.
 *
 * Falhar aqui **não** é fatal: o dHash abaixo cobre o scan até a galeria
 * aparecer, que é a diferença entre "overlay sem item" e "overlay nenhum".
 * A promessa fica memoizada para não repetir a leitura de 5,5 MB por frame.
 */
function loadEncoder(): Promise<EncoderClassifier | null> {
  if (encoder) return Promise.resolve(encoder);
  encoderPromise ??= (async () => {
    try {
      const dir = init.resourcesDir ?? init.modelsDir;
      const e = await EncoderClassifier.create(dir);
      encoder = e;
      console.warn(`[scan] encoder carregado: ${e.size} itens, ${e.space}, ${e.lado}px`);
      return e;
    } catch (err) {
      console.warn(`[scan] encoder indisponivel: ${(err as Error).message}`);
      return null;
    }
  })();
  return encoderPromise;
}

/** Recorta e codifica um lote de retangulos ja conhecidos. */
async function codificar(
  frame: BgraFrame,
  rects: Rect[],
): Promise<SearchResult[] | null> {
  const enc = await loadEncoder();
  if (!enc) return null;
  const imagens: CellImage[] = rects.map((r) => {
    const c = cropTight(frame, r);
    return { pixels: c.pixels, width: c.width, height: c.height };
  });
  try {
    return await enc.recognize(imagens);
  } catch (err) {
    console.warn(`[scan] encoder falhou no lote: ${(err as Error).message}`);
    return null;
  }
}

/**
 * O slot esta vazio?
 *
 * ## ## ## Por que o `std < 6` do Python nao serviu
 *
 * `ml/contar-live.py` trata desvio abaixo de 6 como celula vazia e, com isso,
 * marcou as 20 celulas da mochila como cheias numa captura real: os slots
 * vazios medem ~12, nao menos de 6. O limiar nunca disparou e o filtro era
 * decorativo.
 *
 * A separacao real e limpa. Medido nas 20 celulas do MOCHILA, olhando so a
 * faixa da arte (linhas 0..86, acima da barra, que ja e uniforme):
 *
 *     ocupadas  35,7 .. 66,5
 *     vazias    11,7 .. 12,7
 *
 * Nao ha sobreposicao, e a folga e de 3x dos dois lados. Daí 20, no meio da
 * maior folga relativa, em vez de perto de qualquer extremo.
 *
 * Alem de corrigir, economiza: uma mochila com 8 ocupadas vira 8 passes do
 * encoder em vez de 20, e o lote encolhe junto.
 */
function celulaVazia(pixels: Uint8Array, width: number, height: number): boolean {
  const yMax = Math.max(1, Math.round((86 / 104) * height));
  let soma = 0;
  let soma2 = 0;
  let n = 0;
  for (let y = 0; y < yMax; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      // Luma: um canal so bastaria, e nao compensa ler tres.
      const v = pixels[p]! * 0.114 + pixels[p + 1]! * 0.587 + pixels[p + 2]! * 0.299;
      soma += v;
      soma2 += v * v;
      n++;
    }
  }
  if (n === 0) return true;
  const media = soma / n;
  return Math.sqrt(Math.max(0, soma2 / n - media * media)) < 20;
}

/**
 * Recorta os slots ocupados e joga fora os vazios.
 *
 * Devolve `null` quando **todos** estao vazios: ai nem vale abrir a sessao
 * do ONNX, e o scan responde de imediato.
 */
function recortarOcupados(frame: BgraFrame, rects: Rect[]): { rects: Rect[]; indices: number[] } | null {
  const ocupadas: Rect[] = [];
  const indices: number[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    const c = cropTight(frame, r);
    if (celulaVazia(c.pixels, c.width, c.height)) continue;
    ocupadas.push(r);
    indices.push(i);
  }
  return ocupadas.length ? { rects: ocupadas, indices } : null;
}

async function handleScan(msg: ScanRequest): Promise<ScanPayload> {
  const t0 = performance.now();
  let via: 'encoder' | 'dhash' | 'nenhum' = 'nenhum';

  /**
   * ## Caminho principal: as grades medidas pelo main, todas num request
   *
   * `msg.regioes` traz um painel por contêiner, com os retângulos já medidos.
   * O detector nativo de grade fica fora do caminho: em captura real ele
   * montou 5x7 no MOCHILA, que é 4x6, e devolveu `fallback: false` como se
   * estivesse certo. Inferir o que já se sabe só troca precisão por risco.
   *
   * Todos os painéis são codificados **num lote**. Separar por painel daria
   * uma sessão de ONNX por contêiner — 5 sessoes de runtime em vez de uma —
   * e é o lote que paga: 20 células num `run` custam 15,6 ms contra 2,2 ms
   * por chamada isolada.
   */
  const celulasTotais: ScanCell[] = [];
  const ocupadasTotal: Rect[] = [];
  const indiceOcupadas = new Map<number, { indice: number; rect: Rect }>();
  let offset = 0;
  let algumaOcupada = false;

  for (const regiao of msg.regioes) {
    for (const rect of regiao.cells) {
      celulasTotais.push({
        index: offset,
        regiao: regiao.id,
        rect,
        itemId: null,
        score: 0,
        runnerUp: null,
        familia: null,
        levelVariant: false,
      });
      offset++;
    }
  }

  for (let i = 0; i < celulasTotais.length; i++) {
    const c = cropTight(msg.frame, celulasTotais[i]!.rect);
    if (celulaVazia(c.pixels, c.width, c.height)) continue;
    indiceOcupadas.set(i, { indice: i, rect: celulasTotais[i]!.rect });
    ocupadasTotal.push(celulasTotais[i]!.rect);
    algumaOcupada = true;
  }

  if (algumaOcupada) {
    const hits = await codificar(msg.frame, ocupadasTotal);
    if (hits) {
      via = 'encoder';
      /**
       * `values()` e nao `keys().entries()`: o Map e chaveado pelo indice da
       * celula, que nao coincide com a posicao no array de ocupadas. Com
       * `keys().entries()` o `get(slot)` procurava a chave pela posicao e
       * devolvia `undefined` — "Cannot read properties of undefined
       * (reading 'indice')" no primeiro item com conteudo.
       */
      let k = 0;
      for (const ref of indiceOcupadas.values()) {
        const h = hits[k]!;
        const alvo = celulasTotais[ref.indice]!;
        k++;
        // Três motivos distintos para devolver `null`, e todos importam:
        //   - `ambiguous`: duas famílias diferentes com arte parecida. Acerto
        //     não é possível, e chutar mostra valor errado com confiança.
        //   - `!confiavel`: o melhor vizinho está longe demais para ser este
        //     item (slot vazio, barra, célula em transição).
        //   - Variante de nível **não** é motivo: `torrente-iv` e
        //     `torrente-iii` têm a mesma arte, e `familia` já responde "é um
        //     torrente". O número sai do leitor de numeral.
        const ok = !h.ambiguous && h.confiavel;
        alvo.itemId = ok ? h.itemId : null;
        alvo.score = h.score;
        alvo.runnerUp = h.runnerUp;
        // `familia` também é null quando ambíguo: do contrário um slot vazio
        // que passa de `minScore` por pouco exibiria "action-economy" num
        // slot que não tem item nenhum.
        alvo.familia = ok ? h.familia : null;
        alvo.levelVariant = h.levelVariant;
      }
    } else {
      via = 'nenhum';
    }
  } else {
    // Nada ocupado em nenhum painel: responder sem abrir sessão de ONNX.
    via = 'nenhum';
  }

  const grid = (() => {
    // A grade "vista" é a do painel principal; os demais entram em `cells`.
    const principal = msg.regioes[0];
    if (!principal) return null;
    return { cols: principal.cols, rows: principal.rows };
  })();

  const cells = celulasTotais;

  const payload: ScanPayload = {
    cells,
    grid,
    ms: performance.now() - t0,
    fallback: false,
    classified: cells.filter((c) => c.itemId !== null).length,
    via,
    painel: msg.regioes[0]?.id ?? null,
  };

  if (msg.querOcr) {
    const leitura = await lerNumeros(init.resourcesDir ?? init.modelsDir, msg.frame);
    if (leitura) {
      payload.hud = {
        contadores: leitura.contadores,
        total: leitura.total,
        ms: leitura.ms,
      };
    } else {
      payload.hud = { contadores: {}, total: null, ms: 0, indisponivel: true };
    }
  }

  payload.ms = performance.now() - t0;
  return payload;
}

/**
 * Mensagem `ocr` do protocolo antigo.
 *
 * Só existe para o envelope `WorkerRequest` continuar fechado. A leitura de
 * números é feita por `querOcr` dentro do próprio scan, e por isso usa outra
 * thread — esta aqui carregaria a galeria de embeddings e o pool de inferencia
 * sem precisar de nenhum dos dois.
 */
async function handleOcr(msg: OcrRequest): Promise<unknown> {
  return { boxes: [], engine: 'tesseract', locale: msg.language ?? 'pt-BR', ms: 0 };
}

async function dispatch(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'scan':
      return handleScan(msg);
    case 'ocr':
      return handleOcr(msg);
    case 'configure':
      provider = msg.provider;
      await disposeSessions();
      return { provider };
    default: {
      const never: never = msg;
      throw new Error(`mensagem desconhecida: ${JSON.stringify(never)}`);
    }
  }
}

if (!parentPort) throw new Error('este arquivo precisa rodar em worker_threads');

parentPort.on('message', (msg: WorkerRequest) => {
  void dispatch(msg).then(
    (payload) => parentPort?.postMessage({ id: msg.id, ok: true, payload } satisfies WorkerResponse),
    (err: unknown) =>
      parentPort?.postMessage({
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse),
  );
});