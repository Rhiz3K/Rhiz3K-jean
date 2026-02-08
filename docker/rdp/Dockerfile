FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# System + build deps + Tauri Linux deps + lightweight desktop + RDP
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    sudo \
    git \
    unzip \
    xz-utils \
    build-essential \
    pkg-config \
    python3 \
    libssl-dev \
    libgtk-3-dev \
    librsvg2-dev \
    patchelf \
    dbus-x11 \
    xrdp \
    xorgxrdp \
    xauth \
    x11-xserver-utils \
    mesa-utils \
    xfce4-session \
    xfce4-panel \
    xfwm4 \
    xfce4-terminal \
    thunar; \
  if apt-cache show libwebkit2gtk-4.1-dev >/dev/null 2>&1; then \
    apt-get install -y --no-install-recommends libwebkit2gtk-4.1-dev; \
  elif apt-cache show libwebkit2gtk-4.0-dev >/dev/null 2>&1; then \
    apt-get install -y --no-install-recommends libwebkit2gtk-4.0-dev; \
  else \
    echo "No libwebkit2gtk dev package found (need 4.0 or 4.1)"; \
    exit 1; \
  fi; \
  if apt-cache show libayatana-appindicator3-dev >/dev/null 2>&1; then \
    apt-get install -y --no-install-recommends libayatana-appindicator3-dev; \
  elif apt-cache show libappindicator3-dev >/dev/null 2>&1; then \
    apt-get install -y --no-install-recommends libappindicator3-dev; \
  else \
    echo "No appindicator dev package found (need libayatana-appindicator3-dev or libappindicator3-dev)"; \
    exit 1; \
  fi; \
  rm -rf /var/lib/apt/lists/*

# GitHub CLI (needed by Jean's backend integrations)
RUN apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Rust toolchain via rustup
ENV RUSTUP_HOME=/usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo
ENV PATH=/usr/local/cargo/bin:$PATH

RUN mkdir -p "$RUSTUP_HOME" "$CARGO_HOME" \
  && curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rustup component add rustfmt clippy

# Default dev user (matches typical host UID 1000)
RUN useradd -m -s /bin/bash -u 1000 dev \
  && usermod -aG sudo dev \
  && echo 'dev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dev \
  && chmod 0440 /etc/sudoers.d/dev \
  && chown -R dev:dev /usr/local/cargo /usr/local/rustup

# Ensure XRDP starts XFCE
RUN if ! command -v startxfce4 >/dev/null 2>&1; then \
    printf '%s\n' '#!/bin/sh' 'exec xfce4-session' > /usr/local/bin/startxfce4; \
    chmod +x /usr/local/bin/startxfce4; \
  fi \
  && echo 'startxfce4' > /etc/skel/.xsession

WORKDIR /workspace

COPY docker/rdp/entrypoint.sh /entrypoint.sh
COPY docker/rdp/jean-start-on-login.sh /usr/local/bin/jean-start-on-login.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/jean-start-on-login.sh

EXPOSE 3389

ENTRYPOINT ["/entrypoint.sh"]
