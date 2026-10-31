## Eleven vendor-document money handlers went to any signed-in person; now to owners and managers — FIXED — 2026-10-07

Branch `fix/document-money-writes-for-holders`. `DocumentsController` (`apps/api-gateway/src/procurement/documents/documents.controller.ts`) carried `JwtAuthGuard` only. `SealChallengeService` leaves the role to its caller (`apps/api-gateway/src/common/seal/seal-challenge.service.ts:86`). So a staff token could do all of these:

- mint its own seal and correct a field;
- tick a field;
- edit a line's unit price;
- confirm a transcription;
- run or confirm the match;
- fill an unread document.

Separately, the upload returned the whole parse to every caller, prices and totals included. Eleven handlers now call `assertHoldsHouseMoney` (`document-money-gate.ts`) before any seal, read or write, and the upload answers a non-holder with the door's keys and `amountsWithheld: true`. Pinned by `documents.money-gate.spec.ts`, `documents.seal.spec.ts` (case 28 rewritten) and two rows in `.planning/decisions/claims.d/fix-document-money-writes-for-holders.jsonl`.

Scope: FIXED covers those eleven handlers (`mintFieldCorrectSeal`, `correctField`, `mintFieldVerifySeal`, `verifyFieldTick`, `applyExtraction`, `match`, `linkLine`, `mintLineEditSeal`, `editLine`, `mintVerifySeal`, `verify`) and the upload's answer, nothing more. A staff caller can still pair a document's lines with an order through the upload, and can still steer which item an invoice price lands on through `link-item`; both are OPEN below. [ADDED 2026-10-08, fixer, after the ADR 0090 audit of `8b5849388` ruled the heading broader than the code.]

## Forks decided in this branch — DECIDED — 2026-10-07

Each of these is the coordinator's call under the founder's 2026-10-07T20:04:10Z delegation. None is in an ADR.

1. **The gate reads the token's role, through ADR 0145's `ROLE_POLICY` money row.** It does not read the house's role row through `OrganizationsService`, which the currency write still uses. `JwtStrategy` re-derives the role from the access row on every request (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:60-74`), so a demotion between a seal's mint and its write is refused at the write in the role's words, with the seal unspent (pinned in `documents.seal.spec.ts`). Rejected:
   - `@Roles` + `RolesGuard`. This would move `route-access.expected.json`, which open PR #564 touches.
   - A database read per call. This would add a second source of "who holds money" beside ADR 0145's table.

   The two gates now disagree on `admin`. The currency gate (`OrganizationsService.assertManagerOrOwner`, `apps/api-gateway/src/organizations/organizations.service.ts:273`) admits exactly `owner` and `manager`, so it refuses `admin`; ~~this gate admits `admin` through `ROLE_POLICY`, the same rule `RolesGuard` uses. Whether `admin` can be stored as a house role was not checked.~~ [ADDED 2026-10-08, fixer, after the ADR 0090 audit of `8b5849388`.] [CORRECTED 2026-10-08, after the ADR 0090 audit of `4e1398871`: this gate admits `admin` through `ROLE_POLICY_ALIASES` (`apps/api-gateway/src/ask-readings/reading-data-classes.ts`, `admin` reads the owner row). `RolesGuard` refuses it: it admits exactly the roles a route lists (ADR 0164 `:47`, `roles.guard.ts`). So this gate is the only role gate here that admits `admin`. No one holds `admin` (ADR 0164 `:24`, measured read-only 2026-09-18), so nothing changes at runtime today. The alias comment that said `RolesGuard` widens `admin` is corrected on this branch.]
2. **`PATCH :id/lines/:lineId` is gated whole, not split by payload.** The task said to split a route only if it serves both a door step and a money edit. This route's one caller is the `/receipts` desk (`apps/web/src/pages/receipts/next/ReceiptsNext.tsx:926`), which corrects one figure per PATCH: qty, unit price or line total (`:712-717`). The door's quantity travels through `POST door-count`, which stays open. A qty-only correction moves the document's tie-out and the quantity the match compares, so it is desk work on the paid record. Rejected: opening qty-only patches to staff. That would have to open the `line_edit` seal mint by payload too, for an act no door screen performs.
3. **`corrections` and `fields/verify` are gated whole, non-money paths included** (`documentNumber`, `seller.name`). Their one caller is the formatted sheet (`apps/web/src/pages/documents/next/CanonicalDocumentPage.tsx:260`, `:300`), a desk page, not the door. Same reasoning as 2.
4. **`POST :id/lines/:lineId/link-item` stays open.** It names a shelf and returns no price. By analogy, not by ruling, this follows ADR 0124's "staff may confirm" posture for identity candidates; that ruling is about identity candidates, not this route (`.planning/decisions/0124-a-bottle-has-one-identity-and-every-price-names-it.md:881`). `POST :id/lines/:lineId/link`, the order-line pairing, is gated: `match`'s own description says a wrong pairing writes one wine's invoice price onto another wine's cost lot. [ADDED 2026-10-07 23:11Z, coordinator, after the verifier's pass: the shelf a line names is still a consequence for money. `procurement_document_lines.inventory_id` is what `finalise_delivery_cost` reads to decide which item the invoice price lands on (`line-mapping.service.ts:346-349`). That price lands only when the delivery is verified (`delivery.service.ts:965`, `finaliseAtVerified`), and `POST /procurement/deliveries/:id/verify` is open to every signed-in member today: see the OPEN entry below. So keeping `link-item` open is safe only once the verify is a holder's act.]
5. **The upload echo is an allowlist of exactly what `DoorModel.readPaper` reads:**
   - document keys: `docType`, `docNumber`, `lines`;
   - line keys: `lineNo`, `qty`, `uom`, `packSize`, `qtyBottles`.

   `warnings` is left out because tie-out warnings print the figures they compared, and the door never renders them; `readPaper` counts them, and that count now reads 0. `confidence`, the dates and the vendor fields are left out because the door does not read them. Keys are omitted, never nulled, because a null price would claim the paper printed none. `catalog` and `vendor` pass unchanged:
   - `catalog`'s price admission already refuses a non-manager without figures (`CatalogIngestService.admit`).
   - `vendor` carries no money.

## The upload still pairs a document with an order for every caller — OPEN — 2026-10-08

Found by the ADR 0090 audit of `8b5849388`. Not fixed on this branch.

`POST /procurement/documents` (`DocumentsController.upload`) passes the caller's `body.orderId` to `DocumentIntakeService.ingest`. `ingest` calls `linkAndMatch` (`apps/api-gateway/src/procurement/documents/document-intake.service.ts:1175`, `:1363`).

- With an `orderId`, it calls `link(documentId, orderId, restaurantId, "manual", 1)`, so the caller chooses the order.
- Without one, `autoLink` links to the order whose `order_number` equals the PO number the paper prints, filtered by house (`:2094`; `autoLink` is declared at `:2080`).
- Either way `matchDocumentLines` then writes `order_line_id` onto every line the matcher applies (the `result.applied` loop at `:1711`; `matchDocumentLines` is declared at `:1641`).

So a staff caller does through the upload what `POST :id/match` and `POST :id/lines/:lineId/link` now refuse them. This was the upload's behaviour before this branch; the branch did not add it, and did not close it.

Separately, `link()` (`:2050`) inserts the `orderId` it is given into `procurement_document_links` with no check that the order is this house's. ~~Not verified here: whether `matchDocumentLines`' house filters stop a foreign order's lines from pairing.~~ [SETTLED 2026-10-08, after the ADR 0090 audit of `4e1398871`: the matcher reads order lines with `.eq("restaurant_id", restaurantId)` (`document-intake.service.ts:1678-1679`), so a foreign order's lines are not offered and no pairing is written.] A stray link row can still be written. Whether any later read follows that row to the foreign order, for example the invoice-currency read (`invoice-currency.ts:213`), is not verified.

Pinned as it stands by `documents.money-gate.spec.ts` ("still forwards a staff caller's orderId to intake…"), which shows the controller forwards the order, not what intake then writes. The ownership half has an `open` row in `.planning/decisions/claims.d/fix-document-money-writes-for-holders.jsonl` (`SEC-2026-10-08-DOCUMENT-LINK-ORDER-OWNERSHIP`). The staff half has no row: whether a staff upload should pair at all (drop the `orderId`, skip the match, or keep machine pairing) is an open fork, and a check cannot be written before its fix is chosen.

## Reads still return money to staff — OPEN — 2026-10-07

`GET /procurement/documents`, `GET :id` and `GET :id/canonical` return prices, totals and tie-outs to any signed-in person at the house. This branch covers writes only. Reads are the M2 lane's.

## The desk pages still offer staff the controls the gateway now refuses — OPEN — 2026-10-07

`/receipts` (`ReceiptsNext.tsx`) and `/documents/:id` (`CanonicalDocumentPage.tsx`) still show staff the line edit, match, pairing, verify, field-correct and field-tick controls.

- On the sealed acts, the mint is refused, and `HoldToApprove` shows its own "The seal could not be issued — nothing sent." The gateway's sentence is lost (`apps/web/src/components/mudavym/HoldToApprove.tsx:267-268`).
- On match and pairing, the page prints the gateway's 403 sentence through `serverMessage` (`ReceiptsNext.tsx:1020`, `:1233-1235`).

Fix: disable those controls for staff, reading the role the way `ReceiptsNext.tsx:179-181` already does for the currency control. `CanonicalDocumentPage.tsx` carries a bracketed correction saying this. The web `UploadedDocument` type (`apps/web/src/services/api/receiving.ts:119`) does not name `amountsWithheld` yet. It was not edited here because open PR #612 touches that file. [CORRECTED 2026-10-07 23:11Z, coordinator: #612 merged as `214779a76`, so the file was free. This branch now types the answer (`receiving.ts`, `UploadedDocument`): `amountsWithheld?: true`, and every key the door does not read is optional. `DoorModel.test.ts` pins that `readPaper` pre-fills the same count from the cut echo.]

## A delivery's agree, accept-as-billed and verify are open to every member — OPEN — 2026-10-07

Found while checking the `link-item` reasoning above. Not fixed on this branch, which is the documents controller only.

`DeliveriesController` (`apps/api-gateway/src/procurement/deliveries.controller.ts:57`) carries `JwtAuthGuard` only. So a staff token can `POST :id/agree` (`:263`), `:id/accept-as-billed` (`:241`), `proposals/:pid/accept` (`:214`), `proposals/:pid/counter` (`:193`) and `:id/verify` (`:275`). The verify moves money: `DeliveryService.verify` calls `finaliseAtVerified` (`delivery.service.ts:965`), which runs `finalise_delivery_cost` and turns the lots' provisional cost into the agreed invoice price. The route's own description still says it "Writes NO stock and NO cost on this build", which the code no longer matches.

The money rule (`p4-scratch/sim-run/fixes/audits/money-policy-2026-10-07.md`, "Writes") sends money writes to holders and keeps the door, door count and receiving quantities open to staff. Whether a delivery's verify counts as receiving (quantity) or as the books (cost) is not settled by that sentence: The route's own description calls verification "about the goods and the books" (`deliveries.controller.ts:279`). It needs its own research and refute before a gate is chosen. Web callers: `apps/web/src/services/api/deliveries.ts:221` (agree) and `:252` (verify).

## `door-count` takes the order id it is given without checking the house — OPEN — 2026-10-08

Found by the ADR 0090 audit of PR #659 at `4e1398871`; it predates that PR and is outside its diff. `deliveries.create` (`apps/api-gateway/src/canonical/delivery.service.ts`) does not check that a supplied `orderId` is the caller's house's order, and the difference count that follows reads that order's lines by `order_id` alone. The answer holds counts, not money. Fix on its own branch: check the order against the caller's house before the delivery row is written, with a test that a foreign order is refused.
