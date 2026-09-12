#!/usr/bin/env python3
"""Every HTTP route must SAY whether it is authenticated — ADR 0096.

WHY THIS EXISTS
---------------
On a controller with no class-level `@UseGuards`, a route carrying `@Public()`
and a route carrying nothing are RUNTIME-IDENTICAL: both are reachable without
a token. `AuthController` is the exhibit — 29 routes, no class guard, 23 saying
`@Public()` and 6 saying nothing at all. All six are legitimately public
(`login`, `register`, the two OAuth entry points, `refresh`, `verify-email` —
the routes you use before you hold a token). None is a hole.

That is exactly why the ratchet is worth having. The defect is DECLARATIVE, not
exploitable: a reader cannot tell 23 deliberate decisions from 6 omissions, so
route number 30 gets added silently public and nobody can see that it differs
from the 23. OD-20 happened this way — five controllers were reachable without
authentication because no decorator said they should not be, and the absence
read as a decision.

This guard forces the sentence to be written down. It does not decide which
answer is right; it refuses to let a route decline to answer.

WHAT IT DOES NOT CATCH, STATED
------------------------------
- Whether `@Public()` is the CORRECT answer for a given route. Nothing
  mechanical can. It only ensures somebody typed it on purpose.
- Guards it cannot see: a guard applied globally via `APP_GUARD` in a module,
  or one composed inside a custom decorator. Those are listed as
  `guard-not-recognised` rather than silently passed, so the gap is visible.

NEVER VACUOUS
-------------
Exit 2 when it cannot do its job — no controllers found, no routes found, or a
file it cannot parse. A guard that reports success because it looked at nothing
is the `absence-reported-as-health` fault it exists to prevent.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "api-gateway" / "src"

HTTP_METHODS = ("Get", "Post", "Put", "Patch", "Delete", "All", "Head", "Options")
ROUTE_RE = re.compile(r"^\s*@(" + "|".join(HTTP_METHODS) + r")\s*\(")
CONTROLLER_RE = re.compile(r"^\s*@Controller\s*\(")
CLASS_RE = re.compile(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)")
USEGUARDS_RE = re.compile(r"@UseGuards\s*\(([^)]*)\)", re.S)
PUBLIC_RE = re.compile(r"@Public\s*\(\s*\)")

# A guard that ANSWERS "who is this?". Anything else (rate limiting, a
# production kill-switch, a throttle) may sit on a route without making it
# authenticated, so it must not count as a declaration of exposure.
AUTH_GUARD_RE = re.compile(r"\b\w*(?:Jwt|Auth)\w*Guard\b")


def strip_comments(text: str) -> str:
    """Blank out comments, keeping line numbers intact.

    This is load-bearing, not tidiness. The first version of this guard matched
    `@Public()` and `@UseGuards(...)` anywhere in the file, and the controllers
    in this repo carry long class docstrings that DISCUSS those decorators by
    name — `CommunicationsController`'s OD-20 header mentions `@Public()` seven
    times. Every one of its 17 routes was therefore reported as `public`,
    including the 16 that are JWT-guarded. A guard that reads prose as code
    reports the wrong answer confidently, which is worse than not running.
    """
    out: list[str] = []
    in_block = False
    for line in text.splitlines():
        if in_block:
            end = line.find("*/")
            if end == -1:
                out.append("")
                continue
            line = " " * (end + 2) + line[end + 2 :]
            in_block = False

        rebuilt: list[str] = []
        i = 0
        quote: str | None = None
        while i < len(line):
            ch = line[i]
            if quote:
                rebuilt.append(ch)
                if ch == "\\" and i + 1 < len(line):
                    rebuilt.append(line[i + 1]); i += 2; continue
                if ch == quote:
                    quote = None
                i += 1
                continue
            if ch in "\"'`":
                quote = ch; rebuilt.append(ch); i += 1; continue
            if ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                break
            if ch == "/" and i + 1 < len(line) and line[i + 1] == "*":
                end = line.find("*/", i + 2)
                if end == -1:
                    in_block = True
                    break
                i = end + 2
                continue
            rebuilt.append(ch); i += 1
        out.append("".join(rebuilt))
    return "\n".join(out)


class Fatal(Exception):
    """The guard could not check what it claims to check -> exit 2."""


def decorator_block_above(lines: list[str], idx: int) -> str:
    """Collect the contiguous decorator/comment lines directly above `idx`."""
    out: list[str] = []
    i = idx - 1
    while i >= 0:
        s = lines[i].strip()
        if (
            s.startswith("@")
            or s.startswith("//")
            or s.startswith("*")
            or s.startswith("/*")
            or s.endswith("*/")
            or s == ""
            or s.startswith(")")
            or s.startswith("}")
            or s.startswith("{")
            or ":" in s
            or s.endswith(",")
        ):
            out.append(lines[i])
            i -= 1
            continue
        break
    return "\n".join(reversed(out))


def analyse(path: Path) -> tuple[list[dict], bool]:
    raw = path.read_text(encoding="utf8")
    if "@Controller" not in raw:
        return [], False
    # Decorators are read from CODE ONLY — see strip_comments().
    text = strip_comments(raw)
    lines = text.splitlines()

    class_line = None
    for i, line in enumerate(lines):
        if CLASS_RE.match(line) and any(
            CONTROLLER_RE.match(lines[j]) for j in range(max(0, i - 40), i)
        ):
            class_line = i
            break
    if class_line is None:
        raise Fatal(f"{path}: found @Controller but no class declaration after it")

    header = "\n".join(lines[: class_line + 1])
    class_guards = " ".join(USEGUARDS_RE.findall(header))
    class_public = bool(PUBLIC_RE.search(header))

    routes: list[dict] = []
    for i, line in enumerate(lines):
        if not ROUTE_RE.match(line):
            continue
        block = decorator_block_above(lines, i) + "\n" + line
        # walk forward to the handler name, gathering any decorators below the
        # route decorator too (order is not fixed in this codebase)
        j = i + 1
        handler = "<unknown>"
        while j < len(lines) and j < i + 30:
            s = lines[j].strip()
            if s.startswith("@"):
                block += "\n" + lines[j]
            m = re.match(r"^\s*(?:async\s+)?(\w+)\s*\(", lines[j])
            if m and not s.startswith("@") and m.group(1) not in ("if", "for", "while"):
                handler = m.group(1)
                break
            j += 1

        route_guards = " ".join(USEGUARDS_RE.findall(block))
        route_public = bool(PUBLIC_RE.search(block))
        all_guards = f"{class_guards} {route_guards}".strip()

        if route_public or class_public:
            verdict = "public"
        elif AUTH_GUARD_RE.search(all_guards):
            verdict = "auth-guarded"
        elif all_guards:
            verdict = "guard-not-recognised"
        else:
            verdict = "UNDECLARED"

        routes.append(
            {
                "file": str(
                    path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
                ),
                "line": i + 1,
                "handler": handler,
                "verdict": verdict,
                "guards": all_guards,
            }
        )
    return routes, True


SELF_TEST_FIXTURES: list[tuple[str, str, str]] = [
    (
        "class guard covers every route",
        """
@UseGuards(JwtAuthGuard)
@Controller("x")
export class XController {
  @Get("a")
  async a() {}
}
""",
        "auth-guarded",
    ),
    (
        "route-level @Public wins over the class guard",
        """
@UseGuards(JwtAuthGuard)
@Controller("x")
export class XController {
  @Public()
  @Post("hook")
  async hook() {}
}
""",
        "public",
    ),
    (
        "no guard and no @Public is UNDECLARED",
        """
@Controller("x")
export class XController {
  @Post("login")
  async login() {}
}
""",
        "UNDECLARED",
    ),
    (
        # This is the bug that shipped in the first version of this guard: the
        # class docstring DISCUSSES @Public(), and every route was reported
        # public — including 16 JWT-guarded ones.
        "a decorator named only in a comment is not a decorator",
        """
/**
 * Routes that are genuinely public must say so with @Public(), and this
 * controller once used @UseGuards(SomethingElse).
 */
@Controller("x")
export class XController {
  @Post("login")
  async login() {}
}
""",
        "UNDECLARED",
    ),
    (
        "a trailing // comment mentioning @Public() does not declare anything",
        """
@Controller("x")
export class XController {
  @Post("login") // unlike the @Public() route below
  async login() {}
}
""",
        "UNDECLARED",
    ),
    (
        "a non-auth guard does not make a route authenticated",
        """
@Controller("x")
export class XController {
  @UseGuards(NonProductionGuard)
  @Post("test/thing")
  async thing() {}
}
""",
        "guard-not-recognised",
    ),
]


def self_test() -> int:
    """Prove the parser discriminates. A guard nobody tested is a guess."""
    import tempfile

    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, source, expected in SELF_TEST_FIXTURES:
            f = Path(tmp) / "t.controller.ts"
            f.write_text(source, encoding="utf8")
            routes, _ = analyse(f)
            got = routes[0]["verdict"] if routes else "<no route parsed>"
            ok = got == expected
            failures += 0 if ok else 1
            print(f"  [{'ok' if ok else 'FAIL'}] {name}: expected {expected}, got {got}")

    if failures:
        print(f"\nSELF-TEST FAILED — {failures} case(s). The parser cannot be trusted.")
        return 2
    print(f"\nSELF-TEST PASSED — {len(SELF_TEST_FIXTURES)} cases.")
    return 0


def main() -> int:
    if not SRC.is_dir():
        print(f"FATAL: {SRC} does not exist", file=sys.stderr)
        return 2

    controllers = sorted(SRC.rglob("*.controller.ts"))
    controllers = [p for p in controllers if not p.name.endswith(".spec.ts")]
    if not controllers:
        print("FATAL: no *.controller.ts found — this guard checked nothing", file=sys.stderr)
        return 2

    all_routes: list[dict] = []
    seen_controllers = 0
    try:
        for path in controllers:
            routes, is_controller = analyse(path)
            if is_controller:
                seen_controllers += 1
            all_routes.extend(routes)
    except Fatal as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    if not all_routes:
        print("FATAL: parsed 0 routes across "
              f"{seen_controllers} controllers — the parser is broken", file=sys.stderr)
        return 2

    counts: dict[str, int] = {}
    for r in all_routes:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1

    print(f"Route exposure: {len(all_routes)} routes across {seen_controllers} controllers")
    for verdict in ("auth-guarded", "public", "guard-not-recognised", "UNDECLARED"):
        print(f"  {verdict:22} {counts.get(verdict, 0)}")

    unrecognised = [r for r in all_routes if r["verdict"] == "guard-not-recognised"]
    if unrecognised:
        print("\nGuarded by something this checker does not recognise as authentication.")
        print("Not a failure — listed so the gap is visible rather than assumed safe:")
        for r in unrecognised:
            print(f"  {r['file']}:{r['line']} {r['handler']} -> {r['guards']}")

    undeclared = [r for r in all_routes if r["verdict"] == "UNDECLARED"]
    if undeclared:
        print(f"\nFAIL — {len(undeclared)} route(s) declare no exposure at all.")
        print("Each is reachable without a token and says nothing about whether that")
        print("is intended. Add @Public() if it is, or an auth guard if it is not.")
        for r in undeclared:
            print(f"  {r['file']}:{r['line']} {r['handler']}")
        return 1

    print("\nPASS — every route says whether it is authenticated.")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(main())
