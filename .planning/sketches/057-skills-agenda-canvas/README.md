# Sketch 057 · Skills Agenda Canvas

**Design question:** Can a department agenda be read as one picture — where the pressure enters, where the gate leaks, and where the brake is missing — instead of a task list that hides its own critical path?

**Context:** The wave-3 canvas for `01-org/applied-ai/skills` (ADR 0039 Track B, `GENERATION_BRIEF.md` §8.2.5). One HTML page, self-contained, throwaway-grade. It renders [[skills-agenda-full]] and [[skills-agenda-board]]; if the two disagree, the agenda is right and this file is stale.

## Direction

A department whose whole job is *counter-pressure* should be drawn as a pipe under pressure, not as a roadmap. The page has exactly one argument and three views of it.

| | |
|--|--|
| **Domain** | Registry, gate, telemetry, deletion — the skill lifecycle |
| **Signature** | The pressure diagram: `84 + 233 → §3.3 gate → 4 → [break] → 0` |
| **Color world** | Near-black panels; green = unblocked, red = blocked on Track A4, amber = built-now-armed-later, violet = reach |
| **Rejects** | Progress bars (nothing here has a percentage); a Gantt (dates are close-times, not durations); any rendering of `firing_rate_30d` as `0` — it is *unmeasurable*, and the two defaults point opposite ways |

## The three views

1. **Pressure diagram** — the funnel, left to right, with a deliberate visual break at the stage that cannot run. The break is the point: an inflow 58× the registry, a gate that reports instead of blocking, and no removal path.
2. **Swimlanes** — the 14 tasks by owning team across seven close-dates (2026-09-04 → 2026-11-24). The fourth lane, `skill-harvesting`, is drawn as a single spanning row that says *nobody works here* — the gate is honored on the canvas, not just in the prose.
3. **Seams and refusals** — every cross-unit ask paired with the five things the agenda deliberately does not do.

## Numbers on the page, and how to re-derive them

Every figure is measured, not asserted. Re-derive before trusting:

| Figure | Command |
|---|---|
| 4 committed skills, 4/4 compliant | `python3 scripts/agents/run_card.py --agent registry-clerk` |
| 84 `scripts/` entries · 21 `check_*` guards | `ls scripts/ \| wc -l` · `ls scripts/check_*` |
| 16 CI-wired guards | `grep -c "scripts/check_" .github/workflows/ci.yml` |
| 233 proposed-skill rows / 228 distinct / 187 citable / 5 collisions / 1 T4 | parse `## 3. Skills` across every `*-agent-stack.md` |
| 40 unit docs · 32 dated 2026-08-24 | `find .planning/01-org/applied-ai/skills -name '*.md' \| wc -l` |

## Deliberate omissions

- **No telemetry chart.** `nf_a.skill_id` does not exist; drawing an empty chart would imply a series that will fill in. The break in the pipe is the honest rendering.
- **No ceiling `N` on the page.** It is the founder's number. SK-8 ships the guard disarmed and the canvas says so rather than picking a placeholder that would get quoted back as a decision.
- **No burn-down.** The department's failure mode is a *growing* registry with zero deletions; a chart that only goes down would draw the wrong instinct.

## Open

- The canvas has no live data binding — it is a snapshot dated 2026-08-28. The moment `run_card.py` runs on a cron (Track A4, SRE), the counters here should either be regenerated or the page retired.
- If OD-25 or TECH-F4 close, two lanes change owner. That is a redraw, not an edit.
