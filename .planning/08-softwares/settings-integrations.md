---
type: software
slug: settings-integrations
name: Settings & Integrations
division: platform-admin
status: partial
tier: core
routes: ["/settings", "/services", "/authorize/:integrationId"]
pages: [settings, services, authorize-integration]
api_modules: [settings, integrations, user-preferences, restaurant-templates]
agents: []
owner_unit: platform-api
updated: 2026-09-01
links: ["[[settings]]", "[[services]]", "[[authorize-integration]]", "[[platform-api-charter]]", "[[integration-engineering-charter]]", "[[team-command]]", "[[SOFTWARE-MAP]]"]
---

# Settings & Integrations

## §0 What it is

Where an owner configures the restaurant and grants the product access to outside
accounts. Ten sections behind one screen — who is on the team, which locations belong to
which chain, what units you count in, which notifications you get, which POS you are
connected to — plus the consent screen you pass through on the way to Google or Microsoft
before an integration can read anything.

## §1 Features today

- Read a plain-language consent screen before an OAuth hand-off — what the grant is for,
  and what we deliberately do not ask for
- Cancel a grant and return where you came from; the return path is restricted to
  same-site paths on both client and server
- Set measurement units; open the storage map
- Set the email sender identity
- Set notification channel and batching preferences — honoured by the senders
- Subscribe a calendar client to an iCal URL, and regenerate its token — **broken in
  practice**: no client has ever been observed to subscribe (`settings.md` §10)
- Connect a POS provider and see its connection status
- Manage members and invites — change roles, remove, revoke, invite
- Create and assign locations and chains for multi-location groups
- Grant or revoke service permissions (email, web, privacy) — **hollow**: the toggles
  persist, and `servicePermissions` is read by nothing but the component that writes it
- Toggle per-restaurant feature flags — **hollow, now honestly so**: the 22 switches that
  wrote to a table that was never applied are gone; flags with no gate render *without
  controls* rather than faked (`components/settings/inactiveFeatures.ts`)

## §2 Screens

- [[settings]] — the software. `apps/web/src/App.tsx:317`;
  `apps/web/src/pages/Settings.tsx` is **1,409 lines** (the page note's 1,575 is stale)
  and honours `?tab=` deep links.
- [[services]] — a redirect, **confirmed**: `apps/web/src/App.tsx:332` is
  `<Navigate to="/settings?tab=services" replace />`. Nothing in the app links to it; the
  two surfaces that offer "services" (`Help.tsx:154`, `Privacy.tsx:64-66`) navigate
  straight to `/settings?tab=services` and skip this route entirely.
- [[authorize-integration]] — the consent step, `apps/web/src/App.tsx:262`, inside
  `ProtectedRoute` but deliberately **outside `DashboardLayout`** so that nothing offers
  ways to wander off mid-grant (the reasoning is in the route comment, `App.tsx:255-261`).

## §3 Backend

Four modules, and only one of them is this software's alone.

| Module | Endpoints | Controller |
|---|---|---|
| `settings/` | 4 | `@Controller("settings")` `settings.controller.ts:32` |
| `integrations/` | 5 | `@Controller("integrations/oauth")` `integrations-oauth.controller.ts:27` |
| `user-preferences/` | 2 | `@Controller("users")` `user-preferences.controller.ts:20` |
| `restaurant-templates/` | 4 | `@Controller("restaurants")` `restaurant-templates.controller.ts:23` |

`settings.controller.ts:33` is `@UseGuards(JwtAuthGuard, TenantGuard)` — the **only**
controller in the gateway that names both, which is decoration rather than defence given
what §7 says about the second one. `integrations-oauth` guards per method
(`:40,63,77,125`) with one deliberate `@Public()` on the provider callback (`:107`).

Seams to name: `restaurant-templates` is **shared** — the Email tab writes a
`sender_identity` row through it (`components/settings/EmailSenderSettings.tsx:24,38,40`)
while `hooks/useTemplates.ts` drives the same four endpoints for communications templates.
The page also calls `restaurants/members` (6), `organizations` (8), `calendar`,
`pos-hub` and `notifications` endpoints that belong to [[team-command]] and other
softwares; the Settings screen is a client of six modules and the owner of four.

## §4 Automation

`none (every action is human-initiated)`. No `@Cron` in `settings/`, `integrations/`,
`user-preferences/` or `restaurant-templates/`. Nothing re-checks a connection's health,
refreshes a token proactively, or notices a grant that has been revoked upstream — a
connector surface with no sweep can only tell you what it was told last time somebody
looked.

## §5 Data

- `restaurant_feature_flags` — via `FEATURE_FLAGS_TABLE`
  (`settings/feature-flag-registry.ts:38`, used at `settings.service.ts:40,84`)
- `integration_oauth_connections`, `integration_oauth_states` — `integrations/`
- `user_preferences` — `user-preferences/`
- `communication_templates` — `restaurant-templates/`, **shared with communications**

`settings/` owns no other table: everything else the screen edits is written through
another software's module.

## §6 Owner

[[platform-api-charter]] — team `platform-api`, department `engineering`, division
Platform. The charter names `settings/` (4) and `user-preferences/` (2) outright in its
identity-and-org-surfaces line (`platform-api-charter.md:32-35`).

**It does not own the integrations half, and says so.** Its non-goals table hands *"Which
routes are legitimately public, and their signature verification"* to
[[integration-engineering-charter]] (`platform-api-charter.md:57`), and that charter
claims `apps/api-gateway/src/integrations/integrations-oauth` — 5 routes — in its own
boundaries table (`integration-engineering-charter.md:32-35`). A third charter,
[[connector-platform-trust-charter]] (Product → partnerships-integrations), owns the
*class*: the connector catalogue, OAuth and credential lifecycle, and connection health
(`connector-platform-trust-charter.md:28-32`).

`restaurant-templates` is claimed by no charter at all — grep over `01-org` returns
nothing. Gap row for [[SOFTWARE-MAP]].

## §7 Maturity & seams

**partial**, and the roll-up needs stating rather than averaging. [[settings]]'s own §10
says **hollow**; [[services]] and [[authorize-integration]] both say **complete**. Taking
`hollow` for the software would overstate it, because settings.md §10 itself closes by
listing what is real on the page — members and invites, chains and locations, POS
connection, notification preferences, measurement units, storage map. The hollowness is
specific and named: the feature-flag surface, the services-consent toggles, and the iCal
subscribe.

The two honest hollow verdicts, both with the evidence in `settings.md` §10:

1. **Feature flags were inert at the database, not merely ungated.** The 22-column table
   the service read and wrote lives in `services/database/migrations_archive/` — outside
   `supabase/migrations/` — and was never applied; production carries an EAV table
   instead. Every switch was dead, including the one the page credited as real
   (`enable_ai_negotiation`, whose gate query errored and fell back to *enabled*, so AI
   negotiation could never be turned off). Fixed 2026-08-26 under OD-86; the registry file
   now carries the whole diagnosis (`settings/feature-flag-registry.ts:1-26`).
2. **Services consent persists into a void.** The toggles write `servicePermissions`
   through `PATCH /users/:id/preferences`; grep finds the key in
   `ServicesPermissions.tsx` and one type, nowhere else. `privacy_analytics` governs
   `lib/uxSignals.ts`, which is dark unless `VITE_UX_OPTIMIZER === "true"` and has no
   callers. This is a **consent control that governs nothing**, which is worse than a dead
   toggle.

Structural seams:

3. **ADR 0049 §3a mis-assigns `integrations` to the POS division — a mapping error, not a
   real straddle.** §3a's POS row claims `apps/api-gateway/src/integrations` and the
   `authorize-integration` page (`.planning/04-specs/ECOSYSTEM-PLAN.md:53`), while
   `settings` sits in Platform/Admin (`:59`). Checked against the code, there is nothing
   POS about either. The module defines exactly two integrations, and both are document
   storage: `google_drive` with `provider: "google"`
   (`integrations/integrations-oauth.constants.ts:39`) and `excel` with
   `provider: "microsoft"` (`:70`) — Drive exports and Excel workbooks on OneDrive. The
   page's allowlist is the same pair (`AuthorizeIntegration.tsx:21`,
   `VALID_IDS = ['google_drive', 'excel']`), its only in-app entry point is Settings
   (`components/settings/IntegrationsAuth.tsx:161`, with
   `returnPath=/settings?tab=features`), and its default return is `/settings` (`:100`).
   POS connection is a different surface on a different module — `PosSettingsSection` over
   `pos-hub`. So `integrations` belongs in **Platform/Admin alongside `settings`**, and
   `division: platform-admin` is correct for this software outright rather than by §3a's
   primary-consumer tie-break. **Finding sent to the session amending ADR 0049.**
4. **Two sources of truth for "what integrations exist."** The catalogue is server-driven,
   but adding a third integration still requires editing a hard-coded `VALID_IDS`
   (`AuthorizeIntegration.tsx:21`).
5. **A 1,409-line page hosting ten sections.** Nothing can be extracted section-wise.

## §8 Where it's going

- ADR 0049 §3a: `settings` under **Platform/Admin** at phase **E0**
  (`ECOSYSTEM-PLAN.md:59`). Its POS row's claim on `integrations` and
  `authorize-integration` (`:53`) is a mapping error — see §7 seam 3; the whole software
  is Platform/Admin, and the correction is with the session amending ADR 0049.
- OD-86 closed the feature-flag lie; the **services-consent** hollow is the same defect
  class and has no OD yet — it is the obvious next one.
- The iCal suspect is written down and untested: the feed sets
  `Content-Disposition: attachment` (`calendar/calendar.controller.ts:601-604`), which
  tells a client to download a file rather than subscribe to a feed. First thing to try.
- Connection health has no owner in code and a clear owner in the org
  ([[connector-platform-trust-charter]]); §4 is the gap between those two facts.
