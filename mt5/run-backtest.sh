#!/usr/bin/env bash
# Usage: run-backtest.sh htf|vwap  - runs one MT5 Strategy Tester job in the separate
# MT5Tester copy on its own X display (:98), then the terminal shuts itself down.
unset WINEDEBUG
export WINEPREFIX="$HOME/.mt5" DISPLAY=:98
pgrep -f "Xvfb :98" >/dev/null || { Xvfb :98 -screen 0 1600x900x24 -nolisten tcp >/dev/null 2>&1 & sleep 2; }
T="$WINEPREFIX/drive_c/Program Files/MT5Tester"
cp "$HOME/bt_$1.ini" "$T/Config/bt_$1.ini"
cd "$T" || exit 1
wine terminal64.exe /portable "/config:Config\\bt_$1.ini"
echo "terminal exited $?"
