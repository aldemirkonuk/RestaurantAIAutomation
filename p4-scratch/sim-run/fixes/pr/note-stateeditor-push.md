> **[2026-10-07 20:02Z, coordinator, push] Pushed head `50c9f69fb`.** It sits on the PASS at `c5f27f7a8` and adds:
> - Merges of origin/main `5e6c0684e`, `b270a45b8` (#609) and `ca3582988` (#649), all clean.
> - Records in ADR 0289 and the README row only (`3ac14bb68`, `d2d951c46`, `50c9f69fb`). No code, test or claim row changed since the PASS.
>
> **The records:**
> - The method is locked, *"Keep all, as built (Recommended)"*. It was answered at 12:54:16Z; "12:54:27Z" is corrected in brackets.
> - US territories: at 14:41:21Z the founder picked *"Every ISO country code (Recommended)"*, for a follow-up PR. That PR also adds CD and CI, which the table lacks (a defect).
> - Two-letter provinces abroad: he asked for research first. At 19:48:13Z he picked *"Keep it, read inside the country (Recommended)"*. This **supersedes R3's refusal in follow-up PRs**: the five market readers go country-first first (a defect fix), then a new ADR and the editor change. A house with no country is asked for one (*"Ask for the country (Recommended)"*).
> - **This PR's code still refuses both, as locked, until those follow-ups land.** The research is at `p4-scratch/sim-run/fixes/audits/research-r3-subdivisions-2026-10-07.md`.
>
> At this head:
> - Lane jest passes **102/102** and lane vitest **12/12**.
> - The six fast guards exit 0, gate ownership is `[]` and files = 15.
> - Decision claims hold **928/928** (Python 3.11).
>
> The PASS does not carry to this head; a delta re-audit against `c5f27f7a8` is owed before merge. The fixer's prep note follows (local head `3ac14bb68`). Where it says "not pushed" or names forks as open, read this note instead. Its stale-line replacements still apply.

> **[2026-10-07 13:09Z, fixer, local head 3ac14bb68]** Re-headed over origin/main `5e6c0684e`, and the founder's 2026-10-07 answer recorded. Not pushed. The PASS at `c5f27f7a8` does not cover this head: the head moved and the ADR text changed, so a re-audit is owed before merge.

## Commits

- **`46dd49ea6`**: merge of origin/main `5e6c0684e`, made by `merge_main.sh`. It brings in #644 `1c0e8a696`, #627 `54f833e4b`, #621 `4528b9689`, #622 `5c07cfb23`, #651 `42fe1252b` and #620 `5e6c0684e`.
  - **Conflicts:** only `.planning/decisions/README.md`, in its index rows. The script resolved it by keeping both sides in number order, so 0289 now sits after 0285 and before main's 0290.
  - No other file conflicted, and the merge changed none of the PR's 15 files except that README hunk.
- **`3ac14bb68`** `docs(adr-0289)`: two files, `0289-…md` and `README.md`.
  - **The lock.** The Status now reads "Locked, as built". The old Status words are kept in a dated bracket. The 2026-10-07 question, the picked option with its text and the rejected option with its text are quoted verbatim under "The founder's words, 2026-10-07". The Decision paragraph's "proposed for his review" line (old :60-61) is bracketed. R2, R3, R4, R5 and R8 are each marked "Kept as built by the founder, 2026-10-07".
  - **The README row** says Locked as built, gives the 2026-10-07 pick and names the two forks that stay his.
  - **"Open forks".** A new section lists US territories (`PR` and `Guam` refused, and the table has no PR, GU, VI, AS or MP row) and two-letter provinces abroad (`MI` on an Italian house, `CA` on a Spanish one, `NH` on a Dutch one). They are listed and not decided; the code refuses both, as built.
  - **What the audit owed.** Under Consequences: the readers on main that misread a country name, re-measured at the merged head; three named limits of the build; a #561 re-run line under "Revisit when"; and ADR 0304 PR-5 under "Revisit when".
  - **Cites moved by #620, corrected in brackets.** `useSettingsNextData.ts:1028` is now `:1036`. `house-time-zone.service.ts:194` is now `:283`. R6 quoted "never derived from the country, never defaulted" from `house-time-zone.service.ts:26`; #620 rewrote that rule. The sentence now cites the PUT at `:234-240` and rule 1 at `:28`, and says that `updateLocation` carries no `timezone`.

## Results at 3ac14bb68

- **`lanecheck.sh wt-fix-stateeditor`:** migration order, versions unique, OD ids, conflict markers, citation pairing and ADR numbers all give rc=0. `check_adr_numbers_unique.py` reports "0289 introduced, checked against 1735 refs". The PR has 15 files against `origin/main`, and ownership is `[]`.
- **Claims** (`check_decision_claims.sh`, Python 3.11.0): **925 checked, 925 holding**.
- **Gateway jest** (`env LC_ALL=C npx jest src/organizations src/settings-audit --runInBand --forceExit`): 12 suites, **196 of 196**. The PR's own three, `house-state-country.spec.ts`, `settings-audit.controller.spec.ts` and `get-location-is-role-gated.spec.ts`, give 3 suites, **65 of 65**.
- **Web vitest** (`npx vitest run src/pages/settings/next src/components/locations`): 15 files, **229 of 229**. `locationStateCountry.test.tsx` alone gives **12 of 12**.
- **Probes** (ts-node, Node v20.20.0, a scratch file removed after the run):
  - Across the 194 table names, `normalizeJurisdiction` sends only Georgia to another country (`US-GA`), and `countryCodeOf` gets 16 wrong or null.
  - Written as codes, 22 of the 194 read as US states through `normalizeJurisdiction`, and `countryCodeOf` reads all 194 back.
  - The SQL `normalize_country_code` maps 113 names, and 81 of the table's names pass through it unmapped.
- **`pgtest.sh` not run.** The lane has no migration and no `supabase/tests` file. The merge did bring in main's three migrations, but they are main's. `origin/main` `5e6c0684e` is past the template's `42fe1252b`, and the template was not rebuilt.
- **Not run:** typecheck, eslint, the full gateway suite, the 76-guard sweep, `check_gateway_boots.sh` and a Browser-pane check. The commit changes only `.planning/` text.

## Stale lines in the live body, with replacements

1. **Line 1** ("[2026-10-06 ~00:33Z, coordinator] Re-headed at `c5f27f7a8`. …"). Replace with: "**[2026-10-07 13:09Z] Re-headed at `3ac14bb68`.** It merges origin/main `5e6c0684e` (#644, #627, #621, #622, #651, #620); the only conflict was the README index rows, with both kept. One docs commit follows that records the founder's 2026-10-07 answer. Lines below that name an older head describe this PR before the merge."
2. **Line 64** ("… `house-time-zone.service.ts:159` …"). Replace that cite with `house-time-zone.service.ts:236`; #620 moved the write.
3. **Line 70** ("The fix round re-ran these at 555da17a5, after merging origin/main 1aa4dcb8c (#604):"). Replace with: "Re-run at `3ac14bb68`, after merging origin/main `5e6c0684e`:"
4. **Line 73** ("14 files, **204 of 204** pass"). Replace with: "15 files, **229 of 229** pass, `locationStateCountry.test.tsx` 12 of 12 among them."
5. **Line 79** ("**859 checked, 859 holding**"). Replace with: "**925 checked, 925 holding**".
6. **Line 80** ("`check_adr_numbers_unique.py`: OK, 0289 introduced, checked against 1680 refs."). Replace with: "… checked against 1735 refs."
7. **Line 81** ("`check_citation_pairing.py` (220 citations against 174 rows) …"). Replace with: "`check_citation_pairing.py`, `check_od_ids_exist.py`, the migration guards and `check_no_conflict_markers.py`: rc=0 each at `3ac14bb68` (lanecheck). `check_web_reads_gateway_dto_keys.py` and `check_read_errors_not_swallowed.py` were not re-run."
8. **Line 107** ("… The template now equals origin/main 1aa4dcb8c. Output …"). Replace with: "`pgtest.sh` was not re-run at `3ac14bb68`. The lane still has no migration and no `supabase/tests` file. The output below is last call's, against template `1aa4dcb8c`."
9. **Line 117** ("**ADR 0289's status** reads "Locked for the ruling, and Proposed for the method" … are the lane's design."). Replace with: "**ADR 0289's status** reads "Locked, as built". The founder's 2026-10-07 answer, *"Keep all, as built (Recommended)"*, keeps R2, R3, R4, R5 and R8, and the old status is kept in a dated bracket. Two forks under R3 stay his (see "Forks still open")."
10. **Line 118** ("… It says the ruling is Locked and the method Proposed. …"). Replace with: "… It says Locked as built, gives the 2026-10-07 pick and names the two forks that stay his. It still sits in the Proposed table, now between 0285 and main's 0290."
11. **Lines 121-125** ("Founder answers this rests on"). This section is incomplete, not wrong. Add: "- **The method (answered 2026-10-07, recorded 12:54:27Z):** *"Keep all, as built (Recommended)"*. The option read: *"Locks ADR 0289 as built. No code change; the PR can go to merge after its re-audit."* Rejected: *"I want to change one"*, which read: *"Say which in a note. Any change is a code change in #613 and one more audit."*"
12. **Lines 127-136** ("## Forks deferred (the founder's)" and "The method under his ruling is the lane's design, not his answers. … He can overturn any of these. ADR 0289's status and its README row now say so."). Retitle the section "## Forks still open (the founder's)". Replace the first bullet with: "The method was answered 2026-10-07: kept as built (above)."
13. **Line 137** ("… This is outside the Tuzlu measurement and not in the ADR."). Replace that sentence with: "It is listed in ADR 0289's "Open forks" as his, and is refused as built until he answers."
14. **Line 138** (two-letter provinces abroad). Append: "It is listed in ADR 0289's "Open forks" as his."
15. **Line 142** ("The branch has origin/main 1aa4dcb8c (#604) merged in, and `git merge-tree` against it is clean. 0289 is the last row of the Proposed table, after main's 0284 and 0285. …"). Replace with: "The branch has origin/main `5e6c0684e` merged in. 0289 sits in the Proposed table after 0285 and before main's 0290. A lane that also adds a row there will meet it: keep both, in number order."
16. **Line 143** (#561). Still true. Append: "ADR 0289 now records this under "Revisit when"."
17. **Line 166** ("Not re-run at last call or in the fix round: …"). Replace with: "Not re-run at `3ac14bb68`: typecheck, eslint, the full gateway suite, the 76-guard sweep, `check_gateway_boots.sh`, the `src/pages/profile` vitest and `pgtest.sh`. That commit changed only `.planning/` text."
18. **Line 167** ("**Audit owed.** The independent verify passed … The ADR 0090 three-role audit has not run; …"). Replace with: "**Re-audit owed.** The ADR 0090 audit passed at `c5f27f7a8` (`audits/613-c5f27f7a8/report.md`). That PASS covers only that SHA. This head moved, and its ADR text changed, so a re-audit is owed before merge."
19. **Add under "Not covered":** "**Readers that misread a country name, recorded and not fixed** (ADR 0289 Consequences). Georgia reads as US-GA in the market and price-book readers. `countryCodeOf` gets 16 of the 194 names wrong or null. The SQL normaliser maps 113. These readers are on main. The founder's answer is no code change and the PR is at 15 files, so a `tech-debt.d` fragment is owed on a later branch. Also recorded there: a spelling-only state change is filed as a move, two concurrent saves can each log a stale `from`, and free text takes control characters, with a NUL expected to fail as a 500 (untested)."

## Forks surfaced, not decided

- **Name or code for the country.** The audit's (b) asked whether the country should be written as its name or its code. The 2026-10-07 question did not name this. The picked option, "Locks ADR 0289 as built", covers R3's "written under the table's display name". The audit framed codes as the fix, but that premise is wrong: codes read back right through `countryCodeOf`, while 22 of them (Canada, Germany, India among them) read as US states through `normalizeJurisdiction`. Neither spelling reads right through both readers. If this is put to him, it is a reader fix, not a write-format choice.
- **README placement.** The row stays in the Proposed table because two R3 forks are open. Moving it to the Locked table once they are answered is his call (README preamble: moving a row needs his word).
