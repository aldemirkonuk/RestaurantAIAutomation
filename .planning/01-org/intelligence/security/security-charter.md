---
type: charter
division: intelligence
department: security
status: partial
metrics: [sec.unguarded_authenticated_surface, sec.unverified_public_ingress, nf_a.unauthenticated_inference_spend, sec.recurrence_guard_present, sec.fail_open_defaults, sec.checklist_12c_items_with_a_reading]
updated: 2026-08-24
links: ["[[security-premortem]]", "[[security-agenda-full]]", "[[security-agenda-board]]", "[[security-directive]]", "[[security-loops]]", "[[security-schedule]]", "[[ORG_STRUCTURE]]", "[[intelligence]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]", "[[access-control-tenant-isolation-charter]]", "[[perimeter-ingress-integrity-charter]]", "[[ai-surface-security-charter]]", "[[research-math-charter]]", "[[analytics-bi-charter]]", "[[engineering-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[compliance-privacy-charter|compliance-charter]]"]
---

# Security — Charter

Parent division: **Intelligence** ([[ORG_STRUCTURE]] §2). Siblings in-division:
Research & Math, Analytics & BI.

## Mandate

Security is accountable for whether an attacker **can**. It owns the §12C checklist and
a live defect register that was actionable before this department existed. Concretely:
who may reach an authenticated route and whose data they see; every request that is
*supposed* to arrive without identity and how we prove it came from who it claims; and
the class of risk that arrives *through a model* rather than through a route.

This department is not a review function. It **builds the defenses in the line**
([[ORG_STRUCTURE]] §3). Attacking *decisions* and running premortems on them belongs to
[[red-team-charter]], which sits outside the line precisely so it can attack what we
build. We do not claim that scope and we should not be asked to grade our own controls.

## Boundaries

Owns outright:

- **The guard layer** — `JwtAuthGuard`, `TenantGuard` semantics, `@Public()` policy, and
  the CI mechanism that makes the missing-guard defect class non-recurring.
- **The ingress perimeter** — webhook signature verification, shared secrets, published
  public content routes, CORS, rate limiting.
- **The AI attack surface** — prompt injection from untrusted content, tool/action
  allowlisting, denial-of-wallet on inference endpoints, PII and secrets in prompts and logs.
- **The classification itself** — the per-route verdict behind OD-19. Not a per-module
  label; §"The finding this department starts from" below is why.
- **The §12C checklist** — fifteen items, each with a reading or an honest "unmeasured".

Structured as **three charters across (recommended) two teams**:

| Team | The question it answers | Staffing recommendation |
|---|---|---|
| [[access-control-tenant-isolation-charter]] | "Should this request be rejected?" | Merge with the next until OD-19 closes |
| [[perimeter-ingress-integrity-charter]] | "This request has no identity — can we prove where it came from?" | ⬦ same team, second charter |
| [[ai-surface-security-charter]] | "The request was legitimate. The *content* was hostile." | Separate team from day one |

## ⚠️ Two charters, one team — the division's recommendation, adopted honestly

`intelligence.md:190-199` recommends staffing SEC-1 and SEC-2 as **one team holding two
charters**, splitting when the endpoint campaign ships. This charter adopts that
recommendation rather than pretending three teams are staffed, and the evidence below
strengthens the argument beyond what the division doc had:

**Classifying a route decides which control applies to it.** Get the classification wrong
and you audit a control that is already green while the hole stays open. That is not a
hypothetical — it is the live state of `simpos` (below). A handoff seam between "who
classifies" and "who builds the control" therefore runs straight through the middle of a
single decision. Split it now and the seam is inside one route's verdict.

The split trigger is written down and testable: **`sec.unguarded_authenticated_surface`
reaches 0 with a CI assertion holding it there.** At that point access control becomes
steady-state (review new controllers) and perimeter work becomes its own campaign
(distributed rate limiting, secret rotation, signature coverage), and the two charters
stop sharing a file set. Founder call is open as **INTEL-F4** (`intelligence.md:520`).

[[ai-surface-security-charter]] is different in kind and exists from day one regardless.
Its tools are neither guards nor HMACs, and it has a hard cross-department dependency
(below) that will take longer to satisfy than the endpoint sweep will take to run.

## The finding this department starts from

**The systemic root cause.** `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`
returns `true` when there is no authenticated user — by design, logging a warning. So
`TenantGuard` running globally (`app.module.ts:124-126`) protects nothing on its own, and
auth depends entirely on each controller *remembering* `JwtAuthGuard`. Protection is
opt-in across 448 routes.

**The same fail-open shape appears three more times, in the credential itself.** The JWT
signing secret has a hardcoded default in three independent places:
`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:12-13`,
`apps/api-gateway/src/auth/auth.service.ts:64-66`, and
`apps/api-gateway/src/auth/auth.module.ts:28-30` — all three
`|| "your-secret-key-change-in-production"`. `auth.service.ts:71-75` logs a warning and
the process continues. An environment that ships without `JWT_SECRET` set accepts tokens
signed with a string that is public knowledge. `JWT_REFRESH_SECRET` derives from it when
unset (`auth.service.ts:67-69`). **Four fail-open defaults, all announced by a log line
nobody reads.** This is one defect class, not two, and it is this department's thesis:
*the codebase's habit is to warn and continue.*

**Correct behaviour already exists in the same repo**, which is what makes this
fixable rather than cultural: `apps/api-gateway/src/toast/toast.service.ts:112-121` fails
**closed** with no secret configured, and says so in a comment;
`apps/api-gateway/src/pos-hub/pos-hub.service.ts:87-95` does the same and has tests for
it (`pos-hub.service.spec.ts:239-252`); `apps/api-gateway/src/auth/dev-bypass.util.ts:46-52`
gates a bypass behind five independent conditions including `NODE_ENV !== "production"`.
The department's job is to make the fail-closed shape the default, not to invent it.

## The census, and the denominator that moved twice

| Class | Count | Where |
|---|---|---|
| Guarded by `JwtAuthGuard` | **311** | `ENDPOINTS.md:6` |
| Webhook-module routes (legitimately public, need signatures instead) | **32** | `simpos` 11, `toast` 10, `pos-hub` 10, `inbound-email` 1 |
| Explicit `@Public()`, non-webhook | **11** | `communications/test/e2e/*` 9, `vendor-portal` 2 |
| **Unguarded by omission — the backlog** | **94** | `analytics` 39, `notifications` 24, `communications` 9, `dashboard` 8, `contacts` 8, `procurement/recurring-orders` 6 |
| | **448** | |

> **Corrected 2026-08-25.** The 94-row backlog is stale as a *present* count: the
> primary controller of every one of the six named modules now carries a class-level
> `@UseGuards(JwtAuthGuard)` — `analytics.controller.ts:51`, `dashboard.controller.ts:51`,
> and the same on `notifications`, `communications`, `contacts`, `procurement` (verified
> in source). **Recounted 2026-08-26** in OD-19 (`OPEN-DECISIONS.md:32`): **459** route
> decorators across the 47 non-spec controllers, of which **40** sit on the five
> controllers carrying no class-level `@UseGuards`. OD-19 stays open to enumerate those 40
> and confirm each is public by intent.

**The denominator has now been stated four ways: 86 → 103 → 94 → 40.** The department
inherits the reconciliation, and it is worth writing down once because it is the argument
for per-route classification:

- **86** — [[README]] and OD-19 as originally written.
- **103** — `intelligence.md:211-216`, summing `ENDPOINTS.md`'s per-module *header* counts.
- **94** — verified row-by-row against `ENDPOINTS.md`, and canonical until 2026-08-26.
- **40** — current. The re-measure struck the 94 arithmetic as describing "a codebase two
  guard-sweeps ago" and counts routes on class-unguarded controllers instead
  (OD-19, `OPEN-DECISIONS.md:32`).

The 103 figure counted `communications` at its module total of **18** when only **9** of
those rows are unguarded by omission (nine carry `@Public()`), and placed `vendor-portal`'s
2 routes in the webhook bucket. 103 − 9 = 94. **The correction was not arithmetic; it was
that per-module labels do not survive contact with the routes underneath them.** Each of
the first three numbers above is the count of ⚠️ and 🌐 rows, not of module headers.

## The worked example — what this department catches

`apps/api-gateway/src/analytics/analytics.controller.ts` carried **zero `@UseGuards` and
zero `@Public()`** — unguarded by omission, all 39 routes. The exploit chain was two
calls: `PUT /analytics/consultants/:restaurantId/toggle` to enable the paid consultant
layer (default OFF, `consultants.service.ts:11`), then
`POST /analytics/consult/:restaurantId`, which reaches
`consultants.service.ts:154-176` — `api.anthropic.com/v1/messages`, `claude-opus-4-8`,
`max_tokens: 4096`, `thinking: { type: "adaptive" }`, on the founder's key. The only
brake was the `ai: 20/60s` tier at
`apps/api-gateway/src/common/rate-limit/rate-limit.guard.ts:31`, backed by an in-memory
`Map` (`:65-70`) whose own comment says to use Redis in production — so the effective
limit is *20 × instance count*.

**Fixed on branch `fix/analytics-endpoint-auth` (`99da5eb`): one file, +7 lines, a
class-level `@UseGuards(JwtAuthGuard)`. Not yet merged to `main`.** Tracked as **OD-20**.

Three things this example teaches, all of which shape the charters:

1. **The fix was seven lines.** The cost was never the remediation; it was nobody owning
   the question "which routes are unguarded, and is that deliberate?"
2. **The class-level guard now covers `GET /analytics/health` too.** That is probably
   correct and possibly not — a health route behind a JWT stops answering a health check.
   Guard-by-default plus an explicit, CI-diffed `@Public()` allowlist is the mechanism;
   a heroic pass is not.
3. **The blast radius was money, not data**, which is why
   [[ai-surface-security-charter]] and [[access-control-tenant-isolation-charter]] must
   read the same route list from opposite ends.

## The second live example — the one the labels hide

`simpos` is labelled in `ENDPOINTS.md:536` as a *"webhook module — expected public, must
verify signatures instead."* It is not a webhook receiver. It is the POS **simulator's**
control surface: `@Controller("simpos/:restaurantId")`
(`apps/api-gateway/src/simpos/simpos.controller.ts:23`) with catalogue CRUD, check
creation, and check close — eleven unguarded routes taking the tenant from the URL path.

`POST /simpos/:restaurantId/check/:checkId/close` calls `sendSignedWebhook`
(`simpos.service.ts:489-520`), where **the server signs the payload with its own
`POS_HUB_WEBHOOK_SECRET`** and POSTs it to `/pos-hub/webhook/generic_webhook/:restaurantId`.
`pos-hub` verifies that signature correctly and fails closed
(`pos-hub.controller.ts:71-75`), and — per its own API description at
`pos-hub.controller.ts:57` — *"for closed checks — depletes stock via
`apply_stock_movement`/`record_glass_pour`."* `SimposModule` is registered
unconditionally at `app.module.ts:84`, with no `NODE_ENV` gate.

This is a confused deputy. **The perimeter control is intact and still lets an
unauthenticated caller get the server to sign on their behalf**, because the signature
authenticates the *sender* (us) rather than the *originator*. The per-module label points
an auditor at the HMAC, which is already green. The actual gap is a missing guard — the
other team's tool.

**This is the whole case for one team holding both charters, and for classifying per
route.** Recorded as a finding, not a fix: whether `close` reaches a real tenant's
inventory, and whether the sim restaurant is an isolated tenant, is exactly the
classification OD-19 asks for and nobody has done it yet.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Attacking *decisions*; premortem facilitation | [[red-team-charter]] *(advisory)* | We build defenses in the line; they attack what we build. Same unit doing both is forbidden ([[ORG_STRUCTURE]] §3) |
| Building the guard mechanism into the framework | [[platform-api-charter]] *(Engineering)* | We classify and specify the control; Engineering authors and owns the code |
| Lawful basis, DPAs, consent, retention, GDPR/CCPA | [[compliance-privacy-charter|compliance-charter]] *(Corporate)* | They own whether we *may*; we own whether an attacker *can* |
| Whether the product *should* do a thing at all | [[compliance-privacy-charter|compliance-charter]] | Ethics & Responsible AI was considered and not adopted ([[ORG_STRUCTURE]] §3) |
| Cost telemetry on model calls | [[neural-footprint-instrumentation-charter]] *(R&M)* | Hard dependency, not a request — see below |
| Grading nondeterministic model output quality | [[evaluation-doneability-charter]] *(R&M)* | They grade whether it was *good*; we grade whether it was *attacker-steered* |
| Incident response, SIEM, on-call | Nobody, deliberately | Rejected at `intelligence.md:505` with an entry trigger: first real incident, or first breach-notification SLA |
| Layer-dependency violations (L0–L6) | [[architecture-review-charter]] *(advisory)* | Findings-only, lands in `questions.md` |

## Metrics it moves

Six numbers, never summed. A department that reports one security score has hidden
which control failed.

| Metric | Baseline today | Owner |
|---|---|---|
| `sec.unguarded_authenticated_surface` | **94** → target **0** | [[access-control-tenant-isolation-charter]] |
| `sec.recurrence_guard_present` | **false** — no endpoint-guard CI check exists | [[access-control-tenant-isolation-charter]] |
| `sec.unverified_public_ingress` | **unknown by design** — scope is 43 routes; establishing it is the first deliverable | [[perimeter-ingress-integrity-charter]] |
| `sec.fail_open_defaults` | **4** — `tenant.guard.ts:38-46` + three JWT-secret fallbacks | [[perimeter-ingress-integrity-charter]] |
| `nf_a.unauthenticated_inference_spend` | **unmeasurable** — the NestJS callsites emit no cost events at all | [[ai-surface-security-charter]] |
| `sec.checklist_12c_items_with_a_reading` | **8 of 15** (see [[security-agenda-full]]) | department |

The `unguarded_authenticated_surface` and `unverified_public_ingress` names are taken
verbatim from `intelligence.md:242,287` and namespaced `sec.*` so Dataview can cluster
them. Neural-footprint tie, stated once: **an unauthenticated write is an action with no
attributable subject — an unrecordable footprint.** Every route on the 94 is a hole in
NF-A's subject column before it is anything else.

## Evidence today

**PARTIAL** — real controls exist, real defects exist, no security *unit* has ever run.
Graded honestly rather than talked up in either direction.

**EXISTS — generic tooling, already wired:**
- `.github/workflows/codeql.yml` — CodeQL, `security-extended,security-and-quality`,
  JS + Python, per-PR and weekly Monday cron.
- `.github/dependabot.yml`; Trivy in `.github/workflows/ci.yml:244-254` emitting SARIF.
- `scripts/audit-api-credentials.js`.

**EXISTS — correct controls, usable as templates:**
- HMAC-SHA256 over the raw body, fail-closed, tested: `toast.service.ts:106-130`,
  `pos-hub.service.ts:87-95`, `pos-hub.service.spec.ts:239-252`. `main.ts:9-14` sets
  `rawBody: true` specifically so exact-byte verification is possible.
- `bcrypt` for passwords throughout `auth/auth.service.ts` (`:117`, `:201`, `:594`,
  `:1180`, `:1492`, `:1498`, `:1644`).
- The dev auth bypass, five-condition and fail-closed (`auth/dev-bypass.util.ts:36-52`).
- Prompt-injection quarantine exists in code: `inbound-responder.service.ts:432-456`
  refuses to draft when `injection_suspected` is set, and `:95-96` says the quarantine is
  never bypassed by trust.
- 182 `ENABLE ROW LEVEL SECURITY` statements across 9 migration files.

**PARTIAL:**
- Rate limiting is global (`app.module.ts:120-123`) with sane tiers
  (`rate-limit.guard.ts:27-33`) but backed by an in-memory `Map` (`:65-70`) — per
  instance, not distributed.
- CORS is **not** `*`, but `main.ts:26` allow-lists `/^https:\/\/.*\.vercel\.app$/`
  with `credentials: true`, in production. That is every app on a shared multi-tenant
  domain, not a wildcard but not far off.
- RLS is enabled in the schema; the API connects with `SUPABASE_SERVICE_ROLE_KEY`
  (`database/database.service.ts:15`), which bypasses it. RLS is therefore a defense for
  direct-client access, not for the gateway path. **Unverified claim to resolve, not a
  finding yet.**

**NEW — nothing exists:**
- **No endpoint-guard CI check.** The repo has seven grep-shaped CI guards for other
  invariants (`scripts/check_no_direct_stock_writes.sh`, `check_no_guest_name_matching.sh`,
  `check_schema_parity.sh`, …) — so the mechanism is proven here and simply has not been
  pointed at this defect class.
- No adversarial injection corpus. `inbound-responder.service.spec.ts:248-263` asserts the
  *plumbing* — given a mocked model response with `injection_suspected: true`, the flag
  propagates. Nothing tests whether the model actually sets it on a real payload.
- No per-tenant inference budget. No cost telemetry on any NestJS model callsite.

**Three defects cited in the division's own team doc have been closed by hand since it
was written** — `one-tap-actions` now carries `@UseGuards(JwtAuthGuard)` at
`one-tap-actions.controller.ts:64` and 403s cross-tenant access at `:80`;
`ManualOverrideModal.tsx:114-122` now takes the actor from the signed-in user;
`ux-optimizer.controller.ts:55` was closed in v2.0. `.planning/v3.0-TECH-DEBT.md:62-75`
still lists 44.1a as open. **Four instances of one defect class, four one-off fixes, and
the recurrence guard still does not exist.** The register is draining and the drain has
no lid. That single sentence is why this department exists.

## Open forks touching this department

- **OD-19** — classify the 94. This department's first assignment. `intelligence.md`'s
  INTEL-F1 (denominator) is **resolved at 94**; its INTEL-F2 (`vendor-portal` misclassified) is
  **resolved in the regenerated census** — the routes now carry `@Public()` with a written
  rationale (`vendor-portal.controller.ts:6-13,20,40`) and `ENDPOINTS.md:656` labels them
  correctly. The underlying question INTEL-F2 raised — *classify per route, not per module* —
  is **not** resolved, and `simpos` is the live proof.
- **OD-20** — 🔴 the analytics spend hole. Fixed on a branch, unmerged. Whether it merges
  standalone or folds into the sweep is a founder call; **this charter recommends merging
  it standalone today** and treating it as sweep instance #1.
- **INTEL-F4** (`intelligence.md:520`) — do SEC-1 and SEC-2 start merged? This charter
  recommends yes, with a written split trigger.
- **OD-11** — the NF column contract gates
  [[ai-surface-security-charter]]'s primary metric entirely.
