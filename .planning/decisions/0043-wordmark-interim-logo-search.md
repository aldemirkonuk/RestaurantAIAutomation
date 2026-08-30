# 0043 — Ship a Fraunces text wordmark now; run the logo search in the open

- **Status:** Locked (the interim wordmark) · the final mark is **open** — register row OD-111
- **Date:** 2026-08-30
- **Decider:** Aldemir (founder), 2026-08-30
- **Keywords:** logo, wordmark, Fraunces, brand mark, seal stamp, Meter, dev.mudavym.com, OD-106, OD-111
- **Links:** [[0042-iznik-seal-and-warm-charcoal]], [[0001-mudavym-single-entity]], sketch `054-mudavym-instrument` (the Meter), sketch `059-mudavym-house` (seal-as-stamp), [OPEN-DECISIONS.md](OPEN-DECISIONS.md)

## Context

The brand rollout to dev.mudavym.com needs *something* where the logo goes, and the
logo is genuinely undecided: the 2026-08-27 wave review cut **every** logo from sketch
053 and kept exactly one survivor — sketch 054's "Meter" (five bars hung from a top
rail spelling an M; at rest all ink, one bar carrying the signal colour when the
product has something to say). Sketch 059 separately established that the mark and the
approve interaction should be one object: hold-to-approve completes into the seal
landing.

On 2026-08-30 the founder called the interim: *"we haven't decided on the logo design —
so for now let's stick with simple text for Mudavym. It will basically be the name
with a font."* And directed the search itself to continue: *"look for new logo in
ADR 43, deploy agents."*

## Options considered (interim mark)

1. **Text wordmark, no icon.** Honest about the state of the decision; nothing to
   unlearn later. Costs: the collapsed 56px rail and the favicon still need a glyph.
2. **Ship the Meter as-is.** It survived review — but it was kept as a *candidate*,
   not chosen, and shipping it would quietly promote it past the search.
3. **Keep the wine-glass mark.** It is the WineOps identity on a platform that is no
   longer a wine app; every day it ships it argues against ADR 0001.

## Decision

**Option 1.** The interim brand is the word **"Mudavym" set in Fraunces 600** — the
serif the wave verdicts kept as the house voice (*"serif speaks only when the product
speaks"*; a wordmark is the product speaking). Where a single glyph is unavoidable
(collapsed rail, favicon, app icon) it is **"M."** in the same face, the full stop in
the İznik seal colour — the double-rule/full-stop device from sketch 057 doing interim
duty. The wine-glass `BrandMark` is retired everywhere.

Font choice was put to the founder as a three-way (Fraunces / Plus Jakarta Sans 800 /
both-behind-a-toggle) and Fraunces was chosen directly, 2026-08-30.

## The search (open — OD-111)

Two agent waves ran 2026-08-30, filed under this ADR, reviewed by elimination like
every brand wave before them:

- **Wave: instrument** — evolutions of the Meter lineage: meters, gauges, rules,
  ticks, counters, stamps. Six candidates.
- **Wave: house** — the müdavim story: the set table, the door, the ledger line, the
  monogram, the wax seal. Six candidates. Wine imagery explicitly banned.
- **Wave: lineage** (added later on 2026-08-30, produced by session -29, folded in
  here) — the 054/057/059 sketches' own marks re-cut as single-colour standalone
  SVGs: Full Stop, Double Rule M, Stop Tile, Seal, Meter — five candidates, each
  with a solid cut and (bar the tile) a ≥64px display cut, pre-screened at a true
  16px rasterisation against all five criteria with an honest ranking (full-stop
  first, meter last — kept in the round only by the founder's wave-1 keep). The
  058 ledger-scene render rides along as an exhibit, not a candidate.

Shared constraints: İznik `#1A5E6B`/`#5FB0BC` + ink + paper + Warm Charcoal only;
every candidate proven at 96/32/24px on both grounds; at least two per wave must work
as a circular **seal stamp** so the mark can be the thing that lands when an approval
completes. Candidate sheets are published for review:
<https://claude.ai/code/artifact/a2dc2d0b-2af5-43b0-a77d-003256b2b62c> — seventeen
marks across three waves side by side, each proven at 96/32/24px (lineage also at
16px) on paper and charcoal. The founder's verdicts will be recorded here.

## The withdrawn slab lineage (2026-08-29 → 2026-08-30) — absorbed from the retired `0043-mudavym-mark.md`

A parallel session ran a full mark selection on 2026-08-29 that this ADR now absorbs,
because its id collided with this file and its outcome feeds OD-111 directly.

**What happened, in order.** The founder rejected the three earlier survivors, rejected
an Ottoman *tughra* as "too Turkish", and chose an angular two-pillar monogram from a
generated batch — then specified four craft corrections. It was redrawn as one closed
uniformly-stroked path (`M15 86 L15 14 L85 86 L85 14 Z`), which satisfied three
corrections structurally. On 2026-08-30 the founder withdrew the form: **it reads as
the Visual Studio Code mark**, and the resemblance would follow the brand permanently.
Its replacement — a slab monogram (M crossed by a diagonal, letterpress grain, 1024px
raster) — was never committed; three sessions searched every ref and found nothing,
a hand-trace was attempted and abandoned, and on 2026-08-30 the founder **skipped the
slab entirely: "selection round instead"** (relayed by session -29). The canvas above
is therefore the single vehicle for the logo decision.

**What survives as OD-111 selection criteria** — every one of these killed a candidate
once already, so the elimination round should apply them up front:

1. **Counters and traps must survive 16–24px** — sliver gaps clog; nothing under ~6
   grid units of negative space survives a favicon.
2. **No asymmetric cutouts** competing with the silhouette.
3. **Stroke weight must not drift** between elements — best enforced by construction,
   not adjustment.
4. **The first read must be M** — the withdrawn slab resolved as "N" first; the bowtie
   resolved as VS Code first. Check the first read with someone outside the project.
5. **No lookalike liabilities** (VS Code) and **no costume** ("too Turkish").

**Also carried forward:** the two-cut idea (a display cut with character at ≥64px, a
solid cut for small sizes) — my candidate sheets' separately-drawn 32/24px variants
are the same principle.

**One recorded conflict.** The absorbed ADR paired the mark with a **Plus Jakarta Sans
800** wordmark (2026-08-29); this ADR records the founder choosing **Fraunces 600**
directly on 2026-08-30. The later, direct call stands — Fraunces ships — but the
pairing question deliberately reopens when the final mark is chosen, since the
absorbed ADR's reasoning (humanist sans to soften an industrial mark) was about a
mark that no longer exists.

## Consequences

- **Easier:** dev.mudavym.com ships a coherent identity today without pre-empting the
  mark; the search has a permanent record and a review surface.
- **Harder / given up:** two typefaces now load in the app (Fraunces joins Plus
  Jakarta Sans + DM Sans); the favicon "M." is deliberately unremarkable until the
  mark lands.
- **Revisit when:** the founder eliminates down to a mark on the candidate sheets —
  that verdict supersedes the interim wordmark's glyph duty (the wordmark itself may
  well survive beside the chosen mark).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-30 | Aldemir (founder) | Interim = text wordmark ("the name with a font"); Fraunces picked from a three-way; search waves ordered under this ADR |
| 2026-08-30 | — | Both waves delivered; 12 candidates published on the logo-search canvas, awaiting elimination |
| 2026-08-30 | Aldemir (founder, relayed by session -29) | Slab monogram SKIPPED — "selection round instead"; the canvas is the sole vehicle. Retired `0043-mudavym-mark.md` absorbed as the slab-lineage section |
| 2026-08-30 | — | Wave: lineage folded in (5 sketch-derived marks from session -29, pre-screened vs all five criteria + ledger-scene exhibit) — 17 candidates on the canvas |
