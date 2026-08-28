# 0040 — The error tracker receives no identity

> *Renumbered 0035→0040 at commit time: the agent-stack/wave PR chain (#145–#149) reserves 0034–0039; this ADR was authored against main (0033 highest) and took the next free number below that chain. Content unchanged.*

- **Status:** Proposed
- **Date:** 2026-08-28
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** sentry, pii, privacy, subprocessor, error tracking, setUser, sendDefaultPii, data minimisation
- **Links:** [[0020-no-fabricated-answers]] (a surface must tell the truth about itself — this applies it to the privacy notice), `compliance-privacy-charter.md:177` (the four-guards/three-definitions finding this extends), `privacy-engineering-directive.md:47` (owner of the single PII definition), ADR 0009 / `sync_commitment_patterns.py` (the prior art for "one rule, two runtimes, enforced")

## Context

Wave-3 review found a fourth live PII definition shipping through Sentry. Verified
this session across all three runtimes rather than transcribed, and it was worse
than reported — the leak was in three runtimes, not one:

| Runtime | Call site | What went to Sentry |
|---|---|---|
| `apps/web` | `lib/error-tracking.ts` `setUser`, fed by `contexts/AuthContext.tsx:208-219` | `id`, **`email`**, **`username`** (the user's real name), `restaurantId` |
| `apps/api-gateway` | `common/error-tracking/sentry.service.ts` `setUser` | `id`, **`email`**, **`username`**, `restaurant_id` |
| `services/agent-orchestrator` | `utils/sentry_client.py` `set_user` | `id`, **`email`**, **`username`**, `restaurant_id` — dead code, zero callers, but a loaded gun |

Three aggravating facts, each verified:

1. **`beforeSend` was decorative.** The web hook was literally
   `// Placeholder for any filtering rules; return event`. The gateway hook
   deleted two request headers (`authorization`, `cookie`) case-sensitively and
   nothing else. `services/agent-orchestrator/main.py` — the init that actually
   runs in production — had **no `before_send` at all**; the one in
   `utils/sentry_client.py` belonged to a class nobody instantiates.
2. **`sendDefaultPii` would not have saved us, and reads as though it would.**
   Sentry's own option documentation (`@sentry/core@10.37.0`,
   `build/types/types-hoist/options.d.ts:307-310`) says the flag applies "to data
   that the SDK is sending by default but **not** data that was explicitly set
   (e.g. by calling `Sentry.setUser()`)". A reviewer who sees the flag set to
   false concludes the file is safe. That is precisely the wrong conclusion.
3. **The privacy notice omitted it.** `apps/web/src/pages/Privacy.tsx` documented
   five data flows — cookies, Google sign-in, integrations, product analytics,
   partner sharing — and error tracking was not among them. Its own header
   comment claims it is "written to match what the code actually does". Under
   ADR 0020 that is not a documentation gap, it is a surface asserting something
   untrue about itself.

The compounding factor is retroactivity. A disclosure to a subprocessor is not
undone by a later commit: deleting the field stops tomorrow's events and does
nothing about the retention window already written to a vendor's index.

## Options considered

1. **Scrub on the way out (`beforeSend` only).** Keep `setUser({id, email, …})`
   and strip the fields in the hook. Appeals because it is one file per runtime
   and catches identity arriving by paths nobody enumerated. Costs: the hook is
   the only thing standing between an email and a third party, it is ordinary
   editable code with no type system behind it, and a future `setUser` call in a
   new file inherits nothing. It also cannot be checked by a compiler.
2. **Narrow the type so identity cannot be passed.** Remove `email`/`username`
   from `SentryUser` / `SentryUserScope` / `set_user`'s signature. Appeals
   because a regression becomes a build failure at the call site rather than a
   silent send. Costs: only covers what goes through our own wrapper; says
   nothing about a breadcrumb, an integration, or a raw `Sentry.setUser` call.
3. **Both, plus a guard.** Narrow the type (stops it at the source), keep a real
   `beforeSend` (catches the paths the type does not own), and add a CI check so
   neither half can be quietly removed.
4. **Turn Sentry off.** Genuinely considered, and the only option with a zero
   residual. Rejected: production runs on Railway where CI cannot see Nest DI
   failures, and error tracking is one of the few signals that survives that gap.
   Trading all production observability for a problem solvable by sending a UUID
   is a bad trade.
5. **Do nothing / file it.** Costs a growing archive of real identities at a
   subprocessor with no DPA (`compliance-privacy-charter.md` records zero
   occurrences of "GDPR" or "CCPA" anywhere in source), and every day of delay is
   permanently unrecoverable rather than merely late.

## Decision

**Sentry receives opaque identifiers only — an account UUID and a restaurant
UUID — and never a name, an email, an IP, or a request parameter's value.**
Option 3: defence at the source *and* on the way out, with CI holding both.

The reasoning that carried it is the asymmetry between the two halves. A
scrubber is the only thing that can catch identity arriving through a path
nobody enumerated, so it has to exist. But a scrubber is also just code — it can
be softened in a refactor by someone who does not know why it is there, and
nothing goes red. A narrowed type cannot be softened accidentally: removing it
breaks the build at the call site that depends on it. Neither property is
available from the other half, which is why this is not belt-and-braces but two
different controls answering two different failure modes.

A UUID is retained deliberately rather than dropping the user scope entirely.
It is meaningless outside our own database, so it identifies an account to
support without identifying a person to the processor, and it is what makes "one
user hit this 400 times" distinguishable from "400 users hit this once" — the
distinction that makes error tracking worth having at all.

What ships:

- **Source.** `SentryUser` (web), `SentryUserScope` (gateway) and
  `SentryClient.set_user` (Python) accept `id` and `restaurantId` only. The
  Python parameters are *removed*, not ignored — a parameter that accepts an
  email is an invitation to pass one.
- **Egress.** A real `beforeSend` on all three inits, reaching the user scope,
  `extra`, `contexts`, request body and credential headers (both casings —
  a case-sensitive `delete` is the classic way a scrubber stops scrubbing).
  `main.py` gets one for the first time.
- **`sendDefaultPii: false` stated explicitly** in all three inits. It is already
  the SDK default; a silent default is not a control anyone can audit, and
  writing it down is what lets the guard check it.
- **Request parameters by name, not by value.**
  `sentry.interceptor.ts` sent `request.query` and `request.params` whole and the
  URL with its query string. It now sends key names and a truncated URL: knowing
  *which* parameters were present is what makes a trace reproducible, the values
  are what make it a disclosure (`?email=`, `?token=`).
- **The guard.** `scripts/check_sentry_pii_scope.py`, blocking in the
  `sentry-pii-scope` CI job. Exits 2 rather than green when it cannot find what
  it measures against. Proven against the pre-fix tree: 15 findings across three
  runtimes, at both the call site and the type.
- **The notice.** `Privacy.tsx` gains an "Error and performance monitoring"
  section naming Sentry, what is sent, and what is not.

## Consequences

- **Easier.** A Sentry issue is still routable to an account and a tenant, so
  triage is unchanged in practice. The privacy notice is true again, which is a
  precondition for the obligation register `regulatory-posture-charter` owes.
- **Harder.** Nobody can search Sentry by a customer's email address when a
  customer writes in. The workflow becomes: look the account up in our own
  database, search Sentry by its UUID. This is a real cost and it is the point.
- **Given up.** Not much else — the SDK defaults already withheld bodies and IPs;
  what changed is that we now say so and check it.
- **A new duplication, deliberately.** `PII_USER_KEYS` now exists three times
  with no shared module, because the three runtimes have no shared build. This is
  the same shape as the defect at `compliance-privacy-charter.md:177`, so it is
  answered the same way ADR 0009 answered the commitment guardrail: the guard
  fails the build if the three copies drift, and each runtime's unit tests assert
  the list independently. Enforced duplication, not silent duplication.
- **Revisit when:** a shared TypeScript package spans web and gateway (then the
  two TS copies collapse into it); or `privacy-engineering-charter` executes its
  agenda item 3 and produces the single PII definition, at which point this ADR's
  three lists should be folded into it rather than surviving alongside; or Sentry
  ships a server-side scrubbing guarantee we are willing to rely on.

## Open — for the founder, not decided here

1. **Should the UUID go at all?** This ADR keeps `id` + `restaurantId`. The
   stricter position — fully anonymous error reports — costs the ability to tell
   one user's 400 errors from 400 users' one error, which is most of triage's
   value. Recorded as the recommendation, not as settled.
2. **Retention and the existing archive.** Every event already sent carries real
   emails and names. Purging Sentry's stored history and setting a retention
   window are vendor-console actions no code change reaches. This ADR does not
   do them and they are the half that addresses what already leaked.
3. **A DPA with Sentry.** Out of scope here; belongs with
   `regulatory-posture-charter`. Named so it is not mistaken for handled.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | — | Created; proposed, awaiting founder lock |
