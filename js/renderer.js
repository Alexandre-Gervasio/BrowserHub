const form = document.getElementById("address-form");
const address = document.getElementById("address");
const status = document.getElementById("status");
const list = document.getElementById("panel-list");
const count = document.getElementById("count");
const backButton = document.getElementById("back-button");
const forwardButton = document.getElementById("forward-button");
const reloadButton = document.getElementById("reload-button");
const stopButton = document.getElementById("stop-button");
const restoreButton = document.getElementById("restore-closed");
const contextMenu = document.getElementById("tab-context-menu");
const managerSidebar = document.getElementById("manager-sidebar");
const managerContent = document.getElementById("manager-content");
const managerNav = document.getElementById("manager-nav");

const panels = new Map();
const downloadRecords = new Map();
let activeId = null;
let currentLayout = "grid";
let privateMode = false;
let currentManagerView = "bookmarks";
let nextId = 2;
let draggedId = null;
restoreButton.disabled = true;

const icons = {
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-4 1-4 4 2 2-1 1-4-4-5 5-1-1 5-5-4-4 1-1 2 2 4-4z"/></svg>`,
  maximize: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M20 16v4h-4M4 16v4h4"/></svg>`,
  restore: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m0-5 7 7m4 9h5v-5m0 5-7-7"/></svg>`,
};

function activePanel() {
  return panels.get(activeId);
}

function updateToolbar() {
  const panel = activePanel();
  status.classList.toggle("is-loading", Boolean(panel?.loading));
  backButton.disabled = !panel?.canGoBack;
  forwardButton.disabled = !panel?.canGoForward;
  reloadButton.disabled = !panel;
  stopButton.disabled = !panel?.loading;
  stopButton.hidden = !panel?.loading;
  reloadButton.hidden = Boolean(panel?.loading);
  if (panel && document.activeElement !== address) {
    address.value = panel.url || "";
  }
}

function updateCount() {
  const total = panels.size;
  count.textContent = `${total} ${total === 1 ? "aba" : "abas"}`;
  if (total === 0) list.dataset.empty = "true";
  else delete list.dataset.empty;
}

function updateLayoutButtons() {
  for (const button of document.querySelectorAll("[data-layout]")) {
    const selected = button.dataset.layout === currentLayout;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeButton(text, className, action) {
  const button = makeElement("button", className, text);
  button.type = "button";
  button.addEventListener("click", async () => {
    try {
      await action();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  return button;
}

function setManagerContent(...children) {
  managerContent.replaceChildren(...children);
}

async function openManager(view = "bookmarks") {
  currentManagerView = view;
  if (managerSidebar.hidden) {
    await window.browserHub.setManagerOverlay(true);
    managerSidebar.hidden = false;
    document.getElementById("open-manager").classList.add("is-active");
    document.getElementById("open-manager").setAttribute("aria-expanded", "true");
  }
  await renderManagerView(view);
}

async function closeManager() {
  if (managerSidebar.hidden) return;
  await window.browserHub.setManagerOverlay(false);
  managerSidebar.hidden = true;
  document.getElementById("open-manager").classList.remove("is-active");
  document.getElementById("open-manager").setAttribute("aria-expanded", "false");
}

managerNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-manager-view]");
  if (!button) return;
  const view = button.dataset.managerView;
  const action = !managerSidebar.hidden && currentManagerView === view
    ? closeManager()
    : openManager(view);
  action.catch((error) => {
    status.textContent = `Não foi possível alternar o painel: ${error.message}`;
  });
});

async function renderManagerView(view, query = "") {
  currentManagerView = view;
  for (const button of managerNav.querySelectorAll("[data-manager-view]")) {
    button.classList.toggle("is-selected", button.dataset.managerView === view);
  }

  if (view === "bookmarks") {
    const data = await window.browserHub.listBookmarks();
    const actions = makeElement("div", "manager-actions");
    const folderChoice = makeElement("select", "manager-search");
    for (const folder of data.folders) {
      const option = makeElement("option", "", folder.name);
      option.value = folder.id;
      folderChoice.appendChild(option);
    }
    actions.appendChild(folderChoice);
    actions.append(
      makeButton("Adicionar página atual", "primary-button", async () => {
        const panel = activePanel();
        if (!panel) throw new Error("Não há uma aba ativa para favoritar.");
        await window.browserHub.addBookmark({
          title: panel.title,
          url: panel.url,
          folderId: folderChoice.value,
        });
        await renderManagerView("bookmarks");
      }),
      makeButton("Criar pasta", "secondary-button", async () => {
        const name = window.prompt("Nome da pasta de favoritos:");
        if (name?.trim()) {
          await window.browserHub.createBookmarkFolder(name.trim());
          await renderManagerView("bookmarks");
        }
      }),
    );
    const groups = makeElement("div", "manager-list");
    for (const folder of data.folders) {
      const heading = makeElement("h3", "manager-group-title", folder.name);
      groups.appendChild(heading);
      const entries = data.bookmarks.filter((item) => item.folderId === folder.id);
      for (const entry of entries) {
        const row = makeElement("div", "manager-row");
        const open = makeButton("", "manager-entry", async () => {
          if (!activeId || !panels.has(activeId)) await createPanel(entry.url);
          else await window.browserHub.navigate({ id: activeId, url: entry.url });
        });
        open.append(
          makeElement("strong", "", entry.title),
          makeElement("span", "", entry.url),
        );
        row.append(
          open,
          makeButton("Remover", "text-button", async () => {
            await window.browserHub.removeBookmark(entry.id);
            await renderManagerView("bookmarks");
          }),
        );
        groups.appendChild(row);
      }
      if (!entries.length) groups.appendChild(makeElement("p", "empty-message", "Nenhum favorito nesta pasta."));
    }
    setManagerContent(actions, groups);
    return;
  }

  if (view === "history") {
    const controls = makeElement("div", "manager-actions");
    const search = makeElement("input", "manager-search");
    search.type = "search";
    search.placeholder = "Pesquisar no histórico";
    search.value = query;
    const clear = makeButton("Limpar histórico", "secondary-button", async () => {
      if (!window.confirm("Limpar todo o histórico de navegação?")) return;
      await window.browserHub.clearHistory();
      await renderManagerView("history", search.value);
    });
    controls.append(search, clear);
    const entries = makeElement("div", "manager-list");
    const history = await window.browserHub.listHistory(query);
    for (const item of history) {
      const row = makeElement("div", "manager-row");
      const open = makeButton("", "manager-entry", async () => {
        if (!activeId || !panels.has(activeId)) await createPanel(item.url);
        else await window.browserHub.navigate({ id: activeId, url: item.url });
      });
      open.append(
        makeElement("strong", "", item.title),
        makeElement("span", "", `${item.url} · ${new Date(item.visitedAt).toLocaleString()}`),
      );
      row.appendChild(open);
      entries.appendChild(row);
    }
    if (!history.length) entries.appendChild(makeElement("p", "empty-message", "Nenhum registro encontrado."));
    search.addEventListener("input", () => renderManagerView("history", search.value));
    setManagerContent(controls, entries);
    search.focus();
    return;
  }

  if (view === "workspaces") {
    const actions = makeElement("div", "manager-actions");
    actions.appendChild(makeButton("Salvar abas atuais como espaço", "primary-button", async () => {
      const name = window.prompt("Nome para este espaço de trabalho:");
      if (name?.trim()) {
        await window.browserHub.saveWorkspace(name.trim());
        await renderManagerView("workspaces");
      }
    }));
    const list = makeElement("div", "manager-list");
    const workspaces = await window.browserHub.listWorkspaces();
    for (const workspace of workspaces) {
      const row = makeElement("div", "manager-row");
      const open = makeButton("", "manager-entry", async () => {
        if (!window.confirm("Abrir este espaço substituirá as abas abertas. Continuar?")) return;
        await window.browserHub.openWorkspace(workspace.id);
      });
      open.append(
        makeElement("strong", "", workspace.name),
        makeElement("span", "", `${workspace.panels.length} abas · ${workspace.layout}`),
      );
      row.append(
        open,
        makeButton("Excluir", "text-button", async () => {
          await window.browserHub.removeWorkspace(workspace.id);
          await renderManagerView("workspaces");
        }),
      );
      list.appendChild(row);
    }
    if (!workspaces.length) list.appendChild(makeElement("p", "empty-message", "Nenhum espaço salvo."));
    setManagerContent(actions, list);
    return;
  }

  if (view === "privacy") {
    const panel = activePanel();
    const statusInfo = await window.browserHub.getPrivacyStatus(activeId);
    privateMode = statusInfo.privateMode;
    const privateToggle = makeElement("label", "setting-row");
    const privateCopy = makeElement("span", "setting-copy");
    privateCopy.append(
      makeElement("strong", "", "Navegação privada"),
      makeElement("small", "", "Novas abas não serão salvas no histórico e usam armazenamento temporário."),
    );
    const privateInput = makeElement("input");
    privateInput.type = "checkbox";
    privateInput.checked = privateMode;
    privateInput.addEventListener("change", async () => {
      try {
        privateMode = await window.browserHub.setPrivateMode(privateInput.checked);
      } catch (error) {
        privateInput.checked = privateMode;
        status.textContent = error.message;
      }
    });
    privateToggle.append(privateCopy, privateInput);

    const dataControls = makeElement("div", "manager-section");
    dataControls.appendChild(makeElement("h3", "manager-group-title", "Dados de navegação"));
    const clearHistoryToggle = makeElement("label", "check-row");
    const clearHistoryInput = makeElement("input");
    clearHistoryInput.type = "checkbox";
    clearHistoryToggle.append(clearHistoryInput, makeElement("span", "", "Também limpar o histórico"));
    const clearButton = makeButton("Limpar dados desta sessão", "secondary-button", async () => {
      if (!panel) throw new Error("Abra uma aba antes de limpar os dados.");
      if (!window.confirm("Limpar cookies, cache e armazenamento do site desta aba?")) return;
      await window.browserHub.clearBrowsingData({
        id: activeId,
        clearHistory: clearHistoryInput.checked,
      });
      status.textContent = "Dados de navegação limpos.";
    });
    dataControls.append(clearHistoryToggle, clearButton);

    const permissionSection = makeElement("div", "manager-section");
    permissionSection.appendChild(makeElement("h3", "manager-group-title", "Permissões desta sessão"));
    if (panel) {
      const permissionInfo = await window.browserHub.getPermissions(activeId);
      const names = [
        ["media", "Câmera e microfone"],
        ["geolocation", "Localização"],
        ["notifications", "Notificações"],
      ];
      for (const [permission, label] of names) {
        const row = makeElement("label", "check-row");
        const input = makeElement("input");
        input.type = "checkbox";
        input.checked = permissionInfo.allowed.includes(permission);
        input.addEventListener("change", async () => {
          try {
            await window.browserHub.setPermission({
              id: activeId,
              permission,
              allowed: input.checked,
            });
          } catch (error) {
            input.checked = !input.checked;
            status.textContent = error.message;
          }
        });
        row.append(input, makeElement("span", "", label));
        permissionSection.appendChild(row);
      }
      permissionSection.appendChild(makeElement(
        "p",
        "privacy-note",
        statusInfo.isPrivateMode
          ? "Esta aba está em uma sessão privada."
          : "Permissões são negadas por padrão e só valem nesta sessão.",
      ));
    } else {
      permissionSection.appendChild(makeElement("p", "empty-message", "Abra uma aba para gerenciar permissões."));
    }
    setManagerContent(privateToggle, dataControls, permissionSection);
    return;
  }

  if (view === "downloads") {
    const list = makeElement("div", "manager-list");
    const downloads = await window.browserHub.listDownloads();
    downloadRecords.clear();
    for (const item of downloads) downloadRecords.set(item.id, item);
    for (const item of [...downloadRecords.values()].reverse()) {
      const row = makeElement("div", "download-row");
      const details = makeElement("div", "download-details");
      details.append(
        makeElement("strong", "", item.filename),
        makeElement("span", "", item.state === "completed" ? item.savePath : item.state),
      );
      if (item.state === "in_progress" && item.totalBytes > 0) {
        const progress = makeElement("progress");
        progress.max = item.totalBytes;
        progress.value = item.receivedBytes;
        details.appendChild(progress);
      }
      row.appendChild(details);
      if (item.state === "in_progress") {
        row.appendChild(makeButton("Cancelar", "text-button", () => window.browserHub.cancelDownload(item.id)));
      } else if (item.state === "completed") {
        row.appendChild(makeButton("Mostrar arquivo", "text-button", () => window.browserHub.showDownload(item.id)));
      }
      list.appendChild(row);
    }
    if (!downloads.length) list.appendChild(makeElement("p", "empty-message", "Nenhum download nesta sessão."));
    setManagerContent(list);
  }
}

function addTabAction(card, className, label, icon, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tab-action ${className}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    await action();
  });
  card.appendChild(button);
  return button;
}

function renderPanel(panel) {
  let card = document.getElementById(`tab-${panel.id}`);

  if (!card) {
    card = document.createElement("div");
    card.className = "tab";
    card.id = `tab-${panel.id}`;
    card.dataset.panelId = panel.id;
    card.tabIndex = 0;
    card.setAttribute("role", "tab");
    card.draggable = true;

    const favicon = document.createElement("img");
    favicon.className = "tab-favicon";
    favicon.src = "src/favicon.png";
    favicon.alt = "";

    const title = document.createElement("span");
    title.className = "tab-title";

    addTabAction(card, "maximize-tab", "Maximizar painel", icons.maximize, async () => {
      try {
        await window.browserHub.toggleMaximizePanel(panel.id);
      } catch (error) {
        status.textContent = error.message;
      }
    });

    const pin = addTabAction(card, "pin-tab", "Fixar aba", icons.pin, async () => {
      try {
        await window.browserHub.togglePinPanel(panel.id);
      } catch (error) {
        status.textContent = error.message;
      }
    });

    const close = addTabAction(
      card,
      "close-tab",
      "Fechar aba",
      icons.close,
      async () => {
        try {
          await window.browserHub.removePanel(panel.id);
        } catch (error) {
          status.textContent = error.message;
        }
      },
    );

    card.append(favicon, title);
    card.addEventListener("click", () => activateTab(panel.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateTab(panel.id);
      }
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, panel.id);
    });
    card.addEventListener("dragstart", (event) => {
      draggedId = panel.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", panel.id);
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => {
      draggedId = null;
      card.classList.remove("is-dragging");
      for (const item of list.children) item.classList.remove("drop-target");
    });
    card.addEventListener("dragover", (event) => {
      if (draggedId && draggedId !== panel.id) {
        event.preventDefault();
        card.classList.add("drop-target");
      }
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      card.classList.remove("drop-target");
      const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
      if (!sourceId || sourceId === panel.id) return;
      try {
        await window.browserHub.reorderPanels(sourceId, panel.id);
      } catch (error) {
        status.textContent = `Não foi possível reorganizar as abas: ${error.message}`;
      }
    });
  }

  card.querySelector(".tab-title").textContent =
    panel.customTitle || panel.title || panel.url || "Nova aba";
  card.classList.toggle("is-active", panel.id === activeId);
  card.classList.toggle("is-pinned", panel.pinned);
  card.classList.toggle("is-loading", panel.loading);
  card.classList.toggle("is-maximized", panel.maximized);
  card.setAttribute("aria-selected", String(panel.id === activeId));
  const maximize = card.querySelector(".maximize-tab");
  maximize.innerHTML = panel.maximized ? icons.restore : icons.maximize;
  maximize.title = panel.maximized ? "Restaurar grade" : "Maximizar painel";
  maximize.setAttribute("aria-label", maximize.title);
  card.querySelector(".pin-tab").classList.toggle("is-pinned", panel.pinned);
  card.querySelector(".pin-tab").title = panel.pinned ? "Desafixar aba" : "Fixar aba";
  card.querySelector(".close-tab").disabled = panel.pinned;

  const ordered = [...panels.values()].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
  const targetIndex = ordered.findIndex((item) => item.id === panel.id);
  const following = ordered[targetIndex + 1];
  if (following) list.insertBefore(card, document.getElementById(`tab-${following.id}`));
  else list.appendChild(card);

  updateCount();
  updateToolbar();
}

function showContextMenu(x, y, id) {
  const panel = panels.get(id);
  if (!panel) return;

  contextMenu.replaceChildren();
  const actions = [
    ["Duplicar aba", async () => window.browserHub.duplicatePanel(id)],
    [panel.pinned ? "Desafixar aba" : "Fixar aba", async () => window.browserHub.togglePinPanel(id)],
    ["Renomear aba", async () => {
      const name = window.prompt("Novo nome para a aba:", panel.customTitle || panel.title);
      if (name !== null && name.trim()) await window.browserHub.renamePanel(id, name.trim());
    }],
    ["Fechar aba", async () => window.browserHub.removePanel(id)],
  ];

  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (label === "Fechar aba" && panel.pinned) button.disabled = true;
    button.addEventListener("click", async () => {
      hideContextMenu();
      try {
        await action();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    contextMenu.appendChild(button);
  }

  contextMenu.hidden = false;
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 180)}px`;
}

function hideContextMenu() {
  contextMenu.hidden = true;
}

async function activateTab(id) {
  try {
    await window.browserHub.activatePanel(id);
  } catch (error) {
    status.textContent = error.message;
  }
}

function upsertPanel(state) {
  const existing = panels.get(state.id);
  panels.set(state.id, {
    ...existing,
    ...state,
    order: existing?.order ?? panels.size,
  });
  if (state.active) activeId = state.id;
  renderPanel(panels.get(state.id));
}

window.browserHub.onPanelCreated((panel) => {
  upsertPanel(panel);
  status.textContent = `Aba aberta: ${panel.title || panel.url}`;
});

window.browserHub.onPanelState((state) => {
  upsertPanel(state);
});

window.browserHub.onPanelLoading(({ id, loading }) => {
  const panel = panels.get(id);
  if (!panel) return;
  panel.loading = loading;
  renderPanel(panel);
  if (id === activeId) {
    status.classList.toggle("is-loading", loading);
    status.textContent = loading ? "Carregando página..." : "Página carregada.";
  }
});

window.browserHub.onPanelRemoved(({ id, activeId: newActiveId, canRestoreClosed }) => {
  panels.delete(id);
  document.getElementById(`tab-${id}`)?.remove();
  activeId = newActiveId;
  restoreButton.disabled = !canRestoreClosed;
  if (activeId) {
    const panel = panels.get(activeId);
    if (panel) panel.active = true;
  }
  updateCount();
  updateToolbar();
  status.textContent = "Aba fechada.";
});

window.browserHub.onActivePanel(({ id }) => {
  activeId = id;
  for (const panel of panels.values()) {
    panel.active = panel.id === id;
    renderPanel(panel);
  }
  updateToolbar();
});

window.browserHub.onPanelsReordered(({ ids }) => {
  ids.forEach((id, order) => {
    const panel = panels.get(id);
    if (panel) panel.order = order;
  });
  for (const panel of panels.values()) renderPanel(panel);
});

window.browserHub.onLayoutChanged(({ mode }) => {
  currentLayout = mode;
  updateLayoutButtons();
});

window.browserHub.onPanelError(({ id, message }) => {
  status.classList.remove("is-loading");
  const panel = panels.get(id);
  if (panel) {
    panel.loading = false;
    renderPanel(panel);
  }
  status.textContent = `Erro na aba ${id}: ${message}`;
});

window.browserHub.onRestoreAvailability(({ available }) => {
  restoreButton.disabled = !available;
});

window.browserHub.onPrivateModeChanged(({ enabled }) => {
  privateMode = enabled;
  if (!managerSidebar.hidden && currentManagerView === "privacy") {
    renderManagerView("privacy").catch((error) => {
      status.textContent = error.message;
    });
  }
});

window.browserHub.onDownloadChanged((download) => {
  downloadRecords.set(download.id, download);
  if (!managerSidebar.hidden && currentManagerView === "downloads") {
    renderManagerView("downloads").catch((error) => {
      status.textContent = `Não foi possível atualizar downloads: ${error.message}`;
    });
  }
});

async function createPanel(url = "https://www.google.com") {
  const id = `panel-${Date.now()}-${nextId++}`;
  status.textContent = "Abrindo nova aba...";
  try {
    await window.browserHub.addPanel({
      id,
      url,
      partition: privateMode ? undefined : `persist:browser-hub-${id}`,
      private: privateMode,
    });
    address.value = "";
  } catch (error) {
    status.textContent = `Não foi possível abrir: ${error.message}`;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = address.value.trim();
  if (!value) {
    address.focus();
    return;
  }

  if (!activeId || !panels.has(activeId)) {
    await createPanel(value);
    return;
  }

  try {
    await window.browserHub.navigate({ id: activeId, url: value });
    address.blur();
  } catch (error) {
    status.textContent = `Não foi possível navegar: ${error.message}`;
  }
});

document.getElementById("new-tab").addEventListener("click", () => createPanel());
document.getElementById("open-manager").addEventListener("click", () => {
  const action = managerSidebar.hidden
    ? openManager()
    : closeManager();
  action.catch((error) => {
    status.textContent = `Não foi possível alternar o painel: ${error.message}`;
  });
});
document.getElementById("close-manager").addEventListener("click", () => {
  closeManager().catch((error) => {
    status.textContent = `Não foi possível fechar a lateral: ${error.message}`;
  });
});
async function runActiveAction(action) {
  if (!activeId) return;
  try {
    await action(activeId);
  } catch (error) {
    status.textContent = `Não foi possível executar a ação: ${error.message}`;
  }
}

backButton.addEventListener("click", () => runActiveAction((id) => window.browserHub.goBack(id)));
forwardButton.addEventListener("click", () => runActiveAction((id) => window.browserHub.goForward(id)));
reloadButton.addEventListener("click", () => runActiveAction((id) => window.browserHub.reload(id)));
stopButton.addEventListener("click", () => runActiveAction((id) => window.browserHub.stop(id)));

restoreButton.addEventListener("click", async () => {
  try {
    const restored = await window.browserHub.restoreClosedPanel();
    if (!restored) status.textContent = "Não há abas fechadas recentemente.";
  } catch (error) {
    status.textContent = `Não foi possível restaurar a aba: ${error.message}`;
  }
});

for (const button of document.querySelectorAll("[data-layout]")) {
  button.addEventListener("click", async () => {
    try {
      await window.browserHub.setLayout(button.dataset.layout);
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    address.focus();
    address.select();
  } else if (
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    event.key.toLowerCase() === "t"
  ) {
    event.preventDefault();
    createPanel();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
    event.preventDefault();
    if (activeId) window.browserHub.removePanel(activeId).catch((error) => {
      status.textContent = error.message;
    });
  } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    restoreButton.click();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
    event.preventDefault();
    openManager("history");
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
    event.preventDefault();
    openManager("downloads");
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    event.preventDefault();
    openManager("bookmarks");
  } else if (event.key === "Escape") {
    hideContextMenu();
    if (!managerSidebar.hidden) {
      closeManager().catch((error) => {
        status.textContent = `Não foi possível fechar o painel: ${error.message}`;
      });
    }
  }
});

document.addEventListener("click", (event) => {
  if (!contextMenu.contains(event.target)) hideContextMenu();
});

window.browserHub.getState().then((state) => {
  currentLayout = state.layout;
  activeId = state.activeId;
  restoreButton.disabled = !state.canRestoreClosed;
  state.panels.forEach(upsertPanel);
  updateLayoutButtons();
  updateToolbar();
}).catch((error) => {
  status.textContent = `Não foi possível carregar as abas: ${error.message}`;
});
