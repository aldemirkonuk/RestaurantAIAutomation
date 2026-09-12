---
type: agent-stack
division: commercial
department: media-brand
team: brand-identity
status: designed
updated: 2026-08-27
metrics: []
links: ["[[brand-identity-charter]]", "[[brand-identity-schedule]]", "[[brand-identity-loops]]", "[[brand-identity-directive]]", "[[0034-agent-stack-artifact]]", "[[media-brand-agent-stack]]", "[[skills-charter]]", "[[editorial-gate-charter]]"]
---

# Brand Identity (M1) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The one team in Media & Brand whose primary metric is measurable today, so its card is the
> most concrete in the department — and the most constrained: it measures and proposes, and a
> human lands every change to a string a third party reads. The standing hold on landing-page
> and Blender visuals (`decisions/README.md:76`) sits over this team; no card here proposes
> visual treatment.
>
> `metrics: []` is copied verbatim from [[brand-identity-charter]]. The primary metric is real
> but has no NF namespace: **two counts** (name, domain) of legacy-brand references in shipped
> surfaces, target 0, baseline **351 / 193 files** and **33 / 25 files**. Reporting one number
> is itself the failure mode (charter §Metrics).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `brand-surface-sentinel` | Run both scan patterns, tier every hit, keep the two counts and the tier-1 rows true across source *and* generated output — and never edit an outward string on its own authority | NEW |

## 2. Agent cards

```yaml
agent: brand-surface-sentinel
unit: brand-identity
triggers:
  - schedule: "weekly — two-pattern surface scan"        # mirrored in [[brand-identity-schedule]]
  - topic: pr.opened                                      # publisher: GitHub Actions via `.github/workflows/ci.yml` (exists)
  - schedule: "per release — rescan generated artifacts after rebuild"   # publisher for a release event: NONE (gap — no release signal is named anywhere in this team's docs)
consumes:
  - the working tree, excluding `md/`, `md_files/`, `.planning/`, `*.md`, `pnpm-lock.yaml` (the exclusions that make the counts reproducible — charter §The audit)
  - "the tier classification in [[brand-identity-charter]] §Tier 1 / §Tier 2 / §Tier 3"
  - "`scripts/render_system_atlas.py:109` — the repo's existing single-pattern detector"
  - "generated output: `apps/api-gateway/openapi.json`, `apps/api-gateway/dist/`"
emits:
  - "`legacy-name-burndown` and `legacy-domain-burndown` (close_time weekly, [[brand-identity-loops]]) → consumed by [[media-brand-agent-stack|mb-outward-warden]]'s board"
  - "`brand-guard-regression` (close_time per-pr) → consumed by the PR author, in the CI failure message"
  - proposed string changes as PRs — never applied by the agent
routing_class: mechanical      # grep, tier, count, diff; the only judgment is tier assignment, and the tiers are already written down
quality_bar: "reproducible: a second run on the same commit yields the same two counts and the same tier per hit; a run emitting one aggregate number is a failed run (charter §Metrics). NONE (gap) for a formal verdict basis — ADR 0017 has no grader for scans"
autonomy:
  read: autonomous
  propose: autonomous          # scan output, tier tables, and rename PRs
  mutate_stock_money_outbound: confirm   # constant — and it bites literally here: the `From:` header, the crawler User-Agent, the OpenAPI server, and the iCal PRODID are outbound surfaces, so renaming them is a confirm, not a string edit
memory: brand-identity
escalates_to: "[[media-brand-charter]]"
```

**The card's own hard rules.** It never touches tier 3 — `package.json:2`, `@wineops/*`
scopes, `docker-compose.yml` names, `.railway/railway.ts`, `vercel.json` belong to
[[engineering-charter|Engineering]] under fork **CM-F5**. It never enforces the voice guide on
published copy; that is [[editorial-gate-charter|G3]]'s, and a guide enforced by its author is
an opinion (charter §Non-goals).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `brand-surface-scan` | T2 | Weekly; before any release; immediately whenever someone states the rename is complete | Name and domain counts emitted **separately**, every hit tiered 1/2/3, `path:line` for every tier-1 row, tier 1 grouped by surface class | Twice on this exact problem. Host-scoped scan → **10** (`foundation/EXTERNAL_CONNECTIONS.md:15`); domain-scoped correction → **33** (`foundation/teams/commercial.md` §4.1); neither could see `apps/web/index.html:7`, `apps/web/public/manifest.json:2`, or `apps/mobile/app.json:3`, and the name surface is **351 / 193** (`brand-identity-charter.md:51-68`) | NEW |
| `brand-guard-ci` | T3 | Every pull request and every release build | Non-zero exit when a tier-1 reference exists or is introduced, generated output included; names the class that regressed | The rename was declared complete in the planning corpus and **384 lines survived** across the two patterns; `scripts/render_system_atlas.py:109` already ships a detector for one of the two patterns, which is exactly how the name surface stayed invisible | NEW |
| `reference-shortlist-verify` | T2 | Quarterly, and before any shortlist item is adopted | Each entry ends *verified + named need* or *dropped*; there is no "probably fine" state | Twelve references named in one 2026-08-24 conversation — five spellings unconfirmed, two with no URL, no site fetched (`brand-identity-schedule.md:90-94`) | NEW |

**`voice-guide-check` is deliberately absent.** Its past instance is None because the voice
guide does not exist yet ([[brand-identity-schedule]]), and README §3.3 deletes such a row
rather than keeping it as an aspiration; its owner stays recorded in the schedule.

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]) · the editorial pass
that fires `voice-guide-check` once it exists ([[editorial-gate-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate intact.
- **Episodic** — nf_a `task_type: brand_surface_scan`, one event per run, with `context.pattern`
  (name | domain) and `context.tier` as jsonb keys so the two numbers never collapse into one
  at query time either. Per-PR guard runs are the same family with `context.trigger: pr`.
- **Semantic** — `memory/` beside this file, `brand-identity-MEMORY.md` as index. Its first
  four facts are already established and would be written on day one: the two baselines
  (351/193, 33/25, source: charter §The audit, 2026-08-24); that two prior corrections were
  each right about the blind spot and understated it; that a green source tree can still ship a
  stale generated artifact; and the **retirement fact** — when tier 1 reaches zero, both weekly
  loops are deleted and the per-PR guard becomes the whole mechanism ([[brand-identity-schedule]]
  §Retirement plan), which the memory holds so the deletion is deliberate rather than done by
  the three-runs-no-action rule.
- **Working** — this card, the MEMORY index, charter §Mandate and the tier definitions. The 193
  files carrying the name are **retrieval targets by `path:line`**, never preloaded.

**Consolidation** — monthly, mirrored on the voice-guide-conformance row in
[[brand-identity-schedule]]: diff this month's tier-1 rows against last month's facts;
**failures first** — a cleared surface that came back becomes a fact naming the mechanism (new
code cloned from old code, or a regenerated artifact), because that is the failure path the
guard note in the schedule already predicts; expire facts unverified for 90 days; propose skill
candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction: loop rows to the department board (vault PR), the CI failure message,
NF-A events, and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| No release event to trigger the generated-artifact rescan | `openapi.json` and `dist/` are rebuilt, not edited; nothing announces a rebuild, so the per-release row has no publisher and the weekly scan is the fallback |
| G3's rejections reach M1 by reading, not by event | The monthly "amend the guide where a rejection could not cite a clause" job polls [[editorial-gate-charter]]; nothing notifies |
| Tier-3 identifiers have an owner but no open decision | CM-F5 is a fork, not an assignment; until it closes, `@wineops/*` stays outside every count here — stated on the board so the zero is not read as "everything is renamed" |
| `support@wineops.ai` blocks a sibling | [[social-community-charter]] cannot publish a reply-routing rule while the address is the previous company's (`apps/web/src/pages/Help.tsx:18`) — this team's defect, another team's blocker |

## 6. Evidence today

- **EXISTS — the defect the sentinel measures.** Every tier-1 row was read from the working
  tree on 2026-08-24 (`brand-identity-charter.md:70-104`): `apps/mobile/app.json:3`,
  `apps/mobile/app/lock.tsx:31`, `apps/mobile/src/lib/push.ts:32`, `apps/web/public/sw.js:67`,
  `apps/api-gateway/src/calendar/calendar.service.ts:1204`,
  `apps/api-gateway/src/auth/auth.service.ts:710,735,757`.
- **PARTIAL — the detector.** `scripts/render_system_atlas.py:109` carries the domain pattern
  and only the domain pattern. Half the required scan exists and is the reason the other half
  went unseen.
- **PARTIAL — the CI surface.** `.github/workflows/ci.yml` exists and runs; no brand guard is in it.
- **NEW — the sentinel, all three skills, and everything in §4.** The scans cited as past
  instances were run by hand in planning sessions, not by any committed skill.
