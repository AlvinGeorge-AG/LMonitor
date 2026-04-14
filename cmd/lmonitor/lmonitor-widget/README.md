# LMonitor Widget

A compact, always-on-top Electron widget for [LMonitor](https://github.com/AlvinGeorge-AG/lmonitor)
(or any compatible server). Floats above your windows showing all 9 metric panels in a
scrollable semi-transparent panel.

## Features

- All 9 LMonitor panels: CPU & I/O Wait, Memory, Load Average, Network, Disk I/O,
  Per-Core CPU, Running Tasks, Root Filesystem, System Logs
- Always-on-top, frameless, semi-transparent, draggable
- Per-panel chart type switcher (Line / Area / Bar / Radar)
- Live subtitle line under each panel title (current values)
- System tray icon — hide/show without quitting
- Settings overlay: configure host, port, opacity, always-on-top
- Window size/position saved between sessions

## Requirements

- Node.js 18+
- LMonitor running (default: `localhost:43000`)

## Quick start

```bash
cd lmonitor-widget
npm install
npm start
```

## Build distributables

```bash
# Linux AppImage + deb
npm run build:linux

# Windows portable exe
npm run build:win

# macOS dmg
npm run build:mac
```

## Configuration

Click the **⚙** button in the titlebar to open settings:

| Setting | Default | Description |
|---|---|---|
| Host | `localhost` | LMonitor server hostname/IP |
| Port | `43000` | LMonitor server port |
| Opacity | `0.92` | Window background opacity (0.3–1.0) |
| Always on Top | `true` | Keep widget above other windows |

Settings are saved to Electron's userData directory and persist across restarts.

## WebSocket endpoints used

| Endpoint | Data |
|---|---|
| `ws://<host>:<port>/ws` | Metric samples (JSON, ~1Hz) |
| `ws://<host>:<port>/logs` | System log entries (JSON) |

These match LMonitor v0.3.0's server implementation exactly.

## Project structure

```
lmonitor-widget/
├── main.js          # Electron main process (window, tray, IPC)
├── preload.js       # Context bridge (safe IPC to renderer)
├── store.js         # Lightweight JSON prefs store
├── package.json
└── renderer/
    ├── index.html   # Widget UI
    └── app.js       # All chart logic + WebSocket connections
```
