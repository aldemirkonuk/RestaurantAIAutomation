# 0121 — The house's text sender

- **Status:** **P0 and P1 are BUILT (2026-09-06). Accepted 2026-09-05 in FIVE parts
  the founder decided; the rest stays Proposed.**
  P0 is complete — the push report is three-way *and now executed by tests*, and the
  book can tell a mobile from a landline from a value nobody chose. P1 is built:
  a signed Meta Cloud API inbound webhook threading onto `procurement_conversations`,
  the 24-hour customer service window as a read, and a real dispatch that sends a
  free-form reply inside an open window and refuses outside it. **This is the first
  pass in which a message can leave**, and it leaves only for a house holding a live
  provider credential — `house_text_sender_credentials` still holds zero rows on this
  deployment, and no route writes one (see "What P0 and P1 made true" below for the
  fork that leaves open). Templates, house-initiated conversations and the SMS legs
  are untouched and still refused.
  **A sixth and seventh were accepted on 2026-09-05/06** and are written up in
  the founder-answer sections at the foot of this document: (6) WhatsApp is
  **bring-your-own billing** — a Tech Provider has no credit line, so each house
  attaches its own card to its own WABA and Mudavym bills only the platform;
  (7) the credit purchase **charges the card on file, sealed**, before the credit
  is written, and the first message allowance is set on **one named house** by a
  founder-run script rather than fleet-wide. Taking money required narrowing
  `StripeClient`'s money-resource deny-list to exactly one door, which the guard's
  own refusal text named as a decision rather than a refactor.
  Parts 4 and 5 were added later the same day and are written up in
  "Who pays for a message" below: (4) the **standing** — Mudavym registers directly
  with Meta as a **Tech Provider** and with Twilio as an **ISV**, rejecting Twilio
  for both legs and rejecting Twilio-first-then-migrate; (5) the **billing model** —
  a monthly allowance per plan set from measured usage after a quarter, then either
  Mudavym credits at provider cost plus a stated platform fee, or the house's own
  provider account with Mudavym billing only the platform. **Nothing sends because
  of either.** OD-23 is answered on its message-billing half only and is NOT struck.
  Accepted: (1) *"a crew text exists and build it next"* — founder question 1 is
  answered yes, and P0's honesty work shipped with it; (2) the first market is
  **both** — Türkiye WhatsApp-first and the US on SMS, which closes founder
  question 2 on the *market* and leaves its Türkiye-usage sub-question open; (3)
  **both** ways of getting a number are built as states — the house brings its
  own name, or Mudavym registers per house and bills with the information the
  registrar needs (founder question 3, OD-23, is *narrowed*, not closed: who
  pays is still open). Still Proposed: the WhatsApp transport itself, the
  inbound webhook, templates behind the seal, the hand-off, and founder
  questions 4, 5 and 6. **Nothing sends because of this pass** — see
  "What shipped on 2026-09-05" below, which says exactly what does and does not
  exist.
- **Date:** 2026-09-04 (research); 2026-09-05 (the three decisions above)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** SMS, text sender, WhatsApp, Cloud API, 10DLC, TCR, brand, campaign,
  toll-free verification, alphanumeric sender ID, İYS, KVKK, PECR, TCPA, quiet hours,
  STOP, HELP, opt-out, RCS, Apple Messages for Business, Signal, expo-sms, Plivo,
  per-person phone, hand-off, book-only recipients, commitment guard, seal, OD-23,
  absence-reported-as-health
- **Links:** [[0084-the-communications-gateway-says-what-it-did]] (deleted the raw SMS
  route and the fabricated carrier id), [[0114-connections-are-the-houses-profile-is-the-persons]]
  (house declares, person consents — the model a text sender has to fit),
  [[0118-the-house-writes-its-own-mail]] (the letter half; this answers its founder
  question 2), [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]],
  [[0083-a-page-may-not-claim-a-write-it-never-makes]],
  [[0088-a-team-change-is-recorded-and-a-wage-is-not-invented]],
  `.planning/07-reference/messaging-senders.md` (the survey and every URL),
  `.planning/06-pages/communications.md` §13, `.planning/06-pages/team.md` §13.7c

## Context

Two founder lines on 2026-09-04, hours apart, both verbatim.

On the team broadcast:

> *"as long as the 3rd party connections are well built, remove sms too until the
> house has its own sender. This also means maybe for each individual having their
> phone connected helps us use their connection to message and use freely."*

On the composer:

> *"No letters only, however, we def need a sms sender, and text mesg sender since
> most conversations might just go with text"*

They are not in conflict. Both say the same thing from two directions: **a text
is wanted, and a shared sender is not the way to get it.** The second line does
settle ADR 0118's open founder question 2 ("May the composer send SMS?") in the
affirmative, and ADR 0118's own "letters only" framing is superseded by it. What
is *not* settled is which text — and that turns out to be four different products
with four different owners, four different consent regimes and four different
records.

### What exists

The SMS sender in this repo is **Plivo, not Twilio**
(`apps/api-gateway/src/communications/sms.service.ts:30-33`), and it is **one
number for the entire deployment**: `PLIVO_PHONE_NUMBER` read from env, with no
per-restaurant column anywhere. That is exactly the shape ADR 0118 D1 refused for
mail, one layer over. ADR 0084 already deleted `POST /communications/sms`
(unguarded, untraceable, zero callers) and stopped `sms.service.ts` returning a
fabricated `messageId` for a message nobody sent. `gateway-honesty.spec.ts:328`
asserts as a **test** that no inbound SMS handler exists, so adding one turns the
suite red on purpose.

The crew broadcast was rebuilt on 2026-09-04: the email leg is gone, the SMS leg
is gone, `NO_SENDER = ["email","sms"]` refuses both however a caller asks
(`team/team.controller.ts:432-436`), and what was withheld is *counted and
reported* under `withheldByProduct` rather than silently dropped.

### What the numbers say, measured against production `exzueerziesmczwlhomd` on 2026-09-04

| Query | Result |
|---|---|
| `providers` with a phone and **no** email | **0** of 21 |
| `providers` with a phone at all | 4 of 21 (all 4 also have an email) |
| `provider_contacts` | 3 rows, 2 with a phone |
| `team_members` carrying a phone | **0** of 11 |
| `users.phone` | 3 of 11 |
| `notification_preferences.sms_enabled` true | **0** of 3 rows |
| `mobile_devices` (push tokens) | **0 rows** |

Four things follow, and they are the spine of this document.

1. **No vendor in this deployment is reachable only by phone.** Removing SMS from
   the vendor path costs zero conversations today.
2. **No crew member has a phone number on file.** Removing SMS from the crew path
   costs zero messages today.
3. **Every person who has ever expressed a channel preference has SMS off.** The
   demand for a text is the founder's, from the market he expects; it is not
   visible in this deployment's data.
4. **Push, the only outbound crew channel left, reaches nobody**, and the
   broadcast route does not say so. `ExpoPushService.sendToUsers` returns
   silently when the token read is empty *or* fails
   (`push/expo-push.service.ts:83`, `if (error || !data?.length) return;`) while
   the route reports `notified: pushIds.length` counted off the roster
   (`team.controller.ts:521,527`). A broadcast to the 11-person crew today
   reports **notified: 11** and delivers **0**. That is
   [[absence-reported-as-health]] in the exact place this ADR is about, and it
   means "do nothing until a house has a sender" is not currently a safe state.

### The two markets are not the same problem

From the survey (`07-reference/messaging-senders.md` §2c, Twilio's Türkiye
guidelines fetched 2026-09-04): **two-way SMS is not supported in Türkiye.** An
inbound reply cannot come back. Sender ID registration is required and, from
2026-11-18, unregistered sender IDs are blocked; from 2026-04-01 a company
without a local Turkish entity may not put a URL in a message.

So in the market where "most conversations might just go with text" is most
likely to be true, **SMS cannot carry a conversation at all.** It can carry a
notice. Whatever answers the founder's line in Türkiye, it is not SMS.

---

## The fork, as a graph

Four branches. Each is scored on five axes the founder actually cares about:
what it costs, what the house owns, what the record looks like, which of the
letter's guardrails survive, and what is rejected inside it.

### (a) A house number from an SMS provider

Twilio, Vonage, Telnyx, Sinch, Bird. Full fee and rate table in
`07-reference/messaging-senders.md` §2. This branch immediately forks three ways
on *whose* brand the number registers under.

**a1 — one Mudavym brand, one campaign, one shared number.** What exists today.

**a2 — one Mudavym brand, one campaign per house.**

**a3 — one brand per house, registered against the house's own tax ID.**

**Cost.** US 10DLC: brand $4 (Low-Volume Standard) or $44 (Standard), campaign
vetting $15 once, then $1.50–$10 per campaign per month plus $1.15/month for the
number; messages $0.0083 out and in plus $0.0025–$0.007 carrier pass-through.
Registration is "several days or even several weeks". UK needs no
pre-registration unless the sender ID is protected, but costs about **six times
US per message** ($0.050 at Bird's published rate). Türkiye needs sender ID
registration, about two weeks, at $0.0275–$0.0305. Order of magnitude for one
house: **$36–$135 a year in fixed fees before a single message**, and the fixed
fee recurs per house.

**What the house owns.** In a1, nothing — the number is Mudavym's. In a3, the
number and the brand are genuinely the house's, at the price of the house handing
over a tax ID to switch on a text box. a2 is the interesting middle and the one
that fails hardest, see below.

**The record.** A text is a `procurement_conversations` row like a letter, with
`direction`, the body in `message_text`, and the provider's message id. The
inbound leg is the new object: a reply arrives at a webhook, not in a mailbox,
and it has to be threaded onto the same conversation the outbound left from. That
is a route this repo has deliberately never had, and a test currently asserts its
absence (`gateway-honesty.spec.ts:328`) — building it means *replacing* that
assertion with a guarded route, not deleting it.

**Guardrails, against ADR 0118's letter set.**

| Guard | Transfers to a text? |
|---|---|
| Book-only recipients | Yes, over `providers.contact_phone` and `provider_contacts.phone` — which today reach **4 vendors and 0 crew** |
| Commitment language, blocking | Yes, and it matters more: a text is short and reads as casual, which is precisely when a person types "yes, send them" |
| Round count as a stated fact | Yes, same rows, same counter |
| Unresolved merge token | Yes, unchanged |
| The 2-minute undo | **Degrades.** A letter sits in an inbox; a text is read in seconds. The undo window buys much less and the cost of a wrong send is higher, so a text wants the seal *up front* rather than an undo *after* |
| The seal on a shared sending identity | Yes, and it becomes mandatory rather than optional: a shared sending **number** is the same shared-reputation object as a shared sending domain |
| Provenance chips | **Does not transfer.** 160 characters cannot carry a chip. This is the reason a text must carry the engine's sentence and never a figure the reader cannot trace |

**New guards a text needs that a letter does not.**

- **STOP and HELP, per sender.** 47 CFR 64.1200(a)(10) makes any reasonable
  revocation valid, expressly including a reply of "stop", "quit", "end",
  "revoke", "opt out", "cancel", "unsubscribe", to be honoured "within a
  reasonable time not to exceed ten business days", recorded on a do-not-call
  list (d)(3) and honoured for **five years** (d)(6), with a written policy
  available on demand (d)(1). The UK's PECR reg 22 requires a simple means of
  refusal in *every* message.
- **Quiet hours.** 47 CFR 64.1200(c)(1): nothing before 8 a.m. or after 9 p.m.
  local time at the called party's location. A restaurant's working day ends
  after 9 p.m., which means the one time a manager most wants to text a vendor is
  the one time the rule forbids.
- **Consent of record.** Türkiye requires prior consent registered in İYS under
  Law 6563, on top of KVKK. The primary texts could not be fetched
  (`messaging-senders.md` §7) and this row is the weakest citation in the
  document.

**Rejected inside this branch.**

- **a1, the shared number, is refused outright.** It is ADR 0118's alternative 1
  wearing a phone: the envelope says Mudavym whatever the signature says. It is
  worse than the mail case in one specific way that has no email analogue —
  **STOP is global.** A person who replies STOP to the shared number is opted out
  of *every restaurant on the deployment*, for five years, and no house can undo
  another house's opt-out. One annoyed line cook silences the platform.
- **a2, per-house campaigns under one Mudavym brand, is refused on three
  measured grounds.** The Campaign Registry caps a brand at **100 campaigns**
  (Twilio error 30930), which is a hard ceiling on houses. T-Mobile levies a
  **$1,000** pass-through fee for "snowshoeing, or unauthorized number
  replacement/recycling" — and many campaigns under one brand with rotating
  numbers is the literal description of snowshoeing. And after a warning,
  **$10,000 per unique content violation** lands on the brand, which is Mudavym's,
  for a sentence a manager typed.
- **a3 is not refused, it is deferred.** It is the right end state and the wrong
  first step: weeks of registration and a tax ID demanded before a house can see
  the feature work once.
- **SMS in Türkiye is refused for conversation.** No inbound leg exists. A
  Türkiye SMS can be a notice; it cannot be a thread, and a product that threads
  a reply it can never receive would be claiming a capability it does not have.

### (b) WhatsApp Business Platform (Cloud API)

**Cost.** Billing became **per-message on 2025-07-01**. Free-form (non-template)
messages sent inside an open **24-hour customer service window are free**;
**service** templates have been free for all businesses since 2024-11-01; utility
and authentication templates are free inside an open window and charged outside
it; marketing templates are charged on every delivery. Routed through Twilio,
Twilio adds **$0.005 per message** in both directions. Meta's rate card is
per-country and per-category; it was not transcribed here (`messaging-senders.md`
§7 says why).

**The shape of that pricing is the finding.** Mudavym's traffic is reply-shaped —
a vendor writes, the house answers, the house answers again. Every message in
that pattern is free-form inside an open window, and therefore **free**. The
charge lands only where the house *starts* a conversation, and only through a
template Meta approved.

**Requirements.** A phone number **not already active on the WhatsApp or WhatsApp
Business app** (one that is "cannot be registered unless they are deleted first"),
verified by SMS or voice — a landline is eligible, with voice OTP standard and
SMS OTP "Not Recommended". A display name that passes review (`APPROVED`,
`PENDING_REVIEW`, `DECLINED`, `AVAILABLE_WITHOUT_REVIEW`). Opt-in is a policy
requirement, not only a legal one: "You may only contact people on WhatsApp if:
(a) they have given you their mobile phone number; and (b) you have received
opt-in permission from the recipient confirming that they wish to receive
subsequent messages or calls from you."

**Do the people use it.** Türkiye: reported **88.6%** of individuals, ahead of
YouTube and Instagram (TurkStat 2025 — reported, primary page did not render).
UK: reported **90%** reach among online adults (Ofcom Online Nation 2025 — 403 to
the fetcher). US: **32%** of adults, up from 23% in 2021 (Pew, 5,022 adults,
Feb–Jun 2025 — fetched from source). The three figures are in descending order of
citation quality and the *strongest claim rests on the weakest citation*, which is
stated here rather than smoothed over.

**How it maps to ADR 0114.** Cleanly, and that is the strongest structural
argument for it. The WhatsApp number is a **house-declared connection**, exactly
like the till or a model-context server: declared by a manager, owned by the
restaurant, surviving that manager's departure (`declared_by … ON DELETE SET
NULL`). Each person the house messages **consents**, withdrawably, and the
withdrawal is a row — which is also what Meta's own opt-in rule requires. The
template-approval gate is the seal one layer out: an outbound the house did not
pre-clear cannot leave.

**What the house owns, and does not.** The number, the display name and the
opt-ins. **Not the transport.** Meta may "review, approve, pause and reject any
Message Template at any time." That is the hinge of the counter-argument below.

**The record.** Same `procurement_conversations` row; the inbound webhook threads
on the WhatsApp message id. The 24-hour window becomes a *state the surface must
show*, because whether the next message is free-form or must be a template is not
a detail — it changes what the manager may write.

**Rejected inside this branch.** Using the WhatsApp Business **app** (the phone
app) instead of the Platform: the policy explicitly restricts what may be sent
through it, and it is a human at a handset, not a system of record.

### (c) Per-person phone connections

The founder's line: *"for each individual having their phone connected helps us
use their connection to message and use freely."* Read literally, this is asking
whether a person's own phone can become the house's sender. Every path was
checked and **all of them are closed by the platform's own terms**, with one
narrow survivor.

| Path | Verdict | The rule |
|---|---|---|
| iOS, app sends the SMS | Closed by the platform | the OS opens the composer and the person presses send; `expo-sms` reports only `sent` / `cancelled` / `unknown` and "we do not check actual content of message nor recipients list" |
| Android, app sends the SMS | Closed by Play policy | the SMS permission group is for apps "actively registered as the default handler"; non-qualifying apps "may be removed from Google Play". Mudavym is not a messaging app and will not become the user's default SMS handler |
| WhatsApp linked device / personal account automation | Closed by the ToS | prohibits "any non-personal use of our Services unless otherwise authorized by us" and "sending illegal or impermissible communications such as bulk messaging, auto-messaging, auto-dialing, and the like" |
| Apple Messages for Business | Not a personal channel | a brand channel: an MSP must be selected before registration, and "Only official brand owners qualify" |
| RCS Business Messaging | Partner-gated | sending requires becoming an RCS for Business partner through an interest form; there is no self-serve path |
| Signal | No business product | its terms prohibit "bulk messaging, auto-messaging, and auto-dialing"; no API or organisational product appears in them |

**The survivor: a hand-off, not a send.** The app can prepare the message and
open the person's own composer with it prefilled; the person presses send. This
is the only terms-clean reading of "use their connection", and it is a
*different kind of event* from everything else in this document. The house did
not send it. The record must say so, in those words: the row is
`HANDED_TO_PERSON`, with who it was handed to and when, and **never** a delivery.
`expo-sms` returns `unknown` on Android in all cases, so on Android the product
cannot even claim the composer opened successfully — which makes writing
"delivered" a fabrication of exactly the kind ADR 0084 removed from
`mockSendSms`.

**The privacy line, stated plainly.** A person's own number as the house's sender
is a **consent the person can withdraw**, and the messages sent through it are
**the house's record**. Those two facts pull opposite ways and the resolution has
to be written down before anything is built: when a line cook leaves, the house
keeps the record of what was said and loses the ability to say anything more
through that number, and the cook's number must disappear from every surface the
house can read. Under ADR 0114 that is already the shape — the *attachment* is
the house's, the *credential and the consent* are the person's — so the model
exists; only the phone-shaped instance of it does not.

`apps/mobile` cannot do any of this today: SDK 54 with `expo-notifications` and
`expo-camera` declared, **no `expo-sms`, no `expo-contacts`**, and the only
platform call in the app is `Linking.openURL` to web routes.

### (d) Nothing, until a house sender exists

**What it costs today, measured, not estimated: nothing.** Zero vendors are
phone-only, zero crew members have a phone on file, and zero of the three people
with a stated preference want SMS. The channel that is switched off is reaching
nobody, which is why it could be switched off in a morning without a single
complaint.

**But doing nothing is not currently free, for a different reason.** The
no-sender state *misreports itself*. A crew broadcast returns `notified: 11`
while `mobile_devices` holds 0 rows and `sendToUsers` returns silently on both an
empty read and a failed one. So the honest version of (d) is not "do nothing" —
it is **"do the reporting, and then nothing"**, and that is a real piece of work
with a real deadline: every day it is not done, the product tells a manager it
reached a crew it did not reach.

---

## Decision (proposed — the founder's to take)

**The house's text sender is a WhatsApp number the house declares, not an SMS
number Mudavym rents; SMS follows only where WhatsApp does not reach and only
under the house's own brand; a person's own phone is a hand-off and never a
sender.**

Four phases, each with a gate that is a measurement rather than a date.

### P0 — Make the silence honest (no sender, no new dependency)

1. `broadcast` reports what push actually did: separate "no device registered"
   from "the token read failed" from "delivered to the service", and never count
   a roster entry as notified. This is the same three-way split
   `withheldByProduct` / `withheldByCaller` / `suppressed` already makes for the
   removed channels, extended to the one channel that is still on.
2. The book learns to hold a **mobile** number. `provider_contacts.phone_type`
   already exists and defaults to `'main_line'`; nothing sets it. A text sender
   that cannot tell a landline from a mobile will text a landline.
3. Nothing sends. **Gate to P1:** a house asks for it, or a market is chosen.

### P1 — WhatsApp as a declared connection, reply-shaped only

The house declares its WhatsApp number in `/connections` under ADR 0114's model:
the attachment is the restaurant's, the consent is each person's, and a
manager may stop the house using it. Inbound webhook threads onto
`procurement_conversations`; outbound is **free-form inside an open 24-hour
window only** — no templates, so no house-initiated conversations and no Meta
charge. The composer's existing guards run unchanged: book-only recipients,
commitment-language block, round count, unresolved merge token.

**The mirror is a precondition, not a follow-up.** Every inbound and every
outbound is written to `procurement_conversations` before it is rendered
anywhere. Meta holds the transport; the house's book holds the record. Without
this, P1 must not ship — see the counter-argument.

### P2 — House-initiated messages, behind the seal

Approved templates, which is Meta's own gate, plus the house's: the seal on
every template send, because a template is the only outbound that can arrive
unprompted, and it is charged.

### P3 — SMS, per house, only where it is needed

Only for a market or a counterparty WhatsApp does not reach — realistically the
US crew. **One brand per house** (a3), never a Mudavym brand with per-house
campaigns (a2), never a shared number (a1). STOP/HELP, quiet hours and the
five-year do-not-call list are built with the first message, not after it.
**Never in Türkiye for conversation**, because there is no inbound leg to thread.

### The hand-off, in parallel and independent

`expo-sms` in the mobile app, a prefilled composer, and a row that says
`HANDED_TO_PERSON` with who and when. It is not a send and the record never calls
it one. On Android the product cannot know more than "the composer opened", so it
says exactly that.

---

## The registration playbook, per path, per market (added 2026-09-05)

The founder's question, verbatim: *"can the house sends on their behalf?
whatsapp business api? or sms sender? what do we need there"*. This section is
the answer as a checklist a house could actually work through. Every fetch is
dated **2026-09-05** unless a row says otherwise, and the rows that rest on a
summary rather than a primary source say so in the row rather than in a
footnote.

### The one rule that shapes both paths

**The identity registered is always the HOUSE's, in both paths.** "Mudavym
registers for you" means Mudavym operates the submission; it never means
Mudavym's name goes on the sender. Three independent rules force this and they
are not negotiable by product design:

- A regulatory bundle "must represent the actual end-user", and "Twilio audits
  this" (`twilio-regulatory-compliance-bundles`, 2026-09-05).
- An ISV registering Sender IDs "must provide your customers' business and
  representative information, including a government ID for verification", and
  each Sender ID needs its own registration (Twilio Sender ID registration
  guidance, 2026-09-05).
- Sharing one brand's campaigns across customers "violates carrier policies";
  the ISV pattern is one subaccount and one brand per customer (Twilio ISV
  onboarding, 2026-09-05). This is the same conclusion §a2 above reached from
  the fee schedule, arrived at independently from the provider's own
  architecture guidance.

So the two paths differ in **who does the typing and who holds the account**,
never in whose business is on the registration.

### WhatsApp Business (Cloud API)

| | Bring your own | Mudavym registers |
|---|---|---|
| How the credential arrives | Meta's **Embedded Signup**: the house signs in to its own Meta account in Meta's window and, on success, the flow "returns the customer's WABA ID, business phone number ID, and an exchangeable token code" | The same Embedded Signup, operated by Mudavym as a **Tech Provider** against the house's own business portfolio |
| What this platform never sees | The house's Meta password. There is no field for one anywhere (`text-senders.dto.ts`, asserted by a test) | Same |
| Prerequisite on Mudavym | None | Meta **App Review** for advanced access: "You will not be able to onboard business customers until your app has been approved for advanced access", with `whatsapp_business_management` and `whatsapp_business_messaging` |
| What the house provides | A phone number **not already active on WhatsApp**; a Meta business portfolio; a display name that passes Meta's review; an opt-in from every person it messages | Same, plus the business documents Meta Business Verification asks for |
| Cost | Non-template replies inside an open 24-hour window are **free** ("All non-template messages are free"). Templates are charged per delivery at Meta's per-country rate | Same |
| Time | Sender registration in minutes; **Meta Business Verification "can take several weeks"** | Same |
| The cap while unverified | "Newly created business portfolios have a messaging limit of 250" per 24 hours, and verification is one of three ways to raise it to 2,000 | Same |

**Two caps nobody had measured before this pass, and both bite the
"Mudavym registers" path specifically.** Meta business accounts "are initially
limited to 2 registered business phone numbers, but this limit can be increased
to up to 20" (Meta's own WABA overview), and Twilio's guidance states the same
ceiling with an exception path to 50. If every house's number sat under one
Mudavym portfolio, **20 houses would be the ceiling** — the same structural
failure as §a2's 100-campaign TCR cap, one platform over. It is avoided the same
way: the WABA is the house's, not Mudavym's.

**A third, quieter one:** "all senders on the same Twilio account must share one
WABA" in the self-signup flow (Twilio, 2026-09-05). A multi-tenant deployment
therefore cannot use self-signup for its houses at all; the Tech Provider path
is not an optimisation, it is the only shape that works.

### SMS, United States (10DLC)

What the house provides, and every item is a rejection if it is wrong:

1. The **legal business name exactly as it appears on EIN records**. A marketing
   name is the most common brand rejection.
2. EIN or business tax id, business type, registered address.
3. A **live, publicly reachable** website. A staging URL or a 404 fails, because
   a reviewer opens it.
4. A named contact: first name, last name, corporate email, phone.
5. A campaign use case and **at least two sample messages that match it**, each
   carrying an opt-out line.
6. The **opt-in flow in 40–2049 characters**, naming the method, the message
   frequency, the "message and data rates may apply" disclosure, and a
   **publicly accessible** link or screenshot of the opt-in itself. This field is
   "the #1 reason campaigns get rejected".
7. A privacy policy stating mobile information is **not** shared with third
   parties for marketing, and terms carrying **HELP and STOP instructions in
   bold**.

**Fees** (Twilio's A2P 10DLC page, 2026-09-05): $44 one-time brand registration
(Standard), $4 (Low-Volume Standard or Sole Proprietor); $15 one-time campaign
vetting; then $1.50–$10 per campaign per month ($2 Sole Proprietor), plus the
number's own rental. The recurring part is **per house** and does not amortise.

**Time:** 13–20 business days end to end — brand in minutes to 3–5 business
days, campaign in 10–15. This *corrects* the 2026-09-04 draft's "several days or
even several weeks", which was Twilio's own sole-proprietor-transition wording
and is vaguer than its ISV onboarding guidance. Nothing sends before the
campaign is approved: unregistered traffic is blocked with error 30034.

**One consent rule that binds this product's design, not just its paperwork:**
"Consent must be voluntary. If customers must opt in to messaging to complete a
purchase or create an account, the registration **will be rejected**." A crew
text consent therefore may never be a condition of joining a roster or holding
an account — which is why `person_text_consents` is a separate, withdrawable row
and not a column on `team_members`.

**And one that binds the shared number specifically:** Twilio's US SMS
guidelines list **"shared phone numbers"** among the restricted use cases. The
shared-Plivo shape this ADR refused on STOP-scope grounds is independently a
listed prohibition at the carrier layer.

### SMS, Türkiye (alphanumeric Sender ID)

This is **paperwork, not an API call**, and that is the finding. What the
operators require (Twilio's Türkiye Sender ID article, 2026-09-05):

- A **company or brand registration certificate**.
- A **Letter of Authorization** to the provider, a separate **authorization
  letter**, and an **NOC letter** — each on the **house's own letterhead**,
  signed by an authorized signatory, and **stamped**.
- If the Sender ID does not match the company name, a formal document —
  a trademark registration or an official website — showing the linkage.

Required fields on the forms: the sender company's letterhead, the Sender ID
requested, the legal company name, the name and title of the authorized
signatory, the signature, the company stamp, and the date.

Refusals, stated before a house applies: promotional traffic is not allowed; a
Sender ID resembling a domain name is not allowed; P2P, gambling, political and
religious content is prohibited; from **2026-04-01** a company without a local
Turkish entity may not put a URL in a message; from **2026-11-18** unregistered
Sender IDs are **blocked**. Provisioning takes about two weeks.

**And the capability, which is the reason Türkiye is WhatsApp-first:**
"Two-way SMS supported: **No**". An alphanumeric Sender ID is one-way by
construction everywhere — "recipients cannot reply" — so a Turkish SMS sender
can carry a notice and can never carry the conversation the founder's line
("most conversations might just go with text") is about.

**İYS remains the weakest citation in this document.** Prior consent for
commercial electronic messages must be registered in İYS under Law 6563, and
İYS's own pages are client-rendered and could not be fetched on 2026-09-04 or on
2026-09-05. This row rests on a summary and should be closed before a Turkish
sender goes live.

---

## What shipped on 2026-09-05, and what did not

**Shipped.**

- `house_text_senders` — the house's sender in ADR 0114's shape: the attachment
  is the restaurant's (`declared_by … ON DELETE SET NULL`), six states with no
  default, both paths as stated states, the fee and the timeline **kept as
  sentences** so a house can read back what it was told, and a `vault_secret_ref`
  that points at the encrypted record rather than holding a credential.
- `person_text_consents` — the person's consent, withdrawable, with **no
  approval axis at any layer**: the migration raises if `approved_at` /
  `approval_status` / `pending` / `approved_by` ever appears. Withdrawal is a
  timestamp and never a delete, because 47 CFR 64.1200(d)(3) and (d)(6) require
  the request to be recorded and honoured for five years.
- `team_note_deliveries` — **one row per recipient per channel, written whether
  or not anything was delivered.** This is P0's real content: `broadcast`
  reported `notified: 11` off the roster while `mobile_devices` held 0 rows.
  `ExpoPushService.sendToUsers` now returns its outcome and the route reports
  **devices handed to**, not people counted; `accepted_by_service` is kept
  distinct from `delivered`, and `read_failed` from `no_device_registered`.
- `TextSenderService` — one door, which chooses WhatsApp over SMS where both
  exist (because a Turkish SMS cannot receive a reply), and **refuses every
  time**, naming which half is missing. `SmsService` and `PLIVO_*` are
  unreachable from it, asserted structurally rather than behaviourally.
- The surfaces: two rows on `/connections` with both paths offered and both
  disabled carrying the server's own reason; the crew-text leg on `/team`'s
  composer in its three states; the person's consent on `/profile`'s
  Register IV rather than a seventh register.

**Not built, and the pages say so rather than implying it.**

- **No transport.** No provider credential for a per-house sender exists on this
  deployment, so `send()` returns `transport_not_built` even for a house with a
  connected sender and a consenting person. A connected row is a record of a
  registration, not a wired client, and sending on the strength of a row
  somebody typed would be trusting a claim instead of a transport.
- **No submission.** `POST /communications/text-senders/request` **records** a
  request with its fee and timeline. There is no route that moves a row to
  `submitted`, because submitting puts the house's legal identity in front of a
  registrar and that is a sealed act. The seal is therefore **satisfied
  vacuously in this pass** — nothing can submit — and that is stated here rather
  than left to read as "the seal is enforced".
- **No probe.** `last_probe_at` is `NULL` on every row and the surface says
  "never probed", which is not "unreachable" and is certainly not health.
- **No inbound.** `gateway-honesty.spec.ts:328` still asserts no inbound message
  handler exists, and it still passes. When the transport lands, that assertion
  is *replaced* by one requiring a guarded, tenant-scoped handler — never
  deleted.

---

## The strongest argument against this recommendation

Written as an adversarial pass, not as a caveat.

**WhatsApp-first makes Meta the custodian of the house's vendor conversations,
and Meta can withdraw that custody without notice or appeal.** The policy that
this ADR quotes approvingly — "WhatsApp reserves the right to review, approve,
pause and reject any Message Template at any time" — is the same sentence read
from the house's side: a restaurant whose supplier thread lives on WhatsApp and
whose number is paused has lost its supplier thread. An SMS number costing $135 a
year has a carrier relationship with a support path and a regulator behind it; a
WhatsApp number has a policy team. Measured against the actual downside — a house
in the middle of a delivery dispute, silent — the cheaper channel is the more
fragile one, and "it is free inside the window" is a weak reason to accept that.

There is a second, sharper version. This ADR's central market claim — that
Türkiye is a WhatsApp country and therefore SMS is the wrong first build — rests
on a figure this session **could not fetch from its source**. TurkStat's bulletin
did not render; Ofcom returned 403. The only WhatsApp-usage number fetched from
its primary source is the US one, and it is **32%**. A recommendation whose
strongest evidence is its weakest citation is not a recommendation that should be
locked without the founder confirming the market from what he knows.

**What survives that attack, and why the recommendation still stands.** The
custody objection is answered by making the mirror a precondition rather than a
feature: if every message is written into `procurement_conversations` as it
happens, Meta holds the transport and never the record, and a paused number costs
the house its next message rather than its history. That is why P1 above says the
mirror ships first and P1 does not ship without it. The citation objection is not
answered here at all — it is question 2 below, and it is the founder's.

---

## Alternatives rejected

1. **Restore the shared Plivo number with better copy on the page.** The cheapest
   thing that looks like progress. Refused: STOP on a shared number is global and
   irreversible for five years (47 CFR 64.1200(d)(6)), a content violation bills
   Mudavym $10,000 for a sentence a manager typed, and the number a vendor sees is
   not the house's. It is ADR 0118's rejected alternative 1 with a phone number
   instead of a From header.
2. **One Mudavym 10DLC brand with a campaign per house.** Structurally the
   neatest, and it fails on three independently fatal measured limits: the
   100-campaign brand cap, the $1,000 snowshoeing fee for exactly this pattern,
   and shared liability for every house's content.
3. **Per-house 10DLC as the first build.** Correct end state, wrong first step:
   several days to several weeks of registration and a tax ID demanded before a
   house can see the feature work once.
4. **SMS for Türkiye conversations.** Refused on the operator's own rule: two-way
   SMS is not supported there. A threading UI over a channel that cannot receive
   is a claimed capability.
5. **A free-text SMS composer** (ADR 0118 founder question 2, read maximally).
   Refused in that form: it re-opens precisely what ADR 0084 closed — an
   unguarded, unrecorded send to any number on earth. The founder's line is
   honoured by a *guarded* text composer, book-only, not by a text box.
6. **A person's own WhatsApp, or an Android SMS-gateway build.** Refused on the
   platforms' terms, quoted above. Not a risk assessment: a rule.
7. **RCS or Apple Messages for Business as the first channel.** Both are brand
   channels behind partner or MSP gates with no self-serve path, so neither can
   be the thing a small house switches on.
8. **Doing nothing, unqualified.** Refused — not because it costs sends (it costs
   zero, measured) but because the current no-sender state reports reach it does
   not have. (d) is only honest after P0.
9. **A `house_texts` table.** Same reason ADR 0118 rejected `house_letters`: a
   text is a conversation row, and a second table makes it invisible to the
   ledger, the round count and the page.

---

## Consequences

- **ADR 0118's founder question 2 is answered and closes**: the composer will
  send texts. Its "letters only" framing is superseded by the founder's line of
  2026-09-04; its guardrail set survives intact and gains three (STOP/HELP,
  quiet hours, the window state).
- **ADR 0084's inbound-SMS assertion becomes a build item, not a permanent
  rule.** `gateway-honesty.spec.ts:328` currently fails if any inbound message
  handler appears. When P1 lands, that assertion is *replaced* by one that
  requires the handler to be guarded and tenant-scoped — never deleted, because
  an unguarded inbound webhook is the same hole ADR 0084 closed on the outbound
  side.
- **`/team` gains nothing in P0 except honesty**, and the SMS leg does not come
  back with P1. A WhatsApp sender is a vendor-book channel first; whether a crew
  text exists at all is founder question 1.
- **A migration will be needed** eventually and is not designed here: a per-house
  sender record (channel, identity, state, who declared it), and the do-not-call
  list, which is a five-year legal retention obligation and therefore its own
  table with its own deletion rules.
- **Given up for now:** any text at all. P0 ships no send. The measured cost of
  that is zero conversations and zero messages, and it will stop being zero the
  first time a house records a mobile number.
- **Revisit if** a house records a vendor mobile with no email, a crew member
  records a phone, or a market is chosen. Those are the three signals; a date is
  not one.

---

---

## Who pays for a message — the standing, and the billing model (added 2026-09-05)

The founder's two decisions of 2026-09-05, verbatim in intent and quoted where
they were quoted.

### The standing

> **Mudavym registers directly with Meta as a Tech Provider** — the houses' own
> WhatsApp Business Accounts sit under Mudavym's app, with no per-message
> middleman — **and with Twilio as an ISV for SMS**: hosted SMS for a house's own
> number, or a number bought per house.

**Rejected, and why each was rejected.**

1. **Twilio for both legs.** A perpetual markup on every WhatsApp message
   (Twilio adds $0.005 per message in each direction) and, worse structurally,
   a **WABA bound to Twilio** — Twilio's own guidance is that "all senders on the
   same Twilio account must share one WABA" in the self-signup flow, which a
   multi-tenant deployment cannot use at all.
2. **Twilio first, migrate to Meta later.** Two builds of the WhatsApp leg, and
   the migration is the expensive half: asset migration between partners is a
   documented but manual Meta process, per house.

### Who pays (OD-23's message-billing half, answered)

> Each plan includes a **monthly message allowance**, set from **measured usage
> after one quarter**, generous at first. Past it, the house either **buys
> Mudavym credits** — provider cost passed through plus a stated platform fee,
> with the meter visible — or **connects its own Twilio / Meta account** and pays
> them directly while Mudavym bills only the platform.

**Rejected:** allowance + credits only (it forces a house with its own provider
relationship to buy through us); and pass-through from the first message (it puts
a meter in front of a manager on day one, for a channel they have not yet chosen
to use).

**The founder's worry, to design against, in his words:** a manager who says
*"I'll just use my own phone"*. Price is not what keeps them in — coverage and
convenience are. That is why the refusal sentence names both ways to continue
rather than only the one that bills us, and why the allowance is generous at
first rather than tight.

### What the build makes true

- `plan_message_allowances` — **ships EMPTY, by that decision.** The number comes
  from a quarter of measurement that has not happened, so every house today reads
  **"no allowance stated"**, and *an unstated allowance does not refuse.* It
  cannot, honestly. `monthly_allowance` is nullable and NULL is never rendered as
  0; a `DEFAULT 0` would have refused every message on this deployment on the
  strength of a number nobody chose, which is what
  `restaurants.subscription_tier DEFAULT 'pilot'` already did one column over.
- `house_message_meter` — one row per outbound text, **written whether or not it
  counted against anything**, carrying the month in the HOUSE's timezone (Meta
  applies its rate cards "based on WhatsApp Business account timezone"), a
  `counts_against_allowance` flag with **no default** and a written reason, and a
  `provider_cost_state` with **no default**.
- `house_message_credits` — money in minor units with the currency on every row.
  A purchase redeems a seal at `POST /communications/text-credits/purchase`
  (ADR 0107), bound to **the amount and the currency** so a gesture held over one
  figure cannot be spent on another. A debit names the meter row it paid for.
- The refusal, when a house is past a **stated** allowance with no credits and no
  own keys: it says nothing was sent, that **nothing has been queued and nothing
  will arrive later**, and names the two ways to carry on. A failed read is a
  **third** verdict — `unknown` — because treating it as allowed spends money we
  cannot account for and treating it as refused silences a house over our outage.

### Six measured findings from the provider docs, 2026-09-05

Fetched or retrieved this day and logged in `p4-scratch/p4bc-fetch-log.md`. The
two checklists carry the full working: `07-reference/META-TECH-PROVIDER-CHECKLIST.md`
and `07-reference/TWILIO-ISV-CHECKLIST.md`.

1. **A Meta Tech Provider has no credit line and cannot invoice for API usage.**
   "Unlike Solution Partners, however, Tech Providers do not have credit lines.
   Instead, clients onboarded by Tech Providers must provide their own payment
   method after onboarding is complete. Meta will then bill these clients for API
   usage, and the Tech Provider will bill for other services." **On the WhatsApp
   leg the standing the founder chose forces bring-your-own-billing** — credits
   can cover the SMS leg and the platform fee, never a WhatsApp message. This is
   founder question 7 below.
2. **The binding onboarding cap is 10 new houses per rolling 7 days**, rising to
   200 after Business Verification + App Review + Access Verification, and beyond
   that by applying to become a Meta Business Partner. The 2026-09-05 draft above
   named the right worry (a structural ceiling) at the wrong number: the
   portfolio's 2-numbers-raisable-to-20 cap and its 20-WABA cap are real, and
   under the Tech Provider shape they bind **the house**, not Mudavym, because
   each house owns its own portfolio.
3. **Business Verification gates App Review, not the reverse** — "Your business
   must be verified before you can start the app review process" — and App Review
   itself averages **about 24 hours**. The long pole is verification.
4. **Embedded Signup v2 is deprecated on 2026-10-15.** Six weeks out. Anything
   built against v2 is built against a dead interface; v4 is the target.
5. **The US 10DLC fees are $4.50 + $41.50, not "$44 + $15".** $4.50 one-time to
   register a Brand with TCR, plus $41.50 Standard Brand vetting charged
   automatically during registration; $11 brand appeal, $12.50 Authentication
   Plus, $66–$96/yr political vetting. Campaign fees are monthly and Twilio's
   docs point at a support article rather than stating them. Also new: **a tax ID
   caps at five Standard/Low-Volume Brands** and a Brand at five Campaigns.
6. **Hosted SMS is US and Canada only, and refuses mobile numbers.** So
   `path = 'bring_your_own'` for SMS **does not exist outside North America**:
   in Türkiye the equivalent is an alphanumeric Sender ID on wet-signed, stamped
   paperwork, and it is one-way. Worse for the product: **Twilio's automatic STOP
   handling does not work on an alphanumeric sender** — "You must provide other
   instructions" — so a Turkish opt-out must ride in the message body and be
   honoured by us. `TwilioAdapter` refuses to build a message on an alphanumeric
   sender whose body carries no opt-out.

### What still does not send, and why the refusal moved rather than disappearing

Nothing dispatches. `TextTransportRegistry` returns an adapter only when a live
credential resolves, `house_text_sender_credentials` holds zero rows, and there
is **no HTTP call anywhere below it** — asserted by a test that reads the adapter
sources with comments stripped and fails if `fetch`, `axios` or an `http` import
ever appears.

What changed is that `transport_not_built` stopped being one word for every
reason. A house with a connected sender and no provider account now hears
**`no_provider_account`** — something the house can act on. "The transport is not
built" is something only we can act on. Collapsing them told a manager our
problem in place of theirs.

`buildRequest` is still called on the send path, deliberately: it is where the
provider's own constraints live — an over-long WhatsApp body, a closed 24-hour
window, an alphanumeric sender with no opt-out — and a message the provider would
refuse is better refused in the house's language than reported as sent.

### The strongest argument against the billing model

**An allowance that cannot refuse is not an allowance.** Everything above ships
with `plan_message_allowances` empty, which means the gate's only reachable
verdicts today are `allowed` and `unknown`. The refusal path — the sentence that
carries the whole design — is unreachable on this deployment and will stay
unreachable until somebody writes a number with a source. A guard whose failing
branch has never run in production is a guard with an untested edge, and the first
time it runs it will run against a real house's real messages.

Two things answer part of that and one does not. The refusal branch is covered by
tests, and the constraint that a stated allowance carries a twenty-character
provenance means the number cannot be seeded by somebody in a hurry. What is not
answered is that the *first* house to hit a stated allowance is the first live
exercise of the sentence, and the honest mitigation is to set the first allowance
deliberately, on one house, watching — not to set it across the fleet from a
quarter's aggregate.


## What P0 and P1 made true, 2026-09-06

Written as file:line and measured counts, because the last four passes of this
document each recorded something as shipped and the reader has no way to tell a
built thing from a described one without them.

### P0 — the silence is honest

1. **The push report was already three-way and had never been RUN.** The four
   outcomes (`no_recipients`, `no_device_registered`, `read_failed`,
   `accepted_by_service`) shipped on 2026-09-05 at
   `apps/api-gateway/src/push/expo-push.service.ts:32-38`, and
   `apps/api-gateway/src/push/` held **no spec file at all**.
   `team.controller.broadcast.spec.ts:136` stubs `sendToUsers` wholesale with
   `outcome: "accepted_by_service"`, so reverting the method to its old body —
   `if (error || !data?.length) return;` — would have failed **none of the 5539
   tests**. That is a guard whose failing half has never executed, on the exact
   number this ADR was written about. Six cases now execute all four branches
   plus the throw: `apps/api-gateway/src/push/expo-push.service.spec.ts`,
   **6 passed**. The count-off-devices-not-roster assertion is the one that
   fails if the fault comes back.

2. **The book holds a mobile.** `provider_contacts.phone_type` was never written
   by any path: `addProviderContact` and `updateProviderContact` built their
   payloads without the column
   (`apps/api-gateway/src/providers/providers.service.ts:664-670`, `:697-701`
   as they stood), so every row acquired `'main_line'` from the column's
   `DEFAULT`. The legacy sheet's picker
   (`apps/web/src/components/providers/EditProviderModal.tsx:1504`) wrote to
   local state, the modal has **no call to `addProviderContact` or
   `updateProviderContact` anywhere**, and its hydrate at `:403` overwrote
   whatever the row held with the literal `'main_line'`.

   Now: `apps/api-gateway/src/providers/phone-reachability.ts` classifies a
   stored value into **two facts, never one** — `reach`
   (`mobile` / `landline` / `unstated`) and `stated`. The write path names the
   column on every insert and sends an **explicit NULL** when the caller said
   nothing (`providers.service.ts:671-681`), which is the only way to make
   "nobody has said" expressible without a migration: PostgREST sends the key,
   so Postgres does not substitute the default. `mapContactRow`
   (`providers.service.ts:731-751`) returns `reach`, `phoneTypeStated` and the
   server's own sentence.

   **`'main_line'` reports `landline` with `stated: false`**, and that is the
   load-bearing line. A row carrying it may be a value a manager chose or a
   value the column invented, and no query can separate them — so the reading
   goes in the safe direction (a withheld text is recoverable; a text read aloud
   by a switchboard is not) and says out loud that nobody answered.
   `apps/api-gateway/src/providers/phone-reachability.spec.ts`, **13 passed**,
   including one that reads the default back off
   `supabase/migrations/20260805000000_baseline_from_production.sql:4677` so a
   future migration cannot silently move it.

   The surface is a new section on the vendor sheet:
   `apps/web/src/pages/providers/next/ContactsSection.tsx` +
   `useProviderContacts.ts`, wired into `TwinSheet.tsx:92-99`. Three chips, and
   `Not stated` wins over `Not textable` when nobody has answered.
   `ContactsSection.test.tsx`, 6 cases.

3. **Nothing sent, in P0.** Still true of P0. P1 changes it, deliberately.

### P1 — WhatsApp, reply-shaped, and it dispatches

**The inbound door.** `POST/GET /communications/webhooks/whatsapp`
(`apps/api-gateway/src/communications/text/inbound/whatsapp-webhook.controller.ts`).
Both routes are `@Public()` and say so, per ADR 0096; the token they carry
instead of a JWT is Meta's own:

- the GET handshake compares `hub.mode` against `"subscribe"` and
  `hub.verify_token` against this deployment's, in constant time, and echoes
  `hub.challenge` as the **body** of a 200
  (`inbound/meta-webhook-signature.ts:139-196`);
- the POST verifies `X-Hub-Signature-256` — `sha256=<hex>`, HMAC-SHA256 of the
  **raw bytes** keyed on the app secret, compared with `timingSafeEqual`
  (`meta-webhook-signature.ts:83-131`).

Both schemes are transcribed from
[developers.facebook.com/docs/graph-api/webhooks/getting-started](https://developers.facebook.com/docs/graph-api/webhooks/getting-started),
fetched **2026-09-06**; the payload shape from
[.../whatsapp/cloud-api/webhooks/payload-examples](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples),
same date; the window rule from
[.../whatsapp/cloud-api/guides/send-messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages),
same date — *"When a WhatsApp user messages you or calls you, a 24-hour timer
called a customer service window starts… When the window closes, you can only
send pre-approved template messages."*

**A missing app secret REFUSES.** `verifyMetaSignature` checks the secret first
and on its own, and the route answers 401 for it. Treating an absent secret as
"nothing to check" would turn a public URL into an unauthenticated write on
every house's conversation book, which is
[[absence-reported-as-health]] aimed at the one door nobody would look at.

**The provenance is the mail path's, column for column.**
`inbound/whatsapp-inbound.service.ts:196-236` writes `direction: "inbound"`,
`channel: "whatsapp"`, the body in `message_text`, `received_at`,
`delivery_status: "delivered"`, the `wamid` in `message_id`, and the transport
envelope in `email_headers` — the same six the mail bridge writes at
`common/orchestrator/rabbitmq-bridge.service.ts:745-770`. `order_id` is `NULL`
and is not guessed: the mail path's fallback keys on a Gmail thread, and
attaching "the most recent open order" would put a vendor's sentence on an
order they never mentioned.

**Three refusals that are not errors and are not silence.** No sender holds that
`phone_number_id`; the number is not in that house's book (ADR 0118 D3 read
backwards — and no vendor is created from a stranger's WhatsApp profile); the
`wamid` is already stored (Meta retries what it did not get a 200 for). Each is
a counted disposition with a sentence, enumerated in the response and logged as
counts. **The tenant comes from `house_text_sender_credentials.sender_ref`, never
from the payload** — asserted both behaviourally and structurally.

**The window is a read, off the house's own book.**
`inbound/whatsapp-book.service.ts:243-320`. Three verdicts: `open`, `closed`,
and `unknown` for a read that failed. Folding `unknown` into `closed` would put
our outage into the house's language ("start with a template"); folding it into
`open` would hand Meta a message it refuses after the surface said it went.
Computing it from our own mirror rather than from Meta is the mirror rule doing
work: Meta holds the transport, the house's book holds the record.

**The dispatch.** `providers/text-dispatch.service.ts` — the one place in this
product where a text message leaves the building. The adapters and the registry
are untouched and still hold **no HTTP primitive**, which is why it is a
separate file: `text-transport.spec.ts`'s "the adapters cannot send" block is
unchanged and still passes, and `whatsapp-send.spec.ts` adds its completing
half — **exactly one** non-spec file under `communications/text/` holds an HTTP
call, asserted over a walk of the whole tree.

**The send.** `whatsapp-send.service.ts`, in this order and for these reasons:
the book (the reply is addressed to the number the vendor **wrote from**, off
the mirrored inbound row, so book-only holds by construction rather than by
validation) → **the composer's guards, unchanged** → the window → the transport
→ the money gate → **the mirror, written before the provider is asked** → the
dispatch → the meter.

- *Outside the window*: refused, with a sentence that says *"nothing was sent
  and nothing was queued — it will not go out when they next reply"*. There is
  no retry, no backlog and no scheduled column on this path. Queuing would be
  the worse failure: the message would leave hours later, out of context, in the
  house's name.
- *Inside*: one request, one `procurement_conversations` outbound row, one
  `house_message_meter` row — `counts_against_allowance: false` with the reason
  quoting Meta's own rate card, and `provider_cost_state: 'not_reported_yet'`.
- *Unreachable provider*: recorded as **unknown**, never as "not sent". A
  timed-out POST may have been accepted, and telling a manager it failed is how
  a vendor gets the same message twice.
- *Mirror write fails*: the send is **refused**. ADR 0121 P1 says the mirror is
  a precondition; a message Meta holds and the house's book does not is the
  custody problem the mirror exists to answer.

**The guards are the same function, not a copy.** `composerGuardrails` moved to
`communications/letters/composer-guardrails.ts` and
`HouseLettersService.guardrails` now delegates to it. The letter path's
behaviour is byte-identical; the text path runs the same commitment-language
regexes, the same unresolved-merge-token check and the same round count. Copying
them was the alternative and was refused: a phrase added to one list and not the
other is a hole nobody can see, on the channel this ADR says needs the guard
*more*.

**`transport: { built: false }` was a hard-coded constant and is now measured.**
`text-senders.controller.ts` answered a fixed object saying nothing could be
sent. That was true when written and stopped being true the moment a dispatch
existed — and a constant cannot notice. It is now
`TextSenderService.transportReadout`, which resolves this house's credential and
reports `built` (a dispatch exists) and `wired` (this house has a live
credential), with `wired: null` for a read that failed. The same self-report
fault as [[absence-reported-as-health]], pointed the other way: asserting an
absence you never checked is exactly as wrong as asserting a health you never
checked.

**A manager may stop it.** `/connections`' text-sender rows gained an enabled
**Stop it** control wired to the existing `POST /communications/text-senders/revoke`
(`apps/web/src/pages/connections/next/ConnectionsNext.tsx`, the `TextSenderRow`
controls), and it re-reads the register rather than painting the new state
itself. The two *declare* controls stay disabled and still carry the server's
reason.

### The forks this pass recorded rather than settled

1. **No route writes a credential, so the dispatch is unreachable on this
   deployment.** `house_text_sender_credentials` holds zero rows and the only
   way to fill one is Meta's Embedded Signup code-for-token exchange, which sits
   behind Business Verification and App Review (neither done) and against v4,
   since **Embedded Signup v2 dies 2026-10-15**. Building an untested exchange
   against an app that has not passed review would be inventing a provider
   integration nobody can exercise. **Recommendation, and what was done:** build
   the dispatch and its refusals now, seed a credential only in tests, and file
   the exchange as the next piece of work. The cost of the alternative — wiring
   a form that accepts a token — is a field on this platform that takes a
   secret, which `text-senders.dto.ts` refuses by design.

2. **`phone_type` still carries `DEFAULT 'main_line'`.** Dropping the default
   in a migration would make future absence visible as NULL at the database
   rather than only in the write path. It was **not** done, because no table
   this ADR names is missing and a column change on the busiest vendor table
   belongs in its own pass with its own backfill question. **Recommendation:**
   drop the default and add a CHECK on the vocabulary when the vendor-book pass
   next opens. Until then the code carries the honesty and
   `PHONE_TYPE_COLUMN_DEFAULT` is asserted against the baseline so the two
   cannot drift apart silently.

3. **A vendor's consent is the open window, not a `person_text_consents` row.**
   `person_text_consents` is a PERSON's agreement to be texted by their house
   and a vendor is not a user. Meta's own opt-in rule is satisfied by the vendor
   having written first, which is exactly what an open 24-hour window is
   evidence of. **Recommendation:** leave it there. Adding a vendor consent row
   would be a second record of a fact Meta already gates, and the first time the
   two disagreed the product would have to choose which one to believe.

4. **`'direct'` counts as a landline.** A "direct line" is usually a desk phone,
   so it is not textable. If a house means "the rep's direct mobile" by it, the
   read is wrong in the withholding direction. **Recommendation:** leave it, and
   let the sheet's `Mobile` and `WhatsApp` options carry that meaning — the cost
   of guessing the other way is a text to a desk.


## What only the founder can decide

1. ~~**Does a crew text exist at all, or does the crew stay on inbox and push?**~~
   **ANSWERED 2026-09-05: *"a crew text exists and build it next"*.** It is a
   second product with its own consent, exactly as this row warned: the crew's
   agreement is `person_text_consents`, not `notification_preferences`, and it
   is per person, per number, withdrawable, and impossible for a manager to
   grant. One thing this answer *added* that the question did not anticipate:
   the US registrar refuses a campaign whose consent is a condition of holding
   an account, so a crew text consent could never have been a roster column even
   if the product had wanted one.
2. **PARTLY ANSWERED 2026-09-05: the first market is *"both"*** — Türkiye
   WhatsApp-first, the US on SMS. The build follows it: `market` is a required
   column on every sender row, the catalogue answers for TR and US and returns
   `null` (never an empty checklist) for anything else, and the Türkiye SMS row
   states its own one-way limit rather than inheriting the US row's shape.
   **Still open, and it is the sharper half:** *is the Türkiye WhatsApp claim
   right?* The 88.6% figure still could not be fetched from TurkStat on
   2026-09-05, and the recommendation that Türkiye is WhatsApp-first still rests
   on it. The founder answering "both" does not make that figure fetched.
3. **ANSWERED ON ITS MONEY AXIS, 2026-09-05 (second pass).** *Who pays* is settled
   — allowance, then credits or the house's own keys; see "Who pays for a message"
   above for the words and the rejected alternatives. What follows was the state
   before that answer and is kept because the cost analysis in it still stands.
   **NARROWED, NOT CLOSED, 2026-09-05 (first pass).** The founder answered the *mechanism* —
   *"the house must either brings their own name and we have to make sure the
   connection is secure or with mudavym help buys per house and bills with
   info"* — and both are built as states. He did not answer **who pays**, which
   is OD-23 and is still open. The narrowing sharpened it rather than softening
   it: the fixed registration fee **recurs per house and does not amortise**
   ($4–$44 brand + $15 vetting + $1.50–$10 a month in the US alone), so
   "Mudavym registers for you" is a recurring per-tenant cost and not a one-time
   onboarding favour. The build prints the fee and the timeline at request time
   and keeps them on the row; it names no price to the house, because there is
   none to name.
4. **Is the hand-off acceptable as the answer to "use their connection"?** The
   product would prepare the message and the person would send it from their own
   phone, and the record would say the house did not send it. That is less than
   the line asks for. It is also the only version of it that no platform forbids.
5. **Does book-only survive for a text?** ADR 0118 D3 has no free-text To. A
   phone number is easier to type from memory than an email address, so the
   pressure to allow a free-text number will be higher — and the consequence of
   allowing it is that the message leaves the book, the round count and the
   guardrails at once.
7. **ANSWERED 2026-09-05 (batch 53): *"Accept: WhatsApp is bring-your-own
   billing."*** See the founder-answer section at the foot of this document for
   the words and the rejected alternatives. The question as it stood:
   **Does Mudavym stay a Tech Provider, or pursue Solution Partner status?**
   This is the sharpest consequence of the standing, and it was not visible when
   the standing was chosen. A **Tech Provider has no credit line and cannot
   invoice for API usage**: Meta bills each house directly for WhatsApp, and
   Mudavym bills only for everything else. So the "buy Mudavym credits" half of
   the billing model can cover the SMS leg and the platform fee, and **cannot
   cover a WhatsApp message** — the leg that carries Türkiye. A Solution Partner
   has a credit line, can share it so customers "bypass payment method
   collection", and can invoice directly; Meta's own docs say becoming one "is a
   lengthy process". The three ways out are: accept it (WhatsApp is
   bring-your-own-billing, credits are for SMS), pursue Solution Partner, or
   create a **Multi-Partner Solution** with a Solution Partner who shares their
   credit line with houses onboarded through the joint solution. Nothing in this
   build depends on the answer; every surface that would name a price is absent
   until it exists.
8. **ANSWERED 2026-09-05 (batch 54): *"One house first, deliberately, then
   watch."*** Built as `house_message_allowances` plus
   `scripts/set_house_message_allowance.py`; see the founder-answer section at
   the foot of this document. The question as it stood:
   **Who sets the first allowance, on which house, and when?** The number comes
   from a quarter of measured usage, and `plan_message_allowances` ships empty so
   that "no allowance stated" is true rather than convenient. The consequence is
   that the refusal sentence — the load-bearing one — is unreachable in
   production until somebody writes a number. Setting it fleet-wide from an
   aggregate makes the first live exercise of that sentence happen on every house
   at once.

6. **Where does the text composer live?** A second mode on `/communications`
   beside the letter, or its own surface. Retire-to-write says adding one costs
   retiring one.

---

## Verification

| Claim | Evidence |
|---|---|
| The SMS sender is Plivo, one number for the deployment | `apps/api-gateway/src/communications/sms.service.ts:30-33`; `PLIVO_PHONE_NUMBER` is a single env value with no per-restaurant column |
| The raw SMS route was deleted 2026-09-02 for being unguarded and untraceable | [[0084-the-communications-gateway-says-what-it-did]] §Decision 1, §Context "Two open relays" |
| No inbound SMS handler exists, asserted as a test | `apps/api-gateway/src/communications/gateway-honesty.spec.ts:328` |
| The broadcast refuses email and SMS however they are asked for, and counts what it withheld | `apps/api-gateway/src/team/team.controller.ts:429-436`, `:509-514` |
| 0 of 21 providers are reachable by phone only; 4 have a phone and all 4 have an email | `select` against `exzueerziesmczwlhomd`, 2026-09-04 |
| 0 of 11 `team_members` carry a phone; 3 of 11 `users` do | same |
| 0 of 3 `notification_preferences` rows have `sms_enabled` | same, and consistent with the 2026-09-02 census in `team/broadcast-preferences.ts:27-33` |
| `mobile_devices` holds 0 rows, so push reaches nobody | same |
| A broadcast would report `notified: 11` and deliver 0 | `team.controller.ts:521,527` (counted off the roster) with `push/expo-push.service.ts:83` (`if (error \|\| !data?.length) return;`) |
| `apps/mobile` has no `expo-sms` and no `expo-contacts` | `apps/mobile/package.json` dependency list; `apps/mobile/app.json` plugins |
| Türkiye does not support two-way SMS; sender ID registration required; unregistered IDs blocked from 2026-11-18 | [twilio.com/en-us/guidelines/tr/sms](https://www.twilio.com/en-us/guidelines/tr/sms), fetched 2026-09-04 |
| US 10DLC fees and the 225 msg/s per-campaign figure | [twilio.com/en-us/phone-numbers/a2p-10dlc](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc), fetched 2026-09-04 |
| 100-campaign cap per brand | [twilio.com/docs/api/errors/30930](https://www.twilio.com/docs/api/errors/30930), fetched 2026-09-04 |
| $1,000 snowshoeing fee, $10,000 per content violation | [twilio.com/en-us/guidelines/us/sms](https://www.twilio.com/en-us/guidelines/us/sms), fetched 2026-09-04 |
| Quiet hours, revocation keywords, ten business days, five-year retention | [law.cornell.edu/cfr/text/47/64.1200](https://www.law.cornell.edu/cfr/text/47/64.1200) (c)(1), (a)(10), (d)(1), (d)(3), (d)(6), fetched 2026-09-04 |
| PECR prior consent and the soft opt-in for electronic mail, which covers SMS | [legislation.gov.uk/uksi/2003/2426/regulation/22](https://www.legislation.gov.uk/uksi/2003/2426/regulation/22), fetched 2026-09-04 |
| WhatsApp is per-message since 2025-07-01; free-form inside the 24-hour window is free; service templates free since 2024-11-01 | [developers.facebook.com/docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing/), fetched 2026-09-04 |
| A number already on WhatsApp cannot be registered; display-name review; error 136024 | [developers.facebook.com/docs/whatsapp/phone-numbers](https://developers.facebook.com/docs/whatsapp/phone-numbers), fetched 2026-09-04 |
| Opt-in rule and template-approval rule | [whatsappbusiness.com/policy](https://whatsappbusiness.com/policy/), fetched 2026-09-04 |
| WhatsApp ToS forbid non-personal use and bulk/auto-messaging | [whatsapp.com/legal/terms-of-service](https://www.whatsapp.com/legal/terms-of-service), fetched 2026-09-04 |
| Twilio adds $0.005 per WhatsApp message | [twilio.com/en-us/whatsapp/pricing](https://www.twilio.com/en-us/whatsapp/pricing), fetched 2026-09-04 |
| `expo-sms` opens the system composer and cannot verify content or recipients; Android always returns `unknown` | [docs.expo.dev/versions/latest/sdk/sms](https://docs.expo.dev/versions/latest/sdk/sms/), fetched 2026-09-04 |
| Play restricts SMS permissions to the default handler | [Play policy 10208820](https://support.google.com/googleplay/android-developer/answer/10208820), fetched 2026-09-04 |
| Apple Messages for Business requires an MSP and brand ownership | [register.apple.com … register-your-acct](https://register.apple.com/resources/messages/messaging-documentation/register-your-acct), fetched 2026-09-04 |
| RCS Business Messaging is partner-gated | [developers.google.com … rcs-business-messaging](https://developers.google.com/business-communications/rcs-business-messaging/guides/learn), fetched 2026-09-04 |
| Signal prohibits bulk and automated messaging and offers no business product | [signal.org/legal](https://signal.org/legal/), fetched 2026-09-04 |
| US WhatsApp reach 32%, 5,022 adults, Feb–Jun 2025 | [Pew, Americans' Social Media Use 2025](https://www.pewresearch.org/internet/2025/11/20/americans-social-media-use-2025/), fetched 2026-09-04 |
| **UK 90% and Türkiye 88.6% are REPORTED, not fetched** | Ofcom returned 403; TurkStat's portal is client-rendered. Listed with every other unfetched source in `07-reference/messaging-senders.md` §7 |
| The ADR number is free | **This document was drafted as 0119 and renumbered twice.** The guard's first `--audit` (628 refs) said next free **0119**, and a filesystem sweep of all 51 `git worktree list` entries agreed. Both were right when they ran and wrong twenty minutes later: two concurrent sessions writing into **this same worktree** claimed 0119 (`an-agreed-price-states-its-unit`, committed at `d870800d`) and 0120 (`a-goal-comes-from-a-book-a-model-comes-from-the-task`, still untracked, its README row already committed) while this research was in flight — HEAD moved from `a1959755` to `115d2260` under it. `--audit` did not catch either, because it sweeps **refs** and the second file is not committed. **0121** was taken after re-running `--audit`, re-sweeping every worktree's `.planning/decisions/` on the filesystem, and grepping `decisions/README.md`; all three agree it is free as of this write. It should be re-checked immediately before the commit — that is the only check that counts |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | — | Created. Research only; no code, no migration, no build. |
| 2026-09-05 | Claude (build pass) | **Accepted in three parts and built to the edge of a send.** Three tables (`house_text_senders`, `person_text_consents`, `team_note_deliveries`), one `TextSenderService` that refuses every time and names which half is missing, the P0 broadcast-honesty fix, and three surfaces. Two research corrections to the 2026-09-04 draft, both from primary sources fetched 2026-09-05: the US 10DLC timeline is **13-20 business days** (brand minutes to 3-5 days, campaign 10-15), not "several days or even several weeks"; and a **Meta business portfolio is capped at 2 phone numbers, raisable to 20** — the WhatsApp analogue of the 100-campaign TCR cap, which would have limited a single-portfolio deployment to 20 houses. Two findings the draft did not have: Twilio's US guidelines list **"shared phone numbers"** among the restricted use cases (so a1 is a carrier prohibition, not only a STOP-scope objection), and a US campaign **is rejected if consent is a condition of buying or holding an account**. The Türkiye Sender ID requirement turned out to be **wet-signed, stamped paperwork on the house's own letterhead** (company/brand registration certificate, LOA, authorization letter, NOC), which no form in this product can automate. |
| 2026-09-04 | Claude (audit correction) | **Four citations in `07-reference/messaging-senders.md` were wrong; re-measured against the worktree and corrected.** The commitment guard is `letters/house-letters.service.ts:276` (the test) and `:282` (the block), not `:273`. The unresolved-merge-token guard is `:127` (the pattern), `:286` (the test), `:291` (the block), not `:119,282`. The undo window is `:72` (the status word) and `:419-420` (the row that carries `status` and `scheduled_send_at` together), not `:72,413`. All three verified identical at `902ee67f`, at `HEAD` and in the worktree, so the drift was in the citation, not in the file. The retire-to-write paragraph also named the wrong absorbed items: the pointer in `communications.md` is **§13 item 14** (`:670-671`), not §13.9 — §13.9 is *"The Mudavym sending subdomain"* (`:644`); the pointer in `team.md` is **§13 item 7d** (`:659-660`), not 7a/7c. The third pointer, at `AdminPanel.tsx`, **had never been written**: the paragraph claimed a retirement that had not happened. It is written now (`AdminPanel.tsx:823-824`, above the "Plivo SMS" row at `:825`), so the claim is true rather than merely corrected. |
| 2026-09-05 | Claude (transport + billing pass) | **The standing and the billing model accepted, and built to the edge of a dispatch.** Two migrations (`house_text_sender_credentials`; `plan_message_allowances` + `house_message_meter` + `house_message_credits`), one transport interface with two adapters proven against doc-sourced fixtures, a per-house credential store reusing `TokenCryptoService`, the meter and the refusal, and a sealed `POST /communications/text-credits/purchase` — added to `check_money_routes_are_sealed.py`'s scope **in the same pass**, because that guard's own header records that the last money route went unsealed by being outside a census. Six research corrections, each from the provider's current docs on 2026-09-05: a **Tech Provider has no credit line and cannot invoice for API usage**, which settles the WhatsApp leg's billing by construction and becomes founder question 7; the binding cap is **10 new houses per rolling 7 days**, not the portfolio's 20-number ceiling, which under this shape binds the house; **Business Verification gates App Review** and App Review averages ~24h; **Embedded Signup v2 dies 2026-10-15**; US 10DLC fees are **$4.50 + $41.50**, not "$44 + $15", and a tax ID caps at five Brands; and **Hosted SMS is US/CA only and refuses mobile numbers**, so bring-your-own-number does not exist outside North America, while **STOP does not work on an alphanumeric sender** so a Türkiye opt-out must ride in the body. `transport_not_built` was split: a connected sender with no provider account now says so, because that is a fact the house can act on. Two sources could NOT be read and are named rather than smoothed over — `www.facebook.com` is `Disallow: /` (Business Verification's document list) and `business.whatsapp.com` disallows this agent by name (the per-country WhatsApp rate card), so **no WhatsApp per-message rate appears anywhere in this pass's output**. |

## Founder answer, 2026-09-05 (batch 53) — question 7

**"Accept: WhatsApp is bring-your-own billing."** Each house attaches its own card to its
own WhatsApp Business Account; Mudavym operates it and bills the platform fee; credits
cover the SMS leg and the platform fee only. Rejected: pursue Solution Partner status
(Meta calls it a lengthy process; nothing ships on WhatsApp until it lands); a
Multi-Partner Solution with a Solution Partner (a middleman with a margin, which the
direct standing was chosen to avoid). Revisit if template-initiated messages become
common. Question 8 (charging an instrument on the credits purchase route) is open.

## Founder answers, 2026-09-05 (batch 54) — the charge, and the first allowance

**A note on numbering, because two schemes crossed.** The paragraph above answers this
document's **question 7** (Tech Provider vs Solution Partner) and calls the charging
question "question 8"; this document's own **question 8** is *who sets the first
allowance*. Both are answered below, named by what they are about rather than by number,
and neither renumbering is applied — moving a question after it has been cited is how a
citation stops meaning anything.

### Charging the card on file — ANSWERED

> **"Wire it to the card on file, sealed."**

`POST /communications/text-credits/purchase` charges the house's Stripe instrument for
the stated amount and currency **before** the credit is written. A refused charge writes
nothing and says why. **Rejected: leave it unwired** — a credit that records a debt
nobody collects is a balance that drifts from reality, and every row written under it
would have to be reconciled later.

**This required removing a guard, and that is stated rather than done quietly.**
`StripeClient` carried a deny-list of every money-moving Stripe resource, and its refusal
read: *"Charging requires a price, and pricing is an open decision (OD-23). Removing this
guard is a decision, not a refactor — see ADR 0110."* The founder has now taken that
decision, so the precondition the guard itself named has been met.

The guard was **narrowed, not deleted**. `payment_intents` is still on the deny-list;
one door is cut through it by a module-private `unique symbol` that only
`chargeCardOnFile` holds, so a second `payment_intents` caller still fails and
`grep CHARGE_INTENT` is the complete census of the code that can take money. Deleting the
array entry instead would have opened the resource to every future method silently, which
is exactly what the deny-list exists to prevent. `charges`, `subscriptions`, `invoices`,
`refunds`, `transfers`, `payouts` and `checkout/sessions` remain shut, and a test asserts
that `payment_intents` is still refused through the ordinary path.

**The order, and why it is not negotiable:** role check → seal redeemed → **charge** →
ledger row. Redeeming after the charge would take money and then decide whether it was
allowed, which is auditing a capability rather than gating it. Writing the credit first
would create a balance whether or not the money moved.

**Idempotent on the seal, twice over.** Stripe's idempotency key is
`text-credits:<sealId>`, so a repeated charge returns the original intent; and
`uq_house_message_credits_purchase_seal` makes a second credit row for one seal
impossible at the database. The seal itself is single-use, so a replayed request is
refused before it reaches either. A third enforcement is structural:
`house_message_credits_purchase_is_paid` refuses a purchase with no `payment_ref`, so
credits cannot appear without a payment behind them.

**The one window this does not close, stated plainly.** If the charge succeeds and the
ledger write then fails, the money moved and the credit did not. The response says
exactly that — `charged: true, recorded: false`, with the PaymentIntent id in the
sentence — so a person can reconcile. It does **not** report a success and it does not
retry silently. Closing it properly needs a pre-recorded intent row written before the
charge, which is a larger change than this decision asked for, and it is named here so it
is a known debt rather than a surprise.

**What is NOT wired.** Nothing charges a subscription, nothing charges for a message, and
nothing charges automatically. The only thing that takes money is a manager buying
credits, with a hold, for a figure they named.

### The first allowance, on one house — ANSWERED

> **"One house first, deliberately, then watch."**

The founder sets an allowance on one restaurant he names, and the meter runs there before
any plan-wide number.

**`plan_message_allowances` cannot express that**, and the reason is measured rather than
stylistic: it is keyed on `plan_code`, which maps to `restaurants.subscription_tier`, and
that column carries `DEFAULT 'pilot'` on every house that never chose it. A number
written there lands on the whole fleet at once — the opposite of what was decided. So
`house_message_allowances` is a per-house row that **takes precedence over the plan row**,
and `MeterReadout.allowanceScope` reports which of the two answered: *"200 because we set
it for this house"* and *"200 because every house on its plan has it"* are different
facts, and only one of them was decided.

Two rules the readout keeps, and each is a test:

- **A house row that could not be READ does not fall through to the plan row.** Answering
  with the fleet's number when the house's own read failed is a wrong answer that looks
  exactly like a right one.
- **A house row carrying NULL is not the absence of a row.** The first means somebody
  looked at this house and set nothing, with a reason on the row; the second means nobody
  has looked. The sentence says which.

**The door is a script, not a route:** `scripts/set_house_message_allowance.py`, run by
the founder with `--apply --i-have-the-founders-word`, taking **one** `--restaurant` UUID.
There is no `--all`, no glob and no plan argument; the statement it prints before running
names exactly one house; and it will not write a number without a reason of at least
twenty characters — the same floor
`house_message_allowances_number_has_provenance` enforces at the database, so a
placeholder fails even if it gets past the script. A route was the alternative and was
refused: the act happens once or twice, deliberately, and a service-key route is a door
that stays open afterwards for something nobody should be able to do casually. What that
costs is that the write cannot be proven in the jest suite; it is answered by proving the
**read** side there (the meter and the refusal, against a house-scoped allowance) and by
the script's own `--self-test`, which checks eight refusals and six statement properties
against fixtures with no database.

**What this changes today: nothing, for anybody.** Both allowance tables are empty, so
every house still reads *"no allowance stated"*, and an unstated allowance does not
refuse. The refusal sentence becomes reachable the first time the founder runs that
script, on the one house he names.

| 2026-09-06 | Claude (charge + first allowance pass) | **Both answers built.** `StripeClient.chargeCardOnFile` — the first and only method in this product that moves money — behind a `unique symbol` that narrows the money-resource deny-list to exactly one door rather than deleting the entry; `BillingService.chargeForMessageCredits` with five outcomes kept apart (`provider_not_connected`, `no_customer`, `no_instrument`, `read_failed`, `refused_by_provider`), reading the register the house was SHOWN rather than asking the provider, and refusing a `requires_action` status that a 200 would otherwise pass off as a payment; the purchase route reordered to charge before it writes, reporting `charged` and `recorded` as separate fields because they can disagree. Migration `20260906080000`: `house_message_allowances` (per-house, PK on the restaurant, `set_via` with no default, a twenty-character provenance floor), `uq_house_message_credits_purchase_seal` and `house_message_credits_purchase_is_paid` (added `NOT VALID`, so purchases written before anything could charge stay readable rather than being declared wrong). `scripts/set_house_message_allowance.py` with `--self-test`. Every migration assertion executed against PGlite: **60 checks, 0 errors**, and the three new constraints proven by rows that had to be refused rather than by asserting the constraints exist. |

## Founder answer, 2026-09-05 (batch 57) — the window is closed

> **"Close it now with the intent row."**

The previous pass shipped the charge and then named, in this document, the one
window it could not close inside a request: the charge succeeds, the ledger write
fails, and the money has moved with nothing on disk to say so. The route reported
`charged: true, recorded: false` and asked a person to reconcile from a sentence.
That is a report of a hole, not a mechanism for closing one, and the founder's
answer is to build the mechanism.

### What the order is now

1. the role check
2. the seal redeemed
3. **the intent row written**, then moved to `charge_may_exist` **before** the
   provider is asked
4. the charge
5. the credit, and the intent settled against it

Step 3 exists only so that step 4 can crash safely. The state is set **before**
the call rather than after it, and that is the whole point: a write that happens
after a crash never happens, so a state set after the call could never describe a
crash during it.

### The four states, and what each one licenses

| state | what it means | what may be done to it |
|---|---|---|
| `intended` | the row is written and **nothing has been sent** | charge it, or void it |
| `charge_may_exist` | the provider **has been asked, or is about to be**; whether money moved is unknown | settle it from the provider's answer, or void it from proof |
| `settled` | the charge succeeded; the PaymentIntent id **and** the credit entry it produced are both named on the row | nothing |
| `voided` | proven that no charge will land, with the reason written down | nothing |

`state` has **no default** — an omitted value would read as "nothing was sent",
the one wrong answer that loses money silently. `settled` cannot be reached
without both the payment and the credit; `voided` cannot be reached without a
reason of at least ten characters; `charge_may_exist` cannot be reached without
an attempt time; and an `intended` row may not carry a payment reference or an
attempt time, because the state would then be lying about what has already
happened. All four are proven by rows that had to be refused, not by asserting
the constraints exist.

### The reconcile, and the one thing it refuses to do

`PurchaseIntentReconciler` reads the provider **by the seal id** —
`chargeCardOnFile` stamps it into the PaymentIntent's metadata for exactly this
purpose — and does one of three things: settles on a succeeded charge, voids on a
charge the provider says did not succeed (quoting its status), or, on an empty
answer, **decides by age and only in one direction.**

**Stripe's search index is eventually consistent**, up to about a minute behind by
its own documentation. So an empty search is not evidence of absence for a charge
attempted seconds ago, and voiding on it would destroy the record of a real charge
— silently, and in the exact place this whole mechanism exists to prevent it. An
intent younger than `SEARCH_LAG_FLOOR_MS` (five minutes, a deliberately one-sided
margin) is therefore **left open** and reported as `too_young_to_judge`. That is
not a timeout deciding an outcome; it is a refusal to decide on evidence that
cannot yet be trusted. The attempt is still written to the row, because a
reconcile that leaves no trace when it finds nothing to do is indistinguishable
from one that never ran.

An unanswered provider is likewise never proof: `findChargeForSeal` reports
`readable: false` separately from "no charge found", and the reconcile leaves the
intent exactly as it was.

**Idempotent by construction, not by convention.** A settled row leaves the open
set. The credit write is protected by `uq_house_message_credits_purchase_seal`, so
a second write for one seal is refused by the database, and the reconcile settles
against the existing entry rather than treating that refusal as a failure. Running
it three times settles once — asserted.

### Which door, and why it is three things

- **The decisions** live in `PurchaseIntentReconciler`. One implementation of
  "did this charge happen"; a second would be one more than the number of answers
  there can be.
- **The door** is `POST /communications/text-credits/reconcile`, behind
  `ServiceKeyGuard` (ADR 0099) rather than a seal. A seal binds an act to a person
  who made a gesture; there is no person here, and the route makes no new
  decision — it asks the provider what already happened and writes the answer
  down. It cannot charge, cannot choose an amount, cannot create an intent, and
  cannot void one the provider has not been asked about. It is **allow-listed in
  `check_money_routes_are_sealed.py` with that reason written out**, rather than
  quietly left outside the guard's scope.
- **The runner** is `scripts/reconcile_message_credit_purchases.py`, in the
  founder's-word shape: a dry run lists the open set and what would happen to each
  row, and `--apply` is refused without `--i-have-the-founders-word`.

### The response never says charged-true / recorded-false again

It carries one `state` — the intent's own. Two booleans that can disagree are two
facts a caller has to reconcile in its head, and the point of the intent row is
that the reconciling is done on disk. The old contradiction is now the honest
state `charge_may_exist`, with a sentence saying a reconcile will finish it and
that nothing will be charged twice. A test asserts the response has no `charged`
and no `recorded` property at all, so the old shape cannot come back by accident.

### What this still does not claim

**It is not atomic, and it does not pretend to be.** PostgREST gives this codebase
no multi-statement transaction, so the honest shape is a durable intent plus a
reconcile rather than a claim of atomicity. What changed is that there is no
longer a moment where money can move with nothing on disk to say so — every state
of the world past step 3 is reachable from a row.

| 2026-09-06 | Claude (intent-row pass) | **The window is closed.** Migration `20260906110000` adds `house_message_purchase_intents` — four states with no default, one intent per seal, and four constraints that make a row unable to lie about what has already happened (settled needs both halves, voided needs a reason, `charge_may_exist` needs an attempt time, `intended` may carry neither). `PurchaseIntentService` writes it before the provider exists to the request and marks `charge_may_exist` **before** the call; `PurchaseIntentReconciler` reads the provider by the seal id and settles, voids, or refuses to judge an intent younger than the provider's own search lag; `StripeClient.findChargeBySeal` and `BillingService.findChargeForSeal` are the read, sharing the one door through the money-resource deny-list and keeping "no charge found" apart from "the provider could not be asked". The door is `POST /communications/text-credits/reconcile` behind `ServiceKeyGuard`, allow-listed in the money guard with its reason, plus `scripts/reconcile_message_credit_purchases.py`. The response dropped `charged`/`recorded` for one `state`, asserted by a test that fails if either property returns. The ORDER is proven by a **mutation**: the charge stub records the intent's state as it stood when it was called, and moving the charge above the mark makes the suite fail — verified by doing it. PGlite: **77 checks, 0 errors**. |
| 2026-09-06 | Claude (audit response) | **Two audit findings on the charge path, both closed.** DEFECT: `BillingService.chargeForMessageCredits` and its private `instrumentToCharge` had **zero direct coverage** — the credits spec mocked the method wholesale and `billing.service.spec.ts` never called it, so a regression in the `requires_action` check (filing an unauthenticated 200 as a payment) or in the read-failure branch would have failed none of the 553 tests. Sixteen cases added against a stubbed `StripeClient` and `DatabaseService` with the method itself real: the five outcomes, five non-`succeeded` statuses refused, a missing status not defaulted to success, the instrument taken from the MIRROR and not the provider, and the seal id in the idempotency key. **Each case proven by a one-change mutation**: ten mutations of `billing.service.ts` in a scratch copy, `10/10` killed by the case named in its comment, the file restored byte-identically and verified with `diff -q`. NIT: `stripe.client.spec.ts` restated the deny-list by hand and covered eight of its ten entries — `subscription_items` and `invoiceitems` were enforced in shipped code and asserted nowhere. `FORBIDDEN_PATHS` is now exported and iterated, sub-paths are covered for all ten rather than one, and normalisation (leading slash, case) is asserted; dropping either previously-untested entry now fails the suite, verified. Suite 553 -> 582. |
| 2026-09-06 | Claude (P0 + P1 build pass) | **P0 closed and P1 built — the first pass in which a message can leave.** P0 item 1 turned out to be *shipped and never executed*: `src/push/` held no spec at all, so all four push outcomes existed and reverting `sendToUsers` to `if (error || !data?.length) return;` would have failed none of the 5539 tests; six cases now run every branch. P0 item 2 built the write path (`phone_type` named on every insert with an **explicit NULL** when the caller said nothing, so Postgres cannot substitute its default) and the read that returns **two facts, not one** — `reach` and `stated` — with `'main_line'` reporting `landline`/`stated: false` because the column's own default is byte-identical to a manager's answer; the legacy sheet's picker was writing to local state and its hydrate was overwriting the stored value with the literal `'main_line'`. P1: a `@Public()` Meta Cloud API webhook authenticated by `X-Hub-Signature-256` over the raw body with `timingSafeEqual` (401 on a wrong signature **and** on a missing secret, storing nothing either way, tenant from our own credential row and never from the payload); threading in the mail path's provenance shape, idempotent on the `wamid`; the 24-hour window as a **three-verdict** read off the house's own mirror; and a real dispatch in ONE new file so `text-transport.spec.ts`'s "the adapters cannot send" assertion is *completed* rather than relaxed — a walk of the whole `text/` tree now asserts exactly one file holds an HTTP primitive. A send outside the window is refused with the reason and **nothing is queued**; inside, one request, one mirrored row and one meter row, free by Meta's own rule. The composer's guards MOVED to `letters/composer-guardrails.ts` and are called by both paths — one implementation, byte-identical behaviour for the letter. `transport: { built: false }` was a hard-coded constant and is now measured per house (`built` / `wired` / `wired: null` for a failed read): asserting an absence you never checked is the same fault as asserting a health you never checked. **Measured:** gateway tsc both configs 0 errors; `npx jest` **369 suites, 5543 passed, 14 skipped, 0 failed** (65 new); web tsc clean, `vitest run` **164 files, 2308 passed**; `check_gateway_boots.sh` PASS; route-exposure, new-tables-locked-down, read-columns-exist, queried-tables-exist, read-errors-not-swallowed, money-routes-sealed, money-states-its-currency, migration-versions-unique, fk-targets-exist, citation-pairing all PASS; `check_decision_claims.sh` 254 checked, 254 holding. **No migration** — every table this pass writes to already exists. Four forks recorded rather than settled, the sharpest being that **no route writes a credential**, so the dispatch is real code that no house on this deployment can reach yet: Embedded Signup sits behind Business Verification and App Review, and v2 dies 2026-10-15. |

## Review trail, continued (parent, 2026-09-06) — 565ea4d4 and 9ac36595

| Date | Who | What |
|---|---|---|
| 2026-09-06 | Claude (parent) | The numbers 565ea4d4's message pointed at this trail for (audit adb8de250209ceb96 found the row incomplete): on an archive of that commit's index, `npx jest src/communications src/billing src/team` 553 passed / 38 suites; gateway tsc (both configs) 0 errors; check_gateway_boots PASS; check_money_routes_are_sealed PASS (6 money writes redeem a seal, 4 allow-listed with a reason) and `--self-test` 7 cases; `scripts/reconcile_message_credit_purchases.py --self-test` 4 decisions and 6 report properties, 0 writes; check_new_tables_are_locked_down, check_fk_targets_exist, check_read_columns_exist, check_read_errors_not_swallowed, check_no_seeded_defaults, check_a_count_is_recorded, check_citation_pairing, check_od_ids_exist PASS; migration versions unique; the builder's PGlite probe 77 checks, 0 errors; the order proof by mutation reproduced by the audit (charge above markAttempting fails stateAtChargeTime, 1 of 13). 9ac36595 (the charge path's direct tests): `npx jest src/billing` 100 passed / 6 suites; ten one-change mutations each killed by the case that names it. |
