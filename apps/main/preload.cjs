/**
 * Preload único compartilhado pelas duas janelas.
 * Expor no máximo o que está declarado em `@arcgx/shared/api` — nada de
 * ipcRenderer cru, nada de Node.
 */
const { contextBridge, ipcRenderer } = require('electron');

const C = {
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
  LIST_GAME_FILE: 'desktop:list-game-file',
  LIST_STASH: 'desktop:list-stash',
  LIST_RAIDS: 'desktop:list-raids',
  GAME_UPDATE_CHECK: 'desktop:game-update-check',
  GAME_UPDATE_RESOLVE: 'desktop:game-update-resolve',
  EVENTS_SNAPSHOT: 'desktop:events-snapshot',
  PLAYERS_COUNT: 'desktop:players-count',
  OPEN_LOGS_FOLDER: 'desktop:open-logs-folder',
  LIST_GAME_WINDOWS: 'desktop:list-game-windows',
  START_CAPTURE: 'desktop:start-capture',
  STOP_CAPTURE: 'desktop:stop-capture',
  OPEN_EXTERNAL: 'desktop:open-external',
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
  CONFIG_CHANGED: 'desktop:config-changed',
  STATUS_CHANGED: 'desktop:status-changed',
  AUTH_CHANGED: 'desktop:auth-changed',
  UPDATE_STATE: 'desktop:update-state',

  READY: 'overlay:renderer-ready',
  SET_INTERACTIVE: 'overlay:set-interactive',
  CLEAR: 'overlay:clear',
  TOGGLE_VISIBILITY: 'overlay:toggle-visibility',
  SET_SCAN_TARGET_HZ: 'overlay:set-scan-target-hz',
  NAME_UNKNOWN: 'overlay:name-unknown',
  CANCEL_UNKNOWN: 'overlay:cancel-unknown',
  SCAN_RESULT: 'overlay:scan-result',
  CONFIG: 'overlay:config',
  NOTICE: 'overlay:notice',
  STASH_STATUS: 'overlay:stash-status',
  SEARCH_OPEN: 'overlay:search-open',
  SEARCH_CLOSE: 'overlay:search-close',
  SEARCH_RESULTS: 'overlay:search-results',
};

/** Assina um canal e devolve a função de cancelamento. */
function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const desktopApi = {
  getConfig: () => ipcRenderer.invoke(C.GET_CONFIG),
  setConfig: (patch) => ipcRenderer.invoke(C.SET_CONFIG, patch),
  getStatus: () => ipcRenderer.invoke(C.GET_STATUS),
  getDiagnostics: () => ipcRenderer.invoke(C.GET_DIAGNOSTICS),

  login: () => ipcRenderer.invoke(C.LOGIN),
  logout: () => ipcRenderer.invoke(C.LOGOUT),
  getAuthState: () => ipcRenderer.invoke(C.GET_AUTH_STATE),

  listItems: (query, limit) => ipcRenderer.invoke(C.LIST_ITEMS, query, limit),
  getItemDetail: (id) => ipcRenderer.invoke(C.GET_ITEM_DETAIL, id),
  listQuests: () => ipcRenderer.invoke(C.LIST_QUESTS),
  listProjects: () => ipcRenderer.invoke(C.LIST_PROJECTS),
  listGameFile: (name) => ipcRenderer.invoke(C.LIST_GAME_FILE, name),
  listStash: () => ipcRenderer.invoke(C.LIST_STASH),
  listRaids: () => ipcRenderer.invoke(C.LIST_RAIDS),
  gameUpdateCheck: () => ipcRenderer.invoke(C.GAME_UPDATE_CHECK),
  gameUpdateResolve: (key) => ipcRenderer.invoke(C.GAME_UPDATE_RESOLVE, key),
  eventsSnapshot: () => ipcRenderer.invoke(C.EVENTS_SNAPSHOT),
  playersCount: () => ipcRenderer.invoke(C.PLAYERS_COUNT),
  playersRefresh: () => ipcRenderer.invoke(C.PLAYERS_COUNT, true),
  onPlayersCount: (cb) => {
    const l = (_e, s) => cb(s);
    ipcRenderer.on(C.PLAYERS_COUNT, l);
    return () => ipcRenderer.removeListener(C.PLAYERS_COUNT, l);
  },
  onEventsSnapshot: (cb) => {
    const l = (_e, s) => cb(s);
    ipcRenderer.on(C.EVENTS_SNAPSHOT, l);
    return () => ipcRenderer.removeListener(C.EVENTS_SNAPSHOT, l);
  },

  openLogsFolder: () => ipcRenderer.invoke(C.OPEN_LOGS_FOLDER),
  listGameWindows: () => ipcRenderer.invoke(C.LIST_GAME_WINDOWS),
  startCapture: (hwnd) => ipcRenderer.invoke(C.START_CAPTURE, hwnd),
  stopCapture: () => ipcRenderer.invoke(C.STOP_CAPTURE),
  openExternal: (url) => ipcRenderer.invoke(C.OPEN_EXTERNAL, url),
  quit: () => ipcRenderer.invoke(C.QUIT),

  getCredits: () => ipcRenderer.invoke(C.GET_CREDITS),
  openCredits: () => ipcRenderer.invoke(C.OPEN_CREDITS),

  getEntitlement: () => ipcRenderer.invoke(C.GET_ENTITLEMENT),
  redeemCode: (code) => ipcRenderer.invoke(C.REDEEM_CODE, code),
  getPending: () => ipcRenderer.invoke(C.GET_PENDING),
  syncData: () => ipcRenderer.invoke(C.SYNC_DATA),
  flushPending: () => ipcRenderer.invoke(C.FLUSH_PENDING),
  submitCorrection: (report) => ipcRenderer.invoke(C.SUBMIT_CORRECTION, report),

  checkUpdate: () => ipcRenderer.invoke(C.CHECK_UPDATE),
  installUpdate: () => ipcRenderer.invoke(C.INSTALL_UPDATE),

  onConfigChanged: (cb) => subscribe(C.CONFIG_CHANGED, cb),
  onStatusChanged: (cb) => subscribe(C.STATUS_CHANGED, cb),
  onAuthChanged: (cb) => subscribe(C.AUTH_CHANGED, cb),
  onUpdateState: (cb) => subscribe(C.UPDATE_STATE, cb),
};

const overlayApi = {
  ready: () => ipcRenderer.send(C.READY),
  setInteractive: (on) => ipcRenderer.invoke(C.SET_INTERACTIVE, on),
  clear: () => ipcRenderer.invoke(C.CLEAR),
  toggleVisibility: () => ipcRenderer.invoke(C.TOGGLE_VISIBILITY),
  setScanTargetHz: (hz) => ipcRenderer.invoke(C.SET_SCAN_TARGET_HZ, hz),
  nameUnknown: (signal, name) => ipcRenderer.invoke(C.NAME_UNKNOWN, signal, name),
  cancelUnknown: () => ipcRenderer.invoke(C.CANCEL_UNKNOWN),

  onScanResult: (cb) => subscribe(C.SCAN_RESULT, cb),
  onIdentify: (cb) => subscribe(C.IDENTIFY, cb),
  onConfig: (cb) => subscribe(C.CONFIG, cb),
  onNotice: (cb) => subscribe(C.NOTICE, cb),
  onStashStatus: (cb) => subscribe(C.STASH_STATUS, cb),
  onSearchOpen: (cb) => subscribe(C.SEARCH_OPEN, cb),
  onSearchClose: (cb) => subscribe(C.SEARCH_CLOSE, cb),
  onSearchResults: (cb) => subscribe(C.SEARCH_RESULTS, cb),
};

contextBridge.exposeInMainWorld('arcgx', {
  desktop: desktopApi,
  overlay: overlayApi,
});