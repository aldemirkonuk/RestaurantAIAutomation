---
type: schedule
division: corporate
department: compliance-privacy
team: regulatory-posture
status: new
metrics: [compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, compliance.unevidenced_clause_count]
updated: 2026-08-24
links: ["[[regulatory-posture-charter]]", "[[regulatory-posture-loops]]", "[[regulatory-posture-directive]]", "[[compliance-privacy-schedule]]", "[[privacy-engineering-schedule]]", "[[standards-verification-charter]]", "[[commercial-workforce-agreements-charter]]", "[[design-partner-operations-charter]]", "[[red-team-charter]]", "[[README]]"]
---

# Regulatory Posture — Schedule & Skills

## Recurring work

**Nothing below runs today.** Every row is `NEW`. Unlike
[[privacy-engineering-schedule]], this team inherits no machinery — no CI job, no
script, no artifact. It starts at zero in the most literal sense available.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| Per-PR touching a cited control | **Citation integrity check** — does this change falsify a register row? | stale-citation list | **NEW** · the register's citations are load-bearing in signed instruments |
| Per-PR touching the four asserted claims | **Notice claim assertions** — cookies, token storage, telemetry default, partner-sharing default | pass/fail | **NEW** · the claim already failed once (`Privacy.tsx:23,31,43`) |
| Per-instrument, **before execution** | **Sign-off** — line-by-line, three permitted verdicts | `compliance.unevidenced_clause_count` | **NEW** · a sign-off after signature is a record, not a control |
| Monthly | **Register sweep** — new duties, changed controls, stale citations | `compliance.obligation_coverage` | **NEW** |
| Monthly | **Notice read-through** — the claims a test cannot assert | `compliance.notice_accuracy` | **NEW** |
| Quarterly | **Subprocessor reclassification** — regenerate the host inventory, diff against the register | `compliance.subprocessor_classification` | **NEW** |
| Quarterly | **Gap referral to [[red-team-charter]]** — every accepted gap, attacked by someone who did not accept it | `compliance.gap_age_max` | **NEW** · the independence mechanism |
| Quarterly | **Horizon scan** — privacy law only; alcohol/excise belongs to [[regulated-operations-charter]] | scope delta | **NEW** · first candidate for deletion under the 3-run rule |
| On arrival | **Inbound instrument triage** — escalate on arrival, not on deadline | escalation | **NEW** · M1 |

**Anti-sprawl, applied against this team's own list.** [[README]] §6: a scheduled job
producing no action for 3 consecutive runs is downgraded or deleted. Nine rows for a
team with zero running jobs is over the line, and this team should say so about itself
before someone else does. The three that earn their slot first:

1. **The sign-off** — it is the only job here that can prevent an irreversible
   outcome. Everything else produces a document.
2. **Notice claim assertions** — cheap, and repairing a live false claim.
3. **The monthly register sweep** — produces the primary metric.

The **quarterly horizon scan** is the honest deletion candidate: with jurisdictions
undecided and no customers, it will produce no action for its first three runs by
construction. It is listed so that deleting it later is a planned outcome rather than
an admission.

**Build note on the two per-PR jobs.** Both are CI checks, and the repo's precedent
for privacy CI is `.github/workflows/schema-parity.yml` — push, PR, and a daily cron,
because *"drift is usually introduced outside a PR"* (`:23-25`), plus the habit of
failing loudly when a required input is missing rather than passing vacuously
(`:143-147`). Citation integrity has the same drift profile: the edit that falsifies
a register row is usually made by someone with no idea the row exists.

## Skills owned

Skills live in **`.claude/skills/`** — auto-discovered, committed, PR-reviewable. A
skill unfired for 30 days is reviewed for deletion ([[README]] §3.3).

**Count today: 0.** The directory does not exist.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty |

### Candidates, against [[README]] §3.3's four required fields

Unlike its sibling, this team's work is **judgement over prose**, which is genuinely
skill-shaped rather than guard-shaped — reading a clause and deciding whether a
citation supports it is not a grep. So the candidate list here is more plausible, and
that makes the §3.3 discipline more important, not less.

| Candidate | Trigger | Doneability | Real past instance | Eligible? |
|---|---|---|---|---|
| `dpa-annex-check` — walk an Annex clause by clause against the register | An instrument with a data clause arrives | Every clause carries one of three verdicts; unevidenced clauses are listed with proposed redlines | ❌ **No instrument has ever been received.** Zero DPAs exist in this repo. | ❌ |
| `obligation-map` — map a named duty to a control and grade the evidence | A new duty enters scope, or a control changes | Row with `file:line` or an owner+date; sentences rejected | ✅ **This session** — the ten-duty v0 table in [[regulatory-posture-charter]] §Evidence was produced by hand, including the caveats on the two unexercised controls | ✅ eligible |
| `notice-truth-check` — verify every claim on the privacy notice against code | A PR touches a claimed behaviour, or monthly | Each claim marked true / false / untestable with a citation | ✅ **This session** — the "WineOps" staleness at `Privacy.tsx:23,31,43` was found this way | ✅ eligible |
| `subprocessor-classify` — classify a host by worst-case payload | New outbound host, or quarterly | Row with a methodology note, never a vendor-category justification | ⚠️ partial — the Anthropic/Gemini raw-HTTP finding was made this session, but no host was formally classified | ⚠️ borderline — write it after the first real classification pass |
| `questionnaire-answer` — answer a security questionnaire from the register only | A questionnaire arrives | Every answer traced to a register row; unanswerable questions listed as gaps | ❌ no questionnaire has been received | ❌ |

**Two eligible, one borderline, two not.** `dpa-annex-check` is the most *valuable*
candidate and the least *eligible*, which is exactly the tension §3.3 rule 3 exists to
hold: the instinct is to write it now because it will obviously be needed, and that
instinct is how a registry fills with plausible skills that never fire. It gets
written the week the first DPA arrives, from that DPA.

Note also that `notice-truth-check` overlaps
[[standards-verification-charter]]'s general staleness machinery. Per
[[regulatory-posture-charter]] §non-goals this team owns the *claim*, not the
tooling — so the skill should call their machinery rather than reimplement it, or it
should not exist.

## What this team consumes from other schedules

| Their job | Owner | What we take |
|---|---|---|
| Monthly erasure drill | [[privacy-engineering-schedule]] | Whether the erasure citation may drop its caveat |
| Per-merge PII convergence guard | [[privacy-engineering-schedule]] | Whether "confidentiality" maps to one control or three |
| Doc staleness detection | [[standards-verification-charter]] | Machinery for the notice loop, consumed not rebuilt |
| Weekly security pass ([[README]] §6) | [[security-charter]] | New routes reaching personal data → new register rows |
| Deal pipeline | [[design-partner-operations-charter]] | Early sight of any agreement with a data clause — the only warning L4 gets |
