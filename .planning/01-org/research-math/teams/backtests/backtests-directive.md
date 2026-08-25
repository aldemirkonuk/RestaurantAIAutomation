---
type: directive
division: research-math
department: research-math
team: backtests
status: new
updated: 2026-08-24
links: ["[[backtests-charter]]"]
---

# Backtests — Directive

How this team decides what to replay.

```mermaid
graph TD
  A[Claim or outcome published] --> B{Replayable?<br/>data it did not see}
  B -->|no| C[Record as unfalsifiable<br/>that is itself a finding]
  B -->|yes| D[Replay against injected data]
  D --> E{Survives?}
  E -->|yes| F[Record; no action]
  E -->|no| G[File finding at owning unit<br/>42-day age-out]
  G --> H{Owner disputes?}
  H -->|yes| I[Escalate to OPEN-DECISIONS]
  H -->|no| J[Owner acts or accepts in writing]
```

## Decision rights
Backtests decides **what to replay and how to score it**. It does not decide what ships.

## Escalation trigger
A falsified claim that is republished unchanged goes to `OPEN-DECISIONS.md`, not to a
second finding.

## The rule that protects the team from itself
An unfalsifiable claim is a finding. Otherwise the easy path is to only replay what is
comfortably replayable (premortem M1).
