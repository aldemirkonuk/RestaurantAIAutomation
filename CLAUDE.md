# CLAUDE.md — Working instructions for this repo

> **Mudavym** — autonomous restaurant operations platform. One entity; many small
> softwares inside it (see [`.planning/decisions/`](.planning/decisions/)).
>
> This file is loaded into **every** session. Keep it under ~200 lines. It holds
> *how we work*, never *what we've built* — build state lives in the docs it points at.

---

## 0. The five non-negotiables

These were set on 2026-08-24 and override convenience every time.

1. **Nothing is decided until it is decided together.** If a choice is not written
   in `.planning/decisions/`, it is open. Do not assume, do not "pick a sensible
   default," and do not let an earlier draft doc stand in for a decision. When you
   hit an undecided fork, add it to `.planning/decisions/OPEN-DECISIONS.md` and ask.
2. **Every decision gets a record.** One ADR per decision, in
   `.planning/decisions/`. The rationale and the rejected alternatives matter as
   much as the outcome. A decision made in chat and not written down did not happen.
3. **Low output footprint per session.** Sessions must stay cheap and legible. See
   §2 — this is a hard operating rule, not a preference.
4. **No shortcuts, and say so when you take one.** If you narrowed scope, skipped a
   check, or could not verify something, state it plainly in the final message.
   Reporting a partial result as complete is the one unrecoverable failure here.
5. **Research depth is uncapped; delivery brevity is not.** These are two separate
   constraints — meeting one is never an excuse to relax the other. Never settle on
   the first plausible approach for a decision or an architecture question. See §3.

---

## 1. Orientation — where things are

| Path | What lives there |
|---|---|
| `apps/web`, `apps/mobile`, `apps/api-gateway` | Product surfaces — Vite SPA + react-router-dom (**not** Next.js), React Native, NestJS |
| `services/agent-orchestrator` | Python agents + `core/base_agent.py` |
| `services/self-evolution`, `services/database` | Supporting services |
| `packages/database`, `packages/ui` | Shared workspace packages |
| `supabase/` | Migrations + schema — source of truth for DB shape |
| `.planning/` | Planning corpus (see §4) |
| `.planning/decisions/` | **ADRs + the open-decision register** |
| `md/` | Legacy long-form docs (120 files, historical) |
| `datasets/`, `scripts/` | Data corpora and one-off tooling |

**Doc entry points, in reading order:** `.planning/PROJECT.md` (identity + current
milestone) → `.planning/decisions/README.md` (what is locked, what is open) →
`.planning/STATE.md` (where the build actually is) → `.planning/ROADMAP.md`.

---

## 2. Session output discipline

The constraint: *a session's context and output footprint stay small regardless of
what it is doing.* Concretely:

- **Never read a large planning doc whole.** `UX_PATHS_CATALOG.md` (154KB),
  `claude_full_architectural.md` (181KB), `INVOICE_DOC_UX_RESEARCH.md` (81KB),
  `ROADMAP.md` (70KB) and the beverage/producer plans (57–69KB each) are
  **grep-and-excerpt targets**. Use `Grep` for the section, then `Read` with
  `offset`/`limit`. Reading one of these in full can consume a third of a context
  window and teaches you almost nothing you needed.
- **Write findings to files, not into the transcript.** Long analyses belong in a
  doc; the chat message says what changed and where.
- **One operation per branch, per session.** Do not let a session sprawl across
  unrelated concerns — it destroys reviewability and blows context.
- **Prefer targeted tools over shell dumps.** `Grep`/`Glob` over `find | cat`.
  Pipe through `head`. Never `cat` a file you could `Read` with a line range.
- **Summarize into memory, don't re-derive.** If you spent effort establishing a
  fact that outlives the session, write it to memory (§6).

---

## 3. Research and decision depth

This governs the *work*, not the *report* — §2's low-footprint rule and §8's
response-style rule still apply to what reaches the founder. Everything before that
point can and should be as deep as the decision warrants.

- **Branch, don't walk a line.** Treat an open question as a graph, not a single
  chain of reasoning: each question forks into independent sub-questions, and the
  branching factor should *grow* as you go deeper — third-order questions get more
  angles explored than the first-order one, not fewer. A line of reasoning that
  never forks is not research.
- **Use `Workflow` for decisions and architecture research.** Real parallel
  fan-out — independent finders covering different angles, adversarial
  verification of each candidate answer, judged synthesis across them — not a
  single thread narrating its own thoroughness. Default to this for anything that
  will become an ADR (§5) or a technical-approach choice, not only for one-off bug
  hunts.
- **Never anchor on the first answer.** Once there's a leading approach,
  deliberately try to kill it with a dedicated adversarial pass — not the same
  reasoning that produced it. If it survives that, it's evidence; skipping this
  step means the decision isn't ready to record.
- **No shortcuts on this path, ever.** Skipping a branch, stopping early because an
  answer "seems right," or reusing a stale analysis instead of redoing it are all
  shortcuts — call them out per §0.4 if time pressure forces one.
- **Ask the moment a fork is genuinely open — don't wait.** This sharpens §0.1:
  surface an undecided fork with `AskUserQuestion` as soon as it's found to be
  genuinely the founder's call, rather than batching it to the end of the research
  pass or defaulting it yourself.
- **The report stays short regardless.** All of the above produces one ADR entry
  and a 2–3 sentence chat pointer (§8) — the graph of exploration lives in the
  ADR's rationale and rejected-alternatives, never in the transcript.

---

## 4. The planning corpus

`.planning/` currently holds 28 top-level documents (~1.2MB). It is **not yet
restructured** — that work is proposed but undecided (see
`.planning/decisions/OPEN-DECISIONS.md`, OD-01). Until it is:

- Treat `PROJECT.md`, `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`, `FUTURES.md`
  as the live spine.
- Treat the large `*_PLAN.md` / `*_ARCHITECTURE.md` / `*_CATALOG.md` files as
  reference corpora — grep them, cite them by `file.md:line`, do not restate them.
- `v3.0-TECH-DEBT.md` is the live defect register. Check it before claiming
  something is broken or fixed.
- Do **not** create new top-level `.planning/*.md` files. New long-form docs go in
  a subdirectory with an index entry.
- **Retire-to-write (adopted 2026-08-24, org-wide).** Adding a document means naming
  one to retire, merge, or supersede. The initial 693-doc org generation is exempt;
  everything after it is not. Rationale: the corpus had eleven documents naming *split*
  triggers and three naming *merge* triggers — structures only ratcheted upward.

---

## 5. Decisions

Every decision → one file in `.planning/decisions/NNNN-slug.md`, from the template.

- **Locked** decisions are binding. If you believe a locked decision is wrong, say
  so and propose superseding it — do not quietly work around it.
- **Open** decisions live in `OPEN-DECISIONS.md`. If work depends on an open
  decision: do every part that does not depend on it, then state the assumption or
  ask. Do not block the whole task on one fork.
- Pre-existing locked decisions still live in `PROJECT.md` (Key Decisions table)
  and `FUTURES.md` §2–3. The decision index links to them rather than copying them,
  so there is exactly one source of truth per decision.

---

## 6. Memory

Project memory: `~/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/memory/`

- One fact per file, with frontmatter (`name`, `description`, `metadata.type`).
- `MEMORY.md` is the index — one line per memory, never content.
- Write memory for: how the founder wants work done, constraints not derivable
  from code, and decisions-in-flight. Do **not** write memory for things the repo
  already records (code structure, git history, what a file does).
- Memories are point-in-time. Before acting on one that names a file, flag, or
  function, verify it still exists.

---

## 7. Git and delivery

- Branch per operation: `docs/…`, `feat/…`, `fix/…`, `data/…`. Never commit to `main`.
- Commit only when asked. Atomic commits with a real message body explaining *why*.
- Co-author trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Before deleting or overwriting anything, read it first.
- `.planning/` changes are committed alongside the code they describe.

---

## 8. Response style — keep chat short

The founder does not want long chat replies. Detail belongs in documents.

- **Default reply: 2–3 sentences.** What changed, where, and the one thing needing
  a decision. Nothing else.
- **No preamble, no recap, no summary of what you are about to do.** Do it, then
  report the delta.
- **Findings go to files, chat gets the pointer.** Never paste an analysis into the
  transcript that belongs in `.planning/`.
- **Tables and headings in chat only when the founder asks for a comparison.**
- Exception: when arguing against a decision, state the argument in full — brevity
  must never quietly drop a concern (§0.4).

---

## 9. Verification

- Claims about behavior need evidence: a test run, a query result, a screenshot,
  or a `file:line` citation. "Should work" is not a report.
- If tests fail, paste the failure. If a step was skipped, name it.
- Use the Browser pane preview tools to verify anything user-visible; do not ask
  the founder to check manually.

---

*Last updated: 2026-08-24 — added the research/decision-depth rule (five
non-negotiables) and `Workflow`-based fan-out for decisions.*
