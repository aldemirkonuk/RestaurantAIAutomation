# 0118 — The house writes its own mail

- **Status:** Proposed — built behind `mudavym_design_communications`, founder review open
  - **2026-09-04 (later the same day):** the send scope now exists. The founder
    said "add the gmail send integration now", and `gmail_send` is declared in
    `INTEGRATION_DEFINITIONS` — a separate integration requesting
    `https://www.googleapis.com/auth/gmail.send` and no other scope, house-declared
    and person-consented in the same shape as the Drive and Excel grants. **A
    letter can therefore leave, once a person in the house has consented.** Until
    one has, this ADR's "nothing can be sent today" consequence still describes
    the live answer for that house, but it is now a fact about the house rather
    than about the deployment. The Drive grant was NOT widened: `google_drive`
    still lists "Your Gmail messages" under `notRequested`, and a Drive-only house
    is still `kind: "none"`
    (`apps/api-gateway/src/integrations/integrations-oauth.constants.ts`,
    `apps/api-gateway/src/integrations/gmail-send-asks-for-one-thing.spec.ts`).
    Google app verification for the scope is an open external dependency — see
    ADR 0111's submission item.
  - **2026-09-04 (later still): the receive half.** The founder let the send
    grant stay send-only **on condition that the house can also receive on its
    own mailbox and have the whole comms there**, and, asked how the house's
    inbox should reach the book, answered: *"A second grant, read-only,
    house-declared and person-consented."* Built as **D8-D11** below. Two grants
    now exist, each asking for one thing: `gmail_send`
    (`https://www.googleapis.com/auth/gmail.send`) and `gmail_read`
    (`https://www.googleapis.com/auth/gmail.readonly`), separate ids, separate
    consent screens, separate disconnects. The reading is **off by default**
    behind `enable_house_inbox_read` and reads nothing until a person consents
    AND a restaurant switches it on. What is *not* closed: the flag has no
    manager-gated control anywhere (see Consequences), and no live read has been
    made — see "What only the founder can decide", item 5.
- **Date:** 2026-09-04
- **Decider:** Aldemir (founder) — the sender rule, the send costs, the recipient
  rule, the paid tier and the staff-broadcast exclusion were all decided in
  session on 2026-09-03 / 2026-09-04. Everything else here is the build.
- **Keywords:** email composer, sender identity, gmail.send, gmail.readonly,
  house mailbox, house inbox, second grant, read-only grant, inbound mirror,
  procurement_conversations, house_inbox_cursors, enable_house_inbox_read,
  Mudavym subdomain, paid tier, OD-23, undo window, hold-to-approve, merge
  fields, provenance, candidate_key, vendor book, provider contacts,
  COMMITMENT_PATTERNS, guardrails, template library, GmailTemplateBuilder,
  SMSTemplateBuilder, retire-to-write, absence-reported-as-health, consent
  screen, data handling, Gmail quota
- **Links:** [[0020-honesty-first]], [[0051-rebuilt-pages-show-live-data-only]],
  [[0083-a-page-may-not-claim-a-write-it-never-makes]],
  [[0084-the-ledger-shows-what-happened]],
  [[0112-one-modal-policy-three-shapes-one-primitive]],
  [[0114-connections-are-the-houses-profile-is-the-persons]],
  [[0042-mudavym-brand-directions]],
  `.planning/sketches/100-email-composer/`,
  `supabase/migrations/20260904150000_the_house_writes_its_own_mail.sql`,
  `supabase/migrations/20260905020000_the_house_reads_its_own_inbox.sql`,
  `apps/api-gateway/src/communications/letters/`,
  `apps/api-gateway/src/communications/inbox/`,
  `apps/api-gateway/src/communications/gmail-mime.ts`,
  `apps/api-gateway/src/integrations/gmail-read-asks-for-one-thing.spec.ts`,
  `apps/web/src/pages/communications/next/Compose/`,
  `apps/web/src/pages/AuthorizeIntegration.tsx`,
  `.planning/06-pages/communications.md` §1a/§1b/§9/§13,
  `.planning/06-pages/connections.md` §1a/§13

## Context

`/communications` could not write a letter. It could open two template builders
that stored a row nothing sent, and it could read the conversation book. Every
letter this deployment has ever sent to a vendor left from **one mailbox shared
by every restaurant on it** — `GMAIL_SENDER_EMAIL`, falling back to the literal
`notifications@wineops.ai` (`apps/api-gateway/src/communications/gmail.service.ts:80`).
The sign-off inside the letter carries the house's name; the envelope carries
ours. `GET /communications/sender-identity` was built on 2026-09-03 precisely so
a page could *state* that (`communications.controller.ts:122-157`), and it
returns `scope: "deployment"` with `perHouse.supported: false`.

Sketch 100 drew the composer that this ADR builds, and its survey found the
second half of the problem. **Ten mail products were read; every one answers a
missing merge value by substituting a plausible one** — a default, a silent
blank, or a fluent prediction. That is this repo's named cardinal fault (absence
reported as health) written into a letter a vendor keeps and can quote back.
Mudavym is the only one of the ten that computes its own figures, so it is the
only one that can say *why* a number is missing.

## Decision

### D1 — The sender is the house's, or there is no letter

A letter leaves from **the house's own connected mailbox**, or from **a Mudavym
subdomain address we provision**. Never from the deployment's shared mailbox.
When neither exists, Send is **disabled carrying the reason** and the route
refuses with 409; nothing is queued and nothing is sent.

**The subdomain line is a paid-tier option** (founder, 2026-09-04). A house on
the free plan sends from its own connected mailbox. The price is OD-23 and is
**not stated anywhere in the build** — the row says which tier the option
belongs to and never what it costs.

The identity is resolved from a **stored scope, not a flag**: a grant is a
sending identity only if `integration_oauth_connections.scopes` (a `TEXT[]`
written from the consent screen's own disclosure, `20260826170000:133`) contains
`https://www.googleapis.com/auth/gmail.send`.

**Measured on this branch, 2026-09-04: no house has one.** `INTEGRATION_DEFINITIONS`
declares exactly two integrations, `google_drive` and `excel`
(`integrations-oauth.constants.ts:36-98`), and neither requests `gmail.send` —
`google_drive` lists "Your Gmail messages" under `notRequested` (`:64`). So
`GET /communications/letters/sender` returns `kind: "none"` for every house
today, live-verified against `:4000`. **Widening the Drive grant's scope list to
light the button up was refused**: that changes what people already consented
to, without asking them. The missing integration is named in the response's
`missing[]`, in the page note §9, and in §13 as the next build.

Four states, not two: `house_mailbox`, `mudavym_subdomain`, `none`, and
**`unknown`** — a failed read. "This house has no sending identity" and "we could
not find out whether it has one" are different sentences, and a reader who
cannot tell them apart is being told the second is the first (ADR 0051 clause 3).

### D2 — Send costs what the sender is worth

- **The house's own mailbox** → a plain button and a **server-side undo window**.
  The window is **2 minutes**, and it is not a new number: it is
  `AUTO_SEND_UNDO_MS = 2 * 60 * 1000` at
  `common/orchestrator/inbound-responder.service.ts:36`, the window the
  autonomous vendor-reply path already stages a guardrail-clear reply for. The
  founder's words were "the AI reply path's shape", and the shape includes its
  duration.
- **The Mudavym subdomain** → the **hold-to-approve seal**. One house's letter on
  a shared sending domain affects every other house's deliverability there, so
  the commitment is real in a way a single-tenant mailbox's is not.

**The undo window is a row, not a timer.** The letter is written as
`status='HOUSE_QUEUED'` with `scheduled_send_at = now + window`, and a
once-a-minute dispatcher sends it after that. A `setTimeout` in the request's
process is a promise the process cannot keep — a deploy, a crash or a scale-in
inside the window drops the letter and the page shows "queued" for ever with
nothing behind it. And a *client-side* undo is worse than useless: it sends
immediately and hides the fact for two minutes, which is ADR 0083 pointed the
other way — a page may not offer to undo something that has already happened.

The status word matters. `processScheduledAutoSends` selects
`status = 'AUTO_SEND_SCHEDULED'` and nothing else
(`procurement.service.ts:3739,3755,3951`). A house letter wearing that word would
be dispatched by the **AI's** cron through the **deployment** mailbox — exactly
what this build exists to stop. The spec asserts the two are different.

### D3 — Recipients come from the book, with "add to the book" inline

The composer has **no free-text To**. It searches the vendor book
(`providers.contact_email`, `providers.primary_contact->>'email'`,
`provider_contacts.email`), and an address the book does not hold **creates the
vendor contact first**, through the route that already exists
(`POST /providers/:id/contacts`, `providers.controller.ts:377`). Only then can a
letter address it.

The server refuses independently of the field, and the refusal **names the
addresses that are on record** rather than saying "invalid" — a refusal a person
cannot act on is a smaller version of the same fault.

A free-text To is how a letter escapes the book, and with it the guardrails, the
round count and the conversation record. That is a restriction; it is the
founder's to lift.

### D4 — The merge unit is the engine's whole sentence, with its provenance

A figure carries its provenance, or it goes into the letter as words. The
corollary, which is the load-bearing half: **the unit of insertion is a sentence
the engine already computed**, never a figure scraped back out of one. The
composer's picker offers `analytics_insights` rows; inserting one puts the whole
`sentence` into the body and attaches a chip carrying `candidate_key`, the
window and `computed_at`.

`rec-forward.ts` already gives the reason on the recommendation side: a figure
re-derived on the client is a second arithmetic that can disagree with the first,
and a letter a vendor keeps is the worst possible place for that disagreement to
surface. There is **deliberately no "insert a figure" control**; that field is
the hole all ten surveyed products fall through. A figure the engine withheld
produced no sentence, so there is nothing to insert and no blank to fill.

**The client is not trusted with its own chips.** `verifyInsertions` re-reads
every claimed `candidate_key` for the tenant and drops any whose sentence does
not match the stored row, then records the survivors in
`procurement_conversations.inserted_insights` (new column). Without that column
the chips are a screen effect that does not survive the send: six months later
the row would say what was written and not what the house believed when it wrote
it.

### D5 — The guardrails run over the human's own draft, and only the two that mean something

The AI reply path computes five guardrails
(`inbound-responder.service.ts:871-930`). Measured against a human-written
letter, **exactly two transfer**, and saying so is more honest than running five:

| guardrail | over a human draft | why |
|---|---|---|
| `commitment_language` | **transfers, and BLOCKS** | a pure text test over the body; the reason it exists is as true when a person typed the sentence. The AI's version routes to a human — here the human *is* the author, so the only remaining move is to make them rewrite it or place the order |
| `max_rounds` | **transfers as a FACT, not a block** | it counts outbound rows on the order; a manager writing a fourth letter is entitled to, so the composer says how many have gone |
| `price_above_target` | does not transfer | reads `analysis.vendor_offers`, a structured extraction of what the vendor offered. A blank letter has no offers |
| `qty_or_budget_change` | does not transfer | same reason |
| `sender_unverified` | does not transfer | it is about an inbound message's DKIM/DMARC. There is no inbound message |

One guardrail is **added** that the AI path does not need: an **unresolved merge
token**. The AI writes prose; the composer merges. A letter that ships
`{{last_price}}` has substituted a plausible-looking blank for a figure it did
not have — the cardinal fault, in a vendor's inbox. As far as sketch 100's survey
found, running a commitment-language check over a *human's* draft is something no
product in this field does.

### D6 — A staff broadcast is not a composer template

Founder, 2026-09-04: **definitely not**. The composer writes to the **vendor
book** only; crew messages stay on `/team` as inline comms. This is enforced, not
merely stated: `LETTER_CATEGORIES` is five vendor purposes, the DTO refuses
anything else with the reason, and the library page says it in words.

It was the one template in the sketch with no vendor, no guardrail and a
different legal footing — and the row most likely to drag a shared sending domain
into bulk-sender territory.

### D7 — The two legacy builders are retired from the rebuilt page

`GmailTemplateBuilder` (1,683 lines) and `SMSTemplateBuilder` are no longer
mounted by anything under a `next` tree. They are **untouched**, and the legacy
`/communications` (`pages/Communications.tsx:589,598`) still mounts them exactly
as it did, so ADR 0042's byte-for-byte promise for the flag-off page holds.
`TemplateSheet.tsx` is now the house's own letter library, and
`CommunicationsNext.test.tsx` asserts the retirement **as a rule** by reading the
source of every `next` file — a single `lazy(() => import(...))` slipped back in
would otherwise un-retire them with nothing failing.

**Retire-to-write.** This retires: the `.cm-builder-skin` three-selector re-skin
and its section in `communications.md` (§1b "Modal shape, 2026-09-03"), the SMS
template workshop entry point, and the P5 paragraph defending a workshop that
stored a row nothing could send.

### D8 — Receiving is a SECOND grant, not a second scope (founder, 2026-09-04)

The founder's own words settle the shape: *"A second grant, read-only,
house-declared and person-consented."* `gmail_read` is a separate
`IntegrationDefinition` requesting `https://www.googleapis.com/auth/gmail.readonly`
and nothing else.

Why not one Gmail grant with both scopes, which is what every mail integration
in the field does: `UNIQUE (user_id, integration_id)` (`20260826170000:144`)
makes an **id** a grant, so a separate id is a separate consent screen, a
separate row and a separate disconnect. Somebody who agreed to let this house's
letters *leave* from their mailbox has not thereby agreed to let it be *read*,
and those are the two questions people answer most differently. Combining them
would also have forced every person who already consented to sending back
through a consent screen for a power they never agreed to — which is exactly
what D1's alternative 2 refused for the Drive grant.

`gmail.readonly` is the narrowest scope Google publishes that can fetch a
message **body**. `gmail.metadata` returns headers and labels only, so a
vendor's price would never reach the book; `gmail.modify` would let us label or
archive what we read and is refused, because this reads and changes nothing.

### D9 — The read is bounded by the book, twice, and never reaches backwards

`gmail.readonly` permits reading the whole mailbox. The reader does not, and the
thing that holds it to the vendors in the book is **code**, so the consent screen
says so rather than stopping at the scope.

1. **The query.** Every `users/me/messages` request carries
   `from:(a@x OR b@y ...)` built from THIS house's vendor book — the same
   `HouseLettersService.book()` (`providers.contact_email`,
   `providers.primary_contact->>'email'`, `provider_contacts.email`) that D3
   restricts the composer to. **An empty book issues no request at all**; an
   unbounded read is not the fallback for an empty book, and a book that could
   not be READ is an error rather than an empty one.
2. **The post-check.** Gmail's `from:` operator matches display names and
   partial tokens, not just exact addresses, so a query naming only book
   addresses can still return a message from outside it. Every message that
   comes back has its `From` parsed and compared to the book set exactly, and
   anything else is **discarded before its body is read out of the payload**,
   published, logged or counted as anything but a discard. The spec proves it
   against a message whose display name contains a vendor's name and whose
   address is a clinic's.

**Nothing that arrived before consent is ever read.** The first tick for a grant
seeds the cursor at `now` and reads nothing; `house_inbox_cursors.started_at`
records the moment. Switching the reader on does not sweep a person's mail
history into a shared ledger, and that is a privacy property before it is a
quota one.

**Five minutes, and the number is measured.** Gmail publishes 80,000,000 quota
units per day per project and 6,000 per minute per user per project;
`messages.list` costs 5, `messages.get` 20, `messages.attachments.get` 20
(developers.google.com/workspace/gmail/api/reference/quota, fetched 2026-09-04).
An idle grant with up to 25 vendors costs 5 units a tick — **1,440 units a day**,
0.0018% of the project's daily allowance. A busy day of 50 replies with 10
attachments is 2,640. A 500-vendor book is 20 chunked listings, 100 units a
tick. One minute would be five times the listing cost for a reply nobody acts on
any sooner — an inbound reply is analysed and STAGED for a person, and even the
autonomous path holds it two minutes.

**`messages.list`, not `history.list`,** although `history.list` costs 2 units
and is exactly incremental. It takes no `q`: it returns every change in the
mailbox, so choosing the vendor ones would mean fetching metadata for the
person's whole mail flow. That is precisely the read this grant promises not to
make, and a bounded query at 5 units is cheaper in the only currency that
matters.

### D10 — The mirror is the shared mailbox's own function, not a copy of it

The reader **does not write a `procurement_conversations` row**. It publishes
`email.inbound.received` on the `email.events` exchange, stamped with the
`restaurant_id` the grant already carries — exactly as the Gmail push webhook
does (`communications.controller.ts:1331`) and as the dedicated-domain webhook
does (`common/orchestrator/inbound-email.controller.ts:90`). The row is then
written by `RabbitMqBridgeService.handleInboundEmail`
(`common/orchestrator/rabbitmq-bridge.service.ts:528`), which runs the same
provider match, the same `gmail_message_id` dedupe, the same attachment
persistence, the same promotions extractor and the same handoff to
`InboundResponderService.analyzeAndDraftReply` — understand, guardrails, staged
draft, shadow triage classification.

So a house-mailbox reply **is** a shared-mailbox reply: the same kind of row,
seen by the AI path identically. A second insert would have been easier and is
the thing this build most needed to avoid — two writers that agree today, and a
vendor reply that is triaged on one mailbox and silently is not on the other.
`house-inbox.spec.ts` asserts the reader never names
`procurement_conversations` at all.

**The cursor advances only after the publish resolves.** `publishEvent` throws
when there is no RabbitMQ channel (`orchestrator.service.ts:78-88` does not
swallow it), so a message that did not reach the book is read again next tick
rather than lost with the run reporting a clean pass. The bridge's dedupe makes
the retry a no-op.

**Revocation stops it on the next tick.** The token comes from
`IntegrationsOauthService.getAccessToken`, the one door ADR 0114's house
revocation is enforced at; a manager's cut makes the next tick throw `Forbidden`,
which is recorded in words and reads nothing. A person's own disconnect sets
`revoked_at` and the enumeration never sees the row again. Both are tested.

### D11 — The sender line states the WHOLE conversation, in four states

A sending identity was never the whole answer to "where is this house's
conversation?". A letter leaving from the house's own mailbox whose reply lands
in the mailbox every restaurant here shares is **half** a conversation, and a
line that said only "sends from X" was reporting the half it could see as the
whole — which is the arrangement the founder made the send grant conditional on
ending.

`GET /communications/letters/sender` now carries `conversation.where` with four
values and one non-value:

| `where` | the sentence |
|---|---|
| `whole_conversation_here` | the whole conversation is on this house's mailbox; nothing passes through the shared address |
| `letters_leave_only` | letters leave from X; replies still arrive through the shared mailbox until someone consents to reading |
| `replies_arrive_only` | replies are read and filed; no letter may leave, because nobody consented to sending |
| `shared_mailbox` | neither half is here |
| `unknown` | the grants could not be read — **not** a fifth arrangement, and not `shared_mailbox` (ADR 0051 clause 3) |

**A consent is not a switch.** Reading needs a person's `gmail_read` grant AND
this restaurant's `enable_house_inbox_read`, and neither implies the other. A
house with the first and not the second is placed with the houses that are not
being read — `where` states what IS happening, not what could be — and the words
then name which of the two doors is shut, so nobody is sent to connect a grant
they already have.

## Alternatives rejected

1. **Send through `GmailService`, and put the house's name in the From
   display-name.** The cheapest thing that looks right, and it is the fault in
   costume: the envelope, the Return-Path and the DKIM signature all still say
   `wineops.ai`, a vendor's reply threads to our mailbox, and a spam report lands
   on every other house on the deployment. It also cannot be undone later — once
   vendors have the address, changing it looks like a phish.
2. **Widen the `google_drive` grant to include `gmail.send`.** One line, and the
   button lights up for every house that already connected Drive. Refused
   outright: people consented to file access and were explicitly told "Your Gmail
   messages" was not requested. Sending as someone is a different grant and has
   to be asked for by name.
3. **A client-side undo (send immediately, hide it for two minutes).** Simpler,
   no cron, no queue table. It is a lie: the letter is gone the moment the button
   is pressed, and "Undo" is a button that cannot do what it says.
4. **The seal on every send.** The sketch drew it. Rejected by the founder for
   the house's own mailbox on the argument the sketch itself made: a manager
   writing eight letters a day will find the ceremony tiresome, and the house
   rations the seal on purpose. It survives where the consequence is genuinely
   shared — the Mudavym domain.
5. **A free-text recipient with a warning.** How every mail client works. It is
   also how a letter leaves the book, and everything the book keys — the round
   count, the guardrails, the conversation history — silently stops applying to
   it.
6. **Ship against `POST /procurement/orders/:id/manual-reply` first** (the
   sketch's recommended order). That route exists, is guarded and threads onto
   the last inbound (`procurement.controller.ts:453`), so it was the smaller
   build. Rejected because `apps/api-gateway/src/procurement/**` is owned by
   another builder this pass, and because it requires an existing order and
   *derives* the subject (`procurement.service.ts:3436`) — a composer whose
   subject is computed for it is not a composer.
7. **`MANUAL_REPLY` as the letter's `outbound_email_type`,** avoiding the CHECK
   migration. It is the type the reply-to-an-order path writes; borrowing it
   makes two different things indistinguishable in the ledger the page renders.
8. **A `house_letters` table.** A letter is a conversation row: the AI path reads
   `procurement_conversations` for its round count, `/communications` renders it,
   and a second table would have made a manager's letter invisible to both.

**Rejected for the receive half (D8-D11), 2026-09-04:**

9. **One Gmail integration carrying both `gmail.send` and `gmail.readonly`.**
   One row, one consent screen, one disconnect — and how nearly every mail
   integration in the field does it. Refused: it forces everyone who already
   consented to sending back through a screen for a power they never agreed to,
   makes "connected" mean two things depending on when you connected, and above
   all merges the two questions people answer most differently. "You may send as
   me" and "you may read my mail" are not one decision.
10. **A per-grant `users.watch` + Pub/Sub push, instead of a poll.** Lower
    latency and 2-unit `history.list` calls. Not built, and the reason is stated
    rather than dressed up: it needs a Pub/Sub topic per grant with an IAM
    binding Gmail can publish to, a renewal before the 7-day expiry, and a push
    endpoint that can tell which house a notification belongs to — Google Cloud
    plumbing nobody has been asked to buy. A poll is a smaller promise: no
    infrastructure, it cannot silently stop (the run record says when it last
    ran), and its cost is arithmetic anyone can check. Filed as roadmap.
11. **Reading the mailbox unbounded and filtering afterwards.** Simpler, and it
    would catch a vendor who writes from an address the book does not hold yet.
    Refused: it makes the grant's promise ("mail from the vendors in your book")
    false at the wire, and a promise that is only kept by a later `if` is not the
    promise a person consented to. The cost is real and is stated on the row: a
    vendor who writes from a NEW address is invisible to this reader until
    somebody adds them to the book. It is the same restriction D3 puts on the
    composer, pointed the other way.
12. **Backfilling the mailbox on first connect.** Every mail product does this,
    and it would have made the first screen after consent look useful. Refused:
    it turns "I agreed to let the house see vendor replies" into "the house has
    read six months of my mail", which is precisely the surprise the founder's
    rule forbids. The cursor seeds at `now`.
13. **A per-message log of what was discarded.** Tempting for auditability, and
    it would rebuild inside our own database the record the discard exists to
    avoid keeping — who writes to this person. `house_inbox_cursors` keeps
    counts only, and a count identifies nobody.

## Consequences

- **~~Nothing can be sent today, and the page says so.~~ SUPERSEDED 2026-09-04
  by this ADR's own status line.** As written, this said no house had a
  `gmail.send` grant because no integration asked for one, and named "a third
  `IntegrationDefinition` for `gmail.send` with its own scope disclosure" as the
  next build. That build happened the same day. What survives unchanged: the page
  is still honest when the answer is `none`, the answer is still read off the
  stored `scopes` array rather than a flag, and Google app verification for the
  sensitive scope is still outstanding — so a house outside the OAuth test-user
  list will meet Google's unverified-app screen, not ours.
- **A migration is a precondition, not a follow-up.**
  `20260904150000_the_house_writes_its_own_mail.sql` adds `HOUSE_LETTER` to
  `chk_outbound_email_type`, `inserted_insights` to `procurement_conversations`,
  and `category` / `merge_fields` / `updated_by` / `last_used_at` to
  `communication_templates`. Until it applies, `GET /communications/letters/templates`
  answers **400 with the reason in words** and the library renders "unknown, not
  empty" — verified live on `:4000`. All additive, all nullable, no backfill (a
  letter sent before it carried no recorded provenance, and writing `{}` would
  claim it carried none).
- **The house letter templates live in `communications/letters`, not in
  `restaurant-templates`.** That module's DTO is `whitelist: true,
  forbidNonWhitelisted: true` and models four columns; growing it was outside this
  pass's paths. The two now write the same table under different `type` values
  (`letter` vs `email`/`sms`/`sender_identity`). **This is a seam worth closing**
  — filed in §13.
- **`CommunicationsModule` provides `IntegrationsOauthService` from its class,
  not by importing `IntegrationsModule`.** The first attempt used `forwardRef`
  and the gateway would not boot: `forwardRef` defers *Nest's* graph, not
  *Node's* module loading, and the ring `auth.module → communications.module →
  integrations.module → organizations.module → auth.module` closes at load time
  (`ReferenceError: Cannot access 'AuthModule' before initialization`). The cost
  is a second instance; it is not a second door, because the service holds no
  state and both instances run the same `getAccessToken`, including the
  house-revocation check at `integrations-oauth.service.ts:926-938`.
  `check_gateway_boots.sh` caught it and now passes.
- **A cron now exists that can send mail** (`house-letters.cron.ts`, once a
  minute). It sends only rows a human queued, only after the window, only through
  the house's own grant, and it reports its last run on the sender route so the
  surface never has to guess whether the dispatcher is alive.
- **ADR 0083's status gains a dated line**: its "Save confirms only after
  acceptance" rule now also governs a *send* — the composer returns 202 and says
  "queued", never "sent".
- **`Sheet` gains a `wide` prop** (640px), ADR 0112's one anticipated exception,
  used by exactly one surface. A boolean rather than a number so it cannot become
  per-page freedom by increments.

**From the receive half, 2026-09-04:**

- **A second migration is a precondition, not a follow-up.**
  `20260905020000_the_house_reads_its_own_inbox.sql` creates
  `house_inbox_cursors` (one row per grant, RLS on, service_role only,
  anon/authenticated revoked, and holding **no** subject, sender, body or
  message id) and adds `restaurant_feature_flags.enable_house_inbox_read`
  (`NOT NULL DEFAULT false`).
- **`GET /settings/feature-flags` was ALREADY 500 on this branch before this
  change, and now names one more missing column.** Measured live against
  `:4000` on 2026-09-04: `{"message":"Could not read your feature settings."}`.
  The cause is not this build — `20260903150000_mudavym_design_flags_connections.sql`
  and the rest of the p4 wave's flag columns are not on `origin/main` yet, and
  `getFeatureFlags` selects every ACTIVE key. It resolves when the wave merges
  and the migrations auto-apply. Recorded because a reader meeting that 500
  should not attribute it here.
- **BLOCKING — the switch has no control anywhere, and deliberately did not get one.**
  `PUT /settings/feature-flags` is guarded by `JwtAuthGuard, TenantGuard` and
  **no role check** (`settings.controller.ts:38-40`) — unlike the approval
  thresholds beside it, which call `assertCanManageRestaurant` (`:141`). Adding
  `enable_house_inbox_read` to that DTO would have let **any authenticated
  member of a restaurant start reading a colleague's mailbox**. So the flag is
  settable today only by writing the column directly. That is a gap, not a
  feature, and it is filed rather than closed because closing it means either
  role-gating a route that governs two existing flags (a behaviour change beyond
  this pass) or building a manager-gated control in `settings/**`, another
  builder's path. **The reader therefore cannot run on any deployment until
  somebody does one of the two.**
- **The consent screen refused `gmail_send` outright until this change, and
  nothing failed.** `AuthorizeIntegration.tsx` held
  `const VALID_IDS = ['google_drive', 'excel']` and checked the route parameter
  against it before reading the catalogue. Every Connect row on `/connections`
  and `/profile` links to `/authorize/:id`, so the only path to consenting to
  the sending grant declared that morning ended at *"Unknown integration. That
  integration doesn't exist."* Measured against `git show HEAD:` in
  `apps/web/src/pages/AuthorizeIntegration.test.tsx`'s pre-fix run. Fixed by
  deleting the copy: the catalogue the server returns decides, and an id it does
  not carry gets a sentence about **this deployment's catalogue** rather than
  about existence. Widening `IntegrationId` then surfaced two more copies of the
  same fault at compile time (an exhaustive icon map, a narrowed handler
  parameter), both corrected.
- **Every integration now carries a `dataHandling` block** — what is read, what
  is never read, where it lands, who can see it — REQUIRED on the interface
  rather than optional, and rendered on the consent screen under "Where it goes,
  and who can see it". Optional would have meant the one grant whose author
  thought about it says something and the others say nothing, and a reader
  cannot tell "this stores nothing" from "nobody wrote the sentence".
- **The Gmail MIME walk is now one function** (`communications/gmail-mime.ts`),
  imported by the controller and the reader. Two walkers would have given the
  same vendor reply two different bodies depending on which mailbox it arrived
  on, with nothing to report the difference.
- **`HouseSenderService` must not depend on `HouseInboxService`.** The ring is
  sender -> inbox -> letters (for the book) -> sender, and Nest will not build
  it. The flag read they share lives in `inbox/house-inbox-flag.ts`, a plain
  module with no DI edge — chosen over a second fails-closed copy inside the
  resolver, which is the version that eventually disagrees.
- **`scripts/check_flag_readby_anchors.py` learns a third gate family.** Without
  a `GATE_PATTERNS` entry it exits **2 — CANNOT CHECK** for a new anchor file,
  which is the correct behaviour and is why the entry is part of this change
  rather than a follow-up.

## What only the founder can decide

1. **What does a Mudavym address cost, and who may take one?** OD-23. Sharper
   version: does the *sending identity itself* become the paid line, or is the
   paid line the Mudavym-hosted address on top of a free bring-your-own mailbox?
   The build assumes the second (a free house sends from its own mailbox); the
   copy would change if it is the first.
2. **May the composer send SMS?** The raw SMS route was deleted on 2026-09-02 for
   being unguarded and untraceable (ADR 0084). A free-text SMS composer would
   re-open exactly what that deletion closed.
3. **Does `max_rounds` block a human, or only inform one?** Built as a stated
   fact. If a fourth letter on one order should require a second person, that is a
   policy decision, not a guardrail decision.
4. **Should a queued letter be visible to the whole house, or only its author?**
   Built house-wide (`GET /communications/letters/queued` is tenant-scoped), so a
   second manager can pull back a letter they did not write.
5. **Who may switch the reading on, and where does that control live?** The flag
   exists and has no surface (see Consequences). The two paths are: role-gate
   `PUT /settings/feature-flags` with `assertCanManageRestaurant` — which also
   changes who may flip `enable_ai_autonomous_send`, arguably overdue and
   arguably a separate decision — or build a manager-only control on
   `/connections` beside the reading grant's row. **Until one is chosen, no
   house can turn the reader on**, and that is the honest state of this build.
6. **May the reader read a vendor who is not in the book yet?** Today it cannot,
   by construction (D9). A vendor who writes from a new address, or a prospect
   writing for the first time, reaches the shared mailbox's cold-email path and
   never the house's own. Lifting it means either an unbounded read (rejected,
   alternative 11) or a second, wider consent — and that is the founder's call,
   not a default.
7. **Should reading imply a retention rule?** A vendor reply now lands in
   `procurement_conversations` from a person's private mailbox. Nothing in this
   build deletes it, and nothing says how long the house keeps it. That is a
   policy question the consent screen currently answers with silence.
