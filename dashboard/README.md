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
