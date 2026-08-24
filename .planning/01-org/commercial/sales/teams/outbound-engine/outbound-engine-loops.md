---
type: loops
division: commercial
department: sales
team: outbound-engine
status: new
metrics: [sales.sending_identity_isolated, sales.claim_provenance_rate, sales.complaint_rate, sales.qualified_conversation_rate, sales.reply_rate, sales.suppression_integrity]
updated: 2026-08-24
links: ["[[outbound-engine-charter]]", "[[outbound-engine-premortem]]", "[[outbound-engine-directive]]", "[[outbound-engine-schedule]]", "[[sales-loops]]", "[[design-partner-operations-loops]]", "[[compliance-privacy-charter]]", "[[media-brand-charter]]", "[[reliability-sre-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_ids: ["oe-identity-isolation-guard", "oe-claim-provenance", "oe-suppression-integrity", "oe-volume-safety", "oe-qualification-calibration"]
loop_close_times: ["per-pr", "quarterly", "weekly", "daily", "fortnightly"]
loop_statuses: ["proposed", "proposed", "dormant", "dormant", "dormant"]
---

# Outbound Engine — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop.

**Reading note.** Five loops. **One runs today** (L1, the guard) — and it is the only one
that *should*, because the other four require sending, and sending is gated. A dormant
team with four "running" loops is [[sales-premortem]] M5 wearing a dashboard.

---

## L1 — Identity isolation guard *(the only loop that runs today)*

```yaml
type: loop
id: oe-identity-isolation-guard
owner: outbound-engine
measures: [sales.sending_identity_isolated, oe.gmail_import_violations]
changes: [oe.send_permission, ci.guard_state]
inputs_from: [engineering]
outputs_to: [sales, reliability-sre, engineering]
close_time: per-pr
close_time_note: "per commit (CI)"
status: proposed
```

**Measures.** Whether any module on an outbound path can reach `GmailService`, and whether
cold outbound resolves to an identity distinct from the transactional sender
(`apps/api-gateway/src/communications/gmail.service.ts:76-78`).

**Changes.** Send permission, directly. While the boolean is `false`, gate G2 in
[[outbound-engine-directive]] blocks every send request.

**Close-time: per-commit.** Not weekly — this is a CI guard in the shape of the repo's
existing `scripts/check_*.sh` family, and its whole value is that it closes faster than a
human notices. A per-commit loop is the only kind that can outrun *"I'll just wire it up
quickly."*

**Why it is worth building with nothing to send.** [[outbound-engine-premortem]] M1 takes
down vendor procurement mail and presents as a procurement bug. Preventing it is a grep;
diagnosing it afterwards is days. This is the highest value-to-cost item the team has.

**Runs today?** **Yes** — the moment the guard is written. Nothing else is needed.

---

## L2 — Claim provenance audit

```yaml
type: loop
id: oe-claim-provenance
owner: outbound-engine
measures: [sales.claim_provenance_rate, oe.allowlist_size]
changes: [oe.claim_allowlist, media-brand.copy_constraints]
inputs_from: [design-partner-operations, analytics-bi]
outputs_to: [media-brand, growth, strategy-fundraising]
close_time: quarterly
status: proposed
```

**Measures.** Every assertion in live outbound copy, traced to its evidence. The question
that resolves it is one sentence: *which invoice did that credit appear on?*
(`.planning/YC_WEDGE_PLAN.md:31-33`).

**Changes.** The allowlist. Anything untraceable is **pulled, not footnoted** — a
qualified claim is still the claim.

**Today.** Allowlist is **empty**, and that is correct: `verified_dollars_recovered == $0`.
The one permitted opening is mechanism-only — the four-way document model, where the
distributor's own ship notice and its own invoice disagree and there is nothing left to
argue about (`.planning/YC_WEDGE_PLAN.md` §REVISION 3, `:342`).

**Why quarterly.** Claims drift slowly, through re-use rather than authorship — a figure
written once for one context reappears somewhere it was never verified for. Quarterly
catches drift; weekly would catch nothing and cost attention.

**Runs today?** **Yes, trivially** — an empty allowlist audits in a minute. Keeping it
running while empty is what makes the first non-empty entry visible.

---

## L3 — Suppression integrity

```yaml
type: loop
id: oe-suppression-integrity
owner: outbound-engine
measures: [sales.suppression_integrity, oe.stop_request_latency_p100]
changes: [oe.sequence_stop_path, oe.suppression_scope]
inputs_from: [outbound-engine, compliance-privacy]
outputs_to: [compliance-privacy, sales]
close_time: weekly
status: dormant
```

**Measures.** Share of stop requests honoured within 24 hours, and the **worst** latency,
not the average. An average hides the one person who got a fourth email.

**Changes.** The stop path and the suppression scope. Scope is per-**domain**, not
per-address, copying the dedupe shape the repo already demonstrates
(`apps/api-gateway/src/common/orchestrator/prospects.service.ts:36-42`) — a second contact
at a restaurant that already opted out is the same failure as the first.

**Why it is a launch gate rather than an operational metric.** A system that cannot
reliably stop should not be permitted to start ([[outbound-engine-directive]] G3). A stop
request missed at 24 hours is an **incident**, not a bug.

**Runs today?** **No** — dormant, no sends. The *design* is permitted work now, and the
loop starts the same day sending does.

---

## L4 — Volume safety

```yaml
type: loop
id: oe-volume-safety
owner: outbound-engine
measures: [sales.complaint_rate, oe.bounce_rate, oe.domain_reputation]
changes: [oe.send_volume, oe.warmup_schedule]
inputs_from: [outbound-engine]
outputs_to: [reliability-sre, sales]
close_time: daily
status: dormant
```

**Measures.** Complaints per 1,000 sends, bounce rate, and domain reputation signal.

**Changes.** Volume, in one direction fast and the other slow. Above threshold: **volume to
zero, automatically** — not reviewed, not weighed against pipeline targets. Below: **one
step up**, then re-evaluate. No compounding ramps.

**Why daily.** Reputation damage compounds within a single send window; a weekly close
would report the damage after it was done. This is the fastest loop the team owns, and its
close-time is set by how fast the harm moves rather than by reporting convenience.

**The asymmetry is deliberate.** A lost week of sending is recoverable. A burned domain is
not — and it takes vendor procurement mail with it if isolation ever lapsed
([[outbound-engine-premortem]] M1).

**Runs today?** **No** — dormant, and must stay so while L1's boolean is `false`.

---

## L5 — Qualification calibration

```yaml
type: loop
id: oe-qualification-calibration
owner: outbound-engine
measures: [sales.qualified_conversation_rate, sales.reply_rate, oe.disqualifier_hit_rate]
changes: [oe.qualification_rubric, oe.sequence_copy, oe.target_criteria_feedback]
inputs_from: [outbound-engine, design-partner-operations]
outputs_to: [sales, growth, finance-pricing, product-vision]
close_time: fortnightly
status: dormant
```

**Measures.** Qualified conversations per 100 first-touches — the primary metric — plus
reply rate and, critically, **disqualifier hit rate**: how often the rubric actually fails
someone.

**Changes.** The rubric, but **only with a written rationale and a re-scored cohort**, so
that loosening the definition is visible rather than gradual.

**The inverted alarm.** `qualified_conversation_rate > 60%` in the first cohort escalates
**upward** ([[outbound-engine-directive]]). An honest rubric disqualifies most of a cold
list; a rate that high is evidence of a rubric written to describe the pipeline rather than
judge it ([[outbound-engine-premortem]] M5). This is the only loop in the department where
a good-looking number triggers an escalation, and it is stated explicitly because nobody
escalates a good-looking number voluntarily.

**Why fortnightly.** A cold-outbound cohort needs roughly two weeks to produce replies. A
weekly close would keep re-tuning on incomplete cohorts — which is the mechanism by which
rubrics loosen.

**Runs today?** **No** — dormant. The rubric itself is permitted work now, and writing it
while the pipeline is empty is the only moment it can be written honestly.

---

## Loop health

| Loop | Close-time | Status | Blocked on |
|---|---|---|---|
| L1 Identity guard | **per-commit** | **runnable now** | writing one grep-grade check |
| L2 Claim provenance | quarterly | runnable (empty) | a landed credit, to have anything in it |
| L3 Suppression integrity | weekly | dormant | sending |
| L4 Volume safety | daily | dormant | sending |
| L5 Qualification calibration | fortnightly | dormant | sending + the list |

**One loop should run, and one does.** That is the honest picture of a team that is dormant
by construction. The failure to avoid is not the four dormant loops — it is a future
version of this file where all five report green because someone found a way to make
dormancy look like operation.
