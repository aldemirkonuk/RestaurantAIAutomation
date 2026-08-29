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

Shared constraints: İznik `#1A5E6B`/`#5FB0BC` + ink + paper + Warm Charcoal only;
every candidate proven at 96/32/24px on both grounds; at least two per wave must work
as a circular **seal stamp** so the mark can be the thing that lands when an approval
completes. Candidate sheets are published on the logo-search canvas (link in the
review-trail row when published) and the founder's verdicts will be recorded here.

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
