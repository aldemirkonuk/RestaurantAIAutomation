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
Ten sections on the legacy page, each deep-linkable via `?tab=`; the rebuilt page
keeps all ten under their legacy names and order and appends an eleventh:
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
- **Cellar** *(rebuilt page only, `?tab=cellar`, added 2026-09-03)*: which of the
  seven drinks registers this house carries — wines, beer, whiskey, cocktails,
  spirits, non-alcoholic, soft drinks — with on/off, the inference's evidence
  beside each, and an ask when a register is switched on with nothing behind it.
  **Live**, through the cellar rebuild's own `CellarRegistersControl`
  (`pages/cellar/next/`) over `GET/PUT /cellar/:restaurantId/registers`
  (`apps/api-gateway/src/cellar/`). Mounted, not re-implemented — a second copy
  in this directory would give the product two answers to one question, and this
  page cannot read the books the inference reads

**Mudavym redesign — what the rebuilt page adds** (flag `mudavym_design_settings`,
OFF by default; with it off `Settings.tsx` renders byte-for-byte):

- **A provenance line under every setting** — where the value is kept (*this
  restaurant* · *your account* · *this browser*), **what the date is a date of**
  (changed · granted · issued · connected · last check), and when; or an em dash
  naming why no date exists — the recurring reasons enumerated once in
  `PROVENANCE_UNKNOWN` (`st-format.ts`) rather than retyped, the row-specific
  ones local and each naming the layer it blames. This is the "there should be
  more" the founder asked for: substance per setting, not more switches.
- **Eleven registers, one open at a time** — the legacy ten under their legacy
  names in their legacy order, so no bookmark moves, plus `cellar`. All still
  deep-linked by `?tab=`; the URL is now written on selection and never on
  scroll.
- **Features**: only registry-ACTIVE flags get controls, with the 17
  `mudavym_design_*` keys rendered as their own labelled *Mudavym redesign*
  group (opt-in per restaurant, off by default). `enable_ai_autonomous_send` is
  granted by hold-to-approve completing into the seal, and revoked by one plain
  button — never a toggle.
- **Settings the product stores but never reads render WITHOUT controls**,
  showing the stored value and the files that were grepped across **all four**
  runtimes: push, the five notification categories, and the four
  service-permission consents (§9, §10). **Quiet hours is NOT one of them** — the
  first pass filed it here on a three-runtime grep and was wrong; it is read by
  `services/agent-orchestrator/agents/notification_agent.py:1487-1494` and keeps
  a real switch (§9.2, §1b second pass).
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
the notification categories and the four consents turned out to be read by
nothing (§9). It also produced the pass's five errors, all of them claims of
absence that had not been checked — see *Second pass* below.

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
   destroyed within a second — and eleven registers carrying the new provenance
   line run to roughly four screens of dense text. *If the founder wants
   everything visible at once for scanning*, this comes back and `?tab=` becomes
   entry-only (read on arrival, never rewritten). **Now drawn**, at the founder's
   request, as `.planning/sketches/091-settings-directions/single-page-scroll.html`.
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
`data-ground="charcoal"`, not from eye. **Size, stated plainly:** the page runs
**2,869 lines across sixteen files** excluding its test — 2,121 of code and 536
of comment — against the ~900-line guidance in the build brief. The second pass
did the split the audit asked for (the 532-line `OtherSections.tsx` bundling six
unrelated registers is gone; every register is now its own file, the largest
being the data hook at 466 lines and `SectionKit.tsx` at 356) and shared the
repeated field styles and the save-failure paragraph, but it did **not** get the
total down: eleven registers each carrying a consequence, a provenance line and
a cited grep is what the founder's "there should be more" asked for, and the
evidence comments are load-bearing — they are what the audit checks the page
against.

### Second pass, 2026-09-03

**What the founder asked for.** No emojis anywhere; "bulletproof, profound
solutions" instead of an honest em dash wherever the gap can actually be closed;
the competitor lens (DESIGN-FOUNDATION §6) built for the "need it: now" rows; two
sketches; and — during the pass — an eleventh register for the cellar's
per-house drinks registers.

**What the audit found, and what it was really about.** Five blockers, all one
species: *the page asserting an absence it had not checked.* Four were dates the
database was holding and the wire was dropping; one removed a working control.
The em dash is the house idiom for an unknown, and this pass is the discovery
that **a claim of absence is a claim** — it carries exactly the burden of proof a
number does, and a wrong one is more expensive, because a fabricated figure looks
suspicious and a fabricated absence looks like integrity.

| # | The false claim | What is true | Where it is fixed |
|---|---|---|---|
| 1 | "No sender consults quiet hours" — control removed | `_is_quiet_hours` (`services/agent-orchestrator/agents/notification_agent.py:1487-1494`) is called by `_select_channels` (`:1448`) from four handlers (`:541`, `:637`, `:726`, `:787`) on the very `notification_preferences` row this page writes. Inside the window, anything below `critical` gets **no channel at all** — suppressed, not delayed | Live `Toggle` + window restored, `NotifySection.tsx`; consequence copy says which half honours it and which does not |
| 2 | "the chains table records no last-changed date" | `restaurant_chains.updated_at` is `NOT NULL DEFAULT now()` (`baseline:5053-5060`). The endpoint selected `id, name, cuisine_type` | **Gateway**: `getChainsForUser` selects and returns it; `renameChain` **stamps** it, because that table has no `BEFORE UPDATE` trigger and returning it unstamped would have printed a creation date under the word "changed" |
| 3 | "the branch record carries no last-changed date" | `restaurants.updated_at` exists *and* is maintained by `update_restaurants_updated_at BEFORE UPDATE` (`baseline:12300`) | **Gateway**: `getBranchesForUser` selects it on all three paths and maps it; the page reads it off the session's branch objects, which are passed through unmapped |
| 4 | "an invite records its expiry, not when it was issued" | `members.service.ts:101-107` has always returned `created_at` | `PendingInviteRow` carries it; rendered as **issued · …** |
| 5 | Sign-off "template row returns no changed-at date" | The gateway returns `updatedAt` (camelCase, `restaurant-templates.service.ts:110-121`) and there is no case-converting interceptor | `senderUpdatedAt()` reads both spellings, camelCase first |

**Gateway changes, with file:line.** All in `apps/api-gateway/src/organizations/organizations.service.ts`
(the only gateway module this page was cleared to edit besides `settings/`):
`RestaurantBranch.updated_at` and `RestaurantChain.updated_at` added to the two
interfaces; `getChainsForUser` select widened and mapped; `createChain` select
widened and mapped; `renameChain` patch gains `updated_at: new Date().toISOString()`;
`getBranchesForUser` — `mapRow` plus all three selects (organisation, legacy
`user_restaurant_access`, single-restaurant fallback). Spec:
`apps/api-gateway/src/organizations/last-changed-dates-reach-the-client.spec.ts`
— 5 tests, including one that asserts the rename stamp, because *returning the
column without stamping it* is the failure mode that looks like a fix.

**What else the pass changed.** Every "no switch" claim re-grepped across all four
runtimes with the citing file printed beside it (§9.10). `OtherSections.tsx`
(532 lines, six registers) split one file per register — the audit's DEFECT.
The POS connector no longer stamps a browser-made date into the stored blob and
reads it back as provenance (audit NIT 8): a date from the client's own clock
read back as a record is the page quoting itself. `Provenance` gained a `verb`,
so a granted date and an issued date stop being printed as "changed". Citation
`settings.controller.ts:31-32` corrected to `:33` (NIT 7).

**What stays open, and why.**
- **The Features register's em dash stays.** `restaurant_feature_flags` really has
  `created_at` and no update column (`baseline:5097-5105`, unchanged by the three
  later ALTERs). Closing it needs a migration, which this pass was not cleared to
  write (§13.9).
- ~~**The Cellar register has no switch.**~~ **Closed during this pass** — the
  cellar builder exported `CellarRegistersControl` while this one was running,
  and it is now mounted at `?tab=cellar`. Until it landed the register rendered
  with no control and a line saying why; a switch before the control existed
  would have been the exact fake toggle this page removed everywhere else.
- **Nothing records WHO changed a setting.** That is a schema gap, not a copy
  gap — see the section below for what closing it would take.
- **No live screenshot.** The local gateway on :4010 answers, but its
  dev-bypass session is `emailVerified: false` and every tenant read behind
  `EmailVerifiedGuard` returns `EMAIL_NOT_VERIFIED`; there is no local Postgres
  and no Docker on this machine. So the SQL claims here are read off the
  baseline migration and the code, not measured against a running database, and
  §9.9 is filed as a **suspected** defect for exactly that reason.

### What this page can do now, and what "more" means here

Written for the founder's *"tell me more, let me know"*. Every register, what it
changes, where the value is kept, and who may change it.

| # | Register | What changing it actually does | Where the value is kept | Who may change it | Dated? |
|---|---|---|---|---|---|
| 01 | Team | Grants or withdraws a person's access to this branch, immediately, and what they may do with it | `user_restaurant_access` (role, `is_active`) + `organization_invites` for the invite book | Owner changes roles and removes anyone; a manager may invite; staff cannot open the page | **granted** (access row's `created_at`) · **issued** (invite's `created_at`) |
| 02 | Services | Nothing, for the four consents — they persist and no code branches on them. The connected apps beside them are real OAuth links and Disconnect really disconnects | Consents: `user_preferences.preferences.servicePermissions`. Apps: the integrations store | Anyone signed in — these are yours, not the restaurant's | **connected** (per app) · consents share the preference record's date |
| 03 | Email | Replaces the name at the bottom of every outbound vendor email, substituted by the gateway at send time | `communication_templates` row of type `sender_identity` | Owner or manager | **changed** — real, kept by a database trigger |
| 04 | Notifications | Opens or closes the doors an alert may leave by, sets the low-stock digest, and holds non-critical alerts inside the quiet window | `notification_preferences`, one row per user | Anyone signed in — yours. But the senders read **every** member's together: an alert goes out if anyone wants it | **changed** — real |
| 05 | Locations | Adds a branch, renames a chain, moves a branch between chains — changes what the header switches between | `restaurants` and `restaurant_chains` | Owner creates and renames chains; manager or owner edits a branch | **changed** — real, both, as of this pass |
| 06 | Measurement | Changes how volumes are written **for you on this machine only**. Nothing about what is stored changes | `localStorage["restaurant-settings-storage"]` | Whoever is at this browser. Not shared, not synced to the phone | never — a browser keeps a value, not a history |
| 07 | Map | The frame Find distributors opens at | `user_preferences.preferences.mapDefaultScope` | Anyone signed in — yours | **changed** — the whole record's date, shared |
| 08 | Features | Turns capabilities on for **everyone at this restaurant** — including autonomous AI sending, and including this redesign | `restaurant_feature_flags`, one row per restaurant, one column per flag | Owner or manager (JWT + TenantGuard, `settings.controller.ts:33`) | never — no update column exists |
| 09 | POS | Nothing to the till. It bookmarks whose connector documentation you are reading | `user_preferences.preferences.posConfig` | Anyone signed in | the preference record's date, shared |
| 10 | Calendar | Regenerating **silently breaks every existing subscription**, with no undo | `restaurants.calendar_ical_token` | Owner or manager | never — the token has no date of its own |
| 11 | Cellar | Declares which of the seven drinks registers the house carries, which decides which registers `/cellar` draws at all. Switching one on with nothing in the books behind it is allowed and asks you to confirm | `restaurant_cellar_registers`, one row per (restaurant, register) — and **only** where a person said something; an inference is computed at read time and never stored | Owner or manager (JWT on `/cellar`) | **changed** · — the readout carries no date per answer (§13.19) |

**What "more" turned out to mean, twice.** First pass: *more substance per
setting*, not more switches — the third line under every row. Second pass: *the
third line has to be true*, which meant fixing the gateway rather than writing a
better sentence. Both are the same idea — a settings page earns trust by being
checkable — and the second is the expensive half.

**What a settings audit trail would take.** Nothing on this page records **who**
changed a setting. It is not a small gap: the Features register alone can grant an
AI the right to email a vendor with nobody reading it, and today that grant is
anonymous. What exists and what does not:

- **The table already exists and is already used.** `system_audit_log`
  (`baseline:5553-5568`) carries `actor_type`, `actor_id`, `action`,
  `entity_type`, `entity_id`, `changes jsonb`, `restaurant_id`, `reason`,
  `created_at`. Two access changes already file into it through one shared
  function — `recordAccessChange` (`apps/api-gateway/src/team/access-audit.ts:73`),
  called by `MembersService.updateMemberRole` (`restaurants/members.service.ts:196`,
  action `member_role_changed`, `changes: {role: {from, to}}`) and by
  `TeamService.deleteMember` (`team/team.service.ts:456`). So the shape is
  settled, tested and in production — **settings simply never call it.**
- **What to add, exactly.** `SettingsService.updateFeatureFlags`
  (`settings/settings.service.ts:67-106`) already reads nothing before it upserts;
  it would need a `select(ACTIVE_COLUMNS)` first to capture the before-state, then
  one `recordAccessChange`-shaped call per changed key with
  `action: "feature_flag_changed"`, `entity_type: "restaurant_feature_flag"`,
  `entity_id` the restaurant, `changes: {<key>: {from, to}}`. The same for
  `UserPreferencesService.updatePreferences` and
  `NotificationsService.updatePreferences`, which both already fetch the existing
  row and throw the before-state away.
- **`actor_id` must be `public.users.user_id`, never `auth.users`.** The two
  tables are disjoint in this database — zero shared ids — so an id taken from
  the wrong one dangles, and **CI cannot catch it**: a fresh test database has no
  rows to violate. `system_audit_log.actor_id` carries no FK at all
  (`baseline:13618` declares only `restaurant_id`), so a wrong id would simply
  never resolve and the log would look full while answering nothing.
- **Reading it back** needs one endpoint —
  `GET /settings/audit?restaurantId=&limit=` filtered to the settings actions —
  and then the row's provenance line becomes "changed · 3 days ago · by Deniz",
  which is the whole point. A per-register `?tab=…&history=1` disclosure is the
  cheapest UI: the ledger already renders that way elsewhere.
- **What it does NOT need:** a new table, a migration, or an `updated_at` column
  on `restaurant_feature_flags`. The audit row's own `created_at` is a better
  answer than a column, because it records every change rather than only the last
  one. The `updated_at` migration in §13.9 becomes optional once the log is wired.

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
  `apps/web/src/pages/settings/next/` — sixteen files, one register per file
  after the 2026-09-03 split (`OtherSections.tsx`, which bundled six of them,
  is gone).
  - Shell and shared parts: `SettingsNext.tsx` (contents, `?tab=` routing),
    `useSettingsNextData.ts` (every register, `apiClient` only, tenant-keyed,
    lazy per register), `SectionKit.tsx` (`Row` with its provenance line and its
    `verb`, `Dead`, `Register`'s four states, `ConfirmAction`, `SaveFailure`,
    `fieldStyle`), `st-format.ts` (the register vocabulary, the enumerated
    `PROVENANCE_UNKNOWN` reasons, formatting), `fonts.ts`, `MOTIONS.md`.
  - One per register: `TeamSection.tsx`, `ServicesSection.tsx`,
    `EmailSection.tsx`, `NotifySection.tsx`, `LocationsSection.tsx`,
    `MeasurementSection.tsx`, `MapSection.tsx`, `FeaturesSection.tsx`,
    `PosSection.tsx`, `CalendarSection.tsx`, `CellarSection.tsx`.
  - `SettingsNext.test.tsx` (22 tests).
  - Mounted from elsewhere, not re-implemented: the seven legacy dialogs above,
    and `pages/cellar/next/CellarRegistersControl` for `?tab=cellar`.
- **Gateway, changed by this page's second pass**:
  `apps/api-gateway/src/organizations/organizations.service.ts` (chain and branch
  `updated_at` on the wire; `renameChain` stamps it) with
  `organizations/last-changed-dates-reach-the-client.spec.ts` (5 tests).

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
- `?tab=cellar` exists **only** on the rebuilt page. On the legacy page an
  unrecognised `?tab=` falls back to `team`, so the link degrades rather than
  breaking, and nothing outside this page links to it yet.

## 9. Gaps

- Raw-`fetch`-with-manual-token pattern (§4) bypasses `apiClient` interceptors —
  same inconsistency as dashboard.md §9.
- Phase 30 iCal: "no external calendar client has ever confirmed the feed
  subscribes" (`v3.0-TECH-DEBT.md:346-348`) — the copy at `Settings.tsx:170`
  promises Outlook/Apple/Google regardless.
- ServicesPermissions describes telemetry ("find the screens that slow people
  down") that does not run (§5) — consent UI ahead of the capability.

**Measured 2026-09-02 during the Mudavym rebuild, corrected 2026-09-03.** The
2026-09-02 pass grepped three runtimes — `apps/api-gateway/src`, `apps/web/src`,
`apps/mobile/src` — and omitted `services/agent-orchestrator`, which is where the
alerting agent lives. That omission produced one false "nothing reads this"
(item 2 below, now struck). **Everything here has been re-grepped across all four
runtimes on 2026-09-03**, and the per-key result is §9.10.

1. **Push is not delivered at all.** `push_enabled` persists
   (`notifications.service.ts:1142`) and nothing anywhere sends a push: the
   recipient resolver has no push path, the store it used
   (`push_subscriptions`) does not exist in production, and the obvious repoint
   target has a writer that cannot be planned (42P10). Evidence, in one place:
   `apps/api-gateway/src/communications/push-is-not-resolved-here.spec.ts`.
   The rebuilt page renders Push **without a control**.
2. ~~**Notification categories and quiet hours are written and never read.**~~
   **Half wrong, corrected 2026-09-03.** The five **categories** are write-only:
   written at `notifications.service.ts:1144-1145`, and nothing in any of the
   four runtimes branches on them (`getEffectiveCategoryMode` reads
   `orders_mode` / `reports_mode` only, `scheduled-tasks.service.ts:1528`;
   `getEffectiveLowStockPrefs` reads the five low-stock columns,
   `low-stock-alerts.service.ts:505,515`). **Quiet hours is live**:
   `services/agent-orchestrator/agents/notification_agent.py:1487-1494`
   (`_is_quiet_hours`) is called by `_select_channels` (`:1448`) on the row this
   page writes, loaded by `_get_notification_preferences` (`:1580-1591`,
   `select("*")` on `notification_preferences`), reached from four handlers
   (`:541`, `:637`, `:726`, `:787`). Inside the window and below `critical`,
   `_select_channels` returns `[]` — the alert is **suppressed**, not delayed.
   The control was restored on 2026-09-03; it was removed for one day on a
   three-runtime grep.
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
7. ~~**The seeded-defaults guard does not scan the rebuilt directory.**~~
   **Closed 2026-09-03** — `scripts/check_no_seeded_defaults.py:203` now carries
   `Path("apps/web/src/pages/settings/next")`, added by the parent session. The
   real guard run covers this directory: `PASS — 124 web file(s) and 13 gateway
   file(s) across 19 root(s)`.

**Added 2026-09-03 by the second pass:**

8. **Four "no last-changed date" lines were false, and three were gateway
   defects.** Chains, branches, the invite issue date and the email sign-off all
   had dates the page was not being handed, or was reading under the wrong
   spelling. Fixed at source; the table in §1b *Second pass* is the full account.
   The load-bearing lesson is filed there too: a claim of ABSENCE carries the same
   burden of proof as a number.
9. **SUSPECTED DEFECT — the team roster may be empty for everyone, and the page cannot
   tell.** `MembersService.getMembers` orders by `granted_at`
   (`apps/api-gateway/src/restaurants/members.service.ts:73`) on
   `user_restaurant_access`, and that table has no such column — the baseline
   declares `id, user_id, restaurant_id, role, created_at, is_active, valid_from,
   valid_until, invited_via, deactivated_at, deactivated_by`
   (`baseline_from_production.sql:5810-5822`), and no later migration adds one;
   the single `granted_at` in the whole baseline is `user_roles.granted_at`
   (`:5834`). PostgREST answers an unknown `order=` column with a 42703 error,
   and `getMembers` logs it and **returns `[]`** (`:75-80`) — so a failed read and
   an empty branch arrive at the client identically. **NOT MEASURED**: the local
   gateway's dev-bypass session is `emailVerified: false` and every tenant read is
   behind `EmailVerifiedGuard`, and there is no local Postgres on this machine, so
   this is read off the schema and the code and not off a running database. The
   rebuilt page does not paper over it — an empty roster now says both
   possibilities out loud. Fix in §13.18; it is outside this page's paths.
10. **The per-key grep, 2026-09-03, across all four runtimes.** Every key this
    page renders without a control, with the file that proves it:

    | Key | Reader found? | Citing file |
    |---|---|---|
    | `quiet_hours_enabled` / `_start` / `_end` | **YES — control restored** | `services/agent-orchestrator/agents/notification_agent.py:1487-1494`, via `_select_channels:1448` |
    | `push_enabled` | no — 3 writers, 0 readers | writers `notifications.service.ts:189,1142,1193`; the channel chooser reads urgency + `<type>_channels` (`notification_agent.py:1435-1470`); the one other hit `core/database.py:1967` copies a `restaurants.push_enabled` onto an object nothing reads |
    | `categories.inventory` | no | written `notifications.service.ts:1144-1145`; no branch anywhere |
    | `categories.orders` | no | as above (`orders_mode` is a different column and IS read) |
    | `categories.calendar` | no | as above |
    | `categories.system` | no | as above |
    | `categories.ai` | no | as above |
    | `servicePermissions.email` | no | writers only: `components/settings/ServicesPermissions.tsx:148`, `apps/mobile/src/guidance/GuidanceProvider.tsx:314`; re-exposed at `:334`, consumed by nobody |
    | `servicePermissions.web` | no | as above |
    | `servicePermissions.privacy_analytics` | no | as above, plus `lib/uxSignals.ts:15,64,87,125` is env-gated and its only importer `hooks/useUxOverrides.ts:19` has zero call sites |
    | `servicePermissions.privacy_sharing` | no | as above |

    Zero hits for any of these in `apps/api-gateway/src` beyond the write paths
    named, and zero in `services/agent-orchestrator` except the quiet-hours row.
11. **There are TWO quiet-hours stores, and this page writes the live one.**
    `manager_preferences.quiet_hours_start/end` (`baseline:3696-3697`) is a second
    store, read by `ManagerPreferencesRepository.is_quiet_hours`
    (`core/database.py:1410-1428`) — which has **no callers**. Worth knowing before
    anyone "fixes" quiet hours by wiring the dead one (§13.17).

## 10. Maturity

**partial** — moved from **hollow** on 2026-09-02 by the Mudavym rebuild
(`mudavym_design_settings`).

**What moved it, and to what.** "Hollow" was earned by the 22-switch era, and it
was still the right word while the page's honest content lived only in this
dossier — three corrections nobody standing on `/settings` could see. It is no
longer right: **seven of the eleven registers are live end to end** (team, email,
locations, measurement, map, features, cellar) and the four that are split
(services, notifications, POS, calendar) now say **on the page** exactly which
half is not, each naming the file that was grepped. It is `partial` and not
`complete` because three surfaces are still consent ahead of capability (push,
the five notification categories, the four service permissions), the iCal feed
is still unproven against any client, and no setting on the page records an
author.

**Corrected 2026-09-03**: the 2026-09-02 version of this paragraph counted quiet
hours among the dead surfaces. It is live (§9.2). It also said "seven of ten"
before the eleventh register existed — the count is coincidentally the same and
the denominator is not.

| Register | Live? | Evidence |
|---|---|---|
| Team | **yes** | members/invites/roles/removal, all through `apiClient`; a 403 on the invite book is rendered as a refusal |
| Services | **split** — connected apps yes, consents no | `integrations/oauth/*` carries real `connectedAt`; the four consents are read by nothing (§9.5) |
| Email | **yes** | sign-off substituted at send time; the test send goes to the gateway's configured manager recipients, and the page says so |
| Notifications | **split** | email · SMS (`team/broadcast-preferences.ts:69-70,104`), low stock (`low-stock-alerts.service.ts:505,515`), orders/reports (`scheduled-tasks.service.ts:1528`) **and quiet hours** (`notification_agent.py:1487-1494`) are read. Push and the five categories are not (§9.1-2, §9.10) |
| Locations | **yes** | chains and branches; `assertManagerOrOwner` enforced server-side; both now carry a real last-changed date (§1b second pass) |
| Measurement | **yes, but per-browser** | `stores/restaurantSettingsStore.ts` localStorage (§9.6) |
| Map | **yes** | `pages/distributors/command/DistributorMapPage.tsx:36` |
| Features | **yes** | 19 registry-ACTIVE flags, 2 AI + 17 redesign; `feature-flag-registry.ts` is the single source |
| POS | **split** | `/pos-hub/status/:rid` is real and its failure is rendered as failure; the connector picker reads back only to itself (§9.4) |
| Calendar | **token yes, subscription unproven** | `v3.0-TECH-DEBT.md:346-348`; the page now labels the client steps *Untested* |
| Cellar | **yes** | `pages/cellar/next/CellarRegistersControl` mounted over `GET/PUT /cellar/:restaurantId/registers` (`apps/api-gateway/src/cellar/`); a failed readout renders as words, not as seven registers switched off |

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
| GET/PUT | `/settings/feature-flags` | JWT + **TenantGuard** (`settings/settings.controller.ts:33`) | `settings.service.ts:38-106` | Exactly the registry-ACTIVE keys — 19 today, 2 AI + 17 `mudavym_design_*` (`feature-flag-registry.ts`); a missing row answers with the registry's own defaults (`defaultActiveFlags()`, `:136-144`), all of the redesign flags `false` |
| GET/POST | `/calendar/ical-token`, `…/regenerate` | JWT | `calendar.controller.ts:609-637` | 64-char token + feed path |
| GET | `/restaurants/:rid/members`, `…/invites` | JWT | `restaurants` module | Roster, pending invites |
| PATCH/DELETE | `/restaurants/:rid/members/:userId` | JWT | `restaurants` module | Role change / removal |
| DELETE | `/restaurants/:rid/invites/:code` | JWT | `restaurants` module | Revoked invite |
| GET/PATCH/DELETE | `/organizations/chains`, `…/chains/:id` | JWT (class, `organizations.controller.ts:33`) | `organizations.service.ts` | Chains; `assertManagerOrOwner` on the write paths. Returns `updated_at` as of 2026-09-03, and `renameChain` stamps it (§1b second pass) |
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
6. **New (2026-09-02, corrected 2026-09-03):** six notification controls and four
   consent controls persist and change nothing anywhere — **five, not six**: the
   sixth was quiet hours, which is read (§9.2, §9.10). Nothing records who changed
   any setting (§9.3); the measurement controls look like restaurant settings and
   are per-browser (§9.6). All are stated on the rebuilt page and none is stated
   on the legacy one.
7. **New (2026-09-03):** an empty team roster and a failed roster read are
   indistinguishable at the client (§9.9). The legacy page renders both as an
   empty list with no comment; the rebuilt page says both possibilities.

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

8. ~~**Add `apps/web/src/pages/settings/next` to `SCAN_ROOTS`.**~~ **Done
   2026-09-03** — `scripts/check_no_seeded_defaults.py:203`.
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
12. **Notification categories: wire or delete** (§9.2, §9.10). Five switches that
    record themselves. *Quiet hours has been removed from this item — it is read
    and it works.*
13. **Rebuild the seven borrowed components in the Mudavym hand** —
    `InviteTeamDialog`, `AddLocationDialog`, `CreateChainDialog`,
    `AssignToChainDialog`, `EditLocationChainDialog`, `TeamLaborSettings`,
    `TeamGoalsSettings`. They are mounted as-is by the rebuilt page so no
    capability was lost; the visual seam is the cost.
14. **Prove the iCal feed against one real client** (existing item 3) — the
    rebuilt page now says it is unproven, which makes the gap visible but does
    not close it.

**Added 2026-09-03 by the second pass** (each is outside the paths this pass was
cleared to edit, so each is filed rather than built):

15. ~~**Return `updated_at` from `/organizations/chains` and the branch list.**~~
    **Done 2026-09-03** — `organizations.service.ts` (`getChainsForUser`,
    `createChain`, `getBranchesForUser` on all three paths), with `renameChain`
    stamping the column because `restaurant_chains` has no `BEFORE UPDATE`
    trigger. Spec: `organizations/last-changed-dates-reach-the-client.spec.ts`.
16. **Wire the settings audit trail.** `system_audit_log` and the
    `recordAccessChange` shape already exist and are already used by two access
    changes; `SettingsService.updateFeatureFlags`,
    `UserPreferencesService.updatePreferences` and
    `NotificationsService.updatePreferences` never call them. The full recipe —
    which endpoint, which before-state to capture, and why `actor_id` must be
    `public.users.user_id` — is in §1b, *What this page can do now*. This is the
    single highest-value item on this list: today the grant of autonomous AI
    sending is anonymous.
17. **Decide which quiet-hours store is canonical.** There are two:
    `notification_preferences` (this page writes it; the alerting agent reads it)
    and `manager_preferences.quiet_hours_start/end` (`baseline:3696-3697`, read
    only by a method with no callers). Delete the dead one or the next person
    fixes the wrong one (§9.11).
18. **SUSPECTED, and worth an hour: `MembersService.getMembers` orders by a
    column that does not exist** (`restaurants/members.service.ts:73`,
    `granted_at` on `user_restaurant_access`). If PostgREST rejects it, the Team
    register is empty for every tenant and has been logging it quietly. Change the
    order to `created_at` and check the log. Not measured here — no local database
    and the dev-bypass session cannot pass `EmailVerifiedGuard` (§9.9).
19. ~~**Mount the cellar registers control.**~~ **Done 2026-09-03** —
    `CellarSection.tsx` mounts `pages/cellar/next/CellarRegistersControl` and
    calls the cellar's own `useCellarRegisters`, so the fetch happens only when
    `?tab=cellar` is open. **Open beneath it:** the readout carries no date per
    answer (`RegisterReadoutVM` has `decidedBy`/`confidence`/`basis` and no
    `confirmed_at`), so this register's provenance line is an em dash naming
    that. One field on the gateway's readout closes it.
20. **Blast radius on the Features register** (DESIGN-FOUNDATION §6, "need it:
    now"): each flag should say what it changes *in numbers* — "3 rules fire on
    this", "42 items use this unit". The page says the consequence in prose today
    because no endpoint counts the dependents; that count is the work.
21. **A Vendor-terms register** (DESIGN-FOUNDATION §6, "need it: now" — vendor
    terms "have no home at all"): order cutoffs, delivery days, minimums and pack
    sizes, each field carrying *stated · inferred from N orders · em dash*. Drawn
    as `.planning/sketches/091-settings-directions/vendor-terms.html`. It unblocks
    the calendar idea (cutoffs as closing times) and the notification idea. Needs
    a table and an endpoint; nothing of it exists today.
22. **Approval thresholds** (DESIGN-FOUNDATION §6, *later*): who may seal what,
    above what amount, for which vendor. Blocked on tenancy — production has one
    real tenant and no `staff` role — and recorded as blocked rather than
    attempted. Sketched alongside the vendor terms so the shape is on paper.
