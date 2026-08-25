---
type: page
route: /settings
slug: settings
component: apps/web/src/pages/Settings.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 8
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /settings — Settings

## 1. Purpose

"Restaurant setup, features, permissions, and integrations"
(`components/layout/Sidebar.tsx:176`). Ten sections
(`SECTION_IDS`, `Settings.tsx:82`): team, services, email, notifications,
locations, measurement, map, features, pos, calendar — spanning member/invite
management, service permissions, sender identity, notification prefs, multi-location
chains, units, storage map, per-restaurant feature flags, POS connection, and the
iCal subscribe URL.

## 2. Entry

In-degree 4 ([PAGE_MAP](../foundation/PAGE_MAP.md):141): from `/help`, `/privacy`,
`/profile`, `/recommendations/catalog`. Sidebar (`Sidebar.tsx:174`). `/services`
redirects to `/settings?tab=services` (`apps/web/src/App.tsx:295`); `?tab=` deep
links are honored (`Settings.tsx:709,721`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:285` (lazy import :103).
- `apps/web/src/pages/Settings.tsx` (1,575 lines).
- Section components: `components/settings/{EmailSenderSettings, NotificationsSection, IntegrationsAuth, PosSettingsSection, ServicesPermissions}.tsx`, `components/team/{InviteTeamDialog, TeamLaborSettings, TeamGoalsSettings}.tsx`, `components/locations/{AddLocationDialog, EditLocationChainDialog, CreateChainDialog, AssignToChainDialog}.tsx` (Settings.tsx:44-63).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):527 (`settings`), :516
(`restaurants/members`), :342 (`organizations`), :87 (`calendar`), :355 (`pos-hub`),
:300 (`notifications`).

| Method | Path | Call site |
|---|---|---|
| GET/PUT | `/settings/feature-flags` | `Settings.tsx:894,920` → `services/api/settings.ts:58,66` |
| GET | `/calendar/ical-token`; POST `…/regenerate` | `Settings.tsx:159,177` |
| GET | `/restaurants/:rid/members`, `…/invites` | `Settings.tsx:769,778` |
| PATCH/DELETE | `/restaurants/:rid/members/:userId` | role change / remove, `Settings.tsx:805,842` |
| DELETE | `/restaurants/:rid/invites/:code` | `Settings.tsx:862` |
| GET | `/organizations/chains`; PATCH/DELETE `…/chains/:id` | `Settings.tsx:880,516,537` |
| GET | `/pos-hub/providers`, `/pos-hub/status/:rid` | PosSettingsSection → `services/api/posHub.ts:52,59` |
| GET/PATCH | `/notifications/preferences` | NotificationsSection → `services/api/notifications.ts:194,207` |

Most member/chain calls are raw `fetch` with a manually attached Bearer token
(`Settings.tsx:769-880`) rather than `apiClient`.

## 5. Signals

**None emitted.** Ironically this page *houses* the consent switch for the
would-be signal system: ServicesPermissions offers "report how you move through the
app" (`components/settings/ServicesPermissions.tsx:31`) while the reporter it
governs ships dark with no callers (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — operate. S14 (POS connect — "the true upgrade trigger",
[TIER-MAP](../03-scenarios/TIER-MAP.md):50,94-96) lives in the `pos` section; the
`features` section is where per-restaurant tiering would surface if OD-23 pricing
ever lands.

## 7. Rebrand surface

**8 user-visible strings** — the largest rebrand slice of the 17:

- `Settings.tsx:207` — "Subscribe to your WineOps calendar…".
- `ServicesPermissions.tsx:31,50,72,88,166,249` — six rendered "WineOps" sentences
  (permission copy + cookies note; :240 is a comment, not counted).
- `NotificationsSection.tsx:175` — "How and when WineOps alerts you".

Layout chrome per dashboard.md §7.

## 8. State & config

- **This page is the config surface**: per-restaurant feature flags (GET/PUT above),
  service permissions, POS provider selection, notification channels, measurement
  units, location chains. Deep-linkable via `?tab=` (`Settings.tsx:721`).
- Feature-flag reads elsewhere go through `settingsApi.checkFeatureFlag`
  (`services/api/settings.ts:74`).

## 9. Gaps

- Raw-`fetch`-with-manual-token pattern (§4) bypasses `apiClient` interceptors —
  same inconsistency as dashboard.md §9.
- Phase 30 iCal: "no external calendar client has ever confirmed the feed
  subscribes" (`v3.0-TECH-DEBT.md:243-245`) — the copy at `Settings.tsx:207`
  promises Outlook/Apple/Google regardless.
- ServicesPermissions describes telemetry ("find the screens that slow people
  down") that does not run (§5) — consent UI ahead of the capability.
