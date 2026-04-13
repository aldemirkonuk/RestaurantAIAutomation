#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL is not set."
  echo "   Example: export DATABASE_URL='postgresql://user:pass@host:5432/postgres'"
  exit 1
fi

BACKUP_FILE="${1:-${BACKUP_FILE:-}}"
if [[ -z "${BACKUP_FILE}" ]]; then
  echo "❌ No backup file provided."
  echo "   Usage: ./scripts/restore_db.sh /path/to/backup.dump"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "❌ Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "♻️ Restoring backup from ${BACKUP_FILE}"
pg_restore --clean --if-exists --no-owner --dbname "${DATABASE_URL}" "${BACKUP_FILE}"

echo "✅ Restore complete"
