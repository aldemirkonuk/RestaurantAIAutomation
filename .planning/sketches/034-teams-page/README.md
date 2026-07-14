---
sketch: 034
name: teams-page
question: "Should /teams be a dedicated page — and if so, which layout feels simple yet unmistakably premium?"
winner: null
tags: [teams, members, invites, roles, settings, layout, editorial, glass]
---

# Sketch 034: Teams Page

## UI Skill Consultant — Direction

**Light editorial + glass depth + one ray-hover moment on Invite.** No WebGL. Type and whitespace carry the page; motion stays under 400ms and interruptible.

## Design Question

Team management currently lives inside Settings → Team. As restaurants grow, owners need a **first-class `/teams` page** that feels effortless — not a dense admin table. Which structure balances **simplicity** (few decisions per screen) with **elegance** (premium B2B trust)?

## How to View

```
open .planning/sketches/034-teams-page/index.html
```

## Variants

| | Name | Philosophy | Best for |
|---|------|------------|----------|
| **A** | Editorial Roster | One column, oversized type, avatar monograms, list as the hero | Small teams (2–8), owners who want calm clarity |
| **B** | Glass Cards | 2-col card grid, CSS ray-hover spotlight, pending invites as quiet footer strip | Visual teams, slightly more personality without noise |
| **C** | Split Command | Left summary rail (count, your role, invite) + right filtered roster | Power users, 8+ members, frequent invite/revoke workflows |

## Shared capabilities (all variants)

- Branch context in header (`Nob Hill · Wine Bar`)
- Member list: name, email, role (Owner / Manager / Staff)
- Role edit (owner only), Remove / Leave
- Pending invites with code, role, expiry, Revoke
- Primary **Invite** CTA — signature ray-hover glow (CSS only in sketch)
- Empty + loading states implied by structure

## Stack (when implementing)

- **Base UI:** shadcn/ui — `Button`, `Select`, `DropdownMenu`, `Avatar`
- **Motion:** Motion Primitives `InView` + stagger on rows (≤400ms)
- **Signature moment:** Motion Primitives `Spotlight` on Invite button only
- **Color:** Wine burgundy `#CD2D5B` + warm neutrals (existing tokens)
- **Type:** Plus Jakarta Sans — display scale on page title
- **Icons:** Phosphor Regular (`Users`, `Link`, `DotsThree`)

## What to Look For

- Does A feel *too* sparse, or confidently premium?
- Does B's card grid add warmth without feeling like a marketing page?
- Does C's split rail earn its complexity for a 5-person team?
- Is Invite discoverable without shouting?
- Do pending invites feel secondary (correct) or hidden (wrong)?

## Build order (production)

1. Route `/teams` + nav item (owners/managers)
2. Extract team logic from `Settings.tsx` into shared hook
3. Pick winning variant layout
4. Micro-motion on row enter + Invite spotlight
5. Mobile: A stacks naturally; C collapses rail to top summary bar
