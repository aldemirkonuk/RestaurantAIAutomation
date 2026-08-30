# 0045 — The mark is the Rivet M; the rebuild goes to full go

- **Status:** Locked — mark identity, pairing, full-go, claims, **and the adjusted mark hexes** (landed `d4ba2f19` on `feat/mudavym-brand`, see §2)
- **Date:** 2026-08-30
- **Decider:** Aldemir (founder), 2026-08-30 — three AskUserQuestion rounds in session -7f, answers recorded verbatim below
- **Keywords:** logo, Rivet M, brass, paprika, OD-111, full go, merge, page claims, motion map, audit agents, Fraunces
- **Links:** [[0042-iznik-seal-and-warm-charcoal]] (UI palette, untouched), [[0043-wordmark-interim-logo-search]] (superseded on mark + pairing; its criteria survive), ADR 0044 on `feat/mudavym-design-p1` (merge hold lifted here), `0046-withdrawn-marks-and-mark-colour-risk.md` (session -32, measurements), `06-pages/MAKEOVER-VERDICTS.md`

## Context

ADR 0043 left the final mark open as OD-111: seventeen candidates on the logo-search
canvas (<https://claude.ai/code/artifact/a2dc2d0b-2af5-43b0-a77d-003256b2b62c>),
awaiting a founder elimination. Separately, a parallel design session had drawn a
single-mark review sheet — the **"Mudavym Mark" canvas**
(<https://claude.ai/code/artifact/3474d81f-30d8-4167-a4bd-0b28889fe2c6>, draft 01,
2026-08-29): an M of two strokes meeting at one rivet, with lockups, app-icon tile,
16px minimums and clearspace rules already specced on the sheet. ADR 0044 held all
merges on the founder's "push what exists, merge nothing."

On 2026-08-30 the founder opened session -7f with: work with the other sessions, use
the logo from the Mudavym Mark canvas, analyze the new canvases, and start the
codebase rebuild — documenting everything, no shortcuts, asking at every fork.

## Decision — the founder's answers, verbatim where short

### 1. The mark (resolves OD-111)

*"rank all of them just because i want to for our goal, but we're going to use
option 1 Rivet M."*

**The Rivet M is the Mudavym mark.** Geometry from the canvas, taken verbatim:
M-path `M22,76 L22,24 L50,54 L78,24 L78,76` (stroke 13, round caps/joins), rivet
circle at (50,54) r9 with a 2.5 ink ring; mono cut replaces the rivet with a washer
(evenodd double-circle) for etched/16px contexts. The concept line stands with it:
*two strokes meet at one rivet — the fixed point the system keeps watch over.*

**The ranking still happens.** All 17 logo-search candidates get ranked against the
five OD-111 criteria (16px counters · no asymmetric cutouts · uniform weight · reads
M first · no lookalike liability) — ordered *"just because i want to for our goal."*
Deliverable owned by session -7f; the 082 rendered marks + `ledger-scene.png` join as
the comparison set, labelled as documenting the runner-ups. The ranking must also
check the Rivet M itself against dev-adjacent lookalikes (the VS Code failure mode
that killed the previous mark).

### 2. The mark's colours — an exception, then an adjustment

First answer: **"Mark keeps its own colors"** — brass + paprika are a mark-only
exception beside the İznik UI palette. ADR 0042 is *not* reopened; no UI token
changes.

Then session -32's measurements arrived and were put back to the founder the same
day: paprika `#B23B2A` sits **ΔE00 3.4** from `--risk` `#B3261E` (the mark's focal
accent is perceptually the product's error colour, beside topbar status chips), and
brass `#C79A3D` on paper `#FAF7F1` is **2.42:1**, failing WCAG 1.4.11 non-text
(3.0 minimum) — while clean against the seal (brass↔seal ΔE00 47.8, paprika↔seal
50.7) and strong on charcoal (7.17:1).

Second answer: **"Adjust values"** — keep the brass+paprika identity; shift the
rivet off the red axis (deep-oxblood/ink direction) and darken brass for light
grounds — the founder's explicit concern was fixing this **before** favicons,
PWA icons and store builds are cut.

**The landed values** (derived by session -32 — exhaustive LCh search under the
constraint set, CIEDE2000 + WCAG 2.1 luminance; applied in `d4ba2f19`). The
insight: the *ground* was the problem, not the colours — so the mark became
ground-aware, the same pattern as the seal's 600/400:

| Element | Light `#FAF7F1` | Dark `#15130F` |
|---|---|---|
| brass (strokes) | **`#B18833`** — 3.05:1, ΔE00 6.1 from canvas brass, 12.1 from `--warn` | **`#C79A3D`** unchanged — 7.17:1 |
| rivet | **`#7E2B22`** deep oxblood — 8.71:1, ΔE00 10.6 from `--risk` | **`#B13A29`** — ΔE00 0.3 from canvas paprika, 12.3 from dark `--risk`, 3.10:1 |

Brass↔rivet separation inside the mark: 37.8 light / 36.6 dark; both 43–47 from
the seal. Favicon (ink tile = dark ground) wears the dark rivet. Known
deviation, recorded: the PNG icon tiles keep the canvas paprika ground — ΔE00
0.3 from the adjusted dark value, imperceptible, and no icon pipeline exists to
regenerate them.

### 3. The wordmark pairing (closes 0043's reopen)

0043 said the pairing question reopens when the final mark lands. It landed, it was
asked, and the founder answered directly: **"Fraunces stays."** Fraunces 600 remains
the wordmark beside the Rivet M. The canvas's Piazzolla/Karla/IBM Plex Mono are that
sheet's own presentation style, not app typography. This is a decided pairing, not a
recorded-open one.

### 4. Full go (lifts ADR 0044's hold)

*"Full go"* — the merge hold is lifted: `feat/mudavym-brand` lands on `main` via PR
(**#163**, open), `feat/mudavym-design-p1` rebases onto it afterwards, and page
builds continue in parallel across sessions. Merge trigger held by session -7f, to
fire when (a) the adjusted-hex commit lands and (b) `CI Complete` is green. After
merge: `railway status` check (CI cannot see Nest DI failures), then ping -9e for
the design-p1 rebase.

### 5. Page claims, documentation, and review protocol

Session -7f takes **receipts, documents-reports, communications, providers,
inventory, team, plus any other live unclaimed routes** — excluding -9e's four
(dashboard, orders, receiving, receiving-door) and `/sommelier` (founder: HOLD).
The founder's protocol, verbatim in intent:

- **Document every page change in the vault** — each rebuilt page's `06-pages/<slug>.md`
  records *which design is used, with which motions, where they fire, and the
  reasoning for each decision* (§1a Features and §9 Gaps updated in the same pass;
  "Motions used" table per ADR 0044).
- **A Sonnet audit agent per page** after each page build.
- **A 2–5-agent Opus review of the whole** when all pages are done.

## Pre-merge checks inherited from the colour audits (session -32)

Filed here so #163's merge is eyes-open; full working in their audit docs.
Triaged 2026-08-30 (session -32's block/no-block judgement + in-branch verification):

- **Brand/danger aliasing — was the one BLOCK, now verified already fixed on the
  branch.** On `feat/p1-readout`, `wine`/`brand`/`red`/`danger` are four
  byte-identical scales; on `feat/mudavym-brand`, `wine`/`brand` carry the İznik
  scale (600 `#1A5E6B`) while `red`/`danger` keep the burgundy danger family
  (600 `#9E4249`, "Danger aligned with red triad"). Destructive UI does not turn
  teal. Verified in that branch's `tailwind.config.js` before merge.
- **Tracking, not gating:** `packages/ui` has no CSS build step — editing its ~50
  hex values moves zero pixels while looking done (false-completion trap for the
  page waves); tenant email colour lives in `restaurant_branding.primary_color`
  in the DB and overrides the code constant — no regression at merge, but it
  gates any brand **announcement** on a data migration.

## Consequences

- **Easier:** the glyph-shaped hole in the chrome closes everywhere at once — rail,
  favicon, app icon, seal stamp; the search record stays honest (17 ranked, one
  chosen from outside the sheet, reasons written down).
- **Harder / given up:** the mark carries two non-palette colours forever, and every
  future surface must respect the mark-only boundary; the shipped-then-adjusted hexes
  mean one extra fix-forward commit on the brand branch before merge.
- **Revisit if:** the 17-candidate ranking surfaces a lookalike liability against
  the Rivet M itself — that finding would go back to the founder, not be absorbed
  silently.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-30 | Aldemir (founder) | Round 1: Rivet M chosen + rank all 17; mark keeps its own colours; FULL GO; -7f takes all remaining pages with per-page docs, Sonnet audits, 2–5-Opus final review |
| 2026-08-30 | Aldemir (founder) | Round 2: Fraunces stays beside the mark (0043's pairing reopen — closed) |
| 2026-08-30 | Aldemir (founder) | Round 3: mark colours ADJUST — rivet off the red axis, brass darkened on light grounds, on -32's ΔE00/contrast evidence |
| 2026-08-30 | — | Rivet M implemented on `feat/mudavym-brand` (d0d95d3b, session -34) with canvas hexes; PR #163 open |
| 2026-08-30 | — | Ground-aware hexes derived (-32) and landed (`d4ba2f19`, session -7f adopting the orphaned brand branch): tsc clean, 423/423 tests, four declarations verified in compiled CSS. ADR fully Locked; merge trigger armed on green CI |
