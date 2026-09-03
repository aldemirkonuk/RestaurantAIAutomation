# State — where the build actually is

> One page, one truth. Rewritten 2026-08-25 under [ADR 0018](decisions/0018-p2-plan-of-record.md);
> the 789-line history it replaces is archived verbatim at
> [archive/STATE-pre-P2-20260825.md](archive/STATE-pre-P2-20260825.md).
> If this file and any other doc disagree about what is current, fix the other doc.

**Current milestone: P3 — Grade, then scale** ([ADR 0029](decisions/0029-p3-plan-of-record.md)).
**P2 closed 2026-08-26** — all five stages deployed and verified, both held items resolved.
**Read order:** [PROJECT.md](PROJECT.md) → [decisions/README.md](decisions/README.md) → this file → [ROADMAP.md](ROADMAP.md).

## What is live in production (2026-08-25)

- **Deployed stack:** NestJS gateway + Python agent-orchestrator on Railway,
  web SPA on Vercel, Supabase Postgres (`exzueerziesmczwlhomd`), RabbitMQ on
  CloudAMQP, Redis on Upstash. Check `railway status` after every merge to
  main — CI cannot see Nest DI failures.
- **P1 — Neural Footprint instrumentation (closed 2026-08-24/25):** every
  model call in both runtimes writes a `neural_footprint_event` row through a
  single choke point per runtime (`common/model-client/` in the gateway,
  `SpendLogger` in Python). Readout views + `scripts/nf_readout.py` print
  `nf_a.cost_per_completed_task`. Doneability verdicts landed as the sidecar
  `nf_verdict` table (ADR 0017): `document_extraction` invoices grade
  themselves on `reconciliation_v1`; coverage is honestly ~0% everywhere else.
- **Decision register + guards:** ADRs 0001–0018; `OPEN-DECISIONS.md` with
  executable claims in `CLAIMS.jsonl` enforced by CI
  (`check_decision_claims.sh`), plus guards for gateway boot, model-call
  logging, schema parity, migration/OD id collisions. Lesson that drove it:
  entries with a CI job survived; prose decayed.
- **Security closed this week:** 13 controllers guarded (OD-20 cluster),
  SSRF guard on user-supplied URLs, JWT secret hard-fails, scan-parser page
  cap. Verified live: unauthenticated `dashboard/stats` now 401.
- **POS bridge:** built and proven POS-agnostic (Toast first adapter);
  sale-volume contract + referential integrity migrations applied.
- **Page layer:** 51 routes documented in `06-pages/` (9-section contract),
  each with a Surface section (buttons → destination wikilinks) forming the
  Obsidian page graph.

## P2 position — closed 2026-08-26

| Stage | Status |
|---|---|
| 1. Spine reset (PROJECT / STATE / ROADMAP) | ✅ #65 |
| 2. Page graph — Surface pass over all 51 notes | ✅ #65 — 115 page→page edges |
| 3. Gap proposal → founder approves feature set | ✅ [ADR 0019](decisions/0019-p2-build-scope.md), locked with two carve-outs |
| 4. Build burn-down of the approved list | ✅ #67 |
| 5. Web deploy + live verification | ✅ verified on production 2026-08-25 |

**Deploy verification (2026-08-25, against production, not staging):**

| Check | Result |
|---|---|
| `communications/test/*` + `test/e2e/step*` | reachable → **401** (nine routes, one of them an open email relay) |
| `toast/menus`, `toast/sales` | **200 → 401**; unsigned Toast webhook now rejected |
| Gmail push webhook | still 200 — staged rollout, deliberately not yet closed |
| `auth/login`, pos-hub webhook | unchanged (negative controls: the fixes broke nothing) |
| Web bundle | contains `/documents-reports`; **zero** `/documents` or `/emails` dead literals |
| Web assets | all 200, no page errors |

**Held, needing the founder — the only P2 items not done:**

1. ~~**Page retirements** (ADR 0019 §B)~~ — **resolved 2026-08-26.**
   `/wine-agent` and `/wineagent` are **retired** (routes, inline
   `PlaceholderPage`, sidebar item and both page notes deleted; mobile deep-links
   repointed at `/sommelier`). The parity check the founder attached found working
   capabilities that existed only on the two legacy pages, so neither was deleted
   on that pass. `/inventory-legacy` was then **retired 2026-08-26**: Auto-Locate,
   `MultiLocationCell`'s source-selected transfer, by-the-glass pour, the
   active/inactive toggle and the realtime inventory subscription were ported onto
   `/inventory` first, then the route, `pages/Inventory.tsx` and the orphaned
   `ManualOverrideModal.tsx` were deleted. `/calendar-classic` was **retired
   2026-08-26** the same way: its one blocker — the only reminders in the product
   that actually fire — was ported onto `/calendar` first (`syncEventReminders`
   feeds the same localStorage queue `startReminderScheduler` drains, because the
   calendar API has no reminder endpoint and nothing server-side reads
   `reminder_enabled`), then the route, `pages/Calendar.tsx` and the orphaned
   `NewEventTypeModal.tsx` / `EntityAutocomplete.tsx` were deleted.
   Details: [ADR 0019](decisions/0019-p2-build-scope.md) §B-parity.
   The old note that `/inventory-legacy` hosted `InvoiceScannerModal` was **stale**
   — that component was deleted in `e5402d67` and 44.1e is already closed.
2. **Gmail push verification** is built but staged open. Set
   `GMAIL_PUBSUB_AUDIENCE` + `GMAIL_PUBSUB_SERVICE_ACCOUNT` on Railway (values
   come from the Pub/Sub subscription — nobody can invent them), then
   `GMAIL_PUBSUB_REQUIRE_AUTH=true`. Until then the gateway logs an error per
   unverified push and counts them.

## P3 position

| Stage | Gate | Status |
|---|---|---|
| **P3.0 Doneability coverage** | *is* the gate | ✅ **shipped 2026-08-27** — 7/7 gateway task types graded, Python restamped, CI guard blocks a regression. One migration awaiting production (below) |
| **P3.A Mobile parity** | none — runs alongside | not started |
| **P3.B Backend-kitchen expansion** (beverages first) | none — runs alongside | not started |
| **P3.C Ask AI** | behind P3.0 | blocked by design |
| **P3.D Job → model registry** (OD-04) | behind P3.0 + traffic | blocked by design |
| **NF-B guests** | — | **held** — blocked on OD-05/OD-07, not on work |

**The one number this milestone existed to fix — closed 2026-08-27.** It was:
the gateway emits **7** task types and **1** carries a real verdict. It is now
**7 of 7**, and across both runtimes **26 of 38** task types carry a basis better
than `call_level_v0`, with the remaining **12** named in a shrink-only exemption
list that states why each cannot be graded (genuine human rubric, or a deferred
join that does not exist yet). `scripts/check_task_types_are_graded.py` blocks a
regression in CI, and fails on a *redundant* exemption too — claiming something
cannot be graded when it can is the same rot pointing the other way.

**Not done until applied:** `20260827100000_photo_count_suggestions.sql` is
committed and **not yet applied to production**. `schema-parity.yml`'s production
arm is red until it is, and that is the guard working as designed — an unapplied
migration is the phantom-table class this repo found five times in one day.

**Next action:** apply the photo-count migration, then **P3.C (Ask AI)** and
**P3.D (model registry)** are unblocked — the gate they sat behind is closed.
P3.A (mobile) and P3.B (beverages) were never gated and remain startable.

**Ecosystem scenario harness (ADR 0093, 2026-09-02, branch `feat/ecosystem-scenario-sim`):**
the product learns its operating hours (`restaurants.operating_hours` + Settings editor),
`scripts/simulate scenario` replays a random restaurant day inside them, and
`/simpos/:id/scenarios` verifies the run against its own expectation across twenty checks
(pass / fail / unverifiable). Found by reading before any run: sim tenants were phantom
stock (seed wrote `stock_live`, no lots), a POS void reused the sale's idempotency key and
never returned stock, and the low-stock email outcome was unrecorded — all three fixed with
pre-fix failure proofs. **The first live day is pending the two migrations reaching
production on merge**; until it is on the record, no harness "pass" is a measured one.

**Page layer:** 48 route notes in `06-pages/`, each carrying Surface + §1a
Features + the §10–13 dossier + `archetype:` — both the graph and the
founder-readable layer are CI-claimed (ADR-0018 claims in `CLAIMS.jsonl`).

## Standing constraints

- Solo founder + Claude; low session output footprint (CLAUDE.md §2).
- Version numbers stay as-is until publish (ADR 0005); brand migrates
  WineOps → Mudavym gradually (~71 user-visible strings pending).
- Real data, never mock-only; docs bulletproof before features (ADR 0018).

---
*Last updated: 2026-08-27 — P3.0 shipped: every task type graded or knowingly exempt, guarded in CI.*