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
  **[2026-09-26, PR #427 round 5 — false for bodies on Node.** `@sentry/node`
  10.36 attaches every incoming request body, as a raw utf-8 string of up to
  10 KB, to `request.data` whatever `sendDefaultPii` says
  (`@sentry/node-core` `integrations/http/httpServerIntegration.js:34,333-346`;
  `@sentry/core` `integrations/requestdata.js:8-13`, `data: true` by default),
  and the key-name scrub returned early on a string — so a reset token, a
  refresh token or a password in a POST body reached Sentry on any 5xx or
  sampled transaction. Measured, not inferred: a live `http` server with
  `Sentry.init` after `http` was loaded (as `SentryService.onModuleInit` does)
  put `{"token":…,"password":…}` in `event.request.data`. All three scrubbers
  now drop `request.data` whole, which is what makes this premise true;
  pinned by `sentry-wire.spec.ts` and the claim
  `ADR-0040-REQUEST-BODY-DROPPED-IN-ALL-THREE-RUNTIMES`.]**
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

## Amendment, 2026-08-28 — the three scrubbers were not the same scrubber

An audit of this ADR's own delivery found the "What ships / Egress" bullet above
overstated. It claims a `beforeSend` on all three inits "reaching the user scope,
`extra`, `contexts`, request body and credential headers". That described the two
TypeScript scrubbers. The Python one reached the user scope, credential headers
and cookies — and **not** `extra`, `contexts` or `request.data`. The reverse gap
existed too: neither TypeScript scrubber touched `request.cookies`, and the
gateway's header list was four hard-coded `delete`s (`authorization`/`cookie`,
two casings each) rather than the Python list's four header *names* matched
case-insensitively — so `x-api-key` and `proxy-authorization` survived in the
gateway and no headers were scrubbed at all in the browser.

No known leak followed from it: no Python caller puts identity in `extra`, and
`send_default_pii=False` covers what the SDK attaches by itself. That is exactly
why it is worth recording — the defect was in the *contract*, not in an observed
event, and a last line of defence that depends on what today's callers happen to
do is not one.

The correction is symmetry plus enforcement:

- Python gains `PII_KEYS` (byte-identical to the TS list) and scrubs `extra`,
  `contexts` and `request.data`. Both TS runtimes gain `SENSITIVE_HEADERS` as a
  list matched case-insensitively, and delete `request.cookies`. All three now
  cover six containers: `user`, `extra`, `contexts`, `request.headers`,
  `request.cookies`, `request.data`.
- **The guard could not have caught this, and now can.** `check_no_drift`
  compared `PII_USER_KEYS` *key names* only, so three files agreeing on a list
  of words while looking for them in different places passed. It now compares
  every shared list (`PII_USER_KEYS`, `PII_KEYS`, `SENSITIVE_HEADERS`) **and**
  the set of containers each scrubber reaches into, pinned to
  `REQUIRED_CONTAINERS` so that three runtimes dropping a container together
  fails too. `--self-test` gained the pre-fix Python shape as a fixture, and the
  extended guard was run against a copy of the real pre-fix tree: it reports the
  asymmetry and names the three missing containers.

This is the "enforced duplication, not silent duplication" consequence below
being paid for a second time. The lesson generalizes: for duplicated logic, an
agreeing *constant* is the easy half to check and the half that matters least.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | — | Created; proposed, awaiting founder lock |
| 2026-08-28 | audit | Scrubber symmetry gap found and closed; guard extended to containers (amendment above) |
| 2026-09-21 | PR #427 (self-authored; its own security and compliance audits BLOCKED v1) | Amended — `before_send` never scrubbed `request.url`; `query_string`, a path-borne credential (`@Public()` `/calendar/feed/<token>.ics`) and breadcrumbs were all missed. See the amendment below the trail |
| 2026-09-22 | PR #427 round 2 (self-authored; its own correctness and security audits independently reproduced the same leak via the real SDK and BLOCKED v2) | Amended — the `beforeSendTransaction`/`before_send_transaction` fix from the row above scrubbed `event.request` but not `event.transaction` or `contexts.trace.data`/`spans[].data`, an OpenTelemetry-populated copy of the same URL one level deeper than the existing `contexts` key-name pass reaches. Same two secrets (calendar feed token, inbound-webhook secret) leaked through the new field. See the fifth-gap paragraph below |
| 2026-09-25 | PR #427 round 3 (lane L3a; closes the round-2 audit's non-blocking breadcrumb finding and this record's own "still open" list) | Amended — breadcrumbs, free text (message, log record, exception message, frame locals) and `Referer` now scrubbed in all three runtimes and pinned in the guard; a real-SDK wire test per runtime found `frames[].vars`. See the sixth-gap paragraph below |
| 2026-09-26 | PR #427 round 5 (its ADR 0090 audit at `67644e23` BLOCKED: the correctness and security reviewers both found the Node local-variables paragraph false against the installed SDK, and security found request bodies unscrubbed) | Amended — `request.data` dropped whole in all three runtimes (the Node SDK attaches it as a raw string a key scrub cannot touch; measured on the wire and on a live server); the Node local-variables paragraph and the "Given up" premise corrected in place by dated brackets; `includeLocalVariables: false` stated on the gateway |

---

## Amendment — the path-borne credential, and the query at `before_send` (2026-09-21, PR #427)

This record's Decision already says Sentry receives **"never … a request
parameter's value"**, and its *"Request parameters by name, not by value"*
remedy shipped in `sentry.interceptor.ts`. That remedy was **one layer and one
runtime**. Three gaps were measured on 2026-09-21 and closed here; none is a new
decision, all are this decision reaching where it had not:

1. **`before_send` never scrubbed `event.request.url`.** The browser SDK's
   `httpContextIntegration` fills it from `getLocationHref()` — the full URL with
   its query — so a JavaScript error on `/reset-password?token=…` shipped the
   token to Sentry. Confirmed live: the shipped production bundle carries a real
   DSN, and carried no redaction. The interceptor's `split("?")` never applied,
   because it is a different layer.
2. **`request.query_string` is a sibling the SDKs set separately.** On the
   gateway it carries `INBOUND_WEBHOOK_SECRET` (`@Query("secret")` on a
   `@Public()` route) and the OAuth `code`. In the Python runtime it is the
   *only* place the query appears — `_asgi_common._get_url` builds `url`
   **without** it — so scrubbing `url` alone was a no-op there.
3. **A credential can be in the PATH, where stripping the query cannot reach it.**
   `/invite/<code>`, `/studio/invite/<token>`, and — found by this PR's own
   security audit, which blocked the first version of the fix — the `@Public()`
   `/calendar/feed/<token>.ics`, a tenant-wide, never-expiring, unauthenticated
   bearer over a house's whole calendar, and `/digest/unsubscribe/<token>`.

**The founder's ruling (2026-09-21) on the query half:** strip it **entirely**,
not redact known secret-bearing parameter names. *Rejected:* redaction by name —
it keeps the page state that produced an error, but reports health for every
parameter nobody remembered to add. *Traded:* the query no longer says which page
state produced an error.

**The path half is an allow-list, and that is only safe because it is enforced.**
`TOKEN_PATH_PREFIXES` would otherwise have the exact fail-open property the
founder rejected. Two guards prevent that, both mutation-tested with a NO-OP
control:

- It joined `SHARED_LISTS` in `scripts/check_sentry_pii_scope.py`, so the three
  runtimes' copies cannot drift — this record's own *"Enforced duplication, not
  silent duplication"* rule. Before this, dropping `/invite/` from one runtime
  exited **0**; it now exits **1**.
- `check_public_path_params` enumerates every `@Public()` gateway route taking a
  path parameter and **fails the build** unless it is either covered by
  `TOKEN_PATH_PREFIXES` or named in `PUBLIC_PATH_PARAMS_NOT_CREDENTIALS` with a
  reason. A new token-bearing public route is a red build, not a silent leak.

Only the **one segment** after a prefix is redacted, so `/auth/invite/<code>/accept`
keeps `/accept` and an on-call can still tell routes apart. Over-redaction is the
safe direction and is accepted.

**A fourth gap, found by this PR's own security re-audit after the first three
were closed — and the most consequential of the four.** Both SDKs call the
scrubber for **error events only**: `@sentry/core` gates on
`isErrorEvent(processedEvent) && beforeSend`, and `sentry_sdk` skips it when
`event["type"] == "transaction"`. With `tracesSampleRate` / `traces_sample_rate`
at 0.1, a **successful** request is sampled into a transaction event that the
request-data integration has already filled with `request.url`,
`request.query_string`, headers and cookies. So the `@Public()`
`/calendar/feed/<token>.ics` bearer shipped **in the clear on one in ten
successful reads** — quieter and higher-volume than the 5xx path the first three
fixes closed. Measured end to end through the SDKs' own integrations, not
reasoned about.

Closed by registering the same scrubber on `beforeSendTransaction` /
`before_send_transaction` at all four init sites. It is required
**unconditionally** by `check_init_posture`, not only where tracing is
configured: a later `tracesSampleRate` would otherwise silently reopen it, and a
hook that never fires costs nothing.

This is why the guard, not the list, is the thing that matters. Three separate
walk-arounds of `check_public_path_params` were also measured and closed: a
`@Public()` sitting more than six lines from its route decorator (the fixed
window is now the whole decorator block — `communications.controller.ts` already
separates the two by fifteen lines of comment on main, so the blinding shape was
already house style); a non-literal route argument such as `@Get(SHARE_ROUTE)`,
which is now **refused** rather than skipped, because skipping leaves the route
count unchanged and silence is indistinguishable from nothing-to-check; and
`:id`/`:orderId` sitting in the not-a-credential list while matching **zero**
routes, pre-blessing the two most generic parameter names in the repo. Widening
the scan immediately found a seventeenth `@Public()` route the old window had
never seen.

**A fifth gap, found by this PR's own round-2 audit after the fourth was
closed — the fourth gap's own "Revisit when" clause naming it before either
auditor did.** `beforeSendTransaction`/`before_send_transaction` calls the same
`scrubSentryEvent`/`scrub_sentry_event`, but that scrubber's reach stopped at
`event.request`, `event.user`, `event.extra`, and a key-**name** pass over each
`contexts` entry. It never reached `event.transaction` (the transaction/span
NAME, built from the raw path) or `contexts.trace.data` / each `spans[].data`
— a SEPARATE copy of the URL the OpenTelemetry integrations every runtime's
SDK ships attach on their own, one level deeper than the `contexts` key-name
loop looks (`data` is not a PII key name). Both angles independently
reproduced this against the real installed SDK, not reasoned about: the
`/calendar/feed/<token>.ics` bearer and the `/inbound-email?secret=` webhook
secret both still reached Sentry through these fields, on error events too —
not only the transaction path the fourth gap closed.

Closed by scrubbing `event.transaction` (through the same `scrubUrl` path
redaction) and both `contexts.trace.data` and every `spans[].data` entry —
their `url`/`http.url`/`http.target` keys through `scrubUrl`, their
`url.query`/`http.query` keys dropped entirely, matching the founder's
"strip the query entirely" ruling already applied to `request.query_string`.
`http.route` is deliberately left untouched: it is already the parameterized
route template (`/calendar/feed/:token`), not a live value, and running
`scrubUrl` on it would corrupt the template. Pinned in `CONTAINER_PATTERNS`
as three new required containers (`transaction`, `contexts.trace.data`,
`spans`) so a runtime that stops covering one fails the build, mutation-tested
the same way as the rest of this guard (removing the coverage from one
runtime exits 1; a no-op change exits 0). Tested against event/span/context
shapes that mirror what the SDKs actually emit, not another hand-picked
minimal literal — the exact gap that let this round's finding through CI
clean in the first place.

**Still open (as written 2026-09-22; the first two items are closed by the
sixth gap below, 2026-09-25):** breadcrumb URLs are scrubbed in the **web
runtime only**, which leaves the three runtimes asymmetric on a container — the
exact condition the container check exists for, and the guard does not
require breadcrumbs. `Referer` is not in `SENSITIVE_HEADERS`, which matters for
the token-route form ADR 0158's `no-referrer` source does not match (the
trailing-slash case, `ADR-0158-TOKEN-ROUTES-MATCH-TRAILING-SLASH`, still
`open`). And `scrubUrl` returns on the **first** matching prefix, so a path
bearing two credentials would keep one; no route has that shape today.

**A sixth gap, and the "still open" list above, closed in round 3 (2026-09-25,
lane L3a).** Breadcrumbs are merged onto the event before `beforeSend`, and only
the web runtime scrubbed them — and only their `from`/`to`/`url` keys. Measured
against the installed SDKs rather than reasoned about: `@sentry/node-core`'s
outgoing http and fetch instrumentation (`getBreadcrumbData`) puts an outgoing
request's raw query in `data['http.query']` and its fragment in
`data['http.fragment']`, and a PostgREST lookup by token is exactly
`?token=eq.<token>`; `sentry_sdk`'s httpx and stdlib integrations do the same
with `sanitize=False`, and `LoggingIntegration(level=INFO)` turns httpx's own
`HTTP Request: GET <full URL>` line into a breadcrumb **message**
(`api/studio_routes.py` looks a studio invite up by its token). The same URL,
query included, reaches free text elsewhere: an `httpx.HTTPStatusError`'s
message quotes it, a log record's params carry it, and — found only by the new
real-SDK wire test, which no hand-built fixture would have — `sentry_sdk`
attaches frame locals by default (`include_local_variables`), so an httpx
`Request` repr and the formatted error message both sat in `frames[].vars`.

Closed the same way in all three runtimes: every breadcrumb's `message`, its
data (through the span-data rule, with `http.fragment` now dropped beside
`http.query`), its `from`/`to`, and a console crumb's `arguments`; the event
`message`; a log record's template, params and formatted form; each
exception's message, the strings in its frames' locals, and a frame path only
when it is an http(s) URL (a filesystem or bundle path, and with it source maps
and grouping, is left as the SDK produced it). Free text goes through a new
`scrubText`: any query or fragment carrying a `key=value` is removed wherever it
sits (a bare `?` or `#` in a sentence survives), and the one segment after every
`TOKEN_PATH_PREFIXES` occurrence is replaced. `Referer` is reduced through
`scrubUrl` rather than added to `SENSITIVE_HEADERS`, which deletes: it
describes where a person came from, and only its query and token segment are
the credential. Pinned as five new required containers in `CONTAINER_PATTERNS`
(`breadcrumbs`, `exception`, `message`, `logentry`, `request.headers.referer`),
mutation-tested (dropping any one from one runtime exits 1; a comment-only
control exits 0), and by the CLAIMS row
`ADR-0040-SCRUBBER-COVERS-BREADCRUMBS-AND-FREE-TEXT`, which also fails if the
guard stops pinning them. Each runtime now has a wire test that drives the real
SDK client and asserts on the serialized envelope, with a control proving the
Python one leaks when `before_send` is off.

**Still open after round 3, filed not fixed:** a frame local whose repr holds a
**bare** token with no URL around it (a request-body model, say) is invisible to
URL-shaped scrubbing; closing it means `include_local_variables=False` on the
Python init sites, which trades triage detail for what the tracker may hold and
is the founder's call, not this record's. A strict `xfail` test pins it open
and will fail the day it is closed. Frame locals can carry identity too (a local
named `email`), which `sentry_sdk`'s default denylist does not cover — a gap in
this record's own Decision, not only in the token work. `scrubUrl` still stops at
the first matching prefix.

**Revisit when:** a new `@Public()` route takes a credential in its path (the
guard will say so); Sentry's SDK adds a further container carrying a URL
beyond those now pinned (e.g. a new integration's own event extension) —
round 3's wire tests found one more that no fixture held, so treat this list as
open-ended; the frame-locals decision is made; or the trailing-slash referrer
gap is closed (ADR 0158, PR #423).

**[2026-09-25 — the frame-locals decision is made.]** Founder, in chat, on
"the recommended option": **"stop sending locals"** ([[founder-answers-2026-09-25-web-rebuild.md]]
#10). Closed the way this record anticipated: `include_local_variables=False`
at both `sentry_sdk.init()` sites (`services/agent-orchestrator/main.py`,
`services/agent-orchestrator/utils/sentry_client.py`) — the SDK now never
attaches `frames[].vars`, so the bare-token gap above has nothing to scrub.
The strict `xfail` this paragraph described is retired: PR #427 round 4 turns
it into a passing wire test that drives the real SDK with
`include_local_variables=False` and asserts the token never reaches the
transport, paired with a mutation test that re-enables locals and asserts the
same bare token *does* leak (`test_round3_frame_locals_disabled_a_bare_token_no_longer_leaves`
/ `test_round3_frame_locals_enabled_the_bare_token_does_leave` in
`services/agent-orchestrator/tests/test_sentry_pii_scope.py`). The
local-carries-identity gap (an unredacted `email` local) is unaffected by
this fix in the other direction — it is now moot for these two init sites,
since no locals of any kind reach Sentry from them.

**Gateway (Node) has the same class of leak, still open — not closed by this
bracket.** `@sentry/node-core@10.36.0`'s `getDefaultIntegrations()` includes
`localVariablesIntegration()` (`LocalVariablesAsync` on Node ≥19) unasked,
and `SentryService.initialize()` in
`apps/api-gateway/src/common/error-tracking/sentry.service.ts` passes
`integrations: []` — an **array**, which `@sentry/core`'s
`getIntegrationsToSetup` **merges** with `defaultIntegrations` rather than
replacing them (`[...defaultIntegrations, ...userIntegrations]`,
`@sentry/core/build/cjs/integration.js:51-52`), so the default local-variables
integration is active, unfiltered, on the gateway today. There is no
`includeLocalVariables` boolean on the Node SDK — the only lever is
`integrations` as a *function* filtering `defaults` by the integration's
`name` (`'LocalVariables'` / `'LocalVariablesAsync'`, undocumented-string
match, version-fragile), and there is no wire test in
`apps/api-gateway/src/common/error-tracking/sentry-wire.spec.ts` yet proving
either the leak or a fix — unlike the Python side, which now has both.
Founder's "stop sending locals" answer named the Python init sites (#10);
this record treats the Node gap as **not yet ruled on** and files it as a
candidate OD for L1 rather than fixing it inside PR #427, per §0.1: an
unverified, untested, string-matched change to production Sentry
configuration is not what "one line" was meant to license.

**[2026-09-26, PR #427 round 5 — the paragraph above is wrong on both of its
load-bearing facts; corrected, not deleted.]** (1) `includeLocalVariables`
**does** exist on the Node SDK: it is a typed init option
(`@sentry/node-core` `build/types/types.d.ts:76`, `@sentry/node`
`build/types/types.d.ts:52`). (2) The default local-variables integration is
**inert** on the gateway, not active: it is in the default set, but its
`setup()` returns early unless that option is truthy
(`integrations/local-variables/local-variables-async.js:108`,
`local-variables-sync.js:275`), no `getClientOptions` defaults it to `true`,
and `sentry.service.ts` never set it. So no frame locals have left the gateway,
and the "only lever is a name-matching `integrations` function" remedy is moot.
`sentry.service.ts` now states `includeLocalVariables: false` explicitly — the
same default, written down for the same reason `sendDefaultPii: false` is: a
silent default is not a control a guard can read, and it keeps the Node side
in step with the founder's "stop sending locals". No behaviour changes, so no
candidate OD is owed for it. The claim
`ADR-0040-FRAME-LOCALS-DISABLED-AT-BOTH-PYTHON-INIT-SITES` carried the wrong
Node sentence and now checks the Node line too.
