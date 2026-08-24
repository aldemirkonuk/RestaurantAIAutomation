---
type: loops
division: corporate
department: knowledge-documentation
team: standards-verification
status: provisional
metrics: [standards.stale_claim_rate, standards.unpinned_claim_count, standards.docs_past_60_day_rule, standards.stale_brand_doc_count, standards.regenerated_companion_age_days]
updated: 2026-08-24
links: ["[[standards-verification-charter]]", "[[standards-verification-premortem]]", "[[standards-verification-directive]]", "[[standards-verification-schedule]]", "[[knowledge-documentation-loops]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 3
loop_count: 3
loop_count: 3
loop_ids: ["sv-claim-verification", "sv-sixty-day-sweep", "sv-generated-doc-integrity"]
loop_close_times: ["weekly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed"]
---

# Standards & Verification — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-SV-1 — Claim verification

```yaml
type: loop
id: sv-claim-verification
owner: standards-verification
measures: [standards.stale_claim_rate, standards.unpinned_claim_count, standards.correction_age_days]
changes: [corpus.spine_docs, decisions.open_queue, standards.pinning_backlog]
inputs_from: [platform, applied-ai, intelligence, product, commercial, corporate, architecture-review, red-team, decision-office]
outputs_to: [decision-office, positioning-fundraise-readiness, media-and-brand]
close_time: weekly
status: proposed
```

The team's primary loop. Sample N claims from the spine and unit documents, re-check each
against its cited source, and record one of three verdicts: `verified`, `stale`, or
`unpinnable`.

**`unpinnable` is a first-class verdict, not a soft fail.** It means the sentence may well
be right and there is no mechanism that would ever tell us it had stopped being right — the
insight-count case (`insight-catalog.spec.ts:10` asserts only `>= 200`, so 375, 573, and
348 all pass). Collapsing it into `stale` would hide the difference between a wrong document
and a missing gate, and the missing gate is the more expensive of the two.

Opening: `standards.stale_claim_rate` **unmeasured**, which is why the first run's job is to
produce a number rather than a low number.

---

## L-SV-2 — The 60-day sweep

```yaml
type: loop
id: sv-sixty-day-sweep
owner: standards-verification
measures: [standards.docs_past_60_day_rule, standards.provisional_docs_past_60_days]
changes: [corpus.archive_candidates, knowledge-documentation.agenda_full]
inputs_from: [platform, applied-ai, intelligence, product, commercial, corporate, architecture-review, red-team, decision-office]
outputs_to: [corpus-archive, decision-office, corporate]
close_time: monthly
status: proposed
```

[[ORG_STRUCTURE]] §4: *"an agenda that has not changed in 60 days is either finished or
fiction."* This loop is the only thing that turns that sentence into an event.

Two numbers because they mean different things: a stale **charter** may be genuinely
finished; a stale **provisional agenda** is a promise that work was coming, and past 60 days
it is a statement that it is not.

**No exclusions, including this department.** Its 21 provisional agendas fire
**2026-10-23** and, being the oldest, head the first report. That is written into the loop
rather than left to good intentions — [[standards-verification-premortem]] M4.

Monthly rather than weekly: the threshold is 60 days, so a weekly cadence would report the
same list four times before anything could change.

---

## L-SV-3 — Generated-document integrity

```yaml
type: loop
id: sv-generated-doc-integrity
owner: standards-verification
measures: [standards.regenerated_companion_age_days, standards.hand_edits_to_generated_docs, standards.stale_brand_doc_count]
changes: [ci.generated_doc_check, foundation.companion_docs]
inputs_from: [engineering, security, reliability-sre, media-and-brand]
outputs_to: [decision-office, media-and-brand, architecture-review]
close_time: monthly
status: proposed
```

Counters [[standards-verification-premortem]] M5. `ENDPOINTS.md`, `PAGE_MAP.md`, and
`EXTERNAL_CONNECTIONS.md` are declared *"regenerated rather than hand-edited"*
([[foundation-README]] §0). The loop re-runs each generator and compares against the
committed file. A non-zero diff means either the world moved (regenerate) or someone hand
-edited (revert and fix the source) — and the two are distinguishable only by doing this.

A generated document that is secretly hand-maintained is the most dangerous stale document
in a corpus, because its provenance claim is the part doing the lying.

Brand drift rides along here because it is the same shape of check — a grep with a scope —
and because bundling it avoids a fourth loop that would fire on the same cadence over the
same corpus. Opening: **216** of 1,118 `.planning/` `.md` and **75** of 113 `md/` `.md`
contain "wineops"; the founding spine-scoped figure was **28**. All three reported with
scopes, per [[standards-verification-directive]] rule 4.

---

## Close-time summary

| Loop | Close-time | Counters | Opening value |
|---|---|---|---|
| L-SV-1 claim verification | weekly | premortem M1, M2, M3 | rate **unmeasured**; ≥ 1 unpinned |
| L-SV-2 60-day sweep | monthly | premortem M4 | 0, fires 2026-10-23 |
| L-SV-3 generated-doc integrity | monthly | premortem M5 | 3 companions unchecked; 216 / 75 brand hits |

**Escalation clock, shared:** any correction raised against another unit and unacknowledged
for 30 days escalates via [[knowledge-documentation-loops]] L-KD-4 to
[[decision-office-charter]], regardless of severity. Without it, L-SV-1 is a sampling ritual
that produces a rate nobody acts on — [[standards-verification-premortem]] M3.
