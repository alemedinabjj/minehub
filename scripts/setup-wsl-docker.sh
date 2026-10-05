#!/usr/bin/env bash
# One-time setup of Docker Engine inside WSL2 (Ubuntu 24.04) for HubMine development.
# Run with: sudo bash scripts/setup-wsl-docker.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
TARGET_USER="${SUDO_USER:?run via sudo from your normal user}"

# 1. Docker's official apt repository (https://docs.docker.com/engine/install/ubuntu/)
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Daemon hardening (see .claude/skills/secure-docker-provisioning):
#    - userns-remap: root inside containers maps to an unprivileged host UID range
#    - capped logs by default so no container can fill the disk with logs
#    - no inter-container communication on the default bridge
mkdir -p /etc/docker
if [[ -f /etc/docker/daemon.json ]]; then
  cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%s)"
fi
cat > /etc/docker/daemon.json <<'JSON'
{
  "userns-remap": "default",
  "icc": false,
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "no-new-privileges": true
}
JSON
systemctl enable --now docker
systemctl restart docker

# 3. Allow your user to talk to the daemon (NOTE: docker group == root-equivalent on this machine).
usermod -aG docker "$TARGET_USER"

# 4. System libraries for Playwright's Chromium (screenshots + E2E tests).
apt-get install -y libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2

docker run --rm hello-world >/dev/null && echo "Docker OK"
echo "Done. Close and reopen the terminal (or run: newgrp docker) so the docker group applies to ${TARGET_USER}."
