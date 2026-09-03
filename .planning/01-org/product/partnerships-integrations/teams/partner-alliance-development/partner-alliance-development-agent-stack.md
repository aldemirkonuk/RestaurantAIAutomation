---
type: agent-stack
division: product
department: partnerships-integrations
team: partner-alliance-development
status: designed
updated: 2026-08-27
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
links: ["[[partner-alliance-development-charter]]", "[[partner-alliance-development-schedule]]", "[[partner-alliance-development-loops]]", "[[partner-alliance-development-directive]]", "[[0034-agent-stack-artifact]]", "[[partnerships-integrations-agent-stack]]", "[[decision-office-charter]]", "[[skills-charter]]"]
---

# Partner & Alliance Development — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The team is graded **NEW**: zero outreach, zero agreements, zero recorded contact with any
> counterparty ([[partner-alliance-development-charter]] §Evidence). Its agent therefore
> cannot be an outreach agent — it is a **recorder and triager**, and the distinction is the
> whole design. Harness → [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], the outbound gate →
> [[action-safety-the-human-gate-charter]] (FUTURES §8.1).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `blocker-ledger-keeper` | Keep the nine-provider blocker ledger true — state, date, and what was attempted — triage every new counterparty as a signature problem or a bridge problem, and report OD-07's days-since-touched | NEW |

One row, and it does not send anything. A BD agent that could open a conversation would be
pre-empting a decision the founder has explicitly deferred (charter §Non-goals 2).

## 2. Agent cards

```yaml
agent: blocker-ledger-keeper
unit: partner-alliance-development
triggers:
  - schedule: "monthly — counterparty ledger review + OD-07 decay check"   # [[partner-alliance-development-schedule]]
  - schedule: "quarterly — registry re-read for new partner_agreement entries"
  - topic: registry.auth_model_changed    # publisher: NONE (gap — the registry is a source file; an authModel edit announces nothing)
  - topic: counterparty.outreach_recorded # publisher: a human, before the message is sent (schedule, "Per outreach")
consumes:
  - "pos-provider.registry.ts — the 9 authModel: partner_agreement lines (:119, :171, :192, :222, :232, :242, :254, :264, :298) and the Tier-2 sequencing at :10"
  - "pos-provider.registry.ts:268-322 — the 5-provider Türkiye set"
  - "[[OPEN-DECISIONS]] OD-07 (:30) and its unblocking condition"
emits:
  - "the ledger → [[partner-alliance-development-agenda-board]]"
  - "pi.unblocking_agreements AND pi.time_to_first_response as a pair → [[partnerships-integrations-agent-stack|pi-bridge-board]] — never one alone"
  - "the OD-07 option memo → [[partner-alliance-development-questions]] and [[decision-office-charter]]"
  - "outreach drafts — drafted only, never sent"
  - "nf_a events (task_type: counterparty_triage)"
routing_class: judgment    # reachability triage is a call: signature problem or csv_import problem. The ledger-sync half is mechanical and is carded at the higher class so a triage never routes as a lookup
quality_bar: "a ledger row is complete only when it distinguishes 'never contacted' from 'contacted, no reply' — the charter's own test. NONE (gap): pi.time_to_first_response has no data because no outreach has occurred, so nothing grades a triage yet"
autonomy:
  read: autonomous
  propose: autonomous      # ledger rows, memos and drafts land as PRs
  mutate_stock_money_outbound: confirm   # constant — and it binds hardest here: every counterparty message is outbound, so drafting is the agent's and sending is always a human's
memory: partner-alliance-development
escalates_to: "[[decision-office-charter]]"   # OD-07 at 60 days untouched — the schedule's own escalation
```

**Two card-level prohibitions, both transcribed from the charter.** The agent **names no
first target** (founder-deferred, §Non-goals 2) and **proposes no answer to OD-07** — it owns
the exploration that makes the call answerable, never the call.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `counterparty-reachability-triage` | T2 | A new counterparty is considered | Classified partnership-problem or bridge-problem, with the reason recorded | The registry already did this once, for AKINSOFT Wolvox — *"start with file export → `csv_import` bridge"*, routed accordingly at `pos-provider.registry.ts:309`. The reasoning exists in code and nowhere else | NEW |
| `blocker-ledger-sync` | T2 | Monthly, or on any registry `authModel` change | Every `partner_agreement` provider carries a current state and date; new blocked entries added; agreements reflected in registry status | Negatively, and checkably: 2026-08-24 found 9 blocked providers enumerable by grep and **no record anywhere of whether any had been contacted**. That absence is the instance | NEW |
| `option-memo` | T2 | A strategic option risks being foreclosed by accumulation rather than decision | A memo exists stating what the option buys, costs, forecloses, and how fast it decays | The same reasoning was applied successfully once already, to NF-C: *"preserved as ambition, not carried as dead weight"* (`foundation/README.md` §4.3). OD-07 is the **trigger**, not the instance | NEW |

Consumed, owned elsewhere: `decision-drift-check` — [[partner-alliance-development-schedule]]
flags it as *"very likely [[decision-office-charter]]'s skill, not this team's"*, and this
stack takes that flag at its word rather than claiming a row. `pos-registry-audit` is
[[pos-bridge-schedule]]'s; the envelope is [[skills-charter]]'s.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3
  gate unchanged.
- **Episodic** — nf_a `task_type: counterparty_triage` and `blocker_ledger_sync`. Needs
  `context.provider_key` and `context.state` as jsonb keys so *"how long has this one been in
  this state"* is one filter. The episodic layer will be **thin by construction** until
  outreach happens: a team whose work is other people's replies produces few events.
- **Semantic** — `memory/` beside this file, index
  `partner-alliance-development-MEMORY.md`. Founding facts: *nine providers blocked on a
  signature, enumerated by line* (source: charter §Why this team is distinct, 2026-08-24);
  *zero outreach has ever occurred — searched and not found: any agreement artifact, outreach
  log, contact record or partnership CRM surface* (source: charter §Evidence); *Wolvox is a
  bridge problem, not a partnership problem* (source: `pos-provider.registry.ts:309`).
  Provenance frontmatter per ADR 0034; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The registry's
  nine lines are retrieval targets by `path:line`, never the whole file.

**Consolidation** — monthly, mirrored in [[partner-alliance-development-schedule]]: read the
ledger and the month's triages. **Failures first**, with a definition specific to this team:
a *failure* here is a counterparty that moved from "contacted" back to silence, and the fact
must name the mechanism — a wrong contact route, a tier we do not qualify for — not "no
reply". Expire facts unverified 90 days. One PR; **"no delta" is the expected outcome for
the first three runs and must be stated, never left silent** — that is the difference between
a slow clock and a dead team, and the schedule's six-run deletion clause depends on it.

## 5. Async contract

Loops ([[partner-alliance-development-loops]] — `pad-counterparty-ledger`, `pad-od07-decay`,
`pad-reachability-triage`, `pad-guest-firewall`), nf_a events, vault PRs, skill candidates.
Gap rows:

| Gap | Why it is a gap |
|---|---|
| `registry.auth_model_changed` has no publisher | An `authModel` edit is a diff nobody announces; the quarterly registry re-read bounds the blind spot at 90 days |
| The ledger's real consumer has never existed | A signed agreement hands off to [[pos-bridge-charter]] — **0 of 9**. This is not a wiring gap but a world gap, and it is why the two metrics must always be reported together |
| The OD-07 memo notifies nobody | It lands in [[partner-alliance-development-questions]] as a vault PR; [[decision-office-charter]] must poll it. Same shape as `core/orchestrator.py:198-206` — a subscription with nothing pushing |
| `pi.time_to_first_response` has no publisher **or** data | Nothing records an outreach attempt today. The schedule's *"record the attempt **before** the message is sent"* rule is the only proposed publisher, and it is a human, not a system |

## 6. Evidence today

- **EXISTS — the blocker list.** Nine `authModel: "partner_agreement"` entries, verified by
  grep at the nine lines cited in the card; the Tier-2 sequencing at
  `pos-provider.registry.ts:10`; the 5-provider Türkiye set at `:268-322`.
- **EXISTS — OD-07 as a live, documented fork** (`OPEN-DECISIONS.md:32`), unblocked by a
  founder call after guest-MVP scope exists (FUTURES §7.5). **This stack does not touch it.**
- **NEW — everything else, plainly.** The agent, all three skills, the `memory/` layer, every
  nf_a emission, and the function itself: zero outreach, zero agreements, zero recorded
  contact. `procurement_conversations` exists but threads *vendor* email — a different
  counterparty class, owned by [[supplier-distributor-network-charter]].
- **The honest reading of the zeroes.** Zero agreements with twelve attempts and a 40-day
  median is a market signal; zero agreements with zero attempts is a staffing fact. Today it
  is the second, and this stack is built so that stays visible.
