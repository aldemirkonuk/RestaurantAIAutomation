---
type: charter
division: platform
department: engineering
team: integration-engineering
status: partial
metrics: [integration.verified_signature_coverage, integration.webhook_silence_duration]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[integration-engineering-premortem]]", "[[integration-engineering-agenda-full]]", "[[integration-engineering-agenda-board]]", "[[integration-engineering-directive]]", "[[integration-engineering-loops]]", "[[integration-engineering-schedule]]", "[[integration-engineering-charter|eng-integration-wire]]", "[[platform-api-charter]]", "[[partnerships-integrations-charter|partnerships-charter]]", "[[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]]", "[[EXTERNAL_CONNECTIONS]]", "[[ENDPOINTS]]"]
---

# Integration Engineering — the wire — Charter

Division **Platform** → Department [[engineering-charter]] → Team
`integration-engineering` (§2.7 of `.planning/foundation/teams/technology.md:241-270`).

## Mandate

**Every code path that speaks someone else's protocol**: Toast, SimPOS, POS Hub, vendor
portal webhooks, Gmail/Calendar/Microsoft OAuth, Square and Lightspeed groundwork,
Apify/Yelp/Serper scrapers. This team owns the wire — and the breakage.

## Boundaries

Owns outright — and this is where the **legitimately-public routes live**:

| Module | Routes | Note |
|---|---|---|
| `apps/api-gateway/src/toast/` | 10 | unguarded |
| `apps/api-gateway/src/simpos/` | 11 | unguarded |
| `apps/api-gateway/src/pos-hub/` | 10 | unguarded |
| `apps/api-gateway/src/vendor-portal/` | 2 | unguarded |
| `apps/api-gateway/src/common/orchestrator/inbound-email.controller.ts` | 1 | unguarded |
| | **≈51 legitimately-public routes** | |
| `apps/api-gateway/src/integrations/integrations-oauth` | 5 | |
| `apps/api-gateway/src/calendar/` | — | OAuth side |

Plus the adapters and clients:
`services/agent-orchestrator/adapters/toast_adapter.py`, `core/pos_provider.py`,
`services/toast_api_client.py`, `services/serper_client.py`, `services/plivo_client.py`.

## Distinct from siblings because

It is **the only Engineering team whose contract is owned by a third party and can change
without notice** (`technology.md:247-248`). Every other team can, in principle, freeze its
own inputs. This team cannot: Toast can ship a payload change on a Friday and there is no
PR to review.

It is also where the legitimately-public routes live, so its correctness criterion is
**signature verification, not `JwtAuthGuard`** (`technology.md:249-250`). That is a
different security model, not a weaker one — and confusing the two is how ~51 routes end up
described as "unguarded" without distinguishing the ones that are supposed to be.

**Distinct from [[partnerships-integrations-charter|partnerships-charter]] (Product division)**: Partnerships owns the
relationship and the decision to integrate; this team owns the wire and the breakage
(`technology.md:252-254`).

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| The decision to integrate with a partner, and the relationship | [[partnerships-integrations-charter|partnerships-charter]] *(Product)* |
| Whether delivered data is **fit for use** as L0 substrate | [[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]] — seam at `technology.md:859`: delivered correctly vs usable |
| The global guard mechanism and the allowlist file's existence | [[platform-api-charter]] — we own the *entries* and the signatures on them |
| Stock arithmetic once a POS event lands | [[inventory-ledger-charter]] |
| Vendor commercial terms | [[procurement-vendor-network-charter]] |
| Uptime and queue health of the ingestion path | [[runtime-resilience-charter|sre-runtime-resilience]] |
| What an agent does with integration data | [[ai-orchestration-charter]] |

## Metrics it moves

**Primary: `integration.verified_signature_coverage`** — of the ~51 intentionally-public
endpoints, the share that verify an HMAC.

**The exact number is unmeasured, and measuring it is this team's first task**
(`technology.md:263-266`). `POS_HUB_WEBHOOK_SECRET` (8 refs) and `TOAST_WEBHOOK_SECRET`
(2 refs) suggest partial coverage. Note the asymmetry in those reference counts — it is the
most concrete hint available that coverage is uneven, and it is a hint, not a measurement.

Secondary: `integration.webhook_silence_duration` — longest interval since the last inbound
event, per integration. This is the only metric that can detect the premortem, because **a
webhook that stops arriving produces no signal at all**.

## Evidence today

**EXISTS / PARTIAL** (`.planning/foundation/teams/technology.md:256-261`).

**EXISTS**
- `apps/api-gateway/src/toast/` (10 routes, unguarded), `simpos/` (11, unguarded),
  `pos-hub/` (10, unguarded), `vendor-portal/` (2, unguarded),
  `common/orchestrator/inbound-email.controller.ts` (1, unguarded) — **≈51
  legitimately-public routes**
- `services/agent-orchestrator/adapters/toast_adapter.py`, `core/pos_provider.py`,
  `services/toast_api_client.py`, `services/serper_client.py`, `services/plivo_client.py`
- `apps/api-gateway/src/integrations/integrations-oauth` (5),
  `apps/api-gateway/src/calendar/`

**PARTIAL**
- **Square and Lightspeed appear only as referenced hosts** ([[EXTERNAL_CONNECTIONS]]:11)
  — groundwork, not an adapter. Anything describing them as integrations is wrong today.

**⚠️ Flagged in the evidence pass**
- `abc123.ngrok.io` and `your-domain.com` **still appear in source paths**
  ([[EXTERNAL_CONNECTIONS]]:13,21). A placeholder host in a webhook path is either dead
  code or a live misconfiguration, and the team does not currently know which.

**The team is graded PARTIAL, not EXISTS**, because the POS side is real and running while
the second half of the mandate — signature verification coverage, silence detection, and
two named POS providers — is groundwork, placeholder, or unmeasured.
