"""`scripts/check_fk_targets_exist.py` — the guard 29e439c4 earned.

Every case here is a shape the guard must judge, written as a throwaway
migrations directory rather than against the repo, so the suite never depends on
the corpus staying still. The last two cases DO read the repo: one asserts the
shipped migration set passes, the other rebuilds the pre-fix file from git and
asserts the guard fails on it, naming both the foreign key and the rename.

    pytest scripts/test_fk_targets_exist.py -q
"""

from __future__ import annotations

import pathlib
import subprocess

import pytest

from scripts.check_fk_targets_exist import CannotCheck, normalise, walk

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = REPO_ROOT / "supabase" / "migrations"
THE_COMMIT = "29e439c4"
THE_FILE = "supabase/migrations/20260904230000_a_tool_the_house_has_seen_before.sql"
THE_RENAME = "supabase/migrations/20260903151000_the_house_declares_a_person_consents.sql"

CREATE_A = "CREATE TABLE public.a (id uuid primary key);\n"


def run(tmp_path: pathlib.Path, files: dict[str, str]):
    for name, body in files.items():
        (tmp_path / name).write_text(body, encoding="utf-8")
    return walk(tmp_path, "t")


# --------------------------------------------------------------------------
# The defect
# --------------------------------------------------------------------------

def test_a_key_at_a_renamed_away_name_fails_and_names_the_rename(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_rename.sql": "ALTER TABLE public.a RENAME TO b;\n",
        "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
    })
    assert len(rep.failures) == 1
    only = rep.failures[0]
    assert "003_fk.sql:1" in only          # the key, by line
    assert "public.a" in only
    assert "002_rename.sql:1" in only      # the rename that removed it, by line
    assert "renamed to b" in only


def test_the_same_set_with_the_key_repointed_passes(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_rename.sql": "ALTER TABLE public.a RENAME TO b;\n",
        "003_fk.sql": "CREATE TABLE public.c (b_id uuid REFERENCES public.b(id));\n",
    })
    assert rep.failures == []
    assert rep.fks_checked == 1


def test_a_rename_inside_a_do_block_is_seen(tmp_path):
    """The rename that caused the defect lives inside `DO $$ ... $$`."""
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_rename.sql": (
            "DO $$\nBEGIN\n"
            "  IF to_regclass('public.a') IS NOT NULL THEN\n"
            "    ALTER TABLE public.a\n      RENAME TO b;\n"
            "  END IF;\nEND\n$$;\n"
        ),
        "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
    })
    assert len(rep.failures) == 1
    assert "renamed to b" in rep.failures[0]


def test_order_is_by_filename_not_by_directory_listing(tmp_path):
    """A key written BEFORE the rename is fine; the same key after it is not."""
    ok = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
        "003_rename.sql": "ALTER TABLE public.a RENAME TO b;\n",
    })
    assert ok.failures == []


def test_a_drop_removes_the_target(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_drop.sql": "DROP TABLE IF EXISTS public.a CASCADE;\n",
        "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
    })
    assert len(rep.failures) == 1
    assert "dropped" in rep.failures[0]


def test_a_name_nothing_creates_fails(tmp_path):
    rep = run(tmp_path, {
        "001_fk.sql": "CREATE TABLE public.c (x uuid REFERENCES public.ghost(id));\n",
    })
    assert len(rep.failures) == 1
    assert "no migration up to" in rep.failures[0]


def test_a_key_at_a_view_is_named_as_a_view(tmp_path):
    rep = run(tmp_path, {
        "001_v.sql": "CREATE VIEW public.v AS SELECT 1;\n",
        "002_fk.sql": "CREATE TABLE public.c (x uuid REFERENCES public.v(id));\n",
    })
    assert len(rep.failures) == 1
    assert "is a VIEW" in rep.failures[0]


# --------------------------------------------------------------------------
# What must NOT be read as a foreign key
# --------------------------------------------------------------------------

@pytest.mark.parametrize("body", [
    "-- one day this REFERENCES public.ghost(id)\n",
    "/* REFERENCES public.ghost(id) */\n",
    "/* outer /* nested REFERENCES public.ghost(id) */ still comment */\n",
])
def test_a_reference_in_a_comment_is_not_a_foreign_key(tmp_path, body):
    rep = run(tmp_path, {"001_a.sql": CREATE_A, "002_c.sql": body + CREATE_A.replace("a ", "c ")})
    assert rep.failures == []


def test_rename_column_is_not_rename_to(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_col.sql": "ALTER TABLE public.a RENAME COLUMN id TO a_id;\n",
        "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(a_id));\n",
    })
    assert rep.failures == []


def test_alter_index_rename_to_does_not_move_a_table(tmp_path):
    """20260903151000 renames a table and two INDEXES; only the table counts."""
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A + "CREATE INDEX idx_a ON public.a (id);\n",
        "002_idx.sql": "ALTER INDEX IF EXISTS public.idx_a RENAME TO idx_a2;\n",
        "003_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
    })
    assert rep.failures == []
    assert rep.renames == 0


def test_a_self_reference_inside_its_own_create_resolves(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": "CREATE TABLE public.a (id uuid primary key, parent uuid REFERENCES public.a(id));\n",
    })
    assert rep.failures == []


def test_a_bare_name_resolves_to_public(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": "CREATE TABLE a (id uuid primary key);\n",
        "002_fk.sql": "CREATE TABLE public.c (a_id uuid REFERENCES a(id));\n",
    })
    assert rep.failures == []


def test_an_add_constraint_foreign_key_is_checked(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_rename.sql": "ALTER TABLE public.a RENAME TO b;\n",
        "003_c.sql": (
            "CREATE TABLE public.c (a_id uuid);\n"
            "ALTER TABLE ONLY public.c\n"
            "  ADD CONSTRAINT c_a_fkey FOREIGN KEY (a_id) REFERENCES public.a(id);\n"
        ),
    })
    assert len(rep.failures) == 1
    assert "003_c.sql:3" in rep.failures[0]


def test_external_schemas_are_skipped_and_counted(tmp_path):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_fk.sql": "CREATE TABLE public.c (u uuid REFERENCES auth.users(id), a uuid REFERENCES public.a(id));\n",
    })
    assert rep.failures == []
    assert rep.fks_external == 1
    assert rep.fks_checked == 1


@pytest.mark.parametrize("name,expected", [
    ("a", "public.a"),
    ("Public.A", "public.a"),
    ('public."Mixed"', "public.Mixed"),
    ("public . a", "public.a"),
])
def test_normalise(name, expected):
    assert normalise(name) == expected


# --------------------------------------------------------------------------
# Cannot check is never a pass
# --------------------------------------------------------------------------

def test_an_empty_directory_cannot_check(tmp_path):
    with pytest.raises(CannotCheck, match="no .sql files"):
        walk(tmp_path, "t")


def test_a_missing_directory_cannot_check(tmp_path):
    with pytest.raises(CannotCheck, match="not a directory"):
        walk(tmp_path / "nope", "t")


def test_a_corpus_with_no_foreign_keys_is_not_a_pass(tmp_path):
    rep = run(tmp_path, {"001_a.sql": CREATE_A})
    assert rep.fks_checked == 0  # render() turns this into exit 2, not exit 0


def test_dynamic_ddl_refuses_to_parse(tmp_path):
    with pytest.raises(CannotCheck, match="dynamic DDL"):
        run(tmp_path, {"001.sql": "DO $$ BEGIN EXECUTE 'CREATE TABLE public.z (id uuid)'; END $$;\n"})


def test_a_dynamic_rename_refuses_to_parse(tmp_path):
    with pytest.raises(CannotCheck, match="dynamic DDL"):
        run(tmp_path, {"001.sql": "DO $$ BEGIN EXECUTE 'alter table public.a rename to b'; END $$;\n"})


@pytest.mark.parametrize("body", [
    # OD-73 enables RLS in a loop; that changes security, never a name.
    "DO $$ BEGIN EXECUTE format('alter table public.%I enable row level security', 'a'); END $$;\n",
    # The baseline reads the RFC-822 `references` header out of jsonb.
    "CREATE FUNCTION public.f(h jsonb) RETURNS text AS $$ BEGIN RETURN h ->> 'references'; END $$ LANGUAGE plpgsql;\n",
])
def test_the_two_near_misses_do_not_refuse(tmp_path, body):
    rep = run(tmp_path, {
        "001_a.sql": CREATE_A,
        "002_near.sql": body + "CREATE TABLE public.c (a_id uuid REFERENCES public.a(id));\n",
    })
    assert rep.failures == []
    assert rep.fks_checked == 1


def test_an_unterminated_dollar_quote_cannot_check(tmp_path):
    with pytest.raises(CannotCheck, match="unterminated dollar-quote"):
        run(tmp_path, {"001.sql": "DO $$ BEGIN NULL;\n"})


def test_an_unterminated_block_comment_cannot_check(tmp_path):
    with pytest.raises(CannotCheck, match="unterminated /[*] block comment"):
        run(tmp_path, {"001.sql": "/* open forever\nCREATE TABLE public.a (id uuid);\n"})


# --------------------------------------------------------------------------
# Against the repository itself
# --------------------------------------------------------------------------

def test_the_shipped_migration_set_passes():
    rep = walk(MIGRATIONS, "supabase/migrations")
    assert rep.failures == [], "\n".join(rep.failures)
    assert rep.fks_checked > 300, "the extraction rotted -- it used to find 329"
    assert rep.renames >= 1, "20260903151000's rename must still be seen"


def test_the_prefix_file_fails_and_the_fixed_one_passes(tmp_path):
    """The proof: `git show 29e439c4:<the file>` in place of the fixed one.

    Skipped, never silently passed, if the commit is not in this checkout.
    """
    try:
        prefix = subprocess.run(
            ["git", "show", f"{THE_COMMIT}:{THE_FILE}"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        pytest.skip(f"{THE_COMMIT} is not reachable from this checkout: {e}")
        raise  # pytest.skip already raises; this makes that visible to readers
               # and to analysis, so `prefix` below is provably assigned.

    for src in sorted(MIGRATIONS.glob("*.sql")):
        (tmp_path / src.name).symlink_to(src)
    target = tmp_path / pathlib.Path(THE_FILE).name
    target.unlink()
    target.write_text(prefix, encoding="utf-8")

    rep = walk(tmp_path, "t")
    assert len(rep.failures) == 1, rep.failures
    only = rep.failures[0]
    assert "20260904230000_a_tool_the_house_has_seen_before.sql:52" in only
    assert "public.user_mcp_connections" in only
    assert "20260903151000_the_house_declares_a_person_consents.sql:64" in only
    assert "renamed to restaurant_mcp_connections" in only

    # ...and the fixed file, in the same directory, passes.
    target.unlink()
    target.symlink_to(MIGRATIONS / pathlib.Path(THE_FILE).name)
    assert walk(tmp_path, "t").failures == []
