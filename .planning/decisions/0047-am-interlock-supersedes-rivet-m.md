# 0047 — The mark is the trued A+M interlock; the Rivet M is withdrawn the same day

- **Status:** **Locked and FULLY EXECUTED 2026-08-31** — the founder eyeballed the branch deployment and said go; PR #172 merged the interlock to main (13:41Z, merge commit) and the production deployment was verified serving it (favicon carries the interlock geometry + İznik tile on the wire). On the founder's same order, `dev.mudavym.com` was re-pinned to `feat/mudavym-brand` (`gitBranch` set via the Vercel API — it had silently become main's production alias at the #163 merge), restoring the dev-first preview world; production now answers at `restaurant-ai-automation-web.vercel.app`. Note: as a branch-preview domain, dev.mudavym.com sits behind Vercel deployment protection — open for the founder's logged-in browser, gated for visitors; loosening that is the founder's own protection setting
- **Date:** 2026-08-30
- **Decider:** Aldemir (founder), 2026-08-30 — "the rivet m wasn't the one I wanted, here is what I wanted", plus three AskUserQuestion answers recorded below
- **Keywords:** logo, A+M interlock, letterpress, print trued, Rivet M withdrawn, OD-111, warm wave, dev-first
- **Links:** [[0045-rivet-m-and-full-go]] (supersedes its §1–2: mark identity and the colour exception; its full-go, claims and protocol stand), [[0043-wordmark-interim-logo-search]] (the slab lineage, un-skipped), [[0042-iznik-seal-and-warm-charcoal]] (implementation values), `evidence/0047-mark-canvas-note.md` (the founder's canvas, geometry preserved)

## Context

Hours after ADR 0045 recorded the Rivet M and it shipped to production main, the
founder pasted a Claude Design canvas mid-session: *"the rivet m wasn't the one I
wanted — here is what I wanted."* The canvas holds two sheets: a 13-candidate
rounded **"warm" wave** (2a–2m, review-by-elimination, never run) and the fully
specced **"print, trued" sheet** — the letterpress A+M interlock that ADR 0043's
absorbed history recorded as *skipped* ("no raster, no trace, selection round
instead"). The founder has now supplied the trace himself, trued: the slab
lineage is un-skipped and finished.

## Decision — three answers, 2026-08-30

1. **The mark is the trued A+M interlock.** An A and an M interlocked into one
   piece of type — Aldemir's house and the müdavim's M sharing the same strokes —
   as 7 straight-cut polygons plus 4 counter ticks (tally marks, visits counted).
   Grid 483×574 · one 34° rake (1:0.68) · stems 72/71, leg 81, tip-leg 52, gutter
   29 · clearspace one stem · minimum 24px, ticks read from 32px. Geometry
   verbatim in the evidence note and in `BrandMark.tsx`. The **warm wave stays
   open** as a side exploration — no elimination was run, none of 2a–2m was
   chosen, and the sheet remains reviewable.
2. **Rollout: dev first, main held.** The swap shipped on `feat/mudavym-brand`
   (`b65f14a0`) — the branch dev.mudavym.com pins — so the founder can judge the
   interlock in the chrome. **Main keeps the Rivet M until he says go**; the
   forward-merge PR is prepared but not fired.
3. **Implementation wears the locked 0042 values.** The sheet's `#5FB08C`
   dark-seal and `#1B1511` charcoal are recorded as sketch drift, not adopted:
   the mark renders `wine-600 #1A5E6B` on light, `wine-400 #5FB0BC` on dark,
   paper knockouts on tiles. The mark is **monochrome by design**, so ADR 0045's
   brass/paprika mark-only exception **dies with the Rivet M** — no non-palette
   colours remain anywhere.

Also from the sheet's lockups, implemented: the wordmark becomes **"Mudavym."**
— the full stop in seal colour, the 081 device joining the wordmark permanently.

## What was screened, honestly

The five OD-111 criteria, applied to the chosen mark as they were to all 17:
uniform-width strokes by construction (C3); bilateral it is not — the interlock is
deliberately asymmetric type, and the withdrawal criterion C2 targeted asymmetric
*cutouts* competing with a silhouette, which the ticks are not (they are seated
counters). C1: counters are open wedges; the sheet proves the ladder to 16px tall
with min-size called at 24px — below that the tile treatment carries. **C4 is the
recorded risk:** ADR 0043 noted the withdrawn slab "resolved as N first", and this
trued cut keeps that first-read hazard — A+M read as one glyph can land as N/AV
before M. The founder chooses it knowing the history; the mitigation is the
lockup (mark never far from the name in early life). C5: the interlock shares
nothing with the VS-Code bowtie (that was a different, two-pillar mark); nearest
genre is letterpress printers' monograms — crowded but unowned.

## Consequences

- **Easier:** the mark, the wordmark's full stop and the seal palette are now one
  system with zero exceptions; favicon/PWA/maskable/badge all regenerated from
  one geometry.
- **Harder / given up:** production main carries a mark the founder has already
  withdrawn until the gate opens — anyone screenshotting production today
  captures a dead mark; ADR 0045's ranking artifact needed a re-verdict banner.
- **Revisit when:** the founder eyeballs dev and fires the main merge (flip this
  ADR's rollout line), or runs the warm-wave elimination (which would supersede
  this mark only by an explicit new ruling).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-30 | Aldemir (founder) | Rivet M withdrawn ("wasn't the one I wanted"); canvas pasted with the trued A+M interlock |
| 2026-08-30 | Aldemir (founder) | Three-way answered: A+M interlock is the mark · dev first, main held · locked 0042 values (sheet's palette drift not adopted) |
| 2026-08-30 | — | Swap implemented on `feat/mudavym-brand` `b65f14a0`: BrandMark, favicon, icon-192/512, maskable logo, badge; tsc clean, 423/423 tests, build passes |
| 2026-08-31 | — | Rollout truth established: Vercel had skipped `b65f14a0`'s build (retriggered, now READY), and `dev.mudavym.com` was found aliased to MAIN's production deployment since the #163 merge — the dev-first gate needs the branch deployment link or a founder domain re-pin. Interlock verified serving on the branch deployment (favicon screenshot, paper-on-seal tile) |
| 2026-08-31 | Aldemir (founder) | **Gate opened**: "go merge the interlock forward and re-pin dev." PR #172 merged (13:41Z) after a branch update + green CI Complete; Railway correctly SKIPPED (merge touched only apps/web); production deployment verified serving the interlock on the wire. dev.mudavym.com re-pinned to the brand branch via the Vercel domains API, verified serving the branch deployment |
