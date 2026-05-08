#!/usr/bin/env python3
"""Normalize machine-specific absolute paths in .planning/**/*.md to repo-relative form."""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PLANNING = REPO / ".planning"

# Historical checkout locations: treat as monorepo root.
ROOT_QUOTED = "/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant AI Automation"
ROOT_ESC = r"/Users/aldemirkonuk/Desktop/UnicornProjects/Restaurant\ AI\ Automation"
# Same path as bare arg (grep, python -m py_compile, etc.)
ROOT_ESC_SLASH = ROOT_ESC + "/"
CLAUDE_ABS = "/Users/aldemirkonuk/.claude/"


def normalize(content: str) -> str:
    # GSD @-includes: home-relative tilde
    content = content.replace("@/Users/aldemirkonuk/.claude/", "~/.claude/")

    # cd into services/agent-orchestrator (quoted).
    content = content.replace(
        f'cd "{ROOT_QUOTED}/services/agent-orchestrator"',
        "cd services/agent-orchestrator",
    )
    # cd with escaped spaces
    content = content.replace(
        f"cd {ROOT_ESC}/services/agent-orchestrator",
        "cd services/agent-orchestrator",
    )

    # cd repo root then && (drop cd; commands use paths from root)
    content = content.replace(f'cd "{ROOT_QUOTED}" && ', "")
    content = content.replace(f"cd {ROOT_ESC} && ", "")

    # Standalone instructional cd to repo root
    content = content.replace(f'cd "{ROOT_QUOTED}"', "# Run from repository root")
    content = content.replace(f"cd {ROOT_ESC}", "# Run from repository root")

    # Any remaining absolute path to repo files becomes relative from root.
    content = content.replace(f'"{ROOT_QUOTED}/', '"')
    content = content.replace(f"{ROOT_QUOTED}/", "")
    content = content.replace(ROOT_ESC_SLASH, "")

    # Tracebacks / File "..."
    content = content.replace(f'File "{ROOT_QUOTED}/', 'File "')

    # Debug doc if home path leaked another way
    content = content.replace(CLAUDE_ABS, "~/.claude/")

    return content


def main() -> int:
    if not PLANNING.is_dir():
        print("No .planning directory", file=sys.stderr)
        return 1

    changed = 0
    for path in sorted(PLANNING.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        new = normalize(text)
        if new != text:
            path.write_text(new, encoding="utf-8", newline="\n")
            changed += 1
            print(path.relative_to(REPO))
    print(f"Updated {changed} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
