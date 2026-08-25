---
type: schedule
division: commercial
department: media-brand
team: narrative-collateral
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[narrative-collateral-charter]]"
  - "[[narrative-collateral-loops]]"
  - "[[media-brand-schedule]]"
---

# Narrative & Collateral (M2) — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per artifact | Pre-flight sequence — sentence first, numbers source-lined, nothing above the ask that is not the wedge | `claim-substantiation` |
| Weekly | Blocked-input watch — visual reference, recovery number, `DEP-06`; report days blocked | `collateral-blocked-inputs` |
| Monthly | Headline-claim audit across every outward artifact; count distinct headline claims | `headline-claim-consistency-m2` |
| Quarterly | Narrative freshness — is the story older than the argument it rests on? | `narrative-freshness` |

**Three of the four have nothing to run on today.** There are no artifacts, so the
per-artifact and monthly jobs return empty. This is stated rather than hidden: an empty run
is a correct result while the team is producing its first document, and the
three-runs-no-action rule ([README §6](../../../../../foundation/README.md)) starts counting
once the first artifact exists, not before.

The weekly blocked-input watch is the only job with real work today, and it is the smallest
one.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet.** Each carries the four things
[README §3.3](../../../../../foundation/README.md) requires.

---

### `headline-claim-check` — T2 department

- **Trigger.** Any outward artifact, before it leaves. Also run in bulk during the monthly
  audit.
- **Doneability.** Two outputs: (a) does the artifact lead with the sentence at
  [YC_WEDGE_PLAN.md:312](../../../../YC_WEDGE_PLAN.md), yes or no; (b) a list of every
  number in the artifact with its source line, or `MISSING`. Any `MISSING` fails the run.
- **Real past instance.** [YC_WEDGE_PLAN.md:323](../../../../YC_WEDGE_PLAN.md) records the
  product already failing this test — a sommelier AI, a calendar, promotions, 573 insight
  types, an 860-path UX catalogue, a UX optimizer, a wine library, and a reader who
  concludes there is no wedge. The collateral will inherit the same instinct because every
  one of those is real work someone did.
- **Owner.** M2. Fired by M2; its number-checking half is consumed by G3.

### `artifact-preflight` — T2 department

- **Trigger.** Before any artifact is exported, sent, or presented.
- **Doneability.** Walks the sequence in [[narrative-collateral-directive]] and returns the
  first failing step, not a score. Refuses to pass an internal artifact that is being sent
  outward.
- **Real past instance.** Not yet — but the mechanism it guards is documented: premortem
  mechanism 2 describes an internal deck going out because it was the only deck available on
  a deadline. **Built when the first artifact exists**, not before, per the
  no-speculative-skills rule.
- **Owner.** M2.

### `demo-script-render` — T2 department

- **Trigger.** When the sixty-second demo is recorded or re-recorded.
- **Doneability.** Produces a shot-by-shot script from
  [YC_WEDGE_PLAN.md](../../../../YC_WEDGE_PLAN.md) §3, and stamps the recording as a *demo
  build* whenever `DEP-06` is unchecked.
- **Real past instance.** None. Deferred until there is a demo to record — the invoice half
  is still typed by hand per line item
  (`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:401,440`), so the sixty
  seconds cannot yet be filmed honestly.
- **Owner.** M2, with S1 supplying the invoice.

---

## Explicitly not owned here

| Work | Owner | Why |
|---|---|---|
| Producing the recovery number | Sales S1 | We report it; estimating it is the premortem's third mechanism |
| Verifying a claim | Growth G3 | A team may not fact-check its own deck |
| The YC application and its timing | Strategy & Fundraising | We own the craft, not the path |
| The voice guide | Brand Identity M1 | We apply it |
| Any product screen in a mockup | Product → Design | A deck is outward creative; a screen is not |
