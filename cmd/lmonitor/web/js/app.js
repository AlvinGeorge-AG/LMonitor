/* global Chart */

(function () {
  "use strict";

  const MAX_POINTS = 100;
  const prefersReduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  function timeLabel(t) {
    const d = new Date(t);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  function baseChartOptions(yTitle, tooltipFormatter) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: prefersReduceMotion ? false : { duration: 0 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#c9d1d9", boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: tooltipFormatter || {},
        },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", maxTicksLimit: 6, maxRotation: 0 },
          grid: { color: "#21262d" },
        },
        y: {
          title: yTitle
            ? { display: true, text: yTitle, color: "#6e7681", font: { size: 10 } }
            : undefined,
          ticks: { color: "#8b949e" },
          grid: { color: "#21262d" },
        },
      },
    };
  }

  function createRollingChart(canvas, datasetsSpec, yTitle, tooltipCb) {
    const labels = [];
    const datasets = datasetsSpec.map(function (s) {
      return {
        label: s.label,
        data: [],
        borderColor: s.color,
        backgroundColor: s.fill || "transparent",
        fill: !!s.fill,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 1.5,
      };
    });
    const chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: baseChartOptions(yTitle, tooltipCb),
    });

    return function pushRow(t, values) {
      labels.push(timeLabel(t));
      for (let i = 0; i < values.length; i++) {
        if (datasets[i]) {
          datasets[i].data.push(values[i]);
        }
      }
      while (labels.length > MAX_POINTS) {
        labels.shift();
        for (let i = 0; i < datasets.length; i++) {
          datasets[i].data.shift();
        }
      }
      chart.update("none");
    };
  }

  const elStatus = document.getElementById("status");
  const elRootPct = document.getElementById("root-pct");

  const pushCPU = createRollingChart(
    document.getElementById("c-cpu"),
    [{ label: "CPU %", color: "#58a6ff", fill: "rgba(88, 166, 255, 0.15)" }],
    "%",
    {
      label: function (ctx) {
        const v = ctx.parsed.y;
        return v != null ? ctx.dataset.label + ": " + v.toFixed(1) + "%" : "";
      },
    }
  );

  const pushMem = createRollingChart(
    document.getElementById("c-mem"),
    [
      { label: "RAM used %", color: "#79c0ff" },
      { label: "Swap used %", color: "#ffa657" },
    ],
    "%"
  );

  const pushLoad = createRollingChart(
    document.getElementById("c-load"),
    [
      { label: "1 min", color: "#58a6ff" },
      { label: "5 min", color: "#a371f7" },
      { label: "15 min", color: "#3fb950" },
    ],
    "Load"
  );

  const pushNet = createRollingChart(
    document.getElementById("c-net"),
    [
      { label: "RX", color: "#3fb950" },
      { label: "TX", color: "#a371f7" },
    ],
    "Throughput",
    {
      label: function (ctx) {
        const v = ctx.parsed.y;
        return v != null ? ctx.dataset.label + ": " + formatRate(v) : "";
      },
    }
  );

  const pushDisk = createRollingChart(
    document.getElementById("c-disk"),
    [
      { label: "Read", color: "#79c0ff" },
      { label: "Write", color: "#ffa657" },
    ],
    "Throughput",
    {
      label: function (ctx) {
        const v = ctx.parsed.y;
        return v != null ? ctx.dataset.label + ": " + formatRate(v) : "";
      },
    }
  );

  const rootCtx = document.getElementById("c-root").getContext("2d");
  const rootChart = new Chart(rootCtx, {
    type: "doughnut",
    data: {
      labels: ["Used", "Free"],
      datasets: [
        {
          data: [0, 100],
          backgroundColor: ["#58a6ff", "#21262d"],
          borderColor: "#161b22",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      animation: prefersReduceMotion ? false : { duration: 400 },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#c9d1d9", boxWidth: 10, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const v = ctx.parsed;
              return ctx.label + ": " + v.toFixed(1) + "%";
            },
          },
        },
      },
    },
  });

  function updateRoot(pct) {
    const used = Math.min(100, Math.max(0, pct));
    const free = 100 - used;
    rootChart.data.datasets[0].data = [used, free];
    let col = "#3fb950";
    if (used > 85) col = "#f85149";
    else if (used > 70) col = "#d29922";
    rootChart.data.datasets[0].backgroundColor = [col, "#21262d"];
    rootChart.update("none");
    elRootPct.innerHTML =
      used.toFixed(1) + "%<small>of root filesystem</small>";
  }

  function onSample(msg) {
    const t = msg.t;
    pushCPU(t, [msg.cpu]);
    pushMem(t, [msg.ram, msg.swap]);
    pushLoad(t, [msg.load1, msg.load5, msg.load15]);
    pushNet(t, [msg.netRx, msg.netTx]);
    pushDisk(t, [msg.dskRd, msg.dskWr]);
    updateRoot(msg.rootPct);
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
      } catch (_) {
        /* ignore */
      }
    };
  }

  connect();
})();
