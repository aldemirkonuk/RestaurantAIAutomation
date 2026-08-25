---
sketch: 035
name: teams-parallax
question: "Can /teams stay simple and elegant while adding depth via parallax + Apple liquid-glass + taste-skill restraint?"
winner: null
tags: [teams, parallax, apple-hig, liquid-glass, taste-skill, depth, motion, ui-skill-consultant]
---

# Sketch 035: Teams Page (Parallax + Apple + Taste)

## Design Read

**Reading this as:** B2B restaurant SaaS app page for owners/managers, with a **Linear-meets-Apple** language, leaning toward editorial list + one parallax depth moment (not a marketing landing).

## Dials (taste-skill)

| Dial | Value | Why |
|------|-------|-----|
| DESIGN_VARIANCE | 5 | Symmetric app layout; parallax is the only asymmetry |
| MOTION_INTENSITY | 5 | Parallax + spring hovers; no scroll-hijack |
| VISUAL_DENSITY | 3 | Gallery spacing; list over cards |

## Direction

**Apple clarity + liquid-glass chrome + one 3D parallax grid layer behind a quiet editorial roster.** Parallax communicates depth, not decoration. Member list stays static-readable (deference to content).

## Apple HIG applied

- **Clarity:** One primary action (Invite), roles readable at a glance
- **Deference:** Parallax lives in the background layer; text never moves with it
- **Depth:** Z-layers: parallax grid → glass chrome → member list
- **Fluid motion:** Spring easing, interruptible hover, `prefers-reduced-motion` static fallback
- **Liquid Glass (web approx):** App bar + invite pill with inner highlight border

## Variants

| | Name | Parallax mechanism |
|---|------|-------------------|
| **A** | Orb Drift | Scroll-linked background orbs (slow layer) |
| **B** | Grid Depth | Mouse + scroll 3D perspective grid (signature) |
| **C** | Split Velocity | Left summary rail scrolls at 0.85x vs roster |

## How to View

```
open .planning/sketches/035-teams-parallax/index.html
```

Move mouse inside each mock. Scroll inside variant B/C panes. Toggle **Reduce motion** to verify static fallback.

## Production stack

- shadcn/ui list + `InviteTeamDialog`
- Motion `useScroll` + `useTransform` for parallax (never `useState` on scroll)
- Liquid glass via taste-skill Appendix C CSS class
- Phosphor icons, wine accent locked

## Recommendation

**Variant B (Grid Depth)** for wow with restraint if perf budget allows lazy-loaded canvas/CSS grid. **Variant A** for safest ship on mobile. **Variant C** if team size grows past 8.

## Build order

1. Extract team hook from Settings
2. `/team` route (already placeholder in App.tsx)
3. Glass app bar + editorial list (sketch 034 A body)
4. Parallax layer lazy + reduced-motion gate
5. Invite Spotlight (Motion Primitives)
