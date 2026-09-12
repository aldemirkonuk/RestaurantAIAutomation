---
type: agent-stack
division: product
department: partnerships-integrations
team: connector-platform-trust
status: designed
updated: 2026-08-27
metrics: [pi.verified_ingress_ratio]
links: ["[[connector-platform-trust-charter]]", "[[connector-platform-trust-schedule]]", "[[connector-platform-trust-loops]]", "[[connector-platform-trust-directive]]", "[[0034-agent-stack-artifact]]", "[[partnerships-integrations-agent-stack]]", "[[perimeter-ingress-integrity-charter]]", "[[skills-charter]]"]
---

# Connector Platform & Trust — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's agent is deliberately the most constrained in the department: it **classifies
> and specifies, and implements nothing.** Two units shipping verification is how a secret
> ends up unset in one environment with each assuming the other checked
> ([[connector-platform-trust-premortem]] M2). Harness → [[harness-runtime-charter]]
> (**OD-03 open**), model choice → [[model-routing-inference-economics-charter]], the
> control → [[perimeter-ingress-integrity-charter]], the gate →
> [[action-safety-the-human-gate-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ingress-cartographer` | Regenerate the ingress inventory — every route classified ingress / management / simulator / public-content, every ingress route's verification posture stated with `path:line` — and hand it to Security as the thing to measure | NEW |

One row. The credential and consent work is the same procedure against a different surface,
and a second agent would need a second inventory — which is the duplication this team exists
to prevent.

## 2. Agent cards

```yaml
agent: ingress-cartographer
unit: connector-platform-trust
triggers:
  - schedule: "weekly — inventory regeneration + reconciliation"   # [[connector-platform-trust-schedule]]
  - schedule: "monthly — credential lifecycle; quarterly — deprecation and external surface"
  - topic: route.added_or_changed        # publisher: NONE (gap — the per-PR guard is CI wiring, which is [[engineering-charter]]'s and unbuilt)
  - topic: oauth.scope_changed           # publisher: NONE (gap — a diff on integrations-oauth.constants.ts announces nothing)
consumes:
  - "[[ENDPOINTS]] route census, and the four modules it labels webhook-class"
  - "integrations-oauth.constants.ts (providers, scopes, the consent single-source at :25)"
  - "[[EXTERNAL_CONNECTIONS]] — 80 environment variables and every third-party host"
  - "[[PAGE_MAP]] rows for the surfaces this team owns (:110, :156)"
emits:
  - "the generated ingress inventory → [[perimeter-ingress-integrity-charter]], which measures enforcement against it"
  - "pi.verified_ingress_ratio → [[partnerships-integrations-agent-stack|pi-bridge-board]]"
  - "per-connector trust contracts as vault PRs, co-signed with Security"
  - "nf_a events (task_type: ingress_inventory_run)"
routing_class: judgment    # classifying a route ingress-vs-management is a contract judgment — it is exactly what the "webhook module" label got wrong
quality_bar: "the inventory is generated, not hand-kept: a rerun on the same commit yields the same classification for every route, and an unclassified route fails the run. pi.verified_ingress_ratio must be the same number as Security's, computed once — if they diverge, ours is deleted (charter). NONE (gap) — no formal verdict basis (ADR 0017 has no grader for classifications)"
autonomy:
  read: autonomous
  propose: autonomous      # inventories, contracts and findings land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: connector-platform-trust
escalates_to: "[[partnerships-integrations-charter]]"
```

**The card's hard rule:** `ingress-cartographer` never writes verification code and never
ships a second `verifyWebhookSignature`. It produces the contract; Security measures the
control; Engineering implements it. **PROD-F4 stays open** — this card takes no position on
whether that split survives.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `ingress-route-audit` | T2 | A route is added or changed in any ingress-classified module | Every route classified; each ingress route's posture stated with `path:line`; an unclassified route fails | Fired twice on 2026-08-24: it showed *"0 of 32 verify signatures"* (`product.md:783`) is false — only **3** of the 32 are ingress — and found `toast.service.ts:189` invoking its verifier only `if (signature && timestamp)`, a fail-open call site in front of a fail-closed helper (`:111-119`) | NEW |
| `connector-trust-contract` | T2 | A new connector is proposed, or an existing one changes auth | A written contract exists — data in, data out, auth model, verification, failure posture, deprecation path — co-signed with Security | Negatively, and checkably: `integrations/` has 2 providers (`integrations-oauth.constants.ts:1`) and **no written contract for either**; `pos-hub` and `toast` hold contradictory failure postures precisely because no contract governs them | NEW |
| `consent-surface-review` | T2 | Any change to `integrations-oauth.constants.ts` scopes | The consent surface is reviewed **as rendered**, not as source; disclosed scopes match requested scopes | `/authorize/:integrationId` has no inbound in-app link (`PAGE_MAP.md:110`) **and** an untraceable route component (`:156`) — the one screen where a user grants access to their data is already unreachable and unanalysable | NEW |

Consumed, owned elsewhere: `pos-registry-audit` ([[pos-bridge-schedule]]); the envelope and
registry ([[skills-charter]]); the control itself
([[perimeter-ingress-integrity-charter]]).

**One row deleted rather than kept.** [[connector-platform-trust-schedule]] proposes
`credential-path-check` on the basis *"Yes, imminent"* — Square and Clover are about to need
merchant tokens (`pos-provider.registry.ts:76, :88`) while `IntegrationProvider` is still
`"google" | "microsoft"`. An imminent instance is not a past one, so it has no row here. It
earns one the first time it fires, which will likely be the first merchant connection.

**Deduplication, stated in advance** (transcribed from the schedule): `ingress-route-audit`
overlaps [[perimeter-ingress-integrity-charter]]'s mandate. Ours produces the classification
and the contract; theirs measures enforcement. If they converge, **ours is deleted.**

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3
  gate unchanged.
- **Episodic** — nf_a `task_type: ingress_inventory_run` and `consent_surface_review`. Needs
  `context.module` and `context.route_class` as jsonb keys, or "which class regressed" is a
  question nobody can answer from the events. **Nothing in `integrations/` emits nf_a today.**
- **Semantic** — `memory/` beside this file, index `connector-platform-trust-MEMORY.md`.
  Founding facts, all already verified: *3 of 32 routes are ingress, 1 correct, 1 fail-open,
  1 secret-in-query-string* (source: charter §Evidence, 2026-08-24); *`inbound-email` accepts
  its shared secret as `?secret=` as well as a header* (`inbound-email.controller.ts:38-40,
  57-58`); *the consent surface is orphaned* (`PAGE_MAP.md:110, :156`). Provenance
  frontmatter per ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and the boundary table.
  `ENDPOINTS.md` and `EXTERNAL_CONNECTIONS.md` are retrieval targets, never preloaded.

**Consolidation** — monthly, mirrored in [[connector-platform-trust-schedule]]: diff this
month's inventory against last month's facts. **Failures first:** a route that changed class,
or an ingress route whose posture regressed, becomes a fact naming the mechanism — "the
verifier is called conditionally", not "verification is weak". Expire facts unverified 90
days; propose skill candidates. One PR; "no delta" is a valid stated outcome, and for this
team it is the *target* state once the guard is wired.

## 5. Async contract

Loops ([[connector-platform-trust-loops]] — `cpt-ingress-classification`,
`cpt-credential-lifecycle`, `cpt-consent-truth`, `cpt-external-surface`,
`cpt-boundary-nonduplication`), nf_a events, vault PRs, skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `route.added_or_changed` has no publisher | The per-PR ingress guard is CI wiring owned by [[engineering-charter]] and does not exist. Until it does, the weekly regeneration bounds the blind spot at 7 days |
| `oauth.scope_changed` has no publisher | Same shape, smaller surface: a scope diff notifies nobody, so consent truth is only as fresh as the last scheduled review |
| One number, two owners, no shared computation | `pi.verified_ingress_ratio` and Security's `unverified_public_ingress` are the same measurement named twice. Neither is generated yet, so the divergence has not happened — the fortnightly `cpt-boundary-nonduplication` loop exists to catch it when it does |
| The trust contract has no consumer today | Nobody signs contracts: `integrations/`'s 2 providers have none. The consumer named in the card (Security co-signature) is a designed relationship, not an observed one |
| Connector-scope exposure is open, not owned here | One process-wide `POS_HUB_WEBHOOK_SECRET` covers all 27 providers and all tenants, and the route never binds `restaurantId` to the key (`POS-BRIDGE-AUDIT.md` §2.4, draft **OD-B**). This card records it as a trust-contract finding and picks nothing |

## 6. Evidence today

- **PARTIAL — the substrate, and it is the good pattern.** 5 endpoints, all guarded
  (`ENDPOINTS.md:226-234`); credential encryption at
  `apps/api-gateway/src/common/crypto/token-crypto.service.ts`; one source of truth for
  scopes shared by the consent screen (`integrations-oauth.constants.ts:25`). Two providers
  only.
- **EXISTS — the verification posture this team would certify on the one route that has it.**
  `POST /pos-hub/webhook/:provider/:restaurantId` verifies HMAC-SHA256 over the raw body and
  fails closed when the secret is unset (`pos-hub.controller.ts:61-86`,
  `pos-hub.service.ts:96-121`) — and that is no longer a code read: the 2026-08-24 proof run
  put five negative cases through it (bad hex, missing header, empty, truncated, valid
  signature over a different body) and all five returned 401 with zero rows written
  (`.planning/04-specs/POS-BRIDGE-AUDIT.md:558-568`).
- **NEW — the cartographer, the generated inventory, all three skills, the `memory/` layer,
  and every nf_a emission.** The inventory has been produced once, by hand, in the session
  that wrote [[connector-platform-trust-charter]]. Nothing regenerates it.
