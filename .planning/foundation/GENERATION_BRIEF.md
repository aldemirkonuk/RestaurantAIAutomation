# Unit Generation Brief — the contract every generator agent follows

> Read this **fully** before writing anything. It is the shared contract so that a unit
> written in one session is identical in shape to one written in another.

## 1. Read first (in this order)

| Doc | Why |
|---|---|
| [`ORG_STRUCTURE.md`](ORG_STRUCTURE.md) | The org contract — divisions, unit anatomy, loop frontmatter. Short, read fully. |
| [`OBSIDIAN_VAULT.md`](OBSIDIAN_VAULT.md) | Vault conventions — filenames, frontmatter, Dataview. Short, read fully. |
| `.planning/_templates/*.md` | The 7 artifact templates. Follow their section structure. |
| `teams/<your-division>.md` | **Your evidence source.** Already contains, per team: mandate, why-distinct, EXISTS/PARTIAL/NEW evidence with `path:line`, primary metric, premortem line. **Transcribe and expand it — do not re-derive.** |
| [`README.md`](README.md) | The 7-layer stack (L0–L6), skill taxonomy §3, neural footprint §4. |
| `../../CLAUDE.md` §2 | Output discipline — grep large docs, never read whole. |

## 2. What you write

**7 files for your department**, then **7 files for each of its teams**.
Team directories already exist under `<department-dir>/teams/<team-slug>/`.

Filenames are **prefixed with the unit slug** — `engineering-charter.md`,
`catalogue-identity-premortem.md`. Never bare `charter.md`: Obsidian resolves
`[[links]]` by filename, and 99 files called `charter.md` makes every link ambiguous.

The 7 artifacts: `charter` · `premortem` · `agenda-full` · `agenda-board` ·
`directive` · `loops` · `schedule`.

## 3. Hard requirements

1. **Frontmatter on every file:**
   ```yaml
   ---
   type: charter          # or premortem | agenda-full | agenda-board | directive | loops | schedule
   division: <slug>
   department: <slug>
   team: <slug>           # team files only
   status: exists         # exists|partial|new on charters (from your evidence grade); provisional on agendas
   metrics: []            # nf_a.* for agents, nf_b.* for guests, where relevant
   updated: 2026-08-24
   links: []              # real [[wikilinks]]
   ---
   ```
2. **Agendas** (`agenda-full`, `agenda-board`) open with
   `> **PROVISIONAL — no work done yet.**` — forecast must never read as fact.
3. **Charters carry real evidence** — `path:line` citations graded EXISTS / PARTIAL / NEW,
   taken from your division's team doc. **Never invent evidence or capabilities.** If a
   team is NEW, say NEW plainly rather than dressing it up.
4. **Premortems are substantive** — 3–5 concrete failure mechanisms, each with its
   earliest observable signal and a specific counter-pressure ("be careful" is not one).
   The team doc gives you one premortem line per team; expand it properly. Premortem is
   artifact #2 by deliberate design.
5. **`loops.md`** uses the machine-readable YAML block from ORG_STRUCTURE §5. **Every loop
   names a `close_time`.** A loop that cannot say how fast it closes is a diagram, not a loop.
6. **`agenda-board.md`** uses a **Dataview query**, not a hand-written bullet list — that is
   the anti-sprawl enforcement mechanism.
7. **Cross-link liberally** with `[[slug]]`. Unresolved links are expected and fine — they
   mark a doc worth writing.
8. **`schedule.md`** names recurring work and the skills the unit owns (skills live in
   `.claude/skills/`). Anti-sprawl: a skill unfired for 30 days is reviewed for deletion;
   a scheduled job that produces no action for 3 runs is downgraded or deleted.

## 4. Honesty rules

- Where the evidence is too thin to write a real charter, **say so in the charter** and
  flag it in your final summary. A thin charter honestly labelled beats a padded one.
- Where you think a department has **too many teams**, say so. The founder chose ambition
  deliberately, but a team that cannot state why it is distinct from its sibling is a
  finding, not a failure.
- Trigger-gated teams (marked ⏸ in the team docs) get `status: new` and an explicit
  entry trigger in the charter.

## 5. Do not

- Do **not** run `git add` or `git commit` — the orchestrating session handles commits.
- Do **not** switch branches. You are on `docs/foundation-memory-instructions-decisions`.
- Do **not** edit anything outside your assigned department directory.
- Do **not** read `UX_PATHS_CATALOG.md` (154KB), `claude_full_architectural.md` (181KB),
  or `ROADMAP.md` (70KB) in full — grep them.

## 6. Final summary

Under 12 lines: files written, any place the evidence was too thin, and any team you
believe should not exist.
