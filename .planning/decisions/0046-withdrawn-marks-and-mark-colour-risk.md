# 0046 — Two withdrawn marks, and a measured objection to the third

- **Status:** Record (withdrawals) + **open objection** on the mark-colour exception
- **Date:** 2026-08-30
- **Decider:** records founder calls of 2026-08-29/30; the objection is unresolved
- **Keywords:** logo, mark, VS Code, rivet, brass, paprika, C79A3D, B23B2A, contrast, OD-111
- **Links:** [[0042-iznik-seal-and-warm-charcoal]], `06-pages/COLOR-CONTRAST-REPORT.md`, ADR 0045 (session -7f, mark-colour exception)

> **Numbering note.** This content was first written as ADR 0043 on 2026-08-29 and was
> lost when a concurrent session allocated `0043-wordmark-interim-logo-search.md` over
> it. 0044 and 0045 are claimed by session -7f. This is the collision hazard the
> decision register has hit before; the fix remains *file the register row first*.

## Two marks died, and why it is worth writing down

**Mark 1 — the single-path bowtie** (`M15 86 L15 14 L85 86 L85 14 Z`, one closed mitred
stroke). Withdrawn by the founder on 2026-08-30: **it reads as the Visual Studio Code
mark.** Correct and disqualifying — the same angular ribbon-between-posts silhouette,
close enough that it would follow the brand permanently. The *construction* was sound
(one stroke width means weight cannot drift, and the negative space cannot pinch to a
sliver); the shape it produced was already taken. Worth remembering as a rule: check a
candidate silhouette against the marks a developer-adjacent audience sees daily.

**Mark 2 — the slab monogram with a diagonal**, chosen briefly on 2026-08-30 and
superseded within the day by the Rivet M. Four defects were logged against it, three of
which were the founder's own earlier objections returning in a new position: the
counters clog by 24px, the asymmetric bottom-left step was back, stroke weight was
uneven, and — new — **it reads N before it reads M**. Only the fourth is specific to
that drawing; the first three are a recurring failure mode worth checking on any
candidate.

**Carried forward from both:** the two-cut principle (a display cut carrying ink traps,
a solid cut without, because nothing under roughly 6 grid units survives 16px), and the
Plus Jakarta Sans 800 wordmark.

## The open objection — mark colours versus the measured palette

ADR 0045 (session -7f) records the founder allowing the Rivet M to keep **brass
`#C79A3D`** and **paprika `#B23B2A`** as a mark-only exception beside the locked İznik
UI palette. The exception itself is reasonable — a mark may sit outside the UI system.
Two measured facts should be on the record before it is treated as settled:

| Pair | Measure | Reading |
|---|---:|---|
| paprika `#B23B2A` vs `--risk #B3261E` | **ΔE00 3.4** | Below the ~5 "different colour" threshold. The rivet is perceptually the product's **error** colour. |
| brass `#C79A3D` on paper `#FAF7F1` | **2.42 : 1** | Fails the WCAG 1.4.11 non-text minimum of 3.0. |
| brass `#C79A3D` on charcoal `#15130F` | 7.17 : 1 | Fine. |
| paprika on charcoal | 3.14 : 1 | Bare pass. |
| brass vs `--warn #A5670A` | ΔE00 17.2 | Distinct. No issue. |
| brass / paprika vs the seal | ΔE00 47.8 / 50.7 | Comfortably their own colours. No issue. |

**Why the first row matters.** The mark appears in the topbar and rail, inches from
status chips. `--risk` means failed, expired, over budget. A logo whose single focal
accent is indistinguishable from that is not a brand problem, it is a legibility
problem — and the contrast report already found `warn` and `risk` collapsing into each
other under deuteranopia, so this crowds an area that is already tight.

**Why the second row matters.** On the light ground — which ADR 0042 makes the primary
ground — a brass mark measures 2.42:1. It will read washed out at rail and favicon
sizes, which is the opposite of what a mark is for.

**Two ways out, neither chosen here:** shift the rivet off the red axis (a deeper
oxblood or an ink rivet both leave `--risk` alone), or keep paprika but darken brass for
light grounds so the mark is not the palest thing on the page. Either is cheap now and
expensive after the icons are cut and the mobile store build is out.

## Consequences

- **Recorded, not blocking.** The mark is the founder's call and OD-111 is resolved.
  This ADR exists so the two measurements are on the record rather than rediscovered
  after the app icons, the PWA set and the EAS build have shipped.
- **Revisit when:** the Rivet M is first placed in the real topbar beside a `--risk`
  chip. That is the screen that settles it, not a table.

## Resolution — founder said "adjust values", 2026-08-30

The founder kept the brass + paprika identity and asked for the rivet off the red axis
and brass darkened for light grounds. Derived below; **the finding that shaped the
answer is that the problem was the ground, not the colours.**

Paprika collides with the *light* risk token `#B3261E` (ΔE00 3.4) but is comfortably
clear of the *dark* risk token `#E1513F` (ΔE00 12.3). So the mark becomes ground-aware
— exactly as the seal already is (`#1A5E6B` light / `#5FB0BC` dark). This introduces no
new pattern.

| Element | Ground | Value | Was |
|---|---|---|---|
| Brass | light `#FAF7F1` | **`#B18833`** | `#C79A3D` |
| Brass | dark `#15130F` | **`#C79A3D`** | unchanged — already passed |
| Rivet | light `#FAF7F1` | **`#7E2B22`** (deep oxblood) | `#B23B2A` |
| Rivet | dark `#15130F` | **`#B13A29`** | `#B23B2A` — 0.3 ΔE00, effectively unchanged |

**Verification, against the semantic set of each ground:**

| | contrast | vs risk | vs warn | vs calm |
|---|---:|---:|---:|---:|
| light brass `#B18833` | 3.05 | 35.6 | 12.1 | 65.0 |
| light rivet `#7E2B22` | 8.71 | 10.6 | 27.0 | 38.4 |
| dark brass `#C79A3D` | 7.17 | 32.2 | 12.4 | 62.3 |
| dark rivet `#B13A29` | 3.10 | 12.3 | 25.1 | 39.2 |

Brass↔rivet separation inside the mark: **37.8** light, **36.6** dark. Both elements
sit 43–47 ΔE00 from the seal, so the mark-only exception stays clearly outside the UI
palette rather than looking like a failed match.

Method: WCAG 2.1 relative luminance and contrast ratio; CIEDE2000 in CIELAB; exhaustive
LCh search under the constraint set (rivet ≥ 6 ΔE00 from risk — delivered at 10.6/12.3;
brass ≥ 3.0 : 1 non-text on paper; both families preserved).

## Merge judgement for PR #163 — one blocker of three

Asked which audit findings should block the brand merge. Verified the first directly in
`apps/web/tailwind.config.js` rather than relying on the audit report.

**BLOCKS.** `wine`, `brand`, `red` and `danger` are four byte-identical scales —
`500:'#B85055'`, `600:'#9E4249'`, `700:'#82363C'` in all four. Re-pointing the brand
turns `red-*` and `danger-*` teal, so destructive buttons and error states render in the
brand colour. A Delete that looks like a primary action is a correctness defect a user
can act on. The PR must split `danger`/`red` off the shared scale, or not re-point it.
391 sites across 81 files carry these names and each needs reading — no codemod can
distinguish "delete" from "our brand".

**Does not block.** `packages/ui`'s missing CSS build step, and the
`restaurant_branding.primary_color` DB override on email. Neither is a regression;
both are false-completion traps. The email one is vendor- and customer-facing, so it
should gate the brand *announcement* rather than the merge.

## Block RETRACTED — verified on `feat/mudavym-brand`, 2026-08-30

The blocker above was measured against `feat/p1-readout`. **It does not apply to the
branch that is merging.** Verified directly in `feat/mudavym-brand`'s
`apps/web/tailwind.config.js`:

| Scale | on `feat/p1-readout` | on `feat/mudavym-brand` |
|---|---|---|
| `wine` / `brand` | `600 #9E4249` | **`600 #1A5E6B`, `400 #5FB0BC`** — İznik |
| `red` / `danger` | `600 #9E4249` (identical to brand) | **`600 #9E4249`, `500 #B85055`** — burgundy retained |

The split happened on the brand branch and merges with it. `red`/`danger` no longer
alias the brand, so re-pointing does not turn destructive controls teal. **PR #163 is
not blocked by this.** The finding stands as a real defect *on `feat/p1-readout`*, which
still carries four byte-identical scales and will inherit the fix at merge.

The derived mark values were also applied and verified in
`apps/web/src/components/brand/BrandMark.tsx` on that branch — `stroke-[#B18833]
dark:stroke-[#C79A3D]`, `fill-[#7E2B22] dark:fill-[#B13A29]`. Ground pairing is correct,
not transposed.

**Re-checked the derivation against the reds that actually ship there**, since the split
changes which red the rivet sits beside. It holds:

| | vs `danger-600 #9E4249` | vs `danger-500 #B85055` | vs `--risk #B3261E` |
|---|---:|---:|---:|
| light rivet `#7E2B22` | 11.0 | 16.5 | 10.6 |
| dark rivet `#B13A29` | 10.5 | 10.6 | — |
| light brass `#B18833` | 37.2 | 34.3 | 35.6 |

All comfortably past the ~5 threshold against both the tailwind `danger` family and
ADR 0042's semantic `--risk`.

### New, minor: the product now has two error reds

`danger-600 #9E4249` (what tailwind ships) and `--risk #B3261E` (ADR 0042's semantic
token) are **ΔE00 11.3** apart — visibly different reds, both meaning "error", chosen by
whichever system a given component happened to use. Not a blocker and not a regression;
the two were identical in intent and are now not. Worth reconciling before the semantic
layer is rolled out, or errors will drift between two reds page by page.
