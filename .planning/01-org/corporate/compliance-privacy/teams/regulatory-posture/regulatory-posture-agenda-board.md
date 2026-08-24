---
type: agenda-board
division: corporate
department: compliance-privacy
team: regulatory-posture
status: provisional
metrics: [compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, compliance.unevidenced_clause_count, compliance.questionnaire_answerable_rate]
updated: 2026-08-24
links: ["[[regulatory-posture-charter]]", "[[regulatory-posture-agenda-full]]", "[[regulatory-posture-premortem]]", "[[regulatory-posture-loops]]", "[[regulatory-posture-schedule]]", "[[compliance-privacy-agenda-board]]", "[[privacy-engineering-charter]]", "[[commercial-workforce-agreements-charter]]"]
---

# Regulatory Posture — Board

> **PROVISIONAL — no work done yet.**

## Team status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/compliance-privacy/teams/regulatory-posture"
SORT type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/corporate/compliance-privacy/teams/regulatory-posture"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Counters

- `compliance.obligation_coverage` — **0%** · verified by grep, not assumed
- `compliance.subprocessor_classification` — **0 / 50 hosts**
- `compliance.notice_accuracy` — **already failing** · `Privacy.tsx:23,31,43` say "WineOps"
- `compliance.unevidenced_clause_count` — **0** · true zero over 0 signed instruments
- `compliance.questionnaire_answerable_rate` — **0%**
- Occurrences of "GDPR"/"CCPA"/"data subject"/"right to erasure" in source — **0**
- Duties with partial evidence — **5** · duties with none — **5**

## The verified zero

- `grep -riE "gdpr|ccpa|data subject|right to erasure"` over `apps/`, `services/`, `supabase/`, `scripts/` → **zero hits**
- The one repo-wide match outside planning prose is **"CCPAE"** in `datasets/planning-exports/stage1_producer_research_raw.json` — the Catalan organic-agriculture council. A substring collision, not a statute. Recorded so a future grep reporting "1 hit" is not believed.

## Head starts (raw material that already exists)

- `Privacy.tsx:5-12` — the correct standard, pre-written by someone else: *written to match what the code actually does… if any of those change, this page has to change with them*
- `EXTERNAL_CONNECTIONS.md` — 50 hosts, 8 SDKs, 80 env vars. A subprocessor register missing only its classification column
- v0 obligation table — 10 duties, 5 partially evidenced — drafted in [[regulatory-posture-charter]] §Evidence in one session

## Blocking

- [ ] No obligation register exists
- [ ] No subprocessor register; 0 of 50 hosts classified
- [ ] No records of processing, no subject-access path, no breach-notification runbook
- [ ] No signature gate — an exhibit can be signed today with nobody checking the Annex
- [ ] Controller/processor posture is implied by a schema comment (`:99-105`) and decided nowhere
- [ ] Jurisdictions in scope for v0 undecided
- [ ] CORP-F2 open — DPA/BAA instrument vs obligation split

## Live defects (not future risk)

- [ ] `Privacy.tsx:23,31,43` — "WineOps", pre-Mudavym. A false claim on a pre-login page, today
- [ ] LLM hosts (Anthropic, Gemini) called over raw HTTP/axios — no SDK, no shared middleware; the PII guard on that path detects SSN/card and **not** names, emails or phone numbers. Correct v0 classification: *receives personal data — no control*

## Caveats that must travel with every citation

- Consent record (`:58-64`) — **schema only, 0 call sites.** Never exercised
- Erasure tombstone (`:79-82`) — **design only.** No function, no receipt table, no test
- PII guards — **3 conflicting definitions** across 4 guards

## Watchlist

- [ ] First inbound DPA / exhibit / security questionnaire (M1 — escalate on arrival, not on deadline)
- [ ] First register evidence cell containing a sentence instead of a citation (M2)
- [ ] Any host classified "no personal data" by vendor category rather than payload (M4)
- [ ] A quarter with gaps > 0 and zero written objections filed (M5)
