---
type: agenda-full
division: product
department: partnerships-integrations
team: partner-alliance-development
status: provisional
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partner-alliance-development-charter]]"
  - "[[partner-alliance-development-premortem]]"
  - "[[partner-alliance-development-agenda-board]]"
  - "[[partner-alliance-development-directive]]"
  - "[[pos-bridge-agenda-full]]"
  - "[[consumer-app-points-economy-charter]]"
  - "[[partnerships-integrations-agenda-full]]"
  - "[[OPEN-DECISIONS]]"
---

# Partner & Alliance Development — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three workstreams, one of which is urgent and two of which are constrained.

| Workstream | State | First deliverable |
|---|---|---|
| **Beli / OD-07** | Urgent — the option decays | A written option memo |
| **POS partner agreements** | Constrained — sequence is founder-deferred | The blocker ledger |
| **Türkiye market** | Scope question open | A triage pass against the universal providers |

**This team is graded NEW.** Nine blocked providers are enumerable in code; zero outreach has
occurred; nothing in the repo records a counterparty contact. That is the honest starting
position and it is why the first deliverables are all artifacts rather than agreements.

## How

### The Beli exploration — why it is first, and why it is a memo

OD-07 asks whether to *"build the guest consumer experience independently vs explore
collaboration"*, and notes it *"determines whether guest-app work is product or partnership
groundwork"* (OD-07, `OPEN-DECISIONS.md:29`). Its stated unblocker is *"Founder call after guest MVP
scope exists (FUTURES.md §7.5)."*

**This team does not answer it.** It makes it answerable, and it protects the option in the
meantime. The deliverable is deliberately a **memo, not a conversation** — because an open
conversation creates its own momentum and can shape the guest product around a partner who
has signed nothing ([[partner-alliance-development-premortem]] M4). The memo states:

- what a collaboration would buy that building independently would not;
- what it would cost — in commitments, in roadmap constraint, in optionality foreclosed;
- what the option is worth if simply left unexercised for another two quarters;
- what specifically decays with time, and how fast.

That last point is the reason for urgency. The option is strongest while the guest surface is
unbuilt. Every shipped slice reduces what there is to co-design and moves the eventual
conversation from *partnership* toward *distribution deal*
([[partner-alliance-development-premortem]] M1).

### POS partner agreements — build the ledger, not the pipeline

Nine providers carry `authModel: "partner_agreement"`
(`pos-provider.registry.ts:119, 171, 192, 222, 232, 242, 254, 264, 298`). The registry's own
sequencing places them at *"Tier 2+ — only when selling into chains"* (`:10`), and we have
zero merchants of any size.

**So the precondition is hard: no partner-agreement outreach begins without a named venue that
runs that POS.** The nine are a ledger to maintain, not a queue to work
([[partner-alliance-development-premortem]] M3). This also means the team needs **no outbound
target list** — which is convenient, since that is founder-deferred and this agenda proposes
none.

What gets built instead is the machinery that makes a future zero readable: a ledger where
each of the nine carries a state — *never contacted* / *contacted, no reply* / *in
conversation* / *declined* / *signed* — with a date and what was attempted.

### Türkiye — triage before outreach

Five entries (`:268-322`): Protel/Simpra, ElektraWeb, Vectron, AKINSOFT Wolvox, SambaPOS. The
registry already records the right instinct for one of them — Wolvox: *"start with file export
→ csv_import bridge."*

**Every entry gets triaged against the two universal providers before it enters the outreach
ledger.** If a counterparty can be reached via `generic_webhook` or `csv_import`, it is
[[pos-bridge-charter]]'s problem and it is far faster. Only what survives triage is a
partnership problem ([[partner-alliance-development-premortem]] M5).

## Why now

1. **The Beli option decays and nothing currently slows the decay.** Guest-experience work has
   its own momentum; OD-07 has none. Absent a forcing artifact, M1 is the default outcome, not
   a risk.
2. **A zero recorded today is worth more than a zero recorded in a year.** Building the ledger
   before any outreach means the first zero is *readable* — "nine never contacted, by
   decision" is a legitimate and informative state.
3. **The triage step is cheap now and expensive later.** Once a counterparty is in an outreach
   process, nobody goes back to ask whether a CSV would have worked.

## Next steps

| # | Step | Depends on | Done when |
|---|---|---|---|
| 1 | Write the **OD-07 option memo** | — | The memo exists; the founder call is answerable |
| 2 | Stand up the **blocker ledger** for all 9 `partner_agreement` providers, each with a state and a date | — | Nine rows, nine honest states |
| 3 | **Triage the 5 Türkiye entries** against `generic_webhook` / `csv_import` | [[pos-bridge-charter]] | Each is classified partnership-problem or bridge-problem |
| 4 | Define `pi.time_to_first_response` and its recording, **before** the first outreach | — | The measurement exists ahead of the activity |
| 5 | Agree the **firewall rule** with [[consumer-app-points-economy-charter]]: no guest artifact takes the partnership as a premise while OD-07 is open | Guest Experience | Written and acknowledged by both |
| 6 | Wire the **60-day drift alarm** on OD-07 into the monthly loop | [[decision-office-charter]] | The escalation path exists and has an owner |

Steps 1–4 need nobody's permission. Step 5 is a two-team agreement. Step 6 is a handshake with
the Decision Office.

## Questions for the founder

1. **OD-07 timing.** Should the option memo be written **now**, or after guest MVP scope
   exists as OD-07 (`OPEN-DECISIONS.md:29`) suggests? This agenda argues *now*, because the memo is
   what keeps the option from decaying while scope is being defined. That argument is offered,
   not assumed.
2. **The no-outreach-without-a-named-venue precondition.** It means this team may report zero
   attempts for a long time, by design. Endorse, or is exploratory outreach wanted anyway?
3. **Türkiye scope** — in or out for v0? A different clock and a different motion; at least
   one entry is probably a CSV problem rather than a partnership one.
4. **Where do partnership artifacts live?** A signed agreement is a legal document.
   [[legal-charter]] and [[strategy-fundraising-charter]] both plausibly own the repository of
   record; this team owns the relationship, not the filing.

**Not asked, deliberately:** who to approach first, and on what commercial terms. Both are
founder-deferred, and this agenda's structure is designed to work without either.
