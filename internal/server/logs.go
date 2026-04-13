package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const defaultLogHistory = 400

var appLogPattern = regexp.MustCompile(`^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}\.\d{6})\s+([A-Z]+)\s+(.*)$`)

// LogEntry is the structured payload sent to the dashboard log panel.
type LogEntry struct {
	T       int64  `json:"t"`
	Level   string `json:"level"`
	Origin  string `json:"origin,omitempty"`
	Source  string `json:"source,omitempty"`
	Unit    string `json:"unit,omitempty"`
	Host    string `json:"host,omitempty"`
	PID     string `json:"pid,omitempty"`
	Message string `json:"message"`
}

// LogHub fans out structured log entries to WebSocket clients and keeps a small history.
type LogHub struct {
	mu         sync.Mutex
	clients    map[*websocket.Conn]struct{}
	history    []LogEntry
	maxHistory int
}

// NewLogHub creates a log hub with a bounded history buffer.
func NewLogHub() *LogHub {
	return &LogHub{
		clients:    make(map[*websocket.Conn]struct{}),
		maxHistory: defaultLogHistory,
	}
}

func (h *LogHub) Add(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *LogHub) Remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	_ = c.Close()
}

// BroadcastEntry appends an entry to history and sends it to all connected clients.
func (h *LogHub) BroadcastEntry(entry LogEntry) {
	entry, ok := normalizeLogEntry(entry)
	if !ok {
		return
	}

	b, err := json.Marshal(entry)
	if err != nil {
		return
	}

	deadline := time.Now().Add(2 * time.Second)
	h.mu.Lock()
	h.history = append(h.history, entry)
	if h.maxHistory > 0 && len(h.history) > h.maxHistory {
		h.history = append([]LogEntry(nil), h.history[len(h.history)-h.maxHistory:]...)
	}
	for c := range h.clients {
		_ = c.SetWriteDeadline(deadline)
		if err := c.WriteMessage(websocket.TextMessage, b); err != nil {
			delete(h.clients, c)
			_ = c.Close()
		}
	}
	h.mu.Unlock()
}

// BroadcastLine parses an app log line and sends it as a structured entry.
func (h *LogHub) BroadcastLine(line string) {
	h.BroadcastEntry(parseAppLogLine(line))
}

// Writer returns an io.Writer that splits log output into individual lines.
func (h *LogHub) Writer() io.Writer {
	return &logWriter{hub: h}
}

// Handler returns http.Handler for log-stream WebSocket upgrades.
func (h *LogHub) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WARN log websocket upgrade: %v", err)
			return
		}
		h.Add(conn)
		go func() {
			defer h.Remove(conn)

			h.mu.Lock()
			history := append([]LogEntry(nil), h.history...)
			h.mu.Unlock()
			for _, entry := range history {
				b, err := json.Marshal(entry)
				if err != nil {
					continue
				}
				_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
					return
				}
			}

			conn.SetReadLimit(512)
			_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			for {
				_, _, err := conn.ReadMessage()
				if err != nil {
					return
				}
				_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			}
		}()
	})
}

func normalizeLogEntry(entry LogEntry) (LogEntry, bool) {
	entry.Message = strings.TrimRight(entry.Message, "\r\n")
	if strings.TrimSpace(entry.Message) == "" {
		return LogEntry{}, false
	}
	if entry.T <= 0 {
		entry.T = time.Now().UnixMilli()
	}
	entry.Level = normalizeLogLevel(entry.Level)
	if entry.Level == "" {
		entry.Level = classifyLogTextLevel(entry.Message)
	}
	switch strings.ToLower(strings.TrimSpace(entry.Origin)) {
	case "app":
		entry.Origin = "app"
	case "system":
		entry.Origin = "system"
	default:
		if strings.EqualFold(strings.TrimSpace(entry.Source), "lmonitor") {
			entry.Origin = "app"
		} else {
			entry.Origin = "system"
		}
	}
	entry.Source = strings.TrimSpace(entry.Source)
	if entry.Source == "" {
		if entry.Origin == "app" {
			entry.Source = "lmonitor"
		} else {
			entry.Source = "system"
		}
	}
	entry.Unit = strings.TrimSpace(entry.Unit)
	entry.Host = strings.TrimSpace(entry.Host)
	entry.PID = strings.TrimSpace(entry.PID)
	return entry, true
}

func normalizeLogLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "high", "fatal", "panic", "critical", "crit", "alert", "emerg", "emergency":
		return "high"
	case "error", "err":
		return "error"
	case "warn", "warning":
		return "warning"
	case "debug", "trace":
		return "debug"
	case "good", "info", "notice":
		return "good"
	default:
		return ""
	}
}

func classifyLogTextLevel(line string) string {
	upper := strings.ToUpper(line)
	switch {
	case strings.Contains(upper, "FATAL"),
		strings.Contains(upper, "PANIC"),
		strings.Contains(upper, "CRITICAL"),
		strings.Contains(upper, " ALERT "),
		strings.Contains(upper, "EMERG"):
		return "high"
	case strings.Contains(upper, "ERROR"):
		return "error"
	case strings.Contains(upper, "WARN"):
		return "warning"
	case strings.Contains(upper, "DEBUG"),
		strings.Contains(upper, "TRACE"):
		return "debug"
	default:
		return "good"
	}
}

func parseAppLogLine(line string) LogEntry {
	line = strings.TrimRight(line, "\r")
	entry := LogEntry{
		T:       time.Now().UnixMilli(),
		Level:   classifyLogTextLevel(line),
		Origin:  "app",
		Source:  "lmonitor",
		Message: line,
	}

	m := appLogPattern.FindStringSubmatch(line)
	if len(m) != 4 {
		return entry
	}

	if ts, err := time.Parse("2006/01/02 15:04:05.000000", m[1]); err == nil {
		entry.T = ts.UnixMilli()
	}
	entry.Level = normalizeLogLevel(m[2])
	entry.Message = strings.TrimSpace(m[3])
	return entry
}

type logWriter struct {
	hub *LogHub
	mu  sync.Mutex
	buf []byte
}

func (w *logWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.buf = append(w.buf, p...)
	for {
		idx := bytes.IndexByte(w.buf, '\n')
		if idx < 0 {
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		w.hub.BroadcastLine(line)
	}

	return len(p), nil
}
