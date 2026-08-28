#!/usr/bin/env python3
"""Lift §2 agent cards out of every `<slug>-agent-stack.md` into a queryable index.

The agent-stack artifact (ADR 0034) declares each unit's agents as fenced YAML
cards — requirements-only, harness-agnostic while OD-03 is open. This script is
the cards' `build_loop_index.py` sibling: it parses all of them, enforces the
ADR 0034 contract, and emits `00-index/cards.json` + `00-index/CARD-MAP.md` so
the card layer is machine-readable and visible in the same graph as the loops.

`--check` validates and writes nothing: contract violations exit 1, an index
that no longer matches the cards exits 1, and an environment where the check
cannot run at all (no card files found, PyYAML missing) exits 2 — a guard that
cannot check what it claims to is a failure, not a skip (ADR 0025 discipline).

Wired into CI as a hard gate — see `.github/workflows/ci.yml`.
"""
import json
import re
import sys
import pathlib

try:
    import yaml
except ImportError:  # exit 2: cannot check, never pass vacuously
    sys.exit(2 if (print("CANNOT CHECK: PyYAML is not installed (pip install pyyaml).") or True) else 2)

R = pathlib.Path(__file__).resolve().parent.parent / ".planning"
CHECK = "--check" in sys.argv

CARDS_JSON = R / "00-index" / "cards.json"
CARD_MAP = R / "00-index" / "CARD-MAP.md"

REQUIRED = ("agent", "unit", "triggers", "consumes", "emits",
            "routing_class", "quality_bar", "autonomy", "memory", "escalates_to")
ROUTING = ("mechanical", "extraction", "judgment")
# Inside a *card* nothing may pick a model or an OD-03 candidate. Prose sections
# may cite models as evidence; the yaml block may not.
FORBIDDEN = ("claude-", "gemini-", "gpt-", "hermes-agent", "deepseek")

files = sorted(list((R / "01-org").rglob("*-agent-stack.md")) +
               list((R / "02-advisory").rglob("*-agent-stack.md")))
if not files:
    print("CANNOT CHECK: no *-agent-stack.md files found under .planning/01-org or 02-advisory.")
    sys.exit(2)

FM = re.compile(r"\A---\n(.*?)\n---\n", re.S)
FENCE = re.compile(r"^```yaml\n(.*?)^```", re.S | re.M)
WIKI = re.compile(r"\[\[([^\]|#]+)")

violations, units, gap_topics = [], [], []
routing_counts = {k: 0 for k in ROUTING}

for f in files:
    rel = str(f.relative_to(R))
    slug = f.name[: -len("-agent-stack.md")]
    text = f.read_text()

    m = FM.match(text)
    if not m:
        violations.append(f"{rel}: no frontmatter block"); continue
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as e:
        violations.append(f"{rel}: frontmatter does not parse — {e}"); continue
    if fm.get("type") != "agent-stack":
        violations.append(f"{rel}: frontmatter type is {fm.get('type')!r}, not 'agent-stack'")
    if fm.get("status") != "designed":
        violations.append(f"{rel}: status is {fm.get('status')!r} — ADR 0034 ships everything 'designed'")

    cards = []
    for i, block in enumerate(FENCE.findall(text), 1):
        low = block.lower()
        for bad in FORBIDDEN:
            if bad in low:
                violations.append(f"{rel}: card {i} contains forbidden token {bad!r} — cards are requirements-only")
        try:
            card = yaml.safe_load(block)
        except yaml.YAMLError as e:
            violations.append(f"{rel}: card {i} does not parse — {e}"); continue
        if not isinstance(card, dict):
            violations.append(f"{rel}: card {i} is not a mapping"); continue

        missing = [k for k in REQUIRED if k not in card]
        if missing:
            violations.append(f"{rel}: card {i} missing required keys: {', '.join(missing)}")
        rc = str(card.get("routing_class", "")).split()[0] if card.get("routing_class") else ""
        if rc not in ROUTING:
            violations.append(f"{rel}: card {i} routing_class {card.get('routing_class')!r} not one of {ROUTING}")
        else:
            routing_counts[rc] += 1
        aut = card.get("autonomy")
        gate = str((aut or {}).get("mutate_stock_money_outbound", "")) if isinstance(aut, dict) else ""
        if not gate.startswith("confirm"):
            violations.append(f"{rel}: card {i} autonomy.mutate_stock_money_outbound is {gate!r} — must be 'confirm' (FUTURES §8.1, non-negotiable)")
        if str(card.get("unit", "")) != slug:
            violations.append(f"{rel}: card {i} unit {card.get('unit')!r} != file slug {slug!r}")

        # Declared gaps: any trigger/consumes/emits line that names its missing other side.
        card_gaps = [ln.strip() for ln in block.splitlines() if "NONE (gap" in ln or "publisher: NONE" in ln]
        gap_topics.extend(f"{slug}: {g}" for g in card_gaps)
        cards.append({
            "agent": card.get("agent"), "routing_class": rc or None,
            "triggers": card.get("triggers"), "consumes": card.get("consumes"),
            "emits": card.get("emits"), "quality_bar": card.get("quality_bar"),
            "autonomy": aut, "memory": card.get("memory"),
            "escalates_to": card.get("escalates_to"),
            "declared_gaps": card_gaps,
        })

    if not cards:
        violations.append(f"{rel}: no parseable agent card found")
    units.append({
        "unit": slug, "path": rel,
        "division": fm.get("division"), "department": fm.get("department"),
        "team": fm.get("team"), "status": fm.get("status"),
        "metrics": fm.get("metrics") or [],
        "agents": cards,
        "links": sorted(set(WIKI.findall(text))),
    })

index = {
    "generator": "scripts/build_agent_card_index.py",
    "contract": "ADR 0034 (.planning/decisions/0034-agent-stack-artifact.md)",
    "unit_count": len(units),
    "card_count": sum(len(u["agents"]) for u in units),
    "routing_class_counts": routing_counts,
    "declared_gap_count": len(gap_topics),
    "declared_gaps": sorted(gap_topics),
    "units": units,
}


def render_map():
    by_div = {}
    for u in units:
        by_div.setdefault(u["division"] or "advisory", []).append(u)
    L = [
        "# CARD-MAP — the agent-card layer, one row per card",
        "",
        "> Generated by `scripts/build_agent_card_index.py`. **Do not hand-edit.**",
        "> Contract: [ADR 0034](../decisions/0034-agent-stack-artifact.md) · machine twin: `cards.json`",
        "",
        f"**{index['unit_count']} units · {index['card_count']} cards** — "
        f"{routing_counts['mechanical']} mechanical · {routing_counts['extraction']} extraction · "
        f"{routing_counts['judgment']} judgment · {index['declared_gap_count']} declared gap lines.",
        "",
        "Every card is `status: designed` and requirements-only (no model, no queue tech,",
        "no OD-03 candidate — enforced here). `mutate_stock_money_outbound: confirm` is",
        "verified on every card. A *declared gap* is a trigger whose publisher does not",
        "exist yet — honesty rows, counted rather than hidden.",
        "",
    ]
    for div in sorted(by_div):
        L += [f"## {div}", "", "| Unit | Agent | Class | Gaps |", "|---|---|---|---|"]
        for u in sorted(by_div[div], key=lambda x: x["unit"]):
            for c in u["agents"]:
                L.append(f"| [[{u['unit']}-agent-stack\\|{u['unit']}]] | `{c['agent']}` | {c['routing_class']} | {len(c['declared_gaps'])} |")
        L.append("")
    return "\n".join(L) + "\n"


def stable(idx):
    i = dict(idx)
    return json.dumps(i, indent=1, ensure_ascii=False, sort_keys=False)


if violations:
    print(f"== Agent-card contract: {len(files)} files, {index['card_count']} cards, "
          f"{len(violations)} VIOLATIONS")
    for v in violations:
        print(f"   {v}")
    print("FAIL — a card breaks the ADR 0034 contract.")
    sys.exit(1)

new_json = stable(index)
new_map = render_map()

if CHECK:
    ok = CARDS_JSON.exists() and CARDS_JSON.read_text() == new_json \
        and CARD_MAP.exists() and CARD_MAP.read_text() == new_map
    print(f"== Agent-card contract: {len(files)} files, {index['card_count']} cards, 0 violations")
    if not ok:
        print("FAIL — 00-index/cards.json or CARD-MAP.md is stale. Regenerate:")
        print("    python3 scripts/build_agent_card_index.py")
        sys.exit(1)
    print("PASS — every card honors the contract and the index is current.")
    sys.exit(0)

CARDS_JSON.write_text(new_json)
CARD_MAP.write_text(new_map)
print(f"Wrote {CARDS_JSON.relative_to(R.parent)} and {CARD_MAP.relative_to(R.parent)} — "
      f"{index['unit_count']} units, {index['card_count']} cards, "
      f"{index['declared_gap_count']} declared gaps.")
