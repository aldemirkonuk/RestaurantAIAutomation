---
type: schedule
division: intelligence
department: security
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[security-charter]]", "[[security-loops]]", "[[security-agenda-board]]", "[[security-premortem]]", "[[access-control-tenant-isolation-schedule]]", "[[perimeter-ingress-integrity-schedule]]", "[[ai-surface-security-schedule]]", "[[skills-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]"]
---

# Security — Schedule & Skills

## Recurring work

`foundation README:266` already schedules a **weekly security pass (§12C checklist + new
controller/route audit)** for this department. That job is the spine of this table; the
rest hangs off it.

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Endpoint-guard assertion — `scripts/check_endpoint_guards.sh` + allowlist diff. **Does not exist yet; ships red with all 94 routes listed** | Pass/fail; `sec.unguarded_authenticated_surface` |
| **Per PR** | `@Public()` allowlist diff — first decorator outside the known set escalates | `sec.public_decorator_count` |
| Per PR | CodeQL `security-extended` — already wired (`.github/workflows/codeql.yml`) | SARIF to GitHub Security |
| Per PR | Trivy — already wired (`ci.yml:244-254`) | SARIF |
| **Weekly** | **The §12C pass** — all 15 items re-read, `unmeasured` items named as unmeasured | `sec.checklist_12c_items_with_a_reading` |
| **Weekly** | New-route audit — every controller added since last run, classified before merge if possible | Verdicts; allowlist diff |
| Weekly | L-SEC-1 exposure burn-down | Allowlist diff |
| Weekly | L-SEC-2 two-number report | [[security-agenda-board]] refresh |
| Monthly | L-SEC-4 injection corpus — new cases, detection rate | `sec.injection_corpus_size`, `sec.corpus_detection_rate` |
| Monthly | L-SEC-5 spend-attribution escalation to [[neural-footprint-instrumentation-charter]] | `sec.days_dependency_open` |
| Monthly | Secret-surface review — 80 env vars (`EXTERNAL_CONNECTIONS.md`), fail-open defaults, placeholder domains (`abc123.ngrok.io`, `your-domain.com`) | `sec.fail_open_defaults` |
| Weekly | Dependabot triage — the queue exists; nobody currently reads it | Merged bumps or a recorded deferral |
| Quarterly | L-SEC-3 controls-vs-findings | Allocation recommendation |
| Quarterly | Red Team handoff — hand our classification verdicts to [[red-team-charter]] and ask which is most likely wrong | Findings into `questions.md` |
| Quarterly | Charter staleness sweep — 60 days untouched is finished or fiction (foundation §3.3, §6) | Archive or revision |

**Anti-sprawl, applied to this table.** A scheduled job producing no action for **3
consecutive runs** is downgraded or deleted (foundation §6). Two entries above are already
at risk on that rule and are named rather than hidden: the weekly §12C pass will produce
nothing new by week three unless the `unmeasured` items are being converted to readings,
and the monthly secret-surface review is a one-time audit wearing a recurring costume —
**it should be deleted after its second run** unless the env-var count is actually moving.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.

**State of the ground, honestly:** the repo has exactly **one** project skill
(`.agents/skills/railway-config/SKILL.md`), so this department's skill surface is
greenfield. Root `SKILLS.md` is a prose reasoning protocol, not a skill (foundation §3.1).
The registry itself belongs to [[skills-charter]] (Applied AI) — we author skills, we do
not govern the registry.

Every candidate below is tied to a job in the table above, and each one names the real
past instance foundation §3.3 requires. **No speculative skills.**

| Proposed skill | Fires on | Past instance that justifies it | Owning team |
|---|---|---|---|
| `endpoint-guard-census` | Per-PR + weekly new-route audit | The `/analytics/consult` hole survived 39 routes' worth of review because nobody generated this list until `ENDPOINTS.md` was written | [[access-control-tenant-isolation-charter]] |
| `route-classification-pass` | Weekly, per unclassified route | `simpos` is labelled a webhook module and is not one; `vendor-portal` was labelled one and is not one | [[access-control-tenant-isolation-charter]] |
| `fail-open-audit` | Monthly secret-surface review | Three independent `\|\| "your-secret-key-change-in-production"` fallbacks, each shipped separately by someone who did not know about the other two | [[perimeter-ingress-integrity-charter]] |
| `webhook-signature-audit` | Weekly, on ingress modules | `toast` and `pos-hub` verify correctly; nobody has ever checked whether the other three do | [[perimeter-ingress-integrity-charter]] |
| `injection-corpus-run` | Monthly, and per change to any prompt taking untrusted input | `injection_suspected` has shipped, been tested for plumbing only, and never been fired at a real payload | [[ai-surface-security-charter]] |
| `security-checklist-12c` | Weekly | The checklist has fifteen items and has never been read end-to-end before this department; seven still have no reading | department |

**Nothing in this table exists yet.** It is listed so a skill is created against a
scheduled job with a close-time, rather than a skill being created and a job invented to
justify it — the direction of that arrow is the whole anti-sprawl rule.

**Two candidates deliberately not proposed.** An `incident-response` skill: there is no
SIEM, no on-call, and no incident history, and the response team was rejected at
`intelligence.md:505` with an entry trigger. And a `threat-model` skill: threat modelling
here would be findings about other units' decisions, which is
[[red-team-charter]]'s scope, and building a skill for it is how
[[security-premortem]] M5 starts.
