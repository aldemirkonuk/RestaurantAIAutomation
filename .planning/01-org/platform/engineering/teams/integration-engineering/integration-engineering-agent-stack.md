---
type: agent-stack
division: platform
department: engineering
team: integration-engineering
status: designed
updated: 2026-08-27
metrics: [integration.verified_signature_coverage, integration.webhook_silence_duration]
links: ["[[integration-engineering-charter]]", "[[integration-engineering-schedule]]", "[[integration-engineering-loops]]", "[[integration-engineering-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[platform-api-charter]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Integration Engineering — the wire — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only Engineering team whose contract is owned by a third party and can change without
> notice ([[integration-engineering-charter]] §Distinct from siblings). Its card is shaped by
> one asymmetry: a webhook that *breaks* is loud, and a webhook that *stops* produces no signal
> at all — so the agent's primary job is watching for absence. Mechanism references are
> [[engineering-agent-stack]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `wire-sentinel` | Keep signature coverage over the ~51 legitimately-public routes true, watch each integration's silence against its own baseline, and propose adapter mappings it is forbidden to apply | NEW |

## 2. Agent cards

```yaml
agent: wire-sentinel
unit: integration-engineering
triggers:
  - schedule: "hourly — webhook silence watch (L-IE-1), per integration against its own baseline"   # mirrored in [[integration-engineering-schedule]]
  - schedule: "weekly — signature coverage (L-IE-2)"
  - topic: provider.payload_mismatch      # publisher: NONE (gap — adapters reject a bad payload; nothing emits on rejection)
consumes:
  - "inbound webhook route metadata: apps/api-gateway/src/{toast,simpos,pos-hub,vendor-portal}/ and common/orchestrator/inbound-email.controller.ts"
  - "[[EXTERNAL_CONNECTIONS]] §1 — the per-route verification record (publisher: the 2026-08-25 verification pass)"
  - "adapters and clients: adapters/toast_adapter.py, core/pos_provider.py, services/{toast_api_client,serper_client,plivo_client}.py"
  - "arrival timestamps per integration — publisher: NONE (gap, see §5)"
emits:
  - "integration.verified_signature_coverage and integration.webhook_silence_duration → [[integration-engineering-agenda-board]], L-ENG-5 (consumer: [[engineering-agent-stack|eng-board-keeper]] and [[platform-api-charter]])"
  - "payload-diff proposals (consumer: a human reviewer; never the adapter directly)"
  - "arrival-vs-fitness handoffs (consumer: [[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]], per the seam at technology.md:859)"
  - "nf_a events (task_type: wire_audit) — consumer: NONE (gap, see §5)"
routing_class: judgment          # enumerating routes is mechanical; deciding whether a given verification is *sufficient* for a provider's scheme is not ([[integration-engineering-schedule]])
quality_bar: "per route, an unsigned request must be rejected by a test ([[integration-engineering-schedule]], per-PR job). Coverage is the share of the ~51 public routes carrying such a test — and today that basis is NONE (gap): no rejection test exists to grade against, so the first reading is over documented verification, not proven verification."
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: integration-engineering
escalates_to: "[[engineering-charter]]"
```

**The card's own two hard rules.** `wire-sentinel` may read provider traffic and **propose** an
adapter change; it may never modify a payload mapping automatically — an auto-adapting mapper
converts a loud breakage into a silent misinterpretation, trading the failure this team can see
for the one it cannot ([[integration-engineering-directive]], "On Friday breakages"). And it may
never add a route to the public allowlist: that needs a human co-sign from
[[platform-api-charter]].

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `webhook-signature-audit` | T2 | Weekly, and on any new public route | Every inbound webhook is listed with its scheme, its `path:line`, and its unset-secret behaviour (fails closed / refuses / none) — and every route with **no** verification is named, not averaged away | Performed on 2026-08-25 against `docs/p2-spine-and-pages` HEAD: five inbound webhooks, four verifying HMAC or a shared secret with `path:line`, and `POST /communications/webhooks/gmail` carrying **no check at all**, gated only on `gmailWatchService.isReady()` — [[EXTERNAL_CONNECTIONS]]:15-24 | NEW |
| `placeholder-host-sweep` | T2 | Per PR touching integration config or a webhook base URL | Every non-production host reachable from a shipped path is resolved by name to fixture, dead code, or live misconfiguration — no host left in the "we don't know which" state | Performed on 2026-08-25: the 2026-08-24 census flagged `abc123.ngrok.io` and `your-domain.com` as unknown; the re-check resolved them — `abc123.ngrok.io` as a dev tunnel that must not appear in prod paths, `your-domain.com` as the **unset Plivo callback base** at `plivo_voice_client.py:55` ([[EXTERNAL_CONNECTIONS]]:151-152) | NEW |

`integration-silence-triage` and `provider-payload-diff` appear in
[[integration-engineering-schedule]] and are **deliberately not rows here**: no silence breach
has been triaged and no payload mismatch has been adjudicated, so neither has an instance to
cite. `integration-silence-triage` is the one this team most needs — see the §5 gap that blocks it.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); the allowlist
mechanism itself ([[platform-api-charter]]); data fitness
([[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: wire_audit`. Needs `context.integration` (toast / pos-hub /
  gmail / inbound-email / simpos) and `context.silence_seconds` as jsonb keys, because this
  team's only detectable failure is a *distribution* over time — "is 6 hours of Toast silence
  normal for a Tuesday?" is unanswerable without per-integration history.
- **Semantic** — `memory/` beside this file, `integration-engineering-MEMORY.md` as index. Its
  founding facts are already known and dated: the five-webhook verification map (source:
  [[EXTERNAL_CONNECTIONS]]:15-24, 2026-08-25), the Gmail Pub/Sub route having no check, the
  resolved placeholder hosts, `TOAST_MOCK_MODE` defaulting **true** at `toast.service.ts:71`,
  and that Square and Lightspeed are referenced hosts rather than adapters
  ([[EXTERNAL_CONNECTIONS]]:11). Each carries `source`, `confidence`, `last_verified`; the
  90-day expiry matters more here than anywhere else in Engineering, because a third party can
  invalidate any of these without a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics, and the
  [[EXTERNAL_CONNECTIONS]] §1 table. Adapters are retrieval targets by `path:line`.

**Consolidation** — monthly, mirrored in [[integration-engineering-schedule]]: read the wire
audit slice since the last run; distill durable facts, failures first — a provider whose payload
changed becomes a fact naming the field and the date, never "Toast drifted"; re-verify every
fact whose `last_verified` predates the provider's last release note; expire at 90 days; propose
skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[integration-engineering-loops]], NF-A events, vault PRs,
and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| No per-integration arrival ledger | `integration.webhook_silence_duration` needs a last-seen timestamp per integration and nothing records one. This is the **only** metric that can detect the premortem, because a webhook that stops arriving produces no signal at all — and it is currently unproducible |
| `provider.payload_mismatch` has no publisher | Adapters reject a malformed payload; nothing emits on the rejection. The daily contract-drift job bounds the blind spot at 24 hours |
| `POST /communications/webhooks/gmail` has no verification | Not a doc gap — a live one ([[EXTERNAL_CONNECTIONS]]:22). Named here so the coverage number cannot round it away |
| `wire_audit` NF-A events have no declared consumer | Beyond this team's own board row and the L-ENG-5 exposure loop |

## 6. Evidence today

- **EXISTS — the wire, and now most of the measurement.** The ~51 legitimately-public routes
  and the adapters are cited in [[integration-engineering-charter]] §Evidence. Since that
  charter was written, the 2026-08-25 verification pass recorded **per-route** verification with
  `path:line` for all five inbound webhooks ([[EXTERNAL_CONNECTIONS]]:15-24), which upgrades
  `integration.verified_signature_coverage` from "unmeasured" to "measured once, by hand, and
  not repeated".
- **PARTIAL — silence detection.** Nothing exists. The secondary metric has no producer at all,
  which is why `integration-silence-triage` has no past instance: no breach has ever been
  detected to triage.
- **Resolved since the charter.** The charter flags `abc123.ngrok.io` and `your-domain.com` as
  "the team does not currently know which" they are. The 2026-08-25 re-check resolved both
  ([[EXTERNAL_CONNECTIONS]]:151-152). Square and Lightspeed remain groundwork, as the charter says.
- **NEW — `wire-sentinel` and both skills.** Both procedures were performed once by hand on
  2026-08-25; neither runs on a schedule.
