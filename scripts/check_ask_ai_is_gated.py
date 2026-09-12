#!/usr/bin/env python3
"""Ask AI spends money on demand, so refuse a tree where it is not bounded.

Four faults were measured on `apps/api-gateway/src/ask-ai/` on 2026-09-12 and
closed by ADR 0146. Every one of them was the same shape: **the defence looked
present**. A global ValidationPipe was installed and validated nothing on this
controller. A global rate limiter was bound and could not see who was calling.
A spend ceiling existed and never saw a first call. A guard was declared and
did not check a role.

That shape is why this guard reads SOURCE rather than trusting a name. Each
check below is written so that deleting the thing it protects makes it fail --
and every one was proven to fail by mutation before being committed, which is
this repository's standing bar for a guard (a green guard that cannot go red
protects nothing).

Comments are stripped before any matching. That is not fussiness: twice in one
day in this repository a guard was satisfied by a comment quoting the very
string it was looking for, and once an explanatory comment added by the fix
was the thing that broke the guard.

Exit 0 = every gate is in place. Exit 1 = a gate is missing, and the message
says which. Exit 2 = COULD NOT CHECK (a file this guard reads is absent or
unreadable) -- never reported as a pass.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GW = ROOT / "apps" / "api-gateway" / "src"

CONTROLLER = GW / "ask-ai" / "ask-ai.controller.ts"
SERVICE = GW / "ask-ai" / "ask-ai.service.ts"
DTO = GW / "ask-ai" / "dto" / "ask-ai.dto.ts"
MODEL_CLIENT = GW / "common" / "model-client" / "model-client.service.ts"
AUTHED_GUARD = GW / "common" / "rate-limit" / "authed-rate-limit.guard.ts"

failures: list[str] = []


def cannot_check(why: str) -> "None":
    print(f"CANNOT CHECK: {why}", file=sys.stderr)
    print(
        "This is not a pass. A file this guard reads was absent or unreadable, "
        "so nothing about Ask AI's gating was verified.",
        file=sys.stderr,
    )
    sys.exit(2)


def source(path: Path) -> str:
    """File text with block and line comments removed.

    String literals are left alone. A `//` inside a string would be stripped
    here and that is accepted: no check below matches on a URL or a path, and
    the alternative (a real TypeScript lexer) is a dependency this guard does
    not need.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        cannot_check(f"{path.relative_to(ROOT)} could not be read ({exc})")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    return text


def want(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def main() -> int:
    for path in (CONTROLLER, SERVICE, DTO, MODEL_CLIENT, AUTHED_GUARD):
        if not path.exists():
            cannot_check(f"{path.relative_to(ROOT)} does not exist")

    controller = source(CONTROLLER)
    service = source(SERVICE)
    dto = source(DTO)
    client = source(MODEL_CLIENT)

    # --- 1. The bodies are classes, so ValidationPipe has a metatype -------
    #
    # An inline type erases to `Object` at runtime and the pipe returns the
    # body untouched. Both halves are checked: that the DTO is named, and
    # that no inline object type has come back anywhere on the controller.
    want(
        re.search(r"@Body\(\)\s+body:\s*ProposeDto", controller) is not None,
        "propose does not take ProposeDto -- an inline @Body() type erases at "
        "runtime and ValidationPipe validates nothing",
    )
    want(
        re.search(r"@Body\(\)\s+body:\s*ConfirmDto", controller) is not None,
        "confirm does not take ConfirmDto",
    )
    want(
        re.search(r"@Body\(\)\s+\w+:\s*\{", controller) is None,
        "an inline object type is back on an @Body() in ask-ai.controller.ts -- "
        "this is the exact fault ADR 0146 closed",
    )

    # --- 2. The DTOs actually constrain, rather than merely existing ------
    #
    # A class with no validators passes the pipe unconditionally, which is the
    # same fault wearing a different shape.
    want("@IsString()" in dto, "ProposeDto's utterance is not constrained to a string")
    want(
        re.search(r"@MaxLength\(\s*\d+\s*\)", dto) is not None,
        "no @MaxLength on the utterance -- an unbounded string reaches the model prompt",
    )
    want("@IsObject()" in dto, "ConfirmDto's payload is not constrained to an object")

    # --- 3. Guard order, which is load-bearing ---------------------------
    #
    # AuthedRateLimitGuard keys on request.user.userId and RolesGuard reads
    # user.role. Both see nothing if they run before JwtAuthGuard.
    guards = re.search(r"@UseGuards\(([^)]*)\)", controller)
    if guards is None:
        failures.append("ask-ai.controller.ts declares no @UseGuards at all")
    else:
        names = [g.strip() for g in guards.group(1).split(",") if g.strip()]
        want(
            names and names[0] == "JwtAuthGuard",
            f"JwtAuthGuard is not first in @UseGuards (got {names}) -- the guards "
            "after it read request.user, which does not exist until it runs",
        )
        want(
            "AuthedRateLimitGuard" in names,
            "AuthedRateLimitGuard is not on the controller. The GLOBAL RateLimitGuard "
            "is an APP_GUARD and therefore runs before JwtAuthGuard, so it keys on the "
            "IP and this route falls through to its default of 100/minute",
        )
        want("RolesGuard" in names, "RolesGuard is not on the controller")

    # --- 4. Confirm is the act that writes, so it takes standing ----------
    confirm_block = controller[controller.find("@Post(\"actions/:id/confirm\")") :]
    want(
        '@Post("actions/:id/confirm")' in controller,
        "the confirm route is gone or renamed; this guard no longer describes the tree",
    )
    want(
        re.search(r'@Roles\(\s*"owner"\s*,\s*"manager"\s*\)', confirm_block) is not None,
        'confirm is not @Roles("owner", "manager") -- any member of a house could '
        "confirm any other member's proposal, and confirming is what WRITES",
    )

    # --- 5. propose declares a per-person AND a per-house limit -----------
    #
    # The per-house rule is what stops several members each running at their
    # own per-person limit, and what bounds a patient caller.
    propose_block = controller[
        controller.find('@Post("propose")') : controller.find(
            '@Get("actions")'
        )
    ]
    want(
        "@AuthedRateLimit(" in propose_block,
        "propose declares no authenticated rate limit",
    )
    want(
        'scope: "user"' in propose_block,
        "propose has no per-person limit",
    )
    want(
        'scope: "restaurant"' in propose_block,
        "propose has no per-house limit -- several members would each run at their "
        "own per-person limit",
    )

    # --- 6. The spend ceiling sees propose's FIRST call -------------------
    want(
        "gateFirstAttempt: true" in service,
        "ask-ai.service.ts does not set gateFirstAttempt -- the ceiling would be "
        "consulted only on a retry, so a caller who never retries is never metered",
    )
    want(
        "gateFirstAttempt?: boolean" in client,
        "ModelCallOptions no longer offers gateFirstAttempt",
    )
    want(
        re.search(r"opts\.gateFirstAttempt\s*===\s*true", client) is not None,
        "the first-attempt gate is not an explicit `=== true` -- it must stay opt-in, "
        "because turning it on globally gives seven pre-existing production paths a "
        "failure mode none of them was written to handle",
    )
    # A bare substring test passed this when the class DECLARATION was renamed
    # and only its call sites still spelled it -- caught by mutation before
    # this guard was committed, and the exact reason the rule in this
    # repository is that a row must check the claim and not a proxy for it.
    # So: the type must be declared and exported HERE, and the service must
    # branch on it rather than merely mention it.
    want(
        re.search(r"export class ModelSpendCeilingError\b", client) is not None,
        "ModelSpendCeilingError is no longer declared and exported by "
        "model-client.service.ts, so a spend refusal has no type of its own and "
        "would be reported as a transport outage and retried",
    )
    want(
        re.search(r"instanceof\s+ModelSpendCeilingError", service) is not None,
        "ask-ai.service.ts does not branch on ModelSpendCeilingError, so a spend "
        "refusal falls into the generic catch and is answered as an outage",
    )

    # --- 7. The refusal is honest about what happened --------------------
    want(
        re.search(r"ModelSpendCeilingError[\s\S]{0,600}TOO_MANY_REQUESTS", service)
        is not None,
        "a spend refusal is not answered 429 -- answering 503 would send an operator "
        "looking for an outage that does not exist",
    )

    if failures:
        print("FAIL -- Ask AI is not bounded:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        print(f"\n{len(failures)} gate(s) missing. See ADR 0146.", file=sys.stderr)
        return 1

    print(
        "PASS -- Ask AI validates its bodies, bounds its rate per person and per "
        "house, meters its first call, and takes standing to confirm."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
