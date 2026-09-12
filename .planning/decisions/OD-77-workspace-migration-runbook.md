# OD-77 — Personal → company Google account: migration runbook

**Status:** open — brand chosen (**Mudavym**, 2026-08-26); pending domain
registration and Workspace signup.
**Why now:** do this before onboarding a second restaurant. Moving a live mail
domain that is already carrying real vendor traffic is materially harder later —
vendors have the old `From:` address in their address books and reply chains.

**Register note (updated 2026-08-27):** OD-77 and OD-78 are now rows in
[OPEN-DECISIONS.md](OPEN-DECISIONS.md). This runbook itself was committed
2026-08-27 by the register backfill — until then it lived only as an untracked
file in one checkout, one errant clean away from vanishing.

**Related:** OD-27 (founder deferred the `wineops` → Mudavym string
recalibration; that migration and this one should share one sender identity).

---

## What the founder must do vs. what Claude can do

Registering a domain, signing up for Workspace, creating accounts, and creating
the OAuth client all require entering payment details and authenticating as the
founder. **Claude cannot perform these** — the founder drives the console.

Claude does: the `GMAIL_*` re-point, end-to-end verification, the OD-78 auth
guard (which does not exist in code yet — see below), and the ADRs.

---

## Step 0 — Choose the domain

1. **Brand: Mudavym** — decided by the founder 2026-08-26, consistent with
   ADR 0001 and OD-27's end state. Rejected: *WineOps*, which matches the
   current Railway service name and code strings but locks in a name OD-27
   already commits to migrating away from. This becomes the permanent
   vendor-facing sender identity.
   *Remaining:* confirm `mudavym.com` availability at the registrar; fall back
   to `.co` or `getmudavym.com` if taken.
2. **Which registrar?** Recommend **Cloudflare Registrar** — at-cost pricing, no
   upsells, and its DNS is where the TXT verification record in step 1 will live
   anyway. Rejected: Squarespace (ex-Google Domains) and GoDaddy, both of which
   add renewal markup and upsell flows.

**Cost:** ~$10–15/yr domain + Google Workspace Business Starter at $7/user/mo.
Step 4 requires a second admin, so budget **two seats** (~$14/mo).

---

## Step 1 — Google Workspace on the company domain

1. <https://workspace.google.com> → **Get started**.
2. Enter business name, employee count (1–9), region.
3. Choose **"Yes, I have one I can use"** and enter the domain from step 0.
4. Create the first admin user — this becomes the new vendor-facing sender
   address (e.g. `orders@<domain>`). Record it; it goes into `GMAIL_*` later.
5. Pay. You land in the Admin console setup wizard.
6. **Verify the domain:** the wizard shows a TXT record like
   `google-site-verification=<token>`. In Cloudflare DNS → **Add record** →
   Type `TXT`, Name `@`, Content = the full string → Save → back in the wizard,
   **Verify**. Propagation is usually under 5 minutes.
7. Accept the MX records the wizard offers so the domain actually receives mail.

**Find it later:** <https://admin.google.com> → **Account** → **Domains** →
*Manage domains* shows verification state.

---

## Step 2 — Create the Cloud Organization

The organization is created **automatically** the first time a Workspace super
admin visits Cloud Console — there is no "create organization" button.

1. Sign in to <https://console.cloud.google.com> **as the new Workspace admin**
   (not the personal Gmail account).
2. Click the project picker at the top. The org appears as `<domain>` in the
   scope selector.
3. If it does not appear: <https://admin.google.com> → **Account** →
   **Account settings**, confirm the account is a super admin, then reload.

**Find the org ID:** Cloud Console → **IAM & Admin** → **Settings** with the org
selected in the picker.

---

## Step 3 — Move `wineops-vertex-ai` into the org (or start fresh)

**Recommendation: create a fresh project.** Steps 5 and 6 recreate the OAuth
client, topic, and subscription regardless, so migration buys only the old
project's history — and it drags along the personal-account IAM grants this OD
exists to eliminate.

If migrating anyway, you need `resourcemanager.projects.update` on the project
plus `resourcemanager.projectCreator` on the org, then Cloud Console →
**IAM & Admin** → **Settings** → **Migrate** → pick the destination org.

For a fresh project: project picker → **New Project** → set **Location** to the
new organization (not "No organization") → Create. Then **APIs & Services** →
**Enable APIs** → enable **Gmail API** and **Cloud Pub/Sub API**.

---

## Step 4 — Add a second admin

Right now the founder is a single point of failure on production email.

<https://admin.google.com> → **Directory** → **Users** → **Add new user** →
create the user → open it → **Admin roles and privileges** → assign
**Super Admin**. This consumes the second Workspace seat budgeted in step 0.

---

## Step 5 — New OAuth client + Gmail re-consent

1. Cloud Console (new project) → **APIs & Services** → **OAuth consent screen**.
   User type **Internal** (available now that there is a Workspace org — this
   removes the external-app verification requirement and the 7-day refresh-token
   expiry that unverified external apps suffer).
2. Add scopes: `gmail.readonly`, `gmail.send`, `gmail.modify` — match whatever
   the existing client requests.
3. **Credentials** → **Create credentials** → **OAuth client ID** → type
   **Web application** → add the redirect URI the current client uses.
4. Record the **client ID**. The **client secret** is a secret — do not send it
   to Claude; put it straight into Railway.
5. Run the consent flow as the new sender address to mint a refresh token. Put
   `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` into Railway directly.

---

## Step 6 — Recreate topic + push subscription

1. Cloud Console (new project) → **Pub/Sub** → **Topics** → **Create topic**,
   e.g. `gmail-inbound`.
2. Grant Gmail permission to publish: on the topic → **Permissions** →
   **Add principal** → `gmail-api-push@system.gserviceaccount.com` → role
   **Pub/Sub Publisher**. *Without this, Gmail's `watch` call fails.*
3. **Subscriptions** → **Create subscription** → Delivery type **Push**.
4. **Endpoint URL:**
   `https://<gateway-host>/api/v1/communications/webhooks/gmail`
   (current host: `wineopsapi-gateway-production.up.railway.app`; this changes
   if the Railway service is renamed alongside the domain).
5. **Enable authentication** ON → service account: create one under
   **IAM & Admin** → **Service Accounts** (e.g. `mudavym-webhook-auth`, no roles
   needed) → **Audience:** paste the same endpoint URL from step 4.
6. Save, then record the service-account address and the audience string.

---

## Step 7 — Report back

Send Claude, with **no secrets**:

- new sender address
- new OAuth client ID
- new topic name
- new subscription name
- the Pub/Sub service-account address + audience string (for OD-78)

**Stop here.** Claude then re-points the `GMAIL_*` vars, verifies inbound and
outbound end to end, and only then redoes OD-78 against the new subscription.

---

## OD-78 status — read before setting anything

`GMAIL_PUBSUB_SERVICE_ACCOUNT`, `GMAIL_PUBSUB_AUDIENCE`, and
`GMAIL_PUBSUB_REQUIRE_AUTH` **do not exist anywhere in the codebase** (verified
2026-08-26). The webhook at
[communications.controller.ts:974](../../apps/api-gateway/src/communications/communications.controller.ts)
is still `@Public()` with no OIDC verification — only
`GMAIL_PUBSUB_TOPIC` is read, in
[gmail-watch.service.ts:41](../../apps/api-gateway/src/communications/gmail-watch.service.ts).

Consequences:

- Setting those Railway vars today is inert — nothing reads them.
- OD-78 is **not closeable** by console configuration alone; it needs the
  verification guard written first.
- Doing OD-77 first discards any OD-78 console work anyway, since step 6
  recreates the subscription under a new project.

**Order: OD-77 console work → re-point and verify → write the guard → OD-78.**
