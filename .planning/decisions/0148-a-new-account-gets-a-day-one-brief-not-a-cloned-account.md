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
  [2026-09-16, local run on branch `claude/artifact-pull`: **still not verified.** `list`
  found 71 sessions on this Mac, and no bundle existed at `~/Desktop/claude-state_*.tar.gz`.
  Two logins now share the store — the desktop app runs as org `03017808-…`, the terminal
  CLI's profile still names org `1138b209-…` — and `list` reads the files under either;
  whether `claude --resume` under the new org offers the old org's sessions was not
  tested. `verify` exited 1 on a false alarm, sessions whose cwd is a subdirectory or
  worktree of the repo; `ONBOARDING.md` §6 has the detail.]
- **Artifacts: decided and delivered, 2026-09-16.** The founder chose to pull the twelve Mudavym
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
  signed into the owning account. [Sharpened 2026-09-16 by a second attempt, from the
  Claude desktop app's Code tab on this Mac (branch `claude/artifact-pull`): for all
  twelve, the Artifact read tool returned the identical non-member error, and so did
  `WebFetch` for ten — the auto-mode classifier refused the other two locally, before
  any request left the machine. `list_files` and `read_db` on Wave Four failed too, and
  the Artifact tool's `list` saw no artifacts at all. The diagnosis above **holds**; what
  was wrong was the assumption that a local session is in the owning org. The desktop
  app's session is org `03017808-9f02-4503-8679-8b71c4f82859`; the machine's terminal
  CLI login is org `1138b209-…` (admin), a credential the app's tools do not use.
  claude.ai's frame metadata proves ownership: Wave Four answered `perm.role` `reader` to
  org `03017808-…` and `owner` to org `1138b209-…`. Even signed in as owner, the app's
  browser pane could not yield the text — it sits in a sandboxed cross-origin frame the
  pane's tools cannot read, and the owner's menu offers no download. The Claude in Chrome
  extension was not connected. `ONBOARDING.md` §7 has every exact error and the revised
  unblock order: run the pull from a session in org `1138b209-…`.]
  Only the index landed (`ONBOARDING.md` §7), plus a standalone prompt for the local run
  (§8), after the second attempt. [Delivered 2026-09-16, third attempt: a terminal
  `claude` session confirmed (via `~/.claude.json`'s `oauthAccount`) to be in org
  `1138b209-…` ran the same §8 prompt's Job 2 on branch `claude/artifact-pull`. The
  Artifact tool's `read` action succeeded for all twelve public links with no refusal,
  confirming the diagnosis above: the blocker was org membership, not the tool. All
  twelve are committed as raw HTML snapshots under
  `.planning/07-reference/artifacts/<kebab-slug>.md`, and CLAIMS row
  `ADR-0148-ARTIFACTS-PULLED` is now `resolved` — its `verify` command greps all twelve
  internal ids under that directory and passes. §4 retire-to-write for those twelve files
  was already waived (ADR 0032, founder call 2026-09-16). **The exposure this ADR set out
  to remove is closed for the artifacts specifically: the content is durable in git, not
  account-bound.**] [Corrected the same day: that bracket overclaimed. `625ccb98` saved
  each artifact's page and nothing else, and its id-grep claim still passed. The
  Arrival's five direction files were missing, and so were the recorded calls: Wave Four
  7 documents, The Arrival 5. The completion checked all twelve against claude.ai's
  owner metadata, which lists each artifact's files, sizes, hashes and database document
  count. The five files came from the owning-org terminal session's export. Each, with claude.ai's frame-runtime block removed, matches its published size and sha256. It wrote
  in the verdicts the owner's own page load received, matched to the counts. The
  twelve are now whole, with a guard that proves it:
  `scripts/check_artifact_snapshots.py`, claim `ADR-0148-ARTIFACTS-WHOLE`. It fails
  all twelve on `625ccb98` and passes after. `ONBOARDING.md` §7 *Completed* has the
  detail.]
- **The Claude Design project behind the brand canvases is also account-bound** (added
  2026-09-16). The founder supplied its export. Compared byte for byte, its three
  canvases and its build prompt were already in `.planning/brand/`. The only files git
  held in no form were two uploaded monogram images, now
  `.planning/brand/mudavym-monogram-{1024,2048}.png` (founder call; §4 waived in ADR 0032).
  `support.js` was deliberately not added: `brand/README.md` relies on its absence.
- **Revisit when:** the brief's "in flight" section disagrees with `gh pr list` twice
  running, or `PROGRESS.md` is retired — either signals the brief has become a second
  source of truth rather than an index into the first.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-16 | — | Audit of `625ccb98` found the pull incomplete: The Arrival's five direction files and the verdict databases were missing, and the id-grep claim could not see it. Completed and verified against claude.ai's owner metadata (file lists, sizes, sha256, document counts). New guard `scripts/check_artifact_snapshots.py` (claim `ADR-0148-ARTIFACTS-WHOLE`) fails on `625ccb98` and passes after |
| 2026-09-16 | Aldemir | Claude Design export: chose to add the two monogram images to `.planning/brand/` (§4 waived, ADR 0032). The rest of the export matched git byte for byte; `support.js`, a redundant screenshot and the thumbnail were left out |
| 2026-09-16 | — | Third run of ONBOARDING §8 Job 2, from a terminal session confirmed in owning org `1138b209-…`: all twelve artifacts pulled and committed under `.planning/07-reference/artifacts/`; CLAIMS row flipped to `resolved`; artifacts consequence rewritten as delivered |
| 2026-09-16 | Aldemir | Waived §4 retire-to-write for the twelve artifact files (row in ADR 0032). Same session measured the pull's blocker: the desktop app's org `03017808-…` is a viewer of owner org `1138b209-…`; artifacts consequence re-bracketed |
| 2026-09-16 | — | Local run of ONBOARDING §8 on `claude/artifact-pull`: artifact pull failed for all twelve; the artifacts and same-Mac consequences amended in brackets, decision unchanged |
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
