---
type: agent-stack
division: platform
department: engineering
team: catalogue-identity
status: designed
updated: 2026-08-27
metrics: [identity.false_merge_count, identity.false_split_count, nf_b.guest_signal_attribution_accuracy]
links: ["[[catalogue-identity-charter]]", "[[catalogue-identity-schedule]]", "[[catalogue-identity-loops]]", "[[catalogue-identity-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[action-safety-the-human-gate-charter]]"]
---

# Catalogue & Identity — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns the one Engineering mistake a revert does not undo, so it gets the vault's
> second most constrained card: its agent may assemble evidence for a merge and may publish
> two counts, and it may not merge, un-merge, or ever emit one combined identity score.
> Mechanism references are [[engineering-agent-stack]]'s and are not repeated here.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `identity-adjudicator` | Prepare the evidence packet for every merge, un-merge and disputed near-key pair, and publish false merges and false splits as two columns — ruling on none of them | NEW |

## 2. Agent cards

```yaml
agent: identity-adjudicator
unit: catalogue-identity
triggers:
  - schedule: "weekly — labelled-set coverage (L-CI-2) and producer collapse watch (L-CI-3)"   # mirrored in [[catalogue-identity-schedule]]
  - schedule: "monthly — near-key duplicate sweep"
  - topic: identity.merge_proposed        # publisher: NONE (gap — merges are SQL calls; nothing emits)
consumes:
  - "scripts/eval_merge_policies.py output (publisher: the CI gate at .github/workflows/ci.yml:526)"
  - "datasets/menu_corpus/extracted — the labelled corpus the gate scores against (eval_merge_policies.py:14-16)"
  - "supabase/migrations/20260818010000_beverage_duplicates_near_key.sql, …20260813150000_find_library_duplicates.sql (publisher: the monthly sweep)"
  - "supabase/migrations/20260817120000_nondestructive_merge.sql, …20260818020000_merge_undo_honesty.sql"
emits:
  - "two columns, never one number → [[catalogue-identity-agenda-board]] and L-ENG-1 (consumer: [[engineering-agent-stack|eng-board-keeper]])"
  - "evidence packets into the adjudication queue (consumer: a human ruler — [[catalogue-identity-directive]])"
  - "nf_a events (task_type: identity_adjudication) — consumer: NONE (gap, see §5)"
routing_class: judgment          # deciding whether two rows are the same thing in the world
quality_bar: "the merge-policy gate at .github/workflows/ci.yml:526 — the proposed policy's false-merge count alone is pass/fail (scripts/eval_merge_policies.py:10-13). A summed or averaged score is not a verdict, it is a rule violation."
autonomy:
  read: autonomous
  propose: autonomous            # packets and board rows land as PRs
  mutate_stock_money_outbound: confirm   # constant
memory: catalogue-identity
escalates_to: "[[engineering-charter]]"
```

**The card's own hard rule.** A merge is not in the stock/money/outbound family, and it is
still **confirm-gated here** — because it is the one Engineering mutation that a revert, a
redeploy and a retry all fail to undo ([[catalogue-identity-charter]] §Distinct from
siblings). `identity-adjudicator` prepares; a human rules. It may also never emit a combined
identity score: the non-summability rule at `scripts/eval_merge_policies.py:5-13` binds this
agent exactly as it binds a dashboard.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `merge-safety-review` | T2 | Any merge or un-merge, and any change to a match-key implementation | Two counts reported separately against `datasets/menu_corpus/extracted`; every key implementation that runs in production is named and checked against the one the gate validates | The 2026-08-18 premortem audit (decision #1) found `beverage_identity_key` (SQL, running in production) and `residual_key` (Python, what the gate actually validates) were two independent implementations of one algorithm kept in lockstep by a comment, while `ci.yml`'s merge-identity gate only ever tested the Python side — `.github/workflows/schema-parity.yml:142-150` | NEW |
| `identity-adjudication-queue` | T2 | A disputed near-key pair arrives from the monthly sweep | An evidence packet a human can rule on in one sitting; the skill records no ruling and proposes no threshold | `scripts/check_no_guest_name_matching.sh:5-13` is that adjudication, written up: the wine key measured 0 false merges over 732,874 pairs, the same instinct applied to a person's name was reasoned through by hand and ruled wrong ("`John Smith` is a collision class"), and the ruling became a guard | NEW |

`producer-collapse-audit` appears in [[catalogue-identity-schedule]] and is **deliberately not
a row here**: no collapse-ratio anomaly has been adjudicated yet, so there is no past instance
to cite and README §3.3 deletes the row rather than keeping it as an aspiration.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); corpus
enrichment ([[corpora-enrichment-charter|dat-corpora-enrichment]]) — this agent reads the
corpus, it never fills it in.

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: identity_adjudication`. Needs `context.pair_id` and
  `context.decision` (merge / split / defer) as jsonb keys, plus `context.policy_version`, so
  a policy change can be replayed against every past adjudication rather than argued about.
- **Semantic** — `memory/` beside this file, `catalogue-identity-MEMORY.md` as index. Its
  founding facts are already known: the two-implementations finding (source:
  `schema-parity.yml:142-150`, 2026-08-18), the 732,874-pair measurement (source:
  `check_no_guest_name_matching.sh:6-7`), and the non-summability rule and why it exists.
  Provenance frontmatter per ADR 0034; every write is a PR, which for this team is the point —
  a merge policy that changed without a diff is how a false merge becomes invisible.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The migrations and
  `.planning/07-reference/BEVERAGE_CATALOGUE_ARCHITECTURE.md` are retrieval targets by
  `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[catalogue-identity-schedule]]: read the
adjudication slice since the last run; distill durable facts, failures first — every false
merge or false split becomes a fact naming the mechanism that produced it (which key, which
threshold, which missing corpus class), never "accuracy slipped"; expire facts unverified for
90 days; propose skill candidates. One PR; "no delta" stated when true, and for this team a
month of no merges is a good month, not a quiet one.

## 5. Async contract

Cross-unit interaction is loops in [[catalogue-identity-loops]], NF-A events, vault PRs, and
skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `identity.merge_proposed` has no publisher | Merges are direct SQL function calls (`…20260813030000_merge_library_wines.sql`); nothing emits on one. The weekly and monthly schedules bound the blind spot, but an out-of-band merge is invisible until the next sweep |
| `identity_adjudication` NF-A events have no declared consumer | Beyond this team's own board row; recorded rather than assumed |
| `nf_b.guest_signal_attribution_accuracy` has no producer | It is on this team's charter as a metric and no artifact computes it. It is the metric a false merge corrupts, so its absence is the team's most consequential unread number |
| `scripts/check_display_name_parity.py` runs in no workflow | Listed as a per-PR CI job in [[catalogue-identity-schedule]]; a grep over `.github/` finds no invocation, while the other five guards are wired. A guard nobody runs reads exactly like a guard that passes |

## 6. Evidence today

- **PARTIAL, not NEW — the measurement.** [[catalogue-identity-charter]] §Evidence states the
  labelled identity set is absent and that `identity.false_merge_count` is therefore "a policy,
  not a reading". That is true of `technology.md`, and overtaken by the repo:
  `scripts/eval_merge_policies.py` runs as a CI gate (`.github/workflows/ci.yml:526`) and
  scores against `datasets/menu_corpus/extracted` (27 menus), with the corpus strengthening
  the gate automatically (`eval_merge_policies.py:14-16`). What is still missing is a
  **published two-column number on a board**, not the reading itself.
- **EXISTS — the machinery the agent would read.** Match-key, near-key duplicate, merge,
  non-destructive-merge and merge-undo migrations, `wine_matcher.py`,
  `producer_normalization.py`, `ontology_normalization.py`, and three of the four parity
  guards wired in CI — all cited in [[catalogue-identity-charter]] §Evidence.
- **NEW — `identity-adjudicator` and both skills.** Both procedures were performed by hand
  (2026-08-18 and in the guard's own write-up); neither runs.
