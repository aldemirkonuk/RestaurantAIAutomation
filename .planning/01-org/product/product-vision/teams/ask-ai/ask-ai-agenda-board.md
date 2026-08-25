---
type: agenda-board
division: product
department: product-vision
team: ask-ai
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[ask-ai-charter]]", "[[ask-ai-agenda-full]]", "[[ask-ai-loops]]", "[[ask-ai-schedule]]", "[[product-vision-agenda-board]]", "[[inbound-understanding-charter]]", "[[surface-portfolio-charter]]"]
---

# Ask AI — Action Composer — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/product/product-vision/teams/ask-ai"
SORT type ASC
```

## Where this team sits among its siblings

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/product/product-vision"
WHERE type = "charter"
SORT status ASC, team ASC
```

## The shared-primitive counterpart — one confirm card, two callers

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status
FROM "01-org/product/product-vision/teams/inbound-understanding"
WHERE type = "charter" OR type = "directive"
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/product/product-vision/teams/ask-ai"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/product/product-vision/teams/ask-ai"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## The pair — never published apart

`askai.confirm_without_edit_rate` rising beside a shrinking refusal set is the product
getting more dangerous, not better ([[ask-ai-premortem]] M2).

| Metric | Reading | Note |
|---|---|---|
| `askai.confirm_without_edit_rate` | — unmeasurable | no composer, no confirms |
| `askai.refusal_correctness` | — unmeasurable | no refusal test set, no refusal logging |

## Standing counters (hand-entered until the jobs exist)

- [ ] `askai.entry_point_count` — **4**, target **1**: Reports pill
      (`AICommandPalette.tsx:191`), Wine Agent FAB (`WineAgentFab.tsx`), `/sommelier`
      (`SommelierAI.tsx`), placeholder routes `/wine-agent` + `/wineagent`
      (`App.tsx:293-294`)
- [ ] Adjacent deterministic palette to unify **with**, not absorb —
      `apps/web/src/components/command/` (§A command palette, shipped)
- [ ] Server module for the composer — **0 of 44** api-gateway modules; [[ENDPOINTS]] lists
      no ask route
- [ ] Typed allowlist file — **does not exist**
- [ ] `askai.allowlist_family_count` — **0**. Reported as a *stability* metric; growth is
      the signal to investigate, not the milestone
- [ ] Refusal test set (`NEW-906`) — **does not exist**
- [ ] Refusals logged as NF-A events — **not specified**; treating them as absences makes
      the hard gate permanently unmeasurable
- [ ] Confirm-card contract (`NEW-899`, `NEW-907`, `NEW-901`) — **not written**; one
      primitive exists to build on (`apps/api-gateway/src/one-tap-actions/`)
- [ ] Audit trail (`NEW-902`) — **not built**; specified as ships-**with**, not ships-after
- [ ] Intent logging (what people actually ask for) — **not running**
- [ ] Demand reality — `recommendation_actions` = **0 rows**; nobody has ever acted on a
      recommendation ([[AGENT_NATIVE_UI_DECISION]] §2). The §8.2 action families are
      plausible and unvalidated
- [ ] UX paths specified vs shipped — **25 specified** (`NEW-886…NEW-910`), **0 shipped**;
      ROADMAP 999.5 has **0 plans**
- [ ] Settled-decision integrity — [[AGENT_NATIVE_UI_DECISION]] §3 *don't build* verdict:
      **intact**. Any chat-surface drift is an ADR question, not a sprint
