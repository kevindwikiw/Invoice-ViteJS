#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/orbit-archive-worker
SERVICE_USER=orbit-archive

sudo apt-get update
sudo apt-get install -y python3 python3-venv
sudo useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null || id "$SERVICE_USER" >/dev/null
sudo mkdir -p "$APP_DIR/archives" "$APP_DIR/shared"
sudo install -m 0644 "$SOURCE_DIR/archive_worker.py" "$SOURCE_DIR/requirements.txt" "$APP_DIR/"
sudo install -m 0644 "$SOURCE_DIR/../shared/drive_source.py" "$APP_DIR/shared/drive_source.py"
sudo install -m 0755 "$SOURCE_DIR/deploy/check-archive-worker.sh" /usr/local/sbin/orbit-archive-monitor
sudo install -m 0644 "$SOURCE_DIR/deploy/orbit-archive-monitor.service" "$SOURCE_DIR/deploy/orbit-archive-monitor.timer" /etc/systemd/system/
sudo python3 -m venv "$APP_DIR/.venv"
sudo "$APP_DIR/.venv/bin/pip" install --only-binary=:all: -r "$APP_DIR/requirements.txt"
sudo chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/archives"
sudo chmod 0700 "$APP_DIR/archives"
sudo install -m 0644 "$SOURCE_DIR/deploy/orbit-archive-worker.service" /etc/systemd/system/orbit-archive-worker.service
echo "Create /etc/orbit-archive-worker.env from .env.example (root-only, chmod 600), then run:"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now orbit-archive-worker"
echo "  sudo systemctl enable --now orbit-archive-monitor.timer"
