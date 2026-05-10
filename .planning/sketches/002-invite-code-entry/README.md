---
sketch: "002"
name: invite-code-entry
question: "How should the 8-char invite code input feel intentional and trustworthy?"
winner: "C — Clean Input + Trust Card"
tags: [onboarding, registration, invite-code, trust, validation]
---

# Sketch 002: Invite Code Entry

## Design Question
The current implementation has a plain text input. How do we make entering the invite code feel intentional, secure, and trustworthy — while making the validation feedback feel like a verified identity card?

## How to View
```
open .planning/sketches/002-invite-code-entry/index.html
```

## Variants
- **A: OTP Boxes** — 8 individual character boxes (4+4 with separator dot), auto-advances focus. Familiar from SMS/MFA flows. Validation badge appears below.
- **B: Terminal Slot Field** — Single dark monospace input field (terminal-aesthetic), dot progress indicator below shows 8 slots filling in. Unique, intentional, slightly playful.
- **C: Clean Input + Trust Card** — Standard large monospace input, auto-validates on 8 chars, then an animated trust card slides in showing restaurant name, city, inviter, role, expiry. Most information-rich feedback.

## What to Look For
- Click "Simulate valid code" on each variant to see the validation feedback
- Click "Simulate invalid" to see the error state
- Which input style makes entering a code feel deliberate rather than accidental?
- Which trust badge communicates "you're about to join a real restaurant" most convincingly?
- Which variant has the best balance of feedback richness vs. visual complexity?
