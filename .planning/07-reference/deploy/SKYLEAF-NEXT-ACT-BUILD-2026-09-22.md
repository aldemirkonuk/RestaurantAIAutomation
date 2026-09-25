# Sketch 121 "The book opens already written" — the build record

**Branch:** `feat/skyleaf-next-act`, cut from `origin/feat/finish-arrival` (`2466fc7ef`)
on 2026-09-22. **Not** pushed to `main`, **not** merged, **not** force-pushed onto
PR #414's branch, and no production flag was touched.

**Retire-to-write (CLAUDE.md §4):** this record supersedes sketch 115's A/B/C as the
answer to the arrival-guidance question — the founder closed 115 without a winner on
2026-09-22 and has now picked this direction, so 115 is retired by that ruling, not by
this file. No other document is added; `.planning/sketches/121-skyleaf-next-act/` is the
design source and is cited, never restated.

---

## 1. Why this branch is based on #414 and not on `main`

Measured, not assumed, on 2026-09-22:

- `git ls-tree origin/main -- apps/web/src/pages` returns `GetStarted.tsx` and no
  `arrival/` directory. **The Skyleaf book exists only on `origin/feat/finish-arrival`**
  (`apps/web/src/pages/arrival/Arrival.tsx`, 1113 lines at `2466fc7ef`).
- `apps/api-gateway/src/cellar/` **is** on `origin/main` — so the API half of this work
  would have been possible from either base.

The founder's brief requires the Skyleaf flyleaf, not a card redesign on the legacy
page, so the UI half has exactly one possible home and it is #414's. Base chosen:
`origin/feat/finish-arrival`. The cost is stated plainly in §5: this branch inherits
#414's audit-gate BLOCK and its conflict with `main`, neither of which is fixed here.

The local checkout was on `feat/p1-readout` with 60+ uncommitted planning files; all work
was done in a separate worktree (`/Users/aldemirkonuk/Projects/skyleaf-next-act`) and the
new branch's upstream was **unset** immediately after creation so no push can reach
PR #414's ref by default.

---

## 2. The two founder decisions this build implements

Both were open forks in the sketch's §7 and both are now binding (2026-09-22, appended
verbatim to `memory/founder-answers-2026-09-22-page-gap.md`):

1. **The flyleaf upload is a STRONG DEFAULT, not a hard gate.** Closes sketch 121 §7.1
   and the adversarial pass's attack #3.
2. **Keep all three counts — lines read, lines placed, lines not placed.** Closes §7.3.
   "Not placed" was returned by nothing; it is built here.

Still open and **not** defaulted: §7.2, how loud the un-evidenced registers should be.
Built to the sketch's position (the service's own "unasked, not absent" sentence, visible,
with one act) and flagged as unasked. Newly opened: **OD-140**, whether the API should
return the not-placed *lines* and not only their number.

---

## 3. What shipped

### 3.1 API — the reading count (`apps/api-gateway/src/cellar/`)

The rule that decides whether a menu line lands on a register was inline in
`CellarRegistersService.readMenuLabels`, which meant it had no name and could not be
tested without a database. It now has one:

- `placeMenuLine({ category, name })` in `cellar-registers.ts` — section header first,
  item name as fallback. Moved verbatim, comment and all, from the service.
- `tallyMenuLines(lines)` → `{ read, placed, notPlaced }`. A line that lands on three
  registers is **one** placed line, the symmetric half of the double-count bug already
  fixed on the inventory side.
- `CellarRegistersReadout.menuLines: MenuLineTally | null` — returned by
  `GET /cellar/:restaurantId/registers` and therefore by `GET /arrival`.

**One source of truth, by construction.** `readMenuLabels` computes the per-register
counts and the per-line tally in the same loop, over the same rows, through the same
`placeMenuLine`. `placed` therefore *means* "the register reader placed this line" and
the reveal's headline cannot disagree with the registers printed under it. There is no
second count of the menu and no client-side classifier.

**What `read` is not, stated in the code:** it is not "lines in the uploaded file" and
not `MenuImportResult.itemsExtracted`. It is the number of `menu_items` rows this house's
book holds and the inference actually looked at. Extraction dropping a line and the
reader failing to place it are different failures; this number is only the second one's
denominator.

**`null`, never three zeroes,** when `menu_items` is unreadable — the same
absence-reported-as-health refusal the rest of that file enforces.

### 3.2 Web — the flyleaf, the reveal, and the one asking line (`apps/web/src/pages/arrival/`)

| Piece | Where | What changed |
|---|---|---|
| The inscription | `Arrival.tsx` `Inscription` | The flyleaf was a "Open the book" button over an empty book. It now holds one act: three ways in as **ruled lines, not cards** (photograph / send a file / write the lines), each affordance a phrase at the end of its line. Nothing precedes it. |
| The escape | same | "Open the book without it" — present, working, records nothing, drawn secondary. The flyleaf is **never** drawn over a book that already holds menu lines, has entries in pencil, or whose fo. 00 was carried forward. |
| The wait | same | Facts landing, not a spinner: `<filename> taken in · kept`, then two rows that state what is still owed. No percentage, no loop, no invented count. One `ar-turn` per fact, then stasis. |
| Auto-open the reveal | `Arrival.tsx` `onRead` | #414 defaulted the book back to fo. 00 after every action, so the one thing the upload produced was the one thing the house had to go looking for. A read now opens fo. 02. The legacy page already did this (`GetStarted.tsx:238-274`). |
| The reveal | `Arrival.tsx` `PourReveal` | Three counts across the head of the recto; registers the books support printed as **stated facts carrying `basis` verbatim** with their confidence as a quiet mark and **no control on them**; registers without evidence in the service's own honest sentence with one `We pour this →` that posts at once. **Nothing is ticked, so nothing can be tick-approved** — the seven pre-ticked boxes are gone, and the edit affordance sits one level down behind "Not quite right? State a register yourself". |
| Unsealed entries | same | A read stages entries in **pencil**; they are not `menu_items` yet, so they are not in the count. The page says so rather than letting the headline imply they are. |
| The failed read | same | "The menu could not be read… That is a failure to read, not an empty menu — no zero has been substituted for it." A failed read is never reported as an empty one. |
| The one asking line | `arrival-reading.ts` `nextAct` | **There is no guidance object.** Every contents line states what it knows; exactly one — never two — also states what the book still wants, and why, set in the seal. Ranked, first match wins: menu → seal → not-placed lines → currency → vendors. A folio carried forward is never re-asked. `null` is a real answer: the book asks nothing rather than inventing a suggestion. |
| Optional looks optional | `ARRIVAL_FOLIOS`, footer | `optional: true` on fo. 03. The word is on the contents line, on the folio heading, and the skip is reworded to "Not yet — carry it forward" and named as a recorded act, not an abandonment. |
| Pure logic split out | `arrival-reading.ts` (new) | `folioState`, `nextAct`, `pencilMenuRows`, `readMenuFile`, `typedLinesToCsv`, `stageMenuFile`, `MENU_FILE_LIMIT`. None of it renders; all of it is a claim about what a readout means. Net effect on lint: that directory's `react-refresh` warnings went **3 → 2**. |

`readMenuFile` / `stageMenuFile` are one implementation shared by the flyleaf and fo. 00,
which previously each had their own copy of the extension sniffing.

---

## 4. Test evidence (measured in this worktree, 2026-09-22)

| Suite | Before the change | After |
|---|---|---|
| `apps/api-gateway` `src/cellar/` | **10 failed**, 33 passed (source reverted, new tests kept) | **52 passed**, 0 failed |
| `apps/api-gateway` `src/cellar src/arrival src/menus` | — | **103 passed**, 8 suites, 0 failed |
| `apps/web` `src/pages/arrival` | **30 of 31 failed** (UI source reverted, new tests kept) | **39 passed**, 3 files, 0 failed |
| `apps/web` full `vitest run` | — | **2825 passed**, 14 skipped, 196 files, **0 failed** |
| `tsc --noEmit` web + api-gateway | — | clean, both |
| `eslint src/pages/arrival` | 3 warnings, 0 errors | **2 warnings, 0 errors** |

**Visual check.** The real component markup was rendered through the real
`mudavym.css` + `arrival.css` and screenshotted at 1440 and 390 with Playwright
(harness deleted after use, not committed). The flyleaf draws three ruled lines with the
primary tinted and the escape secondary; the reveal draws `42 / 25 / 17` with the
not-placed figure in the seal, three evidenced registers with `LIKELY` marks and no
controls, four silent registers each with one `We pour this →`, the asking contents line
tinted, and `OPTIONAL` on fo. 03. At 390 the counts stack label-left/number-right and a
register becomes one stacked entry.

**Not verified, and named as such:**

- **No end-to-end run against a live gateway or database.** `menuLines` is proven by unit
  tests over a mocked PostgREST chain, not by a real `GET /arrival`.
- **Nothing is claimed about `mudavym.com`.** This is a branch; it is not deployed.
- `apps/api-gateway` full suite: **28 suites / 1 test fail**, all in
  `auth/`, `health/`, `mcp-connections/`, `commodity/`, `ux-optimizer/`. Confirmed
  **pre-existing on `2466fc7ef`** by stashing every change in this branch and re-running
  three of them — identical failures. Not caused here and not fixed here.

---

## 5. Left for PR #414's existing BLOCK — untouched

This branch inherits both defects named in #414's audit-gate BLOCK (`sha=2466fc7`) and
**fixes neither**:

1. **Four migrations dated behind `origin/main`'s applied ceiling** —
   `20260913190500`, `20260913190600`, `20260919040000`, `20260919050000`, all below
   `main`'s newest `20260919120000`. They would land on `main`, pass every check, and
   never run in production.
2. **`feature-flag-registry.ts` adds `mudavym_design_arrival` to
   `ACTIVE_FEATURE_FLAGS` unconditionally**, and `settings.service.ts` joins every active
   key into one column-list query — so defect 1 would 500 the Settings read for every
   restaurant, not merely leave a feature dark.

Neither is in this branch's diff. `#414` is also still **CONFLICTING** with `main`; this
branch inherits that conflict and resolving it belongs to whoever owns #414.

**Consequence for merge order:** nothing here reaches production until #414's BLOCK is
cleared and #414 merges. The API half (`src/cellar/`) is the only part that would apply
cleanly to `main` on its own, if the founder wants the counts ahead of the book.

---

## 6. Forks refused rather than guessed

1. **OD-140 — the not-placed lines.** Sketch 121 frame 03 draws *"Show me the 17 it could
   not place"*. No read returns those rows and inventing a client-side query would have
   been a second classifier. No control was shipped; the copy says the book returns their
   number and will not list what it cannot name. Filed with three candidate shapes.
2. **Sketch 121 §7.2 — how loud the un-evidenced registers should be.** Built to the
   sketch's position, explicitly not closed. Same fork as
   `PAGE-WAVE-BLOCKERS-2026-09-22.md` §5 Q2.
3. **Whether the flyleaf's third way should be a real manual-entry surface.** #414 has no
   manual-entry folio; typed lines are sent through the same CSV reader as a file
   (quoted, so a drink named "Gin, Lime & Soda" stays one line). That is honest and
   reuses the pipeline, but it is not the `MenuManualEntry` component `origin/main`'s
   legacy page has. Not defaulted into a port.

## 7. Known cosmetic nit, not fixed

Register headings are the mechanical `id.replace(/_/g, ' ')` #414 already used, so
`non_alcoholic` reads "Non Alcoholic" in the heading while the `basis` sentence beside it
reads "non-alcoholic". The gateway has the proper names (`registerTitle`) but does not
return them. Fixing it means either a second home for the seven names in the browser or a
new field on the payload — neither worth doing unasked.
