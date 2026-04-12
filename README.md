# LMonitor

LMonitor is a lightweight Linux system monitor with a live web dashboard.
It samples core host metrics from `/proc`, pushes updates over WebSocket, and renders interactive charts in the browser.

## Features

- Live metrics stream (WebSocket)
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

- Linux host (metrics are read from `/proc`)
- Go 1.22+
- Modern browser (Chrome, Firefox, Edge)

## Quick Start

### 1. Build

```bash
go build -o lmonitor ./cmd/lmonitor
```

### 2. Run dashboard mode

```bash
./lmonitor
```

Open:

- http://127.0.0.1:43000

### 3. Run print mode (CLI stream only)

```bash
./lmonitor -print
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
internal/metrics/             Linux metric collectors and parsers
internal/server/server.go     Metrics WebSocket hub and poll loop
internal/server/logs.go       Log WebSocket hub for dashboard log panel
web/                          Extra web copy (not embedded by current binary)
```

## How It Works

1. `internal/metrics.Collector` reads and parses Linux proc files.
2. `RunPoller` samples on each interval and broadcasts JSON samples to `/ws`.
3. Browser dashboard subscribes to `/ws` and updates charts in real time.
4. App logs are mirrored to `/logs`, consumed by the dashboard log panel.

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
go test ./...
```

Format code:

```bash
gofmt -w ./cmd ./internal
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
- The app is currently focused on Linux proc/stat sources.
