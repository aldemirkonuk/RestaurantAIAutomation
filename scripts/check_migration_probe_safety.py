#!/usr/bin/env python3
"""Guard: a migration's own DO $$ probe cannot corrupt a populated database.

WHY THIS EXISTS
---------------
Two migrations were applied to production on 2026-09-12 and both PASSED, and
both passed only because production happened to be empty-ish at that moment
in the two specific ways each migration's own assertion block relied on:

  20260906030000_a_confirmation_is_a_logged_decision.sql:199-200,257-260
    asserted `(SELECT count(*) FROM public.beverage_identity_decisions) <> 0`
    -- an ABSOLUTE state, true only because nobody had confirmed a beverage
    identity yet. The first real confirmation makes this assertion fail for a
    reason that has nothing to do with what it exists to check: whether the
    migration's OWN probe rolled back.

  20260906200000_a_document_act_takes_a_redeemed_seal.sql:201,216
    deleted its probe row with
    `DELETE FROM public.mcp_seal_challenges WHERE args_hash = 'migration probe'`
    -- a MAGIC STRING, not a key. `mcp_seal_challenges` is a live, real table;
    any genuine challenge that happened to carry that exact `args_hash` would
    be deleted along with the probe.

Both are examples of the same fault: a migration proves something about
ITSELF by touching a real table, and the proof was written as though the
table were guaranteed to be empty or free of that literal value forever. It
is not -- these tables hold production data now. Compare
`20260906020000_a_refused_book_reopens_once_by_an_owner.sql:200-263`, which
does this correctly: every probe row is deleted `WHERE id = probe_review`,
`probe_review` coming from `RETURNING id INTO` on the INSERT that created it,
and any accompanying row-count assertion is a DELTA against a baseline read
before the probe ran, never an absolute value.

THE TWO RULES
-------------
Inside any `DO $$ ... $$` block in a migration:

  1. A `DELETE FROM public.<table>` may not be scoped by a predicate
     containing a string literal. The only safe scope is a variable that was
     itself populated by `RETURNING <key> INTO` on an INSERT this same block
     made -- this guard does not trace that far, but a literal in the WHERE
     clause is proof enough that the predicate is NOT that, because a
     returned key is never spelled as a quoted constant.

  2. A row-count assertion may not compare `(SELECT count(*) FROM
     public.<table>)` against a literal integer. The property such an
     assertion almost always wants to state is "this block wrote no net
     rows", and that is a DELTA (a count taken before the block's probe ran,
     compared to a count taken after) -- never an absolute value, because an
     absolute value assumes facts about the table this migration does not
     control.

WHAT THIS DOES NOT CATCH, ON PURPOSE
-------------------------------------
This is textual, not semantic: it does not verify that a DELETE's variable
predicate actually traces back to a `RETURNING ... INTO` on the same row, and
it does not verify that a delta comparison uses a baseline read before the
probe rather than two unrelated counts. Catching literal magic strings and
literal absolute counts is what turned both real defects into a five-minute
diff; going further would need a real PL/pgSQL analyzer this repo does not
have and would not meaningfully close the gap.

GRANDFATHERED, BY NAME -- NEVER BY CATEGORY
--------------------------------------------
Sweeping every migration on 2026-09-12 found this same shape in files this
fix does not touch. Per ADR 0072's rule ("narrowed by name in this ADR, never
by deleting the category quietly"), they are named here, not silently
excluded by loosening the pattern:

  Rule 2 (absolute count assertion): no grandfathered files remain.
    20260905140000_a_bottle_has_one_identity.sql:417-419,461-462 carried the
    exact same shape as 20260906030000, on tables the same feature writes to
    (`beverage_identities`, `beverage_identity_keys`,
    `beverage_identity_candidates`), and was already applied to production.
    Fixed the same way, in the follow-up that removed it from
    GRANDFATHERED_ABSOLUTE_COUNT -- three before/after locals capture the
    counts on all three tables ahead of the probe and after it rolls back,
    and the assertion is a delta on each, never an absolute value. That
    fix edits the file without rewriting what already ran in production
    (see the migration's own header note and that commit's disclosure).

  Rule 1 (magic-string DELETE) -- the original eight-file sweep, reassessed
  2026-09-12 file by file rather than fixed or left as one block. Three were
  genuinely risky (the DELETE runs against `price_index_postings.source_ref`,
  a column that carries a real external reference string, using a short
  hyphenated probe name a real source_ref could plausibly collide with) and
  are now fixed with the `RETURNING <key> INTO <var>` pattern, proven against
  a throwaway Postgres seeded with a genuine colliding row (see that commit
  for the measurement) -- removed from this list:
    20260905080000_a_posting_says_whose_date_it_carries.sql ('constraint-probe')
    20260905160000_an_uploaded_book_names_who_carried_it.sql ('upload-probe')
    20260905180000_a_carried_book_waits_for_a_second_pair_of_eyes.sql ('admit-probe')

  The remaining five stay grandfathered because each literal is namespaced
  distinctively enough that a genuine collision is not practically possible,
  not merely because they were out of an earlier change's scope:
    20260903110000_billing_stripe_provider.sql -- `event_id = 'evt_migration_
      assertion'` on `billing_webhook_events`. Stripe mints every real
      event_id itself as an opaque random token; it never emits English
      words, so no genuine webhook delivery can ever carry this exact string.
    20260905225000_a_message_is_metered_before_it_is_billed.sql -- one hit is
      `plan_code = '__migration_probe__'` (a dunder-wrapped token no curated
      plan code would ever be assigned); the other two are double-scoped
      (`restaurant_id = <probe row> AND detail/billable_reason = 'migration
      probe, must be refused'`, a full diagnostic sentence, not a value a
      real credit/meter note would ever contain verbatim).
    20260905235000_an_index_series_is_not_a_price.sql -- four `series_key`
      values in the same dotted `probe.<word>.<word>` convention as
      20260906130000 below (e.g. `probe.index.with.currency`); this file
      established that convention.
    20260906080000_a_purchase_is_charged_once_and_a_house_may_have_its_own_allowance.sql
      -- `detail = 'migration probe, must be refused'` on
      `house_message_credits`, the same full diagnostic sentence as above.
    20260906130000_a_series_behind_a_key_says_so.sql -- `series_key` values
      `probe.key.no.var`, `probe.key.pasted`, `probe.keyless.with.var`,
      `probe.zero.budget`: the dotted probe.* convention this repo already
      uses for `commodity_index_series` test keys, distinct in shape from a
      genuine series key (`brent-crude`, `us-corn-no2`, ...).

A file leaves this list only by being fixed, never by widening the pattern to
stop seeing it, and never by being judged safe without that judgment recorded
here by name. If a listed file no longer trips the rule it is grandfathered
under, the guard fails anyway (see `run_default` and the self-test) -- the
list is a debt ledger, not a permanent exemption, and a stale row printing OK
silently is the same "absence reported as health" fault this guard exists to
close.

Two more files matched a naive text search for `DELETE FROM public.` next to
a quoted literal and were checked by hand rather than added:
`20260817120000_nondestructive_merge.sql:263` and
`20260818020000_merge_undo_honesty.sql:51`. Both deletes
(`alias_source = 'merge:' || p_loser::text`) live inside a permanent
`CREATE FUNCTION ... LANGUAGE plpgsql` body -- `merge_library_wines_undo`,
application logic a manager invokes to undo a wine-library merge -- not a
migration's own `DO $$` self-probe. This guard's rule is about a migration
proving something about ITSELF and being wrong to assume the table stays
empty; a stored function whose entire purpose is to delete rows a specific
earlier merge created is a different question this guard does not answer.

EXIT CODES
----------
  0  no migration outside the grandfather list has either shape
  1  a violation -- new or a stale grandfather entry
  2  CANNOT CHECK -- the migrations directory does not exist or holds no
     `.sql` files. Never a silent pass.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import sys
import tempfile

MIGRATIONS_DIR = "supabase/migrations"

# --- Rule 1: DELETE scoped by a magic string, not a returned key ----------

GRANDFATHERED_DELETE_BY_LITERAL = {
    "20260903110000_billing_stripe_provider.sql",
    "20260905225000_a_message_is_metered_before_it_is_billed.sql",
    "20260905235000_an_index_series_is_not_a_price.sql",
    "20260906080000_a_purchase_is_charged_once_and_a_house_may_have_its_own_allowance.sql",
    "20260906130000_a_series_behind_a_key_says_so.sql",
}

# --- Rule 2: an absolute-value row-count assertion -------------------------
#
# Empty. 20260905140000_a_bottle_has_one_identity.sql was the last entry --
# see the module docstring's "GRANDFATHERED, BY NAME" section for how it was
# fixed and why the fix does not touch what already ran in production.

GRANDFATHERED_ABSOLUTE_COUNT: set[str] = set()

DO_BLOCK_RE = re.compile(r"DO\s+(\$[A-Za-z_]*\$)", re.IGNORECASE)
DELETE_RE = re.compile(r"DELETE\s+FROM\s+(public\.\w+)\b(.*?);", re.IGNORECASE | re.DOTALL)
STRING_LITERAL_RE = re.compile(r"'(?:[^']|'')*'")
ABSOLUTE_COUNT_RE = re.compile(
    r"count\(\*\)\s*FROM\s+(public\.\w+)\)\s*(<>|!=|=)\s*\d+",
    re.IGNORECASE,
)


class CannotCheck(Exception):
    """The guard cannot see what it claims to check. Always exit 2."""


def do_blocks(text: str) -> list[tuple[int, str]]:
    """Every `DO $tag$ ... $tag$` block, as (start offset in TEXT, body),
    tag included, in file order. The offset is what lets a match inside the
    block be traced back to its real line -- two blocks can contain the
    byte-for-byte identical assertion text, and re-searching the whole file
    for that text would find only the first one, twice."""
    blocks = []
    for m in DO_BLOCK_RE.finditer(text):
        tag = m.group(1)
        start = m.end()
        end = text.find(tag, start)
        if end == -1:
            continue  # unterminated -- not this guard's problem to parse
        blocks.append((m.start(), text[m.start() : end + len(tag)]))
    return blocks


def line_at(text: str, offset: int) -> int:
    return text[:offset].count("\n") + 1


def find_delete_by_literal(text: str) -> list[tuple[int, str]]:
    """(line, statement) for every DO-block DELETE whose predicate carries a
    quoted string literal -- a magic string, never a returned key."""
    hits = []
    for block_start, block in do_blocks(text):
        for m in DELETE_RE.finditer(block):
            stmt = m.group(0)
            if STRING_LITERAL_RE.search(stmt):
                hits.append((line_at(text, block_start + m.start()), " ".join(stmt.split())))
    return hits


def find_absolute_count(text: str) -> list[tuple[int, str]]:
    """(line, snippet) for every DO-block row-count assertion compared
    against a literal integer instead of a baseline captured at runtime."""
    hits = []
    for block_start, block in do_blocks(text):
        for m in ABSOLUTE_COUNT_RE.finditer(block):
            hits.append(
                (line_at(text, block_start + m.start()), " ".join(m.group(0).split()))
            )
    return hits


def scan(migrations_dir: str) -> tuple[dict, dict, set]:
    """filename -> [(line, text)] for each rule, plus the set of files seen."""
    paths = sorted(glob.glob(os.path.join(migrations_dir, "*.sql")))
    if not paths:
        raise CannotCheck(
            f"no `.sql` files under {migrations_dir!r}. Either the migrations "
            "moved or this guard is pointed at the wrong tree -- repoint it "
            "rather than trusting a clean verdict from an empty sweep."
        )
    by_delete: dict[str, list[tuple[int, str]]] = {}
    by_count: dict[str, list[tuple[int, str]]] = {}
    present: set[str] = set()
    for path in paths:
        name = os.path.basename(path)
        present.add(name)
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        d = find_delete_by_literal(text)
        c = find_absolute_count(text)
        if d:
            by_delete[name] = d
        if c:
            by_count[name] = c
    return by_delete, by_count, present


def run_default(migrations_dir: str) -> int:
    by_delete, by_count, present = scan(migrations_dir)

    failed = False

    for name, hits in sorted(by_delete.items()):
        if name in GRANDFATHERED_DELETE_BY_LITERAL:
            continue
        failed = True
        print(f"VIOLATION (rule 1 -- magic-string DELETE): {name}")
        for line, stmt in hits:
            print(f"  {migrations_dir}/{name}:{line}: {stmt}")
        print(
            "  A DO block deletes from a real table on a predicate that is a "
            "literal, not a returned key. Capture the row's own key via "
            "`RETURNING <col> INTO <var>` on the INSERT that created it, and "
            "scope the DELETE by that variable -- see "
            f"{migrations_dir}/20260906020000_a_refused_book_reopens_once_by_an_owner.sql:210."
        )

    for name, hits in sorted(by_count.items()):
        if name in GRANDFATHERED_ABSOLUTE_COUNT:
            continue
        failed = True
        print(f"VIOLATION (rule 2 -- absolute row-count assertion): {name}")
        for line, snippet in hits:
            print(f"  {migrations_dir}/{name}:{line}: {snippet}")
        print(
            "  A DO block asserts an absolute table state instead of a "
            "delta. Read the count into a variable BEFORE the block's own "
            "probe runs, read it again after, and compare the two variables "
            "-- an absolute count is only ever true by accident of what else "
            "has written to the table."
        )

    # A grandfather entry that no longer matches its rule is debt marked
    # paid without anyone striking it off -- exactly the "prose that rots
    # because nothing re-reads it" fault CLAUDE.md section 5b exists to
    # close. Force it back into the open by failing until the list is edited.
    # Only judged against files this run actually scanned -- a grandfathered
    # name absent from THIS migrations_dir (a self-test fixture holding a
    # handful of files, or a future rename) is not evidence of anything.
    for name in sorted(GRANDFATHERED_DELETE_BY_LITERAL & present):
        if name not in by_delete:
            failed = True
            print(
                f"STALE GRANDFATHER ENTRY (rule 1): {name} is listed as a "
                "known pre-existing magic-string DELETE but no longer "
                "matches. Remove it from GRANDFATHERED_DELETE_BY_LITERAL."
            )
    for name in sorted(GRANDFATHERED_ABSOLUTE_COUNT & present):
        if name not in by_count:
            failed = True
            print(
                f"STALE GRANDFATHER ENTRY (rule 2): {name} is listed as a "
                "known pre-existing absolute-count assertion but no longer "
                "matches. Remove it from GRANDFATHERED_ABSOLUTE_COUNT."
            )

    if failed:
        return 1

    print(
        f"OK -- scanned every `.sql` file under {migrations_dir}. No "
        "migration outside the grandfather list deletes from a real table "
        "on a magic string, or asserts an absolute row count. "
        f"Grandfathered: {len(GRANDFATHERED_DELETE_BY_LITERAL)} file(s) for "
        f"rule 1, {len(GRANDFATHERED_ABSOLUTE_COUNT)} file(s) for rule 2 -- "
        "see this script's module docstring for why each is still open."
    )
    return 0


# ---------------------------------------------------------------------------
# self-test
# ---------------------------------------------------------------------------

FIXTURE_MAGIC_DELETE = """
DO $$
DECLARE
  probe_id uuid;
BEGIN
  INSERT INTO public.widgets (name) VALUES ('probe widget');
  DELETE FROM public.widgets WHERE name = 'probe widget';
END
$$;
"""

FIXTURE_KEYED_DELETE = """
DO $$
DECLARE
  probe_id uuid;
BEGIN
  INSERT INTO public.widgets (name) VALUES ('probe widget')
  RETURNING id INTO probe_id;
  DELETE FROM public.widgets WHERE id = probe_id;
END
$$;
"""

FIXTURE_ABSOLUTE_COUNT = """
DO $$
BEGIN
  IF (SELECT count(*) FROM public.widgets) <> 0 THEN
    RAISE EXCEPTION 'this migration must not write rows';
  END IF;
END
$$;
"""

FIXTURE_DELTA_COUNT = """
DO $$
DECLARE
  before_n bigint;
  after_n  bigint;
  probe_id uuid;
BEGIN
  SELECT count(*) INTO before_n FROM public.widgets;
  INSERT INTO public.widgets (name) VALUES ('probe widget')
  RETURNING id INTO probe_id;
  DELETE FROM public.widgets WHERE id = probe_id;
  SELECT count(*) INTO after_n FROM public.widgets;
  IF after_n <> before_n THEN
    RAISE EXCEPTION 'the probe did not roll back';
  END IF;
END
$$;
"""


def _write(tmpdir: str, name: str, body: str) -> None:
    mdir = os.path.join(tmpdir, MIGRATIONS_DIR)
    os.makedirs(mdir, exist_ok=True)
    with open(os.path.join(mdir, name), "w", encoding="utf-8") as fh:
        fh.write(body)


def _run_guard(tmpdir: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, os.path.abspath(__file__)],
        cwd=tmpdir,
        capture_output=True,
        text=True,
    )


def run_self_test() -> int:
    failures = []

    # 1. The real shape of both 2026-09-12 defects must fire, unfixed.
    with tempfile.TemporaryDirectory() as td:
        _write(td, "20260101000000_magic.sql", FIXTURE_MAGIC_DELETE)
        _write(td, "20260101000100_absolute.sql", FIXTURE_ABSOLUTE_COUNT)
        proc = _run_guard(td)
        if proc.returncode != 1:
            failures.append(
                f"unfixed magic-string DELETE + absolute count: exit "
                f"{proc.returncode}, want 1. Output: {(proc.stdout + proc.stderr)[:400]}"
            )
        if "20260101000000_magic.sql" not in proc.stdout:
            failures.append("the magic-string DELETE fixture was not named in the report")
        if "20260101000100_absolute.sql" not in proc.stdout:
            failures.append("the absolute-count fixture was not named in the report")

    # 2. The fixed shape of both must pass clean.
    with tempfile.TemporaryDirectory() as td:
        _write(td, "20260101000000_magic.sql", FIXTURE_KEYED_DELETE)
        _write(td, "20260101000100_absolute.sql", FIXTURE_DELTA_COUNT)
        proc = _run_guard(td)
        if proc.returncode != 0:
            failures.append(
                f"fixed shapes (keyed DELETE + delta count): exit "
                f"{proc.returncode}, want 0. Output: {(proc.stdout + proc.stderr)[:400]}"
            )

    # 3. A grandfathered file with the violation it is listed for is silent.
    # Rule 2's grandfather list is currently empty (its last entry, the
    # bottle-identity migration, was fixed) -- exercised only when the list
    # is non-empty, so this self-test does not depend on that list staying
    # populated forever.
    with tempfile.TemporaryDirectory() as td:
        grand_delete = next(iter(GRANDFATHERED_DELETE_BY_LITERAL))
        _write(td, grand_delete, FIXTURE_MAGIC_DELETE)
        if GRANDFATHERED_ABSOLUTE_COUNT:
            grand_count = next(iter(GRANDFATHERED_ABSOLUTE_COUNT))
            _write(td, grand_count, FIXTURE_ABSOLUTE_COUNT)
        proc = _run_guard(td)
        if proc.returncode != 0:
            failures.append(
                "a grandfathered file carrying exactly the violation it is "
                f"listed for should pass: exit {proc.returncode}, want 0. "
                f"Output: {(proc.stdout + proc.stderr)[:400]}"
            )

    # 3b. A fresh absolute-count violation is still caught even though rule
    # 2's grandfather list is empty -- an empty exemption list must not be
    # mistaken for the rule itself being disabled.
    with tempfile.TemporaryDirectory() as td:
        _write(td, "20260101000200_fresh_absolute.sql", FIXTURE_ABSOLUTE_COUNT)
        proc = _run_guard(td)
        if proc.returncode != 1:
            failures.append(
                "a fresh (non-grandfathered) absolute-count violation must "
                f"still fail: exit {proc.returncode}, want 1"
            )

    # 4. A grandfathered file that no longer has the violation must fail --
    #    a stale exemption is debt marked paid with nobody striking it off.
    with tempfile.TemporaryDirectory() as td:
        grand_delete = next(iter(GRANDFATHERED_DELETE_BY_LITERAL))
        _write(td, grand_delete, FIXTURE_KEYED_DELETE)
        proc = _run_guard(td)
        if proc.returncode != 1:
            failures.append(
                "a grandfathered file that no longer matches its rule must "
                f"fail (stale exemption), got exit {proc.returncode}, want 1"
            )
        if "STALE GRANDFATHER" not in proc.stdout:
            failures.append(
                "the stale-grandfather case failed for the wrong reason -- "
                "'STALE GRANDFATHER' did not appear in its output"
            )

    # 5. An empty migrations directory must never read as a clean pass.
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, MIGRATIONS_DIR), exist_ok=True)
        proc = _run_guard(td)
        if proc.returncode != 2:
            failures.append(
                f"an empty migrations directory exited {proc.returncode}, "
                "want 2 -- a scan that found nothing must never pass"
            )

    if failures:
        for f in failures:
            print(f"SELF-TEST FAILED: {f}")
        return 1
    print(
        "SELF-TEST OK -- the real 2026-09-12 shapes (magic-string DELETE, "
        "absolute row-count assertion) fire unfixed and pass fixed; a "
        "grandfathered file is silent only while it still carries the "
        "violation it is listed for, and goes red the moment it does not; "
        "an empty migrations directory exits 2, never 0."
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the guard fires on the shape it exists to catch",
    )
    ap.add_argument(
        "--migrations-dir",
        default=MIGRATIONS_DIR,
        help="override the migrations directory (used by the self-test)",
    )
    args = ap.parse_args()

    if args.self_test:
        return run_self_test()

    try:
        return run_default(args.migrations_dir)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        print(
            "This is a FAILURE, not a skip. A guard that certifies itself on "
            "no evidence is worse than no guard.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
