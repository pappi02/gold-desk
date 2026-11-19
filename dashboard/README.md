# Gold Desk dashboard

Read-only web dashboard + email alerts for the three Gold EAs on the VPS
(MetaQuotes-Demo 5059000502). Private: Tailscale only.

- URL: http://100.112.136.21:8088 (Tailscale must be on). Also 127.0.0.1:8088 on the VPS.
- Data: `exporter/GoldDeskExporter.mq5`, an MT5 *service* (MQL5/Services, started from
  Navigator > Services; MT5 restarts it with the terminal). Every 2 s it writes
  `MQL5/Files/golddesk.json`: account, terminal, market (bias, PDH/PDL, ATR, M15 bars),
  positions, full deal history, shared-cap usage. Never trades.
- Server: `app/server.js` (Node, no deps) at /srv/golddesk, systemd `golddesk-dashboard`
  (User=mt5, ProtectSystem=strict, 256M/30% CPU). State (alerts, equity snapshots every
  minute) in /var/lib/golddesk.
- Routes: #/overview #/positions #/trades #/strategies #/strategy/<s1|s2|c> #/analytics
  #/risk #/market #/system. API: /api/state /api/config /api/equity /api/system.
- Alerts (Resend, /etc/golddesk/alerts.env root 600 - key copied from /etc/msmtprc):
  trade open/close, data stale >90 s, MT5 disconnected >2 min, algo trading off,
  daily cap reached, drawdown 10% from equity peak then every +5%; "resolved" emails.
- Firewall: `ufw allow in on tailscale0 to any port 8088` (tailnet only).
- Deploy: tar app/ to /srv/golddesk (root-owned), `systemctl restart golddesk-dashboard`.
- Strategy profiles / backtest expectations live in app/strategies.json.

## Chart page (#/chart)
- TradingView Lightweight Charts 4.2.0, vendored in `app/public/vendor/` (Apache-2.0, licence alongside); drawing code in `app/public/chart.js`.
- Candles come from `golddesk_bars.json`, which exporter v1.20 rewrites every 30 s (M5/M15 3000 bars, H1 2500, H4 1500, D1 600). The live candle moves with the bid between refreshes. Served by `/api/bars?tf=M15[&since=<server time>]`.
- Draws PDH/PDL per broker day, ASH/ASL (M15 bars 03:00-10:00 EAT, locked at 10:00, as the EAs compute it), and each trade as a position zone: red = entry to initial stop, green = entry to the farthest point reached, a dashed stop path, an exit dot and one small label.
- Stop path: the server records every SL change it sees into `/var/lib/golddesk/sl-history.json` (`/api/stops`); trades from before 2026-11-19 only have their initial and final stop.
- Times are EAT. `#/chart/<position id>` zooms to a trade (the "Open on chart" link in trade details).
