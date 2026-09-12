---
type: agent-stack
division: intelligence
department: security
status: designed
updated: 2026-08-27
metrics: [sec.unguarded_authenticated_surface, sec.unverified_public_ingress, nf_a.unauthenticated_inference_spend, sec.recurrence_guard_present, sec.fail_open_defaults, sec.checklist_12c_items_with_a_reading]
links: ["[[security-charter]]", "[[security-schedule]]", "[[security-loops]]", "[[security-agenda-board]]", "[[security-premortem]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[access-control-tenant-isolation-agent-stack]]", "[[perimeter-ingress-integrity-agent-stack]]", "[[ai-surface-security-agent-stack]]", "[[action-safety-the-human-gate-charter]]", "[[red-team-charter]]", "[[platform-api-charter]]"]
---

# Security — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The department-level card watches the three team boards, the six metrics, and the
> §12C checklist — it does **not** classify routes, verify a signature, or fire a
> corpus. Those are the teams' verdicts.

**The rule that shapes every card in this department and its teams:** agents here are
**read and propose only** — they find and classify; [[platform-api-charter]] authors the
control. A security agent that mutates what it audits defeats its own audit, which is
[[ORG_STRUCTURE]] §3's argument applied one level down. The mutation gate itself is
**not ours**: it is [[action-safety-the-human-gate-charter]]'s, referenced, never re-owned.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `sec-orchestrator` | Keep the six numbers un-summed and current, keep every one of the §12C checklist's fifteen items carrying a reading or the word `unmeasured`, and escalate any team loop that breaches its close_time | NEW |

One row deliberately. The three questions — *reject it? / prove where it came from? /
was the content hostile?* — already have three charter owners; a department agent
answering any of them would duplicate the team that exists to answer it.

## 2. Agent cards

```yaml
agent: sec-orchestrator
unit: security
triggers:
  - schedule: "weekly — the §12C pass + new controller/route audit"   # foundation README:266; mirrored in [[security-schedule]]
  - schedule: "monthly — secret-surface review, sunsets after 2 runs"  # [[security-schedule]] anti-sprawl note
  - topic: security.finding_filed                                     # publisher: NONE (gap — findings land as vault PRs; no event exists)
consumes:
  - the three team agenda-boards (Dataview output)          # publishers: the three team [[…-agenda-board]] docs
  - "the §12C checklist in [[security-agenda-full]]"        # publisher: this department's own agenda
  - CodeQL + Trivy SARIF                                     # publishers: .github/workflows/codeql.yml, ci.yml:244-254 (both wired)
  - the Dependabot queue                                     # publisher: .github/dependabot.yml — exists; nobody reads it ([[security-schedule]])
emits:
  - "[[security-agenda-board]] refresh — the six metrics as a SET, never summed"   # consumer: founder board review
  - "sec.checklist_12c_items_with_a_reading"                                       # consumer: [[security-agenda-board]]
  - "quarterly classification handoff — our verdicts, and which is most likely wrong"  # consumer: [[red-team-charter]]
  - nf_a events (task_type: security_checklist_pass)                               # consumer: NF-A tables (ADR 0006/0008)
routing_class: extraction        # reading boards, re-reading fifteen items, and counting is not judgment
quality_bar: "every one of the six metrics carries a value or the word 'unmeasured', and no run ever emits a single security score — a department that reports one number has hidden which control failed ([[security-charter]] §Metrics)"
autonomy:
  read: autonomous
  propose: autonomous            # checklist readings and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; and this agent must not touch a guard, a secret, or a prompt at all
memory: security
escalates_to: "[[decision-office-charter]]"   # OD-19 / OD-20 / INTEL-F4 are founder calls, not sibling disputes
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `security-checklist-12c` | T2 | Weekly, and before any board refresh | All fifteen items re-read; each carries a reading or is named `unmeasured`; a metric whose value moved since last run must name what re-measured it | The unguarded-endpoint denominator has been stated four ways — 86 ([[README]]/OD-19 as written) → 103 (`intelligence.md:211-216`, summing module headers) → 94 (row-by-row) → 40 (`OPEN-DECISIONS.md:33`, 2026-08-26). Nobody was reconciling; each number was published as fact | NEW |

Consumed, owned elsewhere: `endpoint-guard-census` and `route-classification-pass`
([[access-control-tenant-isolation-agent-stack]]); `webhook-signature-audit` and
`fail-open-audit` ([[perimeter-ingress-integrity-agent-stack]]); `injection-corpus-run`
and `prompt-content-audit` ([[ai-surface-security-agent-stack]]); registry governance
([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skill, plus the six team skills it consumes; candidates from
  consolidation go to [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: security_checklist_pass`, plus read access to the
  three team task families (`guard_census`, `ingress_audit`, `ai_surface_probe`). Needs
  `context.team` and `context.metric` as jsonb keys so "which reading moved, and when"
  is one filter rather than a join this department invents.
- **Semantic** — `memory/` beside this file, `security-MEMORY.md` as index. Its first two
  facts are already known: the four-denominator drift above, and the department's thesis —
  *the codebase's habit is to warn and continue* (four fail-open defaults,
  `tenant.guard.ts:38-46` plus three JWT-secret fallbacks). Provenance frontmatter per
  ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. `ENDPOINTS.md`,
  the team charters and controller source are retrieval targets by `path:line`, never
  preloaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[security-schedule]]: read the NF-A slice and
the three boards since the last run; **failures first** — a metric that moved without a
named re-measurement becomes a fact naming the mechanism, not the number; a checklist item
`unmeasured` for three consecutive passes becomes a fact about why it cannot be read;
expire facts unverified for 90 days; propose skill candidates. One PR; "no delta" stated,
never silent.

## 5. Async contract

Cross-unit interaction is loops ([[security-loops]]), NF-A events, vault PRs, and skill
candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `security.finding_filed` has no publisher | Findings are vault PRs and board rows; nothing emits an event. The weekly pass bounds the blind spot at 7 days |
| The Red Team handoff is a doc edit | Quarterly, into `questions.md`; nothing notifies [[red-team-charter]], so their schedule must poll ours |
| `nf_a.unauthenticated_inference_spend` has no publisher at all | 0 of 7 model callsites emit cost events ([[ai-surface-security-charter]] §Metrics); OD-11 gates the column contract. One of this department's six numbers is unpublishable by another unit's dependency |
| Escalation to [[platform-api-charter]] for remediation is a proposal, not a handoff | We classify and specify; they author. Nothing tracks the gap between a filed verdict and a merged fix |

## 6. Evidence today

- **NEW — `sec-orchestrator` and `security-checklist-12c`.** No security unit has ever
  run ([[security-charter]] §Evidence); the checklist has never been read end-to-end;
  8 of 15 items have a reading.
- **EXISTS — the generic tooling the card consumes.** CodeQL `security-extended`
  (`.github/workflows/codeql.yml`, per-PR + weekly cron), Trivy (`ci.yml:244-254`),
  `.github/dependabot.yml`, `scripts/audit-api-credentials.js`.
- **EXISTS — the grep-shaped CI guard mechanism** the teams would point at their own
  defect class: `scripts/check_no_direct_stock_writes.sh`, `check_no_guest_name_matching.sh`,
  `check_schema_parity.sh` and four more, wired into `ci.yml`. Proven here, never pointed
  at guards.
- **PARTIAL — the numbers themselves, and they have drifted since the charter.** The
  charter's 94 baseline was recounted to 40 in OD-19 (`OPEN-DECISIONS.md:33`,
  2026-08-26), and `foundation/README.md` §2.3 records five holes closed in PRs #31/#32
  (analytics spend, the `simpos` confused deputy, the `pos-hub` approval gate, Toast's
  unset-secret path, a JWT secret fallback). **Reconciling that against the boards is
  this agent's first run, not a resolution to write here** — OD-19 and OD-20 stay open.
- **NEW — everything in §4.** No memory directory, no consolidation job, no NF-A
  emission from any security task family.
