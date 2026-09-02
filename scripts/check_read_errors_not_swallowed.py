#!/usr/bin/env python3
"""
Guard: no NEW code destructures a supabase-js read's `data` and throws its
`error` away.

WHY THIS EXISTS
---------------
`supabase-js` **resolves** with `{ data, error }`. It does not throw. So::

    const { data } = await client.from("restaurants").select("id");
    if (!data?.length) return;                    // <- "no tenants"

is indistinguishable from a restaurant list that could not be read, and the
wrapping `try/catch` is INERT because nothing was thrown. `maybeSingle()` is
worse: `data: null` means both "no row matched" and "the query failed".

Four independent auditors found ~29 consequential instances
(`.planning/03-scenarios/DELIVERY-AUDIT.md` §6). A mechanical sweep finds far
more. The measured damage was never "an error was logged badly" -- it was:

    providers.service.ts       the 409 dedup guard FAILED OPEN and inserted
                               the duplicate it exists to prevent
    vendor-catalogue.service   ran a silently DIFFERENT query with every
                               filter dropped, returning WRONG rows
    performance.service.ts     percentile([]) -> peer median 0, so every
                               restaurant's every server beat their team
    insight-scheduler.service  no-opped the ENTIRE hourly insight sweep for
                               every tenant, logging nothing
    pos-hub.service.ts         "is my POS live?" answered "0 checks" over a
                               dead read

Every one of those reads as GOOD NEWS. That is the property that makes this
class expensive: it is the repo's standing fault -- **a system reporting its own
ABSENCE as HEALTH** -- expressed in one line of destructuring.

WHAT IT FLAGS
-------------
A statement of the form::

    const { data } = await <chain containing .from(/.rpc(/.storage/.functions>
    const { data: rows, count } = await ...

where `error` is NOT among the bound names. `count` and `status` are not
substitutes: neither is populated on failure either.

WHAT IT DELIBERATELY DOES NOT FLAG, AND WHY
-------------------------------------------
1. **A destructure whose value is immediately REFUSED.** ::

       const { data: user } = await ...maybeSingle();
       if (!user) throw new NotFoundException(...);

   This is still wrong -- a failed read is reported as a missing row, a 404 for
   a 503 -- but it is not *silent*: the caller gets an error and a human sees
   it. Flagging it would triple the population without separating the cases
   that cost money, and a guard nobody can get to green is a guard everybody
   turns off. It is named here as knowingly-out-of-scope rather than quietly
   dropped (ADR 0067 §"Out of scope").

2. **Tests.** `*.spec.ts` / `*.test.ts` / `tests/` -- a failed query there
   fails an assertion, which is the point.

3. **Non-supabase awaits.** `const { data } = await axios.get(...)` throws on
   failure; the defect is specific to the resolve-with-error contract.

THE RATCHET, AND WHY IT IS NOT A BLANKET DISABLE
------------------------------------------------
This defect predates the guard by the whole life of the codebase. Failing on
every pre-existing site would make the guard unmergeable, and "turn it off
until we finish" is how these die. So:

  * `BASELINE` (`scripts/read_error_baseline.json`) records every site known at
    adoption, keyed by *file + table + binding* -- never by line number, which
    every unrelated edit would shift.
  * A site NOT in the baseline **fails the build**. New code cannot add one.
  * A baselined site that no longer exists ALSO fails the build, with the
    instruction to delete its row. The baseline can therefore only shrink, and
    the count in it is the honest denominator for
    `.planning/03-scenarios/DELIVERY-AUDIT.md` §6.
  * `ALLOWLIST` is for the permanent exceptions -- a destructure that genuinely
    does not need the error. Each entry carries a written justification, and
    adding one is a deliberate, reviewable edit to this file. There are
    deliberately very few; "it's fine" is not one of the reasons.

NEVER VACUOUS
-------------
Exit 0 clean, 1 violation, **2 cannot check**. Exit 2 blocks CI exactly like
exit 1. A guard that passes because it found nothing to look at is a green tick
over an unexamined surface -- the same fault it guards against. Concretely this
exits 2 when the source roots are missing, when zero candidate files are
scanned, when the baseline file is missing or unparseable, or when the detector
finds ZERO sites anywhere (which would mean the pattern rotted, not that the
codebase is clean -- the baseline proves sites exist).

EXIT CODES
----------
    0   checked, clean
    1   checked, violations found (each printed with file:line)
    2   CANNOT CHECK -- treat as failure, never as a skip
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOTS = ("apps", "services", "packages")
BASELINE = ROOT / "scripts" / "read_error_baseline.json"

SUFFIXES = {".ts", ".tsx"}
SKIP_DIRS = {"node_modules", "dist", "build", ".next", "coverage", "tests", "__tests__"}
TEST_FILE = re.compile(r"\.(spec|test|e2e-spec)\.tsx?$")

# `const { … } = await` — the only shape that can silently drop an error.
DESTRUCTURE = re.compile(r"(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\b")
# What makes the awaited expression a supabase call rather than an HTTP client.
SUPABASE_CHAIN = re.compile(r"\.from\(|\.rpc\(|\.storage\b|\.functions\.invoke")
TABLE_NAME = re.compile(r"\.(?:from|rpc)\(\s*[\"'`]([^\"'`]+)[\"'`]")
BINDING_ALIAS = re.compile(r"\bdata\s*:\s*(\w+)")

# A value that is REFUSED the moment it arrives is not silent. See
# "WHAT IT DELIBERATELY DOES NOT FLAG" above.
def _refusal(var: str) -> re.Pattern[str]:
    v = re.escape(var)
    return re.compile(
        r"\s*if\s*\(\s*(?:!\s*%s|%s\s*(?:===|==)\s*(?:null|undefined))\s*\)"
        r"\s*\{?\s*(?:throw|return)" % (v, v)
    )


# ---------------------------------------------------------------------------
# Permanent exceptions. Key: "<path>::<table>::<binding>" — the same key shape
# the baseline uses. Value: WHY this one never needs its error. Adding a row is
# a deliberate edit someone has to be willing to sign.
# ---------------------------------------------------------------------------
ALLOWLIST: dict[str, str] = {}


def _statement_end(text: str, start: int) -> int:
    """Index of the `;` that closes the statement beginning at `start`.

    Bracket-aware, because a supabase chain contains `(`, `[` and `{` and a
    naive `.index(';')` stops inside a `.select("a, b")` argument on any line
    that happens to contain one.
    """
    depth = 0
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == ";" and depth <= 0:
            return i
        i += 1
    return n


def find_sites(text: str) -> list[tuple[int, str, str]]:
    """Swallowed reads in one file, as (lineno, table, binding).

    `table` is the literal passed to `.from(`/`.rpc(`, or `?` when it is a
    variable — the key stays stable either way, which is what matters.
    """
    out: list[tuple[int, str, str]] = []
    for m in DESTRUCTURE.finditer(text):
        bound = m.group(1)
        if "data" not in bound:
            continue
        # `error` bound anywhere in the pattern (incl. `error: dupeError`)
        # means the caller has the failure in hand. What it then does with it
        # is beyond a linter; having it is the line this guard draws.
        if "error" in bound:
            continue
        end = _statement_end(text, m.end())
        stmt = text[m.end() : end]
        if not SUPABASE_CHAIN.search(stmt):
            continue
        alias = BINDING_ALIAS.search(bound)
        var = alias.group(1) if alias else "data"
        if _refusal(var).match(text[end + 1 : end + 400]):
            continue
        table_m = TABLE_NAME.search(stmt)
        table = table_m.group(1) if table_m else "?"
        out.append((text[: m.start()].count("\n") + 1, table, var))
    return out


def key_of(rel: str, table: str, var: str) -> str:
    return f"{rel}::{table}::{var}"


def scan(root: Path) -> tuple[int, dict[str, list[int]]]:
    """Return (files_scanned, {key: [linenos]}). Raises OSError on a bad walk."""
    scanned = 0
    found: dict[str, list[int]] = {}
    for source_root in SOURCE_ROOTS:
        base = root / source_root
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in SUFFIXES:
                continue
            if SKIP_DIRS & set(path.parts):
                continue
            if TEST_FILE.search(path.name):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="strict")
            except (UnicodeDecodeError, OSError):
                continue
            scanned += 1
            rel = path.relative_to(root).as_posix()
            for lineno, table, var in find_sites(text):
                found.setdefault(key_of(rel, table, var), []).append(lineno)
    return scanned, found


def load_baseline(path: Path) -> dict[str, int] | None:
    """`{key: count}`. None when it cannot be read — the caller exits 2."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    sites = raw.get("sites")
    if not isinstance(sites, dict) or not sites:
        return None
    if not all(isinstance(v, int) and v > 0 for v in sites.values()):
        return None
    return sites


def main(root: Path = ROOT, baseline_path: Path = BASELINE) -> int:
    if not any((root / r).is_dir() for r in SOURCE_ROOTS):
        print(f"== Swallowed read errors: CANNOT CHECK -- no source root of "
              f"{SOURCE_ROOTS} under {root}")
        return 2

    baseline = load_baseline(baseline_path)
    if baseline is None:
        print(f"== Swallowed read errors: CANNOT CHECK -- {baseline_path} is "
              f"missing, unparseable, or has an empty/invalid 'sites' map")
        print("   Regenerate with --write-baseline, and read the diff before "
              "committing it.")
        return 2

    try:
        scanned, found = scan(root)
    except OSError as exc:
        print(f"== Swallowed read errors: CANNOT CHECK -- {exc}")
        return 2

    if scanned == 0:
        print(f"== Swallowed read errors: CANNOT CHECK -- 0 candidate .ts/.tsx "
              f"files under {SOURCE_ROOTS}")
        print("   Expected hundreds. Either the tree moved or SKIP_DIRS is wrong.")
        return 2

    if not found:
        # The baseline is non-empty (checked above), so "zero sites anywhere"
        # means the DETECTOR stopped matching, not that the codebase is clean.
        # Reporting that as a pass is the exact fault this guard exists for.
        print(f"== Swallowed read errors: CANNOT CHECK -- {scanned} files "
              f"scanned, 0 sites matched, but the baseline lists "
              f"{sum(baseline.values())}")
        print("   The detector has rotted. Fix DESTRUCTURE/SUPABASE_CHAIN before "
              "trusting a green run.")
        return 2

    new: list[tuple[str, int]] = []
    for key, linenos in sorted(found.items()):
        if key in ALLOWLIST:
            continue
        allowed = baseline.get(key, 0)
        for lineno in sorted(linenos)[allowed:]:
            new.append((key, lineno))

    stale = sorted(
        k
        for k, n in baseline.items()
        if k not in ALLOWLIST and len(found.get(k, [])) < n
    )

    total = sum(len(v) for v in found.values())
    print(f"== Swallowed read errors: {scanned} files scanned, {total} site(s) "
          f"found, {sum(baseline.values())} baselined, {len(ALLOWLIST)} allowlisted")

    if not new and not stale:
        print("PASS -- no new swallowed read, and the baseline still describes "
              "the tree.")
        return 0

    if new:
        print(f"\nFAIL -- {len(new)} swallowed read(s) not in the baseline:\n")
        for key, lineno in new:
            rel, table, var = key.split("::")
            print(f"   {rel}:{lineno}")
            print(f"      const {{ data{'' if var == 'data' else f': {var}'} }} "
                  f"= await ... .from(\"{table}\")  -- `error` is discarded")
        print("\n   supabase-js RESOLVES with { data, error }; it does not throw,")
        print("   so a try/catch around this is inert and `[]`/`null` means BOTH")
        print("   'nothing matched' and 'the query failed'.")
        print("\n   Bind the error and either propagate it or return an explicit")
        print("   unavailable state. Per ADR 0051 an unknown value renders as an")
        print("   em dash, NEVER as 0 -- turning a swallowed error into a")
        print("   displayed zero has not fixed anything. The house idiom is")
        print("   `logQueryFailure` (apps/api-gateway/src/analytics/")
        print("   advanced-analytics.service.ts:150) and insight-generator.")
        print("   service.ts:305-315.")
        print("\n   If this one genuinely does not need its error, add its key to")
        print("   ALLOWLIST in this file WITH the reason. Do NOT add it to the")
        print("   baseline: the baseline is a record of pre-existing debt and")
        print("   only ever shrinks.")

    if stale:
        print(f"\nFAIL -- {len(stale)} baseline row(s) no longer describe the tree:\n")
        for key in stale:
            rel, table, var = key.split("::")
            have = len(found.get(key, []))
            print(f"   {rel}  table={table} binding={var}  "
                  f"baseline={baseline[key]} actual={have}")
        print("\n   This is the good direction -- a site was fixed, moved or")
        print("   deleted. Lower or remove the row in")
        print(f"   {baseline_path.relative_to(root)} so the count stays honest,")
        print("   and update the denominator in")
        print("   .planning/03-scenarios/DELIVERY-AUDIT.md §6.")

    return 1


def write_baseline(root: Path = ROOT, baseline_path: Path | None = None) -> int:
    """Regenerate the baseline from the tree. Adoption + fix-landing only.

    The baseline is written INSIDE `root`, so pointing `--root` at a scratch
    checkout to measure it cannot overwrite the repo's real baseline. That is
    not hypothetical: it happened once while writing this guard.
    """
    if baseline_path is None:
        baseline_path = root / "scripts" / "read_error_baseline.json"
    scanned, found = scan(root)
    if scanned == 0 or not found:
        print("Refusing to write a baseline from a scan that found nothing.")
        return 2
    sites = {k: len(v) for k, v in sorted(found.items()) if k not in ALLOWLIST}
    by_file = Counter(k.split("::")[0] for k in sites)
    payload = {
        "_comment": (
            "Pre-existing swallowed supabase reads, recorded at adoption of "
            "scripts/check_read_errors_not_swallowed.py (ADR 0067). This list "
            "only ever SHRINKS: a key absent from the tree fails the build so "
            "the row gets removed. Never add a row to silence a new finding -- "
            "fix it, or allowlist it with a written reason in the guard."
        ),
        "total_sites": sum(sites.values()),
        "total_files": len(by_file),
        "sites": sites,
    }
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    baseline_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {baseline_path}: {payload['total_sites']} site(s) across "
          f"{payload['total_files']} file(s), {scanned} files scanned.")
    return 0


# ---------------------------------------------------------------------------


def self_test() -> int:
    failures: list[str] = []

    VIOLATION = (
        'async function f(client: any) {\n'
        '  const { data } = await client.from("restaurants").select("id");\n'
        '  return data || [];\n'
        '}\n'
    )
    CLEAN = (
        'async function f(client: any) {\n'
        '  const { data, error } = await client.from("restaurants").select("id");\n'
        '  if (error) throw error;\n'
        '  return data || [];\n'
        '}\n'
    )

    def tree(base: Path, files: dict[str, str]) -> Path:
        for rel, body in files.items():
            p = base / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")
        return base

    def baseline_file(base: Path, sites: dict[str, int]) -> Path:
        p = base / "baseline.json"
        p.write_text(json.dumps({"sites": sites}), encoding="utf-8")
        return p

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # --- the violating shape is caught -------------------------------
        a = tree(root / "a", {"apps/x/svc.ts": VIOLATION})
        # a non-empty baseline that does NOT cover the site
        bl = baseline_file(a, {"apps/other/z.ts::t::data": 1})
        if main(a, bl) != 1:
            failures.append("a new swallowed read did not exit 1")

        # --- the clean shape is not ---------------------------------------
        b = tree(root / "b", {"apps/x/svc.ts": CLEAN, "apps/x/o.ts": VIOLATION})
        bl_b = baseline_file(b, {"apps/x/o.ts::restaurants::data": 1})
        if main(b, bl_b) != 0:
            failures.append("a clean tree with a fully-baselined site did not exit 0")

        # --- a shrunk baseline fails, so the count cannot rot -------------
        c = tree(root / "c", {"apps/x/o.ts": VIOLATION})
        bl_c = baseline_file(c, {"apps/x/o.ts::restaurants::data": 2})
        if main(c, bl_c) != 1:
            failures.append("a stale (over-counted) baseline row did not exit 1")

        # --- CANNOT CHECK cases ------------------------------------------
        if main(root / "nope", bl) != 2:
            failures.append("a missing source tree did not exit 2")

        d = root / "d"
        (d / "apps").mkdir(parents=True)
        if main(d, bl) != 2:
            failures.append("a tree with 0 candidate files did not exit 2")

        e = tree(root / "e", {"apps/x/svc.ts": VIOLATION})
        if main(e, e / "absent.json") != 2:
            failures.append("a missing baseline did not exit 2")

        bad = e / "bad.json"
        bad.write_text("{ not json", encoding="utf-8")
        if main(e, bad) != 2:
            failures.append("an unparseable baseline did not exit 2")

        empty = e / "empty.json"
        empty.write_text('{"sites": {}}', encoding="utf-8")
        if main(e, empty) != 2:
            failures.append("an empty baseline did not exit 2")

        # A clean tree + a non-empty baseline means the DETECTOR rotted, not
        # that the code is clean. This must never be a pass.
        f = tree(root / "f", {"apps/x/svc.ts": CLEAN})
        bl_f = baseline_file(f, {"apps/x/svc.ts::restaurants::data": 1})
        if main(f, bl_f) != 2:
            failures.append("zero sites found against a non-empty baseline did not exit 2")

        # --- detector invariants -----------------------------------------
        if len(find_sites(VIOLATION)) != 1:
            failures.append("the violating shape was not detected")
        if find_sites(CLEAN):
            failures.append("binding `error` was still flagged")
        if find_sites(
            'const { data: dupe, error: dupeError } = await c.from("p").select("*").maybeSingle();\n'
        ):
            failures.append("an aliased `error: dupeError` binding was flagged")
        # A refusal on falsy is loud, not silent — out of scope by decision.
        if find_sites(
            'const { data: user } = await c.from("users").select("*").maybeSingle();\n'
            'if (!user) throw new NotFoundException("x");\n'
        ):
            failures.append("a value refused on falsy was flagged")
        # ...but the FAIL-OPEN shape (`if (x) throw`) must still be flagged:
        # that is precisely the providers.service 409 dedup bug.
        if len(find_sites(
            'const { data: dupe } = await c.from("providers").select("id").maybeSingle();\n'
            'if (dupe) throw new ConflictException("duplicate");\n'
        )) != 1:
            failures.append("the fail-open dedup shape was NOT flagged")
        # Non-supabase awaits throw on failure; not this defect.
        if find_sites('const { data } = await axios.get("/x");\n'):
            failures.append("a non-supabase await was flagged")
        # A `.select("a, b")` argument contains a comma and a quote; the
        # statement scanner must not stop early on it.
        multi = (
            'const { data } = await c\n'
            '  .from("pos_checks")\n'
            '  .select("source, opened_at, closed_at")\n'
            '  .eq("restaurant_id", id);\n'
        )
        sites = find_sites(multi)
        if len(sites) != 1 or sites[0][1] != "pos_checks":
            failures.append(f"a multi-line chain resolved to {sites}, not one pos_checks site")
        # `count` is not a substitute for `error` — it is null on failure too.
        if len(find_sites('const { data, count } = await c.from("v").select("*");\n')) != 1:
            failures.append("`count` was accepted as an error binding")

        # --- the real tree still scans, and the key shape is stable -------
        real_scanned, real_found = scan(ROOT)
        if real_scanned < 100:
            failures.append(f"the real tree scanned only {real_scanned} files")
        if not real_found:
            failures.append("the real tree matched 0 sites — the detector has rotted")
        if any(k.count("::") != 2 for k in real_found):
            failures.append("a key did not have exactly two :: separators")

    print("== --self-test: 18 invariants")
    if failures:
        for f in failures:
            print(f"   FAIL -- {f}")
        return 1
    print("   a NEW swallowed read exits 1; a fully-baselined tree exits 0")
    print("   a baseline row that over-counts the tree exits 1 (the count cannot rot)")
    print("   a missing source tree, 0 candidate files, and a missing, unparseable")
    print("      or empty baseline each exit 2, never 0")
    print("   0 sites found against a non-empty baseline exits 2 (detector rot is")
    print("      NOT a clean bill of health) -- this is the absence-as-health rule")
    print("   binding `error`, or `error: someAlias`, is not flagged")
    print("   a value refused on falsy is not flagged (out of scope, ADR 0067)")
    print("   the FAIL-OPEN `if (dupe) throw` shape IS flagged")
    print("   a non-supabase await is not flagged; `count` is not an error binding")
    print("   a multi-line chain with a comma inside .select() resolves to one site")
    print("   the real tree scans >=100 files and matches sites, with stable keys")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="No new code discards a supabase-js read's `error`."
    )
    ap.add_argument("--self-test", action="store_true",
                    help="prove the exit-code and detector invariants, then exit")
    ap.add_argument("--write-baseline", action="store_true",
                    help="regenerate the baseline from the tree (adoption / after fixes)")
    ap.add_argument("--root", type=Path, default=ROOT,
                    help="scan this tree instead of the repo root. Exists so the "
                         "guard can be pointed at a PRE-FIX checkout and SEEN to "
                         "fail — a guard nobody has watched fail is not evidence.")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())
    if args.write_baseline:
        sys.exit(write_baseline(args.root))
    sys.exit(main(args.root))
