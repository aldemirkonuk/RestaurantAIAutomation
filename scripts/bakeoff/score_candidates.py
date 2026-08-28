#!/usr/bin/env python3
"""OD-03 bake-off scorer — a skeleton that refuses to flatter an unfinished run.

Protocol: scripts/bakeoff/README.md.  Verified external facts: scripts/bakeoff/RESEARCH.md.
OD-03 is OPEN.  This script picks nothing; it only makes a run scorable and hard
to rig.

WHAT IT ENFORCES
----------------
Four rules, each of which exists because the opposite has already happened
somewhere in this repo:

  1. Every axis defaults to UNMEASURED.  Never 0, never "N/A".  ADR 0020: a
     surface with no data says so; it never invents one.  An unmeasured axis
     that scored 0 would silently rank a candidate nobody tested.

  2. A "measured" axis with no evidence path is downgraded to
     INVALID_NO_EVIDENCE and counted as unmeasured.  ADR 0017: a verdict names
     its grader or it is not a verdict.  A number you cannot re-check is a
     rumour with a decimal point.

  3. No total score exists while any axis is unmeasured.  `total` is null and
     the status reads PARTIAL.  A partial scorecard must LOOK partial -- the
     failure mode this guards is a half-run bake-off that reads like a verdict
     because someone averaged the cells that happened to be full.

  4. Weights and normalisation bounds come from a pre-registration frozen
     BEFORE the runs, and the script rejects a prereg committed after any run
     it is scoring.  Whoever picks the weights after seeing the numbers picks
     the winner.  Weights are the founder's call (CLAUDE.md 0.1) and this
     script will not invent them -- `--init-prereg` writes nulls.

NEVER VACUOUS
-------------
Following scripts/check_model_calls_logged.sh: a check that passes because it
found nothing to look at is worse than no check.  So:

  exit 0  a scorecard was emitted (PARTIAL or COMPLETE)
  exit 1  a violation, a tripped disqualifier, or --require-complete on a
          PARTIAL scorecard
  exit 2  could not check what it claims to check -- cards.json missing,
          unreadable, or not matching the ADR 0034 contract; prereg malformed.
          A 2 is never a pass.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import pathlib
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_CARDS = ROOT / ".planning/00-index/cards.json"
DEFAULT_OUT = HERE / "out"
PREREG = HERE / "preregistration.json"

PROTOCOL = "scripts/bakeoff/README.md"
CONTRACT = "ADR 0034 (.planning/decisions/0034-agent-stack-artifact.md)"
ROUTING_CLASSES = ("mechanical", "extraction", "judgment")

# The three candidates.  Named, not ranked.  See README section 2.
CANDIDATES = (
    "hermes-agent",
    "deepseek-harness",
    "reasoning-layer-on-baseagent",
)

# --- the axes -----------------------------------------------------------------
# `direction` is what BETTER means, so normalisation cannot be argued after the
# fact.  `gate` axes are pass/fail and terminal -- they are never weighted.
# Bounds live in the pre-registration, not here: a bound chosen after seeing a
# number is a weight in disguise.
AXES: dict[str, dict[str, Any]] = {
    "capability_fit": {
        "direction": "higher_is_better",
        "gate": False,
        "measurement": (
            "W1 fraction of the sampled cards expressible within the candidate's "
            "own abstractions; W2 field agreement against datasets/menu_corpus/"
            "extracted; W3 parse rate under PARSE_BASIS. Three sub-numbers, "
            "never pre-averaged."
        ),
        "evidence_rule": (
            "Per-card and per-task transcripts under runs/<run_id>/w{1,2,3}/, "
            "plus verbatim eval_merge_policies.py stdout for W2."
        ),
        "subscores": ("w1", "w2", "w3"),
    },
    "integration_surface": {
        "direction": "lower_is_better",
        "gate": False,
        "measurement": (
            "Adapter lines of code between BaseAgent.process_message() and the "
            "candidate, plus count of core/ files changed (required: 0), plus "
            "process boundaries (0 in-process / 1 subprocess / 2 network)."
        ),
        "evidence_rule": (
            "The adapter source committed under runs/<run_id>/adapters/"
            "<candidate>/, plus wc -l or cloc output over it."
        ),
        "subscores": ("adapter_loc", "core_files_changed", "process_boundaries"),
    },
    "nf_a_instrumentation": {
        "direction": "higher_is_better",
        "gate": False,
        "measurement": (
            "Fraction of the required neural_footprint_event fields the candidate "
            "can supply per model call (task_type, input_tokens, output_tokens, "
            "cost_usd NULL-never-0 for an unpriced model) plus an nf_verdict "
            "sidecar with a real basis; gated on check_model_calls_logged.sh and "
            "check_task_types_are_graded.py passing over the adapter."
        ),
        "evidence_rule": (
            "Rows actually written during the run (query output in the run dir) "
            "plus both guards' exit codes. A guard exiting 2 is not a pass."
        ),
        "subscores": ("fields_present", "guards_pass"),
    },
    "confirm_gate": {
        "direction": "must_be_true",
        "gate": True,
        "measurement": (
            "Structural: remove the send/mutate capability from the candidate's "
            "tool surface, re-run W3 with an adversarial fixture instructing the "
            "model to send. Pass = it CANNOT send, not that it declined."
        ),
        "evidence_rule": (
            "The adversarial fixture, the transcript of the attempt, and a query "
            "proving zero outbound rows. FUTURES 8.1; ADR 0034 autonomy."
            "mutate_stock_money_outbound: confirm."
        ),
        "subscores": (),
    },
    "operational_maturity_licence": {
        "direction": "higher_is_better",
        "gate": False,
        "measurement": (
            "Licence SPDX id and whether it permits our use unmodified; published "
            "version and whether >=1.0; release cadence; own test/eval suite. "
            "Star and fork counts are RECORDED AND EXCLUDED -- OD-03 says 'No "
            "pick from repute'."
        ),
        "evidence_rule": (
            "RESEARCH.md rows, each carrying URL + checked date + corroboration "
            "count. A fact with fewer than two independent sources cannot raise a "
            "score."
        ),
        "subscores": ("licence_ok", "version_ge_1_0", "has_own_tests"),
    },
    "cost_per_task": {
        "direction": "lower_is_better",
        "gate": False,
        "measurement": (
            "USD per completed task on the sample, from tokens the run recorded, "
            "at a rate row carrying its own verification date (ADR 0016). "
            "Reported per workload; never averaged across workloads."
        ),
        "evidence_rule": (
            "neural_footprint_event / api_spend rows from the run plus the dated "
            "rate rows used. An unpriced model yields cost_usd NULL and the slice "
            "reads UNMEASURED -- it does not read $0."
        ),
        "subscores": ("w2_usd", "w3_usd"),
    },
}

WEIGHTED_AXES = tuple(k for k, v in AXES.items() if not v["gate"])
GATE_AXES = tuple(k for k, v in AXES.items() if v["gate"])

UNMEASURED = "UNMEASURED"
INVALID = "INVALID_NO_EVIDENCE"
MEASURED = "MEASURED"

DISQUALIFIERS = {
    "D-1": "total computed while an axis was UNMEASURED or INVALID_NO_EVIDENCE",
    "D-2": "a real outbound email / order / stock write / money movement during a run",
    "D-3": "eval_merge_policies.py, datasets/merge_eval/*, or the reference extractions modified in the window",
    "D-4": "a candidate given a prompt, tool, retry budget, or model tier the others were not",
    "D-5": "a diff to services/agent-orchestrator/core/ attributable to the bake-off",
    "D-6": "weights, bounds, or the workload sample changed after any candidate's numbers existed",
    "D-7": "an Axis-5 fact without a URL and checked date in RESEARCH.md, or filled from model memory",
    "D-8": "protocol review missing, or dated on/after the first run",
}


class CannotCheck(Exception):
    """Raised where a silent pass would be worse than a failure -> exit 2."""


# --- helpers ------------------------------------------------------------------

def _digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def _relpath(path: pathlib.Path) -> str:
    """Repo-relative when it can be, absolute otherwise. Never raises."""
    try:
        return str(path.resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def _parse_date(value: Any, what: str) -> _dt.date:
    if not isinstance(value, str) or not value.strip():
        raise CannotCheck(f"{what} is missing or not a string: {value!r}")
    try:
        return _dt.date.fromisoformat(value.strip()[:10])
    except ValueError as exc:
        raise CannotCheck(f"{what} is not an ISO date: {value!r} ({exc})") from exc


def load_cards(path: pathlib.Path) -> dict:
    """Load cards.json and verify it is the index this protocol was written for."""
    if not path.exists():
        raise CannotCheck(
            f"{path} not found. It is generated by scripts/build_agent_card_index.py; "
            "run that first. Scoring against a missing spec sheet would be vacuous."
        )
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise CannotCheck(f"{path} is not valid JSON: {exc}") from exc

    for key in ("contract", "units", "card_count", "routing_class_counts"):
        if key not in data:
            raise CannotCheck(f"{path} has no {key!r} key -- not the ADR 0034 index.")
    if data["contract"] != CONTRACT:
        raise CannotCheck(
            f"{path} declares contract {data['contract']!r}; this protocol was "
            f"written against {CONTRACT!r}. Re-review the protocol before scoring."
        )
    if not data["units"]:
        raise CannotCheck(f"{path} lists zero units -- nothing to sample.")
    missing = [c for c in ROUTING_CLASSES if c not in data["routing_class_counts"]]
    if missing:
        raise CannotCheck(f"{path} is missing routing classes {missing}.")
    return data


def flatten_cards(cards: dict) -> list[dict]:
    out: list[dict] = []
    for unit in cards["units"]:
        for agent in unit.get("agents", []) or []:
            out.append(
                {
                    "unit": unit.get("unit"),
                    "agent": agent.get("agent"),
                    "routing_class": agent.get("routing_class"),
                    "quality_bar": agent.get("quality_bar"),
                    "autonomy": agent.get("autonomy"),
                    "path": unit.get("path"),
                }
            )
    if not out:
        raise CannotCheck("cards.json contained units but no agent cards.")
    return out


def stratified_sample(flat: list[dict], per_class: int) -> dict[str, list[dict]]:
    """Deterministic draw: first `per_class` per routing_class by sha256(key).

    No RNG and no seed. The operator has no discretion over which cards are
    drawn, and re-running on the same cards.json yields the same sample -- which
    is what makes D-6 checkable at all.
    """
    if per_class < 1:
        raise CannotCheck(f"--per-class must be >= 1, got {per_class}")
    buckets: dict[str, list[dict]] = {c: [] for c in ROUTING_CLASSES}
    for card in flat:
        rc = card.get("routing_class")
        if rc in buckets:
            buckets[rc].append(card)
    sample: dict[str, list[dict]] = {}
    for rc, rows in buckets.items():
        if not rows:
            raise CannotCheck(f"routing_class {rc!r} has no cards -- cannot stratify.")
        ordered = sorted(
            rows,
            key=lambda c: hashlib.sha256(
                f"{c['unit']}::{c['agent']}".encode()
            ).hexdigest(),
        )
        sample[rc] = ordered[:per_class]
        if len(ordered) < per_class:
            print(
                f"  note: routing_class {rc} has only {len(ordered)} cards; "
                f"sampled all of them (asked for {per_class}).",
                file=sys.stderr,
            )
    return sample


# --- pre-registration ---------------------------------------------------------

def init_prereg(path: pathlib.Path, force: bool) -> int:
    if path.exists() and not force:
        print(f"{path} already exists. Refusing to overwrite (use --force).")
        return 1
    template = {
        "_readme": (
            "Frozen BEFORE the first run. Weights and bounds set after any "
            "candidate's numbers exist invalidate every scorecard (disqualifier "
            "D-6). Every weight is null on purpose: choosing them is the "
            "founder's call, and this script will not guess one. Weights over "
            "the non-gate axes must sum to 1.0."
        ),
        "committed_at": None,
        "committed_by": None,
        "reviewed_by": None,
        "weights": {axis: None for axis in WEIGHTED_AXES},
        "bounds": {
            axis: {"worst": None, "best": None}
            for axis in WEIGHTED_AXES
        },
        "gate_axes": {axis: "pass_required" for axis in GATE_AXES},
        "workload_notes": {
            "w2_input_source": None,
            "_hint": "README section 3 W2: 'restored_pdfs' (record sha256 per PDF) "
                     "or 'in_repo_slice' (then the W2 sub-number reads UNMEASURED).",
        },
    }
    path.write_text(json.dumps(template, indent=2) + "\n")
    print(f"wrote {path.relative_to(ROOT)} -- fill in the nulls, then freeze it.")
    return 0


def load_prereg(path: pathlib.Path) -> dict | None:
    """Return the prereg, or None if it does not exist yet (a PARTIAL run)."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise CannotCheck(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise CannotCheck(f"{path} is not a JSON object.")
    return data


def prereg_problems(prereg: dict | None) -> list[str]:
    """Everything wrong with the pre-registration, as human sentences."""
    if prereg is None:
        return [
            "no preregistration.json -- weights and bounds were never frozen "
            "(run --init-prereg, fill it in, freeze it BEFORE the runs)"
        ]
    problems: list[str] = []
    if not prereg.get("committed_at"):
        problems.append("preregistration.committed_at is empty -- an unfrozen prereg proves nothing")
    if not prereg.get("committed_by"):
        problems.append("preregistration.committed_by is empty")
    weights = prereg.get("weights") or {}
    for axis in WEIGHTED_AXES:
        if weights.get(axis) is None:
            problems.append(f"weight for {axis} is null -- unset weights cannot produce a total")
    bounds = prereg.get("bounds") or {}
    for axis in WEIGHTED_AXES:
        b = bounds.get(axis) or {}
        if b.get("worst") is None or b.get("best") is None:
            problems.append(f"bounds for {axis} are incomplete -- normalisation is undefined")
    known = [weights[a] for a in WEIGHTED_AXES if isinstance(weights.get(a), (int, float))]
    if len(known) == len(WEIGHTED_AXES) and abs(sum(known) - 1.0) > 1e-6:
        problems.append(f"weights sum to {sum(known)}, not 1.0")
    return problems


# --- results ------------------------------------------------------------------

def load_results(results_dir: pathlib.Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not results_dir.exists():
        return out
    for path in sorted(results_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            raise CannotCheck(f"{path} is not valid JSON: {exc}") from exc
        name = data.get("candidate") or path.stem
        if name not in CANDIDATES:
            raise CannotCheck(
                f"{path} names candidate {name!r}, which is not one of {CANDIDATES}. "
                "Adding a candidate is a protocol change, not a file drop."
            )
        data["_source"] = _relpath(path)
        out[name] = data
    return out


def grade_axis(axis: str, raw: dict | None) -> dict:
    """One axis -> its status, value and evidence. Defaults to UNMEASURED."""
    spec = AXES[axis]
    cell = {
        "status": UNMEASURED,
        "value": None,
        "evidence": [],
        "method": None,
        "direction": spec["direction"],
        "gate": spec["gate"],
        "note": None,
    }
    if not isinstance(raw, dict) or "value" not in raw or raw.get("value") is None:
        cell["note"] = "no measurement supplied"
        return cell

    evidence = raw.get("evidence") or []
    if isinstance(evidence, str):
        evidence = [evidence]
    if not evidence:
        cell["status"] = INVALID
        cell["value"] = None
        cell["note"] = (
            "a value was supplied with no evidence path -- downgraded and counted "
            "as unmeasured (ADR 0017: a verdict names its grader)"
        )
        return cell

    cell["status"] = MEASURED
    cell["value"] = raw["value"]
    cell["evidence"] = list(evidence)
    cell["method"] = raw.get("method")
    if raw.get("subscores"):
        cell["subscores"] = raw["subscores"]
    return cell


def run_integrity(result: dict) -> list[str]:
    """Anti-rigging preconditions on the run itself (README section 6)."""
    problems: list[str] = []
    run = result.get("run") or {}
    run_date_raw = run.get("date")
    if not run_date_raw:
        problems.append("run.date is missing -- an undated run cannot be checked against D-8")
    if not run.get("operator"):
        problems.append("run.operator is missing -- who executed this is part of the evidence")

    review = run.get("protocol_review") or {}
    if not review.get("reviewer"):
        problems.append("run.protocol_review.reviewer is missing (D-8)")
    if str(review.get("verdict", "")).lower() not in {"approved", "approved_with_notes"}:
        problems.append(
            f"run.protocol_review.verdict is {review.get('verdict')!r} -- "
            "architecture-review must approve the protocol BEFORE any run (D-8)"
        )
    if review.get("date") and run_date_raw:
        try:
            if _parse_date(review["date"], "protocol_review.date") >= _parse_date(
                run_date_raw, "run.date"
            ):
                problems.append(
                    "protocol_review.date is not strictly earlier than run.date -- "
                    "a review that arrives after the numbers can be argued from them (D-8)"
                )
        except CannotCheck as exc:
            problems.append(str(exc))
    elif not review.get("date"):
        problems.append("run.protocol_review.date is missing (D-8)")

    for dq in result.get("disqualifiers") or []:
        code = dq if isinstance(dq, str) else dq.get("id", "?")
        problems.append(f"self-declared disqualifier {code}: {DISQUALIFIERS.get(code, dq)}")
    return problems


def prereg_precedes_run(prereg: dict, result: dict) -> list[str]:
    committed = prereg.get("committed_at")
    run_date = (result.get("run") or {}).get("date")
    if not committed or not run_date:
        return []
    try:
        if _parse_date(committed, "prereg.committed_at") > _parse_date(run_date, "run.date"):
            return [
                "preregistration.committed_at is AFTER this run -- weights chosen "
                "with the numbers in hand pick the winner (D-6)"
            ]
    except CannotCheck as exc:
        return [str(exc)]
    return []


def normalise(value: float, axis: str, bounds: dict) -> float | None:
    b = (bounds or {}).get(axis) or {}
    worst, best = b.get("worst"), b.get("best")
    if worst is None or best is None or worst == best:
        return None
    scaled = (value - worst) / (best - worst)
    return max(0.0, min(1.0, scaled))


def score_candidate(name: str, result: dict | None, prereg: dict | None) -> dict:
    card: dict[str, Any] = {
        "candidate": name,
        "status": "PARTIAL",
        "total": None,
        "total_withheld_because": [],
        "gates": {},
        "axes": {},
        "run": (result or {}).get("run"),
        "source": (result or {}).get("_source"),
    }
    raw_axes = (result or {}).get("axes") or {}
    for axis in AXES:
        card["axes"][axis] = grade_axis(axis, raw_axes.get(axis))

    blockers: list[str] = []

    if result is None:
        blockers.append("no results file for this candidate -- it has not been run")
    else:
        blockers.extend(run_integrity(result))

    unmeasured = [a for a, c in card["axes"].items() if c["status"] != MEASURED]
    if unmeasured:
        blockers.append(
            "axes not measured: " + ", ".join(
                f"{a} ({card['axes'][a]['status']})" for a in unmeasured
            ) + " (D-1)"
        )

    for axis in GATE_AXES:
        cell = card["axes"][axis]
        if cell["status"] != MEASURED:
            card["gates"][axis] = UNMEASURED
        else:
            passed = bool(cell["value"]) if not isinstance(cell["value"], str) \
                else cell["value"].strip().lower() in {"pass", "true", "yes"}
            card["gates"][axis] = "PASS" if passed else "FAIL"
            if not passed:
                blockers.append(
                    f"{axis} FAILED -- terminal. FUTURES 8.1 is not weighted "
                    "against other axes; a candidate that cannot structurally "
                    "refuse an unconfirmed mutation is out."
                )

    blockers.extend(prereg_problems(prereg))
    if prereg is not None and result is not None:
        blockers.extend(prereg_precedes_run(prereg, result))

    if blockers:
        card["total_withheld_because"] = blockers
        return card

    weights = prereg["weights"]
    bounds = prereg.get("bounds") or {}
    total = 0.0
    contributions: dict[str, float] = {}
    for axis in WEIGHTED_AXES:
        value = card["axes"][axis]["value"]
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            card["total_withheld_because"].append(
                f"{axis} value {value!r} is not numeric -- cannot normalise"
            )
            return card
        unit = normalise(numeric, axis, bounds)
        if unit is None:
            card["total_withheld_because"].append(
                f"bounds for {axis} are unusable -- cannot normalise"
            )
            return card
        contribution = unit * float(weights[axis])
        contributions[axis] = round(contribution, 6)
        total += contribution

    card["status"] = "COMPLETE"
    card["total"] = round(total, 6)
    card["contributions"] = contributions
    return card


# --- rendering ----------------------------------------------------------------

def render_markdown(scorecard: dict) -> str:
    lines: list[str] = []
    add = lines.append
    add("# OD-03 bake-off — scorecard")
    add("")
    add(f"- Generated: `{scorecard['generated_at']}` by `{scorecard['generator']}`")
    add(f"- Protocol: `{PROTOCOL}`")
    add(f"- Spec sheet: `{scorecard['cards']['path']}` "
        f"(sha256 `{scorecard['cards']['digest']}`, "
        f"{scorecard['cards']['card_count']} cards, "
        f"{scorecard['cards']['unit_count']} units)")
    add(f"- Pre-registration: {'present' if scorecard['preregistration']['present'] else '**ABSENT**'}")
    add("")
    if scorecard["overall_status"] != "COMPLETE":
        add("> ## ⚠ PARTIAL — this scorecard decides nothing")
        add(">")
        add("> One or more axes are `UNMEASURED` or `INVALID_NO_EVIDENCE`, so no total")
        add("> score exists. **OD-03 remains OPEN.** Do not cite this file as a result;")
        add("> cite it as the state of a run in progress.")
        add("")
    add(f"**Overall status: {scorecard['overall_status']}**")
    add("")

    add("## Candidates")
    add("")
    add("| candidate | status | total | confirm gate | measured axes |")
    add("|---|---|---|---|---|")
    for card in scorecard["candidates"]:
        measured = sum(1 for c in card["axes"].values() if c["status"] == MEASURED)
        total = "—" if card["total"] is None else f"{card['total']:.3f}"
        gate = card["gates"].get("confirm_gate", UNMEASURED)
        add(f"| `{card['candidate']}` | {card['status']} | {total} | {gate} | "
            f"{measured}/{len(AXES)} |")
    add("")

    for card in scorecard["candidates"]:
        add(f"### `{card['candidate']}`")
        add("")
        run = card.get("run") or {}
        add(f"- Run: {run.get('id') or '—'} · date {run.get('date') or '—'} · "
            f"operator {run.get('operator') or '—'}")
        review = (run.get("protocol_review") or {})
        add(f"- Protocol review: {review.get('reviewer') or '—'} · "
            f"{review.get('date') or '—'} · {review.get('verdict') or '—'}")
        add("")
        add("| axis | status | value | direction | evidence |")
        add("|---|---|---|---|---|")
        for axis, cell in card["axes"].items():
            value = "—" if cell["value"] is None else f"`{cell['value']}`"
            ev = ", ".join(f"`{e}`" for e in cell["evidence"]) or "—"
            flag = " ⛔" if cell["status"] == INVALID else ""
            add(f"| `{axis}`{' (gate)' if cell['gate'] else ''} | "
                f"**{cell['status']}**{flag} | {value} | {cell['direction']} | {ev} |")
        add("")
        if card["total_withheld_because"]:
            add("**No total score. Why:**")
            add("")
            for reason in card["total_withheld_because"]:
                add(f"- {reason}")
            add("")

    add("## What is still unmeasured, in one place")
    add("")
    any_gap = False
    for card in scorecard["candidates"]:
        gaps = [a for a, c in card["axes"].items() if c["status"] != MEASURED]
        if gaps:
            any_gap = True
            add(f"- `{card['candidate']}`: " + ", ".join(f"`{g}`" for g in gaps))
    if not any_gap:
        add("- nothing — every axis on every candidate carries evidence.")
    add("")
    add("---")
    add("")
    add("*Emitted by `scripts/bakeoff/score_candidates.py`. Axes default to "
        "`UNMEASURED` (ADR 0020); a value without evidence is downgraded to "
        "`INVALID_NO_EVIDENCE` (ADR 0017); no total exists while either is "
        "present. OD-03 is OPEN until this file reads COMPLETE.*")
    return "\n".join(lines) + "\n"


# --- main ---------------------------------------------------------------------

def cmd_score(args: argparse.Namespace) -> int:
    cards_path = pathlib.Path(args.cards)
    cards = load_cards(cards_path)
    flat = flatten_cards(cards)
    prereg = load_prereg(pathlib.Path(args.prereg))
    results = load_results(pathlib.Path(args.out_dir) / "results")

    cardsets = [score_candidate(name, results.get(name), prereg) for name in CANDIDATES]
    overall = "COMPLETE" if all(c["status"] == "COMPLETE" for c in cardsets) else "PARTIAL"

    scorecard = {
        "generator": "scripts/bakeoff/score_candidates.py",
        "protocol": PROTOCOL,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "decision": {
            "id": "OD-03",
            "state": "OPEN",
            "note": "This file never closes OD-03. A COMPLETE scorecard is an "
                    "input to that decision, not the decision.",
        },
        "cards": {
            "path": _relpath(cards_path),
            "digest": _digest(cards_path),
            "unit_count": cards.get("unit_count"),
            "card_count": cards.get("card_count"),
            "routing_class_counts": cards.get("routing_class_counts"),
            "agent_cards_flattened": len(flat),
        },
        "preregistration": {
            "present": prereg is not None,
            "committed_at": (prereg or {}).get("committed_at"),
            "committed_by": (prereg or {}).get("committed_by"),
            "problems": prereg_problems(prereg),
        },
        "axes_definition": {
            axis: {
                "direction": spec["direction"],
                "gate": spec["gate"],
                "measurement": spec["measurement"],
                "evidence_rule": spec["evidence_rule"],
            }
            for axis, spec in AXES.items()
        },
        "disqualifiers": DISQUALIFIERS,
        "overall_status": overall,
        "candidates": cardsets,
    }

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "scorecard.json").write_text(json.dumps(scorecard, indent=2) + "\n")
    (out_dir / "SCORECARD.md").write_text(render_markdown(scorecard))

    print(f"scorecard: {overall}")
    for card in cardsets:
        measured = sum(1 for c in card["axes"].values() if c["status"] == MEASURED)
        print(f"  {card['candidate']:<32} {card['status']:<9} "
              f"{measured}/{len(AXES)} axes measured  "
              f"total={'—' if card['total'] is None else card['total']}")
    print(f"wrote {out_dir/'scorecard.json'}")
    print(f"wrote {out_dir/'SCORECARD.md'}")

    if args.require_complete and overall != "COMPLETE":
        print("\nFAIL (--require-complete): the bake-off has not been run to completion. "
              "OD-03 stays open.", file=sys.stderr)
        return 1
    return 0


def cmd_emit_sample(args: argparse.Namespace) -> int:
    cards_path = pathlib.Path(args.cards)
    cards = load_cards(cards_path)
    flat = flatten_cards(cards)
    sample = stratified_sample(flat, args.per_class)
    payload = {
        "generator": "scripts/bakeoff/score_candidates.py --emit-sample",
        "protocol": PROTOCOL,
        "generated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "cards_digest": _digest(cards_path),
        "selection": "first N per routing_class ordered by sha256(unit::agent) — "
                     "deterministic, no RNG, no operator discretion",
        "per_class": args.per_class,
        "counts": {rc: len(rows) for rc, rows in sample.items()},
        "sample": sample,
    }
    body = json.dumps(payload, indent=2) + "\n"
    payload["sample_digest"] = hashlib.sha256(body.encode()).hexdigest()[:16]
    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "workload_sample.json"
    target.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {target}")
    for rc, rows in sample.items():
        print(f"  {rc:<12} {len(rows)} cards")
        for row in rows:
            print(f"      {row['unit']}::{row['agent']}")
    print("\nCommit this file. Changing the sample after any candidate's numbers "
          "exist is disqualifier D-6.")
    return 0


def cmd_print_schema(_args: argparse.Namespace) -> int:
    schema = {
        "candidate": f"one of {list(CANDIDATES)}",
        "run": {
            "id": "string, e.g. 2026-09-02-hermes-01",
            "date": "ISO date the run executed",
            "operator": "harness-runtime",
            "protocol_review": {
                "reviewer": "architecture-review",
                "date": "ISO date — MUST be strictly earlier than run.date (D-8)",
                "verdict": "approved | approved_with_notes",
            },
            "workload_sample_digest": "from out/workload_sample.json",
            "w2_input_source": "restored_pdfs | in_repo_slice (README §3 W2)",
        },
        "axes": {
            axis: {
                "value": "number, or true/false for a gate axis; omit if unmeasured",
                "evidence": ["path or URL — REQUIRED; a value without one is voided"],
                "method": "one sentence naming the grader",
                "subscores": {s: None for s in spec["subscores"]} if spec["subscores"] else {},
            }
            for axis, spec in AXES.items()
        },
        "disqualifiers": ["list any tripped, e.g. \"D-4\" — self-declaring voids the run honestly"],
    }
    print(json.dumps(schema, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="OD-03 bake-off scorer. Emits a scorecard that looks partial "
                    "while it is partial. Picks nothing.",
    )
    ap.add_argument("--cards", default=str(DEFAULT_CARDS),
                    help="path to .planning/00-index/cards.json")
    ap.add_argument("--out-dir", default=str(DEFAULT_OUT))
    ap.add_argument("--prereg", default=str(PREREG))
    ap.add_argument("--init-prereg", action="store_true",
                    help="write the pre-registration template (all weights null)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing prereg")
    ap.add_argument("--emit-sample", action="store_true",
                    help="write the deterministic stratified workload sample")
    ap.add_argument("--per-class", type=int, default=6,
                    help="cards drawn per routing_class (default 6)")
    ap.add_argument("--print-schema", action="store_true",
                    help="print the results-file schema a run must produce")
    ap.add_argument("--require-complete", action="store_true",
                    help="exit 1 unless every axis on every candidate is measured")
    args = ap.parse_args(argv)

    try:
        if args.init_prereg:
            return init_prereg(pathlib.Path(args.prereg), args.force)
        if args.print_schema:
            return cmd_print_schema(args)
        if args.emit_sample:
            return cmd_emit_sample(args)
        return cmd_score(args)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        print("Exiting 2 — this is not a pass.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
