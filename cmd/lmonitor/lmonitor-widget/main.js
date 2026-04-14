const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const Store = require("./store");

const store = new Store();

let win = null;
let tray = null;

const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 700;

function createWindow() {
  const saved = store.get("bounds") || {};
  const { width, height, x, y } = saved;

  win = new BrowserWindow({
    width: width || DEFAULT_WIDTH,
    height: height || DEFAULT_HEIGHT,
    x: x != null ? x : undefined,
    y: y != null ? y : undefined,
    minWidth: 260,
    minHeight: 300,
    maxWidth: 520,
    frame: false,
    transparent: true,
    alwaysOnTop: store.get("alwaysOnTop") !== false,
    skipTaskbar: false,
    resizable: true,
    hasShadow: false,
    vibrancy: null,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  win.on("close", () => {
    if (win) {
      const b = win.getBounds();
      store.set("bounds", b);
    }
  });

  win.on("closed", () => {
    win = null;
  });
}

function createTray() {
  // Minimal 1x1 transparent tray icon fallback — replace with real icon if desired
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: win && win.isVisible() ? "Hide Widget" : "Show Widget",
        click: () => {
          if (!win) {
            createWindow();
          } else if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
          tray.setContextMenu(buildMenu());
        },
      },
      {
        label: "Always on Top",
        type: "checkbox",
        checked: store.get("alwaysOnTop") !== false,
        click: (item) => {
          store.set("alwaysOnTop", item.checked);
          if (win) win.setAlwaysOnTop(item.checked);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

  tray.setToolTip("LMonitor Widget");
  tray.setContextMenu(buildMenu());
  tray.on("click", () => {
    if (!win) {
      createWindow();
    } else if (win.isVisible()) {
      win.focus();
    } else {
      win.show();
      win.focus();
    }
  });
}

// IPC handlers from renderer
ipcMain.handle("get-prefs", () => ({
  host: store.get("host") || "localhost",
  port: store.get("port") || 43000,
  opacity: store.get("opacity") != null ? store.get("opacity") : 0.92,
  alwaysOnTop: store.get("alwaysOnTop") !== false,
  accentColor: store.get("accentColor") || "#58a6ff",
}));

ipcMain.on("set-prefs", (_e, prefs) => {
  if (prefs.host != null) store.set("host", prefs.host);
  if (prefs.port != null) store.set("port", Number(prefs.port));
  if (prefs.opacity != null) store.set("opacity", prefs.opacity);
  if (prefs.alwaysOnTop != null) {
    store.set("alwaysOnTop", prefs.alwaysOnTop);
    if (win) win.setAlwaysOnTop(prefs.alwaysOnTop);
  }
  if (prefs.accentColor != null) store.set("accentColor", prefs.accentColor);
});

ipcMain.on("close-window", () => {
  if (win) win.hide();
});

ipcMain.on("minimize-window", () => {
  if (win) win.minimize();
});

ipcMain.on("start-drag", (_e, { mouseX, mouseY }) => {
  if (!win) return;
  const [wx, wy] = win.getPosition();
  const origin = { wx, wy, mouseX, mouseY };
  void origin;
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  // Keep app running in tray on all platforms
});



app.on("activate", () => {
  if (!win) createWindow();
});
