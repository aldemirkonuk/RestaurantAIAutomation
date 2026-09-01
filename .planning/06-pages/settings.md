---
type: page
route: /settings
slug: settings
softwares: [settings-integrations]
component: apps/web/src/pages/Settings.tsx
audience: owner
tier: core
archetype: form # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 8
maturity: hollow
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[profile]]", "[[help]]", "[[privacy]]", "[[authorize-integration]]"]
---

# /settings — Settings

> **Part of** [[08-softwares/settings-integrations|Settings & Integrations]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Open Profile** (staff "ask a manager" view) → [[profile]] `/profile`
- **Help & Support** (staff "ask a manager" view) → [[help]] `/help`
- **Privacy** link (services tab) → [[privacy]] `/privacy`
- **Connect** per integration (features tab) → [[authorize-integration]] `/authorize/:integrationId`
- **Invite member** (team tab) → (modal on this page — InviteTeamDialog)
- **Add location / chain management** (locations tab) → (modals on this page)
- **Docs** per POS provider (pos tab) → external provider docs URL
- **iCal subscribe URL** (calendar tab) → external `GET /api/v1/calendar/feed/:token.ics`

## 1. Purpose

"Restaurant setup, features, permissions, and integrations"
(`components/layout/Sidebar.tsx:176`). Ten sections
(`SECTION_IDS`, `Settings.tsx:82`): team, services, email, notifications,
locations, measurement, map, features, pos, calendar — spanning member/invite
management, service permissions, sender identity, notification prefs, multi-location
chains, units, storage map, per-restaurant feature flags, POS connection, and the
iCal subscribe URL.

## 1a. Features
Ten sections, each deep-linkable via `?tab=`:
- **Team**: members and invites — change roles, remove members, revoke invites, invite dialog; labor & goals settings
- **Services**: service permissions / access grants (email, web, privacy)
- **Email**: sender identity settings
- **Notifications**: channel and batching preferences
- **Locations**: multi-location chains — create, assign, edit
- **Measurement**: units
- **Map**: storage map
- **Features**: per-restaurant feature flags
- **POS**: connect a POS provider, see connection status
- **Calendar**: iCal subscribe URL + regenerate token

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
  subscribes" (`v3.0-TECH-DEBT.md:346-348`) — the copy at `Settings.tsx:170`
  promises Outlook/Apple/Google regardless.
- ServicesPermissions describes telemetry ("find the screens that slow people
  down") that does not run (§5) — consent UI ahead of the capability.

## 10. Maturity

**hollow.**

The Features section **was** the largest single block of dead controls in the
product. It is not there any more, and the paragraph that described it was wrong
about *why* it was dead.

**Corrected 2026-08-26 (OD-86, `OPEN-DECISIONS.md:98`).** This dossier claimed the
page renders 22 toggles that "write a real row via `PUT /settings/feature-flags`",
and that one of them, `enable_ai_negotiation`, "genuinely stops the autonomous
responder". Both halves were false, and the audit found the failure to be a layer
deeper than this page:

| What this dossier said | What the audit found |
|---|---|
| 22 toggles render at `Settings.tsx:107-129` | Removed. `Settings.tsx:83-89` records the removal; `:107-129` is now `categoryLabels` and `CalendarSubscriptionSection` |
| Every toggle "writes a real row" | **The 22-column table never existed.** It lives in `services/database/migrations_archive/011_add_restaurant_feature_flags.sql`, outside `supabase/migrations/`, and was never applied — production has a 7-column EAV table. Every switch was inert at the **database**, not merely ungated |
| `enable_ai_negotiation` is the one real gate | Its gate query therefore **errored and fell back to "enabled"** — so AI negotiation could never be turned *off*. The one switch this page credited was the one actively lying |
| The autonomy flags are "not on this page" | `enable_ai_autonomous_send` is on it: `AiAutonomySection` is imported at `Settings.tsx:27` and rendered at `Settings.tsx:1299`, with the consequence spelled out |

What ships now: migration `20260826120000_od86_feature_flag_settings_row.sql` adds the
`enable_ai_negotiation` column (default true, preserving behaviour while making OFF
reachable); `apps/api-gateway/src/settings/feature-flag-registry.ts` is the single
place declaring which flags are real; and the flags with no gate are rendered
**without controls** and listed in `components/settings/inactiveFeatures.ts` rather
than faked.

Two further hollow surfaces:

| Surface | Evidence |
|---|---|
| Services & permissions consent | Toggles persist (`ServicesPermissions.tsx:143-149` → `updatePreferences({servicePermissions})` → `PATCH /users/:id/preferences`), but `servicePermissions` is **read only by the component that writes it** — grep finds it in `ServicesPermissions.tsx:110,126,148` and the type at `hooks/useUserPreferences.ts:27`, nowhere else. `privacy_analytics` ("report how you move through the app", `:31`) governs `lib/uxSignals.ts`, which is dark unless `VITE_UX_OPTIMIZER === "true"` (`uxSignals.ts:15`) and has no callers. §5's observation, confirmed with the read side |
| iCal subscribe | `Settings.tsx:170` promises Outlook/Apple/Google. `v3.0-TECH-DEBT.md:346-348` records that no client has ever been observed to subscribe. **A concrete suspect, found here:** the feed sets `Content-Disposition: attachment; filename="wineops-calendar.ics"` (`calendar/calendar.controller.ts:601-604`), which tells a browser and most calendar clients to *download a file* rather than *subscribe to a feed*. Not proven — nobody has tested it — but it is the first thing to try |

Real on this page: members/invites, chains and locations, POS provider connection,
notification preferences (honoured by the senders via `getEffectiveCategoryMode`,
`communications/scheduled-tasks.service.ts:177-183`), measurement units, storage map.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET/PUT | `/settings/feature-flags` | JWT + **TenantGuard** (`settings/settings.controller.ts:31-32`) | `settings.service.ts:17-105` | 22+ booleans; defaults all-true when no row (`:25-27`) |
| GET/POST | `/calendar/ical-token`, `…/regenerate` | JWT | `calendar.controller.ts:609-637` | 64-char token + feed path |
| GET | `/restaurants/:rid/members`, `…/invites` | JWT | `restaurants` module | Roster, pending invites |
| PATCH/DELETE | `/restaurants/:rid/members/:userId` | JWT | `restaurants` module | Role change / removal |
| DELETE | `/restaurants/:rid/invites/:code` | JWT | `restaurants` module | Revoked invite |
| GET/PATCH/DELETE | `/organizations/chains`, `…/chains/:id` | JWT (class, `organizations.controller.ts:33`) | `organizations.service.ts` | Chains; `assertManagerOrOwner` on the write paths (`:94-118,184`) |
| GET | `/pos-hub/providers`, `/pos-hub/status/:rid` | JWT | `pos-hub` module | Connector list + connection state |
| GET/PATCH | `/notifications/preferences` | JWT (class, `notifications.controller.ts:45`) | `:144-176` | Per-category channel prefs |
| PATCH | `/users/:userId/preferences` | JWT | `user-preferences` module | Consent object nothing reads (§10) |

Most member/chain calls are raw `fetch` with a hand-attached Bearer token
(`Settings.tsx:769-880`), bypassing `apiClient` interceptors — same inconsistency as
dashboard.md §9.

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Feature flags | This page only | Row: yes. Effect: 1 of 22 |
| Members / invites | Registration + `POST /auth/invite`; `/invite/:code` acceptance | Yes |
| Chains / locations | This page; `assertManagerOrOwner` enforced (`organizations.service.ts:184`) | Yes |
| POS status | Toast/SimPOS connector handshake (memory: pos-bridge-state) | Yes |
| Notification prefs | This page; read by the alert senders | Yes |
| iCal token | `calendar.service.getOrGenerateICalToken` | Yes |
| Consent object | This page only | Row: yes. Effect: none |

### Writes

| Write | Downstream reaction |
|---|---|
| `enable_ai_negotiation` off | The autonomous responder stops drafting for this restaurant (`inbound-responder.service.ts:177`) — a real kill switch |
| The other 21 flags | **none** |
| Notification prefs | Every scheduled cron checks the category before sending (`scheduled-tasks.service.ts:177-183`) |
| Member role change / removal | Team access changes immediately; `/team` gates on it |
| iCal token regenerate | **Invalidates every existing subscription** (`calendar.controller.ts:624`) — irreversible, and the UI should say so |
| POS connect | Unlocks the 429/573 POS-dependent insight types (TIER-MAP:91-93) — S14, "the true upgrade trigger" |
| `servicePermissions` | **none** |

## 12. Design intent

**Should be:** the place where an owner changes what the system does, and can trust
that flipping something changed something.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Partial | `CalendarSubscriptionSection` tracks `loading` (`Settings.tsx:145`); the flags and member fetches do not |
| Empty | Partial | Missing-flags row falls back to all-defaults (`settings.service.ts:25-27`) rather than an empty state — reasonable |
| Error | Partial | Write failures toast. **Read failures no longer render defaults** — `settings.service.ts:46-52` raises rather than swallowing (rationale comment `:29-37`), because "an autonomy dial reading OFF when the truth is that we could not find out" is [ADR 0020](../decisions/0020-no-fabricated-answers.md)'s exact prohibition. A *missing row* still legitimately answers with registry defaults |
| Permission-denied | **No** | Non-managers see an "ask a manager" view client-side; there is no 403 branch when the server refuses (`organizations.service.ts:116-118` throws `ForbiddenException`) |

**Where the UI misleads**

1. ~~Twenty-one switches that persist and do nothing.~~ **Fixed by OD-86** — and it
   was worse than "no effect": the columns behind them had never been created, so the
   writes failed too. Flags with no gate now render without controls (§10).
2. ~~The autonomy switch that matters is absent from the surface named "features".~~
   **Fixed** — `enable_ai_autonomous_send` ships in `AiAutonomySection`
   (`Settings.tsx:27,1299`).
3. Consent copy describes telemetry that does not run (§5, §10).
4. Missing-flags-row answers with **registry defaults** (`settings.service.ts:32-33`,
   `defaultActiveFlags()` at `:137`) — still worth knowing, but no longer the "every
   capability enabled" surface this dossier described, since the gate-less flags no
   longer render as controls at all (§10).
5. `Settings.tsx:170` names three calendar clients for a feed nobody has seen work.

## 13. Roadmap

1. ~~**Cut the Features section to the flags that exist as gates.**~~ **Done
   2026-08-26 (OD-86).** The gate-less flags are rendered without controls and listed
   in `inactiveFeatures.ts`; `feature-flag-registry.ts` is the single source of which
   flags are real. The OD-23 tiering fork it was "blocked on" is **still open** — but
   it was never blocking this, which is why the removal shipped without it.
2. ~~**Expose `enable_ai_autonomous_send`.**~~ **Done 2026-08-26** —
   `AiAutonomySection` (`Settings.tsx:27,1299`), with tests at
   `components/settings/AiAutonomySection.test.tsx`.
3. **Test the iCal feed against a real client** and try dropping
   `Content-Disposition: attachment` (`calendar.controller.ts:601-604`). Cheapest
   possible resolution of `v3.0-TECH-DEBT.md:346-348`; today the copy promises what
   nobody has verified.
4. **Warn before regenerating the iCal token** — it silently breaks every existing
   subscription (`calendar.controller.ts:624`).
5. **Either wire `servicePermissions` as a real gate or remove the consent UI.**
   Consent ahead of capability is the wrong-way-round failure: it teaches people the
   switch means something.
6. Route member/chain calls through `apiClient` (`Settings.tsx:769-880`).
7. Rebrand the 8 strings (§7) — `ServicesPermissions.tsx` carries six of them.
