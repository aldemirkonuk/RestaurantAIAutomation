# 0038 — Agent cards become a machine index, and mechanical cards run as declared scripts

- **Status:** Locked — founder, in-session 2026-08-28 (AskUserQuestion): scope
  "substrate + all mechanical agents," home "in-repo, scripts/ + 00-index/."
- **Date:** 2026-08-28
- **Decider:** Aldemir (founder) — scope and home; Claude — the implementation shape, recorded here
- **Keywords:** agent-stack, cards.json, card-map, run_card, mechanical, memory, skills, ci-gate, od-03
- **Links:** [[0034-agent-stack-artifact]], [[0035-wave2-seam-reconciliation]], `scripts/build_agent_card_index.py`, `scripts/agents/run_card.py`, `00-index/CARD-MAP.md`

## Context

ADR 0034 shipped 100 units × declarative cards, docs-only. The founder then asked
for the build: agents connected to their declared points, a tight feedback loop,
and the graph of loops in the action — with the architecture right. The
constraint that shapes everything: **OD-03 (the harness choice) is open**, so
nothing built may make any harness option more expensive to abandon. The repo
already has the pattern that threads that needle: `build_loop_index.py` (a
generated index with a CI `--check` gate) and `watch_loops.py` (a running watcher
that reports and never edits).

## Options considered

1. **Card index + mechanical runners as scripts** *(chosen)* — the cards' twin of
   the loop layer. Judgment/extraction cards stay designed: their own §6 sections
   say the substrate does not exist, and running them now would fabricate.
2. **Build the real runtime (pick or extend a harness)** — front-runs OD-03
   directly; rejected without ceremony.
3. **Substrate only, no runners** — leaves the feedback loop as prose; rejected
   by the founder's scope pick.
4. **A separate service/repo** — severs the graph integration and CI gating the
   build exists for; rejected.

## Decision

Four pieces, all landed 2026-08-28 on `feat/agent-stack-build`:

1. **`scripts/build_agent_card_index.py`** parses every `<slug>-agent-stack.md`
   §2 card (100 units, 102 cards) and emits `00-index/cards.json` +
   `00-index/CARD-MAP.md`. It **enforces the ADR 0034 contract**: required keys,
   `routing_class` vocabulary, `mutate_stock_money_outbound: confirm` on every
   card, no model/queue/OD-03 token inside a card. `--check` is a CI hard gate
   (`agent-card-contract` job) — exit 1 on violation or stale index, exit 2 when
   it cannot check (never a vacuous pass). Seven card files were re-quoted to be
   YAML-valid; machine-parseability *is* the contract.
2. **`scripts/agents/run_card.py`** executes **mechanical** cards whose job is a
   disk census, a comment-aware grep, or a wrapped guard — `watch_loops.py`'s
   discipline (reports; never edits) with one sanctioned write path:
   `--write-memory` lands durable findings as one-fact-per-file semantic memory
   (ADR 0034 §4) in the owning unit's `memory/` dir, so self-improvement is a
   reviewable diff. A card must exist in `cards.json` for its agent to run — an
   undeclared agent is refused. First implementations (8 of 36 mechanical):
   `fleet-census-agent`, `harness-sentinel`, `spend-sentinel`, `registry-clerk`,
   `staleness-reaper`, `claim-auditor`, `gate-runner`, `kd-ledger`; the other 28
   are listed by the runner itself as declared-not-implemented.
3. **The first four committed skills** — `fleet-census`,
   `harness-contract-audit`, `model-pin-census`, `registry-index-refresh` —
   entered `.claude/skills/` through the §3.3 gate with real past instances,
   taking the registry 0 → 4 (measured 4/4 compliant by the census they wrap).
4. **First measured facts** landed in 8 units' `memory/` dirs. Day-one truths the
   2026-08-24 charters did not know: the fleet is **24 modules / 23 can receive /
   1 outside the contract** (`recurring_order_agent`, still); the P1 wrapper
   consolidation **holds** (0 code URL constants outside `common/model-client` —
   the first run flagged a comment as a regression, which is why the census is
   comment-aware); core is 6,556 lines (the OD-03 sunk-cost baseline, now
   measured); skill firing is **unmeasurable** and now escalated by a running job.

## Consequences

- Easier: the feedback loop is real — card → runner → measured fact → PR diff →
  board; drift between charters and disk now surfaces weekly instead of never;
  any OD-03 winner inherits `cards.json` as its spec sheet.
- Harder / owed: 28 mechanical cards await implementations; roster Evidence
  cells across the eight implemented units still read their 2026-08-27
  design-time grades (runtime truth lives in `cards.json`, the runner report,
  and `memory/` — a follow-up sweep may re-grade them); scheduling the runner
  (cron vs CI-only) is deliberately not decided here.
- Revisit when OD-03 resolves — the runner's mechanical scope may then fold into
  the chosen harness, and this ADR's boundary dissolves by design.

## Corrections — 2026-08-28 adversarial audit (same day; both defects fixed)

1. **The routing-scope claim was false as written.** "8 of 36 mechanical" counted
   8 implemented agents, of which only **4** carry `routing_class: mechanical`
   cards; `registry-clerk`/`claim-auditor` are judgment-class and
   `gate-runner`/`kd-ledger` extraction-class, so the ADR's own boundary was
   crossed by its own artifact. What each of those four actually implements is
   strictly the mechanical **sub-duty** of its card (a census or a wrapped
   guard, never the judgment) — that distinction is now *enforced*, not implied:
   `run_card.py` carries a named `MECHANICAL_SUBDUTY` allowlist and refuses any
   implemented agent that is neither mechanical nor listed. Correct remainder:
   **32** mechanical cards unimplemented, not 28.
2. **`fleet.can_receive_estimate = 23` measured the wrong gate.** The census
   read only `orchestrator.py` registration plus a body heuristic; the actual
   gate is `agent_registry.py` — five specs are `AgentTier.OPTIONAL` and
   `is_enabled()` defaults their `AGENT_<NAME>_ENABLED` flags off. Recomputed
   against the registry: **18/24 can start by default**, matching the charter's
   ≈18 this ADR wrongly overturned. The census now reads the registry, the
   metric is renamed `fleet.can_start_by_default`, and the memory fact carries
   the correction. Lesson recorded: the drift mitigation ("the census is a
   charter metric") is exactly as fallible as the census — which is why the
   audit pass exists.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | Founder (AskUserQuestion, in-session) | Scope + home locked; implementation shape delegated and recorded |
| 2026-08-28 | — | Created |
| 2026-08-28 | Adversarial audit (founder-ordered) | WOUNDED ×2 — both defects fixed same day; corrections above |
