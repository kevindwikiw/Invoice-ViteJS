#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/orbit-face-worker
SERVICE_USER=orbit-worker

sudo apt-get update
sudo apt-get install -y python3 python3-venv rclone
sudo useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null || true
sudo mkdir -p "$APP_DIR" /mnt/orbit-drive
sudo cp -R ./* "$APP_DIR/"
sudo python3 -m venv "$APP_DIR/.venv"
sudo "$APP_DIR/.venv/bin/pip" install --upgrade pip
sudo "$APP_DIR/.venv/bin/pip" install --only-binary=:all: -r "$APP_DIR/requirements.txt"
sudo "$APP_DIR/.venv/bin/python" "$APP_DIR/model_assets.py"
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR" /mnt/orbit-drive
sudo install -m 0644 deploy/orbit-face-worker.service /etc/systemd/system/orbit-face-worker.service
echo "Create /etc/orbit-face-worker.env, then run:"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now orbit-face-worker"
