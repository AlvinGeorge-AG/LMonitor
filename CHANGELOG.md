# Changelog

## v0.3.0 - 2026-04-13

- Added structured application logging with categorized log levels for improved troubleshooting
- Added Linux system journal streaming support to power live OS log visibility in the dashboard
- Improved the dashboard UI and log panel behavior for clearer real-time monitoring
- Updated release documentation for the new packaged version and artifacts

## v0.2.0 - 2026-04-12

- Added Windows metrics collection without changing the dashboard or WebSocket payload shape
- Kept the existing Linux `/proc` collector in place behind Linux-only build tags
- Added clean unsupported-platform handling for non-Linux and non-Windows targets
- Updated the README with platform support, Windows usage, and release artifact details
- Published new release artifacts for Linux amd64, Linux arm64, and Windows amd64

## v0.1.0

- Initial packaged release with Linux dashboard binaries and project documentation
