---
type: premortem
division: corporate
department: knowledge-documentation
team: corpus-archive
status: provisional
metrics: [corpus.duplicate_basename_count, corpus.ambiguous_duplicate_count, corpus.top_level_planning_docs]
updated: 2026-08-24
links: ["[[corpus-archive-charter]]", "[[corpus-archive-loops]]", "[[corpus-archive-directive]]", "[[knowledge-documentation-premortem]]", "[[graph-retrieval-charter]]", "[[standards-verification-charter]]"]
---

# Corpus & Archive — Premortem

> Written at founding, before success is assumed.

It is **2027-08-24**. The restructure happened, and navigating the corpus is no easier.
Here is how, most likely first.

---

## M1 — OD-01 was treated as a one-time cleanup

**What happened.** The founder picked a shape, one session executed it, and it was
declared done. Over the following six months every session dropped exactly one new
top-level `.planning/*.md` — "just this once, it doesn't fit anywhere else" — despite
[`CLAUDE.md`](../../../../../CLAUDE.md) §3 forbidding exactly that. The 28 top-level
documents became 61. Nobody remembered why the original shape was chosen, because the
reasoning was in a session transcript and the *rule* was a sentence in a file that agents
read and then rationalised past. The restructure got paid for twice, and the second time
was harder because there was more to move.

**Earliest observable signal.** The **first** top-level `.planning/*.md` created after the
restructure. `ls .planning/*.md | wc -l` — baseline **28** — is a one-line check, and
L-CA-2 runs it weekly precisely so the signal is a number and not a vibe.

**What would have prevented it.** The placement rule shipping as a **CI check**, not a
paragraph. `scripts/check_no_new_toplevel_planning_docs.sh` is the same shape as guards
this repo already runs (`scripts/check_schema_parity.sh`,
`scripts/check_no_direct_stock_writes.sh`, wired into `.github/workflows/ci.yml`) and costs
about the same. A rule enforced by memory has already failed once here — §3 exists today
and the count is 28.

---

## M2 — The 3 diverged duplicates were resolved by a script

**What happened.** Under pressure to move `corpus.duplicate_basename_count` from 38 to 0,
someone extended the dedupe script with a tiebreak — newest mtime wins, or largest file
wins. It deleted `md_files/01-getting-started/README.md`, which was **not the same
document** as `md/09-communication/README.md`; they only shared a basename. Content was
lost silently, git history recorded it as part of a 38-file cleanup commit, and nobody
found out for a year.

**Earliest observable signal.** A commit that reduces the duplicate count by more than
**35** in a single change. That is the exact tell, and it is checkable mechanically:
`corpus.duplicate_basename_count` may fall to 3 automatically; going below 3 requires a
recorded founder decision per pair.

**What would have prevented it.** The hard rule in [[corpus-archive-directive]]:
**byte-identical is a script's decision; anything else is a human's.** Two separate
counters exist (`corpus.duplicate_basename_count` and `corpus.ambiguous_duplicate_count`)
specifically so that "35 of 38 resolved" cannot be reported as 92% complete when the
remaining three are the entire difficulty.

---

## M3 — The restructure moved everything, and every link broke at once

**What happened.** OD-01 executed before [[graph-retrieval-charter]] had shipped link
resolution. Hundreds of relative-path references — the `../../decisions/0004-…` style used
throughout the foundation documents and the ADRs — pointed at nothing. Obsidian's
`[[wikilinks]]` survived (they resolve by name, not path, per [[OBSIDIAN_VAULT]] §3), but
the corpus at that point was ~96% relative links and ~4% wikilinks. The graph did not break
because it barely existed; the **markdown** broke, comprehensively, and fixing it consumed
more effort than the restructure it followed.

**Earliest observable signal.** A restructure PR that moves files without a link-rewrite
step in the same change. Detectable before merge: count relative `.md` links in the diff's
touched files against the post-move paths.

**What would have prevented it.** Sequencing, stated in [[knowledge-documentation-agenda-full]]
§How: link resolution becomes measurable **before** the big move, so a restructure can be
verified rather than hoped. And a rule for the move itself — every file relocation lands
with its inbound-reference rewrites in the same commit, never as a follow-up.

---

## M4 — We deleted the wrong 10.8 MB

**What happened.** `CURSOR_CHAT_MAINOLD.md` (5.4 MB, duplicated across both trees,
gitignored) looked like obvious junk, and the path-shaped directory next to it looked like
obvious corruption. Both were deleted in a cleanup. The chat log turned out to be the only
surviving record of a reasoning chain the founder later needed, and because it was
gitignored, **git could not restore it**. The corpus got smaller and the company lost
something it could not get back.

**Earliest observable signal.** Any deletion proposal touching a path that
`git check-ignore` matches. That is a one-command precondition and it is in
[[corpus-archive-directive]] as a hard gate.

**What would have prevented it.** The rule that **gitignored content is archived, never
deleted** — moved to a location outside the working tree with a recorded manifest, because
for tracked files git is the undo and for untracked files there is none. The path-shaped
directory is different: it is empty, and emptiness is verifiable, so it may be removed
mechanically. Distinguishing "large and ugly" from "unrecoverable" is the whole of this
counter-pressure.

---

## M5 — Archive became a second corpus

**What happened.** An archive policy shipped and `.planning/archive/` filled up. It was
never indexed, never subject to the staleness rule, and never linked — so it became exactly
what `md_files/` already is: a partial copy of the live corpus that nobody can tell is
stale. Searching the repo returned two answers to every question, and the archive's answer
was often the more confidently written one.

**Confirmed, then cleared (2026-08-24).** The 2026-08-24 vault audit measured it: 522 files
in `.planning/archive/`, 24 of 35 phase directories byte-identical to their live twin, and
only 31 files that existed nowhere else. The archive step had copied rather than moved. Both
trees are now deleted; this section stays as the description of a failure mode that has
already occurred once here.

**Earliest observable signal.** A grep for any spine-document claim returns hits in both
`.planning/` and an archive tree with no marker distinguishing them. This was not
hypothetical: `.planning/archive/` existed and held v2.0 phase documents, **94% of them
byte-identical copies of `.planning/phases/`** — M5 had already happened. Both trees were
deleted on 2026-08-24 ([[0032-vault-cleanup-cut-line]]), so this failure mode is currently at zero
and the marker requirement exists to keep it there.

**What would have prevented it.** Archived documents carrying `status: archived` in
frontmatter and a superseded-by link, so [[graph-retrieval-charter]]'s queries can exclude
them and [[standards-verification-charter]]'s sampling can skip them. Archiving without a
marker is duplication with extra steps, which is the failure `md_files/` already
demonstrates and this team was founded to end.

---

## Signal summary

| # | Mechanism | Earliest signal | Counter-pressure |
|---|---|---|---|
| M1 | Restructure drifts back | first new top-level `.planning/*.md` | Placement rule as CI check (L-CA-2) |
| M2 | Diverged pairs resolved by script | duplicate count falls below 3 without a founder call | Byte-identical rule; two separate counters |
| M3 | Move breaks every relative link | a move PR with no link-rewrite in the diff | Link resolution measurable before the move |
| M4 | Deleted unrecoverable gitignored content | deletion proposal matching `git check-ignore` | Gitignored content is archived, never deleted |
| M5 | Archive becomes a second corpus | same claim greps in both live and archive | `status: archived` + superseded-by, or it is not archived |
