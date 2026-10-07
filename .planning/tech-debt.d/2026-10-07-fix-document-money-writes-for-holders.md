## Vendor-document money writes went to any signed-in person; now to owners and managers — FIXED — 2026-10-07

Branch `fix/document-money-writes-for-holders`. `DocumentsController` (`apps/api-gateway/src/procurement/documents/documents.controller.ts`) carried `JwtAuthGuard` only. `SealChallengeService` leaves the role to its caller (`apps/api-gateway/src/common/seal/seal-challenge.service.ts:86`). So a staff token could do all of these:

- mint its own seal and correct a field;
- tick a field;
- edit a line's unit price;
- confirm a transcription;
- run or confirm the match;
- fill an unread document.

Separately, the upload returned the whole parse to every caller, prices and totals included. Eleven handlers now call `assertHoldsHouseMoney` (`document-money-gate.ts`) before any seal, read or write, and the upload answers a non-holder with the door's keys and `amountsWithheld: true`. Pinned by `documents.money-gate.spec.ts`, `documents.seal.spec.ts` (case 28 rewritten) and two rows in `.planning/decisions/claims.d/fix-document-money-writes-for-holders.jsonl`.

## Forks decided in this branch — DECIDED — 2026-10-07

Each of these is the coordinator's call under the founder's 2026-10-07T20:04:10Z delegation. None is in an ADR.

1. **The gate reads the token's role, through ADR 0145's `ROLE_POLICY` money row.** It does not read the house's role row through `OrganizationsService`, which the currency write still uses. `JwtStrategy` re-derives the role from the access row on every request (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:60-74`), so a demotion between a seal's mint and its write is refused at the write in the role's words, with the seal unspent (pinned in `documents.seal.spec.ts`). Rejected:
   - `@Roles` + `RolesGuard`. This would move `route-access.expected.json`, which open PR #564 touches.
   - A database read per call. This would add a second source of "who holds money" beside ADR 0145's table.
2. **`PATCH :id/lines/:lineId` is gated whole, not split by payload.** The task said to split a route only if it serves both a door step and a money edit. This route's one caller is the `/receipts` desk (`apps/web/src/pages/receipts/next/ReceiptsNext.tsx:926`), which corrects one figure per PATCH: qty, unit price or line total (`:712-717`). The door's quantity travels through `POST door-count`, which stays open. A qty-only correction moves the document's tie-out and the quantity the match compares, so it is desk work on the paid record. Rejected: opening qty-only patches to staff. That would have to open the `line_edit` seal mint by payload too, for an act no door screen performs.
3. **`corrections` and `fields/verify` are gated whole, non-money paths included** (`documentNumber`, `seller.name`). Their one caller is the formatted sheet (`apps/web/src/pages/documents/next/CanonicalDocumentPage.tsx:260`, `:300`), a desk page, not the door. Same reasoning as 2.
4. **`POST :id/lines/:lineId/link-item` stays open.** It names a shelf and returns no price, which matches ADR 0124's "staff may confirm" posture for identity candidates (`.planning/decisions/0124-a-bottle-has-one-identity-and-every-price-names-it.md:881`). `POST :id/lines/:lineId/link`, the order-line pairing, is gated: `match`'s own description says a wrong pairing writes one wine's invoice price onto another wine's cost lot. [ADDED 2026-10-07 23:11Z, coordinator, after the verifier's pass: the shelf a line names is still a consequence for money. `procurement_document_lines.inventory_id` is what `finalise_delivery_cost` reads to decide which item the invoice price lands on (`line-mapping.service.ts:346-349`). That price lands only when the delivery is verified (`delivery.service.ts:965`, `finaliseAtVerified`), and `POST /procurement/deliveries/:id/verify` is open to every signed-in member today: see the OPEN entry below. So keeping `link-item` open is safe only once the verify is a holder's act.]
5. **The upload echo is an allowlist of exactly what `DoorModel.readPaper` reads:**
   - document keys: `docType`, `docNumber`, `lines`;
   - line keys: `lineNo`, `qty`, `uom`, `packSize`, `qtyBottles`.

   `warnings` is left out because tie-out warnings print the figures they compared, and the door never renders them; `readPaper` counts them, and that count now reads 0. `confidence`, the dates and the vendor fields are left out because the door does not read them. Keys are omitted, never nulled, because a null price would claim the paper printed none. `catalog` and `vendor` pass unchanged:
   - `catalog`'s price admission already refuses a non-manager without figures (`CatalogIngestService.admit`).
   - `vendor` carries no money.

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

