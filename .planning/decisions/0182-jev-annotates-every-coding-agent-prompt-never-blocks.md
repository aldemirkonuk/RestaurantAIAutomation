# 0182 — Jev annotates every coding-agent prompt, never blocks

- **Status:** Proposed
- **Date:** 2026-09-20
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** typesafe, jev, hooks, cursor, claude-code, codex, prompt-gate, dev-tooling
- **Links:** [[../07-reference/TYPESAFE_AI_OVERVIEW]], `scripts/jev/prompt_gate.py`, `.cursor/hooks.json`, `.claude/settings.json`, `.codex/hooks.json`

## Context

The founder asked, in chat on 2026-09-20, to route every prompt given to a coding
agent in this repo — Cursor, Claude Code, and Codex CLI — through TypeSafe's Jev
API first, always annotate the result, and never let Jev block the agent from
acting. This is dev-tooling (how the team's coding agents behave), not product
code — no `services/agent-orchestrator` agent or user-facing behavior changes.

Each of the three tools defines its own prompt-submission hook with a different
input/output schema; there is no single cross-tool mechanism:

- **Cursor** (`beforeSubmitPrompt`): stdin carries `hook_event_name`, `prompt`.
  Output supports **only** `{"continue": bool, "user_message": str}` — verified
  against `docs.cursor.com/docs/hooks` via the `cursor-guide` subagent,
  2026-09-20. There is no `additionalContext`-equivalent field for this event;
  it is allow/deny-only, not a context-injection point.
- **Claude Code** (`UserPromptSubmit`): supports
  `hookSpecificOutput.additionalContext`, injected as a system reminder Claude
  reads on its next request. Per Claude Code's own docs
  (`docs.claude.com/en/docs/claude-code/hooks`, fetched 2026-09-20): *"Neither
  channel produces a visible transcript entry"* — the founder will not see this
  text appear as a chat bubble; whether the agent chooses to surface it in its
  reply is the agent's own judgment, not a guarantee this hook can make.
- **Codex CLI** (`UserPromptSubmit`): OpenAI's docs
  (`developers.openai.com/codex/hooks`, fetched 2026-09-20) confirm the same
  `hookSpecificOutput.additionalContext` shape, deliberately mirroring Claude
  Code's hook vocabulary.

## Options considered

1. **One shared Python script, three thin per-tool hook configs.** Each tool's
   `UserPromptSubmit`/`beforeSubmitPrompt` hook calls
   `scripts/jev/prompt_gate.py`, which reads the common `prompt` field, branches
   output shape on `hook_event_name`, and is the single place the TypeSafe
   question set and thresholds live (per the `typesafe-ai` skill's own "keep
   questions in one reviewable file" guidance). Chosen.
2. **Three independent scripts, one per tool.** Rejected — the question battery
   and TypeSafe call are identical logic; three copies drift the moment one is
   tuned and the others aren't, the exact failure mode CLAUDE.md §5b's
   `CLAIMS.jsonl` rule exists to catch on decisions, not just facts.
3. **A hosted webhook/service instead of local hook scripts.** Rejected for now
   — three more moving parts (auth, hosting, latency) to annotate a local dev
   prompt, with no clear benefit over a local script reading a local `.env`.
4. **Do nothing / manual only.** What already exists in this chat, ad hoc —
   costs the founder a dedicated conversation per surface (this one) instead of
   an always-on check. Named per the template's requirement, rejected as the
   ongoing state.

## Decision

Add one shared hook script (`scripts/jev/prompt_gate.py`) and three per-tool
hook configs (`.cursor/hooks.json`, `.claude/settings.json`'s `UserPromptSubmit`
entry, `.codex/hooks.json`), all wired to the same TypeSafe question battery —
`request_type` (Choice), `risk` (Score), `needs_clarification` (Noul) — asked in
one batched call per prompt (Speculative Fan-Out).

The key is read from `JEV_API_KEY` (the name the founder actually set in the
repo-root `.env` on 2026-09-20 — corrected from this ADR's initial draft, which
assumed TypeSafe's own docs name, `TYPESAFE_API_KEY`; the script accepts either
name so both conventions work). `.cursor/hooks.json`, `.claude/settings.json`,
and `.codex/hooks.json` are gitignored-by-default paths or gate-owned paths
respectively — see Consequences.

**Live-tested 2026-09-20** against the real API (not mocked): three sample
prompts —
*"what does the fuzzy_matcher.py file do"* → `question`, risk `None (0.0)`;
*"add a dark mode toggle to settings"* → `code_change`, risk `Low (1.2)`;
*"delete all rows from the restaurants table and force-push main"* →
`destructive_action`, risk `High (3.0)`, confidence 1.00 on both classifications
— confirming the battery discriminates correctly across the risk range it's
meant to cover. Required one fix during testing: the interpreter's default SSL
context failed `CERTIFICATE_VERIFY_FAILED` against a real, valid cert (a known
macOS python.org-installer gap, not a TypeSafe-side problem) — the script now
prefers `certifi`'s CA bundle when importable, falling back to the default
context otherwise (e.g. on Linux CI images, where system certs are already
correct).

**It never blocks, on any of the three tools, regardless of what Jev returns.**
Cursor's config always returns `continue: true`. Claude Code and Codex only ever
return `additionalContext`, never `decision: "block"`. A TypeSafe API failure,
timeout, or missing `TYPESAFE_API_KEY` degrades to a one-line "unavailable" or
"not configured" annotation and always exits 0 — a third-party judgment call
must never be the thing that stops the founder from working. This matches the
founder's explicit instruction ("always annotate... never block... let the LLM
take action") over the gate's own default inclination toward blocking risky
actions (contrast [[0090-...]]'s PR-merge gate, which *does* block — that gate
guards an irreversible team-wide action; this one guards nothing, it only
informs).

**Known, accepted limitation:** only the Cursor path is confirmed to reach the
founder directly (`user_message`). The Claude Code and Codex paths reach the
*agent*, not the transcript — the founder sees Jev's read only if the receiving
agent chooses to quote it. This ADR does not add an instruction to CLAUDE.md
compelling agents to do so, because CLAUDE.md is already over its own ~200-line
budget (254 lines measured 2026-09-20) and adding to it is a separate, unrelated
cleanup this ADR does not take on.

## Addendum 2026-09-20 — the desktop-app gap is worse than "invisible by design"

The founder asked what else could close the Claude Code/Codex visibility gap,
specifically naming **Claude Desktop** and **Codex Desktop** (the GUI apps,
distinct from the CLIs this ADR originally targeted). Researched via web
search against upstream issue trackers before answering, rather than assuming
the CLI's documented behavior carries over:

- **Claude Desktop** documents that it fires the *same* hook events as the
  CLI (`code.claude.com/docs/en/hooks`: "Hooks run wherever Claude Code
  runs... the Desktop app... fire the same hook events"). In practice,
  multiple confirmed open bugs show the Desktop app executes hooks and
  **enforces blocks**, but drops the user-facing feedback entirely — no
  `systemMessage`, no block reason, no visible explanation, just an
  indistinguishable hang (`anthropics/claude-code` issues **#66555**,
  **#59822**, **#74299**). A separate, actively-tracked bug
  (**#87657**) shows some Desktop sessions load **zero** hooks despite
  correctly declared settings, intermittently, mid-session.
- **Codex Desktop** documents the same `hooks.json`/`config.toml` mechanism as
  the CLI, but community reports (`openai/codex` issues **#35863**,
  **#18090**, **#21639**) show SessionStart/command hooks detected in the UI
  but never executed, or regressed entirely across app updates — one
  side-by-side table in #21639 shows `additionalContext` reaching the model on
  Codex CLI 0.128.0 and silently not reaching it on 0.130.0+, same config.

**Conclusion carried into the decision:** the CLI/Cursor paths this ADR
targets are the *reliable* ones. The GUI desktop apps are not just
"invisible-by-design" (this ADR's original framing) — they are currently
buggy on top of that, version-dependent, and not something to depend on.

**Built, then explicitly declined, same session:** a fire-and-forget Discord
webhook (`DISCORD_WEBHOOK_URL`) was added and live-tested (degraded correctly
with no URL and with a bad URL) as a way to make founder visibility depend on
Discord's delivery instead of any one desktop app's rendering. The founder
selected Discord by accident in an earlier multi-select, asked for other
options, was offered a curated list (native macOS notification, Telegram,
ntfy.sh), and then chose **none of them** — deciding the model already
reading the annotation is what matters, and that a founder-visible echo is
not needed. The Discord code was removed rather than left in unused,
consistent with this repo's "don't add unused things" norm. If this changes
later, the removed diff is in this PR's git history (commit `ddf8740ff`, the
first push of it) and is a small, self-contained re-add.

**Named, not built:** the founder separately asked about a prompt-writing
surface outside all three tools — draft a prompt, get Jev's read, then paste
the (possibly revised) prompt into whichever app is in use. Clarified in the
same exchange that this isn't actually needed: the founder's real ask was
"include Jev as workflow step one, supplementing the AI before it acts" —
which the hook already does, since `additionalContext` reaches the model's
own context regardless of whether it's echoed to the founder. No separate
composer tool is planned.

**Founder's stated next step (2026-09-20):** move from GUI desktop apps to
the **Claude Code CLI** and **Codex CLI** in this repo, since those are the
surfaces this addendum's research found reliable. Operationally: this hook
only fires once `.claude/settings.json` and `.codex/hooks.json` are present
in whatever working directory the CLI is launched from. As of this addendum,
`codex` is not installed on the founder's machine (`command -v codex` finds
nothing; only `claude` resolves) — the Codex path is config-verified
(valid JSON, matches documented schema) but not yet fired end-to-end for
real, and can't be until the CLI itself is installed.

## Consequences

- Every prompt submitted to Cursor, Claude Code, or Codex CLI in this repo now
  costs one TypeSafe API call (~$0.042/million input tokens, output free — see
  `.planning/07-reference/TYPESAFE_AI_OVERVIEW.md` §6) once `TYPESAFE_API_KEY`
  is set. Until then, every prompt costs one local no-op check (`[JEV] not
  configured`) and zero dollars.
- Nothing in `services/agent-orchestrator` or any product surface changes —
  this is dev-tooling only, scoped to `.cursor/`, `.claude/`, `.codex/`, and
  `scripts/jev/`.
- A future session tightening this from "annotate" to "ask on high risk" (the
  founder's other stated option, not chosen here) is a one-line change to
  `prompt_gate.py`'s `emit()` — the plumbing already carries a `risk` score,
  it's just not acted on yet.
- `.claude/settings.json` is a gate-owned path under [[0090-...]]'s
  `_GATE_OWNED_PATHS` — the PR carrying this change force-escalates the merge
  audit to the founder rather than auto-merging on auditor approval, by design.
- Revisit if: TypeSafe's rate limits (stated as unstable per the overview doc)
  start throttling normal dev traffic, or if the founder wants Jev's `risk`
  answer to actually gate something instead of only annotate.

## Addendum 2026-09-20 — the annotation must reach the model on all three tools

The founder asked whether Jev was doing its job. Live measurement in Cursor
3.21.16 (hook log `cursor.hooks.workspaceId-6bcc50b7ea4fb5ac1b54215923669953.log`,
2026-09-20): the gate ran, TypeSafe answered, Cursor logged "executed
successfully and returned valid response" — and **neither the founder nor the
model saw the line**. Two independent defects:

1. **`user_message` is a block reason, not a chat line.** Cursor's hooks docs
   (fetched 2026-09-20, https://cursor.com/docs/hooks) define `user_message`
   as "Message shown to the user when the prompt is blocked." With
   `continue: true` there is no documented rendering. The founder confirmed
   they have never seen a `[JEV]` line on screen. The ADR's earlier claim
   that "only the Cursor path is confirmed to reach the founder directly
   (`user_message`)" is **false** and is superseded by this addendum.
2. **`beforeSubmitPrompt` has no documented context-injection field.** The
   same docs page lists `additional_context` on `sessionStart` / `postToolUse`
   / `postToolUseFailure` only. So the Cursor dialect this ADR originally
   shipped (`continue` + `user_message`) reached nobody.

**Claude Code** (https://code.claude.com/docs/en/hooks, fetched 2026-09-20):
`UserPromptSubmit` injects `hookSpecificOutput.additionalContext` as a
system reminder *alongside the submitted prompt*. A top-level
`additionalContext` is silently ignored (hooks-guide). The script already
emitted the nested form; this addendum keeps that shape and adds a one-line
instruction so the model treats the annotation as a classification, not a
new task. Not live-fired end-to-end in this session (`claude` is installed;
the founder was in Cursor). The dialect is pinned by
`scripts/jev/prompt_gate_test.py`.

**Codex CLI** (https://developers.openai.com/codex/hooks, fetched 2026-09-20):
the same nested `additionalContext` is "added as extra developer context."
openai/codex#40680 records that it is appended *after* the user prompt as a
`role: developer` message, which is why the instruction line ("not a new
task") is load-bearing on this path. The documented timeout key is
`timeout` (seconds), not `timeoutSec`. The command is rooted with
`git rev-parse --show-toplevel` so a Codex cwd that is not the repo root
still finds the script. Project-local `.codex/hooks.json` loads only when
that layer is trusted (`/hooks` in the CLI). Codex itself is still not
installed on the founder's machine — config-verified, not fired.

**Cursor injection, best available path:** emit three fields at once,
`continue: true`, `additional_context` (the dialect the Vercel Cursor plugin
uses for the mapped UserPromptSubmit event, observed in
`~/.claude/plugins/.../vercel/0.45.1/hooks/user-prompt-submit-skill-inject.mjs`),
and Claude's nested `hookSpecificOutput.additionalContext` (Cursor's
third-party-hooks page says that format is accepted). Whether any of those
actually reach the model on `beforeSubmitPrompt` is **not documented**; the
next prompt in this Cursor session is the empirical check. `user_message`
is kept only so the hook log still prints `[JEV]`.

**Double call:** Cursor runs project hooks *and* `.claude/settings.json`
(priority list on https://cursor.com/docs/reference/third-party-hooks;
observed `Found 2 hook(s)` / `Merged 2 valid response(s)` for the same
`generation_id`, 1 ms apart, so a file lock cannot dedupe). Each config now
passes `--for=cursor|claude|codex`. When `--for=claude` sees a Cursor
payload it returns `{continue: true}` and does not call TypeSafe.
**Superseded 2026-09-21 by addendum item 4 below:** that detection also keyed on
`cursor_version` / `conversation_id` / `workspace_roots` being merely PRESENT,
which is the wrong direction — one such field appearing in a future Claude Code
payload would route a real prompt to `cursor-replay`, annotating nothing while
exiting 0. It now keys on `beforeSubmitPrompt` alone, which is all Cursor ever
sent.

## Addendum 2026-09-21 — what leaves the machine, decided rather than defaulted

The pre-merge audit gate BLOCKED PR #408 on this, and the block was right: this
ADR routed every prompt typed in this repo to a third party and said nothing
about it. Grepped for `retention`, `retain`, `privacy`, `PII`, `redact`,
`stored`, `DPA`, `trains on`, `data process`, `GDPR`, `KVKK` — **zero matches**.
The Consequences section named exactly one cost of the arrangement, the dollar
cost. The largest thing being given up was absent, and the document's shape
presented the matter as settled. That is precisely the §0.1 failure — an
undecided fork reading as a decision.

Four of the options this ADR considered branch on *how to plumb the hook*. Not
one branched on *what to send*. §3 asks the branching factor to grow with depth;
this went three levels deep on hook dialects and zero levels deep on payload
shape.

**The founder's ruling, 2026-09-21, asked directly and answered directly:**

> "it should send every prompt to typesafe to work it properly therefore, make
> adjustments accordingly"

**So: the whole prompt goes, verbatim, and that is the decision — not a default.**
No truncation, no redaction, no content allow-list. The rejected alternative is
named here so it is on the record rather than implied: redacting UUIDs, keys and
SQL literals before the POST was considered and refused, because Jev classifies
the *request* — type, risk, ambiguity — and a prompt with its nouns removed is a
different request. A gate that reads a redacted prompt answers about a prompt
nobody typed.

**What that means concretely, measured on the wire 2026-09-21 against a local
interception server** (PR #408 security angle):

- The payload is `{"state": {"user_message": <the entire prompt>}, "model":
  "jev-latest", "questions": {...}}` to `POST https://api.typesafe.ai/v1/systemone`
  over TLS, with `Authorization: Bearer <JEV_API_KEY>`.
- A test prompt carrying a vendor email address, an IBAN, a tenant UUID, a
  production `UPDATE ... WHERE id=` and a pasted `SUPABASE_SERVICE_ROLE_KEY=`
  arrived byte-identical.
- Under ADR 0090 this repo is also where audit and merge work happens, so the
  prompts that start those runs carry PR diffs, head SHAs and CI state.
- Only machines holding `JEV_API_KEY` transmit. CI runners and any contributor
  without the key send nothing — the gate reports "not configured" and steps
  aside.

**What is still open, and is not blocking:** TypeSafe's retention and training
terms are not written down anywhere in this repo.
`.planning/01-org/corporate/compliance-privacy/compliance-privacy-charter.md:202`
records "no policy, no DPA, no data-processing record, no subprocessor register",
with `compliance.subprocessor_classification` at 0/50. This arrangement adds the
51st runtime host and classifies it as neither. That is a real gap, it is the
founder's to close, and it is now **written down instead of absent** — which was
the whole of the block. Filed as a fork in `OPEN-DECISIONS.md` rather than left
in prose here, because prose rots and nothing re-reads it (§5b).

Not verified, and stated so rather than assumed: whether `UserPromptSubmit`
fires for subagent invocations. If it does, every audit subagent prompt egresses
too, which would widen this materially.

## Addendum 2026-09-21 — six defects the audit found in the gate itself

Fixed in the same pass; each had a concrete failure and each now has a check
that fails without it.

1. **The gate could exit 2, which is the BLOCK signal** — the exact inverse of
   this ADR's one locked constraint. `$CLAUDE_PROJECT_DIR` empty, or
   `git rev-parse` failing (git absent, a `safe.directory` refusal, a cwd outside
   a repo), made the argument `/scripts/jev/prompt_gate.py` and CPython exited 2,
   which erases the prompt. All three configs now run through
   `sh -c '... || exit 0'` with a `${CLAUDE_PROJECT_DIR:-.}` fallback.
   `check_jev_never_blocks.py` now **runs the script as a subprocess** on six
   paths and asserts the process exit code — it previously only walked
   `emit_payload()`'s returned dict, so `main()` returning 2 passed both it and
   the 24-case suite. It also now fires a **High-risk** answer, the one branch
   every fixture had pinned to 0.0, because this ADR itself names "tighten from
   annotate to ask on high risk" as a one-line future edit.
2. **112 of 148 worktrees never found the key**, including every
   `~/.cursor/worktrees/*` checkout — the surface this was built for. The walk
   started at `__file__` and an external linked worktree has no `.env` and no
   main checkout above it, so it ran to `/`. It now reads the worktree's `.git`
   *file*, follows `gitdir:` to the main checkout and searches there. Read, never
   executed — no `git` subprocess, so it survives the same conditions that caused
   defect 1. Two tests pin it. The second was written to say it refuses
   to borrow a stranger's `.env` from a shared ancestor and did not: it
   asserted `in (None, "not-ours")`, which passes under both outcomes,
   including the one its own name forbids. Corrected 2026-09-21 to assert one
   outcome, and the ADR corrected with it — the walk reaches `/` before the
   linked-worktree fallback is consulted, so a `.env` in a shared ancestor DOES
   win today. Latent on this machine (no `.env` in `$HOME`, `~/.cursor`,
   `~/Projects`, `~/Documents` or `/private/tmp`), and `$HOME` is 755, so a
   future `~/.env` would take it. Recorded rather than papered over.
3. **The bearer token followed redirects to any host**, including an https→http
   downgrade, because `urlopen`'s default opener follows `Location` and CPython
   forwards `Authorization`. Reproduced live: a `302` to a local server handed it
   `Bearer <key>` in plaintext. Now an opener with a refusing redirect handler.
4. **One extra field silently turned the gate into a no-op.** `_is_cursor_payload`
   returned True on the mere presence of `conversation_id` / `cursor_version` /
   `workspace_roots`, so such a field appearing in a future Claude Code payload
   would route a real prompt to `cursor-replay` — no call, no annotation, no
   stderr, exit 0, indistinguishable from a working gate. Now keyed on the event
   name alone, which is all Cursor ever needed.
5. **Non-object stdin crashed.** `[]`, `null` or `"str"` reached `.get` before any
   type guard, raising `AttributeError` outside the fail-open envelope: exit 1 and
   a traceback instead of an annotation. Guarded.
6. **`.codex/` had no ignore rule, and this change is what creates the directory.**
   The Codex CLI writes credentials to `.codex/auth.json` and every prompt it has
   been given to `.codex/history.jsonl`, and this ADR records moving to it as the
   next step. `.gitignore` now carries the symmetric `.codex/*` + `!.codex/hooks.json`
   carve-out. Nothing was exposed when it was found — only `hooks.json` existed.

**Known and not fixed here:** `TIMEOUT_SECONDS` is a per-socket timeout, not a
deadline — a server trickling bytes held the hook open for 212 seconds against a
stated bound of 6. The real bound is the harness `timeout: 8`, which is enforced
for Claude Code and config-verified-but-never-fired for Cursor and Codex. Left
as-is because fixing it properly means a wall-clock deadline around the whole
call, which is a change worth its own pass.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-20 | — | Created |
