package metrics

// Sample is one tick of system metrics pushed over the WebSocket.
type Sample struct {
	T          int64     `json:"t"`
	CPU        float64   `json:"cpu"`
	IOWait     float64   `json:"ioWait"`
	CPUs       []float64 `json:"cpus,omitempty"`
	NCPU       int       `json:"ncpu"`
	RAM        float64   `json:"ram"`
	Swap       float64   `json:"swap"`
	Cached     float64   `json:"cachedPct"`
	Buffers    float64   `json:"buffersPct"`
	Load1      float64   `json:"load1"`
	Load5      float64   `json:"load5"`
	Load15     float64   `json:"load15"`
	Load1Pct   float64   `json:"load1Pct"`
	NetRx      float64   `json:"netRx"`
	NetTx      float64   `json:"netTx"`
	DskRd      float64   `json:"dskRd"`
	DskWr      float64   `json:"dskWr"`
	RootPct    float64   `json:"rootPct"`
	Uptime     float64   `json:"uptime"`
	ProcsRun   int       `json:"procsRun"`
	ProcsTotal int       `json:"procsTotal"`
}
