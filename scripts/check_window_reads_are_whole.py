#!/usr/bin/env python3
"""Guard: an analytics read of the sales register is whole, bounded, or recorded.

WHY THIS EXISTS (ADR 0292)
--------------------------
PostgREST stops every response at `max_rows` -- 1000, `supabase/config.toml` --
and says nothing: the answer is a 200 holding a thousand rows. An unranged
`.select()` over `pos_checks` or `wine_consumption_log` was therefore a SAMPLE
named as a total. On the one real house (2026-10-03) the 90-day till counted
1,000 of 3,313 checks, "Who served it" ranked the floor on 29.6% of its takings
and menu engineering classified on 752 of about 8,445 units. Nothing threw,
nothing logged, and every figure looked like a figure.

The fix is `readWholeWindow` (`apps/api-gateway/src/common/read-whole-window.ts`):
keyset pages on `id`, an exact count that proves the read whole, and a refusal
(`WholeReadError`) when it cannot. This guard is what keeps the next reader from
going back to the unranged select, which is the shortest thing anyone can write.

WHAT A READ IS
--------------
A chain starting at `.from("pos_checks")` or `.from("wine_consumption_log")` --
or `.from(X)` where the same file binds `X` to one of those literals -- in a
non-test `.ts` file under `apps/api-gateway/src`. The chain runs from the
`.from(` to the first `;` or `,` at its own bracket depth, or to the bracket
that closes the expression it sits in. A chain holding `.insert(` / `.upsert(` /
`.update(` / `.delete(` is a write and is ignored. A chain with neither a
`.select(` nor a write is a builder this guard cannot follow, and it fails.

WHAT MAKES A READ PASS
----------------------
  1. WHOLE. The `.from(` sits inside the SECOND argument of a
     `readWholeWindow(` call (the page factory), and its first `.select(`
       * projects a bare `id` column (the cursor),
       * passes `{ count: "exact" }` (the proof), and
       * the chain carries no `.order(` / `.limit(` / `.range(` / `.single(` /
         `.maybeSingle(`: the helper owns all of them, and a reader's own order
         would sort ahead of `id` and make the cursor skip rows.
  2. BOUNDED. `.single(` / `.maybeSingle(` / `head: true`, or a `.limit(N)` or
     `.range(a, b)` whose size resolves -- a literal, or a constant bound in
     the same file, optionally `+ k` -- to at most the cap. A limit ABOVE the
     cap fails: it is the same silent truncation with a number on it.
  3. ALLOWLISTED by file, with the reason, the text that must still be in the
     file, and the exact number of reads it covers. Each one reads whole by
     another mechanism. If the pinned text goes or the count moves, the entry
     no longer describes the file: exit 2.
  4. BASELINED. A shrink-only count of the reads that were unbounded the day
     this guard landed, by `<file>::<table>`. One more fails (a new unwhole
     read). One FEWER also fails: the PR that removes the read deletes or
     lowers the row, so the record never claims debt that is gone.

WHAT IT CANNOT SEE, AND SAYS SO
-------------------------------
  * A table name held in a map or computed at runtime (`dev-truth.service.ts`
    reads `.from(table)` over an object of names). Only a `const X = "<table>"`
    in the same file is followed.
  * A bound applied in a LATER statement (`q = q.limit(1)` on the next line) is
    not in the chain and is not credited -- that falls the safe way.
  * Whether the code that consumes a whole read uses all of it.
  * Reads outside the gateway. On 2026-10-03 there were none: no web, mobile or
    orchestrator file names either table in a `.from(` / `.table(`.
  * Test files (`*.spec.*`, `*.test.*`, `__tests__`, `__fixtures__`,
    `__mocks__`) build doubles, not reads, and are not scanned.

EXIT CODES
    0  PASS -- every read is whole, bounded, allowlisted or baselined
    1  FAIL -- a read is none of those, or a baseline row is stale (file:line)
    2  CANNOT CHECK -- never 0. The helper is gone or renamed, the cap in
       `supabase/config.toml` moved, the shared comment stripper will not load,
       neither table is named anywhere, no `readWholeWindow` call exists, or an
       allowlist entry no longer describes its file.
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import shutil
import sys
import tempfile
from pathlib import Path

TABLES = ("pos_checks", "wine_consumption_log")
SCAN_ROOT = "apps/api-gateway/src"
HELPER = "apps/api-gateway/src/common/read-whole-window.ts"
HELPER_FN = "readWholeWindow"
CONFIG = "supabase/config.toml"
# The cap every bound is measured against. Read from CONFIG and checked: if the
# server's cap moves, every "bounded" verdict below was made against the wrong
# number, and that is CANNOT CHECK rather than a quiet pass.
CAP = 1000

TEST_MARKERS = (".spec.", ".test.")
TEST_DIRS = {"__tests__", "__fixtures__", "__mocks__", "node_modules", "dist"}

# ---------------------------------------------------------------------------
# The allowlist: reads that are whole by another mechanism. Measured on
# origin/main 8c673db4b, 2026-10-03.
# ---------------------------------------------------------------------------
ALLOWLIST: dict[str, dict] = {
    "apps/api-gateway/src/ask-readings/reading-sources.ts": {
        "reads": 2,
        "pinned": [
            'return this.session.read(c => c.from("pos_checks")',
            'return this.session.read(c => c.from("wine_consumption_log")',
        ],
        "reason": (
            "RecordingSession.read (ask-readings/recording-session.ts) pages by "
            "id with an exact count and refuses truncation, a changed count or "
            "more than 20,000 rows -- the same rule, older and stricter."
        ),
    },
    "apps/api-gateway/src/logs/logs-timeline.service.ts": {
        "reads": 1,
        "pinned": [
            "const limit = Math.min(200, Math.max(1, opts.limit ?? 50));",
            "return out.limit(cursor.fetch);",
        ],
        "reason": (
            "the bound is applied by `windowed()` in the next statement: at most "
            "201 rows per source page, and the timeline pages by cursor."
        ),
    },
    "apps/api-gateway/src/simpos/scenario-verify.service.ts": {
        "reads": 2,
        "pinned": [
            "if (rows.length >= ScenarioVerifyService.POSTGREST_MAX_ROWS) {",
        ],
        "reason": (
            "`readIn` reads in `.in()` chunks and refuses any chunk that lands "
            "on PostgREST's cap: 'this is a page, not a complete set'."
        ),
    },
}

# ---------------------------------------------------------------------------
# The baseline: unbounded reads on the day this guard landed. SHRINK-ONLY. Each
# is recorded in .planning/v3.0-TECH-DEBT.md via tech-debt.d. The PR that
# removes or wraps one of these reads deletes or lowers its row.
# ---------------------------------------------------------------------------
BASELINE: dict[str, dict] = {
    "apps/api-gateway/src/dashboard/dashboard.service.ts::wine_consumption_log": {
        "reads": 1,
        "why": "getStats' consumption tile (ADR 0292 residual).",
    },
    "apps/api-gateway/src/pos-hub/pos-hub.service.ts::pos_checks": {
        "reads": 1,
        "why": "getStatus' 30-day source summary (ADR 0292 residual).",
    },
    "apps/api-gateway/src/communications/scheduled-tasks.service.ts::wine_consumption_log": {
        "reads": 1,
        "why": "the weekly top-sellers digest over 7 days (ADR 0292 residual).",
    },
    "apps/api-gateway/src/analytics/dev-truth.service.ts::pos_checks": {
        "reads": 2,
        "why": "the as-of split; counts exact, rows capped (ADR 0292 residual).",
    },
    "apps/api-gateway/src/notifications/producers/sale-record.producer.ts::pos_checks": {
        "reads": 1,
        "why": "limit(CHECK_CAP + 1) with CHECK_CAP = 2000, above the cap (ADR 0292 residual).",
    },
    "apps/api-gateway/src/pos-hub/pos-mapping-review.service.ts::pos_checks": {
        "reads": 1,
        "why": (
            "limit(checkLimit): default 500, but the DTO allows @Max(2000), above "
            "the cap (ADR 0292 residual). Missed by the plan's grep census: grep "
            "reads this file as binary."
        ),
    },
}


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# Comment stripping, shared BY PATH with the sibling guards so the repo has one
# stripper (`check_order_capture_contract.strip_comments`, the same one
# `check_read_columns_exist.py` loads). It keeps offsets and line numbers.
# ---------------------------------------------------------------------------
def _load_stripper(root: Path):
    path = root / "scripts" / "check_order_capture_contract.py"
    if not path.is_file():
        raise CannotCheck(
            f"{path} is missing; its comment stripper is this guard's only defence "
            f"against reading a commented-out query as a live one."
        )
    try:
        spec = importlib.util.spec_from_file_location("_occ_shared_wrw", path)
        if spec is None or spec.loader is None:
            raise CannotCheck(f"{path} could not be loaded as a module.")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except CannotCheck:
        raise
    except BaseException as e:  # noqa: BLE001 -- SystemExit included
        raise CannotCheck(f"{path} would not import: {e!r}") from e
    if not hasattr(mod, "strip_comments"):
        raise CannotCheck(f"{path} no longer exports strip_comments().")
    return mod.strip_comments


# ---------------------------------------------------------------------------
# Bracket walking. String and template literals are skipped, so a `,` or `)`
# inside `"restaurant_inventory(master_wine_id)"` never ends anything.
# ---------------------------------------------------------------------------
OPEN = "([{"
CLOSE = ")]}"


def _skip_string(src: str, i: int) -> int:
    """Index just past the literal whose opening quote is at `i`."""
    quote = src[i]
    i += 1
    n = len(src)
    while i < n:
        c = src[i]
        if c == "\\":
            i += 2
            continue
        if c == quote:
            return i + 1
        i += 1
    return n


def _split_args(src: str, open_paren: int) -> list[tuple[int, int]] | None:
    """Spans of the top-level arguments of the call whose `(` is at `open_paren`.
    None when the call is unterminated in the file -- not guessed at."""
    depth = 0
    args: list[tuple[int, int]] = []
    start = open_paren + 1
    i = open_paren
    n = len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            i = _skip_string(src, i)
            continue
        if c in OPEN:
            depth += 1
        elif c in CLOSE:
            depth -= 1
            if depth == 0:
                args.append((start, i))
                return args
        elif c == "," and depth == 1:
            args.append((start, i))
            start = i + 1
        i += 1
    return None


def _chain_end(src: str, start: int) -> int:
    """Where the expression beginning at `start` ends: a `;` or `,` at its own
    depth, or the bracket that closes what it sits in."""
    depth = 0
    i = start
    n = len(src)
    while i < n:
        c = src[i]
        if c in "\"'`":
            i = _skip_string(src, i)
            continue
        if c in OPEN:
            depth += 1
        elif c in CLOSE:
            depth -= 1
            if depth < 0:
                return i
        elif c in ";," and depth == 0:
            return i
        i += 1
    return n


# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------
TABLE_ALT = "|".join(TABLES)
LITERAL_FROM_RE = re.compile(r"""\.from\(\s*(["'`])(""" + TABLE_ALT + r""")\1\s*\)""")
ALIAS_DEF_RE = re.compile(
    r"""\b(?:const|let|var|readonly)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?=\s*"""
    r"""(["'`])(""" + TABLE_ALT + r""")\2"""
)
WRITE_RE = re.compile(r"\.(?:insert|upsert|update|delete)\(")
SELECT_RE = re.compile(r"\.select\(")
HELPER_CALL_RE = re.compile(r"\b" + HELPER_FN + r"\s*(?:<[^()]*?>)?\s*\(")
FORBIDDEN_IN_WHOLE = re.compile(r"\.(?:order|limit|range|single|maybeSingle)\(")
SINGLE_RE = re.compile(r"\.(?:single|maybeSingle)\(")
HEAD_RE = re.compile(r"head\s*:\s*true")
COUNT_EXACT_RE = re.compile(r"""count\s*:\s*["']exact["']""")
LIMIT_RE = re.compile(r"\.limit\(")
RANGE_RE = re.compile(r"\.range\(")


def _const_value(src: str, name: str) -> str | None:
    """The literal a same-file constant is bound to (number or string)."""
    m = re.search(
        r"\b" + re.escape(name) + r"""\s*(?::[^=;\n]+)?=\s*([0-9][0-9_]*|"[^"\n]*"|'[^'\n]*'|`[^`$]*`)""",
        src,
    )
    return m.group(1) if m else None


def _resolve_int(src: str, expr: str) -> int | None:
    """`1000`, `NAME`, `Class.NAME`, each optionally `+ k`. Anything else: None."""
    m = re.fullmatch(r"\s*([A-Za-z_$][\w$.]*|[0-9][0-9_]*)\s*(?:\+\s*([0-9][0-9_]*))?\s*", expr)
    if not m:
        return None
    head, plus = m.group(1), m.group(2)
    if head[0].isdigit():
        base = int(head.replace("_", ""))
    else:
        raw = _const_value(src, head.split(".")[-1])
        if raw is None or not raw[0].isdigit():
            return None
        base = int(raw.replace("_", ""))
    return base + (int(plus.replace("_", "")) if plus else 0)


def _select_text(src: str, expr: str) -> str | None:
    """The column list a select argument holds: a literal, or a same-file const."""
    e = expr.strip()
    if len(e) >= 2 and e[0] in "\"'`" and e[-1] == e[0]:
        body = e[1:-1]
        return None if "${" in body else body
    if re.fullmatch(r"[A-Za-z_$][\w$.]*", e):
        raw = _const_value(src, e.split(".")[-1])
        if raw and raw[0] in "\"'`":
            return raw[1:-1]
    return None


def _top_level_columns(cols: str) -> list[str]:
    out, depth, cur = [], 0, ""
    for ch in cols:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def _bounded(src: str, chain: str, chain_at: int) -> tuple[bool, str | None]:
    """(bounded, why-not). `why-not` is set when a bound exists but is too big."""
    if SINGLE_RE.search(chain):
        return True, None
    sel = SELECT_RE.search(chain)
    if sel:
        args = _split_args(src, chain_at + sel.end() - 1)
        if args and len(args) >= 2 and HEAD_RE.search(src[args[1][0] : args[1][1]]):
            return True, None
    for m in LIMIT_RE.finditer(chain):
        args = _split_args(src, chain_at + m.end() - 1)
        if not args:
            continue
        n = _resolve_int(src, src[args[0][0] : args[0][1]])
        if n is None:
            return False, "its .limit() does not resolve to a number this guard can read"
        if n > CAP:
            return False, (
                f"its .limit() resolves to {n}, above the server's cap of {CAP}; the "
                f"server cuts it to {CAP} and says nothing, so the bound is a fiction"
            )
        return True, None
    for m in RANGE_RE.finditer(chain):
        args = _split_args(src, chain_at + m.end() - 1)
        if not args or len(args) < 2:
            continue
        a = _resolve_int(src, src[args[0][0] : args[0][1]])
        b = _resolve_int(src, src[args[1][0] : args[1][1]])
        if a is None or b is None:
            return False, "its .range() does not resolve to numbers this guard can read"
        if b - a + 1 > CAP:
            return False, f"its .range() spans {b - a + 1} rows, above the cap of {CAP}"
        return True, None
    return False, None


def _whole_problems(src: str, chain: str, chain_at: int) -> list[str]:
    problems: list[str] = []
    sel = SELECT_RE.search(chain)
    if not sel:
        return ["it has no .select() this guard can read"]
    args = _split_args(src, chain_at + sel.end() - 1)
    if not args:
        return ["its .select() is unterminated"]
    cols = _select_text(src, src[args[0][0] : args[0][1]])
    if cols is None:
        problems.append(
            "its column list is not a literal or same-file constant, so `id` cannot be proved"
        )
    elif "id" not in _top_level_columns(cols):
        problems.append("its select does not project `id`, the cursor the pages walk")
    if len(args) < 2 or not COUNT_EXACT_RE.search(src[args[1][0] : args[1][1]]):
        problems.append('its select does not ask for { count: "exact" }, the proof the read is whole')
    if FORBIDDEN_IN_WHOLE.search(chain):
        problems.append(
            "it orders, limits or ranges inside the page factory; the helper owns all "
            "three, and an order of its own sorts ahead of `id` so the cursor skips rows"
        )
    return problems


def _sources(root: Path) -> list[Path]:
    base = root / SCAN_ROOT
    if not base.is_dir():
        raise CannotCheck(f"{SCAN_ROOT} does not exist under {root}.")
    out: list[Path] = []
    for p in sorted(base.rglob("*.ts")):
        if not p.is_file() or any(m in p.name for m in TEST_MARKERS):
            continue
        if any(part in TEST_DIRS for part in p.parts):
            continue
        out.append(p)
    if not out:
        raise CannotCheck(f"no .ts files under {SCAN_ROOT}; the root rotted.")
    return out


def _check_anchors(root: Path) -> None:
    helper = root / HELPER
    if not helper.is_file():
        raise CannotCheck(f"{HELPER} is missing; there is no whole read to point anyone at.")
    text = helper.read_text(encoding="utf-8", errors="replace")
    for needle in (
        f"export async function {HELPER_FN}",
        'order("id", { ascending: true })',
        '.gt("id", cursor)',
        "class WholeReadError",
    ):
        if needle not in text:
            raise CannotCheck(
                f"{HELPER} no longer contains {needle!r}; the rule this guard points "
                f"at may no longer be the rule the code applies."
            )
    cfg = root / CONFIG
    if not cfg.is_file():
        raise CannotCheck(f"{CONFIG} is missing; the cap every bound is measured against is unknown.")
    m = re.search(r"(?m)^\s*max_rows\s*=\s*(\d+)\s*$", cfg.read_text(encoding="utf-8"))
    if not m or int(m.group(1)) != CAP:
        raise CannotCheck(
            f"{CONFIG} no longer says max_rows = {CAP}"
            + (f" (it says {m.group(1)})" if m else "")
            + "; every bound this guard credits was measured against the old cap."
        )


def run(
    root: Path,
    allowlist: dict[str, dict] | None = None,
    baseline: dict[str, dict] | None = None,
) -> tuple[int, list[str], dict[str, int]]:
    """(exit code, findings, counts). Raises CannotCheck for exit 2."""
    allowlist = ALLOWLIST if allowlist is None else allowlist
    baseline = BASELINE if baseline is None else baseline
    _check_anchors(root)
    strip = _load_stripper(root)
    files = _sources(root)

    findings: list[str] = []
    counts = {
        "files": len(files),
        "mentions": 0,
        "reads": 0,
        "writes": 0,
        "whole": 0,
        "bounded": 0,
        "allowlisted": 0,
        "baselined": 0,
        "helper_calls": 0,
        "in_helper": 0,
    }
    allow_seen = {k: 0 for k in allowlist}
    base_seen = {k: 0 for k in baseline}
    over_baseline: dict[str, list[str]] = {}

    for path in files:
        raw = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(root).as_posix()
        if rel == HELPER:
            continue
        src = strip(raw)
        if not any(t in src for t in TABLES) and HELPER_FN not in src:
            continue

        def line_of(pos: int) -> int:
            return src.count("\n", 0, pos) + 1

        # Every factory span: the second argument of each readWholeWindow call.
        factories: list[tuple[int, int]] = []
        for m in HELPER_CALL_RE.finditer(src):
            counts["helper_calls"] += 1
            args = _split_args(src, m.end() - 1)
            if not args or len(args) < 2 or ".from(" not in src[args[1][0] : args[1][1]]:
                findings.append(
                    f"{rel}:{line_of(m.start())} calls {HELPER_FN} with no `.from(` in its "
                    f"page factory, so nothing can check what it reads. Pass the builder "
                    f"inline: {HELPER_FN}(what, () => client.from(...).select(...))."
                )
                continue
            factories.append(args[1])

        # Table aliases bound in this file.
        aliases = {m.group(1): m.group(3) for m in ALIAS_DEF_RE.finditer(src)}
        sites: list[tuple[int, int, str]] = []  # (from pos, chain start, table)
        for m in LITERAL_FROM_RE.finditer(src):
            sites.append((m.start(), m.end(), m.group(2)))
        for alias, table in aliases.items():
            for m in re.finditer(r"\.from\(\s*(?:[\w$]+\.)*" + re.escape(alias) + r"\s*\)", src):
                sites.append((m.start(), m.end(), table))
        for t in TABLES:
            counts["mentions"] += src.count(t)

        for at, chain_at, table in sorted(sites):
            chain = src[chain_at : _chain_end(src, chain_at)]
            line = line_of(at)
            if WRITE_RE.search(chain):
                counts["writes"] += 1
                continue
            if not SELECT_RE.search(chain):
                findings.append(
                    f"{rel}:{line} builds a `{table}` query with no .select() in the same "
                    f"expression, so this guard cannot follow it. Write the read as one "
                    f"chain, or wrap it in {HELPER_FN}."
                )
                continue
            counts["reads"] += 1

            if any(a <= at < b for a, b in factories):
                counts["in_helper"] += 1
                problems = _whole_problems(src, chain, chain_at)
                if problems:
                    findings.append(
                        f"{rel}:{line} reads `{table}` through {HELPER_FN} but "
                        + "; and ".join(problems)
                        + "."
                    )
                else:
                    counts["whole"] += 1
                continue

            ok, why_not = _bounded(src, chain, chain_at)
            if ok:
                counts["bounded"] += 1
                continue
            if rel in allowlist:
                allow_seen[rel] += 1
                counts["allowlisted"] += 1
                continue
            key = f"{rel}::{table}"
            if key in baseline:
                base_seen[key] += 1
                counts["baselined"] += 1
                if base_seen[key] > baseline[key]["reads"]:
                    over_baseline.setdefault(key, []).append(f"{rel}:{line}")
                continue
            findings.append(
                f"{rel}:{line} reads `{table}` "
                + (f"and {why_not}" if why_not else "with no bound")
                + f". PostgREST stops every response at {CAP} rows without saying so, "
                f"so a window larger than that comes back as a sample named as a total. "
                f"Read it with {HELPER_FN}(what, () => client.from(\"{table}\")"
                f'.select("id, ...", {{ count: "exact" }}).eq(...)) -- the whole window or '
                f"a WholeReadError (ADR 0292) -- or bound it at {CAP} or less."
            )

    for key, where in over_baseline.items():
        findings.append(
            f"{key} holds {base_seen[key]} unbounded read(s) against a baseline of "
            f"{baseline[key]['reads']}: the new one ({', '.join(where)}) has no "
            f"permission. Read it with {HELPER_FN} (ADR 0292)."
        )
    for key, entry in baseline.items():
        if base_seen[key] < entry["reads"]:
            findings.append(
                f"baseline row {key} records {entry['reads']} unbounded read(s) but the "
                f"tree holds {base_seen[key]}. The row is STALE: the PR that removes the "
                f"read deletes or lowers the row, so this record never claims debt that "
                f"is gone."
            )

    for rel, entry in allowlist.items():
        p = root / rel
        if not p.is_file():
            raise CannotCheck(f"allowlisted file {rel} no longer exists; remove the entry.")
        text = p.read_text(encoding="utf-8", errors="replace")
        for pin in entry["pinned"]:
            if pin not in text:
                raise CannotCheck(
                    f"allowlisted file {rel} no longer contains {pin!r}, so its reason -- "
                    f"{entry['reason']} -- may no longer be true. Re-measure the entry."
                )
        if allow_seen[rel] != entry["reads"]:
            raise CannotCheck(
                f"allowlisted file {rel} holds {allow_seen[rel]} unbounded read(s), not "
                f"the {entry['reads']} measured and reasoned about. Re-measure the entry."
            )

    if counts["mentions"] == 0:
        raise CannotCheck(
            "neither table is named anywhere under the scan root; this guard would "
            "report a clean tree while looking at nothing."
        )
    if counts["helper_calls"] == 0 or counts["in_helper"] == 0:
        raise CannotCheck(
            f"no {HELPER_FN} call reads either table; the readers this guard was "
            f"written for are gone or renamed."
        )
    return (1 if findings else 0), findings, counts


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    try:
        code, findings, counts = run(root)
    except CannotCheck as e:
        print("== window reads are whole: CANNOT CHECK")
        print(f"   {e}")
        return 2
    print("== window reads are whole (ADR 0292)")
    print(f"   files scanned        {counts['files']}")
    print(f"   writes (ignored)     {counts['writes']}")
    print(f"   reads                {counts['reads']}")
    print(f"   whole ({HELPER_FN}) {counts['whole']}")
    print(f"   bounded (<= {CAP})     {counts['bounded']}")
    print(f"   allowlisted          {counts['allowlisted']}")
    print(f"   baselined            {counts['baselined']}  (shrink-only)")
    for f in findings:
        print(f"   FAIL -- {f}")
    if findings:
        return 1
    print("PASS")
    return code


# ---------------------------------------------------------------------------
# Self-test: every check below is shown to go red.
# ---------------------------------------------------------------------------
SVC = "apps/api-gateway/src/analytics/fixture.service.ts"
OTHER = "apps/api-gateway/src/other/allowed.service.ts"
DEBT = "apps/api-gateway/src/other/debt.service.ts"

HELPER_STUB = (
    "export class WholeReadError extends Error {}\n"
    f"export async function {HELPER_FN}(what: string, build: () => any) {{\n"
    '  let q = build().order("id", { ascending: true });\n'
    '  q = q.gt("id", cursor);\n'
    "}\n"
)

CLEAN_SVC = """import { readWholeWindow } from "../common/read-whole-window";
const SCAN = 200;
export class FixtureService {
  async whole(c: any) {
    return readWholeWindow<any>("the checks", () =>
      c
        .from("pos_checks")
        .select("id, total, restaurant_inventory(master_wine_id)", { count: "exact" })
        .eq("restaurant_id", "r1"),
    );
  }
  async lines(c: any, since: string) {
    return readWholeWindow("the lines", () => {
      let q = c.from("wine_consumption_log").select("id, quantity", { count: "exact" });
      if (since) q = q.gte("created_at", since);
      return q;
    });
  }
  async probe(c: any) {
    const { data } = await c.from("pos_checks").select("id").eq("a", 1).limit(1);
    const { count } = await c.from("wine_consumption_log").select("id", { count: "exact", head: true });
    const one = await c.from("pos_checks").select("id").eq("id", "x").maybeSingle();
    const some = await c.from("pos_checks").select("id").limit(SCAN + 1);
    return [data, count, one, some];
  }
  async write(c: any, row: any) {
    await c.from("wine_consumption_log").insert(row).select("id");
  }
  // c.from("pos_checks").select("total") -- a commented-out read is not a read
}
"""

OTHER_SVC = """export class AllowedService {
  async rows(c: any) {
    return this.session.read((x: any) => x.from("pos_checks").select("id"));
  }
}
"""

DEBT_SVC = """export class DebtService {
  async rows(c: any) {
    return c.from("wine_consumption_log").select("quantity").eq("r", 1);
  }
}
"""

TEST_ALLOW = {
    OTHER: {"reads": 1, "pinned": ["this.session.read("], "reason": "fixture"},
}
TEST_BASE = {f"{DEBT}::wine_consumption_log": {"reads": 1, "why": "fixture"}}


def _fixture(root: Path) -> Path:
    real = Path(__file__).resolve().parent.parent
    (root / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy(
        real / "scripts" / "check_order_capture_contract.py",
        root / "scripts" / "check_order_capture_contract.py",
    )
    (root / "supabase").mkdir(parents=True, exist_ok=True)
    (root / CONFIG).write_text(f"[api]\nmax_rows = {CAP}\n", encoding="utf-8")
    for rel, body in ((HELPER, HELPER_STUB), (SVC, CLEAN_SVC), (OTHER, OTHER_SVC), (DEBT, DEBT_SVC)):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(body, encoding="utf-8")
    return root


def self_test() -> int:
    failures: list[str] = []

    def outcome(root: Path, allow=None, base=None) -> tuple[int, list[str]]:
        try:
            c, f, _ = run(root, TEST_ALLOW if allow is None else allow, TEST_BASE if base is None else base)
            return c, f
        except CannotCheck as e:
            return 2, [str(e)]

    def expect(label: str, root: Path, want: int, needle: str | None = None, **kw) -> None:
        got, findings = outcome(root, **kw)
        if got != want:
            failures.append(f"{label}: exit {got}, expected {want}: {findings}")
        elif needle and not any(needle in f for f in findings):
            failures.append(f"{label}: no finding mentions {needle!r}: {findings}")

    with tempfile.TemporaryDirectory() as td:
        root = _fixture(Path(td) / "t")
        c, findings, counts = run(root, TEST_ALLOW, TEST_BASE)
        if c != 0:
            failures.append(f"the clean fixture failed: {findings}")
        want = {"whole": 2, "bounded": 4, "allowlisted": 1, "baselined": 1, "writes": 1, "reads": 8}
        for k, v in want.items():
            if counts[k] != v:
                failures.append(f"clean fixture count {k} = {counts[k]}, expected {v}")

        svc = root / SVC
        clean = svc.read_text(encoding="utf-8")

        def mutate(label: str, old: str, new: str, want_code: int, needle: str | None = None):
            if old not in clean:
                failures.append(f"{label}: the mutation's anchor is not in the fixture")
                return
            svc.write_text(clean.replace(old, new, 1), encoding="utf-8")
            expect(label, root, want_code, needle)
            svc.write_text(clean, encoding="utf-8")

        hook = "  async write(c: any, row: any) {"

        def add(label: str, method: str, want_code: int, needle: str | None = None):
            mutate(label, hook, method + hook, want_code, needle)

        # The whole point: an unbounded read fails.
        add(
            "an unbounded read",
            '  async bad(c: any) { return c.from("pos_checks").select("total").eq("r", 1); }\n',
            1,
            "with no bound",
        )
        add(
            "an unbounded read in a template literal",
            '  async bad(c: any) { return c.from(`pos_checks`).select("total"); }\n',
            1,
            "with no bound",
        )
        # A limit above the cap is the same truncation with a number on it.
        add(
            "limit(2000)",
            '  async bad(c: any) { return c.from("pos_checks").select("id").limit(2000); }\n',
            1,
            "above the server's cap",
        )
        add(
            "limit(BIG + 1) through a const",
            '  static readonly BIG = 2000;\n'
            '  async bad(c: any) { return c.from("pos_checks").select("id").limit(FixtureService.BIG + 1); }\n',
            1,
            "resolves to 2001",
        )
        add(
            "a range wider than the cap",
            '  async bad(c: any) { return c.from("pos_checks").select("id").range(0, 4999); }\n',
            1,
            "spans 5000",
        )
        # A const alias is followed.
        add(
            "a const alias",
            '  async bad(c: any) { const T = "pos_checks"; return c.from(T).select("total"); }\n',
            1,
            "with no bound",
        )
        # A builder the guard cannot follow fails rather than passing.
        add(
            "a builder with no select",
            '  async bad(c: any) { const q = c.from("pos_checks"); return q; }\n',
            1,
            "cannot follow it",
        )
        # Inside the helper: the count, the id and no order of its own.
        mutate(
            "readWholeWindow without the count",
            ', { count: "exact" })',
            ")",
            1,
            "count",
        )
        mutate(
            "readWholeWindow without `id` (a column merely CONTAINING id)",
            '"id, total, restaurant_inventory(master_wine_id)"',
            '"inventory_id, total, restaurant_inventory(id)"',
            1,
            "does not project `id`",
        )
        mutate(
            "readWholeWindow with its own order",
            '.eq("restaurant_id", "r1"),\n    );',
            '.eq("restaurant_id", "r1").order("opened_at", { ascending: true }),\n    );',
            1,
            "sorts ahead of `id`",
        )
        mutate(
            "readWholeWindow with no inline factory",
            'return readWholeWindow<any>("the checks", () =>',
            'return readWholeWindow<any>("the checks", factory); () =>',
            1,
            "no `.from(` in its",
        )
        # A commented-out read stays invisible.
        add("a commented-out read", '  // c.from("pos_checks").select("x")\n', 0)

        # Baseline: one more fails, one fewer is STALE and fails too.
        expect(
            "a stale baseline row",
            root,
            1,
            "STALE",
            base={f"{DEBT}::wine_consumption_log": {"reads": 2, "why": "x"}},
        )
        debt = root / DEBT
        debt_clean = debt.read_text(encoding="utf-8")
        debt.write_text(
            debt_clean.replace(
                "  async rows(",
                '  async more(c: any) { return c.from("wine_consumption_log").select("x"); }\n  async rows(',
            ),
            encoding="utf-8",
        )
        expect("one read past the baseline", root, 1, "has no permission")
        debt.write_text(debt_clean, encoding="utf-8")

        # Allowlist drift is CANNOT CHECK.
        expect(
            "an allowlist pin that is gone",
            root,
            2,
            "no longer contains",
            allow={OTHER: {"reads": 1, "pinned": ["nothing like this"], "reason": "x"}},
        )
        expect(
            "an allowlist count that moved",
            root,
            2,
            "not the 2 measured",
            allow={OTHER: {"reads": 2, "pinned": ["this.session.read("], "reason": "x"}},
        )

        # Anchors.
        cfg = root / CONFIG
        cfg.write_text("[api]\nmax_rows = 5000\n", encoding="utf-8")
        expect("the cap moved", root, 2, "max_rows")
        cfg.write_text(f"[api]\nmax_rows = {CAP}\n", encoding="utf-8")

        helper = root / HELPER
        helper_clean = helper.read_text(encoding="utf-8")
        helper.write_text(helper_clean.replace('.gt("id", cursor)', ".gt(x)"), encoding="utf-8")
        expect("the helper lost its cursor", root, 2, "no longer contains")
        helper.unlink()
        expect("the helper is gone", root, 2, "missing")
        helper.write_text(helper_clean, encoding="utf-8")

        stripper = root / "scripts" / "check_order_capture_contract.py"
        saved = stripper.read_text(encoding="utf-8")
        stripper.unlink()
        expect("the shared comment stripper is gone", root, 2, "comment stripper")
        stripper.write_text(saved, encoding="utf-8")

        # Never vacuous: no readWholeWindow call at all.
        svc.write_text(
            clean.replace("readWholeWindow<any>(", "notTheHelper<any>(").replace(
                'readWholeWindow("the lines"', 'notTheHelper("the lines"'
            ),
            encoding="utf-8",
        )
        expect("no readWholeWindow call", root, 2, "readers this guard was written for")
        svc.write_text(clean, encoding="utf-8")

        expect("the restored fixture", root, 0)

    if failures:
        print("== window reads are whole: SELF-TEST FAILED")
        for f in failures:
            print(f"   - {f}")
        return 1
    print("== window reads are whole: self-test PASS (every check went red when it should)")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    sys.exit(self_test() if a.self_test else main())
