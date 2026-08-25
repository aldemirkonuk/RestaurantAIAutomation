---
type: agenda-board
division: commercial
department: media-brand
team: brand-identity
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[brand-identity-charter]]"
  - "[[brand-identity-agenda-full]]"
  - "[[media-brand-agenda-board]]"
---

# Brand Identity (M1) — Board

> **PROVISIONAL — no work done yet.**

## This team's documents

```dataview
TABLE type, status, updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## Where this team sits in the department

```dataview
TABLE WITHOUT ID team AS "Team", status AS "Grade", updated AS "Updated"
FROM "01-org"
WHERE department = this.department AND type = "charter" AND team
SORT status ASC, team ASC
```

## Stale check

```dataview
TABLE type, updated
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## The burndown

Baseline verified 2026-08-24. Both numbers, always.

- [ ] `name` pattern: **351 lines / 193 files** → 0 in tier 1
- [ ] `domain` pattern: **33 lines / 25 files** → 0 in tier 1

### Tier 1 by surface class

- [ ] 2a transmitted mail — `gmail.service.ts:78,599` · `template-config.ts:35,36` · `vendor-action.template.ts:31,207` · `low-stock-digest.template.ts:104` · `auth.service.ts:710,735,757,1603`
- [ ] 2b transmitted documents — `calendar.service.ts:1201,1204,1221,1224,1248,1251`
- [ ] 2c third-party logs — `vendor-page-extractor.service.ts:17`
- [ ] 2d published metadata — `main.ts:127,128,130`
- [ ] 2e rendered UI — `index.html:7,8,15` · `manifest.json:2,3,4` · `Sidebar.tsx:469,484` · `DashboardLayout.tsx:77` · `Login.tsx:70` · `Register.tsx:1307,1328` · `AuthShell.tsx:64` · `Privacy.tsx:23,31,43` · `GetStarted.tsx:63,279,324,418` · `Help.tsx:18` · `Profile.tsx:445`
- [ ] 2f OS-level — `app.json:3,20` · `lock.tsx:31,54` · `push.ts:32` · `sw.js:67` · `login.tsx:59` · `settings.tsx:197` · `get-started.tsx:152` · `notifications.service.ts:66` · `push_notification_service.py:225`
- [ ] agent-sent — `notification_agent.py:1623` · `email_composer_service.py:652` · `provider_conversation_agent.py:2604`

### Guards and follow-through

- [ ] `brand-surface-scan` committed **before** any string edit
- [ ] `brand-guard-ci` in `.github/workflows/ci.yml`, same PR as the cleanup
- [ ] Guard verified against a deliberate regression
- [ ] `openapi.json` and `dist/` regenerated, not hand-edited

### Tier 2 (bulk, low risk)

- [ ] Analytics engine and insight file headers
- [ ] Test fixtures, demo scripts, seed SQL, label-studio harness, `env.example:31`
- [ ] `scripts/render_system_atlas.py:109` — add the second pattern

### Not ours

- [ ] Tier 3 handed to Engineering with the Expo-slug hazard note — **CM-F5**
- [ ] `SKILLS.md` wording supplied to whoever owns [OD-14](../../../../../decisions/OPEN-DECISIONS.md)

### Definition work

- [ ] Voice guide — scope stated, clauses citable by G3
- [ ] Reference shortlist verified: 12 named, 5 spellings unconfirmed, 2 with no URL

## Blocked on the founder

- [ ] CM-F5 scope decision
- [ ] Mobile install identity in or out
- [ ] Replacement mailboxes must exist before the address strings change
- [ ] Does `/bot` need to resolve under the new name?
- [ ] Is `WineOpsBot` renamed with the company?
