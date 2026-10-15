/**
 * Canais IPC do Arc GX.
 *
 * Convenção: "<janela>:<ação>".
 *  - `desktop:*` -> painel de configuração
 *  - `overlay:*` -> HUD sobre o jogo
 *
 * Toda adição aqui precisa existir também em `PreloadApi` (api.ts).
 */

export const DesktopChannel = {
  GET_CONFIG: 'desktop:get-config',
  SET_CONFIG: 'desktop:set-config',
  GET_STATUS: 'desktop:get-status',
  GET_DIAGNOSTICS: 'desktop:get-diagnostics',

  LOGIN: 'desktop:login',
  LOGOUT: 'desktop:logout',
  GET_AUTH_STATE: 'desktop:get-auth-state',

  LIST_ITEMS: 'desktop:list-items',
  GET_ITEM_DETAIL: 'desktop:get-item-detail',

  LIST_QUESTS: 'desktop:list-quests',
  LIST_PROJECTS: 'desktop:list-projects',
  /** Qualquer `game/*.json` da release, por nome exato (whitelist no main). */
  LIST_GAME_FILE: 'desktop:list-game-file',
  /** Saque registrado a partir da captura do inventário. */
  LIST_STASH: 'desktop:list-stash',
  /** Histórico de incursões gravado no sqlite local. */
  LIST_RAIDS: 'desktop:list-raids',

  /** Checagem de novidade no catálogo do jogo. */
  GAME_UPDATE_CHECK: 'desktop:game-update-check',
  GAME_UPDATE_RESOLVE: 'desktop:game-update-resolve',

  /** Agenda de eventos ao vivo, recém-coletada da fonte. */
  EVENTS_SNAPSHOT: 'desktop:events-snapshot',

  /** Jogadores online na Steam. */
  PLAYERS_COUNT: 'desktop:players-count',

  OPEN_LOGS_FOLDER: 'desktop:open-logs-folder',

  /**
   * Captura de tela e visão computacional.
   *
   * Faltava o caminho inteiro: o `CaptureManager` tinha `startWindow()`, mas
   * nada o chamava — sem handler, sem preload, sem botão. O app mostrava
   * "captura é opt-in, começa nas Ajustes" e não existia lugar nenhum para
   * começar. A tela exibia o estado; não havia como mudá-lo.
   */
  LIST_GAME_WINDOWS: 'desktop:list-game-windows',
  START_CAPTURE: 'desktop:start-capture',
  STOP_CAPTURE: 'desktop:stop-capture',  OPEN_EXTERNAL: 'desktop:open-external',
  QUIT: 'desktop:quit',

  GET_CREDITS: 'desktop:get-credits',
  OPEN_CREDITS: 'desktop:open-credits',

  GET_ENTITLEMENT: 'desktop:get-entitlement',
  REDEEM_CODE: 'desktop:redeem-code',
  GET_PENDING: 'desktop:get-pending',
  SYNC_DATA: 'desktop:sync-data',
  SUBMIT_CORRECTION: 'desktop:submit-correction',
  FLUSH_PENDING: 'desktop:flush-pending',

  CHECK_UPDATE: 'desktop:check-update',
  INSTALL_UPDATE: 'desktop:install-update',

  /* main -> renderer */
  CONFIG_CHANGED: 'desktop:config-changed',
  STATUS_CHANGED: 'desktop:status-changed',
  AUTH_CHANGED: 'desktop:auth-changed',
  UPDATE_STATE: 'desktop:update-state',
} as const;

export const OverlayChannel = {
  /* renderer -> main */
  READY: 'overlay:renderer-ready',
  SET_INTERACTIVE: 'overlay:set-interactive',
  CLEAR: 'overlay:clear',
  TOGGLE_VISIBILITY: 'overlay:toggle-visibility',
  SET_SCAN_TARGET_HZ: 'overlay:set-scan-target-hz',

  /** O classificador não reconheceu o ícone: o HUD oferece nomear. */
  NAME_UNKNOWN: 'overlay:name-unknown',
  CANCEL_UNKNOWN: 'overlay:cancel-unknown',

  /* main -> renderer */
  SCAN_RESULT: 'overlay:scan-result',
  /** Ícone sem correspondência na base — o HUD abre o prompt de nomeação. */
  UNKNOWN_ITEM: 'overlay:unknown-item',
  GEOMETRY: 'overlay:geometry',
  CONFIG: 'overlay:config',
  NOTICE: 'overlay:notice',
  STASH_STATUS: 'overlay:stash-status',
  SEARCH_OPEN: 'overlay:search-open',
  SEARCH_CLOSE: 'overlay:search-close',
  SEARCH_RESULTS: 'overlay:search-results',
  /**
   * Atalho de identificacao disparado pelo main.
   *
   * Existe como evento proprio, e nao como um `SET_INTERACTIVE`: o HUD e
   * click-through e nao recebe teclado, entao o prompt de nomear item nao pode
   * "aparecer sozinho" de dentro dele. Quem pede e o atalho global.
   */
  IDENTIFY: 'overlay:identify',
} as const;

export type DesktopInvokeChannel = (typeof DesktopChannel)[keyof typeof DesktopChannel];
export type OverlayInvokeChannel = (typeof OverlayChannel)[keyof typeof OverlayChannel];