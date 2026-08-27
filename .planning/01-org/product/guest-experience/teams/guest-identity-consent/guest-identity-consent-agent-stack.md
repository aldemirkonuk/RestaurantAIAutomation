---
type: agent-stack
division: product
department: guest-experience
team: guest-identity-consent
status: designed
updated: 2026-08-27
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.refusal_count, nf_b.consented_link_rate]
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-schedule]]", "[[guest-identity-consent-loops]]", "[[guest-identity-consent-directive]]", "[[guest-identity-consent-premortem]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[guest-experience-agent-stack]]", "[[compliance-privacy-charter]]", "[[skills-charter]]"]
---

# Guest Identity & Consent — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The only team whose errors are irreversible gets the most negative card in the vault:
> this agent keeps four guards structurally present and refuses. It has **no write path
> to guest data at all**, and that is not a phase. Two seams bound it. **NF-B is HELD**
> ([[0029-p3-plan-of-record]] §3): callers measured zero on 2026-08-26, and §6.4 names
> *"NF-B gets wired minimally by someone being helpful"* as how that decision gets
> reversed by accident. And **PII allowlists are not this team's call** — the empty
> allowlist at `scripts/check_no_guest_name_matching.sh:37-38` is a compliance-privacy
> decision, and an agent that adds a line to it has quietly become the reviewer.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `guest-identity-warden` | Assert the four PII guards are structurally present (not merely green), read coverage only ever beside refusals, and produce a written finding on any diff that introduces a similarity score by any name | NEW |

## 2. Agent cards

```yaml
agent: guest-identity-warden
unit: guest-identity-consent
triggers:
  - schedule: "per commit — alongside the guest-merge-gate CI job"   # .github/workflows/schema-parity.yml:185-212; mirrored in [[guest-identity-consent-schedule]]
  - schedule: "weekly — coverage-and-refusals"
  - topic: guest.link_refused                                        # publisher: NONE (gap — see §5)
consumes:
  - "supabase/migrations/20260819000000_guest_identity_minimal_slice.sql (the three tables, the four guards, the RLS at :465-485)"
  - "scripts/check_no_guest_name_matching.sh, scripts/check_no_raw_guest_channels.sh, scripts/eval_guest_merge_policies.py"
  - "the guest-merge-gate CI verdict (.github/workflows/schema-parity.yml:185-212)"
  - "diffs touching guest_link_identifier(), guest_channel_canonicalise(), guest_pepper(), or the is_merge_eligible generated column (:168-169)"
emits:
  - written merge-review findings into the PR that triggered them
  - "guard-presence facts → memory PRs (§4); nf_b.false_merge_count and nf_b.refusal_count to [[guest-experience-agent-stack]]'s weekly rollup"
  - nf_a events (task_type: guest_guard_audit)
routing_class: judgment
quality_bar: "nf_b.false_merge_count = 0 — a gate, graded by scripts/eval_guest_merge_policies.py in CI. For the review findings: NONE (gap) — no verdict basis exists for 'does this diff introduce a threshold' (ADR 0017 has no such grader)"
autonomy:
  read: autonomous
  propose: autonomous            # findings and memory facts land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: guest-identity-consent
escalates_to: "[[compliance-privacy-charter]]"   # any proposed allowlist entry, consent-text change, or guard weakening; the sub-layer board gets the numbers, the reviewer gets the judgment
```

**Two hard rules the card cannot be read without.** (1) The warden never generates,
scores, or ranks a merge candidate — [[guest-identity-consent-directive]] makes
candidate generation founder-only, and *a skill that produces candidates is a merge
queue with a different filename*. (2) It never writes an application caller for the
slice; the structural zero is a decision it reports, not a gap it closes.

`routing_class` is `judgment` because the card is graded by its hardest half: asserting
`revoke all` is still at `:485` is mechanical, but reading whether a diff reintroduced a
similarity threshold under another name is not — and grading the row mechanical is how
it gets routed too cheaply.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `guest-merge-review` | T2 | Any diff touching `guest_link_identifier()`, `guest_channel_canonicalise()`, `guest_pepper()`, the `is_merge_eligible` column, either guard script, or the three tables' RLS | A written finding naming (a) which of the four guards the diff moves, (b) whether it is founder-only under the directive, (c) whether it introduces a similarity score by any name | The 564-line slice itself: its load-bearing reasoning — no threshold (`:27-35`), tombstone not soft-delete (`:71-78`), card fingerprint quarantined despite verification (`:154-162`), incompleteness fails to a split (`:285-289`) — lives **only** in SQL comments in a file nobody re-reads ([[guest-identity-consent-premortem]] F5) | NEW |
| `consent-copy-diff` | T2 | Any change to consent text, `consent_purpose`, `consent_captured_via`, or the CHECK at `:61-62` | `consent_notice_version` is bumped **and** the prior text archived as a retrievable artifact keyed by the old version | `consent_notice_version` exists at `:59`; grepped 2026-08-27 across `apps/`, `services/`, `scripts/` — **no code reads or writes it**. A version column nobody increments is a boolean with extra steps | NEW |
| `erasure-receipt` | T2 | A guest erasure request (`NEW-662` `07-reference/UX_PATHS_CATALOG.md:1492`, `NEW-884` `:1805`) | Runs the tombstone path and writes `erasure_receipt_id` with an enumeration of what was deleted; verifies historical `guest_check_links` still resolve and the surviving row holds nothing about the person (`:112-117`) | `erasure_receipt_id` (`:82`) is a column nothing writes — same 2026-08-27 grep, zero hits. The erasure design is complete and its **proof** is not | NEW |

**Deliberately absent:** anything that resolves, scores, or suggests guest matches.
Not a capacity limit — see the card's hard rule.

Consumed, owned elsewhere: the skill envelope ([[skills-charter]]); consent notice
wording and any allowlist decision ([[compliance-privacy-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates go to [[skill-harvesting-charter]]'s queue
  through the §3.3 gate. A candidate that would generate merge candidates is rejected at
  proposal, not at review.
- **Episodic** — nf_a `task_type: guest_guard_audit` and `guest_merge_review`, with
  `context.guard` naming which of the four a run touched. NF-B contributes nothing:
  `nfe_guest_choice` (`20260824141116_neural_footprint_event.sql:51-54`) has no writer,
  so the layer is audit and review runs only — by design, not by shortfall.
- **Semantic** — `memory/` beside this file, one fact per file with `source` /
  `confidence` / `last_verified`; index `guest-identity-consent-MEMORY.md`. Its first
  facts are known: the four guards and what each closes; the allowlist is empty and
  whose call it is to change; `consent_notice_version` and `erasure_receipt_id` are
  unwritten columns. Every write is a PR — here the audit trail *is* the artifact.
- **Working** — this card, the MEMORY index, charter §Mandate, and the directive's
  founder-only list. The 564-line migration is a `path:line` retrieval target.

**Consolidation** — monthly: diff guard presence and allowlist length against last
month's facts; any movement becomes a fact naming the mechanism, **failures first**;
expire facts unverified 90 days; propose skill candidates. One PR, and "no delta" is the
correct outcome here more often than anywhere else in the sub-layer.

## 5. Async contract

Interaction is loops ([[guest-identity-consent-loops]]: `guest-merge-gate`,
`guest-pii-guard-integrity`, `guest-subject-coverage`, `consent-provability`), NF-A
events, and vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `guest.link_refused` has no publisher | The refusal log is the team's primary output artifact and nothing produces it, because `guest_link_identifier()` has **zero callers**. `nf_b.refusal_count` is therefore unmeasurable, not zero |
| The CI gate passes over an empty domain | `guest_copresence_negatives` (`:519-540`) ships empty by design, so a green `guest-merge-gate` is evidence the guard runs, not evidence it discriminates. Stated so a green badge is never quoted as a merge-quality result |
| Coverage has no publisher either | `nf_b.subject_coverage` is structurally zero and stays so while NF-B is held; the weekly read reports the reason, not the number alone |
| Consent review is a doc exchange | The quarterly `consent-version-audit` runs **with** [[compliance-privacy-charter]], not reviewed by them after — but nothing notifies them; their schedule must carry the same row |

## 6. Evidence today

- **EXISTS — everything the warden would watch.** The 564-line slice (commit `ce65715`),
  both guard scripts, `scripts/eval_guest_merge_policies.py`, and — verified 2026-08-27 —
  the CI job running all three on every commit,
  `.github/workflows/schema-parity.yml:185-212`. This **closes gap 2** of
  [[guest-identity-consent-charter]] §Evidence, which recorded the gate as unwired.
- **NEW — the warden and all three skills.** The reviews they encode were done by hand
  in the 2026-08-24 charter session, which is the past instance that justifies them.
- **NEW — the refusal log.** Charter gaps 1 and 3 stand: zero application callers (only
  `apps/api-gateway/src/settings/feature-flag-registry.ts:145-147` names the domain, and
  it says so itself), and nothing bumps `consent_notice_version`.
