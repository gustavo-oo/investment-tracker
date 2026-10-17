#!/usr/bin/env bash
# backup.sh — backup consistente do SQLite (WAL-aware, via API de backup do
# better-sqlite3). Chamado pelo motor apps-deploy antes de cada up (env:
# APP_IMAGE, DATA_DIR, BACKUP_DIR). Também serve para dump manual/migração.
set -euo pipefail

: "${APP_IMAGE:?APP_IMAGE não definida}"
: "${DATA_DIR:?DATA_DIR não definida}"
: "${BACKUP_DIR:?BACKUP_DIR não definida}"

mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/investments-$(date -u +%Y%m%dT%H%M%SZ).db"

docker run --rm --user root --entrypoint node -w /app \
  -v "$DATA_DIR:/app/data" -v "$BACKUP_DIR:/app/backups" "$APP_IMAGE" \
  -e "const db=require('better-sqlite3')('/app/data/investments.db');db.backup('/app/backups/$(basename "$file")').then(()=>{console.log('BACKUP_OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
