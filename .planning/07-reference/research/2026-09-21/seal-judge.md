# seal-judge: the draft-send seal cutover

This is the judge's verdict on the founder's question: what is state of the art, what is the best user experience, what does a clear role hierarchy look like, and how do we avoid blocking anyone's work.
It is read-only. Code is cited from `wt-r5-E` (branch `r5/E`, HEAD `8d409bd79`) unless it is marked as main.
Inputs were `seal-sota.md` and `seal-code.md`, and every claim I rely on was re-checked in the tree.

## 0. The researchers missed that the founder already decided the hierarchy

Neither report cites ADR 0175 or ADR 0112 F12. Both are on main.

- **ADR 0112 F12, amendment 2 (founder, 2026-09-05)** is at `.planning/decisions/0112-...md:310-313`: *"one man approval if the authority is valid — owner/manager or authorized personnel (owner can give access), otherwise double approval is needed."*
  - `:350` defines "authorized personnel" as a grant row with these fields: grantor, grantee, scope, limit, expiry and revoked-at.
- **ADR 0175 (Locked, founder, 2026-09-19)** has three relevant decisions:
  - D9 (`:63`): every vendor send is sealed. That covers `approve-draft`, `manual-reply`, `confirm-deal` and `/conversations/:id/approve`.
  - D10 (`:64`): every vendor send needs an owner, a manager or a grantee.
  - D5 (`:59`): auto-send is retired, and every send needs a person's tap.

So the hierarchy is not an open question. It is owner, then manager, then a named grantee, and anyone else gets double approval. The researchers' leading answer was risk-graded staff sends through `decideApproval`. That would supersede a decision the founder locked two days ago. It is not a neutral default.

## 1. Adversarial pass: what breaks lane E as built

1. **Staff can route around the gate, and the stakes come out inverted.** Lane E gates only `approve-draft` and `send-drafted-reply` (`procurement.service.ts:6018,6099`).
   - `manualReply` (`procurement.service.ts:6925-6930`) takes no userId. It has no role check and no seal, and it records no actor. It also discards the waiting AI draft (`:7016-7020`).
   - The web client exposes it as "Send reply" (`CommsThreadDrawer.tsx:296,689-693`).
   - `confirmDeal` (`:7291`) also has no role check, no seal and no actor. It emails the vendor by default (`:7499,7539`) at a price and quantity taken from the request body.
   - The house composer `POST /communications/letters` (`house-letters.controller.ts:120-146`) queues vendor mail from any member.
   - Net effect: a staffer refused on a routine AI reply can still confirm a money deal, or paste the same text into "Send reply", and in those paths nobody's name is recorded.
2. **Staff hit a dead end.** No send control shows a role-aware state before the hold. A staffer holds, then reads "Only managers and owners can send a drafted reply" (`seal-code.md` §5, confirmed at `DraftedReplyPanel.tsx` and `draftReplyApproval.ts:45-48`). Nothing is queued for a manager.
3. **Lane E is narrower than the locked rule.** `assertCanManageRestaurant` admits only owner or manager (`organizations.service.ts:130-137,193-199`), so it has no grantee path. The grant row does not exist yet: a search of migrations and the gateway for `grantor` found nothing.
4. **The seal grace protects nobody.**
   - `REQUIRE_DRAFT_SEND_SEAL` (`procurement.service.ts:469`) exists for "native installs predating the seal", but OD-109 (main `OPEN-DECISIONS.md:28`) says the app has never been run.
   - ADR 0175 `:17` records 0 `mobile_devices` rows on 2026-09-19.
   - The repo has no `eas.json`, no `expo-updates`, no `ios/` or `android/` directory, and the bundle id is still `ai.wineops.mobile` (`apps/mobile/app.json:18,29`).
   - Every lane E client already sends a seal: `Orders.tsx:3286-3291`, `DraftRail.tsx:396-399`, `DraftedReplyPanel.tsx:238,263` and `draftReplyApproval.ts:29-38`.
   - The only unsealed caller left is a browser tab open from before the deploy, and a refresh fixes it.
5. **One claim in `seal-code.md` §4 is wrong.** It says the gate "will 403 every existing mobile install ... manager or not". The check reads the JWT user, so a manager on an old build would pass and send unsealed while the flag is unset. The point is moot anyway, because no installs exist.

### Kill test on the recommendation, role by role

- **Owner or manager:** one hold, no change.
- **Solo-owner house:** unaffected.
- **Staff:** the work continues and only the release waits. This is a real cost at night or when no manager is online. There are two ways to soften it. The owner can promote a trusted person to manager today (ADR 0162), and a grant makes that narrower once it is built.
- **AI:** auto-send is already decided dead under ADR 0175 D5. Its claim is still open, and the sweep is live on main.
- **Phone:** there are no installs to strand, and the next build carries the same state.

## 2. State of the art, briefly

- **Binding the seal to the exact letter** (words, recipient and CC hashed at mint) is already done. It matches W3C Secure Payment Confirmation and FIDO transaction confirmation (`seal-sota.md` §2A).
- **Hierarchy without blocking** is handled in restaurant POS systems by inline manager approval plus per-person permission grants:
  - Toast prompts for a manager passcode when an employee lacks a permission, and lets the owner grant that permission to one person or job: https://support.toasttab.com/en/article/Access-Permissions-Reference and https://doc.toasttab.com/doc/platformguide/adminPermissions.html
  - Square notifies managers by push to approve team requests from their phones: https://community.squareup.com/t5/Product-Updates/Manager-approval-workflow-now-available-on-Team-app-and/ba-p/758100
- **Rollout.** Feature-flag rollouts and minimum-version gates exist to protect old clients (`seal-sota.md` §2B). With no installed phones and web redeploying instantly, there is nothing to stage.

## 3. Options (mutually exclusive, recommended first)

1. **Ask a manager, owner grants (recommended).**
   - What it does: owner, manager or grantee sends with one hold. A staffer's hold becomes a request that a manager releases with one hold. The seal is required everywhere now.
   - Cost: the largest build (a request state, notices, a grant table, and the three unsealed doors). Until grants ship, staff sends wait for a manager.
2. **Staff send routine replies.**
   - What it does: staff send when the AI's guardrails flagged nothing. Flagged letters and order letters need a manager.
   - Cost: it reverses ADR 0175 D10 and lets a text classifier decide who commits the house. The flags would also have to be recomputed on every edit, because a staff edit can add a commitment.
3. **Manager-only, as lane E.**
   - What it does: merges the gate as built.
   - Cost: staff hit an error after the hold, and can still send unsealed and unnamed through "Send reply", confirm-deal or the composer.
4. **Seal everyone, no rank.**
   - What it does: drops the manager gate, so any member sends with a hold.
   - Cost: it reverses ADR 0175 D10, and vendor mail has no hierarchy at all.

**Why option 1, in plain words:** Your staff keep doing the work: they read the letter, fix it and press send. If they are not a manager, their press goes to a manager as one tap instead of failing. You can name the staff you trust to send on their own. It is the rule you already set on 5 and 19 September, and it is how Toast and Square handle manager approval.

## 4. What gets built if he takes option 1

1. Delete the `REQUIRE_DRAFT_SEND_SEAL` grace so the seal is always required. Before merge, re-measure `mobile_devices` read-only and confirm it is still 0.
2. Add one authority check for the vendor-send act: owner, manager, or an active grant. It replaces `assertCanManageRestaurant` on mint and on send, and fails closed when the role cannot be read.
3. Add a readout that tells the panel whether this viewer may send or must ask. Use the same shape as `/orders`' `mayApprove` (`procurement.service.ts:4075-4090`, `LedgerRow.tsx:121`).
4. Turn a staff hold into a send request:
   - Save the staffer's exact edited text as the version and record who asked.
   - Mark the draft as waiting for a manager, and notify managers and owners (the web bell now, push when the pipe exists).
   - The manager releases it with one hold over that exact text. An edit makes a new version, which needs a new seal. The staffer then sees who sent it.
5. Show the same states on `/orders`, `/communications` and the phone screen (swipe, per ADR 0176).
6. Put the seal and the authority check on `manual-reply`, `confirm-deal` and `/conversations/:id/approve` in the same pass (ADR 0175 D9/D10), and record an actor on the first two.
   - The founder needs to confirm one more door: the house composer `POST /communications/letters` is a vendor send that D9's list of four does not name.
7. Build the F12 grant row with grantor, grantee, scope, limit, expiry and revoked-at.
   - Only an owner may issue a grant, and any owner may revoke one.
   - Every grant and revocation is told to all owners, and "granted by" is shown wherever the grant is used.
8. Write tests for each of these, with a mutation test per gate:
   - a staff hold becomes a request, not a 403;
   - a release sends exactly the requested version;
   - an edited letter is refused;
   - an expired grant is refused.
9. Record it as an amendment to ADR 0175 (the request state and the composer door), with matching CLAIMS rows. Do not create a new ADR.

## 5. Not verified

- **Production state was not re-measured,** because this task forbids production reads. The 1 staff account (memory, 2026-09-19) and the 0 `mobile_devices` rows (ADR 0175, 2026-09-19) are both cited, not measured.
- Whether anyone has a local dev build of the app on a phone.
- Whether `mudavym_design_communications` is on, which decides whether the composer is reachable.
- Whether a staffer's edits are saved before today's refusal. Not traced.
- The Sprout Social approval page returned 403.
- Main has moved: the local `origin/main` is `0c1422c8d`, two commits past `79dfea023`. Neither ref carries any seal code (grep count 0 on both).
