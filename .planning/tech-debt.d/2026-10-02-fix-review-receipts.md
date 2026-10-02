## The /receipts walk-through's unfixed findings (R3) — OPEN — 2026-10-02

Filed from the founder's /receipts walk-through of 2026-10-01 (session R3, branch `fix/review-receipts`). Every item was measured in that session; the rows cited are in `06-pages/receipts.md` §14. Line numbers are at this branch's head.

**The paper the reader kept but the sheet does not show (RECEIPTS-W41, the founder: "Fix 3, list the rest").**
- The deposit line is counted twice on SYN-TR-0001 (RECEIPTS-W14): the stated total is ₺11.186,40, while the lines plus charges plus tax come to ₺11.366,40, ₺180,00 over. The check `line_net_amount` also expects 360 for line 4 against 180 stated. `v3.0-TECH-DEBT.md` records that check as CLOSED by PR #304, and the code fix is there. The fix only fires when the line is marked as a deposit (`isDepositLine` is `lineKind === "deposit"`, `procurement/documents/parsed-document.ts:435-437`, used at `procurement/canonical/from-parsed-document.ts:472`). This document's intake snapshot has no `lineKind`, so both symptoms come back on it and on any paper read before the field existed. The deposit-line read-back (PR #306) needs the same field. Which checks a person sees is open as W14's fork, OD-207.
- The VAT rate and the amount it was charged on are not read: only the tax amount is. The sheet now says so ("Tax of … was read, but not its rate or what it was charged on.").
- The seller's tax number is resolved (vendor resolution) but not printed on the sheet.
- Ordered, Shipped and Received are never filled on Receipts: the sheet gets no delivery spine there, so every line reads "—".
- The unit is stored normalised ("bottle"), and the paper's own word ("şişe") is not kept as printed.

**Words still wrong on the page.**
- Documents & Reports' provenance strip says "read automatically" (`pages/documents/next/CanonicalDocumentPage.tsx:736`) for a document a person read and entered through the stand-in route.
- A delivery-note row in the list reads "— · no stated total" (`pages/receipts/next/ReceiptsNext.tsx:1678`): a despatch advice has no total by nature, so the clause says nothing.
- The verdict pairs each count with the printed unit (`components/documents/VerdictBlock.tsx:66-67`). A case converted to bottles would read "12 cases": the same hazard W41 guarded against in the Billed cell, not guarded here.
- The order's name reaches the page as the field `wineName` (the order mapper, `api-gateway/src/procurement/procurement.service.ts:7178`, after merging main on 2026-10-02) for any item.

**Verdicts stored before the VAT fix (RECEIPTS-W5, the founder: "Fix rule, leave rows").** The tie-out now counts the printed VAT breakdown when the tax total is missing. But a verdict already stored on a document ("does not tie out", "off by $43.47") is not recomputed. The queue rows, the card and the invoice-confirmed notice still show the old verdict until a person edits a line or the currency is restated. The edit-line and restatement wiring that passes the breakdown has no test of its own.

**Data.** About twelve test papers left in Sim Meyhouse by earlier builds (`SYN-D15-…`) now show on Receipts under "Read cleanly" (W44). Rows are never deleted from a review session, so this is the founder's call.

**How a paper gets in and finds its order.** The founder decided the ways in (RECEIPTS-W42, W43, ADR 0261); whether they close OD-206 is not ruled. Until each is built on its own branch:
- An invoice joins an order only when its printed order number equals ours exactly (`autoLink`, method `po_number`). `referencesDocNumber` is shown as "Despatch reference" but never used to link. The link methods `doc_reference`, `provider_date` and `line_overlap` are declared (`procurement/documents/document-types.ts:101-104`) and never written. The only link made by hand is an `orderId` sent with the upload itself (`procurement/documents/documents.controller.ts:913,1025`, linked at `document-intake.service.ts:1370` as `manual`). Once a document is in, no route and no screen links it to an order.
- There is no paste and no drop anywhere in the web app.
- The e-invoice number (ETTN) is kept nowhere, so the same invoice arriving as a PDF and as a photo is kept twice (dedupe is by file hash only).
- Pictures carried inside an email's text are skipped: only parts with an `attachmentId` are read (`communications/gmail-mime.ts:70-73`). Not picked by the founder, so this stays a gap.
- A HEIC photo is sent to the reader labelled `image/jpeg`: the type guess falls through to jpeg (`procurement/documents/document-extractor.service.ts:527`).

**Papers the house issues (RECEIPTS-W45, the founder: "Both").**
- The reader does not detect which way a paper runs. A service invoice the house issued lands in the vendor queue.
- The vendor step refuses a seller whose tax number equals the buyer's printed one or the house's own on file (`procurement/vendor-identity/vendor-resolution.service.ts:143-170`). On a paper the house issued, the buyer is someone else, so a house with no tax number on file could be filed as its own provisional vendor.
- There is no kind for a running-cost invoice with no goods, so it is matched against deliveries it can never have.

**The sheet goes pale under a stray "Dark" (found in P8).** When `html.dark` is set, `styles/globals.css`'s `.dark h1` and `.dark p` (around line 149, specificity 0,1,1) paint the sheet's seller name and the verdict headline pale on the paper sheet. `html.dark` comes from a choice already stored in this browser. `contexts/ThemeContext.tsx:45-47` and `stores/uiStore.ts:95-100` apply a stored `dark`, or `system` on a dark OS. Since #576 (DASH-W23) the ground is chosen on /profile as Paper or Charcoal, and `components/layout/ThemeMenu.tsx` is gone. Nothing mounted offers Light/Dark any more: `components/layout/ThemeToggle.tsx` is imported nowhere. So a person who chose Dark before #576 keeps it, with no control left to undo it (read from code, not seen live). The note at `globals.css:238` reasons that this cannot fail, but it considered only the charcoal ground, not the paper one. The letterhead mark is safe (the `paper` tone, RECEIPTS-W45c). The fix is house-wide, not a page branch's.
