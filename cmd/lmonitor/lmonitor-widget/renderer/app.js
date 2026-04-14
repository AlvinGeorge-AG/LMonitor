/* global Chart */
(function () {
  "use strict";

  /* ── Constants ── */
  const MAX_POINTS = 60;
  const prefersReduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  Chart.defaults.color = "#8b949e";
  Chart.defaults.borderColor = "#30363d";
  Chart.defaults.font.family =
    'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif';
  Chart.defaults.font.size = 9;

  /* ── Helpers ── */
  function formatRate(b) {
    if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB/s";
    if (b >= 1e6) return (b / 1e6).toFixed(2) + " MB/s";
    if (b >= 1e3) return (b / 1e3).toFixed(1) + " KB/s";
    return b.toFixed(0) + " B/s";
  }

  function timeLabel(t) {
    const d = new Date(t);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }

  function formatUptime(sec) {
    const s = Math.floor(sec);
    const dd = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (dd > 0) return dd + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function coreColor(i, n) {
    const step = 360 / Math.max(n, 1);
    return "hsl(" + Math.round((i * step) % 360) + ",62%,52%)";
  }

  function baseScales(yTitle) {
    return {
      x: { ticks: { color: "#8b949e", maxTicksLimit: 4, maxRotation: 0 }, grid: { color: "#21262d" } },
      y: {
        beginAtZero: true,
        title: yTitle ? { display: true, text: yTitle, color: "#6e7681", font: { size: 8 } } : undefined,
        ticks: { color: "#8b949e" },
        grid: { color: "#21262d" },
      },
    };
  }

  /* ── RollingChart class ── */
  function RollingChart(canvas, tmpl, yTitle, ttCb) {
    this.canvas = canvas;
    this.tmpl = tmpl;
    this.yTitle = yTitle;
    this.ttCb = ttCb || {};
    this.labels = [];
    this.series = tmpl.map(() => []);
    this.chart = null;
    this.chartType = "line";
  }

  RollingChart.prototype.mkDatasets = function () {
    const isArea = this.chartType === "area";
    const isBar = this.chartType === "bar";
    return this.tmpl.map((t, i) => {
      const base = {
        label: t.label,
        data: this.series[i].slice(),
        borderColor: t.color,
        borderWidth: isBar ? 1 : 1.5,
      };
      if (isBar) {
        base.backgroundColor = t.color;
        base.borderRadius = 3;
      } else {
        base.tension = 0.25;
        base.pointRadius = 0;
        base.fill = isArea || !!t.fill;
        base.backgroundColor = isArea
          ? (t.colorDim || t.color)
          : (t.fill || "transparent");
      }
      return base;
    });
  };

  RollingChart.prototype.rebuild = function () {
    if (this.chart) { this.chart.destroy(); this.chart = null; }
    if (!this.labels.length) {
      this.labels.push(timeLabel(Date.now()));
      this.series.forEach(s => s.push(0));
    }
    const isBar = this.chartType === "bar";
    this.chart = new Chart(this.canvas.getContext("2d"), {
      type: isBar ? "bar" : "line",
      data: { labels: this.labels.slice(), datasets: this.mkDatasets() },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReduceMotion ? false : { duration: isBar ? 200 : 0 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#c9d1d9", boxWidth: 8, font: { size: 9 } } },
          tooltip: { callbacks: this.ttCb },
        },
        scales: baseScales(this.yTitle),
      },
    });
  };

  RollingChart.prototype.setType = function (t) {
    if (!["line","area","bar"].includes(t)) return;
    this.chartType = t;
    this.rebuild();
  };

  RollingChart.prototype.pushRow = function (t, values) {
    this.labels.push(timeLabel(t));
    for (let i = 0; i < values.length; i++) {
      if (this.series[i]) this.series[i].push(values[i]);
    }
    while (this.labels.length > MAX_POINTS) {
      this.labels.shift();
      this.series.forEach(s => s.shift());
    }
    if (!this.chart) this.rebuild();
    this.chart.data.labels = this.labels.slice();
    for (let i = 0; i < values.length; i++) {
      if (this.chart.data.datasets[i]) this.chart.data.datasets[i].data = this.series[i].slice();
    }
    this.chart.update("none");
  };

  /* ── CoreChart class ── */
  function CoreChart(canvas) {
    this.canvas = canvas;
    this.chart = null;
    this.types = ["area", "line", "bar", "radar"];
    this.chartType = "area";
    this.timeLabs = [];
    this.perCore = [];
    this.n = 0;
  }

  CoreChart.prototype.ensureBuckets = function (n) {
    if (n === this.n && this.perCore.length === n) return;
    this.n = n;
    this.perCore = [];
    for (let i = 0; i < n; i++) this.perCore.push([]);
    this.timeLabs = [];
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  };

  CoreChart.prototype.setType = function (t) {
    if (!this.types.includes(t)) return;
    this.chartType = t;
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  };

  CoreChart.prototype.update = function (tWall, cpus) {
    if (!cpus || !cpus.length) return;
    this.ensureBuckets(cpus.length);
    const n = cpus.length;
    const mode = this.chartType;

    if (mode === "bar") {
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(this.canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: cpus.map((_, i) => "C" + i),
          datasets: [{ label: "CPU %", data: cpus.slice(), backgroundColor: cpus.map((_, i) => coreColor(i, n)), borderColor: "#161b22", borderWidth: 1, borderRadius: 3 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, indexAxis: "y",
          animation: prefersReduceMotion ? false : { duration: 160 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.parsed.x != null ? ctx.parsed.x.toFixed(1) + "%" : "" } } },
          scales: { x: { beginAtZero: true, max: 100, ticks: { color: "#8b949e", callback: v => v + "%" }, grid: { color: "#21262d" } }, y: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } } },
        },
      });
      return;
    }

    if (mode === "radar") {
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(this.canvas.getContext("2d"), {
        type: "radar",
        data: { labels: cpus.map((_, i) => "C" + i), datasets: [{ label: "Now", data: cpus.slice(), backgroundColor: "rgba(88,166,255,.2)", borderColor: "#58a6ff", borderWidth: 1.5, pointBackgroundColor: cpus.map((_, i) => coreColor(i, n)) }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: prefersReduceMotion ? false : { duration: 200 },
          scales: { r: { beginAtZero: true, max: 100, ticks: { color: "#8b949e", backdropColor: "transparent" }, grid: { color: "#30363d" }, pointLabels: { color: "#c9d1d9", font: { size: 8 } } } },
          plugins: { legend: { display: false } },
        },
      });
      return;
    }

    const isArea = mode === "area";
    this.timeLabs.push(timeLabel(tWall));
    for (let i = 0; i < cpus.length; i++) this.perCore[i].push(cpus[i]);
    while (this.perCore[0].length > MAX_POINTS) {
      this.timeLabs.shift();
      this.perCore.forEach(s => s.shift());
    }
    const dsets = this.perCore.map((s, i) => {
      const col = coreColor(i, n);
      return {
        label: "C" + i, data: s.slice(), borderColor: col,
        backgroundColor: isArea ? col.replace("hsl(", "hsla(").replace(")", ",.14)") : "transparent",
        fill: isArea, tension: 0.25, pointRadius: 0, borderWidth: 1.2,
      };
    });
    const needRebuild = !this.chart || this.chart.config.type !== "line" || this.chart.data.datasets.length !== cpus.length;
    if (needRebuild) {
      if (this.chart) this.chart.destroy();
      this.chart = new Chart(this.canvas.getContext("2d"), {
        type: "line",
        data: { labels: this.timeLabs.slice(), datasets: dsets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: n <= 8, labels: { color: "#c9d1d9", boxWidth: 6, font: { size: 8 } } },
            tooltip: { callbacks: { label: ctx => { const v = ctx.parsed.y; return v != null ? ctx.dataset.label + ": " + v.toFixed(1) + "%" : ""; } } },
          },
          scales: baseScales("%"),
        },
      });
    } else {
      this.chart.data.labels = this.timeLabs.slice();
      this.chart.data.datasets.forEach((ds, i) => { ds.data = this.perCore[i].slice(); });
      this.chart.update("none");
    }
  };

  /* ── RootChart class ── */
  function RootChart(canvas) {
    this.canvas = canvas;
    this.chart = null;
    this.builtType = null;
    this.types = ["doughnut", "pie", "polarArea", "bar"];
    this.chartType = "doughnut";
  }

  RootChart.prototype.setType = function (t) {
    if (!this.types.includes(t)) return;
    this.chartType = t; this.builtType = null;
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  };

  RootChart.prototype._col = function (u) { return u > 85 ? "#f85149" : u > 70 ? "#d29922" : "#3fb950"; };

  RootChart.prototype.update = function (usedPct) {
    const u = Math.min(100, Math.max(0, usedPct)), f = 100 - u, col = this._col(u), t = this.chartType;
    if (!this.chart || this.builtType !== t) {
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      let cfg;
      if (t === "bar") {
        cfg = { type: "bar", data: { labels: ["Used", "Free"], datasets: [{ label: "%", data: [u, f], backgroundColor: [col, "#21262d"], borderColor: "#161b22", borderWidth: 1, borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", animation: prefersReduceMotion ? false : { duration: 250 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.label + ": " + ctx.parsed.x.toFixed(1) + "%" } } }, scales: { x: { max: 100, ticks: { color: "#8b949e", callback: v => v + "%" }, grid: { color: "#21262d" } }, y: { ticks: { color: "#8b949e" }, grid: { display: false } } } } };
      } else {
        cfg = { type: t, data: { labels: ["Used", "Free"], datasets: [{ data: [u, f], backgroundColor: [col, "#21262d"], borderColor: "#161b22", borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: prefersReduceMotion ? false : { duration: 300 }, cutout: t === "doughnut" ? "68%" : undefined, plugins: { legend: { position: "bottom", labels: { color: "#c9d1d9", boxWidth: 8, font: { size: 8 } } }, tooltip: { callbacks: { label: ctx => { const v = typeof ctx.raw === "number" ? ctx.raw : ctx.parsed; return ctx.label + ": " + Number(v).toFixed(1) + "%"; } } } } } };
        if (t === "polarArea") cfg.options.scales = { r: { ticks: { color: "#8b949e", backdropColor: "transparent" }, grid: { color: "#30363d" } } };
      }
      this.chart = new Chart(this.canvas.getContext("2d"), cfg);
      this.builtType = t;
      return;
    }
    this.chart.data.datasets[0].data = [u, f];
    if (this.chart.data.datasets[0].backgroundColor) this.chart.data.datasets[0].backgroundColor = [col, "#21262d"];
    this.chart.update("none");
  };

  /* ── Log helpers ── */
  function normLevel(lv) {
    switch (String(lv || "").toLowerCase()) {
      case "high": case "fatal": case "panic": case "critical": case "crit": case "alert": case "emerg": return "high";
      case "error": case "err": return "error";
      case "warn": case "warning": return "warning";
      case "debug": case "trace": return "debug";
      case "good": case "info": case "notice": return "good";
      default: return "";
    }
  }
  function classifyText(line) {
    const u = String(line || "").toUpperCase();
    if (u.includes("FATAL") || u.includes("PANIC") || u.includes("CRITICAL") || u.includes("EMERG")) return "high";
    if (u.includes("ERROR")) return "error";
    if (u.includes("WARN")) return "warning";
    if (u.includes("DEBUG") || u.includes("TRACE")) return "debug";
    return "good";
  }
  function levelLabel(lv) {
    switch (normLevel(lv)) { case "high": return "HIGH"; case "error": return "ERROR"; case "warning": return "WARN"; case "debug": return "DEBUG"; default: return "GOOD"; }
  }

  /* ── DOM refs ── */
  const elStatus = document.getElementById("status-dot");
  const elRootPct = document.getElementById("root-pct");
  const elStripUptime = document.getElementById("val-uptime");
  const elStripNcpu = document.getElementById("val-ncpu");
  const elStripProcs = document.getElementById("val-procs");
  const elStripLoad = document.getElementById("val-loadpct");
  const elLogView = document.getElementById("log-view");
  let elLogEmpty = document.getElementById("log-empty");
  const elLogFilter = document.getElementById("log-filter");

  /* ── Instantiate charts ── */
  const cpuChart = new RollingChart(
    document.getElementById("c-cpu"),
    [{ label: "CPU %", color: "#58a6ff", fill: "rgba(88,166,255,.15)", colorDim: "rgba(88,166,255,.18)" },
     { label: "I/O wait %", color: "#d29922", colorDim: "rgba(210,153,34,.2)" }],
    "%",
    { label: ctx => ctx.parsed.y != null ? ctx.dataset.label + ": " + ctx.parsed.y.toFixed(1) + "%" : "" }
  );

  const memChart = new RollingChart(
    document.getElementById("c-mem"),
    [{ label: "RAM %",    color: "#79c0ff", colorDim: "rgba(121,192,255,.2)" },
     { label: "Swap %",   color: "#ffa657", colorDim: "rgba(255,166,87,.2)" },
     { label: "Cached %", color: "#a371f7", colorDim: "rgba(163,113,247,.2)" },
     { label: "Buf %",    color: "#56d364", colorDim: "rgba(86,211,100,.18)" }],
    "% of RAM"
  );

  const loadChart = new RollingChart(
    document.getElementById("c-load"),
    [{ label: "1m",  color: "#58a6ff", colorDim: "rgba(88,166,255,.2)" },
     { label: "5m",  color: "#a371f7", colorDim: "rgba(163,113,247,.2)" },
     { label: "15m", color: "#3fb950", colorDim: "rgba(63,185,80,.2)" }],
    "Load avg"
  );

  const netChart = new RollingChart(
    document.getElementById("c-net"),
    [{ label: "RX", color: "#3fb950", colorDim: "rgba(63,185,80,.2)" },
     { label: "TX", color: "#a371f7", colorDim: "rgba(163,113,247,.2)" }],
    "B/s",
    { label: ctx => ctx.parsed.y != null ? ctx.dataset.label + ": " + formatRate(ctx.parsed.y) : "" }
  );

  const diskChart = new RollingChart(
    document.getElementById("c-disk"), 
    [{ label: "Read",  color: "#79c0ff", colorDim: "rgba(121,192,255,.2)" },
     { label: "Write", color: "#ffa657", colorDim: "rgba(255,166,87,.2)" }],
    "B/s",
    { label: ctx => ctx.parsed.y != null ? ctx.dataset.label + ": " + formatRate(ctx.parsed.y) : "" }
  );

  const procsChart = new RollingChart(
    document.getElementById("c-procs"),
    [{ label: "Running", color: "#58a6ff", fill: "rgba(88,166,255,.12)", colorDim: "rgba(88,166,255,.2)" }],
    "Tasks"
  );

  const coreChart = new CoreChart(document.getElementById("c-cores"));
  const rootCtl = new RootChart(document.getElementById("c-root"));

  /* ── Wire chart type selectors ── */
  const selMap = {
    "sel-cpu": cpuChart, "sel-mem": memChart, "sel-load": loadChart,
    "sel-net": netChart, "sel-disk": diskChart, "sel-procs": procsChart,
  };
  Object.entries(selMap).forEach(([id, chart]) => {
    const sel = document.getElementById(id);
    if (sel) sel.addEventListener("change", () => chart.setType(sel.value));
  });

  document.getElementById("sel-cores").addEventListener("change", function () {
    coreChart.setType(this.value);
  });
  document.getElementById("sel-root").addEventListener("change", function () {
    rootCtl.setType(this.value);
    if (window.__lastRootPct != null) rootCtl.update(window.__lastRootPct);
  });

  /* ── Log state ── */
  let logFilter = "all";
  const logRows = [];

  function syncLogEmpty() {
    const visible = logRows.filter(r => !r.el.hidden).length;
    if (visible > 0) { if (elLogEmpty) { elLogEmpty.remove(); elLogEmpty = null; } return; }
    if (!elLogEmpty) { elLogEmpty = document.createElement("div"); elLogEmpty.className = "log-empty"; elLogView.appendChild(elLogEmpty); }
    elLogEmpty.textContent = logRows.length === 0 ? "Waiting for log output…" : "No " + levelLabel(logFilter).toLowerCase() + " logs in view.";
  }

  function applyLogFilter() {
    logRows.forEach(r => { r.el.hidden = logFilter !== "all" && r.entry.level !== logFilter; });
    syncLogEmpty();
  }

  function appendLogEntry(data) {
    if (!data) return;
    const message = data.message != null ? String(data.message) : data.raw ? String(data.raw) : "";
    if (!message) return;
    const level = normLevel(data.level || data.severity) || classifyText(message);
    const origin = String(data.origin || (data.source === "lmonitor" ? "app" : "system")).toLowerCase() === "app" ? "app" : "system";
    const entry = {
      t: Number.isFinite(Number(data.t)) && Number(data.t) > 0 ? Number(data.t) : Date.now(),
      level, origin,
      source: data.source ? String(data.source) : origin === "app" ? "lmonitor" : "system",
      message,
    };

    const stickToBottom = elLogView.scrollTop + elLogView.clientHeight >= elLogView.scrollHeight - 20;
    const row = document.createElement("div");
    row.className = "log-line log-" + level;

    const meta = document.createElement("div"); meta.className = "log-meta";
    const time = document.createElement("span"); time.className = "log-time"; time.textContent = timeLabel(entry.t); meta.appendChild(time);
    const lp = document.createElement("span"); lp.className = "log-pill log-level"; lp.textContent = levelLabel(level); meta.appendChild(lp);
    const op = document.createElement("span"); op.className = "log-pill " + (entry.origin === "app" ? "log-origin-app" : "log-origin-system"); op.textContent = entry.origin === "app" ? "APP" : "SYS"; meta.appendChild(op);
    const sp = document.createElement("span"); sp.className = "log-pill log-source"; sp.textContent = entry.source; meta.appendChild(sp);
    const msg = document.createElement("div"); msg.className = "log-message"; msg.textContent = message;

    row.appendChild(meta); row.appendChild(msg); elLogView.appendChild(row);
    logRows.push({ el: row, entry });
    while (logRows.length > 300) { const old = logRows.shift(); if (old && old.el) old.el.remove(); }
    row.hidden = logFilter !== "all" && entry.level !== logFilter;
    syncLogEmpty();
    if (stickToBottom) elLogView.scrollTop = elLogView.scrollHeight;
  }

  function resetLogs() { logRows.length = 0; elLogView.innerHTML = ""; syncLogEmpty(); }

  elLogFilter && elLogFilter.addEventListener("change", () => { logFilter = elLogFilter.value || "all"; applyLogFilter(); });
  document.getElementById("log-clear") && document.getElementById("log-clear").addEventListener("click", resetLogs);

  /* ── Sample handler ── */
  let lastMsg = null;
  let peakNetRx = 1, peakNetTx = 1, peakDskRd = 1, peakDskWr = 1;

  function onSample(msg) {
    lastMsg = msg;
    peakNetRx = Math.max(peakNetRx, msg.netRx || 0, 1);
    peakNetTx = Math.max(peakNetTx, msg.netTx || 0, 1);
    peakDskRd = Math.max(peakDskRd, msg.dskRd || 0, 1);
    peakDskWr = Math.max(peakDskWr, msg.dskWr || 0, 1);

    const t = msg.t;

    // Topbar strip
    elStripUptime.textContent = formatUptime(msg.uptime || 0);
    elStripNcpu.textContent = String(msg.ncpu != null ? msg.ncpu : "—");
    elStripProcs.textContent = (msg.procsRun != null ? msg.procsRun : "—") + " / " + (msg.procsTotal != null ? msg.procsTotal : "—");
    elStripLoad.textContent = (msg.load1Pct != null ? msg.load1Pct.toFixed(0) : "—") + "% vs CPUs";

    // Charts
    cpuChart.pushRow(t, [msg.cpu, msg.ioWait != null ? msg.ioWait : 0]);
    memChart.pushRow(t, [msg.ram, msg.swap, msg.cachedPct || 0, msg.buffersPct || 0]);
    loadChart.pushRow(t, [msg.load1, msg.load5, msg.load15]);
    netChart.pushRow(t, [msg.netRx, msg.netTx]);
    diskChart.pushRow(t, [msg.dskRd, msg.dskWr]);
    procsChart.pushRow(t, [msg.procsRun != null ? msg.procsRun : 0]);
    if (msg.cpus && msg.cpus.length) coreChart.update(t, msg.cpus);

    window.__lastRootPct = msg.rootPct;
    rootCtl.update(msg.rootPct);
    elRootPct.innerHTML = msg.rootPct.toFixed(1) + "%<small>of root filesystem</small>";

    // Panel subtitles
    document.getElementById("sub-cpu").textContent =
      "CPU " + msg.cpu.toFixed(1) + "% · I/O wait " + (msg.ioWait || 0).toFixed(1) + "%";
    document.getElementById("sub-mem").textContent =
      "RAM " + msg.ram.toFixed(1) + "% · Swap " + msg.swap.toFixed(1) + "% · Cache " + (msg.cachedPct || 0).toFixed(1) + "%";
    document.getElementById("sub-load").textContent =
      "1m " + msg.load1.toFixed(2) + " · 5m " + msg.load5.toFixed(2) + " · 15m " + msg.load15.toFixed(2);
    const prx = peakNetRx > 0 ? (100 * msg.netRx) / peakNetRx : 0;
    const ptx = peakNetTx > 0 ? (100 * msg.netTx) / peakNetTx : 0;
    document.getElementById("sub-net").textContent =
      formatRate(msg.netRx) + " RX · " + formatRate(msg.netTx) + " TX · " + prx.toFixed(0) + "% / " + ptx.toFixed(0) + "% of peak";
    const pr = peakDskRd > 0 ? (100 * msg.dskRd) / peakDskRd : 0;
    const pw = peakDskWr > 0 ? (100 * msg.dskWr) / peakDskWr : 0;
    document.getElementById("sub-disk").textContent =
      formatRate(msg.dskRd) + " R · " + formatRate(msg.dskWr) + " W · " + pr.toFixed(0) + "% / " + pw.toFixed(0) + "% of peak";
    if (msg.cpus && msg.cpus.length) {
      const avg = msg.cpus.reduce((a, b) => a + b, 0) / msg.cpus.length;
      document.getElementById("sub-cores").textContent =
        msg.cpus.length + " cores · avg " + avg.toFixed(1) + "% · max " + Math.max(...msg.cpus).toFixed(1) + "%";
    }
    document.getElementById("sub-procs").textContent =
      (msg.procsRun || 0) + " runnable of " + (msg.procsTotal || 0) + " tasks";
    document.getElementById("sub-root").textContent =
      msg.rootPct.toFixed(1) + "% of root filesystem used";
  }

  /* ── WebSocket connections ── */
  let wsMetrics = null, wsLogs = null;
  let backoffMetrics = 1000, backoffLogs = 1000;
  let host = "localhost", port = 43000;

  function setLive(live) {
    elStatus.classList.toggle("live", live);
    elStatus.title = live ? "Connected" : "Disconnected";
  }

  function connectMetrics() {
    if (wsMetrics) { try { wsMetrics.close(); } catch (_) {} }
    const url = "ws://" + host + ":" + port + "/ws";
    wsMetrics = new WebSocket(url);
    wsMetrics.onopen = () => { setLive(true); backoffMetrics = 1000; };
    wsMetrics.onclose = () => {
      setLive(false);
      setTimeout(connectMetrics, backoffMetrics);
      backoffMetrics = Math.min(30000, Math.floor(backoffMetrics * 1.5));
    };
    wsMetrics.onerror = () => wsMetrics.close();
    wsMetrics.onmessage = ev => { try { onSample(JSON.parse(ev.data)); } catch (_) {} };
  }

  function connectLogs() {
    if (wsLogs) { try { wsLogs.close(); } catch (_) {} }
    const url = "ws://" + host + ":" + port + "/logs";
    wsLogs = new WebSocket(url);
    wsLogs.onopen = () => { resetLogs(); backoffLogs = 1000; };
    wsLogs.onclose = () => {
      setTimeout(connectLogs, backoffLogs);
      backoffLogs = Math.min(30000, Math.floor(backoffLogs * 1.5));
    };
    wsLogs.onerror = () => wsLogs.close();
    wsLogs.onmessage = ev => {
      try { appendLogEntry(JSON.parse(ev.data)); }
      catch (_) { appendLogEntry({ message: String(ev.data), origin: "app", source: "lmonitor" }); }
    };
  }

  function reconnect() {
    backoffMetrics = 1000; backoffLogs = 1000;
    connectMetrics();
    connectLogs();
  }

  /* ── Titlebar buttons ── */
  document.getElementById("btn-close").addEventListener("click", () => {
    window.lmWidget && window.lmWidget.closeWindow();
  });
  document.getElementById("btn-minimize").addEventListener("click", () => {
    window.lmWidget && window.lmWidget.minimizeWindow();
  });

  /* ── Settings overlay ── */
  const overlay = document.getElementById("settings-overlay");
  const sHost = document.getElementById("s-host");
  const sPort = document.getElementById("s-port");
  const sOpacity = document.getElementById("s-opacity");
  const sOpacityVal = document.getElementById("s-opacity-val");
  const sAot = document.getElementById("s-aot");

  document.getElementById("btn-settings").addEventListener("click", async () => {
    if (overlay.classList.contains("open")) { overlay.classList.remove("open"); return; }
    if (window.lmWidget) {
      const prefs = await window.lmWidget.getPrefs();
      sHost.value = prefs.host || "localhost";
      sPort.value = prefs.port || 43000;
      sOpacity.value = prefs.opacity != null ? prefs.opacity : 0.92;
      sOpacityVal.textContent = Number(sOpacity.value).toFixed(2);
      sAot.checked = prefs.alwaysOnTop !== false;
      host = prefs.host || "localhost";
      port = prefs.port || 43000;
      applyOpacity(prefs.opacity);
    }
    overlay.classList.add("open");
  });

  sOpacity.addEventListener("input", () => {
    sOpacityVal.textContent = Number(sOpacity.value).toFixed(2);
    applyOpacity(Number(sOpacity.value));
  });

  function applyOpacity(val) {
    const v = Number(val) || 0.92;
    document.getElementById("shell").style.background = "rgba(13,17,23," + v + ")";
  }

  document.getElementById("s-cancel").addEventListener("click", () => {
    overlay.classList.remove("open");
  });

  document.getElementById("s-save").addEventListener("click", () => {
    const newHost = sHost.value.trim() || "localhost";
    const newPort = parseInt(sPort.value) || 43000;
    const newOpacity = Number(sOpacity.value) || 0.92;
    const newAot = sAot.checked;

    host = newHost; port = newPort;
    applyOpacity(newOpacity);

    if (window.lmWidget) {
      window.lmWidget.setPrefs({ host: newHost, port: newPort, opacity: newOpacity, alwaysOnTop: newAot });
    }
    overlay.classList.remove("open");
    reconnect();
  });

  /* ── Init ── */
  async function init() {
    if (window.lmWidget) {
      const prefs = await window.lmWidget.getPrefs();
      host = prefs.host || "localhost";
      port = prefs.port || 43000;
      applyOpacity(prefs.opacity);
    }
    reconnect();
  }

  init();
})();
