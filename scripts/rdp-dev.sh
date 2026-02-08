#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="docker-compose.rdp.yml"
ENV_FILE=".env.jean-rdp"

log() {
  printf '%s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_docker() {
  if ! has_cmd docker; then
    return 1
  fi

  # Docker daemon reachable?
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  # Some setups require sudo for docker.
  if has_cmd sudo && sudo -n docker info >/dev/null 2>&1; then
    export JEAN_USE_SUDO_DOCKER=1
    return 0
  fi

  return 1
}

docker_cmd() {
  if [ "${JEAN_USE_SUDO_DOCKER:-0}" = "1" ]; then
    sudo docker "$@"
  else
    docker "$@"
  fi
}

compose_cmd() {
  # Prefer "docker compose" (plugin). Fall back to docker-compose.
  if docker_cmd compose version >/dev/null 2>&1; then
    docker_cmd compose "$@"
    return
  fi

  if has_cmd docker-compose; then
    docker-compose "$@"
    return
  fi

  return 1
}

install_docker_linux_apt() {
  if [ "$(uname -s)" != "Linux" ]; then
    log "[setup] Auto-install only supports Linux."
    return 1
  fi

  if ! has_cmd sudo; then
    log "[setup] Missing sudo; cannot auto-install Docker."
    return 1
  fi

  if [ ! -r /etc/os-release ]; then
    log "[setup] Cannot detect distro (/etc/os-release missing)."
    return 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  case "${ID:-}" in
    debian|ubuntu)
      ;;
    *)
      log "[setup] Auto-install supported only on Debian/Ubuntu (detected: ${ID:-unknown})."
      return 1
      ;;
  esac

  local distro="$ID"
  local codename="${VERSION_CODENAME:-}"

  if [ -z "$codename" ]; then
    log "[setup] Missing VERSION_CODENAME; cannot configure Docker apt repo."
    return 1
  fi

  log "[setup] Installing Docker Engine + Compose plugin (${distro} ${codename})"

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg

  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${distro}/gpg" \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  local arch
  arch="$(dpkg --print-architecture)"

  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${distro} ${codename} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update
  sudo apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

  if has_cmd systemctl; then
    sudo systemctl enable --now docker || true
  fi

  if [ -n "${SUDO_USER:-}" ]; then
    sudo usermod -aG docker "$SUDO_USER" || true
    log "[setup] Added ${SUDO_USER} to docker group (re-login may be required)."
  else
    sudo usermod -aG docker "$USER" || true
    log "[setup] Added ${USER} to docker group (re-login may be required)."
  fi
}

prompt() {
  local label="$1"
  local default_value="${2:-}"
  local value

  if [ -n "$default_value" ]; then
    read -r -p "${label} [${default_value}]: " value
    value="${value:-$default_value}"
  else
    read -r -p "${label}: " value
  fi

  printf '%s' "$value"
}

prompt_secret() {
  local label="$1"
  local value
  read -r -s -p "${label}: " value
  printf '\n' >&2
  printf '%s' "$value"
}

choose_dockerfile() {
  log ""
  log "Choose base image:"
  log "  1) Debian (default, lightweight)"
  log "  2) Ubuntu (more likely to have WebKitGTK 4.1 packages)"

  local choice
  choice="$(prompt "Select" "1")"

  case "$choice" in
    2)
      printf '%s' 'docker/rdp/Dockerfile.ubuntu'
      ;;
    *)
      printf '%s' 'docker/rdp/Dockerfile'
      ;;
  esac
}

main() {
  if [ ! -f "$COMPOSE_FILE" ]; then
    log "[error] Missing ${COMPOSE_FILE}"
    exit 1
  fi

  if ! require_docker; then
    log "[setup] Docker is not available or daemon is not reachable."
    log "[setup] If you're on macOS/Windows: install Docker Desktop."
    log "[setup] If you're on Linux: install Docker Engine + Compose plugin."
    log ""

    if [ "$(uname -s)" = "Linux" ]; then
      local install_choice
      install_choice="$(prompt "Attempt auto-install on Debian/Ubuntu? (y/N)" "N")"
      if [[ "$install_choice" =~ ^[Yy]$ ]]; then
        install_docker_linux_apt || true
      fi
    fi

    if ! require_docker; then
      log "[error] Docker still not available."
      exit 1
    fi
  fi

  if ! compose_cmd version >/dev/null 2>&1; then
    log "[error] Docker Compose not found (need 'docker compose' plugin or 'docker-compose')."
    exit 1
  fi

  local rdp_user rdp_password rdp_port dockerfile
  rdp_user="$(prompt "RDP username" "dev")"
  rdp_password="$(prompt_secret "RDP password (will be stored in ${ENV_FILE})")"
  if [ -z "$rdp_password" ]; then
    log "[error] Password cannot be empty."
    exit 1
  fi

  rdp_port="$(prompt "RDP port on host" "3389")"
  dockerfile="$(choose_dockerfile)"

  cat > "$ENV_FILE" <<EOF
RDP_USER=${rdp_user}
RDP_PASSWORD=${rdp_password}
JEAN_RDP_PORT=${rdp_port}
AUTO_START_JEAN=1
JEAN_RDP_DOCKERFILE=${dockerfile}
EOF

  chmod 0600 "$ENV_FILE" || true

  log ""
  log "[run] Starting RDP dev environment"
  compose_cmd --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up --build -d

  log ""
  log "Connect via RDP:"
  log "  host: <this-machine-ip>:${rdp_port}"
  log "  user: ${rdp_user}"
  log "  pass: (stored in ${ENV_FILE})"
  log ""
  log "Logs:"
  log "  docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} logs -f"
}

main "$@"
