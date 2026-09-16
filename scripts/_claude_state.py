#!/usr/bin/env python3
"""Transcript-level helpers for scripts/claude_state_migrate.sh.

Kept separate from the shell script because every operation here is either
JSON-aware (a session transcript is JSONL, one message per line) or has to
distinguish "the file changed" from "the file is now unparseable". Doing that
with sed is how you end up with a 300MB history that `--resume` silently skips.

Not meant to be called directly; the shell script is the interface.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Patterns for pasted secrets. We report counts and the file they live in,
# never the matched text — the whole point is to warn without re-leaking.
SECRET_PATTERNS = {
    "anthropic-api-key": re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}"),
    "openai-api-key": re.compile(r"\bsk-[A-Za-z0-9]{32,}"),
    "github-token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    "aws-access-key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "slack-token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    "private-key-block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "postgres-url-with-password": re.compile(r"postgres(?:ql)?://[^:\s\"]+:[^@\s\"]+@"),
    "supabase-service-key": re.compile(r"\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\."),
}


def sessions(store: Path) -> list[Path]:
    """Transcript files in a project store, newest first."""
    return sorted(
        store.glob("*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def _text_of(message) -> str:
    """Flatten a message's content to plain text, whatever shape it arrived in."""
    content = message.get("content") if isinstance(message, dict) else message
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return " ".join(parts)
    return ""


def summarize(path: Path) -> dict:
    """What a session was about, cheaply — without holding the file in memory."""
    out = {
        "id": path.stem,
        "path": str(path),
        "bytes": path.stat().st_size,
        "mtime": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc),
        "messages": 0,
        "bad_lines": 0,
        "cwd": None,
        "branch": None,
        "version": None,
        "first_prompt": "",
        "last_ts": None,
    }
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                out["bad_lines"] += 1
                continue
            if rec.get("type") in ("user", "assistant"):
                out["messages"] += 1
            out["cwd"] = rec.get("cwd") or out["cwd"]
            out["branch"] = rec.get("gitBranch") or out["branch"]
            out["version"] = rec.get("version") or out["version"]
            out["last_ts"] = rec.get("timestamp") or out["last_ts"]
            if not out["first_prompt"] and rec.get("type") == "user":
                text = _text_of(rec.get("message", {})).strip().replace("\n", " ")
                if text and not text.startswith("<"):
                    out["first_prompt"] = text
    return out


def _print_table(store: Path) -> list[dict]:
    rows = [summarize(p) for p in sessions(store)]
    if not rows:
        print("   (no transcripts in this store)")
        return rows
    total_mb = sum(r["bytes"] for r in rows) / 1_000_000
    print(f"   {len(rows)} session(s), {total_mb:.1f} MB total\n")
    for r in rows:
        prompt = r["first_prompt"][:88] + ("…" if len(r["first_prompt"]) > 88 else "")
        print(f"   ● {r['id']}")
        print(
            f"     {r['mtime']:%Y-%m-%d %H:%M} UTC · {r['messages']} msgs · "
            f"{r['bytes']/1_000_000:.1f} MB · branch {r['branch'] or '—'} · cli {r['version'] or '—'}"
        )
        if prompt:
            print(f'     "{prompt}"')
        if r["bad_lines"]:
            print(f"     ⚠️  {r['bad_lines']} unparseable line(s)")
        print()
    return rows


def cmd_list(store: str) -> int:
    _print_table(Path(store))
    return 0


def cmd_select(store: str, n: str) -> int:
    for p in sessions(Path(store))[: int(n)]:
        print(p)
    return 0


def cmd_manifest(payload: str, repo: str, key: str) -> int:
    root = Path(payload)
    store = root / "projects" / key
    rows = [summarize(p) for p in sessions(store)]
    manifest = {
        "schema": 1,
        "created": datetime.now(timezone.utc).isoformat(),
        "source_repo": repo,
        "source_key": key,
        "sessions": len(rows),
        "bytes": sum(r["bytes"] for r in rows),
        "cli_versions": sorted({r["version"] for r in rows if r["version"]}),
        "branches": sorted({r["branch"] for r in rows if r["branch"]}),
        "has_memory": (store / "memory").is_dir(),
        "has_user_config": (root / "user").is_dir(),
        "session_ids": [r["id"] for r in rows],
    }
    print(json.dumps(manifest, indent=2))
    return 0


def cmd_manifest_field(path: str, field: str) -> int:
    try:
        print(json.loads(Path(path).read_text()).get(field, ""))
    except (OSError, json.JSONDecodeError):
        print("")
    return 0


def cmd_inspect(payload: str) -> int:
    root = Path(payload)
    mpath = root / "manifest.json"
    if mpath.is_file():
        m = json.loads(mpath.read_text())
        print(f"   created      {m.get('created')}")
        print(f"   source repo  {m.get('source_repo')}")
        print(f"   source key   {m.get('source_key')}")
        print(f"   sessions     {m.get('sessions')}")
        print(f"   size         {m.get('bytes', 0)/1_000_000:.1f} MB")
        print(f"   cli versions {', '.join(m.get('cli_versions') or []) or '—'}")
        print(f"   branches     {', '.join(m.get('branches') or []) or '—'}")
        print(f"   memory/      {'yes' if m.get('has_memory') else 'no'}")
        print(f"   user config  {'yes (staged, not auto-installed)' if m.get('has_user_config') else 'no'}")
        print()
    for store in (root / "projects").iterdir():
        if store.is_dir():
            _print_table(store)
    return 0


def cmd_scan(payload: str) -> int:
    hits: dict[str, int] = {}
    files: set[str] = set()
    for path in Path(payload).rglob("*"):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for name, pattern in SECRET_PATTERNS.items():
            found = len(pattern.findall(text))
            if found:
                hits[name] = hits.get(name, 0) + found
                files.add(str(path.relative_to(payload)))
    if not hits:
        print("   ✅ no secret-shaped strings found in the transcripts")
        return 0
    print("   ⚠️  secret-shaped strings found — these were pasted into chat at some point")
    for name, count in sorted(hits.items()):
        print(f"      {count:>5}  {name}")
    print(f"   in {len(files)} file(s). Rotate anything real before handing this bundle over.")
    return 0


def cmd_rewrite(store: str, old: str, new: str) -> int:
    """Repoint every absolute path in the transcripts at the new clone.

    Text-level replace, then a parse check per line: a rewrite that corrupts
    JSON is worse than no rewrite, so we refuse to keep a file that stops
    parsing at a line that parsed before.
    """
    changed = 0
    for path in sessions(Path(store)):
        original = path.read_text(encoding="utf-8", errors="replace")
        if old not in original:
            continue
        updated = original.replace(old, new)

        ok_before = sum(1 for ln in original.splitlines() if ln.strip() and _parses(ln))
        ok_after = sum(1 for ln in updated.splitlines() if ln.strip() and _parses(ln))
        if ok_after < ok_before:
            print(f"   ⚠️  skipped {path.name}: rewrite would break {ok_before - ok_after} line(s)")
            continue

        path.write_text(updated, encoding="utf-8")
        changed += 1
    print(f"   rewrote {changed} transcript(s)")
    return 0


def _parses(line: str) -> bool:
    try:
        json.loads(line)
        return True
    except json.JSONDecodeError:
        return False


def cmd_verify(store: str, repo: str) -> int:
    rows = _print_table(Path(store))
    if not rows:
        print("   ❌ nothing to resume here")
        return 1

    problems = 0
    stale = [r for r in rows if r["cwd"] and r["cwd"] != repo]
    if stale:
        print(f"   ❌ {len(stale)} session(s) still record a different cwd:")
        for r in stale[:5]:
            print(f"      {r['id']}  cwd={r['cwd']}")
        print(f"      Re-run import with the correct --repo, or these will resume against a path that does not exist.")
        problems += 1
    else:
        print(f"   ✅ every session records cwd={repo}")

    broken = [r for r in rows if r["bad_lines"]]
    if broken:
        print(f"   ⚠️  {len(broken)} session(s) contain unparseable lines (usually harmless truncation)")

    empty = [r for r in rows if r["messages"] == 0]
    if empty:
        print(f"   ⚠️  {len(empty)} session(s) hold no user/assistant messages")

    if problems == 0:
        print(f"\n   ✅ `claude --resume` in {repo} will list {len(rows)} session(s).")
    return 1 if problems else 0


COMMANDS = {
    "list": cmd_list,
    "select": cmd_select,
    "manifest": cmd_manifest,
    "manifest-field": cmd_manifest_field,
    "inspect": cmd_inspect,
    "scan": cmd_scan,
    "rewrite": cmd_rewrite,
    "verify": cmd_verify,
}


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in COMMANDS:
        print(f"usage: {os.path.basename(argv[0])} {{{'|'.join(COMMANDS)}}} ...", file=sys.stderr)
        return 2
    try:
        return COMMANDS[argv[1]](*argv[2:])
    except BrokenPipeError:
        # `... | head` closes the pipe early. Silence the interpreter's own
        # "Exception ignored" epilogue by pointing stdout at /dev/null first.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
