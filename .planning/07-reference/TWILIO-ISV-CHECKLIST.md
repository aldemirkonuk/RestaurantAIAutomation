---
type: reference
title: Twilio ISV registration checklist
status: draft — nothing submitted
updated: 2026-09-05
links: ["[[0121-the-houses-text-sender]]"]
---

# Twilio ISV — the registration checklist, for the founder to execute

**Nothing on this page has been done.** No Twilio account was created, no Customer
Profile filed, no Brand registered, no Campaign submitted, no number hosted, no Sender ID
requested, no message sent. This is a document that says what Twilio and the registrars
ask for so a person can work through it.

Every Twilio fact below came from **Twilio's own documentation MCP server**, queried
2026-09-05, not from crawling `twilio.com` — that host publishes
`Content-Signal: ai-train=no, search=yes, ai-input=no`, and the MCP server is the channel
Twilio publishes for agents. Each row names the canonical `twilio.com` URL so a person can
open the page normally. Queries are logged as M1–M8 in `p4-scratch/p4bc-fetch-log.md`.

**Retire-to-write.** This supersedes [ADR 0121](../decisions/0121-the-houses-text-sender.md)
§"SMS, United States (10DLC)" and §"SMS, Türkiye (alphanumeric Sender ID)" as the working
checklist, and it **corrects the fee figures** in ADR 0121 and in
[`messaging-senders.md`](messaging-senders.md) §2 (see §0). The ADR sections stay in place
with a pointer here; the decision they support is unaffected — every correction makes the
per-house registration *cheaper to start and more constrained in shape*, which is the
direction the decision already went.

---

## 0. What this pass changed about what we believed

| Was believed | What Twilio's docs say today (MCP, 2026-09-05) | Effect |
|---|---|---|
| US 10DLC: "$44 one-time brand registration (Standard), $4 (Low-Volume Standard or Sole Proprietor); $15 one-time campaign vetting" | **$4.50 one-time to register any Brand with TCR**, plus **$41.50 one-time Standard Brand vetting**, charged automatically during Standard Brand registration. Additional: **$11** brand appeal (Standard vetting rejections only), **$12.50** Authentication Plus, **$66–$96/yr** political vetting. Campaign fees are monthly and Twilio's docs point at a support article for the table rather than stating figures. | The two-part structure was collapsed into one number and the $15 "campaign vetting" line does not appear in current docs at all. Any figure shown to a house must be **dated and sourced**, which is why `fee_stated` is text and not numeric. |
| Bring-your-own-number works per market | **Hosted SMS supports US and Canada only**, and **mobile numbers are not supported** — only voice-enabled landline and toll-free numbers a business already owns. A number already in a Twilio account for voice cannot be hosted on another Twilio account for messaging. | The "house brings its own number" path for SMS **does not exist outside US/CA**. In Türkiye the equivalent is a Sender ID on paperwork, not a hosted number, and it is one-way. `house_text_senders.path='bring_your_own'` is therefore not uniformly available and the catalogue must say so per market. |
| A brand is registered per house, unbounded | **Each tax ID may register up to five Standard / Low-Volume Standard Brands**, and **each Brand may register up to five Campaigns** (more only with "a clear and valid business reason"). | Not a Mudavym-side cap — each house has its own tax ID — but a real cap for a house that already uses its EIN elsewhere. Worth asking at request time. |
| STOP is handled for us | For **alphanumeric Sender IDs**: "Twilio's SMS **STOP** keyword does **not** work to automatically stop Alphanumeric Sender ID messaging. You must provide other instructions". | In Türkiye the opt-out cannot be a reply. It has to be a phone number, an address, or a page — carried **in the message body**, and recorded by us when exercised. This is a product obligation the transport will not discharge. |

One finding with no prior belief to correct: the Trust Hub alphanumeric registration form
asks, in as many words, **"Will you subassign this alphanumeric sender ID to your end
customers?"** and **"Are you a Direct or Independent Software Vendor (ISV), reseller,
partner?"** — the ISV shape is a first-class answer on the form, not a workaround.

---

## 1. The account shape, decided before anything is filed

Twilio enumerates six ISV architectures and **three of them cannot do A2P 10DLC at all**
(`twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv`).

| | #1 | #2 | #3 | #4 | #5 | #6 |
|---|---|---|---|---|---|---|
| Subaccounts? | yes | yes | yes | no | no | no |
| Subaccounts mapped to individual customers? | **yes** | no | yes | — | — | — |
| Messaging Services? | **yes** | yes | no | yes | yes | no |
| Messaging Services mapped to customers? | — | yes | — | yes | no | — |
| Verdict | **preferred** | works, shared blast radius | **incompatible** | works, shared blast radius | **incompatible** | **incompatible** |

**Take #1: one subaccount per house, one Messaging Service per use case.** Twilio's stated
reason is the one that matters here — "the messaging traffic for each customer is separated
by subaccounts. This allows for easier analytics tracking and minimizes the impact of any
potential noncompliant traffic from one customer on the rest of your customers." Under #2
and #4, "if one customer sends noncompliant traffic, Twilio may need to suspend the primary
Account of that customer", which can take compliant houses down with it.

One warning to note before it bites: restructuring **into** subaccounts later "resets the
opt-out mechanisms that Twilio manages because these settings apply at the Account level."
An opt-out list must be exported and re-applied across a restructure. Choosing #1 now
avoids ever performing that migration with real opt-outs in it.

Per house, under #1:
- Create a **Secondary Customer Profile** under the house's subaccount.
- Register a **Brand** under the house's subaccount.
- Register **Campaigns**, one Messaging Service each, same subaccount.

For Mudavym's own traffic (if any): a **Primary Customer Profile**, a Brand, and Campaigns
under the primary account.

## 2. Prerequisites on Mudavym

| # | Item | Notes |
|---|---|---|
| 2.1 | A paid Twilio account (not trial) | Alphanumeric Sender IDs "are only supported for paid Twilio accounts". |
| 2.2 | A **Primary Business Profile** in Trust Hub with status **`Twilio Approved`** | Business Type: **`ISV Reseller or Partner`**. Record its SID — every later ISV call needs it. |
| 2.3 | Decide whether Mudavym subassigns Sender IDs to houses | The Trust Hub alphanumeric form asks directly. |

**Whose identity goes on the registration: the house's, always.** "When creating Secondary
Customer Profiles and registering Brands for your customer, remember to fill in the
business details of that specific customer. Use that customer's details rather than your
own ISV's details." And on the website field: "If you are an ISV registering secondary
customers, the website provided in this registration must be that of the secondary
customer's brand, NOT the ISV as a business entity." This is the same rule ADR 0121 derived
from the regulatory-bundle requirement, stated a third independent way.

## 3. United States — A2P 10DLC, per house

### 3a. Brand type

| | Sole Proprietor | Low-Volume Standard | Standard |
|---|---|---|---|
| Who | US/CA businesses **without** an EIN or Canadian Business Number | has a tax ID, < ~6,000 segments/day | has a tax ID, above that |
| Campaigns per Brand | 1 | up to 5 | up to 5 |
| Daily volume | 1,000 segments/day to T-Mobile (~3,000 across carriers) | 2,000 to T-Mobile (~6,000 across carriers) | 2,000 → unlimited, by Trust Score |

A restaurant that is an LLC **has an EIN and is therefore ineligible for Sole Proprietor**,
"even if they have a 'Sole Proprietorship' LLC for IRS purposes". Twilio's warning to ISVs
is worth quoting to a house before it self-reports: if a customer declares Sole Proprietor
eligibility "but are subsequently found to have an EIN or equivalent Tax ID, their Campaign
registration will error, and you or they will need to pay all associated fees and re-do
their registration". A house outside the US/CA sending **to** US numbers must register
Standard or Low-Volume Standard.

### 3b. Fees (Twilio, 2026-09-05 — quote the date with the number, always)

| Fee | Frequency | Cost |
|---|---|---|
| Brand registration with TCR | one-time | **$4.50** |
| Standard Brand vetting (auto-charged during Standard registration) | one-time | **$41.50** |
| Brand appeal (Standard vetting rejections only) | per request | **$11** |
| Authentication Plus (public, for-profit brands) | per request | **$12.50** |
| Political vetting | yearly | **$66–$96** |
| Campaign | **monthly**, varies by use case | figure not stated in the docs pages returned; Twilio points at a support article |
| The number itself | monthly | not stated on the pages returned |

**Recurring, and per house.** The campaign fee and the number rental do not amortise across
tenants — that is the fact that makes "Mudavym registers for you" a standing cost rather
than an onboarding favour, and it is the reason OD-23 exists.

### 3c. What the house must supply, field by field

Business identity (creates the Primary Profile **and** the TrustProduct in Trust Hub):

1. Legal business name **exactly as registered with the tax agency** — "provide precise and
   current information that matches how you registered with your country's tax agency."
   It feeds the TCR Trust Score, which sets throughput and daily limits.
2. EIN / tax ID, business type, business industry, registered address.
3. A **live, publicly reachable website** that "loads without authentication and clearly
   identifies your business name, contact information, and products or services", explains
   the messaging use case, and matches the business name. A generic landing page, a login
   wall or a 404 is a rejection.
4. A named authorised contact: first name, last name, corporate email (a real domain, "cannot
   be a disposable address"), phone.

Campaign, per use case:

| Field | Constraint |
|---|---|
| `description` | 40–4,096 chars. Who sends, who receives, why. |
| `message_samples` | **2–5** samples, each 20–1,024 chars. Must match the use case, **identify the brand by name and/or website**, carry opt-out language, and bracket `[conditional]` content. |
| `message_flow` | **40–2,049 chars.** Every opt-in path, all of them in this one field. Must link the **privacy policy** and the **terms**. |
| `opt_in_keywords`, `opt_in_message` | required when keyword opt-in is offered; `opt_in_message` 20–320 chars and must carry brand name, enrolment confirmation, message frequency and opt-out instructions |
| `help_message`, `opt_out_message` | 20–320 chars each, required when handling help/opt-out independently rather than using Twilio's defaults |
| `us_app_to_person_usecase` | must exactly match a listed use case and align with the description and samples |
| `has_embedded_links` | boolean |

Policy pages the house must actually publish:

- A **privacy policy** stating mobile numbers are **not shared with third parties**, plus
  message frequency and a "message and data rates may apply" disclosure.
- **Terms** carrying HELP and STOP instructions.
- If opt-in happens behind a login, a **publicly accessible URL hosting screenshots** of
  the whole consent flow.

Two rules that bind product design and not just paperwork:

- **English only.** "A2P 10DLC campaigns must be submitted in English" (error 30910) —
  description, `message_flow`, samples. A Turkish-language crew text registered for US
  delivery needs an English translation in the registration fields.
- **Consent may not be a condition.** A registration is rejected if opting in is required
  to buy or to hold an account. This is why `person_text_consents` is a separate,
  withdrawable row and never a column on `team_members`.

### 3d. Timeline and the failure mode

Nothing sends before the Campaign is approved; unregistered US traffic is blocked with
**error 30034**. ADR 0121 records **13–20 business days** end to end (brand minutes to 3–5
days, campaign 10–15) from its 2026-09-05 fetch; **this pass did not re-measure that** and
it is carried as inherited.

## 4. Bringing an existing number — Hosted SMS

**US and Canada only, and mobile numbers are not supported.** The number keeps its voice
provider; only SMS routes through Twilio.

Eligibility, checkable before submitting: run **Lookup**; a number whose `carrier.type` is
not `mobile` is eligible, and a toll-free number with `type: null` "generally" is. Twilio
also exposes a bulk eligibility endpoint returning `eligibility_status`
(`eligible` / `ineligible`), an `eligibility_sub_status`, an `ineligibility_reason` and a
`next_step` — worth calling before asking a house for anything.

The order, with the statuses a house will see:

`twilio-processing` → `received` → `pending-verification` → `verified` → `pending-loa`
→ `carrier-processing` → `testing` → `completed` (and `action-required` / `failed`).

1. Create the Hosted Number Order. Eligibility is checked here; failure names the reason
   (already hosted, unsupported country, mobile type).
2. **Ownership verification by phone call.** Twilio calls the number and the person
   answering reads back a security token. The code is valid **10 minutes**; the call prompts
   four times; **three attempts** maximum before the order goes `action-required`, and more
   than **7 days** in `action-required` fails it permanently — a new order is then required.
3. **Letter of Authorization**, signed electronically via HelloSign by the person who
   answered the verification call. An Address object must exist first, with the business as
   friendly name and the authorised decision-maker's first and last name.
4. Carrier processing: **up to one business day** for a landline, **2–3 business days** for
   toll-free. Being the toll-free RespOrg lets you accept Twilio's request and speed it up.
5. `testing` proves inbound connectivity, then `completed` / `in-use`.

Two operational notes worth having before they surprise someone: a Hosted Number can be
moved from the parent account to a subaccount **only through the Subaccounts API**, not the
Console — relevant to architecture #1 above. And a **full port** (voice + messaging) mints a
**new phone number SID**, leaving two records with the same E.164 value, so the SMS webhook
must be reconfigured on the new SID or inbound goes dark.

## 5. Türkiye — alphanumeric Sender ID

**This is paperwork, and it is one-way.** No API call registers it; no reply can come back.

Documents each house must produce, on **its own letterhead**, signed by an authorised
signatory and **stamped**:

- Company / Brand Registration Certificate
- Customer-to-Twilio **LOA** — it "authorizes Twilio, Inc., to register and send branded
  SMS messages on your company's behalf"
- Customer-to-Twilio **Authorization Letter**
- **NOC Letter**

Required fields on the forms: the sender company's letterhead; the Sender ID requested; the
legal company name; the name and title of the authorised signatory; the signature; the
company stamp; the date. Twilio ships annotated examples and says outright that "mobile
network carriers are very strict about the details".

Refusals, stated to a house **before** it applies:

- Promotional traffic is not allowed.
- A Sender ID resembling a domain name is not allowed.
- P2P, gambling, political and religious content is prohibited.
- **From 2026-04-01, a company without a local Turkish entity may not put a URL in a
  message to a Turkish number.**
- If the Sender ID does not match the company name, a formal document (trademark
  registration, official website) is required to show the linkage.

Format: **11 characters** maximum, upper/lower ASCII letters, digits 0–9, spaces, at least
one letter. Some carriers impose a **minimum** length too, and a Sender ID that fails it may
be silently replaced by a generic "unknown".

Consequences that reach the product, not just the filing:

- **One-way.** "recipients cannot reply." Nothing on any surface may thread a reply.
- **STOP does not work.** Twilio's automatic STOP handling does not apply to alphanumeric
  senders; the opt-out instruction must be carried in the message body (a support address, a
  phone line, another number to text) and honoured by us when exercised.
- Sending with an unregistered or non-matching sender fails with **error 30041 / 30042**;
  matching is **case-sensitive**.
- **Not available in the US or Canada at all** — the constraint already enforced by
  `house_text_senders_alpha_not_us`.
- **İYS** (prior consent registered under Law 6563) is still the weakest citation in this
  corpus. It was not established on 2026-09-04, 2026-09-05 or in this pass, and it must be
  closed before any Turkish sender goes live.

Provisioning: ADR 0121 records about two weeks; **not re-measured this pass**.

## 6. United Kingdom

**Not established this pass.** The MCP returned the global alphanumeric rules and Türkiye's
country article; no UK-specific page came back, and the global rules do not tell you whether
the UK requires pre-registration. The country matrix Twilio maintains
(`help.twilio.com` — "International support for Alphanumeric Sender ID") is the page to read
before a UK sender is offered. This row is left empty rather than filled in from the global
rules, because "no registration required" and "we did not check" render identically to a
house and only one of them is true.

## 7. The order to do it in

1. Choose architecture **#1** (§1) — before any subaccount exists, because restructuring
   later resets opt-outs.
2. Create the **Primary Business Profile**, Business Type `ISV Reseller or Partner`, and get
   it to `Twilio Approved` (§2.2).
3. Per house, per market:
   - **US:** subaccount → Secondary Customer Profile → Brand → Campaign → Messaging Service.
     Collect §3c before starting; the website and `message_flow` are the two fields that
     reject.
   - **US/CA bring-your-own-number:** run the eligibility check first (§4), then the Hosted
     Number Order.
   - **TR:** send the house the four documents, wait for wet signatures and a stamp, submit,
     and set the surface to say one-way with a body-carried opt-out.
   - **UK:** read the country matrix first (§6).
4. Nothing in this repo submits any of it. `POST /communications/text-senders/request`
   records a request with its fee and timeline; there is no route that moves a row to
   `submitted`, because submitting puts a house's legal identity in front of a registrar and
   that is a sealed act nobody has built yet.
