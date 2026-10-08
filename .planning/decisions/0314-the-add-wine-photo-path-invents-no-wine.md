# 0314 — The add-wine photo path invents no wine

- **Status:** Locked 2026-10-03, by the founder. This branch had one fork: what the
  "Single Wine Label Scan" button becomes. The founder answered *"Delete it"*.
- **Date:** 2026-10-03
- **Number:** written as 0271 on 2026-10-03, uncommitted. Renumbered to 0314 on 2026-10-08, before its first push. 0271 is below main's newest number (0306 on 2026-10-08), so landing it would put the record out of order; no other ADR holds 0271 (only this one's own backup ref, `backup/local-2026-10-08/addwine`). `check_adr_numbers_unique.py` gave 0313 as the next free number, but another lane already held 0313 (then uncommitted in its worktree; pushed since on `feat/w25-order-request-renderer`, PR #674).
- **Decider:** Aldemir (founder)
- **Keywords:** AddWineModal, AddWineToInventoryModal, label scan, photo, mock detection,
  Château Latour, handlePhotoWineDetected, sweetness, dry, ABV, alcohol 0, fabricated id,
  WINE_, AI Detected, attributive, ADR 0020
- **Links:**
  - [[0020-no-fabricated-answers]] (fabricated analysis is "deleted, not labelled", `:58`);
  - [[0163-the-wine-library-is-a-ledger-of-cited-or-labelled-statements]] (the attributive
    boundary, `:884-889`; §12 already lists "the `AddWineModal` mock" as retired, `:1895`;
    Proposed, so not binding);
  - [[0270-the-staff-bottle-page-stops-showing-the-legacy-taste-profile]] [not on main as of 2026-10-08: ADR 0270 is a local commit, a2e1c27c6, whose PR waits on the founder's word] (lists both
    defects as out of scope, under "Consequences → Out of scope"; local commit `a2e1c27c6`);
  - sketch 102's modal census, which already marks "Add wine (label photo)" as Retires
    (`sketches/102-modal-census/README.md:138`);
  - claims `claims.d/fix-add-wine-no-invented-wine.jsonl`.

## Context

`/inventory` mounts the add sheet: `App.tsx:370` → `InventoryCommandPage.tsx:1667` →
`AddWineToInventoryModal`. Its Photo tab had two buttons. "Open Camera / Upload Image"
opens `MenuScannerFlow`, the real scanner. "Single Wine Label Scan" opened `AddWineModal`
(imported at `AddWineToInventoryModal.tsx:21` on `8c673db4b`). That modal had no detection
backend. Two defects followed, both measured on `8c673db4b`.

1. **A fixed wine for any photo.** `AddWineModal.tsx:57-78`'s `mockDetectionResults.default`
   was returned after a fake 3-second wait. Every photo came back as Château Latour 2010 at
   94% confidence, with a Pauillac appellation, body, sweetness, acidity, 13.5% ABV, aromas,
   flavours, a marketing paragraph and a $1,200 price.
2. **Missing values were invented.** `handlePhotoWineDetected`
   (`AddWineToInventoryModal.tsx:234-269`) turned a result into a wine. Every field the
   result lacked was filled: sweetness `"dry"`, body and acidity `"medium"`, type `"red"`,
   grape, country and region `"Unknown"`, price 0, and alcohol 0. That 0 reads as a real 0%
   ABV, and ABV is attributive: *"stated, sourced or absent, never inferred"* (0163:884-889).
   The wine was then badged "AI Detected". The mock's result had every field, so this half
   was latent, but it would have fired on the first real reading that missed a field.

**Downstream, measured.** No invented value reached a save payload or a DTO. The add
callback sends `createInventoryItem` only `wineId`, stock, threshold, location and
volume/price fields (`InventoryCommandPage.tsx:1677-1703`). `CreateInventoryItemDto` takes
`wineId` with `@IsUUID()` (`inventory.dto.ts:35`), under a `whitelist` +
`forbidNonWhitelisted` ValidationPipe (`main.ts:53-56`). So the photo path's
`WINE_<timestamp>` id was refused with a 400. `handleAddToInventory` does not await
`onAddWine` and closes the sheet straight away, so that 400 surfaced nowhere. The harm was
display only: a person was shown a wine nobody read, and the add then failed silently.

## Options considered

1. **Delete the single-label path** (chosen). Remove `AddWineModal.tsx`, both buttons that
   opened it ("Single Wine Label Scan", "Scan Another Wine"), `handlePhotoWineDetected` with
   its defaults, the `detectedWine` state, the "Wine Detected Successfully!" pane and the
   "AI Detected" badge. The Photo tab keeps the real scanner. This follows ADR 0020's
   *"deleted, not labelled"* and leaves no dead end.
2. **Keep it, and say detection is unavailable.** This was the brief as written: the mock
   goes, a photo returns "not available", and the result screen renders nulls as "Not
   recorded". Rejected. Nothing could reach that result screen, so it would be dead code. A
   person would also upload a photo only to be told no.
3. **Keep the button, disabled, with an explanation.** Rejected. It is a visible control
   that does nothing, sitting one button away from the scanner that works.
4. **Do nothing.** The page keeps showing a wine nobody read.

## Decision

**The add sheet builds no wine from a photo. It adds only a library wine, by its real id.
A photo goes to the real scanner.** With no builder left, nothing fills a missing field.

## Consequences

- `AddWineToInventoryModal.tsx` loses about 100 lines and `AddWineModal.tsx` (519 lines) is
  deleted. It is recoverable at `8c673db4b`. `IsThisTheBottlePanel.tsx:10` cites it, so
  that comment carries a bracketed note.
- **Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It
  retires no document.
- **Records corrected in place, not retired.** `07-reference/UX_PATHS_CATALOG.md:227` and
  `06-pages/wines.md:1804` carry bracketed notes. Sketch 102's census files are a dated
  snapshot that cites old line numbers, and are left as they are.
- **Out of scope**, each on its own branch:
  - `lib/wine-library.ts:27-35` (`mapApiWineToUiWine`) feeds the Search tab and three other
    consumers. It gives every library wine body `"medium"`, sweetness `"dry"`, acidity
    `"medium"` and alcohol 0. Its own `coerceWineType` (`:6-14`) maps an unknown category
    to `"red"`. The register entry at `v3.0-TECH-DEBT.md:3293-3296` says that red default is
    FIXED, which is true only of `wineData.ts`'s copy. This modal draws `type`, `region`
    and `country` from that mapper.
  - A failed add closes the sheet with no error, because `handleAddToInventory` does not
    await `onAddWine` and `useCreateInventoryItem` has no `onError`.
  - `AddWineUnifiedModal.tsx` has no importer, and its `:20` comment still names
    `AddWineModal`.
  - `components/wines/WineValidationModal.tsx:69` sets `alcohol: wineData.alcohol || 0`,
    so a scan that read no strength shows 0 % ABV. It is reached through `MenuScannerModal`
    (imported by `cellar/next/WineRegister.tsx`), not through this sheet.
- **Revisit when** a real single-label reader exists. It enters through "Is this the
  bottle?" (`IsThisTheBottlePanel.tsx`, `POST /wines/submissions`), not through a wine
  object built in the sheet.

## Verification (2026-10-03, branch `fix/add-wine-no-invented-wine` at base `8c673db4b`)

- **Tests.** There are two new specs.
  - `AddWineToInventoryModal.photo.test.tsx` has 3 tests.
  - `AddWineToInventoryModal.photoDefaults.test.tsx` has 1 test. It stands in a reader that
    returns only a name and a producer.
  - Against `8c673db4b`'s two files, 3 of the 4 fail:
    - "expected [2 buttons] to deeply equal [1]";
    - "not to match /Latour|Pauillac/";
    - a received wine with `sweetness: "dry"`, `alcohol: 0`, `type: "red"`.
  - The 4th test is the positive control that the real scanner opens.
  - Mutations on this tree each turn exactly one test red. One adds a second button beside
    the scanner. The other makes the scanner button open nothing.
  - vitest `src/components/inventory src/pages/inventory src/components/wines src/pages/cellar`:
    466/466 [measured at 8c673db4b; 483/483 on 2026-10-08 after merging main 87dafc064].
  - Full web suite: 5230/5230 tests pass. 2 files fail to load, `Login.signInNote` and
    `authPages.publicDesign`, because `@simplewebauthn/browser` is missing from the linked
    `node_modules`. This branch does not touch them.
  - `tsc`: the only error is that same missing module, in `passkeys.ts`.
  - eslint on the changed files: exit 0.
- **Claims.** There are 3 static rows.
  - Each exits 1, with empty stderr, on an `origin/main` extract.
  - Each was mutation-checked. The checks were:
    - a static re-export and a dynamic `import()` of `AddWineModal`;
    - a `|| "dry"` back in code;
    - the scanner button removed;
    - a token in a comment only, which must still hold;
    - a spec deleted;
    - the Latour assertion weakened.
  - `check_decision_claims.sh`: 839/839 holding [measured at 8c673db4b; 978/978 on 2026-10-08 after merging main 87dafc064].
- **Browser.** The page was a throwaway harness on the worktree's dev server. It rendered
  the modal with no session and a seeded library cache, under a CSP that allows only
  localhost. The harness was deleted after the check.
  - The Photo tab's only buttons were the two tabs and "Open Camera / Upload Image". There
    was no file input and no "Latour", "AI Detected" or "Wine Detected Successfully!".
  - Picking the fixture library wine opened the sidebar with no badge. "Add to Inventory"
    passed the library UUID.
  - There were 0 non-local requests and 0 CSP blocks.
  - The worktree has no `.env`. So the dev server's first, root-page load could reach only
    `placeholder.supabase.co` (`lib/supabase.ts:18`) and `localhost:4000`
    (`client.ts:21`), and never production.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created; founder answered the one fork ("Delete it") |
