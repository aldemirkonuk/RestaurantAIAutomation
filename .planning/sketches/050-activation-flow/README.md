# Sketch 050 · Activation Flow (Owner/Manager Get Started)

**Design question:** Menu import has never worked in production (0 rows in `restaurant_menus`/`menu_items`). Once the pipeline is fixed, what should the owner/manager activation flow feel like — a terse ops checklist, a guided day-in-the-life narrative, or a hybrid? And how does a manager review/correct AI-extracted wines without feeling like they're doing data entry twice?

**Context:** Replacing the two-tab Activate/Use shell in `apps/web/src/pages/GetStarted.tsx`. Menu upload becomes a soft gate (dashboard reachable, empty-state + banner nudges instead of a wall). Activated = menu uploaded + default threshold set.

## Direction

| | |
|--|--|
| **Domain** | Menu import (scan/CSV/manual), review & confirm, threshold, vendor email, Google link, calendar subscribe, POS, team invite |
| **Color world** | Wine burgundy `#722F37` (matches shipped guidance components, not the `#CD2D5B` sketch-theme default) |
| **Signature** | Stepped flow with a left-rail progress list; every step after Upload is explicitly skippable |
| **Rejects** | Hard-gating the dashboard; forcing all 8 steps before first value; auto-import with zero human review; fake "Connect Google Calendar" OAuth that only flips a preference flag |

## Step sequence (all variants share this skeleton)

```
1. Upload your wine list         [scan / CSV+Excel / manual]      — soft-required
2. Review & confirm               [edit rows, flag for review]     — soft-required
3. Set your low-stock threshold   [one number, "tune per wine later"] — soft-required
4. Get your vendor email address  [copy restaurant_inbound_addresses] — skip
5. Link Google account           [existing Sign-In OAuth]          — skip
6. Subscribe to your calendar     [copy iCal feed URL + how-to]      — skip
7. Connect your POS              [PosSettingsSection registry]      — skip
8. Invite your team              [copy-link primary, email chips]   — skip
```

Steps 4-8 render as a single "Optional — finish anytime from Settings" section below the fold once 1-3 are done, not as forced full-screen steps. This is the resolution across all three variants: the *required* spine is short (3 steps), the *optional* tail is long (5 steps) and never blocks.

## Variant A — Minimal ops checklist

```
┌─ Get started ────────────────────────────────┐
│  ●━━○━━○   Step 2 of 3: Review & confirm     │
│                                               │
│  12 wines found. Fix anything that's wrong.  │
│  ┌───────────────────────────────────────┐   │
│  │ Name          Vintage  Region   [✓/✎] │   │
│  │ Opus One      2019     Napa     ✓      │   │
│  │ Chateau ???   —        —        ✎ flag │   │
│  └───────────────────────────────────────┘   │
│  [+ Add a wine]        [Looks good →]        │
└───────────────────────────────────────────────┘
```
Terse labels, no marketing copy, table-first. Reads like a spreadsheet import wizard (Toast/Stripe CSV importer tone). Fastest for owners who just want it done.

## Variant B — Guided day-in-the-life

```
┌─ Get started ────────────────────────────────┐
│  "Let's get your wine list into WineOps —    │
│   this is what makes tonight's 86'd-item     │
│   alerts and reorder suggestions accurate."  │
│                                               │
│  [ 📷 screenshot: manager scanning a menu ]  │
│                                               │
│  Step 2 of 3 · Review & confirm              │
│  "We found 12 wines. Quickly check the ones  │
│   we weren't sure about — everything else    │
│   is already correct."                       │
│  [ card per wine, confidence badge, edit ]   │
└───────────────────────────────────────────────┘
```
Narrative copy per step, contextual screenshots/illustrations, explains *why* each step matters before asking for input. Slower but reduces skip-without-understanding.

## Variant C — Hybrid ★ (recommended)

```
┌─ Get started ────────────────────────────────┐
│  Step 2 of 3 · Review & confirm               │
│  One-line "why" + terse table, not a table    │
│  buried under paragraphs:                     │
│                                                │
│  "Quick check — we flagged 2 of 12 for you."  │
│  ┌────────────────────────────────────────┐   │
│  │ ⚠ Chateau ???   vintage unclear   [Fix] │   │
│  │ ⚠ Duckhorn Red  price unclear     [Fix] │   │
│  │ ✓ 10 more look good                     │   │
│  └────────────────────────────────────────┘   │
│  [Looks good, continue →]  [Skip review]      │
└────────────────────────────────────────────────┘
```
One sentence of "why" per step (Variant B's trust-building) + Variant A's terse, scannable list, and only surfaces rows that need attention rather than showing all 12 by default ("10 more look good" collapses the noise). This is the winner: it keeps the required spine at ≤3 steps and ≤10 seconds of reading per step, while still explaining stakes once.

## Review & confirm screen (shared across variants)

- Manager can: inline-edit any cell, re-shoot a photo for one row, add a missing row manually.
- Any manager edit writes an `override_events` row (`promotion_status: 'pending'`) and flags the `menu_items` row (`status: 'flagged'`) — same provenance trail as `/studio`, so corrections are auditable and reviewable without blocking the manager's own inventory.
- "Looks good, continue" is available immediately — review is optional friction, not a wall.

## Optional tail — Google + Calendar (honest state)

```
┌─ Optional — finish anytime from Settings ────┐
│  ✓ Vendor email copied                        │
│  ○ Link Google account        [Link]          │
│  ○ Subscribe to your calendar [Get link]       │
│      → Feed URL + "Add to Google Calendar /   │
│         Apple / Outlook" — same pattern as     │
│         Settings → Calendar today.             │
│  ○ Connect your POS           [Browse →]       │
│  ○ Invite your team           [Copy link]      │
└─────────────────────────────────────────────────┘
```
Google Sign-In link and iCal subscribe both reuse existing, working backend paths (`/auth/oauth/google`, `/calendar/ical-token`). No new "Connect Google Calendar" OAuth button is invented — that capability (two-way sync, `calendar.events` scopes) does not exist and is out of scope.

## Kill / success gates

**Kill if:** menu upload blocks reaching the dashboard; review screen shows all rows with equal weight (no triage); Google/calendar steps promise bidirectional sync; any optional step is not immediately visible as skippable.
**Ship if:** owner reaches a working inventory within 3 steps; flagged rows are visually distinct from clean ones; skipping steps 4-8 has zero UI penalty (no red badges, no blocking modals) but the sidebar checklist still tracks them for later.

**Winner: C — Hybrid.**
