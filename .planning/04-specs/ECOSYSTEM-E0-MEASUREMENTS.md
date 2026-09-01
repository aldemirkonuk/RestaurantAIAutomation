# Ecosystem E0 — the measurements, and what they corrected

- **Status:** Evidence of record for the 2026-09-01 E0 measurement pass. Findings only; the decisions they fed are in ECOSYSTEM-PLAN.md and its ADRs.
- **Date:** 2026-09-01
- **Anchor:** every claim below is against `origin/main` @ `b70e62d9` unless stated. Re-anchor before acting — main moves hourly.
- **Method:** seven parallel agents over a clean read-only worktree, dispatched under the hardness threshold in [ADR 0050](../decisions/0050-agent-dispatch-hardness-threshold.md). Two findings were independently corroborated by concurrent sessions, noted per row.

> **Retire-to-write (§4).** This supersedes the scattered auth-by-omission counts
> (`~94`, `86/103/94`, `39/40`, `9`) wherever they appear as live claims, and the
> `375` insight figure. It replaces the ephemeral `scratchpad/eco-research/01-05`
> pass of 2026-08-28, which no longer exists. It adds no new register rows.

---

## 1. The headline: four of the plan's own claims were wrong

The 2026-08-28 plan was written against a stale checkout (`feat/p1-readout`, ~105
commits behind) and its §0 caveat says every claim was re-anchored to main. Four
were not. This is not a criticism of the plan — it is the caveat doing its job,
one pass later.

| Plan claim | Measured reality | Evidence |
|---|---|---|
| §4.3 "~94 endpoints reachable unauthenticated **by omission**" | **0 by omission.** 468 route handlers: 444 authenticated, 23 deliberately public with evidence, 0 by omission, 1 unclear (`GET /events/metrics`). | Census over 49 files / 51 `@Controller` classes |
| §4.5 "`STATE.md`/`PROJECT.md` still read v3.0/v2.0" | **Both already read "P3 — Grade, then scale"**, and had since 2026-08-26/27 — *before this sentence was written on 2026-08-28.* | `STATE.md:8`, `PROJECT.md:31` |
| §3 "Ask AI … is built on `feat/p3c-ask-ai-web` but **not on main**" | **It is on main and in production** — 11 gateway files, web UI, migration applied. | `ask-ai.service.ts:913-926` |
| §3 "engine delivers ~19 (16 `record()` calls)" | **24 implemented** — and *fewer actually fire*; two families are dead. | see §3 below |

**The lesson worth keeping:** a plan that names its own anchoring caveat still
shipped four unre-anchored claims, and three of them were load-bearing enough to
schedule work against. Re-anchoring is not a disclaimer you write once; it is a
step you perform per claim.

---

## 2. Auth: the number was never in dispute, the question was

Six prior passes produced six numbers and everyone assumed they conflicted. They
did not — they answered six different questions on three different trees.

| Number | What it actually counted | Verdict |
|---|---|---|
| 131 → 71 → **6** → **7** | routes public-by-necessity carrying no `@Public()`, over four commits | the real series, reproducible |
| 86 / 103 / 94 | module-bucket subtraction on a two-sweeps-old tree | superseded |
| 39 / 40 | routes on class-unguarded controllers (a proxy, not the thing) | superseded |
| 9 (`ENDPOINTS.md:19-23`) | genuinely wrong — `toast.controller.ts:63` is guarded | **stale, fix it** |

Engineering's `6` reproduces **exactly** on its own tree. It is 7 today only
because `GET /health/live` landed in PR #154 and moved the count with no signal —
which is the argument for a guard rather than a recount.

**The mechanism, which is the part that matters.** `app.module.ts:130-137`
registers only `RateLimitGuard` and `TenantGuard` as `APP_GUARD`. `JwtAuthGuard`
is **per-controller**, so *the default for a controller that declares nothing is
fully unauthenticated*. The defect generator is intact even though the defect
count is zero. Endpoint 469 is unguarded by default.

`TenantGuard` fails open (`tenant.guard.ts:47-52`) and **can never do otherwise**:
it is global, runs before passport sets `request.user`, and its comparison at
`:37-46` has therefore never executed. A concurrent session found the mitigating
half independently — `assertTenantMatch` now lives in `JwtAuthGuard:60`, so tenant
isolation fails *closed* on any guarded route. So "TenantGuard fails open" is
true-but-misleading as a standalone claim, and both halves must be stated together.

**Four traps that explain the historical spread**, recorded so the next census
does not re-learn them: `grep -v spec` silently drops `pro`**`spec`**`ts.controller.ts`;
`@UseGuards` sits *above* `@Controller` in 15 files (missing this gives 133 instead
of 7 — a 19× error); two files declare two `@Controller` classes; and **23 of 40
`@Public()` string matches are comment prose**.

**Still open, and not counted by the above:** WebSocket auth fails open outside
production (`websocket.gateway.ts:672-678`) and per OD-35 dev/staging share
production's Supabase; Swagger UI is unauthenticated at `/api/docs` (`main.ts:142`).

---

## 3. Intelligence: enumerated vs implemented, not 573-vs-375-vs-19

Three independent passes (this session's agent, a concurrent session, and OD-33)
converged.

| Figure | Truth |
|---|---|
| **573** | correct. `INSIGHT_CANDIDATES.length`, `insight-catalog.ts:547`. Settled by OD-33 on 2026-08-26. |
| **375** | **never a true state on main.** `insight-catalog.ts` has one commit whose message narrates "347→375" while the committed file already computes 573. Survives as stale text in ~5 places. |
| **~19** | undercount. Conflated call sites with types. |
| **24** | verified ceiling: 16 literal `record()` sites + a shared `timeSeriesInsights` helper called 3× emitting 12 more distinct keys. |
| **< 24** | the honest number. Two families are dead: `insight-generator.service.ts` selects `provider_name` on `procurement_orders` (column does not exist), and maps `wineId: c.master_wine_id` off a nested join so `wineId` is `undefined` on every row. |

So the reconciliation is **enumerated 573 vs implemented ≤24, gap ~549** — and two
whole catalogue categories (`efficiency` 108, `inventory` 34) are at zero.

**The live defect this exposed:** the shipped "computable now" meter filters the
573-space by *data availability only*, not by whether a generator exists — showing
~513 computable against ≤24 real, a **~21× overstatement visible to users today**.
That violates locked **ADR 0020** ("a surface with no data says so; it never
invents one"; a mislabelled number is a fabrication). Founder approved fixing it
now; in flight.

---

## 4. The buy-side: the dead wiring holds, by four independent breaks

The plan named one break. There are four, any one sufficient.

1. `pos.sale.completed` has exactly **one producer in the repo** — `pos_integration_agent.py:837`. Zero producers in `apps/`.
2. The NestJS Toast door POSTs to a route that **does not exist**: `toast.service.ts:697` → `{ORCH}/api/v1/toast/webhooks/order`, but the orchestrator registers only `/api/v1/pos` (`api/pos_routes.py:22`). It 404s and **the error is swallowed** at `:708-715`. Six `/api/v1/toast/*` calls affected.
3. The pos-hub spine has **no orchestrator wiring at all** (zero `orchestrator`/`httpClient` hits in `src/pos-hub/`).
4. **Previously unnamed — envelope shape.** NestJS publishes flat (`orchestrator.service.ts:78-88`); Python wraps as `{event_type, payload}` (`message_bus.py:693-701`); `buffer_manager.py:231` reads `message["payload"]` and bails at `:242`.

**One correction that shrinks the fix:** the Python read side is *already on the
live path*. `buffer_manager` evaluates `restaurant_inventory` (`core/database.py:814`),
the lots projection NestJS writes. **Only the trigger is disconnected, not the data.**

**The webhook-forgery fix is half-landed, and the remaining half is configuration.**
`resolveWebhookSecret` (`pos-hub.service.ts:304-341`) now prefers scoped
per-restaurant secrets, fails closed, and compares with `timingSafeEqual` — but the
legacy unscoped `POS_HUB_WEBHOOK_SECRET` survives and is what SimPOS signs with
(`simpos.service.ts:490-501`), so **the forgeable path stays reachable for any
connection with no scoped secret**. That is an operational gap, not a code gap,
which makes it exactly the kind that gets marked done and is not. It ties to the
unfiled `pos_connections` fork (§7.4 of the plan).

**`pos_webhook_logs` exists in no migration at all** — the dormant Python agent
writes a table the schema never creates.

**Toast divergence confirmed**, with three stale citations corrected: the
`?? "bottle"` default is at **`toast.service.ts:524`** — three documents cite
`:502` or `:520`. 5× over-depletion = 750/150 defaults in `record_glass_pour`.
Unreachable in production (fail-closed, no `TOAST_WEBHOOK_SECRET`) but **reachable
in dev unsigned**. Undocumented second defect: the Toast door never selects
`sale_volume_ml` (`:472`), so the human remediation UI cannot repair it.

---

## 5. 🔴 A live ungated sense→act path, which E1 would have switched on

`procurement_agent` is **CORE-tier** (`agent_registry.py:78-82`), subscribes to
`stock.threshold.breached`, and creates a `NEGOTIATING` order plus a
vendor-conversation intent **with no human anywhere**
(`procurement_agent.py:130-131`, `:210-249`).

It is inert today only because the Python POS pipeline feeding it is dormant — and
**E1's own "unify the POS pipeline" step is what switches it on.** The founder
locked this as blocking: nothing else in E1 lands until it is gated. In flight as
proposals-only, following the `recurring_order_agent` conversion from PR #152.

**Also, no dollar spend cap exists anywhere in the repo.** `MAX_REORDER_QUANTITY=500`
caps units, not money.

---

## 6. The send path: right conclusion, wrong seam

The plan says the buy-side send is RabbitMQ-only. It is not: `approveDraft`
(`procurement.service.ts:1573-1719`) sends via Gmail **synchronously inside
NestJS**, and is what web and mobile actually call. The RabbitMQ-only,
fire-and-forget, error-swallowed hop is one step earlier — `approveOrder`
publishing `procurement.conversation_request` (`:873-898`), which unlike
`createOrder` (`:424-448`) has **no HTTP fallback**. A dead fleet kills the
*draft*, so no draft ever appears to approve. Same outcome, different seam — and
the fix lands in a different place than the plan implied.

**The real headline: a stuck approval is completely invisible.** No status, no
sweep, no alert distinguishes "the AI is thinking" from "it died nine days ago."

**A live duplicate-PO bug, independent of any queue.** `approveDraft` has no
atomic claim (the auto-send sweep at `:1924-1930` does), so two concurrent taps
both send; and it sends *before* recording, so a failed status write leaves the
email at the vendor and the row at `PENDING_APPROVAL`, inviting a second tap.
Founder approved a hotfix; in flight.

**The `conversations.*` approve path is broken three ways** and is only harmless
because its one UI caller is orphaned: it POSTs to `/api/v1/events/publish` (a
FastAPI route that does not exist), writes five columns that exist nowhere in the
schema, and returns `messageSent: true` after swallowing the failure (`:677-682`).

---

## 7. A cross-cutting fault the plan did not name: silent cross-runtime failure

Five instances, three runtimes, **none visible to CI**, all with the same shape —
a swallowed error making a permanently-dead path look like a merely-empty one:

| # | Where | Shape |
|---|---|---|
| 1 | `toast.service.ts:697` → `:708-715` | 404 to a nonexistent route, error swallowed |
| 2 | `orchestrator.service.ts:78-88` vs `message_bus.py:693-701` | envelope shape mismatch, consumer bails silently |
| 3 | `conversations.*` `:677-682` | 404 + phantom columns, returns `messageSent: true` |
| 4 | `provider_conversation_agent.py:2677` | bare `except` — and it is **load-bearing**: "fixing" it alone converts a silent loss into a duplicate vendor email via the bus retry path |
| 5 | `insight-generator.service.ts` | selects a column that does not exist; family never emitted |

This is a platform posture, not five bugs. It belongs in §4 of the plan as a named
fault with an owner.

---

## 8. Division-layer corrections (feed the ADR 0049 addendum)

Two independent passes — this session's census and a concurrent session's atlas
writers — reached the same conclusions.

| §3a claim | Correction |
|---|---|
| `integrations` under **POS** | **Wrong — it is Google/Microsoft OAuth** (`integrations-oauth.constants.ts:39,70`); its page links only to Settings. Belongs to **Platform/Admin**. |
| Sommelier pages `sommelier` + `wine-agent` | `wine-agent` was **retired** 2026-08-26 (`RETIRED.md:19-20`). Live pair is `sommelier` + `wines`. |
| `reports` | listed as a **Restaurant module** *and* an **Intelligence page**; `reporting_agent.py` is in neither. Resolve to Intelligence/Analytics by the primary-consumer rule. |
| Studio pages | `studio`, `studio-queue`, `studio-certify`, `studio-invite-redeem` appear in **no** division. Assign to Sommelier. Note Wine Studio has **no gateway module of its own** — it is a proxy pair in `common/orchestrator/` (`studio-proxy.controller.ts:41`, `studio-invite.controller.ts:48`) forwarding 14 endpoints to `api/studio_routes.py:59`. |
| Agent stubs | **5 of 24 are `IS_STUB`** (`auto_pilot` 42 LOC, `ghost_inventory` 43, `shrinkage_detective` 41, `negotiation_playbook`, `compliance`). §3a caveats only `auto_pilot_agent` and lists two others as live. |
| Customer division | **Zero application code.** Only a 564-line migration with no caller anywhere. "Eight divisions" is seven live plus one aspirational. |
| Unassigned code homes | `apps/mobile`, `packages/database`, `packages/ui`, `services/api-gateway`, `services/database`, and **`common/orchestrator/` — 7,256 LOC, 8 controllers, 8 unrelated prefixes, no charter owning it.** |
| Unassigned agents | `drift_agent`, `calendar_agent`, `menu_analyzer_agent`, `visual_verification_agent`, `inequality_detector`, plus the `restaurant-templates` module. |

**Dead code found in passing:** `contacts` has **zero callers** anywhere in `apps/`
(8 routes); `services/api-gateway/routes/advanced_features.ts` is 423 lines with
zero repo-wide references; `apps/web/src/pages/RecurringOrders.tsx` is orphaned
(no page note, no route).

**A broken flagship, not a hollow one:** `SommelierAI.tsx:172-173` calls
`POST {orchestratorUrl}/api/v1/sommelier/chat` — a route that exists nowhere in
`services/agent-orchestrator`. The Sommelier division's main surface calls a 404.

---

## 9. Corrections owed to documents outside this pass

Filed here so they are not lost; each belongs to its own owner and its own branch.

| Doc | Stale claim | Truth |
|---|---|---|
| `ENDPOINTS.md:19-23` | 9 unguarded, both open findings | `toast.controller.ts:63` is guarded |
| engineering task **PA-4** (due 2026-09-18) | 7 `communications` routes unguarded | now class-guarded **and** `NonProductionGuard`-gated |
| `procurement-vendor-network` charter | `unguarded_money_moving_routes`: recurring-orders "all unguarded" | class-level `JwtAuthGuard` at `recurring-orders.controller.ts:35`, OD-20, 2026-08-25 |
| OD-31 | `recurring_order_agent` is "a plain class, not a BaseAgent" | it is a live, registered `BaseAgent` |
| 4 docs incl. a memory | `provider_promotions` is dormant | **not dormant** — written on every provider-matched inbound (`promotion-extractor.service.ts:124`, wired `rabbitmq-bridge.service.ts:789-799`) plus a 09:00 digest cron |
| `ROADMAP.md:35` | P3.0 gate open | shipped 2026-08-27 (`2b5592f3`) |
| `STATE.md:92` | P3.A mobile parity "not started" | in progress, 8.9% → 20.3% (`ab5fb48d`) |
| `v3.0-TECH-DEBT.md:36` | "current milestone is P2" | P3 |
| `studio.md`, `studio-queue.md` | `broken` verdict, evidence "zero `@Controller(studio)`" | superseded by `cc10c228`; `studio-certify.md` already carries the correction, these two do not |
| `App.tsx:203` | cites **ADR 0020** for studio-role gating | 0020 is about fabricated answers; the real one is **0021** |

---

## 10. What this pass could NOT verify

Stated plainly, per §0.5 — none of the below is a claim, and nothing should be
scheduled as though it were settled.

- **Deployed orchestrator liveness.** Unobservable from the repo. Worse: the nightly check that would report it is suffixed `|| true` with no final `exit 1`, so it cannot fail.
- **Whether `20260827100000_photo_count_suggestions.sql` is applied to production.** Needs a live check, not a static read.
- **Production schema drift** against the "these five columns do not exist" claim in §6.
- **Whether Gmail preserves a caller-supplied `Message-ID`** — part of the duplicate-recovery story depends on it.
- **Railway environment values**, including whether `TOAST_WEBHOOK_SECRET` is set anywhere but production.
- A real crossing *rate*: `sales_velocity_7d` is `0.000` across every SKU, so §5's volume work is modelled, not measured, and says so.
