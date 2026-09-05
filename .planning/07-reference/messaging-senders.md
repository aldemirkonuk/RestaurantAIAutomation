---
type: reference
title: Messaging senders — provider and channel survey
status: live
updated: 2026-09-05
links: ["[[0121-the-houses-text-sender]]", "[[0118-the-house-writes-its-own-mail]]", "[[0114-connections-are-the-houses-profile-is-the-persons]]", "[[0084-the-communications-gateway-says-what-it-did]]"]
---

# Messaging senders — provider and channel survey

The evidence table behind [ADR 0121](../decisions/0121-the-houses-text-sender.md).
Every outside row carries the URL it came from and the date it was fetched. Rows
that could **not** be fetched are in §7 and are labelled as such rather than
quietly rounded into the table — a survey that cannot tell a read source from an
unread one is the fault this repo already has a name for
([[absence-reported-as-health]]).

**Retire-to-write (CLAUDE.md §4).** This file exists so the sender survey lives
in exactly one place. It **absorbs** what would otherwise have been written three
times, and the three pointers are the retirement. Corrected 2026-09-04 after an
audit found two of the three cited wrongly and the third not written at all:

| Absorbed from | The pointer, as it actually stands |
|---|---|
| `06-pages/communications.md` **§13 item 14**, *"The house's text sender"* (`:670-671`) | present. **Not §13.9** — that item is *"The Mudavym sending subdomain"* (`:644`), a different subject, and this file said so until today. |
| `06-pages/team.md` **§13 item 7d** (`:659-660`) | present. **Not 7a/7c** — those are the founder's own paragraphs (`:632`, `:640`); 7d is the line that points here. |
| `apps/web/src/pages/AdminPanel.tsx:825`, the "Plivo SMS" row — still the only place in the PRODUCT where a message vendor is named | written 2026-09-04, `:823-824`, as a comment above the row. Until then this paragraph claimed a pointer that did not exist, which is the same shape as the fault this file's opening paragraph names. |

Nothing is deleted by this file.

**All fetch dates below: 2026-09-04.**

---

## 1. What this deployment has today (measured, not fetched)

| Fact | Where | Value |
|---|---|---|
| The SMS sender is **Plivo**, not Twilio | `apps/api-gateway/src/communications/sms.service.ts:30-33` | `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` / `PLIVO_PHONE_NUMBER` |
| It is **one number for the whole deployment** | same, `:32-33` | a single `fromNumber` read from env; no per-restaurant column exists anywhere |
| An unconfigured provider reports failure, not a fake success | `sms.service.ts:225-240` | ADR 0084 fix; returns `{success:false, error:"SMS not configured"}` and no `messageId` |
| There is **no inbound SMS handler** | asserted as a test | `communications/gateway-honesty.spec.ts:328` greps for a route-shaped inbound SMS handler and fails if one appears |
| The raw send route was deleted | ADR 0084 §Decision 1 | `POST /communications/sms` + `SendSmsDto`, zero callers at deletion |
| A crew broadcast sends neither email nor SMS | `team/team.controller.ts:429-436` | `NO_SENDER = ["email","sms"]`; a caller that names one gets the count back under `withheldByProduct` |
| The person-level switch exists and is read | `team/broadcast-preferences.ts:83-87` | `notification_preferences.email_enabled` / `.sms_enabled` / `.push_enabled` |
| Push is the only outbound crew channel left | `team.controller.ts:477-488` → `push/expo-push.service.ts:73-92` | reads `mobile_devices.expo_push_token` |

### Production census, `exzueerziesmczwlhomd`, 2026-09-04

| Query | Result | What it means for a text sender |
|---|---|---|
| `providers` | 21 rows; 4 with `contact_email`; 4 with `contact_phone` | most of the book has neither |
| `providers` with a phone **and** an email | **4** | |
| `providers` with a phone **and no** email | **0** | **no vendor in this deployment is reachable only by phone** |
| `provider_contacts` | 3 rows; 3 with email; 2 with phone | |
| `team_members` | 11 rows; **0** with a phone; **0** with an email; 11 linked to a user | a crew text has no address to go to |
| `users.phone` | 11 rows; **3** carry a phone | three people across the whole deployment |
| `notification_preferences` | 3 rows; `sms_enabled` true on **0**; `push_enabled` true on 3; `email_enabled` true on 3 | every person who has expressed a preference has SMS **off** |
| `mobile_devices` | **0 rows** | push, the only remaining crew channel, currently reaches nobody |

The last row has a live consequence worth naming separately: `broadcast` returns
`notified: pushIds.length` (`team.controller.ts:521,527`) counted from the
roster, while `ExpoPushService.sendToUsers` returns silently when the token read
is empty **or** fails (`expo-push.service.ts:83`, `if (error || !data?.length) return;`).
With `mobile_devices` empty, a broadcast to the 11-person crew reports
`notified: 11` and delivers 0. Filed as a gap, not fixed here (docs-only pass).

---

## 2. SMS providers

| Provider | US A2P 10DLC | Per-message (fetched 2026-09-04) | Numbers | Source |
|---|---|---|---|---|
| **Twilio** | Brand $44 one-time (Standard) / $4 (Low-Volume Standard) / $4 (Sole Proprietor); campaign vetting $15 one-time; monthly $1.50–$10 per campaign, $2 sole proprietor; "up to 225 messages per second per campaign" | US $0.0083 out and in, plus carrier fees ~$0.0025–$0.007; TR $0.0305 out | US long code $1.15/mo, toll-free $2.15/mo | [a2p-10dlc](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc), [sms/pricing/us](https://www.twilio.com/en-us/sms/pricing/us), [sms/pricing/tr](https://www.twilio.com/en-us/sms/pricing/tr) |
| **Telnyx** | has a 10DLC primitive; fees not on the pricing page | US "from $0.004 per part"; carrier fees vary by carrier; TR/UK not listed on that page | $1.00/number/mo | [pricing/messaging](https://telnyx.com/pricing/messaging) |
| **Bird** (was MessageBird) | not stated on the pricing page | US long code and toll-free $0.0035, short code $0.0070; **UK $0.050** (alphanumeric, long, short); **TR alphanumeric $0.0275**; carrier fees on top | not on that page | [pricing/sms](https://bird.com/pricing/sms) |
| **Vonage** | names alphanumeric sender ID as a per-country capability and defers the country list to its knowledgebase, so a per-country answer needs a second lookup | pricing page returned 403 on 2026-09-04 | — | [country-specific-features](https://developer.vonage.com/en/messaging/sms/guides/country-specific-features) |
| **Sinch** | ships a "10DLC Brand and Campaign Registration API"; requirements are not on the landing page | not on the landing page | — | [developers.sinch.com/docs/sms](https://developers.sinch.com/docs/sms/) |
| **Plivo** | *incumbent in this repo* | not surveyed this pass | one deployment number | `sms.service.ts:30-33` |

The UK/US spread is the number that decides a shape: **UK SMS is roughly 6x US
SMS at Bird's published rates** ($0.050 vs $0.0083), and Türkiye sits between
them ($0.0275–$0.0305).

### 2a. Registration and filtering, US

- Registering a brand is what stops carrier filtering: "By registering your
  Brand, you give US carriers information about your business and the messages
  you send, so carriers don't filter them" —
  [direct-standard-onboarding](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/direct-standard-onboarding).
- Campaign type sets throughput and daily caps. Low-Volume Standard is aimed at
  under 6,000 segments/day; Low-Volume Mixed at under 2,000 segments/day on
  T-Mobile; Sole Proprietor is capped at 1,000 messages/day —
  [a2p-10dlc](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc),
  [a2p-10dlc product page](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc).
- Timeline: "While Campaign registration is straightforward, verification can
  take several days or even several weeks" —
  [transition-sole-proprietor-to-standard-brand](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/transition-sole-proprietor-to-standard-brand).
- A brand is capped at 100 campaigns by The Campaign Registry —
  [error 30930](https://www.twilio.com/docs/api/errors/30930). Relevant to any
  design where **each house is its own campaign**.
- Penalties are pass-through and large: a $1,000 T-Mobile program-evasion fee for
  snowshoeing or unauthorized number replacement/recycling, and after prior
  warning "a $10,000 pass-through fee may be imposed for each unique instance of
  content violating the T-Mobile Code of Conduct" —
  [guidelines/us/sms](https://www.twilio.com/en-us/guidelines/us/sms).

### 2b. United Kingdom

- Alphanumeric sender IDs are supported; **pre-registration is required only for
  protected sender IDs** (MEF/BT lists). Generic IDs (SMS, TEXT, INFO, Verify,
  Notify) "are being blocked from the operators". Campaigns must support
  "HELP/STOP messages, and similar messages, in the end user's local language" —
  [guidelines/gb/sms](https://www.twilio.com/en-us/guidelines/gb/sms).
- The law: PECR reg 22 requires prior consent for direct marketing "by means of
  electronic mail", a definition that covers SMS. The soft opt-in applies only
  where the details came from a sale or negotiation with that recipient, the
  marketing is for similar products, and a simple means of refusal was given both
  at collection and in every subsequent message —
  [legislation.gov.uk/uksi/2003/2426/regulation/22](https://www.legislation.gov.uk/uksi/2003/2426/regulation/22).

### 2c. Türkiye

Four operator-level facts, all from
[guidelines/tr/sms](https://www.twilio.com/en-us/guidelines/tr/sms):

1. **Sender ID registration is required**, roughly 2 weeks to provision, and
   "Starting on November 18th, 2026, messages with unregistered Sender IDs to
   Turkish networks will be blocked."
2. **Two-way SMS is not supported.** An inbound reply cannot come back.
3. "Effective April 1 2026 companies WITHOUT a local entity in Turkey can no
   longer send messages with URLs in their content to Turkish numbers."
4. Promotional traffic has been prohibited since 2021-02-15; P2P, gambling,
   political and religious content is prohibited; no SMS to landlines; no
   delivery to Northern Cyprus.

Consent regime: commercial electronic messages require prior consent recorded in
**İYS** (İleti Yönetim Sistemi), the national registry under Law 6563, alongside
KVKK obligations for the personal data. **The primary texts were not fetched** —
see §7.

### 2d. United States law

All from [47 CFR 64.1200 (Cornell LII)](https://www.law.cornell.edu/cfr/text/47/64.1200):

| Rule | Paragraph | Text |
|---|---|---|
| Quiet hours | (c)(1) | no solicitation "before the hour of 8 a.m. or after 9 p.m. (local time at the called party's location)" |
| Revocation | (a)(10) | any reasonable method, expressly including replying "stop", "quit", "end", "revoke", "opt out", "cancel", "unsubscribe" |
| Speed of revocation | (a)(10) | honoured "within a reasonable time not to exceed ten business days from receipt of such request" |
| Written policy | (d)(1) | a written do-not-call policy, available on demand |
| Record the request | (d)(3) | the request is recorded and placed on the caller's do-not-call list |
| Retention | (d)(6) | "a do-not-call request must be honored for 5 years from the time the request is made" |

---

## 3. WhatsApp Business Platform (Cloud API)

| Question | Answer | Source |
|---|---|---|
| Billing model | **per-message since 2025-07-01**; conversation-based pricing deprecated | [docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing/) |
| What is free | non-template (free-form) messages sent inside an open 24-hour customer service window; **service** templates free for all businesses since 2024-11-01; utility and authentication templates free inside an open window | same |
| What is charged | marketing templates on every delivery; utility and authentication outside an open window. Rates are per-country and per-currency on Meta's rate card | same |
| Platform markup | Twilio adds **$0.005 per message**, inbound and outbound, on top of Meta's rate | [twilio.com/en-us/whatsapp/pricing](https://www.twilio.com/en-us/whatsapp/pricing) |
| Who may start a conversation | only with an approved template: "You may only initiate conversations using an approved Message Template", and WhatsApp may "review, approve, pause and reject any Message Template at any time" | [whatsappbusiness.com/policy](https://whatsappbusiness.com/policy/) |
| Opt-in | "You may only contact people on WhatsApp if: (a) they have given you their mobile phone number; and (b) you have received opt-in permission from the recipient confirming that they wish to receive subsequent messages or calls from you" | same |
| The number | a number already active on WhatsApp "cannot be registered unless they are deleted first"; verification by SMS or voice; a landline is eligible (voice OTP standard, SMS OTP "Not Recommended"); re-registering a verified number returns HTTP 400, error `136024` | [docs/whatsapp/phone-numbers](https://developers.facebook.com/docs/whatsapp/phone-numbers) |
| Display name | reviewed; statuses `APPROVED`, `PENDING_REVIEW`, `DECLINED`, `AVAILABLE_WITHOUT_REVIEW` | same |
| Stated prerequisites to start | a Meta account, developer registration, and a WhatsApp-enabled device for test messages. Business verification is not listed on the get-started page | [cloud-api/get-started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started) |

**The pricing shape that matters here.** Mudavym's actual traffic is *replies*:
a vendor writes, the house answers. Every message in that pattern is free-form
inside an open 24-hour window, and free-form inside the window is free. The
charge lands only on the house *starting* a conversation, and only through an
approved template.

### 3a. Do the people actually use it

| Market | Figure | Source |
|---|---|---|
| US | **32%** of US adults use WhatsApp; up from 23% in 2021. Survey of 5,022 US adults, 2025-02-05 to 2025-06-18 | [Pew, Americans' Social Media Use 2025](https://www.pewresearch.org/internet/2025/11/20/americans-social-media-use-2025/) (fetched) |
| UK | reported **90%** reach among UK online adults, May 2025 | Ofcom Online Nation 2025 — **not fetched**, see §7 |
| Türkiye | reported **88.6%** of individuals, ahead of YouTube 72.9% and Instagram 68.1% | TurkStat Household IT Usage Survey 2025 — **not fetched**, see §7 |

The one figure that was fetched from its primary source is the one that is
lowest. That asymmetry is worth carrying: the strongest claim in this section
(Türkiye is a WhatsApp country) rests on the weakest citation.

---

## 4. Per-person phone connections

| Path | Feasible | What the terms say | Source |
|---|---|---|---|
| **iOS, app sends an SMS** | No | the platform API opens the system composer; the person presses send. `expo-sms` "opens the default UI/app for sending SMS messages with prefilled addresses and message"; the only feedback is `sent` / `cancelled` / `unknown`, and "we do not check actual content of message nor recipients list" | [docs.expo.dev/versions/latest/sdk/sms](https://docs.expo.dev/versions/latest/sdk/sms/) |
| **Android, app sends an SMS** | Only as the default SMS handler | Play restricts the SMS permission group to apps "actively registered as the default handler", requires a Permissions Declaration Form, and apps that do not qualify "may be removed from Google Play". `expo-sms` on Android always returns `unknown` — "Android does not provide information about the status of the SMS message" | [Play policy 10208820](https://support.google.com/googleplay/android-developer/answer/10208820), [expo-sms](https://docs.expo.dev/versions/latest/sdk/sms/) |
| **Apple Messages for Business** | Brand channel, not a personal one | an MSP must be selected before registration; administrator and read-only roles; "Only official brand owners qualify — franchisees must work through their brand owner" | [register.apple.com … register-your-acct](https://register.apple.com/resources/messages/messaging-documentation/register-your-acct) |
| **WhatsApp linked devices / personal account automation** | Prohibited | the ToS forbid "any non-personal use of our Services unless otherwise authorized by us" and "sending illegal or impermissible communications such as bulk messaging, auto-messaging, auto-dialing, and the like" | [whatsapp.com/legal/terms-of-service](https://www.whatsapp.com/legal/terms-of-service) |
| **RCS Business Messaging** | Partner-gated | sending requires becoming an RCS for Business partner via an interest form; verified sender badge; Android and iOS | [developers.google.com … rcs-business-messaging](https://developers.google.com/business-communications/rcs-business-messaging/guides/learn) |
| **Signal** | No business product | the terms prohibit "bulk messaging, auto-messaging, and auto-dialing"; no business messaging service, commercial API or organisational product appears in the terms or privacy policy | [signal.org/legal](https://signal.org/legal/) |

### 4a. What the mobile app can do today

`apps/mobile` is Expo SDK 54 (`apps/mobile/package.json`). Declared plugins:
`expo-router`, `expo-secure-store`, `expo-local-authentication`, `expo-font`,
`expo-notifications`, `expo-camera` (`apps/mobile/app.json`). There is **no**
`expo-sms` and **no** `expo-contacts` in the dependency list, and the only
outbound platform call in the app is `Linking.openURL` to web routes
(`apps/mobile/src/guidance/WineAgentFab.tsx:37`, `app/get-started.tsx:70`,
`app/help.tsx:121`, `app/wine-agent.tsx:74`, `app/(tabs)/insights.tsx:92`).
Push is wired (`expo-notifications`, tokens in `mobile_devices`) and has **0
registered devices** in production.

---

## 5. Cost sketch for one house, one year

Order-of-magnitude only, from the fetched rates above. Not a quote.

| Shape | Fixed | Per message | 500 texts/yr | Notes |
|---|---|---|---|---|
| US 10DLC, Low-Volume Standard, one campaign | $4 brand + $15 vetting once, then $1.50–$10/mo campaign + $1.15/mo number | $0.0083 + ~$0.0025–$0.007 carrier | ~$36–$135/yr fixed + ~$5–$8 traffic | registration days-to-weeks; 100-campaign cap per brand |
| UK long code or alphanumeric | number rental | $0.050 | ~$25 traffic | no pre-registration unless the sender ID is protected |
| Türkiye alphanumeric | sender ID registration, ~2 weeks | $0.0275–$0.0305 | ~$14–$15 traffic | **no inbound**; no URLs without a local entity |
| WhatsApp Cloud API, reply-shaped traffic | a dedicated number not on the WhatsApp app; display-name review | $0 Meta inside the window + $0.005/message if routed through Twilio | ~$2.50 | the house-initiated case needs an approved template and pays Meta's rate |

The dominant cost of a text sender is **not the messages**. It is the fixed
registration per sender, and it recurs per house.

---

## 6. Guardrail parity

What a letter already has under ADR 0118, and whether the same guard exists for a
text. This is the checklist ADR 0121's guardrail tables are written against.

| Guard | Letter (built) | A text needs |
|---|---|---|
| Book-only recipients | `providers.contact_email` / `primary_contact->>'email'` / `provider_contacts.email`, no free-text To (ADR 0118 D3) | the same over `contact_phone` / `provider_contacts.phone`, which today reaches **4 vendors and 0 crew** |
| Commitment guard | `COMMITMENT_PATTERNS` over the body, blocks (`letters/house-letters.service.ts:276` tests, `:282` blocks) | identical, and it matters more: a text is shorter and reads as more casual |
| Round count | `max_rounds` as a stated fact, not a block (ADR 0118 D5) | the same counter, over the same `procurement_conversations` rows |
| Undo | 2 minutes as a row, `status='HOUSE_QUEUED'` with `scheduled_send_at` (`house-letters.service.ts:72` names the status, `:419-420` writes the pair) | a text is read within seconds; the undo window is worth less and the cost of a wrong send is higher |
| The seal | on the shared Mudavym sending domain only | a shared sending **number** is the same shared-reputation object as a shared sending domain |
| Unresolved merge token | added guard, `{{ anything }}` (`house-letters.service.ts:127` is the pattern, `:286` tests it, `:291` blocks) | identical |
| Provenance chips | `inserted_insights`, server-reverified | a 160-character message cannot carry a provenance chip. This is the one guard that does not transfer, and it is the reason a text should carry sentences and not figures |

---

## 7. Sources that could NOT be fetched on 2026-09-04

Listed so a later reader knows which rows above rest on a summary rather than a
document, and can close them.

| Claim | Intended primary source | What happened |
|---|---|---|
| Law 6563 Art. 6/8, prior consent for commercial electronic messages in Türkiye | `mevzuat.gov.tr/mevzuatmetin/1.5.6563.pdf` | DNS failure on `www.`, TLS chain failure without it |
| İYS registration obligation and scope | `iys.org.tr/en/what-is-iys`, `iys.org.tr/en/frequently-asked-questions` | client-rendered; both pages returned a loading shell |
| WhatsApp reach in the UK (90%) | Ofcom, Online Nation 2025, published 2025-12-10 — `ofcom.org.uk/.../online-nations-report-2025.pdf` | Ofcom returned HTTP 403 to the fetcher |
| WhatsApp reach in Türkiye (88.6%) | TurkStat, Household Information Technologies Usage Survey 2025 — `data.tuik.gov.tr/Bulten/Index?p=Hanehalki-Bilisim-Teknolojileri-(BT)-Kullanim-Arastirmasi-2025-53492` | redirects to `veriportali.tuik.gov.tr`, which is client-rendered and returned an empty document |
| ICO guidance on PECR electronic mail marketing | `ico.org.uk/.../electronic-mail-marketing/` | HTTP 403. The statutory text was fetched instead, from legislation.gov.uk |
| Twilio's A2P 10DLC fee article | `help.twilio.com/articles/1260803965530` | client-rendered. The same fees were fetched from Twilio's own product page instead |
| Vonage per-message pricing | `vonage.com/communications-apis/sms/pricing/` | HTTP 403 |
| Apple's rule on who may start a Messages for Business conversation | `developer.apple.com/documentation/businesschat`, `developer.apple.com/apple-messages-for-business/` | both HTTP 404; the registration page that did load does not state the rule |

Meta's per-country WhatsApp rate card was also not transcribed: the third-party
summary of it disagreed with Meta's own category rules (it reported marketing
templates as free, which Meta's pricing page contradicts), so only Meta's own
category rules and Twilio's flat $0.005 platform fee are recorded above.

---

## 8. How long is a mirrored vendor reply kept (ADR 0118's founder-question 7, 2026-09-05)

**Why this lives here rather than in a new `07-reference` file.** The question is
not a sender/channel choice — it is a retention question about mail already
being read under the `gmail_read` grant (ADR 0118 D8–D11). It does not fit this
file's own title. It is placed here anyway, under CLAUDE.md §4's retire-to-write:
this file is already the evidence-table sibling of ADR 0118 (frontmatter link,
above), the alternative was an **eighth** `07-reference` file for one founder
question, and this file's own opening paragraph already commits to being the one
place the comms-and-consent evidence lives rather than three. If a second
retention question arrives for a different grant, it belongs here too, and the
title should change before a ninth file does.

**The founder's question, verbatim:** which of three keeps is best, SOTA, "for ML
purposes and training, and for privacy" — (A) kept as long as the vendor
relationship, deleted when the grant is revoked; (B) kept with the house's
records regardless of revocation; (C) a fixed window (90 days) then deleted.

All fetches below are dated **2026-09-05** and are direct fetches of the primary
source (a government/EU-law text, a company's own published policy or FAQ page,
or Google's own documentation) unless a row says otherwise.

### 8.1 What Google's own policy requires, and what it forbids outright

| Question | What Google's policy says | Source (fetched 2026-09-05) |
|---|---|---|
| Is `gmail.readonly` (this build's read scope) a **restricted** scope? | Yes — listed verbatim alongside `mail.google.com`, `gmail.metadata`, `gmail.modify`, `gmail.insert`, `gmail.compose`, `gmail.settings.basic`, `gmail.settings.sharing` | [support.google.com/cloud/answer/13464325](https://support.google.com/cloud/answer/13464325) |
| Is `gmail.send` (the send grant, ADR 0118 D1) on that same restricted list? | **No** — absent from the list above; it is sensitive, not restricted, which is why only the read grant carries the CASA obligation below | same |
| The AI/ML training prohibition, verbatim | *"Transferring, selling, or using user data to create, train, or improve a machine learning or artificial intelligence model beyond that specific user's personalized model for the appropriate use case or user-facing feature."* Applies to Gmail, Chat, Drive, Sheets and other Workspace APIs, and to "data aggregated, anonymized, or derived from" the raw scope, not only the raw payload | [developers.google.com/workspace/workspace-api-user-data-developer-policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) |
| The one stated exception to that ban | "beyond that specific user's personalized model for the appropriate use case" — a **per-house** model trained only on that house's own mirrored mail, for that house's own composer, is the shape the exception describes; a model trained across houses is exactly what is forbidden | same |
| Human reading of the data | *"Don't allow humans to read the data, unless: You first obtained the user's affirmative agreement to view specific messages, files, or other data"* (plus narrow security/legal exceptions) | [developers.google.com/terms/api-services-user-data-policy](https://developers.google.com/terms/api-services-user-data-policy) |
| Transfer / advertising | Transfers barred except to "provide or improve" the consented feature, for security, or for legal compliance; explicitly barred for "serving ads, including retargeting, personalized or interest-based advertising" and for "credit-worthiness or lending purposes" | same |
| Caching / permanent copies | *"Terms of Service prohibits the scraping, building databases (including databases for model training purposes), or otherwise creating permanent copies of Google User data. This includes keeping cached copies longer than permitted by the cache header."* Read narrowly: this targets scraping/independent-database-building, not an ordinary app's own persisted records of a feature the user consented to — but it is the same sentence that bars the "database for model training" the founder asked about | [developers.google.com/workspace/workspace-api-user-data-developer-policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) |
| Required consent-screen disclosure | *"An affirmative or other similar statement that your use of the data complies with the Limited Use restrictions must be disclosed in your application or on a website... e.g. 'The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements.'"* — **this exact sentence is not yet in `integrations-oauth.constants.ts`'s `gmail_read` definition** (`apps/api-gateway/src/integrations/integrations-oauth.constants.ts:204-236`, checked against this fetch) | same |
| **What Google's policy requires on revocation** | **Nothing found.** Searched this page end to end for "revoke", "revocation", "disconnect", "delete" — the only hit is: *"You must provide user help documentation that explains how users can manage and delete their data from your app or service."* Google requires the developer to **offer** a way to delete data; it does not itself mandate automatic deletion the moment a grant is revoked. Read plainly: **none of the three options the founder was given is a Google mandate** — the deletion-on-revocation shape (option A) is a product choice this house would be making, not a rule Google is imposing | same |

### 8.2 The CASA / security-assessment requirement this grant already carries

| Question | Answer | Source (fetched 2026-09-05) |
|---|---|---|
| Does a restricted scope require a security assessment? | Yes: *"Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment"* | [developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) |
| Who sets the price, and does Google charge? | *"Google does not charge the developer any fees for security assessment... The cost for such a service is agreed on between the developer and the assessor without any involvement from Google."* Developers are told to "reach out to multiple assessors" | [support.google.com/cloud/answer/13463817](https://support.google.com/cloud/answer/13463817) |
| Market rate, Tier 2 (the tier a scope like `gmail.readonly` typically needs) | TAC Security \$540/yr; Leviathan \$800–1,200; NetSentries \$900–1,500; NCC Group \$1,200+; Prescient \$1,000+; Bishop Fox \$1,500+ | [switchlabs.dev CASA pricing survey](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option) — a third-party market survey, not Google's own price list (Google publishes none) |
| Market rate, Tier 3 | TAC Security \$4,500; Leviathan \$5,000–8,000; NetSentries \$5,500–7,500; NCC Group \$7,000+; Bishop Fox \$8,000+ | same |
| Timeline | Brand verification "2-3 business days"; full restricted-scope verification "can potentially take several weeks"; Tier 2 assessment itself 1–4 weeks, Tier 3 2–8 weeks | [production-readiness/restricted-scope-verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [switchlabs.dev](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option) |
| Renewal | *"The security assessment must be done once a year"* — a full retest, *"whether you have made any changes or not"* | [support.google.com/cloud/answer/13463817](https://support.google.com/cloud/answer/13463817) |

**What this means for retention, obliquely.** The CASA assessment is a
recurring, priced obligation this grant already carries independent of any
retention choice (ADR 0118's own consequences list does not mention it as
outstanding, and it should be added there — see the ADR amendment). It is not
itself a retention rule, but a shorter retention window is one fewer thing an
assessor has to scope into next year's test.

### 8.3 Storage limitation, purpose limitation, and who is the controller

| Regime | Purpose limitation | Storage limitation | Source (fetched 2026-09-05) |
|---|---|---|---|
| **EU GDPR** Art. 5(1)(b)/(e) | "collected for specified, explicit and legitimate purposes and not further processed... in a manner that is incompatible with those purposes" | "kept in a form which permits identification of data subjects for no longer than is necessary for the purposes for which the personal data are processed" | [gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr/) — a consolidated-text mirror, not eur-lex, wording matches the Official Journal |
| **UK GDPR** Art. 5(1)(b)/(e), as amended | "collected... for specified, explicit and legitimate purposes and not further processed by or on behalf of a controller in a manner that is incompatible with the purposes for which the controller collected the data" | same "no longer than is necessary" test, now cross-referencing new Art. 84B (archiving/research/statistics). Amended by the **Data (Use and Access) Act 2025**, in force through 2026-02-05 | [legislation.gov.uk/eur/2016/679/article/5](https://www.legislation.gov.uk/eur/2016/679/article/5) |
| **Türkiye KVKK**, Law No. 6698 Art. 4(2) | data must be "processed for specified, explicit and legitimate purposes" and be "relevant, limited and proportionate to the purposes for which they are processed" | Art. 4(2)(ç): *"Being stored for the period laid down by relevant legislation or the period required for the purpose for which the personal data are processed"* | [kvkk.gov.tr/Icerik/6649/Personal-Data-Protection-Law](https://www.kvkk.gov.tr/Icerik/6649/Personal-Data-Protection-Law) — the official KVKK English translation |
| **CCPA/CPRA**, Cal. Civ. Code §1798.100 | disclosure of "the length of time the business intends to retain each category of personal information... or if that is not possible, the criteria used to determine that period" (§1798.100(a)(3)) | "A business' collection, use, retention, and sharing of a consumer's personal information shall be **reasonably necessary and proportionate** to achieve the purposes for which the personal information was collected" (§1798.100(c)) | [leginfo.legislature.ca.gov, Civ. Code §1798.100](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1798.100.&lawCode=CIV) |

**Every one of the four regimes asks the same question, differently worded:**
retention must be tied to *a stated purpose*, not to a round number chosen for
convenience. A flat "90 days" (option C) satisfies this only if 90 days is
itself derived from a stated purpose (e.g. "the median round-trip of a
procurement conversation is N days, plus a margin") — picked first and justified
after, it is exactly the "plausible default" this repo's cardinal fault already
has a name for (`.planning/decisions/0020-honesty-first.md`; ADR 0118 itself
names the same fault in ten other mail products' merge fields).

**Controller and processor.** GDPR Art. 4(7): the controller is whoever
*"determines the purposes and means of the processing"* — the house, which
decides to connect the grant and decides what the vendor relationship is for.
Art. 4(8): the processor *"processes personal data on behalf of the
controller"* — Mudavym, running the mirror. Art. 28(3)(a) binds the processor to
"documented instructions from the controller"; **Art. 28(3)(g)** is the clause
that reconciles the founder's options: a processor *"at the choice of the
controller, deletes or returns all the personal data to the controller after the
end of the provision of services... and deletes existing copies **unless Union
or Member State law requires storage of the personal data**."* Two consequences
follow directly: (1) whether a mirrored reply is deleted on revocation is, in
GDPR's own words, **the controller's choice** — the house's, not Mudavym's to
decide unilaterally in a consent screen, though the consent screen is where the
house's policy has to be stated; (2) the "unless law requires storage" carveout
is not a hypothetical here — see §8.5.

**GDPR Art. 5(1)(e) is about the vendor's personal data (their name, their
address, the fact that they emailed).** It does not compel deleting the *order
record* that references the reply; it compels not keeping *identifiable personal
data* longer than the stated purpose needs. §8.5 works through what that split
actually means for a `procurement_conversations` row.

### 8.4 What comparable products publish, on retention, revocation and ML training

| Product | On retention | On revocation / disconnect | On training AI/ML on customer mail | Source (fetched 2026-09-05) |
|---|---|---|---|---|
| **Front** | "We retain personal data for as long as necessary to fulfill the purposes for which we collected it" — **no stated day-count**; shared-inbox owners can set a deletion period, and a conversation living in inboxes with different periods gets the **longest** one | deletion is request-driven ("contact us"); the page does not state what happens to already-synced mail the moment a connection is revoked | not disclosed on this page | [front.com/legal/privacy-notice](https://front.com/legal/privacy-notice) |
| **Superhuman** | "as long as necessary to provide our products" — **no stated day-count** | not addressed for a Gmail disconnect specifically | **discloses a per-account toggle**: *"You can decide whether Superhuman can use your user content to train our AI models"*; explicitly "we do not use your user content for marketing or advertising" | [superhuman.com/legal/privacy-policy](https://superhuman.com/legal/privacy-policy) |
| **Zendesk** | the only one of the six with a **published day-count schedule**: deletion process begins "ninety (90) days after your Account... is canceled," then 40–120 days of structured deletion depending on service, 7–130 days for backups, 90–365 for logs | tied to account cancellation, not a per-connection revoke | **trains its own proprietary models on (sanitized) service data by default**, cross-customer, with fields like username/email excluded and an opt-out "available via support request" — third-party LLM features are zero-retention and never train | [Zendesk Service Data Deletion Policy](https://support.zendesk.com/hc/en-us/articles/4408883628954-Zendesk-Service-Data-Deletion-Policy), [Zendesk AI Data Use Information](https://support.zendesk.com/hc/en-us/articles/5729714731290-Zendesk-AI-Data-Use-Information) |
| **HubSpot** | connected-email disconnect instructions say nothing about deleting already-synced mail; the page is mechanical steps only | disconnecting breaks scheduled/sequence sends; **no stated effect on already-logged CRM email history** | **trains HubSpot's own AI models on customer data by default** ("the setting will be turned on"), some models cross-account ("email segmentation, spam detection"); opt-out exists for Super Admins only, and is **prospective only** — a live class-action investigation (Migliaccio & Rathod LLP) is examining exactly this, on the theory that opting out cannot "delete previously used data from trained models" | [knowledge.hubspot.com/account-management/hubspot-ai-mode-training](https://knowledge.hubspot.com/account-management/hubspot-ai-mode-training), [knowledge.hubspot.com/connected-email/disconnect-your-inbox-from-hubspot](https://knowledge.hubspot.com/connected-email/disconnect-your-inbox-from-hubspot), [classlawdc.com HubSpot AI training investigation](https://classlawdc.com/2026/08/26/hubspot-customer-data-ai-training-investigation/) |
| **Gmelius** | account deletion removes data; backups persist **up to 90 days** after that | user can revoke Google access and separately delete the Gmelius account/data; the page does not state what happens to already-synced data if only the Google grant (not the account) is revoked | **explicit Limited Use disclosure, near-verbatim to Google's own sentence**: *"adheres to the Google API Services User Data Policy, including the Limited Use requirements"*; personalization is "specific to your account" and "never used to develop, improve or train generalized" models | [gmelius.com/legal/privacy](https://gmelius.com/legal/privacy) |
| **Streak** | "only retains data as long as it provides value... removes data promptly once it is no longer referenced," and **does not store the email body at all** — it is fetched from the Gmail API on demand each time (metadata only is cached, for indexing) | not addressed on revoke specifically, but the no-body-storage design makes it largely moot for message content | **the cleanest Limited Use statement of the six**: *"Streak does not use Google Workspace API data to develop, improve, or train generalized AI and/or ML models"* | [streak.com/privacy](https://www.streak.com/privacy) |

**The pattern.** Not one of the six publishes a concrete retention *day-count*
for mirrored mail specifically — Zendesk's 90-day schedule is for the whole
account post-cancellation, not per-message. Not one trains a *cross-tenant*
model on raw customer mail content without either explicit sanitization
(Zendesk) or an explicit opt-out (Superhuman, HubSpot) — and the one built like
option B with no opt-out and a default-on switch (HubSpot) is the one now facing
a class-action theory over exactly that shape. The two that store the least
(Streak: no body at all; Gmelius: explicit non-training language) are the two
with nothing to defend later.

### 8.5 The ML angle, honestly

**What Google's policy forbids, regardless of consent, regardless of what the
consent screen says:** a model trained on this house's mirrored mail, or on
mail mirrored across multiple houses, used to improve a **general-purpose**
Mudavym model — the shape §8.1's exception explicitly carves out is a
"personalized model for that specific user['s]... use case," never a shared one.
This is not a policy Mudavym could consent its way around by disclosing it more
prominently: it is a condition of the token, and Google's own enforcement
mechanism is the annual CASA reassessment, not a one-time check.

**What is lawfully learnable, honestly:**
- **Per-house personalization** — e.g. a per-restaurant draft-reply suggestion
  trained only on that restaurant's own mirrored history, never mixed with
  another restaurant's — is inside Google's stated exception and inside GDPR's
  purpose limitation, provided the house consented to that specific use (a
  *third* disclosure beyond "read" and "file it", which nothing in
  `integrations-oauth.constants.ts` states today).
- **Cross-tenant training on the raw mirrored body is not lawfully learnable
  under Google's grant, full stop** — not with better wording on the consent
  screen, not with an opt-out toggle. The `analytics_insights` engine already
  in this codebase (ADR 0118 D4, `rec-forward.ts`) is the closer model: it
  computes from **structured, derived facts** (prices, quantities, dates) the
  house already has a right to hold as its own procurement record, never from
  the vendor's raw prose, and a figure a vendor's reply merely confirms is not
  "using Gmail data to train a model" in the sense Google's clause targets —
  the clause is about the message content, not about a number the house's own
  systems already computed and is now corroborating.
- **What a house-only model would need, as a floor**: (1) training data scoped
  and enforced at the query layer to one `restaurant_id`, the same discipline
  `HouseInboxService.book()` already applies to reading (`house-inbox.service.ts:349-366`);
  (2) a disclosure on the `gmail_read` consent screen naming this specific use,
  not folded into "lands in this restaurant's conversation book"
  (`integrations-oauth.constants.ts:231-234` today says where it lands, not
  what is computed from it); (3) the same per-tenant deletion obligation this
  ADR is already deciding for the raw mail applying to any derived training
  artifact, so revoking consent does not leave a live model trained on data the
  house can no longer read.

### 8.6 The procurement-record angle — reconciling revocation with the house's own paper trail

This is reasoning over what is already in this codebase, not a further external
fetch. `ADR 0118 D10` (`.planning/decisions/0118-the-house-writes-its-own-mail.md:301-326`)
already establishes the load-bearing fact: a house-mailbox reply and a
shared-mailbox reply become **the same kind of row** in `procurement_conversations`,
through the same `RabbitMqBridgeService.handleInboundEmail`. A vendor's reply
confirming a price or a delivery date is not merely "mail" once it lands there —
it is folded into the order's own record, the same way a shared-mailbox reply
already is, and nothing in ADR 0118 treats a house-mailbox row as more deletable
than a shared-mailbox one.

**The reconciliation GDPR Art. 28(3)(g) actually offers (§8.3):** the choice is
the controller's (the house's), and the "unless law requires storage" carveout
is not hypothetical for a restaurant's own vendor correspondence — Türkiye's Tax
Procedure Law No. 213 requires books and supporting records for **5 years**
after the related calendar year, and Turkish Commercial Code Art. 82 requires
commercial books and related documents for **10 years**
([gurkaynak.av.tr Turkey records-retention Q&A](https://www.gurkaynak.av.tr/docs/cc68a-records-retention-turkey.pdf),
fetched 2026-09-05 via search summary — see caveat below); the UK Companies Act
2006 s.388(4) requires **3 years** (private company) or **6 years** (public)
for accounting records
([legislation.gov.uk/ukpga/2006/46/section/388](https://www.legislation.gov.uk/ukpga/2006/46/section/388)).
**Caveat:** the Turkish figures were read from a secondary Q&A (a law firm's own
summary), not from Kanun No. 213 or TTK Art. 82 directly — the primary Turkish
statute text could not be fetched this pass (mevzuat.gov.tr failed the same way
it did on 2026-09-04, per §7 above) — so these two numbers are one step short of
primary-sourced and should be re-verified before anything is built on them.

**What this means in practice: the two options the founder was given are not
actually "delete the mail" vs. "keep the mail" — they are "delete the mail" vs.
"keep the mail," while the *order's own facts* (a quoted price, a confirmed
delivery date, a written commitment) are a different kind of information with
its own multi-year retention floor regardless of which option wins.** A vendor's
"$14.50/case, delivery Thursday" is evidence the house is independently obliged
to keep for years; the surrounding email — greeting, signature block, an
unrelated aside about the vendor's holiday closure — is the part a person's
privacy expectation actually reaches. ADR 0118 D4 already drew this exact line
on the *outbound* side (a figure goes into a letter as the engine's own computed
sentence, never scraped back out of a reply); the same line, run backward, is
the honest answer to "does deleting comply with revocation destroy evidence": no,
**if** what the order needs is captured as a structured fact at the moment the
reply is read (already happening — `analysis.vendor_offers`, ADR 0118 D5) and not
solely as a live copy of the email body.

---

## 9. Sources that could NOT be fetched on 2026-09-05

| Claim | Intended primary source | What happened |
|---|---|---|
| Turkish Tax Procedure Law No. 213 (5-year retention) and TTK Art. 82 (10-year retention), primary statute text | `mevzuat.gov.tr` | Same DNS/TLS failure as 2026-09-04 (§7); read instead from [a Turkish law firm's Practical Law Q&A](https://www.gurkaynak.av.tr/docs/cc68a-records-retention-turkey.pdf), a secondary source |
| Whether HubSpot's connected-email sync counts as a Google Workspace "restricted scope" pull (vs. IMU/forwarding) | HubSpot's own API/scopes documentation | not pursued this pass — the retention/training findings above stand regardless of which ingestion path HubSpot uses, but the Google Limited Use clause only binds HubSpot's ingestion if it is in fact a Workspace API scope, and this file does not confirm that either way |
| Front's Google-specific privacy notice (a named sub-page the main notice links to) | `front.com/legal/front-products-and-services-privacy-notice#google_user_data_privacy_notice` | not fetched this pass; the general privacy notice was fetched instead |
