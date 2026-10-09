#!/usr/bin/env python3
"""Guard: every column the Python agents NAME in a read must exist in supabase/migrations/.

WHY THIS EXISTS
---------------
`check_read_columns_exist.py` reads the gateway's TypeScript only. The Python
orchestrator had no column check at all, and sim wave 15 (2026-10-09, F-533,
F-536, F-537, F-520) found the cost: the order letter drafted at order creation
read `providers.ai_personality_notes` and `negotiation_facts.fact_field`, the
duplicate-order block filtered `procurement_orders.wine_name`, the reorder plan
read `procurement_orders.price_per_bottle`. None of those columns exist.
PostgREST answers 42703 and fails the WHOLE query; every call site caught the
error and carried on with an empty answer, so the letter went out unaddressed,
the duplicate block never fired, and every reorder targeted $23.75. The unit
tests were green throughout, because their mocks returned the phantom columns.

WHAT IT READS
-------------
Python's own parser (`ast`), not regexes, over services/agent-orchestrator
(tests/, demo/ and venv/ excluded). A chain is anything rooted at
`.table("<name>")`, directly or through a local variable assigned from one:

    .table("t").select("a, b")            the projection
    .table("t").eq("a", v) / .order("a")  the filters and the sort

WHAT IT CANNOT READ, AND SAYS SO
--------------------------------
  * `"*"` and embedded resources (`inventory:inventory_id(wine_name)`) name no
    column of THIS table; the embed needs the FK graph and is skipped.
  * a dotted filter (`inventory.wine_name`) is an embedded filter; skipped.
  * a select or table name that is a runtime value (an f-string, a variable)
    is counted as UNREADABLE and ceilinged below -- never read as "no bad
    columns here".
  * a table the migrations do not declare (a view, or a missing relation) is
    skipped: relation-level absence is check_queried_tables_exist.py's job.
  * write payloads (`.insert({...})`) are not checked here.

The migration parse is `declared_columns()` from check_order_capture_contract.py,
loaded by path, so the repo keeps exactly one migration parser.

EXIT CODES
    0  every named column exists, or is on the shrink-only debt list
    1  a read names a column no migration declares, or the debt list is stale
    2  CANNOT CHECK -- the root, the shared parser or the parse itself is gone
"""
from __future__ import annotations

import ast
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

MIGRATIONS = "supabase/migrations"
ROOT = "services/agent-orchestrator"
EXCLUDED_DIRS = {"tests", "demo", "venv", ".venv", "__pycache__", "node_modules"}

# Floors catch total collapse (a parse that silently stopped seeing chains),
# not drift. Measured 2026-10-09 on 31152ab34 plus this fix: 735 chains.
MIN_TABLES_WITH_COLUMNS = 150
MIN_CHAINS = 200

# Reads whose column list or table name is a runtime value. May shrink freely;
# raising it is a deliberate act, because each one is a read nobody checks.
# Measured 41 on 2026-10-09 (mostly f-string selects and `.table(table_name)`).
UNREADABLE_CEILING = 41

FILTER_METHODS = {
    "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is_", "in_",
    "contains", "contained_by", "overlaps", "order", "not_",
}
IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


# ---------------------------------------------------------------------------
# KNOWN_BAD -- the shrink-only debt ratchet. NOT approved: reads already broken
# when this guard landed (2026-10-09), recorded so it can block the NEXT one.
# Keyed `<file under services/agent-orchestrator>::<table>.<column>`, so a debt
# excuses that one file and the same phantom in any other file still fails.
# Each is out of this lane's scope (sim ledger S75). An entry the
# schema now declares, or that nothing reads any more, FAILS the guard: the
# only way to touch this list is to make it shorter.
# ---------------------------------------------------------------------------
KNOWN_BAD: dict[str, str] = {
    "agents/email_intel_agent.py::providers.email": "Column is contact_email (F-535).",
    "agents/email_intel_agent.py::provider_contacts.restaurant_id": "No house column (F-535).",
    "agents/email_parsing_agent.py::procurement_orders.wine_name": (
        "Name lives on restaurant_inventory (F-454/F-455, fix branch unmerged)."
    ),
    "agents/email_parsing_agent.py::procurement_orders.notes": "No such column.",
    "agents/provider_communication_agent.py::restaurant_feature_flags.auto_send_enabled": (
        "No such column; the auto-send gate reads nothing."
    ),
    "api/admin_routes.py::master_wine_library.restaurant_id": "Global library, no house column.",
    "services/wine_matcher.py::master_wine_library.wine_type": "No such column.",
    "scripts/seed_master_wine_library.py::master_wine_library.wine_type": "No such column.",
    "api/analytics_routes.py::master_wine_library_submissions.master_wine_id": (
        "Column is matched_master_id."
    ),
    "jobs/trend_tasks.py::master_wine_library_submissions.master_wine_id": (
        "Column is matched_master_id."
    ),
    "api/health_routes.py::saga_state.id": "Key is saga_id.",
    "core/database.py::procurement_conversations.paused_at": "No such column.",
    "core/database.py::procurement_conversations.type": "No such column.",
    "core/database.py::procurement_conversations.display_name": "No such column.",
    "core/database.py::procurement_conversations.manager_approval_status": "Column is status.",
    "core/notifications.py::restaurants.owner_id": "No such column.",
    "jobs/recrawl_tasks.py::restaurant_directory.name": "Column is restaurant_name.",
}


def _load_shared(root: Path):
    path = root / "scripts" / "check_order_capture_contract.py"
    if not path.is_file():
        raise CannotCheck(f"{path} is missing; the shared migration parse is gone")
    try:
        spec = importlib.util.spec_from_file_location("_occ_shared_agents", path)
        if spec is None or spec.loader is None:
            raise CannotCheck(f"{path} could not be loaded as a module")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:  # noqa: BLE001 - a stray SystemExit must not pass as 0
        raise CannotCheck(f"{path} would not import: {e!r}") from e
    for fn in ("declared_columns", "CannotCheck"):
        if not hasattr(mod, fn):
            raise CannotCheck(f"{path} no longer exports {fn}")
    return mod


def _str(node: ast.AST, consts: dict[str, str]) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name) and node.id in consts:
        return consts[node.id]
    return None


def _columns_in_select(text: str) -> tuple[list[str], int]:
    """(top-level column names, count of tokens not understood)."""
    parts, depth, seg = [], 0, ""
    for c in text:
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        if c == "," and depth == 0:
            parts.append(seg)
            seg = ""
        else:
            seg += c
    parts.append(seg)
    named, puzzling = [], 0
    for raw in parts:
        tok = raw.strip()
        if not tok or tok == "*" or "(" in tok:
            continue  # `*`, or an embedded resource: needs the FK graph
        if ":" in tok and "::" not in tok:
            tok = tok.split(":")[-1].strip()  # alias:column
        tok = tok.split("::")[0].split("!")[0].split("->")[0].strip()
        if not tok or tok == "*":
            continue
        if not IDENT_RE.match(tok):
            puzzling += 1
            continue
        named.append(tok)
    return named, puzzling


def _chain_root(node: ast.AST, consts: dict[str, str], vars_: dict[str, str]):
    """Walk `.a().b().c()` down to its root. Returns (table | None, unreadable)."""
    while True:
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "table":
                if not node.args:
                    return None, True
                name = _str(node.args[0], consts)
                return (name, name is None)
            node = node.func.value
            continue
        if isinstance(node, ast.Attribute):
            node = node.value
            continue
        if isinstance(node, ast.Name) and node.id in vars_:
            return vars_[node.id], False
        return None, False


def _sources(root: Path) -> list[tuple[str, str]]:
    base = root / ROOT
    if not base.is_dir():
        raise CannotCheck(f"{ROOT} is not a directory under {root}")
    out = []
    for p in sorted(base.rglob("*.py")):
        rel = p.relative_to(base)
        if any(part in EXCLUDED_DIRS for part in rel.parts[:-1]):
            continue
        if rel.name.startswith("test_"):
            continue
        out.append((str(p.relative_to(root)), p.read_text(encoding="utf-8")))
    return out


def collect(root: Path):
    shared = _load_shared(root)
    try:
        cols = shared.declared_columns(root)
    except shared.CannotCheck as e:
        raise CannotCheck(str(e)) from e
    if len(cols) < MIN_TABLES_WITH_COLUMNS:
        raise CannotCheck(f"parsed only {len(cols)} tables from {MIGRATIONS}")

    findings: list[str] = []
    seen: set[str] = set()
    chains = unreadable = 0

    for rel, src in _sources(root):
        try:
            tree = ast.parse(src, filename=rel)
        except SyntaxError as e:
            raise CannotCheck(f"{rel} does not parse: {e}") from e
        consts = {
            t.id: n.value.value
            for n in tree.body
            if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant)
            and isinstance(n.value.value, str)
            for t in n.targets
            if isinstance(t, ast.Name)
        }
        # Variables assigned from a table chain, e.g. `q = sb.table("t").select(..)`
        # then `q = q.eq(..)`. Tracked per file in source order: good enough for
        # the shapes this tree uses, and a miss only under-reports.
        vars_: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                t = node.targets[0]
                if isinstance(t, ast.Name):
                    table, _ = _chain_root(node.value, consts, vars_)
                    if table:
                        vars_[t.id] = table

        def report(table: str, col: str, line: int, how: str) -> None:
            if col in cols[table]:
                return
            key = f"{rel[len(ROOT) + 1:]}::{table}.{col}"
            seen.add(key)
            if key in KNOWN_BAD:
                return
            findings.append(
                f"{rel}:{line} {how} {table}.{col}, which no migration in "
                f"{MIGRATIONS} declares. PostgREST answers 42703 and fails the WHOLE "
                "query. Name the column the table actually has."
            )

        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            method = node.func.attr
            if method != "select" and method not in FILTER_METHODS:
                continue
            table, blind = _chain_root(node.func.value, consts, vars_)
            if blind:
                unreadable += 1
                continue
            if table is None or table not in cols:
                continue
            if not node.args:
                continue
            chains += 1
            text = _str(node.args[0], consts)
            if text is None:
                unreadable += 1
                continue
            if method == "select":
                named, puzzling = _columns_in_select(text)
                unreadable += puzzling
                for c in named:
                    report(table, c, node.lineno, "selects")
            else:
                col = text.strip()
                if "." in col:
                    continue  # embedded filter: inventory.wine_name
                col = col.split("->")[0]
                if not IDENT_RE.match(col):
                    unreadable += 1
                    continue
                report(table, col, node.lineno, f".{method}() on")
    return findings, seen, chains, unreadable, cols


def run(root: Path) -> tuple[int, list[str], str]:
    findings, seen, chains, unreadable, cols = collect(root)
    if chains < MIN_CHAINS:
        raise CannotCheck(f"only {chains} table chains found (floor {MIN_CHAINS})")
    if unreadable > UNREADABLE_CEILING:
        findings.append(
            f"{unreadable} reads name their table or columns at runtime, above the "
            f"ceiling of {UNREADABLE_CEILING}. Use a literal, or raise the ceiling "
            "on purpose."
        )
    for entry in KNOWN_BAD:
        table, _, col = entry.partition("::")[2].partition(".")
        if table in cols and col in cols[table]:
            findings.append(f"KNOWN_BAD lists {entry}, which the schema now declares. Delete it.")
        elif entry not in seen:
            findings.append(f"KNOWN_BAD lists {entry}, which nothing reads any more. Delete it.")
    summary = f"{chains} chains, {unreadable} unreadable, {len(KNOWN_BAD)} debt entries"
    return (1 if findings else 0), findings, summary


def main() -> int:
    try:
        code, findings, summary = run(Path.cwd())
    except CannotCheck as e:
        print(f"FAIL (exit 2) -- CANNOT CHECK: {e}")
        return 2
    if code:
        print(f"FAIL -- {len(findings)} problem(s) [{summary}]:")
        for f in findings:
            print(f"  - {f}")
        return 1
    print(f"PASS -- every column the agents name is declared by {MIGRATIONS} [{summary}]")
    return 0


# ---------------------------------------------------------------------------
# --self-test: the failure path must have run at least once.
# ---------------------------------------------------------------------------
AGENT = f"{ROOT}/agents/a.py"


def _fixture(tmp: Path) -> Path:
    root = tmp / "repo"
    (root / MIGRATIONS).mkdir(parents=True)
    (root / "scripts").mkdir()
    (root / ROOT / "agents").mkdir(parents=True)
    (root / ROOT / "tests").mkdir()
    real = Path(__file__).resolve().parent / "check_order_capture_contract.py"
    (root / "scripts" / real.name).write_text(real.read_text(encoding="utf-8"))
    filler = "".join(
        f"create table public.t{i} (id uuid not null);\n"
        for i in range(MIN_TABLES_WITH_COLUMNS + 5)
    )
    (root / MIGRATIONS / "20260101000000_base.sql").write_text(
        filler
        + "create table public.providers (id uuid not null, name text, personality_notes text);\n"
        "create table public.debt_table (id uuid not null);\n"
    )
    bulk = "".join(
        f'    sb.table("providers").select("id, name").eq("id", x).order("name")\n'
        for _ in range(MIN_CHAINS)
    )
    (root / AGENT).write_text(
        "def f(sb, x):\n"
        '    sb.table("providers").select("name, personality_notes").eq("id", x).execute()\n'
        '    q = sb.table("providers").select("*, inventory:inventory_id(wine_name)")\n'
        '    q = q.eq("inventory.wine_name", x)\n'
        '    sb.table("debt_table").select("zzz_debt")\n' + bulk
    )
    # Tests may mock anything; they are not reads.
    (root / ROOT / "tests" / "test_a.py").write_text(
        'def t(sb):\n    sb.table("providers").select("ai_personality_notes")\n'
    )
    return root


def self_test() -> int:
    failures: list[str] = []
    real_debt = dict(KNOWN_BAD)
    KNOWN_BAD.clear()
    KNOWN_BAD["agents/a.py::debt_table.zzz_debt"] = "synthetic, self-test only"
    try:
        with tempfile.TemporaryDirectory() as td:
            root = _fixture(Path(td))
            agent = root / AGENT
            clean = agent.read_text()

            def expect(label: str, want: int) -> None:
                try:
                    got = run(root)[0]
                except CannotCheck:
                    got = 2
                if got != want:
                    failures.append(f"{label}: exit {got}, expected {want}")

            expect("clean tree", 0)
            # A. the F-533 defect, put back: a phantom in a select list
            agent.write_text(clean.replace("name, personality_notes", "name, ai_personality_notes"))
            expect("phantom select column", 1)
            # B. a phantom filter, through a tracked variable
            agent.write_text(clean.replace('q.eq("inventory.wine_name"', 'q.eq("wine_name"'))
            expect("phantom filter via a variable", 1)
            # C. stale debt: the read is gone
            agent.write_text(clean.replace('    sb.table("debt_table").select("zzz_debt")\n', ""))
            expect("stale debt entry", 1)
            # D. a debt excuses its own file only: the same phantom elsewhere fails
            other = root / ROOT / "agents" / "b.py"
            other.write_text('def g(sb):\n    sb.table("debt_table").select("zzz_debt")\n')
            expect("debt read from another file", 1)
            other.unlink()
            # E. the parse collapsed: no chains at all
            agent.write_text("x = 1\n")
            expect("no chains", 2)
            agent.write_text(clean)
            expect("restored", 0)
    finally:
        KNOWN_BAD.clear()
        KNOWN_BAD.update(real_debt)
    if failures:
        print("SELF-TEST FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("SELF-TEST PASS -- a phantom select, a phantom filter, stale debt, debt out of its file and a blind parse all fail")
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else main())
