#!/usr/bin/env python3
"""
Jev (TypeSafe) prompt gate — a shared UserPromptSubmit hook body for Cursor,
Claude Code, and Codex CLI.

What it does, every time you submit a prompt to any of those three agents in
this repo: sends the prompt to TypeSafe's Jev API with three atomic questions
(request type, risk, ambiguity), then annotates — it never blocks. The founder
decision on 2026-09-20 was explicit: "always annotate ... never block ...
let the LLM take action." See .planning/decisions/0182-jev-annotates-every-coding-agent-prompt-never-blocks.md.

One script, three JSON dialects, because Cursor / Claude Code / Codex each
define their own UserPromptSubmit stdin/stdout shape. The annotation must
reach the MODEL, not (only) the human:

  - Cursor          (`beforeSubmitPrompt`): stdin has `hook_event_name`,
                    `prompt`, `cursor_version`. Native docs only list
                    `{continue, user_message}`; `user_message` is the block
                    reason and is NOT rendered when continue is true, and
                    this event has no documented context-injection field.
                    Production Cursor plugins (Vercel) still emit
                    `additional_context` for the mapped UserPromptSubmit
                    event, and Cursor's third-party-hooks page says Claude's
                    nested `hookSpecificOutput` format is accepted. We emit
                    all three so at least one lands: continue=true,
                    additional_context, and hookSpecificOutput.additionalContext.
  - Claude Code     (`UserPromptSubmit`): stdin has `hook_event_name`, `prompt`.
                    stdout MUST nest additionalContext under hookSpecificOutput
                    with hookEventName UserPromptSubmit. Claude wraps that
                    string in a system reminder and inserts it alongside the
                    submitted prompt. A top-level additionalContext is
                    silently ignored (code.claude.com/docs/en/hooks-guide).
  - Codex CLI       (`UserPromptSubmit`): same nested additionalContext
                    shape. Codex adds it as extra developer context AFTER
                    the user prompt (openai/codex#40680), so the text is
                    wrapped as "this is an annotation, not a new task".

Each config passes `--for=<cursor|claude|codex>` so the script knows which
of the three invoked it. That matters because Cursor runs *both*
`.cursor/hooks.json` and `.claude/settings.json` for the same prompt
(docs.cursor.com/docs/reference/third-party-hooks: UserPromptSubmit maps
to beforeSubmitPrompt, all sources run, responses merge). The Claude
config, when Cursor is the caller, exits without a TypeSafe call.

Never blocks. Never raises on the TypeSafe call failing — a network error,
missing key, or non-200 response degrades to a short "Jev unavailable" note
and always exits 0, because a third-party judgment call must never be able to
stop you from working (fail open, per the founder's decision).
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

try:
    import certifi  # noqa: WPS433 — optional; several macOS python.org installs
    # ship without a linked system CA bundle, so urllib's default SSL context
    # fails closed with CERTIFICATE_VERIFY_FAILED even against a real cert.
    # Prefer certifi's bundle when it's importable; fall back to the
    # interpreter's default context otherwise (e.g. on Linux CI images where
    # system certs are already correct).
    _SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CONTEXT = ssl.create_default_context()

TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
TYPESAFE_MODEL = "jev-latest"
TIMEOUT_SECONDS = 6  # keep this well under every tool's hook timeout so a
# slow or hung TypeSafe call never becomes a slow or hung prompt submission

MODEL_INSTRUCTION = (
    "This is a classification of the user's prompt, not a new task. "
    "If ambiguous is 0.80 or higher, ask a clarifying question before acting."
)

# The three atomic questions asked of every submitted prompt. Kept here, in
# one place, per the TypeSafe skill's own "vibe coding" guidance: questions
# and thresholds belong in a single reviewable spot, not scattered.
QUESTIONS = {
    "request_type": {
        "type": "choice",
        "instructions": "What kind of request is this message to a coding agent?",
        "criteria": {
            "question": "The user is asking for information, an explanation, or a status check — no files will change.",
            "code_change": "The user wants ordinary code, config, or content written or edited.",
            "architecture_decision": "The user is asking to choose or lock in a design, approach, or irreversible technical direction.",
            "destructive_action": "The user is asking to delete, merge, deploy, force-push, revoke, or otherwise take an action that is hard or impossible to undo.",
            "other": "None of the above fits well.",
        },
    },
    "risk": {
        "type": "score",
        "instructions": (
            "If a coding agent carried out this request literally and immediately, "
            "with no further confirmation, how much damage could that cause?"
        ),
        "criteria": [
            "None: read-only or purely informational, nothing changes.",
            "Low: ordinary reversible edits (a new file, a docs change, a local script).",
            "Moderate: changes that touch shared/production-adjacent config, other people's work, or are annoying but recoverable to undo.",
            "High: could delete data, merge/deploy to production, expose a secret, or is otherwise hard to reverse.",
        ],
    },
    "needs_clarification": {
        "type": "noul",
        "instructions": (
            "Is this message ambiguous enough (missing scope, missing target, "
            "missing which-of-several-options) that a careful agent should ask "
            "a clarifying question before acting on it, rather than guessing?"
        ),
    },
}


_KEY_VAR_NAMES = ("JEV_API_KEY", "TYPESAFE_API_KEY")  # founder set JEV_API_KEY
# in the repo-root .env (2026-09-20); TYPESAFE_API_KEY accepted as an alias
# for anyone following TypeSafe's own docs naming instead.


def _read_env_file(env_path: Path, var_names: tuple[str, ...]) -> str | None:
    try:
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            for var_name in var_names:
                if line.startswith(f"{var_name}="):
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if value:
                        return value
    except OSError:
        pass
    return None


def _load_env_var(*var_names: str) -> str | None:
    """Environment first, then the nearest `.env` at or above this script,
    bounded so a file dropped outside the repo can never supply the key.

    The bounds matter more than they look. This walk used to run to "/" and
    take the first matching line it found anywhere above the script. Worktrees
    of this repo live under /private/tmp (mode 1777) and under ~/Documents, so
    any unprivileged local process could drop a .env in a shared ancestor and
    have every prompt typed in those checkouts POSTed to TypeSafe under a key
    it controls — and the annotation would look exactly the same, so nothing
    would show it had happened.

    Three rules, each carrying its own weight:
      * a world-writable directory never supplies a key, whatever it holds;
      * the FIRST .env found wins, so a nearer file cannot be skipped past;
      * the walk stops at a real repo root — a `.git` DIRECTORY. A `.git`
        FILE marks a linked worktree, which must keep walking: the checkouts
        under .claude/worktrees/ hold no .env of their own and read the main
        one above them.
    """
    for var_name in var_names:
        value = os.environ.get(var_name)
        if value:
            return value
    here = Path(__file__).resolve()
    found = _walk_up_for_env(here.parent, var_names)
    if found is not None:
        return found
    # An EXTERNAL linked worktree -- `git worktree add ~/somewhere/lane`, which
    # is what Cursor's agent worktrees are -- holds no .env and has no main
    # checkout above it, so the walk above ran to `/` and found nothing (or, on
    # a machine that keeps a .env in a home directory, found the WRONG one).
    # Measured 2026-09-21: 112 of this machine's 148 worktrees, including every
    # ~/.cursor/worktrees/* checkout, got "[JEV] not configured" -- i.e. the
    # surface this was built for was the one surface it did not serve
    # (PR #408 correctness N2). The `.git` FILE names the main repo; follow it.
    main_root = _linked_worktree_main_root(here.parent)
    if main_root is not None:
        return _walk_up_for_env(main_root, var_names)
    return None


def _walk_up_for_env(start: Path, var_names: tuple[str, ...]) -> str | None:
    """The three rules above, from `start` upward. None means 'kept looking'."""
    for parent in [start, *start.parents]:
        try:
            world_writable = bool(parent.stat().st_mode & 0o002)
        except OSError:
            return None
        env_path = parent / ".env"
        if env_path.is_file() and not world_writable:
            return _read_env_file(env_path, var_names)
        if (parent / ".git").is_dir():
            return None
    return None


def _linked_worktree_main_root(start: Path) -> Path | None:
    """The main checkout a linked worktree belongs to, or None.

    A linked worktree's `.git` is a FILE reading
    `gitdir: /main/.git/worktrees/<name>`. The main root is the parent of that
    `.git` directory. Read, never executed -- no `git` subprocess, so this also
    works when git is absent or refuses the directory as dubiously owned (the
    same refusal that used to make the Codex config exit 2).
    """
    for parent in [start, *start.parents]:
        dot_git = parent / ".git"
        if dot_git.is_dir():
            return None  # a real repo root; the walk already covered it
        if not dot_git.is_file():
            continue
        try:
            line = dot_git.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return None
        if not line.startswith("gitdir:"):
            return None
        gitdir = Path(line[len("gitdir:"):].strip())
        if not gitdir.is_absolute():
            gitdir = (parent / gitdir).resolve()
        for anc in gitdir.parents:
            if anc.name == ".git":
                return anc.parent
        return None
    return None


def _load_api_key() -> str | None:
    """JEV_API_KEY (or TYPESAFE_API_KEY). Never prints the value."""
    return _load_env_var(*_KEY_VAR_NAMES)


class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a Location. See the call site for why."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        _RefuseRedirect,
        urllib.request.HTTPSHandler(context=_SSL_CONTEXT),
    )


_NO_REDIRECTS = _build_opener()


_LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "[::1]", "::1")


def _override_endpoint() -> str | None:
    """JEV_ENDPOINT_OVERRIDE, accepted only when it points at this machine.

    The guard uses it to drive the failure path against a closed port without
    touching the network. An earlier version accepted ANY scheme and host, and
    justified it as "whoever sets it already controls the key and the machine,
    so it grants nothing new". That was an assumption stated as a fact: setting
    one environment variable is strictly weaker than owning a machine — direnv,
    a shell rc, a VS Code `terminal.integrated.env`, an npm postinstall — and an
    unrestricted override turns env-write into "receives every prompt typed in
    this repo, in plaintext over http if it likes". The response is allow-listed
    field by field, so a hostile endpoint could never INJECT; it could only
    RECEIVE, which for this hook is the whole of the risk.

    Restricting it to loopback makes the sentence true instead of assumed.
    """
    raw = os.environ.get("JEV_ENDPOINT_OVERRIDE")
    if not raw:
        return None
    try:
        host = urllib.parse.urlsplit(raw).hostname
    except ValueError:
        return None
    if host is None:
        return None
    return raw if host.strip("[]").lower() in ("127.0.0.1", "localhost", "::1") else None


def _ask_jev(prompt_text: str, api_key: str) -> dict:
    """One TypeSafe call, all three questions batched together (Speculative
    Fan-Out — one round trip, not three). Raises on any failure; caller
    decides the fail-open behavior."""
    fake = os.environ.get("JEV_FAKE_ANSWERS")
    if fake is not None:
        return {"answers": json.loads(fake)}
    body = json.dumps(
        {
            "state": {"user_message": prompt_text},
            "model": TYPESAFE_MODEL,
            "questions": QUESTIONS,
        }
    ).encode("utf-8")
    # JEV_ENDPOINT_OVERRIDE is a LOOPBACK-ONLY test seam; see _override_endpoint.
    endpoint = _override_endpoint() or TYPESAFE_ENDPOINT
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    # No redirects. urllib's DEFAULT opener follows them, and CPython's
    # redirect_request strips only content-length and content-type -- the
    # Authorization header is forwarded to whatever host the Location names, and
    # http_error_302 permits an https -> http downgrade for up to 10 hops. A
    # compromised response path, or any TLS-intercepting middlebox, answers the
    # POST with `302 Location: http://attacker/` and receives the bearer in
    # plaintext (reproduced live, PR #408 security audit F1). The prompt body is
    # not exfiltrable the same way -- 301/302/303 convert POST to GET and drop
    # `data` -- but the key alone is enough.
    with _NO_REDIRECTS.open(
        req, timeout=TIMEOUT_SECONDS
    ) as resp:
        return json.loads(resp.read().decode("utf-8"))


# The annotation is injected into the model's context, so every field read out
# of the response is treated as hostile input, not as data. A `choice` echoed
# verbatim would put an arbitrary remote string in the system-reminder slot of
# every agent session in this repo — sessions that hold shell, gh, Supabase and
# Vercel credentials. Nothing below is trusted: the choice must be one of our
# own declared criteria, the numbers must really be numbers in range, and the
# risk LABEL comes from our own criteria list rather than the response's
# `legend`, which is remote text too.
_RISK_LABELS = tuple(
    level.split(":", 1)[0].strip() for level in QUESTIONS["risk"]["criteria"]
)
_ANNOTATION_MAX = 200


def _safe_number(value: object, low: float, high: float) -> float | None:
    """A real number in range, or None. Rejects bool, str and NaN."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or not (low <= number <= high):  # NaN fails both
        return None
    return number


def _format_annotation(answers: dict) -> str:
    """One short, highlighted line — this is what "highlight what Jev
    touched" means in practice: every annotation names the three answers
    plainly so it's obvious this came from Jev, not from the agent's own
    judgment."""
    if not isinstance(answers, dict):
        return "[JEV] unreadable answer shape — proceeding without a check"

    def section(name: str) -> dict:
        value = answers.get(name)
        return value if isinstance(value, dict) else {}

    choice = section("request_type").get("choice")
    allowed = QUESTIONS["request_type"]["criteria"]
    # `allowed` is a DICT, so `choice in allowed` hashes it. A response with
    # `"choice": {...}` or `["..."]` raised `TypeError: unhashable type` — the
    # only exception kind in a 60,000-shape fuzz, and it hit 26,036 times.
    # main()'s broad except degraded it to "[JEV] unavailable (TypeError)", so
    # it was never a hazard; it would just have silently cost every prompt in
    # the repo its annotation the day TypeSafe returned an object here.
    req_type = choice if isinstance(choice, str) and choice in allowed else "unknown"
    req_conf = _safe_number(section("request_type").get("confidence"), 0.0, 1.0)

    risk_score = _safe_number(section("risk").get("score"), 0.0, len(_RISK_LABELS) - 1)
    risk_label = _RISK_LABELS[round(risk_score)] if risk_score is not None else None

    needs_clarification = _safe_number(section("needs_clarification").get("noul"), 0.0, 1.0)

    parts = [f"type={req_type}"]
    if req_conf is not None:
        parts[-1] += f" ({req_conf:.2f} confidence)"
    if risk_label is not None:
        parts.append(f"risk={risk_label} ({risk_score:.1f})")
    if needs_clarification is not None:
        parts.append(f"ambiguous={needs_clarification:.2f}")

    return ("[JEV] " + " · ".join(parts))[:_ANNOTATION_MAX]


def _declared_for(argv: list[str]) -> str | None:
    for arg in argv:
        if arg.startswith("--for="):
            value = arg.split("=", 1)[1].strip()
            if value in ("cursor", "claude", "codex"):
                return value
    return None


def _is_cursor_payload(payload: Any) -> bool:
    # `payload` is whatever the harness put on stdin. A list, a string or null
    # is valid JSON and used to reach `.get` here, raising AttributeError before
    # main()'s try block -- exit 1 with a traceback instead of an annotation
    # (PR #408 correctness N4). Anything that is not an object is simply not a
    # Cursor payload.
    if not isinstance(payload, dict):
        return False
    event = payload.get("hook_event_name") or payload.get("hookEventName") or ""
    # Keyed on the EVENT NAME ALONE. It used to also return True on the mere
    # presence of conversation_id / cursor_version / workspace_roots, which was
    # unnecessary (Cursor always sends its event name) and dangerous in the
    # other direction: one such field appearing in a future Claude Code payload
    # would route a real prompt to cursor-replay, which calls nothing, annotates
    # nothing, writes no stderr and exits 0 -- indistinguishable from a working
    # gate (PR #408 security F4). Absence reported as health, in the gate itself.
    return event == "beforeSubmitPrompt"


def resolve_platform(payload: dict[str, Any], argv: list[str] | None = None) -> str:
    """cursor | cursor-replay | claude | codex.

    cursor-replay is Cursor executing the Claude-Code config for the same
    prompt. Skip the TypeSafe call; the --for=cursor invocation already ran.
    """
    declared = _declared_for(argv if argv is not None else sys.argv[1:])
    if declared == "claude" and _is_cursor_payload(payload):
        return "cursor-replay"
    if declared in ("cursor", "claude", "codex"):
        return declared
    if _is_cursor_payload(payload):
        return "cursor"
    if payload.get("turn_id"):
        return "codex"
    return "claude"


def model_facing_text(annotation: str, platform: str) -> str:
    """The string the MODEL must see. Codex appends this after the user
    prompt as a developer message, so the instruction that it is not a new
    task is load-bearing there; Claude wraps it as a system reminder."""
    if platform == "cursor-replay":
        return ""
    return f"{annotation}\n{MODEL_INSTRUCTION}"


def emit_payload(platform: str, annotation: str) -> dict[str, Any]:
    """Stdout JSON for one platform. Never includes decision:block."""
    if platform == "cursor-replay":
        return {"continue": True}

    facing = model_facing_text(annotation, platform)
    nested = {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": facing,
    }
    if platform == "cursor":
        # continue=true never blocks. additional_context is the Vercel-plugin
        # Cursor dialect. hookSpecificOutput is Claude's dialect, which
        # Cursor's third-party-hooks page claims to accept. user_message is
        # kept for the hook log; it does not render when continue is true.
        return {
            "continue": True,
            "user_message": annotation,
            "additional_context": facing,
            "hookSpecificOutput": nested,
        }
    return {"hookSpecificOutput": nested}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        payload = {}
    # Normalise ONCE, here, before anything reads a field. `_is_cursor_payload`
    # was guarded and `resolve_platform:396` was not, so `echo null | ... ` with
    # no --for= still reached `payload.get("turn_id")` and exited 1 with a
    # traceback. Guarding each reader separately is how that gap survived the
    # first fix; there is one entry point, so there is one guard.
    if not isinstance(payload, dict):
        payload = {}

    platform = resolve_platform(payload, argv)
    prompt_text = payload.get("prompt", "")

    def emit(annotation: str) -> None:
        print(json.dumps(emit_payload(platform, annotation)))

    if platform == "cursor-replay":
        emit("")
        return 0

    if not str(prompt_text).strip():
        emit("[JEV] empty prompt, nothing to check")
        return 0

    api_key = _load_api_key()
    if not api_key and os.environ.get("JEV_FAKE_ANSWERS") is None:
        emit(
            "[JEV] not configured — set JEV_API_KEY in .env to enable "
            "the Jev prompt check"
        )
        return 0

    try:
        result = _ask_jev(str(prompt_text), api_key or "test")
        annotation = _format_annotation(result.get("answers", {}))
    # Deliberately broad. A narrow tuple let TypeError and AttributeError
    # escape on a response whose score was a string or whose answers were a
    # list: the hook crashed, the annotation was lost and a traceback reached
    # stderr. Nothing a third party returns may end the prompt submission.
    except Exception as exc:  # noqa: BLE001 — fail open is the decision
        annotation = f"[JEV] unavailable ({type(exc).__name__}) — proceeding without a check"

    emit(annotation)
    return 0


if __name__ == "__main__":
    sys.exit(main())
