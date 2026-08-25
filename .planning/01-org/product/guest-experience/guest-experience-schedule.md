---
type: schedule
division: product
department: guest-experience
parent_department: product-vision
status: provisional
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.k_anonymity_pass_rate, nf_b.ops_conversion]
updated: 2026-08-24
links: ["[[guest-experience-charter]]", "[[guest-experience-loops]]", "[[guest-experience-directive]]", "[[guest-identity-consent-schedule]]", "[[taste-fingerprint-schedule]]", "[[consumer-app-points-economy-schedule]]", "[[guest-value-monetization-schedule]]", "[[skills-charter]]", "[[compliance-privacy-charter]]", "[[decision-office-charter]]"]
---

# Guest Experience — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per-commit | `guest-merge-gate` — `scripts/eval_guest_merge_policies.py` against `guest_copresence_negatives`; fails CI on **one** false merge | CI status · `nf_b.false_merge_count` |
| Per-commit | `guest-pii-guards` — the four existing guards run together: `check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`, plus assertions that `revoke all on public.guest_identifiers` (`:485`) and `guest_pepper()`'s raise-on-missing-secret (`:353-359`) are still in the schema | CI status |
| Weekly | `nf-b-coverage-report` — `nf_b.subject_coverage` by restaurant and by capture channel, with the **refusal count printed beside it** as output, not friction | `nf_b.subject_coverage` · `nf_b.refusal_count` |
| Weekly | `nf-b-completeness-sweep` — share of NF-B events missing any of `stimulus` / `choice` / `outcome` / `context`, broken out by which field is missing | `nf_b.event_completeness` |
| Monthly | `cohort-divergence-check` — spread of predicted preference within identical-exposure cohorts; flags collapse toward the regional mean | `nf_b.divergence_within_cohort` |
| Monthly | `guest-agenda-sync` — full vs board agendas drifted? ([[README]] §6). Also flags any unit whose `updated` moved while §Next steps did not | — |
| Quarterly | `ops-conversion-review` — restaurant decisions traceable to a named NF-B segment. **Two consecutive quarters at zero returns this charter to Product & Vision for a scope decision.** | `nf_b.ops_conversion` |
| Quarterly | `consent-version-audit` — every live `consent_notice_version` still has retrievable notice text, and no guest is under a version we can no longer produce. Run **with** [[compliance-privacy-charter]] | — |
| On entry-trigger | `od-07-watch` — surfaces OD-07 in the open-decision digest until it resolves; [[consumer-app-points-economy-charter]] stays unstaffed until then | — |

**Anti-sprawl, applied to this table.** A scheduled job that produces no action for
**3 consecutive runs** is downgraded or deleted ([[README]] §6). Two exemptions,
named rather than assumed: `guest-merge-gate` and `guest-pii-guards` are *supposed*
to produce no action forever — a guard that fires is a guard that arrived too late.
They are exempt from the rule and from nothing else.

## Skills owned

Skills live in `.claude/skills/`. **The directory does not exist yet**
([[skills-charter]] §Evidence: the repo's committed skill count is zero), so
everything below is a **proposal**, and each entry names the trigger, the doneability
criterion, and the real past instance [[README]] §3.3 requires. No speculative skills.

| Skill | Tier | Trigger | Doneability | Real past instance |
|---|---|---|---|---|
| `guest-merge-review` | T2 | Any diff touching `guest_link_identifier()`, `guest_channel_canonicalise()`, `guest_pepper()`, or the merge-eligibility generated column | Produces a written finding naming which of the four PII guards the diff moves and whether the change is founder-only under [[guest-experience-directive]] | The 564-line slice itself — the reasoning at `:27-35` and `:145-162` currently lives only in SQL comments, which is exactly the knowledge a review skill exists to keep applying |
| `k-anonymity-gate-check` | T2 | Any new or changed restaurant-facing view of guest-derived data | Confirms the k-threshold is read from the code constant, that the sub-k path renders the empty state, and that the claim prints its n | `NEW-659`, `NEW-660`, `NEW-661`, `NEW-665` (`UX_PATHS_CATALOG.md:1484-1490`) are five surfaces already specified, none built — the check should exist before the first one ships |
| `nf-b-event-contract-lint` | T2 | Any code path emitting an NF-B event | Rejects an event missing any of the four fields; reports *which* field, so the fix is directed | The completeness metric is defined but has no enforcement; without this it becomes self-reported |
| `consent-copy-diff` | T2 | Any change to consent text, purpose strings, or capture channels | Bumps `consent_notice_version` and preserves the prior text as retrievable | `consent_notice_version` exists (`:59`) with **no process that bumps it** — a version column nobody increments is a boolean with extra steps |

**Not proposed, deliberately:** a `guest-personalization` or `taste-model` skill.
There is no real past instance — 37 distinct item strings across one day
([[DISH_IDENTITY_DESIGN]] §1.1) — and [[README]] §3.3 rule 3 forbids speculative
skills. It gets proposed when [[taste-fingerprint-charter]]'s wine-only track has
fired a model at least once.

## Review

The four proposed skills are reviewed against the 30-day staleness rule
([[README]] §3.3) from the day `.claude/skills/` exists. Two of them —
`guest-merge-review` and `k-anonymity-gate-check` — are expected to fire *rarely*
by design. Rare is not stale: the staleness review asks whether the **trigger
occurred and the skill failed to fire**, not whether the skill fired.
