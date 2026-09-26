#!/usr/bin/env python3
"""
Guard: every task type either carries a doneability verdict, or is named as
knowingly ungraded (OD-59, ADR 0029 P3.0).

WHAT `call_level_v0` ACTUALLY MEANS
-----------------------------------
"The HTTP request returned 200 and was not truncated." Nothing about whether the
agent did the job. On 2026-08-27 the gateway emitted SEVEN task types and
exactly ONE carried a real verdict, so six of them recorded a garbage response
as a success. That is the defect this guard stops from coming back.

ADR 0029 makes it the P3.0 exit criterion: an emitting task type carries a basis
better than `call_level_v0`, or it appears in EXEMPT below with a reason. The
second half is the honest half — several task types genuinely need a human
rubric, and pretending otherwise would be a fabricated verdict, which ADR 0020
forbids. What is not allowed is a task type that is ungraded because nobody
looked.

HOW IT CHECKS
-------------
  Gateway (TS)  a file emitting `taskType: "x"` must also record a verdict
                (`nfVerdicts.record` / `recordForEvent`). Verdicts are sidecar
                rows keyed to the event, so the recorder lives with the caller
                that can grade its own output.

  Python        parsed with `ast`, per `SpendLogger.log(...)` CALL — not per
                file. A file with three emits where one is stamped must not
                pass because the string appears somewhere in it.

EXEMPTIONS SHRINK, THEY DO NOT GROW
-----------------------------------
Every entry names its reason. An exemption for a task type that no longer
emits is itself an error: dead entries hide the fact that the list stopped
being read.

Exit codes:  0 pass  |  1 an ungraded task type  |  2 cannot check
"""
import ast
import os
import re
import subprocess
import sys
from collections import defaultdict

GATEWAY = "apps/api-gateway/src"
PYTHON_ROOT = "services/agent-orchestrator"

TS_TASK_TYPE = re.compile(r'taskType:\s*"([a-z_0-9]+)"')
TS_RECORDER = re.compile(r"nfVerdicts\.(record|recordForEvent)\s*\(")

# Corpus floors (same idea as check_a_count_is_recorded.py's MIN_CORPUS): far
# below today's counts, far above zero. Below them the listing is not this
# repo's tree, and any verdict would be about nothing.
MIN_TS_FILES = 100
MIN_PY_FILES = 50

# ---------------------------------------------------------------------------
# Knowingly ungraded, with the reason. Shrink-only.
#
# The census these come from is `.planning/04-specs/OD-59-VERDICT-CENSUS.md`;
# the section is cited so a reader can check the reasoning rather than trust it.
# ---------------------------------------------------------------------------
EXEMPT: dict[str, str] = {
    # ---- genuine human rubric: no machine ground truth exists (census §3.11)
    "correction_preference": "learned manager preference — correctness is the manager's opinion (census §3.11)",
    "summarization": "summary quality is a human rubric; shape alone would overstate it (census §3.11)",
    "profile_extraction": "vendor profile fields have no oracle to check against (census §3.11)",
    "book_text_extraction": "reference-book OCR has no ground truth in the tree (census §3.11)",
    "book_vision_extraction": "as above, vision path (census §3.11)",
    # ---- ontology_v1 is UNREACHABLE here, and not for want of plumbing.
    # The census filed these as "deferred: needs a wine_id join". Checked site by
    # site 2026-08-27, four are blocked on CAUSALITY, not scheduling: the wine is
    # the OUTPUT of the call, so there is no wine_id at call time to thread. The
    # other three extract MANY wines per call, so a per-wine verdict has no
    # single event to attach to and choosing one would be a fabrication.
    # `wine_enrichment` IS graded on ontology_v1 — it enriches a wine that
    # already exists, which is exactly why it can be. See
    # services/ontology_verdict.py.
    #
    # Only `field_extraction` needs an entry: the other six already carry
    # `parse_v1` from OD-75, so they are graded — just not as WELL as ontology_v1
    # would grade them, and this list is not the place to record that. The guard
    # rejects an exemption for something already graded, which is how these three
    # came off again after I first wrote them in.
    "field_extraction": "the wine does not exist yet — wine_id is this call's output, not an input",
    "vision_extraction": "one call extracts many wines — no single wine_id to attach a per-wine verdict to",
    "text_extraction": "one call extracts many wines — as above",
    "crawl_extraction": "one call extracts many wines — as above",
    "invoice_extraction": "ground truth exists but on a disjoint path that emits no NF row (census §3.9)",
    # ---- a defect, not a rubric: named so it is not mistaken for one
    "embedding": "dimension-only check today, and a silent hash fallback means failure is UNOBSERVABLE — fix the missing failure emit before grading (census §3.10)",
    # ---- not an NF task type at all
    "retrieval_document": "FALSE POSITIVE — this is Gemini's own `genai.embed_content(task_type=...)` parameter, not ours (census §0.2)",
}


def _git_tracked_files(dirs: list[str]) -> list[str]:
    """Tracked paths under `dirs`, repo-relative. Raises RuntimeError if git
    cannot answer.

    `git ls-files` rather than `os.walk`, on purpose (same move as
    check_no_conflict_markers.py's `list_tracked` and
    check_fk_repoint_by_referenced_column.py's `_git_tracked_files`): a local,
    gitignored `services/agent-orchestrator/venv` sits directly under
    PYTHON_ROOT, and a filesystem walk has no way to tell vendored
    third-party Python -- which may not even parse under this repo's grammar
    assumptions, and can carry its own `task_type=` look-alikes -- from this
    repo's own agents. It is not committed, so it must never be part of what
    this guard grades.
    """
    try:
        proc = subprocess.run(
            ["git", "ls-files", "-z", "--"] + list(dirs),
            capture_output=True,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError(f"could not run git ls-files: {exc}") from exc
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git ls-files exited {proc.returncode}: {err}")
    return [p for p in proc.stdout.decode("utf-8", "replace").split("\0") if p]


def _read(path: str) -> str:
    """Working-tree content of a tracked path. Raises RuntimeError (CANNOT
    CHECK) if it cannot be read.

    The path list comes from the index, the content from the working copy, so
    a file that is tracked but deleted (or unreadable) on disk is listed and
    then fails to open. That is a checkout this guard cannot answer for --
    exit 2, never an uncaught traceback that exits 1 and reads as REGRESSED.
    """
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            return fh.read()
    except OSError as exc:
        raise RuntimeError(f"unreadable tracked file {path}: {exc}") from exc


def gateway_files() -> list[str]:
    return [
        p for p in _git_tracked_files([GATEWAY])
        if p.endswith(".ts") and not p.endswith(".spec.ts")
    ]


def python_files() -> list[str]:
    return [
        p for p in _git_tracked_files([PYTHON_ROOT])
        if p.endswith(".py") and not any(x in p for x in ("__pycache__", "/tests"))
    ]


def scan_gateway(files: list[str]) -> dict[str, list[str]]:
    """task_type -> files that emit it without any verdict recorder."""
    ungraded: dict[str, list[str]] = defaultdict(list)
    for path in files:
        text = _read(path)
        types = set(TS_TASK_TYPE.findall(text))
        if not types:
            continue
        if TS_RECORDER.search(text):
            continue
        for t in types:
            ungraded[t].append(path)
    return ungraded


def scan_python(files: list[str]) -> dict[str, list[str]]:
    """task_type -> `log(...)` call sites with no outcome_basis in context."""
    ungraded: dict[str, list[str]] = defaultdict(list)
    for path in files:
        try:
            tree = ast.parse(_read(path))
        except SyntaxError:
            print(f"CANNOT CHECK — {path} does not parse")
            sys.exit(2)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            kwargs = {k.arg: k.value for k in node.keywords if k.arg}
            tt = kwargs.get("task_type")
            if not isinstance(tt, ast.Constant) or not isinstance(tt.value, str):
                continue
            ctx = kwargs.get("context")
            stamped = False
            if isinstance(ctx, ast.Dict):
                stamped = any(
                    isinstance(k, ast.Constant) and k.value == "outcome_basis"
                    for k in ctx.keys
                )
            if not stamped:
                ungraded[tt.value].append(f"{path}:{node.lineno}")
    return ungraded


def main() -> int:
    if not os.path.isdir(GATEWAY) or not os.path.isdir(PYTHON_ROOT):
        print("CANNOT CHECK — run from the repository root")
        return 2

    try:
        ts_files = gateway_files()
        py_files = python_files()
        # Floor, by design rather than by accident: an empty corpus must be
        # CANNOT CHECK. Without this, zero files would reach a verdict only
        # because every EXEMPT entry turns "dead" -- a FAIL that points the
        # reader at the exemption list instead of at the checkout.
        if len(ts_files) < MIN_TS_FILES or len(py_files) < MIN_PY_FILES:
            print(
                f"CANNOT CHECK — corpus is {len(ts_files)} gateway .ts and "
                f"{len(py_files)} orchestrator .py tracked files (minimum "
                f"{MIN_TS_FILES} / {MIN_PY_FILES}); that is not this repo"
            )
            return 2

        gateway = scan_gateway(ts_files)
        python = scan_python(py_files)

        emitted = set(gateway) | set(python)
        # Everything that emits anywhere, so a dead exemption can be spotted.
        all_types = set()
        for path in ts_files:
            all_types |= set(TS_TASK_TYPE.findall(_read(path)))
        for path in py_files:
            all_types |= set(
                re.findall(r'task_type\s*=\s*"([a-z_0-9]+)"', _read(path))
            )
    except RuntimeError as exc:
        print(f"CANNOT CHECK — {exc}")
        return 2

    if not all_types:
        print("CANNOT CHECK — no task type emits anywhere; the guard is looking at nothing")
        return 2

    failures = {t: v for t, v in {**gateway, **python}.items() if t not in EXEMPT}
    dead = sorted(t for t in EXEMPT if t not in all_types)
    # An exemption for a task type that IS graded is not harmless: it says the
    # thing cannot be graded when it demonstrably can, and the next reader
    # believes it. Same shrink-only handshake the schema guard uses.
    redundant = sorted(t for t in EXEMPT if t in all_types and t not in emitted)

    graded = len(all_types) - len(emitted)
    print(
        f"== Task types: {len(all_types)} emit, {graded} carry a verdict, "
        f"{len(emitted & set(EXEMPT))} knowingly exempt, {len(failures)} ungraded"
    )

    if dead:
        print("\n== DEAD EXEMPTIONS — these task types no longer emit anywhere")
        for t in dead:
            print(
                f"   {t}  — delete the entry; a list nobody prunes is a list nobody reads"
            )

    if redundant:
        print("\n== REDUNDANT EXEMPTIONS — these ARE graded now")
        for t in redundant:
            print(f"   {t}  — strike it off; claiming it cannot be graded is now false")

    if failures:
        print(f"\n== UNGRADED ({len(failures)})")
        for t in sorted(failures):
            print(f"   {t}")
            for site in failures[t][:4]:
                print(f"      {site}")
        print(
            "\nFAIL — a task type records `call_level_v0` and nothing else, which\n"
            "   asserts only that the HTTP request returned 200.\n"
            "   Either grade it (a verdict recorder in the gateway, an\n"
            "   `outcome_basis` in the Python context), or add it to EXEMPT with\n"
            "   the reason it cannot be graded. 'Nobody looked' is not a reason."
        )
        return 1

    if dead or redundant:
        print(
            "\nFAIL — the exemption list disagrees with the code. It shrinks; it\n"
            "   does not drift. Strike off what is listed above."
        )
        return 1

    print("PASS — every emitting task type is graded or knowingly exempt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
