#!/usr/bin/env python3
"""
Guard: no dependency directory is ever tracked in git.

WHAT HAPPENED
-------------
On 2026-08-27 `apps/api-gateway/node_modules` was committed to `main` as a
SYMLINK to an absolute path on one developer's laptop:

    120000 blob  apps/api-gateway/node_modules
      -> /Users/<someone>/Projects/restaurant-ai-automation/apps/api-gateway/node_modules

Every CI run then died in `pnpm install`:

    ENOENT ... mkdir '/home/runner/work/.../apps/api-gateway/node_modules'

because pnpm cannot create the real directory on top of a dangling link. Two
jobs went red on `main` and stayed red until it was removed.

The root cause was one character. `.gitignore` said `node_modules/` **with a
trailing slash**, which matches directories only — a symlink of the same name
is not a directory, so it walked past the rule and `git add -A` took it.

WHY A GUARD AND NOT JUST THE GITIGNORE FIX
------------------------------------------
The `.gitignore` fix (dropping the slash) stops the accident recurring the same
way. It does not stop `git add -f`, a differently-named vendor directory, or the
next `.gitignore` edit that reintroduces a slash. This checks the thing that
actually matters — what is TRACKED — rather than what is ignored.

It is cheap: one `git ls-files` over names, no filesystem walk.

Exit codes:  0 pass  |  1 a dependency directory is tracked  |  2 cannot check
"""
import subprocess
import sys

#: Names that are always build output or fetched dependencies, never source.
VENDOR = ("node_modules", ".venv", "__pycache__", ".turbo", ".next")


def main() -> int:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"CANNOT CHECK — git ls-files failed: {exc}")
        return 2

    paths = [p for p in out.split("\0") if p]
    if not paths:
        print("CANNOT CHECK — git ls-files returned nothing (not a repo?)")
        return 2

    offenders = [
        p for p in paths if any(part in VENDOR for part in p.split("/"))
    ]

    print(f"== Tracked files: {len(paths)}, dependency paths among them: {len(offenders)}")
    if not offenders:
        print("PASS — no dependency directory is tracked.")
        return 0

    print("\n== TRACKED DEPENDENCY PATHS")
    for p in offenders[:20]:
        print(f"   {p}")
    if len(offenders) > 20:
        print(f"   … and {len(offenders) - 20} more")
    print(
        "\nFAIL — a dependency directory is tracked in git.\n"
        "   If it is a SYMLINK, every machine but the one that made it gets a\n"
        "   dangling link, and `pnpm install` dies trying to create the real\n"
        "   directory underneath it. That is not a lint failure; it is every CI\n"
        "   job on the branch.\n"
        "   Fix: `git rm --cached <path>` — and check `.gitignore` uses\n"
        "   `node_modules`, NOT `node_modules/`, because the trailing slash\n"
        "   matches directories only and lets a symlink through."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
