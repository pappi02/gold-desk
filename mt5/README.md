# MT5 demo EA on the VPS (set up 2026-11-17)

Two EAs on one **MetaQuotes-Demo** account (login 5059000502, $1,000, 1:100, hedging) - see ../docs/Strategy_Register.md.
- #1 Gold_HTF_Bias_15M_EA v1.10, XAUUSD M15, magic 260117, log MQL5/Files/HTF15_trades.csv
- #2 Gold_VWAP_Fade_5M_EA v1.00, XAUUSD M5, magic 260118, log MQL5/Files/VWAPF_trades.csv
Demo only - never attach them to a real account.

## How it runs
- `mt5.service` (systemd, `User=mt5`) runs `~mt5/mt5-headless.sh`: a private Xvfb
  display :99, xfwm4, a **localhost-only** VNC view (x11vnc on 127.0.0.1:5900),
  then `~mt5/start-mt5.sh` -> `terminal64.exe`. Starts on boot, no login needed,
  restarts on failure. Same caps as the user slice (CPUQuota=120%, MemoryMax=3G,
  low CPU/IO weight), NoNewPrivileges, ProtectSystem=full.
- Watch/operate it: `ssh -L 5900:localhost:5900 gents`, then a VNC viewer to `localhost:5900`.
- `sudo systemctl restart mt5` restarts it. ExecStop (mt5-stop.sh) closes MT5 with Alt+F4 so it SAVES
  MQL5/Profiles/Charts/Default (both charts + EA inputs); a hard kill would lose changes since the last
  clean exit. Backup of the working profile: ~mt5/profile-backup/ (copy back into that folder if lost).
- Profiles live in MQL5/Profiles (not Profiles/). A session started with /config does NOT save its
  charts - attach EAs by hand in a normal session (Navigator double-click, Inputs > Load the .set).
- The XFCE/xrdp desktop (127.0.0.1:3389) is still installed but MT5 no longer
  autostarts there - don't start a second MT5 from RDP (one EA copy only).
- xfwm4 binds Ctrl+F1..F4 to workspaces: Ctrl+F4 does NOT close a chart here
  (it hides everything on workspace 4; Ctrl+F1 brings it back). Close charts from the tab's right-click menu.

## Sandbox
- User `mt5`: no sudo, no SSH (sshd `AllowUsers ubuntu`), home 750, can't read /srv/gents/web.env.

## Wine
- **winehq-devel 11.22, held**. Wine stable 11.0 and 10.0 both trip MT5's
  "A debugger has been found running in your system". Needs Windows version win11,
  WINEDEBUG unset and no AeDebug Debugger entry - start-mt5.sh does all three.
  Cancel Mono/Gecko prompts (MT5 doesn't need them).
- Prefix: ~mt5/.mt5.

## EA inputs (MQL5/Presets: gold_htf.set, vwap_fade.set)
Auto-trade, prev-day H/L break, **risk 5%**, stop 1.0 x H4 ATR14, time stop 10 days,
server GMT+2 (set 3 when EU DST starts, last Sunday of March), sessions 1000/1400/1530/2000 EAT,
**skip-if-min-lot-too-big = false** (never skips; falls back to 0.01 lot), magic 260117.
VWAP Fade: risk 5%, stop $4, target $10, 1.5 sigma, GMT+2, window 1000-1200, flat 1400, max 3/day,
trend filter on, skip-min-lot false, magic 260118. User rule: risk 5-7% max per trade, never skip on min lot.

## Reboots
Unattended upgrades never auto-reboot (52gents-unattended). The service brings MT5
back after a manual reboot by itself.
