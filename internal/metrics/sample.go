package metrics

// Sample is one tick of system metrics pushed over the WebSocket.
type Sample struct {
	T       int64   `json:"t"`
	CPU     float64 `json:"cpu"`
	RAM     float64 `json:"ram"`
	Swap    float64 `json:"swap"`
	Load1   float64 `json:"load1"`
	Load5   float64 `json:"load5"`
	Load15  float64 `json:"load15"`
	NetRx   float64 `json:"netRx"`
	NetTx   float64 `json:"netTx"`
	DskRd   float64 `json:"dskRd"`
	DskWr   float64 `json:"dskWr"`
	RootPct float64 `json:"rootPct"`
}
