# 0310 — A vendor reply whose sender cannot be read is parked, never filed as a stranger

- **Status:** Proposed (implemented on `claude/laughing-hopper-ofbojk`, 2026-10-08; the founder's brief set the two constraints, *"The mail must not be lost and must not be filed as a prospect"*, and asked for the options to be compared; the choice among them is the lane's, for his lock)
- **Date:** 2026-10-08
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** handleInboundEmail, providers read, failed read, cold email, prospect, not leaded, dead_letter_queue, park, pointer, envelope, retry, inbound mail lost, ack before settle, cursor, mirrored_by_grant_id, retention
- **Links:** [[0067-a-failed-read-is-never-an-empty-one]] (the rule this applies, and the guard whose 2026-10-08 amendment found the site); [[0118-the-house-writes-its-own-mail]] (retention and revocation of mirrored mail); [[0240-register-entries-are-fragments]]; `tech-debt.d/2026-10-08-claude-laughing-hopper-ofbojk.md`; `claims.d/claude-laughing-hopper-ofbojk.jsonl`; PR #661 (`fix/a-guessed-order-does-not-link-the-paper`, the same handler's thread read; a separate lane)

## Context

`RabbitMqBridgeService.handleInboundEmail` writes every inbound vendor mail
the house receives, from all three producers. Line numbers in this record are
at `be9a16c` (origin/main when it was written). Its step 1 looked the sender up
(`rabbitmq-bridge.service.ts:668-679` at `be9a16c`) and threw the read's
`error` away. supabase-js resolves a failed read with `{ data: null, error }`,
so a failed read became "no provider", and the handler took the cold-email
branch (`:680-766`): a known vendor's reply was filed as a prospect when it
had an attachment or looked promotional, and otherwise logged
`no provider found (not leaded)` and dropped.

Nothing redelivers a dropped mail:

- the consumer acks before the handler settles: `route.handler(...)` is not
  awaited, then `ack(msg)` (`:372-375`), and the catch acks too (`:380`);
- the house inbox advances its cursor once the publish resolves
  (`house-inbox.service.ts:519-524`);
- the dedicated-domain webhook answers 200 once the publish resolves
  (`inbound-email.controller.ts:91-114`), so its provider does not retry;
- the shared mailbox's Gmail push moves its stored historyId on
  (`communications.controller.ts:1213-1460`); the operator's force-fetch
  (`:1345-1374`) re-reads only the last N minutes, 20 messages at most.

The read-error guard could not see this read: it looked for the supabase
chain only inside the destructuring statement, and this query was built into
`providerQuery` and awaited later. ADR 0067's 2026-10-08 amendment closes
that.

## Options considered

1. **Log and return.** No prospect. The mail is lost, by the evidence above.
   It is what the handler already does when its own insert fails (`:873-878`),
   which is no argument for copying it. Rejected.
2. **Store the reply in `procurement_conversations` with a marker**, as PR
   #661 does for a failed thread read (`email_headers.order_match:
   "thread_read_failed"`). Impossible here: `provider_id` and `restaurant_id`
   are `NOT NULL` (`20260805000000_baseline_from_production.sql`, the
   `procurement_conversations` definition; no later migration relaxes them),
   and the shared-mailbox path carries no `restaurant_id`. Making them
   nullable is a schema change to the house's conversation book for one
   failure mode. Rejected.
3. **File it in the prospects triage bucket** (`email_prospects`,
   `restaurant_id IS NULL`). It is the exact outcome the brief forbids, and
   an attributed reply would still announce "New vendor prospect"
   (`:723-758`). Rejected.
4. **Await the handler in the consumer and nack with requeue.** Changes ack
   semantics for every bridge route (`:348-384`). A requeue has no delay, so
   it loops hot while the database is down; the queue caps at 1000 messages
   and drops from the head (`:361`), so the loop would push other inbound
   mail out; and the queue's 5-minute TTL (`:360`) with no dead-letter
   exchange drops it anyway. Rejected; the ack-before-settle itself is filed
   as an open item.
5. **Re-publish to the bridge's own queue** (`sendToQueue`; the bridge holds
   a channel, `:109`, `:159`). Same three faults as option 4: no delay, the
   1000-message head-drop, the TTL. Rejected.
6. **A new table for unattributed inbound mail.** A migration and a new
   surface for one failure mode, when a parking table exists. Rejected for
   now; revisit if parked rows become routine (below).
7. **Retry the read briefly, then park the mail in `dead_letter_queue`.**
   The table exists for this: the Python agents park a message there after
   their retries (`base_agent.py` `_send_to_dlq`, `:927-953`). It takes any
   message (`message jsonb NOT NULL`), is service-role only (RLS on, no
   policies), and nothing alters it after the baseline. **Chosen.**

## Decision

**A failed sender lookup is retried twice, then the mail is parked in
`dead_letter_queue` and the handler stops: no prospect, no conversation row,
no notice.**

- **Retry.** Three attempts, waits of 250 ms and 1 s plus up to half again of
  jitter, each attempt building its own query (a builder is single-use). A
  throw counts as a failed read, so the outer catch (`:941-945`) cannot lose
  the mail. The handler is not awaited, so the wait holds up nothing.
- **Pointer, not copy, for Gmail mail.** A message from the shared mailbox or
  a person's mirrored mailbox is parked as its Gmail ids, grant, restaurant,
  source, arrival time and attachment count. No sender, subject, body,
  headers or bytes. It is still in that mailbox to fetch again. A pointer
  holds none of the raw mail ADR 0118's sweeps delete, and those sweeps read
  only `procurement_conversations` (`raw-mail-retention.service.ts:548-551`,
  `:649-652`), so a copy here would have outlived a revocation. It also keeps
  the row small: Gmail attachments run to about 21 MB as base64.
- **Envelope for webhook mail.** The dedicated-domain webhook sets no
  `gmail_message_id` (`inbound-email.controller.ts:101-102`) and there is no
  mailbox to fetch it from again, so its whole envelope is kept. That mail is
  not under the sweeps in `procurement_conversations` either: both select by
  `mirrored_by_grant_id`, which webhook rows never carry.
- **Loud on both outcomes.** A park logs at error level with the parked row's
  id and the mail's ids. A failed park logs `the mail is NOT STORED` with the
  ids an operator needs to find it in Gmail or the webhook provider's log.

The reasoning that carried it: of the seven options it is the only one that
keeps the mail without inventing a surface, and it fails the way an outage
fails (loudly, recoverably) instead of the way the defect did (as a stranger,
or silently).

## Consequences

- **Easier.** A failed lookup no longer files a vendor as a stranger or loses
  their mail while the database still takes writes. Specs:
  `a-failed-sender-lookup-is-not-a-stranger.spec.ts`, 8 cases, 7 of them red
  on `be9a16c`.
- **Harder or given up, stated rather than implied:**
  - **Nothing replays a parked row.** Recovery is an operator's: re-fetch by
    `gmail_message_id` (or re-publish the envelope) to `email.events` /
    `email.inbound.received`, then set `resolved_at`. The step-3 dedupe makes
    a Gmail replay idempotent; webhook mail has no `gmail_message_id`, so a
    replay must check `message_id_header` first.
  - **Parked rows count in the orchestrator's `dlq_size`**
    (`health_routes.py:467-476`), which was defined around agent tasks.
    `agent_name = 'api-gateway.rabbitmq-bridge'` separates them.
  - **When the database refuses the park too, the mail is lost**, with a log
    line, not a Sentry event (`SentryService.captureMessage`,
    `sentry.service.ts:468`, has no caller in the gateway). Closing that needs
    the consumer to ack after the handler settles (option 4's open item).
  - **Two neighbouring losses are not fixed here** and are filed open in this
    branch's tech-debt fragment: the store insert failing (`:873-878`) still
    drops the mail, and a mirrored reply from a contact address in the vendor
    book (`provider_contacts.email`, `primary_contact.email`;
    `house-letters.service.ts:485-541`) still misses the `contact_email`-only
    match and takes the cold path even when the read works.
- **Revisit when** a week shows more than a handful of
  `api-gateway.rabbitmq-bridge` rows (parking has become a channel, and option
  6 or a replayer is due), or when the consumer starts acking after the
  handler settles (then a failed lookup can be nacked to a dead-letter
  exchange instead).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-08 | adversarial pass (independent agent, read-only) | Survives with changes. It found the retention gap a full-envelope park would open for mirrored mail (now a pointer), the 21 MB payload size, the throw path through the outer catch (now caught per attempt), and a wrong reason for rejecting option 5 (corrected). It also filed the two neighbouring losses above. |
| 2026-10-08 | — | Created. 8 spec cases; 13 of 13 source mutants killed under a local ts-node harness (registry.npmjs.org is blocked in the authoring sandbox, so jest itself did not run there). |
