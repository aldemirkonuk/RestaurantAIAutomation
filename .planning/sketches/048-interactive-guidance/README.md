# Sketch 048 · Interactive Guidance System

**Design question:** How do we teach WineOps without blocking busy restaurant managers, while keeping consent, teaching, and Wine Agent entry strictly separate?

**Context:** Layered FTUX — activation checklist + `/get-started` Activate/Use, first-visit tip strips, opt-in spotlights, Settings Services & permissions, small Wine Agent FAB (nav only).

## Direction

Ops coaching that is skippable, recoverable via Learn, and never confused with privacy consent.

| | |
|--|--|
| **Domain** | Activation jobs, page tours, service grants, agent entry |
| **Color world** | Wine burgundy `#722F37`, chalk white, soft gray tips |
| **Signature** | Tip strip + opt-in spotlight; FAB is secondary nav only |
| **Rejects** | Auto multi-step tours on open; consent inside tips; Agent-as-teacher; pulsing FAB |

## Hard separation

Consent ≠ Teaching ≠ Agent entry. Never combine OAuth, coach marks, and Agent marketing on one primary view.

## Sketch order (produce before build)

1. Learn hub + sidebar Get Started
2. `/get-started` Activate + Use
3. Tip strip + opt-in spotlight (inventory)
4. Settings → Services & permissions (alone)
5. Agent entry trio (sidebar / guide card / FAB)
6. FAB conflict map (tip + toast + modal + FAB)
7. Dismissed / power-user states

---

### A — Sidebar spine

```
┌─────────────────────────┐
│ WineOps AI              │
│ Inventory Intelligence  │
├─────────────────────────┤
│ ★ Get started  2/4  →   │  ← while activation incomplete
│ Dashboard               │
│ Inventory               │
│ ...                     │
│ Wine Agent              │
├─────────────────────────┤
│ Learn & Help            │  ← after activation
│ Settings                │
└─────────────────────────┘
```

### B — Get started Activate + Use

```
┌─ Get started ──────────────────────────────┐
│  [ Activate ]  [ Use the app ]             │
│  Use cards → Inventory / Orders / Vendors  │
│  Wine Agent → /wineagent                   │
│  Services → /settings?tab=services         │
└────────────────────────────────────────────┘
```

### C — Tip strip + spotlight

Non-blocking strip under page title: purpose + Take tour / Later / Never.  
Spotlights only on Take tour; ≤4 steps; Esc/Skip always.

### D — Services & permissions

Settings tab only. Grant/revoke/status for email, web, privacy.  
Copy: “Wine Agent does not grant email access.” Zero coaching chrome.

### E — Wine Agent FAB

~48px circle, bottom-right, after activation.  
Accessible name: “Wine Agent — inventory & ordering help”.  
Navigate only to `/wineagent`. No pulse. Below modals; offset from toasts.

### F — Conflict map

Priority: modal > tip strip > toast > FAB.  
When tip visible, FAB offsets up (~72px). Mobile: safe-area inset.

### G — Power-user dismissed

Zero tip chrome. Help (?) → Replay tour. Learn recovers tips. FAB hideable via Learn.

## Kill / success gates

**Kill if:** auto multi-step on open; privacy+tutorial same view; unhideable FAB; get-started still import-only.  
**Ship if:** find Get Started &lt;5s; name two post-import jobs; know Services is optional; FAB = navigate only.
