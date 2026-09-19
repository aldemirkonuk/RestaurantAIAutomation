#!/usr/bin/env python3
"""Dry-run planner + applier for ADR 0166's tech-debt-register split.

.planning/decisions/0166-the-defect-register-retires-and-its-items-live-by-kind.md
records the decision: `.planning/v3.0-TECH-DEBT.md` retires, and its 231 surviving
items live split by kind. This script is the tooling that executes that split --
but only once the founder has marked every item, and only against an *exported*
copy of the founder's marking artifact (claude.ai artifact TvfJKKnkhe5pVZnqLDunPX),
because this script has no way to read that artifact's live database directly.

INPUTS
------
  --items PATH   an export of the artifact's "items" collection: either a bare
                 JSON list of item objects, or {"items": [...]}. Each item needs
                 at least "key" (or "id") and "group"; "title", "plain",
                 "evidence", "destination", "severity" are used when present
                 (this is the same shape as review-0919/checklist.json, which
                 seeded the artifact).
  --marks PATH   an export of the artifact's "marks/<group>" collection. Accepts
                 the documented shape {"<group>": {"d": {"<key>": {"v": ..,
                 "n": ..}}}}, and a flat {"<key>": {"v": .., "n": ..}} fallback,
                 since the live schema could not be confirmed by reading the
                 artifact (ADR 0166). "v" must be one of remove|work|decide|move.
  --verify-map   PATH, optional. {"<key>": "<shell command>"} -- a human-authored
                 verify command for a WORK item that reduces to a code-shape
                 question. THIS SCRIPT NEVER INVENTS A VERIFY COMMAND. A WORK
                 item with no entry here routes to the owning-ADR bucket, never
                 to CLAIMS.jsonl with a guessed check -- see CLAUDE.md §5b: a
                 claim that cannot be checked by a command must not pretend to
                 be one.

OUTPUTS (always written, dry run or not; see --out)
----------------------------------------------------
  claims_draft.jsonl        (1) draft CLAIMS.jsonl rows, one per WORK item with
                                 a supplied verify command. DRAFT prose -- read
                                 it before it lands.
  open_decisions_draft.md   (2) draft OPEN-DECISIONS.md table rows for DECIDE
                                 items, numbered from the register's real
                                 next-free OD id (re-measured every run, never
                                 hardcoded).
  adr_open_items.json       (3) WORK items with no verify command, and MOVE
                                 items whose destination names an ADR, grouped
                                 by target ADR (or "UNASSIGNED" when none could
                                 be inferred from the item's "destination").
  move_relocations.json     MOVE items destined for CLAUDE.md conventions or
                                 ROADMAP/FUTURES, plus anything the destination
                                 text didn't match a known keyword for (flagged
                                 "needs manual placement").
  citations.json            (4) every file that names `v3.0-TECH-DEBT.md`
                                 literally, classified into the retirement
                                 plan's citation classes, with a proposed
                                 replacement per class. Independent of marks.
  unmarked.json             (5) items present in --items with no matching mark.
  summary.md                human-readable counts + pointers to the files above.

--apply mutates real files, and ONLY these two:
    .planning/decisions/CLAIMS.jsonl        (append; refuses on an id collision)
    .planning/decisions/OPEN-DECISIONS.md   (insert rows before "## Resolved")
It refuses outright (exit 1) while unmarked.json is non-empty. It NEVER touches
CLAUDE.md, decisions/README.md, .planning/v3.0-TECH-DEBT.md, or any existing ADR
file -- those are gate-owned (ADR 0090) or need per-ADR human judgement about
where an "open items" section belongs, and stay suggestions (adr_open_items.json,
move_relocations.json, citations.json) for a person to apply by hand.

EXIT CODES (mirrors this repo's own guard convention)
------------------------------------------------------
  0  ran cleanly (dry run always reaches this; --apply reaches this only when
     nothing was refused)
  1  a real precondition was refused: unmarked items block --apply, a CLAIMS id
     already exists, "## Resolved" is missing from OPEN-DECISIONS.md
  2  CANNOT CHECK -- malformed input, unreadable file, git/grep failure. Not a
     skip; see CannotCheck.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

VALID_VERDICTS = {"remove", "work", "decide", "move"}

CLAIMS_REL_PATH = ".planning/decisions/CLAIMS.jsonl"
OPEN_DECISIONS_REL_PATH = ".planning/decisions/OPEN-DECISIONS.md"
RESOLVED_HEADING = "## Resolved"

REGISTER_FILENAME = "v3.0-TECH-DEBT.md"
REGISTER_REL_PATH = f".planning/{REGISTER_FILENAME}"


class CannotCheck(Exception):
    """The tool cannot see what it needs to. Never guess -- refuse (exit 2)."""


# ---------------------------------------------------------------------------
# Loading + normalising the two exported collections
# ---------------------------------------------------------------------------


def load_items(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CannotCheck(f"{path}: unreadable or not valid JSON ({exc})") from exc

    if isinstance(data, dict) and "items" in data:
        raw = data["items"]
    elif isinstance(data, list):
        raw = data
    else:
        raise CannotCheck(
            f"{path}: expected a JSON list or an object with an 'items' list, "
            f"got {type(data).__name__}"
        )
    # The marking page's real export (2026-09-19) keys the items collection by
    # document id, which is the item key: {"items": {"<key>": {...}}}.
    if isinstance(raw, dict):
        if not all(isinstance(v, dict) for v in raw.values()):
            raise CannotCheck(f"{path}: 'items' is an object whose values are not all objects")
        raw = [{**v, "key": v.get("key") or v.get("id") or k} for k, v in raw.items()]
    if not isinstance(raw, list):
        raise CannotCheck(f"{path}: 'items' is not a list")

    items: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for i, it in enumerate(raw):
        if not isinstance(it, dict):
            raise CannotCheck(f"{path}: items[{i}] is not an object")
        key = it.get("key") or it.get("id")
        group = it.get("group")
        if not key or not isinstance(key, str):
            raise CannotCheck(f"{path}: items[{i}] has no usable 'key'/'id': {it!r}")
        if not group or not isinstance(group, str):
            raise CannotCheck(f"{path}: items[{i}] (key={key!r}) has no 'group'")
        if key in seen_keys:
            raise CannotCheck(f"{path}: duplicate item key {key!r}")
        seen_keys.add(key)
        norm = dict(it)
        norm["key"] = key
        norm["group"] = group
        items.append(norm)
    if not items:
        raise CannotCheck(f"{path}: parsed to zero items -- refusing an empty plan")
    return items


def load_marks(path: Path) -> dict[str, dict[str, Any]]:
    """Normalises an export of the marks/<group> collection to {key: {v, n}}.

    Accepts:
      A) {"<group>": {"d": {"<key>": {"v": "...", "n": "..."}}}}  -- documented shape
      B) {"<key>": {"v": "...", "n": "..."}}                       -- flat fallback
    Shape B is what the marking page's real export produced (2026-09-19); shape A
    is the documented per-group form, kept for a raw collection dump (ADR 0166).
    """
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CannotCheck(f"{path}: unreadable or not valid JSON ({exc})") from exc
    if not isinstance(data, dict):
        raise CannotCheck(f"{path}: expected a JSON object")

    flat: dict[str, dict[str, Any]] = {}
    for outer_key, outer_val in data.items():
        if isinstance(outer_val, dict) and isinstance(outer_val.get("d"), dict):
            for k, v in outer_val["d"].items():
                if k in flat:
                    raise CannotCheck(f"{path}: key {k!r} marked more than once (group {outer_key!r})")
                flat[k] = v
        elif isinstance(outer_val, dict) and "v" in outer_val:
            if outer_key in flat:
                raise CannotCheck(f"{path}: key {outer_key!r} marked more than once")
            flat[outer_key] = outer_val
        else:
            raise CannotCheck(f"{path}: cannot interpret mark entry {outer_key!r}: {outer_val!r}")

    for k, v in flat.items():
        if not isinstance(v, dict) or v.get("v") not in VALID_VERDICTS:
            raise CannotCheck(
                f"{path}: key {k!r} has verdict {v.get('v') if isinstance(v, dict) else v!r}, "
                f"want one of {sorted(VALID_VERDICTS)}"
            )
    if not flat:
        raise CannotCheck(f"{path}: parsed to zero marks -- refusing an empty plan")
    return flat


def load_verify_map(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CannotCheck(f"{path}: unreadable or not valid JSON ({exc})") from exc
    if not isinstance(data, dict) or not all(isinstance(v, str) for v in data.values()):
        raise CannotCheck(f"{path}: expected a flat {{key: 'shell command'}} object")
    return data


# ---------------------------------------------------------------------------
# Building the plan
# ---------------------------------------------------------------------------


@dataclass
class Plan:
    claims_rows: list[dict[str, Any]] = field(default_factory=list)
    open_decision_rows: list[dict[str, Any]] = field(default_factory=list)
    adr_open_items: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    move_to_roadmap_futures: list[dict[str, Any]] = field(default_factory=list)
    move_to_claude_conventions: list[dict[str, Any]] = field(default_factory=list)
    move_unclassified: list[dict[str, Any]] = field(default_factory=list)
    removed: list[dict[str, Any]] = field(default_factory=list)
    unmarked: list[dict[str, Any]] = field(default_factory=list)


def _claim_id(key: str) -> str:
    """DEBT-<KEY>, uppercased. See the module docstring: ids are drafts, a human
    may rename before landing (the one real precedent, DEBT-44.2d, keeps the
    register id's original case; this function does not, for a simple, testable,
    single rule instead of a case-by-case one)."""
    return f"DEBT-{key.upper()}"


def _owning_adr_from_destination(destination: str | None) -> str | None:
    if not destination:
        return None
    m = re.search(r"ADR\s*0*(\d{3,5})", destination, re.IGNORECASE)
    if not m:
        return None
    return m.group(1).zfill(4)


def _text_field(item: dict[str, Any], *names: str, default: str = "") -> str:
    for n in names:
        v = item.get(n)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return default


def _claim_text(item: dict[str, Any], note: str) -> str:
    parts = [_text_field(item, "title", default=item["key"])]
    plain = _text_field(item, "plain")
    if plain:
        parts.append(plain)
    if note:
        parts.append(f"Founder note: {note}")
    evidence = _text_field(item, "evidence")
    if evidence:
        parts.append(f"Evidence: {evidence}")
    return " -- ".join(parts)


def _relocation_record(item: dict[str, Any], note: str, origin_verdict: str) -> dict[str, Any]:
    return {
        "key": item["key"],
        "group": item["group"],
        "title": _text_field(item, "title", default=item["key"]),
        "destination": _text_field(item, "destination"),
        "founder_note": note,
        "origin_verdict": origin_verdict,
    }


def build_plan(
    items: list[dict[str, Any]],
    marks: dict[str, dict[str, Any]],
    verify_map: dict[str, str],
    next_od_number: int,
) -> Plan:
    plan = Plan()
    od_counter = next_od_number

    for item in items:
        key = item["key"]
        mark = marks.get(key)
        if mark is None:
            plan.unmarked.append(item)
            continue

        verdict = mark["v"]
        note = mark.get("n") or ""

        if verdict == "remove":
            plan.removed.append(_relocation_record(item, note, "remove"))

        elif verdict == "work":
            verify = verify_map.get(key)
            if verify:
                plan.claims_rows.append(
                    {
                        "id": _claim_id(key),
                        "status": "open",
                        "claim": _claim_text(item, note),
                        "verify": verify,
                    }
                )
            else:
                adr = _owning_adr_from_destination(_text_field(item, "destination")) or "UNASSIGNED"
                plan.adr_open_items.setdefault(adr, []).append(_relocation_record(item, note, "work"))

        elif verdict == "decide":
            plan.open_decision_rows.append(
                {
                    "id": f"OD-{od_counter}",
                    "question": _text_field(item, "title", default=key),
                    "why_it_matters": _text_field(item, "plain", "evidence"),
                    "unblocks": _text_field(item, "destination", default="Founder must specify."),
                    "source_key": key,
                    "founder_note": note,
                }
            )
            od_counter += 1

        elif verdict == "move":
            dest_upper = _text_field(item, "destination").upper()
            if "ROADMAP" in dest_upper or "FUTURES" in dest_upper:
                plan.move_to_roadmap_futures.append(_relocation_record(item, note, "move"))
            elif "CLAUDE.MD" in dest_upper:
                plan.move_to_claude_conventions.append(_relocation_record(item, note, "move"))
            else:
                adr = _owning_adr_from_destination(_text_field(item, "destination"))
                if adr:
                    plan.adr_open_items.setdefault(adr, []).append(_relocation_record(item, note, "move"))
                else:
                    plan.move_unclassified.append(_relocation_record(item, note, "move"))

        else:  # pragma: no cover -- load_marks already validated this
            raise CannotCheck(f"key {key!r}: unreachable verdict {verdict!r}")

    return plan


# ---------------------------------------------------------------------------
# OPEN-DECISIONS.md next-free-id (re-measured every run -- CLAUDE.md §5b)
# ---------------------------------------------------------------------------


def next_open_decision_number(repo_root: Path) -> int:
    path = repo_root / OPEN_DECISIONS_REL_PATH
    try:
        text = path.read_text()
    except OSError as exc:
        raise CannotCheck(f"{path}: unreadable ({exc})") from exc
    ids = [int(m) for m in re.findall(r"OD-(\d+)\b", text)]
    if not ids:
        raise CannotCheck(f"{path}: found zero OD-<n> ids -- the row pattern rotted, refusing to guess")
    return max(ids) + 1


# ---------------------------------------------------------------------------
# Citation sweep -- deliverable (4), independent of items/marks
# ---------------------------------------------------------------------------

_EXACT_PATH_CLASSES: dict[str, tuple[str, str]] = {
    "CLAUDE.md": (
        "gate-owned",
        "ESCALATE -- founder must approve this edit directly; ADR 0090's "
        "_GATE_OWNED_PATHS (scripts/pr_audit_gate.py) force-BLOCKs any PR touching it.",
    ),
    ".planning/decisions/README.md": (
        "gate-owned",
        "ESCALATE -- same as CLAUDE.md. Bracketed note only, per CLAUDE.md §5b/§7 "
        "(do not rewrite ADR history in the summary table).",
    ),
    ".planning/decisions/OPEN-DECISIONS.md": (
        "open-decisions-link",
        "Repoint or drop the markdown link (see OD-60); the OD's own prose should "
        "already carry the substance.",
    ),
    ".planning/decisions/CLAIMS.jsonl": (
        "claims-prose",
        "No functional change required (every verify command is self-contained); "
        "optionally strip the dangling filename from the claim string on next touch.",
    ),
    ".planning/PROJECT.md": (
        "entry-point-doc",
        "Repoint or rewrite the sentence naming this as the live defect register.",
    ),
    ".planning/07-reference/INDEX.md": (
        "reference-index",
        "Repoint both mentions to the successor location.",
    ),
}

_SCRIPT_DOCSTRING_PATHS = {
    "scripts/check_web_reads_gateway_dto_keys.py",
    "scripts/check_definer_functions_closed.py",
    "scripts/check_new_tables_are_locked_down.py",
}

_HISTORICAL_PREFIXES = (
    ".planning/01-org/",
    ".planning/sketches/",
    ".planning/archive/",
    ".planning/foundation/",
    ".planning/03-scenarios/",
    ".planning/testing/",
    "datasets/",
)


def classify_path(rel_path: str) -> tuple[str, str]:
    """Maps a citing file's repo-relative path to (class, proposed_replacement),
    mirroring review-0919/tech-debt-retirement-plan.md §1/§3. A path this doesn't
    recognise comes back "unclassified" for manual review -- never guessed."""
    if rel_path in _EXACT_PATH_CLASSES:
        return _EXACT_PATH_CLASSES[rel_path]
    if rel_path in _SCRIPT_DOCSTRING_PATHS:
        return ("script-docstring", "Repoint the one docstring line to the item's new home.")
    if rel_path.startswith(".planning/decisions/") and rel_path.endswith(".md"):
        return (
            "adr-historical",
            "Bracketed note only, in place -- CLAUDE.md §5b/§7 favours a correction "
            "over rewriting ADR history.",
        )
    if rel_path.startswith("apps/api-gateway/") or rel_path.startswith("apps/web/"):
        if "/coverage/" in rel_path:
            return ("generated-coverage", "Ignore -- regenerated on every test run, not a real dependency.")
        return (
            "source-comment",
            "Repoint the comment to the item's new home (CLAIMS id / OD number / "
            "ADR section) -- mechanical, one line, no behaviour change.",
        )
    if rel_path.startswith(".github/workflows/"):
        return ("workflow-comment", "Repoint or drop the comment; no YAML step reads the file.")
    if rel_path.startswith(".planning/06-pages/") or rel_path.startswith(".planning/08-softwares/"):
        return (
            "page-dossier-citation",
            "Repoint the line-range citation to the successor, or accept it becomes historical-only.",
        )
    if rel_path.startswith("supabase/"):
        return ("sql-comment", "Repoint the SQL comment header for context, on next touch of that file.")
    if rel_path.startswith(".planning/00-index/"):
        return (
            "generated-index",
            "Machine-generated (scripts/generate_design_atlas.py) -- never hand-edit; "
            "the mention drops out on the next regeneration.",
        )
    if rel_path.startswith(".planning/04-specs/") or rel_path.startswith(".planning/07-reference/"):
        return (
            "reference-doc",
            "Prose mention -- repoint if this doc is touched for an unrelated reason, "
            "otherwise leave as historical-only.",
        )
    if rel_path.startswith(_HISTORICAL_PREFIXES):
        return (
            "historical-corpus",
            "Leave as historical prose -- retire-to-write applies to new docs, not a "
            "mandate to rewrite the whole corpus in one PR.",
        )
    return ("unclassified", "Manual review -- no path rule matched this file.")


def scan_citations(repo_root: Path) -> list[dict[str, Any]]:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "grep", "-n", "-F", REGISTER_FILENAME],
        capture_output=True,
        text=True,
    )
    if result.returncode not in (0, 1):
        raise CannotCheck(
            f"`git grep` failed (rc={result.returncode}): {result.stderr.strip() or '(no stderr)'}"
        )

    hits_by_file: dict[str, list[dict[str, Any]]] = {}
    for line in result.stdout.splitlines():
        path, lineno, content = line.split(":", 2)
        if path == REGISTER_REL_PATH:
            continue  # the register citing itself is not a dependency
        hits_by_file.setdefault(path, []).append({"line": int(lineno), "text": content.strip()})

    citations = []
    for path in sorted(hits_by_file):
        cls, replacement = classify_path(path)
        citations.append(
            {
                "file": path,
                "class": cls,
                "proposed_replacement": replacement,
                "hits": hits_by_file[path],
            }
        )
    return citations


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _md_cell(text: str) -> str:
    return " ".join(text.replace("|", "\\|").split())


def render_claims_jsonl(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    return "\n".join(json.dumps(r) for r in rows) + "\n"


def render_open_decision_row(row: dict[str, Any]) -> str:
    return (
        f"| {row['id']} | **{_md_cell(row['question'])}** | "
        f"{_md_cell(row['why_it_matters'])} | {_md_cell(row['unblocks'])} |"
    )


def render_open_decisions_md(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    return "\n".join(render_open_decision_row(r) for r in rows) + "\n"


# ---------------------------------------------------------------------------
# --apply: the only two files this tool ever writes into
# ---------------------------------------------------------------------------


def assert_no_unmarked(plan: Plan) -> None:
    if plan.unmarked:
        keys = ", ".join(it["key"] for it in plan.unmarked[:10])
        more = "" if len(plan.unmarked) <= 10 else f", +{len(plan.unmarked) - 10} more"
        raise RefusedError(
            f"{len(plan.unmarked)} item(s) have no founder mark yet ({keys}{more}). "
            "Refusing --apply until every item in --items has a matching entry in --marks."
        )


class RefusedError(Exception):
    """A real precondition failed. Exit 1, not 2 -- this is not a CannotCheck."""


def apply_claims(repo_root: Path, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    path = repo_root / CLAIMS_REL_PATH
    try:
        existing_lines = path.read_text().splitlines()
    except OSError as exc:
        raise CannotCheck(f"{path}: unreadable ({exc})") from exc

    existing_ids: set[str] = set()
    for i, line in enumerate(existing_lines):
        if not line.strip():
            continue
        try:
            existing_ids.add(json.loads(line)["id"])
        except (json.JSONDecodeError, KeyError) as exc:
            raise CannotCheck(f"{path}:{i + 1}: not a valid claim row ({exc})") from exc

    new_ids = [r["id"] for r in rows]
    if len(set(new_ids)) != len(new_ids):
        raise RefusedError(f"the batch itself reuses a claim id: {new_ids}")
    collisions = sorted(set(new_ids) & existing_ids)
    if collisions:
        raise RefusedError(f"claim id(s) already exist in {CLAIMS_REL_PATH}: {collisions}")

    with path.open("a") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")
    return len(rows)


def apply_open_decisions(repo_root: Path, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    path = repo_root / OPEN_DECISIONS_REL_PATH
    try:
        text = path.read_text()
    except OSError as exc:
        raise CannotCheck(f"{path}: unreadable ({exc})") from exc
    if RESOLVED_HEADING not in text:
        raise CannotCheck(f"{path}: no {RESOLVED_HEADING!r} heading found -- refusing to guess where Open ends")

    new_ids = {r["id"] for r in rows}
    existing_ids = set(re.findall(r"OD-(\d+)\b", text))
    existing_ids = {f"OD-{n}" for n in existing_ids}
    collisions = sorted(new_ids & existing_ids)
    if collisions:
        raise RefusedError(f"OD id(s) already exist in {OPEN_DECISIONS_REL_PATH}: {collisions}")

    insertion = render_open_decisions_md(rows)
    before, sep, after = text.partition(RESOLVED_HEADING)
    new_text = before.rstrip("\n") + "\n" + insertion + "\n" + sep + after
    path.write_text(new_text)
    return len(rows)


# ---------------------------------------------------------------------------
# Orchestration + CLI
# ---------------------------------------------------------------------------


def run(
    *,
    items_path: Path,
    marks_path: Path,
    verify_map_path: Path | None,
    repo_root: Path,
    out_dir: Path,
    apply: bool,
) -> int:
    items = load_items(items_path)
    marks = load_marks(marks_path)
    verify_map = load_verify_map(verify_map_path)
    next_od = next_open_decision_number(repo_root)
    plan = build_plan(items, marks, verify_map, next_od)
    citations = scan_citations(repo_root)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "claims_draft.jsonl").write_text(render_claims_jsonl(plan.claims_rows))
    (out_dir / "open_decisions_draft.md").write_text(render_open_decisions_md(plan.open_decision_rows))
    (out_dir / "adr_open_items.json").write_text(json.dumps(plan.adr_open_items, indent=2) + "\n")
    (out_dir / "move_relocations.json").write_text(
        json.dumps(
            {
                "roadmap_futures": plan.move_to_roadmap_futures,
                "claude_conventions": plan.move_to_claude_conventions,
                "unclassified_needs_manual_placement": plan.move_unclassified,
            },
            indent=2,
        )
        + "\n"
    )
    (out_dir / "citations.json").write_text(json.dumps(citations, indent=2) + "\n")
    (out_dir / "unmarked.json").write_text(
        json.dumps([{"key": it["key"], "group": it["group"]} for it in plan.unmarked], indent=2) + "\n"
    )
    (out_dir / "removed.json").write_text(json.dumps(plan.removed, indent=2) + "\n")

    summary_lines = [
        "# retire_tech_debt.py -- run summary",
        "",
        f"- items loaded: {len(items)}",
        f"- REMOVE: {len(plan.removed)}",
        f"- WORK -> CLAIMS.jsonl (had a --verify-map entry): {len(plan.claims_rows)}",
        f"- WORK/MOVE -> owning ADR's open items: {sum(len(v) for v in plan.adr_open_items.values())} "
        f"across {len(plan.adr_open_items)} ADR(s) ({', '.join(sorted(plan.adr_open_items)) or 'none'})",
        f"- DECIDE -> OPEN-DECISIONS.md (next id {f'OD-{next_od}'} onward): {len(plan.open_decision_rows)}",
        f"- MOVE -> ROADMAP/FUTURES: {len(plan.move_to_roadmap_futures)}",
        f"- MOVE -> CLAUDE.md conventions: {len(plan.move_to_claude_conventions)}",
        f"- MOVE -> unclassified (needs manual placement): {len(plan.move_unclassified)}",
        f"- UNMARKED (blocks --apply): {len(plan.unmarked)}",
        f"- citing files found for {REGISTER_FILENAME}: {len(citations)}",
        "",
        "Files: claims_draft.jsonl, open_decisions_draft.md, adr_open_items.json, "
        "move_relocations.json, citations.json, unmarked.json, removed.json",
    ]
    (out_dir / "summary.md").write_text("\n".join(summary_lines) + "\n")

    if not apply:
        return 0

    assert_no_unmarked(plan)
    n_claims = apply_claims(repo_root, plan.claims_rows)
    n_od = apply_open_decisions(repo_root, plan.open_decision_rows)
    print(
        f"[apply] wrote {n_claims} row(s) to {CLAIMS_REL_PATH}, {n_od} row(s) to {OPEN_DECISIONS_REL_PATH}.",
        file=sys.stderr,
    )
    if n_od:
        print(
            f"[apply] now run scripts/check_citation_pairing.py --fix -- inserting "
            f"rows shifted every anchor below them.",
            file=sys.stderr,
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--items", required=True, type=Path)
    parser.add_argument("--marks", required=True, type=Path)
    parser.add_argument("--verify-map", type=Path, default=None)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--out", type=Path, default=Path("./retire_tech_debt_report"))
    parser.add_argument("--apply", action="store_true", help="Mutate CLAIMS.jsonl/OPEN-DECISIONS.md for real. Default is a dry run.")
    args = parser.parse_args(argv)

    try:
        return run(
            items_path=args.items,
            marks_path=args.marks,
            verify_map_path=args.verify_map,
            repo_root=args.repo_root.resolve(),
            out_dir=args.out,
            apply=args.apply,
        )
    except RefusedError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
