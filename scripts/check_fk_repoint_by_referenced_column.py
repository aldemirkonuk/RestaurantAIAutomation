#!/usr/bin/env python3
"""Guard: a catalog-driven repoint names the referencing column, not every column.

WHY THIS EXISTS
---------------
`merge_library_wines()` discovers the foreign keys it must repoint from
pg_constraint rather than from a hard-coded list. That is the right call -- a
hard-coded list is wrong the moment someone adds a referencing table, and wrong
silently. But both of its discovery loops unnested `conkey` on its own:

    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum

`conkey` is the list of REFERENCING columns; `confkey` is the list of columns
they reference, positionally paired. Unnesting one without the other throws the
pairing away, so for a COMPOSITE foreign key the loop emits one
`UPDATE t SET <col> = <keeper id> WHERE <col> = <keeper id>` per COMPONENT --
including components that reference something other than the key.

Measured on Postgres 17 (2026-09-02), that has three outcomes, and the one that
is easiest to imagine is the rarest:

  1. Non-uuid component -- `(inventory_id, uom)`, the shape ADR 0070 introduces:
     `42883 operator does not exist: text = uuid`. The MERGE ABORTS, naming an
     operator nobody wrote in a statement nobody wrote.
  2. uuid component, all components non-null: the composite FK rejects the
     rewrite itself, `23503`. Merge aborts.
  3. uuid component with another component NULL: MATCH SIMPLE -- the default,
     and what every FK in this schema is -- does not enforce a partially null
     key, so the wrong-column write LANDS, unchecked and silent.

Fixed by ADR 0076 / 20260902160000_merge_repoints_by_referenced_column.sql,
which pairs conkey with confkey by ordinality in `public.fk_repoint_plan()`.

WHAT THIS CHECKS
----------------
A. THE SHAPE. No SQL in this repository unnests `conkey` without pairing it to
   `confkey`. Four historical migrations do, and are allowlisted below: they are
   already applied and each is superseded by a later definition, so editing them
   would be schema drift, not a fix. Anything NEW carrying the shape fails.

B. THE FIX IS STILL THE LIVE ONE. The most recent migration that defines
   `merge_library_wines` must route both of its repoint loops through
   `public.fk_repoint_plan(`. A later `CREATE OR REPLACE` that quietly drops it
   is the realistic way this regresses, and check A alone would not see it if
   the replacement hard-coded a column list instead.

  ./scripts/check_fk_repoint_by_referenced_column.py
  ./scripts/check_fk_repoint_by_referenced_column.py --self-test
  ./scripts/check_fk_repoint_by_referenced_column.py --against-database

Exit 0 = pass.  Exit 1 = violation.  Exit 2 = could not check.

Exit 2 is CANNOT CHECK, never a skip: the migrations directory is missing, an
allowlisted file has been renamed out from under the allowlist, or no definition
of merge_library_wines could be found. Fix the anchor; do not delete the step.

THE --against-database ARM
--------------------------
Checks A and B read text. They cannot tell you the fix WORKS -- only that it is
present. `--against-database` builds real composite foreign keys against a live
schema and asserts the behaviour: one plan row per constraint (not one per
component), a stated `problem` for a key that references no id, and a refusal
that names the constraint when a composite key would reject the repointed rows.
It runs in schema-parity.yml against the freshly reset local stack, where the
migrations have just been applied and no secret is involved. Everything it does
happens inside a transaction that is rolled back.

WHAT THIS DOES NOT CATCH
------------------------
The sibling defect in the same function, filed as OD-119: the UNIQUE-collision
loop reads `pg_index.indkey` and joins to pg_attribute by attnum, so an
expression column (attnum 0) is dropped from its comparison list and a partial
index's `indpred` is ignored entirely -- both of which make the collision DELETE
match MORE rows than it should. Same family, different catalog, and it needs its
own evidence. Nothing here sees it.
"""

import argparse
import os
import re
import subprocess
import sys

MIGRATIONS = "supabase/migrations"

# Applied and superseded. Each defines merge_library_wines with the pre-fix
# shape and each is replaced by a later definition -- 20260818020000 by
# 20260902160000, the rest by 20260818020000. Editing an applied migration is
# drift, so these are recorded rather than corrected.
HISTORICAL = {
    "supabase/migrations/20260813030000_merge_library_wines.sql",
    "supabase/migrations/20260813040000_merge_dry_run_reports_steps.sql",
    "supabase/migrations/20260817120000_nondestructive_merge.sql",
    "supabase/migrations/20260818020000_merge_undo_honesty.sql",
}

FIX = "supabase/migrations/20260902160000_merge_repoints_by_referenced_column.sql"
COLLIDE = "supabase/migrations/20260902180000_a_unique_index_decides_what_collides.sql"

# The same failure, one catalog over. The collision loop rebuilt each UNIQUE
# index's equality test from pg_index.indkey and got it wrong five ways --
# expression columns (attnum 0) dropped, indpred ignored, INCLUDE columns
# treated as key columns, invalid indexes treated as constraints, and
# IS NOT DISTINCT FROM making NULL equal NULL when a NULLS DISTINCT index says
# it is not. ADR 0081 deleted the reconstruction rather than adding four cases.
# These migrations carry it and are applied and superseded.
HISTORICAL_INDKEY = HISTORICAL | {FIX}

UNNEST_CONKEY = re.compile(r"unnest\s*\(\s*[\w.]*conkey\s*\)", re.IGNORECASE)
UNNEST_INDKEY = re.compile(r"unnest\s*\(\s*[\w.]*indkey\s*\)", re.IGNORECASE)
CONFKEY = re.compile(r"confkey", re.IGNORECASE)
DEFINES_MERGE = re.compile(
    r"CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.merge_library_wines\s*\(", re.IGNORECASE
)
# How far after an `unnest(conkey)` the paired `unnest(confkey)` may appear.
# In the fixed query they are adjacent lines; 12 is slack, not licence.
PAIR_WINDOW = 12

SCAN_DIRS = ("supabase", "services", "apps", "packages", "scripts")
SCAN_EXT = (".sql", ".py", ".ts", ".js", ".sh")
SKIP_DIRS = {"node_modules", ".git", "dist", "build", "__pycache__", ".next", "coverage"}
# This file necessarily contains the shape it detects -- the self-test asserts
# the check fires on it, and --against-database runs the pre-fix query beside the
# fixed one to show the difference. Skipping it is not a hole: check A would
# otherwise report the guard's own evidence as a defect.
SELF = os.path.relpath(os.path.abspath(__file__), os.getcwd())

SQL_LINE_COMMENT = re.compile(r"--[^\n]*")
SQL_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def executable_sql(text):
    """Strip comments: a query quoted in a header is documentation, not code.

    The migration that FIXES this quotes the defective query at length, and so
    does every doc that explains it. Flagging those would make the guard
    unusable by the very files that exist to explain it.
    """
    return SQL_LINE_COMMENT.sub("", SQL_BLOCK_COMMENT.sub("", text))


def sql_files():
    """Every file that could carry the shape, repo-relative, sorted."""
    out = []
    for root in SCAN_DIRS:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                if not name.endswith(SCAN_EXT):
                    continue
                path = os.path.join(dirpath, name)
                if os.path.abspath(path) != os.path.abspath(__file__):
                    out.append(path)
    return sorted(out)


def unpaired_conkey(text):
    """Line numbers (1-indexed) where conkey is unnested with no confkey nearby."""
    lines = text.split("\n")
    hits = []
    for i, line in enumerate(lines):
        if not UNNEST_CONKEY.search(line):
            continue
        window = "\n".join(lines[max(0, i - PAIR_WINDOW): i + PAIR_WINDOW + 1])
        if not CONFKEY.search(window):
            hits.append(i + 1)
    return hits


def check_shape(paths):
    """A: nothing outside the historical set enumerates conkey unpaired."""
    violations = []
    covered = 0
    for path in paths:
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError as exc:
            print(f"cannot read {path}: {exc}", file=sys.stderr)
            return None
        if "conkey" not in text.lower():
            continue
        covered += 1
        if path.endswith(".sql"):
            text = executable_sql(text)
        hits = unpaired_conkey(text)
        if not hits:
            continue
        if path in HISTORICAL:
            continue
        for line in hits:
            violations.append((path, line))
    return violations, covered


def reconstructs_an_index(text):
    """Line numbers where a UNIQUE index is rebuilt from pg_index.indkey.

    `unnest(i.indkey)` in a query that also names pg_attribute is the shape: it
    is resolving index columns to names in order to compare them by hand. A
    bare read of indkey to COUNT or to test membership is not that, and the
    migration that removes the reconstruction still reads indkey to assert the
    shape is gone -- so the pg_attribute join is what makes it a violation.
    """
    lines = text.split("\n")
    hits = []
    for i, line in enumerate(lines):
        if not UNNEST_INDKEY.search(line):
            continue
        window = "\n".join(lines[max(0, i - PAIR_WINDOW): i + PAIR_WINDOW + 1])
        if re.search(r"pg_attribute", window, re.IGNORECASE):
            hits.append(i + 1)
    return hits


def check_index_reconstruction(paths):
    """C: no live SQL rebuilds a unique index's equality test by hand."""
    violations = []
    for path in paths:
        text = open(path, encoding="utf-8", errors="replace").read()
        if "indkey" not in text.lower():
            continue
        if path.endswith(".sql"):
            text = executable_sql(text)
        if path in HISTORICAL_INDKEY:
            continue
        for line in reconstructs_an_index(text):
            violations.append((path, line))
    return violations


def check_fix_is_live():
    """B: the newest definition of merge_library_wines routes through the plan."""
    if not os.path.isdir(MIGRATIONS):
        print(f"{MIGRATIONS} is not a directory", file=sys.stderr)
        return None
    definers = []
    for name in sorted(os.listdir(MIGRATIONS)):
        if not name.endswith(".sql"):
            continue
        path = os.path.join(MIGRATIONS, name)
        text = open(path, encoding="utf-8", errors="replace").read()
        if DEFINES_MERGE.search(text):
            definers.append((path, text))
    if not definers:
        print(
            "no migration defines public.merge_library_wines -- this guard has "
            "lost its anchor and cannot check what it claims to",
            file=sys.stderr,
        )
        return None
    path, text = definers[-1]          # filenames sort by version prefix
    # Comments stripped: that migration's header quotes the plan by name while
    # explaining the fix, and a header is not a call site.
    calls = executable_sql(text).count("SELECT * FROM public.fk_repoint_plan(")
    return path, calls, len(definers)


def report(violations, covered, live, idx_violations):
    ok = True
    if idx_violations:
        ok = False
        print("A UNIQUE index rebuilt by hand from pg_index.indkey:\n")
        for path, line in idx_violations:
            print(f"  {path}:{line}")
        print(
            "\n  An index is expressions, partial predicates, opclasses, collations,"
            "\n  INCLUDE columns and null semantics. Rebuilding its equality test is a"
            "\n  second implementation of all of that. Attempt the write and read the"
            "\n  index's own answer instead -- see ADR 0081."
        )

    if violations:
        ok = False
        print("Foreign-key enumeration by column instead of by reference:\n")
        for path, line in violations:
            print(f"  {path}:{line}")
        print(
            "\n  unnest(conkey) alone loses which column each component references."
            "\n  Pair it with confkey by ordinality and keep the component whose"
            "\n  referenced attribute is the key -- see public.fk_repoint_plan() in"
            f"\n  {FIX}."
        )
    path, calls, definers = live
    if calls < 2:
        ok = False
        print(
            f"\nThe live definition of merge_library_wines ({path}) calls"
            f"\npublic.fk_repoint_plan() {calls} time(s); both repoint loops must"
            "\nroute through it. A redefinition that drops the plan reintroduces"
            "\nthe defect ADR 0076 fixed, and does it in a shape check A cannot see."
        )
    if ok:
        print(
            f"OK: {covered} file(s) touch pg_constraint.conkey; "
            f"{len(HISTORICAL)} superseded historical migration(s) allowlisted; "
            f"the live merge definition ({os.path.basename(path)}, {definers} total) "
            f"routes {calls} repoint loop(s) through fk_repoint_plan()."
        )
    return ok


# ---------------------------------------------------------------------------
# The behavioural arm. Text cannot tell you the fix works.
# ---------------------------------------------------------------------------

BEHAVIOUR_SQL = r"""
\set ON_ERROR_STOP on
BEGIN;

-- A COMPOSITE foreign key to restaurant_inventory of exactly the shape
-- ADR 0070 introduces: (inventory_id, uom) -> (id, uom).
ALTER TABLE public.restaurant_inventory ADD COLUMN guard_uom text NOT NULL DEFAULT 'bottle';
ALTER TABLE public.restaurant_inventory ADD CONSTRAINT guard_inv_id_uom_key UNIQUE (id, guard_uom);
CREATE TABLE public.guard_child (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL,
  guard_uom    text NOT NULL,
  CONSTRAINT guard_child_inv_uom_fkey FOREIGN KEY (inventory_id, guard_uom)
    REFERENCES public.restaurant_inventory (id, guard_uom)
);

DO $t$
DECLARE
  v_rest uuid; v_keep uuid; v_lose uuid; v_ik uuid; v_il uuid;
  n int; c text; problem text; msg text;
BEGIN
  -- ---------------------------------------------------------------- shape
  SELECT count(*) INTO n FROM public.fk_repoint_plan(
    'public.restaurant_inventory'::regclass, ARRAY['public.inventory_lots'::regclass])
   WHERE constraint_name = 'guard_child_inv_uom_fkey';
  IF n <> 1 THEN RAISE EXCEPTION 'composite FK produced % plan rows, expected 1', n; END IF;

  SELECT id_column INTO c FROM public.fk_repoint_plan(
    'public.restaurant_inventory'::regclass, ARRAY['public.inventory_lots'::regclass])
   WHERE constraint_name = 'guard_child_inv_uom_fkey';
  IF c IS DISTINCT FROM 'inventory_id' THEN
    RAISE EXCEPTION 'plan named % as the id column, expected inventory_id', c; END IF;

  SELECT count(*) INTO n
  FROM pg_constraint pc
  JOIN unnest(pc.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
  WHERE pc.conname = 'guard_child_inv_uom_fkey';
  IF n <> 2 THEN RAISE EXCEPTION 'pre-fix query yielded % rows, expected 2', n; END IF;
  RAISE NOTICE 'PASS shape: pre-fix query names 2 columns, fk_repoint_plan names 1 (inventory_id)';

  -- ------------------------------------------------- nothing silently skipped
  ALTER TABLE public.restaurant_inventory ADD CONSTRAINT guard_inv_version_key UNIQUE (version);
  CREATE TABLE public.guard_orphan (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inv_version integer NOT NULL,
    CONSTRAINT guard_orphan_version_fkey FOREIGN KEY (inv_version)
      REFERENCES public.restaurant_inventory (version));
  SELECT p.problem INTO problem FROM public.fk_repoint_plan(
    'public.restaurant_inventory'::regclass, ARRAY['public.inventory_lots'::regclass]) p
   WHERE p.constraint_name = 'guard_orphan_version_fkey';
  IF problem IS NULL THEN
    RAISE EXCEPTION 'a FK referencing no id column was planned silently -- absence '
                    'reported as health, which is the fault this guards'; END IF;
  RAISE NOTICE 'PASS accounting: a FK referencing no id column is REPORTED (%)', left(problem, 48) || '...';
  DROP TABLE public.guard_orphan;
  ALTER TABLE public.restaurant_inventory DROP CONSTRAINT guard_inv_version_key;

  -- ------------------------------------------------------------- fixture
  INSERT INTO public.restaurants (name, slug) VALUES ('guard test', 'guard-test-' || gen_random_uuid())
    RETURNING id INTO v_rest;
  INSERT INTO public.master_wine_library (wine_id, name, producer, primary_type, country)
    VALUES (left('gk' || replace(gen_random_uuid()::text,'-',''), 20), 'Guard Keeper', 'Guard Producer', 'red', 'FR')
    RETURNING id INTO v_keep;
  INSERT INTO public.master_wine_library (wine_id, name, producer, primary_type, country)
    VALUES (left('gl' || replace(gen_random_uuid()::text,'-',''), 20), 'Guard Loser', 'Guard Producer', 'red', 'FR')
    RETURNING id INTO v_lose;
  INSERT INTO public.restaurant_inventory (restaurant_id, master_wine_id, guard_uom)
    VALUES (v_rest, v_keep, 'bottle') RETURNING id INTO v_ik;
  INSERT INTO public.restaurant_inventory (restaurant_id, master_wine_id, guard_uom)
    VALUES (v_rest, v_lose, 'case')   RETURNING id INTO v_il;

  -- --------------------------------------------------- composite blocker
  INSERT INTO public.guard_child (inventory_id, guard_uom) VALUES (v_il, 'case');
  n := public.fk_repoint_blockers('public.guard_child'::regclass, 'inventory_id',
         ARRAY['guard_uom'], ARRAY['guard_uom'],
         'public.restaurant_inventory'::regclass, 'id', v_ik, v_il);
  IF n <> 1 THEN RAISE EXCEPTION 'fk_repoint_blockers counted %, expected 1', n; END IF;

  BEGIN
    PERFORM * FROM public.merge_library_wines(v_keep, v_lose, false, 'guard');
    RAISE EXCEPTION 'the merge SUCCEEDED with a blocking composite row -- it must refuse';
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
    IF msg NOT LIKE '%refusing to merge%' OR msg NOT LIKE '%guard_child_inv_uom_fkey%' THEN
      RAISE EXCEPTION 'merge failed, but not with the readable refusal: %', msg; END IF;
  END;
  RAISE NOTICE 'PASS refusal: %', left(msg, 96) || '...';

  -- ------------------------------------------------------ the happy path
  -- Reconcile the component the merge refuses to rewrite, and the same merge
  -- goes through. This is the regression half: the fix must not have broken
  -- the merge it was fixing.
  DELETE FROM public.guard_child WHERE inventory_id = v_il;
  UPDATE public.restaurant_inventory SET guard_uom = 'bottle' WHERE id = v_il;
  INSERT INTO public.guard_child (inventory_id, guard_uom) VALUES (v_il, 'bottle');
  n := public.fk_repoint_blockers('public.guard_child'::regclass, 'inventory_id',
         ARRAY['guard_uom'], ARRAY['guard_uom'],
         'public.restaurant_inventory'::regclass, 'id', v_ik, v_il);
  IF n <> 0 THEN RAISE EXCEPTION 'blockers still counts % after reconciling', n; END IF;

  PERFORM * FROM public.merge_library_wines(v_keep, v_lose, false, 'guard');

  SELECT count(*) INTO n FROM public.guard_child
   WHERE inventory_id = v_ik AND guard_uom = 'bottle';
  IF n <> 1 THEN RAISE EXCEPTION 'the composite child was not repointed (% rows on the keeper)', n; END IF;
  SELECT count(*) INTO n FROM public.guard_child WHERE guard_uom <> 'bottle';
  IF n <> 0 THEN RAISE EXCEPTION 'the merge rewrote the non-id component on % row(s)', n; END IF;
  SELECT count(*) INTO n FROM public.restaurant_inventory WHERE id = v_il;
  IF n <> 0 THEN RAISE EXCEPTION 'the loser inventory row survived the merge'; END IF;
  SELECT count(*) INTO n FROM public.master_wine_library
   WHERE id = v_lose AND superseded_by = v_keep AND deleted_at IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'the loser wine was not superseded'; END IF;
  RAISE NOTICE 'PASS merge: child repointed to the keeper, guard_uom untouched, '
               'loser inventory merged, loser wine superseded';
END
$t$;


-- Index shapes the previous loop reconstructed wrongly. Built here rather than
-- found, because none of them exists on a referencing table today -- that is
-- what made four of the five defects latent, not what made them safe.
CREATE TABLE public.t_expr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id uuid NOT NULL REFERENCES public.master_wine_library(id),
  label text NOT NULL);
CREATE UNIQUE INDEX t_expr_uq ON public.t_expr (wine_id, lower(label));

CREATE TABLE public.t_partial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id uuid NOT NULL REFERENCES public.master_wine_library(id),
  code text NOT NULL, active boolean NOT NULL);
CREATE UNIQUE INDEX t_partial_uq ON public.t_partial (wine_id, code) WHERE active;

DO $t$
DECLARE v_keep uuid; v_lose uuid; n int; d text;
BEGIN
  INSERT INTO public.master_wine_library (wine_id, name, producer, primary_type, country)
    VALUES (left('ck'||replace(gen_random_uuid()::text,'-',''),20),'Collide Keeper','CP','red','FR') RETURNING id INTO v_keep;
  INSERT INTO public.master_wine_library (wine_id, name, producer, primary_type, country)
    VALUES (left('cl'||replace(gen_random_uuid()::text,'-',''),20),'Collide Loser','CP','red','FR') RETURNING id INTO v_lose;

  -- (5) NULLS DISTINCT with a nullable key column. sku_mappings is UNIQUE on
  --     (restaurant_id, master_wine_id, sku_type, sku_value) and restaurant_id
  --     is nullable -- a global, unscoped SKU mapping. Two NULLs are DISTINCT,
  --     so both rows may legally sit on the keeper. Both must SURVIVE.
  INSERT INTO public.sku_mappings (restaurant_id, master_wine_id, sku_type, sku_value)
    VALUES (NULL, v_keep, 'upc', 'SAME-UPC'), (NULL, v_lose, 'upc', 'SAME-UPC');

  -- A GENUINE collision. trg_normalize_alias derives alias_name_normalized from
  -- alias_name, so these two differ in case and normalize to the same value.
  INSERT INTO public.wine_aliases (canonical_id, alias_name) VALUES (v_keep, 'samename');
  INSERT INTO public.wine_aliases (canonical_id, alias_name) VALUES (v_lose, 'SAMENAME');

  -- (1) expression index; lower('ABC') <> lower('zzz'), so NO collision.
  INSERT INTO public.t_expr (wine_id, label) VALUES (v_keep, 'ABC'), (v_lose, 'zzz');
  -- (2) partial index; predicate false on both, so neither is in the index.
  INSERT INTO public.t_partial (wine_id, code, active) VALUES (v_keep,'X',false), (v_lose,'X',false);

  PERFORM * FROM public.merge_library_wines(v_keep, v_lose, false, 'collide');

  SELECT count(*) INTO n FROM public.sku_mappings
   WHERE master_wine_id=v_keep AND sku_type='upc' AND sku_value='SAME-UPC';
  IF n <> 2 THEN RAISE EXCEPTION 'NULLS DISTINCT: % sku_mappings row(s) survived of 2 -- a row the index allowed was deleted', n; END IF;
  RAISE NOTICE 'PASS nulls-distinct: both rows survived; NULL does not equal NULL';

  SELECT count(*) INTO n FROM public.wine_aliases WHERE canonical_id=v_keep AND alias_name='SAMENAME';
  IF n <> 0 THEN RAISE EXCEPTION 'genuine collision: the loser row was NOT dropped'; END IF;
  SELECT count(*) INTO n FROM public.wine_aliases WHERE canonical_id=v_keep AND alias_name='samename';
  IF n <> 1 THEN RAISE EXCEPTION 'genuine collision: the KEEPER row was dropped instead'; END IF;
  SELECT x.detail INTO d FROM public.wine_merge_log l,
       jsonb_to_recordset(l.steps) AS x(step text, detail text, rows bigint)
   WHERE l.loser_id=v_lose AND x.step='collision.dropped' AND x.detail LIKE '%wine_aliases%' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'the drop was not reported in the merge log'; END IF;
  RAISE NOTICE 'PASS genuine collision: loser dropped, keeper kept, reported as "%"', d;

  SELECT count(*) INTO n FROM public.t_expr WHERE wine_id=v_keep AND label='zzz';
  IF n <> 1 THEN RAISE EXCEPTION 'expression index: a non-colliding row was deleted'; END IF;
  RAISE NOTICE 'PASS expression index: lower(label) evaluated, non-colliding row survived';

  SELECT count(*) INTO n FROM public.t_partial WHERE wine_id=v_keep AND active=false;
  IF n <> 2 THEN RAISE EXCEPTION 'partial index: % of 2 out-of-predicate rows survived', n; END IF;
  RAISE NOTICE 'PASS partial index: indpred respected, both out-of-predicate rows survived';
END $t$;

ROLLBACK;
"""


def against_database(dsn):
    """Assert the BEHAVIOUR, not the text. Everything is rolled back."""
    if not dsn:
        print(
            "no database URL: pass --dsn or set SUPABASE_DB_URL. This arm cannot "
            "check anything without one",
            file=sys.stderr,
        )
        return None
    try:
        proc = subprocess.run(
            ["psql", dsn, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
            input=BEHAVIOUR_SQL, text=True, capture_output=True, timeout=120,
        )
    except FileNotFoundError:
        print("psql is not installed; this arm cannot run", file=sys.stderr)
        return None
    except subprocess.TimeoutExpired:
        print("psql timed out", file=sys.stderr)
        return None
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        return False
    # Every assertion announces itself. psql exiting 0 without them means the
    # block never ran -- silence is not a pass.
    expected = ("PASS shape:", "PASS accounting:", "PASS refusal:", "PASS merge:",
                "PASS nulls-distinct:", "PASS genuine collision:",
                "PASS expression index:", "PASS partial index:")
    missing = [m for m in expected if m not in proc.stderr]
    if missing:
        print(
            "the behavioural assertions did not all report (missing: "
            + ", ".join(missing)
            + ") -- psql returned 0 without running them, which is not a pass",
            file=sys.stderr,
        )
        return None
    return True


# ---------------------------------------------------------------------------


def self_test():
    """Prove both checks still fire on the shapes they exist to catch."""
    failures = []

    pre_fix = """
    FOR v_fk IN
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.restaurant_inventory'::regclass
    LOOP
    """
    if unpaired_conkey(pre_fix) != [5]:
        failures.append(
            f"A did not fire on the pre-fix query (got {unpaired_conkey(pre_fix)})"
        )

    fixed = """
      SELECT c.conrelid::regclass::text, a.attname
      FROM pg_constraint c
      JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN unnest(c.confkey) WITH ORDINALITY AS f(attnum, ord) ON f.ord = k.ord
      JOIN pg_attribute a   ON a.attrelid   = c.conrelid  AND a.attnum = k.attnum
      JOIN pg_attribute ref ON ref.attrelid = c.confrelid AND ref.attnum = f.attnum
      WHERE ref.attname = 'id'
    """
    if unpaired_conkey(fixed):
        failures.append("A fired on the FIXED query -- it would block the repair")

    literal = "      AND con.conkey = ARRAY[v_attnum]\n"
    if unpaired_conkey(literal):
        failures.append(
            "A fired on an explicitly single-column conkey comparison, which is "
            "correct code and must not be flagged"
        )

    far = "JOIN unnest(c.conkey) ...\n" + ("\n" * (PAIR_WINDOW + 2)) + "confkey\n"
    if not unpaired_conkey(far):
        failures.append("A accepted a confkey that is nowhere near the conkey it pairs")

    quoted = "-- the old loop did: JOIN unnest(c.conkey) WITH ORDINALITY ...\n"
    if unpaired_conkey(executable_sql(quoted)):
        failures.append("A fired on a query QUOTED in a comment, not executed")
    if unpaired_conkey(quoted) != [1]:
        failures.append("comment stripping is doing the work, not the scan -- "
                        "A must still fire on that line when it is real SQL")

    if SELF in sql_files():
        failures.append("A scans its own source, whose evidence it would report "
                        "as a defect")

    # B fires when a later definition drops the plan.
    if "public.fk_repoint_plan(" in DEFINES_MERGE.pattern:
        failures.append("B's anchors are entangled")
    fake = "CREATE OR REPLACE FUNCTION public.merge_library_wines(p uuid)"
    if not DEFINES_MERGE.search(fake):
        failures.append("B no longer recognises a definition of merge_library_wines")
    if fake.count("public.fk_repoint_plan(") >= 2:
        failures.append("B would pass a definition that never calls the plan")

    recon = """
      SELECT i.indexrelid, array_agg(att.attname ORDER BY ik.ord)
      FROM pg_index i
      JOIN unnest(i.indkey) WITH ORDINALITY AS ik(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = ik.attnum
      WHERE i.indisunique
    """
    if reconstructs_an_index(recon) != [4]:
        failures.append(
            f"C did not fire on the pre-fix index reconstruction (got "
            f"{reconstructs_an_index(recon)})")

    counting = "SELECT count(*) FROM unnest(i.indkey) kk(an) WHERE true\n"
    if reconstructs_an_index(counting):
        failures.append(
            "C fired on a bare read of indkey with no pg_attribute join -- that is "
            "counting, not reconstructing, and the ADR 0081 assertion itself does it")

    if check_index_reconstruction(sql_files()):
        failures.append(
            f"C fails on the tree as committed: "
            f"{check_index_reconstruction(sql_files())}")

    # The real tree must satisfy both, or the guard is testing nothing.
    got = check_shape(sql_files())
    if got is None:
        failures.append("A could not read the tree")
    elif got[0]:
        failures.append(f"A fails on the tree as committed: {got[0]}")
    live = check_fix_is_live()
    if live is None:
        failures.append("B lost its anchor on the tree as committed")
    elif live[1] < 2:
        failures.append(f"B fails on the tree as committed: {live}")

    if failures:
        for f in failures:
            print(f"SELF-TEST FAILED: {f}", file=sys.stderr)
        return 1
    print(
        "self-test OK: the shape check fires on the pre-fix query, stays quiet on "
        "the fixed one and on a literal single-column conkey, needs the pairing to "
        "be adjacent, and both checks pass on the tree as committed."
    )
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--self-test", action="store_true",
                    help="prove the guard still fires on the shape it exists to catch")
    ap.add_argument("--against-database", action="store_true",
                    help="assert the BEHAVIOUR against a live schema (rolled back)")
    ap.add_argument("--dsn", default=os.environ.get("SUPABASE_DB_URL", ""),
                    help="connection string for --against-database")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if args.against_database:
        result = against_database(args.dsn)
        if result is None:
            return 2
        return 0 if result else 1

    if not os.path.isdir(MIGRATIONS):
        print(f"{MIGRATIONS} is not a directory", file=sys.stderr)
        return 2
    for path in sorted(HISTORICAL) + [FIX, COLLIDE]:
        if not os.path.isfile(path):
            print(
                f"{path} is missing -- this guard's allowlist and anchor name "
                "files that no longer exist, so it cannot check what it claims to",
                file=sys.stderr,
            )
            return 2

    got = check_shape(sql_files())
    if got is None:
        return 2
    violations, covered = got
    if covered == 0:
        print("nothing in the tree references pg_constraint.conkey", file=sys.stderr)
        return 2
    live = check_fix_is_live()
    if live is None:
        return 2
    idx_violations = check_index_reconstruction(sql_files())
    return 0 if report(violations, covered, live, idx_violations) else 1


if __name__ == "__main__":
    sys.exit(main())
