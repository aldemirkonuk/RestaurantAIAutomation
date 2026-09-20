"""Stdout dialect tests for scripts/jev/prompt_gate.py.

Run: python3 -m pytest scripts/jev/prompt_gate_test.py -q

No TypeSafe call. These tests pin the three harness dialects so a refactor
that drops additionalContext (Claude/Codex) or additional_context (Cursor)
goes red — that is the whole point of the 2026-09-20 visibility fix.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "scripts" / "jev" / "prompt_gate.py"
sys.path.insert(0, str(GATE.parent))

from prompt_gate import (  # noqa: E402
    MODEL_INSTRUCTION,
    emit_payload,
    model_facing_text,
    resolve_platform,
)

CURSOR_STDIN = {
    "hook_event_name": "beforeSubmitPrompt",
    "prompt": "is jev working",
    "cursor_version": "3.21.16",
    "conversation_id": "abc",
    "workspace_roots": ["/tmp"],
}
CLAUDE_STDIN = {
    "hook_event_name": "UserPromptSubmit",
    "prompt": "is jev working",
    "session_id": "abc",
}
CODEX_STDIN = {
    "hook_event_name": "UserPromptSubmit",
    "prompt": "is jev working",
    "turn_id": "turn-1",
}


def test_cursor_payload_is_cursor():
    assert resolve_platform(CURSOR_STDIN, ["--for=cursor"]) == "cursor"


def test_claude_config_on_cursor_stdin_is_a_replay_and_skips():
    assert resolve_platform(CURSOR_STDIN, ["--for=claude"]) == "cursor-replay"


def test_claude_payload_is_claude():
    assert resolve_platform(CLAUDE_STDIN, ["--for=claude"]) == "claude"


def test_codex_payload_is_codex():
    assert resolve_platform(CODEX_STDIN, ["--for=codex"]) == "codex"


def test_cursor_emit_carries_the_model_injection_fields():
    body = emit_payload("cursor", "[JEV] type=question")
    assert body["continue"] is True
    assert "decision" not in body
    facing = body["additional_context"]
    assert facing.startswith("[JEV] type=question")
    assert MODEL_INSTRUCTION in facing
    nested = body["hookSpecificOutput"]
    assert nested["hookEventName"] == "UserPromptSubmit"
    assert nested["additionalContext"] == facing


def test_claude_emit_nests_additionalContext_and_never_blocks():
    body = emit_payload("claude", "[JEV] type=question")
    assert "continue" not in body or body.get("continue") is not False
    assert body.get("decision") != "block"
    nested = body["hookSpecificOutput"]
    assert nested["hookEventName"] == "UserPromptSubmit"
    assert nested["additionalContext"].startswith("[JEV] type=question")
    assert MODEL_INSTRUCTION in nested["additionalContext"]
    # Top-level additionalContext is silently ignored by Claude Code.
    assert "additionalContext" not in body


def test_codex_emit_matches_claude_shape_with_the_not_a_new_task_line():
    body = emit_payload("codex", "[JEV] type=destructive_action")
    nested = body["hookSpecificOutput"]
    assert nested["hookEventName"] == "UserPromptSubmit"
    facing = nested["additionalContext"]
    assert facing.startswith("[JEV] type=destructive_action")
    assert MODEL_INSTRUCTION in facing
    assert body.get("decision") != "block"


def test_cursor_replay_emits_continue_only():
    body = emit_payload("cursor-replay", "[JEV] type=question")
    assert body == {"continue": True}


def test_model_facing_text_is_empty_on_replay():
    assert model_facing_text("[JEV] x", "cursor-replay") == ""


def _run(stdin: dict, extra_args: list[str]) -> dict:
    env = os.environ.copy()
    env["JEV_FAKE_ANSWERS"] = json.dumps(
        {
            "request_type": {"choice": "question", "confidence": 1.0},
            "risk": {"score": 0.0, "legend": {"0": "None: nothing"}},
            "needs_clarification": {"noul": 0.2},
        }
    )
    proc = subprocess.run(
        [sys.executable, str(GATE), *extra_args],
        input=json.dumps(stdin),
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_subprocess_claude_stdout_is_nested_additionalContext():
    body = _run(CLAUDE_STDIN, ["--for=claude"])
    assert "[JEV] type=question" in body["hookSpecificOutput"]["additionalContext"]
    assert MODEL_INSTRUCTION in body["hookSpecificOutput"]["additionalContext"]


def test_subprocess_codex_stdout_is_nested_additionalContext():
    body = _run(CODEX_STDIN, ["--for=codex"])
    assert "[JEV] type=question" in body["hookSpecificOutput"]["additionalContext"]


def test_subprocess_cursor_replay_does_not_include_an_annotation():
    body = _run(CURSOR_STDIN, ["--for=claude"])
    assert body == {"continue": True}


def test_subprocess_cursor_includes_additional_context():
    body = _run(CURSOR_STDIN, ["--for=cursor"])
    assert body["continue"] is True
    assert "[JEV] type=question" in body["additional_context"]
    assert "[JEV] type=question" in body["hookSpecificOutput"]["additionalContext"]


def test_hook_configs_pin_for_flags_and_codex_timeout():
    """The three harness configs are how Claude/Codex/Cursor actually spawn
    this script. A dialect test on emit_payload is vacuous if the config
    still calls the script with no --for= or a key the harness ignores."""
    claude = json.loads((ROOT / ".claude" / "settings.json").read_text())
    claude_cmd = claude["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
    assert "--for=claude" in claude_cmd
    assert "CLAUDE_PROJECT_DIR" in claude_cmd

    cursor = json.loads((ROOT / ".cursor" / "hooks.json").read_text())
    assert "--for=cursor" in cursor["hooks"]["beforeSubmitPrompt"][0]["command"]

    codex = json.loads((ROOT / ".codex" / "hooks.json").read_text())
    handler = codex["hooks"]["UserPromptSubmit"][0]["hooks"][0]
    assert "--for=codex" in handler["command"]
    assert "git rev-parse --show-toplevel" in handler["command"]
    assert handler["timeout"] == 8
    assert "timeoutSec" not in json.dumps(codex)


def test_dropping_additionalContext_would_fail_this_file():
    """Mutation sentinel: if emit_payload for claude/codex stops nesting
    additionalContext, these asserts fail. Keep this test even if you
    rename the helper — the field name is the contract with the harness."""
    for platform in ("claude", "codex"):
        nested = emit_payload(platform, "[JEV] x")["hookSpecificOutput"]
        assert "additionalContext" in nested, platform
        assert nested["additionalContext"]
