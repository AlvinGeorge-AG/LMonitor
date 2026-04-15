/* global Chart */

(function () {
  "use strict";

  const MAX_POINTS = 90;
  const LS = "lmonitor.";

  const prefersReduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function getPref(key, def) {
    try {
      const v = localStorage.getItem(LS + key);
      return v == null || v === "" ? def : v;
    } catch (_) {
      return def;
    }
  }
  function setPref(key, val) {
    try {
      localStorage.setItem(LS + key, val);
    } catch (_) { }
  }

  Chart.defaults.color = "#8b949e";
  Chart.defaults.borderColor = "#30363d";
  Chart.defaults.font.family =
    'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif';

  function formatRate(bps) {
    if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " GB/s";
    if (bps >= 1e6) return (bps / 1e6).toFixed(2) + " MB/s";
    if (bps >= 1e3) return (bps / 1e3).toFixed(1) + " KB/s";
    return bps.toFixed(0) + " B/s";
  }

  function formatUptime(sec) {
    const s = Math.floor(sec);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function timeLabel(t) {
    const d = new Date(t);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function coreColor(i, n) {
    const step = 360 / Math.max(n, 1);
    const h = Math.round((i * step) % 360);
    return "hsl(" + h + ", 62%, 52%)";
  }

  function baseScales(yTitle) {
    return {
      x: {
        ticks: { color: "#8b949e", maxTicksLimit: 6, maxRotation: 0 },
        grid: { color: "#21262d" },
      },
      y: {
        beginAtZero: true,
        title: yTitle
          ? { display: true, text: yTitle, color: "#6e7681", font: { size: 10 } }
          : undefined,
        ticks: { color: "#8b949e" },
        grid: { color: "#21262d" },
      },
    };
  }

  function RollingChart(canvas, panelKey, template, yTitle, tooltipCb, types) {
    this.canvas = canvas;
    this.panelKey = panelKey;
    this.template = template;
    this.yTitle = yTitle;
    this.tooltipCb = tooltipCb || {};
    this.types = types || ["line", "area", "bar"];
    this.labels = [];
    this.series = template.map(function () {
      return [];
    });
    this.chart = null;
    this.chartType = getPref("chart." + panelKey, "line");
    if (this.types.indexOf(this.chartType) < 0) this.chartType = this.types[0];
  }

  RollingChart.prototype.mkDatasets = function () {
    const self = this;
    const isArea = this.chartType === "area";
    const isBar = this.chartType === "bar";
    return this.template.map(function (t, i) {
      const base = {
        label: t.label,
        data: self.series[i].slice(),
        borderColor: t.color,
        borderWidth: isBar ? 1 : 1.5,
      };
      if (isBar) {
        base.backgroundColor = t.color;
        base.borderRadius = 4;
      } else {
        base.tension = 0.25;
        base.pointRadius = 0;
        base.fill = isArea || !!t.fill;
        base.backgroundColor = isArea
          ? t.colorDim || t.color.replace("hsl(", "hsla(").replace(")", ", 0.2)")
          : t.fill || "transparent";
      }
      return base;
    });
  };

  RollingChart.prototype.buildConfig = function () {
    const isBar = this.chartType === "bar";
    const type = isBar ? "bar" : "line";
    const cfg = {
      type: type,
      data: { labels: this.labels.slice(), datasets: this.mkDatasets() },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReduceMotion ? false : { duration: isBar ? 280 : 0 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#c9d1d9", boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: this.tooltipCb },
        },
        scales: baseScales(this.yTitle),
      },
    };
    if (isBar) cfg.options.scales.x.ticks.maxRotation = 40;
    return cfg;
  };

  RollingChart.prototype.rebuild = function () {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    if (this.labels.length === 0) {
      const t = Date.now();
      this.labels.push(timeLabel(t));
      for (let i = 0; i < this.series.length; i++) this.series[i].push(0);
    }
    this.chart = new Chart(this.canvas.getContext("2d"), this.buildConfig());
  };

  RollingChart.prototype.setType = function (t) {
    if (this.types.indexOf(t) < 0) return;
    this.chartType = t;
    setPref("chart." + this.panelKey, t);
    this.rebuild();
  };

  RollingChart.prototype.pushRow = function (t, values) {
    this.labels.push(timeLabel(t));
    for (let i = 0; i < values.length; i++) {
      if (this.series[i]) this.series[i].push(values[i]);
    }
    while (this.labels.length > MAX_POINTS) {
      this.labels.shift();
      for (let j = 0; j < this.series.length; j++) this.series[j].shift();
    }
    if (!this.chart) this.rebuild();
    this.chart.data.labels = this.labels.slice();
    for (let i = 0; i < values.length; i++) {
      if (this.chart.data.datasets[i]) {
        this.chart.data.datasets[i].data = this.series[i].slice();
      }
    }
    this.chart.update("none");
  };

  function CoreChart(canvas, panelKey) {
    this.canvas = canvas;
    this.panelKey = panelKey;
    this.chart = null;
    this.types = ["line", "area", "bar", "radar"];
    this.chartType = getPref("chart." + panelKey, "bar");
    if (this.types.indexOf(this.chartType) < 0) this.chartType = "bar";
    this.timeLabs = [];
    this.perCore = [];
    this.n = 0;
  }

  CoreChart.prototype.labelsForCores = function (n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push("C" + i);
    return a;
  };

  CoreChart.prototype.ensureBuckets = function (n) {
    if (n === this.n && this.perCore.length === n) return;
    this.n = n;
    this.perCore = [];
    for (let i = 0; i < n; i++) this.perCore.push([]);
    this.timeLabs = [];
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  };

  CoreChart.prototype.setType = function (t) {
    if (this.types.indexOf(t) < 0) return;
    this.chartType = t;
    setPref("chart." + this.panelKey, t);
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  };

  CoreChart.prototype.drawBar = function (cpus) {
    const n = cpus.length;
    const labs = this.labelsForCores(n);
    const cfg = {
      type: "bar",
      data: {
        labels: labs,
        datasets: [
          {
            label: "CPU %",
            data: cpus.slice(),
            backgroundColor: cpus.map(function (_, i) {
              return coreColor(i, n);
            }),
            borderColor: "#161b22",
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        animation: prefersReduceMotion ? false : { duration: 220 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const v = ctx.parsed.x;
                return v != null ? v.toFixed(1) + "%" : "";
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: { color: "#8b949e", callback: function (v) { return v + "%"; } },
            grid: { color: "#21262d" },
          },
          y: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        },
      },
    };
    if (this.chart) this.chart.destroy();
    this.chart = new Chart(this.canvas.getContext("2d"), cfg);
  };

  CoreChart.prototype.drawRadar = function (cpus) {
    const n = cpus.length;
    const labs = this.labelsForCores(n);
    const cfg = {
      type: "radar",
      data: {
        labels: labs,
        datasets: [
          {
            label: "Now",
            data: cpus.slice(),
            backgroundColor: "rgba(88, 166, 255, 0.22)",
            borderColor: "#58a6ff",
            borderWidth: 2,
            pointBackgroundColor: cpus.map(function (_, i) {
              return coreColor(i, n);
            }),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReduceMotion ? false : { duration: 280 },
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { color: "#8b949e", backdropColor: "transparent" },
            grid: { color: "#30363d" },
            pointLabels: { color: "#c9d1d9", font: { size: 10 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.chart.data.labels[ctx.dataIndex] + ": " + ctx.raw.toFixed(1) + "%";
              },
            },
          },
        },
      },
    };
    if (this.chart) this.chart.destroy();
    this.chart = new Chart(this.canvas.getContext("2d"), cfg);
  };

  CoreChart.prototype.drawLineArea = function (isArea) {
    const n = this.n;
    const dsets = [];
    for (let i = 0; i < n; i++) {
      const col = coreColor(i, n);
      dsets.push({
        label: "C" + i,
        data: this.perCore[i].slice(),
        borderColor: col,
        backgroundColor: isArea ? col.replace("hsl(", "hsla(").replace(")", ", 0.14)") : "transparent",
        fill: isArea,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 1.2,
      });
    }
    const cfg = {
      type: "line",
      data: { labels: this.timeLabs.slice(), datasets: dsets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: n <= 16,
            labels: { color: "#c9d1d9", boxWidth: 8, font: { size: 9 } },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const v = ctx.parsed.y;
                return v != null ? ctx.dataset.label + ": " + v.toFixed(1) + "%" : "";
              },
            },
          },
        },
        scales: baseScales("%"),
      },
    };
    if (this.chart) this.chart.destroy();
    this.chart = new Chart(this.canvas.getContext("2d"), cfg);
  };

  CoreChart.prototype.update = function (tWall, cpus) {
    if (!cpus || !cpus.length) return;
    this.ensureBuckets(cpus.length);
    const mode = this.chartType;
    if (mode === "bar") {
      this.drawBar(cpus);
      return;
    }
    if (mode === "radar") {
      this.drawRadar(cpus);
      return;
    }
    const lab = timeLabel(tWall);
    this.timeLabs.push(lab);
    for (let i = 0; i < cpus.length; i++) {
      this.perCore[i].push(cpus[i]);
    }
    while (this.perCore[0].length > MAX_POINTS) {
      this.timeLabs.shift();
      for (let j = 0; j < cpus.length; j++) {
        this.perCore[j].shift();
      }
    }
    const needRebuild =
      !this.chart ||
      this.chart.config.type !== "line" ||
      this.chart.data.datasets.length !== cpus.length;
    if (needRebuild) {
      this.drawLineArea(mode === "area");
    } else {
      this.chart.data.labels = this.timeLabs.slice();
      for (let i = 0; i < cpus.length; i++) {
        this.chart.data.datasets[i].data = this.perCore[i].slice();
      }
      this.chart.update("none");
    }
  };

  function RootChart(canvas, panelKey) {
    this.canvas = canvas;
    this.panelKey = panelKey;
    this.chart = null;
    this.builtType = null;
    this.types = ["doughnut", "pie", "polarArea", "bar"];
    this.chartType = getPref("chart." + panelKey, "doughnut");
    if (this.types.indexOf(this.chartType) < 0) this.chartType = "doughnut";
  }

  RootChart.prototype.setType = function (t) {
    if (this.types.indexOf(t) < 0) return;
    this.chartType = t;
    setPref("chart." + this.panelKey, t);
    this.builtType = null;
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  };

  RootChart.prototype._diskColor = function (u) {
    return u > 85 ? "#f85149" : u > 70 ? "#d29922" : "#3fb950";
  };

  RootChart.prototype._buildRoot = function (t, u, f, col) {
    if (t === "bar") {
      return {
        type: "bar",
        data: {
          labels: ["Used", "Free"],
          datasets: [
            {
              label: "%",
              data: [u, f],
              backgroundColor: [col, "#21262d"],
              borderColor: "#161b22",
              borderWidth: 1,
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: "y",
          animation: prefersReduceMotion ? false : { duration: 300 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ctx.label + ": " + ctx.parsed.x.toFixed(1) + "%";
                },
              },
            },
          },
          scales: {
            x: {
              max: 100,
              ticks: { color: "#8b949e", callback: function (v) { return v + "%"; } },
              grid: { color: "#21262d" },
            },
            y: { ticks: { color: "#8b949e" }, grid: { display: false } },
          },
        },
      };
    }
    const cfg = {
      type: t,
      data: {
        labels: ["Used", "Free"],
        datasets: [
          {
            data: [u, f],
            backgroundColor: [col, "#21262d"],
            borderColor: "#161b22",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReduceMotion ? false : { duration: 350 },
        cutout: t === "doughnut" ? "68%" : undefined,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#c9d1d9", boxWidth: 10, font: { size: 10 } },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const v = typeof ctx.raw === "number" ? ctx.raw : ctx.parsed;
                return ctx.label + ": " + Number(v).toFixed(1) + "%";
              },
            },
          },
        },
      },
    };
    if (t === "polarArea") {
      cfg.options.scales = {
        r: {
          ticks: { color: "#8b949e", backdropColor: "transparent" },
          grid: { color: "#30363d" },
        },
      };
    }
    return cfg;
  };

  RootChart.prototype.update = function (usedPct) {
    const u = Math.min(100, Math.max(0, usedPct));
    const f = 100 - u;
    const col = this._diskColor(u);
    const t = this.chartType;
    const needBuild = !this.chart || this.builtType !== t;
    if (needBuild) {
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
      const cfg = this._buildRoot(t, u, f, col);
      this.chart = new Chart(this.canvas.getContext("2d"), cfg);
      this.builtType = t;
      return;
    }
    this.chart.data.datasets[0].data = [u, f];
    if (this.chart.data.datasets[0].backgroundColor) {
      this.chart.data.datasets[0].backgroundColor = [col, "#21262d"];
    }
    this.chart.update("none");
  };

  function fillSelect(sel, defs) {
    sel.innerHTML = "";
    for (let i = 0; i < defs.length; i++) {
      const o = document.createElement("option");
      o.value = defs[i].v;
      o.textContent = defs[i].t;
      sel.appendChild(o);
    }
  }

  const TIME_TYPES = [
    { v: "line", t: "Line" },
    { v: "area", t: "Area" },
    { v: "bar", t: "Bar" },
  ];
  const CORE_TYPES = [
    { v: "bar", t: "Bar (now)" },
    { v: "line", t: "Line" },
    { v: "area", t: "Area" },
    { v: "radar", t: "Radar" },
  ];
  const ROOT_TYPES = [
    { v: "doughnut", t: "Doughnut" },
    { v: "pie", t: "Pie" },
    { v: "polarArea", t: "Polar" },
    { v: "bar", t: "Bar" },
  ];

  function scheduleChartResize() {
    if (window.__lmRszT) clearTimeout(window.__lmRszT);
    window.__lmRszT = setTimeout(function () {
      window.dispatchEvent(new Event("resize"));
    }, 50);
  }

  function normalizeLogLevel(level) {
    switch (String(level || "").toLowerCase()) {
      case "high":
      case "fatal":
      case "panic":
      case "critical":
      case "crit":
      case "alert":
      case "emerg":
      case "emergency":
        return "high";
      case "error":
      case "err":
        return "error";
      case "warn":
      case "warning":
        return "warning";
      case "debug":
      case "trace":
        return "debug";
      case "good":
      case "info":
      case "notice":
        return "good";
      default:
        return "";
    }
  }

  function classifyLogTextLevel(line) {
    const upper = String(line || "").toUpperCase();
    if (
      upper.indexOf("FATAL") >= 0 ||
      upper.indexOf("PANIC") >= 0 ||
      upper.indexOf("CRITICAL") >= 0 ||
      upper.indexOf("EMERG") >= 0
    ) {
      return "high";
    }
    if (upper.indexOf("ERROR") >= 0) return "error";
    if (upper.indexOf("WARN") >= 0) return "warning";
    if (upper.indexOf("DEBUG") >= 0 || upper.indexOf("TRACE") >= 0) return "debug";
    return "good";
  }

  function logLevelLabel(level) {
    switch (normalizeLogLevel(level)) {
      case "high":
        return "HIGH";
      case "error":
        return "ERROR";
      case "warning":
        return "WARN";
      case "debug":
        return "DEBUG";
      default:
        return "GOOD";
    }
  }

  function wireSelect(panel, sel, chart, defs) {
    fillSelect(sel, defs);
    sel.value = chart.chartType;
    sel.addEventListener("change", function () {
      chart.setType(sel.value);
      if (panel === "root" && window.__lastRootPct != null) {
        rootCtl.update(window.__lastRootPct);
      }
      scheduleChartResize();
    });
  }

  function wirePctToggle(panel, chk, bigEl, lineEl, fnLine, fnBig) {
    const k = "pctbig." + panel;
    chk.checked = getPref(k, "0") === "1";
    function apply() {
      const on = chk.checked;
      setPref(k, on ? "1" : "0");
      bigEl.hidden = !on;
      bigEl.innerHTML = fnBig();
      if (lineEl) lineEl.textContent = fnLine();
      scheduleChartResize();
    }
    chk.addEventListener("change", apply);
    return apply;
  }

  let peakNetRx = 1;
  let peakNetTx = 1;
  let peakDskRd = 1;
  let peakDskWr = 1;
  let lastMsg = null;
  let rootCtl;
  let logWsBackoff = 1000;
  const logWsMaxBackoff = 30000;
  const logRows = [];
  let logFilter = "all";

  const elStripUptime = document.getElementById("val-uptime");
  const elStripNcpu = document.getElementById("val-ncpu");
  const elStripProcs = document.getElementById("val-procs");
  const elStripLoad = document.getElementById("val-loadpct");
  const elStatus = document.getElementById("status");
  const elRootPct = document.getElementById("root-pct");
  const elLogView = document.getElementById("log-view");
  let elLogEmpty = document.getElementById("log-empty");
  const elLogFilter = document.getElementById("log-filter");
  const elLogClear = document.getElementById("log-clear");

  const cpuChart = new RollingChart(
    document.getElementById("c-cpu"),
    "cpu",
    [
      {
        label: "CPU %",
        color: "#58a6ff",
        fill: "rgba(88, 166, 255, 0.15)",
        colorDim: "rgba(88, 166, 255, 0.18)",
      },
      { label: "I/O wait %", color: "#d29922", colorDim: "rgba(210, 153, 34, 0.2)" },
    ],
    "%",
    {
      label: function (ctx) {
        const v = ctx.parsed.y;
        return v != null ? ctx.dataset.label + ": " + v.toFixed(1) + "%" : "";
      },
    }
  );

  const memChart = new RollingChart(
    document.getElementById("c-mem"),
    "mem",
    [
      { label: "RAM used %", color: "#79c0ff", colorDim: "rgba(121, 192, 255, 0.2)" },
      { label: "Swap used %", color: "#ffa657", colorDim: "rgba(255, 166, 87, 0.2)" },
      { label: "Cached %", color: "#a371f7", colorDim: "rgba(163, 113, 247, 0.2)" },
      { label: "Buffers %", color: "#56d364", colorDim: "rgba(86, 211, 100, 0.18)" },
    ],
    "% of RAM"
  );

  const loadChart = new RollingChart(
    document.getElementById("c-load"),
    "load",
    [
      { label: "1 min", color: "#58a6ff", colorDim: "rgba(88, 166, 255, 0.2)" },
      { label: "5 min", color: "#a371f7", colorDim: "rgba(163, 113, 247, 0.2)" },
      { label: "15 min", color: "#3fb950", colorDim: "rgba(63, 185, 80, 0.2)" },
    ],
    "Load avg"
  );

  const netChart = new RollingChart(
    document.getElementById("c-net"),
    "net",
    [
      { label: "RX", color: "#3fb950" },
      { label: "TX", color: "#a371f7" },
    ],
    "B/s",
    {
      label: function (ctx) {
        const v = ctx.parsed.y;
        return v != null ? ctx.dataset.label + ": " + formatRate(v) : "";
      },
    }
  );

  const diskChart = new RollingChart(
    document.getElementById("c-disk"),
    "disk",
    [
      { label: "Read", color: "#79c0ff" },
      { label: "Write", color: "#ffa657" },
    ],
    "B/s",
    {
      label: function (ctx) {
        const v = ctx.parsed.y;
        return v != null ? ctx.dataset.label + ": " + formatRate(v) : "";
      },
    }
  );

  const procsChart = new RollingChart(
    document.getElementById("c-procs"),
    "procs",
    [
      {
        label: "Running",
        color: "#58a6ff",
        fill: "rgba(88, 166, 255, 0.12)",
        colorDim: "rgba(88, 166, 255, 0.2)",
      },
    ],
    "Tasks"
  );

  const coreChart = new CoreChart(document.getElementById("c-cores"), "cores");
  rootCtl = new RootChart(document.getElementById("c-root"), "root");

  document.querySelectorAll("select.chart-type").forEach(function (sel) {
    const panel = sel.getAttribute("data-panel");
    if (panel === "cpu") wireSelect(panel, sel, cpuChart, TIME_TYPES);
    else if (panel === "mem") wireSelect(panel, sel, memChart, TIME_TYPES);
    else if (panel === "load") wireSelect(panel, sel, loadChart, TIME_TYPES);
    else if (panel === "net") wireSelect(panel, sel, netChart, TIME_TYPES);
    else if (panel === "disk") wireSelect(panel, sel, diskChart, TIME_TYPES);
    else if (panel === "procs") wireSelect(panel, sel, procsChart, TIME_TYPES);
    else if (panel === "cores") wireSelect(panel, sel, coreChart, CORE_TYPES);
    else if (panel === "root") wireSelect(panel, sel, rootCtl, ROOT_TYPES);
  });

  const refreshCpuPct = wirePctToggle(
    "cpu",
    document.querySelector('.opt-pct[data-panel="cpu"]'),
    document.getElementById("pct-cpu-big"),
    document.getElementById("pct-cpu-line"),
    function () {
      if (!lastMsg) return "";
      return (
        "CPU " +
        lastMsg.cpu.toFixed(1) +
        "% · I/O wait " +
        (lastMsg.ioWait != null ? lastMsg.ioWait : 0).toFixed(1) +
        "%"
      );
    },
    function () {
      if (!lastMsg) return "";
      return (
        "<strong>" +
        lastMsg.cpu.toFixed(1) +
        "%</strong> CPU<small>I/O wait " +
        (lastMsg.ioWait != null ? lastMsg.ioWait : 0).toFixed(1) +
        "%</small>"
      );
    }
  );

  const refreshMemPct = wirePctToggle(
    "mem",
    document.querySelector('.opt-pct[data-panel="mem"]'),
    document.getElementById("pct-mem-big"),
    document.getElementById("pct-mem-line"),
    function () {
      if (!lastMsg) return "";
      return (
        "RAM " +
        lastMsg.ram.toFixed(1) +
        "% · Swap " +
        lastMsg.swap.toFixed(1) +
        "% · Cache " +
        lastMsg.cachedPct.toFixed(1) +
        "% · Buf " +
        lastMsg.buffersPct.toFixed(1) +
        "%"
      );
    },
    function () {
      if (!lastMsg) return "";
      return (
        "<strong>" +
        lastMsg.ram.toFixed(1) +
        "%</strong> RAM<small>swap " +
        lastMsg.swap.toFixed(1) +
        "% · cache " +
        lastMsg.cachedPct.toFixed(1) +
        "%</small>"
      );
    }
  );

  const refreshLoadPct = wirePctToggle(
    "load",
    document.querySelector('.opt-pct[data-panel="load"]'),
    document.getElementById("pct-load-big"),
    document.getElementById("pct-load-line"),
    function () {
      if (!lastMsg) return "";
      return (
        "1m " +
        lastMsg.load1.toFixed(2) +
        " · 5m " +
        lastMsg.load5.toFixed(2) +
        " · 15m " +
        lastMsg.load15.toFixed(2) +
        " · " +
        lastMsg.load1Pct.toFixed(0) +
        "% of CPUs"
      );
    },
    function () {
      if (!lastMsg) return "";
      return (
        "<strong>" +
        lastMsg.load1Pct.toFixed(0) +
        "%</strong> load vs CPUs<small>1m " +
        lastMsg.load1.toFixed(2) +
        "</small>"
      );
    }
  );

  const refreshNetPct = wirePctToggle(
    "net",
    document.querySelector('.opt-pct[data-panel="net"]'),
    document.getElementById("pct-net-big"),
    document.getElementById("pct-net-line"),
    function () {
      if (!lastMsg) return "";
      const prx = peakNetRx > 0 ? (100 * lastMsg.netRx) / peakNetRx : 0;
      const ptx = peakNetTx > 0 ? (100 * lastMsg.netTx) / peakNetTx : 0;
      return (
        formatRate(lastMsg.netRx) +
        " RX · " +
        formatRate(lastMsg.netTx) +
        " TX · " +
        prx.toFixed(0) +
        "% / " +
        ptx.toFixed(0) +
        "% of session peak"
      );
    },
    function () {
      if (!lastMsg) return "";
      const prx = peakNetRx > 0 ? (100 * lastMsg.netRx) / peakNetRx : 0;
      const ptx = peakNetTx > 0 ? (100 * lastMsg.netTx) / peakNetTx : 0;
      return (
        "<strong>" +
        prx.toFixed(0) +
        "%</strong> RX of peak<small>TX " +
        ptx.toFixed(0) +
        "% of peak · " +
        formatRate(lastMsg.netRx) +
        "</small>"
      );
    }
  );

  const refreshDiskPct = wirePctToggle(
    "disk",
    document.querySelector('.opt-pct[data-panel="disk"]'),
    document.getElementById("pct-disk-big"),
    document.getElementById("pct-disk-line"),
    function () {
      if (!lastMsg) return "";
      const pr = peakDskRd > 0 ? (100 * lastMsg.dskRd) / peakDskRd : 0;
      const pw = peakDskWr > 0 ? (100 * lastMsg.dskWr) / peakDskWr : 0;
      return (
        formatRate(lastMsg.dskRd) +
        " R · " +
        formatRate(lastMsg.dskWr) +
        " W · " +
        pr.toFixed(0) +
        "% / " +
        pw.toFixed(0) +
        "% of peak"
      );
    },
    function () {
      if (!lastMsg) return "";
      const pr = peakDskRd > 0 ? (100 * lastMsg.dskRd) / peakDskRd : 0;
      return (
        "<strong>" +
        pr.toFixed(0) +
        "%</strong> read of peak<small>write " +
        (peakDskWr > 0 ? ((100 * lastMsg.dskWr) / peakDskWr).toFixed(0) : "0") +
        "%</small>"
      );
    }
  );

  const refreshCoresPct = wirePctToggle(
    "cores",
    document.querySelector('.opt-pct[data-panel="cores"]'),
    document.getElementById("pct-cores-big"),
    document.getElementById("pct-cores-line"),
    function () {
      if (!lastMsg || !lastMsg.cpus || !lastMsg.cpus.length) return "";
      let sum = 0;
      for (let i = 0; i < lastMsg.cpus.length; i++) sum += lastMsg.cpus[i];
      const avg = sum / lastMsg.cpus.length;
      return (
        lastMsg.cpus.length +
        " cores · avg " +
        avg.toFixed(1) +
        "% · max " +
        Math.max.apply(null, lastMsg.cpus).toFixed(1) +
        "%"
      );
    },
    function () {
      if (!lastMsg || !lastMsg.cpus || !lastMsg.cpus.length) return "";
      const avg =
        lastMsg.cpus.reduce(function (a, b) {
          return a + b;
        }, 0) / lastMsg.cpus.length;
      return (
        "<strong>" +
        avg.toFixed(1) +
        "%</strong> avg core<small>max " +
        Math.max.apply(null, lastMsg.cpus).toFixed(1) +
        "%</small>"
      );
    }
  );

  const refreshProcsPct = wirePctToggle(
    "procs",
    document.querySelector('.opt-pct[data-panel="procs"]'),
    document.getElementById("pct-procs-big"),
    document.getElementById("pct-procs-line"),
    function () {
      if (!lastMsg) return "";
      const r = lastMsg.procsRun != null ? lastMsg.procsRun : 0;
      const tot = lastMsg.procsTotal != null ? lastMsg.procsTotal : 0;
      return r + " runnable of " + tot + " tasks";
    },
    function () {
      if (!lastMsg) return "";
      const r = lastMsg.procsRun != null ? lastMsg.procsRun : 0;
      return "<strong>" + r + "</strong> running<small>tasks in system</small>";
    }
  );

  const refreshRootPct = wirePctToggle(
    "root",
    document.querySelector('.opt-pct[data-panel="root"]'),
    document.getElementById("pct-root-big"),
    document.getElementById("pct-root-line"),
    function () {
      if (!lastMsg) return "";
      return lastMsg.rootPct.toFixed(1) + "% of root filesystem used";
    },
    function () {
      if (!lastMsg) return "";
      return (
        "<strong>" +
        lastMsg.rootPct.toFixed(1) +
        "%</strong> used<small>root filesystem</small>"
      );
    }
  );

  function logNearBottom() {
    return elLogView.scrollTop + elLogView.clientHeight >= elLogView.scrollHeight - 24;
  }

  function ensureLogEmpty(text) {
    if (!elLogEmpty) {
      elLogEmpty = document.createElement("div");
      elLogEmpty.id = "log-empty";
      elLogEmpty.className = "log-empty";
      elLogView.appendChild(elLogEmpty);
    }
    elLogEmpty.textContent = text;
  }

  function syncLogEmptyState() {
    let visible = 0;
    for (let i = 0; i < logRows.length; i++) {
      if (!logRows[i].el.hidden) visible++;
    }
    if (visible > 0) {
      if (elLogEmpty) {
        elLogEmpty.remove();
        elLogEmpty = null;
      }
      return;
    }
    if (!logRows.length) {
      ensureLogEmpty("Waiting for log output…");
      return;
    }
    if (logFilter === "all") {
      ensureLogEmpty("Waiting for log output…");
      return;
    }
    ensureLogEmpty("No " + logLevelLabel(logFilter).toLowerCase() + " logs in view.");
  }

  function normalizeLogEntry(entry) {
    if (entry == null) return null;
    if (typeof entry !== "object") {
      entry = { message: String(entry) };
    }
    const message =
      entry.message != null
        ? String(entry.message)
        : entry.raw != null
          ? String(entry.raw)
          : "";
    if (!message) return null;
    const parsedTime = Number(entry.t);
    const level =
      normalizeLogLevel(entry.level || entry.severity) || classifyLogTextLevel(message);
    const origin = String(entry.origin || (entry.source === "lmonitor" ? "app" : "system"))
      .toLowerCase() === "app"
      ? "app"
      : "system";
    return {
      t: Number.isFinite(parsedTime) && parsedTime > 0 ? parsedTime : Date.now(),
      level: level,
      origin: origin,
      source: entry.source ? String(entry.source) : origin === "app" ? "lmonitor" : "system",
      unit: entry.unit ? String(entry.unit) : "",
      host: entry.host ? String(entry.host) : "",
      pid: entry.pid ? String(entry.pid) : "",
      message: message,
    };
  }

  function applyLogFilter() {
    for (let i = 0; i < logRows.length; i++) {
      const row = logRows[i];
      row.el.hidden = logFilter !== "all" && row.entry.level !== logFilter;
    }
    syncLogEmptyState();
  }

  function appendLogEntry(data) {
    const entry = normalizeLogEntry(data);
    if (!entry) return;

    const stickToBottom = logNearBottom();
    const row = document.createElement("div");
    row.className = "log-line log-" + entry.level;

    const meta = document.createElement("div");
    meta.className = "log-meta";

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = timeLabel(entry.t);
    meta.appendChild(time);

    const level = document.createElement("span");
    level.className = "log-pill log-level";
    level.textContent = logLevelLabel(entry.level);
    meta.appendChild(level);

    const origin = document.createElement("span");
    origin.className =
      "log-pill " + (entry.origin === "app" ? "log-origin-app" : "log-origin-system");
    origin.textContent = entry.origin === "app" ? "APP" : "SYSTEM";
    meta.appendChild(origin);

    const source = document.createElement("span");
    source.className = "log-pill log-source";
    source.textContent = entry.source;
    meta.appendChild(source);

    if (entry.unit && entry.unit !== entry.source) {
      const unit = document.createElement("span");
      unit.className = "log-pill log-unit";
      unit.textContent = entry.unit;
      meta.appendChild(unit);
    }

    const message = document.createElement("div");
    message.className = "log-message";
    message.textContent = entry.message;

    row.appendChild(meta);
    row.appendChild(message);
    elLogView.appendChild(row);

    logRows.push({ el: row, entry: entry });
    while (logRows.length > 400) {
      const old = logRows.shift();
      if (old && old.el) old.el.remove();
    }

    row.hidden = logFilter !== "all" && entry.level !== logFilter;
    syncLogEmptyState();
    if (stickToBottom) {
      elLogView.scrollTop = elLogView.scrollHeight;
    }
  }

  function resetLogs() {
    logRows.length = 0;
    elLogView.innerHTML = "";
    syncLogEmptyState();
  }

  if (elLogFilter) {
    elLogFilter.addEventListener("change", function () {
      logFilter = elLogFilter.value || "all";
      applyLogFilter();
    });
  }

  if (elLogClear) {
    elLogClear.addEventListener("click", function () {
      resetLogs();
    });
  }

  function onSample(msg) {
    lastMsg = msg;
    peakNetRx = Math.max(peakNetRx, msg.netRx || 0, 1);
    peakNetTx = Math.max(peakNetTx, msg.netTx || 0, 1);
    peakDskRd = Math.max(peakDskRd, msg.dskRd || 0, 1);
    peakDskWr = Math.max(peakDskWr, msg.dskWr || 0, 1);

    elStripUptime.textContent = formatUptime(msg.uptime || 0);
    elStripNcpu.textContent = String(msg.ncpu != null ? msg.ncpu : "—");
    elStripProcs.textContent =
      (msg.procsRun != null ? msg.procsRun : "—") +
      " / " +
      (msg.procsTotal != null ? msg.procsTotal : "—");
    elStripLoad.textContent =
      (msg.load1Pct != null ? msg.load1Pct.toFixed(0) : "—") + "% vs CPUs";

    const t = msg.t;
    cpuChart.pushRow(t, [msg.cpu, msg.ioWait != null ? msg.ioWait : 0]);
    memChart.pushRow(t, [msg.ram, msg.swap, msg.cachedPct || 0, msg.buffersPct || 0]);
    loadChart.pushRow(t, [msg.load1, msg.load5, msg.load15]);
    netChart.pushRow(t, [msg.netRx, msg.netTx]);
    diskChart.pushRow(t, [msg.dskRd, msg.dskWr]);
    procsChart.pushRow(t, [msg.procsRun != null ? msg.procsRun : 0]);

    if (msg.cpus && msg.cpus.length) {
      coreChart.update(t, msg.cpus);
    }

    window.__lastRootPct = msg.rootPct;
    rootCtl.update(msg.rootPct);
    elRootPct.innerHTML =
      msg.rootPct.toFixed(1) + "%<small>of root filesystem</small>";

    refreshCpuPct();
    refreshMemPct();
    refreshLoadPct();
    refreshNetPct();
    refreshDiskPct();
    refreshCoresPct();
    refreshProcsPct();
    refreshRootPct();

    if (!window.__lmLayoutOnce) {
      window.__lmLayoutOnce = true;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          window.dispatchEvent(new Event("resize"));
        });
      });
    }
  }

  let backoff = 1000;
  const maxBackoff = 30000;

  function setLive(live) {
    elStatus.textContent = live ? "Live" : "Reconnecting…";
    elStatus.className = "status " + (live ? "status-live" : "status-offline");
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + location.host + "/ws";
    const ws = new WebSocket(url);
    ws.onopen = function () {
      setLive(true);
      backoff = 1000;
    };
    ws.onclose = function () {
      setLive(false);
      setTimeout(connect, backoff);
      backoff = Math.min(maxBackoff, Math.floor(backoff * 1.5));
    };
    ws.onerror = function () {
      ws.close();
    };
    ws.onmessage = function (ev) {
      try {
        onSample(JSON.parse(ev.data));
      } catch (_) { }
    };
  }

  function connectLogs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = proto + "//" + location.host + "/logs";
    const ws = new WebSocket(url);
    ws.onopen = function () {
      resetLogs();
      logWsBackoff = 1000;
    };
    ws.onclose = function () {
      setTimeout(connectLogs, logWsBackoff);
      logWsBackoff = Math.min(logWsMaxBackoff, Math.floor(logWsBackoff * 1.5));
    };
    ws.onerror = function () {
      ws.close();
    };
    ws.onmessage = function (ev) {
      try {
        appendLogEntry(JSON.parse(ev.data));
      } catch (_) {
        appendLogEntry({ message: String(ev.data), origin: "app", source: "lmonitor" });
      }
    };
  }

  document.querySelectorAll("select.chart-type").forEach(function (sel) {
    sel.value = getPref("chart." + sel.getAttribute("data-panel"), sel.value);
  });

  if (elLogFilter) {
    elLogFilter.value = logFilter;
  }

  // --- Theme ---
  const elThemeToggle = document.getElementById("theme-toggle");
  function applyTheme(light) {
    if (light) {
      document.documentElement.setAttribute("data-theme", "light");
      Chart.defaults.color = "#59636e";
      Chart.defaults.borderColor = "#d0d7de";
    } else {
      document.documentElement.removeAttribute("data-theme");
      Chart.defaults.color = "#8b949e";
      Chart.defaults.borderColor = "#30363d";
    }
  }
  let isLight = getPref("theme", "dark") === "light";
  applyTheme(isLight);
  if (elThemeToggle) {
    elThemeToggle.addEventListener("click", function() {
      isLight = !isLight;
      setPref("theme", isLight ? "light" : "dark");
      applyTheme(isLight);
      // Re-trigger layout if needed
      window.dispatchEvent(new Event("resize"));
    });
  }

  // --- Drag and Drop Layouts ---
  const grid = document.querySelector(".grid");
  const panels = Array.from(grid.querySelectorAll(".panel"));
  
  // Reorder on load
  try {
    const savedOrder = JSON.parse(getPref("layout", "[]"));
    if (savedOrder && savedOrder.length) {
      savedOrder.forEach(function(panelKey) {
        const el = grid.querySelector('.panel[data-panel="' + panelKey + '"]');
        if (el) grid.appendChild(el);
      });
    }
  } catch(e) {}

  let draggedEl = null;

  panels.forEach(function(p) {
    p.addEventListener("dragstart", function(e) {
      draggedEl = p;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(function() { p.classList.add("is-dragging"); }, 0);
    });
    p.addEventListener("dragend", function(e) {
      p.classList.remove("is-dragging");
      draggedEl = null;
      panels.forEach(function(x) { x.classList.remove("drop-target"); });
      
      // Save order
      const newOrder = Array.from(grid.querySelectorAll(".panel")).map(function(el) {
        return el.getAttribute("data-panel");
      }).filter(Boolean);
      setPref("layout", JSON.stringify(newOrder));
    });
    p.addEventListener("dragover", function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    p.addEventListener("dragenter", function(e) {
      e.preventDefault();
      if (p !== draggedEl) p.classList.add("drop-target");
    });
    p.addEventListener("dragleave", function(e) {
      p.classList.remove("drop-target");
    });
    p.addEventListener("drop", function(e) {
      e.preventDefault();
      p.classList.remove("drop-target");
      if (draggedEl && draggedEl !== p) {
        const all = Array.from(grid.querySelectorAll(".panel"));
        const idxD = all.indexOf(draggedEl);
        const idxP = all.indexOf(p);
        if (idxD < idxP) {
          p.after(draggedEl);
        } else {
          p.before(draggedEl);
        }
      }
    });
  });

  // --- Process Manager ---
  const elProcRefresh = document.getElementById("proc-refresh");
  const elProcTbody = document.getElementById("proc-tbody");
  
  function fetchProcesses() {
    if (!elProcTbody) return;
    fetch("/api/processes")
      .then(function(res) { return res.json(); })
      .then(function(procs) {
        elProcTbody.innerHTML = "";
        procs.forEach(function(p) {
          const tr = document.createElement("tr");
          tr.innerHTML = 
            "<td>" + window.escapeHtml(String(p.pid)) + "</td>" +
            "<td style='min-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;'>" + window.escapeHtml(p.name) + "</td>" +
            "<td>" + window.escapeHtml(p.user || "-") + "</td>" +
            "<td style='text-align:right'>" + p.cpu.toFixed(1) + "%</td>" +
            "<td style='text-align:right'>" + p.mem.toFixed(1) + "%</td>" +
            "<td style='text-align:right'><button class='btn-kill' data-pid='" + p.pid + "'>Kill</button></td>";
          elProcTbody.appendChild(tr);
        });

        // Bind kill buttons
        elProcTbody.querySelectorAll(".btn-kill").forEach(function(btn) {
          btn.addEventListener("click", function() {
            const pid = btn.getAttribute("data-pid");
            if (confirm("Are you sure you want to kill process " + pid + "?")) {
              fetch("/api/process/" + pid + "/kill", { method: "POST" })
                .then(function(res) {
                  if (!res.ok) alert("Kill failed: " + res.statusText);
                  fetchProcesses();
                });
            }
          });
        });
      })
      .catch(function(e) { console.error("Proc API err:", e); });
  }

  // Simple escaping
  window.escapeHtml = function(unsafe) {
    return (unsafe || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  if (elProcRefresh) {
    elProcRefresh.addEventListener("click", fetchProcesses);
  }
  // Initial fill and slow poll
  fetchProcesses();
  setInterval(fetchProcesses, 4000);

  connect();
  connectLogs();
})();
