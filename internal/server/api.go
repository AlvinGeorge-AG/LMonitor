package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/shirou/gopsutil/v4/process"
)

type ProcessInfo struct {
	PID           int32   `json:"pid"`
	Name          string  `json:"name"`
	CPUPercent    float64 `json:"cpu"`
	MemoryPercent float32 `json:"mem"`
	Username      string  `json:"user"`
}

func MountAPI(mux *http.ServeMux) {
	mux.HandleFunc("/api/processes", handleGetProcesses)
	mux.HandleFunc("/api/process/", handleKillProcess) // will match /api/process/{pid}/kill
}

func handleGetProcesses(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	procs, err := process.Processes()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var infos []ProcessInfo
	for _, p := range procs {
		name, _ := p.Name()
		if name == "" {
			continue
		}
		cpu, _ := p.CPUPercent()
		mem, _ := p.MemoryPercent()
		user, _ := p.Username()

		infos = append(infos, ProcessInfo{
			PID:           p.Pid,
			Name:          name,
			CPUPercent:    cpu,
			MemoryPercent: mem,
			Username:      user,
		})
	}

	// Sort by CPU usage descending
	sort.Slice(infos, func(i, j int) bool {
		return infos[i].CPUPercent > infos[j].CPUPercent
	})

	// Limit to top 50
	if len(infos) > 50 {
		infos = infos[:50]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(infos)
}

func handleKillProcess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	pathParts := strings.Split(r.URL.Path, "/")
	// /api/process/{pid}/kill
	if len(pathParts) != 5 {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	pidStr := pathParts[3]
	pid, err := strconv.ParseInt(pidStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid PID", http.StatusBadRequest)
		return
	}

	p, err := process.NewProcess(int32(pid))
	if err != nil {
		http.Error(w, "Process not found", http.StatusNotFound)
		return
	}

	// For cross-platform default, Kill() terminates the process.
	err = p.Kill()
	if err != nil {
		log.Printf("ERROR failed to kill process %d: %v", pid, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("INFO Killed process %d from UI", pid)
	w.WriteHeader(http.StatusOK)
}
