---
sketch: 038
name: manager-shift-desk
question: "Can sketch 036 keep its Excel-style schedule while giving managers immediate access to day-of problems, approvals, labor risks, and shift details?"
winner: null
tags: [team, schedule, manager-desk, shift-inspector, call-outs, labor, breaks, events, coverage, restaurant-ops, ui-skill-consultant]
---

# Sketch 038: Manager Shift Desk

## Design Read

Operational restaurant scheduling for a manager checking the week before lineup. It should feel like a well-run host stand: compact, calm, legible, and ready for interruptions.

## Domain Exploration

- **Domain:** pre-service lineup, floor sections, call-out chain, cover count, cut list, sidework, station rotation, open/close keys, event staffing, shift handover
- **Color world:** wine-label burgundy, stainless-steel gray, white linen, service-ticket amber, food-safe green, carbon ink
- **Signature:** **Service Pulse**, a restaurant-specific strip above the schedule showing covers, staffing, weather-sensitive patio risk, event load, and unresolved manager actions
- **Defaults rejected:**
  - Generic KPI cards → one actionable Service Pulse strip
  - Detached notification center → persistent, time-prioritized Manager Desk
  - Generic spreadsheet cells → restaurant states: floor, bar, MOD, training, borrowed, open, call-out, break risk

## Interface Checkpoint

- **Intent:** help a manager repair tonight and safely publish the week without leaving the schedule
- **Palette:** warm-neutral service surfaces with WineOps burgundy as the only brand accent; semantic colors appear only for real status
- **Depth:** borders and quiet surface shifts; glass is limited to the app header
- **Surfaces:** canvas → schedule sheet → manager desk → shift inspector
- **Typography:** Plus Jakarta Sans; tabular numerals in hours, costs, and shift times
- **Spacing:** 4px base unit

## Improvements over Sketch 036

1. **Service Pulse:** tonight's covers, staffing, patio/weather risk, labor, and approvals are visible before the grid.
2. **Manager Desk:** a persistent right rail groups work by urgency:
   - Now: call-out and break coverage
   - Before publish: overtime, role gaps, unread schedules
   - People: certification expiry, training, time off
3. **Quick actions:** Add shift, Report call-out, Find cover, Broadcast, Add note, Print.
4. **Shift Inspector:** click a shift to inspect station, break, notes, location, contact, and actions without leaving the schedule.
5. **Schedule lenses:** Coverage, Labor, Fairness, and Compliance reuse the same grid instead of adding dashboards.
6. **Restaurant-aware cells:** call-out, open shift, borrowed employee, trial/training shift, double, closing rotation, and break-risk states.
7. **Day context:** reservation covers, private events, patio risk, delivery, and menu/wine notes are attached to each day.
8. **Publish readiness:** one checklist summarizes remaining blockers and schedule read receipts.

## Real-life Manager Scenarios Included

- Server calls out 90 minutes before dinner; manager offers the shift to three available people
- Friday private event requires two extra servers and one sommelier
- Bartender crosses 40 hours if Saturday is unchanged
- Minor employee cannot work beyond the legal cutoff
- Six-hour shift is missing a required break
- Two staff have not opened the republished schedule
- Alcohol service certification expires before next weekend
- New hire needs a shadow/training assignment
- Staff member is borrowed from another location; travel time is checked
- Patio staffing may be cut if rain arrives
- Closing rotation is unfair across four Saturdays
- Approved PTO conflicts with an event template
- Manager adds a pre-shift lineup note and AM-to-PM handover

## How to View

```bash
open .planning/sketches/038-manager-shift-desk/index.html
```

Click schedule cells to update the Shift Inspector. Switch schedule lenses and Manager Desk filters.

## Production Direction

- Preserve the existing `/team` member/invite APIs.
- Model schedules, availability, requests, and certifications separately.
- Implement the schedule as semantic CSS Grid with sticky member/day headers.
- Use Motion only for inspector and queue transitions.
- Keep the right rail sticky on desktop; collapse it into a bottom sheet below 960px.
