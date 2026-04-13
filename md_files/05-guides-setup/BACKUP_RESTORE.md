# Backup and Restore (Postgres)

## Overview
These scripts provide a consistent backup/restore path for WineOps AI using `pg_dump` and `pg_restore`.

## Prerequisites
- `pg_dump` and `pg_restore` installed (Postgres client tools)
- `DATABASE_URL` set in your shell

## Backup
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/postgres"
./scripts/backup_db.sh
```

Default output:
- `backups/wineops_backup_YYYYMMDD_HHMMSS.dump`

Optional:
```bash
export BACKUP_DIR=/path/to/backups
./scripts/backup_db.sh
```

## Restore
```bash
export DATABASE_URL="postgresql://user:pass@host:5432/postgres"
./scripts/restore_db.sh /path/to/backup.dump
```

Optional:
```bash
export BACKUP_FILE=/path/to/backup.dump
./scripts/restore_db.sh
```

## Safety Notes
- Restore uses `--clean --if-exists` and will drop objects before restoring.
- Do not restore production without a verified backup.
- Run a restore drill monthly and log results.
