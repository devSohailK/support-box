#!/usr/bin/env bash
# One-time EC2 preparation. Run on a fresh instance (Amazon Linux 2023 or Ubuntu 22.04/24.04):
#   curl -fsSL https://raw.githubusercontent.com/devSohailK/support-box/main/scripts/ec2-setup.sh | bash
# Installs Docker + Compose, adds a 2 GB swap file, and creates ~/support-box for deployments.
set -euo pipefail

COMPOSE_VERSION="v2.29.7"
. /etc/os-release

echo "Installing Docker on ${PRETTY_NAME}"
case "${ID}" in
  amzn)
    sudo dnf install -y docker
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    ;;
  ubuntu)
    sudo apt-get update -y
    sudo apt-get install -y docker.io docker-compose-v2
    ;;
  *)
    echo "Unsupported OS: ${ID}. Install Docker and the Compose plugin manually." >&2
    exit 1
    ;;
esac

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

# Small instances run out of memory during image pulls without swap.
if ! swapon --show | grep -q /swapfile; then
  echo "Adding 2 GB swap"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

mkdir -p "$HOME/support-box"
echo
echo "Done. Next:"
echo "  1. Log out and back in (so your user can run docker without sudo)."
echo "  2. Create $HOME/support-box/.env from .env.example with production values."
echo "  3. Push to main (or re-run the GitHub Actions workflow) to deploy."
