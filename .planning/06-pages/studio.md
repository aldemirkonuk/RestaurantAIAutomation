---
type: page
route: /studio
slug: studio
component: apps/web/src/pages/studio/Studio.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 1
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[studio-queue]]", "[[studio-certify]]", "[[wines]]"]
---

# /studio — data ingestion workbench

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
- **Routing gap (candidate defect, not in `v3.0-TECH-DEBT.md`)**: the components assume
  the Vite `/api` proxy targets FastAPI:8000 (`CommandBar.tsx:29-30`,
  `MetricsDashboard.tsx:23`, `FieldCell.tsx:68`), but `apps/web/vite.config.ts:24-28`
  proxies `/api` → `http://localhost:4000` (NestJS), and production rewrites `/api/*`
  to the Railway **gateway** (`vercel.json:8-10`). The gateway has no studio or
  onboarding-extract module and no forwarding proxy (only health:
  `common/orchestrator/health-proxy.controller.ts`). As configured, every §4 call
  should 404 in both dev and prod.
- Manual-seed sessions silently degrade to a local `local-<ts>` id when the API fails
  (`CommandBar.tsx:122`) — records then exist only in browser memory.
- This is the **richest enrichment surface among the wine pages**: 14 record columns
  including grape_variety, color, sweetness, tasting_notes, description
  (`WineRecordsTable.tsx:10-23`) with per-field confidence badges (`FieldCell.tsx:24-33`)
  — none of which `/wines` surfaces (see [[wines]] §9).
