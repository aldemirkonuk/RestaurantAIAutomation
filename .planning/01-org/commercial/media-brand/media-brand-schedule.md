---
type: schedule
division: commercial
department: media-brand
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-loops]]"
  - "[[brand-identity-schedule]]"
  - "[[narrative-collateral-schedule]]"
  - "[[social-community-schedule]]"
  - "[[customer-relationship-research-schedule]]"
---

# Media & Brand — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | `brand-guard` CI check — tier-1 legacy references must be 0, tier-2 count must not grow | CI pass/fail |
| Weekly | Brand surface burndown — run both scan patterns, report both counts, diff against last week | `legacy-brand-surface-burndown` |
| Weekly | Consent-register reconciliation — subjects touched vs approved, withdrawal sweep | `consent-register-reconciliation` |
| Weekly | M3 trigger watch — has any article cleared G3? One line, yes or no | — |
| Monthly | Headline-claim audit — every outward artifact checked against the one sentence | `headline-claim-consistency` |
| Monthly | Agenda sync — full vs board agendas drifted? ([README §6](../../../foundation/README.md)) | — |
| Quarterly | Outward surface inventory — enumerate every place a third party meets this company | `outward-surface-inventory` |
| Quarterly | Reference shortlist review — verify or drop unverified entries | — |

**Three of these are currently unrunnable and are listed anyway, marked:** the consent
reconciliation has no register to read; the M3 trigger watch will return "no" until Growth
produces; the headline-claim audit has no artifacts to audit. Listing them as scheduled with
a known-empty result is deliberate — it is the difference between a job that has not started
and a job nobody remembered to create.

**Anti-sprawl, applied to this table.** A scheduled job that produces no action for three
consecutive runs is downgraded or deleted ([README §6](../../../foundation/README.md)). The
M3 trigger watch is explicitly exempt while M3 is dormant: its job is to fire once, and a
watch that returns "no" is doing exactly what it was built for. Every other row is subject
to the rule.

## Skills owned

Skills live in `.claude/skills/`. **State today: none of the below exist.** The repo has
exactly one project skill, `.agents/skills/railway-config/SKILL.md`, and root `SKILLS.md`
is a prose reasoning protocol rather than a skill — and still says "WineOps AI", which is
tracked separately as [OD-14](../../../decisions/OPEN-DECISIONS.md) and is also, awkwardly,
this department's own defect.

Each skill below carries the four things [README §3.3](../../../foundation/README.md)
requires before commit: trigger, doneability, a real past instance, and an owner.

---

### `brand-surface-scan` — T2 department

- **Trigger.** Weekly, plus before any release, plus on demand when someone claims the
  rename is done.
- **Doneability.** Emits two counts (name pattern, domain pattern) tiered into
  rendered/transmitted, internal, and identifier classes, with `path:line` for every tier-1
  hit. Succeeds when the output is reproducible by a second run on the same tree.
- **Real past instance.** This one, twice. A host-based scan reported 10 references
  ([EXTERNAL_CONNECTIONS.md:15](../../../foundation/EXTERNAL_CONNECTIONS.md)); a
  domain-based follow-up reported 33; both were structurally blind to
  `apps/web/index.html:7`, `apps/web/public/manifest.json:2`, and `apps/mobile/app.json:3`,
  which are the most visible instances in the product.
- **Owner.** M1 Brand Identity.

### `brand-guard-ci` — T3 operational, owned here

- **Trigger.** Every pull request.
- **Doneability.** Fails the build when a tier-1 legacy reference is introduced or survives.
  Runs over generated output too — `apps/api-gateway/openapi.json` and `dist/` are rebuilt,
  not edited, so a green source tree can still ship a stale artifact.
- **Real past instance.** The rename was declared complete in the planning corpus and 33
  domain lines plus 351 name lines survived in shipped code. A cleanup without a guard is a
  cleanup that gets undone; same shape as Security's first assignment
  ([README §2.3](../../../foundation/README.md)).
- **Owner.** M1, implemented with Engineering in `.github/workflows/ci.yml`.

### `voice-guide-check` — T2 department

- **Trigger.** Invoked by G3 during the mandatory editorial pass, and by M2 before any
  artifact leaves.
- **Doneability.** Returns the specific clause violated, not a verdict. "Feels off-brand" is
  not an output.
- **Real past instance.** None yet — the voice guide does not exist. **This skill is not
  built until it does**, per the no-speculative-skills rule.
- **Owner.** M1 writes the guide; G3 fires the skill.

### `headline-claim-check` — T2 department

- **Trigger.** Any outward artifact, before it leaves.
- **Doneability.** Binary: does the artifact lead with the sentence at
  [YC_WEDGE_PLAN.md:312](../../YC_WEDGE_PLAN.md)? Plus a flag on every number lacking a
  source line.
- **Real past instance.** [YC_WEDGE_PLAN.md:323](../../YC_WEDGE_PLAN.md) documents the repo
  already failing this test in product form — sommelier, calendar, promotions, 573 insight
  types, an 860-path UX catalogue. The collateral will inherit the same instinct.
- **Owner.** M2 Narrative & Collateral.

### `consent-register-check` — T2 department, **gate not tool**

- **Trigger.** Before any research touch, and weekly as a sweep.
- **Doneability.** Returns eligible / not eligible / no register, and refuses rather than
  guessing. `no register` is a terminal answer, not a warning.
- **Real past instance.** None, and that is the finding: the practice is being chartered
  before its gate exists, which is the ordering the premortem names as the failure.
- **Owner.** M4, with the mechanism reviewed by Compliance & Privacy.

### `reference-shortlist-verify` — T2 department

- **Trigger.** Quarterly, and before any item on the shortlist is adopted.
- **Doneability.** Each entry resolves to a confirmed identity plus a named need, or is
  dropped. Unverified entries stay unverified in writing; they are never quietly promoted.
- **Real past instance.** Twelve references were named in one conversation; five have
  unverified spellings and two have no URL at all. Recording them without a verification
  step is how an unverified name becomes a dependency.
- **Owner.** M1.

---

## Skills this department deliberately does not own

| Skill | Owner | Why not here |
|---|---|---|
| `seo-article-pipeline` ([README §3.2](../../../foundation/README.md)) | Growth | We define the voice; they run the pipeline |
| Any design-system or component skill | Product → Design | Outward creative is not product interaction |
| Package/scope rename tooling | Engineering | CM-F5 |
