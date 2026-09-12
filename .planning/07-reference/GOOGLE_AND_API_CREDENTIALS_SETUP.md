# Google & API credentials — setup from scratch

Step-by-step guide to rotate or create credentials for WineOps.  
After each section, run the audit script to confirm:

```bash
node scripts/audit-api-credentials.js
```

**Never commit `.env` files or paste keys into chat/Slack.**

---

## What goes where (quick map)

| Variable | Used by | Purpose |
|----------|---------|---------|
| `GOOGLE_API_KEY` | agent-orchestrator (Python) | Gemini — AI drafts, crawlers, research |
| `VITE_GOOGLE_MAPS_API_KEY` | web (Vercel) | Address autocomplete on signup/settings |
| `GMAIL_CLIENT_ID` | api-gateway | Gmail OAuth — send mail |
| `GMAIL_CLIENT_SECRET` | api-gateway | Gmail OAuth — send mail |
| `GMAIL_REFRESH_TOKEN` | api-gateway | Gmail OAuth — long-lived send access |
| `GMAIL_SENDER_EMAIL` | api-gateway | Hint only; real From comes from Gmail profile |
| `GMAIL_APP_PASSWORD` | api-gateway | Optional SMTP fallback if OAuth fails |
| `GMAIL_PUBSUB_TOPIC` | api-gateway | Optional — inbound email watch (advanced) |

**Files to update locally:**

- Root `.env` — shared dev defaults
- `apps/api-gateway/.env` — **required for Gmail** (`gmail-reauth.js` reads this file)
- `services/agent-orchestrator/.env` — Python agents + `GOOGLE_API_KEY`

**Production:** set the same names on **Railway** (api-gateway + agent-orchestrator) and **Vercel** (maps key only).

---

# Part 1 — Google (from scratch, baby steps)

## Step 0 — Pick one Google account

Use **one** Google account you control for admin work (e.g. your WineOps sender Gmail).  
You will sign in with this account many times in Cloud Console and OAuth screens.

---

## Step 1 — Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Top bar → project dropdown → **New project**.
3. Name it e.g. `WineOps Production` → **Create**.
4. Make sure that project is **selected** in the top bar before continuing.

---

## Step 2 — Enable the APIs you need

In the same project: **APIs & Services → Library**. Search and **Enable** each:

| API | Needed for |
|-----|------------|
| **Gmail API** | Sending (and optional inbox watch) |
| **Generative Language API** (Gemini) | AI drafts, agents, crawlers |
| **Places API (New)** | Maps autocomplete in the web app |
| **Maps JavaScript API** | Loads the Maps JS library in the browser |

You can enable more later; these four cover WineOps today.

---

## Step 3 — OAuth consent screen (required for Gmail)

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (unless you have Google Workspace and want Internal).
3. Fill **App name** (e.g. WineOps AI), **User support email**, **Developer contact email** → Save.
4. **Scopes → Add or remove scopes** → add:
   - `.../auth/gmail.send`
   - `.../auth/gmail.readonly`
   - `.../auth/gmail.modify` (used by re-auth script; safe to include)
5. **Test users** → **Add users** → add the **exact Gmail address** that will send mail (e.g. `wineops.ai@gmail.com`).
6. Save.

> While the app is in **Testing**, only test users can authorize. For production-wide use you later **Publish** the app (Google review may apply).

---

## Step 4 — Create OAuth client for Gmail (Web application)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application** (not Desktop, not iOS).
3. Name: e.g. `WineOps Gmail`.
4. **Authorized redirect URIs** → Add:
   - `http://localhost:3001/oauth2callback`  
     (required for `scripts/gmail-reauth.js`)
5. **Create**.
6. Copy **Client ID** and **Client secret** (you will not see the secret again — save in a password manager).

Put in **`apps/api-gateway/.env`** (and root `.env` if you use it):

```env
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_SENDER_EMAIL=your-sender@gmail.com
```

Do **not** wrap values in quotes unless your editor adds them; the re-auth script strips quotes.

---

## Step 5 — Mint a refresh token (local script)

1. From repo root:

   ```bash
   node scripts/gmail-reauth.js --email=your-sender@gmail.com
   ```

2. Browser opens → **choose the sender Gmail** (use incognito if the wrong account appears).
3. Click **Allow** on all Gmail permissions.
4. Browser shows “Authorization successful” → switch to **terminal**.
5. Copy the full line:

   ```text
   GMAIL_REFRESH_TOKEN=1//0g...
   ```

6. Paste into **`apps/api-gateway/.env`** (replace old value).  
   Optionally mirror to root `.env` and Railway **api-gateway** service.

7. **Redeploy** api-gateway on Railway so production picks up the new token.

**If you see `unauthorized_client`:** redirect URI missing or client is not “Web application” — redo Step 4.  
**If you see `invalid_grant` after success:** old token still in `.env`, or client id/secret don’t match the client that minted the token.

**Verify:**

```bash
node scripts/audit-api-credentials.js
```

Gmail OAuth should show **OK**.

---

## Step 6 — Gemini API key (AI / agents)

Your audit may show: *“API key was reported as leaked”* — you must **create a new key** and **delete/disable** the old one.

### Option A — Google AI Studio (simplest)

1. Open [Google AI Studio → API keys](https://aistudio.google.com/app/apikey).
2. **Create API key** → tie to your Cloud project from Step 1.
3. Copy the key once.

### Option B — Cloud Console

1. **APIs & Services → Credentials → Create credentials → API key**.
2. **Restrict key** → API restrictions → only **Generative Language API**.
3. For server-only use: **Application restrictions → IP addresses** (Railway egress IPs if known) or leave unrestricted only during dev (rotate before prod).

Put the **same** key in:

```env
# services/agent-orchestrator/.env
GOOGLE_API_KEY=AIza...

# root .env (if you run tools from root)
GOOGLE_API_KEY=AIza...
```

Also set on **Railway → agent-orchestrator** → redeploy.

**Verify:** audit line `Google Gemini API` → **OK**.

---

## Step 7 — Google Maps / Places (web app)

This is a **separate** key from Gemini — browser keys need **referrer** restrictions.

1. **Credentials → Create credentials → API key**.
2. Name it e.g. `WineOps Maps (browser)`.
3. **Edit key → Application restrictions → HTTP referrers**:
   - `http://localhost:*/*`
   - `http://127.0.0.1:*/*`
   - `https://restaurant-ai-automation-web.vercel.app/*`
   - `https://*.vercel.app/*` (preview deploys)
4. **API restrictions** → restrict to:
   - Maps JavaScript API
   - Places API (New)

Set in **Vercel** (Project → Settings → Environment Variables):

```env
VITE_GOOGLE_MAPS_API_KEY=AIza...
```

Redeploy the web app on Vercel.

Optional local copy in root `.env`:

```env
VITE_GOOGLE_MAPS_API_KEY=AIza...
```

**Verify:** audit line `Google Maps / Places API` → **OK**.

---

## Step 8 — Optional: Gmail App Password (SMTP fallback)

Only if you want backup when OAuth fails:

1. Sender Google account → **Security → 2-Step Verification** (must be on).
2. **App passwords** → create → name `WineOps SMTP`.
3. In **`apps/api-gateway/.env`**:

   ```env
   GMAIL_USER=your-sender@gmail.com
   GMAIL_APP_PASSWORD=16-char-app-password
   ```

Not a substitute for OAuth for full Gmail API features.

---

## Step 9 — Optional: Gmail Watch + inbound email (advanced)

Skip unless you need **inbound provider replies** processed automatically.

Requires:

- Same OAuth trio as Step 5 (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`)
- Google Cloud **Pub/Sub** topic
- `GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/YOUR_TOPIC`
- `GMAIL_WATCH_LABEL_IDS=INBOX,SENT`

See phase 23 planning docs when you enable this; it is not required for **outbound** procurement drafts.

---

## Step 10 — Deploy checklist (Google only)

| Service | Variables | Action |
|---------|-----------|--------|
| Railway **api-gateway** | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_EMAIL` | Redeploy |
| Railway **agent-orchestrator** | `GOOGLE_API_KEY` | Redeploy |
| Vercel **web** | `VITE_GOOGLE_MAPS_API_KEY` | Redeploy |

Run audit again after deploy.

---

# Part 2 — Other APIs (non-Google)

From your last audit, these also need attention.

---

## Anthropic (Claude) — EXPIRED in audit

Used by: procurement drafts (Haiku), research agents, many Python paths.

1. Go to [Anthropic Console](https://console.anthropic.com/) → **API keys**.
2. **Create key** → copy once.
3. Set in **`services/agent-orchestrator/.env`**:

   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   (Some older docs say `CLAUDE_API_KEY` — orchestrator reads `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` depending on file; set **`ANTHROPIC_API_KEY`** in agent-orchestrator.)

4. Railway **agent-orchestrator** → same variable → redeploy.

**Verify:** audit `Anthropic (Claude)` → **OK**.

---

## OpenAI — optional (MISSING in audit)

Only needed if you use OpenAI-specific features.

1. [platform.openai.com](https://platform.openai.com/api-keys) → Create secret key.
2. `services/agent-orchestrator/.env`:

   ```env
   OPENAI_API_KEY=sk-...
   ```

3. Railway agent-orchestrator → redeploy.

---

## Plivo (SMS) — optional (MISSING in audit)

Only if SMS notifications are enabled.

1. [Plivo console](https://console.plivo.com/) → Auth ID + Auth Token.
2. `apps/api-gateway/.env` (and orchestrator if used):

   ```env
   PLIVO_AUTH_ID=...
   PLIVO_AUTH_TOKEN=...
   PLIVO_PHONE_NUMBER=+1...
   ```

---

## Supabase — already OK

If it ever fails:

1. [Supabase Dashboard](https://supabase.com/dashboard) → Project → **Settings → API**.
2. Rotate **service role** key only if compromised (updates `SUPABASE_SERVICE_ROLE_KEY` on api-gateway + orchestrator).
3. **Anon** key → `SUPABASE_ANON_KEY` / Vite if used.

---

## Serper (web search) — already OK

If it fails:

1. [serper.dev](https://serper.dev/) → API key.
2. `services/agent-orchestrator/.env`:

   ```env
   SERPER_API_KEY=...
   ```

---

## Production service URLs (audit “FAIL” on localhost)

Local `.env` often has:

```env
API_GATEWAY_URL=http://localhost:4000
AGENT_ORCHESTRATOR_URL=http://localhost:8000
```

That is fine for dev. To audit **production** health, temporarily set:

```env
API_GATEWAY_URL=https://your-api-gateway.up.railway.app
AGENT_ORCHESTRATOR_URL=https://your-orchestrator.up.railway.app
```

Then re-run the audit (or `curl .../health`).

---

# Troubleshooting cheat sheet

| Symptom | Likely fix |
|---------|------------|
| Gmail `invalid_grant` | New refresh token not saved, or client id/secret mismatch |
| Gmail `unauthorized_client` | OAuth client not “Web application”; missing redirect URI |
| Wrong Gmail on login | Incognito + `--email=...` or `GMAIL_LOGIN_HINT` |
| Gemini “leaked key” | Create new key; delete old in Cloud Console |
| Maps works locally, fails on Vercel | Add Vercel URL to key HTTP referrers |
| Anthropic 401 | New API key; check billing/credits |
| Audit shows localhost FAIL | Start local services or point URLs at Railway |

---

# Recommended order (do this once)

1. GCP project + enable APIs (Steps 1–2)  
2. OAuth consent + Web client (Steps 3–4)  
3. Gmail refresh token (Step 5)  
4. New Gemini key (Step 6)  
5. Maps browser key + Vercel (Step 7)  
6. Anthropic key (Part 2)  
7. `node scripts/audit-api-credentials.js`  
8. Redeploy Railway + Vercel  

When all critical lines are **OK**, test in the app: send a test email from Communications and create an order to trigger an AI draft.
