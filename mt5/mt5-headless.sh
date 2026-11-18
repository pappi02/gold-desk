#!/usr/bin/env bash
# Run by mt5.service: a private X display (:99) with a window manager, a
# localhost-only VNC view of it, then MetaTrader 5 in the foreground.
export DISPLAY=:99
Xvfb :99 -screen 0 1600x900x24 -nolisten tcp &
for i in $(seq 1 20); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.5; done
xfwm4 >/dev/null 2>&1 &
x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -nopw -quiet >/dev/null 2>&1 &
exec /home/mt5/start-mt5.sh
