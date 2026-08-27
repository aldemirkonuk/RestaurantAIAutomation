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
import sys
from collections import defaultdict

GATEWAY = "apps/api-gateway/src"
PYTHON_ROOT = "services/agent-orchestrator"

TS_TASK_TYPE = re.compile(r'taskType:\s*"([a-z_0-9]+)"')
TS_RECORDER = re.compile(r"nfVerdicts\.(record|recordForEvent)\s*\(")

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


def scan_gateway() -> dict[str, list[str]]:
    """task_type -> files that emit it without any verdict recorder."""
    ungraded: dict[str, list[str]] = defaultdict(list)
    for dirpath, _dirs, files in os.walk(GATEWAY):
        for name in files:
            if not name.endswith(".ts") or name.endswith(".spec.ts"):
                continue
            path = os.path.join(dirpath, name)
            text = open(path, encoding="utf-8", errors="ignore").read()
            types = set(TS_TASK_TYPE.findall(text))
            if not types:
                continue
            if TS_RECORDER.search(text):
                continue
            for t in types:
                ungraded[t].append(path)
    return ungraded


def scan_python() -> dict[str, list[str]]:
    """task_type -> `log(...)` call sites with no outcome_basis in context."""
    ungraded: dict[str, list[str]] = defaultdict(list)
    for dirpath, _dirs, files in os.walk(PYTHON_ROOT):
        if any(p in dirpath for p in ("__pycache__", "/tests", ".venv")):
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(dirpath, name)
            try:
                tree = ast.parse(open(path, encoding="utf-8", errors="ignore").read())
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

    gateway = scan_gateway()
    python = scan_python()

    emitted = set(gateway) | set(python)
    # Everything that emits anywhere, so a dead exemption can be spotted.
    all_types = set()
    for dirpath, _dirs, files in os.walk(GATEWAY):
        for name in files:
            if name.endswith(".ts") and not name.endswith(".spec.ts"):
                all_types |= set(
                    TS_TASK_TYPE.findall(
                        open(
                            os.path.join(dirpath, name),
                            encoding="utf-8",
                            errors="ignore",
                        ).read()
                    )
                )
    for dirpath, _dirs, files in os.walk(PYTHON_ROOT):
        if any(p in dirpath for p in ("__pycache__", "/tests", ".venv")):
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            text = open(
                os.path.join(dirpath, name), encoding="utf-8", errors="ignore"
            ).read()
            all_types |= set(re.findall(r'task_type\s*=\s*"([a-z_0-9]+)"', text))

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
