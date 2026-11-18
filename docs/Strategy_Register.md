# Gold Strategy Register (demo forward test)

Both EAs run on the same VPS, same demo account, separate charts. Each is identified by its **magic number** and writes its own trade log in `MQL5/Files/`.

| | Strategy #1 — HTF Bias · 15M | Strategy #2 — VWAP Fade · 5M |
|---|---|---|
| File | `Gold_HTF_Bias_15M_EA.mq5` (v1.10) | `Gold_VWAP_Fade_5M_EA.mq5` (v1.00) |
| Chart | XAUUSD **M15** | XAUUSD **M5** |
| Magic | **260117** | **260118** |
| Trade log | `MQL5/Files/HTF15_trades.csv` | `MQL5/Files/VWAPF_trades.csv` |
| Type | Trend-following | Mean reversion |
| Direction | Daily + H4 agree (close vs EMA50, EMA20 vs EMA50) | Fade back toward VWAP on range days |
| Entry | London 10:00–14:00 / NY 15:30–20:00 EAT; 15M close through prev-day high/low; 1 trade/day | 10:00–12:00 EAT; price pokes ±1.5σ VWAP band, M5 candle closes back inside; max 3/day |
| Skip | Daily/H4 disagree | Trend day (all 6 M5 closes 10:00–10:30 one side of VWAP) |
| Stop | 1 × H4 ATR14 | $4 fixed |
| Exit | First H4 close back across H4 EMA20 (no target); 10-day time stop | $10 target; flat at 14:00 EAT |
| Backtest (after costs) | 2015–26: +0.31R/trade, PF 1.44, maxDD 37R, 383 trades · 2020–26: +0.63R | 2015–19: +0.05R · 2020–26: +0.07R/trade, PF ~1.15–1.2, ~40 trades/yr |
| Bad regime | Sideways years (2015–19 −21R, 2022) | Strong trend days (filtered) |
| Expected win rate | ~25–27% | ~45% |
| Worst losing run (backtest) | 15 | — |

## Review rules
- Review each strategy **separately** from its own CSV (R column). Do not mix them.
- First review after ~30 trades each (#1 ≈ 8–10 months, #2 ≈ 8–9 months).
- Pass: avg R ≥ +0.15 (#1) / ≥ +0.03 (#2) and every trade followed the rules. No parameter changes during the test.
- DST: set `Server GMT` to **3** on both EAs at the EU summer-time switch (last Sunday of March), back to **2** in late October.
