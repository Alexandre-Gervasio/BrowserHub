const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  session,
  shell,
} = require("electron");

const path = require("node:path");
const fs = require("node:fs");

let win;
const panels = new Map();
const recentlyClosed = [];

const TITLEBAR_HEIGHT = 53;
const TABS_HEIGHT = 43;
const TOOLBAR_HEIGHT = 0;
const CHROME_HEIGHT = TITLEBAR_HEIGHT + TABS_HEIGHT + TOOLBAR_HEIGHT;
const STATUS_HEIGHT = 28;
const PANEL_GAP = 8;
const SIDEBAR_WIDTH = 320;
const MAX_RECENTLY_CLOSED = 10;
const MAX_HISTORY_ENTRIES = 5000;
const browserData = {
  bookmarks: [],
  bookmarkFolders: [{ id: "default", name: "Geral" }],
  history: [],
  workspaces: [],
};
const downloads = new Map();
const downloadItems = new Map();
const configuredSessions = new WeakSet();
const sessionPermissions = new Map();

let activePanelId = null;
let layoutMode = "grid";
let maximizedPanelId = null;
let privateMode = false;
let managerOverlayOpen = false;
let nextDownloadId = 1;

function dataFilePath() {
  return path.join(app.getPath("userData"), "browser-hub-data.json");
}

function saveBrowserData() {
  const filePath = dataFilePath();
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(browserData, null, 2), "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function loadBrowserData() {
  const filePath = dataFilePath();
  if (!fs.existsSync(filePath)) return;

  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(saved.bookmarks)) {
    browserData.bookmarks = saved.bookmarks.filter((item) =>
      item &&
      typeof item.id === "string" &&
      typeof item.url === "string" &&
      typeof item.title === "string" &&
      typeof item.folderId === "string",
    );
  }
  if (Array.isArray(saved.bookmarkFolders) && saved.bookmarkFolders.length) {
    browserData.bookmarkFolders = saved.bookmarkFolders;
  }
  if (Array.isArray(saved.history)) {
    browserData.history = saved.history
      .filter((entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.title === "string" &&
        typeof entry.url === "string" &&
        Number.isFinite(entry.visitedAt),
      )
      .slice(0, MAX_HISTORY_ENTRIES);
  }
  if (Array.isArray(saved.workspaces)) {
    browserData.workspaces = saved.workspaces.filter((workspace) =>
      workspace &&
      typeof workspace.id === "string" &&
      typeof workspace.name === "string" &&
      ["single", "grid", "split"].includes(workspace.layout) &&
      Array.isArray(workspace.panels) &&
      workspace.panels.every((panel) => typeof panel.url === "string"),
    );
  }
}

function configureSession(session) {
  if (configuredSessions.has(session)) return;
  configuredSessions.add(session);

  session.setPermissionRequestHandler((webContents, permission, callback) => {
    const panel = [...panels.values()].find((item) => item.view.webContents === webContents);
    const allowed = panel
      ? sessionPermissions.get(panel.partition)?.has(permission)
      : false;
    callback(Boolean(allowed));
  });
  session.setPermissionCheckHandler((webContents, permission) => {
    const panel = [...panels.values()].find((item) => item.view.webContents === webContents);
    return Boolean(panel && sessionPermissions.get(panel.partition)?.has(permission));
  });

  session.on("will-download", (_event, item) => {
    const id = `download-${nextDownloadId++}`;
    const record = {
      id,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: item.getSavePath(),
      state: "in_progress",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    downloads.set(id, record);
    downloadItems.set(id, item);
    const publish = () => {
      record.filename = item.getFilename();
      record.savePath = item.getSavePath();
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      sendToUI("downloads:changed", { ...record });
    };

    item.on("updated", (_updateEvent, state) => {
      if (state === "interrupted") record.state = "interrupted";
      publish();
    });
    item.once("done", (_doneEvent, state) => {
      record.state = state;
      record.completedAt = Date.now();
      publish();
      downloadItems.delete(id);
    });
    publish();
  });
}

function recordHistory(panel, url) {
  if (panel.private || !url || !/^https?:\/\//i.test(url)) return;
  browserData.history.unshift({
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: panel.customTitle || panel.view.webContents.getTitle() || url,
    url,
    visitedAt: Date.now(),
  });
  browserData.history.length = Math.min(browserData.history.length, MAX_HISTORY_ENTRIES);
  saveBrowserData();
}

function resolveAddress(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new Error("Digite um endereço ou uma pesquisa.");
  }

  const input = value.trim();
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  if (hasProtocol) {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error("O endereço digitado não é válido.");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Somente endereços HTTP e HTTPS são permitidos.");
    }
    return url.href;
  }

  const looksLikeDomain =
    /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:[/?#].*)?$/i.test(input) ||
    /^([\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(input);

  if (!looksLikeDomain) {
    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
  }

  const isLocalAddress =
    /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::|[/?#]|$)/i.test(input);
  return new URL(`${isLocalAddress ? "http" : "https"}://${input}`).href;
}

function sendToUI(channel, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

function panelState(panel) {
  const contents = panel.view.webContents;

  return {
    id: panel.id,
    url: contents.getURL() || panel.url,
    title: panel.customTitle || contents.getTitle() || panel.title || panel.url,
    active: panel.id === activePanelId,
    pinned: panel.pinned,
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    maximized: panel.id === maximizedPanelId,
    private: panel.private,
  };
}

function publishPanelState(panel) {
  sendToUI("panel:state", panelState(panel));
}

function publishAllPanelStates() {
  for (const panel of panels.values()) publishPanelState(panel);
}

function displayedPanels() {
  const allPanels = [...panels.values()];

  if (maximizedPanelId) {
    return allPanels.filter((panel) => panel.id === maximizedPanelId);
  }

  if (layoutMode === "grid") return allPanels;
  if (layoutMode === "split") {
    return allPanels.filter(
      (panel) => panel.id === activePanelId || panel.id === getSplitNeighborId(),
    );
  }

  return allPanels.filter((panel) => panel.id === activePanelId);
}

function getSplitNeighborId() {
  const ids = [...panels.keys()];
  const activeIndex = ids.indexOf(activePanelId);

  if (ids.length < 2) return null;
  return ids[(activeIndex + 1) % ids.length];
}

function layoutPanels() {
  if (!win || win.isDestroyed()) return;

  const { width, height } = win.getContentBounds();
  const visiblePanels = displayedPanels();

  for (const panel of panels.values()) {
    if (!visiblePanels.includes(panel)) {
      panel.view.setBounds({ x: -10000, y: -10000, width: 1, height: 1 });
    }
  }

  const count = visiblePanels.length;
  if (count === 0) return;
  const contentX = managerOverlayOpen ? SIDEBAR_WIDTH : 0;
  const contentWidth = Math.max(100, width - contentX);

  let columns = count;
  let rows = 1;

  if (layoutMode === "grid") {
    columns = Math.ceil(Math.sqrt(count));
    rows = Math.ceil(count / columns);
  }

  const availableHeight = Math.max(1, height - CHROME_HEIGHT - STATUS_HEIGHT);
  const cellWidth = Math.max(
    100,
    Math.floor((contentWidth - PANEL_GAP * (columns + 1)) / columns),
  );
  const cellHeight = Math.max(
    100,
    Math.floor((availableHeight - PANEL_GAP * (rows + 1)) / rows),
  );

  visiblePanels.forEach((panel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    panel.view.setBounds({
      x: contentX + PANEL_GAP + column * (cellWidth + PANEL_GAP),
      y: CHROME_HEIGHT + PANEL_GAP + row * (cellHeight + PANEL_GAP),
      width: cellWidth,
      height: cellHeight,
    });
  });
}

async function addPanel({
  id,
  url,
  partition,
  pinned = false,
  title = "",
  private: isPrivate = privateMode,
}) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Identificador de painel inválido.");
  }
  if (panels.has(id)) throw new Error("Esse painel já existe.");

  const safeUrl = resolveAddress(url);
  const defaultPartition = isPrivate
    ? `browser-hub-private-${id}`
    : `persist:browser-hub-${id}`;
  const validPartition = typeof partition === "string" && (
    (isPrivate && /^browser-hub-private-[a-zA-Z0-9_-]{1,64}$/.test(partition)) ||
    (!isPrivate && /^persist:browser-hub-[a-zA-Z0-9_-]{1,64}$/.test(partition))
  );
  const safePartition = validPartition ? partition : defaultPartition;
  const panelSession = session.fromPartition(safePartition);
  configureSession(panelSession);

  const view = new WebContentsView({
    webPreferences: {
      partition: safePartition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const panel = {
    id,
    url: safeUrl,
    title: "",
    customTitle: typeof title === "string" ? title.slice(0, 80) : "",
    pinned: Boolean(pinned),
    partition: safePartition,
    session: panelSession,
    private: Boolean(isPrivate),
    view,
  };

  panels.set(id, panel);
  activePanelId = id;
  maximizedPanelId = null;
  win.contentView.addChildView(view);

  view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const target = new URL(targetUrl);
      if (["http:", "https:"].includes(target.protocol)) {
        shell.openExternal(target.href);
      }
    } catch {
      sendToUI("panel:error", { id, message: "O link solicitado é inválido." });
    }
    return { action: "deny" };
  });

  view.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      const target = new URL(targetUrl);
      if (!["http:", "https:"].includes(target.protocol)) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  view.webContents.on("page-title-updated", (_event, pageTitle) => {
    panel.title = pageTitle;
    publishPanelState(panel);
  });

  view.webContents.on("did-navigate", (_event, currentUrl) => {
    panel.url = currentUrl;
    publishPanelState(panel);
    try {
      recordHistory(panel, currentUrl);
    } catch (error) {
      sendToUI("panel:error", {
        id,
        message: `Não foi possível salvar o histórico: ${error.message}`,
      });
    }
  });

  view.webContents.on("did-navigate-in-page", (_event, currentUrl, isMainFrame) => {
    if (!isMainFrame) return;
    panel.url = currentUrl;
    publishPanelState(panel);
  });

  view.webContents.on("did-start-loading", () => {
    sendToUI("panel:loading", { id, loading: true });
    publishPanelState(panel);
  });

  view.webContents.on("did-stop-loading", () => {
    sendToUI("panel:loading", { id, loading: false });
    publishPanelState(panel);
  });

  view.webContents.on("render-process-gone", () => {
    sendToUI("panel:error", {
      id,
      message: "A página foi encerrada inesperadamente.",
    });
  });

  sendToUI("panel:created", panelState(panel));
  layoutPanels();
  publishAllPanelStates();

  try {
    await view.webContents.loadURL(safeUrl);
  } catch (error) {
    sendToUI("panel:error", { id, message: error.message });
  }

  return panelState(panel);
}

function activatePanel(id) {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");

  activePanelId = id;
  maximizedPanelId = null;
  layoutPanels();
  publishAllPanelStates();
  sendToUI("panels:active", { id });
  publishPanelState(panel);

  return panelState(panel);
}

function removePanel(id, remember = true, allowPinned = false) {
  const panel = panels.get(id);
  if (!panel) return;

  if (panel.pinned && !allowPinned) {
    throw new Error("Desafixe a aba antes de fechá-la.");
  }

  if (remember && !panel.private) {
    recentlyClosed.unshift({
      id: panel.id,
      url: panel.view.webContents.getURL() || panel.url,
      title: panel.customTitle || panel.view.webContents.getTitle() || panel.title,
      partition: panel.partition,
    });
    recentlyClosed.splice(MAX_RECENTLY_CLOSED);
  }

  win.contentView.removeChildView(panel.view);
  panel.view.webContents.close();
  panels.delete(id);
  if (maximizedPanelId === id) maximizedPanelId = null;

  if (activePanelId === id) {
    activePanelId = [...panels.keys()].pop() || null;
  }

  layoutPanels();
  publishAllPanelStates();
  sendToUI("panel:removed", {
    id,
    activeId: activePanelId,
    canRestoreClosed: recentlyClosed.length > 0,
  });
  if (activePanelId) sendToUI("panels:active", { id: activePanelId });
}

function reorderPanels(sourceId, targetId) {
  if (sourceId === targetId || !panels.has(sourceId) || !panels.has(targetId)) {
    return;
  }

  const entries = [...panels.entries()];
  const sourceIndex = entries.findIndex(([id]) => id === sourceId);
  const targetIndex = entries.findIndex(([id]) => id === targetId);
  const [source] = entries.splice(sourceIndex, 1);
  entries.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, source);
  panels.clear();
  for (const [id, panel] of entries) panels.set(id, panel);

  sendToUI("panels:reordered", { ids: [...panels.keys()] });
  layoutPanels();
}

function ensureTrustedSender(event) {
  if (!win || event.sender !== win.webContents) {
    throw new Error("Solicitação não autorizada.");
  }
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    ensureTrustedSender(event);
    return handler(...args);
  });
}

registerHandler("panels:add", addPanel);
registerHandler("panels:remove", (id) => removePanel(id));
registerHandler("panels:activate", activatePanel);
registerHandler("panels:maximize", (id) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");

  maximizedPanelId = maximizedPanelId === id ? null : id;
  activePanelId = id;
  layoutPanels();
  publishAllPanelStates();
  sendToUI("panels:active", { id });
  return panelState(panel);
});
registerHandler("panels:reorder", (sourceId, targetId) =>
  reorderPanels(sourceId, targetId),
);
registerHandler("panels:duplicate", async (id) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");

  const duplicateId = `panel-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  return addPanel({
    id: duplicateId,
    url: panel.view.webContents.getURL() || panel.url,
    partition: panel.partition,
    private: panel.private,
  });
});
registerHandler("panels:pin", (id) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");
  panel.pinned = !panel.pinned;
  publishPanelState(panel);
  return panelState(panel);
});
registerHandler("panels:rename", (id, title) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");
  if (typeof title !== "string" || !title.trim() || title.length > 80) {
    throw new Error("O nome deve ter entre 1 e 80 caracteres.");
  }
  panel.customTitle = title.trim();
  publishPanelState(panel);
  return panelState(panel);
});
registerHandler("panels:restore-closed", async () => {
  const closed = recentlyClosed.shift();
  if (!closed) return null;
  const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const restored = await addPanel({ ...closed, id });
  sendToUI("panels:restore-availability", { available: recentlyClosed.length > 0 });
  return restored;
});
registerHandler("panels:layout", (mode) => {
  if (!["single", "grid", "split"].includes(mode)) {
    throw new Error("Layout inválido.");
  }
  layoutMode = mode;
  maximizedPanelId = null;
  if (activePanelId && !panels.has(activePanelId)) activePanelId = null;
  layoutPanels();
  publishAllPanelStates();
  sendToUI("panels:layout", { mode });
  return mode;
});
registerHandler("panels:navigate", async ({ id, url }) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");
  const safeUrl = resolveAddress(url);
  await panel.view.webContents.loadURL(safeUrl);
  panel.url = safeUrl;
  return panelState(panel);
});
registerHandler("panels:back", (id) => {
  const contents = panels.get(id)?.view.webContents;
  if (!contents) throw new Error("Aba não encontrada.");
  if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
  return {
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  };
});
registerHandler("panels:forward", (id) => {
  const contents = panels.get(id)?.view.webContents;
  if (!contents) throw new Error("Aba não encontrada.");
  if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
  return {
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  };
});
registerHandler("panels:reload", (id) => {
  const contents = panels.get(id)?.view.webContents;
  if (!contents) throw new Error("Aba não encontrada.");
  contents.reload();
});
registerHandler("panels:stop", (id) => {
  const contents = panels.get(id)?.view.webContents;
  if (!contents) throw new Error("Aba não encontrada.");
  contents.stop();
});
registerHandler("panels:set-manager-overlay", (enabled) => {
  managerOverlayOpen = Boolean(enabled);
  layoutPanels();
  return managerOverlayOpen;
});
registerHandler("panels:get-state", () => ({
  panels: [...panels.values()].map(panelState),
  activeId: activePanelId,
  layout: layoutMode,
  canRestoreClosed: recentlyClosed.length > 0,
}));
registerHandler("bookmarks:list", () => ({
  bookmarks: browserData.bookmarks,
  folders: browserData.bookmarkFolders,
}));
registerHandler("bookmarks:add", ({ url, title, folderId = "default" }) => {
  const safeUrl = resolveAddress(url);
  if (!browserData.bookmarkFolders.some((folder) => folder.id === folderId)) {
    throw new Error("A pasta de favoritos não existe.");
  }
  const existing = browserData.bookmarks.find((item) => item.url === safeUrl);
  if (existing) {
    existing.title = String(title || safeUrl).slice(0, 200);
    existing.folderId = folderId;
  } else {
    browserData.bookmarks.unshift({
      id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: String(title || safeUrl).slice(0, 200),
      url: safeUrl,
      folderId,
      createdAt: Date.now(),
    });
  }
  saveBrowserData();
  return browserData.bookmarks;
});
registerHandler("bookmarks:remove", (id) => {
  browserData.bookmarks = browserData.bookmarks.filter((item) => item.id !== id);
  saveBrowserData();
  return browserData.bookmarks;
});
registerHandler("bookmarks:create-folder", (name) => {
  if (typeof name !== "string" || !name.trim() || name.length > 60) {
    throw new Error("O nome da pasta deve ter entre 1 e 60 caracteres.");
  }
  const folder = {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
  };
  browserData.bookmarkFolders.push(folder);
  saveBrowserData();
  return folder;
});
registerHandler("history:list", (query = "") => {
  const search = String(query).trim().toLowerCase();
  return browserData.history.filter((entry) =>
    !search ||
    entry.title.toLowerCase().includes(search) ||
    entry.url.toLowerCase().includes(search),
  ).slice(0, 500);
});
registerHandler("history:clear", () => {
  browserData.history = [];
  saveBrowserData();
  return true;
});
registerHandler("workspaces:list", () => browserData.workspaces);
registerHandler("workspaces:save", (name) => {
  if (typeof name !== "string" || !name.trim() || name.length > 60) {
    throw new Error("O nome do espaço deve ter entre 1 e 60 caracteres.");
  }
  const savedPanels = [...panels.values()]
    .filter((panel) => !panel.private)
    .map((panel) => ({
      url: panel.view.webContents.getURL() || panel.url,
      title: panel.customTitle || panel.view.webContents.getTitle() || panel.title,
      pinned: panel.pinned,
      partition: panel.partition,
    }));
  if (savedPanels.length === 0) {
    throw new Error("Abra ao menos uma aba não privada para salvar um espaço.");
  }

  const workspace = {
    id: `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    layout: layoutMode,
    panels: savedPanels,
    updatedAt: Date.now(),
  };
  browserData.workspaces.unshift(workspace);
  saveBrowserData();
  return browserData.workspaces;
});
registerHandler("workspaces:open", async (workspaceId) => {
  const workspace = browserData.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error("Espaço de trabalho não encontrado.");
  for (const id of [...panels.keys()]) removePanel(id, false, true);
  layoutMode = workspace.layout;
  maximizedPanelId = null;
  for (const savedPanel of workspace.panels) {
    const id = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await addPanel({
      ...savedPanel,
      id,
      partition: savedPanel.partition,
      private: false,
    });
  }
  layoutPanels();
  publishAllPanelStates();
  sendToUI("panels:layout", { mode: layoutMode });
  return workspace;
});
registerHandler("workspaces:remove", (workspaceId) => {
  browserData.workspaces = browserData.workspaces.filter((item) => item.id !== workspaceId);
  saveBrowserData();
  return browserData.workspaces;
});
registerHandler("privacy:status", (id) => {
  const panel = panels.get(id);
  const allowed = panel
    ? [...(sessionPermissions.get(panel.partition) || [])]
    : [];
  return {
    privateMode,
    isPrivateMode: Boolean(panel?.private),
    activePanelPrivate: Boolean(panel?.private),
    permissions: allowed,
  };
});
registerHandler("privacy:set-private-mode", (enabled) => {
  privateMode = Boolean(enabled);
  sendToUI("privacy:mode-changed", { enabled: privateMode });
  return privateMode;
});
registerHandler("privacy:clear-data", async ({ id, clearHistory = false }) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");
  await panel.session.clearStorageData({
    storages: [
      "appcache",
      "cookies",
      "filesystem",
      "indexdb",
      "localstorage",
      "serviceworkers",
      "shadercache",
      "websql",
      "cachestorage",
    ],
  });
  await panel.session.clearCache();
  panel.view.webContents.clearHistory();
  if (clearHistory && !panel.private) {
    browserData.history = [];
    saveBrowserData();
  }
  return true;
});
registerHandler("privacy:permissions", (id) => {
  const panel = panels.get(id);
  if (!panel) throw new Error("Aba não encontrada.");
  return {
    available: ["media", "geolocation", "notifications"],
    allowed: [...(sessionPermissions.get(panel.partition) || [])],
  };
});
registerHandler("privacy:set-permission", ({ id, permission, allowed }) => {
  const panel = panels.get(id);
  const supported = ["media", "geolocation", "notifications"];
  if (!panel) throw new Error("Aba não encontrada.");
  if (!supported.includes(permission)) throw new Error("Permissão não suportada.");
  let allowedPermissions = sessionPermissions.get(panel.partition);
  if (!allowedPermissions) {
    allowedPermissions = new Set();
    sessionPermissions.set(panel.partition, allowedPermissions);
  }
  if (allowed) allowedPermissions.add(permission);
  else allowedPermissions.delete(permission);
  return [...allowedPermissions];
});
registerHandler("downloads:list", () => [...downloads.values()].map((item) => ({ ...item })));
registerHandler("downloads:cancel", (id) => {
  const item = downloadItems.get(id);
  if (!item) throw new Error("Download não está mais ativo.");
  item.cancel();
});
registerHandler("downloads:show", (id) => {
  const download = downloads.get(id);
  if (!download || !download.savePath) throw new Error("Arquivo ainda não está disponível.");
  shell.showItemInFolder(download.savePath);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Browser Hub",
    icon: path.join(__dirname, "..", "src", "icon.png"),
    backgroundColor: "#10151d",
    autoHideMenuBar: true,
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: "#171b22",
            symbolColor: "#c5cad3",
            height: TITLEBAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.on("resize", layoutPanels);
  win.on("maximize", layoutPanels);
  win.on("unmaximize", layoutPanels);
  win.webContents.once("did-finish-load", async () => {
    try {
      await addPanel({ id: "panel-1", url: "https://chatgpt.com" });
    } catch (error) {
      sendToUI("panel:error", { id: "panel-1", message: error.message });
    }
  });

  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.on("closed", () => {
    win = null;
    panels.clear();
    activePanelId = null;
    maximizedPanelId = null;
  });
}

app.whenReady().then(() => {
  try {
    loadBrowserData();
  } catch (error) {
    dialog.showErrorBox(
      "Browser Hub",
      `Não foi possível carregar os dados salvos. Favoritos, histórico e espaços podem não estar disponíveis.\n\n${error.message}`,
    );
  }
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
