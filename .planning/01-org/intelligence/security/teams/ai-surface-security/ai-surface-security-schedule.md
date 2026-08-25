---
type: schedule
division: intelligence
department: security
team: ai-surface-security
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[ai-surface-security-charter]]", "[[ai-surface-security-loops]]", "[[ai-surface-security-agenda-board]]", "[[security-schedule]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[skills-charter]]", "[[red-team-charter]]", "[[compliance-privacy-charter|compliance-charter]]"]
---

# AI Surface Security — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Injection suite — run the corpus against any changed prompt or any callsite touching untrusted input. **Does not exist; ships red** | `sec.corpus_detection_rate` |
| **Per PR** | New-callsite check — any new `api.anthropic.com` / model `fetch` is flagged for corpus coverage and cost instrumentation before merge | `sec.model_callsites_emitting_cost` |
| Monthly | L-AIS-1 corpus review — new cases, detection rate, family and callsite coverage | `sec.injection_corpus_size` |
| Monthly | L-AIS-2 spend + autonomy report — budgets in force, autonomous send rate, effective AI tier | `sec.tenants_with_inference_budget` |
| Monthly | L-AIS-3 RM-3 escalation — the dependency reported as an **integer** | `sec.days_dependency_open` |
| Quarterly | L-AIS-4 prompt/log content audit — two callsites per quarter, deepest first | `sec.pii_fields_in_prompts` |
| Quarterly | Red Team corpus review — *"what attack is not in here?"* | Findings into `questions.md` |
| Quarterly | Charter staleness sweep (foundation §3.3, §6) | Archive or revision |

**Anti-sprawl, applied honestly.** The monthly cadence on three loops is a deliberate
choice against a weekly one: model behaviour does not change week to week, and a weekly
corpus review produces motion instead of signal — which is precisely how a job hits
foundation §6's 3-runs-no-action deletion rule and takes a real function down with it. If
L-AIS-1 produces no new case and no rate change for three consecutive months, the honest
response is not to keep meeting; it is to conclude the corpus is complete for the current
surface and downgrade the loop to quarterly.

**The per-PR new-callsite check is the entry that matters most long-term.** There are seven
model callsites today and none emits a cost event. The eighth arrives by default unless
something reads every PR — the same structural argument
[[access-control-tenant-isolation-charter]] makes about the ninety-fifth unguarded route.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.
Registry governance is [[skills-charter]]'s (Applied AI); we author.

Two skills, each citing the real past instance foundation §3.3 requires. Both **proposed,
not built** — the repo has exactly one project skill today.

### `injection-corpus-run`

- **Trigger.** Per PR touching a prompt string, a model callsite, or any parser of untrusted
  input; and monthly across the whole corpus.
- **Doneability.** Emits **two** numbers — corpus size and detection rate — plus per-family
  and per-callsite coverage. **Emitting a detection rate without the size is a failed run.**
  A run in which every case passes is reported as *suspicious*, not green: it usually means
  the corpus was tuned to the model.
- **Real past instance.** `injection_suspected` has shipped, is quarantined correctly
  (`inbound-responder.service.ts:432-456`), is never lifted by sender trust (`:95-96`), and
  has been tested **only for plumbing** — `inbound-responder.service.spec.ts:248-263`
  asserts that a mocked flag propagates. In the entire history of the feature, no hostile
  text has been put in front of the real prompt. This skill is that missing act.
- **Owner.** This team. **Scheduled:** yes, per-PR + monthly.

### `prompt-content-audit`

- **Trigger.** Quarterly, two callsites per run; and per PR that changes what is included in
  a prompt payload or an evidence pack.
- **Doneability.** For one callsite: what enters the prompt, what is logged, which fields are
  personal or guest data, and whether any secret can reach the payload. **A callsite whose
  prompt is assembled dynamically and cannot be enumerated is a FAILED audit**, not a skipped
  one — unenumerable is the finding.
- **Real past instance.** `consultants.service.ts` builds an evidence pack from analytics
  and ships it to `claude-opus-4-8` (`:154-176`); the analytics surface increasingly
  includes check-level and table-level data. Meanwhile the repo prices a false guest merge
  as *"a DISCLOSURE — one person's dining history, spend"*
  (`eval_guest_merge_policies.py:28-30`) and takes real care at the storage layer — peppered
  channel hashes, an erasure column
  (`20260819000000_guest_identity_minimal_slice.sql`). **The care stops at the prompt
  boundary**, and nobody has checked what crosses it.
- **Owner.** This team. **Scheduled:** yes, quarterly + per-PR.

### Deliberately not proposed

- **`prompt-injection-classifier`** — a model that detects injection. That is the control we
  are trying to *test*, not a skill we should own building; owning both is grading our own
  homework, the argument [[ORG_STRUCTURE]] §3 uses to put Red Team outside the line. If a
  classifier is built, [[evaluation-doneability-charter]] should grade it against our corpus.
- **`llm-cost-tracker`** — that is [[neural-footprint-instrumentation-charter]]'s
  instrumentation. Building a shadow version here would produce the exact outcome RM-3's own
  premortem warns about: *"five private footprints and no appetite to migrate"*
  (`intelligence.md:178-181`). We escalate the dependency and ship a crude ceiling instead.
- **`ai-red-team-agent`** — an agent that autonomously attacks our own surfaces. Attractive,
  and premature while `sec.injection_corpus_size` is 0. A generator with no curated corpus to
  measure itself against produces volume, not coverage.
