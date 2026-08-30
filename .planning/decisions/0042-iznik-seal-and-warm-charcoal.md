# 0042 — İznik is the seal; Warm Charcoal is the dark ground

- **Status:** Locked (palette) · canvas re-skinned 2026-08-29 · live on dev.mudavym.com 2026-08-30 (`feat/mudavym-brand`)
- **Date:** 2026-08-29
- **Decider:** Aldemir (founder), 2026-08-29
- **Keywords:** palette, seal, İznik, 1A5E6B, 5FB0BC, warm charcoal, 15130F, re-skin, CD2D5B, OD-106, sketch 059
- **Links:** [[0041-makeover-canvas-and-conflicted-palette]] (supersedes its palette half), sketch `059-mudavym-house`, `06-pages/MAKEOVER-VERDICTS.md`

## Context

ADR 0041 recorded a `#CD2D5B` answer given on a stale premise: the 2026-08-27 wave
reviews had already ruled out both incumbent burgundies, and the live question was the
*seal* colour, with İznik recommended on sketch 059's decision board and not yet picked.

On 2026-08-29 the founder closed it: **"we're going to re-skin into İznik — but we're
going to do the Warm Charcoal as well."**

## Decision

**Seal = İznik.** Ottoman ceramic blue-teal — the glaze colour, dark, low-chroma and
green-shifted, which is why it does not read as generic SaaS blue. **Dark ground =
Warm Charcoal `#15130F`**, the value decided on 2026-08-27 under the standing
instruction *"keep it as simple as possible"* (Aubergine was recommended and overruled).

The canonical values come from sketch 059's token block, not from a fresh derivation:

| Token | Light | Dark |
|---|---|---|
| `--seal` | `#1A5E6B` | `#5FB0BC` |
| `--seal-deep` | `#14515C` | `#7DC3CD` |
| `--seal-tint` | `rgba(26,94,107,.10)` | `rgba(95,176,188,.14)` |
| `--seal-ring` | `rgba(26,94,107,.32)` | `rgba(95,176,188,.38)` |
| `--paper-0` | `#FAF7F1` | **`#15130F`** (Warm Charcoal, overriding 059's `#16120E`) |
| `--paper-1` | `#F3EFE6` | `#1D1813` |
| `--paper-2` | `#EAE4D8` | `#262019` |
| `--ink-1` | `#211C16` | `#EFE7D9` |
| `--ink-2` | `#4F473C` | `#C0B6A5` |
| `--ink-3` | `#7C7365` | `#8E8576` |
| `--ink-4` | `#665D50` | `#ABA294` |

**Both grounds ship.** This is not a light-mode palette with a dark option bolted on;
the founder asked for warm paper *and* Warm Charcoal, so surfaces that live on the
cellar floor, at the receiving door and on the POS terminal get the charcoal ground as
a first-class treatment rather than an afterthought.

## What this changes in the makeover canvas

The 2026-08-28 canvas (103 artboards) was built on `#CD2D5B` with a warm-grey spine.
The re-skin is mechanical and confined to colour:

- Primary scale `#FDF2F5 … #4A0F21` → the İznik seal ramp. `#CD2D5B` → `#1A5E6B`,
  `#AC204A` → `#14515C`, `#FDF2F5` (the active-nav and selected-row tint) →
  `--seal-tint`, `#8A1A3C` (active-nav text) → `#14515C`.
- Ground `#FBF9F8` → `#FAF7F1`; sunk `#F4F0EE` → `#F3EFE6`; line `#E9E3E0` → a tint of
  `--ink-1`; ink `#191316` → `#211C16`, `#5C5155` → `#4F473C`, `#8C8085` → `#7C7365`.
- Dark tokens `#14100F/#1D1815/#322A28` → `#15130F/#1D1813/#262019`.
- **Semantics do not move.** `--ok`, `--warn`, `--risk` keep their values; `--info`
  `#2F58E0` must be re-checked against the seal — **checked 2026-08-30, see
  Execution below: retire it.**
- **`--calm` `#6B5F8A` is at risk and must be re-judged in context.** It exists so a
  manager can see at a glance what the platform did unasked. Against a crimson primary
  a muted violet was clearly not-the-brand; against an İznik seal it is a neighbouring
  hue and may stop reading as a separate category. Decide it on screen, not in a table.

## Consequences

- **Easier:** one palette across sketches and the makeover canvas; the seal doubles as
  the approval stamp (hold-to-approve completes into the seal landing), so mark and
  interaction are one object.
- **Harder / given up:** every artboard, and later every `tailwind.config.js` scale,
  carries a colour migration. The `--info` blue and the `--calm` violet both need a
  fresh judgement against a teal seal rather than a straight port.
- **Revisit if:** the seal fails contrast on `#FAF7F1` at body sizes (measure), or if
  `--calm` cannot be told apart from the seal on a real screen.

## Execution

- **2026-08-29 — makeover canvas re-skinned** (106 files, colour only) and republished
  to the same URL. Rendered check: `--calm` still reads as its own category against
  the teal seal; `--info` blue vs the seal remains unjudged.
- **2026-08-30 — app rollout begun** on branch `feat/mudavym-brand` → dev.mudavym.com
  (Vercel, domain pinned to the branch; production untouched). Scope per founder:
  İznik primary + Warm Charcoal dark ground + Fraunces text wordmark
  ([[0043-wordmark-interim-logo-search]]) + all user-visible WineOps→Mudavym strings.
  Light-mode grounds deliberately unchanged — the warm-paper spine arrives with the
  page redesigns, not this pass.
- **2026-08-30 — dev.mudavym.com LIVE.** Founder attached the domain and the branch
  pin; verified on the wire: DNS → vercel-dns, HTTP 200, title "Mudavym", Fraunces
  loaded, `favicon.svg` M. mark, compiled CSS carries #1A5E6B ×31 / #15130F ×5 /
  #5FB0BC ×8 and zero #CD2D5B (the two #9E4249 hits are the retained danger scale);
  link colours computed in-browser as `rgb(26,94,107)`. Production/main untouched,
  still WineOps until this branch merges.

### `--info` vs the seal — judged 2026-08-30

Measured and rendered side by side (paper and Warm Charcoal, links/badges/focus
rings): `--info` `#2F58E0` sits at hue 226° against the seal's 190° — only 32–36°
apart on both grounds — with a contrast ratio between the two colors of just
**1.26:1**. On screen they read as two shades of one blue-teal family, not two
categories; the confusion is worst in dark mode, where `#5B8DEF` (info) and
`#5FB0BC` (seal) are nearly interchangeable at a glance.

**Decision: retire `--info` as a hue.** Informational/system-sourced text and
links become **ink with an underline** (a value/texture cue, not a hue cue) —
this can never be mistaken for a seal-colored brand action regardless of what the
seal ends up being. `--info-bg` is retired with it; an informational banner uses
`--ink-1` text on `--paper-1` with a plain left rule, matching the honesty-idiom
register the kit already uses for `--calm`. `--ok`/`--warn`/`--risk` are
unaffected — they were never adjacent to the seal on the wheel and the same
comparison was not run for them.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-29 | Aldemir (founder) | "Re-skin into İznik, and Warm Charcoal as well" — palette locked, execution held |
| 2026-08-30 | — | `--info` vs seal measured + rendered; hunch confirmed, `--info` retired for ink+underline |
