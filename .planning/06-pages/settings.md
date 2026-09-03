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
maturity: partial
status: documented
updated: 2026-09-02
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

**Mudavym redesign — what the rebuilt page adds** (flag `mudavym_design_settings`,
OFF by default; with it off `Settings.tsx` renders byte-for-byte):

- **A provenance line under every setting** — where the value is kept (*this
  restaurant* · *your account* · *this browser*) and when it was last written, or
  an em dash naming why no date exists. This is the "there should be more" the
  founder asked for: substance per setting, not more switches.
- **Ten registers, one open at a time**, all ten still deep-linked by `?tab=`;
  the URL is now written on selection and never on scroll.
- **Features**: only registry-ACTIVE flags get controls, with the 17
  `mudavym_design_*` keys rendered as their own labelled *Mudavym redesign*
  group (opt-in per restaurant, off by default). `enable_ai_autonomous_send` is
  granted by hold-to-approve completing into the seal, and revoked by one plain
  button — never a toggle.
- **Settings the product stores but never reads render WITHOUT controls**,
  showing the stored value and the file that was grepped: push, the five
  notification categories, quiet hours, and the four service-permission consents
  (all newly measured — §9, §10).
- **Measurement & recipes is labelled *this browser*** — it is
  localStorage, not a restaurant setting (`stores/restaurantSettingsStore.ts`).
- **Notifications states the OR semantics**: your preference is taken across
  every member — the alert goes out if anyone wants it, and the earliest digest
  time wins (`low-stock-alerts.service.ts:485-520`).
- **POS**: the connector picker is labelled a documentation bookmark, because
  nothing in the ingest path reads it; a failed `pos_checks` read says so rather
  than rendering "no checks".
- **Calendar**: the Outlook/Apple/Google steps are filed under *Untested* with
  the `Content-Disposition: attachment` suspect named, and regeneration is an
  armed two-click confirm that states it breaks every existing subscription.
- **Not rebuilt, deliberately**: the five modal dialogs (invite, add location,
  create/assign chain, edit branch) and the two labour/goals panels are the
  shipping components, mounted as-is — capability kept, visual seam accepted
  (§13.13).

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_settings`)

Canonical source with curves: `apps/web/src/pages/settings/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `st-register-turn` | The page turns | the open register's panel, once per register change — `turn`, 420ms, 5px rise + fade |
| `st-ink` | Ink micro-state | contents item / toggle / chip / button / select hover, focus and checked — `ink`, 160ms; the toggle thumb's 18px travel is the only translation |
| `st-disclosure-settle` | Show the working | "Labour & goals" and "the steps, as far as they are known" — `settle`, 320ms, `grid-template-rows: 0fr → 1fr` |
| `st-hold-pour` | The İznik pours | the fill under **Hold to allow AI to send** while the thumb is down — `pour`, linear, 620ms |
| `st-hold-tuck` | The retreat | an early release, with "Released at N% — nothing sent" — `tuck`, ~300ms |
| `st-seal-stamp` | The seal lands | autonomous sending granted — `stamp`, 360ms, ~11% overshoot; the only wax on the page |

Deliberate non-motions: the seal is pressed **once** on this page (revoking
autonomy, removing a member, revoking an invite, disconnecting an app and
regenerating the iCal token are dry two-click confirms — revoking must stay the
cheap direction); nothing animates on a successful save (a motion fired on click
is a confirmation the server has not given); no tally; no stagger in the
contents list; no scroll motion, because one register is open at a time.

### Design used, and why (ADR 0044 p4 wave · MAKEOVER-VERDICTS: KEEP Editorial + "more")

**The verdict, verbatim:** *"I kind of like the Editorial. I think that's the best
way to go — or Federation, it doesn't matter. But I feel like there should be
more."*

**The structure that enforces it.** Editorial is kept literally: a contents page
and a register. Fraunces speaks the opening and each register's name, the index
is numbered like a book's table of contents with the storage each register uses
printed beside it, and a double rule under the heading rules off the account.
The "more" is one structural idea rather than more controls — **every setting is
a record, and a record declares its scope and its date**. `Row` in `SectionKit.tsx`
cannot be used without a provenance line, so the substance is enforced by the
component, not by discipline. That single requirement is also what produced the
new findings: forcing each setting to say where it is kept is how measurement
turned out to be localStorage, and forcing it to say what changes is how push,
the notification categories, quiet hours and the four consents turned out to be
read by nothing (§9).

**The honesty rules applied.** A setting the product stores and never reads is
rendered *without* a control, showing its stored value and the file that was
grepped (`Dead` in `SectionKit.tsx`) — ADR 0020, and the founder's "no fake
toggles". A read that fails names the register that failed and says "this is not
an empty register"; a 403 says it was refused, not that the book is empty
(`Register`, four states). An unknown date is an em dash *with its reason
attached*, never "just now". The page opens by stating the one thing it cannot
tell anyone: no table behind it records **who** changed a setting.

**Two alternatives considered and not built — the founder's fork:**

1. **Keep the legacy single-page scroll with the sticky tab bar** (all ten
   sections stacked, scrollspy highlighting). Not built: the scrollspy rewrites
   `?tab=` as the reader scrolls, so the deep link they just followed is
   destroyed within a second — and ten registers carrying the new provenance
   line run to roughly four screens of dense text. *If the founder wants
   everything visible at once for scanning*, this comes back and `?tab=` becomes
   entry-only (read on arrival, never rewritten).
2. **Leave the dead consents and category switches settable** — they do persist
   — under a "recorded, not enforced" label beneath a working control. Not
   built: a switch whose only effect is to record itself is the fake toggle the
   brief rules out. But this *is* a capability removal on web (mobile's guidance
   provider can still write `servicePermissions`), so it is genuinely the
   founder's call: wire them as real gates (§13.5), delete them, or restore the
   controls with the label.

**Substituted or left out, and why:** the five location/invite modals and the two
labour/goals panels are the shipping components mounted as-is — rebuilding seven
dialogs was out of scope and dropping them would have cost real capability, so
the seam is accepted and filed (§13.13). No live screenshot was taken: the
browser pane renders out-of-project files as non-screenshottable static
snapshots, and the shared dev server and checkout are not this agent's to drive —
so both grounds are argued from token-only colour usage (grep: zero raw hex for
any ground, ink or seal) plus a test asserting the root carries `.mudavym` and
`data-ground="charcoal"`, not from eye. The page runs **2,360 lines across nine
files** excluding its test, about 2.6× the ~900-line guidance in the build brief;
ten registers each carrying real substance is the reason, and the shared `Row` /
`Register` primitives are what keep it from being far worse.

## 2. Entry

In-degree 4 ([PAGE_MAP](../foundation/PAGE_MAP.md):141): from `/help`, `/privacy`,
`/profile`, `/recommendations/catalog`. Sidebar (`Sidebar.tsx:174`). `/services`
redirects to `/settings?tab=services` (`apps/web/src/App.tsx:295`); `?tab=` deep
links are honored (`Settings.tsx:709,721`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:285` (lazy import :103).
- `apps/web/src/pages/Settings.tsx` (1,409 lines, measured 2026-09-02 — the
  dossier previously said 1,575).
- Section components: `components/settings/{EmailSenderSettings, NotificationsSection, IntegrationsAuth, PosSettingsSection, ServicesPermissions}.tsx`, `components/team/{InviteTeamDialog, TeamLaborSettings, TeamGoalsSettings}.tsx`, `components/locations/{AddLocationDialog, EditLocationChainDialog, CreateChainDialog, AssignToChainDialog}.tsx` (Settings.tsx:44-63).
- **Mudavym redesign** (flag `mudavym_design_settings`):
  `apps/web/src/pages/settings/next/` — `SettingsNext.tsx` (shell, contents,
  `?tab=` routing), `useSettingsNextData.ts` (every register, `apiClient` only,
  tenant-keyed, lazy per register), `SectionKit.tsx` (`Row` with its provenance
  line, `Dead`, `Register`'s four states, `ConfirmAction`), `FeaturesSection.tsx`,
  `NotifySection.tsx`, `TeamSection.tsx` (team + locations), `OtherSections.tsx`
  (services · email · measurement · map · POS · calendar), `st-format.ts`
  (the ten-register vocabulary + formatting), `fonts.ts`, `MOTIONS.md`,
  `SettingsNext.test.tsx` (15 tests).

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
- **Mudavym redesign gate**: `mudavym_design_settings`, registry-ACTIVE and
  `defaultValue: false` (`apps/api-gateway/src/settings/feature-flag-registry.ts`).
  Per-browser override `localStorage["mudavym.design.settings"]` — `1|true|on`
  forces the redesign, `0|false|off` forces legacy — beats the flag on that
  machine only (`lib/mudavym/useMudavymDesign.ts`). With the flag off,
  `pages/Settings.tsx` renders byte-for-byte.
- Note the recursion: this page is where all 17 `mudavym_design_*` flags are
  flipped, **including its own** — turning `mudavym_design_settings` off from the
  rebuilt Features register returns you to the legacy page.

## 9. Gaps

- Raw-`fetch`-with-manual-token pattern (§4) bypasses `apiClient` interceptors —
  same inconsistency as dashboard.md §9.
- Phase 30 iCal: "no external calendar client has ever confirmed the feed
  subscribes" (`v3.0-TECH-DEBT.md:346-348`) — the copy at `Settings.tsx:170`
  promises Outlook/Apple/Google regardless.
- ServicesPermissions describes telemetry ("find the screens that slow people
  down") that does not run (§5) — consent UI ahead of the capability.

**Measured 2026-09-02 during the Mudavym rebuild** (all grepped across
`apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src`):

1. **Push is not delivered at all.** `push_enabled` persists
   (`notifications.service.ts:1142`) and nothing anywhere sends a push: the
   recipient resolver has no push path, the store it used
   (`push_subscriptions`) does not exist in production, and the obvious repoint
   target has a writer that cannot be planned (42P10). Evidence, in one place:
   `apps/api-gateway/src/communications/push-is-not-resolved-here.spec.ts`.
   The rebuilt page renders Push **without a control**.
2. **Notification categories and quiet hours are written and never read.**
   Written at `notifications.service.ts:1144` and `:1146-1151`; no sender
   branches on either — `getEffectiveCategoryMode` reads `orders_mode` /
   `reports_mode` only (`scheduled-tasks.service.ts:1523-1552`), and
   `getEffectiveLowStockPrefs` reads the five low-stock columns
   (`low-stock-alerts.service.ts:485-520`). Six more controls that changed
   nothing; rendered without controls now.
3. **No setting on this page records WHO changed it.**
   `restaurant_feature_flags` carries `created_at` and no `updated_at` or
   `updated_by` (`supabase/migrations/20260805000000_baseline_from_production.sql:5097-5105`),
   and the service selects only the flag columns (`settings.service.ts:41-46`).
   The rebuilt page says this in its opening paragraph rather than leaving the
   provenance line blank.
4. **`posConfig.activeProvider` is read only by the settings UI itself**
   (`components/settings/PosSettingsSection.tsx:59,76,85`). It connects nothing
   and routes nothing — the rebuilt page labels it a documentation bookmark.
5. **Correction to §10's `servicePermissions` claim.** "Read only by the
   component that writes it" is not exact: `apps/mobile/src/guidance/GuidanceProvider.tsx:130-139,314`
   also reads it and exposes a setter — and nothing consumes *that* either. The
   load-bearing half of the claim survives: **no code branches on it anywhere.**
6. **Measurement and recipes are per-browser.** `stores/restaurantSettingsStore.ts`
   is zustand `persist` under `restaurant-settings-storage` — localStorage, not
   the restaurant and not the account. The legacy page presents the four
   controls beside restaurant settings with nothing saying so.
7. **The seeded-defaults guard does not scan the rebuilt directory.**
   `scripts/check_no_seeded_defaults.py` `SCAN_ROOTS` has no entry for
   `apps/web/src/pages/settings/next`, so a clean run says nothing about it. The
   build was verified against a root-pinned copy of the guard with that entry
   added (PASS, 68 web files vs 59) — the real entry is §13.8, and it is outside
   the page agent's paths.

## 10. Maturity

**partial** — moved from **hollow** on 2026-09-02 by the Mudavym rebuild
(`mudavym_design_settings`).

**What moved it, and to what.** "Hollow" was earned by the 22-switch era, and it
was still the right word while the page's honest content lived only in this
dossier — three corrections nobody standing on `/settings` could see. It is no
longer right: seven of the ten registers are live end to end, and the three that
are not now say so **on the page**, each naming the file that was grepped. It is
`partial` and not `complete` because four surfaces are still consent ahead of
capability (push, notification categories, quiet hours, the four service
permissions), the iCal feed is still unproven against any client, and no setting
on the page records an author.

| Register | Live? | Evidence |
|---|---|---|
| Team | **yes** | members/invites/roles/removal, all through `apiClient`; a 403 on the invite book is rendered as a refusal |
| Services | **split** — connected apps yes, consents no | `integrations/oauth/*` carries real `connectedAt`; the four consents are read by nothing (§9.5) |
| Email | **yes** | sign-off substituted at send time; the test send goes to the gateway's configured manager recipients, and the page says so |
| Notifications | **split** | email · SMS (`team/broadcast-preferences.ts:69-70,104`), low stock (`low-stock-alerts.service.ts:485-520`), orders/reports (`scheduled-tasks.service.ts:1523-1552`) are read. Push, the five categories and quiet hours are not (§9.1-2) |
| Locations | **yes** | chains and branches; `assertManagerOrOwner` enforced server-side |
| Measurement | **yes, but per-browser** | `stores/restaurantSettingsStore.ts` localStorage (§9.6) |
| Map | **yes** | `pages/distributors/command/DistributorMapPage.tsx:36` |
| Features | **yes** | 19 registry-ACTIVE flags, 2 AI + 17 redesign; `feature-flag-registry.ts` is the single source |
| POS | **split** | `/pos-hub/status/:rid` is real and its failure is rendered as failure; the connector picker reads back only to itself (§9.4) |
| Calendar | **token yes, subscription unproven** | `v3.0-TECH-DEBT.md:346-348`; the page now labels the client steps *Untested* |

### The 2026-08-26 record, kept

The Features section **was** the largest single block of dead controls in the
product. It is not there any more, and the paragraph that described it was wrong
about *why* it was dead.

**Corrected 2026-08-26 (OD-86, `OPEN-DECISIONS.md:100`).** This dossier claimed the
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
3. Consent copy describes telemetry that does not run (§5, §10). **Said out
   loud on the rebuilt page** — the four consents render without controls,
   naming `lib/uxSignals.ts:15` as the dark reporter.
4. Missing-flags-row answers with **registry defaults** (`settings.service.ts:32-33`,
   `defaultActiveFlags()` at `:137`) — still worth knowing, but no longer the "every
   capability enabled" surface this dossier described, since the gate-less flags no
   longer render as controls at all (§10).
5. `Settings.tsx:170` names three calendar clients for a feed nobody has seen
   work. **Fixed on the rebuilt page** — the steps are filed under *Untested*
   with the `Content-Disposition: attachment` suspect named; the legacy page
   still promises them.
6. **New (2026-09-02):** six notification controls and four consent controls
   persist and change nothing anywhere (§9.1-2, §9.5); nothing records who
   changed any setting (§9.3); the measurement controls look like restaurant
   settings and are per-browser (§9.6). All five are stated on the rebuilt page
   and none is stated on the legacy one.

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

**Added 2026-09-02 by the Mudavym rebuild** (each is outside the page agent's
paths, so each is filed rather than built):

8. **Add `apps/web/src/pages/settings/next` to `SCAN_ROOTS`** in
   `scripts/check_no_seeded_defaults.py:187-197`. Until then a green guard run
   says nothing about this directory (§9.7).
9. **Give the settings row a provenance.** `restaurant_feature_flags` needs
   `updated_at` and `updated_by`, and `settings.service.ts` needs to select
   them, before the page's "changed · —" line can ever say anything else. The
   actor column must reference **`public.users.user_id`, not `auth.users`** —
   the two tables are disjoint and a FK to `auth.users` 23503s on every write
   while CI cannot catch it.
10. **Decide the consent fork** (§1b, alternative 2): wire the four
    `servicePermissions` as real gates, delete them, or restore settable
    controls under a "recorded, not enforced" label. Today they are records.
11. **Push: build it or delete it.** `push_enabled` is a preference for a
    channel that does not exist (§9.1). Deleting the column is the cheap,
    honest half.
12. **Notification categories and quiet hours: wire or delete** (§9.2). Quiet
    hours in particular is the kind of promise a person plans their evening
    around.
13. **Rebuild the seven borrowed components in the Mudavym hand** —
    `InviteTeamDialog`, `AddLocationDialog`, `CreateChainDialog`,
    `AssignToChainDialog`, `EditLocationChainDialog`, `TeamLaborSettings`,
    `TeamGoalsSettings`. They are mounted as-is by the rebuilt page so no
    capability was lost; the visual seam is the cost.
14. **Prove the iCal feed against one real client** (existing item 3) — the
    rebuilt page now says it is unproven, which makes the gap visible but does
    not close it.
