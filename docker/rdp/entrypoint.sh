#!/usr/bin/env bash

set -euo pipefail

RDP_USER="${RDP_USER:-dev}"
RDP_PASSWORD="${RDP_PASSWORD:-dev}"

if ! id "$RDP_USER" >/dev/null 2>&1; then
  echo "[rdp] Creating user: ${RDP_USER}"
  useradd -m -s /bin/bash "$RDP_USER"
  usermod -aG sudo "$RDP_USER"
fi

echo "${RDP_USER}:${RDP_PASSWORD}" | chpasswd

# Make sure the desktop session starts reliably
USER_HOME="$(getent passwd "$RDP_USER" | cut -d: -f6)"
mkdir -p "${USER_HOME}"

if [ ! -f "${USER_HOME}/.xsession" ]; then
  echo 'startxfce4' > "${USER_HOME}/.xsession"
  chown "${RDP_USER}:${RDP_USER}" "${USER_HOME}/.xsession"
fi

# Autostart Jean dev workflow on desktop login (optional)
mkdir -p "${USER_HOME}/.config/autostart"
cat > "${USER_HOME}/.config/autostart/jean-dev.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Jean Dev
Exec=/usr/local/bin/jean-start-on-login.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
chown -R "${RDP_USER}:${RDP_USER}" "${USER_HOME}/.config"

# If repo is mounted, keep common cache dirs writable for the RDP user
mkdir -p /workspace/node_modules /workspace/src-tauri/target "${USER_HOME}/.npm" || true
chown -R "${RDP_USER}:${RDP_USER}" \
  /workspace/node_modules \
  /workspace/src-tauri/target \
  "${USER_HOME}/.npm" \
  /usr/local/cargo \
  /usr/local/rustup \
  2>/dev/null || true

echo "[rdp] XRDP listening on :3389"
echo "[rdp] Login: ${RDP_USER} / ${RDP_PASSWORD}"
if [ "${AUTO_START_JEAN:-1}" = "1" ]; then
  echo "[rdp] Auto-start: enabled (will launch after RDP login)"
else
  echo "[rdp] Auto-start: disabled"
  echo "[rdp] In the RDP desktop, run: cd /workspace && npm install && npm run tauri:dev:rdp"
fi

# System DBus is optional but reduces desktop weirdness
if command -v dbus-daemon >/dev/null 2>&1; then
  dbus-daemon --system --fork || true
fi

# Start XRDP services (no systemd in container)
/usr/sbin/xrdp-sesman || true
exec /usr/sbin/xrdp --nodaemon
