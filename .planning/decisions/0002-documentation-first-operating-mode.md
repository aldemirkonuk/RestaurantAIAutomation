# 0002 — Documentation-first operating mode + ADR discipline

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** documentation, ADR, decision log, review loops, quality over speed
- **Links:** [`CLAUDE.md`](../../CLAUDE.md) §0, [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md), vision capture §0/§3/§12F

## Context

The 2026-08-24 restructuring mandate: "Whatever we do, we document. Whatever
decision we took, we document." Prior practice scattered decisions across
`PROJECT.md` tables, plan-doc prose, memory files, and chat — recoverable only by
archaeology. The mandate also demands repeated review before anything is treated
as committed, and explicitly forbids shortcuts.

## Options considered

1. **Keep decisions inline in plan docs** — zero new structure; but decisions stay
   non-enumerable, unfindable by keyword, and get silently overwritten by edits.
2. **A single running DECISIONS.md** — enumerable, but grows unboundedly, merges
   badly across parallel branches, and can't carry per-decision review trails.
3. **ADR directory** (`.planning/decisions/`, one file per decision, template,
   open-decision register, index) — standard practice; file-per-decision merges
   cleanly across the parallel sessions this project runs, carries keywords and a
   review trail, and backlinks naturally once Obsidian is the layer ([[0004-obsidian-as-backlink-layer]]).

## Decision

Option 3. Additionally, the operating rules locked with it:

- **Nothing is decided until decided together** — undecided forks go to
  `OPEN-DECISIONS.md`, and only a founder call resolves them.
- Every decision records options, rationale, consequences, and a review trail.
- Pre-existing locked decisions stay canonical where they live; the index links
  to them (one source of truth per decision, no copies).
- Quality over speed for all structural/architectural work — review loops are the
  norm, and skipped steps must be reported, never hidden.

## Consequences

- Slightly more ceremony per decision — accepted deliberately; that is the point.
- Decisions become greppable (`Keywords:` line), reviewable, and supersedable
  without history loss.
- Sessions gain a standard move at every fork: file it in OPEN-DECISIONS and
  continue with non-dependent work — instead of guessing.
- Revisit if: the register's founder-queue grows faster than it drains for a
  sustained period — that signals decisions are batched too finely, not that the
  discipline is wrong.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir | Mandated documentation-first restructuring (session transcript) |
| 2026-08-24 | — | Recorded as ADR; log seeded with 0001–0005 |
