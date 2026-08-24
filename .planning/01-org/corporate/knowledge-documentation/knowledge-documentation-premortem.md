---
type: premortem
division: corporate
department: knowledge-documentation
status: provisional
metrics: [kd.docs_added_vs_retired_ratio, graph.frontmatter_coverage_pct, standards.stale_claim_rate, corpus.duplicate_basename_count]
updated: 2026-08-24
links: ["[[knowledge-documentation-charter]]", "[[knowledge-documentation-loops]]", "[[knowledge-documentation-directive]]", "[[corpus-archive-premortem]]", "[[graph-retrieval-premortem]]", "[[standards-verification-premortem]]", "[[ORG_STRUCTURE]]", "[[OBSIDIAN_VAULT]]", "[[red-team-charter]]"]
---

# Knowledge & Documentation — Premortem

> Written at founding, before success is assumed.

It is **2027-08-24**. The department exists on paper and the corpus is worse than it was
in August 2026. Here is how, most likely first.

---

## M1 — The department became the sprawl (most likely)

**What happened.** The org generation produced 693 documents. This department produced 28
of them and then spent the year producing more: a placement policy doc, a frontmatter
spec, a standards guide, a library index, a staleness rubric. None of them were ever
*executed against*, because executing requires tooling and writing does not. By August 2027
`.planning/` holds 1,800 `.md` instead of 1,118, the 38 duplicated basenames are still 38,
and the department's own output is the largest single contributor to the growth it was
founded to reverse.

**Earliest observable signal.** `kd.docs_added_vs_retired_ratio` stays above 1 for two
consecutive months while `corpus.duplicate_basename_count` has not moved off 38. Visible on
[[knowledge-documentation-agenda-board]] the moment the counter is hand-entered — no
tooling needed to see it.

**What would have prevented it.** The **retire-to-write rule** in
[[knowledge-documentation-directive]]: this department may not add a document to
`.planning/` without naming, in the same change, a document it archives or a duplicate it
deletes. It is the only department in the org that carries this constraint, and it carries
it because it is the only one whose output is also its subject matter. Loop L-KD-1
enforces it monthly with a named close-time.

---

## M2 — Dataview never got installed, so every board agenda was decorative

**What happened.** [[OBSIDIAN_VAULT]] §4 named Dataview *"the anti-sprawl mechanism in
practice"* and [[ORG_STRUCTURE]] §4's 60-day rule depended on it. No `.obsidian/`
directory was ever committed. The 99 `agenda-board.md` files rendered as fenced code
blocks in GitHub and as nothing at all to an agent grepping the repo. Staleness was
therefore never detected by machine, only by a human noticing — which is the mechanism
that was already failing before the department existed. `md/DOCUMENTATION_INDEX.md`
reached its **19-month** anniversary of being wrong.

**Earliest observable signal.** It is observable **today**, not in twelve months: `ls -d
.obsidian` fails, and `.planning/01-org/**/agenda-board.md` contains `dataview` fences that
nothing executes. The signal is already lit. The failure mode is that nobody treats a
pre-existing red light as a red light.

**What would have prevented it.** Committing `.obsidian/` with Dataview enabled as
[[graph-retrieval-charter]]'s **first** deliverable, ahead of any frontmatter backfill —
because a backfill with no query over it produces no observable change, and work with no
observable change is the work that stops. Failing that, the fallback in
[[graph-retrieval-schedule]]: a plain Python script that computes the same three numbers
and writes them into the board files, so the metric survives the tool decision.

---

## M3 — The restructure happened once, and then everything drifted back

**What happened.** OD-01 resolved, a session executed the restructure, `md/` and
`md_files/` were merged, and `.planning/` got a shape. Then across the following forty
sessions, each one dropped exactly one new top-level `.planning/*.md` — "just this once,
it doesn't fit anywhere else" — despite [`CLAUDE.md`](../../../CLAUDE.md) §3 forbidding
precisely that. Nobody remembered why the original shape was chosen, because the reasoning
lived in a chat rather than in a placement rule with an owner. The restructure got paid for
twice, and the second time it was harder.

**Earliest observable signal.** The first top-level `.planning/*.md` created after the
restructure lands **without** a corresponding entry in the placement rule. Count of
top-level docs is a one-line check (`ls .planning/*.md | wc -l`, baseline **28**) and it is
in [[corpus-archive-loops]] L-CA-2 at a weekly close-time for exactly this reason.

**What would have prevented it.** The placement rule shipping as a **CI check**, not a
paragraph. The repo already proves the pattern works — `scripts/check_schema_parity.sh`,
`scripts/check_no_direct_stock_writes.sh` are grep-shaped guards wired into
`.github/workflows/ci.yml`. A `check_no_new_toplevel_planning_docs.sh` is the same shape
and the same cost. A rule with no mechanism is a rule that has already failed once here —
see M4.

---

## M4 — Standards shipped as a style guide nobody runs

**What happened.** [[standards-verification-charter]] produced a documentation quality bar:
tone, structure, citation format. It was good. It was also unexecutable, so nothing ever
failed it. Meanwhile the corpus continued to hold **three** mutually inconsistent counts of
its own insight engine — 375, 573, and 348, two of them five lines apart in the same file
(`LLM_INSTRUCTION_PROMPTS.md:166,167`) — because the underlying number is computed at
import time from three arrays and the only test asserts `>= 200`
(`insight-catalog.spec.ts:10`). An agent read 573 into an investor narrative. The pattern
generalised: `.planning` became authoritative in tone and stale in fact, which is the most
expensive failure available here, because agents act on it.

**Earliest observable signal.** `standards.stale_claim_rate` has no value after 60 days.
Not a bad value — **no** value. A metric that was never instrumented is the tell, and the
excuse will be that measuring it is hard.

**What would have prevented it.** Making the first standards deliverable a **claim-pinning
mechanism** rather than a guide: for each numeric claim repeated across ≥2 spine documents,
either an assertable source (a test that fixes the number) or an explicit `UNPINNED` tag in
the doc. The insight-count case is the worked example and it is already assigned —
[[standards-verification-agenda-full]] §Next steps, item 1.

---

## M5 — The vault was built on a filename convention that was already violated 45 times

**What happened.** [[OBSIDIAN_VAULT]] §3 called unique filenames *"the single most
important convention here"*, and the vault root contained **45 files named `README.md`**
from the day it was declared. `[[README]]` resolved arbitrarily. Because unresolved and
mis-resolved links look identical in prose, nobody noticed that
`engineering-charter.md:106` had been pointing at the wrong document for a year. Trust in
the graph fell below the trust in `grep`, and the graph was quietly abandoned — Obsidian
became a decision nobody used, exactly as `corporate.md:187-190` predicted, but for a
reason nobody had predicted.

**Earliest observable signal.** The first `[[bare-name]]` link written in a vault doc that
matches more than one file. It exists already: `engineering-charter.md:106` writes
`[[README]] §0` intending [[README|foundation-README]], with 45 candidates in scope.

**What would have prevented it.** An **ambiguity check before a backfill**:
`graph.ambiguous_basename_count` measured and driven down, and a link-lint that rejects any
`[[link]]` resolving to more than one path — cheap, mechanical, and running before the
graph is large enough for the problem to be expensive. This is [[graph-retrieval-loops]]
L-GR-2, weekly.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it shows | Counter-pressure |
|---|---|---|---|---|
| M1 | Department becomes the sprawl | `kd.docs_added_vs_retired_ratio` > 1 for 2 months | [[knowledge-documentation-agenda-board]] | Retire-to-write rule (L-KD-1) |
| M2 | Dataview never installed | **already lit** — no `.obsidian/` | `ls -d .obsidian` | Commit `.obsidian/` first; script fallback |
| M3 | Restructure drifts back | first post-restructure top-level doc | `ls .planning/*.md | wc -l` | Placement rule as CI check (L-CA-2) |
| M4 | Standards = unrun style guide | no value for `standards.stale_claim_rate` at 60d | [[standards-verification-loops]] | Claim-pinning before guidance (L-SV-1) |
| M5 | Filename convention pre-violated | any ambiguous `[[link]]` | `engineering-charter.md:106` | Link-lint + ambiguity count (L-GR-2) |

**Two of these five are already observable on day one** (M2, M5). That is the finding this
premortem most wants read: this department does not begin at risk of failure, it begins
with two failures in progress.
