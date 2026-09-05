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
    AND a restaurant switches it on. What is *not* closed: no live read has been
    made. Founder-question 5 is answered — see the next line.
  - **2026-09-05: founder-question 5 answered, and the reader's switch exists.**
    Shown the fork — role-gate the flags route, or build a second manager-only
    control beside the reading grant — the founder chose **"the flags route gains
    a manager check"**, one rule for every flag. `PUT /settings/feature-flags`
    now calls `assertCanManageRestaurant`
    (`apps/api-gateway/src/settings/settings.controller.ts:105-109`), the same
    helper the approval thresholds in that controller already used, and
    `enable_house_inbox_read` joined `UpdateFeatureFlagsDto` — the key this ADR's
    Consequences withheld from it. So the **BLOCKING** consequence below is
    closed: a manager can switch the reader on from `/settings`. The decision
    reaches past this ADR, which is why it was the founder's: the same route
    governs `enable_ai_autonomous_send`, which any authenticated member could
    flip until now. Proof:
    `apps/api-gateway/src/settings/flag-writes-are-role-gated.spec.ts`, 8 cases,
    both directions, with the pre-fix acceptance measured against a
    `git show HEAD:` copy of the controller. Still open: no live read has been
    made.
  - **2026-09-05: founder-question 7 researched, not answered.** The founder
    asked which of three retention shapes is SOTA "for ML purposes and
    training, and for privacy" — see **D12-D15** below and the evidence table at
    `.planning/07-reference/messaging-senders.md` §8. Nothing was built or
    decided by that entry; it existed so the founder's question was answered with
    fetched sources rather than a plausible-sounding default.
  - **2026-09-05 (later the same day): founder-question 7 ANSWERED, and built.**
    Shown the recommendation's four forks, the founder decided all four in
    session: **the split** (a mirrored reply is two objects — raw mail with a
    stated window that also goes on revocation, and facts that keep the order's
    paper trail under the house's bookkeeping retention); **the window basis**
    (the longest open dispute the house has recorded plus a stated margin,
    measured from the house's own conversations, re-derived quarterly, printed
    on the consent screen with its basis); **jurisdiction** (per house from its
    country, each rule naming its floor and its source, a house with no country
    recorded getting the strictest rule and a sentence why); and **revocation**
    (stop reads AND delete the raw mail, facts stay, the consent screen says so
    before the grant). The section below moves from a recommendation to
    **D12-D15**, built in `apps/api-gateway/src/communications/retention/` with
    migration `20260905190000_a_mirrored_reply_states_how_long_it_is_kept.sql`.
    The consent screen no longer answers the retention question with silence.
    One question stays open and is named rather than defaulted: **a per-house ML
    personalization model is not wanted until asked for**, so nothing here builds
    toward it (question 5 of the old list, now D15's own note).
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

### D12 — A mirrored reply is TWO objects, and they get two rules (founder, 2026-09-05)

The founder's first answer to question 7. The three shapes he was offered —
(A) keep while the relationship is open and delete on revocation, (B) keep with
the house's records regardless, (C) a fixed 90-day window — are all answers to
"how long do we keep *a vendor reply*", and a vendor reply is not one thing.

- **The RAW MAIL** — `procurement_conversations.message_text`, `email_headers`,
  `content`, and the attachment bytes in the private `vendor-attachments`
  bucket. This is a copy of somebody's mailbox. It has a stated window (D13) and
  it goes on revocation (D15).
- **The FACTS** — `detected_intent`, `detected_sentiment`, `rolling_summary`,
  and every branch of `conversation_context` the understand step writes
  (`analysis.vendor_offers`, `key_facts`, `commercial_terms`, `classification`;
  `inbound-responder.service.ts:308-339`), plus `procurement_orders.*` and
  `negotiation_facts.exact_quote`. These are the house's own procurement record
  and keep the order's paper trail under the bookkeeping floor in D14. Neither
  the window nor a revocation touches them.

This is D4's own line — a figure goes into a letter as the engine's computed
sentence, never scraped back out of a reply — run in the other direction.

**What made the split safe to build, and it was not in the recommendation.**
The recommendation's own strongest counter-argument was that structured
extraction captures a number and loses the wording, so deleting the body leaves
the house holding a paraphrase of its own making. Measured on this tree:
`public.negotiation_facts.exact_quote` is `text NOT NULL` (baseline:3866) and
holds the vendor's own sentence beside the number, with `commitment_type` and
`stated_by`. The counter-argument is weaker than it read, and it is weaker
because of a table nobody cited, not because the argument was wrong.

### D13 — The window is the house's longest dispute plus one re-derivation interval

The founder's second answer: *the longest open dispute the house has recorded,
plus a margin, stated; measured from the house's own conversations; re-derived
quarterly; the consent screen prints the current figure and its basis.*

- **A dispute** is a `procurement_credits` row — the house's own claim ledger
  (open, requested, promised, credited, rejected, written_off; baseline:4353).
- **Its span** runs from the FIRST MESSAGE ON THE DISPUTED ORDER, not from the
  claim's `opened_at`: a claim is opened after the argument has been running,
  and the mail that matters is the mail from before it was opened.
- **It ends** at `settled_at`, or at today while it is still open — which is
  what "the longest OPEN dispute" means.
- **The margin is 92 days and it is derived, not chosen.** The figure is only
  re-derived quarterly, so a dispute that opens the day after a derivation is
  invisible to the figure for up to one quarter — 92 days at its longest (1 July
  to 1 October). A margin shorter than the gap between two derivations would let
  raw mail expire on a figure a dispute opened since has already made too short,
  with nothing reporting it. The margin is exactly one re-derivation interval:
  the number the cadence forces. `retention-rules.spec.ts` fails if the two ever
  come apart.
- **A house with no dispute recorded gets the margin alone**, `basis_kind` is
  `no_dispute_recorded`, and `longest_dispute_days` is **NULL, never 0** — 0
  would read as "we measured a dispute and it lasted no time". This is the
  SHORTEST window the rule can produce, which is the right direction: no
  evidence of long disputes means the most privacy-preserving answer, and it
  lengthens the first time a dispute actually runs long. **Measured, this is the
  ordinary case and not the edge case:** on 2026-09-05 the one production tenant
  readable through the local gateway (`550e8400-e29b-41d4-a716-446655440000`)
  returned `{"items":[]}` from `GET /procurement/credits` and
  `{"total":0}` from `GET /conversations/stats/overview`.
- **A failed read is never "no disputes."** supabase-js resolves
  `{ data, error }`, so a swallowed error would turn a database outage into
  "this house has never disputed anything" and shorten the window on the
  strength of it. `computeWindow` throws instead, and the spec asserts the
  sentence.

### D14 — The floor for the FACTS is per house, from its country, with the default stated

The founder's third answer. `communications/retention/retention-rules.ts` is the
table; every row names its statute, quotes the operative words, and carries the
URL and the date it was fetched (all 2026-09-05, by this session).

| Rule | Floor for the facts | Named statutes | Reaches the correspondence itself? |
|---|---|---|---|
| **TR** | 10 years | TTK 6102 Art. 82(5); VUK 213 Art. 253 (5 years) | **Yes** — Art. 82(1)(b)-(c) + 82(2) |
| **GB** | 6 years | Companies Act 2006 s.388(4) (3 private / 6 public); HMRC's own six | No |
| **US** | 7 years | IRS periods of limitation (3 / 6 / 7; 4 for employment tax) | No |
| **US-CA** | 7 years | the above, plus CDTFA Pub. 116 (4 years) and CCPA s.1798.100(a)(3)/(c) | No |
| **UNKNOWN** | 10 years | TTK 6102 Art. 82, as the strictest row | Yes, by inheritance |

**The default carries a sentence, not just a number.** A house with no
`restaurants.country` gets the UNKNOWN row and the consent screen prints
`defaultedBecause` verbatim: the strictest rule is applied rather than a guess,
because a floor that is too long costs storage and a floor that is too short
costs a record the house may be legally required to produce. A country the table
has not researched is UNKNOWN too — not the nearest guess — because the table's
authority is the statutes in it.

**The primary Turkish text was fetched this pass, closing §8.6's own caveat.**
`messaging-senders.md` §8.6 read the Turkish figures from a law firm's Q&A and
flagged them as one step short of primary because `mevzuat.gov.tr` would not
resolve. It still will not (`unable to verify the first certificate`,
2026-09-05), but the consolidated statutes are published on two other `.gov.tr`
hosts and were read directly: TTK 6102 from the Ministry of Justice
(`mgm.adalet.gov.tr`) and VUK 213 from `hukukmusavirligi.diyanet.gov.tr`.

**And the primary text moved the finding.** TTK Art. 82(1)(b) requires a trader
to keep *"alınan ticari mektupları"* — the commercial letters RECEIVED — and
82(2) defines a commercial letter as *"bir ticari işe ilişkin tüm yazışmalar"*,
all correspondence relating to a commercial matter, for ten years from the end
of the calendar year of the correspondence. A vendor's reply about an order is
squarely inside that, which is the "unless Union or Member State law requires
storage" carve-out of GDPR Art. 28(3)(g) landing on the raw mail rather than
only on the facts. **The reconciliation this build rests on is that Mudavym
holds a MIRROR and the house's own record is the message still sitting in the
mailbox it was read from** — deleting a copy does not destroy the original. That
is a legal reading, not a certainty, and it is a founder-only question below
rather than a settled point.

**A floor is not a ceiling and the two are not mixed.** The floors above bind
the facts. The raw-mail window comes from D13 and from no statute at all,
because no statute compels a *processor* to hold a *copy* of a person's mailbox
— what the storage-limitation regimes (GDPR Art. 5(1)(e), KVKK Art. 4(2)(ç),
CCPA s.1798.100(c)) require is the opposite direction, and they are listed
separately in `STORAGE_LIMITATION_SOURCES` for exactly that reason.

### D15 — Revoking the grant deletes the raw mail, immediately, and says so first

The founder's fourth answer: *stop reads and delete the raw mail; facts stay;
the consent screen says so before the grant.*

- **Scoped to the grant, not the house.** `procurement_conversations
  .mirrored_by_grant_id` is new, because the row did not know. The reader
  published `source: "house-inbox"` and the bridge never read it, so before this
  column a revocation could only have deleted every reply in the house —
  including shared-mailbox replies that no personal grant covers, and including a
  second person's mirrored replies.
- **The body is tombstoned, not emptied.** `message_text` is `text NOT NULL` on
  the production baseline and dropping that constraint is not this change's
  business, so the sweep writes a sentence naming the date and the reason. An
  empty string would read as "the vendor sent nothing".
- **The order of operations is revoke-then-delete.** A deletion that failed
  after a revoke leaves a dead grant; a revoke that failed after a deletion
  leaves a live reader refilling what was just deleted.
- **A revocation whose deletion cannot run REFUSES.** With no retention service
  in the injector, `disconnect` throws rather than returning `{success: true}`
  for a revocation whose second half silently did not happen.
- **A count is recorded whether or not anything changed** (ADR 0078's rule).
  `house_mail_retention_sweeps` has `considered` and `deleted` as NOT NULL with
  no default, so an omitted count fails instead of reading as zero, and a sweep
  that deleted nothing still leaves a row. A table holding only the sweeps that
  deleted something would make every rate over it 1.0 by construction.
- **The consent screen prints all of it before the grant**, from the gateway
  (`GET /communications/retention/disclosure`), never composed on the page. If
  that read fails, the Continue button for a mirroring grant is **disabled** —
  because a button that still works when the retention answer could not be
  loaded is this ADR's own silence with a step in front of it.
- **The ML axis is answered by not building it.** Google's Limited Use clause
  bans cross-tenant training on the raw body however long it is kept, and the
  one lawful shape — a per-house personalization model — **is not wanted until
  the founder asks for it** (2026-09-05). Nothing here builds toward it, and
  there is no consent-screen disclosure for it, which is the honest state: a
  disclosure for a model nobody has asked for would be a promise about a feature
  that does not exist.

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
- **CLOSED 2026-09-05 (was BLOCKING) — the switch has a control.** The two
  paths below were put to the founder, who chose the first: the route is
  role-gated, the key is in the DTO, and `/settings` renders the switch
  (disabled with the reason for a non-manager). The paragraph is kept as written
  because it is the reason the key was withheld, and a reader meeting
  `3925cde6` needs it.

  ~~**The switch has no control anywhere, and deliberately did not get one.**~~
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

### From the retention half (D12-D15, 2026-09-05)

- **THE DELETION IS NOT COMPLETE, AND THAT IS STATED RATHER THAN IMPLIED.**
  `public.conversation_embeddings.message_text` is `text NOT NULL` and holds a
  second copy of a message's text beside its vector, written by
  `services/agent-orchestrator/agents/provider_conversation_agent.py:1161-1175`.
  That table carries `session_id`, `provider_id` and `restaurant_id` and **no
  `conversation_id`**, so there is no deterministic join from a mirrored
  conversation row to its embedding row and this sweep cannot reach it. A
  "deleted" mirrored reply whose text also reached that table still has its text
  in the database. Filed in `06-pages/communications.md` §9. Closing it needs
  either a `conversation_id` on that table or a rule that the Python agent never
  embeds a mirrored row, and both are outside this change.
- **Google's required Limited Use sentence is STILL not on the consent screen.**
  `messaging-senders.md` §8.1 measured its absence on 2026-09-04 and it is still
  absent: no `dataHandling` field carries "The use of information received from
  Google Workspace APIs will adhere to the Google User Data Policy, including the
  Limited Use requirements", which Google's policy requires be disclosed in the
  application. One sentence in `integrations-oauth.constants.ts`; deliberately
  not done here because it is a use disclosure and this change is a retention
  one, and quietly folding it into a retention field would hide it.
- **The CASA reassessment is annual and priced, and this ADR still does not
  own it.** `gmail.readonly` is a restricted scope, so the grant carries a
  yearly third-party security assessment (§8.2, market rate USD 540-1,500 at
  Tier 2). A shorter raw-mail window is one fewer thing an assessor scopes; it
  is not a substitute for booking one.
- **A second grant in the same house is a second scope of deletion.** Because
  the sweep keys on `mirrored_by_grant_id`, one person revoking deletes only
  what their mailbox produced. Two people consenting in one house therefore give
  the house two independently deletable halves of the same order's thread, and
  the conversation view will show one half tombstoned and the other intact. That
  is correct and it will look odd; `communications.md` §9 records it so the first
  person to see it does not file it as a bug.
- **`RetentionModule` adds a module edge from `IntegrationsModule`.** It imports
  only Database, Auth and Notifications; nothing on `AuthModule`'s require chain
  reaches `IntegrationsModule`, and only `app.module` imports that one, so no new
  ring closes. `scripts/check_gateway_boots.sh` is what proves it — tsc and jest
  cannot see a Nest injector.

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
5. ~~**Who may switch the reading on, and where does that control live?**~~
   **ANSWERED 2026-09-05: an owner or a manager, from `/settings`.** The founder
   took the first of the two paths — role-gate `PUT /settings/feature-flags` with
   `assertCanManageRestaurant` — explicitly including its reach beyond this ADR:
   the same route governs `enable_ai_autonomous_send`, which any authenticated
   member could flip until then. The second path is not foreclosed and is now a
   convenience rather than a blocker: `/connections` still has no row for the
   house-level switch beside the reading grant, so a manager who consents there
   crosses to `/settings` to finish (`06-pages/communications.md` §13.12).
6. **May the reader read a vendor who is not in the book yet?** Today it cannot,
   by construction (D9). A vendor who writes from a new address, or a prospect
   writing for the first time, reaches the shared mailbox's cold-email path and
   never the house's own. Lifting it means either an unbounded read (rejected,
   alternative 11) or a second, wider consent — and that is the founder's call,
   not a default.
7. ~~**Should reading imply a retention rule?**~~ **ANSWERED 2026-09-05, all
   four parts, and built as D12-D15.** The consent screen no longer answers the
   question with silence: it prints the split, the current figure with its
   derivation, the jurisdiction floor with its statutes and their fetch dates,
   and the revocation rule — and it refuses the grant when it cannot.
8. **Is the mirror the house's own Art. 82 record, or is the original?** New,
   and it is new because the primary Turkish text was fetched (D14). TTK 6102
   Art. 82 obliges a Turkish trader to keep the commercial letters it RECEIVED
   for ten years, and Art. 82(2) makes that all correspondence about a
   commercial matter — a vendor's reply included. This build deletes Mudavym's
   MIRROR of that letter on the D13 window and on revocation, on the reading
   that the house's Art. 82 record is the message still in the mailbox it was
   read from. That reading holds while the mailbox is reachable by the house and
   stops holding the day the person leaves. The founder may want, for a Turkish
   house specifically, either (a) the window to be at least the Art. 82 floor,
   or (b) an export of the raw mail to the house before the sweep deletes it, or
   (c) this reading kept as it is, stated on the consent screen. Nothing here
   assumes which.
9. **Should `setHouseGrantAccess(houseUses: false)` delete raw mail too?** Built
   as NO. ADR 0114's control is the house withdrawing its own use of a member's
   grant; the member has not revoked anything and the consent that produced the
   mail is still standing. Deleting on it would let a manager destroy a
   colleague's mirrored correspondence without that colleague acting. If the
   founder means the stronger version, it is one call added beside the upsert in
   `setHouseGrantAccess`.

## Superseded: the recommendation this section used to carry (2026-09-05)

Everything below was written before the founder decided, and is kept rather than
deleted because the rejected alternatives are the argument. The recommendation
itself is now **D12-D15** above; the founder took its shape and sharpened three
of its four numbers (the dispute basis, the per-house jurisdiction, and
revocation reaching the raw mail rather than only future reads).

**What the founder changed from the recommendation, and it matters:** the
recommendation derived the window from "how long a procurement conversation
stays open" and pointed at `max_rounds`. Measured, `max_rounds` is a COUNT of
three outbound rounds (`inbound-responder.service.ts:932`), not a duration — it
could not have produced a day-count at all. The founder's basis, the house's own
recorded disputes, is a real span with a real clock behind it.

## The original recommendation, as written (2026-09-05)

Full evidence, every claim carrying a URL fetched 2026-09-05, in
`.planning/07-reference/messaging-senders.md` §8. This section is the
recommendation drawn from it; the table stays there under retire-to-write
rather than being copied in twice.

**The founder's question, verbatim:** which of three keeps is best, SOTA, "for
ML purposes and training, and for privacy" — (A) kept as long as the vendor
relationship, deleted when the grant is revoked; (B) kept with the house's
records regardless of revocation; (C) a fixed window (90 days) then deleted.

### Recommendation

**The three options are one object short of the real answer, because they
treat "a vendor reply" as a single thing when it is two.** The raw mirrored
mail — body, headers, attachments, the person's mailbox it came from — is what
Google's grant is about and what a person's privacy expectation actually
reaches. The *facts* a reply carries — a quoted price, a confirmed delivery
date, a written commitment — are the house's own procurement record the
moment they are read (ADR 0118 D5's `analysis.vendor_offers`; D10's own point
that a house-mailbox reply becomes the same kind of row a shared-mailbox reply
already is), and GDPR Art. 28(3)(g) names exactly this split: deletion on
revocation is "the choice of the controller" (the house), "unless Union or
Member State law requires storage" — and for a restaurant's own commercial
correspondence, TR and UK law does (5–10 years TR, 3–6 years UK; messaging-senders.md
§8.5–8.6). None of options A, B or C survives contact with that law unmodified:
A deletes evidence the house has an independent legal duty to keep; B keeps a
person's private mail on file for years after they revoked reading it, for no
stated purpose; C's "90 days" is a number nobody derived from anything.

**So: bind the two objects to two different rules, both grounded rather than
picked.**

1. **The raw mirrored mail (body, attachments) gets a fixed, purpose-derived
   window, and is deleted immediately on revocation regardless of where that
   window sits.** Not 90 days because 90 is round — derived from how long a
   procurement conversation on this platform actually stays open (`max_rounds`
   and the order's own lifecycle already measure this; whatever that number is,
   cite it, don't invent a new one) plus a stated margin. This satisfies GDPR's
   storage-limitation test (tied to a purpose, Art. 5(1)(e)), matches the one
   comparable product with a published day-count (Zendesk's schedule, the
   closest live precedent), and gives Google's annual CASA reassessment a
   shrinking rather than growing dataset to scope.
2. **The structured facts already extracted onto the order — the price, the
   date, the commitment — persist under the house's own statutory bookkeeping
   retention, untouched by the Gmail grant's revocation,** because once written
   as the house's own structured field (not a copy of the email) they are the
   house's procurement record, not "Gmail data" in the sense Google's Limited
   Use clause or GDPR's controller-processor split reaches. This is ADR 0118
   D4's own rule (a figure goes into a letter as the engine's computed
   sentence, never scraped back out of a reply) run in the other direction: a
   figure a vendor confirms is captured as a fact at read-time, so the mail
   body's own deletion later does not delete the order's history of what was
   agreed.
3. **On the ML axis, the retention window is nearly beside the point: Google's
   Limited Use clause bans cross-tenant training on the raw body regardless of
   how long it is kept**, and the one lawful use (a per-house personalization
   model, inside the clause's own stated exception) is not built and has no
   consent-screen disclosure today — so there is currently nothing to protect
   by keeping raw mail longer, and nothing gained for "ML purposes" by choosing
   B over A or C. If a house-only model is ever built, it should train on the
   same structured facts in (2), which already outlive the window in (1) —
   never on the raw body.

**On all three axes together:** this is closer to (A) than to (B) or (C) on
the object that is actually privacy-sensitive (the mail), closer to (B) on the
object that is actually the house's record (the facts), and it uses a fixed
window only where GDPR's own test asks for one and only once that window has
an actual derivation. "SOTA" here is not one of the three named shapes; it is
naming which object each rule is a rule *for*.

### The strongest counter-argument

**Splitting raw mail from derived facts is a build the founder did not ask
for, and it can destroy the one thing a dispute actually needs.** ADR 0118 D4
extracts `analysis.vendor_offers` as a *structured* fact — a price, a
quantity — but a real disagreement with a vendor is rarely about the number
alone; it is about the exact wording ("net 30" vs "net 30 from delivery", a
qualifier in a throwaway sentence, a promise made in prose the structured
extraction was never built to capture). Deleting the raw body on a fixed
window and keeping only what the extractor chose to pull out means that six
months from now, when a vendor disputes what they actually wrote, the house
holds a paraphrase of its own making and not the evidence. Plain-(A) — keep the
whole mail, for as long as the relationship is open, full stop, no fixed
window — does not have this failure mode, at the cost of keeping a person's
private correspondence on file for the life of a vendor relationship that can
run for years. This is a real trade, not a rounding error, and it is the
argument for asking whether the extraction in D4/D5 is trusted enough to be the
system of record before building retention rules that assume it is.

### Founder-only questions — ALL FIVE ANSWERED 2026-09-05

Kept verbatim below with the answers, because a question and its answer read
together are the record; the answers are built as D12-D15.

1. **ANSWERED: yes, the split.** Two objects, two rules (D12).
2. **ANSWERED: the longest open dispute the house has recorded**, measured from
   the house's own conversations, plus a stated margin (D13). Not the order
   lifecycle: `max_rounds` turned out to be a count, not a duration.
3. **ANSWERED: jurisdiction-aware per house**, from `restaurants.country`, with
   the strictest rule and a stated sentence when no country is recorded (D14).
4. **ANSWERED: revocation reaches backward, but only into the RAW MAIL.** It
   deletes the body, headers and attachment bytes of every reply that grant
   mirrored, immediately. It does not touch `analysis.vendor_offers` or any
   other fact, because those are the house's record and not a copy of a mailbox
   (D15). This is stronger than the recommendation's "only future ones" on the
   mail and unchanged on the facts.
5. **ANSWERED: not wanted until asked for.** No per-house ML personalization
   model is built, and no consent-screen disclosure claims one (D15).

The original five, as they were asked:

1. **Is the raw-mail / derived-facts split acceptable at all**, or is a single
   retention rule wanted for the whole conversation row — accepting either A's
   evidence risk or B's privacy cost as the price of simplicity?
2. **If a fixed window is wanted for the raw mail, what is it actually derived
   from** — the order lifecycle, a stated dispute window, something else? A
   number with no stated derivation is the same "plausible default" ADR 0118
   itself names as the fault in ten other mail products' merge fields.
3. **Should the window be jurisdiction-aware per house** (TR: 5–10 years of
   statutory retention already binds the *facts*; UK: 3–6; a US house has no
   equivalent researched yet), or one deployment-wide default regardless of
   where the house operates?
4. **Does revoking the `gmail_read` grant mean "stop reading" only, or does it
   also mean "delete what you already learned from my mail"** — i.e. should
   revocation reach backward into `analysis.vendor_offers` rows already
   written from a mirrored reply, or only stop future ones? The recommendation
   above assumes only future ones; the founder may mean the stronger version.
5. **Is a per-house ML personalization model (draft-reply suggestions trained
   only on that restaurant's own mail) wanted at all?** If not, the ML axis of
   this question is currently moot on either retention choice, and today's
   answer should say so rather than build toward a use case nobody has asked
   for.
