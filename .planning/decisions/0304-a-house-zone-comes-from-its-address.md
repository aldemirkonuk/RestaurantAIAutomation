# 0304 — A house's time zone comes from its address, and says where it came from

- **Status:** Locked for the ruling, and Proposed for the method until PR-2 merges. The ruling is the founder's: four answers on 2026-10-04 ~22:35Z and four fork answers on 2026-10-05T01:17Z, all quoted verbatim below. The method (the order, the tables, the two columns, the witness rule and the five PRs) is lane zoneaddr's proposal, built for his review. The five readings under "Readings" are the lane's and he may overrule any of them. Reading 5 (a zone with no recorded source that an audit row witnesses reads as stated) is built in PR-1 and awaits his answer.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** time zone, timezone, restaurants.timezone, timezone_source, timezone_source_zone, restaurants_timezone_source_known, from the address, from the device, stated, source not recorded, witness, house_time_zone_changed, PUT /settings/time-zone, Settings → Time zone, Hours, certainty, inferred, sign-up zone, device zone, browser zone, one-clock countries, US state zone, territory, back-fill dry run, a default is not an answer
- **Links:** migration `a_house_zone_says_where_it_came_from` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/feat-zone-from-the-address.jsonl`; [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]]; [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] (q10 and round 3); [[0213-get-started-is-account-then-house-then-first-proof]] (rows 8 and 9, item 62); [[0111-the-calendar-is-the-houses-day-book]] (row 2); [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (Q33); [[0224-every-host-the-code-can-send-to-is-named-or-excused]]; [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (the digest's `zone_source`); [[0240-register-entries-are-fragments]]; ADR 0296 (PR #616) and ADR 0289 (PR #613), neither on main when this was written; OD-192; the lane brief `p4-scratch/sim-run/fixes/briefs/zoneaddr.md` and plan `p4-scratch/sim-run/fixes/cont/zoneaddr-plan.json` (both outside the repo)

## Context

PR #616 (ADR 0296) files every sale on the house's own day. A house with no `restaurants.timezone` then states no figure — "time zone not set" — for the /reports till, its export and every windowed goal. The real tenant has no zone. Migration `a_default_is_not_an_answer` dropped the `'America/Los_Angeles'` default and cleared every value equal to it (its :189), because a value equal to a default is unattributable (ADR 0116:136). `house-frame.ts` resolves a zone as house → the country's only zone → none, so a US house with no zone gets none (ADR 0207 q10, :271).

Before this ADR a zone reached a house two ways. Sign-up saved the browser's zone with no record of where it came from (ADR 0213 item 62, :76-79). Settings → Time zone (ADR 0207 round 3, :106) let an owner or manager state one, audited. Settings could name who stated a zone only from the newest audit row, and named that person even when the row was about another zone. The Hours tab said "no editor exists", false since round 3. Every present zone was tagged `manual`, whoever or whatever had chosen it.

## The founder's words (verbatim, binding)

Asked 2026-10-04 ~22:35Z with AskUserQuestion, about how #616 lands for a house with no zone:

- **Q1** (how #616 lands): *"When a house signs up, when, whenever it adds a restaurant or anything else, when they type in their addresses, that also shows which time zone they are in. Unless they are want to change."*
- **Q2** (purchase spend / bottles sold goals for a no-zone house): *"we can ask for the location and use it for that if the time zone is not set i mean it's not possible since it's if it's an e restaurant otherwise all restaurants need a re other address right or we're just going to use system time zone that work"*
- **Follow-up, which system zone:** **"The owner's device (Recommended)"**. The option text was: *the zone of the phone or computer the owner signs up on is saved as the house's zone, labelled 'from your device', and the owner can change it.*
- **Follow-up, #616 timing:** **"Merge #616 first (Recommended)"**. The option text was: *#616 merges after audit; the real house reads 'time zone not set' only until the address lane lands and fills its zone in, after a dry run and your yes.*

Asked 2026-10-05T01:17Z with AskUserQuestion, on the plan's forks F1-F4:

- **F1** one-clock countries (DE, AR, CY, KZ, MY, MH, UZ): **"Name the capital's zone (Recommended)"**. Labelled 'from your address'; a test proves every zone of the country keeps the same clock. PS still falls back to the device.
- **F2** where the owner changes the zone: **"Show it; change in Settings (Recommended)"**. Sign-up and Add location show the preview line only; the override is the existing Settings PUT.
- **F3** State field on GetStarted: **"Show State for US (Recommended)"**. An editable, optional State field when the country is the United States, pre-filled from the picked place; this amends ADR 0213 row 9.
- **F4** address move into another zone: **"Follow unless set by hand (Recommended)"**. A stated zone stays; an address-derived zone follows the address; a zone of unknown origin is never overwritten by the machine.

## Decision

**A house's zone is worked out from its address; failing that, from its owner's device; failing that, it is not set. It is always kept with its source, and Settings always shows that source.**

1. **Order.** (1) The address. A country with exactly one zone in Node's `Intl` names it. One of the seven one-clock countries of F1 names its capital's zone: Europe/Berlin, America/Argentina/Buenos_Aires, Asia/Nicosia, Asia/Almaty, Asia/Kuala_Lumpur, Pacific/Majuro, Asia/Tashkent. A US address names a zone only through its state: one of the 35 single-zone states or DC. The 15 split states (AK AZ FL ID IN KS KY MI NE NV ND OR SD TN TX) name none. (2) The owner's device, saved as `device`. (3) Otherwise no zone and no source; the span rule and "time zone not set" stay for that house.
2. **When and where.** Once, when an address is written: at sign-up, at add-location, and (PR-5, per F4) when the address moves. The gateway does it, offline: static tables plus Node `Intl`. There is no network call, no key, no geocoding of typed text, and no read of latitude or longitude. A read never derives or writes a zone.
3. **Recorded with its source.** `restaurants.timezone_source` is `address`, `device` or `stated`. `restaurants.timezone_source_zone` is the zone that source vouches for. The source counts only while `timezone_source_zone = timezone`. A writer that rewrites `timezone` without knowing these columns (the sim seed RPC, `scripts/synth/seed.py`) therefore unbinds the source. The zone then reads as one with no recorded source (4): "source not recorded", or "stated" when the newest audit row names that exact zone. A source is never shown against a zone it did not vouch for, but a blind rewrite back to the very zone it vouched for binds it again. CHECK `restaurants_timezone_source_known` is an equality, `(timezone_source IS NULL) = (timezone_source_zone IS NULL)`, plus membership. The or-form admits a zone with a NULL source, because `NULL IN (...)` is NULL and a NULL CHECK passes. Both columns are nullable with no default. Every existing row reads null/null: its source was never recorded, and nothing invents one.
4. **Shown.** Settings → Time zone says where the zone came from:
   - "from the address · worked out from this house's address when it was entered; no person chose it";
   - "from the device · the zone of the device the house was created on; no person chose it";
   - "stated · {date}", with "stated by · {name}" when the witness's name can be read, or "stated · who and when were not recorded" for a bound `stated` source with no witness;
   - "source not recorded · nothing records who or what chose it (a zone saved at sign-up or by a seed carries no record)".

   A zone with no bound source (every zone saved before this ADR and not stated since, and any zone a blind writer has unbound) reads "source not recorded" unless it has a witness: the newest `house_time_zone_changed` row says `to` = that exact zone (6). With a witness it reads "stated" in the words above. That exception is Reading 5, the lane's, awaiting the founder.

   The Hours tab's "Which clock does it keep?" row points at that row. It is tagged `manual` only when a person stands behind the zone it shows: a bound `stated` source, or a zone with no bound source that has a witness. Any other present zone (from the address, from the device, or with no source and no witness) is `inferred`. A house with no zone is `unstated`.
5. **Overridden by a person.** The override is the existing `PUT /settings/time-zone` (F2), for an owner or a manager (ADR 0207 round 3). It writes the zone with source `stated`. It files a `house_time_zone_changed` row when the zone or its effective source moves, and nothing when neither moves. When only the source moves (a PUT of the zone the house already keeps, whose bound source is not `stated`), the unchanged zone still files a row: `timezone {from: X, to: X}` beside `timezone_source {from: <old source or null>, to: "stated"}`. `timezone` is in every row so the witness rule (6) reads one key, `fields.timezone.to`. The Settings ledger then prints "timezone X → X" beside the source move. This departs from the doc comment on `SettingsChange.fields` ("Only the fields that actually moved", `settings-audit.service.ts:293`); `SettingsAuditService.record()` files the fields it is given and drops none. Settings disables Record when the choice equals the zone, so only a direct PUT files this shape.
6. **A person is named only as the witness of this zone.** Settings names who stated the zone only when the newest `house_time_zone_changed` row says `to` = the zone the house keeps now. A zone bound to `address` or `device` names nobody, whatever the trail holds. An audit write can fail (`recorded: false`), so an older row may name someone who never stated the current zone; that row is not read as its witness. The person named did state this zone value at some time. If a later audit write failed, someone else may have set the same zone since, and the earlier person is still the one named.
7. **When the address moves (F4).** A zone stated by a person stays. So does a zone whose source was never recorded: the machine never overwrites it. Only a zone recorded as `address` or `device` is worked out again, and only when the normalised jurisdiction actually changes ("Texas" → "TX" is not a move). The editor's own device never replaces a house's device zone. The change is audited.
8. **The existing house.** Its zone is filled from its stored address only after a dry run that writes nothing and the founder's yes (the follow-up above; ADR 0111 row 2). Never a migration.

### Which PR builds each part

| PR | Builds | Waits for |
|---|---|---|
| **PR-1** (`feat/zone-from-the-address`) | Migration `a_house_zone_says_where_it_came_from` (the two columns and the CHECK, no row changed); `house-time-zone.service.ts` reads the bound source, applies the witness rule (6), and has the PUT write `stated` (5); Settings → Time zone shows the source (4); the Hours row points at it and its certainty follows (4); this ADR, its index row and its claims | — |
| **PR-2** | `house-zone-from-address.ts` (the order in 1, with F1's seven capital zones and the test that each country keeps one clock over 2026-2028); the three create routes (`createFirstHouse`, `registerRestaurant`, `createLocation`) write the zone with its source; the GetStarted live preview line (F2); a stale state is cleared when the address is retyped; ADR 0213 item 62 bracketed; CLAIMS rows ITEM-62 and the create-location row amended in place | PR-1 and #613 |
| **PR-3** | The back-fill dry run (8): a CLI that reads a pasted read-only select and prints guarded `UPDATE` statements for houses with no zone, writing nothing; ADR 0207 q10 and ADR 0296 bracketed | PR-2 and #616 |
| **PR-4** | The AddLocation live preview (F2); the address's zone offered in Settings when the zone is unset or disagrees (`addressAgrees`); GetStarted's editable, optional State field for the United States (F3), with the ADR 0213 row 9 bracket; the wording of `SectionKit.tsx`'s `Certainty` note (see Consequences) | PR-3 |
| **PR-5** | `updateLocation` per F4 (7), audited, and the location editor showing the result; ADR 0289 bracketed; mobile sends a guarded device zone | #613, PR-2 |

PR-1 contradicts none of F1-F4. It derives nothing, so F1 and F4 are untouched. Its override is the existing Settings PUT, as F2 says. It adds no field to GetStarted (F3 is PR-4's). It keeps a zone of unknown origin exactly as it is (F4). It reads that zone as "source not recorded", or as "stated" when an audit row witnesses that exact zone (Decision 4, Reading 5).

## How a derived zone squares with "a default is not an answer" (2026-09-03, ADR 0116)

That rule found two faults in the `America/Los_Angeles` default. One constant was applied to every row whatever the house. And a defaulted value could not be told apart from a stated one, so nobody could say whether a house had chosen it. A derived zone avoids both:

- **It is this house's own.** It comes from this house's address, or from the device its own owner signed up on. It is never a constant shared across houses. A split US state with no device zone gets no zone; a majority zone such as Texas → Chicago would be a default.
- **It is attributable.** Its source is stored, bound to the exact zone it vouches for, and shown in Settings. Anyone reading it can tell "from the address" from "stated". A blind rewrite unbinds the source instead of leaving it on a zone it did not vouch for.
- **It names no witness.** No person is credited with a zone the address or the device gave (ADR 0116:266-270: attributing mined data to an operator would invent a witness).
- **It never reads the snapshot table.** `tmp_dropped_column_defaults_20260903` stays unread; the cleared defaults are not restored.

An unattributable value stays not an answer. That is why a zone with no source and no witness reads "source not recorded" and is tagged `inferred`, never `manual`. That covers every zone saved before this ADR and not stated since that no audit row witnesses, and any zone a blind writer has unbound and no audit row witnesses.

The witnessed exception is the lane's proposal, awaiting the founder (Reading 5). A zone with no source counts as attributable when the newest `house_time_zone_changed` row says `to` = that exact zone. That row names who set the zone. Settings then reads the zone "stated" with that row's date, plus "stated by · {name}" when the name can be read, and the Hours row is tagged `manual` (Decision 4). This case is reachable for a zone saved before this ADR. `PUT /settings/time-zone` has filed such rows since ADR 0207 round 3, and the migration leaves every existing row's source null.

## Readings (the lane's; the founder may overrule them)

1. **Territories.** Sometimes the address names one zone but the owner's device lies in a place addressed under that country's name that keeps another clock: FR with RE MQ GP GF YT PM BL MF NC PF WF TF; NL with BQ CW AW SX; DK with FO GL; GB with GI FK BM KY VG MS TC AI SH IO PN GS; TR with CY ("Mersin 10, Turkey"). Then the device's zone is saved, as `device`. The address names the territory too and the device is the more specific of the two (Q2 sends what the address cannot settle to the device). A device outside the country entirely does not override the address (Q1).
2. **A device "UTC" or `Etc/*` zone is not an answer.** "UTC" is what an unconfigured or privacy-hardened device reports, and no restaurant keeps it as a civil zone name (ADR 0116). `Etc/GMT+5` is not a zone Settings can name. Neither is saved as `device`.
3. **"from the device", not "from your device", in Settings.** The follow-up's option text labels the zone *'from your device'*. Settings is read by every owner and manager of the house, and "your" would tell a manager the zone came from their own device. Settings therefore says "from the device" with "the device the house was created on". The sign-up preview, shown on that device to the person signing up, says "from this device" (PR-2).
4. **The witness rule (Decision 6).** A person is named only by the newest audit row, and only when its `to` is the zone kept now. Against the code before PR-1, which named the newest row's actor whatever zone that row was about, it narrows who is named and never adds a name.
5. **A witnessed zone with no recorded source reads as stated** (built in PR-1; awaiting the founder). A zone saved before sources were recorded, or one a blind writer has unbound, can still have a witness: the newest `house_time_zone_changed` row says `to` = that exact zone. PR-1 then reads it "stated", names the row's actor when the name can be read, and tags the Hours row `manual` (`zoneProvenance`'s default branch in `TimeZoneSection.tsx`; `hoursTimezoneCert` in `certaintyTally.ts`; pinned by `certaintyTally.test.ts` and `TimeZoneAndMailReading.test.tsx`). The lane reads the row as a person's word for that zone, so the zone is attributable (ADR 0116). The other reading is that only a source recorded on the row counts. Under it such a zone would read "source not recorded" and be tagged `inferred`. The founder decides. If he picks the other reading, the change is the default branch of `zoneProvenance` and one term of `hoursTimezoneCert`, with their tests.

## Amends and keeps

**Amends**
- ADR 0207 round 3 (:106): the PUT now records its zone as `stated` and audits a move of the source as well as of the zone (PR-1). q10 (:271): the "data fix by the founder's word" becomes the PR-3 dry run plus his yes (bracketed in PR-3).
- ADR 0213 item 62 (:76-79) and its 2026-09-28 create-location bracket: "Browser zone, else none" becomes the address, then the owner's device, then none (bracketed in PR-2). Row 9 (:50): GetStarted gains an optional State field for the United States (F3, bracketed in PR-4).
- ADR 0296 (PR #616), rejected option 2, "the browser's zone": it is not revived as a per-reader clock. The device zone is saved once on the house, so every reader keeps one clock (bracketed in PR-3).
- `house-time-zone.service.ts` rule 1 (PR-1): "attributable, never silent" replaces "a person states it here".

**Keeps**
- ADR 0116: no default and no invented witness.
- ADR 0111 row 2: no geocoding of typed text; the back-fill is a script with a dry run.
- ADR 0117 Q33: one country table (#613's `resolveHouseCountry`, not `house-frame`'s `countryCodeOf`).
- ADR 0213 row 8 (:49): "TZ and currency are derived, shown, never asked as blanks".
- ADR 0224: no new host.
- OD-192 (the remover's device zone, `OPEN-DECISIONS.md:91`) is narrowed, not closed: the team removal clock still reads a raw device zone, outside this ADR.
- `house-frame.ts`'s read-time `ZoneSource` and the digest payload's `zone_source` (ADR 0149) are not these columns. They say how a reader found a zone; these say who or what wrote it.

**Retire-to-write.** This ADR supersedes the item-62 paragraph of `sign-up-timezone.ts` (bracketed in PR-2) and rule 1 of `house-time-zone.service.ts` (replaced in PR-1). It adds no planning document.

## Options considered

Rejected, with the reason that carried it:

1. **An offline lat/lng → zone lookup on Places coordinates** (`geo-tz`, `tz-lookup`). Maps Platform Terms §3.2.3(c)(iv) forbid Places latitude/longitude as point-in-polygon input. 0 of 14 rows carried coordinates (ADR 0111:142). `geo-tz` unpacks to 74MB, `@photostructure/tz-lookup` states it misses 5-10% of inhabited points, and the boundary data is ODbL.
2. **Google's Time Zone API.** A new server key, a network call on the write path, and a new data-terms host that would make every owner accept the terms again. §3.2.3(b) forbids caching.
3. **The Places API (New) `timeZone` field.** A Pro field at $17 per 1,000 after 5,000 free. It reaches only web sign-ups where a place was picked: not mobile, typed addresses or API writes. The back-fill would need a Places call per house.
4. **OSM/Nominatim plus `geo-tz`.** A new host, ODbL, and geocoding of typed text, which ADR 0111 row 2 forbids.
5. **Deriving at read time in `house-frame`.** About 20 gateway readers take `restaurants.timezone` directly, and Settings could never say who chose a zone.
6. **Provenance from the audit log alone.** Audit is best-effort, and a PUT of the same zone filed no row.
7. **One `timezone_source` column with no bound zone.** A seed rewrite would leave a stale label, and a CHECK tying it to `timezone` would break the seeds.
8. **A trigger that clears the label.** It cannot tell a deliberate same-source change from a blind writer.
9. **Writing `device` onto existing zones.** That invents a witness (ADR 0116:266-270).
10. **A majority zone for a split state** (Texas → Chicago). That is a default.
11. **`house-frame`'s `countryCodeOf` as the country reader.** A second country table against ADR 0117 Q33; measured on Node 20 and 22 it maps Germany → DD, Serbia → CS and Vietnam → VD, and cannot read "Turkey".
12. **A zone derived on the web and sent in the request.** The client would decide, and mobile sends neither state nor zone.
13. **A database trigger that fills the zone.** `Intl` is not in Postgres.
14. **A back-fill inside a migration.** ADR 0111 row 2 requires a script with a dry run, and the founder asked for a dry run and his yes.
15. **A US ZIP → state or ZIP → zone table.** Every web path that stores a postal code from Places stores the state from the same result. ZIP → zone for split states needs ODbL boundaries and still picks a side for a ZIP that straddles a line, which is a default. Re-open if the PR-3 dry run lists houses with a postal code and no state.
16. **The address always wins over the device, with no territory reading.** Measured, it names Europe/Paris (+1) for a Réunion house typed as "France" (+4), and Europe/Istanbul (+3) for North Cyprus (+2 in winter).
17. **Checking clocks at write time before the territory rule.** About 8,760 formatter calls per write, and unnecessary: a device zone inside the place is right either way. The test runs the sweep once.
18. **Saving a device "UTC" or `Etc/*` zone as `device`.** See Reading 2.
19. **A browser-side warning "this device's zone is not one of {country}'s".** It fires falsely where an engine lacks `Intl` Locale zones or names zones differently (Asia/Calcutta). Replaced by `addressAgrees`, computed on the gateway (PR-4).
20. **Naming `statedBy` whenever the source is `stated`.** An audit write can fail, so the previous actor would be named for a zone they never stated.
21. **Re-deriving every zone not marked `stated` when the address moves.** It would overwrite zones a person stated through the ADR 0207 PUT before PR-1. That became F4, and F4 forbids it.
22. **A schema-only PR ahead of the code.** Ordering the PRs closes the deploy race without one: in PR-1 only Settings → Time zone touches the new columns, and PR-2 lands after they exist.
23. **Reading "Google content" as barring the state field.** The rule reads the address text the owner submits, which the app already stores and the price index already reads; it never reads coordinates. Not legal advice.
24. **A source label in every reader outside Settings.** They name the clock they read, and that stays true. The source lives in one place, Settings → Time zone, and the Hours row points to it.
25. **A dry run that proposes `stated` for existing zones with an audit witness.** It would relabel production rows nobody asked to relabel; Settings already names the witness.
26. **A web mirror of `notAZoneBecause` for the preview.** The preview is advisory; the gateway recomputes and saves the authoritative zone.
27. **Doing nothing.** The real house reads "time zone not set" on every windowed figure until someone finds Settings → Time zone, and every new house keeps an unlabelled browser zone.

## Consequences

- A house's zone can be read for what it is: stated by a named person, given by the address or the device, or of unknown origin. The certainty tally stops counting an unattributed zone as `manual`.
- A split US state or a multi-zone country with no usable device zone reads "time zone not set" until someone states one. That is by design: no majority zone.
- Mobile sign-ups get the address zone after PR-2 and the device zone after PR-5.
- Until PR-2, sign-up still saves the browser's zone with no source, and Settings says "source not recorded" for it (a new house has no audit row to witness it). No row is labelled `address` or `device` until PR-2 writes one.
- **Deploy window.** If the gateway deploys before the migration applies, `GET` and `PUT /settings/time-zone` fail until the columns exist (minutes, nothing written). No other route reads them in PR-1.
- `SectionKit.tsx`'s `Certainty` note still says `inferred` is "computed on read, never written". PR-1 widens that meaning for the Hours zone row (documented on `hoursTimezoneCert`). The note's own wording is owed in PR-4, which edits the Settings page again; PR-1 stayed within its 15 files.
- A person cannot yet re-confirm the zone already shown in Settings as their own (Record is disabled when the choice equals the zone), so a "source not recorded" zone stays so until someone picks a zone. PR-4's Settings offer is the place for that.
- **Revisit if** the PR-3 dry run lists houses with a postal code and no state (option 15), or a tzdata update splits one of F1's countries (its PR-2 test fails the build).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | Aldemir | Ruled Q1, Q2 and the two follow-ups, quoted above |
| 2026-10-05 | Aldemir | Ruled F1-F4, quoted above |
| 2026-10-04 | Claude (lane zoneaddr) | Created. Built PR-1: the migration, the source and witness rules in `house-time-zone.service.ts`, the Settings label and the Hours row |
| 2026-10-05 | Claude (lane zoneaddr) | Record brought in line with the PR-1 code; no behaviour changed (code comments only). The final paragraph of "How a derived zone squares…" and Decision 4 now name the witnessed zone with no source, which reads "stated" and is tagged `manual`, as Reading 5, awaiting the founder. Decision 3 says a blind rewrite unbinds the source and a rewrite back binds it again. Decision 5 records the `timezone {from: X, to: X}` row. Decision 6 says the person named stated this zone value at some time. The witness rule moved to Reading 4 |
