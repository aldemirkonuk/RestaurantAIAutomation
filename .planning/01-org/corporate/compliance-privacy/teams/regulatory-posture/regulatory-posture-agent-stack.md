---
type: agent-stack
division: corporate
department: compliance-privacy
team: regulatory-posture
status: designed
updated: 2026-08-27
metrics: [compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, compliance.unevidenced_clause_count, compliance.questionnaire_answerable_rate]
links: ["[[regulatory-posture-charter]]", "[[regulatory-posture-schedule]]", "[[regulatory-posture-loops]]", "[[regulatory-posture-directive]]", "[[regulatory-posture-premortem]]", "[[0034-agent-stack-artifact]]", "[[compliance-privacy-agent-stack]]", "[[privacy-engineering-agent-stack]]", "[[commercial-workforce-agreements-charter]]", "[[standards-verification-charter]]", "[[red-team-charter]]", "[[design-partner-operations-charter]]"]
---

# Regulatory Posture — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's core act is **saying no to a signature**, and it is not delegable:
> **nothing here is filed, signed, sent, or answered on the record by an agent.** The
> card produces a clause-by-clause verdict sheet; a person carries it, before execution
> — *"a sign-off after signature is a record, not a control"*.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `obligation-register-steward` | Keep every register row true — duty → control with a `file:line` or an honest gap — re-verify citations when the cited code moves, and hold the four asserted claims on the privacy notice against what the code does | NEW; the raw material for two of its jobs EXISTS |

## 2. Agent cards

```yaml
agent: obligation-register-steward
unit: regulatory-posture
triggers:
  - schedule: "monthly — register sweep and notice read-through"        # [[regulatory-posture-schedule]]
  - schedule: "quarterly — subprocessor reclassification"               # [[regulatory-posture-schedule]]
  - topic: control.citation_changed   # publisher: NONE (gap — the edit that falsifies a row is made by someone with no idea the row exists)
  - topic: instrument.received        # publisher: NONE (gap — no intake; zero instruments have ever arrived)
consumes:
  - "the register v0 — the ten-duty table in [[regulatory-posture-charter]] §Evidence (5 duties partially evidenced, 5 with nothing)"
  - "apps/web/src/pages/Privacy.tsx:5-12 — the four asserted claims (no cookies, localStorage tokens, telemetry shipped disabled, partner sharing off); routed at App.tsx:158, lazy at :107"
  - "foundation/EXTERNAL_CONNECTIONS.md — 50 runtime hosts, 8 SDKs, 80 env vars, with per-service reference counts"
  - "convergence and drill verdicts — publisher: [[privacy-engineering-agent-stack|pii-store-classifier]]"
emits:
  - "register deltas and the stale-citation list → compliance.obligation_coverage → [[compliance-privacy-agent-stack|cp-orchestrator]] board"
  - "host classifications (receives personal data / not / unknown) → compliance.subprocessor_classification"
  - "unevidenced-clause findings → [[commercial-workforce-agreements-charter]] — Legal drafts the instrument, we constrain the Annex (CORP-F2 open, not decided here)"
  - "accepted gaps → [[red-team-charter]]'s quarterly adversarial review — attacked by someone who did not accept them"
  - "any clause mentioning excise, licensing, or alcohol movement → [[regulated-operations-agent-stack]] as the entry-trigger sensor"
  - nf_a events (task_type: obligation_mapping)
routing_class: judgment      # reading a clause and deciding whether a citation supports it is not a grep ([[regulatory-posture-schedule]] §Skills)
quality_bar: "the charter's anti-gaming rule: a mapping counts only with a file:line, a passing test, or a named owner with a date. 'Handled by our architecture' scores 0 — and an honest gap scores 0 too, but the gap is the useful one"
autonomy:
  read: autonomous
  propose: autonomous        # register rows, redline proposals, verdict sheets — all PRs
  mutate_stock_money_outbound: confirm   # constant
memory: regulatory-posture
escalates_to: "[[compliance-privacy-charter]]; CORP-F2 to [[decision-office-charter]]; an inbound instrument escalates on arrival, not on deadline (premortem M1)"
```

**Two hard rules.** (1) **No control with zero call sites is ever marked covered.** Two
v0 rows carry that caveat — lawful basis and purpose limitation are schema-only, never
exercised — and it must survive every sweep; dropping it is how `obligation_coverage`
reaches 100% while meaning nothing. (2) **The agent never decides whether to accept a
commercial risk.** It makes the gap explicit before signature; signing anyway is the
founder's call, and one this team must not make silently by staying quiet.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `obligation-map` | T2 | A new duty enters scope, or a cited control changes | A register row with a `file:line`, a passing test, or a named owner + date — sentences rejected; unevidenced mappings recorded as gaps, not as coverage | The ten-duty v0 table in [[regulatory-posture-charter]] §Evidence, produced by hand in the 2026-08-24 session including the caveats on the two unexercised controls | NEW |
| `notice-truth-check` | T2 | A PR touches one of the four claimed behaviours, or monthly | Each claim marked true / false / untestable with a citation | The "WineOps" staleness at `Privacy.tsx:23,31,43` was found exactly this way in the same session — the loop had already failed once before being built | NEW |

`notice-truth-check` must **call** [[standards-verification-charter]]'s staleness
machinery rather than reimplement it: this team owns the claim, not the tooling.

**Three candidates excluded on §3.3 rule 3.** `subprocessor-classify` is borderline and
stays out — the raw-HTTP finding was a *finding*, not a classification pass, and no host
has been formally classified. `dpa-annex-check` and `questionnaire-answer` have zero
instances because zero instruments and zero questionnaires have arrived —
`dpa-annex-check` being the most valuable candidate and the least eligible is the exact
tension rule 3 exists to hold.

## 4. Memory

- **Procedural** — the two §3 skills; candidates via [[skill-harvesting-charter]]'s
  queue, through the §3.3 gate.
- **Episodic** — nf_a `task_type: obligation_mapping`, with `context.duty` and
  `context.citation` as jsonb keys so "which rows did this commit falsify" is one
  filter. Clause text is **referenced, never copied into an event** — the research
  store is append-only and a counterparty's draft is not ours to retain.
- **Semantic** — `memory/` beside this file, index `regulatory-posture-MEMORY.md`.
  First facts: the verified zero **with its false positive recorded** (`CCPAE` is the
  Consell Català de la Producció Agrària Ecològica — recorded so a future grep
  reporting "one hit" is not believed); the two head starts; and every accepted gap
  with the date it was accepted, because `compliance.gap_age_max` is meaningless
  without one. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Metrics (the anti-gaming rule is
  small and load-bearing enough to always carry). `EXTERNAL_CONNECTIONS.md` and any
  instrument are retrieval targets.

**Consolidation** — monthly, mirrored in [[regulatory-posture-schedule]]: read the
mapping slice; **failures first** — a citation that went stale becomes a fact naming the
change that broke it, not "register drifted"; a gap aged past a quarter becomes a fact
with its acceptor; expire at 90 days; propose candidates. One PR; "no delta" when true.

## 5. Async contract

Verdict sheets, register PRs, board rows, NF-A events, and [[regulatory-posture-loops]]
(`instrument-signoff` `per-event`, `notice-accuracy` `per-pr`,
`obligation-register-currency` monthly). Gap rows:

| Gap | Why it is a gap |
|---|---|
| `instrument.received` has no publisher | The `instrument-signoff` loop is the only job here that can prevent an irreversible outcome, and its trigger is somebody remembering to forward an email. [[design-partner-operations-charter]]'s pipeline is the only advance sight L4 gets |
| `control.citation_changed` has no publisher | Citations are load-bearing inside signed instruments and are falsified by unrelated PRs. Until a CI check exists, the monthly sweep bounds the exposure at 30 days |
| The register is not yet an artifact | v0 lives *inside* [[regulatory-posture-charter]] §Evidence as a table in a document. Nothing can cite a row by id, which is the first thing a questionnaire answer needs |
| `compliance.unevidenced_clause_count` is a true zero over an empty set | Zero signed instruments. The number is honest and uninformative, and must not be reported as a passing control |

## 6. Evidence today

- **NEW — the steward, both skills, the register as an artifact, and every metric.**
  The zero was verified by grep, not transcribed: `gdpr|ccpa|data subject|right to
  erasure` across `apps/`, `services/`, `supabase/`, `scripts/` returns zero hits.
- **PARTIAL — head start 1.** `apps/web/src/pages/Privacy.tsx:5-12` is already written
  to the correct standard by someone else, and is already stale at `:23,31,43`.
- **PARTIAL — head start 2.** `foundation/EXTERNAL_CONNECTIONS.md` is a raw
  subprocessor register generated as an architecture artifact; classification converts
  it. Two LLM hosts appear without SDK imports — called over raw HTTP, a subprocessor
  question as well as a retry/cost one, with `constraint_engine.py:113-117` and
  `provider_communication_agent.py:725-733` as its first two citations.
