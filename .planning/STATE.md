# State — where the build actually is

> One page, one truth. Rewritten 2026-08-25 under [ADR 0018](decisions/0018-p2-plan-of-record.md);
> the 789-line history it replaces is archived verbatim at
> [archive/STATE-pre-P2-20260825.md](archive/STATE-pre-P2-20260825.md).
> If this file and any other doc disagree about what is current, fix the other doc.
>
> **2026-09-25 — web rebuild census.** Where the rebuild stands, route by route, what production serves, the 17-lane plan, the open founder forks and his 2026-09-22 answers that had lived only in memory: [07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md](07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md). It supersedes the retired `PAGE-WAVE-BLOCKERS-2026-09-22.md`.
>
> **2026-09-22 — get-started lock.** Founder approved all 17 Opus recs as A. [ADR 0213](decisions/0213-get-started-is-account-then-house-then-first-proof.md) (OD-134–139, OD-141). Build on `feat/arrival-first-proof`: account-only `/register`, four arrival screens, first proof at `/house/menu`. Do not merge #414/#454; do not flip `mudavym_design_arrival`; gate-owned #415/#430/#434 stay with their owner. **[CORRECTED 2026-09-25, [web-rebuild census](07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §1c.1: false on the day it landed. #415 (`cc73f9f66`, 23:53Z), #430 (`e2abd7844`, 00:43Z), #434 (`92ea9cecc`, 01:29Z), #454 (`162f25ade`, 01:42Z) and #414 (`8ec925aa7`, 01:59Z) had all merged before #455 (`ddc5e094b`, 02:33Z, 2026-09-22/23 UTC, `gh pr view <n> --json mergedAt`) carried this line. The intent held: `mudavym_design_arrival` is OFF for 14 of 14 houses (production read, 2026-09-25T21:11Z), so every house gets ADR 0213's flow, which `App.tsx:215-219` mounts in the `legacy` slot while #414's Arrival sits dormant in `next`. `feat/arrival-first-proof` is #455, merged.]**

> **2026-09-12 handoff:** the merge queue, the seven unlanded branches, and the page wave in flight are in [handoff/PROGRESS.md](handoff/PROGRESS.md). Read it before continuing any of them.

> **2026-09-17 — the finish goal.** The founder asked for every page on the Mudavym design,
> legacy deleted, merged and deployed. The decisions are [ADR 0149](decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md)
> (38 answers; the cutover; the deletion manifest is a gated stop on his approval) and
> [ADR 0160](decisions/0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes.md)
> (his sketch review, page by page). Live on main since: #384 the decisions, #386 the new
> audit pipeline ([ADR 0090 amendment](decisions/0090-pr-audit-gate-autonomous-merge.md): Opus
> plans, two Sonnet reviewers run the plan, Opus decides), #387 the overlay foundation and the
> vendor-intel deciding house, and the SEO session's #385/#388 ([ADR 0158](decisions/0158-machines-read-mudavym-from-what-the-host-serves.md)).
> Production was verified on `commit 3a752010` and on a string only #387 added. Sixteen locked
> pages go live for every house in code in `feat/finish-live`; nothing in the database is
> touched and no legacy file is deleted until the manifest is approved. The lane-by-lane state,
> the worktree map and what the founder still owes are in
> [handoff/PROGRESS.md §0c](handoff/PROGRESS.md).

**Current milestone: P3 — Grade, then scale** ([ADR 0029](decisions/0029-p3-plan-of-record.md)).
**P2 closed 2026-08-26** — all five stages deployed and verified, both held items resolved.
**Read order:** [PROJECT.md](PROJECT.md) → [decisions/README.md](decisions/README.md) → this file → [ROADMAP.md](ROADMAP.md).

## Finish goal — 2026-09-16/17 (ADR 0149) — supersedes P3 in practice

The founder set one session goal 2026-09-16: finish every page to the Mudavym
design, then one cutover deletes the legacy frontend for every house at once —
gated on his approval of a deletion manifest, file group by file group. Full
context, the nine rounds of forks and his answers:
[ADR 0149](decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md).
Lanes run as parallel git worktrees (`wt-fin-*`), each owning a slice, none
touching another's files or committing on its own. Detail and lane map:
[handoff/PROGRESS.md](handoff/PROGRESS.md) §0c.

**Live since 2026-09-22 (#421 `34c33a76a` merged 2026-09-21; first served by production from
`9cfc4e96d` at 2026-09-22T03:41:32Z UTC; proof in LIVE-CHECKLIST "Deploy proof, 2026-09-22"):** 16 of the 20
`MUDAVYM_PAGES` keys resolve to the Mudavym design for every house in code, no
`restaurant_feature_flags` row needed — dashboard, orders, receiving_door,
providers, communications, team, inventory, receipts, documents_reports,
document, reports, calendar, profile, connections, notifications, logs
(`apps/web/src/lib/mudavym/useMudavymDesign.ts`, `LIVE_PAGES`). Held back,
still flag-gated pending a sketch review: settings, cellar (all 8 routes),
recommendations, receiving (the desk, not the door). No database write; legacy
code untouched. Full per-route status: [06-pages/LIVE-CHECKLIST.md](06-pages/LIVE-CHECKLIST.md).
**[CORRECTED 2026-09-25, [web-rebuild census](07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §1a: **20** of `MUDAVYM_PAGES`' 26 keys now resolve in code (`useMudavymDesign.ts:125-146`): `settings` joined via #419 (`24b7d5288`), `help` via #413 (`490e9962d`), `cellar` and `menu` via #434 (`92ea9cecc`). Production serves them: mudavym.com's `assets/index-DgyBtnzD.js` carries the 20-key `LIVE_PAGES` literal (curl, 2026-09-25). Still gated: `receiving` (ON for 1 of 14 houses), `recommendations`, `arrival` and `authorize_integration` (OFF for 14 of 14), and `shell` and `admin`, which are ON for 14 of 14 houses in `restaurant_feature_flags` (read-only production query, 2026-09-25T21:11Z) but default OFF in code (`feature-flag-registry.ts:103,130`). A house created after that read gets the legacy shell and admin until both move into `LIVE_PAGES` (lane L4, branch `feat/live-shell-admin-authorize`). Who set those 28 values to ON, and when, is recorded nowhere: the table has `created_at` and no updated-at column. All nine public pages are live Mudavym doors since #426 (`410534a21`; `publicDesign.ts:16,24`). Three surfaces inside live pages are not rebuilt: `/receipts?tab=credits` renders the legacy `ReceiptsPage`, provider sentiment renders through the legacy `ProviderIntelligencePanel` inside `/providers`' sheet, and distributor discovery is reachable by no house (census §0, G8).]**
**[2026-09-25, 22:57Z: #463 (`f7630c08b`) put `shell`, `admin` and `authorize_integration` in `LIVE_PAGES` — **23** keys, live in code for every house including new ones; mudavym.com's `assets/index-2txKbWJ0.js` carries the 23-key literal (fetched 22:59Z). Still gated: `receiving`, `recommendations`, `arrival`. Census R17 is closed.]**
**[2026-09-26T03:10Z: merge train 1 has also merged #416 (`e754b3a27`), #412 (`4e7c5b5a6`) and #446 (`e4f81d748`) — provider intelligence, provider sub-resources and menu-line edits answer only for the caller's house. All three are gateway-only, so `LIVE_PAGES` is still 23 keys and the web bundle is unchanged; the production gateway serves `e4f81d748` (`/api/v1/health/live`). #451 (`932bd83af`, a schema-drift test reader, 03:16Z) merged too. Still OPEN in train 1: #450 #425 #394 #467, and #423 #395 #465 in fix rounds. The `Deploy to Production` workflow failed on every train-1 merge commit; Railway and Vercel deployed anyway. The founder's round 4 and 5 answers (items 14-36) and where each lands: [web-rebuild census](07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §13; the forks still open are OD-125 and OD-153 to OD-160.]**

**What P3 below still describes:** the P3.0 doneability-coverage work
(2026-08-27) is real and shipped; P3.A–P3.D are unstarted or blocked as
written. Nothing in ADR 0149 changes that — it runs alongside, on the frontend
page layer, not the backend task-grading gate.

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
- **Studio + SSRF/log-injection hardening (2026-08-26, PRs #73/#75/#78/#79/#84):**
  the studio invite flow works end to end for the first time — redemption no longer
  requires a studio role the invitee cannot hold, is bound to the invited email, is
  single-use under concurrency, and is *sent by the gateway* rather than handed back as a
  link ([ADR 0021](decisions/0021-studio-invites-are-self-service.md)). Two routing
  approaches collided mid-flight; the founder chose the gateway proxy, so `studioApi.ts`
  resolves relative paths and the gateway forwards `/api/v1/studio/*` and
  `/api/v1/onboarding/extract`. Security, measured by CodeQL on `main`:
  **`js/request-forgery` 3 → 0** (the worst carried `X-Admin-Key` out of the health
  prefix and had been open since 2026-07-08) and **`py/log-injection` 57 → 3**, the three
  survivors being verified false positives awaiting dismissal (OD-90, OD-93). New guards:
  `common/http/safe-path.ts` (one allowlist for every outbound URL interpolation) and
  `scripts/check_log_sanitizer_usage.py` (an `ast` pass that fails when a sanitised string
  reaches a numeric format spec, and exits 2 rather than 0 if it scans nothing).
  **Method note worth keeping:** the alert counts were twice under-reported from an
  unpaginated first page — once hiding a live hole in new code. Paginate, then count.
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
2. 🔴 **Gmail push verification now FAILS CLOSED** (ADR 0094, 2026-09-02) — it
   was staged *open* until then, admitting every push while unconfigured
   despite four places in the repo claiming it failed closed. **Set
   `GMAIL_PUBSUB_AUDIENCE` + `GMAIL_PUBSUB_SERVICE_ACCOUNT` on Railway**
   (values come from the Pub/Sub push subscription — nobody can invent them).
   Until both are set every push is refused and inbound vendor email does not
   arrive; the gateway logs a refusal per push and counts them
   (`GmailPushAuthService.refusedWhileUnconfigured`). `GMAIL_PUBSUB_REQUIRE_AUTH`
   is deleted — it no longer exists and setting it does nothing.
   **Most likely a no-op in production:** OD-78 records an unsigned push probed
   twice on 2026-08-26 returning **401**, which under the old code means either
   the pair was set (verification already live) or the retired flag was already
   refusing everything. Either way this change does not break a working inbox.
   A non-zero `refusedWhileUnconfigured` is how to tell, without Railway access.

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
pre-fix failure proofs. **PR #280 merged 2026-09-03; the live day ran three times the same night** and the
clean run (`937a23f0`) verifies **17 pass · 0 fail · 3 unverifiable** — after fixing six
more defects the harness surfaced (the POS consumption mirror had written zero rows since
2026-08-24; the sim seed could not insert its wines; personas could not sign in or reach
their tenant; two harness faults). Details in ADR 0093, "The live day, on the record".

**Canonical document, slice 2 (ADR 0104 D12/D13, 2026-09-04, branch `feat/canonical-document-slice-2`):** the canonical document is on screen at `/documents/:id` behind `mudavym_design_document` (OFF) — B's verdict block, C's delivery spine, A's sheet — served by `GET /procurement/documents/:id/canonical`; three synthetic PDFs went through the real intake door on the sim tenant and NONE was extracted (the model account has no credit), so every screenshot is of the degraded state and the four-way table has still never rendered real lines.

**Canonical document, slice 1 (ADR 0104 D12, 2026-09-03, branch
- **2026-09-03 — lens phase closed by the founder ("stop here, document it").** POS → inventory → alerts lens and customer + intelligence lens run on a real venue's menu (Sim Meyhouse) and filed (#292, #293; founder page linked from `06-pages/simpos-terminal.md` §10); ADRs 0103/0104/0105 recorded and locked where the founder answered (#288, #294); the Square day measured 0/42 vs 42/42 (0105); canonical document slice 1 merged and verified in production (#295, gaps filed in #296). **Next session starts from:** close the two data-shape gaps (`coerceDocType`, BT-149 + per-field confidence), then ADR 0104 slice 2 (C-led template + door view); the Antalya venue after that; the YMM clock question (0103 A8) still open.
`feat/canonical-document-slice-1`):** the delivery is now a table — `deliveries`,
`document_deliveries`, `delivery_proposals`, `vendor_terms`, `document_revisions`
(append-only by trigger) and `document_corrections` — and
`apps/api-gateway/src/procurement/canonical/` holds the three-layer object with 16
EN 16931 invariants. No route, no UI. **The corpus it was meant to run over does not
exist:** `procurement_documents` 0 rows, `procurement_document_lines` 0 rows,
`vendor-attachments` 0 objects, measured read-only. That is recorded as an ABSENCE —
`datasets/canonical/CORPUS-RUN-2026-09-03.md` says "0 documents read", never "0
failures" — and the invariants' only evidence today is 9 labelled synthetic fixtures.
The Turkish e-İrsaliye response-window clock is deliberately unseeded pending a YMM
(ADR 0103 A8), and a `vendor_terms` row that is missing must BLOCK, never read as
"no deadline".

**Page layer:** 48 route notes in `06-pages/`, each carrying Surface + §1a
Features + the §10–13 dossier + `archetype:` — both the graph and the
founder-readable layer are CI-claimed (ADR-0018 claims in `CLAIMS.jsonl`).

## Standing constraints

- Solo founder + Claude; low session output footprint (CLAUDE.md §2).
- Version numbers stay as-is until publish (ADR 0005); brand migrates
  WineOps → Mudavym gradually (~71 user-visible strings pending).
- Real data, never mock-only; docs bulletproof before features (ADR 0018).

---
*Last updated: 2026-09-22 — the ADR 0149 finish-goal section's sixteen pages are live in
production (first served from `9cfc4e96d`, 2026-09-22T03:41:32Z UTC); added 2026-09-17. The 2026-08-27 P3.0 entry
below is unchanged and still current: every task type graded or knowingly
exempt, guarded in CI.*