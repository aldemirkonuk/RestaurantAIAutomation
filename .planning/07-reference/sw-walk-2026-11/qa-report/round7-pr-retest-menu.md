# QA round 7: adversarial re-test of #793 and #794 (with #761 #777 #778 for context)

Tested at PR heads: #793 `a765c252c`, #794 `b552933ed`, #777 `4337afead` (the stack is #777 -> #793 -> #794; each is stacked on the one before). Method: `gh pr view/diff` read-only, then a detached worktree at #794 (`/private/tmp/claude-501/qa-wt-7`, node_modules symlinked, removed afterwards). Scratch specs (`menus.qa7.spec.ts`, `menu/next/qa7.test.tsx`) lived only in that worktree. Compared against round1-menu-receipts.md (B-5, scenario 19) and round3-pr-retest.md (#777 PARTIAL).

## Verdicts

| PR | Closes | Verdict |
|---|---|---|
| #793 keep a read's warnings, refuse a read with no line | round-3 #777 residuals 2 and 3; B-5 | FIXED (merge-order hazard) |
| #794 say which pages a read missed, on /menu and first proof | round-3 #777 residual 1 | PARTIAL |
| #777 (context, newer head than round 3) | scenario 19 cap not recorded | FIXED for the 120-page cap |
| #761, #778 (context, not re-tested) | unchanged from round 3 | PARTIAL, PARTIAL |

Counts for #793/#794: FIXED 1, PARTIAL 1, NOT FIXED 0, REGRESSION 0.

## The three earlier PARTIAL gaps

1. **"Warnings stored but no UI shows them"** (round 3, #777 point 1). Mostly closed by #794, not entirely.
   - Shown on the `/menu` kept-menu list (`MenuVersions.tsx:319`), under a fresh read's result (`:248`), and under a refused read's error (`:238`). Shown on the first proof (`HouseMenu.tsx:175-181`). The first-proof path is the `GetStarted.tsx:200` photo drop, which writes the whole result through `writeProof` (`firstProof.ts:59`), so `warnings` survives to `HouseMenu`.
   - Still not shown: the three onboarding-wizard screens `MenuScanUpload.tsx:18`, `MenuCsvUpload.tsx:154-157`, `MenuManualEntry.tsx:64` call `importMenu` and hand the result on without reading `.warnings`. A partial scan through the wizard still looks like a normal import with fewer lines. On a refused read they show only `response.data.message`. #794 records this itself (tech-debt note "Onboarding upload screens do not say the warnings -- OPEN"), so it is a disclosed gap, not a hidden one.
2. **120-page cap not recorded** (scenario 19). Closed, in #777's newer head (the stack carries it, not #793/#794): `scan-parser.service.ts:620-626` pushes `{kind:"page_cap", pages:{first:121,last:N}}`. Real pdf-lib probe is in `scan-parser.split-bound.spec.ts:152-168` (125-page PDF: 12 chunk calls, warning 121-125). Arrival still refuses over 120 (413, `:603-607`), so the `[]` it stores in `importParsedItems` is true. An unreadable model reply is also recorded now (`unreadable_reply`, `:214`, `:350`). Web sentence for the cap: `menus.ts` `readWarningSentence` ("only the first 120 pages ... are read").
3. **Zero-item upload marks onboarding "menu uploaded"**. Closed by #793 `menus.service.ts:479-490` (`if (items.length === 0) throw 422`) placed before `keepSource` (`:493`), `createVersion` (`:499`) and `markMenuUploaded` (`:524`). Probed (below): no row, no storage object, flag stays false. `markMenuUploaded` is called once, from `importMenu` only. The other writer of the flag is `PATCH /onboarding` (`UpdateOnboardingProgressDto.menu_uploaded`), which is outside this PR and unchanged.

## Break attempts

Backend (jest, real `MenusService` over the spec's fake Supabase and real `CsvParserService`; 7 added tests, all pass):

| Attempt | Result |
|---|---|
| 0 lines, scan, only a `page_cap` warning | 422, body carries the warning, no menu row, flag false |
| 0 lines, CSV: BOM-only header; header plus blank rows `,`; Turkish header `şarap;fiyat`; `ad;üretici;fiyat\r\n`; empty string | all 422 with the CSV sentence, flag false |
| 0 lines, manual: `data:{}` and `items:[]` | 422, no row |
| 1 line scan with a `page_cap` warning | 200, kept, flag true, warnings echoed on the reply and in `read_warnings` |
| All pages errored (parser throws 503 "every page range errored") | 503 propagates, no row, no storage object, flag false |
| Re-upload the same file over an existing active menu | second read is a new draft (3 rows), old menu stays `active`, both drafts point at the same content-addressed `source_path` (upsert), as before |
| Refused re-upload over the same menus | 422, row count unchanged |
| 500 warnings | stored whole and listed whole; there is no cap. Real input is bounded by chunk count (at most about 12 first-level chunks, more only on re-split), so this is theoretical |

Web (vitest + RTL, worktree only):

| Attempt | Result |
|---|---|
| `kind` = `<img src=x onerror=...>`, `pages.first` = same string, `last` = `ğüşİöç` | rendered as text, no element created; the unknown kind gets the fixed generic sentence. Safe (React escaping; the sentence builder only interpolates the two page numbers) |
| 422 message `Şarap <b>x</b> okunamadı.` and `warnings:"nope"` | message shown as literal text, no `<b>`, no warnings list, no crash |
| 200 warnings on a version row at 375px `innerWidth`; 51 warnings on the first proof | all rendered, no cap, no truncation. jsdom does no layout, so real overflow at phone width is NOT verified (not rendered in a browser) |
| `readWarnings: []`, `undefined`, `null` | nothing rendered |
| `pages` first > last (`9-3`); `page_cap` with first = 61 | prints "Pages 9-3" and "only the first 60 pages" (the cap number is derived from `first - 1`, so it is only right for a first of 121) |
| `readWarnings: [null]` | **crashes the whole kept-menu panel** (`TypeError ... reading 'pages'` at `menus.ts:94`, called from `MenuVersions.tsx:67`); no error boundary caught it in the test. The server never writes a null element (the column CHECK only requires a JSON array, not element shape), so low severity, but one bad row takes the list down. A `w?.` guard would fix it |

## Does the test fail without the fix

- #793: restoring #777's `menus.service.ts` under #793's spec fails 10 tests, 5 of them in the new menu-read block, including both new tests ("a partial scan keeps WHICH pages..." and "a read that found no line is REFUSED..."). The other 5 are the existing makeCurrent block, which now mocks `parseWithWarnings` and so cannot run on the old service. So both new behaviours are guarded.
- #794: restoring #793's three web source files under #794's tests fails 6 of the 7 new tests (HouseMenu 1, MenuVersions 5). The seventh ("says nothing when the whole file was read") passes on the old code by design.
- At the PR heads: 163/163 gateway menu tests pass and 19/19 web tests pass (HouseMenu 2, MenuVersions 17).

## Residuals and hazards

1. Onboarding wizard screens do not render warnings (see gap 1). Until they do, "the user is told" holds for `/menu` and the first proof, not for the wizard. This is why #794 is PARTIAL.
2. Merge order is a hard chain: #776 (column) -> #777 -> #793 -> #794. #776 is still OPEN and its migration is in none of these branches. #793 writes and selects `read_warnings` and its claims row fails until the migration is on main; nothing checks the column is applied in production first (the PR says so). Merging #793 before the column is applied makes every menu import and version list fail.
3. Conflicts: a trial `git merge-tree` of #794 against #761 conflicts in `menus.service.ts`, `HouseMenu.tsx`, `MenuVersions.tsx` and `web/services/api/menus.ts`; against #778 it conflicts in `menus.service.ts`, its spec and `scan-parser.service.ts`. Whichever merges second needs a hand rebase.
4. The refused scan has already been billed: a 422 keeps no source and no row, so the owner pays for a read that leaves no trace except the model-spend ledger. Not claimed fixed.
5. `HouseMenu`'s "couldn't read this file" branch (`itemsExtracted === 0`, `HouseMenu.tsx:94`) is now reached only by a proof stored before this change; the PR notes it.
6. ADR 0193 item 7 is a locked decision narrowed by #793 with a dated bracket and a register row, per the rules. Not re-argued.

## Not done

No browser render at phone width, no real database or Supabase (fake client only), no live model call. #761, #778, #777 were not re-run beyond reading #777's new warning code and its spec; their round-3 verdicts stand.
