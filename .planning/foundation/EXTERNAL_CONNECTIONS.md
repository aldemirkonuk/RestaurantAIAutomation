# External Connections — Mudavym

> Generated 2026-08-24. Hosts referenced in `apps/**` and `services/**` source (virtualenvs, `node_modules`, and documentation/reference URLs excluded).

**50 distinct runtime hosts** · **8 SDKs** · **80 environment variables**.

## Third-party services

| Service | Refs | Role | Hosts |
|---|---|---|---|
| **Other / unclassified** | 36 | Review individually | `api.apify.com`, `api.yelp.com`, `civb.com`, `developer.squareup.com`, `developers.lightspeedhq.com` *(+17)* |
| **Wine data sources** | 29 | Producer/critic enrichment | `images.vivino.com`, `vivino.com`, `wine-searcher.com`, `www.consorziobrunellomontalcino.it`, `www.vivino.com` *(+1)* |
| **Placeholder/sample** | 16 | ⚠️ Fixture or stale sample value | `a.com`, `b.com`, `via.placeholder.com`, `your-domain.com` |
| **Toast POS** | 14 | Primary POS integration (webhooks + API) | `doc.toasttab.com`, `test.toasttab.com`, `ws-api-sandbox.toasttab.com`, `ws-api.toasttab.com` |
| **wineops.ai** | 10 | ⚠️ Legacy brand domain — pre-Mudavym | `api.wineops.ai`, `app.wineops.ai`, `wineops.ai` |
| **Google** | 10 | Gmail + Calendar OAuth | `accounts.google.com`, `maps.googleapis.com`, `oauth2.googleapis.com`, `www.googleapis.com` |
| **Vercel** | 9 | Frontend hosting | `myapp.vercel.app`, `restaurant-ai-automation-web.vercel.app` |
| **Anthropic** | 7 | Claude — extraction, enrichment, drafting | `api.anthropic.com` |
| **schema.org** | 7 | Structured-data vocabulary (not a network call) | `schema.org` |
| **Microsoft** | 3 | OAuth (Outlook/365) | `login.microsoftonline.com` |
| **ngrok** | 3 | ⚠️ Dev tunnel — should not appear in prod paths | `abc123.ngrok.io` |
| **Supabase** | 2 | Postgres + auth + storage | `test.supabase.co` |

## SDKs in use

| SDK | Used by |
|---|---|
| Google APIs (Gmail/Calendar) | api-gateway |
| HTTP client (axios) | api-gateway, web |
| OpenAI | agent-orchestrator |
| RabbitMQ | api-gateway |
| Redis | agent-orchestrator, api-gateway |
| SMTP mail | api-gateway |
| Sentry | api-gateway, web |
| Supabase | api-gateway, web |

> **Note:** Anthropic and Gemini appear as *hosts* but not as SDK imports — they are called over raw HTTP/axios. Worth confirming that retry, timeout, and cost accounting are handled consistently, since an SDK would normally provide those. This directly affects the NF-A telemetry track (foundation §4.2).

## Environment variables

80 distinct vars referenced. Top by reference count:

| Var | Refs |
|---|---|
| `SUPABASE_URL` | 12 |
| `SUPABASE_SERVICE_ROLE_KEY` | 12 |
| `POS_HUB_WEBHOOK_SECRET` | 8 |
| `SUPABASE_SERVICE_KEY` | 7 |
| `SUPABASE_KEY` | 7 |
| `NODE_ENV` | 5 |
| `FRONTEND_URL` | 5 |
| `GEMINI_API_KEY` | 4 |
| `ADMIN_API_KEY` | 4 |
| `CLAUDE_API_KEY` | 3 |
| `ENVIRONMENT` | 3 |
| `DEV_AUTH_BYPASS` | 2 |
| `DEV_AUTH_BYPASS_EMAIL` | 2 |
| `ANTHROPIC_API_KEY` | 2 |
| `GMAIL_USER` | 2 |
| `PORT` | 2 |
| `EXPO_PUBLIC_WEB_URL` | 2 |
| `RABBITMQ_HOST` | 2 |
| `RABBITMQ_PORT` | 2 |
| `RABBITMQ_USER` | 2 |
| `RABBITMQ_PASSWORD` | 2 |
| `RABBITMQ_VHOST` | 2 |
| `TOAST_WEBHOOK_SECRET` | 2 |
| `SENTRY_DSN` | 2 |
| `DATABASE_URL` | 2 |
| `SUPABASE_DB_URL` | 2 |
| `DEV_AUTH_BYPASS_SECRET` | 1 |
| `GOOGLE_CLIENT_ID` | 1 |
| `GOOGLE_CLIENT_SECRET` | 1 |
| `GOOGLE_CALLBACK_URL` | 1 |
| `JWT_SECRET` | 1 |
| `MICROSOFT_TENANT_ID` | 1 |
| `MICROSOFT_CLIENT_ID` | 1 |
| `MICROSOFT_CLIENT_SECRET` | 1 |
| `MICROSOFT_CALLBACK_URL` | 1 |

*(full list in `atlas.json`; regenerate via the atlas script)*