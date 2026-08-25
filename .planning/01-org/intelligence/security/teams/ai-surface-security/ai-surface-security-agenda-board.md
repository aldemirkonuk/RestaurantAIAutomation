---
type: agenda-board
division: intelligence
department: security
team: ai-surface-security
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[ai-surface-security-charter]]", "[[ai-surface-security-agenda-full]]", "[[ai-surface-security-loops]]", "[[ai-surface-security-premortem]]", "[[security-agenda-board]]", "[[neural-footprint-instrumentation-charter]]", "[[ENDPOINTS]]"]
---

# AI Surface Security — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/security/teams/ai-surface-security"
SORT type ASC
```

## Where this team sits in the department

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/intelligence/security"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/intelligence/security/teams/ai-surface-security"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/security/teams/ai-surface-security"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Standing counters (hand-entered until the jobs exist)

**Read the first two together.** A growing corpus at a flat detection rate is padding.

- [ ] `sec.injection_corpus_size` — **0** cases · target 20 in the first month
- [ ] `sec.corpus_detection_rate` — **undefined** (no corpus)
- [ ] `sec.autonomous_send_rate` — **unmeasured** · replies sent with no human in the path
- [ ] `sec.tenants_with_inference_budget` — **0**
- [ ] `sec.model_callsites_emitting_cost` — **0 of 7**
- [ ] `nf_a.unauthenticated_inference_spend` — **unmeasurable** ⛔ blocked on RM-3
- [ ] `sec.days_dependency_open` — **0** · starts counting the day the RM-3 ask is filed
- [ ] `sec.doc_code_divergences_open` — **1** · "never sends" vs. the auto-send path

## Blocked, with an owner and a day counter

- ⛔ **`nf_a.unauthenticated_inference_spend`** — needs cost events from the seven NestJS
  callsites. Owner: [[neural-footprint-instrumentation-charter]]. Contract:
  `intelligence.md:488`, *"Hard dependency, not a nice-to-have."* Loop: L-AIS-3, monthly,
  reports an **integer**, never prose ([[ai-surface-security-premortem]] M3).
- 🔴 **OD-20** — `fix/analytics-endpoint-auth` (`99da5eb`) unmerged. Owner: founder. Closes
  anonymous access; does **not** close denial-of-wallet.
- ⬦ **OD-11** — the NF column contract gates the above.

## The seven model callsites

| Callsite | Untrusted input | Cost event | Corpus coverage |
|---|---|---|---|
| `inbound-responder.service.ts:16` | **vendor email** | ❌ | 0 cases |
| `vendor-page-extractor.service.ts:13` | **scraped HTML** | ❌ | 0 cases |
| `document-extractor.service.ts:27` | uploaded invoices | ❌ | 0 cases |
| `scan-parser.service.ts:10` | uploaded menus | ❌ | 0 cases |
| `photo-count.service.ts:9` | uploaded photos | ❌ | 0 cases |
| `consultants.service.ts:28` | analytics evidence pack | ❌ | 0 cases |
| `ux-optimizer.service.ts:44` | app telemetry | ❌ | 0 cases |

## Severity queue

| # | Item | State |
|---|---|---|
| 1 | Docstring says "never sends"; `:509-513` schedules a send after 2 min | **open** · one-line fix, propagating error |
| 2 | No per-tenant inference budget; guard ≠ budget | **open** · needs no telemetry |
| 3 | `injection_suspected` self-reported by the model under attack, never fired at a real payload | **open** · no corpus |
| 4 | `vendor-page-extractor` puts scraped HTML in a prompt | **open** · indirect injection, no human reads the page |
| 5 | Guest data in prompts/logs unaudited — a false merge is priced as *"a DISCLOSURE"* | **open** · §12C item 10 unmeasured |
| 6 | `ask → propose → confirm → execute` allowlist specified, enforced by no test | **open** |

## The existing guardrails, credited

Not everything here is a gap. `inbound-responder.service.ts` ships six real guardrails
(`:283`, `:895-920`) — commitment language, price above target, quantity/budget change,
3+ rounds, **sender not DKIM/DMARC-verified**, and commercial-terms inconsistency — plus
injection quarantine that trust never lifts (`:95-96`). **The architecture is right. What
is missing is anyone testing it.**
