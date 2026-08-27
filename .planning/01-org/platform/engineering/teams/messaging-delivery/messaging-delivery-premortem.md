---
type: premortem
division: platform
department: engineering
team: messaging-delivery
status: provisional
metrics: [messaging.duplicate_delivery_rate, messaging.drop_rate]
updated: 2026-08-24
links: ["[[messaging-delivery-charter]]", "[[messaging-delivery-loops]]", "[[messaging-delivery-directive]]", "[[engineering-premortem]]", "[[runtime-resilience-charter|sre-runtime-resilience]]", "[[ai-orchestration-charter]]", "[[red-team-charter]]"]
---

# Messaging & Delivery — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:176-179`): *batching logic lives partly
in an in-memory buffer (`buffer_manager.py`) and partly in the persist funnel; a Railway
restart during service hours drops one and double-sends the other, and the founder finds
out from a restaurant, not a metric.*

## It is 2027-08. This team has failed. What happened?

### M1 — The restart during service hours

`services/agent-orchestrator/agents/buffer_manager.py` holds a 30-minute LIFO window in
memory. The persist funnel holds the durable half. A deploy, an OOM, or a platform restart
lands at 19:30 on a Friday. Whatever was in the buffer is gone — those alerts never
arrive. Whatever had been persisted but not marked sent goes out again on boot — those
arrive twice. Both halves of the system behaved correctly according to their own code.

**Earliest observable signal.** A restart timestamp with **no reconciliation record** on
either side of it. Not a user complaint — the restart event itself is the signal, and it
is available today from the platform. If a restart cannot be correlated with "N buffered
items, M redelivered", the failure is already possible.

**Counter-pressure.** Buffer state becomes **durable and idempotent-on-replay**: the
in-memory window is a performance optimisation over a persisted queue, never the only
copy. Every restart emits a reconciliation record — buffered, flushed, redelivered,
dropped — into the same ledger the metrics read. [[runtime-resilience-charter|sre-runtime-resilience]] owns restart
behaviour as infrastructure; this team owns that a restart is *survivable by the message*,
and the seam is stated so neither assumes the other did it.

---

### M2 — The metric was measured from user reports after all

The charter says duplicate and drop rates are measured against `notification_id`, not user
reports. Building an id-keyed delivery ledger across four channels is real work. The
shortcut is a dashboard of send-attempt counts, which is easy and answers a different
question. Duplicates are visible in it; **drops are not** — a message that was never
attempted has no row. Twelve months later the team has good duplicate numbers, no drop
numbers, and still learns about the important failures from restaurants.

**Earliest observable signal.** Any delivery dashboard whose row source is the *send* path
rather than the *intent* path. The tell is structural: if a row is created when we try to
send rather than when we decide to notify, drops are invisible by construction.

**Counter-pressure.** A `notification_id` is minted at **intent** — when the system decides
a human should learn something — and every channel attempt references it. Drop rate is
then simply intents with no successful delivery. Report per channel, never aggregated:
email drops and websocket drops have nothing to do with each other and averaging them
hides both.

---

### M3 — "Delivered" came to mean "handed to the provider"

Email goes out through a provider; push goes to APNs/FCM; websocket goes to a socket that
may be closed. Each returns success on *accept*, not on *arrival*. The delivery ledger
records those acceptances as delivered. The rate is 99.9% and the operator still never saw
the low-stock alert, because the push token was stale and the email landed in spam —
neither of which is a failure from the sending side.

**Earliest observable signal.** A channel whose delivered count and its
acknowledgement/open/read count diverge persistently. Also: any push token that has
"succeeded" for weeks with zero corresponding app opens.

**Counter-pressure.** The ledger distinguishes **accepted**, **delivered**, and
**acknowledged** as separate states, per channel, and the drop-rate metric is computed on
the strongest signal each channel can offer. Where a channel cannot report arrival, that
limitation is written on the board rather than rounded up to success. Stale push tokens
are pruned on an evidence rule, not on a provider error alone.

---

### M4 — Threading merged two conversations, or split one

`.planning/07-reference/CONVERSATION_THREADING_PLAN.md` and `inbound-address.service.ts` route inbound
mail into threads. Threading is identity work wearing a different hat: two vendor replies
merged into one thread put the wrong context in front of an agent; one conversation split
across three threads loses the history that made the reply sensible. Because
[[ai-orchestration-charter]] drafts *from* the thread, a threading error becomes a drafting
error with no trace back to transport.

**Earliest observable signal.** A thread containing messages from two different external
addresses that were never explicitly linked. Cheap to detect and worth detecting on the
first instance, because the damage shows up downstream as a bad draft, not as a transport
bug.

**Counter-pressure.** Threading decisions are logged with their reason (in-reply-to header,
address match, subject heuristic) so a bad draft can be traced to the merge that caused it.
Subject-similarity threading — the heuristic that fails this way — is never sufficient on
its own. Borrow the asymmetry discipline from [[catalogue-identity-charter]]: a wrong merge
of two conversations is worse than a wrong split, and the two are not summed.

---

### M5 — Eighty-four unguarded endpoints became someone's notification channel

`notifications` (24), `communications` (18), and `contacts` (8) are **all unguarded**
([[ENDPOINTS]]; `tenant.guard.ts:38-46` passes unauthenticated requests by design). These
endpoints send messages to real people and read a contact list. Unlike
[[procurement-vendor-network-charter]]'s exposure, the consequence here is not money — it
is sending arbitrary content to a restaurant's contacts under our name, and exfiltrating
the contact list.

**Earliest observable signal.** An outbound send whose originating request had no
authenticated principal. Loggable today, before any guard exists — and the absence of that
log is itself the signal.

**Counter-pressure.** Alert on unauthenticated writes to `notifications/**`,
`communications/**`, and `contacts/**` immediately, independent of
[[platform-api-charter]]'s global mechanism. When that mechanism lands, these routes go in
the first tranche alongside the money-moving routes and are excluded from the `@Public()`
allowlist ([[engineering-premortem]] M2). Contact reads get their own treatment: a list
exfiltration is silent and permanent.

---

## What [[red-team-charter]] should attack first

M2. If drop rate is never measurable, M1, M3, and M5 all fail invisibly — the entire
premortem collapses into "we found out from a restaurant", which is the exact sentence the
seed ends with.
