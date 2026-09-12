# 0059 — Receiving preserves the pair

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** label preservation, machine proposal, human judgement, receiving, entity resolution, negative class, extraction_model, neural footprint, training corpus
- **Links:** `[[0048-domain-quant-under-research-math]]` (food into math), `[[0051-rebuilt-pages-show-live-data-only]]` (absence is not agreement), `[[0037-nfb-erasure-is-crypto-shredding]]` (why footprints are erasable), `.planning/06-pages/receiving.md` §14d, PR for `feat/receiving-preserves-the-pair`

## Context

Receiving is the only place in this product where a number is produced by a
person touching an object. A receiver counts cases against a packing slip a
model just read; a manager corrects an invoice quantity a model just extracted;
someone confirms or rejects a pairing a matcher just proposed. Each of those is
a **machine proposal judged by a human against physical reality** — which is
exactly the shape of a training label, and it is the shape this product is
structurally best placed in the world to collect.

Six such pairs exist on the receiving path. **Four of them destroyed the
machine's half at the instant it became a label.** The cleanest instance is two
lines in `apps/api-gateway/src/procurement/documents/documents.controller.ts:244-245`:

```ts
// A person confirmed it, so confidence is not a model's estimate any more.
match_confidence: body?.orderLineId ? 1 : null,
match_method:     body?.orderLineId ? "manual" : null,
```

That comment is **correct** about live state, and the write is still the defect.
The proposal and the confirmation were sharing two columns, so confirming a
pairing deleted the model's score — at the one moment the pair became a training
example, which is the one moment it can never be reconstructed afterwards.
Nothing looks wrong in the diff, nothing looks wrong in the row, and the corpus
is simply empty of every case the model got right and a human agreed with.

The other three: suggested pairings were never persisted at all
(`document-intake.service.ts:497-502` logged `result.suggested.length` and
returned the candidates on the HTTP response — the entire negative class of an
entity-resolution dataset, gone when the tab closed); the door's paper pre-fill
never left the browser (`DoorNext.tsx:236-246` set the count from
`readPaper().boxes` and `seal()` sent only the final number); and the verify
form's pre-fill overwrite was untracked (`ReceivingWorkspace.tsx:202-223` filled
four fields from the extraction and `:272-293` submitted whatever survived, so a
manager correcting a misread `invoiceQty` from 22 to 24 left a submitted 24
byte-identical to a 24 the model had read correctly).

Alongside them, two capture holes: `procurement_documents.extraction_model` has
had a column and **no writer** since the document spine, so every row said NULL —
which reads as "no model was involved" rather than "nobody recorded which one";
and `procurement_documents` had no `event_id` at all, so no extraction in this
product could ever be attributed to a model, a version, a latency or a cost.

### Why now

Production, measured 2026-09-01:

| table | rows |
|---|---|
| `procurement_documents` | 0 |
| `procurement_document_lines` | 0 |
| `procurement_receipt_events` | 0 |
| `procurement_credits` | 0 |
| `procurement_orders` | 2 |
| `procurement_order_items` | 1 |

Nothing has to be migrated and nothing has to be back-filled, because there is
nothing there. Every pair these tables will ever hold is written by the code this
decision changes. That is the entire argument for doing it in one session rather
than scheduling it: **the same change against a year of rows is not expensive,
it is impossible** — the proposal half is not recoverable from the confirmed
half, by construction.

## Options considered

1. **Reconstruct the labels later from the `extracted` jsonb.** The parse is
   already stored whole on `procurement_documents.extracted`, so the argument is
   that the proposal survives there and can be diffed against the final values
   whenever we get round to it. **It does not work, and the reason is not a
   detail.** `editLine` overwrites lines in place, and the tie-out is recomputed
   from the edited lines — so after a second edit, the first edit's OUTPUT is the
   second edit's baseline. The stored `extracted` is the original parse only
   until someone touches it twice, and nothing records which of those it is. A
   reconstruction would silently mislabel every multiply-edited document as a
   single large model error, and multiply-edited documents are precisely the hard
   ones. It also covers only L4: there is no jsonb anywhere holding a rejected
   match suggestion or the door's box reading.

2. **Log the proposals to the application log instead of the database.** Cheap,
   no migration, no schema surface. Rejected on three grounds. Retention: logs
   roll; a label corpus is an asset that must outlive a log window, and losing it
   is invisible. Join: grading requires joining the proposal to the human's
   answer, which arrives minutes to days later in a different request — a join
   Postgres does for free and a log store does not do at all. Precedent: this
   product already solved exactly this problem the other way for photo counts
   (`photo_count_suggestions`, 2026-08-27), whose migration says in as many words
   that the model's answer and the truth "existed at different times and were
   never joined". A second, weaker answer to the same question would be the drift
   this repo keeps paying for.

3. **Wait for volume.** Adopt the rule once there is enough traffic to make the
   corpus worth having. This is the option that sounds prudent and is strictly
   the most expensive one available, because the cost curve runs the wrong way:
   the change is free today (0 rows, no back-fill, no migration risk, no
   downtime) and becomes *unpayable* later, since waiting does not accumulate
   labels — it accumulates **destroyed** labels. Every delivery received between
   now and then is a pair produced and thrown away. There is no later date at
   which this is cheaper than it is today.

4. **Do nothing.** Costs the same as (3) with no pretence of a plan.

## Decision

Adopt, as a standing rule for this repo:

> **A machine proposal shown to a human is written before the human answers, and
> the answer is appended, never substituted.**

Enforced by `scripts/check_proposal_preservation.py`, blocking in CI. The guard
fails when a write outside a declared writer touches a proposal-half column
(`match_confidence`, `match_method`, `ties_out`, `tie_out_delta`,
`computed_lines_total`, and anything matching `proposed_*`), and exits **2 when
it cannot check** — a missing tree, zero write sites found, a declared writer
that stopped writing its column, or a file it cannot parse.

The `proposed_*` pattern is load-bearing rather than decorative: the fix for the
next instance of this defect will add a `proposed_something` column, and it must
arrive already guarded rather than needing a guard edit to be protected.

Two design points that carried the shape:

- **The allowlist is per column, per file, with a written reason.** Not a
  directory, and not a lint suppression comment. "This module may write it" is a
  much weaker claim than "this function may", and the weaker claim is how the
  defect returns. Adding a writer is a deliberate edit someone has to be willing
  to justify in prose.
- **Rejection is a label, and rejection never erases the proposal.** Unlinking a
  pairing clears the live match columns and leaves `proposed_*` standing. "The
  model proposed this and a human rejected it" is the single most valuable row in
  an entity-resolution corpus; erasing it on rejection would keep only the
  examples the model already got right, which is the failure mode that makes a
  corpus look good and teach nothing.

Deliberate refinements, each of which is a place the naive implementation would
have manufactured a label:

- A pairing **no machine proposed** still gets `match_confidence: 1,
  match_method: "manual"`. That is the honest live state and there is no proposal
  half to destroy. `proposed_*` stays NULL, which is the true statement "the
  machine never offered an opinion on this pair".
- Losing candidates on a line that got a different confirmation resolve as
  **`superseded`, not `rejected`**. No human judged them; scoring them as
  rejections would invent negative labels nobody produced.
- Absence is never agreement (per [0051](0051-rebuilt-pages-show-live-data-only.md)).
  `suggestion_accepted` is NULL when no suggestion was offered, never `false`;
  `prefilled_*` is absent when the form was not pre-filled, never `0`.
- `event_id` is `ON DELETE SET NULL`, **deviating from `photo_count_suggestions`'
  CASCADE**. NF-B erasure is crypto-shredding ([0037](0037-nfb-erasure-is-crypto-shredding.md))
  and footprint rows are prunable; under CASCADE, erasing a model's footprint
  would silently delete the labels it produced. Losing attribution is the correct
  cost. Losing the label is not.
- The extractor waits at most 2s for its own footprint id
  (`EVENT_ID_WAIT_MS`). `model-client.service.ts:326` states that emission
  latency never rides a user path; a plain `await` on the ref would have handed
  the instrument the power to hang the extraction it measures.

## Consequences

**Easier.** Every receiving interaction now produces a durable, joinable
(proposal, answer) pair: line-matching accept/reject/supersede with the model's
own confidence, extraction corrections with the pre-fill they corrected, and
per-document model attribution. Grading a matcher or an extractor becomes a
query rather than a project. The rule generalises beyond receiving — any future
propose/confirm surface inherits the guard the day it names a `proposed_*`
column.

**Harder.** Five new nullable columns, one new table, one more blocking CI job.
Confirmation is now two statements (read the line, then write) rather than one
blind update, which is a small latency cost on a rare human action. Anyone adding
a legitimate proposal writer has to edit the allowlist and say why — friction on
purpose.

**Given up.** Nothing measurable: no product surface reads these columns, and
`procurement_document_lines.order_line_id` remains the only place a pairing
means anything.

**Not done here, and still broken.** L3 (door) and L4 (verify) are **staged, not
finished**: the client sends the label, the DTO validates it, the migration adds
the columns, and the service-side insert is a marked TODO because
`receiving.service.ts` and `procurement.service.ts` were owned by concurrent
sessions. Until those land, both labels reach the gateway and are dropped there
instead of in the browser — a shorter fall, not a fix. Three `it.skip` tests in
`apps/api-gateway/src/procurement/proposal-preservation-deferred.spec.ts` fail
when un-skipped and name the exact lines required.

**Revisit when.** Two named signals. (a) The guard's allowlist exceeds ~6 entries
— that means "declared writer" has stopped being a meaningful constraint and the
rule needs a structural form (a repository layer that owns proposal columns)
rather than a list. (b) `resolved_at IS NULL` on
`procurement_line_match_suggestions` grows without bound — suggestions nobody
ever acts on are not labels, and a large unresolved queue means the confirmation
UI, not the matcher, is what needs work.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created. Numbered three times in one session: drafted 0056, moved to 0058 on founder instruction after `fix/receiving-write-path` took 0055 and PR #220 took 0056, then to **0059** when `fix/order-status-enum` renumbered itself onto 0058 and `check_adr_numbers_unique.py` caught the collision in CI. 0057 was free throughout and left alone. This is [0025](0025-citations-must-disagree-loudly.md)'s cost, paid live. |
