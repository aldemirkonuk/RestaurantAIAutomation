"""
F-918 follow-up: every script that writes master_wine_library.price_reference
also writes price_reference_currency, from the code its source record carries,
and NULL when the record carries none. Never USD by default.

The writers talk to Postgres or Supabase at import or run time, so their
drivers are replaced with recording fakes for the length of each test (and put
back after, so no other test in the run sees them).
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import types

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load(monkeypatch, name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


class _Cursor:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((sql, params))

    def fetchone(self):
        return (0,)

    def fetchall(self):
        return []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Conn:
    def __init__(self, log):
        self.log = log
        self.autocommit = True

    def cursor(self):
        return _Cursor(self.log)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


def _fake_psycopg2(monkeypatch, log, captured_rows=None):
    pg = types.ModuleType("psycopg2")
    pg.connect = lambda *a, **k: _Conn(log)
    extras = types.ModuleType("psycopg2.extras")

    def execute_values(cur, sql, rows, page_size=100):
        log.append((sql, None))
        if captured_rows is not None:
            captured_rows.extend(rows)

    extras.execute_values = execute_values
    pg.extras = extras
    monkeypatch.setitem(sys.modules, "psycopg2", pg)
    monkeypatch.setitem(sys.modules, "psycopg2.extras", extras)


# ── scripts/load_enriched_wines.py (the menu_corpus loader) ─────────────────

def _run_loader(monkeypatch, tmp_path, extracted: dict):
    log: list = []
    _fake_psycopg2(monkeypatch, log)
    mod = _load(monkeypatch, "load_enriched_wines_f918", ROOT / "scripts/load_enriched_wines.py")
    (tmp_path / "enriched.json").write_text(json.dumps([{
        "extracted": {"name": "Etna Rosso", "producer": "Benanti", "vintage": "2021", **extracted},
        "enrichment": {"knowledge": "known", "primary_type": "red", "country": "Italy"},
    }]))
    monkeypatch.setenv("SUPABASE_DB_URL", "postgres://fake")
    monkeypatch.setattr(sys, "argv", ["load", "--in", str(tmp_path), "--apply"])
    assert mod.main() == 0
    inserts = [(sql, p) for sql, p in log if "INSERT INTO master_wine_library" in sql]
    assert len(inserts) == 1
    sql, params = inserts[0]
    cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
    assert "price_reference_currency" in cols
    # Every column before bottle_size_ml (a literal 750) is a placeholder, in order.
    return dict(zip(cols[: cols.index("bottle_size_ml")], params))


def test_loader_writes_the_currency_the_menu_record_names(monkeypatch, tmp_path):
    row = _run_loader(monkeypatch, tmp_path, {"bottle_price": 62, "currency": "TRY"})
    assert row["price_reference"] == 62
    assert row["price_reference_currency"] == "TRY"


def test_loader_leaves_it_null_when_the_menu_record_names_none(monkeypatch, tmp_path):
    row = _run_loader(monkeypatch, tmp_path, {"bottle_price": 62})
    assert row["price_reference"] == 62
    assert row["price_reference_currency"] is None


def test_loader_does_not_read_a_symbol_as_dollars(monkeypatch, tmp_path):
    row = _run_loader(monkeypatch, tmp_path, {"bottle_price": 62, "currency": "$"})
    assert row["price_reference_currency"] is None


# ── services/database/import_master_wine_library.py (the JSONL importer) ───

def _run_importer(monkeypatch, tmp_path, raw: dict):
    log: list = []
    rows: list = []
    _fake_psycopg2(monkeypatch, log, rows)
    mod = _load(
        monkeypatch, "import_master_wine_library_f918",
        ROOT / "services/database/import_master_wine_library.py",
    )
    jsonl = tmp_path / "lib.jsonl"
    jsonl.write_text(json.dumps({"WINE_ID": "WINE_001", "name": "Prosecco", **raw}) + "\n")
    monkeypatch.setattr(mod, "JSONL_PATH", jsonl)
    monkeypatch.setenv("DATABASE_URL", "postgres://fake")
    mod.main()
    sql = next(s for s, _ in log if "INSERT INTO public.master_wine_library" in s)
    cols = [c.strip() for c in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
    assert "price_currency" not in cols and "price_reference_currency" in cols
    assert "price_reference_currency = EXCLUDED.price_reference_currency" in sql
    assert len(rows) == 1 and len(rows[0]) == len(cols)
    return dict(zip(cols, rows[0]))


def test_importer_writes_the_currency_the_row_names(monkeypatch, tmp_path):
    row = _run_importer(monkeypatch, tmp_path, {"price": 48, "price_currency": "usd"})
    assert row["price_reference"] == 48
    assert row["price_reference_currency"] == "USD"


def test_importer_leaves_it_null_when_the_row_names_none(monkeypatch, tmp_path):
    row = _run_importer(monkeypatch, tmp_path, {"price": 48})
    assert row["price_reference_currency"] is None


# ── scripts/seed_database.py (the demo seed) ───────────────────────────────

def _run_seed(monkeypatch, wine: dict):
    upserts: list = []

    class _Table:
        def upsert(self, batch, **_):
            upserts.extend(batch)
            return self

        def execute(self):
            return None

    supa = types.ModuleType("supabase")
    supa.Client = object
    supa.create_client = lambda *a, **k: types.SimpleNamespace(table=lambda name: _Table())
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "supabase", supa)
    monkeypatch.setitem(sys.modules, "dotenv", dotenv)
    monkeypatch.setitem(sys.modules, "bcrypt", types.ModuleType("bcrypt"))
    monkeypatch.setenv("SUPABASE_URL", "http://fake")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "fake")
    monkeypatch.setattr(sys, "path", list(sys.path))
    mod = _load(monkeypatch, "seed_database_f918", ROOT / "scripts/seed_database.py")
    assert mod.seed_master_wine_library([wine]) is True
    assert len(upserts) == 1
    return upserts[0]


def test_seed_writes_the_currency_the_wine_names(monkeypatch):
    row = _run_seed(monkeypatch, {"name": "Barolo", "price": 90, "currency": "EUR"})
    assert row["price_reference"] == 90
    assert row["price_reference_currency"] == "EUR"


def test_seed_leaves_it_null_when_the_wine_names_none(monkeypatch):
    row = _run_seed(monkeypatch, {"name": "Barolo", "price": 90})
    assert row["price_reference_currency"] is None
