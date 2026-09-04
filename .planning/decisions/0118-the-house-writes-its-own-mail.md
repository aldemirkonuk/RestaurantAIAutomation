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
- **Date:** 2026-09-04
- **Decider:** Aldemir (founder) — the sender rule, the send costs, the recipient
  rule, the paid tier and the staff-broadcast exclusion were all decided in
  session on 2026-09-03 / 2026-09-04. Everything else here is the build.
- **Keywords:** email composer, sender identity, gmail.send, house mailbox,
  Mudavym subdomain, paid tier, OD-23, undo window, hold-to-approve, merge
  fields, provenance, candidate_key, vendor book, provider contacts,
  COMMITMENT_PATTERNS, guardrails, template library, GmailTemplateBuilder,
  SMSTemplateBuilder, retire-to-write, absence-reported-as-health
- **Links:** [[0020-honesty-first]], [[0051-rebuilt-pages-show-live-data-only]],
  [[0083-a-page-may-not-claim-a-write-it-never-makes]],
  [[0084-the-ledger-shows-what-happened]],
  [[0112-one-modal-policy-three-shapes-one-primitive]],
  [[0114-connections-are-the-houses-profile-is-the-persons]],
  [[0042-mudavym-brand-directions]],
  `.planning/sketches/100-email-composer/`,
  `supabase/migrations/20260904150000_the_house_writes_its_own_mail.sql`,
  `apps/api-gateway/src/communications/letters/`,
  `apps/web/src/pages/communications/next/Compose/`,
  `.planning/06-pages/communications.md` §1a/§1b/§9/§13

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
