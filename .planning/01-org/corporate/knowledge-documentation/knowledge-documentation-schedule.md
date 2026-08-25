---
type: schedule
division: corporate
department: knowledge-documentation
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-agenda-board]]", "[[corpus-archive-schedule]]", "[[graph-retrieval-schedule]]", "[[standards-verification-schedule]]", "[[skills-charter]]"]
---

# Knowledge & Documentation — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Top-level placement guard** — `scripts/check_no_new_toplevel_planning_docs.sh`, enforcing [`CLAUDE.md`](../../../CLAUDE.md) §3 | Pass/fail; `corpus.top_level_planning_docs` |
| Per PR | **Frontmatter lint** on any `.planning/**/*.md` touched — `type`, `division`, `links` required ([[ORG_STRUCTURE]] §5) | `graph.frontmatter_coverage_pct` |
| Per PR | **Link lint** — reject any `[[link]]` resolving to 0 or >1 file; unresolved is a warning (expected, per [ADR 0004](../../decisions/0004-obsidian-as-backlink-layer.md)), ambiguous is an error | `graph.link_resolution_rate`, `graph.ambiguous_basename_count` |
| Daily | **Corpus census** — `.md` counts per tree, duplicate basenames, byte-identical vs diverged | `corpus.duplicate_basename_count`, `corpus.ambiguous_duplicate_count` |
| Weekly | **Three-number board** — L-KD-2 | [[knowledge-documentation-agenda-board]] refresh |
| Weekly | **Correction handoff ageing** — L-KD-4 | Escalations to [[decision-office-charter]] |
| Weekly | **Claim-sample verification** — N sampled spine-doc claims re-checked against source | `standards.stale_claim_rate` |
| Monthly | **Retire-to-write ledger** — L-KD-1 | `kd.docs_added_vs_retired_ratio` |
| Monthly | **Convention-violated-at-birth review** — L-KD-3 | Contract amendments, not doc fixes |
| Monthly | **Companion-doc regeneration** — `ENDPOINTS.md`, `PAGE_MAP.md`, `EXTERNAL_CONNECTIONS.md` re-scanned, never hand-edited ([[README|foundation-README]] §0) | Diff vs committed; `standards.regenerated_companion_age_days` |
| Quarterly | **Org-wide staleness sweep** — every `agenda-*.md` in `01-org/` and `02-advisory/` past 60 days ([[ORG_STRUCTURE]] §4) | Archive-or-revise list per unit |
| **One-off, founder-requested** | **OD-22 tooling & reference library session** — see below | `.planning/library/` + a Dataview index |

The first two per-PR jobs are the same shape as guards this repo already runs
(`scripts/check_schema_parity.sh`, `scripts/check_no_direct_stock_writes.sh`, wired in
`.github/workflows/ci.yml`). That precedent is why they are scheduled as CI checks rather
than as review habits — see [[knowledge-documentation-premortem]] M3.

## The OD-22 session, scoped

The founder explicitly asked for **one dedicated session** on a durable in-repo library of
plugins, skills, and design/dev resources, currently scattered across a transcript and
unfindable next session (`OPEN-DECISIONS.md`, OD-22). Scoping it here so the session has a
brief rather than a list.

**Home:** `.planning/library/` — proposed, needs the founder's confirmation (OD-22 says
*"needs a home decision"*). Inside the vault root, so it is indexable; outside the top-level
`.planning/*.md` namespace, so it does not violate `CLAUDE.md` §3.

**Shape:** one file per resource, frontmatter-first, so the index is a **Dataview query**
and not a hand-maintained list — the same anti-sprawl reasoning as
[[knowledge-documentation-agenda-board]]. Required frontmatter: `type: library-entry`,
`category`, `url`, `status` (`adopted` | `evaluating` | `noted`), `verified` (date),
`decision` (link to an ADR or OD if adoption is a real decision).

**Named entries from the founder, categorised:**

| Category | Entries |
|---|---|
| Skills / agent tooling | `taste-skill`, web-design rules, Playwright CLI |
| Design collections & references | "awesome" design collections, 21st.dev, Animista, Haikei, Phosphor, shadcn/ui |
| Image / design → code | image-to-code repos, Pomelli |
| Document & web extraction | AnyDoc *(already OD-06)*, Firecrawl, Baidu Unlimited-OCR |
| Messaging | OpenWA |

**Three constraints the session must respect, because a resource library is the easiest
document in the org to let rot:**

1. **Every entry carries a `verified` date.** An entry unverified for 180 days is
   surfaced by the same staleness query that governs agendas. A library of dead links is
   worse than no library, because it is trusted.
2. **`status: noted` is the default and is not a commitment.** Several of these overlap
   live open decisions — AnyDoc is **OD-06** and its adoption is *not* this department's
   call. The library records that a thing exists and where the decision lives; it does not
   adopt.
3. **Ownership is split, deliberately.** [[corpus-archive-charter]] owns placement and the
   archive policy; [[graph-retrieval-charter]] owns the index being a live query;
   [[standards-verification-charter]] owns entry freshness. No single team owns it, because
   this department's whole thesis is that those three properties fail independently.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

⚠️ **`.claude/skills/` does not exist in this repo.** The only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README|foundation-README]] §3.1). Ninety-nine
`schedule.md` files across the org — including this one — assert a directory that is not
there. This department found it, this department is implicated by it, and it is staged as
**CORP-F7**: create `.claude/skills/` and migrate, or correct 99 assertions. Reporting it here
rather than silently repeating the sentence is the whole point of
[[standards-verification-charter]].

This department's skill surface is **proposed, not built**. Each is tied to a scheduled job
above, so that a skill is created against work with a close-time rather than a job being
invented to justify a skill (`foundation/README.md` §3.3).

| Proposed skill | Fires on | Owning team |
|---|---|---|
| `corpus-census` | Daily corpus census | [[corpus-archive-charter]] |
| `doc-placement-check` | Per-PR placement guard | [[corpus-archive-charter]] |
| `frontmatter-lint` | Per-PR frontmatter check | [[graph-retrieval-charter]] |
| `link-lint` | Per-PR link resolution + ambiguity | [[graph-retrieval-charter]] |
| `claim-verify` | Weekly claim sampling | [[standards-verification-charter]] |
| `companion-regen` | Monthly companion-doc regeneration | [[standards-verification-charter]] |
| `library-entry` | Adding an OD-22 library entry | [[corpus-archive-charter]] |

**Nothing in this table exists yet.** Registry governance belongs to [[skills-charter]]
(Applied AI); this department authors and indexes, it does not govern.
