/* Gold Desk — read-only trading workspace. Data: /api/state (MT5 exporter), /api/config, /api/equity, /api/system. */
"use strict";
(() => {
  const TZ = "Africa/Nairobi";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------ icons (Lucide-style strokes, 24px grid)
  const P = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    positions: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    trades: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    strategies: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    analytics: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    risk: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    market: '<path d="M9 5v4"/><rect x="7" y="9" width="4" height="6" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect x="15" y="5" width="4" height="8" rx="1"/><path d="M17 13v3"/><path d="M3 3v18h18"/>',
    system: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
    arrow: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  };
  const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${P[k]}</svg>`;
  const NAV = [["overview", "Overview"], ["positions", "Positions"], ["trades", "Trades"], ["strategies", "Strategies"], ["analytics", "Analytics"], ["risk", "Risk"], ["market", "Market"], ["system", "System"]];

  // ------------------------------------------------------------ formatting
  const money = (v, sign = false) => v == null || !isFinite(v) ? "—" : (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (v, d = 2, sign = false) => v == null || !isFinite(v) ? "—" : (sign && v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const rr = (v) => v == null || !isFinite(v) ? "—" : num(v, 2, true) + "R";
  const pct = (v, d = 1, sign = false) => v == null || !isFinite(v) ? "—" : num(v, d, sign) + "%";
  const ud = (v) => v > 0 ? "up" : v < 0 ? "down" : "";
  const dtf = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const dfDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const tfHour = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });
  const tfMin = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const tfSec = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const tfWd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
  const fmtTime = (ms) => ms ? dtf.format(ms) : "—";
  const shortTime = (ms) => !ms ? "—" : dfDay.format(ms) === dfDay.format(Date.now()) ? tfMin.format(ms) : dtf.format(ms).split(",")[0];
  const dayKey = (ms) => dfDay.format(ms);
  const eatMinutes = (ms) => { const [h, m] = tfMin.format(ms).split(":").map(Number); return (h % 24) * 60 + m; };
  const dur = (sec) => { if (sec == null || !isFinite(sec)) return "—"; sec = Math.max(0, sec); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
  const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ------------------------------------------------------------ state
  let CFG = null, RAW = null, META = null, SYS = null, M = null, EQ = [];
  let route = { name: "overview", arg: null };
  const charts = {};
  const prevVals = new Map();
  const ui = { trades: { strat: "all", dir: "all", res: "all", from: "", to: "", sort: "open", desc: true, open: null }, eqRange: "all" };

  // ------------------------------------------------------------ model
  const tagNum = (c, k) => { const m = new RegExp(`(?:^|\\s)${k}=([\\d.]+)`).exec(c || ""); return m ? Number(m[1]) : null; };
  const REASON = { 0: "Manual", 1: "Manual (mobile)", 2: "Manual (web)", 3: "EA exit", 4: "Stop / trail", 5: "Take profit", 6: "Stop out", 7: "Rollover", 8: "Var. margin", 9: "Split" };

  function buildModel() {
    const d = RAW, off = d.server_gmt_offset ?? 2;
    const toMs = (t) => (t - off * 3600) * 1000;
    const stratByMagic = new Map(CFG.strategies.map((s) => [s.magic, s]));
    const contract = d.market?.contract_size || 100;
    const posById = new Map((d.positions || []).map((p) => [p.position_id, p]));
    const excById = new Map((d.excursions || []).map((x) => [x.position_id, x]));
    const groups = new Map();
    for (const x of d.deals || []) {
      if (x.type > 1) continue;
      if (!groups.has(x.position_id)) groups.set(x.position_id, []);
      groups.get(x.position_id).push(x);
    }
    const trades = [];
    for (const [pid, ds] of groups) {
      ds.sort((a, b) => a.time_msc - b.time_msc);
      const e = ds.find((x) => x.entry === 0); if (!e) continue;
      const exits = ds.filter((x) => x.entry !== 0);
      const s = stratByMagic.get(e.magic);
      const dir = e.type === 0 ? 1 : -1;
      const pos = posById.get(pid);
      const realised = ds.reduce((a, x) => a + (x.profit || 0) + (x.commission || 0) + (x.swap || 0) + (x.fee || 0), 0);
      let risk = tagNum(e.comment, "R");
      if (!risk && e.sl) risk = Math.abs(e.price - e.sl) * e.volume * contract;
      const pnl = pos ? realised + (pos.profit || 0) + (pos.swap || 0) : realised;
      const exitVol = exits.reduce((a, x) => a + x.volume, 0);
      const exitPx = exitVol ? exits.reduce((a, x) => a + x.price * x.volume, 0) / exitVol : null;
      const lastExit = exits[exits.length - 1];
      // farthest point reached in favour / against, in price, $ (at entry size) and R
      const ex = excById.get(pid);
      const xv = (px) => px == null ? null : { px, usd: (px - e.price) * dir * e.volume * contract, R: risk ? (px - e.price) * dir * e.volume * contract / risk : null };
      const best = ex ? { ...xv(ex.best), ms: toMs(ex.best_time) } : null, worst = ex ? { ...xv(ex.worst), ms: toMs(ex.worst_time) } : null;
      trades.push({
        id: pid, magic: e.magic, strat: s ? s.id : "manual", sname: s ? s.name : e.magic ? `Magic ${e.magic}` : "Manual",
        color: s ? s.color : "#747067", dir, side: dir === 1 ? "BUY" : "SELL", volume: e.volume, symbol: e.symbol,
        openMs: toMs(e.time), openPrice: e.price, initSL: e.sl || null, tp: (pos ? pos.tp : e.tp) || null, comment: e.comment, risk,
        trigger: /(?:^|\s)AS(?:\s|$)/.test(e.comment) ? "AS" : /(?:^|\s)PD(?:\s|$)/.test(e.comment) ? "PD" : null,
        open: !!pos, pos, pnl, R: risk ? pnl / risk : null,
        best, worst, exExact: ex ? ex.exact : null,
        closeMs: !pos && lastExit ? toMs(lastExit.time) : null, closePrice: !pos ? exitPx : null, reason: !pos && lastExit ? lastExit.reason : null,
      });
    }
    trades.sort((a, b) => a.openMs - b.openMs);
    const closed = trades.filter((t) => !t.open).sort((a, b) => a.closeMs - b.closeMs);
    const openT = trades.filter((t) => t.open);

    // fills blotter (every buy/sell deal)
    const byId = new Map(trades.map((t) => [t.id, t]));
    const fills = (d.deals || []).filter((x) => x.type <= 1).map((x) => ({
      ms: toMs(x.time), entry: x.entry, side: x.type === 0 ? "BUY" : "SELL", vol: x.volume, price: x.price,
      pl: (x.profit || 0) + (x.commission || 0) + (x.swap || 0) + (x.fee || 0), reason: x.reason, t: byId.get(x.position_id),
    })).sort((a, b) => b.ms - a.ms);

    // balance / equity curve: deals + minute snapshots
    const curve = []; let bal = 0;
    (d.deals || []).filter((x) => x.type === 2 || (x.type <= 1 && x.entry !== 0) || x.commission || x.fee)
      .map((x) => ({ ms: toMs(x.time), v: (x.profit || 0) + (x.commission || 0) + (x.swap || 0) + (x.fee || 0) }))
      .sort((a, b) => a.ms - b.ms).forEach((mv) => { bal += mv.v; curve.push({ ms: mv.ms, bal, eq: bal }); });
    for (const s of EQ) curve.push({ ms: s.t, bal: s.b, eq: s.e });
    curve.sort((a, b) => a.ms - b.ms);
    if (d.account) curve.push({ ms: Math.max(Date.now(), curve.length ? curve[curve.length - 1].ms + 1 : 0), bal: d.account.balance, eq: d.account.equity });
    let peak = -Infinity, maxDD = 0;
    for (const p of curve) { peak = Math.max(peak, p.eq); p.dd = peak > 0 ? (p.eq / peak - 1) * 100 : 0; maxDD = Math.min(maxDD, p.dd); }
    const deposits = (d.deals || []).filter((x) => x.type === 2).reduce((a, x) => a + x.profit, 0);

    const stats = { all: calcStats(closed) };
    for (const s of CFG.strategies) stats[s.id] = calcStats(closed.filter((t) => t.strat === s.id));

    const today = dayKey(Date.now());
    const weekStart = Date.now() - WD.indexOf(tfWd.format(Date.now())) * 86400000;
    const sumClosed = (f) => closed.filter(f).reduce((a, t) => a + t.pnl, 0);
    const floating = d.account ? d.account.profit : 0;
    const plToday = sumClosed((t) => dayKey(t.closeMs) === today);
    const plWeek = sumClosed((t) => dayKey(t.closeMs) >= dayKey(weekStart));
    const plMonth = sumClosed((t) => dayKey(t.closeMs).slice(0, 7) === today.slice(0, 7));

    let openRisk = 0, initRiskOpen = 0;
    for (const t of openT) {
      initRiskOpen += t.risk || 0;
      openRisk += t.pos.sl ? (t.pos.price_current - t.pos.sl) * t.dir * t.pos.volume * contract : t.risk || 0;
    }
    return { d, off, toMs, trades, closed, openT, fills, curve, maxDD, deposits, stats, plToday, plWeek, plMonth, floating, openRisk, initRiskOpen, contract };
  }

  function calcStats(list) {
    const n = list.length, Rs = list.filter((t) => t.R != null).map((t) => t.R);
    const wins = list.filter((t) => t.pnl > 0), losses = list.filter((t) => t.pnl <= 0);
    const gw = Rs.filter((r) => r > 0).reduce((a, b) => a + b, 0), gl = -Rs.filter((r) => r <= 0).reduce((a, b) => a + b, 0);
    let cum = 0, peak = 0, dd = 0, run = 0, maxRun = 0, cur = 0;
    for (const r of Rs) { cum += r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); run = r <= 0 ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    for (let i = list.length - 1; i >= 0; i--) { const w = list[i].pnl > 0; if (i === list.length - 1) cur = w ? 1 : -1; else if ((cur > 0) === w) cur += w ? 1 : -1; else break; }
    const holds = list.filter((t) => t.closeMs).map((t) => (t.closeMs - t.openMs) / 1000);
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    let c = 0; const cumArr = Rs.map((r) => (c += r));
    return {
      n, wins: wins.length, losses: losses.length, win: n ? wins.length / n * 100 : null,
      net: list.reduce((a, t) => a + t.pnl, 0), netR: Rs.reduce((a, b) => a + b, 0), avgR: avg(Rs),
      pf: gl > 0 ? gw / gl : gw > 0 ? Infinity : null,
      avgWinR: avg(wins.filter((t) => t.R != null).map((t) => t.R)), avgLossR: avg(losses.filter((t) => t.R != null).map((t) => t.R)),
      maxDDR: dd, maxLosingRun: maxRun, streak: cur, best: Rs.length ? Math.max(...Rs) : null, worst: Rs.length ? Math.min(...Rs) : null,
      avgHold: avg(holds), cum: cumArr,
    };
  }

  // ------------------------------------------------------------ building blocks
  const pageH = (crumb, title, right = "") => `<div class="page-h"><div><div class="crumb">${crumb}</div><h1>${title}</h1></div>${right ? `<div class="r">${right}</div>` : ""}</div>`;
  const pane = (title, body, { sub = "", r = "", flush = false } = {}) =>
    `<section class="pane"><div class="pane-h"><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}${r ? `<div class="r">${r}</div>` : ""}</div><div class="pane-b ${flush ? "flush" : ""}">${body}</div></section>`;
  const ws = (cls, ...kids) => `<div class="ws ${cls}">${kids.join("")}</div>`;
  const cell = (l, v, s = "", key = "") => `<div class="cell"><div class="l">${l}</div><div class="v" ${key ? `data-k="${key}"` : ""}>${v}</div><div class="s">${s || "&nbsp;"}</div></div>`;
  const strip = (...cells) => ws("c12", `<div class="strip">${cells.join("")}</div>`);
  const chartBox = (id, cls = "") => `<div class="chart ${cls}"><canvas id="${id}"></canvas></div>`;
  const sideTag = (t) => `<span class="tag ${t.dir === 1 ? "buy" : "sell"}">${t.side}</span>`;
  const sw = (c) => `<span class="sw" style="background:${c}"></span>`;
  const empty = (msg) => `<div class="empty">${msg}</div>`;
  const trigTag = (t) => t.trigger ? ` <span class="tag trg-tag" style="margin-left:6px">${t.trigger === "AS" ? "ASIA" : "PDAY"}</span>` : "";
  const stratCellH = (t) => `${sw(t.color)}${esc(t.sname)}${trigTag(t)}`;
  const slots = (used, max) => `<div class="slots ${used >= max ? "full" : ""}">${Array.from({ length: max }, (_, i) => `<i class="${i < used ? "on" : ""}"></i>`).join("")}</div>`;
  const linkTo = (href, label) => `<a class="link" href="${href}">${label} ${ico("arrow")}</a>`;
  const trendWord = (t) => t === 1 ? "up" : t === -1 ? "down" : "flat";

  function table(cols, rows, { sortKey, sortDesc, sortable, rowAttr } = {}) {
    if (!rows.length) return "";
    const hc = (c) => c.hide ? ` h-${c.hide}` : "";
    const th = cols.map((c) => `<th class="${c.n ? "n" : ""}${hc(c)} ${sortable && c.sort ? "s" : ""} ${sortKey && c.sort === sortKey ? "on" : ""}" ${sortable && c.sort ? `data-sort="${c.sort}"` : ""}>${c.h}${sortKey && c.sort === sortKey ? (sortDesc ? " ↓" : " ↑") : ""}</th>`).join("");
    const tr = rows.map((r, i) => `<tr ${rowAttr ? rowAttr(r, i) : ""}>${cols.map((c) => `<td class="${c.n ? "n" : ""}${hc(c)} ${c.cls || ""}">${c.f(r)}</td>`).join("")}</tr>${r.__det || ""}`).join("");
    return `<div class="tw"><table class="t"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  }

  function sparkline(vals, color, w = 120, h = 28) {
    if (!vals.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#2a2f36" stroke-dasharray="2 3"/></svg>`;
    const v = [0, ...vals], lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1)) * w},${h - 3 - ((x - lo) / span) * (h - 6)}`).join(" ");
    const zy = h - 3 - ((0 - lo) / span) * (h - 6);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${zy}" y2="${zy}" stroke="#2a2f36"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  }
  // live avg R (bar from zero) vs backtest (tick) on a −1R … +1.5R scale
  function bullet(live, bt, color) {
    const lo = -1, hi = 1.5, pos = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)), z = pos(0);
    const bar = live == null ? "" : live >= 0 ? `<i class="lv" style="left:${z}%;width:${pos(live) - z}%;background:${color}"></i>` : `<i class="lv" style="left:${pos(live)}%;width:${z - pos(live)}%;background:var(--down)"></i>`;
    return `<span class="bullet" title="live ${rr(live)} · backtest ${rr(bt)}"><i class="track"></i><i class="zero" style="left:${z}%"></i>${bar}<i class="bt" style="left:${pos(bt)}%"></i></span>`;
  }

  // ------------------------------------------------------------ charts
  if (window.Chart) {
    Chart.defaults.color = "#747067";
    Chart.defaults.borderColor = "#1e2227";
    Chart.defaults.font.family = '"Plex Mono", ui-monospace, monospace';
    Chart.defaults.font.size = 10.5;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = "#14171b";
    Chart.defaults.plugins.tooltip.borderColor = "#2a2f36";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.cornerRadius = 2;
    Chart.defaults.animation = false;
  }
  function drawChart(id, config) {
    const el = document.getElementById(id); if (!el || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
  }
  const axisR = { position: "right", grid: { color: "#17191d" }, border: { display: false } };
  const lineOpts = (yFmt, legend = false) => ({
    responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: legend, align: "end" }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}  ${yFmt(c.parsed.y)}` } } },
    scales: { x: { ticks: { maxTicksLimit: 7, maxRotation: 0, autoSkipPadding: 20 }, grid: { display: false }, border: { color: "#2a2f36" } }, y: { ...axisR, ticks: { callback: (v) => yFmt(v), maxTicksLimit: 6 } } },
    elements: { point: { radius: 0, hoverRadius: 3 }, line: { tension: 0, borderWidth: 1.6 } },
  });
  const barOpts = (yFmt, { legend = false, stacked = false } = {}) => ({
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: legend, align: "end" }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}  ${yFmt(c.parsed.y)}` } } },
    scales: { x: { grid: { display: false }, stacked, border: { color: "#2a2f36" } }, y: { ...axisR, stacked, ticks: { callback: (v) => yFmt(v), maxTicksLimit: 6 } } },
    datasets: { bar: { borderRadius: 0, maxBarThickness: 26 } },
  });
  const signCol = (arr) => arr.map((v) => v >= 0 ? "rgba(67,184,140,.85)" : "rgba(229,89,79,.85)");

  // ------------------------------------------------------------ shared sections
  function band(m) {
    const a = m.d.account, st = m.stats.all, cap = m.d.cap || { used: 0, max: CFG.cap_max };
    const base = m.deposits || a.balance, since = a.equity - base, sincePct = since / base * 100;
    return ws("c12", `<div class="band">
      <div class="hero"><div class="lbl">Equity · ${esc(a.currency)}</div>
        <div class="big" data-k="eq">${money(a.equity).replace(/(\.\d\d)$/, "<small>$1</small>")}</div>
        <div class="delta"><span class="${ud(since)}">${money(since, true)} · ${pct(sincePct, 2, true)}</span><span class="muted">since start</span></div></div>
      <div class="cells">
        ${cell("Balance", money(a.balance), "", "bal")}
        ${cell("Floating", `<span class="${ud(m.floating)}">${money(m.floating, true)}</span>`, `${m.openT.length} open`, "fl")}
        ${cell("Today", `<span class="${ud(m.plToday)}">${money(m.plToday, true)}</span>`, "closed · EAT", "td")}
        ${cell("Week", `<span class="${ud(m.plWeek)}">${money(m.plWeek, true)}</span>`, `month ${money(m.plMonth, true)}`)}
        ${cell("Net R", `<span class="${ud(st.netR)}">${rr(st.netR)}</span>`, `${st.n} closed`)}
        ${cell("Win rate", st.win == null ? "—" : pct(st.win), st.n ? `${st.wins}W · ${st.losses}L` : "no closes yet")}
        ${cell("Max drawdown", `<span class="${m.maxDD < 0 ? "down" : ""}">${pct(m.maxDD, 2)}</span>`, "from equity peak")}
        ${cell(m.openRisk >= 0 ? "At risk" : "Locked", `<span class="${m.openRisk > 0 ? "warn" : "up"}">${money(Math.abs(m.openRisk))}</span>`, m.openT.length ? `${pct(Math.abs(m.openRisk) / a.equity * 100, 2)} of equity` : "flat")}
        ${cell("Trades today", `${cap.used}<span class="muted"> / ${cap.max}</span>`, slots(cap.used, cap.max))}
      </div></div>`);
  }

  function book(m) {
    if (!m.openT.length) return empty(`Flat — no open positions.<br>EAs trade <b>London 10:00–14:00</b> and <b>NY 15:30–20:00</b> EAT.`);
    return m.openT.map((t) => {
      const p = t.pos, sl = p.sl || t.initSL, cur = p.price_current;
      const oneR = t.initSL ? Math.abs(t.openPrice - t.initSL) : null, tgt = oneR ? t.openPrice + t.dir * oneR : null;
      const pts = [sl, t.openPrice, cur, tgt].filter((v) => v != null);
      const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1, x = (v) => 6 + ((v - lo) / span) * 88;   // 6–94% keeps labels inside
      const good = (cur - t.openPrice) * t.dir >= 0;
      return `<div class="book-row">
        <div class="top">${sideTag(t)}<b style="font-weight:500">${esc(t.sname)}</b>${t.trigger ? `<span class="tag">${t.trigger === "AS" ? "ASIA" : "PDAY"}</span>` : ""}<span class="meta">${num(p.volume, 2)} lot</span></div>
        <div class="pl ${ud(t.pnl)}" data-k="bk${t.id}">${money(t.pnl, true)}</div>
        <div class="meta">${num(t.openPrice, 2)} → <span style="color:var(--text)">${num(cur, 2)}</span> · ${dur((Date.now() - t.openMs) / 1000)}</div>
        <div class="rr ${ud(t.R)}">${rr(t.R)}</div>
        <div class="gauge"><i class="rail"></i><i class="fill" style="left:${Math.min(x(t.openPrice), x(cur))}%;width:${Math.abs(x(cur) - x(t.openPrice))}%;background:${good ? "var(--up)" : "var(--down)"}"></i>
          ${sl ? `<i class="mk" style="left:${x(sl)}%;background:var(--down)"></i><span class="lab" style="left:${x(sl)}%;color:var(--down)">SL ${num(sl, 2)}</span>` : ""}
          <i class="mk entry" style="left:${x(t.openPrice)}%"></i>
          ${tgt ? `<i class="mk" style="left:${x(tgt)}%;background:var(--up)"></i><span class="lab" style="left:${x(tgt)}%;color:var(--up)">+1R</span>` : ""}
          <i class="now" style="left:${x(cur)}%;background:${good ? "var(--up)" : "var(--down)"}"></i></div>
      </div>`;
    }).join("");
  }

  function verdict(s, st) {
    if (st.n < 30) return `<span class="tag">${st.n}/30</span>`;
    return st.avgR >= s.backtest.pass_avg_r ? `<span class="tag ok">Pass</span>` : `<span class="tag bad">Fail</span>`;
  }
  function strategiesTable(m, detailed = false) {
    const rows = CFG.strategies.map((s) => ({ s, st: m.stats[s.id], open: m.openT.filter((t) => t.strat === s.id) }));
    const openPl = (r) => r.open.reduce((a, t) => a + t.pnl, 0);
    return table([
      { h: "Strategy", f: (r) => `<a href="#/strategy/${r.s.id}" style="display:flex;align-items:center">${sw(r.s.color)}<span class="srow-name"><b>${esc(r.s.name)}</b><span>${esc(r.s.title)} · ${r.s.timeframe}</span></span></a>` },
      { h: "Sample", hide: "lg", f: (r) => verdict(r.s, r.st) },
      { h: "Trades", n: 1, hide: "sm", f: (r) => `${r.st.n}${detailed ? `<span class="muted"> · ~${r.s.backtest.trades_per_year}/yr</span>` : ""}` },
      { h: "Open", n: 1, hide: "lg", f: (r) => r.open.length ? `${r.open.length} <span class="${ud(openPl(r))}">${money(openPl(r), true)}</span>` : `<span class="muted">—</span>` },
      { h: "Win %", n: 1, hide: "sm", f: (r) => `${r.st.win == null ? "—" : pct(r.st.win, 0)}<span class="muted"> / ${pct(r.s.backtest.win_pct, 0)}</span>` },
      { h: "Avg R · live / BT", f: (r) => `<span style="display:inline-flex;align-items:center;gap:10px">${bullet(r.st.avgR, r.s.backtest.avg_r, r.s.color)}<span class="m"><span class="${ud(r.st.avgR)}">${r.st.avgR == null ? "—" : num(r.st.avgR, 2, true)}</span><span class="muted"> / ${num(r.s.backtest.avg_r, 2, true)}</span></span></span>` },
      ...(detailed ? [
        { h: "PF", n: 1, hide: "md", f: (r) => `${r.st.pf == null ? "—" : r.st.pf === Infinity ? "∞" : num(r.st.pf, 2)}<span class="muted"> / ${num(r.s.backtest.pf, 2)}</span>` },
        { h: "Max DD", n: 1, hide: "md", f: (r) => `${r.st.n ? num(r.st.maxDDR, 1) + "R" : "—"}<span class="muted"> / ${num(r.s.backtest.max_dd_r, 1)}R</span>` },
      ] : []),
      { h: "Net R", n: 1, f: (r) => `<span class="${ud(r.st.netR)}">${rr(r.st.netR)}</span>` },
      { h: "Net P/L", n: 1, hide: "sm", f: (r) => `<span class="${ud(r.st.net)}">${money(r.st.net, true)}</span>` },
      { h: "Cum R", hide: "lg", f: (r) => sparkline(r.st.cum, r.s.color) },
    ], rows);
  }

  function blotter(m, limit = 12) {
    return table([
      { h: "Time", f: (f) => `<span class="m t2" title="${fmtTime(f.ms)}">${shortTime(f.ms)}</span>` },
      { h: "Strategy", f: (f) => f.t ? stratCellH(f.t) : "—" },
      { h: "Action", hide: "sm", f: (f) => f.entry === 0 ? `<span class="tag gold">Open</span>` : `<span class="tag">Close</span>` },
      { h: "Side", f: (f) => `<span class="tag ${f.side === "BUY" ? "buy" : "sell"}">${f.side}</span>` },
      { h: "Lots", n: 1, hide: "md", f: (f) => num(f.vol, 2) },
      { h: "Price", n: 1, hide: "sm", f: (f) => num(f.price, 2) },
      { h: "Result", n: 1, f: (f) => f.entry === 0 ? `<span class="tag gold">open</span>` : `<span class="${ud(f.pl)}">${money(f.pl, true)}</span>` },
    ], m.fills.slice(0, limit));
  }

  // ------------------------------------------------------------ sessions (EAT minutes)
  const WINDOWS = [
    { n: "Asia range", w: [180, 600], c: "#7f9fca", who: "Strategy C builds its range" },
    { n: "London", w: [600, 840], c: "#d6a94e", who: "Strategy 1 · Strategy C" },
    { n: "VWAP fade", w: [600, 720], c: "#a990c7", who: "Strategy 2", low: true },
    { n: "New York", w: [930, 1200], c: "#d6a94e", who: "Strategy 1 · Strategy C" },
  ];
  function timeline() {
    const x = eatMinutes(Date.now()), p = (mins) => `${mins / 1440 * 100}%`;
    let h = `<div class="tl"><i class="axis"></i>`;
    for (const s of WINDOWS) {
      const live = x >= s.w[0] && x < s.w[1];
      h += `<div class="seg" style="left:${p(s.w[0])};width:${p(s.w[1] - s.w[0])};top:${s.low ? 35 : 22}px;height:${s.low ? 5 : 9}px;border-color:${s.c};background:${live ? s.c + "66" : s.c + "1c"}">${s.low ? "" : `<span style="color:${s.c}">${s.n}</span>`}</div>`;
    }
    for (let hr = 0; hr <= 24; hr += 3) h += `<span class="hr" style="left:${p(hr * 60)}">${String(hr % 24).padStart(2, "0")}</span>`;
    return h + `<i class="needle" style="left:${p(x)}" title="now"></i></div>`;
  }
  function sessionNow() {
    const x = eatMinutes(Date.now()), live = WINDOWS.filter((s) => x >= s.w[0] && x < s.w[1]);
    if (live.length) return { label: live.map((s) => s.n).join(" + "), sub: `closes in ${dur((Math.min(...live.map((s) => s.w[1])) - x) * 60)}`, live: true };
    const next = WINDOWS.map((s) => ({ s, in: (s.w[0] - x + 1440) % 1440 })).sort((a, b) => a.in - b.in)[0];
    return { label: "Off-session", sub: `${next.s.n} in ${dur(next.in * 60)}`, live: false };
  }
  const SESS = ["Asian", "London", "New York", "Other"];
  const sessionOf = (ms) => { const x = eatMinutes(ms); return x >= 180 && x < 600 ? "Asian" : x >= 600 && x < 840 ? "London" : x >= 930 && x < 1200 ? "New York" : "Other"; };

  // ------------------------------------------------------------ pages
  const PAGES = {};

  PAGES.overview = {
    title: "Overview",
    render(m) {
      const k = m.d.market, sess = sessionNow();
      const bias = k.bias === 1 ? ["long", "LONG ONLY"] : k.bias === -1 ? ["short", "SHORT ONLY"] : ["", "NO TRADE"];
      return `${pageH(`${esc(m.d.account.server)} · account ${m.d.account.login}`, "Overview", `<span class="tag ${sess.live ? "ok" : ""}">${esc(sess.label)}</span><span class="m muted" style="font-size:12px">${esc(sess.sub)}</span>`)}
        ${band(m)}
        ${ws("c8-4",
          pane("Equity curve", chartBox("ch-eq", "tall"), { r: segEq() }),
          pane("Book", book(m), { flush: true, sub: `${m.openT.length} open`, r: linkTo("#/positions", "Positions") }))}
        ${ws("c12", pane("Strategies", strategiesTable(m), { flush: true, sub: "live vs backtest · 2% risk", r: linkTo("#/strategies", "Scorecard") }))}
        ${ws("c7-5",
          pane("Blotter", blotter(m, 10) || empty("No fills yet."), { flush: true, sub: "latest fills", r: linkTo("#/trades", "All trades") }),
          pane("Market", `<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap"><span class="px" data-k="px">${num(k.bid, 2)}</span><span class="m muted">XAUUSD · spread ${num(k.spread, 2)}</span></div>
            <div class="bias-line ${bias[0]}" style="margin:12px 0 6px"><span class="t">${bias[1]}</span><span class="muted" style="font-size:12px">D1 ${trendWord(k.d1.trend)} · H4 ${trendWord(k.h4.trend)}</span></div>
            ${timeline()}
            <div class="kv" style="margin:8px -14px -14px;border-top:1px solid var(--line)">
              <span class="k">Prev-day high</span><span class="v">${num(k.prev_high, 2)} <span class="muted">${num(k.prev_high - k.bid, 2, true)}</span></span>
              <span class="k">Prev-day low</span><span class="v">${num(k.prev_low, 2)} <span class="muted">${num(k.prev_low - k.bid, 2, true)}</span></span>
              <span class="k">H4 ATR</span><span class="v">${num(k.atr_h4, 2)}</span></div>`, { r: linkTo("#/market", "Market") }))}`;
    },
    after(m) { drawEquity(m, "ch-eq"); bindEq(); },
  };
  const segEq = () => `<div class="seg">${[["1d", "1D"], ["7d", "7D"], ["30d", "30D"], ["all", "ALL"]].map(([k, l]) => `<button data-eqr="${k}" class="${ui.eqRange === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const bindEq = () => document.querySelectorAll("[data-eqr]").forEach((b) => b.onclick = () => { ui.eqRange = b.dataset.eqr; render(); });
  function drawEquity(m, id) {
    const span = { "1d": 1, "7d": 7, "30d": 30 }[ui.eqRange];
    const pts = span ? m.curve.filter((p) => p.ms >= Date.now() - span * 86400000) : m.curve;
    drawChart(id, { type: "line", data: { labels: pts.map((p) => fmtTime(p.ms)), datasets: [
      { label: "Equity", data: pts.map((p) => p.eq), borderColor: "#d6a94e", backgroundColor: "rgba(214,169,78,.06)", fill: "start" },
      { label: "Balance", data: pts.map((p) => p.bal), borderColor: "#7f9fca", borderWidth: 1.2, borderDash: [3, 3], stepped: true },
    ] }, options: lineOpts((v) => "$" + num(v, 0), true) });
  }

  PAGES.positions = {
    title: "Positions",
    render(m) {
      const eq = m.d.account.equity, fl = m.openT.reduce((a, t) => a + t.pnl, 0);
      const cols = [
        { h: "Strategy", f: (t) => stratCellH(t) },
        { h: "Side", f: (t) => sideTag(t) },
        { h: "Lots", n: 1, hide: "sm", f: (t) => num(t.pos.volume, 2) },
        { h: "Opened", hide: "md", f: (t) => `<span class="m t2">${fmtTime(t.openMs)}</span>` },
        { h: "Entry", n: 1, hide: "sm", f: (t) => num(t.openPrice, 2) },
        { h: "Price", n: 1, hide: "sm", f: (t) => num(t.pos.price_current, 2) },
        { h: "Stop", n: 1, hide: "md", f: (t) => slCell(t) },
        { h: "To stop", n: 1, hide: "md", f: (t) => t.pos.sl ? num(Math.abs(t.pos.price_current - t.pos.sl), 2) : "—" },
        { h: "Risk", n: 1, hide: "md", f: (t) => money(t.risk) },
        { h: "P/L", n: 1, f: (t) => `<span class="${ud(t.pnl)}">${money(t.pnl, true)}</span>` },
        { h: "R", n: 1, f: (t) => `<span class="${ud(t.R)}">${rr(t.R)}</span>` },
        { h: "Held", n: 1, hide: "sm", f: (t) => dur((Date.now() - t.openMs) / 1000) },
      ];
      return `${pageH("Live book", "Positions")}
        ${strip(cell("Open", m.openT.length, m.openT.length ? [...new Set(m.openT.map((t) => t.sname))].join(", ") : "flat"),
          cell("Floating", `<span class="${ud(fl)}">${money(fl, true)}</span>`, `${pct(fl / eq * 100, 2, true)} of equity`, "pfl"),
          cell("Initial risk", money(m.initRiskOpen), `${pct(m.initRiskOpen / eq * 100, 2)} of equity`),
          cell(m.openRisk >= 0 ? "At risk to stops" : "Locked by stops", `<span class="${m.openRisk > 0 ? "warn" : "up"}">${money(Math.abs(m.openRisk))}</span>`, "from current price"),
          cell("Margin", money(m.d.account.margin), `level ${m.d.account.margin_level ? pct(m.d.account.margin_level, 0) : "—"}`))}
        ${ws("c8-4", pane("Positions", table(cols, m.openT) || empty("Flat — no open positions."), { flush: true, sub: "live · 3 s" }),
          pane("Stop map", book(m), { flush: true, sub: "stop · entry · +1R" }))}
        <div class="note" style="padding:0 2px"><b>R</b> = current P/L ÷ money at risk when the trade opened. <b>Trailed</b> = the EA has moved the stop; <b>locked</b> = the stop is past entry, so the trade can no longer lose. Stops sit on the broker's server and work even if MT5 is offline.</div>`;
    },
  };
  function slCell(t) {
    const cur = t.pos.sl, init = t.initSL;
    if (!cur) return "—";
    const moved = init && Math.abs(cur - init) > 0.005, locked = (cur - t.openPrice) * t.dir >= 0;
    return `${num(cur, 2)}${moved ? ` <span class="tag ${locked ? "ok" : "info"}" title="initial ${num(init, 2)}">${locked ? "locked" : "trailed"}</span>` : ""}`;
  }

  PAGES.trades = {
    title: "Trades",
    render(m) {
      const f = ui.trades, list = filterTrades(m.trades), st = calcStats(list.filter((t) => !t.open));
      const opts = [["all", "All strategies"], ...CFG.strategies.map((s) => [s.id, s.name]), ["manual", "Manual"]];
      const filters = `<div class="ctl">
        <select id="f-strat">${opts.map(([v, l]) => `<option value="${v}" ${f.strat === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="f-dir"><option value="all">Buy + sell</option><option value="1" ${f.dir === "1" ? "selected" : ""}>Buy</option><option value="-1" ${f.dir === "-1" ? "selected" : ""}>Sell</option></select>
        <select id="f-res"><option value="all">All results</option><option value="win" ${f.res === "win" ? "selected" : ""}>Winners</option><option value="loss" ${f.res === "loss" ? "selected" : ""}>Losers</option><option value="open" ${f.res === "open" ? "selected" : ""}>Open</option></select>
        <input type="date" id="f-from" value="${f.from}" aria-label="From"><input type="date" id="f-to" value="${f.to}" aria-label="To">
        <button class="btn" id="f-csv">${ico("download")}CSV</button></div>`;
      return `${pageH("History", "Trades", filters)}
        ${strip(cell("Trades", list.length, `${list.filter((t) => t.open).length} open`), cell("Win rate", st.win == null ? "—" : pct(st.win), `${st.wins}W · ${st.losses}L`),
          cell("Net P/L", `<span class="${ud(st.net)}">${money(st.net, true)}</span>`, "closed only"), cell("Net R", `<span class="${ud(st.netR)}">${rr(st.netR)}</span>`, `avg ${rr(st.avgR)}`),
          cell("Profit factor", st.pf == null ? "—" : st.pf === Infinity ? "∞" : num(st.pf, 2), "in R"), cell("Max DD", st.n ? rr(-st.maxDDR) : "—", `losing run ${st.maxLosingRun}`))}
        ${ws("c12", pane("Trade log", table(tradeCols(), sortTrades(list).map((t) => ({ ...t, __det: f.open === t.id ? tradeDetail(t) : "" })), { sortKey: f.sort, sortDesc: f.desc, sortable: true, rowAttr: (t) => `class="click" data-tid="${t.id}"` }) || empty("No trades match these filters."), { flush: true, sub: "click a row for details" }))}`;
    },
    after(m) {
      const f = ui.trades;
      const bind = (id, k) => { const el = document.getElementById(id); if (el) el.onchange = () => { f[k] = el.value; render(); }; };
      bind("f-strat", "strat"); bind("f-dir", "dir"); bind("f-res", "res"); bind("f-from", "from"); bind("f-to", "to");
      document.querySelectorAll("th[data-sort]").forEach((th) => th.onclick = () => { const k = th.dataset.sort; if (f.sort === k) f.desc = !f.desc; else { f.sort = k; f.desc = true; } render(); });
      document.querySelectorAll("tr[data-tid]").forEach((tr) => tr.onclick = () => { const id = Number(tr.dataset.tid); f.open = f.open === id ? null : id; render(); });
      const csv = document.getElementById("f-csv"); if (csv) csv.onclick = () => exportCsv(sortTrades(filterTrades(m.trades)));
    },
  };
  function filterTrades(list) {
    const f = ui.trades;
    return list.filter((t) => (f.strat === "all" || t.strat === f.strat) && (f.dir === "all" || String(t.dir) === f.dir) &&
      (f.res === "all" || (f.res === "open" ? t.open : !t.open && (f.res === "win" ? t.pnl > 0 : t.pnl <= 0))) &&
      (!f.from || dayKey(t.openMs) >= f.from) && (!f.to || dayKey(t.openMs) <= f.to));
  }
  function sortTrades(list) {
    const f = ui.trades, k = { open: (t) => t.openMs, close: (t) => t.closeMs || Infinity, pnl: (t) => t.pnl, r: (t) => t.R ?? -Infinity, strat: (t) => t.sname, lots: (t) => t.volume }[f.sort] || ((t) => t.openMs);
    return [...list].sort((a, b) => { const x = k(a), y = k(b); return (x < y ? -1 : x > y ? 1 : 0) * (f.desc ? -1 : 1); });
  }
  // farthest point in favour: shown for losing (or breakeven) closed trades, and live for open ones
  const peakShown = (t) => t.best && (t.open || t.pnl <= 0);
  const peakCell = (t) => {
    if (!peakShown(t)) return `<span class="muted">—</span>`;
    const b = t.best, r = b.R != null ? rr(b.R) : money(b.usd, true);
    return `<span title="Farthest in favour${t.open ? " so far" : ""}: ${num(b.px, 2)} at ${fmtTime(b.ms)} (${money(b.usd, true)})">${num(b.px, 2)} <span class="${b.usd > 0 ? "up" : "muted"}">${r}</span></span>`;
  };
  const tradeCols = () => [
    { h: "Opened", sort: "open", hide: "sm", f: (t) => `<span class="m t2">${fmtTime(t.openMs)}</span>` },
    { h: "Strategy", sort: "strat", cls: "strat", f: (t) => stratCellH(t) },
    { h: "Side", f: (t) => sideTag(t) },
    { h: "Lots", sort: "lots", n: 1, hide: "md", f: (t) => num(t.volume, 2) },
    { h: "Entry", n: 1, hide: "sm", f: (t) => num(t.openPrice, 2) },
    { h: "Exit", n: 1, hide: "sm", f: (t) => t.open ? `<span class="tag gold">open</span>` : num(t.closePrice, 2) },
    { h: "Closed", sort: "close", hide: "md", f: (t) => t.open ? `<span class="muted">—</span>` : `<span class="m t2">${fmtTime(t.closeMs)}</span>` },
    { h: "Exit reason", hide: "md", f: (t) => t.open ? `<span class="muted">—</span>` : esc(REASON[t.reason] ?? t.reason) },
    { h: "P/L", sort: "pnl", n: 1, f: (t) => `<span class="${ud(t.pnl)}">${money(t.pnl, true)}</span>` },
    { h: "R", sort: "r", n: 1, f: (t) => `<span class="${ud(t.R)}">${rr(t.R)}</span>` },
    { h: "Peak", n: 1, hide: "sm", f: peakCell },
  ];
  function tradeDetail(t) {
    const held = ((t.closeMs || Date.now()) - t.openMs) / 1000;
    const kv = [["Opened", fmtTime(t.openMs)], ["Entry", num(t.openPrice, 2)], ["Lots", num(t.volume, 2)], ["Closed", t.open ? "open" : fmtTime(t.closeMs)], ["Exit", t.open ? "—" : num(t.closePrice, 2)], ["Exit reason", t.open ? "—" : esc(REASON[t.reason] ?? t.reason)],
      ["Position", `#${t.id}`], ["Magic", t.magic], ["Initial stop", t.initSL ? num(t.initSL, 2) : "—"], ["Stop distance", t.initSL ? num(Math.abs(t.openPrice - t.initSL), 2) : "—"],
      ["Risk at entry", money(t.risk)], ["Target", t.tp ? num(t.tp, 2) : "none"], ["Held", dur(held)], ["Trigger", t.trigger === "AS" ? "Asian-range break" : t.trigger === "PD" ? "Prev-day break" : "—"], ["EA comment", esc(t.comment)]];
    const exc = (x) => x ? `${num(x.px, 2)} · <span class="${ud(x.usd)}">${x.R != null ? rr(x.R) : money(x.usd, true)}</span> · ${money(x.usd, true)}<div class="muted">${fmtTime(x.ms)}</div>` : "—";
    kv.splice(6, 0, [`Farthest in favour${t.open ? " so far" : ""}`, exc(t.best)], [`Farthest against${t.open ? " so far" : ""}`, exc(t.worst)]);
    return `<tr class="det"><td colspan="11"><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px 24px">${kv.map(([k, v]) => `<div><div class="muted" style="font:500 10px var(--mono);letter-spacing:.1em;text-transform:uppercase">${k}</div><div class="m">${v}</div></div>`).join("")}</div></td></tr>`;
  }
  function exportCsv(list) {
    const head = ["position", "strategy", "magic", "side", "lots", "opened_eat", "entry", "initial_sl", "closed_eat", "exit", "exit_reason", "pnl", "risk", "R", "best_price", "best_R", "worst_price", "worst_R", "trigger", "status"];
    const rows = list.map((t) => [t.id, t.sname, t.magic, t.side, t.volume, fmtTime(t.openMs), t.openPrice, t.initSL ?? "", t.closeMs ? fmtTime(t.closeMs) : "", t.closePrice ?? "", t.open ? "" : REASON[t.reason] ?? t.reason, t.pnl.toFixed(2), t.risk?.toFixed(2) ?? "", t.R?.toFixed(3) ?? "", t.best?.px ?? "", t.best?.R?.toFixed(3) ?? "", t.worst?.px ?? "", t.worst?.R?.toFixed(3) ?? "", t.trigger ?? "", t.open ? "open" : "closed"]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `gold-desk-trades-${dayKey(Date.now())}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  PAGES.strategies = {
    title: "Strategies",
    render(m) {
      return `${pageH("Live vs backtest · 2% risk · Jan 2020 – Nov 2026", "Strategies")}
        ${ws("c12", pane("Scorecard", strategiesTable(m, true), { flush: true, sub: "live / backtest" }))}
        ${ws("c6-6", pane("Cumulative R", chartBox("ch-cumr", "tall"), { sub: "closed trades in order" }), pane("Net P/L", chartBox("ch-netpl", "tall")))}
        <div class="note" style="padding:0 2px">Each strategy is judged on its own after <b>30 trades</b>, per your register. Before that the sample is too small — a 25–30% win-rate system can lose 10+ in a row and still be on track.</div>`;
    },
    after(m) {
      const series = CFG.strategies.map((s) => ({ s, pts: m.stats[s.id].cum }));
      const maxN = Math.max(1, ...series.map((x) => x.pts.length));
      drawChart("ch-cumr", { type: "line", data: { labels: Array.from({ length: maxN }, (_, i) => `#${i + 1}`), datasets: series.map((x) => ({ label: x.s.name, data: x.pts, borderColor: x.s.color })) }, options: lineOpts((v) => num(v, 1) + "R", true) });
      drawChart("ch-netpl", { type: "bar", data: { labels: CFG.strategies.map((s) => s.name), datasets: [{ label: "Net P/L", data: CFG.strategies.map((s) => m.stats[s.id].net), backgroundColor: CFG.strategies.map((s) => s.color) }] }, options: barOpts((v) => "$" + num(v, 0)) });
    },
  };

  PAGES.strategy = {
    title: "Strategy",
    render(m) {
      const s = CFG.strategies.find((x) => x.id === route.arg) || CFG.strategies[0];
      PAGES.strategy.title = s.name;
      const st = m.stats[s.id], bt = s.backtest, list = m.trades.filter((t) => t.strat === s.id), open = list.filter((t) => t.open);
      const cmp = (l, live, b, fmt, better = 1) => {
        const state = live == null || st.n < 10 ? `<span class="tag">early</span>` : (live - b) * better >= 0 ? `<span class="tag ok">≥ BT</span>` : `<span class="tag warn">below</span>`;
        return `<tr><td class="t2">${l}</td><td class="n">${live == null ? "—" : fmt(live)}</td><td class="n muted">${fmt(b)}</td><td style="text-align:right">${state}</td></tr>`;
      };
      const vs = `<div class="tw"><table class="t"><thead><tr><th>Metric</th><th class="n">Live</th><th class="n">Backtest</th><th></th></tr></thead><tbody>
        ${cmp("Average R / trade", st.avgR, bt.avg_r, (v) => num(v, 2, true) + "R")}
        ${cmp("Win rate", st.win, bt.win_pct, (v) => pct(v, 1))}
        ${cmp("Profit factor", st.pf === Infinity ? 99 : st.pf, bt.pf, (v) => num(v, 2))}
        ${cmp("Average win", st.avgWinR, bt.avg_win_r, (v) => num(v, 2, true) + "R")}
        ${cmp("Average loss", st.avgLossR, bt.avg_loss_r, (v) => num(v, 2, true) + "R")}
        ${cmp("Max drawdown", st.n ? st.maxDDR : null, bt.max_dd_r, (v) => num(v, 1) + "R", -1)}
        ${cmp("Longest losing run", st.n ? st.maxLosingRun : null, bt.losing_run, (v) => String(Math.round(v)), -1)}
      </tbody></table></div>`;
      const tabs = `<div class="seg">${CFG.strategies.map((x) => `<button data-goto="${x.id}" class="${x.id === s.id ? "on" : ""}">${esc(x.name.replace("Strategy ", "S"))}</button>`).join("")}</div>`;
      const trig = s.triggers ? Object.entries(s.triggers).map(([k, label]) => ({ label, ...calcStats(m.closed.filter((t) => t.strat === s.id && t.trigger === k)) })) : null;
      return `${pageH(`${esc(s.style)} · ${s.timeframe} · magic ${s.magic} · v${esc(s.version)} · ${s.risk_pct}% risk`, `${sw(s.color)}${esc(s.name)} <span class="muted" style="font-weight:400">${esc(s.title)}</span>`, `${verdict(s, st)}${tabs}`)}
        ${ws("c12", `<div class="note" style="padding:12px 14px">${esc(s.summary)}</div>`)}
        ${strip(cell("Trades", st.n, `${open.length} open · ~${bt.trades_per_year}/yr`), cell("Win rate", st.win == null ? "—" : pct(st.win), `${st.wins}W · ${st.losses}L`),
          cell("Net P/L", `<span class="${ud(st.net)}">${money(st.net, true)}</span>`), cell("Net R", `<span class="${ud(st.netR)}">${rr(st.netR)}</span>`, `avg ${rr(st.avgR)}`),
          cell("Profit factor", st.pf == null ? "—" : st.pf === Infinity ? "∞" : num(st.pf, 2)), cell("Max DD", st.n ? `${num(st.maxDDR, 1)}R` : "—", `losing run ${st.maxLosingRun}`),
          cell("Streak", st.streak ? `<span class="${st.streak > 0 ? "up" : "down"}">${Math.abs(st.streak)}${st.streak > 0 ? "W" : "L"}</span>` : "—", `best ${rr(st.best)} · worst ${rr(st.worst)}`), cell("Avg hold", dur(st.avgHold)))}
        ${ws("c8-4", pane("Cumulative R", chartBox("ch-s-cum", "tall")), pane("Live vs backtest", vs, { flush: true, sub: bt.period }))}
        ${ws("c4-4-4", pane("R distribution", chartBox("ch-s-hist", "short")), pane("R by weekday", chartBox("ch-s-wd", "short"), { sub: "EAT" }),
          trig ? pane("By trigger", `<div class="tw"><table class="t"><thead><tr><th>Trigger</th><th class="n">Trades</th><th class="n h-sm">Win</th><th class="n">Avg R</th><th class="n">Net R</th></tr></thead><tbody>${trig.map((x) => `<tr><td>${x.label}</td><td class="n">${x.n}</td><td class="n h-sm">${x.win == null ? "—" : pct(x.win, 0)}</td><td class="n ${ud(x.avgR)}">${rr(x.avgR)}</td><td class="n ${ud(x.netR)}">${rr(x.netR)}</td></tr>`).join("")}</tbody></table></div>`, { flush: true }) : pane("R by session", chartBox("ch-s-sess", "short")))}
        ${ws("c12", pane("Trades", table(tradeCols(), [...list].reverse()) || empty("No trades yet for this strategy."), { flush: true }))}`;
    },
    after(m) {
      document.querySelectorAll("[data-goto]").forEach((b) => b.onclick = () => { location.hash = `#/strategy/${b.dataset.goto}`; });
      const s = CFG.strategies.find((x) => x.id === route.arg) || CFG.strategies[0];
      const cl = m.closed.filter((t) => t.strat === s.id && t.R != null);
      drawChart("ch-s-cum", { type: "line", data: { labels: cl.map((t) => fmtTime(t.closeMs)), datasets: [{ label: "Cumulative R", data: m.stats[s.id].cum, borderColor: s.color, backgroundColor: s.color + "14", fill: "origin" }] }, options: lineOpts((v) => num(v, 1) + "R") });
      const edges = [-1, -0.5, 0, 0.5, 1, 2, 3, 5, 10], labels = ["≤−1", "−1/−.5", "−.5/0", "0/.5", ".5/1", "1/2", "2/3", "3/5", "5/10", ">10"];
      const counts = new Array(labels.length).fill(0);
      cl.forEach((t) => { let i = edges.findIndex((e) => t.R <= e); if (i < 0) i = labels.length - 1; counts[i]++; });
      drawChart("ch-s-hist", { type: "bar", data: { labels, datasets: [{ label: "Trades", data: counts, backgroundColor: labels.map((_, i) => i < 3 ? "rgba(229,89,79,.8)" : "rgba(67,184,140,.8)") }] }, options: barOpts((v) => String(v)) });
      const wd = WD.slice(0, 5).map((w) => cl.filter((t) => tfWd.format(t.openMs) === w).reduce((a, t) => a + t.R, 0));
      drawChart("ch-s-wd", { type: "bar", data: { labels: WD.slice(0, 5), datasets: [{ label: "Net R", data: wd, backgroundColor: signCol(wd) }] }, options: barOpts((v) => num(v, 1) + "R") });
      if (document.getElementById("ch-s-sess")) {
        const ss = SESS.map((n) => cl.filter((t) => sessionOf(t.openMs) === n).reduce((a, t) => a + t.R, 0));
        drawChart("ch-s-sess", { type: "bar", data: { labels: SESS, datasets: [{ label: "Net R", data: ss, backgroundColor: signCol(ss) }] }, options: barOpts((v) => num(v, 1) + "R") });
      }
    },
  };

  PAGES.analytics = {
    title: "Analytics",
    render(m) {
      const cl = m.closed, L = calcStats(cl.filter((t) => t.dir === 1)), S = calcStats(cl.filter((t) => t.dir === -1));
      const ls = `<div class="tw"><table class="t"><thead><tr><th></th><th class="n">Trades</th><th class="n h-sm">Win</th><th class="n">Avg R</th><th class="n">Net R</th><th class="n h-sm">Net P/L</th></tr></thead><tbody>
        ${[["Long", L], ["Short", S]].map(([l, s]) => `<tr><td>${l}</td><td class="n">${s.n}</td><td class="n h-sm">${s.win == null ? "—" : pct(s.win, 0)}</td><td class="n ${ud(s.avgR)}">${rr(s.avgR)}</td><td class="n ${ud(s.netR)}">${rr(s.netR)}</td><td class="n h-sm ${ud(s.net)}">${money(s.net, true)}</td></tr>`).join("")}</tbody></table></div>`;
      return `${pageH("All strategies · closed trades · EAT", "Analytics")}
        ${cl.length < 10 ? `<div class="banner warn">${ico("analytics")}<span>${cl.length} closed trade${cl.length === 1 ? "" : "s"} so far — these breakdowns become meaningful after a few dozen.</span></div>` : ""}
        ${ws("c12", pane("Daily P/L", calendar(m), { sub: "last 26 weeks" }))}
        ${ws("c4-4-4", pane("By weekday", chartBox("ch-a-wd", "short")), pane("By entry hour", chartBox("ch-a-hr", "short"), { sub: "EAT" }), pane("By session", chartBox("ch-a-ss", "short")))}
        ${ws("c6-6", pane("Long vs short", ls, { flush: true }), pane("Strategy correlation", corrTable(m), { flush: true, sub: "daily R" }))}
        ${ws("c12", pane("Monthly P/L", chartBox("ch-a-mo"), { sub: "stacked by strategy" }))}`;
    },
    after(m) {
      const cl = m.closed, by = (keys, f) => keys.map((k) => cl.filter((t) => f(t) === k).reduce((a, t) => a + t.pnl, 0));
      const wd = by(WD.slice(0, 5), (t) => tfWd.format(t.openMs));
      drawChart("ch-a-wd", { type: "bar", data: { labels: WD.slice(0, 5), datasets: [{ label: "P/L", data: wd, backgroundColor: signCol(wd) }] }, options: barOpts((v) => "$" + num(v, 0)) });
      const hrs = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
      const hr = by(hrs, (t) => tfHour.format(t.openMs).padStart(2, "0").slice(-2));
      drawChart("ch-a-hr", { type: "bar", data: { labels: hrs, datasets: [{ label: "P/L", data: hr, backgroundColor: signCol(hr) }] }, options: barOpts((v) => "$" + num(v, 0)) });
      const ss = by(SESS, (t) => sessionOf(t.openMs));
      drawChart("ch-a-ss", { type: "bar", data: { labels: SESS, datasets: [{ label: "P/L", data: ss, backgroundColor: signCol(ss) }] }, options: barOpts((v) => "$" + num(v, 0)) });
      const months = [...new Set(cl.map((t) => dayKey(t.closeMs).slice(0, 7)))].sort();
      drawChart("ch-a-mo", { type: "bar", data: { labels: months, datasets: CFG.strategies.map((s) => ({ label: s.name, data: months.map((mo) => cl.filter((t) => t.strat === s.id && dayKey(t.closeMs).startsWith(mo)).reduce((a, t) => a + t.pnl, 0)), backgroundColor: s.color })) }, options: barOpts((v) => "$" + num(v, 0), { legend: true, stacked: true }) });
    },
  };
  function calendar(m) {
    const daily = new Map();
    m.closed.forEach((t) => { const k = dayKey(t.closeMs); daily.set(k, (daily.get(k) || 0) + t.pnl); });
    const maxAbs = Math.max(1, ...[...daily.values()].map(Math.abs));
    const end = Date.now(), start = end - (25 * 7 + WD.indexOf(tfWd.format(end))) * 86400000;
    let cells = "";
    for (let t = start; t <= end; t += 86400000) {
      const k = dayKey(t), v = daily.get(k), a = v == null ? 0 : 0.3 + 0.7 * Math.min(1, Math.abs(v) / maxAbs);
      cells += `<i style="${v == null ? "" : `background:rgba(${v >= 0 ? "67,184,140" : "229,89,79"},${a})`}" title="${k}${v == null ? "" : "  " + money(v, true)}"></i>`;
    }
    return `<div class="cal">${cells}</div><div class="cal-key">loss <i style="background:rgba(229,89,79,.9)"></i><i style="background:rgba(229,89,79,.4)"></i><i style="background:var(--pane-2)"></i><i style="background:rgba(67,184,140,.4)"></i><i style="background:rgba(67,184,140,.9)"></i> profit · one column per week, Monday on top</div>`;
  }
  function corrTable(m) {
    const days = [...new Set(m.closed.map((t) => dayKey(t.closeMs)))];
    const vec = (id) => days.map((d) => m.closed.filter((t) => t.strat === id && dayKey(t.closeMs) === d).reduce((a, t) => a + (t.R || 0), 0));
    const corr = (a, b) => { const n = a.length; if (n < 5) return null; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sa && sb ? s / Math.sqrt(sa * sb) : null; };
    const S = CFG.strategies, V = Object.fromEntries(S.map((s) => [s.id, vec(s.id)]));
    return `<div class="tw"><table class="t"><thead><tr><th></th>${S.map((s) => `<th class="n">${s.name.replace("Strategy ", "S")}</th>`).join("")}</tr></thead><tbody>${S.map((a) => `<tr><td>${sw(a.color)}${a.name}</td>${S.map((b) => { const c = a.id === b.id ? 1 : corr(V[a.id], V[b.id]); return `<td class="n ${c == null ? "muted" : c > 0.5 && a.id !== b.id ? "warn" : ""}">${c == null ? "n/a" : num(c, 2)}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="note">Needs 5+ trading days. Near <b>+1</b> = they win and lose together (risk stacks); near <b>0</b> = independent. S1 and C share the prev-day trigger, so expect them to correlate.</div>`;
  }

  PAGES.risk = {
    title: "Risk",
    render(m) {
      const a = m.d.account, cap = m.d.cap || { used: 0, max: CFG.cap_max }, curDD = m.curve.length ? m.curve[m.curve.length - 1].dd : 0;
      const rs = riskSeries(m), avgRisk = rs.length ? rs.reduce((x, y) => x + y.pct, 0) / rs.length : null, over = rs.filter((x) => x.pct > CFG.risk_pct * 1.1).length;
      return `${pageH("Exposure · limits · drawdown", "Risk")}
        ${strip(cell("Trades today", `${cap.used}<span class="muted"> / ${cap.max}</span>`, slots(cap.used, cap.max)),
          cell(m.openRisk >= 0 ? "At risk to stops" : "Locked by stops", `<span class="${m.openRisk > 0 ? "warn" : "up"}">${money(Math.abs(m.openRisk))}</span>`, `${pct(Math.abs(m.openRisk) / a.equity * 100, 2)} of equity`),
          cell("Drawdown now", `<span class="${curDD < 0 ? "down" : ""}">${pct(curDD, 2)}</span>`, `worst ${pct(m.maxDD, 2)}`),
          cell("Avg actual risk", avgRisk == null ? "—" : pct(avgRisk, 2), `target ${CFG.risk_pct}% · ${over} above`),
          cell("Free margin", money(a.free_margin), `level ${a.margin_level ? pct(a.margin_level, 0) : "—"}`),
          cell("Leverage", `1:${a.leverage}`, `${a.mode} account`))}
        ${ws("c6-6", pane("Drawdown", chartBox("ch-r-dd"), { sub: "% below equity peak" }), pane("Risk per trade", chartBox("ch-r-risk"), { sub: `actual vs ${CFG.risk_pct}% target` }))}
        ${ws("c6-6", pane("Entries vs daily cap", chartBox("ch-r-cap", "short"), { sub: "last 30 days · all EAs" }),
          pane("Limits in force", `<div class="kv">
            <span class="k">Risk per trade</span><span class="v">${CFG.risk_pct}% of balance · all EAs</span>
            <span class="k">Shared daily cap</span><span class="v">${cap.max} new trades / broker day</span>
            <span class="k">Minimum lot</span><span class="v">0.01 · never skipped</span>
            <span class="k">Strategy 1</span><span class="v">1 / day</span>
            <span class="k">Strategy 2</span><span class="v">3 / day · stop after −2R</span>
            <span class="k">Strategy C</span><span class="v">3 / day · may overlap</span>
            <span class="k">Worst case at once</span><span class="v">≈ ${cap.max * CFG.risk_pct}%+ of balance</span></div>
            <div class="note" style="border-top:1px solid var(--line)">On a $1,000 account the 0.01-lot minimum often risks more than ${CFG.risk_pct}% when gold's stop is wide — those trades plot above the target line.</div>`, { flush: true }))}`;
    },
    after(m) {
      drawChart("ch-r-dd", { type: "line", data: { labels: m.curve.map((p) => fmtTime(p.ms)), datasets: [{ label: "Drawdown", data: m.curve.map((p) => p.dd), borderColor: "#e5594f", backgroundColor: "rgba(229,89,79,.1)", fill: "origin" }] }, options: lineOpts((v) => pct(v, 1)) });
      const rs = riskSeries(m);
      drawChart("ch-r-risk", { type: "bar", data: { labels: rs.map((x) => fmtTime(x.ms)), datasets: [
        { type: "line", label: "Target", data: rs.map(() => CFG.risk_pct), borderColor: "#d6a94e", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        { label: "Risk", data: rs.map((x) => x.pct), backgroundColor: rs.map((x) => x.color) }] }, options: barOpts((v) => pct(v, 1)) });
      const days = []; for (let i = 29; i >= 0; i--) days.push(dayKey(Date.now() - i * 86400000));
      drawChart("ch-r-cap", { type: "bar", data: { labels: days.map((d) => d.slice(5)), datasets: [
        { type: "line", label: "Cap", data: days.map(() => CFG.cap_max), borderColor: "#e5594f", borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
        { label: "Entries", data: days.map((d) => m.trades.filter((t) => dayKey(t.openMs) === d).length), backgroundColor: "rgba(214,169,78,.75)" }] }, options: barOpts((v) => String(v)) });
    },
  };
  function riskSeries(m) {
    return m.trades.filter((t) => t.risk).map((t) => {
      const before = [...m.curve].reverse().find((p) => p.ms <= t.openMs) || m.curve[0];
      return { ms: t.openMs, pct: t.risk / (before ? before.bal : m.d.account.balance) * 100, color: t.color };
    });
  }

  PAGES.market = {
    title: "Market",
    render(m) {
      const k = m.d.market, asia = asianRange(m), x = eatMinutes(Date.now());
      const bias = k.bias === 1 ? ["long", "LONG ONLY", "Daily and H4 both trend up — the EAs will only buy."] : k.bias === -1 ? ["short", "SHORT ONLY", "Daily and H4 both trend down — the EAs will only sell."] : ["", "NO TRADE", "Daily and H4 disagree — Strategy 1 and C stand aside."];
      const sess = WINDOWS.map((s) => { const live = x >= s.w[0] && x < s.w[1], until = (s.w[0] - x + 1440) % 1440;
        return `<span class="k">${sw(s.c)}${s.n} <span class="m muted" style="font-size:11px">${hhmm(s.w[0])}–${hhmm(s.w[1])}</span><br><span class="muted" style="font-size:11px;margin-left:11px">${s.who}</span></span><span class="v">${live ? `<span class="tag ok">live · ${dur((s.w[1] - x) * 60)}</span>` : `<span class="muted">in ${dur(until * 60)}</span>`}</span>`; }).join("");
      const lv = (l, v) => `<tr><td class="t2">${l}</td><td class="n">${num(v, 2)}</td><td class="n ${ud(v - k.bid)}">${num(v - k.bid, 2, true)}</td></tr>`;
      return `${pageH("XAUUSD · MetaQuotes-Demo", "Market")}
        ${ws("c8-4",
          pane("XAUUSD · M15", `<div style="display:flex;gap:18px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px"><span class="px" data-k="mpx">${num(k.bid, 2)}</span><span class="m muted">ask ${num(k.ask, 2)} · spread ${num(k.spread, 2)} · range ${num(k.day_low, 2)}–${num(k.day_high, 2)}</span></div>${candles(m, asia)}`, { sub: "24 h · gold = prev-day H/L · blue = Asian range" }),
          `<div class="pane"><div class="bias-line ${bias[0]}" style="padding:16px 14px"><div><div class="m muted" style="font-size:10px;letter-spacing:.12em">BIAS · D1 + H4</div><div class="t" style="font-size:18px;margin:3px 0">${bias[1]}</div><div class="muted" style="font-size:12px">${bias[2]}</div></div></div>
            <div class="pane-h" style="border-top:1px solid var(--line)"><h2>Sessions · EAT</h2><span class="sub m">${tfMin.format(Date.now())}</span></div><div class="pane-b" style="padding-bottom:2px">${timeline()}</div><div class="kv" style="border-top:1px solid var(--line)">${sess}</div></div>`)}
        ${ws("c4-4-4",
          pane("Levels", `<div class="tw"><table class="t"><thead><tr><th>Level</th><th class="n">Price</th><th class="n">From bid</th></tr></thead><tbody>${lv("Prev-day high", k.prev_high)}${lv("Prev-day low", k.prev_low)}${asia ? lv("Asian high", asia.hi) + lv("Asian low", asia.lo) : ""}${lv("Day open", k.day_open)}${lv("H4 EMA20", k.h4.ema20)}</tbody></table></div>`, { flush: true }),
          pane("Trend filter", `<div class="tw"><table class="t"><thead><tr><th></th><th class="n h-sm">Close</th><th class="n">EMA20</th><th class="n">EMA50</th><th>Trend</th></tr></thead><tbody>${[["D1", k.d1], ["H4", k.h4]].map(([l, t]) => `<tr><td>${l}</td><td class="n h-sm">${num(t.close, 2)}</td><td class="n">${num(t.ema20, 2)}</td><td class="n">${num(t.ema50, 2)}</td><td>${t.trend === 1 ? `<span class="tag ok">up</span>` : t.trend === -1 ? `<span class="tag bad">down</span>` : `<span class="tag">flat</span>`}</td></tr>`).join("")}</tbody></table></div>`, { flush: true }),
          pane("Volatility · stop sizes", `<div class="kv">
            <span class="k">H4 ATR(14)</span><span class="v">${num(k.atr_h4, 2)}</span>
            <span class="k">H1 ATR(14)</span><span class="v">${num(k.atr_h1, 2)}</span>
            <span class="k">S1 stop · 1.0 × H4</span><span class="v">${num(k.atr_h4, 2)} · $${num(k.atr_h4 * 0.01 * m.contract, 2)}/0.01</span>
            <span class="k">C stop · 0.75 × H4</span><span class="v">${num(k.atr_h4 * 0.75, 2)} · $${num(k.atr_h4 * 0.75 * 0.01 * m.contract, 2)}/0.01</span>
            <span class="k">2% of balance</span><span class="v">${money(m.d.account.balance * CFG.risk_pct / 100)}</span></div>`, { flush: true }))}`;
    },
  };
  function asianRange(m) {
    const today = dayKey(Date.now());
    const asia = (m.d.m15 || []).map((b) => ({ ms: m.toMs(b[0]), h: b[2], l: b[3] })).filter((b) => dayKey(b.ms) === today && eatMinutes(b.ms) >= 180 && eatMinutes(b.ms) < 600);
    return asia.length < 8 ? null : { hi: Math.max(...asia.map((b) => b.h)), lo: Math.min(...asia.map((b) => b.l)), from: asia[0].ms, to: asia[asia.length - 1].ms };
  }
  function candles(m, asia) {
    const bars = (m.d.m15 || []).map((b) => ({ ms: m.toMs(b[0]), o: b[1], h: b[2], l: b[3], c: b[4] }));
    if (bars.length < 2) return empty("No bars yet.");
    const k = m.d.market, W = 960, H = 330, padR = 66, padB = 22, padT = 12, n = bars.length, cw = (W - padR) / n, F = 'font-family="Plex Mono, monospace"';
    let hi = Math.max(...bars.map((b) => b.h)), lo = Math.min(...bars.map((b) => b.l));
    [k.prev_high, k.prev_low, asia?.hi, asia?.lo].filter((v) => v).forEach((v) => { if (v < hi + (hi - lo) * 0.6 && v > lo - (hi - lo) * 0.6) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
    const pad = (hi - lo) * 0.06; hi += pad; lo -= pad;
    const y = (v) => padT + (hi - v) / (hi - lo) * (H - padB - padT);
    let s = `<svg class="cdl" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5; s += `<line x1="0" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#17191d"/><text x="${W - padR + 8}" y="${y(v) + 3.5}" fill="#747067" font-size="10.5" ${F}>${v.toFixed(1)}</text>`; }
    if (asia) { const i0 = bars.findIndex((b) => b.ms >= asia.from), i1 = bars.findIndex((b) => b.ms >= asia.to); if (i0 >= 0) s += `<rect x="${i0 * cw}" width="${((i1 >= 0 ? i1 : n - 1) - i0 + 1) * cw}" y="${y(asia.hi)}" height="${Math.max(1, y(asia.lo) - y(asia.hi))}" fill="rgba(127,159,202,.07)" stroke="rgba(127,159,202,.4)" stroke-dasharray="2 2"/>`; }
    const lvl = (v, label) => v && v <= hi && v >= lo ? `<line x1="0" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="#d6a94e" stroke-dasharray="6 4" stroke-width=".9"/><text x="6" y="${y(v) - 5}" fill="#d6a94e" font-size="10.5" ${F}>${label} ${v.toFixed(2)}</text>` : "";
    s += lvl(k.prev_high, "PDH") + lvl(k.prev_low, "PDL");
    // entry lines for open positions; labels stack upwards when entries are close together
    let labY = Infinity;
    for (const t of [...m.openT].sort((a, b) => a.openPrice - b.openPrice)) {
      if (t.openPrice > hi || t.openPrice < lo) continue;
      const ly = Math.min(y(t.openPrice) - 5, labY - 13); labY = ly;
      s += `<line x1="0" x2="${W - padR}" y1="${y(t.openPrice)}" y2="${y(t.openPrice)}" stroke="${t.color}" stroke-width=".8" stroke-opacity=".8"/><text x="${W - padR - 6}" y="${ly}" text-anchor="end" fill="${t.color}" font-size="10" ${F}>${t.sname} ${t.side} ${num(t.pos.volume, 2)} @ ${t.openPrice.toFixed(2)}</text>`;
    }
    bars.forEach((b, i) => { const x = i * cw + cw / 2, c = b.c >= b.o ? "#43b88c" : "#e5594f";
      s += `<line x1="${x}" x2="${x}" y1="${y(b.h)}" y2="${y(b.l)}" stroke="${c}"/><rect x="${x - cw * 0.34}" width="${Math.max(1, cw * 0.68)}" y="${y(Math.max(b.o, b.c))}" height="${Math.max(1, Math.abs(y(b.o) - y(b.c)))}" fill="${c}"/>`; });
    const last = bars[n - 1];
    s += `<line x1="0" x2="${W - padR}" y1="${y(last.c)}" y2="${y(last.c)}" stroke="rgba(235,232,225,.3)" stroke-dasharray="1 3"/><rect x="${W - padR + 2}" y="${y(last.c) - 9}" width="${padR - 4}" height="18" fill="#ebe8e1"/><text x="${W - padR + 8}" y="${y(last.c) + 4}" fill="#0b0c0e" font-size="11" ${F} font-weight="600">${last.c.toFixed(2)}</text>`;
    for (let i = 0; i < n; i += 16) s += `<text x="${i * cw + 2}" y="${H - 6}" fill="#4a4741" font-size="10.5" ${F}>${tfMin.format(bars[i].ms)}</text>`;
    return s + "</svg>";
  }

  PAGES.system = {
    title: "System",
    render(m) {
      const d = m.d, age = META?.file_age_sec ?? Infinity, sys = SYS, memUsed = sys ? (1 - sys.mem_free / sys.mem_total) * 100 : null;
      const st = (l, v, s) => `<div class="stat"><span class="led ${s}"></span><div><div class="l">${l}</div><div class="v">${v}</div></div></div>`;
      const alerts = sys?.alerts || [];
      return `${pageH("Feed · terminal · VPS · alerts", "System")}
        ${ws("c12", `<div class="stats">
          ${st("Data feed", age < 15 ? `live · ${num(age, 0)}s` : `${num(age, 0)}s old`, age < 15 ? "ok" : age < 90 ? "warn" : "bad")}
          ${st("MT5 → broker", d.terminal.connected ? "connected" : "DISCONNECTED", d.terminal.connected ? "ok" : "bad")}
          ${st("Algo trading", d.terminal.algo_trading ? "on" : "OFF", d.terminal.algo_trading ? "ok" : "bad")}
          ${st("EA trading on account", d.account.expert_allowed ? "allowed" : "BLOCKED", d.account.expert_allowed ? "ok" : "bad")}
          ${st("Ping", `${num(d.terminal.ping_ms, 0)} ms`, d.terminal.ping_ms < 400 ? "ok" : "warn")}
          ${st("Account", `${d.account.login} · ${d.account.mode}`, d.account.mode === "demo" ? "ok" : "warn")}
          ${st("Server", `${esc(d.account.server)} · GMT+${d.server_gmt_offset}`, "ok")}
          ${st("Exporter", `seq ${d.seq} · build ${d.terminal.build}`, "ok")}
          ${st("Email alerts", sys?.email_configured ? `on · ${esc(sys.alert_to)}` : "not configured", sys?.email_configured ? "ok" : "warn")}
          ${st("VPS load", sys ? sys.loadavg.map((x) => x.toFixed(2)).join(" ") : "—", sys && sys.loadavg[0] < 2 ? "ok" : "warn")}
          ${st("VPS memory", memUsed == null ? "—" : pct(memUsed, 0) + " used", memUsed != null && memUsed < 85 ? "ok" : "warn")}
          ${st("Dashboard", sys ? `v${sys.version} · up ${dur(sys.uptime_sec)}` : "—", "ok")}</div>`)}
        ${ws("c12", pane("Alert log", alerts.length ? table([
          { h: "Time", f: (x) => `<span class="m t2">${fmtTime(x.at)}</span>` },
          { h: "Type", hide: "sm", f: (x) => `<span class="tag ${x.level === "problem" ? "bad" : x.level === "ok" ? "ok" : "gold"}">${x.level}</span>` },
          { h: "Subject", cls: "wrap", f: (x) => esc(x.subject) },
          { h: "Email", hide: "sm", f: (x) => x.sent ? `<span class="tag ok">sent</span>` : `<span class="tag warn" title="${esc(x.error || "")}">not sent</span>` },
        ], alerts) : empty("No alerts yet."), { flush: true, sub: "trade + problem emails" }))}
        <div class="note" style="padding:0 2px">Problem alerts: <b>data stale</b> 90 s · <b>MT5 disconnected</b> 2 min · <b>algo trading off</b> · <b>daily cap reached</b> · <b>drawdown</b> 10% from peak, then every +5%. Each also emails when it clears. Press <b>?</b> for keyboard shortcuts.</div>`;
    },
  };

  // ------------------------------------------------------------ chrome, router, live updates
  const navLink = (r, l, cls) => `<a href="#/${r}" class="${cls}" data-route="${r}" title="${l}">${ico(r)}<span>${l}</span>${r === "positions" ? `<span class="cnt" data-open></span>` : ""}</a>`;
  const navHtml = (dock) => dock
    ? NAV.slice(0, 4).map(([r, l]) => navLink(r, l, "")).join("") + `<button id="more-btn" aria-haspopup="menu" aria-controls="sheet"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg><span>More</span></button>`
    : NAV.map(([r, l]) => navLink(r, l, "tab")).join("");
  const sheetHtml = () => NAV.slice(4).map(([r, l], i) => `<a href="#/${r}" data-route="${r}" role="menuitem">${ico(r)}${l}<small>${i + 5}</small></a>`).join("");
  function setStatus() {
    const el = $("#live"), txt = $("#live-text"), age = META?.file_age_sec ?? Infinity;
    let c = "ok", t = "live";
    if (!RAW) { c = "warn"; t = "connecting"; }
    else if (age > 90) { c = "bad"; t = `stale ${Math.round(age)}s`; }
    else if (!RAW.terminal.connected) { c = "bad"; t = "mt5 offline"; }
    else if (!RAW.terminal.algo_trading) { c = "warn"; t = "algo off"; }
    else if (age > 15) { c = "warn"; t = `delayed ${Math.round(age)}s`; }
    el.className = `live ${c}`; txt.textContent = t;
    if (RAW) {
      $("#h-acct").textContent = RAW.account.login;
      $("#h-mode").textContent = RAW.account.mode.toUpperCase();
      document.querySelectorAll("[data-open]").forEach((e) => e.textContent = (RAW.positions || []).length || "");
    }
  }
  function parseRoute() {
    const [name, arg] = (location.hash || "#/overview").replace(/^#\/?/, "").split("/");
    route = { name: PAGES[name] ? name : "overview", arg: arg || null };
  }
  let lastKey = "";
  function render() {
    if (!M) return;
    const key = route.name + "/" + (route.arg || ""), page = PAGES[route.name];
    const sameRoute = key === lastKey, keepScroll = sameRoute ? window.scrollY : 0;
    if (!sameRoute) { prevVals.clear(); lastKey = key; }
    const focus = document.activeElement?.id;
    $("#view").innerHTML = page.render(M);
    document.title = `${page.title} · Gold Desk`;
    const navKey = route.name === "strategy" ? "strategies" : route.name;
    document.querySelectorAll("[data-route]").forEach((a) => a.classList.toggle("on", a.dataset.route === navKey));
    $("#more-btn")?.classList.toggle("on", NAV.slice(4).some(([r]) => r === navKey));
    for (const k in charts) if (charts[k].canvas !== document.getElementById(k)) { charts[k].destroy(); delete charts[k]; }
    page.after?.(M);
    document.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k, v = parseFloat(el.textContent.replace("−", "-").replace(/[^0-9.\-]/g, "")), p = prevVals.get(k);
      if (p != null && isFinite(v) && v !== p) el.classList.add(v > p ? "fl-up" : "fl-dn");
      prevVals.set(k, v);
    });
    if (focus && document.getElementById(focus)) document.getElementById(focus).focus();
    window.scrollTo(0, keepScroll);
    setStatus();
  }
  const busy = () => { const a = document.activeElement; return a && (a.tagName === "SELECT" || a.tagName === "INPUT"); };

  async function loadState() {
    try {
      const r = await fetch("/api/state", { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json(); META = j.meta;
      const changed = !RAW || j.data.seq !== RAW.seq; RAW = j.data;
      if (changed || !M) { M = buildModel(); if (!busy()) render(); }
    } catch (e) {
      META = { file_age_sec: Infinity };
      if (!RAW) $("#view").innerHTML = `<div class="banner bad">${ico("system")}<span>Cannot reach the data feed (${esc(e.message)}). Is MT5 running on the VPS?</span></div>`;
    }
    setStatus();
  }
  async function loadEquity() { try { const r = await fetch("/api/equity", { cache: "no-store" }); if (r.ok) { EQ = await r.json(); if (RAW) { M = buildModel(); if (!busy()) render(); } } } catch { /* keep last */ } }
  async function loadSystem() { try { const r = await fetch("/api/system", { cache: "no-store" }); if (r.ok) { SYS = await r.json(); if (route.name === "system" && M) render(); } } catch { /* keep last */ } }

  function keys() {
    let g = false;
    document.addEventListener("keydown", (e) => {
      if (busy() || e.metaKey || e.ctrlKey || e.altKey) return;
      const help = $("#kbd-help");
      if (e.key === "?") { help.hidden = !help.hidden; return; }
      if (e.key === "Escape") { help.hidden = true; $("#sheet").hidden = true; return; }
      if (g) { g = false; const id = { 1: "s1", 2: "s2", c: "c" }[e.key.toLowerCase()]; if (id) location.hash = `#/strategy/${id}`; return; }
      if (e.key === "g") { g = true; setTimeout(() => (g = false), 1200); return; }
      const i = Number(e.key); if (i >= 1 && i <= NAV.length) location.hash = `#/${NAV[i - 1][0]}`;
    });
    $("#kbd-help").onclick = (e) => { if (e.target.id === "kbd-help") e.currentTarget.hidden = true; };
  }

  async function init() {
    $("#tabs").innerHTML = navHtml(false);
    $("#dock").innerHTML = navHtml(true);
    $("#sheet-panel").innerHTML = sheetHtml();
    const sheet = $("#sheet");
    $("#more-btn").onclick = () => { sheet.hidden = !sheet.hidden; };
    sheet.onclick = () => { sheet.hidden = true; };
    CFG = await (await fetch("/api/config")).json();
    parseRoute();
    window.addEventListener("hashchange", () => { $("#sheet").hidden = true; parseRoute(); render(); });
    keys();
    const clock = () => { $("#h-clock").textContent = tfSec.format(Date.now()); };
    clock(); setInterval(clock, 1000);
    await Promise.all([loadEquity(), loadSystem()]);
    await loadState();
    setInterval(loadState, 3000);
    setInterval(loadEquity, 60000);
    setInterval(loadSystem, 15000);
    setInterval(() => { if (M && !busy() && (route.name === "market" || route.name === "overview")) render(); }, 30000);
  }
  init();
})();
