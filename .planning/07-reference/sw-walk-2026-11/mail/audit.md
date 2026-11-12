# Mail: software audit (sw-walk, 2026-11-07)

Read from `origin/main` at `e26a5152d`. All citations are `path:line` on that tree.
- `G/` means `apps/api-gateway/src/`.
- `W/` means `apps/web/src/`.

This audit read code only. Nothing was run or built, and no production system was touched.
Performance notes are inferred from the code, not measured.

## 1. What it is for, in the restaurant's words

"Every message the house gets or sends about its business is in one place. Vendors, our staff and
guests: who wrote, about what, and what we still owe them. When a vendor answers an order, the
reply sits next to that order. A reply is already drafted, and I approve it before it leaves. It
leaves from **our** address, never somebody else's. Nothing a vendor sends us is ever lost. Raw
mail is kept only as long as we might need it for a dispute."

ADR 0118 (`.planning/decisions/0118-the-house-writes-its-own-mail.md`) is the locked shape of this
job:
- The house sends from its own mailbox or a Mudavym subdomain (D1, :130-160).
- `gmail_read` is a separate grant (D8 :322). Reads are bounded by the vendor book (D9 :344).
  The house reader feeds the same bridge (D10 :390).
- Raw mail and facts are split, and raw mail is deleted after the dispute window plus 92 days
  (D12 :450, D15 :568).
- Export goes to the house's Drive (D16 :607).

ADR 0083 (amended) says /communications shows only two sources, the history book and active
drafts.

Draft PR #747 (ADR 0357, "Letter Bench v4 is the house mail terminal") plans an Inbox tab and
inbox KPIs on the same page. The Mail tab designed in section 5 should land as that Inbox tab, not
as a second surface.

## 2. Path map

### 2a. Screens and components (web)

| Piece | Where | What it reads or does |
|---|---|---|
| Route `/communications` | `W/App.tsx:520` (lazy import :92) | `PageGate page="communications"` over `CommunicationsNext`. The legacy page is deleted. |
| Page shell | `W/pages/communications/next/CommunicationsNext.tsx` (1032 lines) | Glance strip :545-559, "Waiting on you" :620, "Drafts waiting" :674, `HouseDrafts` :783, "Conversation book" :823-869 (rows are `LedgerRow` :265), `WhoIsWriting` :974, `ComposeSheet` :977/:996, `TemplateSheet` :1015, `DraftedReplyPanel` :1018. Deep links read only `?draft=` (around :405-430) and `?reply=`. |
| Page data | `W/pages/communications/next/useCommsNextData.ts:118-137` | `useProcurementConversationHistory` (:122) plus `useActiveConversations` (:127). `newestDraftPerOrder` (:128) keeps one draft per order. |
| Folder weight | `W/pages/communications/next/` | 20 non-test files, 6,736 lines, all in one lazy route chunk. |
| History hook | `W/hooks/queries/useConversationQueries.ts:333` | `GET /api/v1/procurement/conversations/history`, staleTime 30 s. Uses its own axios instance with a localStorage token (:1-14). |
| Thread hooks | same file :163 / :189 / :213 / :228 / :243 | `useConversations`: no caller. `useConversationThreads`: one caller, `W/pages/documents-reports/next/useSortingOfficeData.ts:185`. `useConversationThread`, `useConversationStats`, `useRegenerateSummary`: no caller. |
| Draft hooks | `W/hooks/queries/useDraftEmailQueries.ts` | `useActiveConversations` :234 (`/procurement/conversations/active`, polled every 30 s), approve :293, generate AI reply :327, discard :357, seal challenges :210/:224/:270. `useForceFetchReplies` :575 has no caller. |
| Orphan component | `W/components/conversations/ConversationApprovalNotification.tsx:49` | Nothing imports it. |
| Provider entry | `W/pages/providers/next/TwinSheet.tsx:43` → `ProviderIntelligencePanel.tsx:120` → `ProviderConversationMemory.tsx:39` | Reads `/providers/:id/conversation-memory` (`W/services/api/provider-intelligence.ts:172`, `G/providers/provider-intelligence.controller.ts:203`). This is a separate memory store, with no link to the vendor's threads on /communications. |
| Other entries | `W/components/layout/Sidebar.tsx:151`; `W/components/command/commands.ts:101`; `W/components/notifications/OneTapActionCenter.tsx:205`; `counterRead.ts:191,220` (`/communications?reply=<orderId>`); `rooms.ts:87`; `RecurringOrders.tsx:141` (`window.location.assign('/communications')`, a full reload); `QuickGmailModal.tsx:23`; `AdminDesk.tsx:107` (Gmail watch status) | |
| Settings | `useConnectionsNextData.ts:590,606,623` | Reads `communications/sender-identity`, `communications/letters/sender` and the text senders. |

### 2b. Endpoints (gateway)

**Conversations controller** (`G/conversations/conversations.controller.ts`, guarded by `JwtAuthGuard, RolesGuard` :83)

| Route | Line |
|---|---|
| `GET conversations` (paged, `houseOf(user)`) | :95 |
| `GET threads` | :187 |
| `GET thread/:threadId` | :264 |
| `GET by-provider/:providerId` | :292 |
| `GET by-order/:orderId` | :333 |
| `POST :id/summarize` | :367 |
| `GET stats/overview` | :394 |
| `GET pending/list` | :414 |
| `GET :id` | :439 |
| `POST :id/approve-seal-challenge` | :489 |
| `POST :id/approve` | :515 |
| `PUT :id/message` (owner, manager) | :587 |
| `POST :id/reject` (owner, manager) | :642 |

**Communications controller** (`G/communications/communications.controller.ts`, `JwtAuthGuard` :76)

| Route | Line | Notes |
|---|---|---|
| `GET sender-identity` | :127 | Reports scope "deployment" and `perHouse.supported:false`. |
| `GET status` | :167 | |
| Low-stock and daily-summary alerts | :220, :292 | |
| Test routes (`NonProductionGuard`) | :312-1102 | |
| `@Public() POST webhooks/gmail` | :1167-1324 | |
| `GET webhooks/gmail/status` | :1326 | |
| `POST webhooks/gmail/force-fetch` | :1345 | |

**Letters controller** (`G/communications/letters/house-letters.controller.ts`, `communications/letters` :49)

| Route | Line | Notes |
|---|---|---|
| `GET sender` | :59 | |
| `GET book` | :92 | |
| `GET queued` | :101 | |
| `GET drafts` (owner, manager) | :108 | |
| `POST :id/discard` | :122 | |
| Templates | :138 / :148 | |
| `POST seal-challenge` | :162 | |
| Requests | :174 / :182 / :196 / :211 | |
| `POST /` | :224 | Returns 202, or 409 when the house has no sender. |
| `POST :id/cancel` | :263 | |

**Other endpoints**
- Relay: `G/communications/relay/relay-email.controller.ts`, `@Public()` with `RelayDoorGuard`.
- Inbound parse: `@Public() POST webhooks/inbound-email` at `G/common/orchestrator/inbound-email.controller.ts:55-75`.
- Retention: `GET communications/retention/disclosure` (`retention.controller.ts`).
- Archive: list, seal, `POST /` and export (`archive/house-mail-archive.controller.ts`).
- Sender trust: `senders/trust`, `senders/reputation` (`sender-trust.controller.ts`).
- Procurement: `GET procurement/conversations/history` (`G/procurement/procurement.service.ts:4208`, `.limit(100)`) and `GET procurement/conversations/active`.

### 2c. Inbound paths: how mail arrives

1. **Shared deployment mailbox, Gmail push.**
   - Pub/Sub calls `POST /webhooks/gmail` (communications.controller.ts:1167).
   - It calls `GmailWatchService.fetchNewMessages` (`G/communications/gmail-watch.service.ts:183-231`).
   - `historyId` is kept in Redis under `gmail:watch:historyId` (:29) with a 7-day TTL (:179).
   - `history.list` is not paginated. Messages are fetched one `messages.get` at a time (:205).
   - The new `historyId` is stored (:215-218) **before** the controller publishes anything.
   - A 404 re-arms the watch and returns nothing (:222-230).
   - The controller skips mail from its own address by substring match (fallback `<redacted-email>`).
   - It publishes `email.inbound.received` with **no** `restaurant_id`. A failed publish is logged, and the loop moves on.
2. **The house's own Gmail, a read-only grant (ADR 0118 D8-D11).**
   - `HouseInboxCron` runs `@Cron(HOUSE_INBOX_CRON)` (`G/communications/inbox/house-inbox.cron.ts:46`).
   - It calls `HouseInboxService.readDue` (`house-inbox.service.ts:249`), which loops over grants serially (:275).
   - `readOneGrant` (:321) uses the durable cursor table `house_inbox_cursors`. The cursor is seeded at "now" (:370), so earlier mail is never read.
   - `listSince` (:594) pages with maxResults 100.
   - It publishes with `restaurant_id` and `mirrored_by_grant_id` (:487).
   - The reader is behind the flag `enable_house_inbox_read`.
3. **Dedicated-domain inbound parse.**
   - Postmark, SES or Mailgun calls `POST /webhooks/inbound-email`.
   - The secret is read from the `x-inbound-secret` header **or** the `?secret=` query (:58-59). It is compared with plain inequality.
   - The endpoint always answers HTTP 200 (`@HttpCode(OK)` :55), even for `unauthorized` (:75) and errors.
   - The house is resolved from `restaurant_inbound_addresses`. The address is `r-<hex8>@INBOUND_EMAIL_DOMAIN` (`inbound-address.service.ts:45`; baseline migration :5112, unique indexes :11831-11845).
   - It publishes `gmail_message_id: null`.
4. **WhatsApp inbound.** The text module writes its own rows. It is not in this mail bridge.

**The bridge, which all three email paths share** (`G/common/orchestrator/rabbitmq-bridge.service.ts`)
- **Queue and consume.**
  - Durable queue with `x-message-ttl` 300000 (:360) and `x-max-length` 1000 (:361).
  - The consumer calls `route.handler(body)` **without await** (:374) and acks at once (:375). It also acks on error (:380).
- **`handleInboundEmail` (:615).**
  - Provider lookup: `.ilike("contact_email", senderEmail)` with `limit(1)` (:667-676). It is filtered by house only when the event carries `restaurant_id`.
  - Unknown sender:
    - An outreach email becomes a prospect notice that points at `/communications` (:688-757).
    - Anything else is dropped with a log line and **never stored** (:760-764).
  - Thread match:
    - It reads by `gmail_thread_id` with no house filter (:825), then **overwrites** the house (:844).
    - Fallback: it guesses the provider's newest open order (:849-877), which can also overwrite the house (:875).
  - Dedupe: on `gmail_message_id` only (:889-902).
  - Insert into `procurement_conversations` (:907-935). An insert error is logged and the function returns.
  - Attachments are fire-and-forget. Then the promotions extractor runs.
  - A websocket notice carries `action_url: /orders?order=` (:989). It is absent when no order was matched.
  - The responder hands off only when an order was matched (:1005).

### 2d. Reply preparation and approval

- **Drafting.** `InboundResponderService.analyzeAndDraftReply` (called from bridge :1005) stages a
  `PENDING_APPROVAL` or `AUTO_SEND_SCHEDULED` row with a 2-minute undo. This is behind
  `enable_ai_negotiation` / `enable_ai_autonomous_send` and the guardrails.
- **Approval.** Through `POST conversations/:id/approve-seal-challenge` then `:id/approve`
  (controller :489 / :515), or through the procurement approve-draft hook (`useDraftEmailQueries.ts:293`).
- **Edit and reject.** `PUT :id/message` (:587) and `POST :id/reject` (:642), owner or manager only.
- **Send.** `ProcurementService.sendProviderEmail` (`G/procurement/procurement.service.ts:8389`).
  Its callers are approve-draft :7936, the auto-send sweep :8671, :8958, and confirm-deal :9833.

### 2e. Sender selection: which address and why

Two separate paths. They disagree.

1. **House letters and the relay** use `HouseSenderService.resolve`
   (`G/communications/letters/house-sender.service.ts:266`):
   - It makes one read of Google `integration_oauth_connections` where `revoked_at` is null.
   - If the Mudavym subdomain is provisioned: `siparis@${MUDAVYM_SENDING_DOMAIN}`, after a ceremony seal.
   - If the read fails: `unknown`.
   - If no grant carries `gmail.send`: `none`.
   - Otherwise the caller's own grant, or else `withSend[0]` with no ORDER BY (:383-385).
   - The address can be null.
   - The four "where" sentences are at :472-517.
   - The relay reuses `resolve` (`relay-email.service.ts:137, :324`).
2. **Vendor and order mail** (`sendProviderEmail`, :8389-8432):
   - **Always** goes through `gmailService.sendEmail`, which is the shared deployment mailbox
     (`GMAIL_SENDER_EMAIL` or the Gmail profile, `G/communications/gmail.service.ts:171, :221`).
   - Passes no `fromName`, so the display name is "Mudavym" (`gmail.service.ts:730, :741`).
   - Reply-To is the house's inbound-parse address when one is provisioned (:8414).
   - The Message-ID is `<mudavym-uuid@wineops.ai>` (:8384-8385).
   - If the API send fails, it falls back to SMTP over nodemailer with `GMAIL_APP_PASSWORD`
     (`gmail.service.ts:248-266, :804`). That fallback sets neither the thread id nor the Gmail
     message id (:136, :145).
3. **`GET communications/sender-identity`** (:127) still reports a deployment sender and
   `perHouse.supported:false`. `letters/sender` reports a per-house sender. The settings page reads
   both (`useConnectionsNextData.ts:590,606`).

### 2f. Retention

- `RawMailRetentionService` (`G/communications/retention/raw-mail-retention.service.ts`):
  - `computeWindow` :249 (from `procurement_credits` disputes) and `deriveWindow` :366 (`house_mail_retention_windows`).
  - `sweepHouse` :447 selects only rows where `mirrored_by_grant_id` is not null (around :545).
  - `deleteRawFor` :759 tombstones `message_text`, empties `email_headers`, sets `raw_deleted_at` and deletes attachment bytes.
- The margin is `RETENTION_MARGIN_DAYS = 92` (`retention-rules.ts`).

### 2g. Tables and jobs

**Tables**
- `procurement_conversations`: threads, drafts and approvals. Keys `thread_key`, `gmail_thread_id`, `gmail_message_id`; columns `mirrored_by_grant_id`, `raw_deleted_at`.
- `restaurant_inbound_addresses`, `house_inbox_cursors`, `house_mail_retention_windows`.
- `integration_oauth_connections`.
- `communication_templates` (the `sender_identity` row).
- `providers` (`contact_email`).
- RPC `list_conversation_threads` (baseline, and `20261016000000_a_thread_list_withholds_credit_drafts_from_staff.sql`).

**Jobs**
- Gmail watch renewal: `setInterval` (`gmail-watch.service.ts:84`).
- House inbox cron (`house-inbox.cron.ts:46`). `lastRun()` is held in memory.
- The auto-send sweep (procurement :8671).
- The retention sweep.
- Nine communications crons pinned to America/New_York (`.planning/08-softwares/communications-hub.md`, OD-92).

## 3. Performance, read from code

- **Route weight.** One lazy chunk of about 6.7K source lines (20 files) that mounts every sheet's
  code. On mount it fires about five parallel requests: history, active (polled every 30 s),
  `letters/sender`, `letters/drafts` and letter requests. `letters/sender` runs resolve, cron
  status and inbox status serially on the server (`house-letters.controller.ts:59`).
- **Unbounded reads.**
  - `getStats` (`G/conversations/conversations.service.ts:827`) selects every row of the house and
    aggregates in JS (:852). PostgREST's default row cap would silently truncate the totals.
  - `listConversationThreads` (:572) calls the RPC (:595), then reads **every** message of the
    page's threads with `select *` plus provider and order joins, with no cap per thread.
  - The history read caps at 100 rows (`procurement.service.ts:4208`), so older conversations
    disappear from the book with no "more" control.
- **N+1 and serial work.**
  - Gmail push makes one `messages.get` per message (`gmail-watch.service.ts:205`).
  - The house reader handles grants one at a time (`house-inbox.service.ts:275`).
  - `resolveSenderName` makes 3 serial queries per vendor send (`procurement.service.ts:8347`).
  - The bridge runs provider, thread, order, dedupe and insert as 4-5 sequential round trips per
    inbound message (:667-935).
- **Polling.** `useActiveConversations` polls every 30 s whether the tab is visible or not
  (`useDraftEmailQueries.ts:234`).

## 4. Gaps

| Id | Severity | Gap | Evidence |
|---|---|---|---|
| G1 | blocker | Mail from the shared mailbox can be filed in the wrong house, or as a row that mixes house A's vendor with house B's restaurant. | Push publishes no `restaurant_id`. Provider lookup is `ilike(contact_email)` with `limit(1)` across all houses (`rabbitmq-bridge.service.ts:667-676`). A thread match with no house filter overwrites the house (:825, :844). The newest-open-order guess can overwrite it too (:875). `ilike` wildcards are not escaped. Fix is open as PR #681 (unmerged since 2026-10-08). |
| G2 | blocker | Inbound mail can be lost silently on every path. | **Gmail push:** `historyId` stored before publish (`gmail-watch.service.ts:215-218`); publish errors swallowed in the webhook loop (`communications.controller.ts:1167-1324`); `history.list` not paginated; a 404 re-arms and drops the gap (:222-230); the cursor lives in a Redis key with a 7-day TTL (:179). **Bridge:** acks before an un-awaited async handler (`rabbitmq-bridge.service.ts:374-380`); 5-minute TTL and 1000-message cap (:360-361); a failed insert only logs (:907-935). **Inbound parse:** always 200, so the provider never retries (`inbound-email.controller.ts:55`). There is no fallback poll. |
| G3 | major | Vendor and order mail leaves from the shared deployment mailbox, displayed as "Mudavym". This contradicts ADR 0118 D1 (the house writes from its own mailbox or subdomain). | `sendProviderEmail` always calls `gmailService.sendEmail` with no `fromName` (`procurement.service.ts:8389-8432`; `gmail.service.ts:730, :741`). It is called from approve :7936, auto-send :8671, :8958 and confirm-deal :9833. `HouseSenderService.resolve` is used only by letters and the relay. |
| G4 | major | A Mail tab that lists all people has no data. Staff and guest mail, and any sender not in the vendor book, is never stored. Rows can only point at a provider. | Unknown non-outreach senders are dropped (`rabbitmq-bridge.service.ts:760-764`). The house reader is book-bounded by ADR 0118 D9 (`0118...md:344`). `procurement_conversations` has `provider_id`, with no counterpart type for staff or guests. |
| G5 | major | The /communications book is a flat list of 100 rows, vendor-only and not threaded. A threaded API exists and is unused there. There is no deep link to a thread. | `useCommsNextData.ts:122-128`; `procurement.service.ts:4208` `.limit(100)`; `GET conversations/threads` (`conversations.controller.ts:187`) is used only by Sorting Office (`useSortingOfficeData.ts:185`); the page reads only `?draft` / `?reply`. |
| G6 | major | Raw-mail retention covers only mail mirrored by the house reader. Raw bodies, headers and attachments from the shared mailbox and the inbound domain, and prospect bodies, are kept forever. | `sweepHouse` filters `mirrored_by_grant_id` not null (`raw-mail-retention.service.ts:447, ~545`); the bridge stores the full `Subject + body` (`rabbitmq-bridge.service.ts:907-935`). ADR 0118 D12-D15 (`:450, :568`). |
| G7 | major | Force-fetch replays the deployment-wide inbox. Any signed-in member of any house can trigger it: there is no role check and no house scope. Managers have no working recovery button. | `communications.controller.ts:1345` (JWT only); `useForceFetchReplies` (`useDraftEmailQueries.ts:575`) has no caller. |
| G8 | major | The inbound-parse door is weak and invisible to the house. | Secret accepted from the `?secret=` query (logged in URLs) and compared with `!==` (`inbound-email.controller.ts:58-75`); no dedupe (`gmail_message_id: null`, so bridge :889-902 never matches); `INBOUND_EMAIL_DOMAIN` / `INBOUND_WEBHOOK_SECRET` absent from `env.example`; the address (`inbound-address.service.ts:45`) is used only as Reply-To (`procurement.service.ts:8414`), with no screen or forwarding setup. |
| G9 | major | Inbox numbers (ADR 0357's planned KPIs) would sit on an unbounded read aggregated in JS, and the thread list over-fetches. | `getStats` `conversations.service.ts:827-852`; `listConversationThreads` :572-595 reads every message `select *`. |
| G10 | minor | "Regenerate summary" is dark, and the orchestrator event dispatch points at a host prod cannot reach. | `regenerateSummary` publishes `email.summarize.requested` with no subscriber (`conversations.service.ts:772-800`); `publishEvent` posts to `AGENT_ORCHESTRATOR_URL` (:306). The `useRegenerateSummary` hook has no caller. |
| G11 | minor | When a house has several grants, the house sender is picked nondeterministically, and the address can be null. | `withSend[0]` with no ORDER BY (`house-sender.service.ts:383-385`); `gmail_send` records no email. |
| G12 | minor | Two endpoints give two answers to "who sends for this house". | `GET sender-identity` reports `perHouse.supported:false` (`communications.controller.ts:127`); `letters/sender` reports a house mailbox (`house-letters.controller.ts:59`). Settings reads both (`useConnectionsNextData.ts:590,606`). |
| G13 | minor | A reply to an SMTP-fallback send loses its thread, and the Message-ID domain matches no sender domain. | The fallback sets no thread or Gmail message id (`gmail.service.ts:136,145` vs :248-266); Message-ID is `@wineops.ai` (`procurement.service.ts:8385`). Replies then fall to the order guess (`rabbitmq-bridge.service.ts:849-877`). |
| G14 | minor | Reader status can read empty on an instance that did not run the cron. Plausible, not verified on the deployed topology. | `lastRun()` is held in memory (`house-inbox.cron.ts:46`) and is served through `letters/sender` (`house-letters.controller.ts:59`). |
| G15 | minor | Entry points disagree on where a mail lives. | The new-mail notice goes to `/orders?order=` and has no URL when no order matched (`rabbitmq-bridge.service.ts:989`). Prospects go to `/communications` with no anchor (:745, :755). RecurringOrders does a full reload (`RecurringOrders.tsx:141`). The provider twin shows a separate memory store with no link to the vendor's threads (`ProviderConversationMemory.tsx:39`). |
| G16 | minor | Dead client surface and a second auth path. | `useConversations` :163, `useConversationThread` :213, `useConversationStats` :228, `useRegenerateSummary` :243, `useForceFetchReplies` :575: no callers. `ConversationApprovalNotification.tsx:49`: no importer. `useConversationQueries.ts:1-14` builds its own axios with a localStorage token. |
| G17 | minor | The software doc is stale. | `.planning/08-softwares/communications-hub.md` is dated 2026-09-01 and still describes the deleted legacy `Communications.tsx`. |

## 5. Mail tab design (inside /communications, as ADR 0357's Inbox tab)

- **List: people first.** One row per counterpart (vendor, staff, guest, unknown sender). Each row
  shows the last message, a "waiting on you" mark, the channel icons in use and the order chip.
  - Filters: counterpart type, channel (email, WhatsApp), waiting-on-us vs waiting-on-them, house
    mailbox.
  - Data: `GET conversations/threads` (RPC `list_conversation_threads`), grouped by counterpart.
    This needs a counterpart key beyond `provider_id` (G4).
  - Server-side cursor paging. No 100-row cap.
- **Thread view.** Reached by `?thread=<thread_key>` from every entry point: notice, order,
  provider twin, palette.
  - Messages come from `GET conversations/thread/:id`, with a per-thread page cap (G9).
  - Each message shows its source (shared mailbox, house reader, inbound address) and its raw-mail
    state (`raw_deleted_at`).
- **Composer.** `DraftedReplyPanel` with the sealed approve. The sender line comes from one source:
  `letters/sender`, after G3 and G12 are fixed. Staff role is read-only (ADR 0357 answer 3).
- **Review list.** Every machine-written draft and sent reply in one place, as Front's AI replies
  hub does.
- **Health line.** Each intake path shows its last read and whether it is behind. It shows three
  states, never two (ADR 0051 clause 3): reading, behind, cannot tell.
- **Prerequisites:**
  - G1 and G2 before any house is shown "all your mail".
  - G4 before staff or guest rows exist.
  - G3 before a reply is sent from the tab.

## 6. Open PRs in this area (`gh pr list`, 2026-11-07)

| PR | State | How it overlaps |
|---|---|---|
| #681 `fix/inbound-mail-vendor-house` | Open, last updated 2026-10-08 | Fixes G1 in `rabbitmq-bridge.service.ts` and `inbound-responder.service.ts`. |
| #747 `docs/letter-bench-v4-map` | Draft (ADR 0357) | Defines the Inbox tab and inbox KPIs that G5 and G9 bear on. |
| #758, #759, #760 | Open | Letter designs. They touch the /communications surface, not intake. |
| #672 `fix/orders-send-blank-followups` | Open | "One sender read" in `procurement.service.ts`. Adjacent to G3. |
| #674, #687 | Open | W25 order-request letter. |
| #679 | Open | F-106: settles orders with two waiting drafts. |
| #680 | Open | Keeps the price ceiling out of vendor drafts. |
| #682 | Open | F-159: settles a claim against a memo the vendor sent unasked. |
| #538 | Open | Alert relays (ADR 0244). |
| #731 | Open | Gmail session note. |

None of these closes G2, G3, G4, G6, G7 or G8.

## What was not done

- Nothing was executed: no build, bundle measurement or query plan.
- WhatsApp inbound was only located, not traced line by line.
- G14 depends on the deployed topology, which was not checked.
