"""Strategy C meta-model: predict trade quality from entry conditions, judged on unseen years.
train 2020-2023 | choose settings on 2024 | locked test 2025-2026 (looked at once)."""
import sys, numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
D = sys.argv[1]
FEAT = ["dir","is_as","eat_min","dow","today","open_n","atr","atr_rel","atrH1_H4","atrH4_D1","d_h4e20","d_h4e50","d_d1e20","d_d1e50",
        "h4_gap","d1_gap","brk_body","brk_range","brk_beyond","pd_range","as_range","day_move","day_range","prev_day","mom_h1","mom_d5","room","rsi_h1","spread"]
f = pd.read_csv(f"{D}/cml_feat.txt", sep="|", header=None, names=["pid","time"]+FEAT)
o = pd.read_csv(f"{D}/cml_out.txt", sep="|", header=None, names=["pid","R","mfe","mae","tout"])
df = f.merge(o, on="pid"); df["time"] = pd.to_datetime(df["time"], format="%Y.%m.%d %H:%M"); df = df.sort_values("time").reset_index(drop=True)
df["year"] = df.time.dt.year; df["live"] = df.today < 3
X = [c for c in FEAT if c not in ("atr",)]          # raw ATR in $ drifts with price level: leave it out
tr, va, te = df[df.year <= 2023], df[df.year == 2024], df[df.year >= 2025]
print(f"rows {len(df)} (live-cap {df.live.sum()}) | train {len(tr)} val {len(va)} test {len(te)}")

def stats(R):
    R = np.asarray(R); 
    if len(R) == 0: return "n=0"
    c = np.cumsum(R); dd = np.max(np.maximum.accumulate(np.r_[0, c])[1:] - c) if len(c) else 0
    gp, gl = R[R > 0].sum(), -R[R < 0].sum()
    return f"n={len(R):4d} avg {R.mean():+.3f} total {R.sum():+7.1f} PF {gp/gl if gl else 0:4.2f} DD {dd:5.1f}"

y_reg = df.R.clip(-1.2, 8)                          # tame the fat tail so a few 25R trades don't dominate
y_big = (df.mfe >= 2).astype(int)                   # reached +2R at some point
models = {
  "gbm_R":   lambda Xt, i: lgb.LGBMRegressor(n_estimators=300, learning_rate=0.02, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5, verbose=-1, random_state=1).fit(Xt, y_reg[i]),
  "gbm_2R":  lambda Xt, i: lgb.LGBMClassifier(n_estimators=300, learning_rate=0.02, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5, verbose=-1, random_state=1).fit(Xt, y_big[i]),
  "logit_2R":lambda Xt, i: make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000)).fit(Xt, y_big[i]),
}
def score(m, Xs): return m.predict_proba(Xs)[:, 1] if hasattr(m, "predict_proba") else m.predict(Xs)

def policies(s, R, cuts):
    """skip below the cut, and size 0.5/1/1.5 by score third."""
    lo, hi = cuts
    out = {"all": R}
    out["skip worst 25%"] = R[s >= lo]
    w = np.where(s < lo, 0.5, np.where(s >= hi, 1.5, 1.0)); out["size 0.5/1/1.5"] = R * w
    return out

stage = sys.argv[2] if len(sys.argv) > 2 else "val"
for name, fit in models.items():
    print(f"\n### {name}")
    if stage == "val":
        m = fit(tr[X].values, tr.index); s_tr = score(m, tr[X].values)
        cuts = (np.quantile(s_tr, 0.25), np.quantile(s_tr, 0.75))
        v = va[va.live]; s = score(m, v[X].values)
        print("  2024 (unseen, live-cap trades), corr(score,R) = %+.3f" % np.corrcoef(s, v.R)[0, 1])
        for k, R in policies(s, v.R.values, cuts).items(): print(f"    {k:16s} {stats(R)}")
        # same thing with shuffled labels: what luck looks like
        rng = np.random.default_rng(0); sh = []
        for _ in range(30):
            idx = tr.index.values; yy = y_reg.copy(); yb = y_big.copy()
            yy[idx] = rng.permutation(yy[idx].values); yb[idx] = rng.permutation(yb[idx].values)
            g = lambda Xt, i: (models[name].__call__)  # placeholder
            if name == "gbm_R": mm = lgb.LGBMRegressor(n_estimators=300, learning_rate=0.02, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5, verbose=-1, random_state=1).fit(tr[X].values, yy[idx])
            elif name == "gbm_2R": mm = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.02, num_leaves=7, min_child_samples=40, subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5, verbose=-1, random_state=1).fit(tr[X].values, yb[idx])
            else: mm = make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=2000)).fit(tr[X].values, yb[idx])
            ss = score(mm, v[X].values); cu = np.quantile(score(mm, tr[X].values), 0.25)
            sh.append(v.R.values[ss >= cu].sum() - v.R.values.sum())
        print(f"    shuffled-label 'skip worst 25%%' gain vs all: mean {np.mean(sh):+.1f}R, 90th pct {np.quantile(sh, .9):+.1f}R")
        if name == "gbm_R":
            imp = pd.Series(m.booster_.feature_importance("gain"), index=X).sort_values(ascending=False)
            print("  top features:", ", ".join(f"{k}" for k in imp.index[:10]))
    else:   # final: train on 2020-2024, cuts from that data, test once on 2025-26
        trv = df[df.year <= 2024]; m = fit(trv[X].values, trv.index); s_tr = score(m, trv[X].values)
        cuts = (np.quantile(s_tr, 0.25), np.quantile(s_tr, 0.75))
        t = te[te.live]; s = score(m, t[X].values)
        print("  2025-26 LOCKED TEST (live-cap trades), corr(score,R) = %+.3f" % np.corrcoef(s, t.R)[0, 1])
        for k, R in policies(s, t.R.values, cuts).items(): print(f"    {k:16s} {stats(R)}")

if stage == "val":
    print("\n### simple look: avg R by quintile of each feature (train years, live-cap trades)")
    t = tr[tr.live]
    for c in X:
        try: q = pd.qcut(t[c], 5, duplicates="drop")
        except Exception: continue
        g = t.groupby(q, observed=True).R.mean()
        if len(g) >= 3 and (g.max() - g.min()) > 0.5: print(f"  {c:11s} " + "  ".join(f"{v:+.2f}" for v in g.values))
