# The Mudavym Ecosystem Plan — POS → Restaurant → Sales → Customer as one closed loop

- **Status:** DRAFT plan of record, awaiting the founder's sequencing lock (the forks in §7). The map and phase content below are evidence-grounded; the *order* is the open decision.
- **Date:** 2026-08-28
- **Author:** synthesized from five parallel research passes (`scratchpad/eco-research/01-05`, this session) over **origin/main**, cross-checked against the unmerged agent-stack/wave PR chain (#145–#153).
- **Anchoring caveat (read first):** the research read the working checkout on `feat/p1-readout`, which is ~105 commits behind main (main's `pos-hub.service.ts` is 931 lines vs the branch's 615). Every load-bearing claim here is re-anchored to **origin/main**; where a gap is already closed on main or on an in-flight PR, it says so. Do not act on a gap without re-confirming it against main.

---

## 1. The one sentence

The **sell-side sensing loop is real and closed** — a guest's order flows autonomously from POS check → inventory depletion → low-stock detection → analytics learning — but the **buy-side acting loop breaks at the sense→act seam**, the **intelligence layer promises far more than it computes**, the **demand-origin (the guest) is unbuilt and held**, and three **cross-cutting faults** (a two-runtime split, auth-by-omission, and zero real-merchant data) sit under all of it. This plan closes the loop, in an order the founder chooses.

## 2. The ecosystem as it actually runs (the 10-hop spine)

From `eco-research/05-end-to-end.md`, re-anchored to main:

| Hop | What | State | The seam |
|---|---|---|---|
| 1 | POS check ingested | **WIRED** — HMAC webhook → idempotent `pos_checks` upsert | *known-open: the webhook secret was cross-tenant-forgeable (one global secret); a fix is in flight this session* |
| 2 | Inventory depletes | **WIRED** — closed checks → `record_glass_pour`/`apply_stock_movement` RPCs, lots-as-truth, unmapped lines queued never dropped | ADR 0011/0015/0030 (on main; absent on the stale checkout) |
| 3 | Low-stock detected | **WIRED** — edge sweep, dedup, one grouped notification; mirrors sale → `wine_consumption_log` | this is the demand series analytics reads |
| 4 | **Reorder proposed** | **BROKEN — no autonomy** | `AutoPilotAgent` is a declared stub (`IS_STUB=True`, logs only); **no code turns a par crossing into a draft PO. The human is the bridge.** |
| 5 | Order → AI draft | **WIRED (human-initiated)** — HTTP-guaranteed + RabbitMQ; drafts, never auto-sends | |
| 6 | Vendor contacted | **WIRED — email/SMS only** | Plivo is SMS-only; **the "voice" channel does not exist as a live path** (its client code exists but is inert — gated this session before activation) |
| 7 | Goods received | **WIRED** — fast door capture, estimated cost | |
| 8 | Three/four-way match | **WIRED** — estimated→landed, discrepancies → credit claims, dollars-at-risk queue | best-engineered code in the buy-side |
| 9 | Analytics learns | **WIRED** — Holt-Winters, reorder points, menu quadrants off `wine_consumption_log` | loop closes back to hop 3 |
| 10 | Recommendation → buying | **MANUAL** — surfaced as insights; **no automated menu-price or par write-back** | the act-on-learning end is open, mirroring hop 4 |

**Net:** sensing (1→3, 9) is autonomous and closed; acting (4, 6-voice, 10) is human-gated by design *and* by gap.

## 3. The four segments — verdict and the load-bearing gaps

Full evidence in `eco-research/01-04`.

**POS → data spine** (`01`) — *the hard half is built and runtime-proven on synthetic data, but has never carried one real restaurant's check, and the one provider it's configured for (Toast) bypasses the spine.* Gaps: zero merchant-backed providers; Toast never writes `pos_checks` and still carries the `?? "bottle"` 5× over-depletion on its own path; cross-tenant webhook forgeability (fix in flight); push-only, no `pos_connections` model, no pull path for 13 webhook-less providers, `csv_import` doesn't parse CSV; real-venue onboarding unbuilt (catalog pull is SimPOS-only).

**Restaurant ops loop** (`02`) — *both ends SOTA (lots-as-truth depletion; receiving→four-way-match→credit→landed-cost), the middle doesn't auto-close, and the automation that exists is wired to the wrong POS pipeline.* Gaps: deplete→reorder unwired; **two divergent POS pipelines** — live depletion is NestJS (`toast`/`pos-hub`) but the automated procurement fleet feeds off the parallel **dormant Python** `pos_integration_agent`, so `buffer_manager`→`procurement_agent` is dead wiring; Toast fail-closed for all 10 restaurants (`TOAST_WEBHOOK_SECRET` unset, OD-64); reconcile hinges on a manual `verifyReceipt`; `recurring_order_agent` auto-approve had no per-order gate **(closed this session by the A3 fix, PR #152)**.

**Sales / analytics intelligence** (`03`) — *healthy tested core, hollow edges — a strong deterministic engine wrapped in claims and menus that outrun what computes.* Gaps: catalog promises 573 insight types, UI says 375, engine delivers ~19 (16 `record()` calls); feedback loop half-wired (`recommendation_impressions` logged never read; `insight_acceptance_rate` computable never computed); Ask AI (the whole insight→action bridge, DB-enforced confirm) is built on `feat/p3c-ask-ai-web` but **not on main**; consultant grounding has a failed-fetch blind spot **(scheduled as analytics-bi C1)**; analytics reads `stock_live`+`wine_consumption_log` not the lots ledger (latent dual-bookkeeping) and consumes **zero guest data** — no seam to the customer segment.

**Customer / guest** (`04`) — *the demand-side flywheel input; almost entirely potential, not built, and held.* The NF store ships with the guest slot open but **zero emitters, zero rows**; the 564-line consent slice has **zero callers**; guest keys are HMAC-*derived* from one master (can't be crypto-shredded — needs *stored* per-guest keys, ADR 0037 addendum); `erasure_receipt_id` dangles; the only POS↔guest seam is `guest_check_links.pos_check_id`, unwired. Activation prereqs (all founder-gated): OD-05/OD-07, the erasure model, A15 dish-identity vs wine-only taste, the k=20 anonymity gate as code.

## 4. Cross-cutting faults no single segment owns

1. **The sense→act seam (hop 4).** The buy-side has no autonomous trigger; the core "autonomous operations" promise breaks exactly here. Owner: nobody today.
2. **The two-runtime split.** Live path is NestJS; the agent fleet is Python; they meet over RabbitMQ. Buy-side *send* is RabbitMQ-only into a Python orchestrator CI can't prove is alive — a silent orchestrator means approvals that never reach the vendor. This split also explains why the automation is wired to the dormant Python POS pipeline. It ties directly to **OD-03** (the harness choice, still open).
3. **Auth-by-omission.** `TenantGuard` fails open; ~94 endpoints reachable unauthenticated by omission (the number is measured 4 different ways — reconciling it to one script is scheduled in security's + engineering's agendas). A platform posture, not a module bug.
4. **Zero real-merchant data.** The entire analytics stack is downstream of a pipe proven only on a 47-row simulator window + 66 P3PROOF fixtures. L0 data is the named blocker (README §1).
5. **Doc-vs-reality skew.** `STATE.md`/`PROJECT.md` still read v3.0/v2.0; the live frontier is P1 NF-A instrumentation. The map must be trued up before it can steer.

## 5. What this session already moved

- **A2** (#151): `api_spend.task_type` + `cost_per_task_v` — the cost-per-task number the intelligence layer was missing.
- **A3** (#152): `recurring_order_agent` brought inside the harness, `_create_order` deleted, proposals-only — closes ops-gap #5, and the `ACTION-SCHEMA-SPEC.md` it ships is the typed spine the hop-4 bridge needs.
- **A4** (#153): `nf_a.skill_id` + the weekly runner cron.
- **Four integrity fixes** (this session): POS webhook per-tenant secrets (fix in flight), voice binding gate, Sentry PII scrub, gold-set fail-loud guard.
- **Wave 3** (#149): every department now has a real agenda; most segment gaps above are already scheduled in the owning unit's agenda — this plan is the *cross-segment* layer over those.

## 6. The phases (content fixed; order is §7's fork)

- **E0 — Foundational integrity.** Land the four fixes; finish the auth-by-omission classification to one reproducible census + a global-guard decision; true up STATE/PROJECT to the real frontier. *Rationale: nothing above is trustworthy while the door is open, the pipe is unaudited, and the map is stale.*
- **E1 — Close the buy-side loop.** Build the sense→act bridge (activate `AutoPilotAgent` behind the human gate, on the A3 action schema), unify the POS pipeline so automation feeds the **live** path not the dormant Python one, and make cross-runtime send reliable (an HTTP fallback or a durability guarantee for `conversation.approved`). *This is the flagship "autonomous operations" promise, and it is one seam wide.*
- **E2 — Make the intelligence honest and actionable.** Reconcile 573/375/19 to one truthful number the engine actually produces; wire the feedback loop (`recommendation_impressions` read, `insight_acceptance_rate` computed); give the cost/verdict views their readers; merge Ask AI as the insight→action bridge; close the grounding failed-fetch blind spot.
- **E3 — Turn on the demand side (staged, gated).** Only behind its founder forks: the erasure model (stored keys), consent enforcement as code, the k-threshold guard, OD-05/OD-07. Wire the guest→check seam and, if activated, guest-taste → recommendation. *NF-B stays HELD until the founder says otherwise.*
- **E4 — Real-merchant activation & the closed loop.** Onboard the first real venue (Toast onto the spine, catalog pull, "create inventory from POS item"), then close hop 10 (recommendation writes back to par/menu, human-gated), then begin the wine→beverages vertical expansion.

## 7. The forks — the founder's to decide (§0.1)

These are put to the founder before this becomes a locked ADR. They are in the companion question set; recorded here so the doc names them.

1. **Sequencing. ✅ Locked by the founder 2026-08-28: E1 leads after E0.** Close the buy-side autonomous-ops flagship on the sell-side data we already have — the sense→act bridge (hop 4) is one seam wide and the highest-visibility promise. E2/E4 run behind it; E3 stays gated. *(Considered and not chosen: E2-intelligence-first, E4-real-merchant-first — recorded so the order is not silently revisited.)*
2. **The two-runtime question (ties to OD-03). ✅ Locked by the founder 2026-08-28: decide it via the A1 bake-off (PR #150), not by a guess now.** "NestJS-native fleet vs keep-Python-and-harden-the-bridge" enters the bake-off as a scored axis; the plan sequences the runtime commitment as a *bake-off output*. Until it reports, E1 hardens the existing NestJS↔Python send seam (an HTTP fallback / outbox for `conversation.approved`) rather than migrating either way — that hardening is useful under both outcomes.
3. **Autonomy posture for the sense→act bridge.** Even behind the human gate, how far does the hop-4 bridge auto-propose — every par crossing becomes a draft PO awaiting one tap, or only rule-matched crossings (an `auto_pilot_rules` engine the founder configures)?
4. **The POS `pos_connections` fork (OD-A/OD-B, unfiled).** Per-connection webhook secret + per-vendor signature schemes: a new `pos_connections` table vs a column on `restaurants`. The env-scoped half is in flight; this half needs an ADR.
5. **Guest activation trigger (OD-05/OD-07).** Unchanged — when does the demand side turn on. Named for completeness; E3 is gated on it and nothing here moves it.

---

*Companion research: `eco-research/01-pos-spine.md`, `02-restaurant-ops.md`, `03-sales-analytics.md`, `04-customer-guest.md`, `05-end-to-end.md`. This plan becomes a numbered ADR once §7.1 is locked and the PR-chain ordering (0034–0039 in flight) is settled.*
