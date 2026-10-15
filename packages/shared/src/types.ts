export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Retângulo em coordenadas de tela (client), usado para posicionar o HUD. */
export interface ScreenRect extends Rect {}

import type { Tier } from './game-schema.js';

export type { Tier } from './game-schema.js';
export { TIER_ORDER } from './game-schema.js';
export type { DataAttribution, AttributionFile } from './game-schema.js';
export type {
  UnknownSignal,
  Correction,
  CorrectionField,
  CorrectionReport,
  SubmitResult,
  DataPatch,
  Entitlement,
  EntitlementTier,
  PremiumFeatures,
} from './backend-schema.js';

/**
 * Item no formato do Arc GX: já com o texto resolvido no idioma do usuário.
 * O bruto (com nomes por idioma) fica em `game-schema.ts` -> `RawGameItem`.
 */
export interface GameItem {
  id: string;
  name: string;
  tier: Tier;
  category?: string;
  description?: string;
  imageUrl?: string;
  stackSize?: number;
  /** Preço base na moeda do jogo, vindo de `items.json`. */
  baseValue?: number;
}

export interface ItemCell {
  /** Índice da célula dentro da grade do inventário (0-based). */
  index: number;
  rect: Rect;
}

export interface ItemDetection {
  cell: ItemCell;
  item: GameItem;
  /** 0..1 */
  confidence: number;
  /** embedding gallery que casou, para depuração */
  galleryHit?: string;
  /**
   * Item sem o sufixo de nível.
   *
   * 34 das 36 famílias do catálogo têm variantes de nível com **a mesma arte**:
   * muda só o numeral romano no canto da célula, que a moldura mascara antes
   * de codificar. O embedding identifica a família com confiança e não consegue
   * decidir o nível — quem decide é o leitor de numeral.
   *
   * Quando `levelVariant` é true, `item.id` é uma suposição dentro da família e
   * o overlay deve mostrar a família, não o valor do nível.
   */
  familia?: string | null;
  levelVariant?: boolean;
  /** segundo colocado, quando o caso é ambíguo de verdade */
  runnerUp?: string | null;
}

export interface TextBox {
  text: string;
  rect: Rect;
  confidence: number;
}

export interface OcrResult {
  boxes: TextBox[];
  engine: 'paddle' | 'windows';
  locale: string;
  ms: number;
}

export interface ScanResult {
  /** timestamp do frame capturado */
  t: number;
  detections: ItemDetection[];
  ocr?: OcrResult;
  /** ms gasto no frame inteiro */
  ms: number;
  /**
   * Contadores dos contêineres e total da raid, lidos do cabeçalho do jogo.
   *
   * Ausente enquanto nenhum quadro com OCR chegou. O overlay trata como "ainda
   * não leu" e não desenha — mostrar `0/0` num slot com item é pior do que não
   * mostrar, porque o usuário para de acreditar no número.
   *
   * O main preserva a última leitura válida entre quadros, porque o OCR roda a
   * 2 Hz e o scan a 30; sem isso o contador piscaria 14 vezes por segundo.
   */
  hud?: {
    contadores: Record<string, { ocupado: number; capacidade: number }>;
    total: number | null;
    ms: number;
    indisponivel?: boolean;
  };
  /** qual painel os badges cobrem */
  panel?: string;
  /**
   * O jogo está em foco agora?
   *
   * `false` vem com `detections` vazio e significa "não há inventário na tela":
   * o overlay **tem** de sumir. Sem este campo, as badges ficavam congeladas
   * sobre o desktop quando o jogador minimizava ou alt-tabava, com números
   * envelhecidos e nenhuma marca de que eram velhos.
   *
   * Ausente = true, para que um payload antigo não desapareça.
   */
  visivel?: boolean;
}

export interface CaptureFrameMeta {
  width: number;
  height: number;
  /** 'window' | 'screen' */
  source: 'window' | 'screen';
  /** HWND da janela capturada (quando source === 'window') */
  hwnd?: number;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface DataReleaseStatus {
  state: LoadState;
  manifestId: string | null;
  publishedAt: string | null;
  percent: number | null;
  error: string | null;
  /**
   * Itens indexados no sqlite local.
   *
   * Vive no status e não numa chamada própria porque o painel mostra "N itens
   * indexados" na primeira tela — sem isso, a home começa sem número e só
   * enche depois de uma ida e volta ao banco.
   */
  count: number | null;
}

export interface AppConfig {
  locale: string;
  overlayVisible: boolean;
  badgesEnabled: boolean;
  badgeOpacity: number;
  showPrices: boolean;
  showSatisfied: boolean;
  itemCardEnabled: boolean;
  noticesEnabled: boolean;
  /** Hz da inferência de item (pesado). */
  scannerTargetHz: number;
  /** Hz de refresh do HUD. */
  overlayHz: number;
  /** 'fast' | 'balanced' | 'low' */
  scannerMemory: 'fast' | 'balanced' | 'low';
  scannerCaptureEnabled: boolean;
  scannerDebugView: boolean;
  ocrEnabled: boolean;
  ocrEngine: 'auto' | 'paddle' | 'windows';
  ocrLanguage: string | null;
  panelHotkey: string;
  overlayHotkey: string;
/** abre o prompt de identificação do item sob o cursor */
identifyHotkey: string;
  /**
   * Fechar minimiza para a bandeja em vez de sair.
   *
   * Desligado (padrao), fechar sai. A razao do padrao ser sair: sem bandeja
   * nao ha destino para o painel, e "esconder e nao ter como voltar" deixa o
   * app um zumbi sobre o jogo. Ligando, sair passa a ser o item `Quit` do
   * menu da bandeja.
   */
  minimizeToTray: boolean;

  /**
   * URL base do feed de atualização, com `latest.yml` na raiz.
   *
   * ## ## ## Por que isso vive na config e não só no `electron-builder.yml`
   *
   * O padrão do `electron-updater` é o `app-update.yml` que o builder assina
   * dentro do pacote. Isso funciona, mas trocar o feed exige **rebuildar e
   * reinstalar** — e o repositório do Arc GX ainda nem existe, então o
   * primeiro usuário não teria como apontar para o repo certo.
   *
   * Vazio = usa o `app-update.yml` embutido. Preenchido = sobrescreve, sem
   * rebuild.
   */
  updateFeedUrl: string;
  windowBounds: { width: number; height: number; x?: number; y?: number } | null;
}

export type UpdateState =
  | { type: 'disabled'; reason?: string }
  | { type: 'checking' }
  | { type: 'available'; version: string; notes?: string }
  | { type: 'downloading'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

export interface AppStatus {
  version: string;
  electron: string;
  node: string;
  platform: string;
  capture: {
    available: boolean;
    running: boolean;
    source: 'window' | 'screen' | null;
    windowTitle: string | null;
    error: string | null;
  };
  vision: { available: boolean; error: string | null };
  ocr: { available: boolean; engine: 'paddle' | 'windows' | null; locale: string | null; error: string | null };
  dataRelease: DataReleaseStatus;
  update: UpdateState;
  fps: { scan: number; overlay: number };
  memoryMb: number;
}