# Strategy C meta-model experiment (Nov 2026)

Question: can a model trained on entry conditions pick out Strategy C's better trades?

- `Gold_StratC_ML.mq5`: tester-only copy of Strategy C v1.05 (built by `cml.py`) that prints
  `CFEAT|` (29 entry conditions, in H4-ATR units) and `COUT|` (R, MFE, MAE) per trade.
- Data: `bt_c_ml` backtest, Jan 2020 - 18 Nov 2026, daily caps off -> 1,724 closed trades
  (1,438 within the live 3/day cap). `cml_feat.txt` / `cml_out.txt`.
- `train.py <dir> val`: train 2020-23, judge on 2024; `train.py <dir> test`: train 2020-24, judge 2025-26 once.
- `chk.py`: single-feature quintiles, train years vs 2024.

## Result (2024 validation): no usable edge
| 2024, live-cap trades (228) | total R | PF |
|---|---|---|
| take all | +91.4 | 1.68 |
| GBM expected-R, skip worst 25% | +86.7 | 1.69 |
| GBM reach-2R, skip worst 25% | +91.3 | 1.79 |
| logistic reach-2R, skip worst 25% | +35.8 | 1.33 |

Score vs R correlation on 2024: -0.07 / +0.05 / -0.11. Single-feature patterns from 2020-23
reversed in 2024 (e.g. lowest ATR-vs-average quintile: +1.30R then -0.32R). The 2025-26 test
was NOT opened, so it is still clean for a future attempt with different data
(e.g. counter-bias breakouts for more samples, or outside data such as DXY / news calendar).

Python env: Windows `C:\Users\cent$\.venvs\goldml` (numpy, pandas, scikit-learn, lightgbm).
