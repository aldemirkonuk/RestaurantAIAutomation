# 0148 — A new account gets a day-one brief, not a cloned account

- **Status:** Locked
- **Date:** 2026-09-16
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** onboarding, migration, account, sessions, artifacts, handoff, retire-to-write
- **Links:** [[0002-documentation-first-operating-mode]], [[0003-session-output-discipline]], [[0032-vault-cleanup-cut-line]], `scripts/claude_state_migrate.sh`, `.planning/handoff/ONBOARDING.md`

## Context

The founder is moving to a different Claude account and asked to carry "the exact
sessions, what we are, where we are" for this repository. The first reading of that
request was literal — clone the account — and produced a migration tool
(`scripts/claude_state_migrate.sh`, commit `f5ba56c`) plus a runbook.

The founder then reframed it: *"we're not trying to copy everything into this cloud
... think of it as a new employee who just started working and trying to get a hold of
the whole repo."* The goal is orientation, not replication. That changes the
deliverable, and it changes which of the two halves actually matters.

Three facts settled the shape:

1. **The spine is current.** `PROJECT.md`, `STATE.md`, `ROADMAP.md`,
   `decisions/README.md`, `OPEN-DECISIONS.md` and `handoff/PROGRESS.md` were all
   touched 2026-09-05 → 2026-09-13, against 51 commits in 30 days and ADRs out to
   0147. `PROGRESS.md`'s "still open, in priority order" list still matches GitHub:
   #368, #362 and #349 are open today. So a new hire reading the documented order
   lands roughly current — the corpus is not the gap.
2. **The gap is what is not in git:** session context and artifacts.
3. **The destination is the same Mac under a different account.** That makes the
   migration tool largely insurance rather than mechanism — see Consequences.

## Options considered

1. **A day-one onboarding brief** — one short doc a cold session reads first, each
   claim citing `file:line` so it is re-checkable per CLAUDE.md §5b. Costs a
   retire-to-write retirement (§4) and adds a document that can rot.
2. **No new document; fix the entry point** — tighten CLAUDE.md §1's reading order and
   `PROJECT.md`'s header instead. Cheapest, owes no retirement, but leaves the cold-start
   reader assembling the picture from six files, two of which are 130KB and 284KB.
3. **Rely on the migration tool alone** — carry the sessions and let the new account
   read the transcripts. Rejected: transcripts are a record of *how* we got here, not a
   statement of *where* we are, and reading them costs more context than the spine does.
4. **Do nothing** — the founder re-explains the project to each new session by hand.
   That is the status quo cost the request exists to remove.

## Decision

**Option 1.** Write `.planning/handoff/ONBOARDING.md` as the cold-start entry point,
with every state claim carrying a `file:line` or a command, and retire
`.planning/handoff/CLAUDE-STATE-MIGRATION.md` into it.

The retire-to-write obligation (§4) is met by a genuine merge, not a sacrificial
victim: the migration runbook and the onboarding brief answer the same question from
two sides — *you are new here* and *you are arriving here from somewhere else* — and a
new account needs both on the same page. The deep rationale that does not belong in a
day-one brief already lives in the 30-line header of `scripts/claude_state_migrate.sh`,
which is the durable reference; the verification record moves here, below.

**Tombstone.** `.planning/handoff/CLAUDE-STATE-MIGRATION.md` is deleted, not archived
in tree (§4: archive means delete + tombstone). Recoverable at commit
**`f5ba56ca46f687e9390032d2664605a9af0a4340`**.

## Consequences

- **Easier:** a cold session reaches the current picture in one read instead of six,
  and every line in it can be checked rather than believed.
- **Harder:** one more document that can rot. Mitigated by the citation guard
  (`scripts/check_onboarding_citations.py`, claim `ADR-0148-ONBOARDING-CITATIONS`),
  which fails CI when a cited path stops existing — the §5b lesson applied to the one
  doc most likely to be read cold and trusted.
- **Given up:** the standalone migration runbook. Its procedure is now a section of the
  brief; its reasoning stays in the script header.
- **Notable, from the founder's answer that the destination is the same Mac:** session
  transcripts live in `~/.claude/projects/<key>/` and credentials in
  `~/.claude/.credentials.json` (macOS: Keychain, *Claude Code-credentials*). Switching
  accounts clears the latter and has no reason to touch the former, so on one machine
  the history very likely does not move at all — it is already there and account-agnostic.
  **This is reasoned, not verified**: it was not possible to test a real logout/login
  cycle from the container. The brief therefore tells the founder to take a bundle
  *before* logging out, as insurance against the reasoning being wrong.
- **Artifacts: decided but not delivered.** The founder chose to pull the twelve Mudavym
  artifacts into the repo as files. Measured 2026-09-16 across 16 requests and both link
  formats, that is not possible from a cloud session. The org-scoped
  `claude.ai/code/artifact/<uuid>` links returned *"artifact not found — it may have been
  deleted, or it has not been shared with you"* through `WebFetch` and the Artifact read
  tool alike. The founder then supplied public share links
  (`claude.ai/artifact/<short>`), and **all twelve resolved to their internal ids** —
  proving none is deleted and every link is live — but each returned *"this artifact is
  served to you as a public (non-member) reader, and reading public artifacts that way is
  not enabled yet"*. The distinction matters for the fix: **wider sharing does not help,
  because the blocker is non-membership, not permission.** The reader must be a member of
  org `1138b209-aed5-4cfe-9199-186b04b76545`, or the pull must run from a local session
  signed into the owning account. Only the index landed (`ONBOARDING.md` §7), plus a
  standalone prompt for the local run (§8). **The exposure this ADR set out to remove is
  therefore still open for the artifacts specifically.**
- **Revisit when:** the brief's "in flight" section disagrees with `gh pr list` twice
  running, or `PROGRESS.md` is retired — either signals the brief has become a second
  source of truth rather than an index into the first.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-16 | Aldemir | Reframed the request from account-clone to onboarding; chose the brief, chose to pull artifacts into the repo as files, confirmed same-Mac destination |
| 2026-09-16 | — | Created |

## Verification record (carried from the retired runbook)

`scripts/claude_state_migrate.sh`, tested end-to-end on a fixture simulating a store
moving to a new machine at a different path, 2026-09-16:

| Case | Result |
|---|---|
| `list` against this repo's live store | 1 session, correct branch and CLI version |
| export → inspect → import → verify, path changed | 2 sessions, `✅ every session records cwd=<new>` |
| `.credentials.json` planted in the source store | purged from bundle; absent from destination |
| Pasted `ghp_…` token in a transcript | flagged as 1 × github-token, value not printed |
| `memory/` + per-session sidecar dirs | carried across intact |
| Old absolute path remaining anywhere | zero references after rewrite |
| `--no-rewrite` into a different path | `verify` exits 1 and names both sessions |
| Same-path import | no rewrite attempted, verify clean |
| Re-import over an existing store | prior store copied to `.backup.<timestamp>` first |
| `--since 1` | 1 transcript + full `memory/` |

Not verified: a real macOS → Linux move (fixture was Linux on both sides), `--resume`
inside the `claude` binary after import, and the logout/login claim above.
