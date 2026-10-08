TITLE: fix: read a house's state inside its own country in the market readers (ADR 0305)

> **Coordinator note, 2026-10-08 ~01:05Z.** New head `9b1ce4acc` (`9b1ce4acce08bb5fd2f38522612f3aaad2618d01`), 15 files against `origin/main`, merged with `origin/main` `62f8967b4` (clean, no conflicts; `git merge-tree` with the newer `be9a16ccf` is also clean). Still local: not pushed, not audited. The verifier's four shoulds, and how each was answered:
> 1. **Merge main.** Merged at `4ae68f616`. #613 moved the add-location insert, so its cite is now `organizations.service.ts:992-993` (ADR 0305 and this body, bracket-corrected).
> 2. **The founder's pick is only half built.** Half of the missing part is now built. The **commodity section** of `MarketIndexPanel` asks for the country with a link to `/settings?tab=locations` (`useHouseCommodity.ts` reads the gateway's flag, set only by a literal `true`). It has 6 new tests, and 5 mutations were killed. **`/connections` is still owed**: it needs `DistributorFeedPanel.tsx`, the field on `DistributorCatalogueVM` in `useConnectionsNextData.ts` and `DistributorFeedPanel.test.tsx`, which is three files over the 15-file cap. To make room for `useHouseCommodity.ts`, **ADR 0305's README index row moved to the next PR**. No guard requires the row: lanecheck's six guards pass without it. So this PR builds the pick on the market panel only, not on `/connections`. Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation.
> 3. **ADR 0305 Links cited 0304 for the no-time-zone line.** Corrected in place to ADR 0290, whose §1 (F1 (a)) is that line (`SalesCalendar.tsx:338`, `dn-zone-unset`).
> 4. **The Tests line was broader than what was run.** It is rewritten below to what was run at `9b1ce4acc`. The review-service block has no unreadable-read test, and the line no longer says it does.
>
> Evidence at `9b1ce4acc`:
> - gateway jest: 55 suites, 848 passed
> - web vitest: 10 files, 208 passed
> - tsc: only the `@simplewebauthn` errors
> - `check_decision_claims.sh`: 950 checked, 950 holding
> - lanecheck: six guards rc=0, files=15, ownership `[]`

**Branch:** `fix/market-readers-read-inside-the-country`.
- Base: `origin/main` `ca3582988`. Head: `ff0e59838`. 15 files against main. [Corrected 2026-10-08, coordinator: head `9b1ce4acc`, with `origin/main` `62f8967b4` merged in. Still 15 files, but a different set: `useHouseCommodity.ts` is in, and `.planning/decisions/README.md` is out.]
- `origin/main` has since moved to `a323cc80b` (#613). `git merge-tree` of this branch with it is clean. The branch has not been rebased. [Corrected 2026-10-08, coordinator: `origin/main` is merged in at `4ae68f616` (`62f8967b4`, which includes #613). The branch is still not rebased.]
- Local only: not pushed, not audited.

## Why

The market readers read `restaurants.state_province` first, through `normalizeJurisdiction` (`price-index.registry.ts:482-501`). They fell back to `restaurants.country` only when the state did not resolve. So a bare two-letter code was a US state whatever country the house was in:
- An Italian house that writes "MI" for Milano was read as Michigan. Poste Italiane's address standard asks for that code ("20133 MILANO MI").
- Terni's "TR" was read as Türkiye.
- A house in Georgia the country was read as US-GA.

At `origin/main` the old reads are at:
- `price-index.service.ts:271-281`
- `price-index-review.service.ts:401-408` and `:439-446`
- `commodity.service.ts:232-236`
- `distributor-feed.service.ts:141-147`

Every address standard the research checked reads a subdivision inside its own country: ISO 3166-2, CLDR, Google's address data and Shopify's validator. Under them IT-MI is Milano and US-MI is Michigan. The research is in `p4-scratch/sim-run/fixes/audits/research-r3-subdivisions-2026-10-07.md`, outside the repo.

## The founder's answers (2026-10-07T19:48:13Z, verbatim from `fixes/briefs/answers-2026-10-07-pm.md:37-44`)

- **"Keep it, read inside the country (Recommended)"**: *"Supersedes R3. The editor stops refusing and keeps what the owner writes (code or name), and Italy's field is labelled 'Provincia (sigla, es. MI)'. This is how Google, Stripe and Yelp work. The readers are fixed first, then the editor, in follow-up PRs; #613 merges as locked."*
  - Rejected: "Check Italy's own list" and "Keep refusing, as locked".
- **"Ask for the country (Recommended)"**: *"The panels say the country isn't recorded and link to Settings, the same way a house with no time zone is handled. Nothing is guessed. That one house sees no state-based prices until the owner sets it."*
  - Rejected: "Treat it as US".

This PR is the readers half. The editor half is the next PR.

## What changes

**One resolver: `apps/api-gateway/src/price-index/house-jurisdiction.ts`**

`resolveHouseJurisdiction(state, country)` at `:72-92`:
1. **A blank country** is `country_not_recorded`. No state is read and nothing is guessed (`:78-80`).
2. **A country with no subdivision list** is `country_unrecognised`, and no state is read (`:81-84`). That is every country except the United States, the United Kingdom and Türkiye, so Italy and Georgia the country are among them. "MI" on an Italian house is never Michigan, and a Georgian house is never US-GA.
3. **For US, GB and TR**, the state is read only against that country's own list (`stateWithin`, `:62-70`).
   - A state that does not read inside the country falls back to the country, as before.
   - "England" on a US or Turkish house is not GB-ENG.

More on the resolver:
- `houseJurisdictionKey` returns the key or null.
- `COUNTRY_NOT_RECORDED_SENTENCE` is the gateway's sentence for a house with no country.
- The resolver has its own file because it imports both the registry and `jurisdiction.ts`, which means no import cycle.
- `jurisdiction.ts` gains the two spellings of the web's one country table that it lacked: "Republic of Türkiye" (`:100`) and "U.S." (`:111`).

**Five house call sites now read through it.**

| Reader | Call |
|---|---|
| `price-index.service.ts` `forHouse` | `resolveHouseJurisdiction` at `:302` |
| `price-index-review.service.ts` `jurisdictionOfHouse` | `houseJurisdictionKey` at `:402` |
| `price-index-review.service.ts` `admittersFor` | `houseJurisdictionKey` at `:439` |
| `commodity.service.ts` `forHouse` | `resolveHouseJurisdiction` at `:245` |
| `distributor-feed.service.ts` `forHouse` | `resolveHouseJurisdiction` at `:169` |

**A house with no country.** The price index, commodity and the distributor feed answer:
- `countryNotRecorded: true`
- no state-based price
- a sentence that says why

The flag is never set on a `restaurants` read that failed (ADR 0067). The price index and commodity now track `readFailed`. A database fault would otherwise send an owner to Settings to fix an address that was never wrong.

**Web.**
- `useHouseIndex` carries `countryNotRecorded`, set only by a literal `true` from the wire.
- `MarketIndexPanel` draws *"This house's country isn't recorded, so its state isn't read and no state-based price is shown…"* in place of the generic silence.
  - It links **Set the country in Settings** to `/settings?tab=locations`.
  - This is the shape of the no-time-zone line (`SalesCalendar.tsx:338`, `dn-zone-unset`, ADR 0290).
- [Added 2026-10-08, coordinator] `useHouseCommodity` carries `countryNotRecorded` from `GET /commodity-index/me`, again set only by a literal `true`. The commodity section draws *"This house's country isn't recorded, so no country's or state's series is read here, and only a series that speaks for everywhere is listed."* with the same link (`data-testid="mi-commodity-country-unset"`). The world series are still listed under it.
- [Added 2026-10-08, coordinator] **Not yet on `/connections`.** The distributor panel still prints the gateway's sentence as plain text, with no link (see Not done).

**Decision record.**
- `.planning/decisions/0305-a-state-is-read-inside-its-house-country.md`, plus its README row. [Corrected 2026-10-08, coordinator: the README row moved to the next PR, to make room for `useHouseCommodity.ts` under the 15-file cap.]
- `claims.d/fix-market-readers-read-inside-the-country.jsonl`, with 7 static rows. [Corrected 2026-10-08, coordinator: 8 rows. `ADR-0305-COMMODITY-SECTION-ASKS-FOR-THE-COUNTRY` was added, and 3 mutations each made it fail.]

## About #613 (ADR 0289), which merged while this lane ran

#613 merged at `a323cc80b`, after this branch's base.
- **It is compatible.** #613 writes the country as the web table's display name ("Italy", "United Kingdom") and a US state as its bare code ("CA"). This resolver reads both as written.
- **The link now has a place to land.** The Locations section's `EditLocationChainDialog` now has the state and country fields, but only for an owner of the house. A manager who follows the link finds no country field there.
- **Tested merged.** I merged the branch with `a323cc80b` in a scratch worktree (never pushed, since removed) and ran the suites there:
  - gateway jest for `price-index`, `commodity`, `distributor-feed` and `organizations`: 55 suites, 848 passed
  - web `MarketIndexPanel.test.tsx`: 37 passed (before the test split below)
  - #613's `locationStateCountry.test.tsx`: 12 passed
  - tsc: only the existing `@simplewebauthn` errors
- **`HOUSE_COUNTRIES` is not used yet.** The brief asked for the country step to go through #613's `HOUSE_COUNTRIES`. That table was not on this base, and a copy would have been a second country table. The country step reads `jurisdiction.ts` instead. `house-jurisdiction.spec.ts` reads `apps/web/src/lib/countries.ts` as text and checks every row:
  - All 17 spellings of US, GB and TR must resolve to their own country.
  - The other 191 countries must not resolve at all.

  Moving to `HOUSE_COUNTRIES` is owed, and it is not a pure swap. That table lists "England" as an alias of the United Kingdom, so the country "England" would become `GB` where it is `GB-ENG` today.

## Tests (measured at `9b1ce4acc`, after the main merge, unless noted)

[Corrected 2026-10-08, coordinator: this section was measured at `ff0e59838`, before the main merge. It also said every reader block covers an unreadable read. The `PriceIndexReviewService` block has no such test. It is rewritten to what was run at `9b1ce4acc`.]

- **Gateway jest** (`src/price-index src/commodity src/distributor-feed src/organizations`): 55 suites, 848 passed.
  - `house-jurisdiction.spec.ts` is 32 tests: 8 for the resolver, 3 for the web-table mirror, and per-reader blocks for the four services.
  - The `PriceIndexService`, `CommodityService` and `DistributorFeedService` blocks have 6 tests each: IT+MI, US+MI, GB and TR, no country + MI (flag true, no state-based price), Georgia the country, and an unreadable read (flag false).
  - The `PriceIndexReviewService` block has 3 tests: `jurisdictionOfHouse` over IT+MI, US+MI, GB, TR, no country and Georgia; `admittersFor('US-MI')`; and `admittersFor('US-GA')`. It has **no** unreadable-read test.
  - `src/analytics` was not run, since no analytics file is touched.
- **Web vitest** (`src/pages/notifications/next/` plus #613's `src/components/locations/locationStateCountry.test.tsx`): 10 files, 208 passed. This includes:
  - `MarketIndexPanel.test.tsx` (46). It checks the register's ask (the message, `href="/settings?tab=locations"`, exactly one status, no message when the flag is off) and the commodity section's ask (the message and the link, no ask when the flag is off). It also checks both hooks' wire reads (true / false / missing / "true").
  - `MarketIndexPanel.commodity.test.tsx` (32), `NotificationsNext.test.tsx` (37) and `locationStateCountry.test.tsx` (12).
- **tsc** for both apps: only the existing `@simplewebauthn/server` (gateway, 2) and `@simplewebauthn/browser` (web, 1) module errors.
- **eslint:** the four web files in `notifications/next/` exit 0 with `--quiet` through the scratch `jsx-a11y` plugin dir. Gateway eslint was not re-run at this head, since these commits change no gateway file.
- **Mutations:**
  - 5 new ones on the commodity ask, each restored from a `cp -p` snapshot and checked with `cmp`, and all were killed: the flag ignored, the flag always on, the link pointed elsewhere, a truthy read, and a hard-coded false. They ran on the uncommitted working tree that became `c97fe1279`, before the main merge. The merge changes none of those files.
  - The earlier 20 were run at `ff0e59838` and were **not** re-run at this head.
- **Claims:** `check_decision_claims.sh` reports 950 checked, 950 holding. That includes this PR's 8 rows.
- **`lanecheck.sh wt-fix-countryfirst`:** the six guards return rc=0, files=15, and ownership is `[]`. `check_adr_numbers_unique` is OK for 0305.

<details><summary>The superseded Tests section, as measured at <code>ff0e59838</code></summary>


- **Gateway jest** (`src/price-index src/commodity src/distributor-feed`): 45 suites, 689 passed.
  - `house-jurisdiction.spec.ts` is 32 tests. It covers the resolver, the web-table mirror and a per-reader block for each of the four services.
  - Each reader block covers: IT+MI, US+MI, GB, TR, no country + MI (flag true, no prices), Georgia the country, and an unreadable read (flag false).
- **Web vitest** (`src/pages/notifications/next/`): 9 files, 190 passed. This includes:
  - `MarketIndexPanel.test.tsx` (40), which checks the message, `href="/settings?tab=locations"`, exactly one status, no message when the flag is off, and the hook's wire read (true / false / missing / "true").
  - `MarketIndexPanel.commodity.test.tsx` (32).
  - `NotificationsNext.test.tsx` (37).
- **The flaky wire test is fixed.** It used to load the real hook inside a 5 s test. Run beside `NotificationsNext.test.tsx`, it timed out (measured: 1 failed, 73 passed). It now loads in a `beforeAll` and runs as four tests (commit `ff0e59838`).
- **tsc** for both apps: only the existing `@simplewebauthn/server` and `@simplewebauthn/browser` module errors.
- **eslint:** gateway files exit 0. The three web files exit 0 through the scratch `jsx-a11y` plugin dir.
- **Mutations:** 20, one per new behaviour, each from a `cp -p` snapshot and restored with `cmp`. All were killed. After the test split, the two web wire mutations were run again, and both are still killed:
  - reading the flag as truthy
  - hard-coding it to false
- **Claims:** all 7 rows hold when run by hand. Each was mutated until it failed. `check_decision_claims.sh` was not run, as the brief says.
- **ADR guard** (`check_adr_numbers_unique.py`): OK, 0305 checked against 1746 refs.
- **`lanecheck.sh wt-fix-countryfirst`:** every check rc=0, files=15, ownership clean.


</details>

## Readers left, and why

- **`price-index.service.ts` `forState` (`:327`) and `distributor-feed.service.ts` `forJurisdiction` (`:82`)** take a jurisdiction from the URL, not a house. `normalizeJurisdiction` is right for them.
- **`communications/retention/retention-rules.ts:282` (`resolveJurisdiction`)** is already country-first. It reads a state only inside the US.
- **vendor-intel** reads no house's state. It scopes by the shop's jurisdiction (`shop-reference-sweep.service.ts:256`).
- **The SQL territory gate `search_distributors`** compares `t.country = r.country`, per the research note. I did not re-check it.
- **`organizations/house-state-country.ts` (#613)** reads a state with `normalizeJurisdiction` (`:381`, `:392`). That is the editor's R3 check, not a market reader. It is the next PR's to change.

## Out of scope: three writers store any state with any country, unchecked

- `auth.service.ts:1690-1691` and `:1812-1813` (the two sign-up paths)
- `organizations.service.ts:771-772` (add location) [Corrected 2026-10-08, coordinator: `:992-993` at `9b1ce4acc`, after #613's merge. It is still unchecked, because #613's `checkHouseStateCountry` runs only on the edit path at `:556`.]

With the readers country-first, what these store can no longer be read as the wrong country's state. It can still be stored inconsistently.

## Not done, or not verified

- **The editor half is the next PR, with its own ADR.** It will:
  - supersede ADR 0289 R3
  - label Italy's field "Provincia (sigla, es. MI)"
  - drop the "IL" placeholder abroad (`AddLocationDialog.tsx:295`, `:460`)

  This PR does not touch the location editor.
- **No browser check of the panel.** The message and link are verified only by the vitest render.
- **No production reads.** The no-country house count (1 of 14) is from 2026-09-05 and was not re-measured.
- **`search_distributors` was not re-checked.**
- **The country step does not use `HOUSE_COUNTRIES`.** That switch is owed (see the #613 section).
- **`/connections` shows the distributor feed's no-country sentence as plain text**, with no Settings link. [Corrected 2026-10-08, coordinator: still owed. Because of it, the founder's pick *"The panels say the country isn't recorded and link to Settings"* is built on the market panel and not on `/connections`. The next PR owes three files: `DistributorFeedPanel.tsx`, `useConnectionsNextData.ts` (the `DistributorCatalogueVM` field) and `DistributorFeedPanel.test.tsx`. The gateway already sends the flag (`distributor-feed.service.ts:177`).]
- **The commodity section of `MarketIndexPanel` does not read the flag.** The index register above it carries the ask. [Corrected 2026-10-08, coordinator: built in this PR (`c97fe1279`).]
- [Added 2026-10-08, coordinator] **ADR 0305's index row in `.planning/decisions/README.md` is owed to the next PR.**
- [Added 2026-10-08, coordinator] **A manager is sent to a field only an owner sees.** The link text says "Set the country in Settings", but `EditLocationChainDialog` shows the country field only to an owner (ADR 0289). This is unchanged, and it is a verifier nit, not a should.
- **`GET /price-index/uploads` gives one sentence for three cases**: no country, an unrecognised country and a failed read.
- **The merged-tree run predates the test-split commit.** That commit changes only a test file, and the branch run after it passes. [Corrected 2026-10-08, coordinator: superseded. The branch now has `origin/main` merged in, and the suites above were run at that head.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
