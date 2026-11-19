// Gold Desk dashboard server: read-only. Serves the dashboard, exposes the MT5
// exporter's JSON (MQL5/Files/golddesk.json) and sends email alerts on trade
// open/close and on problems. No dependencies; Node 18+.
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const DATA_FILE = process.env.GOLDDESK_DATA || "/home/mt5/.mt5/drive_c/Program Files/MetaTrader 5/MQL5/Files/golddesk.json";
const STATE_DIR = process.env.STATE_DIRECTORY || path.join(__dirname, ".state");
const STATE_FILE = path.join(STATE_DIR, "alerts-state.json");
const HOSTS = (process.env.GOLDDESK_HOSTS || "127.0.0.1").split(",").map((h) => h.trim()).filter(Boolean);
const PORT = Number(process.env.GOLDDESK_PORT || 8088);
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "strategies.json"), "utf8"));
const VERSION = "1.1.0";
const BARS_FILE = process.env.GOLDDESK_BARS || path.join(path.dirname(DATA_FILE), "golddesk_bars.json");
const TFS = ["M5", "M15", "H1", "H4", "D1"];

const RESEND_KEY = process.env.RESEND_API_KEY || "";
const ALERT_TO = process.env.ALERT_TO || "";
const ALERT_FROM = process.env.ALERT_FROM || "";
const STALE_SEC = Number(process.env.STALE_SEC || 90);
const DISCONNECT_SEC = Number(process.env.DISCONNECT_SEC || 120);
const ALGO_OFF_SEC = Number(process.env.ALGO_OFF_SEC || 120);
const DD_ALERT_PCT = Number(process.env.DD_ALERT_PCT || 10);   // first drawdown alert, then every +5%

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

// ---------------------------------------------------------------- data
let last = { text: null, json: null, mtimeMs: 0, readAt: 0, error: null };
async function readData() {
  try {
    const st = await fsp.stat(DATA_FILE);
    if (st.mtimeMs !== last.mtimeMs || !last.json) {
      const text = await fsp.readFile(DATA_FILE, "utf8");
      const json = JSON.parse(text);
      last = { text, json, mtimeMs: st.mtimeMs, readAt: Date.now(), error: null };
    }
  } catch (e) {
    last.error = String(e.message || e);
  }
  return last;
}

// ---------------------------------------------------------------- candle history (chart page)
// The exporter rewrites golddesk_bars.json every 30 s; each timeframe is re-serialised once per change.
let bars = { mtimeMs: 0, offset: 2, tf: {} };
async function readBars() {
  try {
    const st = await fsp.stat(BARS_FILE);
    if (st.mtimeMs !== bars.mtimeMs) {
      const j = JSON.parse(await fsp.readFile(BARS_FILE, "utf8"));
      bars = { mtimeMs: st.mtimeMs, offset: j.server_gmt_offset ?? 2, tf: j.tf || {} };
    }
  } catch { /* not written yet */ }
  return bars;
}

// ---------------------------------------------------------------- stop-loss history (chart page)
// The exporter only shows each position's current SL, so record every change seen:
// { position_id: [[utc_sec, sl], ...] }, kept 200 days after the last change.
const SL_FILE = path.join(STATE_DIR, "sl-history.json");
let slHist = {};
try { slHist = JSON.parse(fs.readFileSync(SL_FILE, "utf8")); } catch { /* first run */ }
function recordStops(j) {
  let changed = false;
  const off = j.server_gmt_offset ?? 2;
  for (const p of j.positions || []) {
    const id = String(p.position_id), h = slHist[id] || (slHist[id] = []);
    if (!h.length) {                                     // seed with the stop at entry
      const e = (j.deals || []).find((d) => d.position_id === p.position_id && d.entry === 0);
      if (e && e.sl) h.push([e.time - off * 3600, e.sl]);
    }
    if (p.sl && (!h.length || Math.abs(h[h.length - 1][1] - p.sl) > 0.001)) { h.push([Math.floor(Date.now() / 1000), p.sl]); changed = true; }
  }
  if (!changed) return;
  const cutoff = Date.now() / 1000 - 200 * 86400;
  for (const k of Object.keys(slHist)) if (!slHist[k].length || slHist[k][slHist[k].length - 1][0] < cutoff) delete slHist[k];
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(SL_FILE + ".tmp", JSON.stringify(slHist)); fs.renameSync(SL_FILE + ".tmp", SL_FILE); } catch (e) { console.error("sl history save failed:", e.message); }
}

// ---------------------------------------------------------------- equity history
// One snapshot per minute (UTC ms, equity, balance) so the equity curve shows real
// movement, not just closed trades. Kept for 120 days in STATE_DIR/equity.jsonl.
const EQ_FILE = path.join(STATE_DIR, "equity.jsonl");
const EQ_KEEP_MS = 120 * 86400000;
let eqHist = [];
try {
  eqHist = fs.readFileSync(EQ_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((p) => p.t > Date.now() - EQ_KEEP_MS);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(EQ_FILE, eqHist.map((p) => JSON.stringify(p)).join("\n") + (eqHist.length ? "\n" : ""));
} catch { /* first run */ }
function recordEquity() {
  const j = last.json;
  if (!j || !j.account || Date.now() - last.mtimeMs > 120000) return;
  const p = { t: Date.now(), e: j.account.equity, b: j.account.balance };
  eqHist.push(p);
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.appendFileSync(EQ_FILE, JSON.stringify(p) + "\n"); } catch (e) { console.error("equity save failed:", e.message); }
}
function equitySeries(maxPoints = 1500) {
  if (eqHist.length <= maxPoints) return eqHist;
  const step = eqHist.length / maxPoints, out = [];
  for (let i = 0; i < maxPoints; i++) out.push(eqHist[Math.floor(i * step)]);
  out.push(eqHist[eqHist.length - 1]);
  return out;
}

// ---------------------------------------------------------------- alerts
let state = { seenDeals: [], seeded: false, problems: {}, capDay: null, peakEquity: null, ddStep: 0, log: [] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch { /* first run */ }
const seen = new Set(state.seenDeals);
function saveState() {
  state.seenDeals = [...seen].slice(-5000);
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error("state save failed:", e.message); }
}

const strategyByMagic = new Map(CONFIG.strategies.map((s) => [s.magic, s]));
const stratName = (m) => (strategyByMagic.get(m) ? `${strategyByMagic.get(m).name} (${strategyByMagic.get(m).title})` : m ? `Magic ${m}` : "Manual");
const fmtEat = (serverTime, offset) => new Date((serverTime - offset * 3600) * 1000).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }) + " EAT";
const tag = (c, k) => { const m = new RegExp(`${k}=([\\d.]+)`).exec(c || ""); return m ? Number(m[1]) : null; };
const REASON = { 0: "Manual (terminal)", 1: "Manual (mobile)", 2: "Manual (web)", 3: "EA exit", 4: "Stop loss / trailing stop", 5: "Take profit", 6: "Stop out", 7: "Rollover", 8: "Variation margin", 9: "Split" };

async function sendEmail(subject, lines, level) {
  const entry = { at: Date.now(), level, subject, body: lines.join("\n"), sent: false };
  state.log.unshift(entry); state.log = state.log.slice(0, 200);
  if (!RESEND_KEY || !ALERT_TO || !ALERT_FROM) { entry.error = "email not configured"; saveState(); return; }
  const color = level === "problem" ? "#e5484d" : level === "ok" ? "#30a46c" : "#5b8def";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px">
    <div style="border-left:4px solid ${color};padding:12px 16px;background:#f6f7f9">
      <div style="font-size:16px;font-weight:600;margin-bottom:8px">${escapeHtml(subject)}</div>
      ${lines.map((l) => `<div style="font-size:14px;line-height:1.6;color:#333">${escapeHtml(l)}</div>`).join("")}
    </div>
    <div style="font-size:12px;color:#888;margin-top:10px">Gold Desk · demo account · read-only dashboard alert</div></div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: ALERT_FROM, to: [ALERT_TO], subject, text: lines.join("\n"), html }),
      signal: AbortSignal.timeout(15000),
    });
    entry.sent = res.ok;
    if (!res.ok) entry.error = `Resend ${res.status}`;
  } catch (e) { entry.error = String(e.message || e); }
  saveState();
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function problem(key, active, subject, lines) {
  const p = state.problems[key] || { active: false, since: null, notified: false };
  if (active) {
    if (!p.active) { p.active = true; p.since = Date.now(); p.notified = false; }
    if (!p.notified) { p.notified = true; sendEmail(`[Gold Desk] PROBLEM: ${subject}`, lines, "problem"); }
  } else if (p.active) {
    if (p.notified) sendEmail(`[Gold Desk] RESOLVED: ${subject}`, [`Back to normal after ${Math.round((Date.now() - p.since) / 60000)} min.`], "ok");
    p.active = false; p.notified = false; p.since = null;
  }
  state.problems[key] = p;
}

let staleSince = null, disconnectedSince = null, algoOffSince = null;
async function checkAlerts() {
  const d = await readData();
  const now = Date.now();
  const ageSec = d.mtimeMs ? (now - d.mtimeMs) / 1000 : Infinity;

  // problems that don't need a fresh file
  if (ageSec > STALE_SEC) { staleSince ??= now; } else staleSince = null;
  problem("stale", staleSince !== null, "MT5 data is stale",
    [`The dashboard has not received data from MT5 for ${Math.round(ageSec)} s.`, "MT5 or the GoldDeskExporter service may be down. Check: ssh gents 'systemctl status mt5'."]);
  if (!d.json) { saveState(); return; }
  const j = d.json, off = j.server_gmt_offset ?? 2;
  if (ageSec < STALE_SEC) recordStops(j);

  if (j.terminal && j.terminal.connected === false) { disconnectedSince ??= now; } else disconnectedSince = null;
  problem("disconnected", disconnectedSince !== null && (now - disconnectedSince) / 1000 > DISCONNECT_SEC, "MT5 is disconnected from the broker",
    ["The terminal reports no connection to MetaQuotes-Demo for over 2 minutes.", "EAs cannot open or manage trades until it reconnects."]);
  const algoOff = j.terminal && (j.terminal.algo_trading === false || (j.account && j.account.expert_allowed === false));
  // MT5 reports algo off for a few seconds while it starts up, so wait like the disconnect alert does
  if (algoOff) { algoOffSince ??= now; } else algoOffSince = null;
  problem("algo", algoOffSince !== null && (now - algoOffSince) / 1000 > ALGO_OFF_SEC, "Algo trading is switched off",
    ["MT5's Algo Trading has been off (or not allowed on the account) for over 2 minutes, so the EAs will not open or close trades."]);

  // trade open / close
  const deals = Array.isArray(j.deals) ? j.deals : [];
  if (!state.seeded) { deals.forEach((x) => seen.add(String(x.ticket))); state.seeded = true; }
  const bal = j.account?.balance ?? 0;
  for (const x of deals) {
    const id = String(x.ticket);
    if (seen.has(id)) continue;
    seen.add(id);
    if (x.type !== 0 && x.type !== 1) continue;              // only buy/sell deals
    const dir = x.type === 0 ? "BUY" : "SELL";
    const s = stratName(x.magic);
    if (x.entry === 0) {
      const risk = tag(x.comment, "R");
      const trig = /\bAS\b/.test(x.comment) ? "Asian-range break" : /\bPD\b/.test(x.comment) ? "Prev-day break" : null;
      sendEmail(`[Gold Desk] OPEN ${s}: ${dir} ${x.volume} ${x.symbol} @ ${x.price}`, [
        `Strategy: ${s}${trig ? ` · ${trig}` : ""}`,
        `${dir} ${x.volume} lot ${x.symbol} at ${x.price}`,
        `Stop: ${x.sl || "none"}   Target: ${x.tp || "none (trailing / EA exit)"}`,
        risk != null ? `Risk: $${risk.toFixed(2)} (${(risk / Math.max(bal, 1) * 100).toFixed(2)}% of balance)` : "Risk: n/a",
        `Trades today (all EAs): ${j.cap?.used ?? "?"}/${j.cap?.max ?? 4}`,
        `Time: ${fmtEat(x.time, off)}`,
      ], "trade");
    } else {
      const all = deals.filter((y) => y.position_id === x.position_id);
      const pnl = all.reduce((a, y) => a + (y.profit || 0) + (y.commission || 0) + (y.swap || 0) + (y.fee || 0), 0);
      const open = all.find((y) => y.entry === 0);
      const risk = open ? tag(open.comment, "R") : null;
      const stillOpen = (j.positions || []).some((p) => p.position_id === x.position_id);
      const r = risk ? pnl / risk : null;
      const hold = open ? (x.time - open.time) / 3600 : null;
      const sOpen = open ? stratName(open.magic) : s;
      sendEmail(`[Gold Desk] ${stillOpen ? "PARTIAL CLOSE" : "CLOSED"} ${sOpen}: ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}${r != null ? ` (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)` : ""}`, [
        `Strategy: ${sOpen}`,
        `${open ? (open.type === 0 ? "BUY" : "SELL") : ""} ${x.volume} lot ${x.symbol}: ${open ? open.price : "?"} → ${x.price}`,
        `Result: ${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toFixed(2)}${r != null ? `  (${r >= 0 ? "+" : ""}${r.toFixed(2)}R)` : ""}`,
        `Exit: ${REASON[x.reason] || x.reason}${hold != null ? `   Held: ${hold < 24 ? hold.toFixed(1) + " h" : (hold / 24).toFixed(1) + " days"}` : ""}`,
        ...(!stillOpen && pnl <= 0 ? peakLine(j, x.position_id, open, off) : []),
        `Balance now: $${bal.toFixed(2)}`,
        `Time: ${fmtEat(x.time, off)}`,
      ], "trade");
    }
  }

  // daily cap reached (once per broker day)
  if (j.cap && j.cap.used >= j.cap.max && state.capDay !== j.cap.day_start) {
    state.capDay = j.cap.day_start;
    sendEmail(`[Gold Desk] Daily cap reached: ${j.cap.used}/${j.cap.max} trades`, [
      "All four of today's trade slots are used. No EA will open another trade until the next broker day.",
      `Broker day started: ${fmtEat(j.cap.day_start, off)}`], "trade");
  }

  // drawdown from peak equity
  const eq = j.account?.equity;
  if (typeof eq === "number" && eq > 0) {
    if (state.peakEquity == null || eq > state.peakEquity) { state.peakEquity = eq; state.ddStep = 0; }
    const dd = (1 - eq / state.peakEquity) * 100;
    const step = dd >= DD_ALERT_PCT ? Math.floor((dd - DD_ALERT_PCT) / 5) + 1 : 0;
    if (step > state.ddStep) {
      state.ddStep = step;
      sendEmail(`[Gold Desk] PROBLEM: drawdown ${dd.toFixed(1)}% from peak`, [
        `Equity $${eq.toFixed(2)} is ${dd.toFixed(1)}% below its peak of $${state.peakEquity.toFixed(2)}.`,
        `Next alert at ${(DD_ALERT_PCT + step * 5).toFixed(0)}%.`], "problem");
    } else if (step < state.ddStep && dd < DD_ALERT_PCT) state.ddStep = 0;
  }
  saveState();
}

// farthest point a losing trade reached in its favour before it closed
function peakLine(j, pid, open, off) {
  const ex = (j.excursions || []).find((e) => e.position_id === pid);
  if (!ex || !open) return [];
  const dir = open.type === 0 ? 1 : -1, contract = j.market?.contract_size || 100;
  const usd = (ex.best - open.price) * dir * open.volume * contract, risk = tag(open.comment, "R");
  const r = risk ? ` (${usd >= 0 ? "+" : ""}${(usd / risk).toFixed(2)}R)` : "";
  return [usd > 0
    ? `Farthest in favour: ${ex.best} at ${fmtEat(ex.best_time, off)}, +$${usd.toFixed(2)}${r}`
    : "Farthest in favour: never went into profit"];
}

// ---------------------------------------------------------------- http
function send(res, code, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'", ...extra });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, '{"error":"read-only"}');
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/state") {
      const d = await readData();
      if (!d.text) return send(res, 503, JSON.stringify({ error: d.error || "no data yet" }));
      const meta = { file_age_sec: (Date.now() - d.mtimeMs) / 1000, served_at: Date.now(), error: d.error };
      return send(res, 200, `{"meta":${JSON.stringify(meta)},"data":${d.text}}`);
    }
    if (url.pathname === "/api/bars") {
      const tf = url.searchParams.get("tf"), since = Number(url.searchParams.get("since") || 0);
      if (!TFS.includes(tf)) return send(res, 400, '{"error":"tf"}');
      const b = await readBars(), list = b.tf[tf] || [];
      let i = list.length; if (since) while (i > 0 && list[i - 1][0] >= since) i--; else i = 0;
      return send(res, 200, JSON.stringify({ offset: b.offset, bars: list.slice(i) }));
    }
    if (url.pathname === "/api/stops") return send(res, 200, JSON.stringify(slHist));
    if (url.pathname === "/api/config") return send(res, 200, JSON.stringify(CONFIG));
    if (url.pathname === "/api/equity") return send(res, 200, JSON.stringify(equitySeries()));
    if (url.pathname === "/api/system") {
      return send(res, 200, JSON.stringify({
        version: VERSION, uptime_sec: Math.round(process.uptime()), host: os.hostname(), loadavg: os.loadavg(),
        mem_total: os.totalmem(), mem_free: os.freemem(), sys_uptime_sec: os.uptime(),
        email_configured: !!(RESEND_KEY && ALERT_TO && ALERT_FROM), alert_to: ALERT_TO.replace(/(.{3}).*(@.*)/, "$1…$2"),
        problems: state.problems, alerts: state.log.slice(0, 50).map(({ at, level, subject, sent, error }) => ({ at, level, subject, sent, error })),
      }));
    }
    if (url.pathname === "/healthz") return send(res, 200, "ok", "text/plain");
    // static
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, "forbidden", "text/plain");
    const buf = await fsp.readFile(file).catch(() => null);
    if (!buf) return send(res, 404, "not found", "text/plain");
    return send(res, 200, req.method === "HEAD" ? "" : buf, MIME[path.extname(file)] || "application/octet-stream",
      { "Cache-Control": p.startsWith("/vendor/") ? "public, max-age=86400" : "no-cache" });
  } catch (e) {
    console.error(e);
    return send(res, 500, '{"error":"internal"}');
  }
});

// Listen on each host; if one isn't available yet (e.g. Tailscale still starting at
// boot), keep retrying every 10 s instead of giving up.
for (const h of HOSTS) {
  const s = h === HOSTS[0] ? server : http.createServer(server.listeners("request")[0]);
  const start = () => s.listen(PORT, h);
  s.on("listening", () => console.log(`Gold Desk dashboard on http://${h}:${PORT}`));
  s.on("error", (e) => { console.error(`listen ${h}:${PORT} failed: ${e.message} - retrying in 10 s`); setTimeout(start, 10000); });
  start();
}
setInterval(() => checkAlerts().catch((e) => console.error("alerts:", e)), 5000);
setInterval(recordEquity, 60000);
setTimeout(recordEquity, 8000);
checkAlerts().catch((e) => console.error("alerts:", e));
