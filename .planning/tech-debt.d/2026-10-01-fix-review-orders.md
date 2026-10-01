## The orders list reads at most 50 orders — OPEN — 2026-10-01

Filed from fix/review-orders (/orders walk-through, ADR 0255).

**What.** `GET /procurement/orders` takes `query.limit ?? 50` (`apps/api-gateway/src/procurement/procurement.service.ts:3031`). The page sends no limit (`apps/web/src/services/api/orders.ts:47-58`). For a house with more than 50 orders, three things go wrong:
- the station counts, the month figure and "last month" cover only the newest 50;
- a deep link `?order=<id>` to an older order says it was not among the loaded orders;
- the recurring station counts only rows among those 50.

**Today.** Production holds 3 orders across all 8 houses (measured on the walk-through). Nothing is wrong yet.

**Fix.** Either paginate the ledger and read the counts and month figure from a server-side aggregate, or, as a first step, have the page say "the newest 50" whenever it receives exactly 50.

## Manual replies are not checked for unfilled template blanks — OPEN — 2026-10-01

**What.** ORD-W7 refuses an unfilled `[Bracketed Blank]` in `issueDraftSendSeal`, `requestDraftSend` and `approveDraft` (`unfilled-slots.ts`). It does not refuse one in `issueManualReplySeal` or `send-drafted-reply`, which the founder's ruling did not cover.

**Fix.** Call `unfilledTemplateSlots` in the same position in `issueManualReplySeal` and add a spec case for it. Ask the founder first, because a manual reply is typed by a person.

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
