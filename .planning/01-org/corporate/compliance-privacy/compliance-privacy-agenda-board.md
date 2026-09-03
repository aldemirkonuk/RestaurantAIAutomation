---
type: agenda-board
division: corporate
department: compliance-privacy
status: active
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, privacy.store_inventory_coverage, compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, nf_b.research_store_erasability, regops.trigger_check_freshness]
updated: 2026-08-28
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-agenda-full]]", "[[compliance-privacy-premortem]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-schedule]]", "[[compliance-privacy-agent-stack]]", "[[compliance-privacy-questions]]", "[[privacy-engineering-agenda-board]]", "[[regulatory-posture-agenda-board]]", "[[regulated-operations-agenda-board]]", "[[customer-relationship-research-charter]]", "[[reliability-sre-charter]]", "[[0037-nfb-erasure-is-crypto-shredding]]", "[[0039-activation-plan-of-record]]"]
---

# Compliance & Privacy — Board

**Active since 2026-08-28.** Tasks, doneability and evidence live in
[[compliance-privacy-agenda-full]]; this page is the rollup and the live queries.
Metrics are shown **as a set, never averaged** — one strong team, one verified zero
and one gated stub average into a number that hides all three
([[compliance-privacy-agent-stack]] §2, `cp-orchestrator` quality bar).

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

## Agenda commitments, by close_time

The dates are commitments, not estimates. The 09-11 row is another department's
dependency.

| close_time | Task | § | Owner | Grade |
|---|---|---|---|---|
| 2026-09-04 | Re-measure the PII citation census (all four drifted) | B1 | privacy-engineering | committed |
| 2026-09-04 | Is `guest_identifier_pepper` provisioned in the vault at all? | E2 | privacy-engineering | committed |
| **2026-09-11** | **Consent-gate SPEC v1 — Media & Brand is scheduling against this** | **A1** | privacy-engineering | committed |
| 2026-09-11 | Sentry classified as a 4th PII definition + a personal-data subprocessor | B2 | privacy-engineering | committed |
| 2026-09-11 | `Privacy.tsx` omits the error-tracking flow; brand still "WineOps" | C3 | regulatory-posture | committed |
| 2026-09-18 | Customer-approval register — record design (proposed, not applied) | A2 | privacy-engineering | committed |
| 2026-09-18 | Store inventory from the corpus walk that already runs in CI | E1 | privacy-engineering | committed |
| 2026-09-25 | Single `pii` module + `check_single_pii_definition.sh` | B3 | privacy-engineering | committed |
| 2026-09-30 | Obligation register v1 — 10 duties → control or named gap | C1 | regulatory-posture | committed |
| 2026-09-30 | First-ever regulated-operations trigger check | F1 | dept (`cp-orchestrator`) | committed |
| 2026-10-02 | Gate denials become countable with a reason code | A3 | privacy-engineering | committed |
| 2026-10-02 | Crypto-shredding keys must be **stored, not derived** (design note) | D1 | privacy-engineering | committed |
| 2026-10-02 | `log_safety.py` redacts nothing — fix it or register the gap | B4 | privacy-engineering | reach |
| 2026-10-09 | 50/50 subprocessor classification, `unknown` = FAIL | C2 | regulatory-posture | committed |
| 2026-10-09 | One receipt schema for both a tombstone and a shred | D4 | privacy-engineering | committed |
| 2026-10-16 | Notice-accuracy as a per-PR check, not a comment (answers DO-7) | C4 | regulatory-posture | reach |
| 2026-10-16 | Shred-survives-restore drill, designed jointly with SRE | D2 | privacy-engineering + SRE | reach |
| 2026-10-23 | Name the NF-B training paths while there are zero | D3 | privacy-engineering | aspiration |
| 2026-10-30 | First end-to-end erasure drill | E3 | privacy-engineering | reach |

## Counters

Values verified 2026-08-28 against `HEAD`, not transcribed.

- `privacy.pii_definition_count` — **4 distinct across 5 guards** · was recorded as 3/4; Sentry is the fourth (agenda §B2) · target **1**
- `privacy.consent_call_sites` — **0** · re-verified; zero hits in `apps/` and `services/`
- `privacy.erasure_completeness` — **0%** · no producer; denominator lands 2026-09-18 (§E1)
- `privacy.store_inventory_coverage` — **no value** · publisher exists in CI and is unread (§E1)
- `privacy.consent_gate_denials` — undefined · no gate; SPEC 2026-09-11
- `compliance.obligation_coverage` — **0%** · `grep -riE "gdpr|ccpa|data subject|right to erasure"` still returns 0
- `compliance.subprocessor_classification` — **0 / 50 hosts** · one host now provably personal-data-receiving
- `compliance.notice_accuracy` — **1 omitted flow + 3 stale brand strings**, measured (was "unverified")
- `nf_b.research_store_erasability` — **decided 2026-08-28** · [[0037-nfb-erasure-is-crypto-shredding]], crypto-shredding, LOCKED
- `regops.trigger_check_freshness` — **never checked** · first check 2026-09-30
- unit docs : running controls — **28 : 2**

## Blocking

- [ ] Consent schema has **zero call sites** — the caller is Product's to write (§Questions 1)
- [ ] No erasure function, no receipt table — `erasure_receipt_id` (`:82`) references nothing
- [ ] 4 PII definitions across 5 guards; two are byte-identical copies with no shared import
- [ ] `AuthContext.tsx:208-218` ships user email to Sentry; no instrument covers it
- [ ] `Privacy.tsx` documents five data flows and omits error tracking entirely
- [ ] No policy, no DPA, no BAA, no subprocessor register anywhere in the repo
- [ ] Consent gate not built — [[customer-relationship-research-charter]] is blocked on **2026-09-11**
- [ ] CORP-F2 open — DPA/BAA instrument vs obligation split
- [ ] CORP-F4 open — is [[regulated-operations-charter]] Corporate's at all?
- [ ] Ethics scope sits in the line → this department reviews itself (premortem M5)

## Closed since 2026-08-24

- [x] **NF-B erasability had no dated decision** → [[0037-nfb-erasure-is-crypto-shredding]], locked 2026-08-28. Retires **RT-2** in [[compliance-privacy-questions]] (that file is outside this wave's write scope — recorded here for whoever batches it).
- [x] **The `nfb-research-store-erasability` loop had no owner** → assigned to privacy-engineering, [[0035-wave2-seam-reconciliation]].

## Not blocking, but wrong

- [ ] Every PII citation in this department's own docs drifted within four days (§B1)
- [ ] `Privacy.tsx` says "WineOps" at `:23`, `:31`, `:43` — pre-Mudavym brand
- [ ] `foundation/teams/commercial.md:578` **and `:613`** cite "Ethics & Responsible AI" — **not adopted** ([[ORG_STRUCTURE]] §3, struck row). Two occurrences, not one; still uncorrected.
- [ ] `log_safety.py` is named for a guarantee it does not provide (§B4)

## Teams

- [[privacy-engineering-charter]] — `exists` — carries 11 of the 19 agenda rows · **strongest evidence in the division**
- [[regulatory-posture-charter]] — `new` — 4 rows · **0% coverage, re-verified 2026-08-28**
- [[regulated-operations-charter]] — `new`, ⏸ **GATED** — 1 row, and that row is the whole point of gating

## Watch — the gated trigger

- [ ] First customer in a jurisdiction where we hold or touch a licence
- [ ] First time excise reporting appears in a signed MSA
- Checked: **never** · First check scheduled **2026-09-30** (agenda §F1) · Owner: `cp-orchestrator`
- `services/agent-orchestrator/agents/compliance_agent.py` — `IS_STUB = True`; the orchestrator refuses to start it
