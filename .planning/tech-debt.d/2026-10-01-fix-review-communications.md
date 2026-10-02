## A refused Gmail renewal leaves the house reading as "has a mailbox" — OPEN — 2026-10-01

Filed from the /communications walk-through (COMMS-W17, page doc §14). Fix approved by the founder on its own branch.

**What.** `IntegrationsOauthService.getAccessToken` (`apps/api-gateway/src/integrations/integrations-oauth.service.ts`, at `0bfd0dca8`) throws "needs to be reconnected" when Google refuses the refresh, and writes nothing. `HouseSenderService` (`apps/api-gateway/src/communications/letters/house-sender.service.ts:278-282`) counts any `integration_oauth_connections` row with `revoked_at IS NULL` and the send scope as `sendable: true`, with no token check. So after a password change or an access removal in Google, letters and drafts show ready until a send is tried and fails. The reconnect banner on /connections covers `gmail_read` only (`apps/web/src/pages/connections/next/ConnectionsNext.tsx:340-355`).

**Fix (approved 2026-10-01, "Fix, own branch (Recommended)").** On a refused renewal, record it on the connection; the sender read reports "reconnect"; /communications shows it in "Before it can leave". Own branch, ADR and review.

## Drafted vendor replies leave from the deployment's shared mailbox — OPEN — 2026-10-01

Filed from the /communications walk-through (COMMS-W13, W13b). The founder decided the rule; the gateway half is not built on the page branch.

**What.** Four paths in `apps/api-gateway/src/procurement/procurement.service.ts` (at `0bfd0dca8`) send through the deployment's one mailbox (`gmail.service.ts` `userId: "me"`, SMTP fallback from `GMAIL_USER`), while house letters refuse it (ADR 0118 D1, `house-sender.service.ts:236-256`): `approveDraft`, `processScheduledAutoSends` (the 30-second vendor auto-send), `manualReply`, `confirmDeal`. Drafts are created by `requestDraftSend`.

**Fix (decided 2026-10-01).** With no house mailbox a drafted reply is not created, and nothing leaves from the shared mailbox for any house, on all four paths, behind a flag the founder flips. Every house gets a mailbox (connected, or one Mudavym creates, included for every house). Own branch, ADR and review. The page half (drafts already waiting stay, locked, with the reason) is on `fix/review-communications`.

## The house composer lets unchecked text and figures reach a vendor — OPEN — 2026-10-01

Filed from the /communications walk-through (COMMS-W12, research `p4-scratch/review-snap-2/research/comms-letter-features-2026-10-01.md` §2f, §9d). Six defects found by that research's finders and critic; the lines marked "re-checked" were opened again at `0bfd0dca8` before filing, the rest are the research's citations, not re-run.

1. **Subject merge tokens are not checked.** `composerGuardrails` scans subject + body for commitment language but runs the unresolved-token check on `params.body` only (`apps/api-gateway/src/communications/letters/composer-guardrails.ts:91`, `:105`, re-checked), while template subjects carry tokens (`house-letters.service.ts:1901`, `ComposeSheet.tsx:172`). `Order {{date}}` can reach a vendor raw.
2. **A credit letter can print `$` for a lira house.** `invoice-match.ts:296` formats money as `$n` (re-checked); the summary is copied into the claim (`credit-ledger.ts:184-195`) and printed verbatim (`credit-letter.ts:98-101`).
3. **A credit letter's currency defaults to USD.** Read from `procurement_credits.currency` (`house-letters.service.ts:1287`, re-checked), a `DEFAULT 'USD' NOT NULL` column overwritten only `if (order?.currency)` (`procurement.service.ts:5718`, re-checked).
4. **Any house sentence can go to a vendor.** The insight picker fetches `/analytics/insights/:id?limit=30` with no category filter (`useComposeData.ts:202`, re-checked) and `verifyInsertions` checks house, key and sentence, not category (`house-letters.service.ts:1845-1856`, re-checked). Founder: a per-purpose allow-list (COMMS-W12c F10).
5. **`dto.orderId` is not checked against this house or vendor** in the service (`house-letters.service.ts:416`, `:773`, re-checked as used; a DB-level FK/RLS backstop NOT checked).
6. **An inserted sentence's provenance is not bound to the body.** The page sends chosen sentences apart from the body (`ComposeSheet.tsx:178-183`, `:202-205`); `verifyInsertions` never compares with `dto.body` (`:1872`), so a figure edited after insertion is stored with the unedited sentence's provenance (`:782`). Not re-checked.

**Fix.** 4 and 6 close with F10's server-resolved sentence blocks; 5 must close before any order-bound block (the order-line table); 1-3 are independent one-file fixes. Own branch, not this page's.

## The draft hold rule C-01 knows only wine words — OPEN — 2026-10-01

Filed from the /communications walk-through (COMMS-W22). The founder's 2026-10-01 news: Mudavym handles all beverages, then foods.

**What.** `services/agent-orchestrator/services/constraint_engine.py:17-21` (`WINE_TOPIC_PATTERNS`) holds a drafted vendor letter as off-topic (C-01, `:161-166`) unless it names a wine word or one of bottle, case, invoice, delivery, shipment, distributor, importer, broker, allocation, sommelier, cellar. A beer, spirits or soft-drink letter that names none of those is held. The page now says "it does not seem to be about the order" rather than "the wine on order" (founder's answer, 2026-10-01). The rule is unchanged.

**Fix.** Widen the topic lock to the house's own categories (beverages, then foods) with the all-beverages work, and keep the page words true to whatever the rule checks. Not this page's branch.

## The book cannot tell who wrote a queued letter — OPEN — 2026-10-01

Filed from the /communications walk-through (COMMS-W23, built). `GET /communications/letters/queued` (`apps/api-gateway/src/communications/letters/house-letters.service.ts:1044-1067`) returns id, vendor, subject, to and send time, but not `email_headers.written_by`, while cancel is the author's alone (`:926-931`). So the book offers "Pull it back" to everyone, says "Only the person who wrote it can pull it back.", and prints the server's refusal when someone else presses it.

**Fix.** Return the author from the queued read so the page disables the button for anyone else, with the reason, and add owner/manager-only for a credit-claim letter (`:921-925`). Gateway, W13 gateway branch.

## A malformed order id reads as a server fault on the drafted-reply read — OPEN — 2026-10-02

Filed from the /communications walk-through (COMMS-W37, a disclosed SELF row: the practice stub's made-up order ids `o14`/`o15` reached the real gateway 39 times, reads only).

**What.** `GET /procurement/orders/:id/draft` (`apps/api-gateway/src/procurement/procurement.controller.ts:1288`, at `0bfd0dca8`) takes `:id` with no id check, so Postgres refuses a non-uuid id and `getPendingDraft` (`procurement.service.ts:9759-9761`) answers 500 "The pending draft could not be read. Nothing was sent." A caller's mistake is counted as a server fault and reaches the error tracker. No page sends such an id today (the ids come from the server's own drafts).

**Fix.** Check the id at the route (a uuid pipe, 400) or map Postgres `22P02` to 400 in the read; the same audit for the other `orders/:id/draft*` routes (`:741`, `:829`, `:1204`). Gateway branch, not this page's.
