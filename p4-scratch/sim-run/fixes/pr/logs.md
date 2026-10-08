## What was wrong for the owner

These findings come from the read-only analytics walk on Tuzlu Rüzgar (production, 2026-10-03), lane `logs`: AW06 and A-039.

**AW06 / A-039 (minor): /logs had no way to reach a day.** The page is a newest-first feed walked one cursor page at a time. Its only way back was **Read older entries** (`LogsNext.tsx:553` at `8c673db4b`). The hook never seeded the cursor: `initialPageParam: null`, and the query key had no start point (`useLogsNextData.ts:131,142`). The gateway already takes any ISO `before`:
- `logs.controller.ts:65` reads it.
- `logs-timeline.service.ts:150` parses it.
- `:560-568` normalises it to UTC `Z` and answers 400 to garbage.
- `:578-584` applies it as an inclusive `<=` OR `is.null`.

What Tuzlu's owner saw:
- **The first page held 100 import-day stock rows**, stamped 21:38–22:07 on Oct 2, with `hasMore` true.
- **Jul 22 is 2,401 till checks back** from the newest sale. Every non-POS row stamped Oct 1–2 at import sits on top of those.
- **Reaching Jul 22 took at least 28 presses** of *Read older entries*. That is a model lower bound from the walk. The walk's estimate was about 65–75 presses, assuming roughly 3,700 import-stamped stock-sale rows, which was not measured.
- **The register chips did not help.** They sieve only rows already loaded (`LogsNext.tsx:650`).
- **The walk's earlier RECOVERED verdicts were unreachable in the UI.** They used `before=` values the page never offers.

## What changed and why

Web only; no gateway change. The reader names a day, and the feed reads back from the end of that day by seeding the gateway's existing inclusive `before` cursor. That is one bounded request of 100 rows where it used to take 28 or more presses.

- **`lg-format.ts`: new `parseDay(raw)`.**
  - It accepts only a strict `YYYY-MM-DD` that survives a calendar round trip. `2026-02-30`, `2026-7-22`, a padded value and `foo` all give `null`.
  - It returns `{ key, end, heading }`. `end` is the start of the next day, in the same local calendar `dayKeyOf` draws the day headings in. Because the cursor is inclusive, nothing on the chosen day drops. A row stamped exactly at the next midnight is read too, under its own heading.
  - It refuses a day whose end would serialise with an expanded year (`9999-12-31` west of Greenwich gives `+010000-…`), so the seed keeps the four-digit shape every other cursor has.
- **`useLogsNextData.ts`.** It gains `from` (default `null`):
  - `initialPageParam: from`.
  - The query key gains `from ?? ''`, so a jumped reading is never served the newest page from cache.
  - Paging and stall logic are unchanged. A first page whose `nextCursor` equals the seed is a stall.
- **`LogsNext.tsx`: the address is the one source of truth.** It already was for the thread.
  - **The address.** `?date=YYYY-MM-DD` is the name /calendar already uses (`CalendarNext.tsx:282`). The back button undoes a jump.
  - **The form.** A native `<input type="date" max={localToday()}>` labelled *Read back from a day*. It reads on submit only, never on change, because a date field fires a change for every intermediate year typed. The key map already ignores a focused input, so typing `j` in the field moves no row.
  - **A thread reads whole.** A date never cuts a thread short, so "Ruled off" stays true. The date stays in the address, so leaving the thread returns the reader to the day they came from.
  - **Every claim stays true on a jumped reading (ADR 0086).**
    - Register counts carry `≥`, because nothing after the day was read.
    - The foot says *Showing N entries back from the end of <day>*, or *All N entries up to the end of <day> are on the page; entries after it are not read here*. It never says *the registers hold*.
    - The empty state says *Nothing is recorded on or before <day>*, or *No entry read on or before <day>* when a register failed. It never says *hold nothing for this house yet*.
    - A quiet band names the reading and carries **Back to the newest**. It also says that a till check opened on the day and closed after it sits under a later heading, and that undated rows come last.
  - **An unreadable `?date=` is said in words** (`role=status`), and the feed starts at the newest entry.
  - **`lg-turn` keys on the reading** (a thread, or the feed plus its day). The page turns when a jumped reading lands and again on *Back to the newest*, never on arrival. `MOTIONS.md` carries the row note.

The day's zone is not chosen here. The jump follows the headings, and a test pins the pair: `dayKeyOf(end − 1ms)` is the day and `dayKeyOf(end)` is the next day, on ordinary and DST days alike. If the tz lane moves either side alone, that test fails.

12 files, 636 insertions and 32 deletions, in 5 commits on `8c673db4b`. The `/logs` next face is in `LIVE_PAGES` (`useMudavymDesign.ts:212`), so this reaches every house, Tuzlu included.

## Tests and guards

I re-ran all of these myself at HEAD `09b62124a` in the clean worktree.

**Tests**
- **Web:** `npx vitest run src/pages/logs/next` gives **3 files, 74/74 passed**. The baseline at `8c673db4b` was 57, so 17 tests are new:
  - `LogsNext` 37 → 46. The 9 new tests cover: the field and its submit, arriving from the address and the turn back, the floors and foot, the empty state, the failed-register empty state, a thread from a jumped day, both params at once, an unreadable date, and typing in the field.
  - `useLogsNextData` 8 → 12. The new tests cover: the seed as the first cursor, the seeded key not served from cache, the walk from the seed, and a seed echoed back as a stall.
  - `lg-format` 12 → 16. The new tests cover: the strict parse, the day-end invariant on DST days, refusals, and the expanded-year refusal.
- **Neighbours:** the verifier ran `src/styles/mudavym-ground.test.ts` and `src/components/mudavym`: 28 files, 430 tests, all passed. I did not re-run them.
- **Gateway jest:** not run. No gateway file changes.

**Mutation proof.** These were the verifier's runs; each file was restored and compared with `cmp`.
- These mutations each failed tests:
  - Hook reverted to base: 4 tests fail.
  - Key without `from`: fails.
  - End seeded at 23:59:59.999: fails.
  - Floor ignoring `jumped`: fails.
  - Foot sentence for `hasMore` false: fails.
  - Thread not read whole: 2 fail.
  - Empty-state words: 2 fail.
  - Turn keyed on the thread only: 2 fail.
  - Silent unreadable date: fails.
  - Read on change: fails.
- One mutation survives: trimming the `date` param (see Not covered).

**Zone invariant outside the suite.** `setup.ts` pins the suite to New York, so the builder and the verifier ran the real `parseDay` (esbuild, standalone) under ten zones. Those were New York, Los Angeles, Kolkata, London, Auckland, Havana, Beirut, Kiritimati, Pago Pago and Lord Howe. Across all 365 days of 2026 there were 0 failures.

**Static checks**
- **Typecheck:** `npx tsc --noEmit | grep -v '^../../packages' | grep -c 'error TS'` gives 1. It is the missing `@simplewebauthn/browser` module already on main, in `src/services/api/passkeys.ts`; nothing is in `pages/logs`.
- **Lint:** `npx eslint --quiet --resolve-plugins-relative-to …/p4-scratch/web-lint` on the six web files exits 0.

**Guards.** Each exits 0, and so does its `--self-test`:
- `check_adr_numbers_unique` (1,663 refs)
- `check_citation_pairing`
- `check_od_ids_exist`
- `check_no_conflict_markers`
- `check_windowed_figures`
- `check_no_seeded_defaults`
- `check_web_reads_gateway_dto_keys`
- `check_a_count_is_recorded`
- `check_read_errors_not_swallowed`
- `check_money_states_its_currency`

**Claims**
- `LC_ALL=C bash scripts/check_decision_claims.sh`: 837 checked, 837 holding.
- `test_check_decision_claims.sh`: 31 ok, 0 failed.

## ADR / CLAIMS touched

- **New ADR 0277,** `.planning/decisions/0277-logs-reads-back-from-a-day.md`, status Proposed. It records the decision, eight options considered with the rejected ones, two open forks and the review trail. Its index row is in `decisions/README.md`.
  - **Number check.** I swept every ref and all 223 registered worktrees, untracked files included. 0277 is held only by this file.
  - **Renumbering.** The ADR was first numbered 0271, which collided with another worktree's untracked `0271-the-add-wine-photo-path-invents-no-wine.md`. Fix round 1 renumbered it.
- **New claim** in `.planning/decisions/claims.d/fix-logs-jump-to-a-date.jsonl`: `ADR-0277-LOGS-READS-BACK-FROM-A-DAY`, status `resolved`. Its verify is seven static greps across the hook, the page, `lg-format.ts` and the invariant test. I re-ran it: it exits 1 on `origin/main`'s copies of the four files and 0 on the branch.
- **New tech-debt** in `.planning/tech-debt.d/2026-10-03-fix-logs-jump-to-a-date.md`, OPEN.
  - **The defect.** `pos_checks` is windowed and ordered on `opened_at` (`logs-timeline.service.ts:225`) but dated by `closed_at || opened_at` (`:232`). This causes re-reads, out-of-order checks, and a jumped day that opens with checks closed after it.
  - **What it names.** It names the gateway fix and argues that no row is skipped.
  - **Status.** It was reasoned from code and not measured, and is left for a gateway lane.
- **Updated:**
  - `.planning/06-pages/logs.md`: a §1 bullet, the §1b `lg-turn` row, the §2 deep link, the §3 test counts (74) and the §4 endpoint note. It also adds roadmap item 5c, the forward walk.
  - `apps/web/src/pages/logs/next/MOTIONS.md`: the `lg-turn` row.

## Founder answers

None. The lane brief (`p4-scratch/sim-run/fixes/briefs/logs.md`) has no FOUNDER ANSWERS section, and `forks.md` carries no answer for this lane. Nothing here is built from, or quotes, a founder ruling. ADR 0277 is Proposed, and the founder locks it.

## Forks deferred (founder's call, not made here)

1. **Which clock defines "a day" on /logs?** The options are the viewer's browser zone, which the headings use today (`lg-format.ts:162-169`), or the house's `restaurants.timezone`, falling back to the viewer's (ADR 0207 Q6).
   - This is finding A-056, owned by the `tz` lane (`briefs/tz.md:46`).
   - The plan recommends the house's zone, delivered by the tz lane.
   - This lane picks neither. The jump follows the headings, and the invariant test holds the two together.
2. **Should /logs also walk forward after a jump ("Read newer entries")?**
   - That needs an `after` cursor on `GET /logs/timeline`, with its own ADR and PR.
   - The plan recommends not now. Until then, the page says that entries after the day are not read, and the reader names a later day or presses *Back to the newest*.

Neither fork blocks this PR. Both are recorded in ADR 0277 "Open forks" and in `forks.md`. Neither is filed as an `OPEN-DECISIONS.md` row (see Not covered).

## Merge-order notes

- **`decisions/README.md` conflicts with current `origin/main` `fb862aa57`.**
  - #600 appended the 0285 row directly after the 0265 row, which is where this branch's 0277 row sits.
  - The resolution is mechanical: keep both rows in number order (0265, 0277, 0285).
  - Against `c3b1a227e` (#599) and `619a068a9` (#592), the merge is clean.
  - Every other fix lane that adds an ADR also appends a row here: cap, sig, postime, events, rec, sighting, doortime, dash, caltakings, recregisters and stateeditor. Each one is the same one-line keep-both resolution.
- **PR #565** (`fix/review-shared-batch-1`, open, paused with the dashboard work) touches `LogsNext.tsx`, `LogsNext.test.tsx` and `.planning/06-pages/logs.md`.
  - **`LogsNext.tsx`.** #565 inserts lines directly after `const data = useLogsNextData(correlationId);`, and this branch changes that line. A small text conflict is certain whichever merges second. Keep this branch's two-argument call.
  - **The other two files.** This branch's test describe and §1 bullet were placed away from #565's hunks.
- **The `tz` lane** has a brief only and no branch yet. It will likely edit `lg-format.ts` `dayKeyOf`, `fmtDay` and `fmtClock`. `parseDay` sits below `threadSpan`, away from those helpers. The day-end invariant test is the deliberate coupling: it fails if the headings and the jump move apart.
- **No other open PR** touches `pages/logs`, `06-pages/logs.md` or `lg-format.ts` (checked with `gh pr list` today).

## Not covered (CLAUDE.md §0.5)

- **No Browser pane or visual check.** That includes the date field at phone width and the native picker. The page needs a signed-in gateway, and this lane makes no production calls. The rendered sentences are pinned by exact-string tests instead.
- **The zone invariant runs in CI only in New York.** `setup.ts` pins the suite's TZ. The ten-zone runs above were standalone and are not in CI.
- **A-039's production figures were not re-measured.** That covers 28 presses, 2,401 checks and the 100 import-day rows on the first page. The "one request" result for Jul 22 is reasoned from code and proven by tests, not measured on Tuzlu.
- **Part of A-039 is not fixed here.** The re-read effect ("70–100 new rows per page") comes from the gateway's `opened_at`/`closed_at` mismatch. It is filed OPEN in tech-debt, reasoned from code and not measured.
  - A jumped day can open with checks that closed after it. They show under their own later heading, and the band says so.
  - The register chips still sieve only loaded rows (roadmap 5b).
- **The forks are not in `OPEN-DECISIONS.md`.** CLAUDE.md §0.1 says an undecided fork gets a register row. They live only in ADR 0277 and `forks.md`, because a new register row shifts the row citations that follow it. The orchestrator still owes the founder both questions.
- **PostgREST's handling of a `+` year was not checked.** It does not matter here, because `parseDay` refuses any seed of that shape.
- **One mutation survives.** Trimming the `date` param in `LogsNext.tsx` passes the page tests; only a comment says "not trimmed". `parseDay`'s own test does reject `' 2026-07-22'`, so the effect is cosmetic.
- **Some words are slightly broader than the code.**
  - The band says "every count is a floor", but a zero count draws no `≥`. This is the same convention as the non-jumped floor, and the zero cell says "nothing on this page" in words.
  - The README row says "took at least 28 presses" without the "model lower bound" qualifier that the ADR body carries.
- **Early commit bodies are stale.** `8ed59dd47` and `3e6eec7c7` still say "ADR 0271" and "72 tests". Later commits correct both, and squash removes them.
- **Old stale lines in `.planning/06-pages/logs.md` were left alone.**
  - The page doc still describes `LogsTimelinePage.tsx` as a live legacy face behind an OFF-by-default `mudavym_design_logs`. This appears in the frontmatter at `:6` and at `:45`, `:49-51`, `:110` (`App.tsx:386` with `legacy=LogsTimelinePage`), `:119-120`, `:131`, `:147-148` and `:236-239`.
  - In the tree, `logs` is in `LIVE_PAGES` (`useMudavymDesign.ts:212`), the route is `App.tsx:523` with no legacy, and `LogsTimelinePage.tsx` no longer exists.
  - This lane did not write those lines or correct them. That is a separate docs fix.
- **Retire-to-write (CLAUDE.md §4).** The branch adds ADR 0277, a claims fragment and a tech-debt fragment, and retires nothing. They are the records §5 and §5b require for a decision and a claim.
- **Suites not run:** the repo-wide vitest, and the gateway jest (no gateway change).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
