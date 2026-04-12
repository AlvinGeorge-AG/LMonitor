# LMonitor

LMonitor is a lightweight host system monitor with a live web dashboard.
It samples core host metrics with platform-specific collectors, pushes updates over WebSocket, and renders interactive charts in the browser.

## Features

- Live metrics stream (WebSocket)
- Linux and Windows support
- CPU and I/O wait
- Per-core CPU usage
- Memory usage (RAM, swap, cached, buffers)
- Load averages and load percentage vs CPU count
- Network RX/TX throughput
- Disk read/write throughput
- Runnable tasks and total tasks
- Root filesystem usage
- Live in-app log panel in the dashboard
- Multiple chart modes per panel (line, area, bar, and more where applicable)

## Requirements

- Linux or Windows host
- Go 1.22+
- Modern browser (Chrome, Firefox, Edge)

## Quick Start

### 1. Build

```bash
go build -o lmonitor ./cmd/lmonitor
```

On Windows:

```powershell
go build -o lmonitor.exe ./cmd/lmonitor
```

### 2. Run dashboard mode

```bash
./lmonitor
```

On Windows:

```powershell
.\lmonitor.exe
```

Open:

- http://127.0.0.1:43000

### 3. Run print mode (CLI stream only)

```bash
./lmonitor -print
```

On Windows:

```powershell
.\lmonitor.exe -print
```

## Runtime Flags

- `-addr` HTTP listen address (default: `127.0.0.1:43000`)
- `-interval` sampling interval (default: `1s`)
- `-print` print samples to stdout instead of serving HTTP

Examples:

```bash
# Listen on all interfaces
./lmonitor -addr 0.0.0.0:43000

# Slower sampling
./lmonitor -interval 2s
```

## Project Layout

```text
cmd/lmonitor/main.go          App entrypoint, HTTP server, embedded web assets
cmd/lmonitor/web/             Embedded dashboard assets actually served by the binary
internal/metrics/             Platform-specific metric collectors and parsers
internal/server/server.go     Metrics WebSocket hub and poll loop
internal/server/logs.go       Log WebSocket hub for dashboard log panel
web/                          Extra web copy (not embedded by current binary)
```

## How It Works

1. `internal/metrics.Collector` uses the host-specific backend for metric collection.
2. Linux reads directly from `/proc`; Windows uses platform APIs through `gopsutil`.
3. `RunPoller` samples on each interval and broadcasts JSON samples to `/ws`.
4. Browser dashboard subscribes to `/ws` and updates charts in real time.
5. App logs are mirrored to `/logs`, consumed by the dashboard log panel.

## Platform Support

LMonitor now supports Linux and Windows with the same dashboard and WebSocket payload format.

Linux:
- Full support for the current metric set using `/proc` and `statfs`

Windows:
- CPU, per-core CPU, RAM, swap, load, uptime, network, disk throughput, root drive usage, and total process count are supported
- `ProcsRun` is currently Linux-specific and may remain `0`
- Some metrics are best-effort depending on what Windows exposes on the host

Other platforms:
- The binary builds can fail cleanly at runtime with an unsupported-platform message until a collector is added

## Releases

Current release:
- `v0.2.0`

Release artifacts:
- `dist/lmonitor-v0.2.0-linux-amd64`
- `dist/lmonitor-v0.2.0-linux-arm64`
- `dist/lmonitor-v0.2.0-windows-amd64.exe`

Release notes:
- [CHANGELOG.md](CHANGELOG.md)
- [docs/releases/v0.2.0.md](docs/releases/v0.2.0.md)

## Logging Behavior

- Dashboard log panel shows log lines from the monitor process.
- It is not currently tailing system journals like `journalctl`.
- Depending on current logger config, logs may also appear in terminal.

## Stop Running Instances

Use one of:

```bash
# stop all processes named exactly lmonitor
pkill -x lmonitor

# broader match if needed
pkill -f lmonitor
```

## Development

Run tests:

```bash
env GOCACHE=/tmp/lmonitor-gocache go test ./...
```

Format code:

```bash
gofmt -w ./cmd ./internal
```

Cross-build for Windows:

```bash
env GOCACHE=/tmp/lmonitor-gocache GOOS=windows GOARCH=amd64 go build ./cmd/lmonitor
```

## Troubleshooting

### Command exits with code 130

Process was interrupted (usually Ctrl+C). This is expected when stopping manually.

### Command exits with code 143

Process received SIGTERM (often from `pkill`/`kill`). This is expected during shutdown.

### App appears to run but no terminal output

If running in dashboard mode without `-print`, primary output is in the web UI and logs panel.

### Port already in use

Run on another address/port:

```bash
./lmonitor -addr 127.0.0.1:43001
```

Then open the new URL in your browser.

## Notes

- Sampling and parsing logic has tests under `internal/metrics`.
- Linux and Windows share the same server and dashboard layers.
- Linux uses `/proc`; Windows uses a dedicated collector backend.
