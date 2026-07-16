---
sketch: 037
name: team-command
question: "Can 70 team features collapse into one calm command surface via time-based tabs (Tonight / Schedule / People) + one alert queue?"
winner: null
tags: [team, tonight, command, alerts-queue, fairness, read-receipts, call-in, shifts, restaurant-ops, ui-skill-consultant]
---

# Sketch 037: Team Command Surface

## Design Read

**Reading this as:** operational command center for restaurant managers, evolved from 036. The insight: managers think in time horizons (tonight → this week → people), not in feature categories. Structure follows the 4pm scramble.

## UX Architecture (vs 036)

| 036 (one wall) | 037 (three horizons) |
|----------------|----------------------|
| Roster strip on top | **Tonight strip** is the hero: on-duty, late, call-ins, coverage now |
| Grid always visible | Grid lives in **Schedule tab** with lens toggles (coverage / labor / fairness) |
| Two request panels | One prioritized **Needs attention** queue, approve/deny inline |
| Static publish button | Publish flow: **read receipts** ("3 of 5 seen") + auto-reminders |
| Person cards show tags | **People tab** owns profiles, certs, onboarding, milestones |

## New scenario features shown

- Call-in replacement: Sofia sick → "Text 3 available servers" one-tap
- Running-late status live on tonight board
- Read receipts under Publish
- Fairness lens: "Sofia closed 4 Saturdays straight" warning
- Handover note from AM shift
- Event template applied to Friday (auto +1 somm, +2 servers)
- Borrow across branches (Marina pulls a bartender)
- Needs-attention queue mixing swap, PTO conflict, cert expiry, OT, fairness

## How to View

```
open .planning/sketches/037-team-command/index.html
```

Click the three tabs. Hover Invite for the ray. All motion transform/opacity only, reduced-motion safe.

## Consultant guardrails check

- One accent (wine), one icon feel, glass chrome only on app bar
- Signature moment unchanged (ray-hover); tabs animate ≤300ms
- Grid density high, everything around it calm
- No new fonts, no gradients beyond glass highlight
