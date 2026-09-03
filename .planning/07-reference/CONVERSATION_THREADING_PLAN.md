# Conversation Threading & Order Linkage — Fix Plan

**Status:** shipped — migration applied to hosted Supabase 2026-07-28
**Created:** 2026-07-27
**Owner:** aldemirkonuk
**Surfaces:** `/documents-reports` (Communication History tab), `/communications`, provider drawer

---

## 1. The problem, stated precisely

`procurement_conversations` holds 26 rows. All 26 belong to GULLIT DISTRIBUTION.

| Column | Populated |
|---|---|
| `provider_id` | 26 / 26 |
| `gmail_thread_id` | 21 / 26 |
| `order_id` | **1 / 26** |
| `thread_id` | **0 / 26** |

The UI buckets messages **solely by `order_id`**. So 25 of 26 messages collapse into a
single amber "Unassigned" pile, even though `gmail_thread_id` already describes
**8 clean conversation threads** — e.g. `19f365aac4e6be95` is a complete 6-message
negotiation (offer → reply → confirm-request → confirmation → reply → clarification).

The provider filter is **not** broken: filtering by Gullit returns all 26 rows,
identical to unfiltered. What reads as "only a few under Gullit" is the order
grouping underneath it, plus a hardcoded `limit: 20` that hides 6 more behind a pager.

### Why `order_id` is null on 25 rows

Not deletion. `order_id` is `ON DELETE CASCADE`
([baseline_schema.sql:198](../supabase/migrations/20260208024921_baseline_schema.sql)) —
had the orders been deleted, the messages would have gone with them. Those rows were
inserted order-less and never backfilled.

Timeline corroborates: all 25 order-less rows are dated **2026-05-18 → 2026-07-06**.
The email-attribution hardening landed **2026-07-08/09** (`4ceb6fb`, `4de6927`). The one
correctly-linked row is dated **2026-07-16**, after the fix. So the forward path was
repaired; **the historical rows were never migrated.**

> Confidence note: n=1 post-fix message is weak statistical evidence on its own. The
> code read supports it — `rabbitmq-bridge.service.ts:659-706` has both a
> `gmail_thread_id` leg and an open-order fallback — but this plan does not *rely* on
> the forward path being perfect. §3 makes correctness independent of every writer.

---

## 2. Root cause: thread identity is conflated with `order_id`

This is the actual defect, and it is a design error rather than a bug:

1. **A negotiation exists before an order does.** A `DEMAND_OFFER` *is* the thing you
   send to decide whether to order. Keying identity on `order_id` guarantees every
   pre-order message is homeless. This is not an edge case — it is the common case.
2. **`order_id` is `ON DELETE CASCADE`.** Tying thread identity to it means deleting
   one order silently destroys the entire negotiation history with that vendor. Any
   backfill we do today is one `DELETE` away from being erased.
3. **The cardinality is wrong.** One order can span several email threads; one thread
   can precede — and produce — an order. It is not 1:1.

Downstream symptoms all trace back to this single root:

- Order # filter uses `procurement_orders!inner`
  ([conversations.service.ts:59](../apps/api-gateway/src/conversations/conversations.service.ts)),
  so it can never return more than that 1 linked message.
- "View full thread" is gated on `conv.thread_id`
  ([ClassifiedConversationList.tsx:221](../apps/web/src/components/communications/ClassifiedConversationList.tsx)),
  which is null on every row → the button never renders.
- `getThread()` queries `.eq("order_id", threadId)`
  ([conversations.service.ts:214](../apps/api-gateway/src/conversations/conversations.service.ts)) —
  the thread view is keyed on order_id and is dead for all 26 rows.

---

## 3. The fix: a durable `thread_key`

Give conversations a **first-class thread identity that never depends on an order
existing**, and demote `order_id` to an annotation on the thread.

### Resolution order

```
1. gmail_thread_id present        → gm:<gmail_thread_id>      (Gmail already threaded it)
2. else RFC-822 in_reply_to/refs  → mid:<normalized-root-message-id>
3. else provider + subject        → subj:<provider_id>:<slug(subject minus Re:/Fwd:)>
4. else                           → msg:<row id>               (singleton — never null)
```

Step 4 is what makes "Unassigned" disappear as a dumping ground: an unthreadable
message becomes a thread of one, not a member of a 25-message heap.

### Enforced by a database trigger, not by callers

`BEFORE INSERT OR UPDATE` trigger computes `thread_key` whenever it is null.

This is the "once and for all" property, and it is the single most important decision in
this plan. There are at least four writers today — the NestJS bridge, the inbound
responder, the communications controller, and the Python `provider_communication_agent`
(plus test/demo endpoints, and manual SQL). Enforcing in application code means the
next writer added reintroduces the bug. Enforcing in the database means it cannot.

### Layers

| Layer | Change |
|---|---|
| **L0 — schema** | add `thread_key`, `order_number_snapshot`; indexes; flip `order_id` FK `CASCADE` → `SET NULL` |
| **L1 — trigger** | `set_conversation_thread_key()` — computes thread_key + snapshots order_number |
| **L2 — backfill** | populate `thread_key` on all rows; propagate `order_id` **only within an identical `gmail_thread_id`** |
| **L3 — API** | expose `thread_key`; `getThread` keys on it; order-number filter uses the snapshot (left join, not inner) |
| **L4 — web** | group by `thread_key`; label with order number when present; gate "View full thread" on `thread_key`; raise page limit |

---

## 4. Premortem

> It is 2026-10. The fix shipped in July. It is considered a failure. What happened?

| # | Failure story | Likelihood | Mitigation |
|---|---|---|---|
| **P1** | **The backfill glued unrelated messages together.** The subject heuristic merged the Barolo negotiation with the Brunello one because both subjects normalized to "Order Request". Managers saw a 25-message Frankenstein thread and stopped trusting the page. | High | Subject fallback (step 3) applies **only** when both `gmail_thread_id` and message headers are absent — 5 rows today, all unsent drafts. It is additionally scoped by `provider_id`. Steps 1–2 are exact identifiers, never heuristics. |
| **P2** | **The backfill attached 25 old messages to `ORD-2026-95040`.** Order propagation walked too far and every pre-order inquiry got stamped with the one order that exists, corrupting order history and analytics. | High | Propagate `order_id` **only within an identical `gmail_thread_id`**, never across subject- or header-derived keys, and only when `COUNT(DISTINCT order_id) = 1` for that thread. Verified no-op against current data: the one linked row is alone in its thread. |
| **P3** | **Someone deleted an order and the negotiation history vanished.** We backfilled beautifully, then `ON DELETE CASCADE` erased it. | Medium | L0 flips the FK to `ON DELETE SET NULL` **and** adds `order_number_snapshot` so a deleted order still renders its number in history. This is why the FK change is in scope rather than deferred. |
| **P4** | **A new writer reintroduced null thread_keys.** Someone added an endpoint, or the Python agent wrote a row, and the heap came back. | High | The DB trigger, not application code, is the enforcement point. Application-side `resolveThreadKey()` exists for clarity but is belt-and-braces. |
| **P5** | **Threads are split across pages.** Grouping is client-side over a 20-row page, so a 6-message thread renders as 4 + 2 across two pages and looks broken. | High | Raise the page limit and add a `threadKey` filter so a thread can be fetched whole. Full server-side thread pagination is explicitly **out of scope** — noted as follow-up. |
| **P6** | **The migration failed on the FK swap** because a row referenced a deleted order, and the deploy rolled back mid-way. | Low | Drop-then-add in one transaction; `SET NULL` is strictly more permissive than `CASCADE`, so no existing row can violate it. |
| **P7** | **We fixed the display and declared victory** while new sends still create order-less rows (the demo endpoint at `communications.controller.ts:451` hardcodes `orderId: null`). | Medium | Accepted and explicit: that is a **test-scenario endpoint**, not the production flow. With `thread_key` those rows still thread correctly — they just have no order, which is truthful. Flagged, not silently fixed. |
| **P8** | **`thread_key` collides across restaurants.** Two tenants' messages merge. | Low | `gmail_thread_id` and message-ids are globally unique; the subject fallback is scoped by `provider_id`, which is itself restaurant-scoped. |

### What the premortem changed in the design

- FK `CASCADE → SET NULL` + `order_number_snapshot` moved **into** scope (P3) — without it
  the backfill is one delete away from worthless.
- Enforcement moved from application code **into a DB trigger** (P4).
- Order propagation constrained to exact `gmail_thread_id` only, with a distinct-count
  guard (P2) — the single highest-risk step.
- Server-side thread pagination explicitly **descoped** and named as follow-up (P5),
  rather than half-built.

---

## 5. Results (measured)

Migration was applied inside a transaction, dry-run first (rolled back), then committed.

| Check | Before | After |
|---|---|---|
| rows with `thread_key` | 0 / 26 | **26 / 26** |
| distinct threads | 1 shared "Unassigned" bucket + 1 order | **13** (8 real Gmail threads + 5 never-sent draft singletons) |
| rows with `order_id` | 1 | **1** — propagation was a verified no-op, exactly as P2 required |
| `order_id` FK delete rule | `c` (CASCADE) | **`n` (SET NULL)** |
| `getThread()` | returned 0 messages for every row | **returns the whole 6-message thread** |
| Order # filter | ≤1 message reachable | works off snapshot, survives order deletion |
| `threadKey` filter | did not exist | fetches a thread whole |

Trigger proven: an insert supplying no `thread_key` came back with `gm:probe-thread-xyz`.
(The probe row was committed by the apply step and has been deleted; verified 0 remain.)

What the Gullit filter renders now — 26 messages, 13 named threads instead of a
25-message "Unassigned" pile:

```
[ORD-2026-95040] 2010 Cavallotto Bricco Boschis "Vigna San Giuseppe"   1 msg
[no order yet  ] 2010 Guiseppe Rinaldi Brunate Barolo                  6 msg
[no order yet  ] 2008 Metoxi Chromista Limnio-Cabernet Sauvignon       3 msg
[no order yet  ] 2019 Capture Napa Valley                              3 msg
[no order yet  ] 1966 Chateau Longueville Pichon-Longueville           2 msg
[no order yet  ] 2012 Miani Merlot Colli Orientali del Friuli          2 msg
[no order yet  ] 2010 Poggio di Sotto Brunello di Montalcino           2 msg
[no order yet  ] 2010 Guiseppe Rinaldi Brunate Barolo                  2 msg
[no order yet  ] Conversation  ×5                                      1 msg each
```

`npx tsc --noEmit` clean on both apps; 90 web tests pass.

## 5b. Security audit (2026-07-28)

Scoped to the conversations surface these changes touch. Findings are probe-verified,
not inferred.

| # | Finding | Severity | Status |
|---|---|---|---|
| **S1** | **`/api/v1/conversations/*` had no auth guard at all.** All 11 routes were reachable with no token — including `approve`/`reject`, which send real email to vendors. The gateway queries with the service-role key, which bypasses RLS, so this exposed every tenant's vendor negotiations. Verified: `curl` with no `Authorization` header returned 200 and full message bodies. | **HIGH** | **Fixed** — class-level `@UseGuards(JwtAuthGuard)`; all routes now 401. |
| **S2** | **Cross-tenant read via `getThread`.** No restaurant scoping; any caller could read another restaurant's whole negotiation by supplying its thread key. Latent before (keyed on `order_id`, which was null everywhere) — making the thread view work is what turned it into a live path. | **HIGH** | **Fixed** — mandatory `restaurant_id` filter, taken from the token. |
| **S3** | **`listConversations`/`getStats` took `restaurantId` as an optional query param.** Omitting it returned every tenant's data in one response. | **HIGH** | **Fixed** — tenant now comes from `user.restaurantId`; the param is gone. |
| **S4** | RLS is enabled on `procurement_conversations` — the anon key returns `[]`. The exposure above was entirely via the gateway's service-role key. | — | Confirmed healthy. |
| **S5** | `order_number_snapshot` / `thread_key` filters interpolate user input into PostgREST `ilike`/`eq` values. supabase-js URL-encodes them, so the filter grammar cannot be escaped. | — | Not exploitable. |

`list_conversation_threads` is `SECURITY INVOKER` with `p_restaurant_id` as a required
argument (no default), so it cannot be called unscoped, and `anon` is revoked.
Verified: querying it as another tenant returns 0 rows.

### Not fixed — outside this change's blast radius

**10 other controllers carry no `JwtAuthGuard`**, and `TenantGuard` fails *open* when
there is no authenticated user (`tenant.guard.ts:41-47` returns true and logs a
warning). So the same exposure very likely exists on: `analytics`, `dashboard`,
`notifications`, `contacts`, `one-tap-actions`, `toast`, `pos-hub`,
`recurring-orders`, `communications`, `procurement/recurring-orders`.
`inbound-email.controller` is intentionally `@Public()` (webhook) — leave it.

I did not touch these: each needs its own tenant-scoping review, and a blanket guard
would break any route legitimately relying on being open. Flagged for a dedicated pass.

## 5c. Follow-ups delivered

**Never-sent drafts are named by status.** `status` is now plumbed through to the
client, and a thread with no subject, no wine and no order falls back to its lifecycle
label — "Discarded draft", "Cancelled draft", "Approved, not sent" — instead of five
identical "Conversation" rows. A `SENT` message is explicitly not called a draft.

**Server-side thread-aware pagination.** New `list_conversation_threads` SQL function
paginates by *thread*, so the page boundary falls between conversations instead of
through the middle of one. The interim `limit: 100` is reverted to 20 — which now
means 20 conversations, not 20 messages. Verified against live data: page 1 and page 2
each return whole threads, `total` = 13 threads, and every message on a page belongs
to a thread on that page.

### Known rough edge

~~The 5 singletons render as "Conversation"~~ — FIXED in §5c. They are drafts that were never sent
(`DISCARDED`/`CANCELLED`), so they carry no subject and no Gmail id to name them by.
Titling them from `status` would need `status` plumbed into the API payload; deferred
rather than guessed at.

## 6. Verification

1. **Pre-flight snapshot** — record current `thread_key`/`order_id` distribution.
2. **Migration dry-run** — apply, then assert:
   - `thread_key` non-null on 26/26
   - distinct `thread_key` count == 8 gmail threads + 5 singleton/subject buckets
   - `order_id` still set on exactly **1** row (propagation is a verified no-op today)
   - FK is `SET NULL`
3. **API** — `/conversations` returns `thread_key`; `getThread(<key>)` returns a whole thread.
4. **UI** — Gullit shows ~8 named threads instead of "Unassigned: 25".
5. **Regression** — existing vitest suite for `conversationGrouping` passes, extended
   with thread_key cases.

## 7. Out of scope (named, not forgotten)

- Server-side thread-aware pagination (P5).
- Reworking the demo endpoint that hardcodes `orderId: null` (P7).
- Backfilling `generated_reports` — that table is genuinely empty; the Reports tab's
  empty state is correct, not a bug.
