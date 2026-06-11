#!/bin/bash
# Aurex — Self-update cron script
#
# Watches for the .update-pending flag file written by the backend.
# When detected, pulls latest code and rebuilds Docker containers.
#
# Setup (one-time on your VPS):
#   chmod +x scripts/cron-update.sh
#   crontab -e
#   * * * * * /path/to/aurex/scripts/cron-update.sh >> /var/log/aurex-update.log 2>&1

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FLAG="$PROJECT_DIR/.update-pending"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

if [ ! -f "$FLAG" ]; then
  exit 0
fi

echo "$LOG_PREFIX Update flag detected. Starting rebuild..."

rm -f "$FLAG"

cd "$PROJECT_DIR" || { echo "$LOG_PREFIX ERROR: Cannot cd to $PROJECT_DIR"; exit 1; }

echo "$LOG_PREFIX Pulling latest code..."
git pull origin main || { echo "$LOG_PREFIX ERROR: git pull failed"; exit 1; }

echo "$LOG_PREFIX Rebuilding containers..."
docker compose up --build -d || { echo "$LOG_PREFIX ERROR: docker compose rebuild failed"; exit 1; }

echo "$LOG_PREFIX Update complete."
