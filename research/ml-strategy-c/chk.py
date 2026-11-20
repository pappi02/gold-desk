import pandas as pd, numpy as np
exec(open("train.py").read().split("def stats")[0].replace("D = sys.argv[1]","D='.'"))
t, v = tr[tr.live], va[va.live]
for c in ["atr_rel", "spread", "atrH1_H4", "pd_range"]:
    q = np.quantile(t[c], [.2, .4, .6, .8])
    bt = pd.cut(t[c], [-np.inf, *q, np.inf]); bv = pd.cut(v[c], [-np.inf, *q, np.inf])
    print(f"{c:9s} train " + " ".join(f"{x:+.2f}" for x in t.groupby(bt, observed=False).R.mean()) +
          " | 2024 " + " ".join(f"{x:+.2f}({n})" for x, n in zip(v.groupby(bv, observed=False).R.mean(), v.groupby(bv, observed=False).R.size())))
