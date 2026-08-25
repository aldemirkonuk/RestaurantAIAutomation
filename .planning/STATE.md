# State — where the build actually is

> One page, one truth. Rewritten 2026-08-25 under [ADR 0018](decisions/0018-p2-plan-of-record.md);
> the 789-line history it replaces is archived verbatim at
> [archive/STATE-pre-P2-20260825.md](archive/STATE-pre-P2-20260825.md).
> If this file and any other doc disagree about what is current, fix the other doc.

**Current milestone: P2 — Web complete + deploy.**
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

## P2 position

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

1. **Page retirements** (ADR 0019 §B): `/calendar-classic`, `/inventory-legacy`,
   `/wine-agent`, `/wineagent-alias`. Deletion is irreversible and each was
   made conditional on a parity check, so it waits for an explicit yes.
   `/inventory-legacy` also still hosts `InvoiceScannerModal`, which posts to
   an endpoint that does not exist (44.1e) — retiring the page closes that too.
2. **Gmail push verification** is built but staged open. Set
   `GMAIL_PUBSUB_AUDIENCE` + `GMAIL_PUBSUB_SERVICE_ACCOUNT` on Railway (values
   come from the Pub/Sub subscription — nobody can invent them), then
   `GMAIL_PUBSUB_REQUIRE_AUTH=true`. Until then the gateway logs an error per
   unverified push and counts them.

**Next action:** P3 selection (ROADMAP candidates), or the two held items above.

## Standing constraints

- Solo founder + Claude; low session output footprint (CLAUDE.md §2).
- Version numbers stay as-is until publish (ADR 0005); brand migrates
  WineOps → Mudavym gradually (~71 user-visible strings pending).
- Real data, never mock-only; docs bulletproof before features (ADR 0018).

---
*Last updated: 2026-08-25 — P2 complete through deploy; two items held for the founder.*
