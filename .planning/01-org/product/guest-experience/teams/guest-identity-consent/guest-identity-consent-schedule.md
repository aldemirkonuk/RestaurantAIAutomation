---
type: schedule
division: product
department: guest-experience
team: guest-identity-consent
status: provisional
metrics: [nf_b.false_merge_count, nf_b.subject_coverage, nf_b.refusal_count]
updated: 2026-08-24
links: ["[[guest-identity-consent-charter]]", "[[guest-identity-consent-loops]]", "[[guest-identity-consent-directive]]", "[[guest-experience-schedule]]", "[[skills-charter]]", "[[compliance-privacy-charter]]", "[[partnerships-integrations-charter]]", "[[security-charter]]"]
---

# Guest Identity & Consent — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per-commit | `guest-merge-gate` — `scripts/eval_guest_merge_policies.py` against `guest_copresence_negatives`; fails CI on **one** false merge | `nf_b.false_merge_count` · CI status |
| Per-commit | `guest-pii-guard-integrity` — all four guards asserted **structurally present**, not merely passing: both `check_no_*` scripts green with **empty allowlists**, `revoke all` at `:485` still in schema, `guest_pepper()` still raising at `:353-359` | `pii_guards_present` · `guard_allowlist_entries` |
| Weekly | `coverage-and-refusals` — `nf_b.subject_coverage` by restaurant and capture channel, printed **beside** `nf_b.refusal_count` and its reason distribution. Never separately | `nf_b.subject_coverage` · `nf_b.refusal_count` · `nf_b.consented_link_rate` |
| Weekly | `unverified-share-watch` — `nf_b.unverified_identifier_share`; alerts on a **fall** with no change that explains it | `nf_b.unverified_identifier_share` |
| Monthly | `merge-vocabulary-sweep` — scan PRs, issues, and design docs for *confidence · threshold · fuzzy · just for the pilot* near guest matching, and for merge-queue proposals under any name | Escalation, or silence |
| Quarterly | `consent-version-audit` — every live `consent_notice_version` still has retrievable notice text; no guest under a version we cannot produce. Run **with** [[compliance-privacy-charter]], not reviewed by them after | `consent_versions_with_retrievable_text` |
| Quarterly | `erasure-drill` — exercise the tombstone path end to end on a test guest: identifiers hard-deleted, label and consent nulled, `erasure_receipt_id` written, historical links still resolvable | `erasure_receipts_written` |
| Per-connector | `connector-pii-declaration` — every new inbound integration declares what personal fields it persists and where. Agenda item on [[partnerships-integrations-charter]]'s connector review | — |

**Anti-sprawl, with two named exemptions.** A scheduled job producing no action for 3
consecutive runs is downgraded or deleted ([[README]] §6). `guest-merge-gate` and
`guest-pii-guard-integrity` are **supposed** to produce no action forever — a guard
that fires arrived too late. They are exempt from that rule and from nothing else.
`merge-vocabulary-sweep` is **not** exempt: three quiet quarters is real evidence the
pressure has not materialised, and it should then be downgraded to annual rather than
run as theatre.

## Skills owned

Skills live in `.claude/skills/`. **The directory does not exist yet**
([[skills-charter]]), so these are proposals. Each names trigger, doneability, and a
real past instance per [[README]] §3.3 — no speculative skills.

### `guest-merge-review` (T2)

- **Trigger.** Any diff touching `guest_link_identifier()`,
  `guest_channel_canonicalise()`, `guest_pepper()`, `guest_canonicaliser_version()`,
  the `is_merge_eligible` generated column, either guard script, or the RLS policies
  on the three guest tables.
- **Doneability.** Produces a written finding naming (a) which of the four PII guards
  the diff moves, (b) whether the change is founder-only under
  [[guest-identity-consent-directive]], and (c) whether it introduces a similarity
  score by any name.
- **Real past instance.** The 564-line slice itself. Its load-bearing reasoning —
  no threshold (`:27-35`), tombstone not soft-delete (`:71-78`), card fingerprint
  quarantined despite verification (`:154-162`), incompleteness fails to a split
  (`:285-289`) — currently lives **only in SQL comments in a file nobody re-reads**.
  This skill exists to keep re-applying an argument that is already written down and
  already invisible. [[guest-identity-consent-premortem]] F5.

### `consent-copy-diff` (T2)

- **Trigger.** Any change to consent text, `consent_purpose` values,
  `consent_captured_via` options, or the CHECK constraint at `:61-62`.
- **Doneability.** `consent_notice_version` is bumped **and** the prior text is
  archived as a retrievable artifact keyed by the old version.
- **Real past instance.** `consent_notice_version` exists at `:59` with no process
  that increments it and no archive anywhere. A version column nobody increments is a
  boolean with extra steps — [[guest-identity-consent-premortem]] F4.

### `erasure-receipt` (T2)

- **Trigger.** A guest erasure request (`NEW-662`, `NEW-884`).
- **Doneability.** Executes the tombstone path and writes `erasure_receipt_id`
  (`:82`) with an enumeration of what was deleted; verifies historical
  `guest_check_links` still resolve and the guest row survives as a tombstone holding
  nothing about the person (`:112-117`).
- **Real past instance.** `erasure_receipt_id` is a column nothing writes. The
  erasure design is complete and its **proof** is not.

**Not proposed:** anything that resolves, scores, or suggests guest matches. Not
capacity — [[guest-identity-consent-directive]] makes candidate generation
founder-only, and a skill that produces candidates is a merge queue with a different
filename.

## Review

All three skills are reviewed against the 30-day staleness rule from the day
`.claude/skills/` exists. `guest-merge-review` and `erasure-receipt` are expected to
fire **rarely**. Rare is not stale: the review asks whether the **trigger occurred and
the skill failed to fire**, not whether the skill fired.
