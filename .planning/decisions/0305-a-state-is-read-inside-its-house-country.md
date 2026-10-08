# 0305 — A house's state is read inside its own country, and a house with no country is asked for one

- **Status:** Locked for the two rulings (the founder, 2026-10-07T19:48:13Z, both quoted verbatim below), and Proposed for the method: the resolver, its file, the country spellings it reads, the `countryNotRecorded` flag and the panel's copy and link are this lane's build, for his review.
- **Date:** 2026-10-07
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** state_province, country, jurisdiction, country first, read inside the country, MI Milano Michigan, Georgia GE US-GA, provincia sigla, country not recorded, countryNotRecorded, resolveHouseJurisdiction, houseJurisdictionKey, house-jurisdiction.ts, normalizeJurisdiction, normalizeNonUsJurisdiction, price index, price-book review, admitter pool, commodity, distributor feed, /settings?tab=locations, R3 supersession
- **Links:** ADR 0289 (PR #613, merged to `main` at `a323cc80b` on 2026-10-07, after this branch's base `ca3582988`; `git merge-tree` of this branch with it is clean; its R3 and its "Open forks" item 2 carry the same two answers); [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (Q33, the web's one country table); [[0067-a-failed-read-is-never-an-empty-one]]; [[0290-the-dashboard-tells-the-houses-day-true]] (the no-time-zone line this mirrors, `SalesCalendar.tsx:338`, `dn-zone-unset`) [Corrected 2026-10-08, coordinator: this cited [[0304-a-house-zone-comes-from-its-address]] for that line; the line and its link to `/settings?tab=time-zone` are ADR 0290's (0290 §1, F1 (a)). 0304 is where a house's zone comes from, not how its absence is shown]; `claims.d/fix-market-readers-read-inside-the-country.jsonl`; the research note `p4-scratch/sim-run/fixes/audits/research-r3-subdivisions-2026-10-07.md` and the founder's answers `p4-scratch/sim-run/fixes/briefs/answers-2026-10-07-pm.md:37-44` (both outside the repo)

## Context

`restaurants.state_province` and `restaurants.country` are free text. Every market reader of a house read the state first, with `normalizeJurisdiction` (`price-index.registry.ts:482-501`), and read the country only when the state did not resolve. That function reads a bare two-letter US code (`:490`) and a US state name (`:494`) before anything else. So:

- An Italian house that writes "MI" for Milano, as Poste Italiane's address standard asks ("20133 MILANO MI"), was read as Michigan. The research note counts 19 of Italy's 111 province codes spelled like US state codes. A twentieth, Terni ("TR"), was read as Türkiye, because `normalizeNonUsJurisdiction` passes the country code through (`jurisdiction.ts:236`). The founder's question counted 20, the codes R3 refuses.
- A house in Georgia the country was read as the US state GA whenever its state was blank or unreadable, because `normalizeJurisdiction("Georgia")` is `US-GA`.

The readers that did this, at `origin/main` `ca3582988`, were five house call sites in four services:

| Reader | Old read | What a misplaced house got |
|---|---|---|
| `PriceIndexService.forHouse` | `price-index.service.ts:271-281` | Michigan's posted prices and sources on `/price-index/me` |
| `PriceIndexReviewService.jurisdictionOfHouse` | `price-index-review.service.ts:401-408` | Michigan's held price books on `GET /price-index/uploads` (`price-index.controller.ts:119`) |
| `PriceIndexReviewService.admittersFor` | `price-index-review.service.ts:439-446` | a place in Michigan's admitter pool |
| `CommodityService.forHouse` | `commodity.service.ts:232-236` | the United States' commodity series |
| `DistributorFeedService.forHouse` | `distributor-feed.service.ts:141-147` | Michigan's distributors on `/connections` |

Every standard the research checked reads a subdivision code inside the address's own country: ISO 3166-2, CLDR, Google's address data and Shopify's validator. Under them IT-MI is Milano and US-MI is Michigan. Our market readers were the outlier. Separately, ADR 0289 R3 (in #613) refuses a US state code on a foreign house in the location editor. That kept new Italian "MI" rows out of the editor, but not out of the three writers that check nothing (Consequences).

## The founder's words (verbatim, binding)

Asked 2026-10-07 with AskUserQuestion, answered at **19:48:13Z**. Recorded at `answers-2026-10-07-pm.md:37-44`.

**#613 R3, re-asked with the research.** Q: *"The research is back (fixes/audits/research-r3-subdivisions-2026-10-07.md). Italian addresses do carry a two-letter province code: Poste Italiane's standard requires '20133 MILANO MI', and Google's address data, Shopify and Italy's e-invoice format all expect it. What nobody does is read that code as a US state. Every standard looks the code up inside the address's own country (IT-MI is Milano, US-MI is Michigan). Our market panels are the odd one out: they read a bare 'MI' as Michigan whatever the country. That reader fix ships either way as a defect fix. What should the location editor do with 'MI' on an Italian house?"*

- Picked **"Keep it, read inside the country (Recommended)"**: *"Supersedes R3. The editor stops refusing and keeps what the owner writes (code or name), and Italy's field is labelled 'Provincia (sigla, es. MI)'. This is how Google, Stripe and Yelp work. The readers are fixed first, then the editor, in follow-up PRs; #613 merges as locked."*
- Rejected "Check Italy's own list": *"The same, but the server accepts only Italy's 111 province codes or names for an Italian house and refuses anything else (Shopify's model). It catches typos, but the list has to be kept current: Sardinia's codes already differ between Google and ISO."*
- Rejected "Keep refusing, as locked": *"20 Italian province codes (MI, CO, PA, VA…) stay unsavable in the editor. The editor's hint 'Kept as you write it' then contradicts it."*

**No-country house.** Q: *"Once the market panels read the state inside the house's country, what does a house with no country recorded get? (One of 14 houses had none at the 2026-09-05 count.)"*

- Picked **"Ask for the country (Recommended)"**: *"The panels say the country isn't recorded and link to Settings, the same way a house with no time zone is handled. Nothing is guessed. That one house sees no state-based prices until the owner sets it."*
- Rejected "Treat it as US": *"A US state code on a no-country house is read as the US state, as today. A real US house with no country keeps its prices, but an Italian house with no country and 'MI' still reads as Michigan."*

## Decision

**A house's state is read only inside its recorded country. A house with no country has no state read, and its panel asks for the country with a link to Settings** [Added 2026-10-08, coordinator: on the market panel; `/connections` does not ask yet, see Consequences]**.**

The rule lives in one function, `resolveHouseJurisdiction(stateProvince, country)` in `apps/api-gateway/src/price-index/house-jurisdiction.ts:72-92`:

1. **The country is read first.** A blank country (null, empty or whitespace) is `country_not_recorded`. No state is read and nothing is guessed (`:78-80`).
2. **A recorded country the register has no list for is `country_unrecognised`.** The register lists only the United States, the United Kingdom and Türkiye. No state is read for any other country, so "MI" on an Italian house is never Michigan and a Georgian house is never US-GA (`:81-84`). The country is read with `normalizeNonUsJurisdiction` (`jurisdiction.ts:228-240`), which knows no US state name.
3. **For those three the state is read only against the country's own list.** For a US house that is the registry's code, name or `US-XX` list. For the other two it is the UK nations or Türkiye's provinces. A key is kept only when its country half is the house's country (`stateWithin`, `:62-70`). A state that does not read inside the country is not used, and the country alone answers, as it did for the Antalya house before.

A country written as one of the UK's nations ("England") or as a Turkish province is read as that subdivision. `normalizeJurisdiction` read it the same way before.

All five call sites now read through it. Four call `resolveHouseJurisdiction(rawState, rawCountry)` or `houseJurisdictionKey(…)`: `price-index.service.ts:302`, `price-index-review.service.ts:402` and `:439`, and `commodity.service.ts:245`. The fifth is `distributor-feed.service.ts:169`. `normalizeJurisdiction` stays on the two URL routes, `forState` and `forJurisdiction`, which ask about a place rather than a house.

**What a house with no country gets.**

- The price index returns no line and no source, and reads nothing after `restaurants`. Its result carries `countryNotRecorded: true` and the sentence `COUNTRY_NOT_RECORDED_SENTENCE` (`house-jurisdiction.ts:108-111`).
- The distributor catalogue returns no list and the same sentence and flag.
- The commodity register returns only the world series. FAO speaks for everywhere and is not a state-based price. It also returns the flag.
- The review service puts the house in no pool. For such a house `GET /price-index/uploads` keeps its existing sentence, "This house records no jurisdiction this register recognises… Set the address in Settings."

On the web, `MarketIndexPanel` draws *"This house's country isn't recorded, so its state isn't read and no state-based price is shown…"* with a link, **Set the country in Settings**, to `/settings?tab=locations`, in place of the generic silence. This is the shape of the dashboard's no-time-zone line (`SalesCalendar.tsx:338`, `dn-zone-unset`, ADR 0290). `useHouseIndex` sets the flag only on a literal `true` from the wire. [Added 2026-10-08, coordinator: the panel's commodity section asks too. When `useHouseCommodity` reads a literal `true` from `GET /commodity-index/me`, the section draws *"This house's country isn't recorded, so no country's or state's series is read here, and only a series that speaks for everywhere is listed."* with the same link, **Set the country in Settings**, to `/settings?tab=locations` (`data-testid="mi-commodity-country-unset"`). The register still lists the world series, which `seriesForJurisdiction(null)` returns (`commodity.registry.ts:721-727`). `/connections` does not yet: see Consequences.] [Added 2026-10-08, coordinator: a house both endpoints flag is asked once in the box, not twice. Both read the same `restaurants` row, so a house with no country is normally flagged by both, and the box drew two near-identical sentences with two links named **Set the country in Settings**. Now, when the register's ask (`mi-country-unset`) is drawn and the commodity section is flagged too, that one ask adds *"No country's or state's commodity series is read either, so the commodity and market index section lists only a series that speaks for everywhere."* and the section draws no ask of its own. The section still asks by itself when the register is not asking: its read failed, it is still loading, or it is not flagged. The register's ask names the commodity section only when that section's read is `ready` and flagged.]

**A failed read is not a missing country.** `forHouse` in the price index and in commodity now tracks `readFailed`. A `restaurants` read that throws keeps "could not be read… unknown, not empty" and never sets `countryNotRecorded` ([[0067-a-failed-read-is-never-an-empty-one]]). Without that, a database fault would have sent an owner to Settings to fix an address that was never wrong. The distributor feed already returned early on a failed read.

**The country spellings.** The brief asked for the country to be mapped to an ISO code through #613's `HOUSE_COUNTRIES`. That table was not on this branch's base (`ca3582988`): #613 merged at `a323cc80b` while this lane was running, and this lane does not rebase. A copy here would have been a second country table and a merge conflict with #613. The country step therefore reads `jurisdiction.ts`'s `COUNTRIES`, and this PR adds the two spellings of the web's one country table it lacked: "Republic of Türkiye" and "U.S." (`jurisdiction.ts:100`, `:111`). `house-jurisdiction.spec.ts` reads `apps/web/src/lib/countries.ts` as text and fails in two cases: if any spelling of the three listed countries stops resolving to that country, or if any spelling of the other 191 starts resolving at all. The resolver sits in its own file because it imports both the registry and `jurisdiction.ts`. It can now read `HOUSE_COUNTRIES` without an import cycle (`house-jurisdiction.ts:45-50`); that switch is a follow-up (Consequences). The retention resolver's shape (`retention-rules.ts:282`: blank country → `UNKNOWN`, a state read only inside the US) is the pattern lifted. Its table was not reused, because it lists only the jurisdictions whose retention law was researched and reads only California as a state.

## What this PR does not do: the editor half is the next PR

The founder's pick says *"The readers are fixed first, then the editor, in follow-up PRs; #613 merges as locked."* This PR is the readers. The next PR, with its own ADR, will:

- **formally supersede ADR 0289 R3.** The location editor stops refusing a two-letter province abroad and keeps what the owner writes, code or name.
- **label Italy's field "Provincia (sigla, es. MI)".**
- **drop the "IL" placeholder for non-US houses** (`AddLocationDialog.tsx:295` and `:460`; `Register.tsx:1029` has no Italy case).

It must land after this PR, or the editor writes rows the old readers take for Michigan. This PR does not touch the location editor or R3's refusal. **#613 (ADR 0289) merged at `a323cc80b` after this branch's base**, so the Locations section this PR links to now has a country field: `EditLocationChainDialog` on `main` shows the state and country fields to an owner of the house. A manager who follows the link sees no country field there; the gateway refuses anyone but an owner (ADR 0289). #613 writes the country as the web table's display name ("Italy", "United Kingdom") and a US state as its bare code ("CA"), and this resolver reads them as written: "United States", "United Kingdom" and "Turkey" resolve to their countries (`HOUSE_COUNTRIES` gives the three the same spellings as `apps/web/src/lib/countries.ts:254`, `:260-261`, which the mirror test pins), "CA" on a United States house is `US-CA`, and "Italy" is a country with no list. The branch was merged with `a323cc80b` in a scratch worktree and the touched suites were run there (the PR body has the counts).

## Options considered

1. **Read the state inside the country, and ask a house with no country** (chosen, both rulings). Every address standard checked reads a subdivision this way. Its cost is the one house with no country, which loses its state-based prices until its owner sets a country.
2. **Read inside the country, but treat a no-country house as US** (rejected by the founder: *"an Italian house with no country and 'MI' still reads as Michigan"*). It keeps a real US house's prices and keeps the defect for exactly the house that can least be placed.
3. **Read inside the country, and have the server accept only Italy's own 111 province list for an Italian house** (rejected by the founder: *"the list has to be kept current"*). This is an editor rule, not a reader rule. The readers here would be unchanged under it.
4. **Keep the readers state-first and rely on R3's editor refusal** (what `main` did). It leaves 20 Italian codes unsavable, and it leaves the three unchecked writers and every existing row read as US states.
5. **Copy #613's `HOUSE_COUNTRIES` into this PR as the country step** (rejected by this lane). On this branch's base that would have made a second country table and a conflict with #613, then unmerged. Reading `jurisdiction.ts` and testing it against the web's table gives the same answer for the only three countries that have a state list.

## Consequences

- **Easier:** one function answers "which market is this house in" for all four services, so the panels cannot disagree. An Italian "MI" house and a Georgian house leave Michigan's and Georgia's prices, books, pools and distributor lists.
- **Given up:** a house with no country (1 of 14 at the 2026-09-05 count, not re-measured, since this lane had no production reads) sees no state-based price and is in no admitter pool until its country is set. A US house whose state does not read inside the US (e.g. "Milano") still gets only "US" and its existing "set the state" sentence. That imprecision predates this PR.
- **Three writers still store any state with any country, unchecked** (out of scope here, named by the brief and the research): `auth.service.ts:1690-1691` and `:1812-1813` (the two sign-up paths) and `organizations.service.ts:992-993` (add location) [Corrected 2026-10-08, coordinator: this read `:771-772`, the line at base `ca3582988`; #613's merge moved it. The writer still checks nothing: #613's `checkHouseStateCountry` runs only on the edit path, `:556`]. Since the readers are now country-first, what those writers store can no longer be read as the wrong country's state. It can still be stored inconsistently.
- **Readers left, and why:**
  - `communications/retention/retention-rules.ts:282` (`resolveJurisdiction`, read by `raw-mail-retention.service.ts` and `house-mail-archive.service.ts`) is already country-first and reads a state only inside the US.
  - vendor-intel reads no house's state. It scopes by the shop's jurisdiction (`shop-reference-sweep.service.ts:256`), and its one mention of `state_province` (`price-reference-shops.ts:298`) is a sentence.
  - The SQL territory gate `search_distributors` already compares `t.country = r.country`. That is the research note's finding and was not re-checked here.
  - `forState` and `forJurisdiction` take a jurisdiction from the URL, not a house.
- **Owed follow-ups, not in this PR:**
  - `/connections` prints the distributor feed's sentence as plain text and has no link to Settings. [Corrected 2026-10-08, coordinator: still owed, and so the founder's pick *"The panels say the country isn't recorded and link to Settings"* is built on the market panel only. The fix needs three files this PR cannot hold under its 15-file cap: `DistributorFeedPanel.tsx` (draw the link when the catalogue's `countryNotRecorded` is a literal `true`), `useConnectionsNextData.ts` (the field on `DistributorCatalogueVM`) and `DistributorFeedPanel.test.tsx`. The gateway already sends the flag (`distributor-feed.service.ts:177`).]
  - The commodity section of `MarketIndexPanel` does not read the flag. The index register above it carries the ask. [Corrected 2026-10-08, coordinator: built in this PR. `useHouseCommodity.ts` reads the flag and the section asks with a link (Decision, "What a house with no country gets").]
  - [Added 2026-10-08, coordinator: this ADR's index row in `.planning/decisions/README.md` moved to the next PR, to keep this one at 15 files. No guard requires the row.] [Corrected 2026-10-08, coordinator: ADR 0305 ships with no index row, because this PR is at the 15-file cap. Adding the row later is not free: `scripts/pr_audit_gate.py` `_index_pure_append` (`:1218-1247`) frees a README edit only when the same PR adds that ADR, so a later PR adding row 0305 while 0305 is already on `main` makes a gate-owned edit and needs the founder's word. It is not the only ADR without a row: on `origin/main` `0d79883e7`, 33 of the 213 `NNNN-*.md` files at the top of `.planning/decisions/` have no row starting `| [NNNN]` in `README.md`, and 22 of those numbers appear nowhere in it (measured by grepping `README.md` for each number). No guard fails a PR over a missing row.]
  - `GET /price-index/uploads` keeps one sentence for no country, an unrecognised country and a failed read (`jurisdictionOfHouse` returns null for all three, as before).
- **Switching the country step to `HOUSE_COUNTRIES`** (now on `main`, `organizations/house-state-country.ts`, `resolveHouseCountry`) is owed, then retiring the mirror test. It is not a pure swap: that table lists "England", "Scotland", "Wales" and "Northern Ireland" as aliases of the United Kingdom, so a house whose country reads "England" would resolve to `GB`, where `jurisdiction.ts` reads it as `GB-ENG` today. The follow-up has to keep the nation when no state is written.
- **Revisit when:** the country step moves to `HOUSE_COUNTRIES`, the register gains a fourth country with a subdivision list, or a house's country is found written in a spelling the web's table does not hold.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-07 | — | Created by lane countryfirst on `fix/market-readers-read-inside-the-country` from `origin/main` `ca3582988`. 20 mutations were run against the tests, one per new behaviour, and every one failed the suite. Every claim row was also run by hand and mutated until it failed. Unaudited. |
| 2026-10-08 | coordinator | Verifier's shoulds answered: the Links cite for the no-time-zone line is corrected to ADR 0290; the commodity section now asks for the country, with 5 mutations killed; `/connections` is named as still owed; the README row moved to the next PR [Corrected 2026-10-08, coordinator: the row is not free to add in a later PR; see Consequences]. Merged `origin/main`. Unaudited. |
| 2026-10-08 | coordinator | Second round: the Decision rule names the market panel; the owed README row is worded as a gate-owned edit needing the founder's word; a house flagged by both endpoints is asked once in the box (3 new test cases and 1 new assertion in `MarketIndexPanel.test.tsx`; 6 mutations of `MarketIndexPanel.tsx` run, each failed the suite). Merged `origin/main` `0d79883e7`. Unaudited. |
