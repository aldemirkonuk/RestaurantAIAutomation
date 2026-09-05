#!/usr/bin/env python3
"""Every route that can change what the house is charged on redeems a seal.

WHY THIS EXISTS
---------------
ADR 0110's addendum sealed the three `/payment-methods` writes and then recorded,
in its own text, that the `create` route it had just sealed has no caller: an
instrument is attached by minting a SetupIntent at `POST /billing/setup-intent`,
confirming it on Stripe's origin, and reconciling at `POST /billing/sync`. The
seal was on the door nobody used, and the door everybody used ran a role check
and nothing else — which answers "may this ROLE" and cannot answer "did a
PERSON".

That was not a coding mistake. It was a MODULE boundary: the pass that added the
seal named `payment-methods/**` as its scope, and `billing/**` was outside it. A
guard is the only thing that survives the next such boundary. So this one does
not ask whether the modules that were sealed are still sealed; it asks whether
every non-GET route in the money modules is, and it fails on a route added
tomorrow by somebody who never read the ADR.

WHAT COUNTS AS SEALED
---------------------
The handler's own call graph, read from source, must reach one of the seal
service's redemption primitives (`redeem`, `assertRedeemed` — the names are read
OFF `common/seal/seal-challenge.service.ts` rather than typed here). MEASURED,
2026-09-05: renaming `redeem` in the service makes every route report UNSEALED
and the guard exit 1 — loud and closed, never a vacuous pass. Exit 2 is for
finding NO primitives at all, the case where the guard cannot say what "sealed"
means. The walk follows:

  * private helpers on the same controller (`this.assertSealed(...)`), and
  * constructor-injected providers whose class is declared in one of the scanned
    modules (`this.billing.foo(...)` -> `BillingService.foo`),

to a bounded depth. It reads CODE only: `strip_comments` blanks out comments
first, because these controllers carry long headers that DISCUSS `redeem` by
name, and a guard that reads prose as code passes confidently for the wrong
reason (the exact bug `check_route_exposure.py` shipped and fixed).

WHAT IT DOES NOT CATCH, STATED
------------------------------
- WHETHER the binding is right. A route could redeem a seal for the wrong
  subject or the wrong act and this guard would call it sealed. Only the specs
  can check that (`billing.seal.spec.ts`, `payment-methods.seal.spec.ts`).
- A CONDITIONAL redemption. `POST /billing/sync` redeems only when the caller
  names a SetupIntent; this guard sees the call and is satisfied. That is why
  the census in ADR 0110's addendum, not this script, is the record of which
  routes are sealed unconditionally.
- A seal reached through a provider declared OUTSIDE the scanned modules. Those
  are reported as `unresolved-hop` and listed rather than silently passed, so
  the gap is visible.

NEVER VACUOUS
-------------
Exit 2 when it cannot do its job: a scanned module missing, no controllers, no
routes parsed, the seal service's primitives not found, or an ALLOWLIST entry
naming a route that no longer exists. A stale exemption is the
absence-reported-as-health shape wearing this guard's own badge — an allow-list
row that stopped matching anything still reads, to a person skimming it, like a
decision that is still in force.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "api-gateway" / "src"
SEAL_SERVICE = SRC / "common" / "seal" / "seal-challenge.service.ts"

# The modules whose non-GET routes must be sealed. This list IS the census of
# ADR 0110's addendum: `payment-methods/**` holds the register's own writes,
# `billing/**` holds the provider path that attaches an instrument. Adding a
# module here is how a future money surface joins the rule; the guard cannot
# discover one on its own, and pretending otherwise would be the same
# absence-as-health mistake one level up.
MONEY_MODULES = ("payment-methods", "billing")

# Where a seal may be redeemed FROM. The walk resolves injected providers only
# within these directories; anything else is an unresolved hop and is listed.
RESOLVE_DIRS = MONEY_MODULES + ("common/seal",)

HTTP_METHODS = ("Get", "Post", "Put", "Patch", "Delete", "All", "Head", "Options")
WRITE_METHODS = ("Post", "Put", "Patch", "Delete", "All")
ROUTE_RE = re.compile(r"^\s*@(" + "|".join(HTTP_METHODS) + r")\s*\(")
WRITE_ROUTE_RE = re.compile(r"^\s*@(" + "|".join(WRITE_METHODS) + r")\s*\(")
CLASS_RE = re.compile(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)")
# The same shape, multiline, for SCANNING a whole file rather than one line.
# Without re.M a `finditer` anchors at the string start only and finds a class
# just when the file begins with one -- which is never, in this codebase.
CLASS_DECL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)", re.M
)
CONTROLLER_RE = re.compile(r"^\s*@Controller\s*\(")
# `private readonly seals: SealChallengeService,` in a constructor.
INJECT_RE = re.compile(
    r"(?:private|public|protected|readonly)[\w\s]*?\b(\w+)\s*:\s*(\w+)\s*[,)]"
)
MAX_DEPTH = 4

# ---------------------------------------------------------------------------
# The allow-list. Every row is a ROUTE THAT MAY WRITE WITHOUT A SEAL, and every
# row carries the sentence that makes that true. A row with no reason is not an
# exemption, it is an omission with a comma in it.
# ---------------------------------------------------------------------------
ALLOWLIST: dict[tuple[str, str], str] = {
    (
        "billing/billing.controller.ts",
        "webhook",
    ): (
        "Stripe's own account of what changed, not a person's act. Authenticated "
        "by HMAC-SHA256 over the EXACT request bytes under STRIPE_WEBHOOK_SECRET "
        "with a five-minute timestamp tolerance (stripe-signature.ts), which "
        "fails CLOSED when the secret is unset; a replay of a completed delivery "
        "is a no-op because billing_webhook_events has the provider's event id as "
        "its PRIMARY KEY. A seal is meaningless here: there is no person and no "
        "session to bind one to."
    ),
    (
        "payment-methods/payment-methods.controller.ts",
        "sealChallenge",
    ): (
        "The mint itself. Requiring a seal to obtain a seal is circular, and this "
        "route writes nothing about an instrument: it inserts one short-lived "
        "challenge row bound to this actor, act and instrument, behind the same "
        "manager-or-owner check the writes run."
    ),
}


class Fatal(Exception):
    """The guard could not check what it claims to check -> exit 2."""


def strip_comments(text: str) -> str:
    """Blank out comments, keeping line numbers intact.

    Load-bearing, not tidiness: `billing.controller.ts` and
    `seal-challenge.service.ts` both DISCUSS `redeem` at length in prose. A guard
    that matched those would call every route sealed.
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
                    rebuilt.append(line[i + 1])
                    i += 2
                    continue
                if ch == quote:
                    quote = None
                i += 1
                continue
            if ch in "\"'`":
                quote = ch
                rebuilt.append(ch)
                i += 1
                continue
            if ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                break
            if ch == "/" and i + 1 < len(line) and line[i + 1] == "*":
                end = line.find("*/", i + 2)
                if end == -1:
                    in_block = True
                    break
                i = end + 2
                continue
            rebuilt.append(ch)
            i += 1
        out.append("".join(rebuilt))
    return "\n".join(out)


def seal_primitives() -> list[str]:
    """The redemption method names, read off the seal service itself.

    Never hard-coded. If `redeem` is renamed and this guard still looked for
    "redeem", every route would report unsealed (noisy but safe) — and if a NEW
    primitive were added and not listed here, routes using it would report
    unsealed too. Reading the class is what keeps the two in step. A primitive
    is any public async method of this service other than the mint (`issue`) and
    the filing (`file*`): everything else on it exists to refuse. That is a
    structural rule, not a reading of each body, and it is stated here so a
    method added later that does NOT refuse would be miscounted — which is the
    guard's own soft spot rather than a property of the code it checks.
    """
    if not SEAL_SERVICE.is_file():
        raise Fatal(f"{SEAL_SERVICE} does not exist — the seal service moved")
    text = strip_comments(SEAL_SERVICE.read_text(encoding="utf8"))
    names = [
        m.group(1)
        for m in re.finditer(r"^  async (\w+)\s*\(", text, re.M)
        if m.group(1) != "issue"
    ]
    # `fileRefusal` is private and files; it does not refuse.
    names = [n for n in names if not n.startswith("file")]
    if not names:
        raise Fatal(
            f"{SEAL_SERVICE}: found no redemption methods — the parser is rotted "
            "or the service was rewritten. This guard cannot say what 'sealed' "
            "means, so it refuses to say anything."
        )
    return names


def method_body(lines: list[str], start: int) -> str:
    """The body of the method whose signature is on `lines[start]`.

    THE PARAMETER LIST HAS BRACES IN IT, AND THAT IS THE WHOLE DIFFICULTY
    --------------------------------------------------------------------
    The first version of this function counted braces from the signature line
    onward. Every handler in this codebase is typed
    `@Req() req: Request & { user: AuthenticatedUser },` — a `{` and a `}` that
    balance INSIDE the parameter list — so the count reached zero before the
    body had even opened, the "body" was the signature, and all five sealed
    routes were reported UNSEALED. It was caught because the guard was run
    against a tree whose answer was already known; a guard proved only on
    fixtures would have shipped reporting the opposite of the truth.

    So the walk is two phases. First the PARENTHESES are balanced, which ends
    the parameter list and steps over every brace inside it. Only then does the
    body's opening `{` count — and it is required to be the last non-space
    character on its line, which is how a body opens here and is not how a
    braced return type would read.
    """
    text_from = lines[start:]
    depth_paren = 0
    opened_paren = False
    body_start: int | None = None

    for offset, line in enumerate(text_from[:60]):
        if body_start is None and not (opened_paren and depth_paren == 0):
            for ch in line:
                if ch == "(":
                    depth_paren += 1
                    opened_paren = True
                elif ch == ")":
                    depth_paren -= 1
            if not (opened_paren and depth_paren <= 0):
                continue
        # The parameter list is closed as of this line; the body opens on it or
        # on a later one.
        if line.rstrip().endswith("{"):
            body_start = offset
            break
    if body_start is None:
        raise Fatal(
            f"could not find the body of the method on line {start + 1} "
            "(the parameter list never closed, or the body does not open with "
            "a trailing brace). The guard cannot read what it must read."
        )

    depth = 0
    seen = False
    out: list[str] = []
    for line in text_from[body_start:]:
        out.append(line)
        for ch in line:
            if ch == "{":
                depth += 1
                seen = True
            elif ch == "}":
                depth -= 1
        if seen and depth <= 0:
            break
    return "\n".join(out)


def class_methods(text: str) -> dict[str, str]:
    """Every method on the file's classes, by name, as source."""
    lines = text.splitlines()
    out: dict[str, str] = {}
    for i, line in enumerate(lines):
        m = re.match(
            r"^  (?:private |public |protected |static |readonly )*"
            r"(?:async )?(\w+)\s*\(",
            line,
        )
        if not m:
            continue
        name = m.group(1)
        if name in ("constructor", "if", "for", "while", "switch", "catch"):
            continue
        out[name] = method_body(lines, i)
    return out


def injected(text: str) -> dict[str, str]:
    """Constructor-injected providers: property name -> class name."""
    m = re.search(r"constructor\s*\((.*?)\)\s*\{", text, re.S)
    if not m:
        return {}
    return {p: c for p, c in INJECT_RE.findall(m.group(1))}


def load_sources() -> dict[str, dict]:
    """Every non-spec .ts under the scanned dirs, parsed once, by class name."""
    by_class: dict[str, dict] = {}
    for rel in RESOLVE_DIRS:
        d = SRC / rel
        if not d.is_dir():
            raise Fatal(f"{d} does not exist — a scanned module moved or was renamed")
        for path in sorted(d.rglob("*.ts")):
            if path.name.endswith((".spec.ts", ".test.ts", ".d.ts")):
                continue
            text = strip_comments(path.read_text(encoding="utf8"))
            for cm in CLASS_DECL_RE.finditer(text):
                by_class[cm.group(1)] = {
                    "path": path,
                    "text": text,
                    "methods": class_methods(text),
                    "injected": injected(text),
                }
    return by_class


def reaches_seal(
    body: str,
    owner: str,
    by_class: dict[str, dict],
    primitives: list[str],
    depth: int,
    unresolved: list[str],
) -> bool:
    """Does this body, or anything it calls within the scanned modules, redeem?"""
    for name in primitives:
        if re.search(r"\.\s*" + re.escape(name) + r"\s*\(", body):
            return True
    if depth >= MAX_DEPTH:
        return False

    info = by_class.get(owner)
    if not info:
        return False

    # `this.helper(...)` — a private method on the same class.
    for call in set(re.findall(r"this\.(\w+)\s*\(", body)):
        nxt = info["methods"].get(call)
        if nxt and reaches_seal(
            nxt, owner, by_class, primitives, depth + 1, unresolved
        ):
            return True

    # `this.provider.method(...)` — an injected service.
    for prop, call in set(re.findall(r"this\.(\w+)\.(\w+)\s*\(", body)):
        cls = info["injected"].get(prop)
        if not cls:
            continue
        target = by_class.get(cls)
        if not target:
            unresolved.append(f"{owner}.{prop}: {cls} (declared outside the scan)")
            continue
        nxt = target["methods"].get(call)
        if nxt and reaches_seal(
            nxt, cls, by_class, primitives, depth + 1, unresolved
        ):
            return True
    return False


def analyse(
    path: Path, by_class: dict[str, dict], primitives: list[str]
) -> tuple[list[dict], list[str]]:
    raw = path.read_text(encoding="utf8")
    if "@Controller" not in raw:
        return [], []
    text = strip_comments(raw)
    lines = text.splitlines()

    owner = None
    for i, line in enumerate(lines):
        cm = CLASS_RE.match(line)
        if cm and any(CONTROLLER_RE.match(lines[j]) for j in range(max(0, i - 60), i)):
            owner = cm.group(1)
            break
    if owner is None:
        raise Fatal(f"{path}: found @Controller but no class declaration after it")
    if owner not in by_class:
        raise Fatal(f"{path}: controller class {owner} was not parsed")

    rel = str(path.relative_to(SRC))
    routes: list[dict] = []
    unresolved: list[str] = []
    for i, line in enumerate(lines):
        if not ROUTE_RE.match(line):
            continue
        verb = ROUTE_RE.match(line).group(1)
        # Walk to the handler signature.
        handler = None
        sig_line = None
        for j in range(i + 1, min(i + 40, len(lines))):
            s = lines[j].strip()
            if s.startswith("@") or s == "":
                continue
            hm = re.match(r"^\s*(?:async\s+)?(\w+)\s*\(", lines[j])
            if hm:
                handler = hm.group(1)
                sig_line = j
                break
        if handler is None:
            raise Fatal(f"{path}:{i + 1}: a {verb} route with no handler after it")

        if verb not in WRITE_METHODS:
            routes.append({"line": i + 1, "verb": verb, "handler": handler,
                           "verdict": "read"})
            continue

        body = method_body(lines, sig_line)
        sealed = reaches_seal(body, owner, by_class, primitives, 0, unresolved)
        if sealed:
            verdict = "sealed"
        elif (rel, handler) in ALLOWLIST:
            verdict = "allow-listed"
        else:
            verdict = "UNSEALED"
        routes.append(
            {"line": i + 1, "verb": verb, "handler": handler, "verdict": verdict}
        )
    return [dict(r, file=rel) for r in routes], unresolved


# ---------------------------------------------------------------------------
# Self-test. A guard nobody tested is a guess, and this one's whole value is
# discriminating a real call from a mention of one in a comment.
# ---------------------------------------------------------------------------
SELF_TEST_FIXTURES: list[tuple[str, str, str]] = [
    (
        "a handler that redeems directly is sealed",
        """
@Controller("x")
export class XController {
  constructor(private readonly seals: SealChallengeService) {}
  @Post("a")
  async a() {
    await this.seals.redeem({});
    return 1;
  }
}
""",
        "sealed",
    ),
    (
        "a handler that redeems through a private helper is sealed",
        """
@Controller("x")
export class XController {
  constructor(private readonly seals: SealChallengeService) {}
  private async assertSealed() {
    await this.seals.redeem({});
  }
  @Post("a")
  async a() {
    await this.assertSealed();
    return 1;
  }
}
""",
        "sealed",
    ),
    (
        "a handler that only asserts a role is UNSEALED",
        """
@Controller("x")
export class XController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Post("a")
  async a() {
    await this.organizations.assertCanManageRestaurant("u", "r", "do it");
    return 1;
  }
}
""",
        "UNSEALED",
    ),
    (
        # The bug check_route_exposure.py shipped: prose read as code.
        "the word redeem in a comment does not seal anything",
        """
/**
 * This route would redeem a seal: this.seals.redeem(...) is what it should do.
 */
@Controller("x")
export class XController {
  @Post("a")
  async a() {
    // this.seals.redeem() — not yet
    return 1;
  }
}
""",
        "UNSEALED",
    ),
    (
        "a GET is a read and is not asked to seal anything",
        """
@Controller("x")
export class XController {
  @Get()
  async a() {
    return 1;
  }
}
""",
        "read",
    ),
    (
        # Brace counting: the seal is in the NEXT method, not this one.
        "a seal in a later method does not seal an earlier route",
        """
@Controller("x")
export class XController {
  constructor(private readonly seals: SealChallengeService) {}
  @Post("a")
  async a() {
    return 1;
  }
  @Post("b")
  async b() {
    await this.seals.redeem({});
    return 2;
  }
}
""",
        "UNSEALED",
    ),
    (
        "assertRedeemed counts too — proving an earlier seal is a seal check",
        """
@Controller("x")
export class XController {
  constructor(private readonly seals: SealChallengeService) {}
  @Post("a")
  async a() {
    await this.seals.assertRedeemed({});
    return 1;
  }
}
""",
        "sealed",
    ),
]


def self_test() -> int:
    import tempfile

    try:
        primitives = seal_primitives()
    except Fatal as exc:
        print(f"SELF-TEST CANNOT RUN: {exc}", file=sys.stderr)
        return 2
    print(f"  seal primitives read from the service: {', '.join(primitives)}")

    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, source, expected in SELF_TEST_FIXTURES:
            f = Path(tmp) / "t.controller.ts"
            f.write_text(source, encoding="utf8")
            text = strip_comments(source)
            by_class = {
                "XController": {
                    "path": f,
                    "text": text,
                    "methods": class_methods(text),
                    "injected": injected(text),
                }
            }
            # `analyse` wants a path under SRC for its relative name; the
            # verdict does not depend on it, so a stand-in is used and the
            # allow-list cannot accidentally match.
            lines = text.splitlines()
            got = "<no route parsed>"
            for i, line in enumerate(lines):
                if not ROUTE_RE.match(line):
                    continue
                verb = ROUTE_RE.match(line).group(1)
                sig_line = None
                for j in range(i + 1, len(lines)):
                    s = lines[j].strip()
                    if s.startswith("@") or s == "":
                        continue
                    if re.match(r"^\s*(?:async\s+)?(\w+)\s*\(", lines[j]):
                        sig_line = j
                        break
                if verb not in WRITE_METHODS:
                    got = "read"
                    break
                body = method_body(lines, sig_line)
                got = (
                    "sealed"
                    if reaches_seal(body, "XController", by_class, primitives, 0, [])
                    else "UNSEALED"
                )
                break
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

    try:
        primitives = seal_primitives()
        by_class = load_sources()
    except Fatal as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    controllers = [
        p
        for module in MONEY_MODULES
        for p in sorted((SRC / module).rglob("*.controller.ts"))
        if not p.name.endswith(".spec.ts")
    ]
    if not controllers:
        print(
            "FATAL: no *.controller.ts under "
            f"{', '.join(MONEY_MODULES)} — this guard checked nothing",
            file=sys.stderr,
        )
        return 2

    all_routes: list[dict] = []
    unresolved: list[str] = []
    try:
        for path in controllers:
            routes, un = analyse(path, by_class, primitives)
            all_routes.extend(routes)
            unresolved.extend(un)
    except Fatal as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 2

    if not all_routes:
        print(
            f"FATAL: parsed 0 routes across {len(controllers)} controllers — "
            "the parser is broken",
            file=sys.stderr,
        )
        return 2

    writes = [r for r in all_routes if r["verdict"] != "read"]
    if not writes:
        print(
            "FATAL: parsed 0 non-GET routes in the money modules. Either the "
            "money surface is gone or the parser is. Both need a person.",
            file=sys.stderr,
        )
        return 2

    print(
        f"Money routes: {len(all_routes)} routes across {len(controllers)} "
        f"controllers in {', '.join(MONEY_MODULES)}"
    )
    for r in all_routes:
        print(f"  {r['verdict']:13} {r['verb']:6} {r['file']}:{r['line']} {r['handler']}")

    # A stale exemption is worse than a missing one: it reads like a live
    # decision. Exit 2, not 1 — the guard cannot check what it claims to.
    live = {(r["file"], r["handler"]) for r in all_routes}
    stale = [k for k in ALLOWLIST if k not in live]
    if stale:
        print(
            "\nFATAL: the allow-list names route(s) that no longer exist. An "
            "exemption nothing matches still reads as a decision in force:",
            file=sys.stderr,
        )
        for f, h in stale:
            print(f"  {f} :: {h}", file=sys.stderr)
        return 2

    if unresolved:
        print("\nHops this guard could not follow (listed, not assumed safe):")
        for u in sorted(set(unresolved)):
            print(f"  {u}")

    allowed = [r for r in all_routes if r["verdict"] == "allow-listed"]
    if allowed:
        print("\nAllowed to write without a seal, each with its reason:")
        for r in allowed:
            print(f"  {r['file']}:{r['line']} {r['handler']}")
            print(f"    {ALLOWLIST[(r['file'], r['handler'])]}")

    unsealed = [r for r in all_routes if r["verdict"] == "UNSEALED"]
    if unsealed:
        print(f"\nFAIL — {len(unsealed)} money route(s) write without redeeming a seal.")
        print("Each can change which instrument this house is charged on, behind a")
        print("role check that answers 'may this role' and not 'did a person'. Add")
        print("the redemption (see billing.controller.ts) or add an ALLOWLIST entry")
        print("with the sentence that makes the exemption true.")
        for r in unsealed:
            print(f"  {r['file']}:{r['line']} {r['verb']} {r['handler']}")
        return 1

    sealed = len([r for r in all_routes if r["verdict"] == "sealed"])
    print(
        f"\nPASS — {sealed} money write(s) redeem a seal, "
        f"{len(allowed)} are allow-listed with a reason."
    )
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(main())
