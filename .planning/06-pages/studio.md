---
type: page
route: /studio
slug: studio
softwares: [wine-studio]
component: apps/web/src/pages/studio/Studio.tsx
audience: dev
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 1
maturity: broken
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[studio-queue]]", "[[studio-certify]]", "[[wines]]"]
---

# /studio — data ingestion workbench

> **Part of** [[08-softwares/wine-studio|Wine Studio]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Queue** (studio header, review_admin/developer only) → [[studio-queue]] `/studio/queue`
- **Certify** (studio header, review_admin/developer only) → [[studio-certify]] `/studio/certify`
- **Ingest** (URL / manual) → API `POST /api/v1/studio/sessions`; PDF/photo extraction via `POST /api/v1/onboarding/extract`
- **Promote** → API `POST /api/v1/studio/promote`
- **Override a field** → API `POST /api/v1/studio/overrides`

## 1. Purpose
Internal contributor tool: ingest a wine list (PDF/photo → Claude Vision, URL → Gemini
Flash crawler, or empty manual record), review the extracted records field-by-field with
per-field confidence, override values, and promote records into the master library.
Audience is developer / certified_contributor / review_admin — not restaurant users.

## 1a. Features *(internal contributor tool)*
- Ingest a wine list three ways: PDF/photo (Claude Vision), URL (Gemini crawler), or an empty manual record
- Review extracted records field-by-field with per-field confidence badges (14 columns incl. grape, color, sweetness, tasting notes)
- Override a value; high-confidence fields require a reason
- Promote records into the master library (409 = duplicate)
- Session metrics dashboard
- 🚧 Routing gap: as configured, all calls should 404 against the gateway (§9)

## 2. Entry
**No inbound in-app link** (`PAGE_MAP.md` entry-point list) — cold URL, gated by
`ProtectedRoute requiredStudioRole={['developer','certified_contributor','review_admin']}`
(`App.tsx:167-175`). Roles come from the JWT's `app_metadata.roles`
(`contexts/AuthContext.tsx:225-238`). Internal nav between the three studio pages via
`StudioLayout` header links (`StudioLayout.tsx:36-68`).

## 3. Files
- Route: `apps/web/src/App.tsx:167-175` → `pages/studio/Studio.tsx` (34 lines, composition)
- Shell: `pages/studio/StudioLayout.tsx` (own chrome, outside DashboardLayout)
- `pages/studio/CommandBar.tsx` (ingestion bar, 248), `SessionSummary.tsx` (29),
  `metrics/MetricsDashboard.tsx` + `MetricCard.tsx`, `WineRecordsTable.tsx` (200),
  `FieldCell.tsx` (209), `ReasonInput.tsx` (40)
- Store: `stores/useStudioSessionStore.ts`

## 4. Endpoints
All relative-URL `fetch` with Bearer token from localStorage:
- `POST /api/v1/studio/sessions` (`CommandBar.tsx:60,111,120`)
- `POST /api/v1/onboarding/extract` — pdf_base64 or images (`CommandBar.tsx:70-73`)
- `POST /api/v1/studio/overrides` (`FieldCell.tsx:89-104`)
- `POST /api/v1/studio/promote` — 409 = duplicate (`WineRecordsTable.tsx:41-52`)
- `GET /api/v1/studio/metrics` — 60s poll (`metrics/MetricsDashboard.tsx:25`)
Server side these live in the **orchestrator**, prefix `/api/v1/studio`
(`services/agent-orchestrator/api/studio_routes.py:52,66,160,578,832`), not the gateway
— they are absent from ENDPOINTS.md's 44 gateway modules. See §9 routing gap.

## 5. Signals
none. (Extraction results are cached to localStorage `wineops_last_extraction`,
`CommandBar.tsx:103-107` — a local convenience, not telemetry.)

## 6. Tier cut
Outside the subscriber tier axis — internal tooling. It *supplies* S06 (wine catalogue
extraction, the ✅ half) and S17 (duplicate queue / promote-409) rather than being sold
in any tier.

## 7. Rebrand surface
1 — "WineOps Studio" in the shared header (`pages/studio/StudioLayout.tsx:33`), visible
on all three studio pages.

## 8. State & config
- Studio role gate (§2); localStorage `accessToken` read directly for auth headers
- localStorage `wineops_last_extraction` (§5); session state in `useStudioSessionStore`
- D-07: an override on a field with confidence ≥ 0.8 requires a reason
  (`FieldCell.tsx:58-59`)

## 9. Gaps
- ~~**Routing gap (candidate defect, not in `v3.0-TECH-DEBT.md`)**~~ — **confirmed and
  closed 2026-08-26** ([ADR 0021](../decisions/0021-studio-invites-are-self-service.md)).
  The diagnosis was right: the components assume the Vite `/api` proxy targets
  FastAPI:8000 (`CommandBar.tsx:29-30`, `MetricsDashboard.tsx:23`, `FieldCell.tsx:68`),
  but `apps/web/vite.config.ts:24-28` proxies `/api` → `http://localhost:4000` (NestJS)
  and production rewrites `/api/*` to the Railway **gateway** (`vercel.json:8-10`).
  `StudioProxyController` now forwards `/api/v1/studio/*` to the orchestrator with the
  caller's own Bearer token, so the four `studio/*` calls in §4 resolve. **The ingestion
  path resolves too:** `OnboardingProxyController` serves `POST /onboarding/extract`
  (`common/orchestrator/onboarding-proxy.controller.ts:34,40`), is registered at
  `orchestrator.module.ts:36`, and sits under the `api/v1` global prefix (`main.ts:77`) —
  so `/api/v1/onboarding/extract` is a real gateway route, forwarded with a 5-minute
  timeout for base64 PDFs (`orchestrator.service.ts:127-151`) to the orchestrator's own
  `@router.post("/extract")` (`services/agent-orchestrator/api/onboarding_routes.py`,
  mounted at `main.py:142`) — cited by symbol, not by line: that decorator was at `:222`
  when this was written and moved to `:226` when the log-injection sweep (#79) landed a
  few hours later, which is the exact failure mode this entry is about.
  Note the operational coupling — the gateway signs with `JWT_SECRET` and the orchestrator
  verifies with `SUPABASE_JWT_SECRET`, so those must hold the same value or every studio
  call 401s.
  - **Correction (2026-08-26).** This paragraph read *"still open (OD-83): `POST
    /api/v1/onboarding/extract` has no route anywhere in the gateway"*. That was false the
    day it was written: the same PR (#73, `cc10c228`) that added `StudioProxyController`
    added the extract route in the same commit. The id was stale too — that OD-83 was a
    pre-rebase filing renumbered to [OD-88](../decisions/OPEN-DECISIONS.md), whose row
    already records this part as gone; the OD-83 now in the register is an unrelated,
    resolved entry (`/receiving` nav, calendar subscription, reminder toggle). No new OD
    was opened, because there is no defect left to file. The route is now claim-checked
    under `ADR-0021` in [`CLAIMS.jsonl`](../decisions/CLAIMS.jsonl) so it cannot rot back.
- Manual-seed sessions silently degrade to a local `local-<ts>` id when the API fails
  (`CommandBar.tsx:122`) — records then exist only in browser memory.
- This is the **richest enrichment surface among the wine pages**: 14 record columns
  including grape_variety, color, sweetness, tasting_notes, description
  (`WineRecordsTable.tsx:10-23`) with per-field confidence badges (`FieldCell.tsx:24-33`)
  — none of which `/wines` surfaces (see [[wines]] §9).

---

## 10. Maturity — **broken**

**Ingestion reaches a real backend; nothing you do to the result does.** The routing
gap in §9 was fixed for exactly one component and left in place for the other four.

- **Fixed:** `CommandBar` now bases its calls on the orchestrator, not the gateway —
  `const base = import.meta.env?.VITE_AGENT_ORCHESTRATOR_URL || ''` (`CommandBar.tsx:42`,
  used by the shared `studioFetch` at `:36-49`). So `POST /api/v1/studio/sessions`
  (`:66,117,126`) and `POST /api/v1/onboarding/extract` (`:76`) land on FastAPI **when
  that env var is set**; unset, `base` is `''` and both fall back to the same broken
  relative path.
- **Not fixed:** every other studio call is still a bare relative fetch —
  promote `WineRecordsTable.tsx:41`, override `FieldCell.tsx:89`, metrics
  `MetricsDashboard.tsx:25`. Relative `/api/v1/...` goes to the NestJS gateway in both
  environments (`apps/web/vite.config.ts:24-27` → `localhost:4000`;
  `vercel.json:7-10` → the Railway gateway). The gateway mounts everything under
  `api/v1` (`apps/api-gateway/src/main.ts:77`) and has **no studio controller** — grep
  `@Controller("studio"` across `apps/api-gateway/src`: zero hits. Those three 404.
- Net effect: **you can extract a wine list and you cannot promote it or correct a
  field.** The two actions the page exists for are the two that fail.
- The URL branch is **hollow on top of that**: it toasts "URL crawler started — records
  will appear as they are extracted" (`CommandBar.tsx:122`), but `create_session`
  only inserts a row into `onboarding_sessions` (`studio_routes.py:66-99`) — it starts
  no crawl, and nothing on the page ever polls for records. Worse, the crawler has no
  HTTP entry point at all: `scan_routes.py`'s main router (`/api/v1/scan`,
  `scan_routes.py:79`) is **never mounted** — `main.py:46` imports only
  `router_preview` from that module, and `main.py:130-165` lists every router that is.
- The metrics strip reports **fabricated zeros**: on a failed fetch `data` is undefined
  and each card renders `?? 0` (`MetricsDashboard.tsx:41,47,53,59`) with no error
  branch — "Total Overrides 0 / Pending Queue 0" is what a dead endpoint looks like.
- `MetricsDashboard.tsx:24` still carries the belief that caused all of this:
  *"Use relative URL — Vite proxy routes /api → FastAPI (port 8000)"*. It does not
  (`vite.config.ts:24-27`).

## 11. Data flow

**Calls out**

| Method | Path | Auth | Server | Returns / today |
|---|---|---|---|---|
| POST | `{VITE_AGENT_ORCHESTRATOR_URL}/api/v1/studio/sessions` | Bearer from `localStorage` (`CommandBar.tsx:37`); server verifies the Supabase JWT + studio role (`services/override_service.py:34-79`) | `api/studio_routes.py:66` | `{session}` row in `onboarding_sessions`. **Works** when the env var is set |
| POST | `{VITE_AGENT_ORCHESTRATOR_URL}/api/v1/onboarding/extract` | **none — the route has no `Depends`** (`api/onboarding_routes.py:148-149`) | `api/onboarding_routes.py:32,148` | `{scan_session_id, total_wines, total_cost_usd, wines[], page_errors}`; HTTP 207 on partial (`:370-372`), 402 over cap (`:173-182`) |
| POST | `/api/v1/studio/overrides` (relative) | Bearer | `studio_routes.py:161` — real, role-aware, D-07 reason gate at `:203-209` | **404s at the gateway** |
| POST | `/api/v1/studio/promote` (relative) | Bearer | `studio_routes.py:833`, 409 + `X-Existing-Wine-Id` on dedup (`:923-928`) | **404s at the gateway** |
| GET | `/api/v1/studio/metrics` (relative, 60 s poll) | Bearer | `studio_routes.py:579` | **404s at the gateway** → four zeros |

**Fed by — the extraction stack, as it actually runs**

| Stage | Where | Reaches this page? |
|---|---|---|
| **Claude Vision** — `claude-haiku-4-5-20251001`, parallel pages, native-PDF or image branch | `services/claude_vision_extractor.py:42,448,544,596`; called at `onboarding_routes.py:185-202` | **Yes** — this is the only producer the UI shows |
| **Per-field confidence + 3-tier routing** (accept ≥ 0.8, review 0.5–0.8, reject < 0.5; auto-block when > 50 % of fields are rejected) | `services/field_confidence.py:76-81,153,230`; applied `onboarding_routes.py:231-242` | **Yes** — drives the badges (`FieldCell.tsx:24-33`) and the amber row tint (`WineRecordsTable.tsx:123-133`) |
| **Mid-confidence review rows** → `field_review_queue` | `onboarding_routes.py:278-304` | **No** — written, never rendered anywhere in the studio UI |
| **Haiku enrichment** (`claude-haiku-4-5-20251001`) for wines missing region/country/grape | queued `onboarding_routes.py:306-323` → `jobs/haiku_tasks.py:37`; service `services/haiku_enrichment_service.py:47,57` | **No** — async, and the page holds its records in a Zustand store with no refetch |
| **Web verification** → **ontology validation** (region↔country, grape↔appellation, vintage plausibility, colour↔grape, with autofills) | `jobs/haiku_tasks.py:128-143` → `jobs/web_verify_tasks.py:416-418` → `jobs/ontology_tasks.py:41` → `services/ontology_validation_service.py:86,527` | **No** |
| **Critic scores** (Vivino ×20, Jancis ×5, WA/WS/Decanter passthrough, weighted composite) + markup | `jobs/ontology_tasks.py:124-126` → `jobs/score_tasks.py:66` → `services/critic_score_service.py:65,81,268` | **No** |
| **Daily threshold calibration** from human review accuracy | `jobs/celery_app.py:112-117` | **No** |
| **Gemini Flash crawler** (`gemini-2.5-flash`) | `services/web_crawler.py:285-290,546` via `services/vlm_extraction_service.get_gemini_crawler_extractor`; entry points are `jobs/tasks.py:462` and `jobs/recrawl_tasks.py` only | **No** — and unreachable from this page (§10) despite the UI captioning it (`CommandBar.tsx:230`) |

**Writes**

- `onboarding_sessions` (one row per ingest, `studio_routes.py:80-93`).
- `master_wine_library_submissions` — one row per extracted wine, `status:'pending_review'`,
  `auto_blocked`, `field_confidence` JSONB (`onboarding_routes.py:256-271`); the insert
  response's UUID is stamped back onto the record as `submission_id` (`:275-276`) and is
  what promote/override key off.
- `field_review_queue` (`onboarding_routes.py:281-295`); `api_spend` via the cost preflight
  (`:57-78`).
- Downstream: the Celery chain above (haiku → web-verify → ontology → critic/dataset), and
  on a successful promote, `master_wine_library` — the row `/wines` and every matcher read.
- `localStorage.wineops_last_extraction` (`CommandBar.tsx:109-113`) — local convenience only.

## 12. Design intent

**Should be:** the one place a contributor turns a wine list into trustworthy library
rows — extract, see how sure the machine is per field, correct what is wrong with a
reason, and promote. Correction and promotion are the product; extraction is the input.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes**, and good — "No records in this session / Paste a URL or drop a PDF…" (`Studio.tsx:19-27`) | |
| Loading | **yes** — skeleton rows (`WineRecordsTable.tsx:82-92`), `Ingesting…` spinner (`CommandBar.tsx:223`), metric skeletons (`MetricsDashboard.tsx:43`) | |
| Error | **partial** — ingest failures surface honestly (`CommandBar.tsx:140-143`, `setExtractionError` + toast); promote failures show a red "Failed" chip that self-clears in 3 s (`WineRecordsTable.tsx:53-56`); **metrics have no error state at all** | |
| Permission-denied | **yes** — route-level "Studio Access Required" card (`ProtectedRoute.tsx:105-124`) | |

**Where the UI misleads**

1. **Four zeros that mean "endpoint dead"** (`MetricsDashboard.tsx:41-61`) — the exact
   fabricated-zero failure the contract names.
2. **"URL crawler started"** for a crawl that is never started (`CommandBar.tsx:122`;
   `studio_routes.py:66-99`), on a page that captions the input *"will use Gemini Flash
   crawler"* (`:230`).
3. **Manual seed degrades silently to `local-<ts>`** on API failure
   (`CommandBar.tsx:128-129`) — the record exists only in browser memory, and the toast
   says "Empty record ready".
4. **Promote is enabled on wine-name alone** (`canPromote`, `WineRecordsTable.tsx:127`),
   so a row that will 404 looks actionable.
5. The permission-denied card and the header both say **"WineOps Studio"**
   (`ProtectedRoute.tsx:114`, `StudioLayout.tsx:33`) — §7 counts one; there are two.

## 13. Roadmap

1. **Route promote / override / metrics the way `CommandBar` already routes** — the
   one-line `base` prefix from `CommandBar.tsx:42` applied at `WineRecordsTable.tsx:41`,
   `FieldCell.tsx:89`, `MetricsDashboard.tsx:25`. Restores the page's two core actions.
   Correct the false comment at `MetricsDashboard.tsx:24`.
2. **Decide the studio transport once** — env-var-to-orchestrator (today's half-fix) vs a
   gateway `/studio` proxy like `common/orchestrator/health-proxy.controller.ts`.
   *Blocked: founder decision.* The proxy option also fixes #3 for free.
3. **Authenticate `POST /api/v1/onboarding/extract`** (`onboarding_routes.py:148-149`).
   It is unauthenticated, spends Anthropic credit, and its only brake is a $2.00 cap
   (`:35`) keyed on a **caller-supplied** `restaurant_id` (`:135,172`) — rotate the id,
   rotate the cap. Studio itself sends the literal `'studio'` when the user has no
   restaurant (`CommandBar.tsx:77`), so all studio extraction shares one $2 budget.
4. **Give metrics an error state** so a dead endpoint stops reading as a quiet week.
5. **Make the URL branch honest** — either wire an ingest path to the crawler (needs the
   unmounted `/api/v1/scan` router, `main.py:46`) or replace the toast with "URL ingestion
   is not wired yet". *Blocked on nothing; #5b is a five-minute fix.*
6. **Surface the enrichment the pipeline already produces** — ontology failures, critic
   composite, haiku fills, `field_review_queue` rows. All five stages write to the DB and
   none reach the reviewer (§11), which is the largest unexploited asset on this page.
7. Refetch records after promote/override so the table reflects server truth rather than
   the optimistic local patch at `WineRecordsTable.tsx:65-80`.
