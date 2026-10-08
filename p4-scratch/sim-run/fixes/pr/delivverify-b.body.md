**Merge order:** after #659, then after `fix/the-delivery-desk-is-for-holders` (PR A, which carries ADR 0312). This branch is not stacked on A. It is cut from `origin/main` `be9a16ccf`, with #659 (`10642298c`) merged locally. Its sentences say verify is an owner's or a manager's act, which is true only once A is live.

## Why

ADR 0312 makes the delivery desk an act for the house-money holders, owner and manager, at the gateway. The desk acts are propose, counter, accept, accept-as-billed, agree and verify. This PR does two things for that decision.

**The page.** `/documents/:id` would still offer every desk button to staff, and each press would end in a refusal.

**The prose.** The refute pass found sentences broader than the code (ADR 0312 amendment 1):

| Sentence | What it said | What the code does |
|---|---|---|
| Verify's doc | No stock and no cost move | Verify posts cost |
| Re-verify costNote | Cost "was posted then" | It may not have been |
| Failed-post sentences | Posting "is safe to retry" | A second verify returns early and posts nothing |
| Door-count description | "Nothing here writes stock" | A count onto a delivery books its lines |
| DeliveryGates, verified line | Nothing was posted to cost "on this build" | Cost posts at verify |

## What changes

**`CanonicalDocumentPage.tsx`**

- `holdsMoney` is true when the role is owner or manager. The role is read from `activeRole`, else the account's role, then trimmed and lowercased.
- `onAgree`, `onVerify`, `onPropose`, `onCounter` and `onAccept` are passed only when `holdsMoney` is true. `DeliveryGates` and `ProposalThread` already render no button for an absent handler.
- A non-holder on a delivery sees `delivery-desk-note`: *"Agreeing, verifying and answering a position on this delivery are an owner's or a manager's acts. The door count and its photograph still go through for you."*
- `onSubmitCount` is not gated.
- The header gets a bracketed note.

**`DeliveryGates.tsx`**

- The verified line no longer says nothing posted.
- The agreed-but-not-verified line says that *"where an agreed price reaches the item, it becomes what the item cost"*.
- The not-agreed line says verification is about *"the goods and the books"*.

**`delivery.service.ts`**

- Verify's doc says this is where cost posts:
  - for each item an agreed price reaches;
  - the rest stay provisional;
  - a delivery never booked at the door posts nothing.
- The re-verify costNote now reads *"This delivery was already verified; verifying again posts nothing."*
- The failure comment says verifying again does not post, and points at OD-223.

**`delivery-stock.service.ts:427`** now says *"the lot stays provisional; verifying again does not post it."*

**`documents.controller.ts`** door-count description:

- with a delivery, the count books its lines as stock, provisionally and with no price yet;
- with no delivery it books nothing;
- cost posts at verify.

**Tests and claims**

- New `CanonicalDocumentPage.desk.test.tsx`.
- Three new `DeliveryGates` cases.
- Two resolved CLAIMS rows.

## Decision

ADR 0312 (on PR A). **It is the coordinator's call under the founder's delegation, not the founder's pick.** The founder, 2026-10-07T20:04:10Z:

> "keep working until the restaurant analytics and other pages can serve to real retaurant with every possible scenario. Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research. Do not stop until then"

## Rejected

- **Disabling the buttons with a tooltip instead of removing them.** The thread and the gates already treat an absent handler as "no control". A disabled control plus a separate sentence would say the same thing twice.
- **Admitting `admin` on the page to match `holdsHouseMoney`.** The page follows `canSeeCreditLedger` (owner or manager). ADR 0312 names the divergence as a follow-up.
- **Rewording the lapse sentences here.** They were not re-read against the gate, so they are filed as a follow-up.

## Evidence

- Web vitest, `src/pages/documents/next/` plus `canonical-sections.test.tsx`: 3 files, 115 tests passed. The desk test admits owner, manager, `" Manager "` and an account-level owner, and refuses staff, no role, an account-level staff and `admin`.
- Gateway `npx jest src/procurement`: 98 suites passed, 1 skipped; 2045 tests passed, 3 skipped.
- Gateway `tsc --noEmit`: only the 2 known `@simplewebauthn/server` errors.
- Web `tsc --noEmit`: only the known `@simplewebauthn/browser` error.
- Mutations ran in scratch with `cp -p` and `cmp` restores:
  - each of the five handlers ungated: `DOCUMENT-PAGE-OFFERS-THE-DELIVERY-DESK-ONLY-TO-HOLDERS` and the desk test go red;
  - the predicate widened to any role: the same row and the desk test go red;
  - the note removed: the same row and the desk test go red;
  - each restored stale sentence (verified line, agreed line, costNote, stock, door): `DELIVERY-VERIFY-PROSE-IS-NO-BROADER-THAN-THE-CODE` goes red;
  - the two `DeliveryGates` sentences: the sections test also goes red.

## Not done

- **The lapse sentences** (`DeliveryGates.tsx` lapse notice, and the clock's lapse text) are a filed follow-up.
- **The two sealed document writes on this page** still show their controls to staff. That is #659's named follow-up, not this PR.
- **Browser-pane check.** No Browser-pane screenshot was taken. The page was verified by vitest only.
- **Nothing was pushed.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
