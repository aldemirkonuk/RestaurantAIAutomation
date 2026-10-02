## The orders list reads at most 50 orders — OPEN — 2026-10-01

Filed from fix/review-orders (/orders walk-through, ADR 0255).

**What.** `GET /procurement/orders` takes `query.limit ?? 50` (`apps/api-gateway/src/procurement/procurement.service.ts:3031`). The page sends no limit (`apps/web/src/services/api/orders.ts:47-58`). For a house with more than 50 orders, three things go wrong:
- the station counts, the month figure and "last month" cover only the newest 50;
- a deep link `?order=<id>` to an older order says it was not among the loaded orders;
- the recurring station counts only rows among those 50.

**Today.** Production holds 3 orders across all 8 houses (measured on the walk-through). Nothing is wrong yet.

**Fix.** Either paginate the ledger and read the counts and month figure from a server-side aggregate, or, as a first step, have the page say "the newest 50" whenever it receives exactly 50.

## The blank check sees one shape of blank — OPEN — 2026-10-01

[replaces an entry filed earlier the same day. That entry said manual replies and `send-drafted-reply` went unchecked. `send-drafted-reply` was always checked, because it goes through `approveDraft`. Manual replies and the automatic send sweep are now checked too (ORD-W7 rework, ADR 0255).]

**What.** `unfilledTemplateSlots` (`apps/api-gateway/src/procurement/unfilled-slots.ts`, mirrored in `apps/web/src/pages/orders/next/unfilledSlots.ts`) matches one to four Capitalised ASCII words in square brackets. From the #578 pr-audit:
- **Missed (a blank still reaches the vendor):** lowercase or underscored blanks (`[vendor name]`, `[VENDOR_NAME]`), `{{x}}`, blanks with digits, and Turkish or other non-ASCII blanks (`[Şirket Adı]`).
- **Wrongly refused (a sound letter is blocked):** quoted-thread markers such as `[EXTERNAL]` and `[Quoted Text Hidden]`, and a bracketed wine term such as `[Riserva]`.

**Fix.** The draft generator should mark its own slots (for example `{{slot:name}}`), so nobody has to guess blanks from brackets. Until then, any wider pattern trades one list above for the other, so it needs the founder's call with real drafts in hand.

## Senders outside procurement do not check for blanks — OPEN — 2026-10-01

**What.** ORD-W7's blank check (`blanksAtSend`) runs on six procurement routes only: `issueDraftSendSeal`, `requestDraftSend`, `approveDraft`, `processScheduledAutoSends`, `issueManualReplySeal` and `manualReply`. These senders do not check, and they fill no blanks either:
- the communications service's house letters (`apps/api-gateway/src/communications/communications.service.ts`);
- the relay (`communications/relay/relay-email.service.ts`);
- `confirmDeal`'s confirmation. Its words are built in code from `describeConfirmedOrderTerms`, so no template blank can appear there today.

Found by the second #578 pr-audit.

**Fix.** Move the check into the one place every vendor-bound send passes through, then delete the per-route calls. The founder's ruling covered the sweep and the hand-written reply only, so ask first.

## The shell asks for the same thing two and three times on load — OPEN — 2026-10-01

**What.** On a fresh load of /orders as `me`: `auth/me` ×3, `users/:id/preferences` ×2 and `organizations/branches` ×2 (pane network log, 2026-10-01). All three come from shared contexts (`contexts/`), not from this page.

**Fix.** Each needs a shared react-query key, or one owner for the read. That work belongs to the shell lane.

## An opened order polls every 15s beside a live channel — OPEN — 2026-10-01

**What.** While visible, /orders polls on four timers:
- the list, every 60s (`hooks/queries/useOrderQueries.ts:39`);
- active drafts, every 30s (`useDraftEmailQueries.ts:233`);
- the opened order's conversations, every 15s (`:434`);
- its deal, every 20s (`:636`).

The page also has a WebSocket invalidation. On the local review gateway the socket never connects (`ws://localhost:4105/socket.io/` fails), so the timers are the only refresh there. Production was not checked.

**Fix.** Measure the socket in production first. If it is live, lengthen the per-order timers.
