---
type: schedule
division: product
department: partnerships-integrations
status: partial
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.doc_corrections_carried]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partnerships-integrations-loops]]"
  - "[[partnerships-integrations-directive]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[engineering-charter]]"
---

# Partnerships & Integrations — Schedule & Skills

## Recurring work

| Cadence | Job | Owner | Emits |
|---|---|---|---|
| **Per PR** | Ingress guard — a route added to an ingress module without a verification call fails CI | [[connector-platform-trust-charter]] + [[engineering-charter]] | build status |
| **Per change** | Two-provider check on any `pos-types.ts` diff | [[pos-bridge-charter]] | `pi.canonical_shape_drift` |
| **Weekly** | Bridge review — `pi.merchant_backed_providers`, and the adapter gate decision that follows from it | department | L1 |
| **Weekly** | Ingress inventory refresh — reconcile routes against the trust contracts | [[connector-platform-trust-charter]] | `pi.verified_ingress_ratio`, L2 |
| **Weekly** | Doc-drift sweep — verified corrections carried back to source in the same week | department | `pi.doc_corrections_carried`, L6 |
| **Bi-weekly** | Security coordination with [[perimeter-ingress-integrity-charter]] — standing item, not an escalation | joint | — |
| **Monthly** | Counterparty review — outreach attempts, response times, agreements. **Zero is a valid reading; "we did not check" is not** | [[partner-alliance-development-charter]] | `pi.unblocking_agreements`, L3 |
| **Monthly** | Open-fork staleness — OD-07, OD-21, OD-23, CM-F3 days-since-touched, with the two hard escalations | department | L4 |
| **Monthly** | Registry audit — statuses vs reality; demote any provider whose `scaffolded` claim no longer builds | [[pos-bridge-charter]] | registry diff |
| **Quarterly** | Connector deprecation review — dead credentials, unused connections, stale env vars against `EXTERNAL_CONNECTIONS.md`'s 80 variables | [[connector-platform-trust-charter]] | — |

**Anti-sprawl rule in force:** a scheduled job that produces no action for **3 consecutive
runs** is downgraded or deleted. The monthly counterparty review is the one most likely to
trip this, and it is deliberately exempted *once* — a BD loop that reads zero three months
running is telling the truth about a slow clock, not failing. If it reads zero for **six**,
it is deleted and [[partner-alliance-development-charter]] is reconsidered as a team.

## Skills owned

Skills live in `.claude/skills/`. **None of these exist yet.** The repo has exactly one
project skill today (`.agents/skills/railway-config/SKILL.md`, foundation §3.1), so this is
a proposal list, not an index. Per foundation §3.3 every skill below names its trigger, its
doneability criteria, and a **real past instance** — no speculative skills.

| Skill | Trigger | Done when | Real past instance | Tier |
|---|---|---|---|---|
| `ingress-route-audit` | A route is added or changed in `pos-hub`, `toast`, `simpos`, `inbound-email`, or any new ingress module | Every route is classified ingress / management / simulator and each ingress route's verification posture is stated with `path:line` | This session: it produced the correction that "0 of 32 verify" is false, and found `toast.service.ts:189` failing open on unsigned requests | T2 |
| `pos-registry-audit` | Monthly, or when a provider's status changes | Registry statuses reconciled against what actually builds and connects; any unsupported `scaffolded` demoted | This session: found 27 providers where the team doc says 30 | T2 |
| `connector-trust-contract` | A new connector is proposed | A written contract exists — data in, data out, auth model, verification, failure posture, deprecation path — co-signed by Security | The `integrations/` OAuth module has 2 providers and no written contract for either (`integrations-oauth.constants.ts`) | T2 |
| `doc-code-drift-check` | Weekly; and whenever a foundation doc is cited in a plan | Every `path:line` in the cited section is re-verified; failures are carried back to source the same week | This session: 3 corrections found in `foundation/teams/product.md` and `ENDPOINTS.md` | T3 |
| `canonical-shape-review` | Any diff touching `pos-types.ts` | Two-provider rule applied: ≥2 providers populate the field, or it is provider-optional behind a capability flag | Not yet fired — the shape has not changed since the registry was written. Chartered against premortem M5, which is a *predicted* instance, and is flagged as the weakest justification on this list | T2 |

**Honest note on the skill list.** Four of the five cite a real instance from this session's
own reading. `canonical-shape-review` does not — it is justified by a premortem, not by
history. Per foundation §3.3 that is a weaker basis than the others, and it is the first
candidate for deletion if the 30-day rule ever bites.

## What is deliberately not scheduled

- **Outbound cadence to named targets.** Founder-deferred. The monthly counterparty review
  measures whatever outreach happens; it does not schedule any.
- **Pricing review.** Founder-deferred. Not this department's.
- **A second signature-verification implementation.** Owned by
  [[perimeter-ingress-integrity-charter]]. We schedule coordination, not duplication.
