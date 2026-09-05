# 0121 — The house's text sender

- **Status:** Proposed — research only, nothing built, founder decision open
- **Date:** 2026-09-04
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

## What only the founder can decide

1. **Does a crew text exist at all, or does the crew stay on inbox and push?**
   ADR 0118 D6 says a staff broadcast is not a composer template, and the
   composer writes to the vendor book only. A text sender does not automatically
   change that. If crew texting is wanted, it is a second product with a
   different legal footing (employees, not businesses) and a different consent.
2. **Which market is the first text house — US, UK or Türkiye?** This changes the
   entire build: 10DLC brand registration, or an alphanumeric sender ID, or
   WhatsApp with no SMS at all. And with it: **is the Türkiye WhatsApp claim
   right?** The document's strongest recommendation rests on a figure that could
   not be fetched from its source.
3. **Who pays for a sender?** OD-23 again, sharper than in ADR 0118: a mailbox
   can be brought from home, but a text sender cannot — there is no "connect your
   own number" for 10DLC, and a WhatsApp number must be one *not already on
   WhatsApp*, which most restaurants' phones are. The house has to buy a number
   or Mudavym has to.
4. **Is the hand-off acceptable as the answer to "use their connection"?** The
   product would prepare the message and the person would send it from their own
   phone, and the record would say the house did not send it. That is less than
   the line asks for. It is also the only version of it that no platform forbids.
5. **Does book-only survive for a text?** ADR 0118 D3 has no free-text To. A
   phone number is easier to type from memory than an email address, so the
   pressure to allow a free-text number will be higher — and the consequence of
   allowing it is that the message leaves the book, the round count and the
   guardrails at once.
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
