TITLE: fix(documents): keep vendor-document money writes for owners and managers

> **[2026-10-07 23:39Z, coordinator] Head `81599fcf4`.** Merged origin/main `b30ca260e` (#653). `linkLine` kept both sides: #653's uuid/400 and not-a-line/404 checks run after this PR's holder gate, and `proposal-preservation.spec.ts` now calls as a manager (pairing is a holder's act). After the verifier's should and nits: the 403 for a member with a role says the photograph and the door count still go through for them; the web `UploadedDocument` names `amountsWithheld` and the cut echo's keys; `DoorModel.test.ts` pre-fills the count from a non-holder's echo; the door-echo claims row also pins that `doorEchoOf` returns `null` or the picked doc and nothing else. **New OPEN in the fragment:** a delivery's agree, accept-as-billed, proposals and verify routes are JwtAuthGuard-only (`deliveries.controller.ts:57`), and verify lands cost through `finaliseAtVerified`. Which gate fits needs research first, so it is its own lane, not this PR. Evidence at this head: gateway jest (documents and neighbours) **23 suites, 475 passed**; web vitest receiving + documents **11 files, 202 passed**; gateway and web `tsc --noEmit` clean apart from the two `@simplewebauthn` modules missing from the shared `node_modules`; eslint clean on the touched gateway files; `lanecheck.sh` six guards exit 0, files=10, ownership `[]`; decision claims **939/939**. Not audited yet.

## What was wrong for a real house

The upload response and the money writes on vendor documents were open to any signed-in person at the house. A staff member at Tuzlu could do all of the following:

- At the delivery door, upload a photo of an invoice and get every price on it back in the response (unit prices, line totals, tax, the printed figures).
- On `/receipts` or `/documents/:id`:
  - hold the seal control and change a unit price;
  - correct or tick a field;
  - confirm the transcription a vendor dispute leans on;
  - run or confirm the line pairing that decides which cost lot an invoice price lands on.

The reason: `DocumentsController` carries `JwtAuthGuard` and nothing else, and the seal service leaves the role to its caller (`apps/api-gateway/src/common/seal/seal-challenge.service.ts:86`). So a staff token could mint its own seal and spend it.

## What changed, and why

- **Eleven handlers now refuse a non-holder before any seal, read or write.** The writes are corrections, fields/verify, extraction, match, `lines/:lineId/link`, `PATCH lines/:lineId` and verify. The gate also covers the seal mints for the sealed ones.
  - The new pure `document-money-gate.ts` reads ADR 0145's `ROLE_POLICY` money row through `policyFor`. The founder's money rule is `.planning/decisions/0145-mudavym-answers-out-of-a-reading.md:763`, and `procurement_document_lines.unit_price` is named money-tagged at `:804`.
  - Owner, manager and admin pass. Staff, an unknown role and no role get a 403 sentence. It says the act is an owner's or a manager's, who the session is, that nothing was sealed or changed, and that the photo and door count still work.
- **The role comes from the token.** `JwtStrategy` re-derives the house role every request (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:60-74`), so a manager demoted between the mint and the write is refused at the write with the seal unspent.
  - I gated in the handler rather than with `@Roles`, so `route-access.expected.json` is untouched (open PR #564 edits it).
- **The door stays open.** This follows `.planning/decisions/0126-a-price-behind-a-licence-is-not-a-posting.md:634`: "The door stays open to staff; the price register does not."
  - `POST /procurement/documents` still stores everyone's paper.
  - A non-holder gets `document` cut to exactly what `DoorModel.readPaper` reads, plus `amountsWithheld: true` at the root:
    - document keys: `docType`, `docNumber`, `lines`;
    - line keys: `lineNo`, `qty`, `uom`, `packSize`, `qtyBottles`.
  - It is an allowlist, so a money field added later stays withheld. Keys are left out, never nulled.
  - `door-count` is unchanged.
  - `link-item` is unchanged. It names a shelf with no price, which matches ADR 0124's "staff may confirm" (`.planning/decisions/0124-a-bottle-has-one-identity-and-every-price-names-it.md:881`).
- **Context, not cited in code:** ADR 0253 on the unmerged PR #566 (`de4e8cade`, lines 54, 60, 80) points the same way. Money on the phone is closed to staff, the server refuses what a staff member's rights do not open, and "Receive is the door count only".
- **Forks decided as the coordinator's call** under the founder's 2026-10-07T20:04:10Z delegation, recorded in `.planning/tech-debt.d/2026-10-07-fix-document-money-writes-for-holders.md`:
  - the token role rather than the house role row;
  - `PATCH lines/:lineId` gated whole, because its only caller is the `/receipts` desk, not the door;
  - corrections and fields/verify gated whole;
  - link-item open;
  - the exact echo allowlist.

## Evidence

| Check | Result |
|---|---|
| `env LC_ALL=C npx jest src/procurement/documents src/procurement/receiving-price-held.spec.ts src/notifications/producers/invoice-confirmed.producer.spec.ts` | **23 suites, 468 passed** |
| `documents.money-gate.spec.ts` (new) | 42 cases on one fixture |
| `documents.seal.spec.ts` | 34 → 35 cases. The old "check NO role" case is rewritten, and a demoted-manager case is added |
| `npx vitest run src/pages/documents` | **3 files, 64 passed** |
| Gateway `tsc --noEmit` on `tsconfig.json` and `tsconfig.spec.json` | Only the two known `@simplewebauthn/server` errors in `passkeys.service.ts` |
| `eslint --quiet` on the four gateway files | Exit 0 |
| `lanecheck.sh wt-fix-docwrites` | Exit 0, 7 files vs origin/main, ownership `[]` |

`documents.money-gate.spec.ts` checks each of the eleven routes on one fixture:

- A staff token gets a 403 with the sentence, and no collaborator is touched.
- No role, an empty role and an unknown role get the same 403.
- Owner, manager and admin each reach the work.
- The uuid 400 still comes first.

It also checks the door side:

- `link-item` and `door-count` stay open to staff.
- The staff upload returns only the allowlisted keys, and no figure appears anywhere in it by key or by value.
- The holder upload returns the whole parse with no marker.

**Mutations.** Each was restored byte-identical from a `cp -p` snapshot and checked with `cmp`.

| Mutation | Result |
|---|---|
| Every gate call removed from the controller | 24 of 77 red (money-gate + seal specs) |
| Upload echo turned off | 2 of 42 red |
| Holder test widened from `money` to `stock` | 26 of 42 red |

**CLAIMS** (`.planning/decisions/claims.d/fix-document-money-writes-for-holders.jsonl`): two `resolved` rows, static python only.

- Both hold on this branch and exit 1 against origin/main's controller.
- They go red when:
  - a gate is removed;
  - a gate is moved after the seal;
  - link-item is gated;
  - the holder test is widened;
  - `unitPrice` or `lineTotal` is added to the echo;
  - the echo or the marker is removed;
  - the gate file is deleted.

## Not covered

- **Reads still return money to staff.** `GET /`, `GET :id` and `GET :id/canonical` are the M2 lane's.
- **The desk pages still offer staff the controls.**
  - On a sealed act, the mint is refused and `HoldToApprove` shows its own "The seal could not be issued — nothing sent.", not the gateway's sentence.
  - Match and pairing print the gateway's sentence.
  - Disabling the controls for staff is filed as OPEN in the fragment. `CanonicalDocumentPage.tsx` carries a bracketed correction of its "NO NEW ROLE GATE" note.
- [CORRECTED 23:39Z] ~~The web `UploadedDocument` type does not name `amountsWithheld`.~~ #612 merged; the type now names it (head note above).
- **Untouched files.** `seal-challenge.service.ts` (open PR #543) and `scripts/check_money_routes_are_sealed.py` prose.
- **Not run here:**
  - [CORRECTED 23:39Z] ~~`scripts/check_decision_claims.sh`~~ the coordinator ran it: 939/939;
  - any browser check;
  - any live gateway or production call.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
