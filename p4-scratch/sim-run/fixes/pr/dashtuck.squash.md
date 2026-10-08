## What this does

The dashboard's counter now starts tucked to its strip, as it already does on `/reports` and `/inventory`. A person who opens it keeps it open on every page.

- **Why.** Inside the shell at a 1280 px window the open counter leaves the dashboard's month a 36.9 px cell. Its figures draw at about 8 px, and "not recorded" breaks mid-word (#622, ADR 0290 §9).
- **The founder's answer** (2026-10-05, AskUserQuestion), verbatim: *"Counter starts tucked (Recommended)"*. The option text was: *"/dashboard joins /reports and /inventory as a page where the counter starts as a strip. A person's remembered choice still wins. Measured: a 75 px cell at 1280 with the full 12 px headline and "not recorded" on one line. 1024 stays at 39 px. One line of code, on a small follow-up branch with its own audit."*
- **The change.** The dashboard is served at `/` (`App.tsx`: `<Route path="/" element={<PageGate page="dashboard" …/>}`), so `/` joins `WIDE_PAGES` in `apps/web/src/lib/mudavym/counterPrefs.ts`. `pageKeyOf` maps the bare path, `/` with a query or hash, and degenerate forms such as `''` and `//` to `/`; no other page changes.

## Files (6, against main)

- `counterPrefs.ts`: `/` joins `WIDE_PAGES`, and its comment.
- `counterPrefs.test.ts`: `/` is tucked at 1280, 1440 and 1920, and with a query; `/orders` and `/calendar` stay open; a remembered "open" wins on `/`.
- `HouseShell.test.tsx`: mounting `/` draws "The counter, tucked" and no open counter.
- ADR 0290: Consequences says this shipped here, plus a review-trail row.
- `.planning/06-pages/DESIGN-FOUNDATION.md`: the width rule names `/`.
- The tech-debt fragment: its "owed" note says the line was built here.

#622, which this was first stacked on, merged 2026-10-06 as `5c07cfb23`.

## Tests

- At the merged head `5f99edfb3`: vitest `counterPrefs.test.ts` + `HouseShell.test.tsx`, 2 files, 38 passed (ADR 0090 audit re-run).
- CI run 37712187993 on `5f99edfb3`: 41 of 42 checks succeeded, Supabase Preview skipped; decision claims green.
- Mutation: with `/` taken back out of `WIDE_PAGES`, the new spec case and the new shell test fail (2 failed, 36 passed). The file was restored from a copy.
- ADR 0090 audit: **PASS** at `5f99edfb3` (comment 6050574191), with notes carried forward: ADR 0290:109 should add "and has not chosen yet" when next touched; `websocket.tsx:770` links to `/dashboard`, which is not a route (on main, to file).
- `tsc -p apps/web/tsconfig.json`: one error, `@simplewebauthn/browser` not found in `passkeys.ts`. It is pre-existing, and #622's head shows the same error.

## Not covered

- **Not measured in the real shell or on the deployed app.** The 75.1 px cell at 1280 is #622's fixture harness, with spacers at the shell's widths.
- **Below 1280 nothing changes.** The counter is already a strip there, so a 1024 window keeps its 38.6 px cell.
- **A person who has already opened the counter anywhere** keeps it open on the dashboard too, because the one remembered choice wins on every page (founder, 2026-10-01).
- **ADR 0290 says `/dashboard`** in places, meaning the page. Its route is `/`. The review-trail row says so.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
