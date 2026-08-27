---
type: directive
division: product
department: partnerships-integrations
team: partner-alliance-development
status: new
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partner-alliance-development-charter]]"
  - "[[partner-alliance-development-premortem]]"
  - "[[partner-alliance-development-loops]]"
  - "[[partnerships-integrations-directive]]"
  - "[[pos-bridge-charter]]"
  - "[[consumer-app-points-economy-charter]]"
  - "[[decision-office-charter]]"
  - "[[legal-charter]]"
---

# Partner & Alliance Development — Directive

How *this* team decides. The shape here is a **filter with a hard precondition**, because the
team's characteristic error is starting a conversation that should never have started —
either with a POS vendor no customer runs, or with Beli before the option is written down.

## Graph A — does this counterparty enter the outreach ledger?

```mermaid
graph TD
  A[Counterparty considered] --> B{Reachable via generic_webhook<br/>or csv_import instead?}
  B -->|yes| BRIDGE[Not our problem.<br/>Hand to pos-bridge. Faster, no signature.]
  B -->|no| C{Is there a NAMED venue<br/>that runs this POS?}

  C -->|no| LEDGER[Ledger state: 'never contacted'.<br/>No outreach. This is a legitimate state,<br/>not a backlog item.]
  C -->|yes| D{authModel = partner_agreement?}

  D -->|no| POSB[Engineering can unblock this.<br/>pos-bridge owns it.]
  D -->|yes| E{Do we have founder direction<br/>on sequence/terms?}

  E -->|no| ASK[Escalate: outreach sequence and terms<br/>are founder-deferred. Do not improvise them.]
  E -->|yes| GO[Outreach. Record attempt + date<br/>BEFORE the first message goes out.]
```

**The hard precondition is C.** Nine enumerable providers is a checklist, and a checklist gets
worked. The registry itself places them at *"Tier 2+ — only when selling into chains"*
(`pos-provider.registry.ts:10`) and we have no merchants of any size. Until a real venue names
one, the nine are a ledger, not a queue
([[partner-alliance-development-premortem]] M3).

**Node B is deliberately first**, before anything else is considered. The registry already
demonstrated this reasoning for AKINSOFT Wolvox — *"start with file export → csv_import
bridge"* — and the process exists to generalize that instinct rather than lose it.

## Graph B — the Beli / OD-07 path

```mermaid
graph TD
  A[Beli question arises] --> B{Is the option memo written?}
  B -->|no| MEMO[Write it. Deliverable is a MEMO,<br/>not a conversation.<br/>Nothing else in this stream proceeds.]
  B -->|yes| C{Has the founder made the OD-07 call?}

  C -->|no| D{Has OD-07 been untouched 60 days<br/>WHILE guest commits continued?}
  C -->|yes, collaborate| TALK[Open the conversation<br/>within the memo's stated bounds]
  C -->|yes, independent| CLOSE[Close the stream.<br/>Hand guest work to Guest Experience unencumbered.]

  D -->|yes| DRIFT[File a decision-by-drift finding<br/>with decision-office, NAMING the commits]
  D -->|no| WAIT[Hold. Firewall stays up:<br/>no guest artifact may assume the partnership.]
```

**This team never traverses to a decision.** The founder holds OD-07
(`OD-07, OPEN-DECISIONS.md:28`). What this team holds is the obligation to make the drift visible —
which is why node D produces an escalation rather than a nudge.

## Decision rights

### Held by this team

| Decision | Note |
|---|---|
| Whether a counterparty enters the outreach ledger | Under Graph A |
| Ledger state and its accuracy | *never contacted* / *contacted, no reply* / *in conversation* / *declined* / *signed* |
| How the Beli option is framed and what the memo covers | The framing, not the answer |
| Whether a Türkiye entry is a partnership problem or a bridge problem | Triage, node B |
| When to file a decision-by-drift finding | Under Graph B node D |

### Not held here

| Decision | Owner |
|---|---|
| **OD-07 itself** | **founder** |
| **Which counterparty to approach first** | **founder — deferred. Not improvised here.** |
| **Commercial terms, pricing, revenue share** | **founder — deferred**, then [[unit-economics-pricing-charter]] |
| Legal form of any agreement; repository of record | [[legal-charter]] |
| Whether to build an adapter after a signature | [[pos-bridge-charter]] |
| Guest-app scope and build | [[consumer-app-points-economy-charter]] |

## The two standing rules

1. **Never report agreements without attempts.** `pi.unblocking_agreements` and
   `pi.time_to_first_response` are reported as a pair, always, plus raw attempt count. A zero
   with twelve attempts and a 40-day median is a market signal; a zero with zero attempts is a
   staffing fact. Reporting one number lets the two be confused for a year
   ([[partner-alliance-development-premortem]] M2).
2. **Record the attempt before the message goes out.** Not after, not weekly. A ledger
   backfilled from memory is the mechanism by which "we did not try" becomes indistinguishable
   from "they did not reply."

## Escalation triggers

| Trigger | Escalate to | As |
|---|---|---|
| **OD-07 untouched 60 days while guest commits continue** | [[decision-office-charter]] | Decision-by-drift finding, naming the commits |
| A named venue runs a `partner_agreement` provider | department + founder | Outreach request — sequence and terms are the founder's |
| A counterparty proposes terms | founder + [[legal-charter]] | Never negotiated here |
| A guest artifact appears that assumes the partnership | [[consumer-app-points-economy-charter]] + department | Firewall breach — premortem M4 |
| All nine ledger rows still read "never contacted" at 6 months | department | Finding: is this team correctly staffed, or should it be dormant? |

## On being a NEW team

This team is graded **NEW** — the blocker list exists, the function does not
([[partner-alliance-development-charter]]). The directive is written to suit that: every rule
above is designed to make an *absence* of activity legible rather than invisible. A BD function
with nothing to report is normal. A BD function whose nothing cannot be distinguished from
neglect is the failure.
