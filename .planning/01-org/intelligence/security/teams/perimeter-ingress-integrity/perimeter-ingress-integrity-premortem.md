---
type: premortem
division: intelligence
department: security
team: perimeter-ingress-integrity
status: provisional
metrics: [sec.unverified_public_ingress, sec.fail_open_defaults, sec.distributed_rate_limit_present, sec.secrets_in_url_or_bundle]
updated: 2026-08-24
links: ["[[perimeter-ingress-integrity-charter]]", "[[perimeter-ingress-integrity-loops]]", "[[perimeter-ingress-integrity-directive]]", "[[security-premortem]]", "[[access-control-tenant-isolation-charter]]", "[[integration-engineering-charter]]", "[[platform-api-charter]]", "[[ENDPOINTS]]"]
---

# Perimeter & Ingress Integrity — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

Five mechanisms. The first is the division doc's own premortem line
(`intelligence.md:292-294`), expanded — and it is more likely than it looks, because the
codebase already contains four instances of the exact inversion it describes.

---

### M1 — Signature verification was added and it failed *open*

A signature check is added to `simpos` or `inbound-email`. It works in staging. Then in one
environment the secret is not set — a new region, a preview deploy, a rotated key that did
not propagate — and the code takes the reasonable-looking branch: *no secret configured, so
skip verification and accept*. The endpoint now looks verified in every audit, every
dashboard, every `ENDPOINTS.md` regeneration, and verifies nothing.

**This is not a hypothetical inversion; it is the codebase's dominant habit.** Four
existing controls do exactly this: `tenant.guard.ts:38-46` returns `true` with no
authenticated user and logs a warning, and three independent sites fall back to a public
default JWT secret (`jwt.strategy.ts:12-13`, `auth.service.ts:64-66`,
`auth.module.ts:28-30`) with `auth.service.ts:71-75` logging *"Using default JWT_SECRET"*
and continuing. The house style is **warn and continue**. Writing a fifth control in that
style requires no bad intent at all — only consistency with the surrounding code.

**Earliest observable signal.** A code path where a missing secret produces `return true`,
`skip`, or a `logger.warn` followed by normal processing. Reviewable as a diff shape, not
an outcome. Second signal, environment-side: a service that starts successfully with an
empty secret — startup should refuse, not warn.

**Counter-pressure.** The correct shape is already in this repo, twice, with the reasoning
written into the comments: `toast.service.ts:112-121` (*"fail closed. A missing
TOAST_WEBHOOK_SECRET must reject every signed request, not wave everything through"*) and
`pos-hub.service.ts:87-95`, the latter with tests asserting the no-secret case
(`pos-hub.service.spec.ts:239`). **Every new verification copies that file, including its
test.** And `sec.fail_open_defaults` is tracked as a standing counter with a baseline of 4,
so the habit has a number attached to it rather than being a matter of taste.

---

### M2 — The module labels were trusted and the audit checked the wrong control

The team audits signature coverage module by module, because that is how `ENDPOINTS.md` is
organised. `toast` green. `pos-hub` green. `simpos` — labelled *"webhook module — expected
public, must verify signatures instead"* (`ENDPOINTS.md:536`) — is checked for signatures,
and signatures are found (`simpos.service.ts:498-502`), correct and fail-closed. Green.
`sec.unverified_public_ingress` reports a healthy number.

Nothing in that audit notices that `simpos` **receives** no webhooks, that its eleven
routes are an unauthenticated control surface taking the tenant from the URL, or that the
signature it produces is generated **by our own server on an anonymous caller's behalf**
and consumed by `pos-hub`, which then depletes stock (`pos-hub.controller.ts:57`). The
perimeter control was real, correct, tested — and pointed at the wrong question.

The census has been wrong at module level twice out of five ingress modules:
`vendor-portal` was labelled a webhook needing signatures when it is public content by
slug (since corrected), and `simpos` still is. **A 40% module-label error rate is the
measured base rate here, not a worry.**

**Earliest observable signal.** Any audit artifact whose unit of analysis is a *module*
rather than a *route*. Concretely: a coverage report with five rows.

**Counter-pressure.** Per route, always ([[security-directive]] rule 2). The verdict
template requires naming **who sends the request** and **what proves it** — and for
`simpos` both answers come out wrong immediately, which is the test. Carry `simpos` in
[[perimeter-ingress-integrity-agenda-board]] as the standing counter-example so a new
teammate meets it in week one.

---

### M3 — The rate limit was the control, and it was per-process

Rate limiting is the last brake on several exposures — it was the *only* brake on the
analytics denial-of-wallet hole. It is registered globally with sensible tiers
(`rate-limit.guard.ts:27-33`) and stored in an in-memory `Map` (`:65-70`). At one instance
that is fine. At four instances the effective limit is four times the number on the tin,
and nobody notices, because nothing surfaces the multiplier — the config still says
`ai: 20/60s`.

The failure completes when an incident review concludes *"rate limiting was in place"*.
That sentence is true and useless, and it closes the investigation.

**Earliest observable signal.** `sec.distributed_rate_limit_present` = `false` while any
document, incident note, or charter cites a tier number as a control. The mismatch between
"a limit exists" and "the limit is N" is the whole finding. Second signal: nobody can state
the deployed instance count — if the multiplier is unknown, the limit is unknown.

**Counter-pressure.** Report the tier as **`limit × instances`**, never as `limit`, until
the store is shared. Put the instance count on the board. And when this charter cites rate
limiting as mitigation anywhere, the citation carries the multiplier — which makes the
Redis work argue for itself instead of needing a champion.

---

### M4 — The 23 unverified routes were classified and the 9 obvious ones were kept

`communications/test/e2e/step1-trigger-threshold` … `step6-check-status` and
`test/send-template` (`ENDPOINTS.md:153-162`) are nine `@Public()` routes in a production
build that drive a real end-to-end flow — including sending vendor email. They carry
`@Public()` **deliberately**, which is exactly what makes them dangerous: the decorator
reads as a decision that someone already made and vouched for.

The predictable outcome is a verdict of `public-with-shared-secret`, a secret is added, the
routes stay, and the org now maintains an authenticated remote-control API for its own
outbound email because deleting things is socially harder than securing them.

**Earliest observable signal.** A verdict of anything other than `delete` on a route whose
path contains `test`. Not proof of failure — but it should require an explicit written
justification naming the consumer, and if the consumer is *"a developer, manually,
sometimes"*, that is the answer.

**Counter-pressure.** `delete` is a first-class verdict in the template
([[perimeter-ingress-integrity-directive]]), not a last resort. Escalate the nine as a
single founder question rather than nine route decisions — one decision is answerable,
nine are attritional. And where a test route must survive, it is gated by `NODE_ENV`
following `dev-bypass.util.ts:46-52`'s five-condition pattern, which is the repo's own
proof that "developer convenience, safely" is a solved problem here.

---

### M5 — Secrets were rotated and nothing changed, because nobody knew where they were

80 environment variables (`EXTERNAL_CONNECTIONS.md`). A secret leaks — a laptop, a log, a
screenshot in a support ticket. Rotation begins. Nobody has a map of which service reads
which variable, which have public-string fallbacks that will silently absorb an empty
value, or which are baked into a built frontend bundle rather than read at runtime. The
rotation completes, the dashboards are green, and one service is still accepting the old
credential because its fallback kicked in.

Two live seeds for this: `VITE_DEV_AUTH_BYPASS_SECRET` is compiled into the web bundle, so
"rotating" it requires a rebuild and every previously-built bundle keeps the old value
forever; and `INBOUND_WEBHOOK_SECRET` travels in `?secret=` query strings
(`inbound-email.controller.ts:57-58`), so its historical values are sitting in access logs
that rotation does not reach.

**Earliest observable signal.** Nobody can answer *"which services read
`POS_HUB_WEBHOOK_SECRET`?"* from a document in under a minute. Test it before an incident,
not during one.

**Counter-pressure.** One inventory, generated rather than written —
`EXTERNAL_CONNECTIONS.md` is already the regenerated grep target, so extend it with
consumer and fallback columns. Eliminate the two known leak paths first (query-string
credential → header only; bundle secret → server-side only), because a rotation plan for a
secret that is already in log files and shipped bundles is theatre.

---

## Signal summary

| # | Mechanism | Earliest signal | Watched by |
|---|---|---|---|
| M1 | Verification fails open | A `logger.warn` followed by normal processing | L-PII-2 · weekly |
| M2 | Module labels trusted | A coverage report with five rows instead of 43 | L-PII-1 · weekly |
| M3 | Per-process rate limit cited as a control | Limit quoted without its instance multiplier | L-PII-3 · monthly |
| M4 | Test routes secured instead of deleted | Non-`delete` verdict on a path containing `test` | L-PII-1 · weekly |
| M5 | Rotation with no map | "Which services read X?" takes over a minute | L-PII-4 · monthly |

**The one-sentence version.** Four of these five end with a control that is genuinely
present, genuinely correct, and answering a question nobody asked — so this team's verdicts
must always name **who sends the request**, not merely **what checks it**.
