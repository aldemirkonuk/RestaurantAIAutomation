---
type: agenda-full
division: corporate
department: compliance-privacy
team: regulated-operations
status: provisional
metrics: [regops.trigger_check_freshness, regops.jurisdiction_count, regops.deadline_miss_count, regops.excise_reconciliation_variance]
updated: 2026-08-24
links: ["[[regulated-operations-charter]]", "[[regulated-operations-premortem]]", "[[regulated-operations-directive]]", "[[regulated-operations-loops]]", "[[regulated-operations-schedule]]", "[[regulated-operations-agenda-board]]", "[[compliance-privacy-agenda-full]]", "[[compliance-privacy-schedule]]", "[[regulatory-posture-charter]]", "[[inventory-ledger-charter]]", "[[agent-fleet-charter]]", "[[commercial-workforce-agreements-charter]]", "[[design-partner-operations-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[corporate]]"]
---

# Regulated Operations — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.
> **And more than provisional: this team is not staffed.** ⏸ It has an entry
> trigger, no people, no metrics but one, and no work in progress. Everything below
> §"Before activation" is a plan for a team that may never exist.

## What

Two agendas, separated because they belong to different worlds.

**Before activation — three items, all owned by others:**

1. **A quarterly trigger check with a named owner.** The entire counter-pressure
   against [[regulated-operations-premortem]] M1, which is currently at its worst
   possible value: the trigger has never been checked.
2. **A second sensor where the event actually happens.** Add *"does this mention
   excise, licensing, or alcohol movement?"* to
   [[regulatory-posture-charter]]'s per-instrument sign-off. One line, and it sees
   the trigger months earlier than a quarterly review.
3. **An owner for the three-tier control that is already running.**
   `constraint_engine.py:38-41` (C-19 `THREE_TIER_COMPLIANCE`) executes on outbound
   drafts today and belongs to nobody.

**On activation — the 30-day design gate, decided now:**

4. Licence and jurisdiction inventory.
5. A filing calendar with evidence, built on the reserved event vocabulary.
6. An excise computation that **consumes** [[inventory-ledger-charter]]'s published
   aggregate and never recomputes movement.
7. A verdict on `compliance_agent.py` — implement it, or delete it.

## How

**Before activation, the method is: put the sensor where the event is, not where the
reviewer is.** A quarterly check is a backstop; the sign-off checklist is the primary
sensor, because an MSA with an excise clause passes through
[[regulatory-posture-charter]]'s L4 before execution and through a quarterly review
months later. Both, because one is cheap and the other is timely.

**On activation, the method is a 30-day design gate before the first filing.** This
is the counter to [[regulated-operations-premortem]] M2 and it is the single most
important sentence in this agenda: a team born inside an emergency builds a
spreadsheet, and the spreadsheet becomes the process. The gate produces a runbook and
a data-source decision first. If a filing is genuinely due inside 30 days, that is an
escalation about a commitment made without this team — not a reason to skip the gate.

**The data-source decision is pre-made here so the emergency cannot make it
differently.** Excise reporting consumes the ledger's published aggregate. If the
ledger's shape does not serve excise, the fix is a new published aggregate *in the
ledger*, owned by [[inventory-ledger-charter]] — never a second query in this team.
Two sources of movement truth means a regulator gets to pick one
([[regulated-operations-premortem]] M3), and this is exactly the decision a
deadline gets wrong.

**On the stub, the method is inherited.**
`services/agent-orchestrator/agents/compliance_agent.py:11-15` explains why it
declares itself: an event-consuming no-op *"reads identically to a working one from
every dashboard and health check."* `core/orchestrator.py:245-250` enforces the
refusal at boot. That reasoning is the model for how this team should treat every
dormant thing it owns, including its own charter — hence the banner at the top of
every document in this directory.

## Why now

**"Now" here means "write the design now, do the work never — until the trigger."**
Three reasons the design is worth writing while the team is unstaffed:

1. **The trigger fires during a deal or a market entry.** That is definitionally the
   worst moment to discover the scope has no owner and no plan. A dormant team's
   deliverable is *a design that exists before the emergency*.
2. **Two failure modes are live today for a team that does not exist.**
   `regops.trigger_check_freshness` is unbounded, and C-19 is executing on production
   traffic with no owner and no measurement. Neither waits for activation.
3. **OD-C4 is cheaper to answer now.** Whether this scope is Corporate's or Product's
   ([[corporate]] §7) costs nothing to decide today and costs a re-org during a
   deadline if left.

**Why *not* now, stated plainly.** No customer, no jurisdiction, no clause, no
filing. Any work beyond the three pre-activation items is speculative work on a
regime we have not entered, and it should be refused — including by this team's own
future self, which will be tempted to prepare.

## Next steps

| # | Step | Owner | When |
|---|---|---|---|
| 1 | Quarterly trigger check lands on a real schedule with a named owner | [[compliance-privacy-schedule]] | now |
| 2 | Excise/licensing question added to the instrument sign-off checklist | [[regulatory-posture-charter]] | now |
| 3 | C-19 recorded in the obligation register as *"operating control, no owner"* | [[regulatory-posture-charter]] | now |
| 4 | C-19 hit-rate measured — zero hits with non-zero draft volume is a dead control | [[regulatory-posture-charter]] → here on activation | now |
| 5 | Sunset trigger recorded: unfired by **2027-08-24** → retire the track | [[decision-office-charter]] | now |
| 6 | OD-C4 answered — Corporate or Product? | founder | now |
| — | *— activation line —* | | |
| 7 | 30-day design gate: runbook + data-source decision before any filing | this team | on trigger |
| 8 | Licence and jurisdiction inventory | this team | on trigger |
| 9 | Excise computation consuming the ledger's published aggregate | this team + [[inventory-ledger-charter]] | on trigger |
| 10 | Verdict on `compliance_agent.py` — implement or delete | this team + [[agent-fleet-charter]] | on trigger |

Steps 1–6 are the whole agenda. They total perhaps a day of work spread across two
other teams, and they are what make the difference between a gated team and a
forgotten one.

## Questions for the founder

1. **OD-C4 — is this scope Corporate's at all?** Alcohol excise may belong to Product
   once licensing is a *feature* rather than an *obligation*. This charter takes no
   position beyond noting the argument for Product is real: a team follows the
   feature. Answering costs nothing now.
2. **Do you accept the sunset trigger?** Proposed: if neither entry condition has
   fired by **2027-08-24**, retire the track — delete these seven documents, delete
   `compliance_agent.py`, and record that the scope returns to
   [[regulatory-posture-charter]] as a note. Written at founding so retirement is a
   plan, not a post-mortem, and so [[red-team-charter]] has a date and a number.
3. **Who owns C-19 in the meantime?** A three-tier compliance control is executing on
   production outbound traffic today with no charter behind it. Proposed:
   [[regulatory-posture-charter]] carries it in the register as an unowned operating
   control until activation. That is a holding position, not a solution.
4. **Is there a jurisdiction on the roadmap we should know about?** The entry trigger
   is deliberately event-based, but if a licensed market is already in the plan, the
   30-day design gate should start before the signature rather than after it.
5. **Should a permanently-dormant stub agent have an anti-sprawl rule?**
   [[README]] §6 covers scheduled jobs (3 no-action runs) and skills (30 days
   unfired). A declared stub sitting in `agents/` for three years has no equivalent
   rule, and `compliance_agent.py` is the test case.

## What this team owes and is owed while dormant

| Counterparty | Owed to them | Owed from them |
|---|---|---|
| [[compliance-privacy-schedule]] | Two trigger questions that need no expertise to answer | The quarterly check actually running |
| [[regulatory-posture-charter]] | The C-19 citation and its unowned status | The sign-off checklist line; early sight of any excise clause |
| [[design-partner-operations-charter]] | — | Notice of any deal in a licensed jurisdiction |
| [[agent-fleet-charter]] | A verdict on `compliance_agent.py`, eventually | The stub kept declared and refused at boot |
| [[inventory-ledger-charter]] | Advance notice that excise will need a published movement aggregate | — |
| [[decision-office-charter]] | OD-C4 and the sunset trigger, as dated entries | Both kept open rather than drifting |
