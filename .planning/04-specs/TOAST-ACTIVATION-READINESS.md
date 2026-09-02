---
type: spec
id: TOAST-ACTIVATION-READINESS
title: Toast — can it be switched on, and what is actually missing
status: proposed
updated: 2026-09-02
supersedes: ".planning/07-reference/TOAST_API_CONFIGURATION.md (retired to a tombstone in the same change)"
links:
  - "[[POS-BRIDGE-AUDIT]]"
  - "[[OPEN-DECISIONS]]"
  - "[[EXTERNAL_CONNECTIONS]]"
  - "[[TOAST_API_DEVELOPER_GUIDE]]"
---

# Toast activation readiness

- **Question asked:** can the Toast integration be switched on, and what configuration is missing?
- **Short answer:** **no — not today, and not for the reason anyone expected.** Toast API
  credentials *are* provisioned (on one service), and they point at a specific, identified
  merchant. What is missing is (a) a webhook signing secret, (b) any Toast configuration at
  all on the service that serves `/toast/*`, and (c) a Python factory function that does not
  crash. **None of this is blocked on the founder obtaining credentials.** The credentials
  are already there. See §6 for who does what.
- **Code anchor:** `origin/main` @ `69cdb19f`. Re-anchor before acting; main moves hourly.
- **Environment anchor:** Railway project `virtuous-delight`, environment `production`,
  read **2026-09-02**. Presence checks only — no variable *value* was read, printed, or
  stored anywhere in this document. Where a value is quoted it is a non-secret flag
  (`MOCK_POS`, `TOAST_API_URL`, `NODE_ENV`).
- **Data anchor:** production Supabase `exzueerziesmczwlhomd` (`Restaurant_Wine_Ops`), read
  **2026-09-02**, read-only `SELECT` only. Same single-tenant caveat as
  [ECOSYSTEM-E0-MEASUREMENTS.md](ECOSYSTEM-E0-MEASUREMENTS.md): 10 restaurants, 1 real tenant.
- **Not verified, and deliberately so:** **no call was made to the Toast API.** Whether the
  provisioned credentials are *valid*, *unexpired*, or *scoped* to the required endpoints is
  therefore **unknown**. It is a third-party paid integration and testing it is a founder
  action, not an agent action. Everything below is configuration-shape evidence, not a
  live handshake.

> **Retire-to-write (CLAUDE.md §4).** This document retires
> [`07-reference/TOAST_API_CONFIGURATION.md`](../07-reference/TOAST_API_CONFIGURATION.md),
> which promised configuration and contained none — it was a 64-line summary of Toast's
> *public vendor API*, a strict subset of the 153-line
> [`TOAST_API_DEVELOPER_GUIDE.md`](../07-reference/TOAST_API_DEVELOPER_GUIDE.md) sitting
> next to it. Its title is what made it a trap: anyone asking "how is Toast configured
> here?" found a file that answered "here is how OAuth 2.0 works." Replaced with a
> tombstone stub per the ADR 0032 convention; its three non-duplicated lines (the
> idempotency / rate-limit / error-handling best practices) are carried into the stub.

---

## 1. What the client actually requires

`services/agent-orchestrator/services/toast_api_client.py` — the constructor
(`:123-149`), `connect()` (`:151-175`), `_authenticate()` (`:192-215`), and the factory
`create_toast_client_from_settings()` (`:541-548`).

| Constructor parameter | Default (`:123-130`) | Sourced from | Env key | Setting default |
|---|---|---|---|---|
| `toast_client_id` | `None` | `settings.toast_client_id` (`:544`) | `TOAST_CLIENT_ID` | `None` — `config/settings.py:155` |
| `toast_client_secret` | `None` | `settings.toast_client_secret` (`:545`) | `TOAST_CLIENT_SECRET` | `None` — `settings.py:156` |
| `toast_restaurant_guid` | `None` | `settings.toast_restaurant_guid` (`:546`) | `TOAST_RESTAURANT_GUID` | `None` — `settings.py:157` |
| `mock_mode` | `True` | `settings.toast_mock_mode` (`:547`) | — | **does not exist** — see §1a |
| `base_url` | `"https://api.toasttab.com"` | **nothing** — never passed by the factory | `TOAST_API_URL` is read but never reaches the client | `"https://ws-api.toasttab.com"` — `settings.py:152-154` |

Settings the *orchestrator* defines but this client never consumes:
`toast_webhook_secret` (`settings.py:158`, `TOAST_WEBHOOK_SECRET`), `toast_environment`
(`settings.py:159`, `TOAST_ENVIRONMENT`, default `"sandbox"`), `mock_pos`
(`settings.py:160`, `MOCK_POS`, default `"true"`).

### 1a. The factory is broken — `AttributeError`, every call

`create_toast_client_from_settings()` reads `settings.toast_mock_mode` at
`toast_api_client.py:547`. `Settings` is a plain class with no `__getattr__`
(`config/settings.py:13-16`, properties end at `:247`) and **never defines that
attribute**. The nearest thing it has is `mock_pos` (`settings.py:160`).

Reproduced, no network:

```
$ cd services/agent-orchestrator && python3 -c \
  "from config.settings import Settings; Settings().toast_mock_mode"
AttributeError: 'Settings' object has no attribute 'toast_mock_mode'
```

**Why nobody hit this:** the factory has *zero callers* in the tree. Every existing
construction goes through `ToastAPIClient(...)` directly —
`demo/demo_realtime_week.py:103`, `tests/test_toast_api_client.py:23,28,210`. The
`/api/v1/toast` router now being built is the first caller, and it would crash on
import-time wiring or first request. **This is the single highest-value finding for the
sibling agents.**

Closed in this change by defining `toast_mock_mode` in `settings.py` — deliberately *not*
aliased to `MOCK_POS`, see §5.

### 1b. Two more latent defects (documented, not fixed here)

Both live in `toast_api_client.py`, which this session was scoped out of touching.

1. **The client talks to the wrong host.** `base_url` defaults to
   `https://api.toasttab.com` (`:129`) and the factory never overrides it (`:543-548`),
   so `TOAST_API_URL` / `settings.toast_api_url` are dead config. Toast's own partner host
   is `https://ws-api.toasttab.com` — which is what `settings.py:153`, both `.env.example`
   files, the production Railway value, and `ToastAuthService` (`toast-auth.service.ts:16`)
   all say. The Python client is the one place that disagrees.
2. **`TOAST_ENVIRONMENT` has no effect on the Python path.** The NestJS side switches host
   on it (`toast-auth.service.ts:59-64`: `production` → `ws-api`, anything else →
   `ws-api-sandbox`). The Python client has no sandbox concept at all.

Net effect if the factory were fixed in isolation: the router would authenticate against a
production hostname the rest of the system does not use, ignoring the sandbox switch.

---

## 2. What serves `/toast/*` — and why the gateway matters more than the client

`apps/api-gateway/src/toast/toast.controller.ts:64` mounts `@Controller("toast")` with ten
routes. **Six of them do not call Toast at all** — they proxy to the orchestrator's
`/api/v1/toast/*`: `menus` (`toast.service.ts:757`), `menus/:id` (`:806`), `POST orders`
(`:863`), `orders/:id` (`:895`), `sales` (`:923`), `statistics` (`:943`) — each behind an
`if (this.mockMode)` early return (`:745, :790, :858, :890, :918`). The comment at
`toast.service.ts:694-703` records that this orchestrator router has never existed.

`ToastAuthService` — the only gateway code that holds Toast credentials
(`toast-auth.service.ts:54-62`) — is registered in `toast.module.ts:36-37` and **injected
nowhere**. It is dead code today. That is *why* the gateway needs no `TOAST_CLIENT_ID`:
until something injects `ToastAuthService`, the gateway's Toast credentials would be unused.

Config the gateway genuinely reads:

| Key | Read at | Default | Consequence of absence |
|---|---|---|---|
| `TOAST_MOCK_MODE` | `toast.service.ts:72` | `true` | **Every one of the six proxy endpoints returns mock data.** This is the master switch. |
| `TOAST_WEBHOOK_SECRET` | `toast.service.ts:81` | `null` | `verifyWebhookSignature` fails closed (`:130-139`) and, because `NODE_ENV=production` forces `enforceSignature()` true (`:121-123`), **every inbound Toast webhook is rejected 401.** |
| `TOAST_CACHE_TTL_SECONDS` | `toast.service.ts:74` | `300` | Benign. |
| `AGENT_ORCHESTRATOR_URL` | `toast.service.ts:67` | `http://localhost:8000` | Present in production and pointing at the orchestrator (verified). |

---

## 3. Presence in production — per service

Railway `virtuous-delight` / `production`, 2026-09-02, via
`railway variables list --service <svc> -p 4478ee8c… -e production --json`, keys extracted
programmatically. **Values were never printed.** `@wineops/web` (15 keys) and
`@wineops/mobile` (14 keys) carry no Toast or POS key of any kind and are omitted.

| Key | `@wineops/api-gateway` (48 keys) | `services/agent-orchestrator` (65 keys) | Read by |
|---|---|---|---|
| `TOAST_CLIENT_ID` | **absent** | present, non-empty | both services |
| `TOAST_CLIENT_SECRET` | **absent** | present, non-empty | both services |
| `TOAST_RESTAURANT_GUID` | **absent** | present, non-empty | Python client only |
| `TOAST_API_URL` | **absent** | present — `https://ws-api.toasttab.com` | orchestrator settings (then dropped, §1) |
| `TOAST_ENVIRONMENT` | **absent** → `sandbox` | **absent** → `sandbox` | both |
| `TOAST_WEBHOOK_SECRET` | **absent** → webhooks 401 | **absent** | both |
| `TOAST_MOCK_MODE` | **absent** → **defaults `true`** | n/a until §5 | gateway |
| `TOAST_CACHE_TTL_SECONDS` | **absent** → `300` | n/a | gateway |
| `MOCK_POS` | absent | present — **`false`** | orchestrator only |

Three things worth stopping on:

1. **`TOAST_MOCK_MODE` absent on the api-gateway is the whole story for the six endpoints.**
   The prior finding is confirmed: it defaults `true` at `toast.service.ts:72`, so
   `/toast/menus`, `/toast/menus/:id`, `/toast/orders`, `/toast/orders/:id`, `/toast/sales`
   and `/toast/statistics` all return canned data regardless of what the orchestrator does.
   The sibling agents' router can be perfect and the product still shows mock wines.
2. **The two services disagree about mocking.** The orchestrator says `MOCK_POS=false`
   (POS is live); the gateway defaults `TOAST_MOCK_MODE=true` (Toast is mocked). Nobody set
   either one *for Toast* — one is a different switch and the other was never set.
3. **The credentials are on the wrong service for the gateway path, and the right one for
   the Python path.** Given §2 (`ToastAuthService` is dead code), that is currently correct
   and should stay that way — do not copy secrets onto the gateway.

### 3a. Are those credentials real?

Shape-only heuristics, computed without printing any value:

| Key | UUID-shaped | Length bucket | Contains `test`/`demo`/`mock`/`sample`/`fake`/`dummy`/`example` | Matches the `your-…` placeholder in `env.example` |
|---|---|---|---|---|
| `TOAST_CLIENT_ID` | no | 16–35 chars | no | no |
| `TOAST_CLIENT_SECRET` | no | ≥64 chars | no | no |
| `TOAST_RESTAURANT_GUID` | **yes** | 36–63 chars | no | no |

These are consistent with real Toast machine-client credentials, not placeholders.
**They have not been validated against Toast** (§0, deliberate). "Shaped like a credential"
is not "is a working credential."

---

## 4. Is a Toast merchant provisioned? — mixed verdict, and it is not the one on file

Production reads, 2026-09-02:

| Check | Result |
|---|---|
| `restaurants` | 10 rows, **all** `pos_system = 'toast'` |
| `restaurants` with non-empty `pos_credentials` | **1** |
| Keys inside that `pos_credentials` JSON | exactly one: `restaurant_guid` — **no** client id, **no** secret |
| Is that GUID UUID-shaped | yes |
| Does it equal the `TOAST_RESTAURANT_GUID` set on the orchestrator | **yes** — verified by comparing `md5()` prefixes, never the values |
| That restaurant's `restaurant_inventory` rows | 50 |
| That restaurant's `pos_checks` rows | 66 — **all 66 in the database**, one distinct `restaurant_id` |
| `pos_checks` by `source` | `generic_webhook`: 66. **`toast`: 0** |
| `pos_item_mappings` | **0 rows, all sources** (the 92 orphans were deleted; see the POS-bridge memory) |
| `toast_item_mappings` | **0 rows** |
| `restaurant_inventory` with `toast_item_guid` not null | **0 rows** |
| A `pos_connections`-style table | **does not exist** — no table in `public` holds per-tenant POS credentials |

**Verdict.** A specific Toast merchant *was* identified: the `TOAST_RESTAURANT_GUID` in the
orchestrator's environment is the same GUID recorded against the real tenant's
`pos_credentials`, and that tenant is the one carrying all 50 inventory rows and all 66
checks. So this is **not** "no merchant exists" — somebody had a real Toast restaurant in
hand and wrote its GUID down in two places.

But **no Toast data has ever reached this system.** Zero Toast-sourced checks, zero Toast
item mappings, zero inventory rows carrying a Toast GUID. The earlier "zero merchant-backed
POS providers" finding is therefore **confirmed in effect and refined in cause**: the
blocker was never a missing merchant identity, it was that the pipe was never opened.

Two structural notes for whoever opens it:

- `restaurants.pos_system` defaults to `'toast'` (POS-BRIDGE-AUDIT.md:225), so "all 10
  declare Toast" is a **default, not ten decisions**. Do not read it as demand.
- There is no per-tenant credential store. `TOAST_CLIENT_ID` / `TOAST_CLIENT_SECRET` are
  **process-wide environment variables**, so today the platform can serve exactly one Toast
  merchant. Multi-tenant Toast needs a schema change, not a config change. (`ToastAuthService`
  is already shaped for it — `getAccessToken(restaurantGuid)` — but has no store to read from.)

---

## 5. Config-surface gaps, and what this change closes

A key the code reads that no config surface documents is a trap. Surfaces checked:
root `env.example`, `services/agent-orchestrator/.env.example`,
`services/agent-orchestrator/config/settings.py`, `.railway/railway.ts`,
`docker-compose.yml`, `docker-compose.override.yml`.

| Key / setting | Read at | `env.example` | orch `.env.example` | `settings.py` | `.railway/railway.ts` | compose |
|---|---|---|---|---|---|---|
| `TOAST_CLIENT_ID` | `toast-auth.service.ts:54`, `settings.py:155` | `:52` | `:30` | yes | orchestrator only | **no** |
| `TOAST_CLIENT_SECRET` | `toast-auth.service.ts:55`, `settings.py:156` | `:53` | `:31` | yes | orchestrator only | **no** |
| `TOAST_RESTAURANT_GUID` | `settings.py:157` | `:54` | `:32` | yes | orchestrator only | **no** |
| `TOAST_API_URL` | `settings.py:152` | `:51` | `:29` | yes | orchestrator only | **no** |
| `TOAST_WEBHOOK_SECRET` | `toast.service.ts:81`, `settings.py:158` | `:55` | `:33` | yes | **neither service** | **no** |
| `TOAST_ENVIRONMENT` | `toast-auth.service.ts:59`, `settings.py:159` | `:56` | `:34` | yes | **neither service** | **no** |
| `TOAST_MOCK_MODE` | `toast.service.ts:72` | **GAP → closed** | **GAP → closed** | **GAP → closed** | **neither service** | **no** |
| `TOAST_CACHE_TTL_SECONDS` | `toast.service.ts:74` | **GAP → closed** | n/a | n/a | **neither service** | **no** |
| `MOCK_POS` | `settings.py:160` | `:57` | `:35` | yes | orchestrator only | **no** |

**Closed in this change** (placeholders and comments only — no value, real or otherwise):

- `env.example` — `TOAST_MOCK_MODE` and `TOAST_CACHE_TTL_SECONDS`, with the note that the
  first is the master switch for the six proxy endpoints and defaults **true**.
- `services/agent-orchestrator/.env.example` — `TOAST_MOCK_MODE`, with the note that it is
  **not** `MOCK_POS`.
- `services/agent-orchestrator/config/settings.py` — defines `toast_mock_mode`, closing the
  `AttributeError` in §1a.

**Deliberately NOT aliased to `MOCK_POS`.** `MOCK_POS` is `false` in production. Had
`toast_mock_mode` been defined as an alias, the moment the sibling agents wire
`create_toast_client_from_settings()` the orchestrator would begin making **real, billable
calls to a third-party API** as a side effect of a bug fix, with no human decision anywhere
in the chain. It reads its own `TOAST_MOCK_MODE` and defaults `true`, matching the
gateway's default at `toast.service.ts:72`, so one key now governs both services.

**Left open, needs a founder call, not an agent's:** `.railway/railway.ts` declares Toast
variables for the orchestrator (`:82-85`) and **none** for the api-gateway (`:103-133`).
Adding `TOAST_MOCK_MODE: preserve()` there would declare a variable that does not yet exist
in the dashboard, and the behaviour of `preserve()` against an unset variable was not
verified — so this session did not touch production IaC. It is step 2 of §6.

---

## 6. The smallest honest activation checklist

Ordered. "Code" = an agent can do it and merge it. "Founder" = requires an account, a
credential, a dashboard, or a commercial decision.

| # | Step | Who | Blocked by |
|---|---|---|---|
| 0 | **Resolve [OD-64](../decisions/OPEN-DECISIONS.md) — is Toast the first real POS integration, or do we stay provider-neutral?** Everything below is downstream of this. `generic_webhook` is the only door that has ever carried traffic (66 rows); switching Toast on makes it the reference implementation. | **Founder** | — |
| 1 | Merge the §5 config-surface fixes so `create_toast_client_from_settings()` stops raising `AttributeError`. | Code | — |
| 2 | Add `TOAST_MOCK_MODE` (and `TOAST_WEBHOOK_SECRET`, `TOAST_ENVIRONMENT`) to the api-gateway block of `.railway/railway.ts`, after confirming `preserve()` semantics for a not-yet-existing variable. | Code, needs the §5 IaC question answered | 1 |
| 3 | Fix the two §1b defects in `toast_api_client.py`: pass `settings.toast_api_url` as `base_url`, and honour `TOAST_ENVIRONMENT` for the sandbox host. **Owned by the sibling agent on that file.** | Code | — |
| 4 | Build the `/api/v1/toast` router the gateway has proxied to since day one. **Owned by the sibling agent.** | Code | 1, 3 |
| 5 | **Confirm the provisioned `TOAST_CLIENT_ID` / `TOAST_CLIENT_SECRET` still authenticate**, and confirm which Toast environment they belong to (sandbox vs production). No agent may test this — it is a live call to a paid third-party API. | **Founder** | 0 |
| 6 | **Obtain the webhook signing secret from the Toast dashboard** and set `TOAST_WEBHOOK_SECRET` on `@wineops/api-gateway`. Until this exists, every inbound webhook is a 401 (`toast.service.ts:121-139`) — the integration is inbound-dead no matter what else is true. Claude cannot retrieve it. | **Founder** | 0 |
| 7 | Set `TOAST_ENVIRONMENT` explicitly on both services. It defaults to `sandbox` in two places today, so "we never set it" currently reads as "we chose sandbox." | Founder decides the value; code can apply it | 5 |
| 8 | Set `TOAST_MOCK_MODE=false` on `@wineops/api-gateway`. **This is the switch.** Nothing before it changes what the six endpoints return. | **Founder** | 1, 2, 4, 5, 6 |
| 9 | Populate `toast_item_mappings` / `pos_item_mappings` for the merchant — all three are empty (§4), so even a working feed depletes nothing. | Code + founder (menu mapping) | 8 |
| 10 | If more than one Toast merchant is ever needed: design per-tenant credential storage. Today's env-var model serves exactly one. | Founder (scope), then code | 8 |

**The honest headline.** The founder does *not* need to go and obtain API credentials —
those exist, and they name a real merchant. What is genuinely gated on the founder is
**one commercial decision (OD-64), one secret (the webhook signing secret), and one
validation the agent is forbidden to perform (do these credentials still work).** Steps 1–4
can proceed in parallel with all of that; steps 8–9 cannot.

---

## 7. Register corrections

Per the standing rule that the decision register rots, OD-64's claims were re-verified
against production and code on 2026-09-02.

- ✅ "all **10** restaurants declare `pos_system='toast'` and exactly one stores
  `pos_credentials`" — **still true.** Add that the column *defaults* to `'toast'`
  (POS-BRIDGE-AUDIT.md:225), and that the one stored credential is a bare `restaurant_guid`
  with no client id or secret.
- ✅ "`pos_checks` holds 66 rows, every one `generic_webhook`" — **still true**, one
  distinct `source`, one distinct `restaurant_id`.
- ✅ "`TOAST_CLIENT_ID` and `TOAST_CLIENT_SECRET` are set" — **true in production Railway**,
  on `services/agent-orchestrator` only.
- ✅ "`TOAST_WEBHOOK_SECRET` is unset … every Toast webhook is rejected today" — **true**,
  and re-confirmed absent on both services in production Railway, not merely in `.env`.
- ❌ "**If Toast: the webhook signing secret + `TOAST_API_KEY` from the Toast dashboard**" —
  **`TOAST_API_KEY` is read by no code in this repository.** The only occurrences are prose:
  OD-64 at OPEN-DECISIONS.md:46, and REGISTER-AUDIT-2026-08-26.md:293. Asking for it sends
  them to a dashboard for a key nothing consumes. The real second item is `TOAST_MOCK_MODE`
  — which no register entry mentions, and which is the actual master switch.
