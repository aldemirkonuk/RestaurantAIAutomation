---
type: reference
title: Meta Tech Provider registration checklist
status: draft — nothing submitted
updated: 2026-09-05
links: ["[[0121-the-houses-text-sender]]"]
---

# Meta Tech Provider — the registration checklist, for the founder to execute

**Nothing on this page has been done.** No Meta app was created, no business submitted
for verification, no App Review filed, no customer onboarded, no message sent. This is a
document that says what Meta asks for so a person can work through it. Every fetch behind
it is logged in `p4-scratch/p4bc-fetch-log.md`, all on 2026-09-05, all from
`developers.facebook.com`, whose `robots.txt` is `User-agent: * / Allow: /`.

**Retire-to-write.** This supersedes [ADR 0121](../decisions/0121-the-houses-text-sender.md)
§"The registration playbook, per path, per market" → "WhatsApp Business (Cloud API)" — the
two-column table there is absorbed here and corrected in three places (§0 below). The ADR
row stays where it is with a pointer; it is not deleted, because the ADR's *decision* rests
on it.

---

## 0. What this pass changed about what we believed

Four corrections and two findings, all measured against the pages fetched today.

| Was believed (ADR 0121, 2026-09-05) | What the docs say today | Why it matters |
|---|---|---|
| "Mudavym registers directly with Meta as a Tech Provider … houses' own WABAs under Mudavym's app" — with the billing question left open | **A Tech Provider has no credit line and cannot invoice for API usage.** "Unlike Solution Partners, however, Tech Providers do not have credit lines. Instead, clients onboarded by Tech Providers must provide their own payment method after onboarding is complete. Meta will then bill these clients for API usage, and the Tech Provider will bill for other services." | This **answers half of OD-23 by construction**. On the WhatsApp leg, bring-your-own-billing is not one of two options the founder picks between — under Tech Provider it is the only one Meta offers. Mudavym credits can cover the SMS leg and the platform fee; they cannot cover a WhatsApp message. See fork Q1 in the report. |
| The binding cap is "a Meta business portfolio is capped at 2 phone numbers, raisable to 20 … 20 houses would be the ceiling" | Both caps are real — "Meta Business Accounts are initially limited to 2 registered business phone numbers, but this limit can be increased to up to 20" **and** "initially limited to 20 WABAs" — but under the Tech Provider shape **they bind the house, not Mudavym**, because each house owns its own portfolio and WABA. The cap that binds **Mudavym** is a different one nobody had found: **Embedded Signup onboards at most 10 new business customers in a rolling 7-day window**, rising to **200 per rolling 7 days** after Business Verification + App Review + Access Verification, and above that requires applying to become a Meta Business Partner. | The ADR's "20 houses" ceiling was the right worry pointed at the wrong number. The real first ceiling is **10 houses a week**, and it is a throughput limit on onboarding rather than a total. |
| "App Review for advanced access" as a single prerequisite | App Review is **step 2 of 2**; **Business Verification is step 1 and gates it** — "Your business must be verified before you can start the app review process." App Review itself averages **about 24 hours** turnaround. | The long pole is Business Verification, not App Review. Sequencing matters: the video evidence App Review wants can be recorded while verification is pending, but cannot be *submitted*. |
| Embedded Signup, unversioned | **Embedded Signup v2 is deprecated on 2026-10-15**; integrations must move to **v4**. | Six weeks from today. Anything built against v2 is built against a dead interface. |

Two findings with no prior belief to correct:

- **Asset ownership is unconditional and cannot be restricted.** "Business customers
  onboarded via Embedded Signup own all of their WhatsApp assets" and have full access to
  WhatsApp Manager — "Note that you cannot restrict this access in any way." This is the
  strongest possible confirmation of ADR 0114's shape, from the platform rather than from us.
- **A sandbox exists and messages cannot leave it.** A claimed sandbox account returns a
  real WABA ID, phone number ID and token code, is valid 30 days, and "the business phone
  number cannot be used to send or receive messages." That is the only environment in which
  the onboarding half of this can be exercised without a real house.

---

## 1. Prerequisites (before anything is filed)

| # | Item | Where | Notes |
|---|---|---|---|
| 1.1 | A **Meta app** with the **WhatsApp use case**, of type **Business** | App Dashboard → Create an app | Type matters: the Embedded Signup Integration Helper "is available only for Business-type apps." |
| 1.2 | A **business portfolio** connected to the app | Can be created during app creation | |
| 1.3 | App **basic settings**: app icon, **privacy policy URL**, app category | App Dashboard → Basic settings | Named by the Tech Provider guide as an App Review prerequisite. |
| 1.4 | Decide: onboard **with** a Solution Partner, or **without** | Tech Provider onboarding panel | With a partner you supply their app ID and gain an extra App Review step ("Create a partner solution"); the partner's credit line is what makes customer-bypasses-payment possible. Without, each house pays Meta itself. This is fork Q1. |

## 2. Step 1 — Business Verification (blocks everything after it)

App Dashboard → **Use cases → Customize** (pencil) → **WhatsApp** → **Tech Provider
onboarding** → **Start verification**.

What Meta says it asks for, quoted from the developer docs (the Help Center article that
expands this is `www.facebook.com/business/help/2058515294227817`, which is
`Disallow: /` to automated readers and was **not** fetched — so this list is the developer
docs' own enumeration and may be shorter than what the form actually shows):

1. **Verify business details** — business name, address, phone number, email, website.
2. **Confirm your connection** — choose a channel through which Meta contacts you to
   confirm you are connected to the business.
3. **Upload documents** — "You might need to upload accepted documents to confirm these
   details if your business is not found."

Timeline: **not stated on any page fetched this pass.** ADR 0121 carries "can take several
weeks" from its 2026-09-04 fetch; that figure is not re-confirmed here and is marked as
inherited rather than re-measured.

**Gate:** verified business → step 3 unlocks. Until then App Review cannot be started.

## 3. Step 2 — App Review, for Advanced access

Two permissions, both required to be a Tech Provider:

| Permission | Why it is required | What the submission must contain |
|---|---|---|
| `whatsapp_business_messaging` | "required to send messages on behalf of your clients" | **Written:** what messaging functionality the app offers to onboarded clients and how they perform it. **Video:** the app being used to send a WhatsApp message, *and* the WhatsApp client receiving and displaying it. |
| `whatsapp_business_management` | "required to access your clients' WABAs. Without it, API calls that use this permission on WABAs not owned by your business return error code `200`" | **Written:** how the permission is used to reach onboarded clients' business assets. **Video:** the app — or WhatsApp Manager — being used to **create a message template**. |

Rules that decide pass or fail, quoted:

- "requesting unnecessary permissions is a common reason for rejection."
- "Do not submit a video that includes multiple permissions supporting different use
  cases. You must submit a different video clip for each permission."
- Both a written description **and** a screen recording are required per permission;
  a recording without a description "will be rejected."
- "you cannot submit a screenshot, you must submit a screen recording."
- "Submissions in draft mode will not be reviewed."
- Turnaround: **about 24 hours** on average.

**Substitutes accepted, if the app is not ready:** a screen recording of the **API Setup**
cURL script sending to a test recipient number, in place of the app's own send; and a
recording of **WhatsApp Manager** creating a template, in place of the app's own template
screen. Both are named as acceptable by the Tech Provider guide. This matters here because
`TextSenderService` refuses every send today — the substitutes are the only route until a
transport exists.

**What Advanced access changes.** While the app is in development mode the permissions
appear in Embedded Signup to anyone with an admin/developer/tester role on the app. Once
the app goes live, **only permissions approved for Advanced access appear at all**, so a
house cannot grant what was not approved.

## 4. What Mudavym must display and hold

- A **privacy policy URL** on the app's basic settings (1.3).
- A **callback URL** for webhooks. "all webhooks for all of your onboarded business
  customers will be sent to your app's callback URL" unless overridden per-WABA or
  per-number. One endpoint, many tenants — so the handler must resolve the tenant from the
  payload and never from a parameter.
- A **webhook subscription per onboarded WABA.** "you must subscribe your app to webhooks
  on the WABA of each business customer who completes the flow." This is a step in the
  onboarding sequence, not a global setting.

## 5. The onboarding sequence, per house

From the Embedded Signup document, in order:

1. The house clicks the launcher in Mudavym and authenticates **in Meta's window** with
   its own Meta credentials. Mudavym never sees a password and has no field for one.
2. The house accepts terms for Cloud API, WhatsApp Business, Meta, Marketing Messages Lite
   API, and Meta Business Tool Terms; selects or creates a business portfolio; selects or
   creates a WABA; enters and verifies its business phone number; enters a display name.
3. On success the flow returns, to the launching window, **the WABA ID, the business phone
   number ID, and an exchangeable token code**.
4. Mudavym's **server** then, server-to-server: exchanges the code for a
   customer-scoped **business token**; registers the number for Cloud API use; subscribes
   the app to webhooks on that WABA. (Sharing a credit line is a fifth step and is
   **Solution Partners only**.)
5. **Billing.** Tech Provider: the house "must add a payment method to their WhatsApp
   Business account" before it can send. Meta bills the house for API usage; Mudavym bills
   for everything else.

Constraints on the number the house brings:

- Registered for **Cloud API only**.
- A number already on the **WhatsApp Business app** *is* supported, but only through a
  customised flow ("WhatsApp Business app user onboarding") — it is not the default path.
- **Existing WABAs originally created via a developer app cannot be onboarded through
  Embedded Signup at all.**
- Optional: up to two **555 numbers** (+1, 555 area code, auto-verified, display name must
  be approved before sending, cannot be migrated out).

Token type: **business tokens exclusively**, for a Tech Provider. A system user token is a
Solution Partner instrument for credit-line sharing and has no role here.

## 6. Messaging limits the house will hit

Limits are **per business portfolio**, shared across every number in it, counted as unique
recipient numbers messaged **outside** an open customer service window in a moving 24 hours.

- New portfolio: **250**.
- **2,000** by completing one scaling path: verify the business; have a partner verify it
  (Select/Premier Solution Partners only — not a Tech Provider); or deliver 2,000
  out-of-window messages to unique numbers in 30 days on high-quality templates.
- Then **10,000 → 100,000 → unlimited** by automatic scaling, which needs high message
  quality *and* "in the last 7 days, your business has utilized at least half of your
  current messaging limit". A level rises within 6 hours when both hold.

Read the field via the Phone Number API as
`whatsapp_business_manager_messaging_limit` (returns e.g. `"TIER_250"`).
`messaging_limit_tier` is **deprecated** — a read of it is not a read of the limit.

## 7. What a message costs, and what this pass could not learn

- Charged **per message**, since 2025-07-01, and **only when a template is delivered**.
- **All non-template messages are free**, and can only be sent inside an open 24-hour
  customer service window.
- **Utility templates inside an open window are free.** Marketing templates are charged
  on every delivery. Everything is free for 72 hours inside a free-entry-point window.
- Rates vary by template category, volume tier and recipient country code. Meta may change
  them **only on the 1st of a quarter**, with 1 month's notice for a rate-card update,
  3 months for a pricing model add-on, 6 months for a pricing model change.
- **No rate is stated here.** The rate cards are published at
  `business.whatsapp.com/products/platform-pricing#rates`, and that host disallows this
  agent. A figure is not invented to fill the gap. The design consequence is recorded in
  the credits ledger: **cost comes from the provider's own report of it, or stays NULL.**

## 8. The order to do it in

1. Create the Business-type Meta app with the WhatsApp use case and a portfolio (§1).
2. Fill in basic settings including the privacy policy URL (§1.3).
3. Decide with/without a Solution Partner (§1.4) — this is the OD-23 fork, decide it first.
4. **Start Business Verification** (§2). It gates everything and its timeline is unknown.
5. While it is pending: claim a **sandbox account**, build against **Embedded Signup v4**
   (v2 dies 2026-10-15), record the two App Review videos, stand up the webhook callback.
6. When verification lands: **submit App Review** for both permissions, separately or in
   one bulk submission, with one video and one description each (§3).
7. On approval: switch the app live, onboard the first house through Embedded Signup, and
   walk it through adding its own payment method (§5.5).
8. Only then does a `connected` row in `house_text_senders` mean anything, and only then
   may a probe move a row into it.
