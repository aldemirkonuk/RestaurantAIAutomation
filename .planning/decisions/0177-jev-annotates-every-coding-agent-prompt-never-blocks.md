# 0177 — Jev annotates every coding-agent prompt, never blocks

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

**Added in response:** an optional, fire-and-forget Discord webhook
(`DISCORD_WEBHOOK_URL`) posted from the same `emit()` call on every tool,
every event — see `_notify_discord` in `prompt_gate.py`. This makes the
founder's visibility depend on Discord's delivery, not on any one desktop
app's hook-rendering reliability. Live-tested 2026-09-20: degrades silently
and correctly with no URL set and with a syntactically-invalid URL; not yet
tested against a real Discord channel (no webhook URL provided as of this
addendum — the founder still needs to create one and add it to `.env`).

**Named, not built:** the founder also asked about a prompt writing surface
outside all three tools — draft a prompt, get Jev's read, then paste the
(possibly revised) prompt into whichever of Claude Desktop / Codex Desktop /
Cursor is actually being used. This sidesteps the entire hook-reliability
question above, since it depends on no hook API at all. Not built in this
PR — it is a second tool, not an extension of the hook script, and needs its
own scope decision (a CLI prompt? a tiny local web page? does it call Jev
once or interactively?) before building it.

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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-20 | — | Created |
