---
type: schedule
division: platform
department: engineering
team: integration-engineering
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[integration-engineering-charter]]", "[[integration-engineering-loops]]", "[[engineering-schedule]]", "[[partnerships-charter]]", "[[skills-charter]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Integration Engineering — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Hourly** | Webhook silence watch — L-IE-1, per integration against its own baseline | Silence duration; incident on threshold breach |
| **Daily** | Third-party contract drift — L-IE-5 | Payload schema mismatches; adapter rejection rate |
| Daily | OAuth token health — `integrations/integrations-oauth`, Gmail/Calendar/Microsoft | Expiring and failed refreshes before they break a flow |
| Per PR | Placeholder-host gate — after L-IE-3's one-shot resolution | Blocks `*.ngrok.io`, `your-domain.com` and kin in shipped config |
| Per PR | Public-route rejection tests — unsigned request must be rejected | Verification proof per route |
| Weekly | Signature coverage — L-IE-2 | `integration.verified_signature_coverage`; routes lacking a rejection test |
| Weekly | Arrival-vs-fitness triage — L-IE-4 with [[dat-pos-telemetry-ingest]] | Unclaimed data-quality reports and their age |
| Monthly | Adapter contract test refresh — `toast_adapter.py`, `core/pos_provider.py`, `toast_api_client.py` | Fixtures re-recorded against live provider payloads |
| Monthly | Scraper health — `serper_client.py`, Apify/Yelp paths | Selector and quota breakage |
| Quarterly | External connection inventory refresh against [[EXTERNAL_CONNECTIONS]] | New hosts; Square/Lightspeed status (**groundwork only** today, `:11`) |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `webhook-signature-audit` | Weekly, and on any new public route | Enumerating routes is scriptable; deciding whether a given verification is *sufficient* for a provider's scheme is not |
| `integration-silence-triage` | A silence threshold breach | Must distinguish "restaurant is closed", "provider outage", and "our endpoint changed" — three very different responses to identical silence |
| `provider-payload-diff` | A schema mismatch | Compares the received payload to the recorded contract and proposes a mapping; a human approves before the adapter changes |

**Constraint on all three:** a skill may **read** provider traffic and **propose** an
adapter change; it may not modify payload mappings automatically. An auto-adapting mapper
converts a loud breakage into a silent misinterpretation — which trades the failure this
team can see for the one it cannot ([[integration-engineering-directive]], "On Friday
breakages"). None may add a route to the allowlist; that requires a human co-sign from
[[platform-api-charter]].

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
