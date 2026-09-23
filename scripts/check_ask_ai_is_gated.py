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

# /ask/folios (BoundAskService et al.) is a SECOND route that spends money on
# demand, added after this guard was first written. It was not caught here
# until the KL audit (2026-09-17, J6/D12): the CLAIMS row that certifies the
# first-attempt gate stays opt-in counts call sites by a bare grep, and a PASS
# from THIS guard was being read as if it said something about that route,
# when it read only the three files above. Checked below by the same standard
# as ask-ai itself: DTO metatype, guard order and order, per-person AND
# per-house rate limits, and the first-attempt spend gate.
BOUND_CONTROLLER = GW / "ask-ai" / "bound-ask.controller.ts"
BOUND_SERVICE = GW / "ask-ai" / "bound-ask.service.ts"
BOUND_DTO = GW / "ask-ai" / "dto" / "bound-ask.dto.ts"

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
    for path in (CONTROLLER, SERVICE, DTO, MODEL_CLIENT, AUTHED_GUARD, BOUND_CONTROLLER, BOUND_SERVICE, BOUND_DTO):
        if not path.exists():
            cannot_check(f"{path.relative_to(ROOT)} does not exist")

    controller = source(CONTROLLER)
    service = source(SERVICE)
    dto = source(DTO)
    client = source(MODEL_CLIENT)
    bound_controller = source(BOUND_CONTROLLER)
    bound_service = source(BOUND_SERVICE)
    bound_dto = source(BOUND_DTO)

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
        len(re.findall(r"@Body\(\)\s+body:\s*ConfirmDto", controller)) >= 2,
        "the sealed routes (seal-challenge, sealed-confirm) do not both take ConfirmDto",
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

    # --- 4. Applying is the act that writes: standing AND a redeemed seal ---
    #
    # "Never without the seal" (the founder, 2026-09-21, on /ask). A proposal
    # is applied only through `confirmSealed`, which redeems the seal before it
    # calls the private executor. Five things hold that, each read from code:
    #
    #   a. no handler on ANY controller calls an unsealed `askAi*.confirm(` --
    #      the public method is gone, and a new route reintroducing one fails
    #      here even if it carries @Roles;
    #   b. every handler calling `confirmSealed(` or `issueProposalSeal(` takes
    #      @Roles("owner", "manager") -- checked per HANDLER, on every
    #      controller (the first version sliced from one route to END OF FILE,
    #      so an @Roles on any later handler satisfied it);
    #   c. the retired `@Post("actions/:id/confirm")`, if present, throws a
    #      GoneException and calls NOTHING on the service;
    #   d. the executor is `private async applyAfterSeal(` and the service has
    #      no public `async confirm(`;
    #   e. inside `confirmSealed`, `seals.redeem(` comes BEFORE
    #      `this.applyAfterSeal(` -- a write before the redemption is the
    #      assertion model with extra steps.
    #
    # A handler here is the text from one route decorator to the next, which
    # assumes @Roles sits below its route decorator, as every handler in this
    # controller does.
    route = re.compile(r"@(?:Get|Post|Put|Patch|Delete)\(")
    roles = re.compile(r'@Roles\(\s*"owner"\s*,\s*"manager"\s*\)')
    sealed_callers = 0
    for ctrl in sorted(GW.rglob("*.controller.ts")):
        text = source(ctrl)
        starts = [m.start() for m in route.finditer(text)] + [len(text)]
        for a, b in zip(starts, starts[1:]):
            handler = text[a:b]
            # `askAi.confirm(` and the cast spelling `(this.askAi as any).confirm(`
            # both count: a handler that names Ask AI and calls a `.confirm(` or
            # the private executor is an unsealed apply, however it is typed.
            if re.search(r"\baskAi\w*\b", handler) and re.search(
                r"\.(?:confirm|applyAfterSeal)\(", handler
            ):
                failures.append(
                    f"a handler in {ctrl.relative_to(ROOT)} applies a proposal through "
                    "an unsealed askAi.confirm( -- a proposal is applied only behind a "
                    "redeemed seal (confirmSealed)"
                )
            if re.search(r"askAi\w*\.(?:confirmSealed|issueProposalSeal)\(", handler):
                sealed_callers += 1
                want(
                    roles.search(handler) is not None,
                    f"a handler in {ctrl.relative_to(ROOT)} mints or redeems a proposal "
                    'seal without @Roles("owner", "manager") -- applying is what WRITES',
                )
    # The private executor is called from exactly one place: confirmSealed.
    for ts in sorted(GW.rglob("*.ts")):
        if ts.name.endswith(".spec.ts") or ts == SERVICE:
            continue
        if ".applyAfterSeal(" in source(ts):
            failures.append(
                f"{ts.relative_to(ROOT)} calls applyAfterSeal -- the executor is "
                "reached only from AskAiService.confirmSealed, after the redemption"
            )
    want(
        len(re.findall(r"\.applyAfterSeal\(", service)) == 1,
        "AskAiService calls applyAfterSeal from more than one place (or none) -- "
        "confirmSealed must be its only caller",
    )
    want(
        sealed_callers >= 2,
        "fewer than two handlers mint (issueProposalSeal) or redeem (confirmSealed) "
        "a proposal seal; this guard no longer describes the tree",
    )
    retired_at = controller.find('@Post("actions/:id/confirm")')
    if retired_at != -1:
        nxt = route.search(controller, retired_at + 1)
        retired = controller[retired_at : nxt.start() if nxt else len(controller)]
        want(
            "throw new GoneException(" in retired,
            'the retired @Post("actions/:id/confirm") no longer throws GoneException',
        )
        want(
            re.search(r"this\.askAi\b", retired) is None,
            'the retired @Post("actions/:id/confirm") reaches the service again',
        )
    want(
        re.search(r"private\s+async\s+applyAfterSeal\(", service) is not None,
        "the proposal executor is not `private async applyAfterSeal(` -- a public "
        "executor is an unsealed apply one caller away",
    )
    want(
        re.search(r"^\s+(?:public\s+)?async\s+confirm\(", service, flags=re.M) is None,
        "AskAiService has a public `async confirm(` again -- the unsealed apply",
    )
    sealed_body = re.search(
        r"async\s+confirmSealed\((.*?)\n  async\s+discard\(", service, flags=re.S
    )
    if sealed_body is None:
        failures.append("confirmSealed not found before discard in ask-ai.service.ts")
    else:
        body = sealed_body.group(1)
        redeem_at = body.find("seals.redeem(")
        apply_at = body.find("this.applyAfterSeal(")
        want(
            redeem_at != -1 and apply_at != -1 and redeem_at < apply_at,
            "confirmSealed does not redeem the seal BEFORE it calls applyAfterSeal",
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
    # A present limit is not a bound if its number is not. Every rule on the
    # controller must be integer literals with 1 <= limit <= 1000, a window of
    # 1s to 1 day, and a rate of at most one request per second. The first
    # version checked only that the words `scope: "user"` appeared.
    rules = re.findall(
        r"\{\s*limit:\s*([^,\s]+)\s*,\s*windowSeconds:\s*([^,\s]+)\s*,", controller
    )
    want(len(rules) >= 3, f"expected at least 3 limit rules on the controller, found {len(rules)}")
    for limit_s, window_s in rules:
        if not (limit_s.isdigit() and window_s.isdigit()):
            failures.append(
                f"a rate-limit rule is not integer literals (limit: {limit_s}, "
                f"windowSeconds: {window_s}) -- a bound this guard cannot read is not a bound"
            )
            continue
        lim, win = int(limit_s), int(window_s)
        want(
            1 <= lim <= 1000 and 1 <= win <= 86400 and lim <= win,
            f"rate-limit rule {lim} per {win}s is outside the bounds ADR 0146 sets "
            "(1-1000 requests, a 1s-1d window, at most one request per second)",
        )

    # --- 6. The spend ceiling sees propose's FIRST call -------------------
    want(
        re.search(
            r"this\.modelClient\.call\(\s*\{[^;]{0,1500}?\bgateFirstAttempt:\s*true\s*,", service
        )
        is not None,
        "ask-ai.service.ts does not pass the literal `gateFirstAttempt: true` in its "
        "model call -- the ceiling would be consulted only on a retry, so a caller "
        "who never retries is never metered",
    )
    gate_block = re.search(
        r"if\s*\(\s*opts\.gateFirstAttempt\s*===\s*true\s*\)\s*\{([\s\S]{0,800}?)\n    \}", client
    )
    want(
        gate_block is not None
        and re.search(r"allowedBySpendCeiling\([^)]*,\s*\"daily\"\s*\)", gate_block.group(1)) is not None,
        "the first-attempt gate does not ask the DAILY question -- every production "
        "house is on pilot, a lifetime credit, so a lifetime read makes the refusal "
        "permanent (ADR 0146, founder's answer 2026-09-12)",
    )
    want(
        gate_block is not None
        and "midnight UTC" in gate_block.group(1)
        and "resets on its own" not in client,
        "the spend refusal does not say it resets at midnight UTC, or still says "
        "'resets on its own' -- the message must be the promise the code keeps",
    )
    want(
        re.search(r"\.order\(\s*\"id\"", client) is not None
        and "SPEND_PAGE_ROWS" in client
        and re.search(r"rows\.length\s*<\s*SPEND_PAGE_ROWS", client) is not None,
        "the spend sum reads one page -- PostgREST caps a response at max_rows = 1000, "
        "so a busy house's spend is undercounted and it is admitted past its allowance",
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
    branch = re.search(
        r"if\s*\(\s*\w+\s+instanceof\s+ModelSpendCeilingError\s*\)\s*\{([\s\S]{0,600}?)\n      \}",
        service,
    )
    want(
        branch is not None
        and re.search(
            r"throw\s+new\s+HttpException\([\s\S]*HttpStatus\.TOO_MANY_REQUESTS", branch.group(1)
        )
        is not None,
        "ask-ai.service.ts does not branch on ModelSpendCeilingError with a 429 thrown "
        "INSIDE that branch, so a spend refusal falls into the generic catch and is "
        "answered as an outage",
    )

    # --- 7. The refusal is honest about what happened --------------------
    want(
        re.search(r"ModelSpendCeilingError[\s\S]{0,600}TOO_MANY_REQUESTS", service)
        is not None,
        "a spend refusal is not answered 429 -- answering 503 would send an operator "
        "looking for an outage that does not exist",
    )

    # --- 8. An empty house is refused BEFORE the model is called ------------
    #
    # ADR 0145 build item 8. Every action is grounded against the three candidate
    # lists, so with all three empty no proposal can pass however the model
    # answers; the call would be paid for and then rejected. Checked as ORDER in
    # the source, not mere presence: a gate written after the model call refuses
    # correctly and still spends the money.
    gate = re.search(
        r"if\s*\(\s*lists\.inventory\.length\s*===\s*0\s*&&\s*"
        r"lists\.providers\.length\s*===\s*0\s*&&\s*"
        r"lists\.orders\.length\s*===\s*0\s*\)\s*\{\s*return\s*\{\s*proposed:\s*false",
        service,
    )
    call_at = service.find("this.modelClient.call(")
    want(
        gate is not None and call_at != -1 and gate.start() < call_at,
        "propose does not refuse an empty house before calling the model -- with no "
        "items, vendors or open orders nothing can be grounded, so the call is paid "
        "for and then rejected (ADR 0145 build item 8)",
    )

    # --- 9. /ask/folios (BoundAskService) is bounded the same way ----------
    #
    # A second money-spending route, added after this guard existed. Checked
    # by SOURCE, same as ask-ai above, not by the CLAIMS row's bare grep --
    # that grep can only count how many files opted in, never whether the one
    # opted-in call site actually sits behind a DTO class, guard order, a
    # rate limit, and a typed spend refusal.
    #
    # /ask has no caller (no page, no palette entry -- ADR 0145 row 33 defers
    # the page itself). Every guard above still holds, but none of them stops
    # a curl with a valid JWT, and every hit is a paid model call. The launch
    # gate is the thing that does: it must be the FIRST statement `submit`
    # can reach, before `this.folios.begin(` (KL audit D13, round 2). If this
    # line moves below the folio write or is deleted, a refused-here request
    # would instead write a folio row and spend a model call with no product
    # surface ever having asked for it.
    submit_body_start = bound_service.find("async submit(")
    begin_at = bound_service.find("this.folios.begin(", submit_body_start)
    # Anchored on the flag's own name, not the bare `!== "true"` comparison
    # (D-d, KL2 confirm round): the old anchor stayed green through a rename
    # of the env key, or a second, unrelated `!== "true"` landing ahead of
    # it. This still does not require the specific comparison operator or
    # value, only that the check reads ASK_LAUNCHED before any folio write --
    # the CLAIMS row ADR-0145-ASK-FOLIOS-REFUSES-WITHOUT-LAUNCH-FLAG pins the
    # exact literal as a second, independent line of defence.
    gate_at = bound_service.find('"ASK_LAUNCHED"', submit_body_start)
    want(
        submit_body_start != -1 and gate_at != -1 and begin_at != -1 and gate_at < begin_at,
        "BoundAskService.submit does not refuse before writing a folio when its launch "
        "flag is unset -- /ask/folios has no page or palette caller yet, so a request "
        "with nothing gating it would spend a model call for a route the product cannot "
        "reach (KL audit D13, round 2)",
    )
    want(
        "ServiceUnavailableException" in bound_service,
        "BoundAskService no longer imports ServiceUnavailableException -- the launch "
        "gate above depends on it",
    )
    want(
        re.search(r"@Body\(\)\s+body:\s*BoundAskDto", bound_controller) is not None,
        "bound-ask.controller.ts's submit does not take @Body() body: BoundAskDto -- "
        "an inline @Body() type erases at runtime and ValidationPipe validates nothing",
    )
    want("@IsString()" in bound_dto, "BoundAskDto's utterance is not constrained to a string")
    want(
        re.search(r"@MaxLength\(\s*\d+\s*\)", bound_dto) is not None,
        "BoundAskDto has no @MaxLength on the utterance -- an unbounded string reaches the model prompt",
    )

    bound_guards = re.search(r"@UseGuards\(([^)]*)\)", bound_controller)
    if bound_guards is None:
        failures.append("bound-ask.controller.ts declares no @UseGuards at all")
    else:
        names = [g.strip() for g in bound_guards.group(1).split(",") if g.strip()]
        want(
            names and names[0] == "JwtAuthGuard",
            f"JwtAuthGuard is not first in bound-ask.controller.ts's @UseGuards (got {names})",
        )
        want(
            "AuthedRateLimitGuard" in names,
            "AuthedRateLimitGuard is not on bound-ask.controller.ts -- the route falls "
            "through to the global IP-keyed default",
        )
        want("RolesGuard" in names, "RolesGuard is not on bound-ask.controller.ts")

    want(
        '@Post("folios")' in bound_controller,
        "the /ask/folios route is gone or renamed; this guard no longer describes the tree",
    )
    submit_block = bound_controller[bound_controller.find('@Post("folios")') : bound_controller.find("submit(")]
    want(
        "@AuthedRateLimit(" in submit_block,
        "POST /ask/folios declares no authenticated rate limit",
    )
    want('scope: "user"' in submit_block, "POST /ask/folios has no per-person limit")
    want(
        'scope: "restaurant"' in submit_block,
        "POST /ask/folios has no per-house limit -- several members would each run at "
        "their own per-person limit",
    )

    # Every model call this service makes must be metered on its FIRST attempt,
    # not only a retry -- checked as the literal the spend ceiling reads, same
    # test as ask-ai.service.ts above.
    want(
        re.search(
            r"this\.modelClient\.call\(\s*\{[^;]{0,600}?\bgateFirstAttempt:\s*true\s*,", bound_service
        )
        is not None,
        "bound-ask.service.ts does not pass the literal `gateFirstAttempt: true` on its "
        "model call -- a caller who never retries would never be metered",
    )
    want(
        re.search(r"\bretry:\s*false\b", bound_service) is not None,
        "bound-ask.service.ts's model call does not disable transport retry -- a retried "
        "call bypasses the first-attempt gate a second time for one user action",
    )

    if failures:
        print("FAIL -- Ask AI is not bounded:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        print(f"\n{len(failures)} gate(s) missing. See ADR 0146.", file=sys.stderr)
        return 1

    print(
        "PASS -- Ask AI validates its bodies, bounds its rate per person and per "
        "house, meters its first call, and applies a proposal only behind a "
        "redeemed seal taken with standing."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
