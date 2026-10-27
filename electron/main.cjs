"use strict";
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  globalShortcut,
  screen,
  ipcMain,
  session,
} = require("electron");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { createHotkeys } = require("./hotkeys.cjs");
const { createInputDiagnostics } = require("./input-diagnostics.cjs");
const {
  loadPreferences,
  savePreferences,
  normalizePreferences,
  validateBindings,
  bindingLabel,
} = require("./preferences.cjs");

app.setName("My Brush");
if (process.env.MY_BRUSH_USER_DATA)
  app.setPath("userData", path.resolve(process.env.MY_BRUSH_USER_DATA));
const entry = path.join(__dirname, "renderer/index.html");
const entryURL = pathToFileURL(entry).href;
const windows = new Map();
const interactions = new Map();
function modalWindow() {
  return [...windows.values()].find(
    (w) => interactions.get(w.webContents.id)?.modal,
  );
}
function busyWindow() {
  return [...windows.values()].find((w) => {
    const v = interactions.get(w.webContents.id);
    return v?.modal || v?.composing;
  });
}
let preferenceRevision = 0;
let prefs,
  tray,
  visible = false,
  quitting = false,
  activeDisplay,
  tool = "pen";
const hotkeys = createHotkeys(globalShortcut, toggle, process.platform);
let registrationError = "",
  hideSequence = 0,
  hiding;
const hideAcks = new Map();
const userData = app.getPath("userData");
const inputDiagnostics = createInputDiagnostics(userData);
const nativeInputEvents = new Map();
const legacyPaths =
  process.platform === "darwin"
    ? [
        path.join(
          os.homedir(),
          "Library/Preferences/MyBrush/MyBrush/preferences.json",
        ),
      ]
    : [process.env.LOCALAPPDATA, process.env.APPDATA]
        .filter(Boolean)
        .map((p) => path.join(p, "MyBrush/MyBrush/preferences.json"));

function send(win, channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isLoadingMainFrame())
    win.webContents.send(channel, payload);
}
function state(win) {
  const connected = screen
    .getAllDisplays()
    .some((d) => windows.get(d.id) === win);
  return {
    preferences: prefs,
    platform: process.platform,
    visible: visible && connected,
    tool,
    active: connected && windows.get(activeDisplay) === win,
    blocked: !!busyWindow() && busyWindow() !== win,
    revision: preferenceRevision,
    registrationError,
  };
}
function broadcastState() {
  for (const win of windows.values()) send(win, "brush:state", state(win));
  updateMenu();
}
function activeWindow() {
  return windows.get(activeDisplay) || windows.values().next().value;
}
function show() {
  if (hiding) {
    hiding.then(show);
    return;
  }
  activeDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  ).id;
  visible = true;
  for (const display of screen.getAllDisplays()) {
    const win = windows.get(display.id);
    if (win) win.showInactive();
  }
  broadcastState();
  activeWindow()?.show();
  activeWindow()?.focus();
}
async function hide() {
  if (hiding) return hiding;
  hiding = (async () => {
    const token = ++hideSequence;
    const waiting = [...windows.values()]
      .filter((w) => !w.isDestroyed() && !w.webContents.isLoadingMainFrame())
      .map(
        (win) =>
          new Promise((resolve) => {
            const key = `${token}:${win.webContents.id}`;
            const timer = setTimeout(() => {
              hideAcks.delete(key);
              resolve();
            }, 1200);
            hideAcks.set(key, () => {
              clearTimeout(timer);
              hideAcks.delete(key);
              resolve();
            });
            send(win, "brush:command", { action: "prepare-hide", token });
          }),
      );
    await Promise.all(waiting);
    visible = false;
    for (const win of windows.values()) win.hide();
    if (process.platform === "darwin") app.hide();
    broadcastState();
  })();
  try {
    await hiding;
  } finally {
    hiding = null;
  }
}
function toggle() {
  if (!visible) {
    show();
    return;
  }
  // Renderer owns modal/IME priority and the current editing transaction.
  send(busyWindow() || activeWindow(), "brush:command", { action: "toggle" });
}
function openSettings() {
  if (!visible) show();
  send(busyWindow() || activeWindow(), "brush:command", {
    action: "settings",
  });
}
function updateMenu() {
  const items = [
    {
      label: `${visible ? "필기 끄기" : "필기 켜기"} (${bindingLabel(prefs.shortcuts.toggle, process.platform)})`,
      click: toggle,
    },
    { label: "단축키 설정…", click: openSettings },
    ...(registrationError
      ? [
          {
            label: "전역 단축키 등록 실패 · 설정에서 변경하세요",
            enabled: false,
          },
        ]
      : []),
    { type: "separator" },
    { label: "My Brush 종료", click: () => app.quit() },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(items));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "My Brush", submenu: items },
      {
        label: "편집",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]),
  );
}
function createOverlay(display) {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#01000000",
    enableLargerThanScreen: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    title: "My Brush",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  windows.set(display.id, win);
  const nativeEvents = [];
  nativeInputEvents.set(win.webContents.id, nativeEvents);
  const rememberNative = (kind, mouse = {}) => {
    nativeEvents.push({
      kind,
      time: Date.now(),
      button: { left: 0, middle: 1, right: 2 }[mouse.button],
      control: mouse.modifiers?.includes("control"),
      focused: win.isFocused(),
    });
    if (nativeEvents.length > 12) nativeEvents.shift();
  };
  win.webContents.on("before-mouse-event", (_event, mouse) => {
    if (mouse.type === "mouseDown" || mouse.type === "mouseUp")
      rememberNative(mouse.type === "mouseDown" ? "down" : "up", mouse);
  });
  win.on("blur", () => rememberNative("blur"));
  win.setAlwaysOnTop(true, "screen-saver");
  if (process.platform === "darwin")
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", () => {
    send(win, "brush:state", state(win));
    if (visible && screen.getAllDisplays().some((d) => d.id === display.id))
      win.showInactive();
  });
  win.on("focus", () => {
    rememberNative("focus");
    const modal = modalWindow();
    if (modal && modal !== win) {
      modal.focus();
      return;
    }
    if (activeDisplay !== display.id && visible) {
      activeDisplay = display.id;
      broadcastState();
    }
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      hide();
    }
  });
  win.loadFile(entry);
  return win;
}
function refreshDisplays() {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const win = windows.get(display.id) || createOverlay(display);
    win.setBounds(display.bounds);
    if (visible) win.showInactive();
  }
  for (const [id, win] of windows)
    if (!displays.some((d) => d.id === id)) {
      interactions.delete(win.webContents.id);
      send(win, "brush:command", { action: "deactivate-display" });
      win.hide();
    }
  if (!displays.some((d) => d.id === activeDisplay))
    activeDisplay = displays[0]?.id;
  broadcastState();
}
function trusted(event) {
  if (
    !event.senderFrame ||
    event.senderFrame.url !== entryURL ||
    event.senderFrame !== event.sender.mainFrame ||
    ![...windows.values()].some((w) => w.webContents === event.sender)
  )
    throw new Error("허용되지 않은 요청입니다.");
}
function installIPC() {
  ipcMain.on("brush:input-diagnostic", (event, report) => {
    trusted(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    inputDiagnostics.record(report, {
      focused: win.isFocused(),
      visible: win.isVisible(),
      appHidden: process.platform === "darwin" && app.isHidden(),
      version: app.getVersion(),
      events: nativeInputEvents.get(event.sender.id),
    });
  });
  ipcMain.on("brush:interaction", (event, value) => {
    trusted(event);
    interactions.set(event.sender.id, {
      modal: !!value?.modal,
      composing: !!value?.composing,
    });
    broadcastState();
  });
  ipcMain.handle("brush:init", (event) => {
    trusted(event);
    return state(BrowserWindow.fromWebContents(event.sender));
  });
  ipcMain.handle("brush:hide", (event) => {
    trusted(event);
    return hide();
  });
  ipcMain.on("brush:hide-ready", (event, token) => {
    trusted(event);
    hideAcks.get(`${token}:${event.sender.id}`)?.();
  });
  ipcMain.handle("brush:tool", (event, next) => {
    trusted(event);
    const owner = busyWindow();
    if (owner && owner.webContents !== event.sender) return;
    if (!["pen", "rect", "text"].includes(next)) return;
    tool = next;
    broadcastState();
  });
  ipcMain.handle("brush:save", (event, raw) => {
    trusted(event);
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (k) => !["color", "width", "fontSize", "shortcuts"].includes(k),
      )
    ) {
      return { ok: false, error: "올바르지 않은 설정 변경입니다." };
    }
    const merged = { ...prefs, ...raw };
    const validation = validateBindings(merged.shortcuts, process.platform);
    if (validation.error) return { ok: false, error: validation.error };
    const next = normalizePreferences(merged, process.platform);
    const result = hotkeys.apply(next.shortcuts.toggle, () =>
      savePreferences(userData, next),
    );
    if (!result.ok) return result;
    prefs = next;
    preferenceRevision++;
    registrationError = "";
    broadcastState();
    return { ok: true, preferences: prefs, revision: preferenceRevision };
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (prefs) show();
  });
  // Activation alone must preserve OFF; use the tray, shortcut or a second launch.
  app.on("activate", () => {});
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
    globalShortcut.unregisterAll();
  });
  app
    .whenReady()
    .then(() => {
      prefs = loadPreferences(userData, legacyPaths, process.platform);
      session.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      installIPC();
      activeDisplay = screen.getPrimaryDisplay().id;
      refreshDisplays();
      // Draw a small pencil directly as a bitmap; template tint follows macOS appearance.
      const bitmap = Buffer.alloc(32 * 32 * 4);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const along = (x - y + 16) / 32;
          const t = Math.max(0, Math.min(1, along));
          const distance = Math.hypot(x - (8 + 16 * t), y - (24 - 16 * t));
          if (distance > 3.2) continue;
          const index = (y * 32 + x) * 4;
          const shade =
            process.platform === "darwin" ? 0 : distance > 1.8 ? 255 : 50;
          bitmap[index] = bitmap[index + 1] = bitmap[index + 2] = shade;
          bitmap[index + 3] = 255;
        }
      const image = nativeImage.createFromBitmap(bitmap, {
        width: 32,
        height: 32,
        scaleFactor: 2,
      });
      if (process.platform === "darwin") image.setTemplateImage(true);
      tray = new Tray(image);
      tray.setToolTip("My Brush");
      tray.on("click", toggle);
      const registration = hotkeys.install(prefs.shortcuts.toggle);
      if (!registration.ok) registrationError = registration.error;
      updateMenu();
      screen.on("display-added", refreshDisplays);
      screen.on("display-removed", refreshDisplays);
      screen.on("display-metrics-changed", refreshDisplays);
      if (!process.argv.includes("--start-hidden") || registrationError) show();
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
