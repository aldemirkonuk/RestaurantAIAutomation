# 0105 — A POS connection is a row, not an env var

- **Status:** Locked — the founder chose option (a) in session on 2026-09-03 after the measured Square day below; **the build is gated** (nothing in this ADR is implemented; see Consequences)
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** pos, pos-hub, pos_connections, webhook, signature, square, toast, clover, secret scope, notification_url, adapter, pull path, OD-A, OD-B, absence-as-health
- **Links:** [[0093-a-scenario-is-replayed-and-verified-against-its-own-expectation]], [[0067-a-failed-read-is-never-an-empty-one]], [[0011-pos-sale-volume-contract]], `04-specs/POS-BRIDGE-AUDIT.md:495-496` (OD-A/OD-B, drafted there and never registered), `04-specs/ECOSYSTEM-PLAN.md:112` (§7 fork 4), `01-org/product/partnerships-integrations/partnerships-integrations-agenda-board.md:110-113`, `…/partnerships-integrations-agenda-full.md:523` (PI-23), `08-softwares/pos-bridge.md:185-205`, `scripts/simulate/square_day/` (the generator and `EVIDENCE.md`)

## Context

The founder's requirement for the POS side of the ecosystem is one sentence, underlined:
_"we should be able to cope with any kind of POS technology and adapters for each of
them."_ The registry declares 27 providers; SimPOS is the only live signer. The
POS-bridge audit drafted two forks — **OD-A** (where a connection lives: a
`pos_connections` table vs jsonb on `restaurants`) and **OD-B** (one process-wide webhook
secret vs per-connection secrets, and _"no real vendor's signature scheme is
implemented"_) — and they were never registered (`POS-BRIDGE-AUDIT.md:495-496`; carried as
_drafted, never registered_ on the partnerships board). The founder's instruction for this
phase was: run a real vendor's day against the hub, and when it fails at the signature,
**report it and file the fork — build nothing.**

**What is on `main` today (read at `47f971de`, re-read at `2e9d0723`).** The route is
`POST /pos-hub/webhook/:provider/:restaurantId`; the only signature header read is
`x-pos-hub-signature` (`apps/api-gateway/src/pos-hub/pos-hub.controller.ts:89`).
`resolveWebhookSecret` (`pos-hub.service.ts:304-341`) walks per-connection → per-provider
→ legacy env, and `verifyWebhookSignature` (`:365-373`, hex at `:419-423`,
`timingSafeEqual` at `:424`) compares a hex HMAC of the raw body — so OD-B's _secret-scope_
half is already code-complete and configuration-blocked, while its _signature-scheme_ half
is untouched. The Square adapter reads `payload.data.object.order` (`pos-adapters.ts:77-78`)
and its unit test is green against that envelope (`pos-adapters.spec.ts:59-70`). Settings'
"Use this POS" writes a per-user preference no server code reads
(`PosSettingsSection.tsx:118-126`). `pos_connections` does not exist as a table.

**What Square actually sends (public docs and Square's own SDK source, read 2026-09-03;
`scratchpad` report §1, distilled in `scripts/simulate/square_day/EVIDENCE.md`).**
`order.created` / `order.updated` carry a _pointer_ — `order_id, location_id, state,
version, created_at` — not the order; line items need a separate authenticated
`RetrieveOrder`. The signature is `base64(HMAC-SHA256(key, notification_url + raw_body))`
in `x-square-hmacsha256-signature`. That recipe diverges from ours on four independent
axes — header name, MAC input (the **registered notification URL** is part of it),
encoding (base64 vs hex), and key provenance — and the URL varies per merchant, so it has
to be stored per connection. Nothing in the schema can hold it.

**The Square day, on the record (2026-09-03, local gateway on `main` + PR #285, orphan sim
tenant `aaecdb17-…`, product doors only, database reads only).** One real Meyhouse Palo
Alto Friday — menu and hours from public sources, 42 checks, $10,540.47 — rendered as 243
spec-faithful Square events (synthesised, labelled as such; Square's sandbox cannot emit a
restaurant day) and posted three ways:

| Run   | Route · header                                                       | Posted | Result                                                            | Rows landed                                              |
| ----- | -------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- | -------------------------------------------------------- |
| (i)   | `/webhook/square/:rid` · genuine Square signature                    | 243    | **401 × 243** `Webhook signature verification failed`             | 0                                                        |
| (ii)  | same bytes · our legacy `X-Pos-Hub-Signature`                        | 243    | **201 × 243** `received: 0 … "No recognizable checks in payload"` | 0                                                        |
| (iii) | `/webhook/generic_webhook/:rid` · same day as our canonical envelope | 42     | **201 × 42**, `upserted: 1` each                                  | 42 checks, 52 unresolved lines (tenant has no inventory) |

So "cope with any POS" measures today at **0 of 42 checks for one real vendor, 42 of 42
for our own envelope.** Four things the day found that no document held: (1) run (i)
produced _one_ log line for 243 rejections, and it is the success-shaped `legacy_global`
warning — the missing header is never named (`pos-hub.service.ts:410`); (2) run (ii)
emitted **no** PosHub log line at all, because the ingest log at `:552` sits after the
`!checks.length` short-circuit at `:457-465` — the one path that discards everything is
the one path that logs nothing; (3) `covers` sent as `null` is stored as `0` on all 42
canonical checks, so a POS that structurally cannot report covers would read as a real
zero; (4) the `event_id` redelivery was rejected and discarded identically, so
duplicate-detection was never exercised — nothing landed to dedupe. Also measured: the
hub answers **201**, not the 200 the research predicted (Nest's `@Post()` default).

## Options considered

1. **(a) A `pos_connections` table keyed `(restaurant_id, provider_key)`** carrying the
   secret (encrypted at rest), `signature_scheme`, `notification_url`, OAuth
   access/refresh tokens with expiry, a pull `cursor`, `status`, `last_event_at`,
   `last_error`. Appeals: it is the only shape that holds Square's per-merchant URL and a
   per-vendor scheme descriptor; it gives every connection a health row (so a quiet
   integration and a broken one stop looking the same — the audit's OD-C); it enables
   token refresh for the six `oauth2` providers, a cursor for the thirteen pull providers,
   and two POS in one venue. Costs: a migration, a secrets-at-rest mechanism, a
   verifier-per-scheme registry, and the retirement of the legacy global rung once every
   live signer has a row.
2. **(b) `pos_connections jsonb` on `restaurants`.** Appeals: no new table. Costs: no
   unique constraint per provider, no per-connection URL, no per-row health or cursor, and
   the audit had already rejected it for exactly the reason the Square day measured.
3. **(c) Keep env-scoped secrets and document that every non-canonical POS needs a
   customer-side re-signing middleware.** This is what ships today. Its cost is the
   measured number: 0%. "Any POS" would mean "any POS plus an integrator", which
   contradicts the founder's requirement and the registry's own `notes`.
4. **Do nothing** — leave OD-A/OD-B unregistered. Costs the same 0%, plus a test suite that
   says Square works (`pos-adapters.spec.ts:59-70`), which is the absence-as-health class
   this repo already names.

## Decision

**A POS connection is a row in a `pos_connections` table keyed `(restaurant_id,
provider_key)`, and verification is a function of that row's `signature_scheme`, not of a
process-wide header and secret.**

What carried it: Square's MAC _requires_ a per-connection input that has nowhere to live in
(b) or (c); the day proves push-only Square is impossible (its webhooks are pointers, so the
pull path — and the credential it needs — must exist for Square specifically, not just for
the thirteen `webhooks: false` providers); and (a) is the only option under which
"connected and quiet" and "connected and broken" are different rows. The founder picked (a)
in session on 2026-09-03 with this table in front of them.

Sub-decisions folded in, each the founder's to reopen:

- **D1 — Scheme is data.** `signature_scheme` names a verifier: `pos_hub_scoped_v1`
  (today's `"<provider>:<restaurantId>." + body`, hex), `square_v1`
  (`notification_url + body`, base64), and per-vendor entries for Toast (`timestamp.body`),
  Stripe-style (`t.<ts>.<body>` with tolerance) and Shopify-style (body only) as they are
  brought up. An unknown scheme **fails closed and logs the scheme name**, never a
  success-shaped warning.
- **D2 — The legacy global rung retires** when SimPOS (`simpos.service.ts:490-501`, the only
  live signer) has its own connection row. Until then it stays, logged as `legacy_global`
  on _every_ rejection as well as every success.
- **D3 — Square needs the pull path.** The webhook handler for Square performs
  `RetrieveOrder` with the connection's OAuth token; the connection row owns the cursor and
  the token lifecycle. This is scoped, not built, here.
- **D4 — Adapter fixtures must be vendor evidence.** Every adapter test fixture is a
  captured or spec-cited vendor payload, with the citation in the test. A green test
  against an invented envelope is not evidence; `pos-adapters.spec.ts:59-70` is the
  standing counter-example until replaced.
- **D5 — Capability is behavioural.** A field a POS cannot supply (`covers` on Square) is
  stored as `null` and rendered as _not reported_, never as `0` (today's column behaviour
  is a defect, filed in `v3.0-TECH-DEBT.md`).

## Consequences

- **Easier:** onboarding a second live provider is a row plus a verifier; health, token
  refresh and cursors have a home; the pull-provider half of the registry stops being
  fiction; Settings' "Use this POS" gets a server-side object to write.
- **Harder / given up:** a migration with secrets at rest (the mechanism is a prerequisite
  named here, not chosen here); every adapter test re-based on captured payloads; the
  legacy rung's retirement is a coordinated cut with SimPOS.
- **Build is gated.** The founder's instruction for this phase was to report and file, not
  to build. The order when it opens: migration + secrets mechanism → `pos_hub_scoped_v1`
  row for SimPOS → `square_v1` verifier + `RetrieveOrder` → replay
  `scripts/simulate/square_day` and require run (i) to land 42/42 with the redelivery
  deduplicated and the `CANCELED` order reversing stock.
- **Fixed regardless of the build (defects, not decisions):** the silent discard path at
  `pos-hub.service.ts:457-465`, the deduped success-shaped rejection log at `:410`, and
  `covers: null → 0` — all three filed in `v3.0-TECH-DEBT.md` (2026-09-03 section).
- **Supersedes** the OD-A/OD-B drafts in `POS-BRIDGE-AUDIT.md:495-496` and closes PI-23's
  hand-off for those two; OD-C (capabilities behavioural or documentation) is answered by
  D5 in the narrow sense and otherwise still the audit's draft; OD-D is untouched.
- **Revisit when:** a vendor's scheme needs an input the row cannot hold (a nonce
  exchanged out of band, a certificate), or when the first captured real-merchant payload
  contradicts the synthesised corpus — the two-run design in `EVIDENCE.md` says which
  prediction flips.

## Review trail

| Date       | Reviewer                               | Outcome                                                                  |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------ |
| 2026-09-03 | Fable (lens session), Square-day agent | Created from the measured day; founder chose (a) in session; build gated |
