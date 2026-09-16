# Handoff: moving this repo's Claude state to another machine or account

Written 2026-09-16 on the founder's instruction: *"copy paste my whole Claude account
in a different one ... especially I need it for the restaurant AI automation repository
... I need the exact sessions, what we are, where we are."*

Tooling: [`scripts/claude_state_migrate.sh`](../../scripts/claude_state_migrate.sh)
(+ [`scripts/_claude_state.py`](../../scripts/_claude_state.py)). Run it with `--help`.

**Retire-to-write (CLAUDE.md §4): this doc enters the corpus retiring nothing.** Nothing
in `.planning/` covered machine/account migration, so there was no document to supersede.
Flagged rather than papered over.

---

## 1. What actually moves, and what cannot

The request is two problems wearing one coat. Only one is solvable.

| | Lives where | Moves? |
|---|---|---|
| Session transcripts (`--resume` history) | `~/.claude/projects/<key>/*.jsonl` | ✅ plain files |
| Project memory (CLAUDE.md §6) | `~/.claude/projects/<key>/memory/` | ✅ plain files |
| User-level `CLAUDE.md`, settings, skills, agents | `~/.claude/` | ✅ staged, installed by hand |
| The repo: code, `.planning/`, `.claude/`, ADRs | git | ✅ it's just `git clone` |
| **claude.ai chat conversations** | Anthropic servers | ❌ export only, no import |
| **Claude Code on the web sessions** | Anthropic servers | ❌ bound to the account |
| **Routines, Artifacts, connectors** | Anthropic servers | ❌ recreate |
| **GitHub App connection** | GitHub ↔ account | ❌ reconnect |
| **OAuth credentials** | `~/.claude/.credentials.json`, macOS Keychain | ❌ **never copy** — see §4 |

So: *"where we are"* on the CLI moves completely. The web-side history does not — there is
an export at **Settings → Privacy → Export data**, and no import path in either direction.

## 2. The trap: the project-directory key

Claude Code files sessions under a key derived from the repo's **absolute path**, every
character outside `[A-Za-z0-9-]` replaced by a dash:

```
/Users/aldemirkonuk/Projects/restaurant-ai-automation
  -> ~/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/
```

Clone to a different path on the new machine and `claude --resume` shows an **empty list**
next to a fully intact history, because it looked under a key that does not exist. This is
the single most likely way the move appears to fail.

Two ways out, both fine:

- **Clone to the identical absolute path.** Zero rewriting. Simplest if you can.
- **Clone anywhere and let `import` rewrite.** It repoints `cwd` and every absolute path
  inside the transcripts, then `verify` proves it.

## 3. The procedure

On the **old** machine, logged into the **old** account:

```bash
cd /path/to/restaurant-ai-automation
scripts/claude_state_migrate.sh list                 # confirm it sees your sessions
scripts/claude_state_migrate.sh export --out ~/Desktop
#   add --with-user-config for ~/.claude/CLAUDE.md, settings, skills, agents
#   add --since 20 to carry only the 20 most recent sessions
```

Copy the `.tar.gz` across. Then on the **new** machine:

```bash
scripts/claude_state_migrate.sh inspect ~/Desktop/claude-state_*.tar.gz
```

Read that output before importing — it lists every session with its first prompt and
branch, and scans for secrets ever pasted into chat (§4).

```bash
git clone https://github.com/aldemirkonuk/RestaurantAIAutomation
cd RestaurantAIAutomation
claude login                                          # the NEW account, first
scripts/claude_state_migrate.sh import ~/Desktop/claude-state_*.tar.gz --dry-run
scripts/claude_state_migrate.sh import ~/Desktop/claude-state_*.tar.gz
scripts/claude_state_migrate.sh verify
claude --resume                                       # your sessions, by name
```

`verify` exits non-zero and names the offending sessions if any still record the old
`cwd` — that is the §2 trap caught before it wastes your afternoon.

Then reconnect, per §1: the GitHub App at <https://claude.ai/connect-github>, plus any
connectors and Routines the old account held.

## 4. Credentials

`export` **never** bundles credentials. Not by default, not behind a flag — the script
carries a blocklist (`.credentials.json`, `.env`, ssh keys, `.netrc`) and sweeps the staged
bundle unconditionally, reporting what it purged. On macOS the token lives in the Keychain
as *"Claude Code-credentials"* and is never touched either.

This is deliberate: copying the old account's token would authenticate the new machine as
the **old** account — the exact opposite of moving out. The new account runs `claude login`
and owns its own token.

Separately, `inspect` greps the transcripts for secret-*shaped* strings — API keys,
tokens, Postgres URLs with inline passwords — and reports **counts and filenames, never
values**. Transcripts are a verbatim record of everything ever pasted into chat. If that
scan is non-zero, rotate those secrets before the bundle leaves the machine. `--since N`
narrows the blast radius if the full history is more than you want to carry.

The scan cannot tell a real key from an example one — exporting this very session flagged
3 categories, all of them fixture strings typed while testing the script. Treat a non-zero
count as "go look", not as "you leaked something".

## 5. Verification performed

End-to-end, on a fixture simulating a Mac store moving to a new machine at a different
path (`scripts/claude_state_migrate.sh`, 2026-09-16):

| | Result |
|---|---|
| `list` against this repo's live store | 1 session, correct branch and CLI version |
| export → inspect → import → verify, path changed | 2 sessions, `✅ every session records cwd=<new>` |
| `.credentials.json` planted in the source store | purged from bundle; absent from destination |
| Pasted `ghp_…` token in a transcript | flagged by `inspect` as 1 × github-token, value not printed |
| `memory/` + per-session sidecar dirs | carried across intact |
| Old absolute path remaining anywhere | zero references after rewrite |
| `--no-rewrite` into a different path | `verify` exits 1 and names both sessions (trap caught) |
| Same-path import (new account, same machine) | no rewrite attempted, verify clean |
| Re-import over an existing store | prior store copied to `.backup.<timestamp>` first |
| `--since 1` | 1 transcript + full `memory/` |

Not verified: a real macOS → Linux move (fixture only, both sides Linux in-container), and
resuming inside the actual `claude` binary after import — `verify` asserts the store is
well-formed and correctly keyed, which is the precondition `--resume` reads, not `--resume`
itself.
