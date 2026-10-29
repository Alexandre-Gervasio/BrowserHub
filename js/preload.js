const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("browserHub", {
  addPanel: (data) => ipcRenderer.invoke("panels:add", data),
  removePanel: (id) => ipcRenderer.invoke("panels:remove", id),
  activatePanel: (id) => ipcRenderer.invoke("panels:activate", id),
  toggleMaximizePanel: (id) => ipcRenderer.invoke("panels:maximize", id),
  reorderPanels: (sourceId, targetId) =>
    ipcRenderer.invoke("panels:reorder", sourceId, targetId),
  duplicatePanel: (id) => ipcRenderer.invoke("panels:duplicate", id),
  togglePinPanel: (id) => ipcRenderer.invoke("panels:pin", id),
  renamePanel: (id, title) => ipcRenderer.invoke("panels:rename", id, title),
  restoreClosedPanel: () => ipcRenderer.invoke("panels:restore-closed"),
  setLayout: (mode) => ipcRenderer.invoke("panels:layout", mode),
  navigate: (data) => ipcRenderer.invoke("panels:navigate", data),
  goBack: (id) => ipcRenderer.invoke("panels:back", id),
  goForward: (id) => ipcRenderer.invoke("panels:forward", id),
  reload: (id) => ipcRenderer.invoke("panels:reload", id),
  stop: (id) => ipcRenderer.invoke("panels:stop", id),
  getState: () => ipcRenderer.invoke("panels:get-state"),
  setManagerOverlay: (enabled) =>
    ipcRenderer.invoke("panels:set-manager-overlay", enabled),
  listBookmarks: () => ipcRenderer.invoke("bookmarks:list"),
  addBookmark: (bookmark) => ipcRenderer.invoke("bookmarks:add", bookmark),
  removeBookmark: (id) => ipcRenderer.invoke("bookmarks:remove", id),
  createBookmarkFolder: (name) =>
    ipcRenderer.invoke("bookmarks:create-folder", name),
  listHistory: (query) => ipcRenderer.invoke("history:list", query),
  clearHistory: () => ipcRenderer.invoke("history:clear"),
  listWorkspaces: () => ipcRenderer.invoke("workspaces:list"),
  saveWorkspace: (name) => ipcRenderer.invoke("workspaces:save", name),
  openWorkspace: (id) => ipcRenderer.invoke("workspaces:open", id),
  removeWorkspace: (id) => ipcRenderer.invoke("workspaces:remove", id),
  getPrivacyStatus: (id) => ipcRenderer.invoke("privacy:status", id),
  setPrivateMode: (enabled) =>
    ipcRenderer.invoke("privacy:set-private-mode", enabled),
  clearBrowsingData: (options) =>
    ipcRenderer.invoke("privacy:clear-data", options),
  getPermissions: (id) => ipcRenderer.invoke("privacy:permissions", id),
  setPermission: (options) =>
    ipcRenderer.invoke("privacy:set-permission", options),
  listDownloads: () => ipcRenderer.invoke("downloads:list"),
  cancelDownload: (id) => ipcRenderer.invoke("downloads:cancel", id),
  showDownload: (id) => ipcRenderer.invoke("downloads:show", id),
  onPanelCreated: (callback) => subscribe("panel:created", callback),
  onPanelRemoved: (callback) => subscribe("panel:removed", callback),
  onPanelState: (callback) => subscribe("panel:state", callback),
  onPanelLoading: (callback) => subscribe("panel:loading", callback),
  onRestoreAvailability: (callback) =>
    subscribe("panels:restore-availability", callback),
  onPanelError: (callback) => subscribe("panel:error", callback),
  onActivePanel: (callback) => subscribe("panels:active", callback),
  onPanelsReordered: (callback) => subscribe("panels:reordered", callback),
  onLayoutChanged: (callback) => subscribe("panels:layout", callback),
  onPrivateModeChanged: (callback) =>
    subscribe("privacy:mode-changed", callback),
  onDownloadChanged: (callback) => subscribe("downloads:changed", callback),
});
