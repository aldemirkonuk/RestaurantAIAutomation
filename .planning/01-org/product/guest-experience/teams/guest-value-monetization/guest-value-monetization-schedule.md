---
type: schedule
division: product
department: guest-experience
team: guest-value-monetization
status: provisional
metrics: [nf_b.k_anonymity_pass_rate, nf_b.ops_conversion, nf_b.photo_consent_rate]
updated: 2026-08-24
links: ["[[guest-value-monetization-charter]]", "[[guest-value-monetization-loops]]", "[[guest-value-monetization-directive]]", "[[guest-experience-schedule]]", "[[skills-charter]]", "[[compliance-privacy-charter]]", "[[legal-charter]]", "[[analytics-bi-charter]]", "[[product-vision-charter]]"]
---

# Guest Value & Monetization — Schedule & Skills

> **The team is unstaffed.** Three jobs below run today anyway, because all three are
> counter-pressures that only work **before** the thing they guard exists.

## Recurring work

| Cadence | Job | Active? | Emits |
|---|---|---|---|
| Per-commit | `k-threshold-constant-guard` — the k-threshold is a code constant, not an env var, settings row, or per-restaurant override. Shape: the four guest PII guards | **yes — build now** | `k_threshold_configurable` (must be false) |
| Per-render | `k-anonymity-render-gate` — every restaurant-facing guest-data render passes k, or shows the empty state. **100%, no admin exception** | on activation | `nf_b.k_anonymity_pass_rate` · `nf_b.sub_k_render_attempts` |
| Weekly | `sub-k-pressure-read` — `nf_b.sub_k_render_attempts` trend. A rise means the threshold is about to be questioned; the response is **better empty-state copy**, never a lower number | on activation | `nf_b.sub_k_render_attempts` |
| Per-use | `photo-consent-check` — no photo enters enrichment or promotion without a **live, purpose-scoped** consent record for that specific purpose. Enforced at the pipeline, not the surface | on activation | `nf_b.photo_consent_rate` · `photos_used_without_purpose_consent` |
| Per-placement | `advertising-boundary-check` — every ad-carrying surface checked against every surface promising no advertising (`ServicesPermissions.tsx:41,249`). **Verdict is BLOCKED while no written boundary exists** | **yes — the blocking verdict is live now** | `promise_copy_consistency` · `boundary_statement_current` |
| Monthly | `revocation-propagation-audit` — revoked photo consents actually removed from live surfaces and downstream catalog use | on activation | `revocations_propagated` |
| Quarterly | `ops-conversion-review` — decisions traceable to a named NF-B segment. **Two consecutive quarters at zero returns the sub-layer charter to [[product-vision-charter]]** | **yes — reporting 0** | `nf_b.ops_conversion` · `nf_b.segment_to_decision_latency` |
| Quarterly | `self-review-audit` — confirm every privacy gate this team operates was reviewed by [[compliance-privacy-charter]] and **not internally** | on activation | Review trail |

**Anti-sprawl, with two named exemptions.** A job producing no action for 3
consecutive runs is downgraded or deleted ([[README]] §6).
`k-threshold-constant-guard` and `photo-consent-check` are **supposed** to produce no
action forever — a guard that fires arrived too late. `ops-conversion-review` is
explicitly **not** exempt in the usual direction: it reporting zero is not "no action",
it is the finding, and three quiet quarters escalates rather than downgrades.

## Skills owned

Skills live in `.claude/skills/`. **The directory does not exist yet**
([[skills-charter]]). Each names trigger, doneability, and a real past instance per
[[README]] §3.3.

### `k-anonymity-gate-check` (T2)

- **Trigger.** Any new or changed restaurant-facing view of guest-derived data.
- **Doneability.** Confirms (a) the threshold is read from the code constant, (b) the
  sub-k path renders the empty state rather than an error or a partial, (c) the claim
  prints its n, and (d) no admin or staging branch bypasses the gate.
- **Real past instance.** `NEW-659`, `NEW-660`, `NEW-661`, `NEW-665`
  (`UX_PATHS_CATALOG.md:1484-1490`) are five restaurant-facing surfaces already
  specified and none built. The check should exist before the first one ships, because
  after the first ships the check becomes a retrofit argued against a working screen.

### `photo-consent-scope-check` (T2)

- **Trigger.** Any code path that reads, copies, or publishes a guest-supplied photo.
- **Doneability.** Verifies a live consent record exists **for the specific purpose**
  — catalog enrichment, restaurant promotion, and paid placement are three purposes and
  one "yes" does not transfer. Verifies revocation propagates.
- **Real past instance.** `NEW-865` promises *"consent prompt for catalog reuse"*
  (`UX_PATHS_CATALOG.md:1781`) and the enrichment pipeline it would feed already exists
  ([[FUTURES]] §4) while the consent plumbing does not. A capability without its gate
  is one integration away from using a photo it has no right to.

### `advertising-boundary-check` (T2)

- **Trigger.** Any advertising or sponsored-placement design or implementation.
- **Doneability.** Confirms a written boundary statement exists and that the surface
  falls inside it; greps for any product copy promising no advertising and reports
  conflicts. **Blocks while the statement is unwritten.**
- **Real past instance.** `apps/web/src/components/settings/ServicesPermissions.tsx:41`
  and `:249` already promise no advertising on the operator surface while this team's
  charter names advertising as its revenue model. Found by grep this session, absent
  from the team layer — which is precisely how it would be found by someone outside the
  company later.

### `segment-traceability-check` (T2)

- **Trigger.** Any restaurant-facing recommendation or insight surface.
- **Doneability.** Confirms the surface carries the segment id that produced it and
  that acting on it writes back — the chain `nf_b.ops_conversion` needs to be
  computable at all.
- **Real past instance.** `NEW-664` (digest → menu experiment) and `NEW-882`/`NEW-883`
  (advocacy → par and promotion suggestions) all *end* at a restaurant decision with no
  write-back specified. Without the chain the metric is unmeasured rather than zero,
  and unmeasured reads as neutral for four quarters.

**Not proposed:** anything that computes, optimises, or forecasts revenue. **Pricing
is founder-deferred**, and a skill that optimises ad yield is a pricing model with a
different filename.

## Review

All four reviewed against the 30-day staleness rule from the day `.claude/skills/`
exists. `advertising-boundary-check` is expected to sit at BLOCKED until the boundary
statement is written — that is the skill working, not the skill going stale.
