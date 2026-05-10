---
sketch: "003"
name: restaurant-details-form
question: "How do we make the dense 10-field restaurant form feel manageable, not overwhelming?"
winner: "C — Left-Rail Progress"
tags: [onboarding, registration, form, restaurant-setup, progressive-disclosure]
---

# Sketch 003: Restaurant Details Form

## Design Question
Path B Step 2 has 10 fields (name, country, address, city, state, ZIP, neighborhood, phone, cuisine). How do we structure it so users feel progress rather than burden?

## How to View
```
open .planning/sketches/003-restaurant-details-form/index.html
```

## Variants
- **A: Section Groups** — Fields grouped into 3 labeled sections (Identity, Location, Contact) with icon headers and dividers. All fields visible at once, reduced by chunking. The "can see the whole form" approach.
- **B: Progressive Reveal** — Fields unlock sequentially: Name first, then Country, then Address autocomplete, then City/State, then optional fields. Animated reveal, progress bar. Fewer fields visible at once. Click "Fill demo data" to see it in action.
- **C: Left-Rail Progress** — Stripe Atlas / Linear-style sidebar with section nav. Each section is its own focused panel. Click sections in the rail or use Next/Back buttons to navigate. Feels premium for a multi-field form.

## What to Look For
- Which variant feels least like a chore to complete?
- Variant A: Can users see the full form and feel comfortable?
- Variant B: Does progressive reveal feel helpful or gimmicky?
- Variant C: Does the left rail add clarity or complexity for a 10-field form?
- Which step indicator (step bar vs. progress bar vs. rail) best communicates progress?
- Which approach works best on mobile viewport? (Use the 📱 button in toolbar)
