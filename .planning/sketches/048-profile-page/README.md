---
sketch: "048"
name: profile-page
question: "How should /profile feel — single form, identity hero, left-rail sections, avatar drawer, memberships overview, or editorial wild card?"
winner: "C — Left rail Account/Security/Preferences/Danger"
tags: [profile, account, security, preferences, oauth, danger-zone, layout, glass]
---

# Sketch 048: Profile Page

## Design Question

Managers need a dedicated `/profile` for identity, password, linked OAuth, theme, role/restaurant context, and destructive actions. Which composition feels premium and scannable without becoming a second Settings page?

Mock user: **Hakki Germiyanligil** · `konukp@hotmail.com` · Manager · Nob Hill Wine Bar

## How to View

```
open .planning/sketches/048-profile-page/index.html
```

Light theme only. Tabs switch variants A–F. Brand: wine burgundy `#CD2D5B`.

## Variants

| | Name | Philosophy | Purity | Effectiveness | Product |
|---|------|------------|:------:|:-------------:|:-------:|
| **A** | Single-column account form | One scroll of glass cards — account → security → linked → prefs → danger | 8 | 6 | 48 |
| **B** | Identity hero + stacked sections | Large avatar hero, then section cards below | 7 | 7 | 49 |
| **C ★** | Left rail sections | Sticky rail: Account / Security / Preferences / Danger — one panel at a time | **9** | **9** | **81** |
| **D** | Compact sheet from avatar | Mock app header; profile opens as right drawer from avatar | 8 | 7 | 56 |
| **E** | Me + memberships overview | Identity strip + multi-restaurant membership list as primary | 7 | 8 | 56 |
| **F** | Wild editorial / asymmetric | Oversized type, diagonal layout, owner upgrade as editorial CTA | 5 | 6 | 30 |

**WINNER = C** — Left rail mirrors Settings mental model, keeps danger isolated, and scales if we add Linked Accounts as a fifth rail item. Owner upgrade stub lives here (and in F) without cluttering everyday fields.

## Shared surfaces (all variants)

- Display name, email, phone
- Password change (current / new / confirm)
- Linked Google + Microsoft
- Theme control (light mock)
- Role + active restaurant
- Danger zone (leave restaurant / delete account)
- **Owner upgrade stub:** C and F only

## What to Look For

- Does A's long scroll bury danger and password, or feel calm?
- Does B's hero earn the vertical space for a B2B profile?
- Does C's rail feel like Settings 006 — or redundant with it?
- Is D's drawer good enough for "quick edit," or too shallow for password + OAuth?
- Does E correctly elevate memberships for multi-restaurant managers?
- Is F inspiring, or too noisy for trust-sensitive account work?

## SCORECARD

See [SCORECARD.md](./SCORECARD.md) for the purity × effectiveness table.
