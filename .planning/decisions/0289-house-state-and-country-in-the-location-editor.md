# 0289 — An owner sets the house's state and country in the location editor

- **Status:** Locked, as built. The founder's four answers are each quoted where they
  apply: the choice of (a), 2026-10-04 ~00:30Z, *"Add it to the editor (Recommended)"*;
  R1's owner and R3's United States rule, 2026-10-04 ~02:10Z, *"The house's owner
  (Recommended)"* and *"Required for US (Recommended)"*; and the method, answered
  2026-10-07 at 12:54:16Z **[corrected 2026-10-07: was "recorded 12:54:27Z; the answer's own second was not taken". 12:54:27Z was when the coordinator ran `date -u`; the transcript stamps the answer itself at 12:54:16Z.]**, *"Keep all, as
  built (Recommended)"*, which keeps R2, R3, R4, R5 and R8 as built (quoted under "The
  founder's words, 2026-10-07"). Two consequences of R3 were not in that question and
  stay his open forks: US territories, and two-letter provinces abroad (see "Open forks").
  Until he answers them, the code refuses both, as built. **[2026-10-07, 14:41:21Z: he
  answered the first. Every ISO country code goes in the country table, in a follow-up
  PR; this PR is unchanged. For the second he asked for research before he rules. Both
  are quoted under "Open forks".]** **[2026-10-07, 19:48:13Z: after the research he
  answered the second. A two-letter province abroad is to be kept and read inside the
  house's country, which supersedes R3's refusal in follow-up PRs. A house with no
  country is to be asked for one. This PR is unchanged, and both are quoted under "Open
  forks".]** **[Locked 2026-10-07 by that
  answer. Was: "Locked for the ruling, and Proposed for the method. The ruling is the
  founder's, in three answers, each quoted where it applies: the choice of (a),
  2026-10-04 ~00:30Z, *"Add it to the editor (Recommended)"*; and the two forks it left
  open, answered 2026-10-04 ~02:10Z: R1's owner, *"The house's owner (Recommended)"*, and
  R3's United States rule, *"Required for US (Recommended)"*. Everything else below is
  lane stateeditor's design, built for his review: among it R2, R3's rules for the
  United Kingdom, Turkey, every other country and a state that resolves to another
  country, R4's receipt, R5 and R8."]**
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
panels, which read the state."* The rules that carry it out are the lane's method, which
the founder kept as built on 2026-10-07 (quoted after R8); R1 and R3 also carry his
answers of 2026-10-04. **[Bracketed 2026-10-07. Was: "The rules that carry it out are
the lane's method, proposed for his review, except the two answers quoted in R1 and
R3:"]**

**R1. Who may change it: an owner of this house.** The founder, 2026-10-04 ~02:10Z,
verbatim pick: *"The house's owner (Recommended)"*. The rejected readings were the
organisation's owner (the ADR 0164 gate on opening a location) and either one.

- The role is read strictly, per restaurant, through the same reader the rest of the
  service uses (`readRestaurantRole`). The question put to him named the source as
  `restaurant_members`. No table of that name exists: it has no hits in `supabase/` or
  `apps/api-gateway/src`. The house role lives in `user_restaurant_access`, with the
  legacy `users.role` as the fallback, both read by `lookupRestaurantRole`
  (`organizations.service.ts:44`). `authority-grants.service.ts` `assertOwner` reads the
  role through the same function. The web's `isOwner` (`useSettingsNextData.ts:1036`; **[line moved 2026-10-07 by the
  merge of #620: was `:1028`]**)
  means the same house role, but takes it from the session's active house, which is why
  the editor asks the gateway for `callerRole` instead (R8).
- A manager or staff member is refused with 403. A PATCH that mixes a rename with the
  pair is refused **whole**: the gate runs before any write, so nothing half-lands.
- A role that cannot be read is 503 ("…could not be read… Nothing was changed"), never
  a guess.
- The rest of the PATCH (name, city, chain, email, phone) keeps its existing
  manager-or-owner gate, unchanged.

**R2. The pair travels together.** *Kept as built by the founder, 2026-10-07.*

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
*Kept as built by the founder, 2026-10-07; two of its refusals stay his open forks (see
"Open forks").*

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

**R4. Recorded in the settings log, and the record is not assumed.** *Kept as built by the
founder, 2026-10-07.*

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

**R5. Every register the log's type admits reads back by name.** *Kept as built by the
founder, 2026-10-07.*

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
- **The time zones the Settings page offers first:** `house-time-zone.service.ts:283`
  **[line moved 2026-10-07 by the merge of #620: was `:194`]**.
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
suggestion and write only a value that arrives in the request. The currency service
"never derives one from the country" (`house-currency.service.ts:42-43`). The time-zone
service's PUT writes the zone it was sent, with source `stated`
(`house-time-zone.service.ts:234-240`), and its rule 1 reads "never defaulted and never
written on a read" (`:28`). `updateLocation`'s patch carries no `timezone`, so a moved
pair moves no zone. ADR 0304's PR-5, not merged, plans to make `updateLocation` move an
address-derived zone with the address (its F4) and to bracket this ADR. **[Corrected
2026-10-07 at the merge of #620 (ADR 0304 PR-1), which rewrote the time-zone rule. Was:
"both services return the country verbatim as a suggestion and write only a value that
arrives in the request ("never derived from the country, never defaulted",
`house-time-zone.service.ts:26`; `house-currency.service.ts:42-43`)."]**
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

**R8. Only the house surface has the control.** *Kept as built by the founder, 2026-10-07.*

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

## The founder's words, 2026-10-07 (verbatim, binding)

Answered 2026-10-07 at 12:54:16Z **[corrected 2026-10-07: was "recorded 12:54:27Z; the answer's own second was not taken". 12:54:27Z was when the coordinator ran `date -u`; the transcript stamps the answer itself at 12:54:16Z.]**, with
AskUserQuestion:

- **Question:** *"#613 (owner sets the house's state and country): you ruled the state is
  required for a US house. The rest of how it works is the lane's design and is waiting on
  you: (R2) state and country are always saved together, 'no state' is a real answer, and
  the country can't be cleared; (R3) the state is checked against the country with the
  same country list as sign-up, and price and market panels use the state before the
  country; (R4) every change writes one settings-log row and the page doesn't assume the
  save worked; (R5) the settings log now reads back every kind of row by name, not just
  the first five kinds; (R8) only the house page has the control, and a manager sees it
  read-only. Keep all of these?"*
- **Picked:** **"Keep all, as built (Recommended)"**. The option text was: *"Locks ADR 0289
  as built. No code change; the PR can go to merge after its re-audit."*
- **Rejected:** *"I want to change one"*. The option text was: *"Say which in a note. Any
  change is a code change in #613 and one more audit."*

The question named R2, R3, R4, R5 and R8. R6 and R7 record what the code re-scopes; they
were not put to him as choices.

## Open forks (the founder's, not decided here)

Both follow from R3 as built, and neither was in the 2026-10-07 question. Until he
answers, the code refuses both.

1. **US territories.** On a United States house, `PR` and `Guam` are refused as "not a
   United States state" (`house-state-country.ts` `checkStateFor`, probed 2026-10-07 at
   the merged head), and the country table has no row coded PR, GU, VI, AS or MP. A house
   in a territory cannot save the pair.

   **[Answered 2026-10-07, 14:41:21Z, with AskUserQuestion (verbatim, binding).**
   - **Question:** *"#613: Puerto Rico, Guam and the other US territories can't save an
     address at all today. How should the country list handle places like them?"*
   - **Picked:** **"Every ISO country code (Recommended)"**. The option text was: *"Add
     about 54 rows (Puerto Rico, Guam, Hong Kong, Gibraltar, Réunion…), each with its own
     currency, clock and address search. A follow-up PR; #613 merges as locked. Missing DR
     Congo and Côte d'Ivoire get fixed as a defect either way."*
   - **Rejected:** *"Just the US territories"* (*"Add only the five US territories as their
     own entries. Smaller, but the same gap stays for Hong Kong, Gibraltar and the
     rest."*) and *"Write them as US states"* (*"Pick 'United States' and write PR as the
     state. Brazil's PR (Paraná), Spain's GU/VI and India's AS/MP would then start reading
     as US territories, and the address search for 'United States' doesn't find San
     Juan."*).

   So the country table becomes every ISO 3166-1 code, territories as their own
   countries, in a follow-up PR. The same PR adds the two sovereign states the table lacks
   today, CD (DR Congo) and CI (Côte d'Ivoire), which is a defect, not a fork. This PR's
   code is unchanged: until the follow-up lands, a territory house still cannot save the
   pair.**]**
2. **Two-letter provinces abroad.** On any other country, a two-letter state that reads as
   a US state is refused: `MI` on an Italian house, `CA` on a Spanish one, `NH` on a Dutch
   one (probed the same way). The refusal names the way out: write the name in full, or
   leave the state blank.

   **[2026-10-07, 14:41:21Z: asked, not yet ruled.** The question was: *"#613: you kept
   'refuse a US state code on a foreign house' today. An Italian owner writing 'MI' for
   Milan is refused, while houses added another way with 'MI' are read as Michigan by the
   market panels. Change that ruling?"*. Its options were *"Read it within the country
   (Recommended)"* and *"Keep refusing, as locked"*. He picked neither and wrote:
   *"research on how industry do it? in italy they would just write the city's name and
   they don't do like US satet  short writings so."* R3 stays locked as built until he
   rules. The research is under way, and its result goes back to him as a fresh
   question.**]**

   **[Answered 2026-10-07, 19:48:13Z, with AskUserQuestion, after the research
   (`p4-scratch/sim-run/fixes/audits/research-r3-subdivisions-2026-10-07.md`;
   verbatim, binding). This supersedes R3's refusal of a two-letter province abroad, in
   follow-up PRs.**
   - **Question:** *"The research is back (fixes/audits/research-r3-subdivisions-2026-10-07.md).
     Italian addresses do carry a two-letter province code: Poste Italiane's standard
     requires '20133 MILANO MI', and Google's address data, Shopify and Italy's e-invoice
     format all expect it. What nobody does is read that code as a US state. Every standard
     looks the code up inside the address's own country (IT-MI is Milano, US-MI is
     Michigan). Our market panels are the odd one out: they read a bare 'MI' as Michigan
     whatever the country. That reader fix ships either way as a defect fix. What should
     the location editor do with 'MI' on an Italian house?"*
   - **Picked:** **"Keep it, read inside the country (Recommended)"**. The option text
     was: *"Supersedes R3. The editor stops refusing and keeps what the owner writes (code
     or name), and Italy's field is labelled 'Provincia (sigla, es. MI)'. This is how
     Google, Stripe and Yelp work. The readers are fixed first, then the editor, in
     follow-up PRs; #613 merges as locked."*
   - **Rejected:** *"Check Italy's own list"* (*"The same, but the server accepts only
     Italy's 111 province codes or names for an Italian house and refuses anything else
     (Shopify's model). It catches typos, but the list has to be kept current: Sardinia's
     codes already differ between Google and ISO."*) and *"Keep refusing, as locked"*
     (*"20 Italian province codes (MI, CO, PA, VA…) stay unsavable in the editor. The
     editor's hint 'Kept as you write it' then contradicts it."*).

   **A second answer, same call:**
   - **Question:** *"Once the market panels read the state inside the house's country,
     what does a house with no country recorded get? (One of 14 houses had none at the
     2026-09-05 count.)"*
   - **Picked:** **"Ask for the country (Recommended)"**. The option text was: *"The
     panels say the country isn't recorded and link to Settings, the same way a house with
     no time zone is handled. Nothing is guessed. That one house sees no state-based prices
     until the owner sets it."*
   - **Rejected:** *"Treat it as US"* (*"A US state code on a no-country house is read as
     the US state, as today. A real US house with no country keeps its prices, but an
     Italian house with no country and 'MI' still reads as Michigan."*).

   **What follows, in order, none of it in this PR:**
   1. A defect-fix PR. The five market readers read a state only inside the house's own
      country, and a house with no country is asked for one. The readers are the price
      index, price-index review, commodity and distributor-feed call sites listed in the
      research note.
   2. A follow-up PR with a new ADR that supersedes R3's refusal. The editor keeps a
      two-letter province abroad, and Italy's field is labelled "Provincia (sigla, es.
      MI)". It must land after step 1, or the editor writes rows the old readers take for
      Michigan.

   This PR's code is unchanged, and it still refuses as built until those land.**]**

## Consequences

- The four "Set the … in Settings" sentences now point at a control: Settings → Locations
  → Edit. They are left as written.
- **One country table, and its copy.** The gateway needs to validate, and it cannot import
  `apps/web`, so `organizations/house-state-country.ts` mirrors its 194 rows (code, name,
  aliases; currency dropped). `house-state-country.spec.ts` reads the web file **as text**
  and fails on any row that differs, as `common/iso-4217.spec.ts` does for currencies. The
  web file stays the source. A country added there fails that jest parity spec, and so
  CI, until it is copied.
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
  - `communications.module.ts:42`, which says `organizations.service.ts` imports only
    DatabaseService. It now also imports `SettingsAuditService` and the country check
    (`house-state-country.ts`), beside `org-role` and `sign-up-timezone`, which it
    imported on `origin/main` already.
  - `settings-audit.module.ts:14`, which calls `SettingsModule` the module's only
    consumer. `pricing.module.ts` and `vendor-terms.module.ts` imported it on
    `origin/main` already, and `OrganizationsModule` now does too.
  - `LedgerSection`'s "not yet filed" list still names Locations & chains whole. Its name,
    city and chain still file nothing; the state and country now do. Its label for the
    new action is the generic fallback, "house state country changed".
- **Readers that misread a country name** (added 2026-10-07 from the ADR 0090 audit at
  `c5f27f7a8`; re-measured at the merged head on Node v20.20.0 over the table's 194
  names). These readers are on `origin/main` and get-started writes the same names; the
  editor is one more way to reach them. Not fixed here: the founder's 2026-10-07 answer is
  "No code change", and this PR is at 15 files, so a `tech-debt.d` fragment is owed on a
  later branch.
  - `normalizeJurisdiction("Georgia")` (`price-index.registry.ts:494`) returns `US-GA`,
    the only one of the 194 names that resolves to another country. A Georgia (GE) house
    whose state is blank or does not resolve is read as US-GA by the market index
    (`price-index.service.ts:271-274`) and by the price-book review
    (`price-index-review.service.ts:401-407`), which pools its owners and managers with
    US-GA's admitters. R3 accepts that pair: `checkStateFor("GE", "")` writes null.
  - `countryCodeOf` (`common/house-frame.ts:151`) gives a wrong code for 6 names (Germany
    DD, Serbia CS, Vietnam VD, Yemen YD, Zimbabwe RH, Vanuatu NH) and none for 10 (Turkey,
    Antigua and Barbuda, Bosnia and Herzegovina, Congo, Czech Republic, Saint Kitts and
    Nevis, Saint Lucia, Saint Vincent and the Grenadines, Sao Tome and Principe, Trinidad
    and Tobago). `houseFrame` (`:212-218`) takes its region, its locale and its fallback
    zone from that code. It is imported by `vendor-scorecard.service.ts`,
    `dashboard.service.ts`, `team.service.ts`, `arrival-asks.service.ts`,
    `procurement.service.ts`, `pos-hub/refused-checks-note.ts` and
    `advanced-analytics.service.ts`.
  - The SQL `normalize_country_code` (migration
    `20260811000000_fix_territory_gate_normalization`) maps 113 names. 81 of the 194 pass
    through it uppercased.
  - Written as codes instead, the 194 read back as themselves through `countryCodeOf`, but
    22 read as US states through `normalizeJurisdiction` (CA Canada → US-CA, DE Germany →
    US-DE, IN India → US-IN, among them). Neither spelling reads right through both.
  - No spec reads the 194 names back through these readers.
- **Known limits of the build, named and not fixed** (added 2026-10-07 from the same
  audit; the founder's answer is no code change):
  - A state that differs only in spelling is filed as a move. The state is compared as
    text (`organizations.service.ts:572`) and the country by code (`:568`), so a stored
    `California` sent as `CA` is written as `CA` and files a `house_state_country_changed`
    row, though the market readers resolve both to US-CA.
  - The old values are read before the UPDATE, and the UPDATE has no condition on them
    (`organizations.service.ts:611-615`). Two owners saving at once can each file a stale
    `from`; the last write stands.
  - Outside the United States, the United Kingdom and Turkey the state is written as sent,
    trimmed: `"Tbilisi\nfoo"` on an Italian house is accepted, and so is a state ending in
    a NUL. Postgres text cannot hold a NUL, so that UPDATE is expected to fail and the
    PATCH to answer 500 (`:616-617`). No test covers it.
- **Not touched:**
  - The creation writers in `auth.service.ts`, which set the pair when a house is born.
  - The deferred PR-B forks.
- **Revisit when:**
  - a second surface (mobile, a legacy Settings) needs the control;
  - the gateway gains a workspace package the country table can live in, which retires
    the mirror;
  - #561 (open on 2026-10-07) lands. It rewrites `lookupRestaurantRole`, which R1's gate
    and `callerRole` read through. Whichever of #561 and this PR merges second re-runs
    `house-state-country.spec.ts` and `get-location-is-role-gated.spec.ts`; if #561 drops
    the `users.role` fallback, R1's sentence naming it needs a bracket;
  - ADR 0304's PR-5 makes `updateLocation` move an address-derived zone (its F4).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | — | Created on `feat/house-state-in-location-editor` (lane `stateeditor`, A-052/AW26) |
| 2026-10-04 | Independent verifier, round 1 | The founder's 02:10Z answers quoted and R1/R3 locked; the region-first claim scoped to the market readers; the retention sentence and the currency/time-zone line narrowed to what the code moves |
| 2026-10-04 | Final reviewer, HOLD | Status split into Locked for the ruling and Proposed for the method (ADR 0285's pattern), and the index row moved to the Proposed table; the Locations note scoped to the section's own edits, since currency, time zone, carrying cost, tone scoring, data terms and target margin also write the row and file settings-log rows; two more stale comments named |
| 2026-10-06 | ADR 0090 audit at `c5f27f7a8`, PASS | No block; owed records named (readers that misread a country name, three minor limits, the #561 re-run) |
| 2026-10-07 | Prep fixer, after merging origin/main `5e6c0684e` | Status Locked as built by the founder's 2026-10-07 answer, quoted verbatim; the US-territory and two-letter-province refusals listed as his open forks; the audit's owed records added under Consequences; the time-zone and `isOwner` cites moved by #620 corrected in brackets |
| 2026-10-07 | Coordinator, after the founder's 14:41:21Z answers | Open fork 1 answered (every ISO country code, in a follow-up PR; CD and CI filed as a defect), quoted verbatim; open fork 2 put to him and sent back for research, his reply quoted; the 2026-10-07 answer time corrected from 12:54:27Z to 12:54:16Z in brackets |
| 2026-10-07 | Coordinator, after the founder's 19:48:13Z answers | Open fork 2 answered after the research, "Keep it, read inside the country (Recommended)", which supersedes R3's refusal in follow-up PRs (readers first, then the editor). The no-country rule is answered, "Ask for the country (Recommended)". Both are quoted verbatim, and this PR's code is unchanged |
