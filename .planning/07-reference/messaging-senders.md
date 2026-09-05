---
type: reference
title: Messaging senders — provider and channel survey
status: live
updated: 2026-09-04
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
