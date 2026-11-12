# Brief: receipts browser-walk fixes (2026-11-11)

You are a Sonnet builder. Build four DRAFT PRs. Each one is based DIRECTLY on
`feat/receipts-desk-intake-strip` (#1044, tip 96c942637). They are not stacked on each other: their
files do not overlap, so they merge in any order. Every fork below is already
decided as "the session's call under the 2026-11-07 /goal". Write the decision and
the rejected alternatives into each PR body. If the code contradicts this brief,
STOP and report; do not guess.

## Standing rules

- Never edit, stage or commit in /Users/aldemirkonuk/Projects/restaurant-ai-automation.
  Only `git fetch` and `git worktree add` there.
- New worktrees go under ~/Projects/p4-scratch/sw-walk/wt/.
- Symlink node_modules as ~/Projects/p4-scratch/local-stack.sh does, from
  ~/Projects/p4-scratch/sw-walk/wt/new-device-code: `./node_modules`,
  `apps/web/node_modules`, `apps/api-gateway/node_modules` and `packages/ui/node_modules`.
- `git add <path>` explicitly; never a broad add.
- Heavy commands (tsc, jest, vitest) run ONLY through
  `~/Projects/p4-scratch/sim-run/heavy.sh <cmd...>`. Exit 75 means busy: wait, then retry.
- DRAFT PRs only. Never merge, mark ready, force-push or close.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Write each PR body to a file inside its worktree. It must end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- At most 15 files and 30K of diff per PR.
- Do not touch any other PR branch. Stay out of the cost-math files: `canonical/delivery-stock.service.ts`,
  `finalise_delivery_cost`, and anything about lot cost.

Evidence comes from a local-stack browser walk: a synthetic TR house, e-invoice files
uploaded through `POST /procurement/documents`, and no production. Worktree for each:
`git -C <main> worktree add -b <head> ~/Projects/p4-scratch/sw-walk/wt/<dir> origin/feat/receipts-desk-intake-strip`.

---

## PR R-A: a line can be paired with a good by hand

Head `fix/receipts-line-chooses-its-good`, dir `receipts-fix-a`.

**Defect.** `components/documents/RememberedShelf.tsx:170-185` renders "Choose an
item" only when `onChoose` is passed. `CanonicalSheet.tsx:652` passes
`onChoose={onChooseItem}`, but no caller of `<CanonicalSheet>` ever passes
`onChooseItem`. `git grep "onChooseItem={"` returns nothing, and the picker was
never built (#347). The only caller is `CanonicalDocumentPage.tsx:648`, which /receipts
embeds at `ReceiptsNext.tsx:2072`.

The result: a document line that the mapping memory has no proposal for reads
"Names no shelf yet." and offers nothing. The memory only learns from a link, so
the FIRST pairing for any vendor's line can never be made. Without it,
`finaliseAtVerified` cannot name the item the invoice prices, and the lot stays
provisional. Seen on /receipts and /documents/:id for every e-invoice line and every
unmatched photo line.

**Build.**
1. Add a new `components/documents/ItemChooser.tsx`. It is a small inline chooser, not a modal:
   - A text input labelled "Find the item" that filters the house's items by name,
     case-insensitive and accent-insensitive (`normalize('NFD').replace(/\p{M}/gu,'')`).
   - Below it, up to 8 matches as buttons. Each one shows `itemName(id)` or a fallback
     of `displayName`/`wineName`, plus the size when known.
   - A "Cancel" button.
   - Choosing one calls `onPick(inventoryId)`.
   - Props: `items`, `itemLabel(id)`, `onPick`, `onCancel` and `busy`.
   - Empty-list words: "No item matches “…”. Add it on /inventory first."
   - Failed item read (prop `itemsFailed`): "The house's items could not be read,
     so none can be chosen." Never show an empty list in that case.
2. In `CanonicalDocumentPage.tsx`:
   - Hold `choosingLineId` state.
   - Pass `onChooseItem={(lineId) => setChoosingLineId(lineId)}` to `<CanonicalSheet>`.
   - Render `<ItemChooser>` where `RememberedShelf` renders for that line. Read
     `CanonicalSheet` and decide whether the chooser goes inside the sheet or
     through a render prop. The simplest correct option is to pass `choosingLineId`
     and a `renderChooser(lineId)` prop down to `RememberedShelf`'s "nothing" state;
     say which you chose in the PR body.
   - `onPick` calls the existing `linkItem(lineId, inventoryId, 'chosen')` and then clears the state.
   - Items come from the existing `itemsQ` (`getInventory()`); pass `itemsQ.isError` as `itemsFailed`.
   - Do the same for the "unavailable" state (the memory could not be read): a person may still choose by hand.
3. Tests:
   - Extend `pages/documents/next/CanonicalDocumentPage.test.tsx` (read how it mocks `canonicalApi` and `getInventory`):
     - A line in the "nothing" state shows "Choose an item".
     - Clicking it, typing a filter and choosing calls `canonicalApi.linkLineToItem(docId, lineId, itemId, 'chosen')`.
     - Cancel calls nothing.
     - A failed item read shows the failure sentence and no buttons.
   - Add a unit test for the accent-insensitive filter (for example "sarap" finds "Şarap").

**Rejected.**
- A modal picker: it covers the paper the person is reading the line from.
- Linking from /inventory: the line is on the paper, and that is where the person is.
- Auto-linking by description: ADR 0104 forbids a guessed pairing, and the memory is "a tick a person gives".

**Checks.**
- Web: `npx vitest run src/pages/documents/next src/components/documents src/pages/receipts/next`.
- Web: `npx tsc --noEmit -p tsconfig.json`.
- Revert proof: with the `onChooseItem` prop removed, the new test fails. Say so in the PR body.

---

## PR R-B: the paper shows what its reader said, and how it was read

Head `fix/receipts-paper-says-what-its-reader-said`, dir `receipts-fix-b`.

**Defects (all seen in the walk).**
1. Intake writes the reader's own sentences to `procurement_documents.extracted.warnings`,
   but no screen shows them. A paper that arrived by email has no upload outcome line,
   so a person NEVER sees these:
   - "The file declares a DOCTYPE … it was not read."
   - "Line 2: the file counts in cases (BX) … Set it before this paper is booked."
   - "Line 3: … kilograms (KGM) …"
   - "This e-invoice is a return (IADE). Check who issued it …"
   - The buyer and tax-number checks.
   - "The original bytes could not be stored …"

   In the walk, a DOCTYPE-refused file showed only "Document · —" and "NOT EXTRACTED" with no reason.
2. Provenance (`CanonicalDocumentPage.tsx:752-760`) says "Arrived by upload · no record
   of how it was read." for an e-invoice that the UBL-TR reader read field by field.
   `extraction_model` is NULL there by design. The record of how it was read is
   `extracted.einvoice` = `{kind:'e-fatura'|'e-arşiv'|'e-irsaliye'…, profile, typeCode, signed, signatureChecked:false}`.
3. `DegradedNotice.tsx:91` always says "The original is beside this notice." In the same
   pane, "THE ORIGINAL" says "No original was stored for this document." (storage write
   failed). The two sentences contradict each other.

**Build.**
- Gateway, `documents.controller.ts` `canonicalDocument` (~line 536-640):
  - Add `warnings:extracted->warnings, einvoice:extracted->einvoice` to the `.select(...)` string.
    That is PostgREST JSON-path aliasing; check that the select still parses by reading
    how the existing spec fakes it.
  - Return `intake.warnings: string[] | null` (null when absent or not an array, filtered to
    strings, at most 20) and `intake.einvoice: {kind, profile, typeCode, signed} | null`.
  - FIRST read whether this route cuts money for a session that does not hold the house's money
    (`assertHoldsHouseMoney` / `amountsWithheld` / `document-money-gate.ts`). If it does,
    return `warnings: null` for those sessions too, because a reader warning can quote an amount.
  - Extend `canonical-route.spec.ts`:
    - warnings and einvoice pass through.
    - A non-array is null.
    - The money-gated case, if one applies.
- Web, `services/api/canonical.ts` `intake`: add the two optional fields.
- Web, `CanonicalDocumentPage.tsx`, Provenance block:
  - When `intake.einvoice` is set, the second half reads `read from the ${kind} file as written (${profile} · ${typeCode}); ${signed ? 'its signature is present but was not checked' : 'it carries no signature'}`.
    Keep the model-hover form for model reads and keep "no record of how it was read" only
    when both are absent. Reuse the upload-outcome sentence's wording in `ReceiptsIntake.tsx:85-88`.
  - Under it, when `intake.warnings?.length`, add a small list headed "What the reader noted"
    with one `<li>` per sentence, the text as written.
- Web, `DegradedNotice.tsx`:
  - Add a prop `originalStored: boolean`. At the call site (`CanonicalDocumentPage.tsx:628`)
    pass whether `res.original` names a stored file (read `canonical.ts:312` for the field).
  - When false, say "No original was stored either. " in place of "The original is beside this notice. "
- Tests:
  - `canonical-sections.test.tsx` or `CanonicalDocumentPage.test.tsx`, whichever already renders DegradedNotice and provenance.
  - Cover: e-invoice provenance words (signed and unsigned), the warning list present and absent, and both notice branches.

**Rejected.**
- Showing warnings only in /receipts' own review card: /documents/:id is the same paper.
- Writing a new column: the sentences are already stored.
- Re-deriving the warnings in the web: they are the reader's own words.

**Checks.**
- Gateway: `npx tsc --noEmit -p tsconfig.json`, `npx jest src/procurement/documents`.
- Web: vitest on `src/pages/documents/next src/components/documents src/pages/receipts/next`, and web tsc.
- Revert proof for the gateway pass-through spec.

---

## PR R-C: an e-invoice's VKN is a Turkish number

Head `fix/einvoice-vkn-is-turkish`, dir `receipts-fix-c`.

**Defect.**
- `procurement/documents/efatura/ubl-tr.ts` `partyOf()` (~line 100-136) sets `country` only
  from `PostalAddress/Country/IdentificationCode` or a `Country/Name` matching Türkiye.
- `partyOf()` picks the tax id only when `schemeID` is `VKN` or `TCKN`, which are Turkish
  schemes by definition. A file whose address omits the country therefore yields
  `vendorCountry: null`.
- `VendorResolutionService` then refuses: "the tax identity "1234567890" carries no country
  prefix and the document states no country, so it cannot be told apart from the same
  digits issued elsewhere". The vendor stays unresolved even though a vendor in the book
  carries `tax_id_normalized = 'TR:1234567890'`.
- This was seen on all five uploaded e-invoices.
- The direction check (`document-intake.service.ts` ~950) already assumes `doc.vendorCountry ?? "TR"`,
  so the two readers of the same file disagree about which country the number is from.

**Build.**
- In `partyOf`: `country = <address-derived> ?? (taxIdEl ? 'TR' : null)`. The address still
  wins when it names a country. Add a one-line comment explaining why.
- Spec in `efatura/ubl-tr.spec.ts` (read its fixtures):
  - (a) A supplier with `schemeID="VKN"` and no Country gives `vendorCountry === 'TR'`.
  - (b) The same with `Country/IdentificationCode` `DE` gives `'DE'`.
  - (c) A buyer with TCKN and no Country gives TR (check the field name the reader returns).
- Revert proof: (a) fails without the change.

**Rejected.**
- Defaulting TR inside `VendorResolutionService` for every document: that resolver serves
  photos and EDI too, where a bare 10-digit number is genuinely ambiguous.
- Defaulting on `doc.einvoice != null` in intake: it couples intake to the reader's shape,
  when the reader knows the scheme.

**Checks.** Gateway tsc, `npx jest src/procurement/documents src/procurement/vendor-identity`.

---

## PR R-D: a case line can be given its bottles-per-case on the review card

Head `fix/receipts-case-line-takes-its-pack`, dir `receipts-fix-d`.

**Defect.**
- The e-invoice reader tells the person: "Line 2: the file counts in cases (BX) and does not
  say how many are in one … Set it before this paper is booked."
- The /receipts review card's line table (`ReceiptsNext.tsx:1335-1400`, `EDITABLE_FIELDS` at
  :713-718) edits only qty, unit price and total, and does not show the line's unit at all.
  A line of "2" cases reads as a bare 2.
- `PATCH /procurement/documents/:id/lines/:lineId` already accepts `packSize`
  (`documents.controller.ts:1842-1851`), sealed over the whole patch. The web client's
  `documentsApi.editLine` patch type (`services/api/documents.ts:324-333`) does not allow it.

**Build.**
- Widen `editLine`'s patch type with `packSize: number`.
- In the review card's line table:
  - Show the unit word after the qty input: `bottle(s)`, `case(s)`, `pack(s)`, `each`, `liter(s)`, `keg(s)`.
    Use a small pure helper with a test.
  - Add a "Per case" column (`head: 'Per'`, label `Bottles per case`). It is editable through
    the existing `EditCell` + `commitEdit` path with patch key `packSize`, non-nullable, integer ≥ 1.
  - Show that column ONLY on lines whose `uom` is `case`, `pack` or `split_case`. Other rows show
    nothing in it, not an input.
  - Its "extracted N · undo" figure is a count, not money: extend the `f.key === 'qty'` check.
- Phone layout: the rows already become blocks (`.rc-lines`, W35). Check that `data-label`
  carries the new head.
- Tests in `ReceiptsNext.test.tsx`:
  - A case line shows the pack cell and the unit word.
  - A bottle line shows neither the cell nor an input for it.
  - Committing 6 sends `{ packSize: 6 }` through the sealed edit (read how the existing qty edit test asserts the patch).
- Do NOT touch cost: what a case costs per bottle at delivery is the cost-math lane's.

**Rejected.**
- Refusing to verify a case line without a pack size: that changes the verify gate, a decision of its own.
- Guessing 12: ADR 0104 BT-149, a guessed twelve is wrong by a factor of twelve.

**Checks.** Web vitest `src/pages/receipts/next`, web tsc. Revert proof.

---

## Return

For each PR, give:
- number, head, base, files and diff size;
- the exact pass lines for tests and tsc;
- the revert proof;
- anything you could not do, and why.

Do not run the local stack; the parent re-checks in the browser.
