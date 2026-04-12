package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"time"

	"lmonitor/internal/metrics"
	"lmonitor/internal/server"
)

//go:embed web
var webRoot embed.FS

func main() {
	addr := flag.String("addr", "127.0.0.1:43000", "HTTP listen address")
	interval := flag.Duration("interval", time.Second, "metrics sampling interval")
	printMode := flag.Bool("print", false, "print samples to stdout instead of serving HTTP")
	flag.Parse()

	col := metrics.NewCollector()
	hub := server.NewHub()

	if *printMode {
		for {
			s, err := col.Collect()
			if err != nil {
				log.Fatal(err)
			}
			fmt.Printf("cpu=%.1f%% ram=%.1f%% swap=%.1f%% load=%.2f/%.2f/%.2f net_rx=%.0f net_tx=%.0f dsk_rd=%.0f dsk_wr=%.0f root=%.1f%%\n",
				s.CPU, s.RAM, s.Swap, s.Load1, s.Load5, s.Load15, s.NetRx, s.NetTx, s.DskRd, s.DskWr, s.RootPct)
			time.Sleep(*interval)
		}
	}

	static, err := fs.Sub(webRoot, "web")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(static)))
	mux.Handle("/ws", hub.Handler())

	go server.RunPoller(col, hub, *interval, nil)

	log.Printf("LMonitor listening on http://%s", *addr)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}
