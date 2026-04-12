package server

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// LogHub fans out plain-text log lines to WebSocket clients and keeps a small history.
type LogHub struct {
	mu         sync.Mutex
	clients    map[*websocket.Conn]struct{}
	history    []string
	maxHistory int
}

// NewLogHub creates a log hub with a bounded history buffer.
func NewLogHub() *LogHub {
	return &LogHub{
		clients:    make(map[*websocket.Conn]struct{}),
		maxHistory: 200,
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

// BroadcastLine appends a line to history and sends it to all connected clients.
func (h *LogHub) BroadcastLine(line string) {
	line = strings.TrimRight(line, "\r")
	if line == "" {
		return
	}

	h.mu.Lock()
	h.history = append(h.history, line)
	if h.maxHistory > 0 && len(h.history) > h.maxHistory {
		h.history = append([]string(nil), h.history[len(h.history)-h.maxHistory:]...)
	}
	deadline := time.Now().Add(2 * time.Second)
	for c := range h.clients {
		_ = c.SetWriteDeadline(deadline)
		if err := c.WriteMessage(websocket.TextMessage, []byte(line)); err != nil {
			delete(h.clients, c)
			_ = c.Close()
		}
	}
	h.mu.Unlock()
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
			history := append([]string(nil), h.history...)
			h.mu.Unlock()
			for _, line := range history {
				_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, []byte(line)); err != nil {
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
