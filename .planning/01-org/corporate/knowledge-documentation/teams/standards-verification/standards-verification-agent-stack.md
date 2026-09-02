---
type: agent-stack
division: corporate
department: knowledge-documentation
team: standards-verification
status: designed
updated: 2026-08-27
metrics: [standards.stale_claim_rate, standards.unpinned_claim_count, standards.stale_brand_doc_count, standards.docs_past_60_day_rule, standards.contract_self_compliance_pct]
links: ["[[standards-verification-charter]]", "[[standards-verification-schedule]]", "[[standards-verification-loops]]", "[[standards-verification-directive]]", "[[0034-agent-stack-artifact]]", "[[0025-citations-must-disagree-loudly]]", "[[0020-no-fabricated-answers]]", "[[decision-office-charter]]", "[[knowledge-documentation-agent-stack]]"]
---

# Standards & Verification — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This is the one card in the department whose method is already running in CI. ADR 0025's
> pairing guard and the executable-claims guard are not analogies for this team's work —
> they *are* it, at register scope, wired into `.github/workflows/ci.yml:159-179`. The
> agent's job is to carry that method from the decision register out to the rest of the
> corpus, and its premortem is what happens if it ships prose instead.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `claim-auditor` | Sample spine-document claims, return `verified` / `stale` / `unpinnable` with a `path:line` for each, and turn every repeated number into an assertion that fails loudly when it changes | PARTIAL — the method exists and runs at register scope (`scripts/check_citation_pairing.py`, `scripts/check_decision_claims.sh`); nothing applies it to prose |

## 2. Agent cards

```yaml
agent: claim-auditor
unit: standards-verification
triggers:
  - schedule: "weekly — claim sample + correction ageing (L-SV-1)"    # mirrored in [[standards-verification-schedule]]
  - schedule: "monthly — 60-day sweep, companion regen, brand scan (L-SV-2, L-SV-3)"
  - schedule: "quarterly — contract self-compliance"
  - topic: ci.decision_claims_failed                                   # publisher: the `decision-claims` job (.github/workflows/ci.yml:159-179) — it EXISTS but fails a PR rather than emitting; see the gap row in §5
consumes:
  - "`.planning/decisions/CLAIMS.jsonl` — 112 executable claims, the only re-checkable prose in the corpus today"
  - "the guard outputs: `scripts/check_decision_claims.sh`, `scripts/check_citation_pairing.py`, `scripts/check_od_ids_exist.py`"
  - "spine documents and `07-reference/` (including tombstone stubs, which carry line-anchored citations forward)"
  - "generator output for `ENDPOINTS.md`, `PAGE_MAP.md`, `EXTERNAL_CONNECTIONS.md`"
emits:
  - "the five `standards.*` values to [[standards-verification-agenda-board]] and the department rollup ([[knowledge-documentation-agent-stack|kd-ledger]])"
  - "new rows appended to `CLAIMS.jsonl` when a prose claim is made executable"
  - "correction handoffs to the owning unit, aged weekly (L-SV-1 → L-KD-4)"
routing_class: judgment      # the mechanical half — brand grep, doc age, guard runs — is already CI's and must not be re-implemented here; what is left is deciding whether a claim is stale or unpinnable against its source
quality_bar: "every sampled claim carries `verified`/`stale`/`unpinnable` **and** a `path:line`; the agent refuses to emit a rate if any sample could not be resolved ([[standards-verification-schedule]] §Skills) — an unresolvable sample silently dropped is a fabricated denominator (ADR 0020). Every count ships with its scope attached"
autonomy:
  read: autonomous
  propose: autonomous        # corrections, pinning assertions, and board rows land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: standards-verification
escalates_to: "[[decision-office-charter]]"   # corrections unacknowledged past 30 days; the 573 figure in the YC narrative routes to [[positioning-fundraise-readiness-charter]]
```

**The card's own hard rules.** `claim-auditor` never patches another unit's source to make a
document true, never hand-edits the three generated companion documents, and never decides
*what the true value is* — it proves two documents disagree and that the source is
unassertable, which is a smaller and provable claim
([[standards-verification-charter]] §Non-goals). **The fork it must not close is CORP-F6**:
whether a team inside this department can credibly grade its own department's artifacts, or
belongs under [[decision-office-charter]] (`corporate.md:512-515`). This agent audits its
own unit's nine artifacts today — stated, not solved.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `register-claims-reverify` | T2 | Every PR | Every executable claim in `CLAIMS.jsonl` re-runs; a claim that no longer describes reality fails the build | 2026-08-25: five `OPEN-DECISIONS` entries were acted on and **all five** were wrong in ways that changed the priority — OD-63's table did not exist in production, OD-56's queue and CVEs had zero package overlap (`scripts/check_decision_claims.sh:7-16`) | **EXISTS** as `scripts/check_decision_claims.sh`, CI at `ci.yml:167` — not yet a skill |
| `register-citation-pairing` | T2 | Every PR | Every citation carries an id **and** a line and they agree; `--fix` refuses on a tree with conflict markers; `--self-test` proves both invariants | ADR 0025's measurement: of the register citations naming both an id and a line, **zero agreed** (`ci.yml:156-158`); three defects each failed differently — a renumbered id that still resolved, prose that lied while every `file:line` held, an anchor that was never correct (`0025-citations-must-disagree-loudly.md:29-35`) | **EXISTS** as `scripts/check_citation_pairing.py`, CI at `ci.yml:170`/`:173` — not yet a skill |
| `claim-verify` | T2 | Weekly sample; on demand against one document | Each sampled claim gets a verdict with a `path:line`; refuses to emit a rate if any sample is unresolvable | `md/DOCUMENTATION_INDEX.md` was wrong in every category count from 2026-01-29 onward — it claimed `04-updates-builds` held 6 files against an actual 48 — and nothing surfaced it before the tree was retired under ADR 0032 | NEW |
| `claim-pin` | T2 | A number appears in ≥ 2 spine docs | Produces the assertion that makes the source fail loudly when the value changes, and names the owning unit | The insight count is quoted as **375**, **573**, and **348** — the last one line after the first, in the same file. The only assertion over it is `expect(INSIGHT_CANDIDATES.length).toBeGreaterThanOrEqual(200)` (`apps/api-gateway/src/analytics/insights/insight-catalog.spec.ts:10`), which **all three pass** | NEW |
| `staleness-sweep` | T2 | Monthly, org-wide, no exclusions | Lists every `agenda-*` past 60 days, this department's own included | The 60-day rule has existed since 2026-08-24 with no mechanism; it first fires **2026-10-23** against 21 provisional agendas in this department alone | NEW |
| `companion-regen` | T2 | Monthly, and per PR touching the three generated docs | Re-runs each generator and diffs; a hand edit is distinguishable from a world change | [[README\|foundation-README]] §0 declares them regenerated-not-hand-edited; nothing enforces it | NEW |
| `brand-drift-scan` | T2 | Monthly | Reports per scope with denominators; refuses to emit a bare count | The same fact was 28, 216, or 75 depending on scope — and the `.planning/` figure has since moved to **185** `.md` (measured 2026-08-27) without anyone noticing, which is the argument for the denominator in one line | NEW |

Consumed, owned elsewhere: placement and retirement ([[corpus-archive-schedule]]), link
resolution ([[graph-retrieval-schedule]]), registry governance ([[skills-charter]]).
`scripts/check_od_ids_exist.py` (`ci.yml:176`) is consumed as an input, not owned here.

## 4. Memory

- **Procedural** — the §3 skills. Two of them already exist as CI scripts, which sets the
  target shape for the other five: a procedure is finished when it is a guard, not a habit.
  Candidates via [[skill-harvesting-charter]]'s queue, through the §3.3 gate at
  `.claude/skills/README.md:12-18`.
- **Episodic** — **no NF-A path today**, and saying otherwise would be this team's own
  founding defect. A `claim_sample` task type would immediately face
  `scripts/check_task_types_are_graded.py` (`ci.yml:179`), which requires a basis better
  than `call_level_v0` or a named exemption — and `verified`/`stale`/`unpinnable` is
  exactly the human-rubric case that guard's EXEMPT list exists for. Until then the
  episodic layer is `CLAIMS.jsonl`'s 112 rows plus the CI history of the two running guards.
- **Semantic** — `memory/` beside this file, `standards-verification-MEMORY.md` as index.
  First facts: the unpinned insight count and *why* it is unpinned — built at import time
  from a cross-product, so any edit to three arrays changes it silently (charter §Evidence);
  the two standard-setting documents that violate their own frontmatter rule; the three
  defect shapes ADR 0025 measured. `source`, `confidence`, `last_verified` per ADR 0034;
  every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the sampling scope in
  [[standards-verification-directive]]. Source files are `path:line` retrieval targets;
  loading a document to judge it is how a verifier becomes a style guide.

**Consolidation** — monthly: read the month's verdicts, **failures first** — every `stale`
becomes a fact naming the mechanism (*"count built at import time, no assertion over it"*),
never the symptom (*"the number was wrong"*), because the mechanism is what generalises and
the symptom is what gets patched and recurs; every `unpinnable` becomes a candidate for
`claim-pin`; expire facts unverified for 90 days. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops ([[standards-verification-loops]]), vault PRs, and
correction handoffs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `ci.decision_claims_failed` has a publisher but no transport | The `decision-claims` job exists and fails loudly (`ci.yml:159-179`) — but it fails *a pull request*. Nothing an agent subscribes to is emitted, so a red guard reaches this team only when a human looks at a check |
| Corrections raised against other units have named consumers and no acknowledgement | L-SV-1 lists nine `outputs_to` units; delivery is a vault PR. The weekly ageing job plus the 30-day escalation to [[decision-office-charter]] is the entire mechanism, and it is unbuilt |
| The 573 figure crosses a division boundary | It sits in the YC narrative, so the correction routes through [[positioning-fundraise-readiness-charter]] and is not this team's to apply — an emit whose consumer can decline it, recorded rather than assumed |

## 6. Evidence today

- **EXISTS — the method, at register scope.** `scripts/check_decision_claims.sh` over 112
  claims in `.planning/decisions/CLAIMS.jsonl`; `scripts/check_citation_pairing.py` with a
  `--self-test` that proves `--fix` still refuses what it must; `scripts/check_od_ids_exist.py`.
  All three are wired into the `decision-claims` job at `.github/workflows/ci.yml:159-179`.
  This is the strongest EXISTS line in the department and it is the reason this card is not
  speculative.
- **PARTIAL — everything outside the register.** No sampling of spine prose, so
  `standards.stale_claim_rate` remains **unmeasured**; the 60-day rule has no mechanism;
  the three generated companion documents have no regeneration guard.
- **Closed since the charter — recorded because this team must not repeat a stale claim.**
  OD-14 is **resolved**: root `SKILLS.md` was retired to a tombstone on 2026-08-24
  (OD-14, `OPEN-DECISIONS.md:132`, Resolved table; `SKILLS.md:1-3`), the path kept because
  `.github/copilot-instructions.md` referenced it. The charter's OD-14 line is superseded.
- **NEW — the agent and the five unbuilt skills.** `.claude/skills/` now exists
  (`.claude/skills/README.md`) and holds zero committed skills — CORP-F7 closed by creating
  the directory, which resolves the assertion in 99 schedules but fills none of them.
