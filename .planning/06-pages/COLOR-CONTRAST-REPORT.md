# Colour and contrast verification — İznik seal + Warm Charcoal

- **Date:** 2026-08-29
- **Subject:** the palette locked in [[0042-iznik-seal-and-warm-charcoal]], as used by the design kit in `MAKEOVER-VERDICTS.md`
- **Method:** every number below was computed, not estimated. Script and validation in §9.

---

## Verdict

**Eleven blocking defects. Do not ship the kit as specified.** Two of them are
structural (no token in the palette can legally draw a control border; the focus ring
is invisible on the one control it matters most on), one is a whole missing layer
(dark mode has no semantic values at all), and two are the open questions from
ADR 0042 — both of which the numbers answer against the incumbent value.

### What must change before anything is built

| # | Defect | Measured | Threshold |
|---|---|---:|---:|
| B1 | Focus ring `#1A5E6B` on the primary button fill `#1A5E6B` — same colour | **1.00** | 3.00 |
| B2 | No border token reaches control-boundary contrast: `line` 1.29 / `line-strong` 1.56 on paper-0 | **1.29–1.67** | 3.00 |
| B3 | Active-nav fill `seal-50` against `surface`; no tint on the ramp can reach 3.0 (best is seal-400 at 2.49) | **1.08** | 3.00 |
| B4 | Dark mode defines no semantic values; the light ones on dark paper-1 give 2.69–3.81 | **2.69–3.81** | 4.50 |
| B5 | White label on the dark primary fill `#5FB0BC` | **2.49** | 4.50 |
| B6 | `warn #A5670A` on its own chip bg (4.13) and on `paper-0` (4.32) | **4.13** | 4.50 |
| B7 | `ink-3` — the placeholder token — on `paper-1` (4.07), `paper-0` (4.37); dark on paper-2 (4.43) | **4.07** | 4.50 |
| B8 | `--calm #6B5F8A` against the seal under deuteranopia — ΔE00 | **7.7** | ~20 |
| B9 | `--info` chip fill against the selected-row/active-nav tint `seal-50` — ΔE00 (tritan 2.0) | **6.3** | ~20 |
| B10 | `warn` vs `risk` under deuteranopia — ΔE00; **no colour pair fixes this** | **7.7** | ~20 |
| B11 | Chip tints carry no information under CVD: ok-bg vs info-bg (tritan) ΔE00 | **1.2** | ~10 |

### What is safe to ship as specified

The neutral spine and the seal itself are the strong part of this palette and need no
change: `ink-1`/`ink-2` clear AA-normal on every ground in both themes by a wide margin
(7.96–16.90), the seal clears AA-normal as body text on every light ground
(6.40–7.35) and `seal-400` does the same on every dark ground (6.46–7.44), white on the
light primary fill is 7.35 and 8.89 on the `seal-600` hover, and dark-mode ink parity
is genuinely good — every ink role lands within ±0.75 of its light counterpart except
`ink-1` on a card, which is 2.56 lower and still 14.34.

### The two open questions, answered

- **`--info #2F58E0` — retire the blue.** Not because the foregrounds collide (ΔE00 22.3
  normal, worst case 13.8 under tritanopia — survivable), but because **the chip fills do**:
  `info-bg #EAF0FE` sits ΔE00 **6.3** from `seal-50 #F1F7F8`, the active-nav and
  selected-row tint, falling to **2.0** under tritanopia. An informational chip and a
  selected row are the same colour. No blue candidate improves on this — `#1E40AF` is
  *worse* against the seal (10.2), `#4338CA` is a wash (13.4) and collides with `calm`
  (11.6). The numbers say swap the role, not the hue: **`--info` becomes achromatic**
  (`ink-1 #211C16` mark + rule; min ΔE00 ≥ 20.3 against every other role, contrast 15.81
  on paper-0). Full working in §5.
- **`--calm #6B5F8A` — replace it.** ΔE00 to the seal is **8.2 under protanopia and 7.7
  under deuteranopia**: for roughly 6% of male users, "the platform did this" is a tint
  of the brand. This is exactly the risk ADR 0042 named and it is real. Best available
  replacement is **`#6D28D9`** (min ΔE00 16.6 vs seal-500, 29.2 vs seal-400, contrast
  6.64/7.10/6.14). 16.6 is an improvement, not a solution — `calm` also needs a
  non-colour signature. §5.

---

## 1. Text on ground

WCAG 2.1 contrast ratio; APCA Lc (0.98G-4g) given alongside because SC 1.4.3 is known to
be lenient on dark grounds and this palette ships two.

#### Light theme

| Foreground | Background | Ratio | AA-normal 4.5 | AA-large 3.0 | AAA 7.0 | APCA Lc |
|---|---|---:|:--:|:--:|:--:|---:|
| ink-1 `#211C16` | paper-0 `#FAF7F1` | 15.81 | PASS | PASS | PASS | +99.2 |
| ink-2 `#4F473C` | paper-0 `#FAF7F1` | 8.54 | PASS | PASS | PASS | +86.4 |
| ink-3 `#7C7365` | paper-0 `#FAF7F1` | 4.37 | **FAIL** | PASS | FAIL | +67.8 |
| ink-1 `#211C16` | paper-1 `#F3EFE6` | 14.73 | PASS | PASS | PASS | +94.5 |
| ink-2 `#4F473C` | paper-1 `#F3EFE6` | 7.96 | PASS | PASS | PASS | +81.7 |
| ink-3 `#7C7365` | paper-1 `#F3EFE6` | 4.07 | **FAIL** | PASS | FAIL | +63.1 |
| ink-1 `#211C16` | surface `#FFFFFF` | 16.90 | PASS | PASS | PASS | +103.8 |
| ink-2 `#4F473C` | surface `#FFFFFF` | 9.13 | PASS | PASS | PASS | +91.0 |
| ink-3 `#7C7365` | surface `#FFFFFF` | 4.67 | PASS | PASS | FAIL | +72.5 |
| seal-500 `#1A5E6B` | paper-0 `#FAF7F1` | 6.87 | PASS | PASS | FAIL | +80.6 |
| seal-500 `#1A5E6B` | paper-1 `#F3EFE6` | 6.40 | PASS | PASS | FAIL | +75.9 |
| seal-500 `#1A5E6B` | surface `#FFFFFF` | 7.35 | PASS | PASS | PASS | +85.2 |
| white `#FFFFFF` | primary fill `#1A5E6B` | 7.35 | PASS | PASS | PASS | −90.1 |
| white `#FFFFFF` | seal-600 hover `#14515C` | 8.89 | PASS | PASS | PASS | −94.5 |
| seal-700 `#10424C` | active-nav fill `#F1F7F8` | 10.18 | PASS | PASS | PASS | +89.8 |
| ink-1 `#211C16` | active-nav fill `#F1F7F8` | 15.62 | PASS | PASS | PASS | +98.3 |

#### Dark theme

| Foreground | Background | Ratio | AA-normal 4.5 | AA-large 3.0 | AAA 7.0 | APCA Lc |
|---|---|---:|:--:|:--:|:--:|---:|
| ink-1 `#EFE7D9` | paper-0 `#15130F` | 15.11 | PASS | PASS | PASS | −92.1 |
| ink-2 `#C0B6A5` | paper-0 `#15130F` | 9.25 | PASS | PASS | PASS | −62.8 |
| ink-3 `#8E8576` | paper-0 `#15130F` | 5.09 | PASS | PASS | FAIL | −37.0 |
| ink-1 `#EFE7D9` | paper-1 `#1D1813` | 14.34 | PASS | PASS | PASS | −91.6 |
| ink-2 `#C0B6A5` | paper-1 `#1D1813` | 8.79 | PASS | PASS | PASS | −62.3 |
| ink-3 `#8E8576` | paper-1 `#1D1813` | 4.84 | PASS | PASS | FAIL | −36.4 |
| ink-1 `#EFE7D9` | paper-2 `#262019` | 13.12 | PASS | PASS | PASS | −90.5 |
| ink-2 `#C0B6A5` | paper-2 `#262019` | 8.04 | PASS | PASS | PASS | −61.2 |
| ink-3 `#8E8576` | paper-2 `#262019` | 4.43 | **FAIL** | PASS | FAIL | −35.4 |
| seal-400 `#5FB0BC` | paper-0 `#15130F` | 7.44 | PASS | PASS | PASS | −52.5 |
| seal-400 `#5FB0BC` | paper-1 `#1D1813` | 7.06 | PASS | PASS | PASS | −52.0 |
| seal-400 `#5FB0BC` | paper-2 `#262019` | 6.46 | PASS | PASS | FAIL | −50.9 |
| white `#FFFFFF` | dark primary fill `#5FB0BC` | 2.49 | **FAIL** | **FAIL** | FAIL | −53.9 |
| paper-0 `#15130F` | dark primary fill `#5FB0BC` | 7.44 | PASS | PASS | PASS | +54.3 |
| seal-500 `#1A5E6B` (wrong ramp step) | paper-1 `#1D1813` | 2.40 | **FAIL** | **FAIL** | FAIL | −15.6 |

The last two rows are the two ways a mechanical port of the light kit breaks in dark
mode: white text stays on the button, or `seal-500` stays as the primary. Both are
below AA-large.

#### Semantics, light theme

| Foreground | Background | Ratio | AA-normal 4.5 | AA-large 3.0 | AAA 7.0 | APCA Lc |
|---|---|---:|:--:|:--:|:--:|---:|
| ok `#17795E` | ok-bg `#E9F5F1` | 4.78 | PASS | PASS | FAIL | +68.6 |
| warn `#A5670A` | warn-bg `#FBF1DF` | 4.13 | **FAIL** | PASS | FAIL | +64.0 |
| risk `#B3261E` | risk-bg `#FBEAE8` | 5.61 | PASS | PASS | FAIL | +70.5 |
| info `#2F58E0` | info-bg `#EAF0FE` | 5.12 | PASS | PASS | FAIL | +69.5 |
| calm `#6B5F8A` | calm-bg `#F0EDF6` | 5.00 | PASS | PASS | FAIL | +69.0 |
| ok `#17795E` | paper-0 `#FAF7F1` | 4.99 | PASS | PASS | FAIL | +71.5 |
| warn `#A5670A` | paper-0 `#FAF7F1` | 4.32 | **FAIL** | PASS | FAIL | +67.1 |
| risk `#B3261E` | paper-0 `#FAF7F1` | 6.11 | PASS | PASS | FAIL | +76.2 |
| info `#2F58E0` | paper-0 `#FAF7F1` | 5.47 | PASS | PASS | FAIL | +73.9 |
| calm `#6B5F8A` | paper-0 `#FAF7F1` | 5.41 | PASS | PASS | FAIL | +74.3 |
| ok `#17795E` | surface `#FFFFFF` | 5.34 | PASS | PASS | FAIL | +76.2 |
| warn `#A5670A` | surface `#FFFFFF` | 4.62 | PASS | PASS | FAIL | +71.8 |
| risk `#B3261E` | surface `#FFFFFF` | 6.54 | PASS | PASS | FAIL | +80.8 |
| info `#2F58E0` | surface `#FFFFFF` | 5.84 | PASS | PASS | FAIL | +78.5 |
| calm `#6B5F8A` | surface `#FFFFFF` | 5.79 | PASS | PASS | FAIL | +78.9 |

Nothing in the semantic set reaches AAA anywhere. That is a defensible choice for chips
but rules the semantic colours out for long-form text.

#### Semantics carried unchanged into dark — the whole layer fails

The palette defines no dark-mode semantic values. This is what the light values do if
they ship as-is.

| Foreground | Background | Ratio | AA-normal 4.5 | AA-large 3.0 |
|---|---|---:|:--:|:--:|
| ok `#17795E` | dark paper-1 `#1D1813` | 3.30 | **FAIL** | PASS |
| warn `#A5670A` | dark paper-1 `#1D1813` | 3.81 | **FAIL** | PASS |
| risk `#B3261E` | dark paper-1 `#1D1813` | 2.69 | **FAIL** | **FAIL** |
| info `#2F58E0` | dark paper-1 `#1D1813` | 3.01 | **FAIL** | PASS |
| calm `#6B5F8A` | dark paper-1 `#1D1813` | 3.04 | **FAIL** | PASS |
| dark ink-1 `#EFE7D9` | ok-bg `#E9F5F1` used as a dark chip fill | 1.10 | **FAIL** | **FAIL** |
| dark ink-1 `#EFE7D9` | warn-bg `#FBF1DF` | 1.10 | **FAIL** | **FAIL** |
| dark ink-1 `#EFE7D9` | risk-bg `#FBEAE8` | 1.05 | **FAIL** | **FAIL** |
| dark ink-1 `#EFE7D9` | info-bg `#EAF0FE` | 1.08 | **FAIL** | **FAIL** |
| dark ink-1 `#EFE7D9` | calm-bg `#F0EDF6` | 1.06 | **FAIL** | **FAIL** |

---

## 2. Non-text contrast (WCAG 1.4.11, 3.0 minimum)

#### Structure lines — light

| Element | Against | Ratio | 1.4.11 |
|---|---|---:|:--:|
| line `#E3DBCB` | paper-0 `#FAF7F1` | 1.29 | FAIL |
| line `#E3DBCB` | surface `#FFFFFF` | 1.38 | FAIL |
| line `#E3DBCB` | paper-1 `#F3EFE6` | 1.20 | FAIL |
| line-strong `#D2C7B2` | paper-0 `#FAF7F1` | 1.56 | FAIL |
| line-strong `#D2C7B2` | surface `#FFFFFF` | 1.67 | FAIL |
| line-strong `#D2C7B2` | paper-1 `#F3EFE6` | 1.46 | FAIL |

**Read this precisely.** SC 1.4.11 does not require decorative rules to reach 3.0, so
`line` is fine as a table rule, a zebra separator or a card edge. The defect is that
**the palette contains no token that can legally draw the boundary of a control** —
a text input, a select, an unchecked checkbox, a segmented control. `line-strong`, the
one that sounds like it should, tops out at 1.67. A form built from these tokens has
input fields with no perceivable edge.

#### Structure lines — dark

| Element | Against | Ratio | 1.4.11 |
|---|---|---:|:--:|
| line `#302921` | dark paper-0 `#15130F` | 1.29 | FAIL |
| line `#302921` | dark paper-1 `#1D1813` | 1.23 | FAIL |
| line `#302921` | dark paper-2 `#262019` | 1.12 | FAIL |

Same defect, mirrored. The dark theme has one line token and it is even weaker relative
to its grounds.

#### Focus ring `#1A5E6B`

| Element | Against | Ratio | 1.4.11 |
|---|---|---:|:--:|
| focus ring | paper-0 `#FAF7F1` | 6.87 | PASS |
| focus ring | surface `#FFFFFF` | 7.35 | PASS |
| focus ring | paper-1 `#F3EFE6` | 6.40 | PASS |
| focus ring | active-nav fill `#F1F7F8` | 6.79 | PASS |
| **focus ring** | **primary button fill `#1A5E6B`** | **1.00** | **FAIL** |
| dark ring `#5FB0BC` | dark paper-0 `#15130F` | 7.44 | PASS |
| dark ring `#5FB0BC` | dark paper-1 `#1D1813` | 7.06 | PASS |
| **dark ring `#5FB0BC`** | **dark primary fill `#5FB0BC`** | **1.00** | **FAIL** |

The ring is excellent everywhere except on the one control the product will train users
to reach for. Keyboard focus on a primary button is invisible in both themes.

#### Status-chip dots on their own tint — all pass

| Element | Against | Ratio | 1.4.11 |
|---|---|---:|:--:|
| ok dot `#17795E` | `#E9F5F1` | 4.78 | PASS |
| warn dot `#A5670A` | `#FBF1DF` | 4.13 | PASS |
| risk dot `#B3261E` | `#FBEAE8` | 5.61 | PASS |
| info dot `#2F58E0` | `#EAF0FE` | 5.12 | PASS |
| calm dot `#6B5F8A` | `#F0EDF6` | 5.00 | PASS |

#### Fills against the surface they sit on

| Element | Against | Ratio | 1.4.11 |
|---|---|---:|:--:|
| **active-nav fill `#F1F7F8`** | **surface `#FFFFFF`** | **1.08** | **FAIL** |
| **active-nav fill `#F1F7F8`** | **paper-0 `#FAF7F1`** | **1.01** | **FAIL** |
| ok-bg `#E9F5F1` | surface `#FFFFFF` | 1.12 | — |
| warn-bg `#FBF1DF` | surface `#FFFFFF` | 1.12 | — |
| risk-bg `#FBEAE8` | surface `#FFFFFF` | 1.16 | — |
| info-bg `#EAF0FE` | surface `#FFFFFF` | 1.14 | — |
| calm-bg `#F0EDF6` | surface `#FFFFFF` | 1.16 | — |

Chip fills are not required to reach 3.0 — the label carries the meaning. The nav fill
is different: on `paper-0` it is **1.01**, a 1% luminance step. Selection is the state,
and here the state is invisible. Nor can it be fixed within the ramp: no seal tint
reaches 3.0 against `surface`.

| Ramp step | vs surface | vs paper-0 |
|---|---:|---:|
| seal-50 `#F1F7F8` | 1.08 | 1.01 |
| seal-100 `#E0EFF1` | 1.18 | 1.10 |
| seal-200 `#BEDDE2` | 1.44 | 1.34 |
| seal-300 `#8FC4CD` | 1.92 | 1.79 |
| seal-400 `#5FB0BC` | 2.49 | 2.33 |

3.0 against white requires roughly L\* ≤ 55 — a mid-tone, not a tint. A tint fill can
never carry "selected" on its own.

---

## 3. Perceptual distance — the two open questions

### Working thresholds

ΔE00 is calibrated for adjacent large patches; UI categories are small, separated and
compared from memory. The thresholds used throughout this report, stated as a working
convention rather than a standard:

| ΔE00 | Reading |
|---|---|
| < 5 | the same colour |
| 5–10 | a tint or shade of each other |
| 10–20 | distinguishable side by side; unreliable from memory or across a page |
| > 20 | separate categories |

### Full pairwise ΔE00, normal vision

| | seal-500 | seal-400 | seal-600 | info | calm | ok | warn | risk | ink-1 | ink-2 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **seal-500** | — | 30.7 | 4.3 | 22.3 | 26.1 | 19.5 | 40.9 | 52.6 | 28.0 | 22.8 |
| **seal-400** | 30.7 | — | 36.2 | 35.1 | 36.4 | 26.2 | 43.7 | 54.7 | 54.3 | 43.9 |
| **seal-600** | 4.3 | 36.2 | — | 23.5 | 26.7 | 21.1 | 41.3 | 51.3 | 24.7 | 21.4 |
| **info** | 22.3 | 35.1 | 23.5 | — | 18.3 | 41.7 | 55.3 | 44.0 | 41.3 | 37.8 |
| **calm** | 26.1 | 36.4 | 26.7 | 18.3 | — | 33.9 | 41.8 | 33.5 | 32.5 | 26.3 |
| **ok** | 19.5 | 26.2 | 21.1 | 41.7 | 33.9 | — | 39.3 | 57.4 | 35.8 | 27.6 |
| **warn** | 40.9 | 43.7 | 41.3 | 55.3 | 41.8 | 39.3 | — | 25.2 | 36.9 | 26.0 |
| **risk** | 52.6 | 54.7 | 51.3 | 44.0 | 33.5 | 57.4 | 25.2 | — | 33.4 | 26.9 |
| **ink-1** | 28.0 | 54.3 | 24.7 | 41.3 | 32.5 | 35.8 | 36.9 | 33.4 | — | 14.1 |
| **ink-2** | 22.8 | 43.9 | 21.4 | 37.8 | 26.3 | 27.6 | 26.0 | 26.9 | 14.1 | — |

Note before the CVD analysis even begins: in **normal vision**, `ok` sits ΔE00 19.5 from
`seal-500` and `info` 22.3. Both are borderline for the brand-versus-status distinction
before any deficiency is applied.

### `--info #2F58E0` versus the seal

| Pair | normal | protan | deutan | tritan | **min** |
|---|---:|---:|---:|---:|---:|
| info vs seal-500 | 22.3 | 20.1 | 17.5 | 13.8 | **13.8** |
| info vs seal-400 | 35.1 | 27.4 | 26.8 | 22.2 | **22.2** |
| info vs calm | 18.3 | 12.8 | 13.0 | 21.5 | **12.8** |
| **info-bg vs seal-50** | **6.3** | 5.5 | 5.5 | **2.0** | **2.0** |
| info-bg vs calm-bg | 4.3 | 2.6 | 2.9 | 6.5 | **2.6** |

**Answer: they are distinguishable as foregrounds and indistinguishable as chips.**

The foreground pair holds up better than expected — 22.3 normal, worst case 13.8 under
tritanopia (where `#2F58E0` simulates to `#007B94`, a teal, and `seal-500` to `#006362`,
also a teal). 13.8 is "tell them apart side by side, not from memory". Marginal, not
fatal.

The fatal number is the fill. `info-bg #EAF0FE` and `seal-50 #F1F7F8` — the active-nav
and selected-row tint — are **ΔE00 6.3 apart in normal vision**, i.e. shades of each
other, falling to 2.0 under tritanopia. On a page where selection is a pale cool tint,
an informational chip *is* a selected row. `info` also sits 12.8 from `calm` under
protanopia, and their fills 2.6 apart: three of the five chip fills are the same pale
cool wash.

**No blue fixes this.** Every candidate scored, min ΔE00 across all four vision types:

| Candidate | vs seal-500 | vs seal-400 | vs calm | vs risk | vs warn | on paper-0 | on surface | on own bg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| incumbent `#2F58E0` | 13.8 | 22.2 | 12.8 | 44.0 | 51.7 | 5.47 | 5.84 | 5.12 |
| indigo `#4338CA` | 13.4 | 32.8 | 11.6 | 42.4 | 46.8 | 7.39 | 7.90 | 6.83 |
| royal `#1E40AF` | **10.2** | 33.7 | 11.3 | 42.9 | 49.1 | 8.16 | 8.72 | 7.50 |
| navy `#312E81` | 13.8 | 40.5 | 14.1 | — | — | 10.68 | — | — |
| slate `#3F4756` | **5.4** | 35.5 | 12.9 | 27.2 | 34.1 | 8.74 | 9.35 | 8.11 |
| ink-2 `#4F473C` | 17.8 | 39.9 | 13.5 | 11.6 | 23.1 | 8.54 | 9.13 | 7.96 |
| **ink-1 `#211C16`** | **24.4** | **50.2** | **27.6** | **20.3** | **33.9** | **15.81** | **16.90** | **14.73** |

Bluer and darker moves *toward* the seal, not away — `#1E40AF` lands at 10.2 and
`#3F4756` at 5.4, both worse than the incumbent. The only direction with room is out of
the hue circle entirely.

**Proposed treatment.** `--info` becomes achromatic, as ADR 0042 anticipated:

- mark and label: `ink-1 #211C16` — **15.81** on paper-0, **14.73** on paper-1, **16.90**
  on surface; min ΔE00 **≥ 20.3** against every other role in the system including the seal
- structure: a 2px left rule in the control-border token `#8F8674` (3.37 on paper-0),
  **not** a tinted fill — a fill is what collides
- if a fill is unavoidable, `paper-1 #F3EFE6` — but note it lands ΔE00 1.4 from `risk-bg`,
  which is the same disease. Prefer no fill.
- dark theme: `ink-1 #EFE7D9` (14.34 on paper-1), rule in `#736B61` (3.36)

This also reads correctly as semantics: informational is the *absence* of a status, and
it should look like the page rather than like a sixth state.

### `--calm #6B5F8A` versus the seal

| Pair | normal | protan | deutan | tritan | **min** |
|---|---:|---:|---:|---:|---:|
| **calm vs seal-500** | 26.1 | **8.2** | **7.7** | 22.5 | **7.7** |
| calm vs seal-400 | 36.4 | 25.5 | 21.9 | 34.0 | **21.9** |
| calm vs info | 18.3 | 12.8 | 13.0 | 21.5 | **12.8** |
| calm-bg vs seal-50 | 6.8 | 3.3 | 2.8 | 5.5 | **2.8** |

**Answer: no. `calm` reads as a shade of the seal for red-green deficient users.**

In normal vision it is fine (26.1). Under protanopia `seal-500` simulates to `#545B6C`
and `calm` to `#55668C`; under deuteranopia `#49526B` and `#576589` — in both cases two
muted blue-slates differing chiefly in lightness, ΔE00 **8.2 / 7.7**. Deuteranopia and
protanopia together affect roughly 6% of men. Against the light theme's `seal-500` this
is a collapse; only against the dark theme's brighter `seal-400` does it hold (21.9).
The backgrounds are worse still (2.8).

This is precisely the failure ADR 0042 predicted — *"against an İznik seal it is a
neighbouring hue and may stop reading as a separate category"* — confirmed numerically.

Candidates, min ΔE00 across all four vision types:

| Candidate | vs seal-500 | vs seal-400 | vs risk | vs ok | vs warn | paper-0 | surface | L\* | C |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| incumbent `#6B5F8A` | **7.7** | 21.9 | 30.3 | 19.7 | 25.0 | 5.41 | 5.79 | 43.0 | 26.4 |
| `#5B4B8A` | 8.0 | 30.5 | 33.7 | 24.0 | 29.6 | 6.97 | 7.45 | 36.2 | 39.5 |
| `#6D4B7A` plum | 3.4 | 27.5 | 24.6 | — | — | 6.69 | 7.15 | — | — |
| `#7A4A6B` mauve | 3.3 | 26.4 | 19.3 | — | — | 6.50 | 6.96 | — | — |
| `#7E3AA8` | 12.4 | 28.5 | 25.8 | 28.2 | 19.5 | 6.42 | 6.87 | 38.4 | 67.7 |
| `#5B21B6` | 14.5 | 35.2 | 38.4 | 27.3 | 34.0 | 8.40 | 8.98 | 31.1 | 88.2 |
| `#6941C6` | 15.4 | 28.8 | 39.3 | 22.9 | 33.5 | 6.19 | 6.62 | 39.3 | 79.6 |
| `#7E22CE` | 15.9 | 29.0 | 30.5 | 32.9 | 24.4 | 6.53 | 6.98 | 37.9 | 96.9 |
| **`#6D28D9`** | **16.6** | **29.2** | **39.0** | **25.8** | **33.2** | **6.64** | **7.10** | 37.4 | 101.2 |
| `#7C3AED` | 19.1 | 24.8 | 39.2 | 24.8 | 32.3 | 5.33 | 5.70 | 43.4 | 102.2 |
| `#9333EA` | 19.6 | 23.4 | 30.9 | 33.3 | 22.9 | 5.03 | 5.38 | 45.0 | 102.5 |

The instinct to move violet *toward* the warm side is wrong: `#6D4B7A` (3.4) and
`#7A4A6B` (3.3) are far worse than the incumbent, because under protanopia they lose
their red component and land on top of the desaturated seal. The escape is **more
chroma and bluer-violet**, not warmer.

**Proposal: `--calm #6D28D9`**, tint `#F7EFFF`.

| | normal | protan | deutan | tritan |
|---|---:|---:|---:|---:|
| `#6D28D9` vs seal-500 | 23.5 | 18.6 | **16.6** | 22.4 |

Contrast: 6.64 on paper-0, 7.10 on surface, 6.14 on `#F0EDF6` / 6.34 on `#F7EFFF` — all
clear AA-normal, and it clears 1.4.11 as a chip border (7.10 against surface).
`#7C3AED` and `#9333EA` separate slightly better (19.1 / 19.6) but drop below 5.5 on
paper-0; `#6D28D9` is the point where both constraints are satisfied.

**16.6 is an improvement, not a solution.** It is still inside the "side by side yes,
from memory no" band. `calm` marks a category the founder specifically wants readable at
a glance, so it must also carry a non-colour signature — a dedicated glyph (the seal
mark itself, small), or a dashed rather than solid rule, applied consistently wherever
autonomous action is shown. Colour should be the redundant cue here, not the carrier.

---

## 4. Colour-vision-deficiency simulation

Machado, Oliveira & Fernandes (2009) severity-1.0 matrices, applied in linear RGB.

#### Simulated values

| Token | normal | protan | deutan | tritan |
|---|---|---|---|---|
| seal-500 | `#1A5E6B` | `#545B6C` | `#49526B` | `#006362` |
| seal-400 | `#5FB0BC` | `#A4AABD` | `#959FBC` | `#27B6B3` |
| seal-50 | `#F1F7F8` | `#F6F6F8` | `#F5F5F8` | `#EFF8F7` |
| ok | `#17795E` | `#76705D` | `#696760` | `#007A71` |
| warn | `#A5670A` | `#7B6C00` | `#8A7B0E` | `#B55858` |
| risk | `#B3261E` | `#534A1B` | `#756916` | `#C60026` |
| info | `#2F58E0` | `#006DE4` | `#005DDD` | `#007B94` |
| calm | `#6B5F8A` | `#55668C` | `#576589` | `#65666E` |
| ok-bg | `#E9F5F1` | `#F4F3F1` | `#F2F2F1` | `#E7F5F4` |
| warn-bg | `#FBF1DF` | `#F6F0DE` | `#F9F3DF` | `#FFEEEC` |
| risk-bg | `#FBEAE8` | `#EDECE8` | `#F1EFE8` | `#FFE8E9` |
| info-bg | `#EAF0FE` | `#ECF1FF` | `#EAEFFE` | `#E6F3F4` |
| calm-bg | `#F0EDF6` | `#ECEEF6` | `#ECEEF6` | `#EFEEF0` |
| paper-0 | `#FAF7F1` | `#F9F7F1` | `#F9F8F1` | `#FCF6F5` |
| ink-1 | `#211C16` | `#1E1C16` | `#1F1D16` | `#231B1A` |
| ink-3 | `#7C7365` | `#777364` | `#797565` | `#80706F` |
| line | `#E3DBCB` | `#DFDACA` | `#E1DDCB` | `#E8D8D6` |
| line-strong | `#D2C7B2` | `#CDC6B1` | `#CFC9B3` | `#D8C3C1` |
| dark paper-0 | `#15130F` | `#14130F` | `#15130F` | `#161212` |
| dark ink-1 | `#EFE7D9` | `#EBE7D8` | `#EDE9D9` | `#F3E4E3` |

The neutrals barely move, which is the palette's real strength: the warm-paper spine is
CVD-invariant. Everything that carries meaning by hue is the problem.

#### The collapsing pairs, stated explicitly

| Pair | Vision type | ΔE00 | Reading |
|---|---|---:|---|
| **warn ↔ risk** | deuteranopia | **7.7** | amber `#8A7B0E` vs red `#756916` — both olive |
| **calm ↔ seal-500** | deuteranopia | **7.7** | `#576589` vs `#49526B` — both blue-slate |
| **calm ↔ seal-500** | protanopia | **8.2** | `#55668C` vs `#545B6C` |
| **ok ↔ seal-500** | tritanopia | **8.5** | `#007A71` vs `#006362` — both teal |
| warn ↔ risk | tritanopia | 12.3 | |
| info ↔ calm | protanopia | 12.8 | |
| info ↔ calm | deuteranopia | 13.0 | |
| info ↔ seal-500 | tritanopia | 13.8 | |
| ok ↔ info | tritanopia | 14.3 | |
| warn ↔ risk | protanopia | 14.7 | |
| ok ↔ risk | protanopia | 16.6 | |
| ok ↔ warn | protanopia | 16.8 | |

Full matrices per vision type:

**protanopia**

| | ok | warn | risk | info | calm | seal |
|---|---:|---:|---:|---:|---:|---:|
| **ok** | — | 16.8 | 16.6 | 39.4 | 26.5 | 20.3 |
| **warn** | 16.8 | — | 14.7 | 59.4 | 42.9 | 35.2 |
| **risk** | 16.6 | 14.7 | — | 52.6 | 37.1 | 28.5 |
| **info** | 39.4 | 59.4 | 52.6 | — | 12.8 | 20.1 |
| **calm** | 26.5 | 42.9 | 37.1 | 12.8 | — | **8.2** |
| **seal** | 20.3 | 35.2 | 28.5 | 20.1 | **8.2** | — |

**deuteranopia**

| | ok | warn | risk | info | calm | seal |
|---|---:|---:|---:|---:|---:|---:|
| **ok** | — | 22.9 | 19.3 | 33.8 | 19.7 | 18.1 |
| **warn** | 22.9 | — | **7.7** | 63.0 | 43.7 | 42.0 |
| **risk** | 19.3 | **7.7** | — | 59.5 | 40.7 | 37.8 |
| **info** | 33.8 | 63.0 | 59.5 | — | 13.0 | 17.5 |
| **calm** | 19.7 | 43.7 | 40.7 | 13.0 | — | **7.7** |
| **seal** | 18.1 | 42.0 | 37.8 | 17.5 | **7.7** | — |

**tritanopia**

| | ok | warn | risk | info | calm | seal |
|---|---:|---:|---:|---:|---:|---:|
| **ok** | — | 50.0 | 58.3 | 14.3 | 24.3 | **8.5** |
| **warn** | 50.0 | — | 12.3 | 51.7 | 25.0 | 47.3 |
| **risk** | 58.3 | 12.3 | — | 60.6 | 30.3 | 53.4 |
| **info** | 14.3 | 51.7 | 60.6 | — | 21.5 | 13.8 |
| **calm** | 24.3 | 25.0 | 30.3 | 21.5 | — | 22.5 |
| **seal** | **8.5** | 47.3 | 53.4 | 13.8 | 22.5 | — |

#### Can ok / warn / risk still be told apart?

**No — `warn` and `risk` collapse to ΔE00 7.7 under deuteranopia, and no colour pair
fixes it within this system.** Every alternative was tested:

| warn | vs risk `#B3261E` (normal / protan / deutan / tritan) | min |
|---|---|---:|
| `#A5670A` (current) | 25.2 / 14.7 / 7.7 / 12.3 | 7.7 |
| `#9E6100` | 24.5 / 12.6 / 5.2 / 11.2 | 5.2 |
| `#9C5F00` | — | 4.7 |
| `#8A5A00` | 25.7 / 9.5 / 1.5 / 12.6 | **1.5** |
| `#B4730F` | 28.3 / 19.4 / 12.6 / 15.4 | 12.6 |

**Darkening `warn` to fix its contrast failure (B6) makes the deuteranopia collapse
worse** — 7.7 → 5.2 at `#9E6100`, → 4.7 at `#9C5F00`. The two defects pull in opposite
directions. Lightening to `#B4730F` improves separation to 12.6 but drops contrast on
`warn-bg` to 3.47, failing AA-normal outright. There is no amber that satisfies both.

Moving `risk` instead does work — `#9F1239` crimson raises warn↔risk to 17.0 deutan
(min 14.0) — **but it then collides with the achromatic `info` at ΔE00 4.6 under
protanopia**, because a dark crimson simulates to a near-neutral. Given the §3 decision
to make `info` achromatic, `risk` must stay `#B3261E` (which sits 11.6 from an
achromatic info).

**Conclusion: `warn` and `risk` must be distinguished by icon or shape, and colour must
be redundant.** This is SC 1.4.1, and no palette edit substitutes for it.

`ok` also touches the seal at ΔE00 **8.5** under tritanopia. Moving `ok` to a true green
(`#15803D`) raises that to 10.5 and raises ok↔seal in normal vision from 19.5 to 29.8 —
attractive until the rest of the set is checked: it drops **ok↔warn to 6.5 and ok↔risk
to 6.7** under red-green deficiency, worse than the pair it fixes. The green-teal `ok` is
what is currently protecting the red/amber/green triad. **Leave `ok` at `#17795E`** and
accept the tritan collision (tritanopia prevalence ~0.01% versus ~6% of men for
deutan/protan).

#### Can `calm` still be told apart from the seal and from `info`?

No, on both counts, with the incumbent values — `calm`↔seal 7.7 (deutan), `calm`↔`info`
12.8 (protan), and their fills 2.8 and 2.6. With the §3 proposals (`calm #6D28D9`,
`info` achromatic) both recover: **calm↔seal 16.6, calm↔info 20.0** worst-case.

#### The chip fills carry no information at all

| Pair | normal | protan | deutan | tritan | min |
|---|---:|---:|---:|---:|---:|
| ok-bg vs info-bg | 9.6 | 7.5 | 7.4 | **1.2** | **1.2** |
| ok-bg vs risk-bg | 14.2 | **1.8** | 3.0 | 17.3 | **1.8** |
| info-bg vs seal-50 | 6.3 | 5.5 | 5.5 | **2.0** | **2.0** |
| ok-bg vs seal-50 | 4.0 | 2.2 | 2.3 | 2.2 | **2.2** |
| info-bg vs calm-bg | 4.3 | 2.6 | 2.9 | 6.5 | **2.6** |
| calm-bg vs seal-50 | 6.8 | 3.3 | 2.8 | 5.5 | **2.8** |
| warn-bg vs risk-bg | 9.3 | 5.9 | 5.2 | **3.0** | **3.0** |
| risk-bg vs seal-50 | 10.9 | 3.8 | 5.2 | 15.0 | **3.8** |
| ok-bg vs calm-bg | 10.4 | 5.1 | **4.5** | 7.3 | **4.5** |
| risk-bg vs calm-bg | 7.0 | 6.0 | 7.5 | 8.9 | **6.0** |
| ok-bg vs warn-bg | 10.2 | 6.9 | 8.0 | 14.4 | **6.9** |
| warn-bg vs calm-bg | 12.7 | 12.1 | 12.9 | 6.7 | **6.7** |
| risk-bg vs info-bg | 11.0 | 8.7 | 10.6 | 17.1 | **8.7** |
| warn-bg vs seal-50 | 9.8 | 9.1 | 10.3 | 12.2 | **9.1** |
| warn-bg vs info-bg | 14.8 | 14.8 | 16.0 | 13.7 | **13.7** |

Twelve of fifteen pairs fall below 10 in at least one vision type; six fall below 5.
**Design rule: a chip's fill is decoration. Every chip needs a label and an icon.**

---

## 5. Dark-mode parity

| Role | light | dark | delta | verdict |
|---|---:|---:|---:|---|
| ink-1 on ground | 15.81 | 15.11 | −0.70 | parity |
| ink-2 on ground | 8.54 | 9.25 | +0.71 | parity |
| ink-3 on ground | 4.37 | 5.09 | +0.73 | parity (both weak; light fails) |
| ink-1 on card | 16.90 | 14.34 | **−2.56** | **dark worse** — still comfortable |
| ink-2 on card | 9.13 | 8.79 | −0.35 | parity |
| ink-3 on card | 4.67 | 4.84 | +0.17 | parity |
| primary on ground | 6.87 | 7.44 | +0.57 | parity |
| primary on card | 7.35 | 7.06 | −0.29 | parity |
| button label on primary fill | 7.35 | 7.44 | +0.09 | parity — **only if the dark label is `#15130F`, not white** |
| line on ground | 1.29 | 1.29 | +0.01 | parity (both fail) |
| line on card | 1.38 | 1.23 | −0.15 | parity (both fail) |
| card lift (surface vs ground) | 1.07 | 1.05 | −0.02 | parity (both near-invisible) |
| sunk row (paper-1 vs surface) | 1.15 | 1.09 | −0.05 | parity (both near-invisible) |

**The ink and seal roles keep parity; nothing regresses meaningfully.** `ink-1` on a card
is the only role losing more than a point and it lands at 14.34.

**Roles that get meaningfully worse are the ones dark mode does not define:**

1. **The whole semantic layer** (B4). Light-mode semantics on dark paper-1 give
   2.69–3.81; `risk` fails even AA-large. Delta versus light: −1.5 to −2.9.
2. **The primary button label** (B5). White on `seal-400` is 2.49 against 7.35 in light
   — a −4.86 regression if ported mechanically. Fixed by using `paper-0 #15130F` as the
   label (7.44).
3. **`ink-3` on `paper-2`** (4.43) is the one dark ink that fails where its light
   counterpart on `surface` (4.67) passes.
4. **Card lift.** `paper-1` against `paper-0` is **1.05** in dark against 1.07 in light.
   Both are invisible; light gets away with it because a card can cast a shadow on paper
   and dark cannot. Dark cards need the border token below, not elevation.

### Derived dark-mode semantic set

Hue held from the light value, L\* raised until AA-normal clears on `paper-1 #1D1813`:

| Role | light | **dark fg** | on paper-0 | on paper-1 | on paper-2 | chip fill | ink-1 on fill |
|---|---|---|---:|---:|---:|---|---:|
| ok | `#17795E` | **`#369174`** | 4.82 | 4.58 | 4.19 | `#153127` | 11.40 |
| warn | `#A5670A` | **`#B5751D`** | 4.88 | 4.64 | 4.24 | `#382919` | 11.41 |
| risk | `#B3261E` | **`#E1513F`** | 4.82 | 4.57 | 4.18 | `#3F2621` | 11.32 |
| calm | `#6D28D9` | **`#A05CFF`** | 4.83 | 4.59 | 4.20 | `#2E293A` | 11.44 |
| info | achromatic | **`#EFE7D9`** (ink-1) | 15.11 | 14.34 | 13.12 | none | — |

Each dark fg also clears 1.4.11 as a chip border against `paper-1` (4.57–4.64), which
the dark chip fills themselves do not (1.25–1.27) — so **dark chips need a border**, not
just a fill.

Separation of the derived dark set is *worse* than light, because raising L\* toward the
ground compresses the differences:

| Pair | normal | protan | deutan | tritan | min |
|---|---:|---:|---:|---:|---:|
| warn vs risk | 23.7 | 10.0 | **3.2** | 10.2 | **3.2** |
| ok vs risk | 57.3 | 13.5 | 5.0 | 64.1 | **5.0** |
| ok vs seal-400 | 19.9 | 22.0 | 20.6 | 11.6 | **11.6** |
| risk vs info | 25.5 | 14.1 | 17.4 | 24.9 | **14.1** |
| info vs calm | 37.6 | 36.3 | 36.7 | 14.5 | **14.5** |

`warn`↔`risk` degrades from 7.7 light to **3.2 dark**. The icon requirement from §4 is
not optional in dark mode — it is the only thing separating a warning from a danger.

---

## 6. Every failure, with its fix and the recomputed number

| # | Failure | Now | Fix | Then |
|---|---|---:|---|---:|
| B1 | Focus ring on light primary fill | 1.00 | Two-part ring: 2px `paper-0`/`surface` gap, then 2px `seal-500` outside it — the ring is then measured against the page ground. Inner alternative: white inner ring on the fill. | **6.87** vs ground / **7.35** white-on-fill |
| B1d | Focus ring on dark primary fill | 1.00 | Same, gap in dark `paper-0`; inner ring `#211C16` on the fill | **7.44** / **6.78** |
| B2 | No control-border token, light | 1.29–1.67 | Add `--line-control #8F8674`. Keep `line`/`line-strong` for decorative rules only. | **3.37** paper-0 / **3.14** paper-1 / **3.60** surface |
| B2d | No control-border token, dark | 1.12–1.29 | Add dark `--line-control #736B61` | **3.54** / **3.36** / **3.07** |
| B3 | Active-nav fill invisible | 1.08 / 1.01 | Selection cannot be a tint. Add a 3px `seal-500` left rail and set the label to `seal-700`; keep `seal-50` as decoration only. | rail **7.35** vs surface, **6.87** vs paper-0, **6.79** vs the fill; label **10.18** |
| B3d | Dark active-nav | — | 3px `seal-400` rail on `#123138` fill | rail **5.53** |
| B4 | No dark semantics | 2.69–3.81 | Adopt the derived set in §5 | **4.57–4.64** on paper-1 |
| B5 | White on dark primary fill | 2.49 | Dark button label is `paper-0 #15130F` | **7.44** |
| B6 | `warn` as text | 4.13 / 4.32 | Split the token. `--warn` `#A5670A` for dots, borders and icons (1.4.11 needs 3.0 — it has 4.13). `--warn-text` `#9C5F00` for any warn-coloured *word*. **Better still: chip labels use `ink-1`, not the semantic colour** (see B11) — then `--warn-text` is only needed for inline prose. | `#9C5F00`: **4.63** own-bg / **4.85** paper-0 / **4.52** paper-1 / **5.18** surface. `ink-1` on warn-bg: **15.09** |
| B7 | `ink-3` fails as placeholder | 4.07 / 4.37 / 4.43 | Light `ink-3` → **`#736B5D`**; dark `ink-3` → **`#918879`**. (Disabled text is exempt from 1.4.3; placeholder is not, so the token must clear it.) | light **4.92**/**4.59**/**5.26**; dark **5.30**/**5.03**/**4.61** |
| B8 | `calm` collapses into the seal | 7.7 | `--calm` **`#6D28D9`**, tint `#F7EFFF`, plus a non-colour signature | min ΔE00 **16.6** vs seal-500, **29.2** vs seal-400; contrast **6.64**/**7.10**/**6.34** |
| B9 | `info` chip == selected row | 6.3 (2.0 tritan) | Retire the blue. `--info` = `ink-1` mark + `#8F8674` rule, no tinted fill | min ΔE00 **≥ 20.3** vs everything; contrast **15.81** |
| B10 | `warn`/`risk` under deutan | 7.7 (3.2 dark) | Unfixable by colour — every amber tested makes it worse or fails contrast. Mandate distinct icons; colour is redundant. | — |
| B11 | Chip fills carry nothing | ΔE00 1.2–4.5 | Chip = `ink-1` label + coloured dot + 1px border in the semantic colour + tint fill. Text contrast then comes from ink-1 on the tint, and the colour only has to clear the 3.0 non-text bar, which every semantic already does. | `ink-1` on the five tints: **14.52–15.13**; borders vs surface **4.62–9.13** |

### Resulting token deltas

| Token | Was | Becomes |
|---|---|---|
| `--ink-3` (light) | `#7C7365` | `#736B5D` |
| `--ink-3` (dark) | `#8E8576` | `#918879` |
| `--line-control` (light) | *absent* | `#8F8674` |
| `--line-control` (dark) | *absent* | `#736B61` |
| `--warn-text` (light) | *absent* | `#9C5F00` |
| `--info` / `--info-bg` | `#2F58E0` / `#EAF0FE` | `ink-1` + `--line-control` rule; no fill |
| `--calm` / `--calm-bg` | `#6B5F8A` / `#F0EDF6` | `#6D28D9` / `#F7EFFF` |
| `--ok` / `--warn` / `--risk` | unchanged | unchanged — see B10, B6 |
| dark `--ok/--warn/--risk/--calm` | *absent* | `#369174` / `#B5751D` / `#E1513F` / `#A05CFF` |
| dark chip fills | *absent* | `#153127` / `#382919` / `#3F2621` / `#2E293A` |

Everything else in ADR 0042 stands as locked.

### Rules the tokens cannot enforce, which the kit must

1. Focus rings never sit directly on a fill of the same colour — always a ground-coloured gap.
2. Selection is a rail plus a label colour, never a tint alone.
3. A chip's label is `ink-1`, not the semantic colour.
4. `warn` and `risk` always carry distinct icons.
5. `calm` always carries its own glyph.
6. `line`/`line-strong` never border a control.

---

## 7. Tightest margins

| Pair | ratio | threshold | margin |
|---|---:|---:|---:|
| focus ring vs primary fill | 1.00 | 3.0 | −2.00 |
| active-nav fill vs surface | 1.08 | 3.0 | −1.92 |
| dark line on dark paper-1 | 1.23 | 3.0 | −1.77 |
| line on paper-0 | 1.29 | 3.0 | −1.71 |
| dark line on dark paper-0 | 1.29 | 3.0 | −1.71 |
| line on surface | 1.38 | 3.0 | −1.62 |
| line-strong on paper-0 | 1.56 | 3.0 | −1.44 |
| line-strong on surface | 1.67 | 3.0 | −1.33 |
| ink-3 on light paper-1 | 4.07 | 4.5 | −0.43 |
| warn on warn-bg | 4.13 | 4.5 | −0.37 |
| warn on paper-0 | 4.32 | 4.5 | −0.18 |
| ink-3 on light paper-0 | 4.37 | 4.5 | −0.13 |
| ink-3 on dark paper-2 | 4.43 | 4.5 | −0.07 |
| warn on surface | 4.62 | 4.5 | +0.12 |
| ink-3 on light surface | 4.67 | 4.5 | +0.17 |
| ok on ok-bg | 4.78 | 4.5 | +0.28 |
| ink-3 on dark paper-1 | 4.84 | 4.5 | +0.34 |
| ok on paper-0 | 4.99 | 4.5 | +0.49 |
| calm on calm-bg | 5.00 | 4.5 | +0.50 |
| ink-3 on dark paper-0 | 5.09 | 4.5 | +0.59 |

Five of the passing margins are under +0.5. `warn on surface` at +0.12 and `ok on ok-bg`
at +0.28 will not survive a rounding change or a hover state.

---

## 8. Open questions this raises for the founder

1. **`--calm` at ΔE00 16.6 is better, not good.** Accept `#6D28D9` plus a mandatory glyph,
   or drop the sixth hue and mark autonomous action structurally (a dashed seal-tinted
   rule and the seal mark)? The second is more robust and costs a colour.
2. **`--info` going achromatic removes a colour from the kit.** Confirm that an
   informational note reading as "page-coloured with a rule" is the intended look — this
   is what ADR 0042 anticipated but it was never seen on screen.
3. **`--ok` stays green-teal at ΔE00 19.5 from the brand in normal vision.** That is thin
   for brand-versus-status. Moving it makes CVD worse (§4), so the alternative is to stop
   using the seal for anything that could be read as a status.

---

## 9. Method and reproducibility

- **WCAG 2.1 relative luminance and contrast ratio** — sRGB → linear (the 0.04045 /
  12.92 piecewise transfer), coefficients 0.2126/0.7152/0.0722, `(L1+0.05)/(L2+0.05)`.
  Validated: black on white = **21.00**, `#767676` on white = **4.5422**.
- **APCA 0.98G-4g** — exponent 2.4, soft black clamp at 0.022^1.414, the BoW/WoB
  polarity split. Validated: black on white **+106.04**, white on black **−107.88**,
  `#888888` on white **+63.06**.
- **CIELab / CIEDE2000** — sRGB → XYZ (D65, 2°) → Lab; full ΔE00 with the G chroma
  correction, the T rotation term and R_T. Validated against **all seven** Sharma,
  Wu & Dalal reference vectors to within 1e-4 (2.0425, 2.8615, 3.4412, 1.0000, 1.2644,
  2.0373, 0.9082 — all exact).
- **CVD simulation** — Machado, Oliveira & Fernandes (2009) severity-1.0 matrices applied
  in linear RGB. Sanity check: pure red → `#A39000` and pure green → `#EFD63A` under
  deuteranopia, as expected.
- **Derived fixes** — hue and chroma held in LCh(ab), L\* stepped by 0.5 until the
  threshold clears, chroma binary-searched back into the sRGB gamut. Every "then" figure
  in §6 is the recomputed ratio of the derived value, not a target.
- Script: `palette_check.py` + `fixes.py`/`fixes2.py`/`fixes3.py`, run in the session
  scratchpad on 2026-08-29. No third-party dependencies. Nothing was committed to the
  repo besides this report.

### Scope actually covered, and what was not

- Covered: all 9 ink-on-ground pairs per theme, primary on all six grounds, both button
  label options, all 15 semantic-foreground pairs in light, the semantic layer ported to
  dark, both line tokens against all three grounds per theme, the focus ring against five
  backgrounds, five chip dots, seven fills, the full 6×6 semantic ΔE00 matrix in four
  vision types, all 15 chip-fill pairs in four vision types, 13 replacement candidates,
  and 13 dark-parity roles.
- **Not covered, and deliberately so:** this is arithmetic on colour values, not a
  rendering test. It does not account for sub-pixel antialiasing at small type sizes,
  font weight (a 300-weight `ink-3` at 13px will read worse than its 4.37 suggests),
  monitor gamma, or the founder's stated instruction to *"decide it on screen, not in a
  table"* for `--calm`. The `#6D28D9` recommendation is the best value the numbers
  support; it still needs the on-screen judgement ADR 0042 asked for.
- **Not covered:** hover, pressed and disabled state variants; the `seal-tint` and
  `seal-ring` alpha values from ADR 0042 (they composite against a ground and were not
  measured); `ink-4`; the seal ramp steps 100/200/300/800/900 in use.

---

*Related: [[0042-iznik-seal-and-warm-charcoal]] · `06-pages/MAKEOVER-VERDICTS.md`
(§"Still open after this review", item 2).*
