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
| 1. Spine reset (PROJECT / STATE / ROADMAP) | this PR |
| 2. Page graph — Surface pass over all 51 notes | this PR |
| 3. Gap proposal → **founder approves feature set** | next — blocks stage 4 |
| 4. Build burn-down of the approved list | not started |
| 5. Web deploy complete (then mobile) | not started |

**Next action:** stage 3 — compile the proposal (missing pages, dead ends,
endpoint gaps, `v3.0-TECH-DEBT.md` carry-overs) and put it to the founder.

## Standing constraints

- Solo founder + Claude; low session output footprint (CLAUDE.md §2).
- Version numbers stay as-is until publish (ADR 0005); brand migrates
  WineOps → Mudavym gradually (~71 user-visible strings pending).
- Real data, never mock-only; docs bulletproof before features (ADR 0018).

---
*Last updated: 2026-08-25 — P2 spine reset (ADR 0018).*
