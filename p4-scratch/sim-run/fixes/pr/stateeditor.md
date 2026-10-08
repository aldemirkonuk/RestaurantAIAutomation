**[2026-10-06 ~00:33Z, coordinator] Re-headed at `c5f27f7a8`.** It merges `origin/main` `63ce97e62`, bringing in everything merged since this branch last took main. The newest of that is #607 `1884dea38`, #647 `8e16fbcef` and #646 `63ce97e62`. Conflicts resolved by the coordinator: README index rows (both kept). Guards at the new head: migration order, versions unique, OD ids and conflict markers all 0. `ownership_between(origin/main, HEAD)` = `[]`. Decision claims and ADR-number uniqueness are left to CI. Lines below that name an older head describe this PR before the merge. This is a first audit pass; the merge turn re-heads and re-audits.

## What was wrong for the owner

On Tuzlu Rüzgar, the market index asked the owner to do something no page could do. This is finding A-052 (AW26), from the read-only analytics walk on production, 2026-10-03, cited at 661068ab3 and re-verified at 8c673db4b.

- **The house.** It records country `US` and no state.
- **What the index said.** `vp-price-index-me` returned state `US` with this silence: *"This house records the country (US) but no state, and US publishes prices state by state. Set the state in Settings to scope an index line."* (`price-index.service.ts:419`).
- **The register.** It lists 10 sources, US-CA among them. **Every source holds 0 rows today** (`sourcesWithRows 0`), so even with a state nothing would draw yet.
- **Why no page could do it:**
  - `UpdateLocationDto` declared neither `country` nor `stateProvince`, so `ValidationPipe({ whitelist: true })` (`organizations.controller.ts:36`) stripped both silently and answered 200.
  - The controller forwarded only `chainId, name, city, email, phone`, and the service patched only those columns.
  - The only editor, `EditLocationChainDialog`, sent only chain, name and city.
  - The Add-location State field creates a *new* branch. Get-started does not ask for the state, by ADR 0213 rows 8-9.
- **The same instruction appears three more times:**
  - `price-index.service.ts:291`
  - `price-index.controller.ts:129`
  - `distributor-feed.service.ts:154`

  All three say "Set the address in Settings".

## What changed, and why

The founder ruled for option (a): put the state and country in the location editor, owners only, recorded in the log. He also answered both forks. ADR 0289 records the ruling and the method.

**Gateway: `PATCH /organizations/locations/:id`.** No new route.

- **DTO.** `UpdateLocationDto` declares `country` and `stateProvince`: optional, string or null, at most 100 characters (the columns are varchar(100)).
- **Controller.** It forwards both, and it returns the service's receipt instead of `void`.
- **Owner gate (R1).** When either key is sent, the caller must be an **owner of this house**, read strictly through `readRestaurantRole`, which uses `lookupRestaurantRole`.
  - A manager or staff member gets 403. A mixed PATCH (a rename plus the pair) is refused whole, because the gate runs before anything is validated or written.
  - A role that cannot be read gets 503 and changes nothing.
  - A PATCH without the pair keeps its manager-or-owner gate, unchanged.
- **The pair is checked together (R2, R3)**, by `organizations/house-state-country.ts`:
  - Either key alone is refused.
  - The country cannot be cleared, and it must be a row of the one country table.
  - **United States:** the state is required, must resolve to a US state, and is written as the two-letter code.
  - **United Kingdom, Turkey:** the state is blank, a nation, or one of the 81 provinces.
  - **Any other country:** the state is free text, refused only when it resolves to another country. `GA` on an Indian house would read as US-GA, because the market readers are region first.
  - The same country under another spelling is not a move.
  - Every refusal ends "Nothing was changed."
- **One UPDATE, then the log (R4).**
  - The pair and any rename land in one write.
  - A move then files one `system_audit_log` row: action `house_state_country_changed`, register `state-and-country`, only the fields that moved, as `{from, to}`.
  - The PATCH answers `{stateAndCountry: not-sent|unchanged|changed, audited, auditReason}`. A log failure keeps the change and says so.
  - The location read's own error is now read: an outage answers 503, where it used to be a 404.
- **The settings log reads every register back by name (R5).**
  - `readRegister` held a hand-typed list of the first five registers. Rows under the seven added since (currency through ask-training) read back as `register: null`, and `?register=` dropped them; ConsentPanel's ask-training trail showed nothing.
  - It now reads through a `Record<SettingsRegister, true>` that the compiler holds to the union.
  - `state-and-country` is added to the type, to `REGISTERS` and to the action lists.
- **Module wiring.** `OrganizationsModule` imports `SettingsAuditModule`. The service takes the log through `@Optional()`, because `CommunicationsModule` provides `OrganizationsService` by class and cannot import `SettingsAuditModule` without a load-time ring. An instance without the log still writes, and answers `audited: false` with the reason.
- **The editor's read.** `GET /organizations/locations/:id` also returns `country`, `stateProvince` and `callerRole`, a fresh strict read of the role in *this* house. `callerRole` is null if that read failed.
- **The country table.** It is mirrored from `apps/web/src/lib/countries.ts`: 194 rows of code, name and aliases. The spec reads the web file as text and fails on any difference, the `iso-4217.spec` precedent.

**Web.**

- **The Sheet branch of `EditLocationChainDialog`** reads the pair when it opens. What it shows depends on that read:
  - **An owner:** gets a `CountryCombobox` and a State field, with the rule shown before saving.
  - **A manager:** sees the values read-only, with "Only an owner can change the state and country."
  - **A failed read:** gets no control. A field seeded with a guess would write the guess back.
- **What it sends.** The pair goes only when it moved, and always together. A rename-only edit leaves it out, so an owner can still rename a US house that has no state.
- **After saving the pair,** the gateway's receipt stays on the sheet until Done. The possible answers are "Saved", "Saved, not recorded" with the reason, "Nothing to change", or "Saved, unconfirmed" when no receipt came back.
- **The legacy Radix branch** is byte-frozen (ADR 0112/0042) and never reads the pair.
- **`LocationsSection`'s provenance note** now says that, of the edits made in this section, only an owner's change to the state or country is recorded with a name, in the settings log (ADR 0289), and that nothing records who renamed a branch, moved its city or changed its chain. It no longer speaks for the whole row: the currency, time zone, carrying cost, tone scoring, data terms and target margin settings write the same `restaurants` row (`house-currency.service.ts:207`, `house-time-zone.service.ts:159`, `house-carrying-cost.service.ts:190`, `house-tone-scoring.service.ts:89`, `house-data-terms.service.ts:417`, `target-margin.service.ts:266`/`:342`) and each files its own settings-log row.

The four "Set the … in Settings" sentences are unchanged. For an owner, they now point at a real control: Settings → Locations → Edit.

## Tests and guards

The fix round re-ran these at 555da17a5, after merging origin/main 1aa4dcb8c (#604):

- **Gateway jest** (`env LC_ALL=C npx jest src/organizations src/settings-audit --runInBand --forceExit`): 12 suites, **196 of 196** pass.
- **Web vitest** (`npx vitest run src/pages/settings/next src/components/locations`): 14 files, **204 of 204** pass, `locationStateCountry.test.tsx` 12 of 12 among them.
- **Typecheck:**
  - Gateway `tsc --noEmit -p tsconfig.spec.json`: 2 errors, both `passkeys.service.ts`, the missing `@simplewebauthn/server`.
  - Web `tsc --noEmit`: 1 error, `services/api/passkeys.ts`, the same cause.
  - None of these are in lane files.
- **Guards:**
  - `check_decision_claims.sh` under `LC_ALL=C`: **859 checked, 859 holding**.
  - `check_adr_numbers_unique.py`: OK, 0289 introduced, checked against 1680 refs.
  - `check_citation_pairing.py` (220 citations against 174 rows), `check_od_ids_exist.py`, `check_web_reads_gateway_dto_keys.py` (4 mirrors) and `check_read_errors_not_swallowed.py`: PASS, each exit 0.
- **Lint on the fix round's files:**
  - Gateway eslint on `organizations.service.ts`: 0 errors, 5 warnings (1 unused import, 4 prettier), all on lines older than this branch (`git blame`: 614978d3c, 941d9cb40, fd73d0920).
  - Web eslint `--quiet` on `LocationsSection.tsx`: clean.
- **Worktree:** clean, 0 porcelain lines.

From the builder and the independent verifier, after the merge of origin/main f5f658934, and not re-run at last call or in the fix round:

- **Gateway regression.** The 55 specs that reference `OrganizationsService`, `SettingsAuditService` or settings-audit: 54 suites, **945 of 945** tests pass. The 55th, `passkeys.service.spec.ts`, cannot load `@simplewebauthn/server`, an environment gap.
- **Profile pages.** `src/pages/profile` (which reads `GET /organizations/locations/:id`): **99 of 99**.
- **Fails without the fix.** Measured by the verifier in a scratch copy with the 6 changed source files swapped back to origin/main:
  - `house-state-country.spec.ts` plus `settings-audit.controller.spec.ts`: **28 of 58 fail**;
  - `locationStateCountry.test.tsx` against main's dialog: **11 of 12 fail** (the 12th is the legacy-branch pin).
- **Mutations:**
  - The `getLocation` `logger.warn` replaced by a no-op fails 1 test.
  - Without `@Optional()` on `settingsAudit`, `check_gateway_boots.sh` fails with Nest's unresolved `SettingsAuditService` at index [1] in the `CommunicationsModule` context.
  - Both files were restored byte-identical.
- **CI guards.** All 76 distinct `scripts/check_*.py` invocations in `ci.yml` (guards plus their `--self-test`): **76 of 76** exit 0.
  - `test_check_decision_claims.sh`: 31 ok.
  - `check_migration_order.py --event pull_request --base-ref main`: OK, 0 migrations added.
  - `check_gateway_boots.sh` (with a `NODE_PATH` stub for `@simplewebauthn`): PASS.
  - Each of the 7 `claims.d` rows holds on the lane and fails on main's sources.
- **Lint:**
  - Gateway eslint on the 9 lane files: 0 errors, 14 prettier warnings, all on lines from 8c673db4b or earlier.
  - Web eslint `--quiet` on the 3 lane files: clean.

**SQL proof.** `pgtest.sh lane … stateeditor`. The lane has no migration and no `supabase/tests` file, so there are no `[fix]` lines. The template now equals origin/main 1aa4dcb8c. Output (`audits/stateeditor-local-pg.txt`):

```
applied 0 migration(s) to stateeditor_fix
template=fb862aa574f710d4e1faf06df0ea50f1a5ce18cf lane_migrations=0 tests=0
```

## ADR and CLAIMS

- **ADR 0289** (new): "An owner sets the house's state and country in the location editor". Rules R1-R8; R6 names every reader the pair re-scopes, with `file:line`.
- **ADR 0289's status** reads "Locked for the ruling, and Proposed for the method", ADR 0285's pattern. The ruling is the founder's three answers, quoted below; R2, R3's rules for the United Kingdom, Turkey, other countries and a cross-country state, R4's receipt, R5 and R8 are the lane's design.
- **`.planning/decisions/README.md`:** one row, 0289, at the end of the Proposed table after 0285. It says the ruling is Locked and the method Proposed. No existing row is edited.
- **`claims.d/feat-house-state-in-location-editor.jsonl`** (new), 7 static claims: R2 DTO, R2 controller, R1 owner gate, R4 audit row, R5 every register reads back, R3 table mirror pinned, R8 editor sends the pair.

## Founder answers this rests on (verbatim)

- **The ruling (2026-10-04 ~00:30Z):** *"Add it to the editor (Recommended)"*. The option read: *"Add state and country to the location editor, changed by owners only and recorded in the log. This also re-scopes mail retention and the commodity/distributor panels, which read the state."*
- **Which owner (2026-10-04 ~02:10Z):** *"The house's owner (Recommended)"*. The question named the source as `restaurant_members`. No table of that name exists; the house role lives in `user_restaurant_access`, with the `users.role` fallback, both read by `lookupRestaurantRole`. ADR 0289 R1 records the correction.
- **US state (2026-10-04 ~02:10Z):** *"Required for US (Recommended)"*. A United States house must record a state; other countries stay optional.

## Forks deferred (the founder's)

- **The method under his ruling is the lane's design, not his answers.** That covers:
  - R2: the pair travels together, and the country is never cleared;
  - R3's subdivision lists for the United Kingdom and Turkey, its refusal of a state that resolves to another country, and its free text elsewhere;
  - R4's receipt;
  - R5;
  - R8's read-only view for a manager.

  He can overturn any of these. ADR 0289's status and its README row now say so.
- **US territories.** Puerto Rico and Guam are refused as "not a United States state", and the country table has no PR row. A house in a territory therefore cannot save the pair. This is outside the Tuzlu measurement and not in the ADR.
- **Two-letter provinces abroad.** On an Italian, Spanish or Dutch house, `MI`, `CA` or `NH` is refused because it reads as a US state. The refusal names the way out: write the name in full, or leave the state blank.

## Merge order

- **`.planning/decisions/README.md`** is shared with every wave lane. The branch has origin/main 1aa4dcb8c (#604) merged in, and `git merge-tree` against it is clean. 0289 is the last row of the Proposed table, after main's 0284 and 0285. A lane that also appends to that table will meet this row: keep both, in number order.
- **#561** (`fix/role-read-error-means-no-role`, open) rewrites `lookupRestaurantRole` in `organizations.service.ts`. The hunks are separate, but this PR's owner gate and `callerRole` read go through that function. Whichever lands second must re-run `house-state-country.spec.ts` and `get-location-is-role-gated.spec.ts`. If #561 drops the `users.role` fallback, ADR 0289 R1's sentence naming it becomes stale and needs a bracketed correction.
- **No migration and no SQL**, so there is no version-slot interaction with postime (`20261218101500`) or events (`20261218150000`).
- **PR-B**, on its own branch after this one, holds what the 15-file cap pushed out (see "Not covered").

## Not covered (shortcuts, named)

- **The Ledger now half-contradicts itself; deferred to PR-B for the file cap.** This PR has exactly 15 files.
  - `LedgerSection`'s "What this record does not yet cover" still lists "Locations & chains" and says a change there "files no row". A state or country change now does file one.
  - The new action shows under the generic fallback label "house state country changed".
  - `SettingsNext.test.tsx` pins that copy.
- **Stale module comments, named in ADR 0289 and not fixed (file budget):**
  - `inventory.module.ts:14`, `procurement.module.ts:65` and `settings.module.ts:36` say `OrganizationsModule` imports only Database and Auth.
  - `communications.module.ts:42` says "`organizations.service.ts` imports only DatabaseService". That was already untrue on main, which also imports `org-role` and `sign-up-timezone`; it now also imports `settings-audit.service` and `house-state-country`.
  - `settings-audit.module.ts:14` calls `SettingsModule` the module's only consumer. `pricing.module.ts` and `vendor-terms.module.ts` imported it on main already, and `OrganizationsModule` now does too.
  - The boot guard passed at the verifier's head, so there is no functional cycle.
  - The `OrganizationsService` constructor comment is corrected in this PR: it now names the ring importing `SettingsAuditModule` would close (auth → communications → settings-audit → auth) apart from the one `communications.module.ts` names (auth → communications → organizations → auth).
- **The Locations note's first sentence is unchanged from main.** It says a branch's date moves for *any* change and gives four examples (a rename, a city, a chain, a calendar feed token). The currency, time zone and the other settings above move it too; "any" covers them, but they are not named.
- **No Browser-pane check.** It needs a local gateway and database, and production is off-limits. The Sheet is covered by vitest renders only. Every CSS class it uses exists.
- **A failed read looks like an outage.** Any failed `GET`, including a 403 for a role that is neither manager nor owner, shows "could not be read … try again". That role cannot save any edit here either.
- **The State hint overstates for other countries.** "Optional. Kept as you write it." does not mention the cross-country refusal. The refusal itself explains.
- **Tuzlu's index stays quiet.** Every source holds 0 rows, so after an owner sets the state the market index changes its silence, not its lines. A-052's sentence becomes followable; no price line appears.
- **Earlier commit bodies are superseded.** `83443634a` says "every reader is region first", and `08fb10e1b` says R1 and R3 "await his confirmation" and that the pair re-scopes "currency and time-zone defaults". `3faee5aa2` supersedes all three. `3faee5aa2` in turn says the ADR "marks R1 and R3 locked" and that the README row carries the three picks, in the Locked table; `5ac54c510` supersedes that with the split status and the Proposed-table row. History was not rewritten. **Use this body, not those, for the squash message.**
- **Environment.** The shared `node_modules` lacks `@simplewebauthn/*`, so the passkeys spec, its typecheck and the unstubbed boot guard rest on CI.
- **Not re-run at last call or in the fix round:** the full gateway jest suite, the 76-guard sweep, `check_gateway_boots.sh` and the `src/pages/profile` vitest run. Those counts are the verifier's. `pgtest.sh` is last call's and was not re-run in the fix round. The fix round changed one sentence of JSX copy, one code comment and two planning files, and merged #604, which shares only `.planning/decisions/README.md` with this PR (its 0284 row, merged without a conflict).
- **Audit owed.** The independent verify passed, with minor issues only. The ADR 0090 three-role audit has not run; under "merge when audited" it is owed before merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

