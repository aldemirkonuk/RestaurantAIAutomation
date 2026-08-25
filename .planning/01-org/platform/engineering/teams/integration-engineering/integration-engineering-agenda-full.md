---
type: agenda-full
division: platform
department: engineering
team: integration-engineering
status: provisional
metrics: [integration.verified_signature_coverage, integration.webhook_silence_duration]
updated: 2026-08-24
links: ["[[integration-engineering-charter]]", "[[integration-engineering-premortem]]", "[[integration-engineering-agenda-board]]", "[[integration-engineering-loops]]", "[[engineering-agenda-full]]", "[[platform-api-charter]]", "[[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Integration Engineering — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Four deliverables, and the first two are investigations rather than features:

1. **Resolve the placeholder hosts.** `abc123.ngrok.io` and `your-domain.com` appear in
   source paths ([[EXTERNAL_CONNECTIONS]]:13,21). Determine dead / dev-only / **live** for
   each. An `ngrok` subdomain is leased and reassignable; if a live callback points there,
   this is an open inbound path, not untidiness.
2. **Measure signature coverage.** The charter names this the team's first task
   (`technology.md:264-266`). One row per public route; verification mechanism; **a test
   that proves an unsigned request is rejected**.
3. **Silence detection per integration.** Time since last inbound event, alerted against
   each integration's own rhythm — the only mechanism that can see the premortem.
4. **Per-event delivery records**, which the seam with [[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]]
   requires: this team must be able to answer *did the event arrive, intact and on time?*

## How

**Absence is the failure mode; build for absence.** Error-rate monitoring cannot see a
webhook that never arrived. The metric is silence duration, the baseline is per
integration, and where a provider API allows it, pair passive receipt with an **active
poll** — an integration verifiable only passively cannot distinguish "no activity" from
"no connection".

**A secret is not verification.** `POS_HUB_WEBHOOK_SECRET` (8 refs) and
`TOAST_WEBHOOK_SECRET` (2 refs) prove intent. The proof of verification is a **rejected
unsigned request**, per route, in a test.

**Public means signature-verified, not unauthenticated.** The criterion is stated
positively: a third party calls it **and** its authenticity is verified. Not "internal",
not "the agent calls it", not "it 401s in dev" (premortem M5). This team owns allowlist
*entries*; [[platform-api-charter]] owns the file and its enforcement; both co-sign.

**Take first triage on the substrate seam.** Left-of-seam is this team
(`technology.md:859`). Answer the arrival question, attach evidence, then hand off. That
default is what keeps [[engineering-premortem]] M1 from happening here.

## Why now

- **Two placeholder hosts may be live.** This is the cheapest possible investigation with
  the widest possible consequence, and nobody has done it.
- **The primary metric is explicitly unmeasured** and named as the first task in the
  evidence document itself.
- **Square and Lightspeed are groundwork, not adapters** ([[EXTERNAL_CONNECTIONS]]:11). The
  moment to establish what a *finished* integration means — signature coverage, silence
  detection, delivery records — is before the next one is built, not after two more exist.
- **POS data feeds stock.** A silent Toast outage becomes a wrong inventory number, which
  is [[inventory-ledger-charter]]'s undetectable-from-the-UI failure with an external cause.

## Next steps

- [ ] Resolve `abc123.ngrok.io` and `your-domain.com`: dead / dev-only / live — then delete
      or replace; route as a finding to [[security-charter]] (premortem M3)
- [ ] Add a grep gate on placeholder hosts in shipped configuration
- [ ] Build the per-route verification table; publish first
      `integration.verified_signature_coverage` reading (M2)
- [ ] Add a rejection test per public route — unsigned request must fail
- [ ] Ship silence detection with per-integration baselines and alerting (M1)
- [ ] Add active polling where the provider API supports it (M1)
- [ ] Record per-event delivery so the arrival question is answerable (M4)
- [ ] Seed the [[platform-api-charter]] allowlist with the ~51 routes, each with a reason
      and this team as owner (M5)
- [ ] Agree cross-hop idempotency derivation with [[inventory-ledger-charter]] and
      [[messaging-delivery-charter]]

## Questions for the founder

1. **Are the placeholder hosts live?** If nobody knows, that is the answer and the
   investigation is urgent. If someone knows they are dead, we delete them today.
2. **What is an acceptable silence window per integration?** It is a product decision —
   two hours of no Toast events during service is very different from two hours overnight.
   Without a stated window the alert either cries wolf or never fires.
3. **Does an unverified public route get closed or verified?** Some providers may not sign
   at all. If a provider cannot sign, is IP allowlisting acceptable, or does the
   integration not ship?
4. **Square and Lightspeed — real roadmap, or aspiration?** They are referenced hosts only.
   If they are on the roadmap, the verification/silence/delivery standard should be a
   precondition for the first one rather than retrofitted to three.
5. **Who talks to Toast when they break something?** This team owns the wire;
   [[partnerships-integrations-charter|partnerships-charter]] owns the relationship. On a Friday breakage, who sends the
   email — and does that answer change at 20:00?
