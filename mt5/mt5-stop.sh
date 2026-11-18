#!/usr/bin/env bash
# ExecStop for mt5.service: close MetaTrader 5 like a user would (Alt+F4 on the
# main window) so it saves its charts and EA settings, then wait for it to exit.
export DISPLAY=:99
w=$(xdotool search --name "MetaQuotes-Demo" 2>/dev/null | head -1)
[ -z "$w" ] && w=$(xdotool search --name "MetaTrader 5" 2>/dev/null | head -1)
if [ -n "$w" ]; then
  xdotool key Escape 2>/dev/null
  xdotool windowactivate --sync "$w" key alt+F4 2>/dev/null
fi
for i in $(seq 1 45); do pgrep -u mt5 -f terminal64.exe >/dev/null || exit 0; sleep 2; done
exit 0
