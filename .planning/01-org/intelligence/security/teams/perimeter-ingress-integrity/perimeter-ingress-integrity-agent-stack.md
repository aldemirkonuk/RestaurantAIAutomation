---
type: agent-stack
division: intelligence
department: security
team: perimeter-ingress-integrity
status: designed
updated: 2026-08-27
metrics: [sec.unverified_public_ingress, sec.fail_open_defaults, sec.distributed_rate_limit_present, sec.secrets_in_url_or_bundle]
links: ["[[perimeter-ingress-integrity-charter]]", "[[perimeter-ingress-integrity-schedule]]", "[[perimeter-ingress-integrity-loops]]", "[[perimeter-ingress-integrity-premortem]]", "[[perimeter-ingress-integrity-directive]]", "[[0034-agent-stack-artifact]]", "[[security-agent-stack]]", "[[access-control-tenant-isolation-agent-stack]]", "[[skills-charter]]", "[[platform-api-charter]]", "[[integration-engineering-charter]]", "[[ENDPOINTS]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Perimeter & Ingress Integrity — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> ⬦ Same team as [[access-control-tenant-isolation-agent-stack]] until the split
> trigger fires; a separate card because the question is different — *this request has
> no identity, can we prove where it came from?* The agent reads controls and files
> verdicts; it never changes one. [[platform-api-charter]] authors the config,
> [[integration-engineering-charter]] authors the wire.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ingress-verdict-sentinel` | Fill the five-field verdict — `sender`, `proof`, `fail_mode`, `verdict`, `evidence` — for every route in the 43-route ingress scope, and keep the fail-open and secret-shape counts true, without touching a live control | NEW |

One row. The fail-open sweep and the ingress verdict are two skills, not two agents:
they read the same file set and the same secret reads, and splitting them would mean two
agents grepping `config.get` in the same PR.

## 2. Agent cards

```yaml
agent: ingress-verdict-sentinel
unit: perimeter-ingress-integrity
triggers:
  - topic: pr.ingress_control_changed     # publisher: NONE (gap — no CI check watches guards, strategies, or secret reads)
  - schedule: "weekly — one ingress module per session; new `@Public()` review"   # mirrored in [[perimeter-ingress-integrity-schedule]]
  - schedule: "monthly — fail-open sweep + secret-surface inventory (3-run sunset)"
consumes:
  - the five ingress modules' source           # publisher: the repo (toast, pos-hub, simpos, vendor-portal, inbound-email)
  - "[[ENDPOINTS]] module labels"              # publisher: the census scan — and the labels are what the verdict must not trust
  - "[[EXTERNAL_CONNECTIONS]] — 80 env vars"   # publisher: that doc
  - rate-limit.guard.ts:27-33,65-70 and main.ts:16-38  # publisher: the repo
emits:
  - "sec.unverified_public_ingress (provisional 23 of 43), sec.fail_open_defaults, sec.distributed_rate_limit_present, sec.secrets_in_url_or_bundle"   # consumer: [[perimeter-ingress-integrity-agenda-board]], rolled up by [[security-agent-stack|sec-orchestrator]]
  - "a route whose real gap is a missing guard, not a missing signature"   # consumer: [[access-control-tenant-isolation-agent-stack|route-classifier]] — the `simpos` shape
  - verdict + secret facts → memory PRs (§4)   # consumer: this team's semantic layer
  - nf_a events (task_type: ingress_audit)     # consumer: NF-A tables (ADR 0006/0008)
routing_class: judgment
quality_bar: "a route with a `proof` and no named `sender` is a FAILED check, not a pass ([[perimeter-ingress-integrity-schedule]]) — that inversion is the whole job; the fail-open list passes only at zero, and each fail-closed branch must have a test (`pos-hub.service.spec.ts:239` is the reference). NONE (gap) — ADR 0017 has no verdict basis for audits"
autonomy:
  read: autonomous
  propose: autonomous            # verdicts, counts and control specs land as PRs
  mutate_stock_money_outbound: confirm   # constant; and see the hard rule below
memory: perimeter-ingress-integrity
escalates_to: "[[security-charter]]"
```

**The card's own hard rule:** the sentinel never changes a live ingress control — not a
signature check, not a CORS entry, not a rate-limit tier. A rejected webhook does not page
anyone; it just stops arriving ([[perimeter-ingress-integrity-directive]], integration-break
rule). Any control change it proposes goes through one close-time of observe-then-enforce
review with a human, which is also why an autonomous "fix" here is worse than a slow one.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `webhook-signature-audit` | T2 | Weekly per ingress route; per PR touching `toast/`, `simpos/`, `pos-hub/`, `vendor-portal/`, `common/orchestrator/inbound-email.controller.ts` | Five verdict fields per route; a `proof` with no named `sender` fails at field one | `simpos` carries a correct, fail-closed, tested HMAC (`simpos.service.ts:489-520`) *and* eleven unguarded routes, and is labelled "webhook module — must verify signatures instead" (`ENDPOINTS.md:536`). A signature-only audit passes it; a sender-first audit fails it | NEW |
| `fail-open-audit` | T2 | Per PR touching any guard, strategy, or module reading a secret from config; monthly across the repo | List every path where a missing secret leads to `return true`, `skip`, or `warn`-then-continue; passes only at zero; asserts a test on each fail-closed branch | Three independent `\|\| "your-secret-key-change-in-production"` fallbacks shipped separately (`jwt.strategy.ts:12-13`, `auth.service.ts:64-66`, `auth.module.ts:28-30`), plus `tenant.guard.ts:38-46` doing the same for authentication — four instances of one shape, each by someone who did not know about the others | NEW |

Consumed, owned elsewhere: `endpoint-guard-census` and `route-classification-pass`
([[access-control-tenant-isolation-agent-stack]] — same team, other charter); registry
governance ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  §3.3 gate unchanged.
- **Episodic** — nf_a `task_type: ingress_audit`. Needs `context.route` and
  `context.fail_mode` as jsonb keys, so "which controls were fail-open when, and for how
  long" is a query rather than a re-read of monthly PRs.
- **Semantic** — `memory/` beside this file, `perimeter-ingress-integrity-MEMORY.md` as
  index. Founding facts, already known: the standard already set on two modules
  (`toast.service.ts:112-121`, `pos-hub.service.ts:87-95`, and `main.ts:9-14` setting
  `rawBody: true` so exact-byte verification is possible); the confused deputy
  (`simpos.service.ts:489-520` — our own server signs, and the signature authenticates
  the sender, not the originator); the two leak paths that defeat rotation by construction
  (`?secret=` in access-log history, `VITE_DEV_AUTH_BYPASS_SECRET` in every bundle ever
  built). Provenance per ADR 0034; every write a PR.
- **Working** — the card, the MEMORY index, charter §Mandate and §Metrics. Ingress
  controllers, `EXTERNAL_CONNECTIONS.md` and `main.ts` are retrieval targets by
  `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[perimeter-ingress-integrity-schedule]]:
**failures first** — every route whose verdict changed becomes a fact naming the control
that moved, and every fail-open path closed becomes a fact naming *how it shipped*, since
the shape recurring is the finding, not any one instance. A module label contradicted by
its routes becomes a fact before it becomes a verdict (premortem M2). Expire facts
unverified for 90 days; propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction: board rows to the department (vault PR), NF-A events, loops in
[[perimeter-ingress-integrity-loops]], skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `pr.ingress_control_changed` has no publisher | No CI check watches guards, strategies, or `config.get` on a secret; today only human review notices. The weekly sitting bounds the blind spot at 7 days |
| The observe-then-enforce review has nothing to read | No ingress control runs in observe mode, so "what would this have rejected?" has no log stream. The review is real cadence with a missing input, and shadow logging must land with the first control change, not after it |
| `sec.env_vars_with_named_consumer` has no publisher | 80 env vars are listed; who consumes each is unrecorded, so the monthly inventory is hand-derived — which is why it carries a 3-run sunset |
| Remediation is a proposal, not a handoff | [[platform-api-charter]] authors the rate-limit store, the CORS config and the guard; [[integration-engineering-charter]] the wire. Nothing tracks a filed verdict to a merged fix |

## 6. Evidence today

- **NEW — the sentinel and both skills.** Both past instances above were found by hand in
  the 2026-08-24 generation session; nothing runs them on a schedule.
- **EXISTS — the standard to reach, on two of five modules.** HMAC-SHA256 over the raw
  body, fail-closed, with tests (`toast.service.ts:106-130`, `pos-hub.service.ts:87-95`,
  `pos-hub.service.spec.ts:239-252`). This team's job on the other three is to reach a
  standard already set here, not to invent one.
- **PARTIAL — three known weaknesses, all readable from source today:** the `?secret=`
  query credential (`inbound-email.controller.ts:53-58`, header path correct); the
  in-memory rate-limit `Map` (`rate-limit.guard.ts:65-70`) making the effective limit
  *tier × instance count*; the unscoped `/^https:\/\/.*\.vercel\.app$/` CORS origin with
  `credentials: true` in production (`main.ts:26`).
- **PARTIAL — the baseline has moved since the charter.** 23-of-43 was provisional at
  2026-08-24; `foundation/README.md` §2.3 records the `simpos` confused deputy, the
  `pos-hub` approval gate and Toast's unset-secret path closed in PRs #31/#32. Confirming
  the count per route is this agent's first run — **the charter's provisional reading
  stands until it does.**
- **NEW — everything in §4**, and `sec.distributed_rate_limit_present` is still `false`.
