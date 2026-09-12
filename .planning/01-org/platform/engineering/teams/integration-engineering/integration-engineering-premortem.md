---
type: premortem
division: platform
department: engineering
team: integration-engineering
status: provisional
metrics: [integration.verified_signature_coverage, integration.webhook_silence_duration]
updated: 2026-09-01
links: ["[[integration-engineering-charter]]", "[[integration-engineering-loops]]", "[[integration-engineering-directive]]", "[[engineering-premortem]]", "[[platform-api-charter]]", "[[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]]", "[[red-team-charter]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Integration Engineering — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:268-270`): *Toast ships a breaking
webhook payload change on a Friday, the failure surfaces as "inventory looks stale" rather
than an error, and nobody notices for a week because **a webhook that stops arriving
produces no signal at all**.*

That last clause is the team's defining problem. Everything below is a variation on it.

## It is 2027-08. This team has failed. What happened?

### M1 — Silence was not an error

Toast changed a payload field on a Friday. The adapter threw, or the handler returned 400,
or the events simply stopped. There is no alert for *absence*: monitoring watches error
rates on requests that arrive, and requests that never arrive have no rate. The first
symptom is a restaurant saying inventory looks stale — nine days later, after a week of
service. By then the gap cannot be backfilled, because POS providers do not replay
arbitrary history.

**Earliest observable signal.** Time since last inbound event, **per integration**,
compared to that integration's own normal rhythm. A restaurant that sends events every few
minutes during service and nothing for two hours at 20:00 is the signal. This is
computable from data the system already receives, today, with no provider cooperation.

**Counter-pressure.** `integration.webhook_silence_duration` is a **first-class metric with
an alerting threshold per integration**, derived from that integration's own baseline
rather than a global constant. Silence is treated as an incident, not as quiet. Pair with a
periodic active poll where the provider API allows one — an integration that can only be
verified passively cannot distinguish "no activity" from "no connection".

---

### M2 — Signature coverage stayed unmeasured, then was assumed complete

The charter says measuring coverage is the team's first task, because the number is
unknown. `POS_HUB_WEBHOOK_SECRET` has 8 references and `TOAST_WEBHOOK_SECRET` has 2
([[EXTERNAL_CONNECTIONS]]) — suggestive of uneven coverage and proof of nothing. The
comfortable path is to note that secrets exist, conclude verification happens, and move on.
Then ~51 public endpoints are described internally as "signature-verified" and some
fraction of them accept anything.

**Earliest observable signal.** Any document, dashboard, or conversation asserting webhook
verification **without a per-route table**. The assertion itself is the signal, because the
enumeration does not exist yet.

**Counter-pressure.** Produce the table before anything else: one row per public route,
column for verification mechanism, column for a test that proves an unsigned request is
rejected. **The proof is a rejected request, not the presence of a secret.** A secret in
the environment demonstrates intent; only a failing request demonstrates verification.

---

### M3 — Placeholder hosts turned out to be live

`abc123.ngrok.io` and `your-domain.com` still appear in source paths
([[EXTERNAL_CONNECTIONS]]:13,21). Today nobody knows whether these are dead code, dev
scaffolding, or a live path pointing at a tunnel someone else can now claim. An `ngrok`
subdomain is not owned — it is leased and reassignable. If a live callback still points
there, a stranger who registers that subdomain receives our webhooks, or serves responses
into our ingestion path.

**Earliest observable signal.** The presence of the strings, which is already established.
The unknown is not *whether* they exist but whether they are reachable — and that is a
one-afternoon investigation nobody has done. Not doing it is the failure.

**Counter-pressure.** Resolve the ⚠️ before any new integration work: for each occurrence,
determine dead / dev-only / live, and delete or replace it. A grep gate on placeholder
hosts in shipped configuration, so the class cannot return. Treat this as a **security**
finding routed to [[security-charter]], not as tidying — the consequence is inbound data
from an unowned host.

---

### M4 — The seam with substrate quality was never held, so nobody owned stale data

`technology.md:859` draws the line: **delivered correctly** (this team) versus **usable as
L0** (`dat-pos-telemetry-ingest`). In practice a report arrives — "sales numbers look
wrong" — and it is genuinely ambiguous: dropped webhook, or a mapping that silently
misclassified a menu item? Each team reasonably believes it is the other's. Two weeks pass.
This is [[engineering-premortem]] M1 in its most likely concrete form.

**Earliest observable signal.** The first data-quality report that both teams look at and
neither claims within one close-time. The age of that report is the metric.

**Counter-pressure.** The seam has a **default owner**: this team, as left-of-seam
(`technology.md:859`), takes first triage and answers one question — *did the event arrive,
intact and on time?* A yes hands it to [[pos-operational-telemetry-ingest-charter|dat-pos-telemetry-ingest]] with evidence attached;
a no keeps it. Answering that question requires per-event delivery records, which is
therefore a prerequisite rather than a nicety.

---

### M5 — "Public" was allowed to mean "unauthenticated" one route too far

This team owns ~51 legitimately-public routes, and that legitimacy is real. It is also the
most useful precedent in the codebase for anyone who wants a route to skip auth. The
`recurring-orders` cluster was justified as "internal" — the same argument in a different
costume — and it has since been **closed**: all six routes have carried a class-level
`@UseGuards(JwtAuthGuard)` since 2026-08-25
(`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
OD-20); [[ENDPOINTS]]:464-473 marks all six ✅. That the argument lost once does not retire
M5: "internal" is still the costume the next exemption request will arrive in, and this
team is still where it will arrive. When [[platform-api-charter]] ships its allowlist, this
team is the natural owner of entries, and every future exemption request will arrive here
first, phrased as an integration need.

**Earliest observable signal.** An allowlist request from a team that does not speak a
third-party protocol. The first one, and the phrasing will be plausible.

**Counter-pressure.** This team owns **entries**, [[platform-api-charter]] owns the **file
and its enforcement**, and both must co-sign — so neither can widen the exemption alone.
The criterion is stated positively and narrowly: a route qualifies if a third party calls
it **and** its authenticity is verified by signature. Not "internal", not "the agent calls
it", not "it 401s in dev". A route with no signature verification is not public; it is
unprotected, and belongs on someone's remediation list.

---

## What [[red-team-charter]] should attack first

M3, immediately, because it is cheap and possibly live: two placeholder hosts in source
paths, one of them on a reassignable tunnel domain. Then M2 — the team's primary metric is
explicitly unmeasured, and every claim about integration security rests on it.
