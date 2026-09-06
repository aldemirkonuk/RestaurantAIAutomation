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

**With `mudavym_design_connections` ON (the collapse, 2026-09-04)** — four registers
leave, one line replaces them, and the four `?tab=` links keep working by redirect:

- **Connections — what acts for this house** (contents column) → [[connections]] `/connections`
- `?tab=services` → [[connections]] `/connections#grants`
- `?tab=pos` → [[connections]] `/connections#till`
- `?tab=email` → [[connections]] `/connections#sender`
- `?tab=calendar` → [[connections]] `/connections#feed`

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
keeps all ten under their legacy names and appends four more (`cellar`
2026-09-03, then `vendor-terms`, `thresholds` and `ledger` on the fourth pass of
the same day).

> **Fourteen, or ten plus one line out (the collapse, 2026-09-04).** With
> `mudavym_design_connections` on, **Services, Email, POS and Calendar leave this page**
> — all four are connections, and ADR 0114 justified `/connections` on a surface count
> that had to fall. Ten registers remain and one line points out
> (`st-format.ts`: `COLLAPSED_SECTIONS`, `sectionsFor`, `groupsFor`). Their ids stay in
> `SECTION_IDS` on purpose, so `?tab=pos` is RECOGNISED and redirected rather than
> falling through `isSectionId` and quietly opening Team. With the flag off, all
> fourteen render exactly as below.

- **Team**: members and invites — change roles, remove members, revoke invites, invite dialog; labor & goals settings
- **Services**: service permissions / access grants (email, web, privacy)
- **Email**: sender identity settings
- **Notifications**: channel and batching preferences
- **Locations**: multi-location chains — create, assign, edit
- **Measurement**: units
- **Map**: storage map
- **Features**: per-restaurant feature flags — owner/manager only to write, since 2026-09-05
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

- **Vendor terms** *(rebuilt page only, `?tab=vendor-terms`, added 2026-09-03)*:
  per vendor — order cutoff (time **and** how many days before delivery),
  delivery weekdays, minimum order, lead time, payment terms — each field
  carrying its own PROVENANCE: *stated by the house* (with the name of whoever
  wrote it down and when), *on the vendor record* (with the column named),
  *inferred* (with the receipt count and a confidence), or an em dash with the
  reason. **Live**, over `GET /vendor-terms` and `PUT /vendor-terms/:providerId`
  (`apps/api-gateway/src/vendor-terms/`), written into
  `restaurant_vendor_terms` (migration `20260903140000`). **The provider form
  writes the delivery days here** since 2026-09-04 (ADR 0116) — they used to go
  into `providers.regions_covered`, the geography column. Two of the five terms
  are stated as BOUNDS rather than values, because that is all this house's own
  orders can support: the cutoff is a bracket (*after 13:40, before 15:10*) and
  the minimum is an upper bound (*they have accepted as little as X*)
- **Approval thresholds** *(rebuilt page only, `?tab=thresholds`, added
  2026-09-03)*: three rules — a manager's ceiling by amount, the first order to a
  vendor, and a price above what the house last paid — each with who set it and
  when, and each showing **how often it would have fired** over this
  restaurant's own orders in the last 365 days — which is what makes a number
  chooseable rather than guessed. **ENFORCED since 2026-09-04 (ADR 0116)**:
  `ProcurementService.assertApprovalAllowed` reads these rows, the order and the
  actor's role before any seal and refuses with the rule and the number in
  words; the refused order parks in `APPROVAL_NEEDED` and the refusal files as
  `order_approval_refused`. The register's first sentence is rendered from
  `enforcement.enforcedBy`, which is MEASURED — it said "nothing stops an order
  yet" for two passes and needed no edit when the gate landed.
  **Writing a rule is owner-or-manager only**, refused server-side
  (`assertCanManageRestaurant`); the editor is disabled for anyone else with the
  reason in words and the number still legible. `GET/PUT
  /settings/approval-thresholds`
  (`apps/api-gateway/src/settings/approval-thresholds.service.ts`), table
  `restaurant_approval_thresholds`
- **What changed here** *(rebuilt page only, `?tab=ledger`, added 2026-09-03)*:
  every settings change on this restaurant, who made it, and the before-and-after
  per field. Read-only — there is no write route and no delete route, because a
  log the person who made the change can edit is not a log. `GET /settings-audit`
  (`apps/api-gateway/src/settings-audit/`) over the existing
  `public.system_audit_log`; **no new table and no migration**. Covers the three
  registers whose writes go through the modules this pass owns (Features, Vendor
  terms, Approval thresholds) plus the two team-access actions that already
  filed; the footer names the other eight so their silence cannot be misread

**Mudavym redesign — what the rebuilt page adds** (flag `mudavym_design_settings`,
OFF by default; with it off `Settings.tsx` renders byte-for-byte):

- **A provenance line under every setting** — where the value is kept (*this
  restaurant* · *your account* · *this browser*), **what the date is a date of**
  (changed · granted · issued · connected · last check), and when; or an em dash
  naming why no date exists — the recurring reasons enumerated once in
  `PROVENANCE_UNKNOWN` (`st-format.ts`) rather than retyped, the row-specific
  ones local and each naming the layer it blames. This is the "there should be
  more" the founder asked for: substance per setting, not more switches.
- **Fourteen registers, one open at a time** — every legacy `?tab=` id kept, so
  no bookmark moves. The URL is written on selection and never on scroll.
- **The side tab bar reads in five groups** (fourth pass): *The house* ·
  *How it buys* · *What it does on its own* · *Yours* · *The record*, each with
  a one-line signpost, one line per register, and a seal rule down the open one.
  Grouped by what a person came to DO rather than by where the value is kept —
  the standard both references converged on (Linear's redesigned settings group
  into Account / Features / Administration / Your teams,
  <https://linear.app/changelog/2024-12-18-personalized-sidebar>; Stripe's 2023
  Dashboard navigation added grouped sections plus pinned and recent shortcuts,
  <https://support.stripe.com/questions/dashboard-update-may-2024>). Nothing is
  hidden behind a "More": a settings section that is collapsed is a settings
  section that goes unread. The per-item storage line moved to the group heading
  and to the open register's own subtitle, which is what made fourteen rows read
  as cleanly as eleven did. Membership and order are declared once, on each
  `SectionSpec`'s `group`/`order`, and `GROUPS` is derived from them.
- **Features**: only registry-ACTIVE flags get controls, with the 19
  `mudavym_design_*` keys rendered as their own labelled *Mudavym redesign*
  group (opt-in per restaurant, off by default). `enable_house_inbox_read` has
  its own row from 2026-09-05, and every control on the register is disabled
  with the reason for anyone who is not an owner or a manager, because the route
  refuses them (§9.18). `enable_ai_autonomous_send` is
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
- **Currency (register 05, group "The house")** — the money this house reports
  in, with the code or "currency not recorded", the country's default OFFERED
  and stated in words before Record writes it, the date it was last *stated*
  (from the audit trail, never `restaurants.updated_at`), and a select disabled
  for anyone who is not a manager or owner. `PUT /settings/currency` is gated by
  `assertCanManageRestaurant` and validates `^[A-Z]{3}$` — exactly what
  `restaurants_currency_check` allows. The same field is on the legacy page
  (`ReportingCurrencySection`, `pages/Settings.tsx`), because the rebuild is
  behind a flag and a house without it must still be able to answer.
- **Carrying cost (register 06, group "The house", 2026-09-06)** — what a month of
  holding stock costs this house, as a PERCENT of the goods' value, with the number or
  "no saving is shown anywhere", the date it was typed and by whom (from the column
  itself, which carries its own moment by CHECK, never `restaurants.updated_at`), an
  optional free-text basis in the person's own words, and a field disabled for anyone
  who is not a manager or owner. `PUT /settings/carrying-cost` is gated by
  `assertCanManageRestaurant` and validates `>= 0.01` and `<= 25` percent a month —
  exactly what `restaurants_carrying_cost_is_a_plausible_percent` allows. **Those bounds
  are a units check**: `0.0075` (the fraction spelling, which would understate the cost
  by a hundred and make every commodity alert look profitable) and `75` (a percent a
  year) are both refused with a sentence naming the spelling the field wants, in the
  page AND in the gateway. **Why it is asked at all**: the founder, 2026-09-05 batch 59,
  answering the commodity plan's Q5 — *"Twice a year, and the house types its carrying
  cost."* Measured over 440 recorded FAO months, a commodity alert's whole gain is spent
  by a carrying cost of about one percent a month, so until this is typed the alert says
  its saving is UNMEASURED rather than pricing a stock-up off a figure nobody chose. No
  legacy equivalent: this register exists only on the rebuilt page.
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

**The fourth pass added THREE registers and ZERO motions** — the table above is
unchanged. Nothing marks a recorded term (a stated term and an inferred one are
different *kinds* of thing, not one of them arriving); the threshold banner does
not animate (a standing fact about the system is not an event, and animating it
would make it easy to dismiss); the settings record does not stream (a snapshot
that slid in would imply a live feed); and the sticky contents column has no
transition of its own, `position: sticky` being layout rather than motion. Full
reasoning in `MOTIONS.md`.

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
`data-ground="charcoal"`, not from eye. **Size, stated plainly:** at the end of the second pass the page ran **2,880
lines across sixteen files** excluding its test. **After the fourth pass it runs
4,538 lines across nineteen files** — 3,788 of code and 750 of comment, `wc -l`
and a comment-classifying count agreeing to the line — plus a 743-line test,
against the ~900-line guidance in the build brief. The three registers account for
the whole 1,658-line growth: 1,236 in their own three files
(`VendorTermsSection.tsx` 622, `ThresholdsSection.tsx` 369,
`LedgerSection.tsx` 245) and 422 across the three shared ones they extend
(`st-format.ts`, `useSettingsNextData.ts`, `SettingsNext.tsx`). The largest file
on the page is still the shared data hook at 643. The second pass
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
| 1 | "No sender consults quiet hours" — control removed | `_is_quiet_hours` (`services/agent-orchestrator/agents/notification_agent.py:1487-1494`) is called by `_select_channels` (`:1448`) from its three call sites — `:545` low stock, `:727` negotiation complete, `:788` delivery confirmation — on the very `notification_preferences` row this page writes. Inside the window, anything below `critical` gets **no channel at all** — suppressed, not delayed | Live `Toggle` + window restored, `NotifySection.tsx`; consequence copy says which half honours it and which does not |
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

### Sixth pass, 2026-09-04 — the collapse: four connection tabs become one line

**The founder's call, verbatim:** *"Move the registers and collapse the four tabs."*
ADR 0114 rejected "a settings section rather than a route" but recorded that the
alternative *"genuinely wins on surface count if the four tabs collapse into it"*, and
left the obligation standing. Until this pass the product had a new route **and**
fourteen tabs — the count had gone up.

**Measured, before and after.**

| | flag off | flag on |
|---|---|---|
| Registers in the contents column | **14** | **10**, plus one line out |
| Opening line | "Fourteen registers — ten kept for this restaurant, three on your account, one in this browser." | "Ten registers — seven kept for this restaurant, two on your account, one in this browser." |
| `?tab=services\|pos\|email\|calendar` | opens that register here | `307` to `/connections#grants\|#till\|#sender\|#feed` |
| Buttons in `nav[aria-label="Settings registers"]` | 14 | 10 |

**Where each of the four went, and why that anchor.** `pos` → `#till`, `email` →
`#sender`, `calendar` → `#feed`, and `services` → **`#grants`** rather than Register I:
the Services tab was the OAuth catalogue — *"which apps YOU have connected"* — and
`/connections` Register III is "Personal grants that act inside this house", which is
where those live. The anchors are declared on the page that owns the elements
(`connections/next/ConnectionsNext.tsx`, `REGISTER_ANCHORS`) and mapped here
(`st-format.ts`, `CONNECTIONS_ANCHOR`); a fragment nothing answers to is a link that
silently does nothing, and one test asserts every anchor exists in the rendered DOM.

**The ids do not leave `SECTION_IDS`.** Dropping them would make `?tab=pos` an
*unrecognised* parameter, and an unrecognised parameter opens Team — a bookmark quietly
changing what it opens, which is worse than one that breaks loudly. They stay in the id
set so `isSectionId` still recognises them and `isCollapsedSection` can redirect them.

**One line, not a fifteenth register.** It is drawn under an "Elsewhere" heading with no
number, because the numbers count what this page opens *in place* and this leaves the
page. Drawing it as a register would say the till is configured here; it is not — it is
configured on a surface that is **manager-and-owner only**, while this page admits staff
to nothing at all, and the line says so before the click rather than letting the
destination refuse.

**The tally sentence now drops a clause that reaches zero** rather than printing "none
on your account" (`keptTally(connectionsOn)`), because a zero clause reads as a finding
and the true statement is silence.

**Proof.** `vitest run src/pages/settings/next` — **49 passed** (43 pre-existing,
unmodified and green with the flag OFF, which is the proof that nothing in production
changes; 6 new with it ON, including one that asserts all fourteen tabs and no line out
when the route does not exist). `tsc --noEmit` clean for this directory; eslint
`--quiet` clean; emoji grep over `pages/settings/next`: empty.

**What is NOT done here.** The four registers' *code* (`ServicesSection`, `PosSection`,
`EmailSection`, `CalendarSection`) stays in this directory and still renders when the
flag is off — it is a flag-conditional collapse, not a deletion. Deleting them is
gated on the flag reaching production, and is filed in §13.

### Fifth pass, 2026-09-04 — the decisions take effect (ADR 0116)

**What the founder decided**, in session on 2026-09-03, three calls:

1. **Thresholds: enforce.** *"only certain high tier like manager or owner can
   adjust it, do option 1"* — an order above the house's threshold cannot be
   sealed by a role below the rule; it waits for the named approver, in words on
   the order; and only owner or manager may write or change a threshold.
2. **Drop all three column defaults** and migrate existing rows to null. An
   unset value reads as unknown everywhere.
3. **Delivery days: repoint at vendor terms.**

**What was built.** §13.23, §13.25 and §13.26 carry the file-level account; this
is what changed on THIS page.

| Register | Before | After |
|---|---|---|
| 13 Approval thresholds | opened with *"Nothing stops an order yet"*, rendered from `enforcement.enforcedBy` being empty | opens with *"Enforced"* and the path that enforces it — **from the same array**, so removing the gate puts the old sentence back |
| 13 Approval thresholds | any signed-in person could write a rule | **owner or manager**, refused server-side; the editor is disabled for anyone else with the reason in words |
| 12 Vendor terms | had no writer outside this page | the provider form writes `deliveryWeekdays` into it |
| 12 Vendor terms | a `7` or a `Net 30` on a vendor record was reported UNKNOWN, because it could not be told from the column default | reported as a **term** — the defaults are gone and every row that carried one is NULL |

**The one thing worth reading twice.** The enforcement banner was written in the
fourth pass to render from a MEASURED array rather than from a hard-coded
string — *"the day something reads these rows, that array is what changes"*. That
day arrived and the page needed no edit at all. That is the whole argument for
rendering claims from measurements: the page told the truth before the gate
existed and tells the truth after it, and neither sentence was ever authored for
the state it describes.

**A measured correction to my own first attempt, worth recording because the
first version of the test was the plausible wrong one.** The threshold editor is
disabled for anyone who is not owner or manager. The obvious test — set the
fixture to `role: 'staff'` and assert the disabled control — **fails**, and
finding out why is the point: `SettingsNext.tsx:142` sends staff to *"Ask a
manager"* and renders no register at all, so a staff fixture tests the page gate
above this control and proves nothing about it. The state that actually reaches
the disabled editor is `role: null` — a person whose role could not be
RESOLVED, which `AuthContext` produces both when `/auth/me/role` fails and when
the person has no access row. That is also the case that matters: a role nobody
could read must not be able to raise a ceiling. Both are now pinned, the second
explicitly so the first cannot be misread as "staff see a disabled editor".

**Corrected here, because this page asserted it.** §9.12 named
`payment-due.template.ts:108` as the route by which a fabricated `Net 30`
reached a vendor's inbox. Measured on 2026-09-04: the field was already emitted
only when truthy, so an absent term always printed nothing — and **nothing calls
the mailer**, the cron having been deleted
(`scheduled-tasks.service.ts:596-619`). The migration is still right; the
argument for it was overstated by one link, and that link is now pinned in
`payment-terms-are-not-fabricated.spec.ts` so nobody rebuilds it by accident.

### Fourth pass, 2026-09-03

**What the founder asked for, verbatim:** *"Keep tab bar (side), look clean. The
more Vendor terms, thresholds, audit trail -> this looks super detailed and I
like it a lot, the more insights functionality the better, we could actually put
these type of detailed 'more's into other pages like /teams design and
configuration."* So: build the three registers sketch 091 drew, for real; keep
the side tab bar and make it read clean; and carry the shape to `/team` (written
up, not built — `06-pages/team.md` §13.7).

**What was built.** Three registers, one gateway module each in spirit, one
migration, no new page.

| register | route | table | endpoint |
|---|---|---|---|
| Vendor terms | `?tab=vendor-terms` | `restaurant_vendor_terms` (new) | `GET /vendor-terms`, `PUT /vendor-terms/:providerId` |
| Approval thresholds | `?tab=thresholds` | `restaurant_approval_thresholds` (new) | `GET/PUT /settings/approval-thresholds` |
| What changed here | `?tab=ledger` | `public.system_audit_log` (**existing**) | `GET /settings-audit` |

Neither new module is registered in `app.module.ts`: `SettingsModule` imports
`VendorTermsModule` and `SettingsAuditModule`, following
`McpConnectionsModule`'s import of `McpRuntimeModule`
(`mcp-connections/mcp-connections.module.ts:23`), so their controllers mount
under the entry `AppModule` already has for settings and **no shared file
changed**. `check_gateway_boots.sh` PASS.

**The finding this pass exists for: a column default is an answer nobody gave.**
Three columns in this product assert facts about the world by default:

| column | default | citation | what it asserts about every row |
|---|---|---|---|
| `providers.lead_time_days` | `7` | `baseline:4864` | every vendor delivers in a week |
| `providers.payment_terms` | `'Net 30'` | `baseline:4897` | every vendor is on Net 30 |
| `restaurants.timezone` | `'America/Los_Angeles'` | `baseline:3575` | every house is in California |

None of them can distinguish "the house was told this" from "nobody has ever
been asked", and the second reading is far more likely. `payment_terms` is
already printed into outbound vendor mail
(`communications/email-templates/payment-due.template.ts:108`). This is
[[absence-reported-as-health]] living inside a `DEFAULT` clause — the absence of
an answer, stored as an answer, by the schema itself.

The register's rule: **a value indistinguishable from its column default, with
no per-tenant override and no stated row, renders as UNKNOWN with the reason
naming the default** (`vendor-terms.service.ts` — `leadTimeCell`,
`paymentCell`). The per-tenant overrides `restaurant_providers.custom_lead_time_days`
and `custom_minimum_order` (`baseline:5154-5155`) carry no defaults, so any value
on them is always somebody's answer and is preferred. The timezone is used and
FLAGGED rather than refused, because refusing to compute a weekday helps nobody:
the register prints "read in America/Los_Angeles, which is also that column's
default value" above the table. **The defaults themselves were NOT dropped** —
that is a production ALTER with live readers, filed as §13.26.

**The second finding: the delivery-days checkbox writes into the geography
column.** `AddProviderModal.tsx:820` collects delivery weekdays;
`pages/Providers.tsx:458` sends them as `statesOrRegionsServed`;
`services/api/providers.ts:162-163` maps that to `regionsCovered`; the gateway
writes `providers.regions_covered` (`providers.service.ts:199`). Its sibling
field `deliverySchedule` (`Providers.tsx:458`) is declared on the web DTO
(`services/api/providers.ts:88`) and never reaches `buildProviderPayload`'s
output at all (`:140-177`) — dropped on the floor. So today, ticking "Monday,
Wednesday, Friday" has exactly one persisted effect: three weekday names join the
list of regions the vendor covers. Filed as §13.25; this register gives the
field a home that says what it is.

**Inference is a claim about evidence, never a value.**
`vendor-terms/term-inference.ts` is pure and separately tested (21 tests), and
each of the five fields returns what the ledger can actually support:

- **delivery weekdays** — the days receipts landed on; the rule is stated in the
  file (rank by count, take until 80% coverage, drop any day with fewer than two
  receipts) so it can be argued with rather than trusted. Says whether the sample
  is signed arrivals or only promised dates.
- **lead time** — median AND p90 in whole local days. A p90 more than three days
  past the median drops confidence to `low`, because that is two behaviours
  averaged, not a lead time. A row dated as arriving before it was placed is
  **dropped, not clamped to zero** — clamping pulls the median down with a number
  that describes nothing.
- **order cutoff** — a BRACKET and never a time. A house's own placement times
  say nothing about a vendor's cutoff on their own; what carries information is
  pairing a placement time with the turnaround it got, so the latest placement
  that still achieved the vendor's best turnaround is a FLOOR and the earliest
  that did not is a CEILING. When nothing has ever missed, the answer is "a floor
  with no ceiling" at `low` confidence. Choco stores a cutoff **per delivery
  day** (<https://help.choco.com/en/articles/6572290-view-and-edit-the-information-of-your-supplier>
  lists "Order Cut Off Times for each delivery day"), which these rows cannot
  split at all — said plainly rather than modelled away.
- **minimum order** — an UPPER BOUND, always. Every row in the ledger is an order
  the vendor accepted; a refusal leaves no row, so the smallest accepted order
  proves the floor is at most that. Rendered with a leading `≤`.
- **payment terms** — NOT INFERABLE. `procurement_orders` (`baseline:4514-4567`)
  records no payment date, invoice due date or settlement, so there is no
  interval to measure. Returns the reason rather than a shrug.

Nothing inferred is ever written back: the row exists only where a person said
something, exactly as `restaurant_cellar_registers` (20260903092000) settled.
Where a stated term and the evidence disagree, the house's word wins and the row
carries a **contradiction** line — "the last 214 deliveries landed on Wednesday" —
which no other surface in this product would ever tell them.

**The competitor lens, and what was taken from it.** Choco models minimum order
value, delivery cost, delivery days and a cutoff time per customer, with the
cutoff strict or flexible
(<https://help.choco.com/en/articles/6853427-manage-your-order-preferences>).
MarketMan sets delivery days plus a cut-off day and time per supplier
(<https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management>).
BlueCart lets suppliers set and enforce cutoffs and minimums
(<https://www.bluecart.com/for-restaurants>). US Foods MOXē shows the cutoff in
the My Orders tile on the ordering day and waives minimums on daily delivery
(<https://www.usfoods.com/how-we-help-you/easy-ordering/moxe-help-center/ordering-on-moxe>).
Sysco eliminated minimum delivery requirements outright in 2020
(<https://www.restaurantbusinessonline.com/financing/sysco-eliminating-minimum-delivery-requirements>).
**Two things follow.** First, every one of them stores these as terms the
SUPPLIER states, because they are the supplier's software; Mudavym is the
restaurant's, so a term here is either something the house was told or something
its own books imply — which is why provenance is the axis nobody else has.
Second, minimums are being waived across the industry, so a `minimum_order`
column read as gospel is increasingly wrong, and the upper-bound framing is the
honest one either way.

For approval thresholds: Restaurant365 calls the amount rule a "Workflow
threshold", routes anything above it to an approval hierarchy assigned to a
person or a "Workflow Group", and blocks the ordinary approve permission on a
transaction subject to a rule
(<https://docs.restaurant365.com/docs/approvals-in-workflows>). Ottimate lists
five dimensions — "the number of people needed, certain amount thresholds,
vendor-based approvals, role-based approvals, and account-based approvals"
(<https://ottimate.com/feature/workflows-and-approvals/>). This build takes the
amount and the role and leaves the other three unbuilt rather than half-built
(no queue for a second approver — `procurement_orders` has ONE `approved_by`
column; no per-vendor row; no chart of accounts to hang an account rule on), and
adds two the field mostly does not: the first order to a vendor, and a price
jump against what the house last paid.

**The threshold register's honesty problem, and how it was solved.** Measured:
`ProcurementService.approveOrder` (`procurement.service.ts:1438-1460`) writes
`status`, `approved_at` and `approved_by` and reads neither a role nor an amount;
`POST /procurement/orders/:id/approve` (`procurement.controller.ts:283`) carries
`JwtAuthGuard` and nothing else (class-level, `:108`); `/orders`' `HoldToApprove`
(`pages/orders/next/LedgerRow.tsx:227`) renders for every pending row. So the
ceremony exists and the policy behind it does not, and a settings page that let
an owner believe a ceiling was holding would be worse than no page at all. The
register's FIRST sentence is therefore the enforcement statement, rendered from
`enforcement.enforcedBy` being empty rather than from a hard-coded string — the
day something reads these rows, that array is what changes — and it names
`procurement.service.ts:1438` as the site. What makes the register worth setting
anyway is the **retrospective**: each rule shows how many of the last 365 days'
orders would have needed a second signature, because a ceiling of 15,000 means
something completely different in a house that places four orders a month.

**The audit trail, and what it did not need.** `public.system_audit_log` has
existed since the baseline (`:5553-5568`); `recordAccessChange`
(`team/access-audit.ts:81`) has been filing role changes and removals into it
since ADR 0088; `ReportsService.refile` (`reports/reports.service.ts:215`) files
into it too; the /logs timeline already reads it
(`logs/logs-timeline.service.ts:293`). Settings simply never called it. So this
register is **no new table and no migration** — one writer
(`settings-audit/settings-audit.service.ts`), one read route, and three call
sites. `SettingsService.updateFeatureFlags` now `select`s the row **before** the
upsert so the audit row can carry `{from, to}` per key rather than only "somebody
set this to true"; the read is best-effort, because refusing to change a setting
because the *previous* value could not be read would make a database hiccup look
like a permissions failure.

Three rules the writer holds, each with a test:
1. **`actor_id` is `public.users.user_id`, taken from the JWT and nowhere else.**
   `auth.users` and `public.users` are disjoint here, `system_audit_log.actor_id`
   carries no FK (`baseline:13618` declares only `restaurant_id`), and **CI
   cannot catch a wrong id** — a fresh test database has no rows to violate. A
   request with no user is REFUSED rather than filed anonymously.
2. **Never throws, always reports.** The setting has already changed by the time
   the recorder runs; the receipt travels back to the client as
   `audited`/`auditReason` so a failed record is visible rather than inferred
   from a short list.
3. **Only what moved.** An empty diff files nothing. A row per SAVE rather than
   per CHANGE would fill the register with people opening a form and pressing the
   button.

The reader understands BOTH change shapes — its own nested
`{register, subject, fields}` and the flat `{field: {from,to}}` that
`recordAccessChange` has been writing since ADR 0088 — because rewriting the
older writer would rewrite rows already in production.

**Measured against a real Postgres, not read off a file.** The migration was
applied to the local Supabase container (`supabase_db_…`, port 54322, 198 public
tables, the full baseline schema) and every assertion in it passed, twice
(idempotent re-run). It also **caught a real error**: the obvious way to write
the weekday CHECK —
`NOT EXISTS (SELECT 1 FROM unnest(delivery_weekdays) ...)` — is illegal
(`ERROR: cannot use subquery in check constraint`) and would have failed on
merge; it is now the containment operator `<@`, and the comment says why.
Measured behaviours: a weekday of `9` is refused; the EMPTY array is accepted and
stored as `{}` (the house stating "no fixed days"); a second row for the same
pair collides on `uq_restaurant_vendor_terms_pair`; the `updated_at` trigger
moves the column by the full interval on UPDATE; a `manager_ceiling` with no
amount is refused by `…_rule_carries_its_number`; a rule outside the closed set
is refused by `…_rule_check`; `anon` and `authenticated` have no SELECT and RLS
is on. *(The two tables were left in place on that container rather than dropped:
the migration is in this worktree, so additive is the direction that keeps the
database and the migration set consistent.)*

**What is deliberately NOT built, and why.**
- ~~**Enforcement of the thresholds.**~~ **BUILT 2026-09-04, ADR 0116** — the
  patch in §13.23 was carried out, with three departures named there. The
  register's opening sentence now flips itself: it renders from
  `enforcement.enforcedBy`, which is measured, so removing the gate would put
  "Nothing stops an order yet" back on the page.
- **A per-vendor threshold override.** Ottimate's vendor dimension; it needs a
  row per (restaurant, vendor, rule) and a reader that does not exist. Rendered
  as a no-switch row naming the CHECK constraint that closes the rule set.
- **A second approver in the chain.** `procurement_orders` has one `approved_by`
  column; a chain needs a queue and a current-approver, which is a schema
  decision.
- ~~**Dropping the three column defaults.**~~ **BUILT 2026-09-04, ADR 0116** —
  migration `20260903170000`, plus a reader sweep across all four runtimes
  (§13.26). Two claims in the sentence this bullet used to carry were **wrong**:
  the payment-due template already printed nothing for an absent term, and
  nothing calls that mailer at all, so no fabricated term has ever left the
  building through it.
- **Filing the other eight registers into the trail.** Their writes go through
  services this pass did not own; the register names all eight and the exact
  service each writes through, so their silence cannot be read as "nothing
  changed there".
- **A cutoff per delivery day**, which is how Choco models it. The stated row
  holds ONE cutoff plus an offset; splitting it per weekday needs a child table,
  and the register says the bracket cannot separate a Friday cutoff from a
  weekday one.

**Verification.** Web: `tsc --noEmit` clean; `vitest run src/pages/settings/next`
**39/39** (17 new, each pinning the opposite of the plausible wrong behaviour —
a defaulted 7 rendered as a term, a bracket printed as a time, an upper bound
printed as a minimum, an unenforced ceiling shown as a gate, an empty trail read
as a quiet house). Gateway: `tsc --noEmit -p tsconfig.spec.json` clean in every
module this pass owns; `jest src/vendor-terms src/settings-audit src/settings`
**68/68**; `check_gateway_boots.sh` PASS. `check_no_seeded_defaults.py` PASS (154
web files, 15 gateway files). Emoji grep over both new gateway modules, the page
directory and the migration: empty. Live curl against the local gateway with a
minted session: `GET /vendor-terms` 200, `GET /settings-audit?limit=5` 200,
`GET /settings/approval-thresholds` 200 — and, because the migration is not
applied on the database that gateway points at, all three answered by NAMING the
missing table rather than by rendering emptiness, which is the honesty rule
demonstrating itself. Screenshots at 1440 wide, paper and charcoal, both grounds
reading: `scratchpad/shots-settings-p4d/vt-vendor.png`, `vt-thresholds.png`,
`vt-ledger.png`, `vt-thresholds-charcoal.png`.

**One thing the screenshots cannot show.** The dev tenant has **zero** providers
and zero orders (`GET /providers?restaurantId=550e8400-…` returns `[]`), so the
vendor table renders its empty state rather than a populated register. The
populated shape is sketch 091's `vendor-terms.html`, which is what this was built
to, and the render contract is pinned by tests against a populated fixture.

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
| 08 | Features | Turns capabilities on for **everyone at this restaurant** — including autonomous AI sending, mailbox reading, and this redesign | `restaurant_feature_flags`, one row per restaurant, one column per flag | Owner or manager — **enforced since 2026-09-05** (`assertCanManageRestaurant`, `settings.controller.ts:105-109`; this cell claimed it while only `JwtAuthGuard, TenantGuard` ran, §9.18) | never — no update column exists |
| 09 | POS | Nothing to the till. It bookmarks whose connector documentation you are reading | `user_preferences.preferences.posConfig` | Anyone signed in | the preference record's date, shared |
| 10 | Calendar | Regenerating **silently breaks every existing subscription**, with no undo | `restaurants.calendar_ical_token` | Owner or manager | never — the token has no date of its own |
| 11 | Cellar | Declares which of the seven drinks registers the house carries, which decides which registers `/cellar` draws at all. Switching one on with nothing in the books behind it is allowed and asks you to confirm | `restaurant_cellar_registers`, one row per (restaurant, register) — and **only** where a person said something; an inference is computed at read time and never stored | Owner or manager (JWT on `/cellar`) | **changed** · — the readout carries no date per answer (§13.19) |
| 12 | Vendor terms | Records what a vendor told this house: their cutoff, delivery days, minimum, lead time and payment terms. **The provider form now WRITES the delivery days here** (ADR 0116) instead of into `providers.regions_covered`; nothing else reads them yet — the calendar and orders contract is §13.24 | `restaurant_vendor_terms`, one row per (restaurant, provider), and **only** where a person said something. Every column independently nullable: five terms are five statements | Anyone signed in with a restaurant. Deliberately not owner-only — a cutoff is operational knowledge, and every write carries its author into the log (record it, do not restrict it, as ADR 0088 decided for access) | **stated** — real, with the person's name |
| 13 | Approval thresholds | **Stops an order** (ADR 0116, 2026-09-04). `ProcurementService.assertApprovalAllowed` reads these rows, the order and the actor's role before any seal, refuses with the rule and the number in words, parks the order in `APPROVAL_NEEDED` and files `order_approval_refused`. The register still tells you how many of your own last 365 days' orders each rule would have caught — that is what makes a number choosable rather than guessed | `restaurant_approval_thresholds`, one row per (restaurant, rule) so each carries its own author and date. No rows are seeded: a house with none has set no policy, which is not "unlimited" — and the gate seals as before for such a house, saying so | **Owner or manager only** (`assertCanManageRestaurant`, server-side). Deliberately NOT the vendor-terms rule: a cutoff is knowledge about the world, a threshold is the house's own limit on spending, and a limit anybody may raise is not a limit | **set by · when** — real, per rule |
| 14 | What changed here | Nothing — it is read-only, and there is no write or delete route at all. A log the person who made the change can edit is not a log | `public.system_audit_log`, which already existed. No new table, no migration | Read: anyone signed in with a restaurant. Write: only the three services that file into it | every row IS a date, and a name |

**What "more" turned out to mean, twice.** First pass: *more substance per
setting*, not more switches — the third line under every row. Second pass: *the
third line has to be true*, which meant fixing the gateway rather than writing a
better sentence. Both are the same idea — a settings page earns trust by being
checkable — and the second is the expensive half.

**~~What a settings audit trail would take.~~ BUILT 2026-09-03 (fourth pass).**
The recipe below was written by the second pass and followed to the letter by the
fourth: `settings-audit/settings-audit.service.ts` is the caller, `GET
/settings-audit` is the read, and `?tab=ledger` is the register. Three of the
eleven writes file today (Features, Vendor terms, Approval thresholds); the other
eight are named on the register and in §13.27. **The recipe is kept verbatim
below**, because it is also the instruction for those eight — and because the one
paragraph in it about `actor_id` is the whole security of the feature. What
follows was true when written and is now a description of what shipped:

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
| GET/PUT | `/settings/feature-flags` | `Settings.tsx:894,920` → `services/api/settings.ts:58,66`. The PUT is owner/manager-only since 2026-09-05 (`assertCanManageRestaurant`, §9.18); the GET is not role-gated, deliberately — a member may read what is set. |
| GET | `/calendar/ical-token`; POST `…/regenerate` | `Settings.tsx:159,177` |
| GET | `/restaurants/:rid/members`, `…/invites` | `Settings.tsx:769,778` |
| PATCH/DELETE | `/restaurants/:rid/members/:userId` | role change / remove, `Settings.tsx:805,842` |
| DELETE | `/restaurants/:rid/invites/:code` | `Settings.tsx:862` |
| GET | `/organizations/chains`; PATCH/DELETE `…/chains/:id` | `Settings.tsx:880,516,537` |
| GET | `/pos-hub/providers`, `/pos-hub/status/:rid` | PosSettingsSection → `services/api/posHub.ts:52,59` |
| GET/PATCH | `/notifications/preferences` | NotificationsSection → `services/api/notifications.ts:194,207` |

**Added 2026-09-03 by the fourth pass** — rebuilt page only, all three through
`apiClient`, all three tenant-scoped from the signed token (no restaurant id is
accepted from the caller):

| Method | Path | Gateway | Call site |
|---|---|---|---|
| GET | `/vendor-terms` | `vendor-terms/vendor-terms.controller.ts:44` | `useSettingsNextData.ts` — `vendorTerms` remote, keyed `?tab=vendor-terms` |
| PUT | `/vendor-terms/:providerId` | `vendor-terms/vendor-terms.controller.ts:71` | `useSettingsNextData.ts` — `saveVendorTerms` |
| GET | `/settings/approval-thresholds` | `settings/settings.controller.ts` | `useSettingsNextData.ts` — `thresholds` remote |
| PUT | `/settings/approval-thresholds` | `settings/settings.controller.ts` | `useSettingsNextData.ts` — `saveThreshold` |
| GET | `/settings-audit?limit=&register=` | `settings-audit/settings-audit.controller.ts:48` | `useSettingsNextData.ts` — `ledger` remote |

There is deliberately **no** write or delete route on `/settings-audit`.

**Added 2026-09-05 — the currency field (§13.35).** These two are on BOTH pages,
because the rebuild is behind a flag:

| Method | Path | Gateway | Call site |
|---|---|---|---|
| GET | `/settings/currency` | `settings/settings.controller.ts` → `settings/house-currency.service.ts` | `useSettingsNextData.ts` — `houseCurrency` remote, keyed `?tab=currency`; legacy `ReportingCurrencySection` (`pages/Settings.tsx`) |
| PUT | `/settings/currency` | same | `useSettingsNextData.ts` — `saveCurrency`; legacy `ReportingCurrencySection` |
| GET | `/settings/carrying-cost` | `settings/settings.controller.ts` → `settings/house-carrying-cost.service.ts` | `useSettingsNextData.ts` — `houseCarryingCost` remote, keyed `?tab=carrying-cost` |
| PUT | `/settings/carrying-cost` | same | `useSettingsNextData.ts` — `saveCarryingCost` |

The GET is not role-gated (a member may read what money the figures they are
looking at are in); the PUT is owner/manager-only through
`assertCanManageRestaurant` and validates `^[A-Z]{3}$`, which is
`restaurants_currency_check` verbatim.

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
- **`mudavym_design_connections` changes THIS page too** (the collapse, 2026-09-04),
  which is the only cross-page flag dependency in the wave: it removes four registers
  here and redirects their four `?tab=` links. Off → fourteen registers, no line out,
  every `?tab=` unchanged. The verdict is asynchronous under the per-restaurant flag,
  so `SettingsNext` derives what it SHOWS (`shown`) rather than trusting `active`,
  and a collapsed register is never painted for a frame on a page whose contents
  column says it is not there.
- Note the recursion: this page is where all 17 `mudavym_design_*` flags are
  flipped, **including its own** — turning `mudavym_design_settings` off from the
  rebuilt Features register returns you to the legacy page.
- `?tab=cellar` exists **only** on the rebuilt page. On the legacy page an
  unrecognised `?tab=` falls back to `team`, so the link degrades rather than
  breaking, and nothing outside this page links to it yet. The same is true of
  `?tab=vendor-terms`, `?tab=thresholds` and `?tab=ledger` (added 2026-09-03).
- **New config this page now owns** (fourth pass): `restaurant_vendor_terms` and
  `restaurant_approval_thresholds`, both created by migration
  `20260903140000_the_terms_a_house_was_given.sql` with RLS on, a service-role
  policy, `anon`/`authenticated` revoked, and in-file assertions that fail the
  migration rather than reporting success. Neither table is seeded: a house with
  no rows has stated nothing and set no policy, which is different from having
  chosen a value.
- **The contents column's grouping is data, not layout.** Each `SectionSpec`
  carries `group` and `order` (`st-format.ts`); `GROUPS` and `READING_ORDER` are
  derived from them, so the numbers in the tab bar and the "Register N of 14"
  line cannot drift apart, and a new register is placed by editing one row.

## 9. Gaps

- **Closed 2026-09-05 — a house could not state its own currency.** After the
  Q30 clearing pass, eleven of the fourteen production houses hold
  `restaurants.currency = NULL` and print "currency not recorded" against every
  money figure. Until today the only writer in the entire product was the
  sign-up form, so those eleven were told a true thing they had no way to act
  on. `GET`/`PUT /settings/currency` and the Currency register (§1a) are the
  field; §13.35 is struck accordingly.
- **Still open here**: nothing clears a stated currency back to NULL. That was
  done once, by `scripts/correct_restaurant_currency.py` under the founder's
  explicit word, and this register deliberately does not offer it — a button
  that silently un-answers the question every money figure depends on is not the
  same act as answering it. If a house needs it, it is a founder call.
- **A currency with no trail row cannot be dated.** `statedAt` comes from
  `system_audit_log`, so a code set before this route existed (or by the
  correction script) shows an em dash naming both possibilities rather than
  substituting `restaurants.updated_at`, which moves for any change to the row.
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
   `select("*")` on `notification_preferences`). `_select_channels` has exactly
   three call sites: `:545` (low stock), `:727` (negotiation complete), `:788`
   (delivery confirmation). Inside the window and below `critical` it returns
   `[]` — the alert is **suppressed**, not delayed. The control was restored on
   2026-09-03; it was removed for one day on a three-runtime grep.
   **Corrected again 2026-09-03 (re-audit DEFECT 1):** this citation said "four
   handlers (`:541`, `:637`, `:726`, `:787`)". `send_order_approval_request`
   (`:611`) fetches the same preferences row (`:637`) but then reads
   `order_approval_channels` off it directly (`:638`) and never calls
   `_select_channels` — **order-approval notifications are not quiet-hours-gated
   at all**, which is a real and distinct fact rather than a citation trim
   (§13.17 covers what to do about it). The rendered copy never claimed
   otherwise; the comment that exists to make the claim checkable did.
3. ~~**No setting on this page records WHO changed it.**~~ **PARTLY CLOSED
   2026-09-03 (fourth pass).** `restaurant_feature_flags` still carries
   `created_at` and no `updated_at`/`updated_by`
   (`supabase/migrations/20260805000000_baseline_from_production.sql:5097-5105`) —
   and that no longer matters, because the author is recorded in
   `system_audit_log` instead, which is a better answer than a column: it records
   **every** change rather than only the last one. `SettingsService.updateFeatureFlags`
   now reads the row before the upsert and files `{from, to}` per key with the
   JWT's `public.users.user_id` as the actor. Vendor terms and approval
   thresholds file the same way. **Still open for the other eight registers** —
   they write through services this pass did not own (§13.27), and the ledger
   register names all eight so their silence cannot be misread as "nothing
   changed there".
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
   real guard run covers this directory. Last run here: `PASS — 129 web file(s) and 13 gateway file(s) across 19 root(s); 1,433,123 + 127,368 chars examined.`
   — the web file count climbs as the shared `wt-p4` worktree takes other pages'
   commits, so it is a timestamp, not a constant.

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
12. ~~**Three column defaults assert facts nobody stated**~~ **CLOSED 2026-09-04 — ADR 0116**, migration `20260903170000_a_default_is_not_an_answer.sql`; the reader sweep and the two corrections to this entry are in §13.26. The finding as it stood (measured 2026-09-03):
    `providers.lead_time_days DEFAULT 7` (`baseline:4864`),
    `providers.payment_terms DEFAULT 'Net 30'` (`baseline:4897`), and
    `restaurants.timezone DEFAULT 'America/Los_Angeles'` (`baseline:3575`). Each
    makes every row carry an answer to a question nobody was asked, and none can
    be told apart from a real answer. `payment_terms` already reaches vendors:
    `communications/email-templates/payment-due.template.ts:108` prints it into
    outbound mail. The vendor-terms register refuses to read any of the three as
    a term (`vendor-terms.service.ts` — `leadTimeCell`, `paymentCell`); dropping
    the defaults is §13.26 and is a production ALTER with live readers
    (`providers.service.ts:1374,1382`).
13. ~~**The delivery-days checkbox writes into the geography column.**~~ **CLOSED 2026-09-04 — ADR 0116**; the picker writes `PUT /vendor-terms/:providerId` and `EditProviderModal` seeds from that register (§13.25). The finding as it stood:
    `AddProviderModal.tsx:820` collects weekdays; `pages/Providers.tsx:458` sends
    them as `statesOrRegionsServed`; `services/api/providers.ts:162-163` maps that
    to `regionsCovered`; the gateway writes `providers.regions_covered`
    (`providers.service.ts:199`). The sibling field `deliverySchedule`
    (`Providers.tsx:458`) is declared on the web DTO (`services/api/providers.ts:88`)
    and never reaches `buildProviderPayload`'s output (`:140-177`) — dropped
    entirely. So ticking three weekdays adds three weekday names to the list of
    regions a vendor covers, and does nothing else (§13.25).
14. ~~**Nothing enforces an approval threshold, and nothing ever has.**~~ **CLOSED 2026-09-04 — ADR 0116**: `ProcurementService.assertApprovalAllowed` reads the rules, the order and the actor's role and refuses the seal in words; `PUT /settings/approval-thresholds` is owner/manager only (§13.23). The finding as it stood:
    `ProcurementService.approveOrder` (`procurement.service.ts:1438-1460`) writes
    `status`, `approved_at` and `approved_by` without reading a role or an amount;
    `POST /procurement/orders/:id/approve` (`procurement.controller.ts:283`)
    carries `JwtAuthGuard` alone. Anyone who can reach the endpoint can seal any
    amount. The register records the policy and says this on its face (§13.23).
15. **The eleven registers file into the trail at three of eleven.** Email
    sign-off, Notifications, Locations & chains, Map, Services, POS, Calendar and
    Cellar all write through services outside this pass's paths and file no audit
    row (§13.27). The ledger register lists all eight with the service each writes
    through, so an empty trail for one of them means nothing rather than nothing
    having happened.
16. **Two of the five vendor terms can only ever be BOUNDS, not values.** A
    cutoff can be bracketed but never stated from this house's own orders (the
    latest placement that made the best turnaround is a floor; the earliest that
    did not is a ceiling), and a minimum can only ever be an upper bound because
    every row in `procurement_orders` is an order the vendor ACCEPTED and a
    refusal writes nothing anywhere. Not a defect to fix — a limit of the
    evidence, stated in the register rather than papered over. Closing either
    needs the vendor to tell the house, which is what the stated row is for.
17. **Payment terms cannot be inferred at all.** `procurement_orders`
    (`baseline:4514-4567`) records no payment date, no invoice due date and no
    settlement, so there is no interval to difference. The orchestrator's
    extractor already pulls `payment_terms` out of vendor replies
    (`common/orchestrator/commercial-terms.ts:33`) but writes it nowhere this
    register can read (§13.28).

18. **CLOSED 2026-09-05 — the flags route asked nothing about who was asking.**
    `PUT /settings/feature-flags` carried `JwtAuthGuard, TenantGuard` and no role
    check, while `PUT /settings/approval-thresholds` in the same controller
    called `assertCanManageRestaurant`. Any authenticated member of a restaurant
    could therefore flip `enable_ai_autonomous_send` — ON means an AI-written
    reply reaches a vendor with nobody having read it — and the consequence was
    measured, not inferred: a `git show HEAD:` copy of the controller accepted a
    staff member's write (`jest src/settings/zz-prefix-head.spec.ts`, 1 passed,
    2026-09-05, probe deleted after the run). The founder's call was **one rule
    for every flag**: the route now runs the same helper the thresholds use
    (`settings.controller.ts:105-109`), and both directions are held by
    `apps/api-gateway/src/settings/flag-writes-are-role-gated.spec.ts` (8 cases).
    Two consequences: `enable_house_inbox_read` could finally join
    `UpdateFeatureFlagsDto` (ADR 0118 D8-D11 had withheld it for exactly this
    reason), and the controls on both `/settings` builds render disabled with the
    reason for a non-manager rather than failing after the click (ADR 0083).
19. **STILL OPEN — the two flag READ routes are not tenant-scoped the way the
    write is.** `GET /settings/feature-flags/:restaurantId` is documented "admin
    only" and has no admin check, and `POST /settings/feature-flags/check` takes
    `restaurant_id` from the request body; both therefore answer for a restaurant
    the caller names rather than the one the token carries
    (`settings.controller.ts:213-227`, `:186-206`). What leaks is a boolean per
    flag, not tenant data, which is why this is filed rather than fixed inside a
    write-side pass — but "admin only" in an `@ApiOperation` that nothing
    enforces is the shape ADR 0020 exists to forbid, and it should be closed by
    whoever next owns this controller.


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
| Features | **yes** | 22 registry-ACTIVE flags, 3 AI/mailbox + 19 redesign (counted 2026-09-05 from `ACTIVE_FEATURE_FLAGS`); `feature-flag-registry.ts` is the single source |
| POS | **split** | `/pos-hub/status/:rid` is real and its failure is rendered as failure; the connector picker reads back only to itself (§9.4) |
| Calendar | **token yes, subscription unproven** | `v3.0-TECH-DEBT.md:346-348`; the page now labels the client steps *Untested* |
| Cellar | **yes** | `pages/cellar/next/CellarRegistersControl` mounted over `GET/PUT /cellar/:restaurantId/registers` (`apps/api-gateway/src/cellar/`); a failed readout renders as words, not as seven registers switched off |

### The 2026-08-26 record, kept

The Features section **was** the largest single block of dead controls in the
product. It is not there any more, and the paragraph that described it was wrong
about *why* it was dead.

**Corrected 2026-08-26 (OD-86, `OPEN-DECISIONS.md:101`).** This dossier claimed the
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

> **Added 2026-09-04 by the collapse.**
> - **Retire the four collapsed registers' code** — `ServicesSection.tsx`,
>   `PosSection.tsx`, `EmailSection.tsx`, `CalendarSection.tsx` and their four
>   `SECTION_IDS` entries. Gated on `mudavym_design_connections` reaching production:
>   until then the flag-off branch renders them and deleting them would break it. The
>   ids themselves must survive the deletion, as a redirect table — a `?tab=pos`
>   bookmark that stops being recognised opens Team instead, silently.
> - **`useMudavymDesign` has no settled state**, so this page derives `shown` from
>   `active` rather than trusting it for one render. A tri-state in
>   `apps/web/src/lib/mudavym/useMudavymDesign.ts` would remove the workaround here and
>   the first-paint reads on `/profile`; it is a wave-level change to a shared file.

1. ~~**Cut the Features section to the flags that exist as gates.**~~ **Done
   2026-08-26 (OD-86).** The gate-less flags are rendered without controls and listed
   in `inactiveFeatures.ts`; `feature-flag-registry.ts` is the single source of which
   flags are real. The OD-23 tiering fork it was "blocked on" is **still open** — but
   it was never blocking this, which is why the removal shipped without it.
2. ~~**Expose `enable_ai_autonomous_send`.**~~ **Done 2026-08-26** —
   `AiAutonomySection` (`Settings.tsx:27,1299`), with tests at
   `components/settings/AiAutonomySection.test.tsx`. **Extended 2026-09-05:**
   exposing it was half the job; until that date any authenticated member could
   flip it. The route is role-gated now (§9.18) and both `/settings` builds
   render the control disabled with the reason for a non-manager.
2a. **Close the two ungated flag READ routes** (§9.19) — `GET
   /settings/feature-flags/:restaurantId` claims "admin only" and checks nothing,
   and `POST /settings/feature-flags/check` reads the restaurant id out of the
   body. Both should take the tenant from the token like every other route on
   this controller, and the `:restaurantId` one should either grow the admin
   check its description promises or be deleted.
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
16. ~~**Wire the settings audit trail.**~~ **Done 2026-09-03 (fourth pass)** for
    three of eleven registers — Features, Vendor terms and Approval thresholds —
    through `apps/api-gateway/src/settings-audit/`, read at `?tab=ledger`. No new
    table and no migration. The remaining eight are §13.27. The original entry is
    kept below because it is still the instruction for those eight:
    `system_audit_log` and the
    `recordAccessChange` shape already exist and are already used by two access
    changes; `SettingsService.updateFeatureFlags`,
    `UserPreferencesService.updatePreferences` and
    `NotificationsService.updatePreferences` never call them. The full recipe —
    which endpoint, which before-state to capture, and why `actor_id` must be
    `public.users.user_id` — is in §1b, *What this page can do now*. This is the
    single highest-value item on this list: today the grant of autonomous AI
    sending is anonymous.
17. **Decide which quiet-hours store is canonical, and whether order approvals
    should honour the window.** Two stores: `notification_preferences` (this page
    writes it; the alerting agent reads it) and
    `manager_preferences.quiet_hours_start/end` (`baseline:3696-3697`, read only
    by a method with no callers) — delete the dead one or the next person fixes
    the wrong one (§9.11). Separately,
    `NotificationAgent.send_order_approval_request`
    (`notification_agent.py:611,638`) bypasses `_select_channels` and reads
    `order_approval_channels` directly, so an order-approval push or SMS fires
    inside the quiet window. That may be right — an approval request is arguably
    urgent — but it is undeclared, and the page cannot say "quiet hours holds
    non-critical alerts" without an asterisk until it is decided.
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
21. ~~**A Vendor-terms register.**~~ **Done 2026-09-03 (fourth pass)** —
    `?tab=vendor-terms`, `restaurant_vendor_terms`,
    `apps/api-gateway/src/vendor-terms/`. **Pack size was NOT built**: nothing in
    the schema holds one, and inferring it from `procurement_orders.unit_type`
    (a varchar with `bottles` as its default) would repeat the exact
    defaulted-column fault this register exists to catch. Filed as §13.29.
22. ~~**Approval thresholds.**~~ **Done 2026-09-03 (fourth pass)** —
    `?tab=thresholds`, `restaurant_approval_thresholds`,
    `GET/PUT /settings/approval-thresholds`. The tenancy objection the second pass
    recorded ("production has one real tenant and no `staff` role") turned out to
    be an argument against *testing* it, not against *building* it: the rules are
    owner-vs-manager, both of which exist, and the retrospective makes the setting
    useful on day one even with nobody to escalate to. **Enforcement is NOT
    built** — §13.23.

**Added 2026-09-03 by the fourth pass** (each is outside the paths this pass was
cleared to edit, so each is filed rather than built):

23. ~~**Enforce the approval thresholds — the exact patch.**~~ **DONE 2026-09-04 — ADR 0116.** Built almost exactly as specified below, with three departures, each named where it happens:
    - the role comparison is a RANK test, not `requiredRole === "owner"`: a
      rule may demand `manager`, and `owner` has to satisfy it
      (`procurement/order-approval-gate.ts` `roleSatisfies`);
    - an **unreadable** policy REFUSES rather than sealing. The patch below
      did not distinguish it from an empty one, and they are opposites;
    - the refused order is parked in `APPROVAL_NEEDED` — an existing
      `ProcurementOrderStatus` member, `status` being `varchar(50)` with no
      CHECK (`baseline:4527`) — so the ROW says it is waiting, not only the
      log. No migration.

    Also required and not in the patch: `procurement.controller.ts` re-wrapped
    **every** throw as a 500, so the 403 and its sentence would have reached
    the browser as "Internal Server Error". `HttpException` is now rethrown.

    Files: `procurement/order-approval-gate.ts` (new),
    `procurement.service.ts` `assertApprovalAllowed` / `approvalGate`,
    `procurement.module.ts` (imports `SettingsModule` + `OrganizationsModule`),
    `organizations.service.ts` `resolveRestaurantRole` (lifted out of
    `assertManagerOrOwner`, one implementation),
    `procurement/order-approval-gate.spec.ts` (21 cases).
    The web half: `GET /procurement/order-approval-gate` (one call per house,
    not per row) → `useOrdersNextData` → `LedgerRow` renders the ceremony
    **disabled with the rule and the amount in words**, and
    `services/api/orders.ts` promotes the 403 body onto `error.message` so all
    four call sites print it. `pages/orders/next/ApprovalGate.test.tsx`, 9 cases.

    The original entry, kept because the departures only read against it:

    **Gateway.** `apps/api-gateway/src/procurement/procurement.service.ts`,
    inside `approveOrder(restaurantId, orderId, userId)` at `:1438`, BEFORE the
    `.update(...)` at `:1443`:
    1. Read the order first — it is not read today at all:
       `select("total_cost, provider_id, inventory_id, final_price").eq("restaurant_id", restaurantId).eq("id", orderId).maybeSingle()`.
       A `null` here is already a 404 case the method silently turns into a
       PostgREST error, so this is a fix either way.
    2. `const policy = await this.thresholds.read(restaurantId)` —
       `ApprovalThresholdsService` is exported from `SettingsModule`
       (`settings/settings.module.ts`), so `ProcurementModule` needs
       `imports: [SettingsModule]` and the service in its constructor.
    3. Build the `OrderUnderTest`: `total` from `total_cost`;
       `isFirstOrderToVendor` from a `count` of prior orders to that
       `provider_id` **excluding this one**, or `null` if that count errors —
       `null` must NOT be read as `false`, which `decideApproval` already
       guarantees; `pricePremiumPct` from the previous `final_price` for the same
       `inventory_id`, or `null` when there is none.
    4. `const decision = decideApproval(policy.thresholds, order)` — the pure
       function is already exported from
       `apps/api-gateway/src/settings/approval-thresholds.ts` and is already
       tested (13 tests). **Do not write a second copy**: two implementations of
       "does this need an owner" is how a policy page and a policy diverge.
    5. If `decision.requiredRole === "owner"` and the caller's JWT role is not
       `owner`, throw a `ForbiddenException` whose message is
       `decision.reasons.join("; ")` — the person waiting must be told which rule
       fired and what the number was, or they learn to split orders in two.
       `decision.untestable` non-empty should NOT block: a rule that could not be
       tested is not a rule that fired.
    6. File the refusal: `system_audit_log`, action `order_approval_refused`,
       so a policy that is quietly blocking work is visible.
    **Spec** in the same module asserting: over-ceiling + manager role → 403;
    over-ceiling + owner → approved; unknown first-order-ness → approved, not
    refused; no policy at all → approved (a house that set nothing has not set
    "nobody may approve").

    **Web read site**, outside this page's paths:
    `apps/web/src/pages/orders/next/LedgerRow.tsx:227` renders `HoldToApprove`
    for every pending row. It should read the policy once in
    `useOrdersNextData.ts` (`GET /settings/approval-thresholds`, keyed by
    `activeRestaurantId`) and, when `decideApproval` says the row needs a role the
    signed-in person does not have, render the ceremony **disabled** with one line
    naming the rule and the amount — never hidden, because a control that
    disappears teaches nothing. Until that lands the button is correct as it
    stands: the gateway is the gate, and the UI must not pretend to be one.
24. **The vendor-terms contract for `/calendar` and `/orders`.** Both were named
    in the brief as future readers; neither is built. `GET /vendor-terms` already
    returns everything they need — the payload is
    `{ restaurantId, vendors[], currency: {code, isColumnDefault},
    zone: {zone, isColumnDefault}, windowDays, sources }`, and each vendor is
    `{ providerId, providerName, ordersInWindow, lastOrderedAt,
    deliveryWeekdays, orderCutoff, minimumOrder, leadTimeDays, paymentTerms,
    notes, statedBy, statedAt }` with every term a
    `TermCell` = `{ value, source: 'stated'|'vendor_record'|'inferred'|'unknown',
    statedBy?, statedAt?, column?, n?, confidence?, basis?, reason?,
    contradiction? }`.

    **The contract, and it is a hard one: a reader may act ONLY on
    `source === 'stated'` or `'vendor_record'`.** An inferred cutoff is a
    bracket and an inferred minimum is an upper bound; drawing either as a
    deadline on a calendar, or refusing an order against either, would convert a
    bound into a fact at the exact moment somebody relies on it. An inferred term
    may be SHOWN — "we think they close around 14:00, nobody has confirmed" —
    and must carry its `n` and `confidence` when it is.
    - **`/calendar`**: a vendor with a stated `orderCutoff` and stated
      `deliveryWeekdays` yields a recurring per-day object — *"Anadolu closes in
      3h 10m for Wednesday"* — computed as the next delivery weekday minus
      `offsetDays`, at `time`, **in `zone.zone`**, and suppressed entirely when
      `zone.isColumnDefault` is true, because a cutoff drawn in the wrong
      timezone is worse than no cutoff.
    - **`/orders`**: a draft to a vendor whose stated `deliveryWeekdays` do not
      contain the promised delivery day should say so before it is sent; a draft
      below a stated `minimumOrder` should say so. Both are warnings, never
      blocks — the vendor's terms are the vendor's, and the house may have been
      told something newer on the phone.
    - **`/notifications`**: a low-stock alert can say *"order by 14:00 or it is
      Friday"* only when the cutoff is stated.
25. ~~**Give the delivery-days checkbox a real home**~~ **DONE 2026-09-04 — ADR 0116.** Pointed at `PUT /vendor-terms/:providerId`; the control was not
    deleted, because the days are real information somebody is trying to
    record. `pages/Providers.tsx` no longer sends `statesOrRegionsServed` or
    `deliverySchedule` from the picker, and `EditProviderModal` seeds it from
    `GET /vendor-terms` instead of from `regionsCovered` — reading the
    geography column back into the control is what round-tripped the defect.
    When that register cannot be read the picker is **disabled with the reason
    in words** and the page skips the write, because an empty selection is
    itself a statement ("no fixed days") this page would otherwise save.
    Mapping and payload pinned in `services/api/vendorTerms.test.ts` (9 cases).
    **Cleanup was deliberately NOT done**: `regions_covered` is free text and
    a "Sunday" in it cannot be proven a picker artefact rather than a place,
    so `scripts/list_weekdays_in_regions_covered.py` lists and proposes and has
    no `--apply`. The rows it finds are the founder's call.
26. ~~**Drop the three column defaults**~~ **DONE 2026-09-04 — ADR 0116**,
    migration `20260903170000_a_default_is_not_an_answer.sql`: three
    `DROP DEFAULT`s and three `UPDATE … SET col = NULL WHERE col = <default>`,
    counted into a `RAISE NOTICE`. The migration states in its own header that
    this erases real answers along with fabricated ones, because a default is
    indistinguishable from an answer and no query separates them.
    **Proven on the local Postgres in a rolled-back transaction**: with three
    seeded providers and one restaurant it cleared 2 / 2 / 1 rows and left
    intact the provider that carried a stated `21` days and `2% 10 net 30`.
    **Production counts were not measured** — no production access this
    session; the `NOTICE` reports them at apply time.

    **CORRECTED 2026-09-04 by the audit: the first sweep claimed four runtimes
    and covered three.** It grepped `apps/api-gateway`, `apps/web` and
    `apps/mobile` for the COLUMN names and treated
    `services/agent-orchestrator` as covered because the grep returned two hits
    it read as inert. It was the same omission §9 records the 2026-09-02 pass
    making — and it hid a real outage, because the orchestrator does not read
    these columns by name, it *validates rows into a model*:

    `core/database.py` declared `Provider.lead_time_days: int = 7`,
    **non-Optional** (unlike `payment_terms` two lines below). After this
    migration a NULL lead time makes `Provider.model_validate` raise
    `pydantic.ValidationError`; `BaseRepository.find_many` and `.get_by_id`
    catch **only `APIError`**, so it escaped the repository entirely; and
    `RFQAgent._select_competitor_vendors` swallowed it in a bare `except Exception` and
    returned `[]`. The symptom would have been **"this house has no active
    vendors", for every restaurant, permanently** — one ERROR line and an empty
    list. Proven against a HEAD copy of the model:
    `Input should be a valid integer [type=int_type, input_value=None]`.

    Fixed: `lead_time_days` and `minimum_order_quantity` are
    `Optional[... ] = None` (the second names a column that does not exist at
    all — `providers` has `minimum_order` — so its `12` was fabricated for every
    provider and has zero readers); `find_many` validates **per row**, logs the
    id of a row it cannot read and the count it dropped, and returns the rest;
    `get_by_id` reports an unvalidatable row as not-found *and says so*. Pinned
    in `services/agent-orchestrator/tests/test_dropped_column_defaults.py`
    (17 cases), which fails against the pre-fix tree.

    **The re-audit found the same funnel's second mouth**, and it is closed:
    `RFQAgent._select_competitor_vendors` still caught bare `Exception` and
    returned `[]`, so a dropped connection or an expired service key was logged
    as *"No vendors found for X"* — a claim about the house, not the request. It
    raises `VendorSelectionUnavailable` now, carrying the cause and its class;
    `_build_rfq_plan` still fails closed and now says which of the two happened.
    6 cases in `tests/test_rfq_vendor_selection_failure.py`, one of which runs
    the pre-fix shape to prove it still swallows the failure.

    **Test figures, stated in their own scope.** The blocker fix's commit
    message quoted 1,336 orchestrator tests; that was the marker-filtered run
    (`-m "not e2e and not prod_e2e and not slow"` — 1,336 passed, 4 skipped, 53
    deselected) reported as the whole suite. The full run at that commit was
    **1,339 passed, 54 skipped**. With this pass's six additions it is
    **1,345 passed, 54 skipped**.

    **The lesson, which is the durable part:** a reader sweep that greps for
    COLUMN NAMES cannot see a runtime that reads columns through a schema. The
    orchestrator's models are a reader of every column they name, and they were
    not in the grep.

    The rest of the sweep, and each fix:
    | Site | Was | Now |
    |---|---|---|
    | `vendor-terms.service.ts` `leadTimeCell` / `paymentCell` | compared against `7` / `'Net 30'` and reported a match as unknown | the comparison is gone; a `7` is a term. **Couples this file to the migration** — named in ADR 0116's Consequences |
    | `vendor-terms.service.ts` `readHouse` | `isColumnDefault` true when the zone EQUALLED Los Angeles | true only when the zone is unset. The `currency DEFAULT 'USD'` half is unchanged — it was not in the decision |
    | `communications/email-templates/payment-due.template.ts:108` | named in §9.12 as the escape route to a vendor's inbox | **already correct**, and **nothing calls the mailer** — its only invocation is `tests/email-e2e.spec.ts`; the cron was deleted (`scheduled-tasks.service.ts:596-619`). Both pinned in `payment-terms-are-not-fabricated.spec.ts` |
    | `communications/scheduled-tenants.service.ts:135` | `row.timezone \|\| "America/New_York"` | `TIMEZONE_NOT_SET` (empty string, not a valid IANA zone), so `notification-producers.service.ts:339-347` and `calendar-reminders.service.ts:176-185` both log `TIMEZONE_UNKNOWN` and run in UTC |
    | `organizations.service.ts:577` | `dto.timezone ?? "America/New_York"` on location create | `?? null` |
    | `AddProviderModal` / `EditProviderModal` | `paymentTerms: 'Net 30'` as the FORM default | `''`, with an explicit "Not stated" option. This would have refilled the column on every save |
    | `providers.service.ts:201,420,1374,1382` | writes `?? null` / `?? undefined`, reads raw | unchanged — already correct |
    | `restaurants/operating-hours.service.ts:179`, `simpos/scenario-verify.service.ts` | `?? null`, and says "an unrecorded timezone" | unchanged — already correct |

    ~~**NOT touched, and filed here rather than done in passing:**~~
    **DONE 2026-09-04** — the founder read the reader list and dropped both:
    `manager_preferences.report_timezone` (`baseline:3692`) and
    `manager_report_profiles.timezone` (`baseline:3729`), migration
    `20260904190000_a_report_has_no_default_clock.sql`, same snapshot shape and
    same per-column assertion. **They were not the same case**, and the
    measurement is why the second was nearly cosmetic:
    `manager_report_profiles.timezone` has **zero readers of the column
    anywhere** and its table holds 0 rows in production
    (`demo/weekly_report_scheduler.py:96`), so dropping its default was free —
    while `manager_preferences.report_timezone` had the same fabricated answer
    **hard-coded twice more in Python**, and dropping the column default alone
    would have changed nothing:
    | Site | Was | Now |
    |---|---|---|
    | `core/database.py` `ManagerPreferences.report_timezone` | `str = "America/Los_Angeles"` — non-Optional, so a NULL row would also have raised `ValidationError` in `model_validate` | `Optional[str] = None` |
    | `agents/reporting_agent.py` `_should_generate_report` | `preferences.get("report_timezone", "America/Los_Angeles")` — and this line decides **whether a manager's report fires now** | refuses in words: logs, skips the schedule, sends nothing, assumes no zone. An unknown zone name is refused separately |
    | `core/database.py` `ManagerPreferencesRepository.is_quiet_hours` | `pytz.timezone(prefs.report_timezone)` | **DEAD** — zero callers anywhere (the only other `is_quiet_hours` is `NotificationAgent._is_quiet_hours`, a different method on a different table). Left in place, made safe, and recorded as dead in ADR 0116 rather than quietly repaired |
    `auth.service.ts:768` writes `dto.timezone || "America/New_York"` on
    registration — the same fault on the sign-up path — and was left because
    another builder held that file uncommitted for the whole session.
27. **File the other eight registers into the settings trail.** Email sign-off
    (`restaurant-templates.service.ts`), Notifications
    (`notifications.service.ts`), Locations & chains (`organizations.service.ts`),
    Map / Services / POS (`user-preferences.service.ts`), Calendar subscription
    (the ical-token route), Cellar registers (`cellar-registers.service.ts`).
    Each needs the same two lines Features got: read the row before the write,
    then call `SettingsAuditService.record` with the JWT's
    `public.users.user_id`. `SettingsAuditService` is already exported from
    `SettingsAuditModule`; each owning module imports it.
28. **Carry `payment_terms` from a vendor reply into the stated row.** The
    orchestrator already extracts it (`common/orchestrator/commercial-terms.ts:33`,
    prompt at `inbound-responder.service.ts:688`) with `source_quotes` attached,
    and writes it nowhere the vendor-terms register can read. A one-tap "the
    vendor said Net 45 — record it?" is the shape, and the audit row would then
    name the person who accepted it rather than the AI that read it.
29. **Pack size.** Named in the second pass's §13.21 and not built: nothing in
    the schema holds one, and `procurement_orders.unit_type` is a varchar
    defaulting to `bottles`, so inferring from it would repeat the
    defaulted-column fault of §9.12. It needs a column on
    `restaurant_vendor_terms` and, more usefully, a per-item one — which is an
    inventory decision, not a settings one.
30. **A cutoff per delivery day.** Choco stores one
    (<https://help.choco.com/en/articles/6572290-view-and-edit-the-information-of-your-supplier>);
    this build stores one cutoff plus an offset. A child table keyed
    (restaurant, provider, weekday) would hold it, and the inference cannot split
    it either way — a Friday cutoff of 11:00 and a weekday one of 15:00 land in
    the same bracket today, which the register says.
31. **"Set this up with me" — the assistant's entry point on this page.** Proposed by
    [ADR 0113](../decisions/0113-the-assistant-proposes-the-seal-applies.md) from the
    founder's note of 2026-09-03: *"let AI assistant talk with you and handle all the configs
    then approval button."* Sketch
    [`101-config-assistant/`](../sketches/101-config-assistant/) draws the conversation, the
    proposal and the seal.

    **The control.** One line in the contents column, above the five groups, not a floating
    button: *"Set this up with me"*. It opens the ⌘K assistant scoped to configuration —
    `components/askai/AskAiSurface.tsx` is the surface, `HoldToApprove` is the seal. It is
    **disabled with one line saying why** until the role gate below exists, per this page's
    own rule that a control whose backend does not exist is never drawn as a working button.

    **What it produces.** Not a chat transcript — a **proposal document**: every value it
    would set, grouped by the register it belongs to, each row carrying the reason, the
    current value, and where that current value came from. Rows are prunable. One
    hold-to-approve applies what remains. The apply is **item by item across eight services
    with no shared transaction**, so the completion screen is a receipt — written · refused
    (with the reason) · not attempted — never a single checkmark. This is
    [[0084-the-communications-gateway-says-what-it-did]] applied to configuration.

    **What it may and may not touch** (ADR 0113 rule 2, drawn by blast radius rather than by
    the word "settings"). May be proposed: `vendor-terms`, `thresholds`, `notifications`,
    `cellar`, `calendar`, `email`, `map`, and `measurement` — the last with a caveat, because
    `measurement` is `kind: 'browser'` (`pages/settings/next/st-format.ts:123`), kept in
    localStorage, so **a server-side batch cannot write it at all** and the row must say so.
    May never be proposed: `team`, `locations`, `features`, `services`, `pos` (the till
    connection is a credential, not a judgment), `ledger` (read-only), and anything touching a
    payment instrument — eight and six account for all fourteen. Notion draws the same line for the same
    reason — its agent restructures a whole workspace and may not "manage any workspace level
    settings, like member roles, billing, security features, and more"
    (<https://www.notion.com/help/notion-agent>).

    **The third provenance state.** This register page already distinguishes a value nobody
    stated from one somebody typed — the rule of `vendor-terms/vendor-terms.service.ts:44-59`.
    A sealed proposal is neither, and must be recorded as its own kind: a `system_audit_log`
    row carrying the batch's `correlation_id` **and** the utterance in `reason`. Both columns
    exist and neither is used — `reason` is in the baseline (`20260805000000:5564`),
    `correlation_id` was added by `20260805132000:73-75`, and
    `SettingsAuditService.record` sets neither (`settings-audit/settings-audit.service.ts:205-221`).
    Filling them makes a sealed batch **undoable as a batch**, because `changes.fields[*]`
    already stores `{from, to}` (`:89-91`) and `/logs` already filters this table by
    `correlation_id` (`logs/logs-timeline.service.ts:302`). The reader exists and is unfed.
    Salesforce's Setup Audit Trail is the counter-example: it records who changed what and
    does not capture field-level before-and-after values, so it can never be an undo
    (<https://www.salesforceben.com/setup-audit-trail-keep-track-of-metadata-changes-in-salesforce/>).

    **Blocking precondition, and it belongs to this page.** `PUT /settings/approval-thresholds`
    is guarded by `@UseGuards(JwtAuthGuard, TenantGuard)` and **no role decorator**
    (`settings/settings.controller.ts:40,107`), so any authenticated member of the tenant can
    today rewrite the policy that decides who may seal an order. `@Roles()` and `RolesGuard`
    exist (`auth/decorators/roles.decorator.ts`, `auth/guards/roles.guard.ts`) and are used on
    exactly two controllers (`auth.controller.ts`, `vendor-intel.controller.ts`). The
    assistant does not create this hole, but it makes it reachable by sentence. OWASP names
    the class: independent authorization enforcement, never the model's own judgment
    (<https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html>).
    **This gate ships before the assistant does.**

32. **Drop `public.tmp_dropped_column_defaults_20260903` — on or after 2026-10-04.**
    A dated, bounded chore, filed the day the table was created so it cannot
    become permanent by inattention.

    **What it is.** Migration `20260903170000_a_default_is_not_an_answer.sql`
    §2 photographs the pre-change values of the three columns it clears —
    `(provider id, lead_time_days, payment_terms)` and
    `(restaurant id, timezone)` — into that table before §3 nulls them, and §3
    asserts **per column** that the photograph caught exactly the rows the
    UPDATE went on to clear. The founder asked for it on 2026-09-04 after
    reading the erasure cost in §13.26.

    **Why it must go, and why the date is not a formality.** It is a record, not
    a restore path: a value equal to a column default is unattributable, which is
    the entire premise of the migration, so the snapshot cannot tell a real
    "7 days" from a fabricated one either. Restoring it wholesale would restore
    the fault. Left in place indefinitely it becomes a **second copy of the
    fabricated answers** — one that no reader sweep covers, that no guard checks,
    and that the next person to find it will reasonably mistake for data. That is
    strictly worse than never having taken it.

    **The chore.** One migration: `DROP TABLE IF EXISTS
    public.tmp_dropped_column_defaults_20260903;`. Nothing reads it — RLS is on,
    `anon` and `authenticated` are revoked, and no application code references
    the name (grep before dropping; if that grep finds a reader, the reader is the
    bug). If the founder wants the erasure preserved beyond a month, the answer is
    an export taken deliberately and stored outside the database, **not** an
    un-dropped table.

33. **Drop `public.tmp_dropped_report_clocks_20260904` — on or after 2026-10-04.**
    The twin of §13.32, for migration
    `20260904190000_a_report_has_no_default_clock.sql`. Same shape, same
    argument, same date: `DROP TABLE IF EXISTS
    public.tmp_dropped_report_clocks_20260904;`, nothing reads it, and a
    snapshot kept indefinitely stops being a record of an erasure and becomes a
    second copy of the erased answers. Both drops can be one migration.

### 13.34 — the house's currency stopped being a default, and this page shows it

**Done 2026-09-05, ADR 0117 Q25.** `20260903170000_a_default_is_not_an_answer.sql`
dropped `restaurants.timezone`'s default and explicitly left
`restaurants.currency DEFAULT 'USD'` standing, filing it here because it had not
been decided. It has been now: measured on production, that default had put
`USD` on **all fourteen** houses including two in Türkiye and one in London.
`20260905120000_a_house_names_its_money.sql` drops it and adds an ISO-4217-shape
CHECK.

What changed on this page: `VendorTermsSection` now distinguishes **two states
that used to be one**. `reg.currency.code === null` means nobody has been asked
and the panel says so in a sentence; a stored `USD` still carries the older
"this was also the column's default" caveat, because the migration deliberately
did NOT clear the ten US houses that already hold it and nothing can yet tell a
chosen `USD` from an inherited one (that is Q30, and it is a write).
`lib/mudavym/format.ts`'s `fmtMoney` takes `string | null` and renders an
unrecorded currency as `1,200 (currency not recorded)` — never a symbol, because
a currency mark is a claim about the amount.

Still open here: `manager_preferences.report_timezone` and
`manager_report_profiles.timezone` (§13.32's neighbours) are untouched. ~~and so
is whether `/settings` should let a house SET its currency at all — today the
only place it can be stated is the sign-up form.~~ **Answered 2026-09-05: it
does — see §13.35.**

### 13.35 — after the clearing pass, this page is where the answer has to live

**Raised 2026-09-05, ADR 0117 Q30/Q35.** The founder's call — *"Clear all eleven
to unrecorded; the onboarding step asks"* — sets `restaurants.currency` to NULL
on every house still carrying the old column default. Eleven qualify.

`VendorTermsSection` already renders that state honestly ("this house has not
recorded the money it reports in"), which is §13.34's work. What it does not do
is offer to fix it, and **the sign-up form is the only place in the product that
can set a currency at all**. So after the apply, eleven houses are told a true
thing they have no way to act on — which is the shape this page exists not to
have.

The fix is a field, not a decision: `/settings` writes `restaurants.currency`
through the same shape the sign-up step uses (`lib/currency.ts`
`currencyToRecord`, the ISO-4217 picker, "not recorded" as a real answer). It
should land before the clearing pass gets far ahead of it.

**CLOSED 2026-09-05.** Both pages carry the field.

* Gateway — `apps/api-gateway/src/settings/house-currency.service.ts`, routed as
  `GET /settings/currency` and `PUT /settings/currency`
  (`settings.controller.ts`). The write is gated by
  `assertCanManageRestaurant` (the same helper the flags and the thresholds
  call), validates `^[A-Z]{3}$` — the migration's own CHECK, so a value the
  route accepts is a value the database accepts — and files a
  `reporting_currency_changed` row in `system_audit_log` naming the actor and
  both codes. The receipt travels back as `audited` / `auditReason`, so an
  audit row that failed is visible rather than assumed.
* Rebuilt page — register 05 "Currency" under *The house*
  (`pages/settings/next/CurrencySection.tsx`). The country's default is
  OFFERED and stated in a sentence before Record writes it; nothing is ever
  written by opening the page.
* Legacy page — `ReportingCurrencySection` (`pages/Settings.tsx`, section
  `?tab=currency`), the same three rules, because the rebuild is behind a flag.

Also closed here: the §13.34 tail asking *"whether `/settings` should let a
house SET its currency at all"*. It does.

Not closed: `manager_preferences.report_timezone` and
`manager_report_profiles.timezone` are still untouched.

### 13.36 — What holding stock costs this house (CLOSED 2026-09-06)

**The founder, 2026-09-05 batch 59, answering the commodity plan's §12 Q5:** *"Twice a
year, and the house types its carrying cost."*

* Column — `restaurants.carrying_cost_percent_per_month`
  (`20260906140000_a_carrying_cost_is_typed_by_a_person.sql`), `NUMERIC(5,3)`, nullable,
  **no default**, with `carrying_cost_set_by` (→ `public.users`, `ON DELETE RESTRICT`),
  `carrying_cost_set_at` and an optional `carrying_cost_basis`. Two CHECKs: the value,
  the author and the moment are one fact; and the value is a plausible PERCENT a month.
  PGlite-proven — applied twice, seven refusals and three admissions measured, zero rows
  backfilled, the author FK inside `public`.
* Route — `GET`/`PUT /settings/carrying-cost`, manager-gated by
  `assertCanManageRestaurant`, audited under the new `carrying-cost` register and the
  `carrying_cost_changed` action, with the receipt on the readout.
* Rebuilt page — register 06 "Carrying cost" under *The house*
  (`pages/settings/next/CarryingCostSection.tsx`). Nothing is offered as a starting
  value, because unlike a currency nothing implies a carrying cost; the sentence under
  the field says exactly what Record will write, in a month AND in a year.

**A defect found and fixed while doing it.** `settings-audit.controller.ts`'s `REGISTERS`
allow-list — the values `?register=` may filter to — **omitted `currency` from the day
that register was added**: `PUT /settings/currency` wrote `register: "currency"` rows and
`GET /settings-audit?register=currency` answered 400 naming five registers that did not
include it. An omission there reads to a caller as "that register does not exist" while
rows for it are being written all the same. Both `currency` and `carrying-cost` are now
in the list.

**Not closed**: nothing in the product yet READS
`restaurants.carrying_cost_percent_per_month` at runtime — the commodity alert is still
dark (`COMMODITY_ALERT_DARK` off) and its money clause is exercised in
`cadence-value.spec.ts` rather than on a screen. The register is the input; the reader is
phase 1.
