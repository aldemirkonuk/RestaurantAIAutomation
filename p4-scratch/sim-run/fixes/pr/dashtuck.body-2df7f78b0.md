> **[2026-10-07 23:59Z, coordinator] Head `2df7f78b0`, base retargeted to `main`.** #622 merged on 2026-10-06 as `5c07cfb23`, so the "Stacked on #622" section below is history: against main this PR is **6 files** (the 5 named below plus `.planning/06-pages/DESIGN-FOUNDATION.md`). Since the live head `9666b4f89`:
> - `db6555650` merges main `ca3582988`, and `2df7f78b0` merges main `b30ca260e`.
> - `60d28f1a0` names the options the tuck pick beat.
> - `a5382a99f` re-cites `WIDE_PAGES` (`counterPrefs.ts:42`) and names `/` in the design foundation's width rule.
> - `21ac9254b` records that `/` is where sign-in lands (`Login.tsx:122`).
> - `92e3a3ee3` narrows that sentence (the verifier's should): it now names who first sees the strip (no page to return to, no choice made yet) and says how often was not measured.
>
> Evidence: vitest `counterPrefs.test.ts` + `HouseShell.test.tsx` **2 files, 38 passed**; decision claims **937/937**; `lanecheck.sh` six guards 0, files=6, ownership `[]`. Not audited yet; no browser check at this head.

## What this does

The dashboard's counter now starts tucked to its strip, as it already does on `/reports` and `/inventory`. A person who opens it keeps it open on every page.

- **Why.** Inside the shell at a 1280 px window the open counter leaves the dashboard's month a 36.9 px cell. Its figures draw at about 8 px, and "not recorded" breaks mid-word (#622, ADR 0290 §9).
- **The founder's answer** (2026-10-05, AskUserQuestion), verbatim: *"Counter starts tucked (Recommended)"*. The option text was: *"/dashboard joins /reports and /inventory as a page where the counter starts as a strip. A person's remembered choice still wins. Measured: a 75 px cell at 1280 with the full 12 px headline and "not recorded" on one line. 1024 stays at 39 px. One line of code, on a small follow-up branch with its own audit."*
- **The change.** The dashboard is served at `/` (`App.tsx`: `<Route path="/" element={<PageGate page="dashboard" …/>}`), so `/` joins `WIDE_PAGES` in `apps/web/src/lib/mudavym/counterPrefs.ts`. `pageKeyOf` maps only the bare path, or `/` with a query, to `/`, so no other page changes.

## Stacked on #622

Base: `fix/dashboard-tells-the-day-true` (#622). This branch adds 5 files on top of it:

- `counterPrefs.ts`: the list, and its comment.
- `counterPrefs.test.ts`: `/` is tucked at 1280, 1440 and 1920, and with a query; `/orders` and `/calendar` stay open; a remembered "open" wins on `/`. The old "normal page" case that used `/` now uses `/calendar`.
- `HouseShell.test.tsx`: mounting `/` draws "The counter, tucked" and no open counter.
- ADR 0290: Consequences now says this shipped here, plus a review-trail row.
- The tech-debt fragment: its "owed" note now says the line was built here.

It merges after #622, and is re-based onto main once #622 lands.

## Tests

- vitest `counterPrefs.test.ts`, `HouseShell.test.tsx` and `src/pages/dashboard`: 9 files, 152 tests passed.
- Mutation: with `/` taken back out of `WIDE_PAGES`, the new spec case and the new shell test fail (2 failed, 36 passed). The file was restored from a copy.
- `tsc -p apps/web/tsconfig.json`: one error, `@simplewebauthn/browser` not found in `passkeys.ts`. It is pre-existing, and #622's head shows the same error.

## Not covered

- **Not measured in the real shell or on the deployed app.** The 75.1 px cell at 1280 is #622's fixture harness, with spacers at the shell's widths.
- **Below 1280 nothing changes.** The counter is already a strip there, so a 1024 window keeps its 38.6 px cell.
- **A person who has already opened the counter anywhere** keeps it open on the dashboard too, because the one remembered choice wins on every page (founder, 2026-10-01).
- **ADR 0290 says `/dashboard`** in places, meaning the page. Its route is `/`. The review-trail row says so.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

