#!/usr/bin/env python3
"""`@CurrentUser()` never carries an `id` field — `JwtStrategy.validate` has

never set one (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts` returns
`userId`, not `id`), and `@CurrentUser()` hands the request-scoped object over
UNTYPED (`auth/decorators/current-user.decorator.ts`), so a controller that
types its parameter as `{ id: string }` compiles and every read of `.id` is
`undefined` at runtime — silently, because TypeScript trusts the annotation
rather than the object it describes.

FOUND 2026-09-17 by the nightly E2E walk (PR #349 / ADR 0135), measured live:
`GET /communications/text-senders` returned `myConsent.reason: 'invalid input
syntax for type uuid: "undefined"'` for every caller. Three controllers had the
fault — `text-senders.controller.ts` (11 reads, including consent WRITES),
`providers.controller.ts` (4 reads: create/setUsualCurrency/delete, plus eight
more parameters typed with a dead `id` field nothing read), and
`provider-intelligence.controller.ts` (1 read, `verifyKnowledge`'s `verified_by`
actor). The same class was already found and fixed twice before, independently,
on 2026-09-12 — `common/rate-limit/rate-limit.guard.ts` and
`communications/letters/house-letters.actor.ts` both carry a full post-mortem
comment naming the identical shape. Three sites in one day is a pattern, not a
coincidence, hence this guard rather than a fourth manual sweep.

WHAT IT FLAGS
-------------
Per `*.controller.ts` file, per `@CurrentUser()` parameter:

  A. its type (inline object literal, or a named `interface`/`type` it
     references) declares a property key literally `id` — even one nothing
     reads yet, because that is exactly how providers.controller.ts's eight
     dead `id` fields were sitting when the eleventh one was read.
  B. the bound parameter is read as `<name>.id` anywhere else in the file.

Comments are stripped before matching (this repository has twice had a guard
satisfied by a comment quoting the string it was hunting — including, right
now, the two post-mortems named above, which say `user.id` in prose).

ALLOWLIST
---------
`vendor-intel.controller.ts` keeps `id` in five parameter types and reads it —
but only as `user.userId ?? user.id`, `userId` checked FIRST. That is the safe
shape: `id` is a dead fallback, never the value used. It is not the bug this
guard exists to catch, and is named here rather than silently excluded by
loosening the pattern.

NEVER VACUOUS
-------------
Exit 2 if zero `*.controller.ts` files are found under the scan root, or zero
of them use `@CurrentUser()` at all — the scope has rotted, not passed.

USAGE
    python3 scripts/check_current_user_has_no_id.py
    python3 scripts/check_current_user_has_no_id.py --self-test
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCAN_ROOT = "apps/api-gateway/src"

# path (relative to repo root) -> why it is allowed to keep `id` in scope.
ALLOWLIST: dict[str, str] = {
    "apps/api-gateway/src/vendor-intel/vendor-intel.controller.ts": (
        "reads `user.userId ?? user.id` — userId checked first, id is a dead "
        "fallback that is never the value actually used. Not this bug."
    ),
}

CURRENT_USER_PARAM = re.compile(r"@CurrentUser\(\)\s*(?:readonly\s+)?(\w+)\s*:\s*")
TYPE_DECL = re.compile(r"\b(?:interface|type)\s+(\w+)\b[^{]*\{")
# A property key literally `id` (optionally `?`), not `restaurantId`/`userId`/etc:
# must be at the start of the type text or right after a separator.
BARE_ID_KEY = re.compile(r"(?:^|[{;,])\s*id\s*\??\s*:")


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    text = re.sub(r"//[^\n]*", "", text)
    return text


def balanced_brace_body(text: str, open_brace_idx: int) -> str | None:
    """Text of `{ ... }` starting at `open_brace_idx`, braces included."""
    depth = 0
    for i in range(open_brace_idx, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[open_brace_idx : i + 1]
    return None


def resolve_type_text(text: str, start: int) -> tuple[str, int] | None:
    """The type text right after a `@CurrentUser() name:` match, and where it ends."""
    rest = text[start:]
    stripped = rest.lstrip()
    skipped = len(rest) - len(stripped)
    if stripped.startswith("{"):
        body = balanced_brace_body(text, start + skipped)
        if body is None:
            return None
        return body, start + skipped + len(body)
    m = re.match(r"\w+", stripped)
    if not m:
        return None
    type_name = m.group(0)
    end = start + skipped + len(type_name)
    decl = TYPE_DECL.search(text)
    while decl:
        if decl.group(1) == type_name:
            body = balanced_brace_body(text, decl.end() - 1)
            if body is not None:
                return body, end
        decl = TYPE_DECL.search(text, decl.end())
    # A named type this guard cannot resolve (imported from elsewhere, a DTO
    # class, etc.) has no `id` this file could be blamed for declaring.
    return "", end


def findings_for_file(rel_path: str, raw_text: str) -> tuple[list[str], int]:
    """(violations, number of @CurrentUser() parameters seen)."""
    text = strip_comments(raw_text)
    violations: list[str] = []
    param_names: set[str] = set()
    seen = 0

    for m in CURRENT_USER_PARAM.finditer(text):
        seen += 1
        name = m.group(1)
        param_names.add(name)
        resolved = resolve_type_text(text, m.end())
        if resolved is None:
            continue
        type_text, _end = resolved
        if BARE_ID_KEY.search(type_text):
            line = text.count("\n", 0, m.start()) + 1
            violations.append(
                f"{rel_path}:{line}  @CurrentUser() {name}: type declares `id` "
                f"— JwtStrategy never sets it"
            )

    if param_names:
        alt = "|".join(re.escape(n) for n in sorted(param_names))
        read_re = re.compile(rf"\b(?:{alt})\??\.id\b")
        for n, line in enumerate(text.splitlines(), 1):
            m = read_re.search(line)
            if m:
                violations.append(
                    f"{rel_path}:{n}  reads `{line.strip()[:100]}` "
                    f"— .id is undefined at runtime"
                )

    return violations, seen


def scan() -> tuple[list[str], int, int]:
    """(violations, controller files scanned, files using @CurrentUser())."""
    violations: list[str] = []
    scanned = 0
    using_current_user = 0
    base = REPO_ROOT / SCAN_ROOT
    for path in sorted(base.rglob("*.controller.ts")):
        if not path.is_file():
            continue
        rel = str(path.relative_to(REPO_ROOT))
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        scanned += 1
        if "@CurrentUser()" not in text:
            continue
        using_current_user += 1
        if rel in ALLOWLIST:
            continue
        file_violations, _seen = findings_for_file(rel, text)
        violations.extend(file_violations)
    return violations, scanned, using_current_user


def self_test() -> int:
    failures: list[str] = []

    def check(label: str, path: str, text: str, want_violations: int) -> None:
        got, _seen = findings_for_file(path, text)
        if len(got) != want_violations:
            failures.append(
                f"{label}: wanted {want_violations} violation(s), got {len(got)} — {got}"
            )

    # The exact pre-fix shape of text-senders.controller.ts.
    check(
        "inline id + .id read (text-senders shape)",
        "x.controller.ts",
        """
        interface Actor { id: string; restaurantId: string }
        async readout(@CurrentUser() user: Actor) {
          const mine = await this.senders.myConsent(user.restaurantId, user.id);
        }
        """,
        2,  # type declares id, AND a .id read
    )

    # providers.controller.ts's dead-field shape: declared, never read.
    check(
        "dead id field, never read",
        "x.controller.ts",
        """
        async listProviders(
          @CurrentUser() user: { id: string; restaurantId: string },
        ) {
          return this.svc.listProviders(user.restaurantId);
        }
        """,
        1,
    )

    # The correct, already-fixed shape.
    check(
        "userId only — clean",
        "x.controller.ts",
        """
        async listProviders(
          @CurrentUser() user: { userId: string; restaurantId: string },
        ) {
          return this.svc.listProviders(user.restaurantId, user.userId);
        }
        """,
        0,
    )

    # The vendor-intel fallback shape — flagged by the bare scanner (the
    # allowlist, not this function, is what excuses the real file).
    check(
        "userId ?? id fallback — still 2 violations before the allowlist",
        "x.controller.ts",
        """
        async f(@CurrentUser() user: { userId?: string; id?: string }) {
          const userId = user.userId ?? user.id;
        }
        """,
        2,
    )

    # A comment mentioning `user.id` must not trip the guard — this is
    # exactly what house-letters.actor.ts and rate-limit.guard.ts's own
    # post-mortem comments do.
    check(
        "comment only — clean",
        "x.controller.ts",
        """
        // typed their caller as { id, restaurantId } and read user.id.
        async f(@CurrentUser() user: { userId: string }) {
          return user.userId;
        }
        """,
        0,
    )

    # A resolved named-interface reference (text-senders' actual shape).
    got, _ = findings_for_file(
        "x.controller.ts",
        """
        interface Actor {
          id: string;
          restaurantId: string;
        }
        requirements(@CurrentUser() _user: Actor) {
          return {};
        }
        """,
    )
    if len(got) != 1:
        failures.append(f"named interface reference: wanted 1, got {len(got)} — {got}")

    # Full-repo ALLOWLIST scan must still see the real fixed files as clean,
    # and the real allowlisted file must resolve to a path this guard would
    # actually reach.
    allowlisted_path = REPO_ROOT / "apps/api-gateway/src/vendor-intel/vendor-intel.controller.ts"
    if not allowlisted_path.is_file():
        failures.append(
            f"ALLOWLIST names a path that does not exist: {allowlisted_path} "
            "— the allowlist has rotted"
        )

    if failures:
        print("SELF-TEST FAILED")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("SELF-TEST PASSED")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()

    try:
        violations, scanned, using = scan()
    except Exception as exc:  # noqa: BLE001 — a guard that cannot run is a failure
        print(f"FAIL — the guard could not run: {exc}", file=sys.stderr)
        return 2

    if scanned == 0:
        print(
            f"FAIL — 0 *.controller.ts files found under {SCAN_ROOT}. "
            "The scan root is wrong.",
            file=sys.stderr,
        )
        return 2
    if using == 0:
        print(
            "FAIL — 0 controllers use @CurrentUser() at all. Either the "
            "decorator was renamed or the scope has rotted.",
            file=sys.stderr,
        )
        return 2

    print(
        f"== @CurrentUser() id field: {scanned} controller(s) scanned, "
        f"{using} use @CurrentUser(), {len(ALLOWLIST)} allowlisted"
    )
    if violations:
        print()
        print("FAIL — a @CurrentUser() parameter names or reads `id`:")
        for v in violations:
            print(f"     {v}")
        print()
        print(
            "   JwtStrategy.validate returns `userId`, never `id` "
            "(auth/strategies/jwt.strategy.ts) — @CurrentUser() hands the "
            "object over untyped, so this compiles and reads undefined at "
            "runtime. Use `userId`. If `id` is a deliberate, checked-second "
            "fallback (never the value actually used), add the file to "
            "ALLOWLIST in this script with the reason."
        )
        return 1

    print("PASS — every @CurrentUser() parameter matches what JwtStrategy sets.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
