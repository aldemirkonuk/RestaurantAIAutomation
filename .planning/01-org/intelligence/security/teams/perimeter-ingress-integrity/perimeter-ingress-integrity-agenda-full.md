---
type: agenda-full
division: intelligence
department: security
team: perimeter-ingress-integrity
status: provisional
metrics: [sec.unverified_public_ingress, sec.fail_open_defaults, sec.distributed_rate_limit_present, sec.secrets_in_url_or_bundle]
updated: 2026-08-24
links: ["[[perimeter-ingress-integrity-charter]]", "[[perimeter-ingress-integrity-premortem]]", "[[perimeter-ingress-integrity-agenda-board]]", "[[perimeter-ingress-integrity-directive]]", "[[perimeter-ingress-integrity-loops]]", "[[perimeter-ingress-integrity-schedule]]", "[[security-charter]]", "[[access-control-tenant-isolation-charter]]", "[[integration-engineering-charter]]", "[[platform-api-charter]]", "[[ENDPOINTS]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Perimeter & Ingress Integrity — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Every reading below was
> taken from source on 2026-08-24; nothing in "next steps" has been started.

## What

Four deliverables, in severity order rather than convenience order.

1. **Confirm the ingress baseline.** 43 routes, one verdict each, per route. The
   provisional reading is **20 verified · 23 not**; confirming it is the deliverable.
2. **Resolve `simpos`.** Eleven routes labelled a webhook module that receives no webhooks.
   The confused-deputy case.
3. **Close the four fail-open defaults.** One `TenantGuard` behaviour and three JWT-secret
   fallbacks to a publicly-known string.
4. **Close the two secret-leak paths.** The `?secret=` query credential and
   `VITE_DEV_AUTH_BYPASS_SECRET` in the web bundle.

## How

**The standard already exists in this repo, and copying it is the method.**
`toast.service.ts:112-121` and `pos-hub.service.ts:87-95` do HMAC-SHA256 over the raw body
and refuse everything when the secret is absent — with the reasoning written into the
comment and, for `pos-hub`, a test asserting the no-secret case
(`pos-hub.service.spec.ts:239`). `main.ts:9-14` sets `rawBody: true` precisely so exact-byte
verification is possible. **Every new verification copies that file including its test.**
Nothing here is a design problem.

**Verdicts are per route and name the sender.** The template is shared with
[[access-control-tenant-isolation-charter]] and adds one field this charter cares about
more than any other:

| Field | Note |
|---|---|
| `sender` | **Who transmits this request.** Not "the internet" — a named system |
| `proof` | `hmac` · `shared-secret-header` · `publish-state` · `none` |
| `fail_mode` | `closed` · `open` — **`open` is never shippable** |
| `verdict` | `verified` · `needs-signature` · `needs-publish-check` · `delete` |
| `evidence` | `path:line` |

`simpos` fails this template at the first field, which is the fastest possible
demonstration that per-module labels do not work
([[perimeter-ingress-integrity-premortem]] M2).

**Rate limiting is reported with its multiplier.** Until the store is shared, every
citation of a tier reads `limit × instances`, never `limit`. That single formatting rule is
the counter-pressure to M3 and it costs nothing.

## Why now

The perimeter is the only thing standing in front of routes that will never have a guard,
and its state is uneven in a way that hides itself: two modules are exemplary, which makes
the aggregate look healthy. Meanwhile `simpos`'s eleven routes are unguarded, unclassified,
and connected — via a signature we generate ourselves — to a code path documented as
depleting stock (`pos-hub.controller.ts:57`).

There is also a sequencing reason. The sibling charter's endpoint sweep will produce
`public-with-signature` and `public-content` verdicts as a **byproduct**. If this charter
has no baseline when those verdicts start arriving, they land in a queue with no
denominator — the same defect that made OD-19's original "~86" unusable.

## Next steps

Ordered. Nothing started.

1. **Resolve `simpos` (11 routes).** Answer three questions in writing: does
   `POST /simpos/:restaurantId/check/:checkId/close` reach a real tenant's inventory? Is the
   sim restaurant an isolated tenant? Should `SimposModule` be registered in a production
   build at all, given its own docstring calls it *"a synthetic test fixture, not a WineOps
   feature"* (`simpos.controller.ts:16-20`) and `app.module.ts:84` registers it with no
   `NODE_ENV` gate? **Highest severity item in this charter.**
2. **Confirm the 43-route baseline.** `pos-hub` and `toast` should confirm quickly; the
   value is in the other 23.
3. **Close the fail-open defaults.** Refuse to start without `JWT_SECRET` rather than
   falling back to `"your-secret-key-change-in-production"` in three places. This is a
   small diff with a large blast radius and needs [[platform-api-charter]] to author it.
4. **Header-only for `inbound-email`.** Remove the `?secret=` path
   (`inbound-email.controller.ts:57-58`); keep the fail-closed behaviour at `:39-45`, which
   is already right. Requires coordinating with whichever inbound-parse provider is
   configured — a real integration break if done unilaterally.
5. **Escalate the nine `communications/test/e2e/*` routes as one founder question**, not
   nine route verdicts.
6. **Audit `vendor-portal`.** Two routes, genuinely public by design and correctly labelled
   now. The real questions are slug enumeration and whether an **unpublished** page can
   leak — `getPublishedPage` is the control and it has not been read for this purpose.
7. **Distributed rate limiting.** Specify; [[platform-api-charter]] builds. Until then,
   report every tier with its multiplier.
8. **Scope the CORS `vercel.app` regex.** `main.ts:26` allow-lists every app on a shared
   preview domain with `credentials: true`, in production. The localhost widening
   immediately below it (`:33-35`) is correctly `NODE_ENV`-scoped and shows the author knew
   the pattern.
9. **Extend `EXTERNAL_CONNECTIONS.md` with consumer and fallback columns.** It is already a
   regenerated grep target, so this is a scan change, not a document to maintain.

## Questions for the founder

1. **Should `simpos` ship in production at all?** If the answer is no, eleven routes leave
   the backlog and the confused-deputy path closes with a module removal.
2. **The nine `communications/test/e2e/*` routes — keep, gate, or delete?** They are
   `@Public()` on purpose and they send real vendor email. Recommendation: `delete`, or gate
   behind the five-condition `dev-bypass.util.ts:46-52` pattern.
3. **Which inbound-parse provider is configured** (Postmark / SES / Mailgun / Cloudflare)?
   Removing the `?secret=` path depends on whether that provider can send a custom header.
4. **How many API instances run in production?** Sets the real rate limit and decides
   whether the Redis store is urgent or merely correct.
5. **Is any `vercel.app` preview deployment a trusted origin in production?** If not, that
   regex should be `NODE_ENV`-scoped like its neighbour.
