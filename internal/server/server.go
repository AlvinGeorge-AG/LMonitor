package server

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"lmonitor/internal/metrics"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		o := r.Header.Get("Origin")
		if o == "" {
			return true
		}
		return strings.HasPrefix(o, "http://localhost") ||
			strings.HasPrefix(o, "http://127.0.0.1") ||
			strings.HasPrefix(o, "http://[::1]")
	},
}

// Hub fans out JSON samples to WebSocket clients; slow clients are dropped on write error.
type Hub struct {
	mu      sync.Mutex
	clients map[*websocket.Conn]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[*websocket.Conn]struct{})}
}

func (h *Hub) Add(c *websocket.Conn) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) Remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, c)
	h.mu.Unlock()
	_ = c.Close()
}

func (h *Hub) BroadcastJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	deadline := time.Now().Add(2 * time.Second)
	h.mu.Lock()
	for c := range h.clients {
		_ = c.SetWriteDeadline(deadline)
		if err := c.WriteMessage(websocket.TextMessage, b); err != nil {
			delete(h.clients, c)
			_ = c.Close()
		}
	}
	h.mu.Unlock()
}

// Handler returns http.Handler for WebSocket upgrades.
func (h *Hub) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("WARN websocket upgrade: %v", err)
			return
		}
		h.Add(conn)
		go func() {
			defer h.Remove(conn)
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

func formatRate(bps float64) string {
	if bps >= 1e9 {
		return formatFixed(bps/1e9, 2) + " GB/s"
	}
	if bps >= 1e6 {
		return formatFixed(bps/1e6, 2) + " MB/s"
	}
	if bps >= 1e3 {
		return formatFixed(bps/1e3, 1) + " KB/s"
	}
	return formatFixed(bps, 0) + " B/s"
}

func formatFixed(v float64, digits int) string {
	s := strconv.FormatFloat(v, 'f', digits, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" {
		return "0"
	}
	return s
}

// RunPoller collects metrics every interval and broadcasts; if printFn non-nil, also logs.
func RunPoller(col *metrics.Collector, hub *Hub, interval time.Duration, printFn func(metrics.Sample)) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for range t.C {
		s, err := col.Collect()
		if err != nil {
			log.Printf("collect: %v", err)
			continue
		}
		if printFn != nil {
			printFn(s)
		}
		hub.BroadcastJSON(s)
		log.Printf(
			"DEBUG sample cpu=%.1f%% iow=%.1f%% ram=%.1f%% swap=%.1f%% cache=%.1f%% buf=%.1f%% load=%.2f/%.2f/%.2f load%%=%.1f%% tasks=%d/%d net=%s/%s disk=%s/%s root=%.1f%%",
			s.CPU,
			s.IOWait,
			s.RAM,
			s.Swap,
			s.Cached,
			s.Buffers,
			s.Load1,
			s.Load5,
			s.Load15,
			s.Load1Pct,
			s.ProcsRun,
			s.ProcsTotal,
			formatRate(s.NetRx),
			formatRate(s.NetTx),
			formatRate(s.DskRd),
			formatRate(s.DskWr),
			s.RootPct,
		)
	}
}
