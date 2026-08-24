---
type: agenda-full
division: product
department: guest-experience
team: guest-identity-consent
status: provisional
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.refusal_count, nf_b.consented_link_rate]
updated: 2026-08-24
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-premortem]]", "[[guest-identity-consent-agenda-board]]", "[[guest-identity-consent-directive]]", "[[guest-identity-consent-loops]]", "[[guest-identity-consent-schedule]]", "[[guest-experience-charter]]", "[[taste-fingerprint-charter]]", "[[compliance-privacy-charter]]", "[[partnerships-integrations-charter]]", "[[design-charter]]", "[[UX_PATHS_CATALOG]]", "[[OPEN-DECISIONS]]"]
---

# Guest Identity & Consent — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Take ownership of a shipped artifact nobody owns, close its three verified gaps, and
hold the merge rule against pressure that will come from inside the sub-layer.

Three gaps, in priority order:

1. **The CI gate is available, not wired.** `scripts/eval_guest_merge_policies.py`
   and `guest_copresence_negatives` (`:519-540`) exist; nothing in
   `.github/workflows/` runs them.
2. **Zero application callers.** No code in `apps/api-gateway/src`, `apps/web/src`, or
   `apps/mobile/src` touches `guest_check_links`, `guest_link_identifier`,
   `guest_identifiers`, or `guests`. `nf_b.subject_coverage` is structurally 0%.
3. **`consent_notice_version` has no process that bumps it** (`:59`), and no prior
   notice text is archived anywhere.

## How

**Wire the gate before the write path — deliberately in that order.** It is
tempting to reverse them: coverage is the visible number and the gate passes
trivially today. But a gate wired *after* the first data is a gate that has to be
argued for, and a gate wired while it passes trivially is just a fact about the
build. The migration itself makes this argument at `:513-518` — register A6 records
what happened when an evaluation gate arrived after the data it was meant to judge,
and `guest_copresence_negatives` ships **empty on purpose** because of it. Wiring it
is finishing a job whose reasoning is already written.

**Then the smallest possible write path.** One restaurant, one capture channel out of
the four the schema already permits (`:61-62`), no new UI beyond what exists. The
goal is not coverage; it is to convert a structural zero into a real, small,
non-zero number, because a small number and a structural zero are different kinds of
problem and only one of them is a *measurement*.

**And a standing posture, not a project.** Most of this team's value over a year is
refusals and reviews: blocking the merge queue, blocking the threshold, reviewing
every new inbound integration for what personal fields it persists. Work that leaves
no artifact is work that gets defunded, so the refusal log is a **first-class
deliverable** and `nf_b.refusal_count` is reported as output, in the same review
where somebody complains about coverage.

## Why now

- **Unowned careful work degrades faster than unowned sloppy work.** The slice's
  value is its argument — no threshold, tombstone not soft-delete, card fingerprint
  quarantined despite verification, incompleteness fails to a split. All of it lives
  in comments in a migration, and a migration is the one artifact nobody re-reads. It
  ran once; it is history. [[guest-identity-consent-premortem]] F5.
- **The property is free now and impossible later.** `:135-136`: no other table holds
  guest PII *today*, which is exactly why the hashing rule is cheap now. Every month
  without an owner is a month in which a new integration can quietly make it
  expensive.
- **Every interaction without a write path is unbackfillable.** The migration's own
  scope test (`:16-25`) is *build what cannot be backfilled*. Consent captured at
  capture time cannot be reconstructed later. This is not a backlog item with a
  slipping date; it is a slipping date with a permanent cost.
- **The pressure has not arrived yet, which is the only time to build the defence.**
  [[taste-fingerprint-charter]] is currently blocked by A15 and therefore not yet
  asking for subjects. The founder-only gate should be written and endorsed while it
  is hypothetical.

## Next steps

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | Wire `scripts/eval_guest_merge_policies.py` into CI, in the shape of `.github/workflows/schema-parity.yml` | none | The gate runs per-commit and fails on one false merge |
| 2 | Add a CI assertion that the four PII guards are still structurally present — `revoke all` at `:485`, `guest_pepper()`'s raise at `:353-359`, both `check_no_*` scripts green with empty allowlists | none | A diff that removes a guard fails the build |
| 3 | Provision the `guest_identifier_pepper` vault secret | Ops access | `guest_pepper()` stops raising (`:549-564` wraps provisioning so a missing vault does not fail the migration) |
| 4 | Build **one** consent capture channel end to end — `reservation_form` or `loyalty_signup` — with `NEW-658` consent controls | 3, [[design-charter]], [[compliance-privacy-charter]] notice text | A real consented `guest_check_links` row exists; `nf_b.subject_coverage` is non-zero for one restaurant |
| 5 | Write the **refusal log** — every declined link with its reason, from `guest_channel_canonicalise()` returning NULL and `guest_link_identifier()` raising | 4 | `nf_b.refusal_count` is a real number on the board |
| 6 | Ship the `consent-copy-diff` skill; archive current notice text under its version | [[compliance-privacy-charter]] | Two consent strings can never share a version |
| 7 | Write `erasure_receipt_id` (`:82`, currently unwritten) — an erasure receipt enumerating what was deleted | 4 | `NEW-662` / `NEW-884` produce a receipt, not a silent success |
| 8 | Standing review: every new inbound connector declares what personal fields it persists | [[partnerships-integrations-charter]] | It is an agenda item on connector review, not a habit |

**Not doing, and it belongs in writing:** no merge queue, no resolution UI, no
candidate generation, no preference aggregates, no cross-restaurant linking. All are
listed as *"can wait"* at `:22-25` and all stay absent. The merge queue in particular
is not deferred for capacity reasons — it is **the delivery vehicle for the
threshold**, because a queue needs candidates and candidates need a similarity score.

## Questions for the founder

1. **Endorse the founder-only gate now, while it is hypothetical.** Any weakening of
   *exact verified key, a human assertion, or nothing* is a founder decision with a
   mandatory [[red-team-charter]] finding attached. Endorsing it before anyone wants
   it is the entire point; endorsing it under coverage pressure is a negotiation.
2. **Which capture channel goes first?** The schema permits four (`:61-62`).
   `reservation_form` and `loyalty_signup` give verified identifiers cleanly;
   `staff_verbal` is the one that produces the *unverified* rows the migration warns
   about at `:148-151` (the assistant booking twelve dinners). Product call, and it
   determines what `nf_b.unverified_identifier_share` looks like from day one.
3. **Is a small pilot number acceptable as a milestone?** One restaurant, one channel,
   a handful of consented links is a *good* outcome for this team and a bad-looking
   number on a dashboard. Confirming that now prevents the coverage conversation from
   being reopened as a performance conversation.
4. **Where does the operator preference signal live?** Not this team's to own — an
   operator is not a guest — but this team is the one that will be asked to host it,
   because it is the closest thing to a person-subject in the schema.
   `recommendation_actions`
   (`supabase/migrations/20260805000000_baseline_from_production.sql:4908`;
   `apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`) has no
   `subject_type` home, and **OD-11 will fix the per-`subject_type` index strategy**,
   after which adding a value is a migration against live indexes. Answer it before
   OD-11 closes, not after. Full framing in [[guest-experience-agenda-full]] §2.
