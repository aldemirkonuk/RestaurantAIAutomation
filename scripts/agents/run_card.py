#!/usr/bin/env python3
"""Run the mechanical agent cards — the first agents off the ADR 0034 card layer.

`watch_loops.py` sibling, one layer up: where the watcher reads the loop graph,
this runner *executes* agent cards whose `routing_class: mechanical` job is a
disk census, a grep, or a wrapped guard — no model call, no message bus, no
database. That boundary is deliberate: OD-03 (the harness choice) is open, and
nothing here may make any harness option easier or harder — these agents are
scripts with cards, exactly like the five `check_*.sh` guards, but declared.

It reports; by default it never edits anything. `--write-memory` is the one
sanctioned write path: it lands the run's durable findings as one-fact-per-file
memory (ADR 0034 §4 semantic layer) in the owning unit's `memory/` directory,
so the "self-improvement is a reviewable diff" loop actually closes — the facts
ride the same PR as everything else.

Judgment- and extraction-class cards are NOT run here. Most have no substrate
yet (their own §6 says so); running them would fabricate behavior. The honest
frontier is visible in the report: implemented / mechanical-but-unimplemented /
out of scope.

Usage
-----
    python3 scripts/agents/run_card.py                 # run all implemented, report
    python3 scripts/agents/run_card.py --agent fleet-census-agent
    python3 scripts/agents/run_card.py --json
    python3 scripts/agents/run_card.py --write-memory  # also land facts in memory/
"""
from __future__ import annotations

import datetime as _dt
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
P = ROOT / ".planning"
ORCH = ROOT / "services" / "agent-orchestrator"
GW = ROOT / "apps" / "api-gateway" / "src"
TODAY = _dt.date.today().isoformat()

JSON_OUT = "--json" in sys.argv
WRITE_MEMORY = "--write-memory" in sys.argv
ONLY = None
if "--agent" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--agent") + 1]


def _cards():
    idx = json.loads((P / "00-index" / "cards.json").read_text())
    out = {}
    for u in idx["units"]:
        for c in u["agents"]:
            out[c["agent"]] = {"unit": u["unit"], "path": u["path"],
                               "routing_class": c["routing_class"]}
    return out


def _grep_lines(root: pathlib.Path, pattern: str, suffix: str, code_only: bool = False):
    """code_only strips comment-only lines and text after an inline comment
    marker before matching — a URL in a comment is not a call site."""
    rx = re.compile(pattern)
    hits = []
    for f in sorted(root.rglob(f"*{suffix}")):
        if "node_modules" in f.parts or ".git" in f.parts:
            continue
        try:
            for n, line in enumerate(f.read_text(errors="replace").splitlines(), 1):
                probe = line
                if code_only:
                    s = line.lstrip()
                    if s.startswith(("//", "*", "/*", "#")):
                        continue
                    probe = line.split("//", 1)[0] if suffix == ".ts" \
                        else line.split("#", 1)[0]
                if rx.search(probe):
                    hits.append((str(f.relative_to(ROOT)), n, line.strip()))
        except OSError:
            continue
    return hits


# --------------------------------------------------------------------------- #
# Implementations. Each returns {"metrics": {...}, "findings": [...],
# "facts": [(slug, title, body)]} — facts are the durable subset.
# --------------------------------------------------------------------------- #

def fleet_census_agent():
    agents_dir = ORCH / "agents"
    modules = sorted(p.stem for p in agents_dir.glob("*.py") if p.stem != "__init__")
    subclassing = [m for m in modules
                   if re.search(r"class\s+\w+\(\s*BaseAgent\s*[),]",
                                (agents_dir / f"{m}.py").read_text())]
    reg_text = (ORCH / "core" / "orchestrator.py").read_text()
    block = re.search(r"_register_agent_classes.*?\n\s*\}", reg_text, re.S)
    registered = re.findall(r'"([a-z0-9_]+)"\s*:\s*\w+Agent', block.group(0)) if block else []
    unregistered = [m for m in modules if m not in registered]

    # Gate check, not a heuristic (fix 2026-08-28, ADR 0038 correction / PAO-14):
    # the registry is the arbiter. OPTIONAL-tier specs are boot-refused unless
    # AGENT_<NAME>_ENABLED is set, and that env default is off — so an OPTIONAL
    # agent cannot receive by default regardless of what its process_message says.
    # The first census read only orchestrator.py, published 23, and overturned the
    # charter's correct ≈18; measuring the wrong gate with confidence was the bug.
    reg_src = (ORCH / "core" / "agent_registry.py").read_text()
    optional = re.findall(
        r'"([a-z0-9_]+)":\s*\{[^}]*?AgentTier\.OPTIONAL', reg_src, re.S)
    stubs = [m for m in registered if m in optional]

    # Subscription coverage: topics subscribed vs published, grep-level.
    subs = {m.group(1) for _, _, l in _grep_lines(ORCH, r'subscribe\w*\(\s*["\']', ".py")
            if (m := re.search(r'subscribe\w*\(\s*["\']([^"\']+)', l))}
    pubs_text = "\n".join(l for _, _, l in _grep_lines(ORCH, r'publish\w*\(', ".py"))
    dead_topics = sorted(t for t in subs if t not in pubs_text)

    live = len(registered) - len(stubs)
    metrics = {
        "fleet.modules_on_disk": len(modules),
        "fleet.subclassing_baseagent": len(subclassing),
        "fleet.registered": len(registered),
        "fleet.can_start_by_default": live,
        "fleet.live_agent_ratio": f"{live}/{len(modules)}",
        "fleet.optional_gated_off": len(stubs),
        "fleet.orphan_modules": len(unregistered),
        "fleet.subscribed_topics_without_publisher": len(dead_topics),
    }
    findings = [f"unregistered modules: {', '.join(unregistered) or 'none'}",
                f"OPTIONAL tier, boot-refused unless AGENT_<NAME>_ENABLED "
                f"(agent_registry.py is_enabled, default off): "
                f"{', '.join(stubs) or 'none'}",
                f"subscribed topics with no publisher (grep-level): "
                f"{', '.join(dead_topics) or 'none'}"]
    facts = [("fleet-census",
              f"Fleet census {TODAY}: {live}/{len(modules)} can start by default",
              f"On disk {len(modules)} · subclass BaseAgent {len(subclassing)} · "
              f"registered {len(registered)} · OPTIONAL gated off {len(stubs)} "
              f"({', '.join(stubs) or '—'}) · unregistered "
              f"{', '.join(unregistered) or '—'} · dead subscribed topics "
              f"{', '.join(dead_topics) or '—'}. The gate is the registry "
              f"(AgentTier.OPTIONAL + is_enabled default-off), not a body "
              f"heuristic — corrected 2026-08-28 after the first census measured "
              f"the wrong gate and published 23 where the default-boot count "
              f"matches the charter's ≈18.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def harness_sentinel():
    agents_dir = ORCH / "agents"
    outside = []
    for f in sorted(agents_dir.glob("*.py")):
        if f.stem == "__init__":
            continue
        t = f.read_text()
        if re.search(r"^class\s+\w+", t, re.M) and not re.search(
                r"class\s+\w+\(\s*BaseAgent\s*[),]", t):
            outside.append(f.stem)
    core = ORCH / "core"
    core_lines = {f.name: len(f.read_text().splitlines())
                  for f in sorted(core.glob("*.py"))}
    tests = len(list((ORCH / "tests").glob("test_*.py")))
    metrics = {
        "harness.agents_without_harness_guarantees": len(outside),
        "harness.core_total_lines": sum(core_lines.values()),
        "harness.pytest_files": tests,
    }
    findings = [f"modules with a class outside BaseAgent: {', '.join(outside) or 'none'}",
                "core line count is the OD-03 sunk-cost meter baseline; "
                "the diet allows bug fixes, instrumentation, narrowing only"]
    facts = [("harness-contract-audit",
              f"Harness audit {TODAY}: {len(outside)} module(s) outside the contract",
              f"Outside BaseAgent: {', '.join(outside) or 'none'}. core/ totals "
              f"{sum(core_lines.values())} lines across {len(core_lines)} modules "
              f"(OD-03 sunk-cost baseline); {tests} pytest files hold the contract.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def spend_sentinel():
    url_hits = _grep_lines(GW, r"api\.anthropic\.com", ".ts", code_only=True)
    url_files = sorted({h[0] for h in url_hits})
    pin_hits = [h for h in _grep_lines(GW, r'["\'](claude|gemini|gpt)-[\w.-]+["\']',
                                       ".ts", code_only=True)
                if ".spec." not in h[0]]
    pin_values = sorted({m.group(0).strip("\"'") for _, _, l in pin_hits
                         if (m := re.search(r'["\'](?:claude|gemini|gpt)-[\w.-]+["\']', l))})
    unrouted = [f for f in url_files if "common/model-client" not in f]
    py_pins = [h for h in _grep_lines(ORCH, r'["\'](claude|gemini|gpt)-[\w.-]+["\']',
                                      ".py", code_only=True)
               if "/tests/" not in h[0]]
    metrics = {
        "routing.anthropic_url_constants": len(url_files),
        "routing.url_constants_outside_wrapper": len(unrouted),
        "routing.distinct_model_pins_gateway": len(pin_values),
        "routing.model_pin_sites_gateway": len(pin_hits),
        "routing.model_pin_sites_orchestrator": len(py_pins),
    }
    findings = [f"api.anthropic.com constants: {', '.join(url_files)}",
                f"gateway files outside the wrapper still holding the URL: "
                f"{', '.join(unrouted) or 'none — consolidation holds'}",
                f"distinct gateway model pins: {', '.join(pin_values)}"]
    facts = [("model-pin-census",
              f"Pin census {TODAY}: {len(unrouted)} URL constant(s) outside the wrapper",
              f"URL constants live in: {', '.join(url_files)}. Outside "
              f"common/model-client: {', '.join(unrouted) or 'none'}. Distinct "
              f"gateway pins ({len(pin_values)}): {', '.join(pin_values)}; "
              f"orchestrator pin sites: {len(py_pins)}. Cost/spend *values* need "
              f"the DB and are out of this runner's scope — not zero, unqueried.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def _skills_census():
    root = ROOT / ".claude" / "skills"
    skills = sorted(root.glob("*/SKILL.md"))
    rows = []
    for s in skills:
        text = s.read_text()
        fm = re.match(r"\A---\n(.*?)\n---", text, re.S)
        fields = set(re.findall(r"^(\w[\w-]*):", fm.group(1), re.M)) if fm else set()
        rows.append({
            "skill": s.parent.name,
            "has_name": "name" in fields, "has_description": "description" in fields,
            "trigger": bool(re.search(r"^##+\s*Trigger|^trigger:", text, re.M | re.I)),
            "doneability": bool(re.search(r"doneability", text, re.I)),
            "past_instance": bool(re.search(r"past instance", text, re.I)),
            "owner": bool(re.search(r"^owner:|owning", text, re.M | re.I)),
        })
    return rows


def registry_clerk():
    rows = _skills_census()
    compliant = [r for r in rows if all((r["trigger"], r["doneability"],
                                         r["past_instance"], r["owner"]))]
    metrics = {
        "skills.registry_size": len(rows),
        "skills.protocol_compliance_rate":
            (f"{len(compliant)}/{len(rows)}" if rows else "undefined — denominator 0"),
    }
    findings = ([f"{r['skill']}: " + ("compliant" if r in compliant else
                 "MISSING " + ", ".join(k for k in
                 ("trigger", "doneability", "past_instance", "owner") if not r[k]))
                 for r in rows] or ["registry empty — .claude/skills/ holds no SKILL.md"])
    facts = [("registry-index",
              f"Skill registry {TODAY}: {len(rows)} committed, "
              f"{len(compliant)} §3.3-compliant",
              "; ".join(f"{r['skill']}" for r in rows) or
              "Registry empty at census time.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def staleness_reaper():
    rows = _skills_census()
    metrics = {
        "skills.firing_rate_30d": "unmeasurable — nf_a.skill_id does not exist",
        "skills.deletions_per_quarter": 0,
        "skills.registry_size": len(rows),
    }
    findings = [(f"{r['skill']}: last fired UNMEASURABLE (no telemetry) — "
                 f"neither stale nor fresh; the gap is the finding") for r in rows] or \
               ["nothing to reap — registry empty"]
    facts = [("staleness-review",
              f"Staleness review {TODAY}: {len(rows)} skill(s), all unmeasurable",
              "Firing telemetry (nf_a.skill_id) does not exist; per the charter, "
              "unmeasurable is escalated, never counted as stale or fresh. "
              "Deletion count this quarter: 0 against "
              f"{len(rows)} addition(s) — the ratio to watch.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def _run_guard(cmd):
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=300)
        tail = (r.stdout.strip().splitlines() or ["(no output)"])[-1]
        return r.returncode, tail
    except Exception as e:  # noqa: BLE001 — a guard that cannot run is a finding
        return 2, f"could not run: {e}"


def claim_auditor():
    guards = {
        "decision-claims": ["bash", "scripts/check_decision_claims.sh"],
        "citation-pairing": ["python3", "scripts/check_citation_pairing.py"],
        "agent-card-contract": ["python3", "scripts/build_agent_card_index.py", "--check"],
    }
    results = {name: _run_guard(cmd) for name, cmd in guards.items()}
    metrics = {f"standards.{k}": ("PASS" if rc == 0 else f"FAIL(exit {rc})")
               for k, (rc, _) in results.items()}
    findings = [f"{k}: exit {rc} — {tail}" for k, (rc, tail) in results.items()]
    facts = [("guard-run",
              f"Guard run {TODAY}: " + ", ".join(
                  f"{k}={'PASS' if rc == 0 else 'FAIL'}"
                  for k, (rc, _) in results.items()),
              " | ".join(f"{k}: {tail}" for k, (_, tail) in results.items()))]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def gate_runner():
    script = ROOT / "scripts" / "check_task_types_are_graded.py"
    if not script.exists():
        return {"metrics": {"eval.verdict_coverage": "CANNOT CHECK — grader script missing"},
                "findings": ["scripts/check_task_types_are_graded.py not found"],
                "facts": []}
    rc, tail = _run_guard(["python3", str(script)])
    metrics = {"eval.graded_task_type_gate": "PASS" if rc == 0 else f"FAIL(exit {rc})"}
    findings = [f"check_task_types_are_graded: exit {rc} — {tail}"]
    facts = [("coverage-gate",
              f"Coverage gate {TODAY}: {'PASS' if rc == 0 else 'FAIL'}",
              f"scripts/check_task_types_are_graded.py exited {rc}: {tail}. "
              "This wraps the operations half only; verdict *values* live in the "
              "DB and are out of this runner's scope.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


def kd_ledger():
    md = [p for p in P.rglob("*.md") if ".obsidian" not in p.parts]
    top = [p for p in P.iterdir() if p.suffix == ".md"]
    stacks = [p for p in md if p.name.endswith("-agent-stack.md")]
    metrics = {
        "kd.planning_md_total": len(md),
        "kd.top_level_md": len(top),
        "kd.agent_stack_docs": len(stacks),
    }
    findings = [f"top-level spine files: {', '.join(sorted(p.name for p in top))}"]
    facts = [("vault-census",
              f"Vault census {TODAY}: {len(md)} md files, {len(top)} top-level",
              f"{len(md)} markdown files under .planning ({len(stacks)} agent-stack "
              f"docs); top level holds {len(top)}: "
              f"{', '.join(sorted(p.name for p in top))}. Growth without retirement "
              "is the ratio the retire-to-write rule watches.")]
    return {"metrics": metrics, "findings": findings, "facts": facts}


IMPLEMENTED = {
    "fleet-census-agent": ("agent-fleet", fleet_census_agent),
    "harness-sentinel": ("harness-runtime", harness_sentinel),
    "spend-sentinel": ("model-routing-inference-economics", spend_sentinel),
    "registry-clerk": ("skill-registry-authoring", registry_clerk),
    "staleness-reaper": ("skill-lifecycle-anti-sprawl", staleness_reaper),
    "claim-auditor": ("standards-verification", claim_auditor),
    "gate-runner": ("agent-evaluation-gates", gate_runner),
    "kd-ledger": ("knowledge-documentation", kd_ledger),
}

# Boundary discipline (2026-08-28 audit finding, ADR 0038 correction): only
# mechanical cards run here — EXCEPT an agent whose card is judgment/extraction
# but whose implemented function is strictly the mechanical SUB-DUTY of that
# card (a census or a wrapped guard, never the judgment itself). Each such
# exception is named here with its sub-duty; an implemented agent that is
# neither mechanical nor listed is refused at runtime.
MECHANICAL_SUBDUTY = {
    "registry-clerk": "registry census only (§3.3 field presence); the gate "
                      "review — 'is this past instance real?' — stays human",
    "claim-auditor": "wraps the three existing guards and reports exit codes; "
                     "judges nothing itself",
    "gate-runner": "wraps scripts/check_task_types_are_graded.py; grades no task",
    "kd-ledger": "file-count census; no corpus judgment",
}


def write_memory(unit_path: str, slug: str, facts):
    unit_dir = P / pathlib.Path(unit_path).parent
    mem = unit_dir / "memory"
    mem.mkdir(exist_ok=True)
    idx = mem / f"{slug}-MEMORY.md"
    lines = idx.read_text().splitlines() if idx.exists() else [
        f"# {slug} — memory index",
        "",
        f"> Semantic memory per ADR 0034 §4 — one fact per file, written only by",
        f"> `scripts/agents/run_card.py --write-memory`, landed via PR. Provenance",
        f"> frontmatter on every fact.", ""]
    written = []
    for fslug, title, body in facts:
        fname = f"{TODAY}-{fslug}.md"
        (mem / fname).write_text(
            "---\n"
            f"type: fact\nunit: {slug}\nsource: scripts/agents/run_card.py ({TODAY})\n"
            f"confidence: measured\nlast_verified: {TODAY}\n"
            "---\n\n"
            f"# {title}\n\n{body}\n")
        entry = f"- [{title}]({fname})"
        if entry not in lines:
            lines.append(entry)
        written.append(str((mem / fname).relative_to(ROOT)))
    idx.write_text("\n".join(lines) + "\n")
    return written


def main():
    cards = _cards()
    mech = {a for a, c in cards.items() if c["routing_class"] == "mechanical"}
    reports, wrote = [], []
    for agent, (unit, fn) in IMPLEMENTED.items():
        if ONLY and agent != ONLY:
            continue
        if agent not in cards:
            print(f"WARN: {agent} has no card in cards.json — refusing to run "
                  f"an undeclared agent")
            continue
        if agent not in mech and agent not in MECHANICAL_SUBDUTY:
            print(f"REFUSED: {agent} card is "
                  f"{cards[agent]['routing_class']} and it is not in "
                  f"MECHANICAL_SUBDUTY — running it would cross the ADR 0038 "
                  f"boundary")
            continue
        r = fn()
        r.update(agent=agent, unit=unit, ran_at=TODAY)
        reports.append(r)
        if WRITE_MEMORY and r["facts"]:
            wrote += write_memory(cards[agent]["path"], unit, r["facts"])

    unimplemented = sorted(mech - set(IMPLEMENTED))
    out = {"ran": reports, "mechanical_cards_total": len(mech),
           "implemented_mechanical": sorted(set(IMPLEMENTED) & mech),
           "implemented_mechanical_subduty": {k: MECHANICAL_SUBDUTY[k]
                                              for k in sorted(
                                                  set(IMPLEMENTED)
                                                  & set(MECHANICAL_SUBDUTY))},
           "mechanical_unimplemented": unimplemented,
           "memory_files_written": wrote}
    if JSON_OUT:
        print(json.dumps(out, indent=1, ensure_ascii=False))
        return
    print(f"== run_card: {len(reports)} agent(s) ran · "
          f"{len(mech)} mechanical cards declared · "
          f"{len(unimplemented)} mechanical not yet implemented")
    for r in reports:
        print(f"\n-- {r['agent']} ({r['unit']})")
        for k, v in r["metrics"].items():
            print(f"   {k} = {v}")
        for fdg in r["findings"]:
            print(f"   · {fdg}")
    if wrote:
        print(f"\nmemory facts written ({len(wrote)}):")
        for w in wrote:
            print(f"   {w}")
    print(f"\nmechanical, declared, not implemented ({len(unimplemented)}):")
    print("   " + ", ".join(unimplemented))


if __name__ == "__main__":
    main()
