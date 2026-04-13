#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL is not set."
  echo "   Example: export DATABASE_URL='postgresql://user:pass@host:5432/postgres'"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/wineops_backup_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "📦 Creating backup at ${OUTPUT_FILE}"
pg_dump --format=custom --file "${OUTPUT_FILE}" "${DATABASE_URL}"

echo "✅ Backup complete"
