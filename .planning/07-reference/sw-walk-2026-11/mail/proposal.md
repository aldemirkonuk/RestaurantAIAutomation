# Mail: proposal (sw-walk, 2026-11-07)

Read from `origin/main` at `e26a5152d`. `G/` = `apps/api-gateway/src/`, `W/` = `apps/web/src/`.
Inputs: `audit.md`, `sota.md`, and the verified gaps (verdicts), with each gap's corrected claim used
in place of the audit's wording. Nothing was run, built or queried. No production system was
touched. A `~` before a line number means the verdict located it to within a few lines.

The founder's /goal of 2026-11-07 delegates every fork ("Do not ask me any questions I approve you
decide them all"). Section 4 records the session's call on each fork. ADRs are cited where they
bear on a fork; where this proposal departs from one, it says so and names the amendment owed.

---

## 1. Verdict

Mudavym already stores vendor mail and WhatsApp in one table, `procurement_conversations` (baseline
`supabase/migrations/20260805000000_baseline_from_production.sql:4294`;
`G/communications/text/inbound/whatsapp-inbound.service.ts:304-311`). It also has a threaded,
paged API that /communications does not use (`G/conversations/conversations.controller.ts:187`, used
only by `W/pages/documents-reports/next/useSortingOfficeData.ts:185`). A Mail tab is therefore
mostly a read-model and UI job, **but it must not be shown as "all your mail" until intake stops
losing letters**. Today mail can be dropped at the Gmail push door, at the inbound-parse door and
at the bridge (G2). Mail to the shared mailbox can be filed against two houses at once (G1, fix
#681 conflicting). Order mail leaves as "Mudavym" from the deployment mailbox (G3).

The plan is 12 lanes. Five server-correctness lanes come first: house filing, durable intake, the
Gmail cursor, the parse door, and the order sender. Then one counterpart store that lets staff,
guests and unknown senders exist at all (G4), plus retention and a bounded read model. The UI
lanes come last: the Mail tab, entry points, and dead-code removal.

---

## 2. Target experience, per screen

This is a people page, so it follows the simple-for-people rule. Density appears only on the intake
health sheet, which is a technical surface. Colours come only from the Mudavym tokens in
`W/styles/mudavym.css`, declared on `.mudavym` with paper as the default ground (:139-190) and a
charcoal ground (:209-256):
- `--paper-0/1/2` for grounds, and `--ink-1..4` for text.
- `--seal` / `--seal-deep` / `--seal-tint` for "waiting on you" and the approve act.
- `--warn` for "behind" and guessed placement, and `--alarm` / `--loss` for a door that failed.

No confidence number is shown anywhere (ADR 0104 status line,
`.planning/decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md:3`).
Placement is stated in words instead.

### 2.1 Mail tab: the list of people

This is where ADR 0357's "Inbox" tab goes (PR #747 draft, rows "Inbox: waiting on you / approve
and send / KPIs"). Until that tab shell exists, the list replaces the "Conversation book" section
(`W/pages/communications/next/CommunicationsNext.tsx:823-869`).

- **Header line:** one sentence in the house's words, for example "3 people are waiting on you.
  The oldest has been waiting 2 days." The numbers come from the server (L8). An unknown figure
  shows the em dash, never zero (ADR 0051, `.planning/decisions/0051-rebuilt-pages-show-live-data-only.md:57`).
- **Filter chips:** All · Waiting on you · Vendors · Team · Guests · Strangers. Guests and
  Strangers are hidden for the staff role.
- **One row per person:**
  - The name (the vendor name, the member's name, the guest's name, or the bare address).
  - A kind word: vendor, team, guest, stranger.
  - The last line of the newest message.
  - The time.
  - A seal dot when the house owes a reply.
  - Channel glyphs (mail, WhatsApp).
  - The newest open-order chip, for vendors only.
- **Paging:** cursor paging, "Show older people" at the foot, and no 100-row cap (G5).
- **Empty state:** one sentence naming which doors are connected, so an empty list never reads as
  a healthy one.

### 2.2 A person's threads

Reached with `?with=<counterpart_key>`.
- Threads are grouped by `thread_key`, newest first. A vendor thread carries its order number.
- Each thread row shows the subject, its message count, and who wrote last.

### 2.3 Thread view

Reached with `?thread=<thread_key>`. This deep link must work from every entry point.
- Messages appear oldest to newest, paged at 50 per thread (G9).
- Each message carries a quiet provenance line in words:
  - which door it arrived by ("your mailbox", "Mudavym's mailbox", "your Mudavym address",
    "WhatsApp");
  - how it was placed, for example "placed by the reply thread" or "**placed by a guess: the
    newest open order**", set in `--warn`, with a "Move to another order" act;
  - "Original removed on 12 Mar; the facts stay", shown when `raw_deleted_at` is set
    (ADR 0118 D12, `.planning/decisions/0118-the-house-writes-its-own-mail.md:450`).
- **Composer:** the existing `DraftedReplyPanel` and its sealed approve.
  - The sender line comes from a single resolver after L5. For example: "Leaves from
    siparis@… as Kitchenette", or "Leaves from Mudavym's mailbox on Kitchenette's behalf. Replies
    come to your Mudavym address."
  - The staff role sees no composer: read-only, per ADR 0357 answer 3 in PR #747.

### 2.4 Review list

A filter of the Mail tab ("Written by Mudavym"), not a new page. It lists every machine-drafted
reply, both waiting and sent, with its approval state. This follows Front's AI replies hub
(`sota.md` item 2). Approval stays sealed (ADR 0175).

### 2.5 Intake health sheet (technical, dense)

Opened from a single line under the header, for example "All doors reading" or "Mudavym's mailbox
is behind by 40 min".

There is one row per door: shared mailbox push, shared mailbox poll, house mailbox reader, Mudavym
address, and WhatsApp. Each row shows:
- the last read time and the last letter stored;
- a three-state status: reading, behind, or cannot tell. "Cannot tell" covers the case where no
  durable record exists (G14).
- held or failed intake items, with "Read again". Owners and managers can use it; it is scoped
  to the house's own doors (G7).
- the house's Mudavym address, with a copy button, so a vendor can be told to write there (G8).
- the count of letters that arrived from senders no house could place. This is a count only;
  the bodies are not kept (F4).

---

## 3. Phased build plan

Every lane has at most 15 files and a diff of at most 30K, so the gate verdict does not truncate.
Migrations are cited by slug, because the version is assigned at merge. Each new test must fail on
`origin/main` and pass on the lane head; mutate the fix away to prove this.

### Phase A: server correctness (nothing user-visible changes)

| # | Branch | Files (≤15) | Tests that must fail on main, pass after | Depends on |
|---|---|---|---|---|
| L1 | `fix/inbound-mail-vendor-house` (**rebase PR #681**, which is `CONFLICTING`) | the PR's 8 files: `G/common/orchestrator/rabbitmq-bridge.service.ts`, `inbound-responder.service.ts`, `rabbitmq-bridge.vendor-house.spec.ts`, `feature-flag-registry.ts`, census script, claims row, DELIVERY-AUDIT | `rabbitmq-bridge.vendor-house.spec.ts`: (a) a no-house event, from a sender who is a vendor of two houses, stores no vendor match; (b) a thread match in house B never moves an event that names house A; (c) the open-order guess never changes the house. Today `:671-678` reads unscoped with `limit(1)`, and `:844`/`:875` overwrite the house. | #681 itself. Must merge before L2, L3, L6 and L7, which edit the same file. |
| L2 | `fix/mail-intake-durable-before-ack` | `rabbitmq-bridge.service.ts`; new `G/common/orchestrator/mail-intake.store.ts` and spec; migration `a_letter_is_stored_before_its_door_is_answered` (table `mail_intake`: id, restaurant_id null, door, provider_message_id, rfc_message_id, payload jsonb, status received/stored/held/failed, attempts, error, created_at; unique on `(door, provider_message_id)`); `rabbitmq-bridge.intake.spec.ts` | (a) a handler that rejects is not acked: the item stays `held` and is retried (today the handler is not awaited at `:374` and is acked at `:375` / `:380`); (b) a failed `procurement_conversations` insert leaves the item `failed` and visible, not just logged; (c) a 1001st queued item is not discarded, because the bridge queue is now only a wake-up signal and `mail_intake` is the record (`:360-361`). The queue needs a **new name**, since `assertQueue` with changed `x-` arguments fails on an existing durable queue. | L1 |
| L3 | `fix/gmail-push-cursor-after-store` | `G/communications/gmail-watch.service.ts`; `communications.controller.ts` (webhook loop plus force-fetch); new `G/communications/mail-door-poll.cron.ts`; migration `a_mail_door_keeps_its_cursor_in_the_book` (table `mail_door_cursors`: door, cursor, last_read_at, last_stored_at, last_error), which replaces the Redis key with its 7-day TTL; 2 specs | (a) `history.list` with a `nextPageToken` reads every page (today there is one call and no pageToken, ~`:185-230`); (b) the stored historyId does not advance when any write to `mail_intake` fails; (c) a 404 runs a bounded resync through `messages.list` (`newer_than` = the gap since `last_read_at`, capped at 7 days) instead of returning `[]`; (d) the poll cron reads when no push has arrived for 10 minutes; (e) `POST webhooks/gmail/force-fetch` returns 403 for owner, manager and staff (only `super_admin` passes), while a new house "Read again" route re-queues only that house's `held`/`failed` intake rows. Today the route is guarded by JWT only (`:76`, `:1345-1357`). (f) The health read comes from `mail_door_cursors`, not from in-memory `lastRun()` (`G/communications/inbox/house-inbox.cron.ts:38-42`, G14). | L2 |
| L4 | `fix/inbound-parse-door-says-when-it-failed` | `G/common/orchestrator/inbound-email.controller.ts` and spec; `rabbitmq-bridge.service.ts` (dedupe on rfc_message_id plus recipient; a thread match by In-Reply-To/References against our stored Message-ID, G13); migration `a_letter_is_known_by_its_own_message_id` (`procurement_conversations.rfc_message_id`, partial unique index on `(restaurant_id, rfc_message_id)`); `procurement.service.ts` (store the minted Message-ID on the outbound row, ~`:8385`); `env.example`, `services/agent-orchestrator/.env.example`; new `GET communications/inbound-address` | (a) `?secret=` alone is refused (today accepted, `:59`); (b) a wrong secret returns 401/403, not `200 {status:"unauthorized"}` (`:55`, `:71-75`); (c) the comparison uses `timingSafeEqual`; (d) a failed intake write returns 5xx so Postmark retries (`sota.md` item 6); (e) the same Message-ID delivered twice stores one row (today `gmail_message_id` is null, so the dedupe at ~`:889-895` never applies); (f) a reply to an SMTP-fallback send threads by In-Reply-To even though it has no `gmail_thread_id`. | L2. Coordinate `procurement.service.ts` with #672 and L5. |
| L5 | `fix/order-mail-leaves-as-the-house` | `procurement.service.ts` (`sendProviderEmail` `:8389-8432`); `G/communications/letters/house-sender.service.ts` (deterministic fallback); `communications.controller.ts` (`sender-identity` `:127-160` delegates to `HouseSenderService.resolve`); `procurement.module.ts`; 3 specs | (a) an order letter's `fromName` is the house's name, not "Mudavym" (today `gmail.service.ts:82` is the default and no `fromName` is passed); (b) when the house has a sealed subdomain or a `gmail_send` grant, the order letter leaves from that sender; (c) `GET sender-identity` equals `GET letters/sender` for the same house (today `supported:false` at `:157`, G12); (d) with three granted members and none of them the asker, resolve picks the oldest grant every time (today `withSend[0]` with no order at `:387`, G11). | **#672** (its "one sender read" in `procurement.service.ts`): rebase on it, or land after it. |

### Phase B: the counterpart store and the read model

| # | Branch | Files (≤15) | Tests that must fail on main, pass after | Depends on |
|---|---|---|---|---|
| L6 | `feat/mail-knows-every-person` | migration `a_house_hears_from_its_people_not_only_its_vendors`: table `house_mail` (restaurant_id NOT NULL, counterpart_kind `member`/`guest`/`stranger`, user_id, guest_id, address, direction, door, channel, subject, body, headers, rfc_message_id, gmail ids, thread_key, raw_deleted_at); RLS service-role-only plus a house read policy. `rabbitmq-bridge.service.ts` routing: when no vendor matches **and the house is known**, match a member (`user_restaurant_access` plus `users.email`), then a guest (`guest_identifiers` with `channel_type='email'`, `20260819000000_guest_identity_minimal_slice.sql:128`), then fall back to stranger. Bridge spec; pgtest for RLS. | (a) a letter to a house's Mudavym address from a house member is stored as `member`, where today it is dropped at ~`:757-764`; (b) a guest's address is stored as `guest`; (c) an unknown sender at a house-attributed door is stored as `stranger`; (d) an unknown sender at the shared mailbox with no house is **not** stored and increments the door's unplaced count; (e) a staff-role JWT cannot read a `guest` row or another member's row through RLS. | L1, L2 |
| L7 | `fix/raw-mail-window-covers-every-door` | `G/communications/retention/raw-mail-retention.service.ts`; `retention-rules.ts`; spec; `mail_intake` payload purge | (a) a shared-mailbox row (`mirrored_by_grant_id` null) past the house's window has its raw mail deleted (today `sweepHouse` filters it out at `:551`); (b) a `house_mail` stranger body is deleted 30 days after arrival unless the person is added to the book; (c) a processed `mail_intake.payload` is cleared after 30 days; (d) a revoked grant still purges only its own rows (`:651`), so there is no regression. | L2, L6 |
| L8 | `feat/mail-people-and-threads-read` | migration `the_mail_list_is_read_by_person`: RPC `list_mail_people(p_restaurant_id, p_role, p_kind, p_waiting, p_after, p_limit)`, a union of vendor rows (`procurement_conversations` grouped by provider), `house_mail` grouped by counterpart, and `relay_email_queue` outbound to members (`20261115100000_a_persons_mail_queues_like_the_houses_own.sql:81`); RPC `mail_inbox_kpis`. `G/conversations/conversations.service.ts`: `listConversationThreads` takes a counterpart filter, selects explicit columns, caps at 50 messages per thread with a cursor; `getStats` becomes an RPC call (today an unbounded read aggregated in JS, `:827-852`). New `GET communications/mail/people` and `GET communications/inbox/kpis` (the ADR 0357 "New" row); route-access expected json; specs plus pgtest. | (a) a house with 150 vendor conversations lists them all across pages (today `procurement.service.ts:10280-10329` caps at `.limit(100)`); (b) a thread of 120 messages returns 50 plus a cursor; (c) the KPI totals equal `count(*)` on a 2,000-row fixture, where the PostgREST row cap truncates them today; (d) a staff role gets no guest or stranger rows and no other member's rows; (e) the thread list response contains no `email_headers`. | L6. Coordinate route-access json with #760. |

### Phase C: the UI

| # | Branch | Files (≤15) | Tests that must fail on main, pass after | Depends on |
|---|---|---|---|---|
| L9 | `feat/comms-mail-tab` | `W/pages/communications/next/`: new `MailPeople.tsx`, `MailThread.tsx`, `useMailData.ts`, `mail-format.ts`, `IntakeHealthSheet.tsx`, plus tests; `CommunicationsNext.tsx` (swap the Conversation book for MailPeople; read `?with=` / `?thread=`); `useDraftEmailQueries.ts` (pause the 30 s poll while the tab is hidden, `:248`) | RTL: (a) `?thread=gm:abc` opens that thread (today only `?draft` and `?reply` are read, `CommunicationsNext.tsx:~405-460`); (b) "Show older people" fetches the next cursor; (c) the staff role sees no composer and no Guests or Strangers chips; (d) a door with no cursor row shows "cannot tell", never "reading"; (e) the page contains no percent and no score text (ADR 0104); (f) a guessed placement renders the warn line and the move act. | L3, L5, L8. If #747/#760 has landed, mount inside its Inbox tab; otherwise mount in place and move later. |
| L10 | `fix/every-door-to-a-letter-opens-it` | `rabbitmq-bridge.service.ts` (new-mail notice `action_url` = `/communications?thread=<thread_key>`, ~`:985-989`; prospect notices `?with=stranger:<addr>`, `:745`, `:755`); `W/pages/providers/next/TwinSheet.tsx` ("Letters with this vendor" leads to `?with=vendor:<id>`); `W/components/command/commands.ts:101`; the orders page order sheet ("Letters about this order"); `OneTapActionCenter.tsx:205`; specs | (a) a matched reply's notice opens the thread and not `/orders?order=`; (b) an unmatched reply's notice carries a URL (today it is `undefined`); (c) TwinSheet renders a link with `?with=vendor:<id>`. `?reply=<orderId>` (`counterRead.ts:191,220`) stays working, with no regression. | L9; L1 for the bridge file |
| L11 | `chore/mail-dead-surface-and-one-client` | `W/hooks/queries/useConversationQueries.ts`: delete `useConversations` `:163`, `useConversationStats` `:228` and `useRegenerateSummary` `:243`, and move off the private axios that reads localStorage (`:7-18`) onto the shared api client. Delete `W/components/conversations/ConversationApprovalNotification.tsx`. Delete `useForceFetchReplies` (`useDraftEmailQueries.ts:575`). Update `useSortingOfficeData.ts` imports. | A lint/test guard: no file under `W/` creates its own `axios.create` with a localStorage token (it fails on main at `useConversationQueries.ts:7`); Sorting Office tests still pass. | L9 |
| L12 | `docs/mail-software-record` | Rewrite `.planning/08-softwares/communications-hub.md`, which is stale (`updated: 2026-09-01`, describes the deleted `Communications.tsx`; G17); an ADR recording F1-F16 (number from the guard); an ADR 0118 amendment for D1b/D9/D12 (§4); a `CLAIMS.jsonl` row per resolved gap; a `v3.0-TECH-DEBT` entry for G10. **Retires** the old communications-hub body and this scratch proposal. | `scripts/check_decision_claims.sh` rows: e.g. `rabbitmq-bridge.service.ts` no longer contains `this.channel?.ack(msg); // Ack even on error` (resolved), and so on. | Any. The ADR should land before L6 merges. |

**Order:** L1 → L2 → (L3 ∥ L4 ∥ L5) → L6 → (L7 ∥ L8) → L9 → (L10 ∥ L11). L12 can be drafted at
any time.

**Overlap with open PRs:**
- #681 is L1 and is `CONFLICTING`.
- #672 shares `procurement.service.ts` with L4 and L5.
- #747, #758, #759 and #760 (ADR 0357) own the tab shell and `route-access.expected.json`.
- #674 and #687 (W25 letters) and #679, #680 and #682 touch procurement and drafts. They do not
  touch intake. Rebase L4 and L5 after whichever of them merges first.
- None of the open PRs closes G2, G3, G4, G6, G7 or G8.

---

## 4. Forks: the session's call on each

Each fork gives the call and the rejected alternatives. The leading choice then gets one attempt
to kill it, with the result stated.

**F1. Where the Mail tab lives.**
- **Call:** inside /communications, as ADR 0357's Inbox tab, with no new route.
- **Rejected:**
  - A new `/mail` route. It would be a second surface for the same rows, which ADR 0083 narrows
    away.
  - Sorting Office. That page is a documents surface.
- **Kill attempt:** ADR 0357 is still a draft and its build order puts the Inbox at step 6, so
  waiting would stall the Mail tab. **Survived**, with a change: L9 mounts in place of the
  Conversation book and moves under the tab shell unchanged when that shell lands.

**F2. Unit of the list.**
- **Call:** the person (counterpart), with threads under the person and messages under the
  thread. The channel is an attribute of each message (Choco, `sota.md` item 1).
- **Rejected:**
  - Thread rows. A vendor with 12 order threads would bury everyone else.
  - Flat messages. This is today's design, and it is the one that fails (G5).
- **Kill attempt:** a vendor with two live orders gets one row, so the second order's reply looks
  hidden. **Survived**, because the row shows "2 open threads", and both the seal dot and the
  order chip come from the newest waiting thread.

**F3. How non-vendor people are stored (G4).**
- **Call:** a new `house_mail` table for member, guest and stranger mail, plus a union read RPC.
  `procurement_conversations` stays vendor-only, with `provider_id NOT NULL` (baseline `:4298`).
- **Rejected:**
  - Making `provider_id` nullable. Five send paths, the responder and the promotions extractor
    assume a vendor. The WhatsApp door already declined to change this table for a second channel
    (`whatsapp-inbound.service.ts:19-30`). The relay queue was split off for the same reason
    (`20261115100000_….sql:196`).
  - One new unified messages table with a backfill. That is a big-bang migration on the busiest
    table.
- **Kill attempt:** two stores means two retention sweeps, two dedupe keys and a union that must
  page correctly. **Survived**, because L7 extends the sweep in the same phase, both stores take
  `rfc_message_id` uniqueness, and L8 has a paging test across the union boundary. Cost accepted:
  the RPC is more complex than a single-table query.

**F4. Unknown senders.**
- **Call:**
  - At a door that names the house (its Mudavym address): store as `stranger` and keep the body
    30 days.
  - At the shared mailbox with no house: do not store, and count it on the health sheet.
  - Existing outreach keeps becoming a prospect.
- **Rejected:**
  - Dropping everything (today's behaviour). This loses a new vendor's first letter.
  - Storing shared-mailbox strangers. The letter belongs to no house, so it would need a
    cross-tenant store of strangers' mail.
- **Kill attempt:** spam at the house address floods the list. **Survived**, because strangers sit
  behind their own chip and the existing sender trust (`WhoIsWriting.tsx`, trusted senders and
  Strangers) gates promotion.

**F5. The house mailbox reader stays bounded by the vendor book (ADR 0118 D9, `:344-360`).**
- **Call:** keep D9. Staff, guest and stranger mail enters only through doors the house points at
  Mudavym: its Mudavym address and forwarding to it.
- **Rejected:** widening `gmail.readonly` to all senders. That changes what the consent screen
  promised, and it pulls private mail into a vendor tool.
- **Kill attempt:** "all conversations with people" then excludes guests who write to the owner's
  Gmail. **Survived, narrowed:** the Mail tab says which doors feed it (§2.1 empty state, §2.5),
  so the omission is stated rather than hidden. An ADR 0118 amendment note is owed to record that
  D9 was kept on purpose.

**F6. Who sees what.**
- **Owner and manager:** see all kinds.
- **Staff:**
  - vendor threads, read-only (ADR 0357 answer 3);
  - their own `member` thread;
  - never guests, strangers or other members' threads.
- Enforcement is in RLS and in the RPC, not only in the UI.
- **Rejected:**
  - A per-person "private line" grant now (SevenRooms). There is no guest volume yet.
  - Staff seeing everything read-only. Guest PII and personnel mail would be exposed.
- **Kill attempt:** a manager's mail about one staff member to another staff member is visible to
  the recipient, which is correct, but the RPC must not group it under the subject person.
  **Survived**, because a thread groups by its correspondent, not by a person it mentions.

**F7. The sender for order mail (G3).**
- **Call:**
  - Always pass the house's name as `fromName`.
  - When the house has a sealed subdomain or a `gmail_send` grant, send from it through
    `HouseSenderService.resolve`.
  - Otherwise send from the deployment mailbox, and **the screen states it**: "Leaves from
    Mudavym's mailbox on <house>'s behalf; replies come to your Mudavym address."
- **Rejected:**
  - Refusing to send when the house has no sender (a literal reading of D1). That would halt
    ordering for a house with no grant. Production has one real tenant, and whether its grant is
    live is unverified.
  - Keeping "Mudavym". The vendor sees a stranger's name on the house's order.
- **Kill attempt:** this quietly works around a locked decision (CLAUDE.md §5). **Survived only
  with a record:** D1 is worded about letters (`0118…md:130-160`, verdict G3), and L12 files a D1b
  amendment stating the disclosed fallback.

**F8. Intake reliability (G2).**
- **Call:** the inbox pattern.
  - Every door writes a `mail_intake` row **before** it answers (Gmail cursor advance, HTTP 200)
    or acks.
  - The bridge queue becomes a wake-up signal only.
  - Gmail push is a hint. There is a poll fallback, and a 404 runs a bounded resync (`sota.md`
    item 5).
- **Rejected:**
  - Only making RabbitMQ durable (manual ack, no TTL). A publish failure at the door is still
    lost, and the queue's comment calls bridge events ephemeral (`:360`, `:380`).
  - Dropping RabbitMQ for this path. That is out of scope, and other routes share the bridge.
- **Kill attempt:** the intake table is one more copy of raw mail, and Postmark payloads cannot be
  re-fetched. **Survived**, because L7 clears processed payloads after 30 days and Gmail items
  store only ids.

**F9. Retention for mail that was not mirrored (G6).**
- **Call:** one rule for every door. Raw mail goes after the D13 window, with the D14 floor and the
  92-day margin; facts stay (D12). Stranger bodies go after 30 days.
- **Rejected:**
  - Keeping them forever. No stated policy exists, and it conflicts with data minimisation.
  - Deleting at fact extraction. That breaks disputes.
- **Kill attempt:** D12-D15 were written for "a copy of somebody's mailbox", so applying them to
  the shared mailbox overreaches. **Survived**, because the shared mailbox holds the house's
  vendor mail just the same, and the dispute logic is identical. Recorded in the L12 amendment.

**F10. Force-fetch (G7).**
- **Call:** the deployment-wide replay is for `super_admin` only. Managers get a house-scoped
  "Read again" over their own held or failed intake.
- **Rejected:**
  - Deleting the route. It is the only recovery for the push door today.
  - Leaving it open to any JWT. It replays another house's door.
- **Kill attempt:** none found. Replays are idempotent, so the risk was only scope.

**F11. Deep-link contract.**
- **Call:**
  - `?with=<kind>:<id>` for a person;
  - `?thread=<thread_key>` for a thread;
  - `?reply=<orderId>` and `?draft=<id>` stay;
  - the new-mail notice points at the thread.
- **Rejected:** `/orders?order=` as the notice target. The order is context, not the letter, and
  an unmatched letter gets no URL at all.
- **Kill attempt:** a `thread_key` leaks across houses through a shared link. **Survived**, because
  the read is house-scoped server-side, and another house's key returns empty.

**F12. Inbox numbers.**
- **Call:** server-side counts only:
  - waiting on you;
  - the oldest wait;
  - letters in and out today;
  - letters held at a door.
- No scores, no percentages, no "AI confidence" (ADR 0104).
- **Rejected:** a response-time percentile and sentiment. They have no measured basis, so they
  would be fabricated precision.
- **Kill attempt:** "Oldest wait" depends on a correct waiting flag. **Survived**, because it is
  derived from the last direction per thread, which L8 tests.

**F13. Freshness.**
- **Call:** the websocket new-mail notice invalidates the list. The 30 s poll stays only while the
  tab is visible.
- **Rejected:** polling every 30 s in the background (today, `useDraftEmailQueries.ts:248`).
- **Kill attempt:** a dropped websocket means a stale list. **Survived**, because the visible-tab
  poll remains as the floor.

**F14. "Regenerate summary" (G10).**
- **Call:** remove the client hook. Leave the server route and file it as debt. Do not build a
  subscriber now.
- **Rejected:** wiring the button. It has no subscriber, and its publish targets a route the
  orchestrator does not define.
- **Kill attempt:** none found.

**F15. Dead client surface (G16).**
- **Call:**
  - Wire `useConversationThreads` and `useConversationThread` into Mail.
  - Delete the rest.
  - Put the hooks on the shared api client.
- **Rejected:** keeping the hooks "for later". They are unowned code with a second auth path.
- **Kill attempt:** none found.

**F16. The inbound-parse provider and setup (G8).**
- **Call:**
  - Header-only secret, compared with `timingSafeEqual`.
  - Non-2xx on failure.
  - Document the env vars in `env.example`.
  - Show the address in the health sheet.
  - The proposal does not pick between Postmark, SES and Mailgun: the controller is
    provider-neutral, and the deployed choice is unverified (§6).
- **Kill attempt:** some providers cannot send custom headers. **Survived, narrowed:** Postmark,
  Mailgun and SES (through SNS/Lambda) can all be set up with a header or a signed URL. If the
  deployed provider cannot, L4 keeps the query secret behind a flag and logs nothing about it.

---

## 5. Integration contract with neighbouring software

| Neighbour | Mail gives | Mail takes | Contract |
|---|---|---|---|
| **Orders / procurement** (`G/procurement/procurement.service.ts`) | A thread per order; inbound replies matched by `gmail_thread_id` or In-Reply-To | Outbound order letters through `sendProviderEmail` (after L5, with the house's sender) | `thread_key` stays `gm:<gmail_thread_id>`. `?reply=<orderId>` stays. A guessed order match is marked as a guess and can be moved. |
| **Vendors** (ADR 0221: a vendor belongs to one house) | Vendor rows keyed `vendor:<provider_id>` | `providers.contact_email`, `provider_contacts.email` | Lookup only inside the resolved house (L1). A vendor shared by two houses on a no-house event is never matched. |
| **Notifications** | `action_url` `/communications?thread=…` or `?with=…` | None | Every mail notice carries a URL (L10). |
| **Letters / relay** (ADR 0118; `relay_email_queue`) | Inbound to members | Outbound member mail as rows in the people list | One resolver (`HouseSenderService.resolve`) answers "who sends" for every path (L5). |
| **Settings / Connections** (`useConnectionsNextData.ts:585-607`) | The house's Mudavym address and door health | Grants (`integration_oauth_connections`) | `sender-identity` and `letters/sender` give the same answer (L5). |
| **Guests** (`guests`, `guest_identifiers`) | `guest` rows | Email identifiers | Owner and manager only. No guest compose in v1. |
| **Team** (`user_restaurant_access`, `users`) | `member` rows | Membership | A member who leaves keeps their history, read-only, with the kind word "former". |
| **Documents / Sorting Office** (`useSortingOfficeData.ts:185`) | Threads endpoint (shared) | Attachments go to documents intake as today | L8 keeps the `GET conversations/threads` response shape a superset of today's. |
| **Retention / archive** (D12-D16) | `house_mail` and non-mirrored rows enter the sweep and the export | Windows from `house_mail_retention_windows` | The archive export includes `house_mail` (follow-up to L7). |
| **WhatsApp** (`text/inbound`) | Same counterpart key; `channel` column | Its own inserts into `procurement_conversations` | A vendor's WhatsApp and email appear under one person. |
| **Promotions extractor and responder** | Vendor rows only | None | They never receive `house_mail` rows. |

---

## 6. What stays unverified

- **Production state.** No production access was used. Unchecked:
  - whether `INBOUND_EMAIL_DOMAIN`, `enable_house_inbox_read`, `enable_ai_negotiation` or
    `enable_ai_autonomous_send` are set;
  - whether the one real tenant has a live `gmail_send` grant or a sealed subdomain;
  - which inbound-parse provider is deployed.

  F7's fallback and F16's header choice depend on these.
- **Gateway instance count.** It decides how much G14 matters; L3 removes the question either way.
- **RabbitMQ.** Whether other routes share `x-message-ttl`/`x-max-length` on the same queue, and
  the cost of renaming the queue in L2.
- **Volume.** Real mail volume, and whether any member, guest or stranger mail reaches a house
  door today. F4 and F5 rest on reasoning, not on counts.
- **Diff sizes.** The 30K-per-lane figures are estimates. L2, L6 and L8 are the most likely to
  need a split, as migration-only plus code PRs.
- **#681's rebase.** The rebase effort for #681 was not measured. It is `CONFLICTING` and was
  last updated 2026-10-08.
- **Approximate line numbers.** Line numbers marked `~` come from the verdicts and were not
  re-read line by line. The history query is at `procurement.service.ts:10280-10329` on this tree;
  the audit's `:4208` is wrong.
- **Not opened:** the bundle weight of the communications chunk was not measured, and WhatsApp
  inbound was located but not traced.
- **Ownership:** the session did not decide who owns ADR numbering for L12. It is assigned from
  the guard at commit time.
