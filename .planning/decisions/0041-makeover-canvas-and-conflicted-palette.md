# 0041 — A 46-screen makeover canvas, and a palette answer that needs re-asking

- **Status:** Proposed — **conflicted, do not treat as locked**
- **Date:** 2026-08-29
- **Decider:** Aldemir (founder) — the answer below was given in session, but on a stale premise (see Context)
- **Keywords:** design, makeover, canvas, palette, CD2D5B, 9E4249, seal colour, Mudavym, OD-106, bake-off, screenshots
- **Links:** [[0001-mudavym-single-entity]], `06-pages/DESIGN-FOUNDATION.md` (canonical copy lives on `docs/mudavym-design-kickoff`), OPEN-DECISIONS **OD-106**

## Context

On 2026-08-28 the founder asked for a full visual pass: screenshot every shipping
page, design a makeover for each, and show today beside the redesign on one canvas.

All 46 reachable routes were captured from a live localhost session at 1440×900
against the Meyhouse Palo Alto tenant, a binding design kit was written, and 103
artboards were drawn — 46 "today" frames, 46 redesigns, five flagship screens drawn
three times for a direction bake-off, a foundation sheet and a component gallery.
The canvas is published:
<https://claude.ai/code/artifact/e45a34cb-566f-4541-a9d3-b6e17a6a2d43>

**The premise of two of the questions asked at the top of that session was stale, and
this ADR exists mainly to say so.** The session read `DESIGN-FOUNDATION.md` from the
`feat/p1-readout` checkout, which predates the 2026-08-27 brand kickoff. It therefore
offered the founder the old A/B/C direction fork and the old two-burgundy palette
fork, both of which the 2026-08-27 waves had already superseded:

- The A/B/C fork was replaced by a from-scratch, five-direction brand exploration
  (sketches 053–062 on `docs/mudavym-design-kickoff`), reviewed by elimination.
- **Both incumbent burgundies were explicitly ruled out** in the wave-1/2 verdicts.
  The open palette question there is the *seal colour*, with İznik `#1A5E6B` /
  `#5FB0BC` recommended on board 059 and not yet chosen; the dark ground is already
  decided as Warm Charcoal `#15130F`.
- The register id is **OD-106**, not OD-79. OD-79 is the resolved email-verification
  decision (ADR 0023); a bare `OD-79` for the design fork is the exact mislabelling
  that was corrected on 2026-08-26.

## Options considered

1. **Record #CD2D5B as locked.** It is what the founder answered when asked. Costs:
   it silently overrides a later, better-informed founder ruling that ruled the same
   colour out, and it would be the second time this fork got filed under a wrong id.
2. **Discard the session's answer and the canvas with it.** Costs: throws away 103
   artboards and a live-capture evidence base that is independently useful whatever
   the palette turns out to be.
3. **Keep the work, re-ask the palette.** Record what was produced and what was
   answered, mark the palette answer as needing reconfirmation against the wave
   verdicts, and treat the kit's *structure* — which is palette-independent — as the
   durable output.

## Decision

**Option 3.** The makeover canvas stands as delivered work. The colour answer does
not stand as a locked decision.

What the founder answered on 2026-08-28, recorded as given: brand primary
**#CD2D5B**, **Mudavym everywhere**, direction settled by a **bake-off on flagships**,
depth **all 46 pages, tiered**. Three of those four are unaffected by the staleness —
Mudavym-everywhere agrees with the kickoff, the bake-off is a process choice, and the
depth is a scope choice. Only the primary conflicts.

The kit built on top of it is deliberately separable: one primary hex, one warm ink,
one warm ground, five semantic pairs, and one new token — **`--calm` `#6B5F8A`, worn
by anything the platform did without being asked, always beside a human control.**
Re-skinning the canvas onto a different seal colour is a find-and-replace of the
primary scale plus a contrast re-check; nothing structural depends on the crimson.

## Consequences

- **Easier:** there is now a live, dated baseline of every screen as it actually
  ships, a written critique per page, and three fully drawn direction arguments to
  judge instead of three paragraphs.
- **Harder / given up:** the canvas currently wears a colour that a later founder
  ruling had excluded, so it cannot be read as a palette proposal — only as a
  structural one, until the seal colour lands.
- **Revisit when:** the founder picks the seal colour on board 059. At that point the
  canvas is re-seeded with the new primary scale and this ADR is either superseded by
  a real palette ADR or closed as withdrawn.

## Consequences for process

The session that produced this read `.planning` from its own checkout instead of
`origin/main`, which is the failure mode `vault-structure-post-od01` already names.
The register id and the two forks were all stale for the same reason. **Survey
`.planning` from `origin/main` before asking the founder anything.**

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | Aldemir (founder) | Answered a four-way and three-way fork; answers recorded above |
| 2026-08-29 | — | Staleness found after the canvas was published; status set to Proposed/conflicted, palette flagged for re-ask |
