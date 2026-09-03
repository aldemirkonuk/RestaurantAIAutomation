#!/usr/bin/env python3
"""TOAST_MOCK_MODE is the only thing that decides, and unset means mock.

WHY THIS EXISTS
---------------
`create_toast_client_from_settings()` used to end with:

    if strict:
        mock_mode = False

and `get_toast_client()` (services/agent-orchestrator/api/toast_routes.py) —
the /api/v1/toast router's sole production caller — always passes strict=True.
So the switch could not gate the router at all. Measured on the pre-fix tree,
2026-09-03, with TOAST_MOCK_MODE at its documented safe value `true` and egress
recorded at the socket layer:

    settings.toast_mock_mode       = True
    client.mock_mode after factory = False
    EGRESS ATTEMPTED: DNS for ws-api.toasttab.com:443

Production makes that load-bearing: measured the same day against the live
Railway `production` environment, TOAST_MOCK_MODE is absent from BOTH services
while TOAST_CLIENT_ID (32 chars) and TOAST_CLIENT_SECRET (64 chars) are set on
`services/agent-orchestrator`. An unset switch therefore had to mean mock, and
did not.

WHY IT IS AN AST CHECK AND NOT A GREP
-------------------------------------
The factory's docstring quotes the deleted line verbatim, because the reasoning
is worth keeping. A grep for `if strict:` cannot tell that quotation from a
regression. This walks the function body with the docstring dropped, so it sees
code and only code.

WHAT IT ASSERTS
---------------
1. The factory body assigns `mock_mode` exactly ONCE. Two assignments is the
   pre-fix shape: read the setting, then override it.
2. That single assignment is `getattr(settings, <name>, True)` — the fallback is
   the SAFE value, not a credentials-derived guess. `not (client_id and
   client_secret)` was the old fallback, and deleting the strict override alone
   did NOT fix the switch: with credentials present that expression is False, so
   the pre-fix tree still attempted DNS. Credentials being present is not
   consent to use them.
3. `Settings.toast_mock_mode` parses fail-closed: only the literal "false"
   disarms it, so unset and malformed both mean mock. Written `== "true"` this
   was fail-OPEN — measured, `TOAST_MOCK_MODE=yes`, `=1` and `=""` all produced
   live, billable calls from a typo.

NEVER VACUOUS
-------------
Exit 2 whenever this cannot check what it says it checks — a missing file, a
parse error, a renamed function. A guard that cannot run does not get to pass.
Exit 1 when the property is genuinely violated. Exit 0 only on a real check.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLIENT = REPO / "services/agent-orchestrator/services/toast_api_client.py"
SETTINGS = REPO / "services/agent-orchestrator/config/settings.py"
FACTORY = "create_toast_client_from_settings"


def die(code: int, msg: str) -> None:
    sys.stderr.write(f"{msg}\n")
    raise SystemExit(code)


def parse(path: Path) -> ast.Module:
    if not path.is_file():
        die(2, f"CANNOT CHECK: {path} does not exist (renamed or moved?)")
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (
        SyntaxError
    ) as exc:  # pragma: no cover - a broken tree fails the build anyway
        die(2, f"CANNOT CHECK: {path} does not parse: {exc}")


def strip_docstring(body: list[ast.stmt]) -> list[ast.stmt]:
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        return body[1:]
    return body


def check_factory() -> list[str]:
    tree = parse(CLIENT)
    funcs = [
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == FACTORY
    ]
    if len(funcs) != 1:
        die(
            2,
            f"CANNOT CHECK: found {len(funcs)} definitions of {FACTORY}() in {CLIENT}",
        )

    body = strip_docstring(funcs[0].body)
    assigns = [
        node
        for node in ast.walk(ast.Module(body=body, type_ignores=[]))
        if isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign))
        and any(
            isinstance(t, ast.Name) and t.id == "mock_mode"
            for t in (
                node.targets
                if isinstance(node, ast.Assign)
                else [node.target]  # AugAssign / AnnAssign
            )
        )
    ]

    problems: list[str] = []
    if len(assigns) != 1:
        problems.append(
            f"{FACTORY}() assigns mock_mode {len(assigns)} times, expected 1. "
            "The pre-fix shape read the setting and then overrode it with "
            "`if strict: mock_mode = False`, which let the router reach Toast "
            "with the switch at its safe value."
        )
        return problems

    value = assigns[0].value
    ok = (
        isinstance(value, ast.Call)
        and isinstance(value.func, ast.Name)
        and value.func.id == "getattr"
        and len(value.args) == 3
        and isinstance(value.args[2], ast.Constant)
        and value.args[2].value is True
    )
    if not ok:
        problems.append(
            f"{FACTORY}() must default mock_mode to the SAFE value: "
            'getattr(settings, "toast_mock_mode", True). A credentials-derived '
            "fallback goes live whenever credentials happen to be set, which is "
            "the production shape."
        )
    return problems


def check_settings_parse() -> list[str]:
    tree = parse(SETTINGS)
    for node in ast.walk(tree):
        # `self.toast_mock_mode: bool = ...` is an AnnAssign, not an Assign.
        if isinstance(node, ast.Assign):
            target = node.targets[0]
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            target = node.target
        else:
            continue
        if not (
            isinstance(target, ast.Attribute)
            and target.attr == "toast_mock_mode"
            and isinstance(target.value, ast.Name)
            and target.value.id == "self"
        ):
            continue
        src = ast.dump(node.value)
        fail_closed = "NotEq" in src and "'false'" in src.replace('"', "'")
        if fail_closed:
            return []
        return [
            "Settings.toast_mock_mode must be fail-closed: only the literal "
            '"false" may disarm the switch, so that unset AND malformed both '
            'mean mock. An `== "true"` parse turns TOAST_MOCK_MODE=yes, =1 and '
            '="" into live, billable calls.'
        ]
    die(2, f"CANNOT CHECK: no `self.toast_mock_mode = ...` assignment in {SETTINGS}")


def main() -> int:
    problems = check_factory() + check_settings_parse()
    if problems:
        sys.stderr.write("TOAST_MOCK_MODE no longer gates the orchestrator router:\n")
        for p in problems:
            sys.stderr.write(f"  - {p}\n")
        return 1
    print("OK: TOAST_MOCK_MODE is the only decider, and its unset value is mock.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
