---
type: page
route: /studio/certify
slug: studio-certify
component: apps/web/src/pages/studio/StudioCertify.tsx
audience: dev
tier: core
signals_today: none
rebrand_strings: 1
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[studio]]", "[[studio-queue]]"]
---

# /studio/certify — certified contributors admin

## 1. Purpose
Manage the certified-contributor roster: invite (single-use link), revoke, and
enable/disable contributors who feed the studio ingestion pipeline.

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list) except the studio header's
"Certify" link, rendered only for review_admin/developer (`StudioLayout.tsx:58-67`).
Route gate: `requiredStudioRole={['developer','review_admin']}` (`App.tsx:184-191`).

## 3. Files
- Route: `apps/web/src/App.tsx:184-191` → `pages/studio/StudioCertify.tsx` (91 lines)
- `pages/studio/certify/ContributorTable.tsx` (194), `InviteDialog.tsx` (152)
- Shell: `pages/studio/StudioLayout.tsx`

## 4. Endpoints
- `GET /api/v1/studio/contributors` — 60s poll (`StudioCertify.tsx:16,24-28`)
- `PATCH /api/v1/studio/contributors/:userId/revoke` (`StudioCertify.tsx:33-36`)
- `PATCH /api/v1/studio/contributors/:userId/enable|disable` (`StudioCertify.tsx:41-44`)
- `POST /api/v1/studio/invite` (`certify/InviteDialog.tsx:31`)
Server: orchestrator `studio_routes.py:483` (invite), `:760` (contributors),
`:789-` (revoke/enable/disable PATCHes). Not in the gateway atlas — same routing gap
as [[studio]] §9.

## 5. Signals
none.

## 6. Tier cut
Outside the tier axis — internal admin for the S06/S17 data-supply chain.

## 7. Rebrand surface
1 — shared "WineOps Studio" header (`StudioLayout.tsx:33`).

## 8. State & config
Studio role gate (§2); Bearer token from localStorage (`StudioCertify.tsx:10-13`).

## 9. Gaps
- Same **/api routing gap** as [[studio]] §9 — all four calls should 404 against the
  gateway as proxied/rewritten today.
- `handleRevoke`/`handleToggleEnable` don't check the response status
  (`StudioCertify.tsx:32-46`) — a failed PATCH still invalidates the query and looks
  like success (the "reachable code that does nothing" failure mode named at
  `v3.0-TECH-DEBT.md:53-56`).
