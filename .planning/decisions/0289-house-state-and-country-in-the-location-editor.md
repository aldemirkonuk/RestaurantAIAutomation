# 0289 — An owner sets the house's state and country in the location editor

- **Status:** Locked. The choice of (a) is the founder's, 2026-10-04 ~00:30Z. The two
  forks it left open were his too, answered 2026-10-04 ~02:10Z and quoted where they
  apply: R1's owner is *the house's owner*, and R3's United States house *must record
  its state*.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** state, country, state_province, jurisdiction, location editor, owner only, settings log, market index, retention, A-052, AW26
- **Links:** [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (Q33, the one country table),
  [[0118-the-house-writes-its-own-mail]] (retention), [[0213-get-started-is-account-then-house-then-first-proof]] (rows 8-9),
  [[0112-one-modal-policy-three-shapes-one-primitive]] / [[0042-iznik-seal-and-warm-charcoal]] (the frozen legacy branch),
  [[0020-no-fabricated-answers]], [[0240-register-entries-are-fragments]];
  claims `claims.d/feat-house-state-in-location-editor.jsonl`; brief `p4-scratch/sim-run/fixes/briefs/stateeditor.md`

## Context

The analytics walk on Tuzlu Rüzgar (read-only, production, 2026-10-03) found the market
index telling a house that records country `US` and no state: *"Set the state in Settings
to scope an index line"* (`apps/api-gateway/src/price-index/price-index.service.ts:419`).
No control anywhere could do that for a house that already existed:

- `UpdateLocationDto` declared neither key, so `ValidationPipe({ whitelist: true })`
  (`organizations.controller.ts:36`) stripped both in silence;
- the controller forwarded `chainId, name, city, email, phone` and the service patched
  those five columns;
- the only location editor in Settings, `EditLocationChainDialog`, sent chain, name and
  city.

The Add-location dialog's State field creates a *new* branch. Get-started does not ask for
the state either, by ADR 0213 rows 8-9.

The same unfollowable instruction stands in three more sentences:

- `price-index.service.ts:291`
- `price-index.controller.ts:129`
- `distributor-feed.service.ts:154`

All three say "Set the address in Settings".

## Options considered

1. **(a) Add the state and country to the location editor**: owners only, recorded in the
   log. This makes the four sentences true. It also re-scopes every reader of the pair (R6).
2. **(b) Reword the four sentences until a control exists.** This is honest and cheap, but it
   leaves a US house with no way to scope an index line. The founder did not pick it.
3. **(c) Ask for the state at get-started.** This reopens ADR 0213 rows 8-9, and it does
   nothing for houses that already exist, which is the defect.
4. *Doing nothing*: the market index keeps instructing an owner to do something no page does.

## Decision

**(a)**, in the founder's words: *"Add it to the editor (Recommended)"*. The option he
picked read: *"Add state and country to the location editor, changed by owners only and
recorded in the log. This also re-scopes mail retention and the commodity/distributor
panels, which read the state."* The rules that carry it out:

**R1. Who may change it: an owner of this house.** The founder, 2026-10-04 ~02:10Z,
verbatim pick: *"The house's owner (Recommended)"*. The rejected readings were the
organisation's owner (the ADR 0164 gate on opening a location) and either one.

- The role is read strictly, per restaurant, through the same reader the rest of the
  service uses (`readRestaurantRole`). The question put to him named the source as
  `restaurant_members`. No table of that name exists: it has no hits in `supabase/` or
  `apps/api-gateway/src`. The house role lives in `user_restaurant_access`, with the
  legacy `users.role` as the fallback, both read by `lookupRestaurantRole`
  (`organizations.service.ts:44`). `authority-grants.service.ts` `assertOwner` reads the
  role through the same function. The web's `isOwner` (`useSettingsNextData.ts:1028`)
  means the same house role, but takes it from the session's active house, which is why
  the editor asks the gateway for `callerRole` instead (R8).
- A manager or staff member is refused with 403. A PATCH that mixes a rename with the
  pair is refused **whole**: the gate runs before any write, so nothing half-lands.
- A role that cannot be read is 503 ("…could not be read… Nothing was changed"), never
  a guess.
- The rest of the PATCH (name, city, chain, email, phone) keeps its existing
  manager-or-owner gate, unchanged.

**R2. The pair travels together.**

- Sending either key without the other is refused, because the state is read against the
  country it is sent with.
- `null` is a real answer for the state ("none"). The country cannot be cleared.

**R3. The state is checked against the country**, using the one country table the
onboarding path uses (`apps/web/src/lib/countries.ts`, ADR 0117 Q33). The market index,
the price-book review, and the commodity and distributor panels are **region first**: a
state that resolves wins over the country (`price-index.service.ts:256-275`,
`price-index-review.service.ts:390-405`, `commodity.service.ts:214-236`,
`distributor-feed.service.ts:115-146`). For those
readers a mismatched pair is worse than a missing one. `GA` on an Indian house reads as
Georgia, `WA` on an Australian house reads as Washington, and `England` on a Turkish
house reads as GB-ENG. Retention's `resolveJurisdiction` is country first and reads the
state only for California, and the country-only readers of R6 never read the state.

- **United States:** the state is required. The founder, 2026-10-04 ~02:10Z, verbatim
  pick: *"Required for US (Recommended)"*; the rejected option kept it optional, as the
  Add-location dialog's free-text State is at creation. It must resolve to
  a US state (`CA`, `California` and `US-CA` all do) and is written as the two-letter code.
  The two-letter code is what retention's `resolveJurisdiction` (`retention-rules.ts:282-313`)
  matches; it matches `CA` and `CALIFORNIA`, never `US-CA`.
- **United Kingdom, Turkey:** the state is blank, or it must be one of the country's
  subdivisions: England, Scotland, Wales or Northern Ireland, or one of the 81 provinces.
  A publication extent (`GB-EAW`, `GB-GBN`, `GB-UKM`) is refused.
- **Any other country:** the state is free text. It is refused only when it resolves to a
  different country.
- The country is matched by ISO code. Sending back the same country under another
  spelling (`US` stored, `United States` sent) is **not** a move. It writes nothing and
  files nothing. A moved country is written under the table's display name.
- Every refusal ends "Nothing was changed."

**R4. Recorded in the settings log, and the record is not assumed.**

- Each move files one `system_audit_log` row through `SettingsAuditService.record`:
  - action `house_state_country_changed`;
  - register `state-and-country`;
  - the actor;
  - the house's name after the write as its subject;
  - **only the fields that moved**, `{from, to}`.
- The log write is a second call, not a transaction, so the PATCH answers with a receipt:
  `{stateAndCountry: "not-sent"|"unchanged"|"changed", audited, auditReason}`.
- The sheet shows that receipt until it is read. If the log refused the row, the change
  stands and the sheet says so, with the reason. An answer with no receipt is shown as
  "Saved, unconfirmed", never as recorded (ADR 0020).

**R5. Every register the log's type admits reads back by name.**

- `readRegister` held a hand-typed list of the first five registers. A row filed under
  any of the seven added since (currency through ask-training) read back as
  `register: null`, so `?register=` filtered it away. ConsentPanel's ask-training trail
  (`ConsentPanel.tsx:91`) was showing nothing it had recorded.
- It now reads through a `Record<SettingsRegister, true>`, which the compiler holds to the
  union in both directions.
- This is fixed here because the new register would otherwise have been the eighth
  casualty.

**R6. The readers this re-scopes.** The pair is read by each of these, so an owner's change
moves what they show or keep.

*State first, then country:*

- **Market index:** `price-index.service.ts:256`.
- **Price-book review:** `price-index-review.service.ts:390` and `:430`. The jurisdiction
  of a house pools its owners and managers with that jurisdiction's admitters.
- **Commodity panel:** `commodity.service.ts:214`.
- **Distributor panel:** `distributor-feed.service.ts:115`.
- **How these resolve:** `normalizeJurisdiction` is at `price-index.registry.ts:482` and
  `countryOf` at `price-index/jurisdiction.ts:237`.

*Mail retention:*

- `raw-mail-retention.service.ts:249`/`:252`, the quarterly derive.
- `:930`, the disclosure.
- `house-mail-archive.service.ts:1239`/`:1244`, the rule stamped on an archived copy.

*Country only:*

- **The currency the Settings page offers first:** `house-currency.service.ts:249`.
- **The time zones the Settings page offers first:** `house-time-zone.service.ts:194`.
- **Vendor scorecard:** `providers/scorecard/vendor-scorecard.service.ts:190`.
- **Team:** `team.service.ts:1600` and `:1911`.
- **Schedule:** `schedule.service.ts:206`.
- **Procurement:** `procurement.service.ts:3775`.
- **Arrival asks:** `arrival-asks.service.ts:130`.
- **Low-stock alerts:** `low-stock-alerts.service.ts:1543` and `:1576`.
- **Analytics:** `advanced-analytics.service.ts:144`.
- **Web:** `pages/team/next/tm-format.ts` and `pages/providers/next/vendor-scope.ts`.
- **SQL:** the territory gate's `normalize_country_code`.

A moved country changes which currency and which time zones the Settings page **offers
first**. It never sets either one: both services return the country verbatim as a
suggestion and write only a value that arrives in the request ("never derived from the
country, never defaulted", `house-time-zone.service.ts:26`; `house-currency.service.ts:42-43`).
Before Save, the sheet tells the owner the pair re-scopes the market index, the commodity
and distributor panels, and the statute named in the mail-retention notice (R7).

**R7. Retention moves, but deletes nothing sooner.**

- The raw-mail window (`figure_days`) is the house's own longest dispute plus a margin
  (`raw-mail-retention.service.ts:343-344`). The jurisdiction does not enter it.
- A moved state changes three things:
  - the jurisdiction and `facts_floor_years` written at the next quarterly derive
    (`:360`, `:384`);
  - the disclosure's statute;
  - the rule stamped on future archive copies (`house-mail-archive.service.ts:811`).
- No mail is swept earlier because of it.

**R8. Only the house surface has the control.**

- The Mudavym Sheet reads the pair from `GET /organizations/locations/:id` when it opens.
  That read now returns `country`, `stateProvince` and `callerRole`.
- What the sheet shows depends on the read:
  - **An owner:** gets the two fields.
  - **A manager:** sees the values and "Only an owner can change the state and country."
  - **A failed read:** offers no control. A field seeded with a guess would write the
    guess back.
- The legacy Radix branch stays byte-frozen (ADR 0112/0042) and never reads the pair.
  Settings' only mount of this dialog (`LocationsSection`, under `PageGate`'s next page)
  renders the Sheet.

## Consequences

- The four "Set the … in Settings" sentences now point at a control: Settings → Locations
  → Edit. They are left as written.
- **One country table, and its copy.** The gateway needs to validate, and it cannot import
  `apps/web`, so `organizations/house-state-country.ts` mirrors its 194 rows (code, name,
  aliases; currency dropped). `house-state-country.spec.ts` reads the web file **as text**
  and fails on any row that differs, as `common/iso-4217.spec.ts` does for currencies. The
  web file stays the source. A country added there fails the gateway's build until it is
  copied.
- **Corrected in the design, not in the brief:**
  - The service takes the settings log through `@Optional()`. `CommunicationsModule`
    provides `OrganizationsService` by class (`communications.module.ts:138`) for its
    role reads, and it cannot import `SettingsAuditModule` without closing the
    auth → communications ring at load time. A required parameter would have failed boot.
  - An instance built without the log still writes, and answers
    `audited: false` with the reason. It never claims a record.
- **Left stale, named rather than fixed (file budget):**
  - The comments that say OrganizationsModule imports only Database and Auth:
    `inventory.module.ts:14`, `procurement.module.ts:65` and `settings.module.ts:36`.
  - `LedgerSection`'s "not yet filed" list still names Locations & chains whole. Its name,
    city and chain still file nothing; the state and country now do. Its label for the
    new action is the generic fallback, "house state country changed".
- **Not touched:**
  - The creation writers in `auth.service.ts`, which set the pair when a house is born.
  - The deferred PR-B forks.
- **Revisit when:**
  - a second surface (mobile, a legacy Settings) needs the control;
  - the gateway gains a workspace package the country table can live in, which retires
    the mirror.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | — | Created on `feat/house-state-in-location-editor` (lane `stateeditor`, A-052/AW26) |
| 2026-10-04 | Independent verifier, round 1 | The founder's 02:10Z answers quoted and R1/R3 locked; the region-first claim scoped to the market readers; the retention sentence and the currency/time-zone line narrowed to what the code moves |
