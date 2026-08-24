---
type: agenda-full
division: product
department: guest-experience
parent_department: product-vision
status: provisional
metrics: [nf_b.subject_coverage, nf_b.event_completeness, nf_b.ops_conversion]
updated: 2026-08-24
links: ["[[guest-experience-charter]]", "[[guest-experience-premortem]]", "[[guest-experience-agenda-board]]", "[[guest-experience-directive]]", "[[guest-experience-loops]]", "[[guest-experience-schedule]]", "[[guest-identity-consent-charter]]", "[[taste-fingerprint-charter]]", "[[consumer-app-points-economy-charter]]", "[[guest-value-monetization-charter]]", "[[product-vision-charter]]", "[[compliance-privacy-charter]]", "[[partnerships-integrations-charter]]", "[[data-charter]]", "[[0006-neural-footprint-architecture]]", "[[OPEN-DECISIONS]]", "[[FUTURES]]", "[[DISH_IDENTITY_DESIGN]]"]
---

# Guest Experience — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Stand up the third user type as a sub-layer of [[product-vision-charter]], staged in
four questions that must be answered in order:

1. **Who is this guest** — and, above all, when not to merge.
   [[guest-identity-consent-charter]] · shipped as schema, **zero callers**.
2. **What do they like**, at mechanism level. [[taste-fingerprint-charter]] · blocked
   on food, open on wine.
3. **Where does the signal come from** — the consumer app and its points economy.
   [[consumer-app-points-economy-charter]] · greenfield, gated on OD-07.
4. **What does the restaurant get back.** [[guest-value-monetization-charter]] ·
   ambition with zero groundwork.

Reading them in that order is the roadmap. Building them out of that order is M3 and
M4 in [[guest-experience-premortem]].

## How

**The near-term shape is one team, not four.** [[guest-identity-consent-charter]]
activates now — to *defend and connect* the shipped slice, not to extend it.
[[taste-fingerprint-charter]] activates **wine-only**, because that is the one place
the corpus supports it. The other two hold on written entry triggers.

Three principles govern everything below:

- **Refusal is a deliverable.** In this sub-layer, "we declined to compute that" is
  reported as work, in the same review where someone complains about coverage. Every
  other unit in the company is measured on producing; this one is partly measured on
  declining. If that ever feels awkward, the incentive is working.
- **Mechanism, not tagging.** [[0006-neural-footprint-architecture]] and the founder's
  explicit instruction: model flavour like chemistry or immunology. Exposure is a
  *prior* with a dose-response shape, never a posterior. Two siblings raised in the
  same house diverge, and the model must be able to represent that or it is doing
  regional averaging under a personalization label. Detail in
  [[taste-fingerprint-charter]].
- **Consumer-grade or not at all.** The guest is not paid to be here. A business tool
  reskinned will be uninstalled, and every NF-B metric downstream inherits that zero.

## Why now

Three reasons, and one reason it is *not* urgent — which matters as much.

- **The identity slice already exists and nobody owns it.** 564 lines of unusually
  careful schema — versioned consent, tombstone erasure, four independent PII guards,
  a zero-false-merge CI gate that shipped before the data. It is the highest-quality
  unowned artifact in the division, and unowned careful work degrades faster than
  unowned sloppy work, because the reasons for the care live in comments nobody is
  reading.
- **It is cheap now and impossible later.** The migration's own thesis (`:16-25`):
  build exactly what cannot be backfilled. Consent captured at capture time cannot be
  reconstructed. A guest identifier hashed with a per-restaurant pepper cannot be
  retrofitted onto plaintext already spread through `pos_checks.raw`, `events`,
  `notifications`, `decision_log`. Every month without an owner is a month of
  interactions that can never become NF-B events.
- **The consumer app's design contract is written and enumerated** — [[FUTURES]] §7
  plus 41 UX paths across §W and §AB. The expensive part of that work is done. What
  is missing is a decision (OD-07), not a specification.

**And the reason it is not urgent:** the modelling half is blocked by two decisions
already made — A15 (dish identity deferred) and the measured corpus. Pretending
otherwise is M3.

## Next steps

Ordered. Nothing below assumes a decision that has not been made.

| # | Step | Owner | Unblocks | Gate |
|---|---|---|---|---|
| 1 | Wire `scripts/eval_guest_merge_policies.py` into CI **while it still passes trivially** | [[guest-identity-consent-charter]] | The zero-false-merge gate becomes real rather than available | none |
| 2 | Build the **first write path** into the identity slice — one consent capture channel, one restaurant | [[guest-identity-consent-charter]] | `nf_b.subject_coverage` stops being structurally 0 | Provision the `guest_identifier_pepper` vault secret first (`:549-564`); `guest_pepper()` raises until it exists |
| 3 | Close the **`recommendation_actions` subject-type question** before OD-11 closes | escalated below | NF schema correctness | Founder |
| 4 | Draft the **NF-B event contract, wine-only** — what fills `stimulus`, `context`, `choice`, `outcome` for a bottle | [[taste-fingerprint-charter]] | A completeness metric with a real denominator | OD-11 column contract |
| 5 | Fix the **k-threshold as a code constant with a CI guard**, and design the sub-k empty state | [[guest-value-monetization-charter]] | Removes the incentive that causes M4 | Review by [[compliance-privacy-charter]], not by us |
| 6 | Write the **advertising boundary statement** against `ServicesPermissions.tsx:41,249` | [[guest-value-monetization-charter]] | A written promise stops silently contradicting a chartered revenue model | Founder + [[compliance-privacy-charter]] |
| 7 | Hold [[consumer-app-points-economy-charter]] **unstaffed** until OD-07 resolves | — | — | OD-07 |

## Questions for the founder

Five. Three are open decisions this sub-layer must not close on its own; two are new.

1. **OD-07 — Beli.** Build the consumer experience independently, or explore
   collaboration? ([[OPEN-DECISIONS]]:18) This sub-layer takes **no position** and
   states plainly that it should not: an independent build is the outcome that
   maximises this sub-layer's scope, which disqualifies it as a neutral assessor.
   The dependency is total — [[consumer-app-points-economy-charter]] exists or does
   not exist downstream of the answer, and [[taste-fingerprint-charter]]'s signal
   source changes shape with it. *What it needs first:* guest MVP scope, which
   [[FUTURES]] §7.5 already provides.

2. **⚠️ The operator preference signal has no `subject_type` home — and OD-11 will
   close over it.** `recommendation_actions` is shipped and carries dismiss / snooze
   / done / pin / assign / `helpful` · `not_helpful`
   (`supabase/migrations/20260805000000_baseline_from_production.sql:4908`;
   `apps/api-gateway/src/analytics/recommendation-actions.service.ts:12-44`). It is
   the strongest *human* preference data the company already collects — stronger
   today than anything NF-B will hold for months. And
   [[0006-neural-footprint-architecture]] fixes `subject_type` to
   `agent | guest | bio`. An operator is none of those.
   The tempting move — record it as the *agent's* outcome — changes the subject of
   the record from the person who chose to the system that proposed, which is the
   collapse the stimulus → internal state → choice → outcome shape exists to prevent.
   **Three options, undecided here:** (a) a fourth value, e.g. `operator`;
   (b) NF-A outcome field, accepting the subject shift; (c) a track outside the NF
   spine. **Timing is the actual ask:** OD-11 sets the partial-index strategy per
   `subject_type`. Adding a value afterwards is a migration against live indexes, not
   a schema edit. If OD-11 closes without answering this, it closes wrong.

3. **OD-22 — does monetization belong here or in Commercial?** ([[product]] §5.2)
   The case for here: the k-anonymity gate and the photo-consent contract are
   guest-data obligations, and keeping them next to the revenue is the whole point.
   The case for Commercial: advertising is a revenue model and Commercial owns
   revenue models. Reflected as open in [[guest-value-monetization-charter]], not
   pre-empted. **Note:** pricing itself is founder-deferred and no pricing model is
   proposed anywhere in this sub-layer.

4. **New — the advertising promise already in the product.**
   `apps/web/src/components/settings/ServicesPermissions.tsx:41` lists *"Any
   advertising or cross-site tracking"* under exclusions and `:249` says *"WineOps
   sets no tracking or advertising cookies."* That binds the operator app, not a
   future guest app — but it is a written promise about advertising on one surface
   while another surface charters advertising as revenue. Is the boundary
   *per-surface* (operator app never, guest app with consent), or is the copy the
   company's position? This is cheap to answer now and expensive to answer after a
   journalist finds both strings.

5. **New — is `nf_b.ops_conversion` allowed to be the stop condition?**
   [[guest-experience-premortem]] M1 proposes that two consecutive quarters at zero
   sends this sub-layer's charter back to [[product-vision-charter]] for a scope
   decision. That is a real consequence and it should be founder-endorsed now, while
   it is hypothetical, rather than negotiated later when it is a specific team's
   existence.
