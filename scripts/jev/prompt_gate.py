#!/usr/bin/env python3
"""
Jev (TypeSafe) prompt gate — a shared UserPromptSubmit hook body for Cursor,
Claude Code, and Codex CLI.

What it does, every time you submit a prompt to any of those three agents in
this repo: sends the prompt to TypeSafe's Jev API with three atomic questions
(request type, risk, ambiguity), then annotates — it never blocks. The founder
decision on 2026-09-20 was explicit: "always annotate ... never block ...
let the LLM take action." See .planning/decisions/<NNN>-jev-prompt-gate.md.

One script, three JSON dialects, because Cursor / Claude Code / Codex each
define their own UserPromptSubmit stdin/stdout shape:

  - Cursor          (`beforeSubmitPrompt`): stdin has `hook_event_name`, `prompt`.
                    stdout ONLY supports {"continue": bool, "user_message": str}.
                    No additionalContext field exists for this event — the
                    annotation can only reach the human, not the model, on
                    this tool. (Verified against docs.cursor.com/docs/hooks,
                    2026-09-20 — see ADR for citation.)
  - Claude Code     (`UserPromptSubmit`): stdin has `hook_event_name`, `prompt`.
                    stdout supports {"hookSpecificOutput": {"hookEventName":
                    "UserPromptSubmit", "additionalContext": str}} — this text
                    is injected into Claude's context as a system reminder and
                    saved in the transcript, but is not rendered as a chat
                    bubble by itself.
  - Codex CLI       (`UserPromptSubmit`): same shape as Claude Code's
                    additionalContext mechanism (OpenAI copied Claude Code's
                    hook vocabulary deliberately).

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
import urllib.request
from pathlib import Path

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


def _load_api_key() -> str | None:
    """JEV_API_KEY (or TYPESAFE_API_KEY) from the environment, or from the
    repo's root .env if the hook subprocess didn't inherit the shell
    environment (common for GUI-launched Cursor/Claude Code/Codex). Never
    prints the value."""
    for var_name in _KEY_VAR_NAMES:
        key = os.environ.get(var_name)
        if key:
            return key
    # Walk up from this script to find a repo-root .env (works from any of
    # the three tools' cwd, since all three pass an absolute script path).
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        env_path = parent / ".env"
        if env_path.is_file():
            try:
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    for var_name in _KEY_VAR_NAMES:
                        if line.startswith(f"{var_name}="):
                            value = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if value:
                                return value
            except OSError:
                pass
    return None


def _ask_jev(prompt_text: str, api_key: str) -> dict:
    """One TypeSafe call, all three questions batched together (Speculative
    Fan-Out — one round trip, not three). Raises on any failure; caller
    decides the fail-open behavior."""
    body = json.dumps(
        {
            "state": {"user_message": prompt_text},
            "model": TYPESAFE_MODEL,
            "questions": QUESTIONS,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        TYPESAFE_ENDPOINT,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(
        req, timeout=TIMEOUT_SECONDS, context=_SSL_CONTEXT
    ) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _format_annotation(answers: dict) -> str:
    """One short, highlighted line — this is what "highlight what Jev
    touched" means in practice: every annotation names the three answers
    plainly so it's obvious this came from Jev, not from the agent's own
    judgment."""
    req_type = answers.get("request_type", {}).get("choice", "unknown")
    req_conf = answers.get("request_type", {}).get("confidence")
    risk_score = answers.get("risk", {}).get("score")
    risk_legend = answers.get("risk", {}).get("legend", {})
    risk_label = None
    if risk_score is not None and risk_legend:
        # nearest level below-or-equal the (possibly fractional) score
        nearest = max(
            (int(k) for k in risk_legend if int(k) <= round(risk_score)),
            default=None,
        )
        if nearest is not None:
            risk_label = risk_legend.get(str(nearest), "").split(":", 1)[0] or None
    needs_clarification = answers.get("needs_clarification", {}).get("noul")

    parts = [f"type={req_type}"]
    if req_conf is not None:
        parts[-1] += f" ({req_conf:.2f} confidence)"
    if risk_label is not None:
        parts.append(f"risk={risk_label} ({risk_score:.1f})")
    if needs_clarification is not None:
        parts.append(f"ambiguous={needs_clarification:.2f}")

    return "[JEV] " + " · ".join(parts)


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        payload = {}

    event_name = payload.get("hook_event_name") or payload.get("hookEventName") or ""
    prompt_text = payload.get("prompt", "")
    is_cursor = event_name == "beforeSubmitPrompt"

    def emit(annotation: str, blocked_message: str | None = None) -> None:
        if is_cursor:
            # Cursor's beforeSubmitPrompt only supports continue/user_message
            # (no additionalContext) — see module docstring. Never block.
            print(json.dumps({"continue": True, "user_message": annotation}))
        else:
            # Claude Code and Codex CLI share the same UserPromptSubmit
            # additionalContext shape.
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "UserPromptSubmit",
                            "additionalContext": annotation,
                        }
                    }
                )
            )

    if not prompt_text.strip():
        emit("[JEV] empty prompt, nothing to check")
        return 0

    api_key = _load_api_key()
    if not api_key:
        emit(
            "[JEV] not configured — set TYPESAFE_API_KEY in .env to enable "
            "the Jev prompt check"
        )
        return 0

    try:
        result = _ask_jev(prompt_text, api_key)
        annotation = _format_annotation(result.get("answers", {}))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as exc:
        annotation = f"[JEV] unavailable ({type(exc).__name__}) — proceeding without a check"

    emit(annotation)
    return 0


if __name__ == "__main__":
    sys.exit(main())
