import type {
  AppConfig,
  AppStatus,
  AttributionFile,
  CorrectionReport,
  DataPatch,
  Entitlement,
  GameItem,
  PremiumFeatures,
  ScanResult,
  SubmitResult,
  UnknownSignal,
  UpdateState,
} from './types.js';
import type { UpdateCheck } from './game-update.js';
import type { GameWindow, CaptureStartResult } from './capture.js';
import type { PlayerCount } from './players.js';

export interface Diagnostics {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: string;
  arch: string;
  cwd: string;
  userData: string;
  uptimeSec: number;
  memoryMb: number;
  env: Record<string, string>;
}

/** Uma pilha lida do inventário. `qty` é o que o jogador tem. */
export interface StashEntry {
  itemId: string;
  name: string;
  qty: number;
  tier: string;
  category?: string;
  baseValue?: number;
  imageUrl?: string;
  /** 1-based, para ordenar como o jogador vê na mochila. */
  slot: number;
}

/** Incursão registrada localmente. */
export interface RaidRecord {
  id: string;
  startedAt: number;
  endedAt?: number | null;
  map?: string | null;
  outcome?: string | null;
  kills: number;
  lootValue: number;
}

/** Superfície exposta ao renderer do painel via contextBridge. */
export interface DesktopApi {
  getConfig(): Promise<AppConfig>;
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
  getStatus(): Promise<AppStatus>;
  getDiagnostics(): Promise<Diagnostics>;

  login(): Promise<void>;
  logout(): Promise<void>;
  getAuthState(): Promise<{ signedIn: boolean; userId: string | null; name: string | null }>;

  listItems(query: string, limit: number): Promise<GameItem[]>;
  getItemDetail(id: string): Promise<GameItem | null>;
  listQuests(): Promise<unknown[]>;
  listProjects(): Promise<unknown[]>;

  /**
   * Qualquer `game/*.json` da release, pelo nome do arquivo.
   *
   * Um canal só para quests, projetos, arvore de pesquisa, mapas e inimigos
   * em vez de um endpoint por arquivo. O main valida contra a lista fechada de
   * arquivos de jogo — o nome vem do renderer e não pode virar caminho livre.
   */
  listGameFile(name: string): Promise<unknown>;

  /** Pilhas lidas da captura do inventario, por categoria de stash. */
  listStash(): Promise<StashEntry[]>;
  /** Incursões registradas no sqlite local. */
  listRaids(): Promise<RaidRecord[]>;

  /** Novidade no catálogo do jogo. Roda sozinho no main; isto só consulta. */
  gameUpdateCheck(): Promise<UpdateCheck | null>;
  /** O usuário respondeu ao aviso de novidade; some da fila. */
  gameUpdateResolve(key: string): Promise<void>;

  /** Agenda de eventos recém-coletada da fonte (o main atualiza sozinho). */
  eventsSnapshot(): Promise<unknown>;
  onEventsSnapshot(cb: (s: unknown) => void): () => void;

  /** Jogadores online na Steam (o main atualiza sozinho). */
  playersCount(): Promise<PlayerCount>;
  /** Força a releitura, ignorando o intervalo mínimo de 1 min. */
  playersRefresh(): Promise<PlayerCount>;
  onPlayersCount(cb: (p: PlayerCount) => void): () => void;

  openLogsFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
  quit(): Promise<void>;

  /* ------------------------------------------------ captura e visao */

  /** Janelas visíveis, com título já normalizado (`cleanTitle`). */
  listGameWindows(): Promise<GameWindow[]>;
  /**
   * Inicia a captura na janela dada. Sem argumento, tenta achar a janela do
   * jogo pelo título normalizado.
   */
  startCapture(hwnd?: number): Promise<CaptureStartResult>;
  stopCapture(): Promise<{ ok: boolean }>;

  /** Créditos de dados. `sources[].required === true` precisa ser exibido. */
  getCredits(): Promise<AttributionFile>;
  openCredits(): Promise<void>;

  /** Plano e o que ele destrava. */
  getEntitlement(): Promise<{ entitlement: Entitlement; features: PremiumFeatures }>;
  redeemCode(code: string): Promise<{ ok: boolean; message: string }>;

  /** Fila de correções ainda não publicadas. */
  getPending(): Promise<CorrectionReport[]>;
  syncData(): Promise<DataPatch | null>;
  flushPending(): Promise<number>;
  submitCorrection(report: CorrectionReport): Promise<SubmitResult>;

  checkUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;

  /* eventos main -> renderer */
  onConfigChanged(cb: (cfg: AppConfig) => void): () => void;
  onStatusChanged(cb: (status: AppStatus) => void): () => void;
  onAuthChanged(cb: (state: { signedIn: boolean }) => void): () => void;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
}

/** Superfície exposta ao renderer do HUD via contextBridge. */
export interface OverlayApi {
  ready(): void;
  setInteractive(interactive: boolean): Promise<void>;
  clear(): Promise<void>;
  toggleVisibility(): Promise<boolean>;
  setScanTargetHz(hz: number): Promise<void>;

  /** Envia a resposta do usuário ao item desconhecido. */
  nameUnknown(signal: UnknownSignal, name: string): Promise<SubmitResult>;
  /** O usuário fechou o prompt sem nomear — some com o realce. */
  cancelUnknown(): Promise<void>;

  onScanResult(cb: (result: ScanResult) => void): () => void;
  /** Atalho global pediu o prompt de nomear o item de menor confianca. */
  onIdentify(cb: () => void): () => void;
  onConfig(cb: (cfg: AppConfig) => void): () => void;
  onNotice(cb: (notice: { level: 'info' | 'warn' | 'error'; message: string }) => void): () => void;
  onStashStatus(cb: (status: { count: number; capacity: number }) => void): () => void;
  onSearchOpen(cb: () => void): () => void;
  onSearchClose(cb: () => void): () => void;
  onSearchResults(cb: (results: GameItem[]) => void): () => void;
}