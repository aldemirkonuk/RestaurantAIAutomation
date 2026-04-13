#!/usr/bin/env python3
"""
Database Migration Runner

A simple migration system for PostgreSQL/Supabase databases.

Usage:
    python migrate.py                    # Apply all pending migrations
    python migrate.py --status           # Show migration status
    python migrate.py --rollback 001     # Rollback to version 001
    python migrate.py --create "name"    # Create new migration file

Features:
    - Version-based migrations (001, 002, etc.)
    - Checksum verification
    - Transaction support
    - Rollback capability (if down migrations exist)
    - Migration status tracking
"""

import os
import sys
import hashlib
import argparse
import re
import socket
from datetime import datetime
from pathlib import Path
from typing import List, Tuple, Optional
import logging

# Try to import psycopg2 or asyncpg
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    DB_DRIVER = "psycopg2"
except ImportError:
    try:
        import asyncpg
        DB_DRIVER = "asyncpg"
    except ImportError:
        print("Error: Please install psycopg2 or asyncpg")
        print("  pip install psycopg2-binary")
        print("  or")
        print("  pip install asyncpg")
        sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Migration directory
MIGRATIONS_DIR = Path(__file__).parent / "migrations"
ROOT_DIR = Path(__file__).resolve().parents[2]

_ENV_LOADED = False


def _get_pooler_url() -> Optional[str]:
    return os.getenv("SUPABASE_POOLER_URL") or os.getenv("SUPABASE_SESSION_POOLER_URL")


def _load_env_file() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    env_path = ROOT_DIR / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    _ENV_LOADED = True


def get_database_url() -> str:
    """Get database URL from environment."""
    _load_env_file()
    database_url = os.getenv("DATABASE_URL")
    supabase_db_url = os.getenv("SUPABASE_DB_URL")
    supabase_direct_url = os.getenv("SUPABASE_DIRECT_CONNECTION_STRING")
    supabase_pooler_url = _get_pooler_url()
    url = database_url or supabase_db_url or supabase_direct_url or supabase_pooler_url
    if not url:
        # Try to construct from individual env vars
        host = os.getenv("SUPABASE_DB_HOST", "localhost")
        port = os.getenv("SUPABASE_DB_PORT", "5432")
        user = os.getenv("SUPABASE_DB_USER", "postgres")
        password = os.getenv("SUPABASE_DB_PASSWORD", "")
        database = os.getenv("SUPABASE_DB_NAME", "postgres")
        url = f"postgresql://{user}:{password}@{host}:{port}/{database}"
    return url


def get_connection():
    """Get database connection."""
    url = get_database_url()
    try:
        parsed = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(url)
    except Exception:
        parsed = None
    if parsed and parsed.hostname:
        try:
            socket.getaddrinfo(parsed.hostname, parsed.port or 5432)
        except Exception:
            pooler_url = _get_pooler_url()
            if pooler_url and pooler_url != url:
                url = pooler_url

    if DB_DRIVER == "psycopg2":
        return psycopg2.connect(url, cursor_factory=RealDictCursor)
    else:
        raise NotImplementedError("asyncpg support not yet implemented")


def calculate_checksum(content: str) -> str:
    """Calculate SHA256 checksum of migration content."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def get_migration_files() -> List[Tuple[str, str, Path]]:
    """
    Get all migration files sorted by version.
    
    Returns:
        List of (version, name, path) tuples
    """
    migrations = []
    pattern = re.compile(r"^(\d{3})_(.+)\.sql$")
    
    for file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = pattern.match(file.name)
        if match:
            version = match.group(1)
            name = match.group(2)
            migrations.append((version, name, file))
    return migrations


def get_applied_migrations(conn) -> dict:
    """Get all applied migrations from database."""
    cursor = conn.cursor()
    
    # Ensure migration tracker table exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            id SERIAL PRIMARY KEY,
            version VARCHAR(10) NOT NULL UNIQUE,
            name VARCHAR(255) NOT NULL,
            applied_at TIMESTAMPTZ DEFAULT NOW(),
            checksum VARCHAR(64),
            execution_time_ms INTEGER,
            success BOOLEAN DEFAULT TRUE,
            error_message TEXT
        )
    """)
    conn.commit()
    
    cursor.execute("SELECT version, name, checksum, applied_at FROM _migrations WHERE success = TRUE")
    rows = cursor.fetchall()
    return {row["version"]: row for row in rows}


def apply_migration(conn, version: str, name: str, path: Path) -> bool:
    """
    Apply a single migration.
    
    Args:
        conn: Database connection
        version: Migration version (e.g., "001")
        name: Migration name
        path: Path to migration file
        
    Returns:
        True if successful, False otherwise
    """
    logger.info(f"Applying migration {version}_{name}...")
    
    content = path.read_text()
    checksum = calculate_checksum(content)
    
    cursor = conn.cursor()
    start_time = datetime.now()
    
    try:
        # Execute migration in transaction
        cursor.execute(content)
        
        # Record migration
        execution_time = int((datetime.now() - start_time).total_seconds() * 1000)
        cursor.execute(
            """
            INSERT INTO _migrations (version, name, checksum, execution_time_ms, success)
            VALUES (%s, %s, %s, %s, TRUE)
            ON CONFLICT (version) DO UPDATE SET
                applied_at = NOW(),
                checksum = EXCLUDED.checksum,
                execution_time_ms = EXCLUDED.execution_time_ms,
                success = TRUE,
                error_message = NULL
            """,
            (version, name, checksum, execution_time),
        )
        
        conn.commit()
        logger.info(f"  ✓ Applied {version}_{name} ({execution_time}ms)")
        return True
        
    except Exception as e:
        conn.rollback()
        
        # Record failed migration
        try:
            cursor.execute(
                """
                INSERT INTO _migrations (version, name, checksum, success, error_message)
                VALUES (%s, %s, %s, FALSE, %s)
                ON CONFLICT (version) DO UPDATE SET
                    applied_at = NOW(),
                    success = FALSE,
                    error_message = EXCLUDED.error_message
                """,
                (version, name, checksum, str(e)),
            )
            conn.commit()
        except:
            pass
        
        logger.error(f"  ✗ Failed to apply {version}_{name}: {e}")
        return False


def run_migrations(conn) -> Tuple[int, int]:
    """
    Run all pending migrations.
    
    Returns:
        Tuple of (applied_count, failed_count)
    """
    applied_migrations = get_applied_migrations(conn)
    migration_files = get_migration_files()
    
    applied = 0
    failed = 0
    
    for version, name, path in migration_files:
        if version in applied_migrations:
            # Check checksum
            content = path.read_text()
            checksum = calculate_checksum(content)
            
            if applied_migrations[version]["checksum"] != checksum:
                logger.warning(f"  ⚠ Migration {version}_{name} has been modified since it was applied")
            continue
        
        if apply_migration(conn, version, name, path):
            applied += 1
        else:
            failed += 1
            break  # Stop on first failure
    
    return applied, failed


def show_status(conn):
    """Show migration status."""
    applied_migrations = get_applied_migrations(conn)
    migration_files = get_migration_files()
    
    print("\nMigration Status:")
    print("-" * 60)
    
    for version, name, path in migration_files:
        if version in applied_migrations:
            applied = applied_migrations[version]
            applied_at = applied["applied_at"].strftime("%Y-%m-%d %H:%M:%S")
            print(f"  ✓ {version}_{name} (applied: {applied_at})")
        else:
            print(f"  ○ {version}_{name} (pending)")
    
    print("-" * 60)
    print(f"Total: {len(migration_files)} migrations, {len(applied_migrations)} applied")


def create_migration(name: str):
    """Create a new migration file."""
    # Get next version number
    migration_files = get_migration_files()
    if migration_files:
        last_version = int(migration_files[-1][0])
        next_version = f"{last_version + 1:03d}"
    else:
        next_version = "001"
    
    # Sanitize name
    safe_name = re.sub(r"[^a-z0-9_]", "_", name.lower())
    
    # Create file
    filename = f"{next_version}_{safe_name}.sql"
    filepath = MIGRATIONS_DIR / filename
    
    template = f"""-- ============================================================================
-- Migration: {next_version}_{safe_name}
-- Created: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
-- ============================================================================

-- UP Migration
-- Add your schema changes here

-- Example:
-- CREATE TABLE IF NOT EXISTS my_table (
--     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--     name VARCHAR(255) NOT NULL,
--     created_at TIMESTAMPTZ DEFAULT NOW()
-- );

-- DOWN Migration (optional, for rollback support)
-- Wrap in a comment block and name it "-- DOWN:"
-- -- DOWN:
-- -- DROP TABLE IF EXISTS my_table;
"""
    
    filepath.write_text(template)
    print(f"Created migration: {filepath}")


def reconcile_migrations(conn) -> int:
    """Mark existing migrations as applied without executing them."""
    applied_migrations = get_applied_migrations(conn)
    migration_files = get_migration_files()
    cursor = conn.cursor()
    reconciled = 0

    for version, name, path in migration_files:
        if version in applied_migrations:
            continue
        content = path.read_text()
        checksum = calculate_checksum(content)
        cursor.execute(
            """
            INSERT INTO _migrations (version, name, checksum, execution_time_ms, success, error_message)
            VALUES (%s, %s, %s, %s, TRUE, %s)
            ON CONFLICT (version) DO NOTHING
            """,
            (version, name, checksum, 0, "reconciled_without_execution"),
        )
        reconciled += 1

    conn.commit()
    return reconciled


def main():
    parser = argparse.ArgumentParser(description="Database Migration Runner")
    parser.add_argument("--status", action="store_true", help="Show migration status")
    parser.add_argument("--create", metavar="NAME", help="Create new migration")
    parser.add_argument("--rollback", metavar="VERSION", help="Rollback to version")
    parser.add_argument("--reconcile", action="store_true", help="Mark migrations applied without running them")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    
    args = parser.parse_args()
    
    if args.create:
        create_migration(args.create)
        return
    
    # Connect to database
    try:
        conn = get_connection()
        logger.info("Connected to database")
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        sys.exit(1)
    
    try:
        if args.status:
            show_status(conn)
        elif args.reconcile:
            count = reconcile_migrations(conn)
            logger.info(f"Reconciled {count} migration(s) without execution")
        elif args.rollback:
            logger.error("Rollback not yet implemented")
            sys.exit(1)
        else:
            # Run migrations
            logger.info("Running migrations...")
            applied, failed = run_migrations(conn)
            
            if failed > 0:
                logger.error(f"Migration failed! Applied: {applied}, Failed: {failed}")
                sys.exit(1)
            elif applied > 0:
                logger.info(f"Successfully applied {applied} migration(s)")
            else:
                logger.info("No pending migrations")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
