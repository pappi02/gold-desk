/* Gold Desk chart page: TradingView Lightweight Charts (vendored) + one overlay primitive that draws
   PDH/PDL, ASH/ASL and each trade's position zone, stop path and result. Times are shown in EAT
   (chart time = UTC + 3 h, the usual Lightweight Charts trick for a fixed display zone). */
"use strict";
window.GDChart = (() => {
  const EAT = 3 * 3600;
  const TF = { M5: { s: 300, l: "5m", leg: "5" }, M15: { s: 900, l: "15m", leg: "15" }, H1: { s: 3600, l: "1H", leg: "1H" }, H4: { s: 14400, l: "4H", leg: "4H" }, D1: { s: 86400, l: "D", leg: "1D" } };
  const THEME = {
    light: { bg: "#ffffff", text: "#131722", grid: "#f0f3fa", border: "#e0e3eb", cross: "#9598a1", up: "#089981", down: "#f23645",
      pd: "#787b86", as: "#f7a600", entry: "#787b86", red: "rgba(242,54,69,.13)", green: "rgba(8,153,129,.13)", stop: "#f23645", best: "#089981" },
    dark: { bg: "#0b0c0e", text: "#d1d4dc", grid: "#1a1d23", border: "#2a2e39", cross: "#5d606b", up: "#089981", down: "#f23645",
      pd: "#9598a1", as: "#f7a600", entry: "#9598a1", red: "rgba(242,54,69,.16)", green: "rgba(8,153,129,.18)", stop: "#f23645", best: "#26a69a" },
  };
  const store = {
    get(k, d) { try { return localStorage.getItem("gd.chart." + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("gd.chart." + k, v); } catch { /* private mode */ } },
  };
  const fmt = (v) => v == null || !isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let S = null;   // mounted state

  // ---------------------------------------------------------------- overlay primitive
  class Overlay {
    constructor() { this.items = { segs: [], trades: [] }; this.view = { zOrder: () => "bottom", renderer: () => ({ draw: (t) => this.draw(t) }) }; }
    attached({ requestUpdate }) { this.req = requestUpdate; }
    detached() { this.req = null; }
    updateAllViews() {}
    paneViews() { return [this.view]; }
    set(items) { this.items = items; if (this.req) this.req(); }
    draw(target) {
      if (!S) return;
      const th = THEME[S.theme], ts = S.chart.timeScale(), ser = S.series;
      target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
        const W = bitmapSize.width;
        // logicalToCoordinate only handles whole bar indexes, so interpolate between neighbours
        const X = (t) => {
          const l = S.logicalOf(t); if (l == null) return null;
          const i = Math.floor(l), a = ts.logicalToCoordinate(i), b = ts.logicalToCoordinate(i + 1);
          return a == null || b == null ? null : (a + (b - a) * (l - i)) * hr;
        };
        const Y = (p) => { const y = ser.priceToCoordinate(p); return y == null ? null : y * vr; };
        const font = (px, w = 500) => `${w} ${Math.round(px * vr)}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`;
        const line = (x1, y, x2, color, dash) => {
          c.strokeStyle = color; c.lineWidth = Math.max(1, Math.round(hr)); c.setLineDash(dash ? dash.map((d) => d * hr) : []);
          c.beginPath(); c.moveTo(x1, Math.round(y) + .5); c.lineTo(x2, Math.round(y) + .5); c.stroke();
        };
        // levels: thin segments, tiny tag at the right end
        if (S.show.levels) for (const g of this.items.segs) {
          const x1 = X(g.t1), x2 = X(g.t2), y = Y(g.p);
          if (x1 == null || x2 == null || y == null || x2 < 0 || x1 > W) continue;
          line(x1, y, x2, g.color);
          if (x2 > W - 6 * hr) continue;                       // runs off the edge: the price-scale tag names it
          c.font = font(10); c.fillStyle = g.color; c.textAlign = "right"; c.textBaseline = "bottom";
          c.fillText(g.label, x2 - 2 * hr, y - 2 * vr);
        }
        // trades: TradingView-style position zones
        const placed = [];                                     // label boxes already drawn (skip overlapping ones)
        if (S.show.trades) for (const t of this.items.trades) {
          const x1 = X(t.t1), x2 = X(t.t2), ye = Y(t.entry);
          if (x1 == null || x2 == null || ye == null || x2 < 0 || x1 > W) continue;
          const w = Math.max(x2 - x1, 3 * hr);
          if (t.sl != null) { const ys = Y(t.sl); if (ys != null) { c.fillStyle = th.red; c.fillRect(x1, Math.min(ye, ys), w, Math.abs(ys - ye)); } }
          if (t.best != null) { const yb = Y(t.best); if (yb != null) { c.fillStyle = th.green; c.fillRect(x1, Math.min(ye, yb), w, Math.abs(yb - ye)); } }
          line(x1, ye, x1 + w, th.entry);
          // stop path (step line)
          if (t.stops.length) {
            c.strokeStyle = th.stop; c.lineWidth = Math.max(1, Math.round(hr)); c.setLineDash([3 * hr, 2 * hr]); c.beginPath();
            t.stops.forEach(([tt, p], i) => {
              const xs = Math.max(x1, X(tt) ?? x1), xe = i + 1 < t.stops.length ? X(t.stops[i + 1][0]) ?? x2 : x2, y = Y(p);
              if (y == null) return;
              if (i === 0) c.moveTo(xs, Math.round(y) + .5); else c.lineTo(xs, Math.round(y) + .5);
              c.lineTo(Math.min(xe, x1 + w), Math.round(y) + .5);
            });
            c.stroke(); c.setLineDash([]);
          }
          // entry triangle + exit dot
          const s = 4 * hr;
          c.fillStyle = t.color; c.beginPath();
          if (t.dir > 0) { c.moveTo(x1, ye + s * 2.2); c.lineTo(x1 - s, ye + s * 3.6); c.lineTo(x1 + s, ye + s * 3.6); }
          else { c.moveTo(x1, ye - s * 2.2); c.lineTo(x1 - s, ye - s * 3.6); c.lineTo(x1 + s, ye - s * 3.6); }
          c.fill();
          if (t.exit != null) { const yx = Y(t.exit); if (yx != null) { c.beginPath(); c.arc(x2, yx, 3 * hr, 0, Math.PI * 2); c.fillStyle = th.text; c.fill(); } }
          // one tiny label
          c.font = font(10, 600); c.textAlign = "left"; c.textBaseline = t.dir > 0 ? "top" : "bottom";
          const lx = x1 + 3 * hr, ly = t.dir > 0 ? ye + 2 * vr : ye - 2 * vr, lw = c.measureText(t.label).width, lh = 12 * vr;
          const top = t.dir > 0 ? ly : ly - lh;
          if (placed.some((b) => lx < b.x + b.w + 4 * hr && b.x < lx + lw + 4 * hr && top < b.y + b.h && b.y < top + lh)) continue;
          placed.push({ x: lx, y: top, w: lw, h: lh });
          c.fillStyle = t.R == null ? th.text : t.R >= 0 ? th.up : th.down;
          c.fillText(t.label, lx, ly);
        }
      });
    }
  }

  // ---------------------------------------------------------------- data
  const toChart = (serverT, off) => serverT - off * 3600 + EAT;
  async function getBars(tf, since) {
    const r = await fetch(`/api/bars?tf=${tf}${since ? `&since=${since}` : ""}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`bars HTTP ${r.status}`);
    return r.json();
  }
  const asBar = (b, off) => ({ time: toChart(b[0], off), open: b[1], high: b[2], low: b[3], close: b[4] });

  function computeLevels() {
    const th = THEME[S.theme], segs = [], first = S.times[0] ?? 0, tf = S.tf;
    const lines = [];
    if (tf !== "D1" && S.d1.length > 1) {                       // previous day high/low over each broker day
      for (let i = 1; i < S.d1.length; i++) {
        const t1 = S.d1[i].time, t2 = i + 1 < S.d1.length ? S.d1[i + 1].time : t1 + 86400;
        if (t2 < first) continue;
        segs.push({ t1, t2, p: S.d1[i - 1].high, color: th.pd, label: "PDH" }, { t1, t2, p: S.d1[i - 1].low, color: th.pd, label: "PDL" });
        if (i === S.d1.length - 1) lines.push(["PDH", S.d1[i - 1].high, th.pd], ["PDL", S.d1[i - 1].low, th.pd]);
      }
    }
    if (["M5", "M15", "H1"].includes(tf) && S.m15.length) {     // Asian range 03:00-10:00 EAT, locked at 10:00 (as the EA)
      const byDay = new Map();
      for (const b of S.m15) {
        const day = Math.floor(b.time / 86400) * 86400, m = (b.time - day) / 60;
        if (m < 180 || m >= 600) continue;
        const d = byDay.get(day) || { h: -Infinity, l: Infinity, n: 0 };
        d.h = Math.max(d.h, b.high); d.l = Math.min(d.l, b.low); d.n++; byDay.set(day, d);
      }
      const now = S.times[S.times.length - 1] ?? 0, days = [...byDay.keys()].sort((a, b) => a - b);
      for (const day of days) {
        const d = byDay.get(day);
        if (d.n < 16 || now < day + 600 * 60 || day + 20 * 3600 < first) continue;
        segs.push({ t1: day + 3 * 3600, t2: day + 20 * 3600, p: d.h, color: th.as, label: "ASH" }, { t1: day + 3 * 3600, t2: day + 20 * 3600, p: d.l, color: th.as, label: "ASL" });
        if (day === days[days.length - 1]) lines.push(["ASH", d.h, th.as], ["ASL", d.l, th.as]);
      }
    }
    // price-scale tags for today's levels (no line across the chart)
    for (const pl of S.priceLines) S.series.removePriceLine(pl);
    S.priceLines = S.show.levels ? lines.map(([title, price, color]) => S.series.createPriceLine({ price, color, lineVisible: false, axisLabelVisible: true, title })) : [];
    return segs;
  }

  function computeTrades() {
    const out = [], nowT = Date.now() / 1000 + EAT;
    for (const t of S.model.trades) {
      const t1 = t.openMs / 1000 + EAT, t2 = t.open ? nowT : t.closeMs / 1000 + EAT;
      const hist = (S.stops[String(t.id)] || []).map(([u, p]) => [u + EAT, p]);
      if (t.initSL && (!hist.length || hist[0][0] > t1 + 60)) hist.unshift([t1, t.initSL]);
      const sname = (t.sname || "").replace("Strategy ", "S").replace(/^S([A-Z])$/, "$1");
      out.push({ t1, t2, dir: t.dir, entry: t.openPrice, sl: t.initSL, best: t.best && t.best.usd > 0 ? t.best.px : null,
        exit: t.open ? null : t.closePrice, stops: hist, color: t.color, R: t.R,
        label: `${sname} ${t.dir > 0 ? "BUY" : "SELL"} ${t.R == null ? "" : (t.R >= 0 ? "+" : "") + t.R.toFixed(2) + "R"}${t.open ? " ·" : ""}` });
    }
    return out;
  }

  function redraw() { if (S) S.overlay.set({ segs: computeLevels(), trades: computeTrades() }); }

  // ---------------------------------------------------------------- legend (OHLC of the bar under the cursor)
  function legend(bar) {
    if (!S) return;
    const th = THEME[S.theme], b = bar || S.lastBar;
    if (!b) { S.legend.textContent = ""; return; }
    const i = S.times.indexOf(b.time), prev = i > 0 ? S.bars[i - 1].close : b.open, ch = b.close - prev, col = ch >= 0 ? th.up : th.down;
    S.legend.innerHTML = `<b>XAUUSD · ${TF[S.tf].leg}</b> <span>O<i style="color:${col}">${fmt(b.open)}</i> H<i style="color:${col}">${fmt(b.high)}</i> L<i style="color:${col}">${fmt(b.low)}</i> C<i style="color:${col}">${fmt(b.close)}</i> <i style="color:${col}">${ch >= 0 ? "+" : "−"}${fmt(Math.abs(ch))} (${ch >= 0 ? "+" : "−"}${(Math.abs(ch) / prev * 100).toFixed(2)}%)</i></span>`;
  }

  // ---------------------------------------------------------------- load / live
  async function loadTf(tf, keepRange) {
    S.tf = tf; store.set("tf", tf);
    S.root.querySelectorAll("[data-tf]").forEach((b) => b.classList.toggle("on", b.dataset.tf === tf));
    const [main, m15, d1, stops] = await Promise.all([getBars(tf), tf === "M15" ? null : getBars("M15"), tf === "D1" ? null : getBars("D1"),
      fetch("/api/stops", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}).catch(() => ({}))]);
    if (!S) return;
    S.off = main.offset;
    S.bars = main.bars.map((b) => asBar(b, S.off));
    S.times = S.bars.map((b) => b.time);
    S.m15 = tf === "M15" ? S.bars : m15.bars.map((b) => asBar(b, m15.offset));
    S.d1 = tf === "D1" ? S.bars : d1.bars.map((b) => asBar(b, d1.offset));
    S.stops = stops;
    S.lastBar = S.bars[S.bars.length - 1];
    S.series.setData(S.bars);
    if (!keepRange) {
      const n = S.bars.length, f = S.focus && S.model.trades.find((t) => String(t.id) === String(S.focus));
      if (f) {
        const a = Math.floor(S.logicalOf(f.openMs / 1000 + EAT)), b = Math.ceil(S.logicalOf((f.open ? Date.now() : f.closeMs) / 1000 + EAT));
        const pad = Math.max(20, (b - a) * 0.6);
        S.chart.timeScale().setVisibleLogicalRange({ from: a - pad, to: b + pad });
      } else S.chart.timeScale().setVisibleLogicalRange({ from: n - 140, to: n + 8 });
    }
    redraw(); legend();
  }

  // map a chart time to a fractional bar index (gaps and the future are interpolated)
  function logicalOf(t) {
    const a = S.times, n = a.length; if (!n) return null;
    const step = TF[S.tf].s;
    if (t <= a[0]) return (t - a[0]) / step;
    if (t >= a[n - 1]) return n - 1 + (t - a[n - 1]) / step;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid] <= t) lo = mid; else hi = mid; }
    return lo + Math.min(1, (t - a[lo]) / Math.min(step, a[hi] - a[lo]));
  }

  function liveTick(m) {
    const mk = m.d.market; if (!S || !S.lastBar || !mk || mk.bid == null || !mk.tick_time) return;
    const step = TF[S.tf].s, t = toChart(mk.tick_time, m.d.server_gmt_offset ?? S.off);
    const shift = (((EAT - S.off * 3600) % step) + step) % step;        // bar boundaries are broker-aligned
    const start = Math.floor((t - shift) / step) * step + shift, p = mk.bid, L = S.lastBar;
    if (start < L.time) return;
    if (start === L.time) { L.high = Math.max(L.high, p); L.low = Math.min(L.low, p); L.close = p; }
    else { S.lastBar = { time: start, open: L.close, high: Math.max(L.close, p), low: Math.min(L.close, p), close: p }; S.bars.push(S.lastBar); S.times.push(start); }
    S.series.update({ ...S.lastBar });
    if (!S.hover) legend();
  }

  async function refresh() {                                           // every 30 s: true OHLC from MT5 + stop history
    if (!S || !S.lastBar) return;
    try {
      const since = S.lastBar.time - EAT + S.off * 3600 - TF[S.tf].s;
      const [r, stops] = await Promise.all([getBars(S.tf, since), fetch("/api/stops", { cache: "no-store" }).then((x) => x.ok ? x.json() : S.stops)]);
      if (!S) return;
      for (const raw of r.bars) {
        const b = asBar(raw, r.offset);
        if (b.time < S.lastBar.time - TF[S.tf].s) continue;
        const i = S.times.indexOf(b.time);
        if (i >= 0) S.bars[i] = b; else { S.bars.push(b); S.times.push(b.time); }
        S.series.update(b); S.lastBar = S.bars[S.bars.length - 1];
      }
      S.stops = stops;
      if (S.tf === "M15") S.m15 = S.bars;
      redraw();
    } catch { /* keep last */ }
  }

  // ---------------------------------------------------------------- mount / theme
  function applyTheme() {
    const th = THEME[S.theme];
    S.root.className = `tv tv-${S.theme}`;
    S.chart.applyOptions({
      layout: { background: { type: "solid", color: th.bg }, textColor: th.text, fontSize: 11, fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif' },
      grid: { vertLines: { color: th.grid, style: 1 }, horzLines: { color: th.grid, style: 1 } },
      rightPriceScale: { borderColor: th.border }, timeScale: { borderColor: th.border },
      crosshair: { vertLine: { color: th.cross, labelBackgroundColor: th.text }, horzLine: { color: th.cross, labelBackgroundColor: th.text } },
    });
    S.series.applyOptions({ upColor: th.up, downColor: th.down, borderUpColor: th.up, borderDownColor: th.down, wickUpColor: th.up, wickDownColor: th.down });
    if (S.bars) redraw();
    legend();
  }

  function mount(root, { model, focus }) {
    destroy();
    root.innerHTML = `<div class="tv-bar">
        <span class="tv-sym">XAUUSD</span><span class="tv-div"></span>
        <div class="tv-tfs">${Object.entries(TF).map(([k, v]) => `<button data-tf="${k}">${v.l}</button>`).join("")}</div><span class="tv-div"></span>
        <button class="tv-tg" data-tg="levels">Levels</button><button class="tv-tg" data-tg="trades">Trades</button>
        <span class="tv-sp"></span>
        <button class="tv-ic" data-act="fit" title="Go to latest" aria-label="Go to latest"><svg viewBox="0 0 24 24"><path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/></svg></button>
        <button class="tv-ic" data-act="theme" title="Light / dark" aria-label="Light or dark chart"><svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button>
      </div><div class="tv-pane"><div class="tv-legend"></div></div>`;
    const pane = root.querySelector(".tv-pane");
    const chart = LightweightCharts.createChart(pane, {
      autoSize: true,
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7 },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (p) => fmt(p) },
    });
    const series = chart.addCandlestickSeries({ priceLineVisible: true, lastValueVisible: true, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    const overlay = new Overlay();
    series.attachPrimitive(overlay);
    S = { root, chart, series, overlay, model, focus, theme: store.get("theme", "light"), legend: root.querySelector(".tv-legend"),
      show: { levels: store.get("levels", "1") === "1", trades: store.get("trades", "1") === "1" }, priceLines: [], stops: {}, bars: null, times: [], m15: [], d1: [],
      logicalOf: (t) => logicalOf(t), timer: null, hover: false, off: 2 };
    applyTheme();
    root.querySelectorAll("[data-tg]").forEach((b) => {
      b.classList.toggle("on", S.show[b.dataset.tg]);
      b.onclick = () => { const k = b.dataset.tg; S.show[k] = !S.show[k]; store.set(k, S.show[k] ? "1" : "0"); b.classList.toggle("on", S.show[k]); redraw(); };
    });
    root.querySelectorAll("[data-tf]").forEach((b) => b.onclick = () => { S.focus = null; loadTf(b.dataset.tf).catch(fail); });
    root.querySelector('[data-act="theme"]').onclick = () => { S.theme = S.theme === "light" ? "dark" : "light"; store.set("theme", S.theme); applyTheme(); };
    root.querySelector('[data-act="fit"]').onclick = () => { S.chart.timeScale().scrollToRealTime(); };
    chart.subscribeCrosshairMove((p) => { const b = p && p.time != null ? p.seriesData.get(series) : null; S.hover = !!b; legend(b ? { ...b, time: p.time } : null); });
    const fail = (e) => { if (S) S.legend.textContent = `Chart data unavailable (${e.message}). Is the exporter v1.20 running?`; };
    const tf = focus ? "M15" : store.get("tf", "M15");
    loadTf(TF[tf] ? tf : "M15").catch(fail);
    S.timer = setInterval(refresh, 30000);
  }

  function update(model) { if (!S) return; S.model = model; liveTick(model); if (S.bars) S.overlay.set({ segs: S.overlay.items.segs, trades: computeTrades() }); }

  function destroy() {
    if (!S) return;
    clearInterval(S.timer);
    try { S.chart.remove(); } catch { /* already gone */ }
    S = null;
  }

  return { mount, update, destroy, active: () => !!S };
})();
