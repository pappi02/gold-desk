# Gold Desk

Automated XAUUSD trading on MetaTrader 5 (demo forward test) plus a private
read-only monitoring dashboard. Runs on the Atlancis VPS (`ssh gents`, Tailscale only).

| Folder | What |
|---|---|
| `mt5/` | The three EAs, their presets, the MT5-under-Wine launcher/stop scripts, `mt5.service`, the backtest runner and optimisation sets. See `mt5/README.md`. |
| `dashboard/` | Gold Desk dashboard (Node, no deps) + `exporter/GoldDeskExporter.mq5` (MT5 service that writes the data feed) + `golddesk-dashboard.service`. See `dashboard/README.md`. |
| `docs/` | Strategy register (rules, magics, review criteria). |

## Live setup (demo)

| EA | File | Chart | Magic | Risk |
|---|---|---|---|---|
| Strategy 1 · HTF Bias 15M | `mt5/Gold_HTF_Bias_15M_EA.mq5` (v1.12) | XAUUSD M15 | 260117 | 2% |
| Strategy 2 · VWAP Fade 5M | `mt5/Gold_VWAP_Fade_5M_EA.mq5` (v2.01) | XAUUSD M5 | 260118 | 2% |
| Strategy C · Breakout + ATR trail | `mt5/Gold_StrategyC_EA.mq5` (v1.02) | XAUUSD M15 | 260119 | 2% |

All three share a cap of **4 new trades per broker day**, size lots with
`OrderCalcProfit` (the MetaQuotes-Demo XAUUSD tick value is 10x off), and fall back
to the 0.01 minimum lot instead of skipping.

Dashboard: http://100.112.136.21:8088 (Tailscale on). Email alerts on every trade
open/close and on problems (data stale, MT5 disconnected, algo trading off, daily cap
reached, drawdown).

Secrets are never committed: the Resend key lives only in `/etc/golddesk/alerts.env`
on the VPS; demo account credentials stay in MT5.
