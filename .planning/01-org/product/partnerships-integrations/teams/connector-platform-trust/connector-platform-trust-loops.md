---
type: loops
division: product
department: partnerships-integrations
team: connector-platform-trust
status: partial
metrics: [pi.verified_ingress_ratio]
updated: 2026-08-24
links:
  - "[[connector-platform-trust-charter]]"
  - "[[connector-platform-trust-directive]]"
  - "[[partnerships-integrations-loops]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[access-control-tenant-isolation-charter]]"
  - "[[engineering-charter]]"
  - "[[LOOP-MAP]]"
loop_count: 5
loop_count: 5
loop_ids: ["cpt-ingress-classification", "cpt-credential-lifecycle", "cpt-consent-truth", "cpt-external-surface", "cpt-boundary-nonduplication"]
loop_close_times: ["per-PR", "monthly", "per-scope-change", "quarterly", "bi-weekly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Connector Platform & Trust — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

`pi.*` metrics are defined canonically in [[partnerships-integrations-loops]].

---

## L1 — Ingress classification integrity

The team's spine, and the loop that produces the number nobody currently has.

```yaml
type: loop
id: cpt-ingress-classification
owner: connector-platform-trust
measures: [pi.verified_ingress_ratio, routes.unclassified_count]
changes: [connector.trust_contracts, ci.ingress_guard, endpoints.classification]
inputs_from: [engineering, security, pos-bridge, supplier-distributor-network]
outputs_to: [security, engineering, partnerships-integrations]
close_time: per-PR
status: proposed
```

**Close-time is per-PR, and that is the whole design.** A weekly review *discovers* an
unclassified route; a per-PR guard *prevents* one. The weekly reading exists only to confirm
the guard is still wired — it is a check on the check.

**What it changes.** Trust contracts, the CI guard, and the classification annotations in
source from which the inventory is regenerated. The inventory is **generated, never
hand-maintained** — a hand-written one is stale within a quarter, and that staleness is what
produced the widely-cited and incorrect *"0 of 32 verify"*
([[connector-platform-trust-premortem]] M3).

**Today's reading, verified in-session.** Of the 32 routes in modules labelled "webhook":

| | Count | Detail |
|---|---|---|
| Actual ingress | **3** | pos-hub webhook · toast webhook · inbound-email |
| Verifying correctly | **1** | pos-hub — HMAC-SHA256 over raw body, `timingSafeEqual`, fails closed (`pos-hub.service.ts:96-121`) |
| Fail-open on unsigned | **1** | toast — verifier invoked only `if (signature && timestamp)` (`toast.service.ts:189`) |
| Secret in query string | **1** | inbound-email — `?secret=` accepted (`:57-58`) |
| Management / simulator, merely unauthenticated | **29** | includes the catalogue-match approval gate, `ENDPOINTS.md:361-362` |

---

## L2 — Credential lifecycle health

```yaml
type: loop
id: cpt-credential-lifecycle
owner: connector-platform-trust
measures: [credentials.paths_in_use, credentials.unencrypted_count, connections.stale_count]
changes: [integrations.provider_union, credential.rotation_policy, connector.deprecation_queue]
inputs_from: [pos-bridge, engineering, security]
outputs_to: [security, engineering, compliance-privacy]
close_time: monthly
status: proposed
```

**The first measure is the one that matters.** `credentials.paths_in_use` should be **1**. It
is 1 today only because there are two providers, both OAuth, both inside
`integrations/`. The moment a POS merchant token needs a home it becomes 2 — and Square and
Clover are *already* waiting on exactly that
(`pos-provider.registry.ts:76, :88` — *"needs merchant OAuth token"* / *"needs merchant API
token"*), while `IntegrationProvider` is a two-member union of `google | microsoft`
(`integrations-oauth.constants.ts:1`).

**What it changes.** Whether the provider union widens or a separate credential class is
adopted **with a written reason and a named owner**. Monthly is right because credential paths
change on the timescale of new integration classes, not new connections — but the loop is also
**triggered by any PR that stores a credential**, which is when the fork actually arrives.

---

## L3 — Consent-surface truth

```yaml
type: loop
id: cpt-consent-truth
owner: connector-platform-trust
measures: [consent.scope_drift_count, consent.surface_reachable]
changes: [integrations_oauth.constants, web.authorize_route]
inputs_from: [design, engineering, compliance-privacy]
outputs_to: [compliance-privacy, design]
close_time: per-scope-change
status: proposed
```

**Close-time is per-scope-change**, because a scope is granted once and lives forever. A
quarterly review of consent would find drift long after users had consented to something
nobody had read.

**The structural problem it addresses.** Scopes are declared once and *"shared by the consent
screen"* (`integrations-oauth.constants.ts:25`) — which is the right architecture and precisely
why drift here is silent: the screen faithfully renders whatever the constants say, and
**nobody can reach the screen.** `/authorize/:integrationId` has no inbound in-app link
(`PAGE_MAP.md:110`) and its route component cannot be traced (`PAGE_MAP.md:156`).

**The rule it enforces:** any scope change is reviewed **as rendered**, not as source. A
consent screen nobody can reach is a consent screen nobody has read
([[connector-platform-trust-premortem]] M5).

---

## L4 — External surface inventory

```yaml
type: loop
id: cpt-external-surface
owner: connector-platform-trust
measures: [env_vars.unowned_count, hosts.unowned_count, hosts.placeholder_in_prod_path]
changes: [connector.catalogue, engineering.config_cleanup]
inputs_from: [engineering, security, reliability-sre]
outputs_to: [security, engineering, reliability-sre]
close_time: quarterly
status: proposed
```

**Why quarterly and why it is still worth having.** The surface is **80 environment variables**
and every third-party host ([[EXTERNAL_CONNECTIONS]]). It changes slowly, so a faster cadence
would read "no change" and be skipped. But it contains a specific, named defect class:
`abc123.ngrok.io` and placeholder domains (`your-domain.com`, `a.com`, `b.com`,
`via.placeholder.com`) appear in source paths (foundation `README.md:57-59`) — fixtures or
stale config, but **they should never be reachable from a production code path.**

`hosts.placeholder_in_prod_path` is the measure that makes this loop actionable rather than
archival. If it reads 0 for three consecutive quarters, this loop should be **downgraded to a
CI check and deleted as a loop** — a quarterly review that always reads zero is a scheduled
job that produces no action, and the anti-sprawl rule applies to us too.

---

## L5 — Boundary non-duplication

Small, and pointed at this team's own most likely failure.

```yaml
type: loop
id: cpt-boundary-nonduplication
owner: connector-platform-trust
measures: [metrics.overlap_with_sec2, contracts.co_signed_ratio]
changes: [connector_platform_trust.metric_set, partnerships.od23_position]
inputs_from: [perimeter-ingress-integrity]
outputs_to: [perimeter-ingress-integrity, decision-office]
close_time: bi-weekly
status: proposed
```

**What it watches.** Whether `pi.verified_ingress_ratio` and SEC-2's
`unverified_public_ingress` have started describing the same surface with different numbers —
the earliest observable signal of [[connector-platform-trust-premortem]] M2.

**What it changes, pre-decided.** If they measure the same surface, **ours is deleted.**
Security owns the control; we own the contract. That is not negotiated at the moment of
overlap; it is committed here so the overlap has a resolution before it happens.

**Close-time is bi-weekly** because it rides the standing coordination slot with Security —
it costs one question in a meeting that already exists, which is the only reason a loop this
small is worth running.

---

## Not owned here

| Loop | Owner | Why |
|---|---|---|
| Control effectiveness / `unverified_public_ingress` | [[perimeter-ingress-integrity-charter]] | **The** boundary. We supply the contract; they measure enforcement |
| `JwtAuthGuard` coverage across the ~94 unguarded-by-omission routes | [[access-control-tenant-isolation-charter]] | Different control, different question (OD-19) |
| Canonical shape neutrality | [[pos-bridge-charter]] | Shape is theirs; credentials and trust are ours |
| Vendor-page publish-state | [[supplier-distributor-network-charter]] | Publish-state is a relationship property |
| Rate limiting and CORS | [[perimeter-ingress-integrity-charter]] | Named explicitly in their mandate |
