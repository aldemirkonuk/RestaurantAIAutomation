# 082 — Mudavym brand marks in three dimensions (Blender)

Founder verdict on the first pass, 2026-08-27: *"these are super simple put more
effort."* Fair. That pass was three primitives under two lights. This is the rebuild:
**six marks**, real materials, and framing computed rather than guessed.

Rendered headless through the Blender MCP CLI bridge — Blender 5.2.1 LTS, Cycles on
Metal GPU, 220–280 samples, denoised, depth of field throughout.

## The six

| File | Mark | Belongs to | What it is |
|---|---|---|---|
| `seal-teal.png` | The Seal | 081 → 083 | Wax pressed with the M over the double rule. Rendered in a candidate seal colour (deep teal) — feeds the open colour question. |
| `seal-oxblood.png` | The Seal, warm | 081 → 083 | The identical press in deep oxblood, so the colour decision can be judged on the same object. |
| `fullstop.png` | The Full Stop | 081 → 083 | The wordmark printed in ink with its full stop **debossed** into cotton stock, under one hard raking light — the only way a deboss exists. |
| `meter.png` | The Meter | 078 (the one kept) | Five bars dipping into an M, four in brushed steel, one in brass. The logo obeying "grayscale data, chroma = anomaly." |
| `rule.png` | The Double Rule | 081 → 083 | Brass inlaid in a dark slab — the rule that closes a ledger column, as an object. |
| `table.png` | Set the Table | 079 → 083 | *"Set the table. We'll keep the books."* Porcelain, linen, and the two rules laid as cutlery. |

`ember.png` and `seal.png` are the superseded first pass, kept only until the founder
has seen the comparison.

## What actually changed from the first pass

- **Framing is computed, not eyeballed.** Camera distance is derived from the subject
  width and the lens' field of view, and every camera aims through a `TRACK_TO`
  constraint at a focus empty. The first pass put the camera 1.9 units from a subject
  needing 6.3 — which is why the seal arrived as a macro of one letter, and the full
  stop as a white blur.
- **Materials do something.** Subsurface scattering in the wax (it now reads as wax,
  not ceramic), brushed anisotropic metal, porcelain with a coat, and paper carrying
  two octaves of noise.
- **Paper noise moved into object space.** In generated space, on a 90-unit ground
  plane, one "fibre" was roughly a metre across — which is why the paper read as a
  seamless white void twice. Driving the noise from object coordinates puts the scale
  in world units and gives real tooth.
- **Lighting has falloff.** Dark world plus a hard raking key, rather than a bright
  even world that flattened every relief.
- **Type is printed, not moulded.** Flat text with a matte ink material instead of
  extruded, bevelled letters sitting on the surface like plastic.

## Declared honestly

- The walnut in `rule.png` reads glossier than wood should, and its grain is absent —
  the same object-space noise fix applied to the paper has not been applied to it.
- `table.png`'s linen has no visible weave for the same reason.
- The seal colours are **candidates, not decisions** — the open question is the founder's
  ("one unique colour that is outside the colouring of themes among other startups"),
  and the swatch board that answers it properly lives on board 083.
- Three earlier iterations were rejected and re-rendered rather than shipped: a
  pink-cookie seal, a ribbed-egg candle, and a cropped meter. A `space_character`
  typo silently killed `rule` and `table` in one pass; both were re-rendered.
- Scene code lives in `scratchpad/marks_v{2..5}.py` for this session; the working
  `.blend` is disposable.


## Generated imagery (higgsfield, 2026-08-27)

Three scenes the renderer could not give us — real paper tooth, real wax, real room —
generated on higgsfield's `z_image` at 0.15 credits each (total **0.45**).

| File | What it is |
|---|---|
| `ledger-scene.png` | The seal on a leather ledger at closing time. Unprompted, it drew the 083 lockup exactly: a serif M above two rules, in İznik teal. |
| `seal-press.png` | The brass stamp at the moment of contact — hold-to-approve made physical. |
| `back-office.png` | A warm-charcoal back office after service, one teal glow. Became the evidence for the founder's dark-ground decision. |

**Budget, declared.** Balance was 1.88 credits on a free plan. Recraft V4.1 vector — the
model actually built for logos, which takes a hex palette — costs 2.5 and was
unreachable. Nano Banana (1.0), which the founder authorised, **rejected the request:
"Requires basic plan or higher"** — so the authorised spend was not made. `z_image` at
0.15 was the only model the free plan would run; four more were requested and two came
back (the other two hit a 429 rate limit). Spent 0.45 of the ~1.0 authorised; balance
1.43. Proper vector logo exploration still needs a plan upgrade.

| 082 | mudavym-3d-marks | Do the direction motifs survive becoming physical objects — seal, full stop, meter, rule, table? | null | brand, mudavym, blender, 3d, render, seal, fullstop, meter, rule, table, od-106 |
