---
type: agent-stack
division: product
department: design
team: design-system-motion-substrate
status: designed
updated: 2026-08-27
metrics: [design.system_composition_pct, design.token_source_count, design.primitive_documented_ratio, design.a11y_violations_per_pr, design.bespoke_components_added]
links: ["[[design-system-motion-substrate-charter]]", "[[design-system-motion-substrate-schedule]]", "[[design-system-motion-substrate-loops]]", "[[design-system-motion-substrate-premortem]]", "[[0034-agent-stack-artifact]]", "[[design-agent-stack]]", "[[skills-charter]]", "[[exploration-studio-agent-stack]]", "[[ux-path-burn-down-agent-stack]]", "[[media-brand-charter]]", "[[client-surfaces-charter]]"]
---

# Design System & Motion Substrate — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only Design team whose customer is other teams, so its agent is a **census and a set of
> reports**, not an author: it counts what leaks, names it by value and `path:line`, and hands
> the reading to a human. It is also the card most constrained by an open fork — **OD-106**
> (OD-106, `decisions/OPEN-DECISIONS.md:64`) is deferred to founder co-design, **documentation only**,
> and no line below may propose building the foundation.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `substrate-census` | Keep the four substrate numbers true — token sources and their divergent values *by name*, primitives with stories, §X rules enforced, bespoke components added — and report per-PR violations without owning the machinery that blocks a build | NEW |

One row. The per-PR gates are three reports from one census, not three agents; and the
Storybook/lint machinery itself is [[engineering-charter]] / [[client-surfaces-charter]]'s
(charter §Non-goals), so this card produces findings, never CI configuration.

## 2. Agent cards

```yaml
agent: substrate-census
unit: design-system-motion-substrate
triggers:
  - topic: pr.opened            # publisher: .github/workflows/ci.yml:14 (pull_request) — EXISTS, though no design-lint job consumes it yet
  - schedule: "weekly — a11y enforcement progress (which of the 10 §X rules are live)"     # [[design-system-motion-substrate-schedule]]
  - schedule: "monthly — token divergence diff and substrate census"
consumes:
  - "packages/ui/src/ (primitives, layout, charts, notifications — zero .stories.tsx) and apps/web/src/components/ui/ (26 .tsx, 5 stories)"
  - "the two token sources: apps/web's Tailwind layer (tailwind.config.js) and apps/mobile/src/design/tokens.ts"
  - "§X accessibility rows NEW-667…676 (UX_PATHS_CATALOG.md:1493) — the standard this team enforces for [[ux-path-burn-down-agent-stack]]"
  - "the motion specs in sketches 043–046 and the stack decision in 042, as published by [[exploration-studio-agent-stack]]"
emits:
  - "per-PR findings: missing token reference, missing story, §X violation, next/* import in a Vite SPA (apps/web/package.json:8,55,94)"
  - "design.token_source_count, design.token_divergence_values, design.primitive_documented_ratio, design.a11y_rules_enforced, design.bespoke_components_added → [[design-agent-stack]] board rollup"
  - "brand-string occurrences (\"WineOps AI\") → [[media-brand-charter]] as a list, quarterly"
  - nf_a events (task_type: substrate_census)
routing_class: mechanical      # count files, diff token values, match imports — no judgment call in the loop
quality_bar: "reproducible — a rerun on the same commit yields the same counts; each of the 10 §X rules reported as enforced-in-CI or unenforced-with-a-named-owner, never omitted. NONE (gap) — ADR 0017 has no verdict grader for lint-style reports"
autonomy:
  read: autonomous
  propose: autonomous          # story scaffolds and findings land as PRs a human merges
  mutate_stock_money_outbound: confirm    # constant; this agent has no such surface
memory: design-system-motion-substrate
escalates_to: "[[design-charter]]"
```

**Three hard rules.** (1) **OD-106 stays open here.** The census may report that two
burgundies are in circulation — `apps/web/tailwind.config.js:31` `#9E4249` versus
`sketches/themes/default.css:6` `#CD2D5B`, both verified on disk this session — and may not
propose which survives; that is the founder's deferred, documentation-only call. (2) It may
not reopen sketch **042** (*H — RN Skia + Reanimated*), which is decided. (3) It reports the
count of undocumented primitives and does not backfill the whole back-catalogue, because a
team measured on its own back-catalogue builds a museum (premortem M1).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `design-token-census` | T2 | Monthly, and on any token edit | Both sources enumerated; divergent values listed **by name**; count published | **`apps/mobile/src/design/tokens.ts` became a second token source with no recorded decision**, and the same drift produced two live burgundies — the finding OD-106 was filed on (`OPEN-DECISIONS.md:64`) | NEW |
| `a11y-path-audit` | T2 | Per PR, plus a quarterly full sweep | Each §X rule is either enforced in CI or listed as unenforced with a named owner | **§X `NEW-667…676`** (`UX_PATHS_CATALOG.md:1493`) written in July as prose and enforced nowhere since — 0 of 10 rules live | NEW |
| `primitive-story-scaffold` | T2 | A primitive lands with no story | The story exists and renders every documented state | **`packages/ui` has 0 stories** while `apps/web`'s 28 story files cluster in `src/stories/` rather than beside the primitives that ship — the shared package is the least documented thing in the repo | NEW |

Two rows on [[design-system-motion-substrate-schedule]] are deliberately **not** here.
`motion-spec-trace` and `bespoke-component-detect` both cite an absence (*"0 named winners"*,
*"nothing counts this today"*) rather than an instance where the procedure was performed —
README §3.3 rule 3 deletes such rows. They remain scheduled jobs; the first hand-run of each
becomes the instance that creates the row.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); the CI
machinery the findings would eventually run inside ([[client-surfaces-charter]]).

## 4. Memory

- **Procedural** — the three §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  still through the §3.3 gate.
- **Episodic** — nf_a `task_type: substrate_census`. Needs `context.surface`
  (`apps/web` / `apps/mobile` / `packages/ui`) as a jsonb key, because this is the only
  Design team spanning three, and a number that cannot be split by surface hides the mobile
  zero behind the web five.
- **Semantic** — `memory/` beside this file, `design-system-motion-substrate-MEMORY.md` as
  index, one fact per file with `source` / `confidence` / `last_verified`. Founding facts: the
  two token sources and their divergent burgundies; `packages/ui` at zero stories; §X at 0 of
  10 enforced; the stale `"WineOps AI"` string in `MANIFEST.md`. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the §X row range. Token
  files and primitive directories are retrieved by `path:line` on demand.

**Consolidation** — monthly, alongside the substrate census in
[[design-system-motion-substrate-schedule]]: read the month's per-PR findings; **failures
first** — a diverged token value becomes a fact naming the mechanism (*"a second source can be
added without a decision"*), not the value; a §X rule unenforced for three months becomes a
fact about the owner gap; expire facts unverified 90 days; propose skill candidates. One PR;
"no delta" stated when true.

## 5. Async contract

Interaction is loops ([[design-system-motion-substrate-loops]]), NF-A events, and vault PRs.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| Findings have no enforcing consumer | `.github/workflows/ci.yml` runs 15 jobs and **none is a design lint or an axe check** (checked this session); until the machinery owner accepts the job, every violation is a report a human may ignore — the difference between a standard and a wish |
| `design.system_composition_pct` has no denominator | *"Newly-shipped surface"* is undefined; the charter names defining it as the first deliverable, so the census reports the metric as **undefined**, not as a number |
| The motion publisher exists but has nothing to publish | [[exploration-studio-agent-stack]] is the named publisher of winners; sketches 043–046 carry **0 of 4**, so the trace has no reference set and says so |
| Brand-string list reaches [[media-brand-charter]] as a PR | Acceptable async path, but nothing notifies; their schedule must poll the quarterly sweep output |

## 6. Evidence today

- **PARTIAL — real substrate, thin coverage.** `packages/ui/src/` is a genuine shared workspace
  package with **zero stories**; `apps/web/src/components/ui/` holds 26 `.tsx` with **5
  stories**; `apps/mobile/src/design/tokens.ts` is a second token source and `apps/mobile` has
  zero stories ([[design-system-motion-substrate-charter]] §Evidence; token files re-verified
  on disk this session).
- **EXISTS — the trigger substrate.** `.github/workflows/ci.yml:14` fires on `pull_request`, so
  `pr.opened` has a real publisher even though none of the workflow's 15 jobs consumes it for
  design or a11y.
- **EXISTS — the motion specification, unconverged.** Sketches 043–046 carry nine motions with
  *trigger / motion / haptic / anti-gimmick* contracts; **all four are `Winner: null`**.
- **NEW — the agent, all three skills, and every §4 layer** except the NF-A tables themselves
  (ADR 0006/0008). `design.a11y_violations_per_pr` and `design.bespoke_components_added` have
  never been counted once.
