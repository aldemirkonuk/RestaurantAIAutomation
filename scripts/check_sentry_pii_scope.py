#!/usr/bin/env python3
"""
Guard: the error tracker never receives an identity.

    ./scripts/check_sentry_pii_scope.py
    ./scripts/check_sentry_pii_scope.py --self-test

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
Sentry is a subprocessor. Everything handed to it leaves our infrastructure,
lands in a third party's index, and stays there for the retention window --
which means the interesting question is never "did we redact it before we
looked at it" but "did it ever go". Three runtimes ship events (apps/web,
apps/api-gateway, services/agent-orchestrator) and all three used to forward
`email` and `username` straight onto the user scope.

Three properties make this a build-time check rather than a review habit:

1. `sendDefaultPii` does NOT cover it. Sentry's own option docs say the flag
   applies "to data that the SDK is sending by default but not data that was
   explicitly set (e.g. by calling `Sentry.setUser()`)". A reviewer who sees
   `sendDefaultPii: false` at the top of a file reasonably concludes the file
   is safe. It is exactly the wrong conclusion, and it is the one the previous
   shape of this code invited.

2. The failure is silent and retroactive. Nothing errors, no test goes red, no
   user notices. The defect is only visible in a vendor's UI that most of the
   team never opens, and by the time anyone opens it the disclosure has already
   happened for every event in the retention window. Deleting the field later
   does not un-send the year of events that carried it.

3. It regresses by copy-paste. `Sentry.setUser({ id, email, username })` is the
   shape in Sentry's own getting-started page, so every future integration
   starts from the leaking version unless something says no.

WHAT IT CHECKS
--------------
  1. Every Sentry init states its PII posture explicitly: `sendDefaultPii:
     false` / `send_default_pii=False`, plus a `beforeSend` / `before_send`
     scrubber. A silent default is not an auditable control.
  2. No Sentry user scope is handed an identity field -- not at a call site,
     and not in the type or signature that describes one. The type check is the
     load-bearing half: a narrowed type makes a re-introduction a compile
     error, which a scrubber cannot do.
  3. The three runtimes' key lists have not drifted apart -- every list they
     share (PII_USER_KEYS, PII_KEYS, SENSITIVE_HEADERS). Same reasoning as
     scripts/sync_commitment_patterns.py: two copies of one rule with no shared
     module is one edit away from being two different rules, and nothing else
     in CI would notice.
  4. The three scrubbers cover the same *containers*. Agreeing on the key list
     is not the same as agreeing on where the keys are looked for, and the
     original version of this guard checked only the former: for a while the
     Python scrubber shared PII_USER_KEYS with the TypeScript ones while
     silently not scrubbing `extra` or `contexts` at all, and the guard passed.
     The container set is therefore pinned to REQUIRED_CONTAINERS as well as
     compared across runtimes, so "all three dropped it together" fails too.

Exit 0 pass, 1 violation, 2 cannot check.
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Roots that ship a Sentry event. Tests are excluded: they legitimately build
# malformed events and replicas of init blocks in order to assert behaviour.
SEARCH_ROOTS = ("apps", "services")
SOURCE_SUFFIXES = (".ts", ".tsx", ".py")
EXCLUDE_PARTS = (
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "tests",
    "__tests__",
)
EXCLUDE_NAME_RE = re.compile(
    r"(\.spec\.tsx?$|\.test\.tsx?$|^test_.*\.py$|_test\.py$|^conftest.*\.py$)"
)

# Fields that identify a person rather than describe a fault. `id` and
# restaurant_id are deliberately absent: they are UUIDs meaningless outside our
# own database, which is what keeps an issue routable without it being personal.
IDENTITY_FIELDS = (
    "email",
    "username",
    "name",
    "first_name",
    "last_name",
    "firstname",
    "lastname",
    "phone",
    "phone_number",
    "ip_address",
    "full_name",
)

# The canonical scrub lists, and the three files that must agree on them.
# One declaration per runtime is the source of truth for that runtime; this
# guard is what makes the three declarations one rule.
SHARED_LISTS = ("PII_USER_KEYS", "PII_KEYS", "SENSITIVE_HEADERS")
DRIFT_FILES = (
    "apps/web/src/lib/error-tracking.ts",
    "apps/api-gateway/src/common/error-tracking/sentry.service.ts",
    "services/agent-orchestrator/utils/sentry_client.py",
)

# The scrubber entry point in each runtime, and where its body starts.
SCRUBBER_DECL_RE = re.compile(
    r"(?:function\s+scrubSentryEvent\b|def\s+scrub_sentry_event\b)"
)

# Every container of an event that a scrubber must reach into. Pinned, not
# merely compared across runtimes: three runtimes that all stopped scrubbing
# `contexts` would still agree with each other.
#
# Detected per language from the scrubber body. The patterns are deliberately
# shape-agnostic (`.get(...)` / `.pop(...)` / property access) so that a
# rewrite of the scrubbing style does not read as a dropped container.
CONTAINER_PATTERNS = {
    "user": {
        "ts": r"event\.user\b",
        "py": r"""event\.(?:get|pop)\(\s*['"]user['"]""",
    },
    "extra": {
        "ts": r"event\.extra\b",
        "py": r"""event\.(?:get|pop)\(\s*['"]extra['"]""",
    },
    "contexts": {
        "ts": r"event\.contexts\b",
        "py": r"""event\.(?:get|pop)\(\s*['"]contexts['"]""",
    },
    "request.headers": {
        "ts": r"request\??\.headers\b",
        "py": r"""request\.(?:get|pop)\(\s*['"]headers['"]""",
    },
    "request.cookies": {
        "ts": r"request\??\.cookies\b",
        "py": r"""request\.(?:get|pop)\(\s*['"]cookies['"]""",
    },
    "request.data": {
        "ts": r"request\??\.data\b",
        "py": r"""request\.(?:get|pop)\(\s*['"]data['"]""",
    },
}
REQUIRED_CONTAINERS = frozenset(CONTAINER_PATTERNS)

INIT_CALL_RE = re.compile(r"\b(?:Sentry\.init|sentry_sdk\.init)\s*\(")
SET_USER_CALL_RE = re.compile(r"\b(?:Sentry\.setUser|sentry_sdk\.set_user)\s*\(")
# A type or signature that describes what may be put on the user scope.
USER_TYPE_DECL_RE = re.compile(
    r"(?:interface\s+SentryUser\w*\s*\{|"
    r"type\s+SentryUser\w*\s*=\s*\{|"
    r"def\s+set_user\s*\(|"
    r"\bsetUser\s*\(\s*user\s*:\s*\{)"
)


class CannotCheck(Exception):
    """Raised when the guard cannot establish the fact it exists to establish."""


# ---------------------------------------------------------------------------
# Source scanning
# ---------------------------------------------------------------------------


def _balanced_block(text: str, open_index: int) -> str:
    """
    Return the source from `open_index` through its matching close bracket.

    Brace-counting rather than a regex because these calls nest objects several
    levels deep and a non-greedy match stops at the first inner `}`.
    String and comment contents are skipped so a brace inside a literal or a
    `// note {` cannot unbalance the count.
    """
    pairs = {"(": ")", "{": "}", "[": "]"}
    stack: list[str] = []
    i = open_index
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            while i < n and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if text.startswith("//", i) or text.startswith("#", i):
            nl = text.find("\n", i)
            i = n if nl == -1 else nl
            continue
        if text.startswith("/*", i):
            end = text.find("*/", i)
            i = n if end == -1 else end + 2
            continue
        if ch in pairs:
            stack.append(pairs[ch])
        elif stack and ch == stack[-1]:
            stack.pop()
            if not stack:
                return text[open_index : i + 1]
        i += 1
    raise CannotCheck(f"unbalanced bracket starting at offset {open_index}")


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


_MASKABLE = (
    (re.compile(r"/\*.*?\*/", re.DOTALL), None),  # TS block comment
    (re.compile(r'"""(?:.|\n)*?"""'), None),  # Python docstring
    (re.compile(r"'''(?:.|\n)*?'''"), None),
    (re.compile(r"^[ \t]*(?://|#).*$", re.MULTILINE), None),  # whole-line comment
    (re.compile(r"(?<=[\s;,)}])(?://|#)[^\n]*"), None),  # trailing comment
)


def _mask_noncode(text: str) -> str:
    """
    Blank out comments and docstrings, preserving offsets and line numbers.

    Needed because prose mentioning `sentry_sdk.init()` or `email` is exactly
    what this file — and the code it guards — is full of. The first version of
    this guard failed on its own docstring. Single-line string literals are
    deliberately NOT masked: Python dict keys (`{"email": ...}`) are string
    literals and are precisely what must still be caught.
    """
    masked = text
    for pattern, _ in _MASKABLE:
        masked = pattern.sub(
            lambda m: re.sub(r"[^\n]", " ", m.group(0)),
            masked,
        )
    return masked


def source_files() -> list[Path]:
    found: list[Path] = []
    for root in SEARCH_ROOTS:
        base = REPO / root
        if not base.is_dir():
            raise CannotCheck(f"expected source root is missing: {root}/")
        for path in base.rglob("*"):
            if path.suffix not in SOURCE_SUFFIXES or not path.is_file():
                continue
            if any(part in EXCLUDE_PARTS for part in path.parts):
                continue
            if EXCLUDE_NAME_RE.search(path.name):
                continue
            found.append(path)
    if not found:
        raise CannotCheck("no source files found under apps/ or services/")
    return found


def _identity_fields_in(code: str) -> list[str]:
    """
    Identity field names used as a key or a parameter inside `code`.

    `code` must already be comment-masked — prose saying "email is deliberately
    not forwarded" sits next to every one of these call sites.
    """
    hits = []
    for field in IDENTITY_FIELDS:
        # `email:` / `email =` / `"email"` / `'email'` — a key or a parameter,
        # not a substring of restaurantId or a word inside a string body.
        pattern = rf"""(?:^|[^\w.'"])({field})\s*(?:[:=,)]|\?\s*:)"""
        if re.search(pattern, code, re.IGNORECASE | re.MULTILINE):
            hits.append(field)
    return hits


def check_init_posture(files: list[Path]) -> tuple[list[str], int]:
    """Every Sentry init declares sendDefaultPii=false and a scrubber."""
    problems: list[str] = []
    checked = 0
    for path in files:
        text = _mask_noncode(path.read_text(encoding="utf-8", errors="replace"))
        for match in INIT_CALL_RE.finditer(text):
            checked += 1
            block = _balanced_block(text, match.end() - 1)
            rel = path.relative_to(REPO)
            line = _line_of(text, match.start())
            is_py = path.suffix == ".py"
            pii_ok = (
                re.search(r"send_default_pii\s*=\s*False", block)
                if is_py
                else re.search(r"sendDefaultPii\s*:\s*false", block)
            )
            scrub_ok = (
                re.search(r"before_send\s*=", block)
                if is_py
                else re.search(r"beforeSend\s*[(:]", block)
            )
            if not pii_ok:
                problems.append(
                    f"{rel}:{line} — Sentry init does not state "
                    f"{'send_default_pii=False' if is_py else 'sendDefaultPii: false'}"
                )
            if not scrub_ok:
                problems.append(
                    f"{rel}:{line} — Sentry init has no "
                    f"{'before_send' if is_py else 'beforeSend'} scrubber"
                )
    return problems, checked


def check_user_scope(files: list[Path]) -> tuple[list[str], int]:
    """No identity field reaches a Sentry user scope, by call or by type."""
    problems: list[str] = []
    checked = 0
    for path in files:
        text = _mask_noncode(path.read_text(encoding="utf-8", errors="replace"))
        rel = path.relative_to(REPO)

        for match in SET_USER_CALL_RE.finditer(text):
            checked += 1
            block = _balanced_block(text, match.end() - 1)
            for field in _identity_fields_in(block):
                problems.append(
                    f"{rel}:{_line_of(text, match.start())} — "
                    f"Sentry user scope is given `{field}`"
                )

        # Only inspect user-shape declarations in files that talk to Sentry.
        if not re.search(r"@sentry/|sentry_sdk", text):
            continue
        for match in USER_TYPE_DECL_RE.finditer(text):
            checked += 1
            open_index = text.find("{", match.start())
            if match.group(0).startswith("def set_user"):
                open_index = text.find("(", match.start())
            if open_index == -1:
                continue
            block = _balanced_block(text, open_index)
            for field in _identity_fields_in(block):
                problems.append(
                    f"{rel}:{_line_of(text, match.start())} — "
                    f"a Sentry user shape still accepts `{field}`"
                )
    return problems, checked


def _declared_list(text: str, name: str) -> tuple[str, ...] | None:
    """
    The string members of a `NAME = [...]` / `NAME = (...)` / `NAME = new Set([...])`
    declaration, sorted so member order is not treated as drift.
    """
    match = re.search(
        rf"\b{name}\s*[:=]\s*(?:new\s+Set\s*\(\s*)?[\(\[]([^\)\]]*)[\)\]]",
        text,
        re.DOTALL,
    )
    if not match:
        return None
    return tuple(sorted(re.findall(r"""['"]([^'"]+)['"]""", match.group(1))))


def _scrubber_body(rel: str, text: str) -> str:
    """
    The body of the runtime's scrub function, comment-masked.

    Scoped to the function rather than the whole file so that a mention of
    `event.extra` in a neighbouring helper cannot stand in for the scrubber
    actually reaching into it.
    """
    match = SCRUBBER_DECL_RE.search(text)
    if not match:
        raise CannotCheck(f"no scrubber function found in {rel}")
    if rel.endswith(".py"):
        # Python has no closing brace: run to the next top-level statement.
        rest = text[match.start() :]
        after_signature = rest.index("\n")
        end = re.search(r"\n(?=\S)", rest[after_signature:])
        if end is None:
            return rest
        return rest[: after_signature + end.start()]
    open_index = text.find("{", match.end())
    if open_index == -1:
        raise CannotCheck(f"scrubber function in {rel} has no body")
    return _balanced_block(text, open_index)


def _containers_scrubbed(rel: str, body: str) -> frozenset[str]:
    """Which event containers the scrubber body reaches into."""
    lang = "py" if rel.endswith(".py") else "ts"
    return frozenset(
        name
        for name, patterns in CONTAINER_PATTERNS.items()
        if re.search(patterns[lang], body)
    )


def check_no_drift(drift_files: tuple[str, ...] = DRIFT_FILES) -> list[str]:
    """
    The three runtimes implement one contract: same key lists, same containers.

    Both halves matter. A shared key list with different containers is the
    asymmetry this check was extended to catch — `email` in the same list in
    all three files means nothing if only two of them look in `extra` for it.
    """
    problems: list[str] = []
    lists: dict[str, dict[str, tuple[str, ...]]] = {name: {} for name in SHARED_LISTS}
    containers: dict[str, frozenset[str]] = {}

    for rel in drift_files:
        path = REPO / rel
        if not path.is_file():
            raise CannotCheck(f"expected scrubber file is missing: {rel}")
        text = _mask_noncode(path.read_text(encoding="utf-8", errors="replace"))
        for name in SHARED_LISTS:
            keys = _declared_list(text, name)
            if keys is None:
                raise CannotCheck(f"no {name} declaration found in {rel}")
            if not keys:
                raise CannotCheck(f"{name} in {rel} parsed as empty")
            lists[name][rel] = keys
        containers[rel] = _containers_scrubbed(rel, _scrubber_body(rel, text))

    for name in SHARED_LISTS:
        distinct = set(lists[name].values())
        if len(distinct) > 1:
            detail = "\n".join(
                f"    {rel}: {list(keys)}" for rel, keys in lists[name].items()
            )
            problems.append(
                f"{name} has drifted between runtimes — one rule, "
                f"{len(distinct)} definitions:\n{detail}"
            )

    if len(set(containers.values())) > 1:
        detail = "\n".join(
            f"    {rel}: {sorted(found)}" for rel, found in containers.items()
        )
        problems.append(
            "the scrubbers do not cover the same event containers — same key "
            f"list, different reach:\n{detail}"
        )
    for rel, found in containers.items():
        missing = REQUIRED_CONTAINERS - found
        if missing:
            problems.append(
                f"{rel} — scrubber does not reach {sorted(missing)}; "
                "every container in REQUIRED_CONTAINERS must be scrubbed "
                "(widen the contract deliberately, do not narrow it silently)"
            )
    return problems


# ---------------------------------------------------------------------------
# Self-test — prove the guard fails on the shape it exists to catch
# ---------------------------------------------------------------------------


_FIXTURE_LISTS_TS = """
const PII_USER_KEYS = ['email', 'username', 'name', 'ip_address']
const PII_KEYS = new Set(['email', 'name', 'username', 'first_name', 'last_name',
  'phone', 'phone_number', 'ip_address', 'address', 'password', 'ssn'])
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-api-key',
  'proxy-authorization'])
"""

_FIXTURE_SCRUBBER_TS = """
export function scrubSentryEvent(event) {
  if (event.request) {
    const headers = event.request.headers
    delete event.request.cookies
  }
  if (event.user) { drop(event.user) }
  scrubPiiKeys(event.extra)
  scrubPiiKeys(event.request?.data)
  if (event.contexts) { each(event.contexts) }
  return event
}
"""

_FIXTURE_LISTS_PY = """
PII_USER_KEYS = ("email", "username", "name", "ip_address")
PII_KEYS = ("email", "name", "username", "first_name", "last_name", "phone",
            "phone_number", "ip_address", "address", "password", "ssn")
SENSITIVE_HEADERS = ("authorization", "cookie", "x-api-key", "proxy-authorization")
"""

# The shape the audit actually found: identical key lists, three fewer
# containers. This is what the guard used to pass.
_FIXTURE_SCRUBBER_PY_PRE_FIX = """
def scrub_sentry_event(event, hint=None):
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        request.pop("cookies", None)
    user = event.get("user")
    return event
"""

_FIXTURE_SCRUBBER_PY_FIXED = """
def scrub_sentry_event(event, hint=None):
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        request.pop("cookies", None)
        _scrub_pii_keys(request.get("data"))
    user = event.get("user")
    _scrub_pii_keys(event.get("extra"))
    contexts = event.get("contexts")
    return event
"""


def _self_test_containers() -> list[str]:
    """
    The container half of check_no_drift, against the asymmetry it was added
    for: a Python scrubber sharing every key list with the TypeScript ones
    while never looking in `extra`, `contexts` or `request.data`.
    """
    global REPO
    real_repo = REPO
    failures: list[str] = []
    fixture_files = ("web.ts", "gateway.ts", "orchestrator.py")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            for label, py_body, expect_failure in (
                ("pre-fix", _FIXTURE_SCRUBBER_PY_PRE_FIX, True),
                ("fixed", _FIXTURE_SCRUBBER_PY_FIXED, False),
            ):
                root = Path(tmp) / label
                root.mkdir(parents=True)
                for name in ("web.ts", "gateway.ts"):
                    (root / name).write_text(
                        _FIXTURE_LISTS_TS + _FIXTURE_SCRUBBER_TS, encoding="utf-8"
                    )
                (root / "orchestrator.py").write_text(
                    _FIXTURE_LISTS_PY + py_body, encoding="utf-8"
                )

                REPO = root
                problems = check_no_drift(fixture_files)

                if bool(problems) != expect_failure:
                    failures.append(
                        f"[{label}] container check: expected "
                        f"{'a failure' if expect_failure else 'no failure'}, "
                        f"got {problems}"
                    )
                elif expect_failure and not any(
                    "container" in p or "does not reach" in p for p in problems
                ):
                    failures.append(
                        f"[{label}] container check fired for the wrong reason: "
                        f"{problems}"
                    )
    finally:
        REPO = real_repo
    return failures


def _self_test() -> int:
    """Run each check against the pre-fix source and assert it fires."""
    global REPO
    real_repo = REPO
    failures: list[str] = []

    pre_fix_web = """
    import * as Sentry from '@sentry/react'
    interface SentryUser { id: string; email?: string; username?: string }
    Sentry.init({
      dsn: config.dsn,
      tracesSampleRate: 0.1,
      integrations: [],
      beforeSend(event) { return event },
    })
    Sentry.setUser({ id: user.id, email: user.email, username: user.name })
    """
    clean_web = """
    import * as Sentry from '@sentry/react'
    interface SentryUser { id: string; restaurantId?: string }
    Sentry.init({
      dsn: config.dsn,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      integrations: [],
      beforeSend(event) { return scrubSentryEvent(event) },
    })
    // email and username are deliberately not forwarded
    Sentry.setUser({ id: user.id, restaurantId: user.restaurantId })
    """

    with tempfile.TemporaryDirectory() as tmp:
        for label, body, expect_init, expect_user in (
            ("pre-fix", pre_fix_web, True, True),
            ("fixed", clean_web, False, False),
        ):
            root = Path(tmp) / label
            (root / "apps" / "web").mkdir(parents=True)
            (root / "services").mkdir(parents=True)
            target = root / "apps" / "web" / "error-tracking.ts"
            target.write_text(body, encoding="utf-8")

            REPO = root
            files = source_files()
            init_problems, init_checked = check_init_posture(files)
            user_problems, user_checked = check_user_scope(files)

            if init_checked == 0 or user_checked == 0:
                failures.append(f"[{label}] self-test found nothing to check")
            if bool(init_problems) != expect_init:
                failures.append(
                    f"[{label}] init posture check: expected "
                    f"{'a failure' if expect_init else 'no failure'}, got {init_problems}"
                )
            if bool(user_problems) != expect_user:
                failures.append(
                    f"[{label}] user scope check: expected "
                    f"{'a failure' if expect_user else 'no failure'}, got {user_problems}"
                )

    REPO = real_repo
    failures.extend(_self_test_containers())

    if failures:
        print("FAIL — the guard does not behave as documented:")
        for line in failures:
            print(f"  {line}")
        return 1
    print(
        "PASS — guard fires on the pre-fix shapes (identity on the user scope, "
        "and a scrubber that covers fewer containers than its peers) and is "
        "silent on the fixed ones."
    )
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test()

    try:
        files = source_files()
        init_problems, init_checked = check_init_posture(files)
        user_problems, user_checked = check_user_scope(files)
        drift_problems = check_no_drift()
        if init_checked == 0:
            raise CannotCheck(
                "no Sentry init call site found — the guard would pass "
                "vacuously, which is worse than failing"
            )
        if user_checked == 0:
            raise CannotCheck("no Sentry user scope or user shape found to check")
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}")
        print("Exiting 2 — a guard that cannot verify must not report success.")
        return 2

    problems = init_problems + user_problems + drift_problems
    if problems:
        print("FAIL: an identity may be reaching the error tracker.")
        for line in problems:
            print(f"  {line}")
        print()
        print("Sentry is a subprocessor: what goes to it leaves our estate and")
        print("stays in a third party's index for the retention window. Send")
        print("opaque identifiers only — an account id and a restaurant id keep")
        print("an issue routable without making it personal.")
        print()
        print("Note that `sendDefaultPii: false` does NOT cover setUser(): the")
        print("SDK option applies only to data the SDK attaches by itself. The")
        print("narrowed user type is what actually stops the leak.")
        return 1

    print(
        f"PASS — {init_checked} Sentry init site(s) declare their PII posture, "
        f"{user_checked} user scope(s)/shape(s) carry opaque identifiers only, "
        f"and {len(DRIFT_FILES)} runtimes agree on {len(SHARED_LISTS)} scrub "
        f"list(s) and all {len(REQUIRED_CONTAINERS)} scrubbed containers."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
