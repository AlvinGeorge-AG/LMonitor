//go:build linux

package server

import (
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

var journalOutputFields = []string{
	"__CURSOR",
	"__REALTIME_TIMESTAMP",
	"PRIORITY",
	"MESSAGE",
	"SYSLOG_IDENTIFIER",
	"_SYSTEMD_UNIT",
	"_SYSTEMD_USER_UNIT",
	"USER_UNIT",
	"_COMM",
	"_HOSTNAME",
	"_PID",
	"SYSLOG_PID",
}

// StartSystemLogCollector tails the system journal entries accessible to the current user.
func StartSystemLogCollector(h *LogHub) {
	go func() {
		var afterCursor string
		var lastErr string

		for {
			nextCursor, err := streamJournal(h, afterCursor)
			if nextCursor != "" {
				afterCursor = nextCursor
			}
			if err != nil {
				msg := err.Error()
				if msg != lastErr {
					h.BroadcastEntry(LogEntry{
						Level:   "warning",
						Origin:  "app",
						Source:  "journalctl",
						Message: "system journal stream unavailable: " + msg,
					})
					lastErr = msg
				}
			} else {
				lastErr = ""
			}
			time.Sleep(5 * time.Second)
		}
	}()
}

func streamJournal(h *LogHub, afterCursor string) (string, error) {
	if _, err := exec.LookPath("journalctl"); err != nil {
		return afterCursor, err
	}

	args := []string{
		"--no-pager",
		"--all",
		"-o", "json",
		"--output-fields=" + strings.Join(journalOutputFields, ","),
	}
	if afterCursor != "" {
		args = append(args, "--after-cursor", afterCursor)
	} else {
		args = append(args, "-n", strconv.Itoa(defaultLogHistory))
	}
	args = append(args, "-f")

	cmd := exec.Command("journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return afterCursor, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return afterCursor, err
	}
	if err := cmd.Start(); err != nil {
		return afterCursor, err
	}

	stderrCh := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(stderr)
		stderrCh <- strings.TrimSpace(string(b))
	}()

	dec := json.NewDecoder(stdout)
	lastCursor := afterCursor
	for {
		var raw map[string]any
		if err := dec.Decode(&raw); err != nil {
			waitErr := cmd.Wait()
			stderrText := <-stderrCh
			if err == io.EOF {
				if waitErr != nil {
					return lastCursor, wrapJournalErr(waitErr, stderrText)
				}
				if stderrText != "" {
					return lastCursor, fmt.Errorf("%s", stderrText)
				}
				return lastCursor, nil
			}
			return lastCursor, wrapJournalErr(err, stderrText)
		}

		entry, cursor, ok := journalRecordToEntry(raw)
		if cursor != "" {
			lastCursor = cursor
		}
		if ok {
			h.BroadcastEntry(entry)
		}
	}
}

func wrapJournalErr(err error, stderrText string) error {
	if stderrText == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, stderrText)
}

func journalRecordToEntry(raw map[string]any) (LogEntry, string, bool) {
	cursor := journalField(raw, "__CURSOR")
	message := strings.TrimSpace(journalField(raw, "MESSAGE"))
	if message == "" {
		return LogEntry{}, cursor, false
	}

	source := firstNonEmpty(
		journalField(raw, "SYSLOG_IDENTIFIER"),
		journalField(raw, "_COMM"),
		journalField(raw, "_SYSTEMD_UNIT"),
		journalField(raw, "_SYSTEMD_USER_UNIT"),
		journalField(raw, "USER_UNIT"),
		journalField(raw, "_HOSTNAME"),
	)
	unit := firstNonEmpty(
		journalField(raw, "_SYSTEMD_UNIT"),
		journalField(raw, "_SYSTEMD_USER_UNIT"),
		journalField(raw, "USER_UNIT"),
	)
	pid := firstNonEmpty(
		journalField(raw, "_PID"),
		journalField(raw, "SYSLOG_PID"),
	)

	return LogEntry{
		T:       parseJournalTimestamp(journalField(raw, "__REALTIME_TIMESTAMP")),
		Level:   journalPriorityLevel(journalField(raw, "PRIORITY")),
		Origin:  "system",
		Source:  source,
		Unit:    unit,
		Host:    journalField(raw, "_HOSTNAME"),
		PID:     pid,
		Message: message,
	}, cursor, true
}

func parseJournalTimestamp(v string) int64 {
	us, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if err != nil || us <= 0 {
		return 0
	}
	return us / 1000
}

func journalPriorityLevel(priority string) string {
	n, err := strconv.Atoi(strings.TrimSpace(priority))
	if err != nil {
		return ""
	}
	switch {
	case n <= 2:
		return "high"
	case n == 3:
		return "error"
	case n == 4:
		return "warning"
	case n >= 7:
		return "debug"
	default:
		return "good"
	}
}

func journalField(raw map[string]any, key string) string {
	return normalizeJournalValue(raw[key])
}

func normalizeJournalValue(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(x)
	case float64:
		return strconv.FormatInt(int64(x), 10)
	case json.Number:
		return x.String()
	case []any:
		parts := make([]string, 0, len(x))
		for _, item := range x {
			s := normalizeJournalValue(item)
			if s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, " ")
	default:
		return strings.TrimSpace(fmt.Sprint(x))
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		v = strings.TrimSpace(v)
		if v != "" {
			return v
		}
	}
	return ""
}
