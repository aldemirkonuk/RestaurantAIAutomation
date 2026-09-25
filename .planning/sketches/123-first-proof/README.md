---
sketch: 123
name: first-proof
question: "Does 'the first proof' make the digitized menu feel like Mudavym's own presentation — and does the pencil admit a double-check without looking unfinished?"
winner: null
tags: [get-started, onboarding, register, google-sign-in, places, menu-upload, reveal, first-proof, ink-pencil, three-counts, adr-0169, adr-0047, adr-0213, od-134, od-135, od-136, od-137, od-138, od-139, od-141, mudavym]
---

# Sketch 123 · The first proof

**Stand-in.** Drawn by Grok (2026-09-22) because Opus 5.5 was rate-limited and the founder
wanted Opus on sketches. Treat as a working visual — pending Opus review before any ADR
or product build.

Open `index.html` (desktop 1440; folds at ≤860px). Paper is the default ground; the toggle
top-right shows charcoal. Frame 05 is interactive. Shots in `shots/`; regenerate with
`node shoot.mjs` (adds `f5-original-1440.png` and `f5-charcoal-1440.png`).

**Brief:** [`00-OPUS-VERDICT.md`](../../07-reference/deploy/research-122-squad/00-OPUS-VERDICT.md) §9.
**Provenance of the locks:** the founder approved every Opus rec in that verdict on 2026-09-22,
relayed through the parent agent — F1–F7 = A
([`FORKS-FOR-FOUNDER.md`](../../07-reference/deploy/research-122-squad/FORKS-FOR-FOUNDER.md),
OD-134…OD-139 and OD-141). Locked as A by [ADR 0213](../../decisions/0213-get-started-is-account-then-house-then-first-proof.md)
on 2026-09-22. This sketch draws the lock.

## Frames

0. **Account** — `/register` account-only: name, email, password or *Continue with Google*.
   Google is sign-in only; the page says Mudavym doesn't read the inbox (F1 A, F4 A).
1. **You** — “Welcome, Selin. Let's set up your restaurant.” Name (carried), mobile optional
   (“For urgent stock alerts. Never marketing.”), role as one optional tap, none preselected.
2. **Your restaurant** — two states: Places search with *Use my location* as a bias → confirm,
   with ₺ and time read from the address and editable. Address required (F2 A, F3 A).
3. **Your menu** — 122's drop well kept generous and centred; photo and typed lines as 121's
   ruled lines; *Skip for now — open the house* skips the menu only; the last invoice is a
   dashed “Later” hint, not a step.
4. **Reading** — 122 frame 02 carried; verbs now “set”, kitchen lines counted as set aside.
5. **The first proof** — 42-line mixed menu typeset in sections (Wine: red / white / rosé /
   sparkling · Beer · Rakı & spirits · Whiskey · Cocktails · Soft drinks). Counts
   *42 read · 25 set · 17 pencilled*. Ink lines unlabelled; 15 pencilled (*Worth a second
   look*); 2 open rings (*Needs a place*). Tap opens the line in place: source crop, reason,
   section chips with the guess dashed and never pressed. Choosing inks the line or moves it;
   counts tick. *Show my original* = split view. Footer: *Not on this menu: sake, cider.*
   Kitchen lines collapse to one counted line (F5 A, F6 A, F7 A).
6. **The house** — contents; exactly one line asks (supplier, optional); the menu line states
   “17 pencilled”; the last invoice is a greyed future inscription.
7. **Thin & failed** — 9-line chalkboard proof (8 ink, 1 pencil); an unreadable file that is
   never shown as an empty proof.

## What changed from 122

| 122 | 123 |
|---|---|
| Upload was the first screen | Account → You → Your restaurant → Your menu (house exists before the upload) |
| Reveal = register readout with `basis` sentences and chips | Reveal = the menu itself, typeset, items grouped by section |
| Customer-facing chip words for the classifier states | Ink (no label) / pencil “Worth a second look” / ring “Needs a place” — grep for those words = 0 |
| Separate frame-04 “not placed” page | Inline expansion on the proof, same rules (dashed guess, no preselect, no “all”) |
| Q2 three-way tone switch | One footer line naming the absent sections |
| Bordered tiles for counts, filled verso, icon tile in the well | Ruled-line counts (121), unfilled verso, one-button centred well — lighter frames throughout |
| Read · placed · not placed | Read · set · pencilled |
| — | New `--graphite` token; new motion token `ink` (pencil → ink); tokens are `turn / settle / ink / tally` |

Kept from 122: white ground, 56px bar with 24px A+M mark, the open drop well, reading frame,
three counts, no checkboxes, thin/failed honesty. Kept from 121: book typography, ruled lines,
exactly one ask on the house page.

## Drawn ahead of the code — not verified

- **R1** per-line pencil signal and **R4** per-line source crops do not exist in the service;
  the 17 pencils and their reasons are fixture data in the page's script.
- **R2** food lines on a mixed menu: “31 kitchen lines set aside” is a drawing, not observed
  extractor behaviour.
- **R5** SMS-consent wording is a visible placeholder on frame 01.
- Places search, *Use my location*, derived currency/time and account-only register are all
  unbuilt (F1 costs a tenant-creation change, `register-restaurant.dto.ts`).
- Checked only by headless screenshots (1440 + 390, charcoal and original-view for frame 05);
  not checked in a real browser session or against a screen reader.

## Housekeeping

- Nothing in `apps/` changed. No PR merged, no flag touched.
- Retire-to-write: if picked, 123 supersedes 122 as the get-started drawing (122 and 121 stay
  as research records). The ADR recording F1–F7 should retire
  `GET-STARTED-REDESIGN-2026-09-22.md` and 122's “Still open” section (verdict disclosures).
