---
type: agenda-board
division: corporate
department: compliance-privacy
status: provisional
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, compliance.obligation_coverage, compliance.subprocessor_classification]
updated: 2026-08-24
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-agenda-full]]", "[[compliance-privacy-premortem]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-schedule]]", "[[privacy-engineering-agenda-board]]", "[[regulatory-posture-agenda-board]]", "[[regulated-operations-agenda-board]]"]
---

# Compliance & Privacy — Board

> **PROVISIONAL — no work done yet.**

## Unit status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  team AS Team,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/compliance-privacy"
SORT team ASC, type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/corporate/compliance-privacy"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Counters

- `privacy.erasure_completeness` — **0%** · schema supports it, nothing proves it
- `privacy.consent_call_sites` — **0** · the schema has no callers in `apps/` or `services/`
- `privacy.pii_definition_count` — **3 distinct across 4 guards** · target **1**
- `privacy.consent_gate_denials` — undefined · no gate is running
- `compliance.obligation_coverage` — **0%** · zero "GDPR"/"CCPA" in source
- `compliance.subprocessor_classification` — **0 / 50 hosts**
- `compliance.notice_accuracy` — unverified · brand stale at `Privacy.tsx:23,31,43`
- `nf_b.research_store_erasability` — **unanswered** · the department's biggest open question
- unit docs : running controls — **28 : 2** (`check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`)

## Blocking

- [ ] Consent schema has **zero call sites** — no consent has ever been captured
- [ ] No erasure function, no receipt table — `erasure_receipt_id` (`:82`) references nothing
- [ ] Two byte-identical PII pattern lists, no shared module, no CI guard on divergence
- [ ] `research_tasks.py` PII definition is disjoint from the other two (email/phone only)
- [ ] No policy, no DPA, no BAA, no subprocessor register anywhere in the repo
- [ ] Consent gate not built — [[customer-relationship-research-charter]] is blocked on us
- [ ] NF-B erasability vs append-only research store — no `OPEN-DECISIONS.md` entry yet
- [ ] CORP-F2 open — DPA/BAA instrument vs obligation split
- [ ] CORP-F4 open — is [[regulated-operations-charter]] Corporate's at all?
- [ ] Ethics scope sits in the line → this department reviews itself (premortem M5)

## Not blocking, but wrong

- [ ] `Privacy.tsx` says "WineOps" at `:23`, `:31`, `:43` — pre-Mudavym brand
- [ ] `teams/commercial.md:578-580` cites "Ethics & Responsible AI (advisory)" — **not adopted**

## Teams

- [[privacy-engineering-charter]] — `exists` — controls, guards, erasure proof · **strongest evidence in the division**
- [[regulatory-posture-charter]] — `new` — obligations, register, notice · **0% coverage, verified**
- [[regulated-operations-charter]] — `new`, ⏸ **GATED** — alcohol/excise · does not staff until the trigger fires

## Watch — the gated trigger

- [ ] First customer in a jurisdiction where we hold or touch a licence
- [ ] First time excise reporting appears in a signed MSA
- Checked: **never** · Cadence owner: [[compliance-privacy-schedule]]
- `services/agent-orchestrator/agents/compliance_agent.py:16` — `IS_STUB = True`; orchestrator refuses to start it (`core/orchestrator.py:245`)
