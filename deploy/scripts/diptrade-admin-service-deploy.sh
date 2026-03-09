#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/var/www/diptrade-admin-service/repo"
SERVICE_NAME="diptrade-admin.service"
BRANCH="${BRANCH:-main}"
ENV_FILE="/etc/diptrade/admin-service.env"

echo "== Diptrade Admin Service Deploy =="
date
echo "Repo: $REPO_DIR"
echo "Service: $SERVICE_NAME"
echo "Branch: $BRANCH"
echo "Env file: $ENV_FILE"
echo

if [[ ! -d "$REPO_DIR/.git" ]]; then
  echo "ERROR: repo not found or not a git repo: $REPO_DIR" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

cd "$REPO_DIR"

echo "-- git fetch"
git fetch --all --prune

echo "-- git checkout $BRANCH"
git checkout "$BRANCH"

echo "-- git pull (ff-only)"
git pull --ff-only

if [[ -f "package-lock.json" ]]; then
  echo
  echo "-- npm ci"
  npm ci --omit=dev
fi

echo
echo "-- reload systemd"
systemctl daemon-reload

echo
echo "-- restart service"
systemctl restart "$SERVICE_NAME"

echo
echo "-- status"
systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
echo "-- logs"
journalctl -u "$SERVICE_NAME" -n 80 --no-pager

echo
echo "OK: admin-service deployed."
