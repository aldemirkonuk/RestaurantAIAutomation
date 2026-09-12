# 0037 — NF-B erasure is crypto-shredding

- **Status:** Locked — founder, in-session 2026-08-28 (AskUserQuestion).
- **Date:** 2026-08-28
- **Decider:** Aldemir (founder)
- **Keywords:** nf-b, erasure, gdpr, crypto-shredding, privacy-engineering, research-store
- **Links:** [[0006-neural-footprint-architecture]], [[0029-p3-plan-of-record]] (NF-B HELD), [[0035-wave2-seam-reconciliation]] (loop ownership), [[privacy-engineering-agent-stack]]

## Context

ADR 0006 designed NF-B as a wide, append-only research log of guest
stimulus→choice→outcome. Wave 2 surfaced that its erasability loop
(`nfb-research-store-erasability`) had no owner and no register entry; ADR 0035
assigned the loop to privacy-engineering. The *mechanism* remained open, and an
append-only store that cannot honor erasure is a GDPR liability designed in.
NF-B itself stays HELD (ADR 0029, zero callers) — this decides the design so
activation, whenever it comes, does not improvise it.

## Options considered

1. **Crypto-shredding** *(chosen)* — every guest's NF-B rows are encrypted under
   a per-guest key; erasure destroys the key, O(1), rows become noise in place.
   The append-only structure and all cross-guest aggregates computed before
   erasure survive untouched. Costs, owned going in: key-management
   infrastructure, and decryption on every training/analysis path.
2. **Subject partitions** — physical delete per guest partition. Simpler
   mentally, but every erasure churns backfills and stales derived aggregates;
   "append-only" becomes "append-mostly," which is a different store.
3. **Aggregate-only retention** — raw rows expire fast, only aggregates persist.
   Cheapest ML path and weakest liability, but it guts the wide research log
   ADR 0006 exists for; taste-fingerprint research on aggregates alone is a
   different, poorer project.
4. **Defer to activation** — honest, but leaves privacy-engineering owning a
   loop it cannot close and re-opens a decided-together question later under
   activation pressure.

## Decision

NF-B's research store is designed for **crypto-shredding**: per-guest keys,
erasure = key destruction. Privacy-engineering owns the loop and, at activation
time, the key-management design; nothing is built while NF-B is HELD.

## Consequences

- Easier: the erasability loop can close (its output is now a design, not a
  fork); ADR 0006's wide store survives GDPR contact.
- Harder: NF-B's eventual activation carries key infrastructure as a
  prerequisite, and every consumer pays a decrypt.
- Revisit if activation-time measurement shows the decrypt cost dominating a
  named training path — the fallback recorded here is option 3 applied only to
  that path's inputs, never to the store itself.

## Addendum — 2026-08-28, same day: three consequences the decision must own

Surfaced by the adversarial audit and, independently, by the guest-experience and
compliance-privacy wave-3 passes. None overturns the pick; all three bind its
implementation and are privacy-engineering's to carry:

1. **Keys must be STORED, not derived.** The repo's only key precedent,
   `guest_pepper()` (`20260819000000_guest_identity_minimal_slice.sql:338-367`),
   HMAC-derives per-restaurant keys from one vault master — a derived key can be
   recomputed and therefore cannot be destroyed. Crypto-shredding requires
   independently stored, destroyable per-guest keys: different infrastructure
   than anything shipped. (Their agendas' D1/GX-4 attack this with
   architecture-review before any build.)
2. **Aggregate residue is a liability, not a feature.** The Decision section
   stated pre-erasure cross-guest aggregates "survive untouched" as a benefit
   without arguing the point; an aggregate derived from an erased subject is
   residual personal-data risk that the erasure story must address (k-thresholds
   or aggregate expiry — design question, not settled here).
3. **Model residue is out of this ADR's scope and someone's problem.** Key
   destruction does not remove what a trained model already absorbed (GX-17).
   Filed to privacy-engineering + decision-office; any NF-B-trained model
   inherits an unlearning question this ADR deliberately does not answer.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | Founder (AskUserQuestion, in-session) | Locked — option 1, recommended, chosen |
| 2026-08-28 | — | Created |
| 2026-08-28 | Adversarial audit + GX/CP wave passes | WOUNDED on consequences, not on the pick — addendum above binds implementation |
