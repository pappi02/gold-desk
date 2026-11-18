#!/usr/bin/env bash
# Starts MetaTrader 5 for the mt5 user. MT5 refuses to run if it thinks a debugger
# is attached: WINEDEBUG must be unset and Wine's AeDebug crash-debugger entry removed.
# If ~/mt5-once.ini exists it is passed as /config for this start only (used to
# attach the EA to its chart once), then renamed so later starts don't add a copy.
unset WINEDEBUG
export WINEPREFIX="$HOME/.mt5"
export DISPLAY="${DISPLAY:-:99}"
wine reg add "HKCU\\Software\\Wine" /v Version /d win11 /f >/dev/null 2>&1
for k in "HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AeDebug" "HKLM\\Software\\Wow6432Node\\Microsoft\\Windows NT\\CurrentVersion\\AeDebug"; do
  wine reg delete "$k" /v Debugger /f >/dev/null 2>&1
done
T="$WINEPREFIX/drive_c/Program Files/MetaTrader 5"
cd "$T" || exit 1
if [ -f "$HOME/mt5-once.ini" ]; then
  cp "$HOME/mt5-once.ini" "$T/Config/once.ini"
  mv "$HOME/mt5-once.ini" "$HOME/mt5-once.ini.used"
  exec wine terminal64.exe '/config:Config\once.ini'
fi
exec wine terminal64.exe
