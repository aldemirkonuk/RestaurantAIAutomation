---
type: schedule
division: product
department: partnerships-integrations
team: pos-bridge
status: exists
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-loops]]"
  - "[[pos-bridge-directive]]"
  - "[[partnerships-integrations-schedule]]"
  - "[[connector-platform-trust-schedule]]"
---

# POS Bridge — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Two-provider check on any `pos-types.ts` diff; `generic_webhook` contract must still validate | L2 |
| **Per PR** | Ingress guard on the 10 `pos-hub` routes — a new route without a guard or a verification call fails CI | L4 |
| **Weekly** | Real-throughput read: `pos_checks` rows **excluding `external_check_id LIKE 'P3PROOF-%'` and rows on the synthetic fixture tenant `550e8400-e29b-41d4-a716-446655440000`** (`POS-BRIDGE-AUDIT.md:622-628`, `REGISTER-AUDIT-2026-08-26.md:287`). *Predicate re-cut 2026-08-28 (audit of ADR 0035 item 6): "SimPOS-sourced generic_webhook" was not computable — all 66 proof rows share `source = 'generic_webhook'`, and `generic_webhook` is a real available ingress, so excluding by provider would permanently exclude the only path a real venue can use today. Exclude by check-id prefix and fixture tenant, never by provider.* | L5 |
| **Weekly** | Catalogue-match gate review — approval rate against dwell time, looking for rubber-stamping | L3, `nf_a.*` |
| **Monthly** | Registry audit — do the 27 statuses match what builds and connects? Demote anything unsupported | L1 |
| **Monthly** | Adapter-gate decision — is `pi.merchant_backed_providers` still 0? If yes, the gate stays shut | L1 |
| **Quarterly** | SimPOS boundary review — has any feature landed whose only justification is real-service use? | premortem M5 |

**Anti-sprawl:** a job producing no action for 3 consecutive runs is downgraded or deleted.
The weekly gate review (L3) is **exempt until the first real merchant connects**, because it
is measuring a surface that has not run yet — but it is scheduled now deliberately, so the
instrumentation exists before the data does. If it is still reporting "no data" 3 runs after
the first merchant, it is broken and gets fixed, not deleted.

## Skills owned

Skills live in `.claude/skills/`. **None exist yet** — the repo has one project skill total
(`.agents/skills/railway-config/SKILL.md`, foundation §3.1). Per foundation §3.3, each below
names a trigger, doneability criteria, and a real past instance.

| Skill | Trigger | Done when | Real past instance | Tier |
|---|---|---|---|---|
| `pos-registry-audit` | Monthly, or any provider status change | Every provider's status reconciled against what builds and connects; unsupported `scaffolded` demoted; count reported | This session: found **27** providers where `foundation/teams/product.md:658` claims 30 | T2 |
| `canonical-shape-review` | Any diff touching `pos-types.ts` | Two-provider rule applied; `generic_webhook` contract re-validated; single-provider fields moved to capabilities or rejected | Not yet fired. Justified by premortem M2, i.e. a *predicted* instance — the weakest basis on this list, and the first deletion candidate under the 30-day rule | T2 |
| `pos-adapter-scaffold` | A named venue is waiting on a provider that has no normalizer | Normalizer + spec exist, capabilities assigned, registry entry moved to `scaffolded`, `generic_webhook` contract unbroken | Square (`:71`) and Clover (`:83`) were both scaffolded this way; the procedure exists in the code but not as a written skill | T1 |
| `match-gate-review` | Weekly once real proposals exist | Approval rate reported against dwell time; low-confidence proposals confirmed to be presented separately; a rubber-stamp signature is flagged | Not yet fired — the gate has never run on real data. Chartered against premortem M4 and against the *existing* `catalog-matcher.service.spec.ts`, which tests correctness but not human behaviour | T2 |

**Honest note.** Two of these four have no real past instance. `pos-adapter-scaffold` is
strongly grounded — the procedure has been executed twice in code. `canonical-shape-review`
and `match-gate-review` are premortem-driven. That is a weaker basis than foundation §3.3
wants, it is stated rather than hidden, and both should be deleted rather than defended if
they have not fired within 30 days of the surfaces they cover going live.

## Deliberately not scheduled

- **Adapter work for providers 3–27.** Blocked by the gate while
  `pi.merchant_backed_providers == 0`. Scheduling it would defeat the gate.
- **Outreach of any kind.** [[partner-alliance-development-charter]]'s.
- **SimPOS feature development toward real service.** Non-goal, by charter.
