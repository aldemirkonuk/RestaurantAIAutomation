#!/usr/bin/env python3
"""
Guard: no voice code path can speak to a vendor without passing the §8.1 gate.

    ./scripts/check_voice_gate_coverage.py
    ./scripts/check_voice_gate_coverage.py --self-test

WHY THIS IS A GUARD AND NOT A CONVENTION
----------------------------------------
FUTURES §8.1 is absolute: AI never forms or accepts a purchase commitment
without a recorded human tap. `assert_order_voice_allowed()` is the one place
that rule is enforced for voice, and PR #156 wired it into the three surfaces
that existed at the time. The audit of that PR named the hole it left, and it
is a coverage hole, not a logic one:

    "the real spoken script is served by the (unbuilt) answer webhook, not by
    the gated `generate_negotiation_xml` output which `make_call` discards.
    When that webhook slice lands it needs its own gate — the exact 'next
    caller forgets' risk, re-created one layer down."

That is a claim a command can check, so it is one. The voice client's own
docstring already says why the gate lives in the module and not in the caller
("a gate that lives in the caller is a gate the next caller can forget"). This
guard is the same argument applied to the module list: a gate that lives in
*today's* modules is a gate tomorrow's module can forget. The answer webhook
does not exist yet, which is precisely when the check is cheap to add and
impossible to argue with — nobody is inconvenienced by it today, and the day
somebody writes `return "<Response><Speak>…press 1 to accept this order"` in a
new file, CI says no before a vendor's phone rings.

THE RULE
--------
Every **voice emitter** either passes through `assert_order_voice_allowed()` or
is named in ALLOWLIST below with the reason it commits nothing.

A voice emitter is any function that can put words in a vendor's ear:

  (A) it builds Plivo call XML — a `<Speak>`, `<GetDigits>`, `<GetInput>` or
      `<PreAnswer>` literal (or a weaker verb in a file that mentions Plivo);
  (B) it dials — anything reaching `…calls.create(…)`;
  (C) it calls, in the same module, a function that is already an emitter —
      so hiding the XML behind a private helper does not launder it;
  (D) it calls one of the voice client's own public emitters by name. That set
      is DERIVED from the module rather than hardcoded, so a new public
      surface extends this guard's reach on the commit that adds it.

Gate coverage is likewise transitive within a module: `make_call` never names
the gate, it calls `_gate_call_context`, which does. That is real coverage and
the guard counts it.

TypeScript and JavaScript are scanned too, at file level. The gate is a Python
function; a Plivo answer webhook written in the NestJS gateway could not call
it even if the author wanted to. So a TS/JS file that builds call XML is an
automatic failure — the point being to force that design decision into an ADR
instead of into a merged diff.

WHAT THIS GUARD DOES NOT CLAIM
------------------------------
It proves that every speaking path *reaches* the gate. It says nothing about
whether the gate's own predicates are airtight — `is_order_acceptance_prompt`
is a regex and is defeatable by rewording, and `make_call` decides an order is
in play by looking for `ORDER_BINDING_CONTEXT_KEYS`. Those are separate
weaknesses in the gate's judgment, and tightening them is a change to
`plivo_voice_client.py`, not to this file. Conflating the two would let a
green run here be read as a stronger claim than it is.

ALLOWLIST ENTRIES SHRINK, THEY DO NOT GROW
------------------------------------------
Each entry names the exact function and why it forms no commitment. An entry
for a function that no longer exists, or one that has since acquired a gate
call, is itself a failure: a list nobody prunes is a list nobody reads.

Exit 0 pass, 1 violation, 2 cannot check.
"""

from __future__ import annotations

import ast
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

#: The module that owns the gate. Its public emitters become the cross-module
#: API names of rule (D), so this one path is the guard's anchor.
VOICE_MODULE = "services/agent-orchestrator/services/plivo_voice_client.py"
GATE_FUNCTION = "assert_order_voice_allowed"

SEARCH_ROOTS = ("apps", "services")
PY_SUFFIX = ".py"
TS_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs")

# Tests are excluded for the same reason the Sentry guard excludes them: they
# legitimately build order-acceptance XML in order to assert it is refused.
EXCLUDE_PARTS = (
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "venv",
    "coverage",
    "tests",
    "__tests__",
    "e2e",
)
EXCLUDE_NAME_RE = re.compile(
    r"(\.spec\.[jt]sx?$|\.test\.[jt]sx?$|^test_.*\.py$|_test\.py$|^conftest.*\.py$)"
)

# Unambiguous Plivo/TwiML call verbs — these appear in no other context.
XML_VERBS_STRONG = ("Speak", "GetDigits", "GetInput", "PreAnswer")
# Real verbs that are also ordinary words in other markup, so they only count
# in a file that is already talking to Plivo. `Record` in particular is also a
# TypeScript utility type: `useState<Record<string, X>>` is not a voicemail
# prompt, which is why every verb must be followed by a real tag terminator.
XML_VERBS_WEAK = ("Response", "Dial", "Conference", "Redirect", "Record")


def _verb_re(verbs: tuple[str, ...]) -> re.Pattern[str]:
    """`<Verb>`, `<Verb />`, `<Verb attr=…` — never `<Record<string, X>>`."""
    return re.compile(rf"<(?:{'|'.join(verbs)})[\s/>]", re.IGNORECASE)


XML_STRONG_RE = _verb_re(XML_VERBS_STRONG)
XML_WEAK_RE = _verb_re(XML_VERBS_WEAK)

DIAL_SUFFIX = "calls.create"


@dataclass(frozen=True)
class Emitter:
    """One function that can reach a vendor's ear."""

    rel: str
    qualname: str
    why: str
    gated: bool

    @property
    def key(self) -> str:
        return f"{self.rel}::{self.qualname}"


@dataclass
class Report:
    emitters: list[Emitter] = field(default_factory=list)
    api_names: set[str] = field(default_factory=set)
    ts_hits: list[str] = field(default_factory=list)
    files_scanned: int = 0


# ---------------------------------------------------------------------------
# Reviewed non-binding paths. Two entries. Both are load-bearing enough that
# the reason is written out rather than referenced.
# ---------------------------------------------------------------------------
ALLOWLIST: dict[str, str] = {
    # The dial primitive. It hands Plivo a phone number and an answer URL; its
    # signature carries no order, quantity or price, and its single caller
    # `make_call` runs the gate as its first statement (plivo_voice_client.py
    # :512) before any branch can reach here. What the answer URL *serves* is
    # not exempt and is not covered by this entry: whatever function builds
    # that script is an emitter under rule (A) and must gate on its own.
    f"{VOICE_MODULE}::PlivoVoiceClient._make_call_via_plivo": (
        "private dial primitive — no order terms in its signature, single "
        "caller make_call gates first, and the script served at answer_url is "
        "a separate emitter this guard enumerates in its own right"
    ),
    # The caller. Deliberately ungated *here*: the gate lives one layer down in
    # PlivoVoiceClient so a future caller cannot reach the phone line by going
    # round this method, and this guard is what proves that layer is intact.
    # Both of its outbound calls (generate_negotiation_xml, make_call) are
    # enumerated below and both come back gated.
    "services/agent-orchestrator/agents/procurement_agent.py"
    "::ProcurementAgent._initiate_voice_negotiation": (
        "caller, not surface — every voice call it makes goes through a "
        "PlivoVoiceClient method this guard independently proves gated; "
        "duplicating the gate here would be the caller-side gate FUTURES §8.1 "
        "explicitly does not rely on"
    ),
}

#: TS/JS files permitted to build call XML. Empty on purpose: the gate is a
#: Python function, so a TS emitter is unreachable from it by construction.
TS_ALLOWLIST: dict[str, str] = {}


class CannotCheck(Exception):
    """Raised when the guard cannot establish the fact it exists to establish."""


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _docstring_ids(tree: ast.AST) -> set[int]:
    """Node ids of every docstring, so prose about `<Speak>` is not evidence."""
    ids: set[int] = set()
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            ids.add(id(first.value))
    return ids


def _dotted(node: ast.AST) -> str:
    """Best-effort dotted source name of a call target."""
    parts: list[str] = []
    cur = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    elif isinstance(cur, ast.Call):
        parts.append("()")
    return ".".join(reversed(parts))


def _functions(tree: ast.Module) -> list[tuple[str, ast.AST]]:
    """(qualname, node) for every def, methods included, nesting flattened."""
    found: list[tuple[str, ast.AST]] = []

    def walk(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.ClassDef):
                walk(child, f"{prefix}{child.name}.")
            elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                found.append((f"{prefix}{child.name}", child))
                walk(child, f"{prefix}{child.name}.")

    walk(tree, "")
    return found


def _owned_ids(tree: ast.Module) -> set[int]:
    """Ids of every node inside some function — the rest is module level."""
    owned: set[int] = set()
    for _qual, node in _functions(tree):
        for inner in ast.walk(node):
            owned.add(id(inner))
    return owned


def _strings(nodes: list[ast.AST], skip: set[int]) -> list[str]:
    out: list[str] = []
    for node in nodes:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) not in skip:
                out.append(node.value)
    return out


def _call_names(nodes: list[ast.AST]) -> tuple[set[str], set[str]]:
    """(final-component names, full dotted names) of every call in `nodes`."""
    simple: set[str] = set()
    dotted: set[str] = set()
    for node in nodes:
        if not isinstance(node, ast.Call):
            continue
        name = _dotted(node.func)
        if not name:
            continue
        dotted.add(name)
        simple.add(name.rsplit(".", 1)[-1])
    return simple, dotted


def _xml_marker(strings: list[str], mentions_plivo: bool) -> str | None:
    """Strongest call-XML evidence in these strings, or None."""
    weak: str | None = None
    for text in strings:
        match = XML_STRONG_RE.search(text)
        if match:
            return f"builds Plivo call XML ({match.group(0).strip()}…)"
        if mentions_plivo and weak is None:
            match = XML_WEAK_RE.search(text)
            if match:
                weak = f"builds Plivo call XML ({match.group(0).strip()}…)"
    return weak


# ---------------------------------------------------------------------------
# Per-module analysis
# ---------------------------------------------------------------------------


def analyse_module(rel: str, text: str, api_names: set[str]) -> list[Emitter]:
    """Enumerate the emitters in one Python module and say which are gated."""
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        raise CannotCheck(f"{rel} does not parse ({exc})") from exc

    skip = _docstring_ids(tree)
    owned = _owned_ids(tree)
    mentions_plivo = "plivo" in text.lower()

    units: dict[str, list[ast.AST]] = {}
    for qual, node in _functions(tree):
        units[qual] = list(ast.walk(node))
    module_level = [n for n in ast.walk(tree) if id(n) not in owned]
    units["<module>"] = module_level

    why: dict[str, str] = {}
    calls_simple: dict[str, set[str]] = {}
    gates_directly: set[str] = set()

    for qual, nodes in units.items():
        simple, dotted = _call_names(nodes)
        calls_simple[qual] = simple

        if GATE_FUNCTION in simple:
            gates_directly.add(qual)

        marker = _xml_marker(_strings(nodes, skip), mentions_plivo)
        if marker:
            why[qual] = marker
            continue
        if any(d.endswith(DIAL_SUFFIX) for d in dotted):
            why[qual] = f"dials Plivo (…{DIAL_SUFFIX})"
            continue
        reached = sorted(simple & api_names)
        if reached:
            why[qual] = f"calls the voice API `{reached[0]}()`"

    # (C) in-module propagation: calling an emitter makes you one.
    changed = True
    while changed:
        changed = False
        for qual, simple in calls_simple.items():
            if qual in why:
                continue
            for other in why:
                if other == "<module>":
                    continue
                if other.rsplit(".", 1)[-1] in simple:
                    why[qual] = f"reaches `{other.rsplit('.', 1)[-1]}()` in this module"
                    changed = True
                    break

    # Gate coverage propagates the same way: make_call calls _gate_call_context,
    # which calls the gate. That is coverage, and pretending otherwise would
    # push the guard toward demanding a redundant second gate call.
    gated = set(gates_directly)
    changed = True
    while changed:
        changed = False
        for qual, simple in calls_simple.items():
            if qual in gated:
                continue
            for covered in gated:
                if covered == "<module>":
                    continue
                if covered.rsplit(".", 1)[-1] in simple:
                    gated.add(qual)
                    changed = True
                    break

    return [
        Emitter(rel=rel, qualname=qual, why=reason, gated=qual in gated)
        for qual, reason in sorted(why.items())
    ]


# ---------------------------------------------------------------------------
# Repository scan
# ---------------------------------------------------------------------------


def _sources(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    found: list[Path] = []
    for name in SEARCH_ROOTS:
        base = root / name
        if not base.is_dir():
            raise CannotCheck(f"expected source root is missing: {name}/")
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in suffixes:
                continue
            if any(part in EXCLUDE_PARTS for part in path.parts):
                continue
            if EXCLUDE_NAME_RE.search(path.name):
                continue
            found.append(path)
    return found


def scan(root: Path) -> Report:
    """Enumerate every voice emitter under `root` and its gate status."""
    voice_path = root / VOICE_MODULE
    if not voice_path.is_file():
        raise CannotCheck(
            f"the gated voice module is missing: {VOICE_MODULE}. "
            "That is a move or a rename, not a pass — repoint the guard."
        )
    voice_text = voice_path.read_text(encoding="utf-8", errors="replace")
    if not re.search(rf"^\s*def\s+{GATE_FUNCTION}\s*\(", voice_text, re.MULTILINE):
        raise CannotCheck(
            f"`{GATE_FUNCTION}` is not defined in {VOICE_MODULE}. The gate this "
            "guard exists to police is gone; nothing here can be verified."
        )

    report = Report()

    # Pass 1 — the anchor module. Its public emitters are rule (D)'s API names.
    voice_emitters = analyse_module(VOICE_MODULE, voice_text, set())
    report.api_names = {
        e.qualname.rsplit(".", 1)[-1]
        for e in voice_emitters
        if not e.qualname.rsplit(".", 1)[-1].startswith("_")
    }
    if not report.api_names:
        raise CannotCheck(
            f"no public voice emitter found in {VOICE_MODULE} — the guard would "
            "have no cross-module API to look for, which is a vacuous pass"
        )

    report.emitters.extend(voice_emitters)
    report.files_scanned += 1

    # Pass 2 — everything else, now knowing what the voice API is called.
    for path in _sources(root, (PY_SUFFIX,)):
        rel = path.relative_to(root).as_posix()
        if rel == VOICE_MODULE:
            continue
        report.files_scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        # Cheap pre-filter: a file with none of these tokens cannot emit.
        if not (
            XML_STRONG_RE.search(text)
            or XML_WEAK_RE.search(text)
            or DIAL_SUFFIX in text
            or "plivo" in text.lower()
            or any(name in text for name in report.api_names)
        ):
            continue
        report.emitters.extend(analyse_module(rel, text, report.api_names))

    # TS/JS — file level. The gate is Python; a hit here is unreachable from it.
    for path in _sources(root, TS_SUFFIXES):
        rel = path.relative_to(root).as_posix()
        report.files_scanned += 1
        text = path.read_text(encoding="utf-8", errors="replace")
        hit = XML_STRONG_RE.search(text) or (
            "plivo" in text.lower() and XML_WEAK_RE.search(text)
        )
        if hit and rel not in TS_ALLOWLIST:
            report.ts_hits.append(rel)

    if not report.emitters:
        raise CannotCheck(
            "no voice emitter found anywhere under "
            f"{'/, '.join(SEARCH_ROOTS)}/ — the guard would pass vacuously"
        )
    return report


def evaluate(
    report: Report, allowlist: dict[str, str]
) -> tuple[list[str], list[str], list[str]]:
    """(ungated, stale allowlist entries, redundant allowlist entries)."""
    keys = {e.key for e in report.emitters}
    ungated = [
        f"{e.key}\n      emits: {e.why}"
        for e in report.emitters
        if not e.gated and e.key not in allowlist
    ]
    stale = sorted(k for k in allowlist if k not in keys)
    redundant = sorted(e.key for e in report.emitters if e.gated and e.key in allowlist)
    return ungated, stale, redundant


# ---------------------------------------------------------------------------
# Self-test — prove the guard fires on the shapes it exists to catch
# ---------------------------------------------------------------------------

_GATE_DEF = '''
def assert_order_voice_allowed(**kwargs):
    """The gate."""
    raise RuntimeError("refused")
'''

_VOICE_MODULE_GATED = (
    _GATE_DEF
    + """

class PlivoVoiceClient:
    def generate_answer_xml(self, speak_text=None, gather_input=False):
        if gather_input:
            assert_order_voice_allowed(spoken_text=speak_text)
        return "<Response><Speak>" + speak_text + "</Speak></Response>"

    def generate_negotiation_xml(self, quantity, target_price):
        greeting = "press 1 if you can accommodate this order"
        assert_order_voice_allowed(spoken_text=greeting)
        return self.generate_answer_xml(speak_text=greeting, gather_input=True)

    def _gate_call_context(self, context):
        assert_order_voice_allowed(spoken_text=str(context))

    async def make_call(self, to_number, context=None):
        self._gate_call_context(context)
        return await self._make_call_via_plivo(to_number)

    async def _make_call_via_plivo(self, to_number):
        return self.client.calls.create(to_=to_number)
"""
)

#: The pre-PR-156 shape: the gate exists, and nothing calls it.
_VOICE_MODULE_UNGATED = _VOICE_MODULE_GATED.replace(
    "assert_order_voice_allowed(", "_noop("
).replace("def _noop(**kwargs)", "def assert_order_voice_allowed(**kwargs)")

_WEBHOOK_UNGATED = '''
"""The answer webhook the audit warned about, one layer down."""


def serve_answer_xml(order):
    return (
        "<Response><GetDigits action='/x'>"
        "<Speak>Press 1 to accept this order at $25.00 per bottle.</Speak>"
        "</GetDigits></Response>"
    )
'''

_WEBHOOK_GATED = _WEBHOOK_UNGATED.replace(
    "def serve_answer_xml(order):\n    return (",
    "from services.plivo_voice_client import assert_order_voice_allowed\n\n\n"
    "def serve_answer_xml(order):\n"
    "    assert_order_voice_allowed(order_id=order)\n"
    "    return (",
)

#: No XML of its own — it just calls the public voice API (rule D).
_CROSS_MODULE_CALLER = """
def dial_the_vendor(client, order):
    return client.generate_negotiation_xml(quantity=6, target_price=25.0)
"""

#: XML behind a private helper, gate behind another one (rules C and gate
#: propagation) — the `make_call` / `_gate_call_context` shape.
_INDIRECT_GATED = (
    _GATE_DEF
    + """

def _build(text):
    return "<Response><Speak>" + text + "</Speak></Response>"


def _check(text):
    assert_order_voice_allowed(spoken_text=text)


def speak_to_vendor(text):
    _check(text)
    return _build(text)
"""
)

_TS_WEBHOOK = """
export function answerXml(order: string): string {
  return `<Response><GetDigits><Speak>Press 1 to accept this order.</Speak>` +
    `</GetDigits></Response>`;
}
"""


def _build_tree(root: Path, files: dict[str, str]) -> None:
    for rel, body in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
    (root / "apps").mkdir(parents=True, exist_ok=True)
    (root / "services").mkdir(parents=True, exist_ok=True)


WEBHOOK_REL = "services/agent-orchestrator/webhooks/voice_answer.py"
CALLER_REL = "services/agent-orchestrator/agents/vendor_caller.py"
INDIRECT_REL = "services/agent-orchestrator/services/voice_helper.py"
TS_REL = "apps/api-gateway/src/voice/answer.controller.ts"


def _self_test() -> int:
    """Run the guard against synthetic pre-fix trees and assert it fires."""
    failures: list[str] = []

    def check(label: str, files: dict[str, str], expect: dict[str, bool]) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _build_tree(root, files)
            try:
                report = scan(root)
            except CannotCheck as exc:
                if expect.get("cannot_check"):
                    return
                failures.append(f"[{label}] unexpected CANNOT CHECK: {exc}")
                return
            if expect.get("cannot_check"):
                failures.append(f"[{label}] expected CANNOT CHECK, guard ran clean")
                return

            ungated, _stale, _redundant = evaluate(report, {})
            flagged = " ".join(ungated)
            for needle, want in expect.items():
                if needle in ("cannot_check", "ts"):
                    continue
                got = needle in flagged
                if got != want:
                    failures.append(
                        f"[{label}] expected `{needle}` "
                        f"{'flagged' if want else 'silent'}; "
                        f"guard reported: {ungated or 'nothing'}"
                    )
            if "ts" in expect and bool(report.ts_hits) != expect["ts"]:
                failures.append(
                    f"[{label}] TS check: expected "
                    f"{'a hit' if expect['ts'] else 'no hit'}, got {report.ts_hits}"
                )

    # 1. The pre-PR-156 tree: the gate is defined and no emitter calls it.
    check(
        "pre-fix voice module",
        {VOICE_MODULE: _VOICE_MODULE_UNGATED},
        {
            "generate_negotiation_xml": True,
            "generate_answer_xml": True,
            "make_call": True,
        },
    )

    # 2. The shipped tree: same emitters, all reaching the gate.
    check(
        "gated voice module",
        {VOICE_MODULE: _VOICE_MODULE_GATED},
        {
            "generate_negotiation_xml": False,
            "generate_answer_xml": False,
            # `_make_call_via_plivo` is genuinely ungated — it is the ALLOWLIST
            # entry, and with an empty allowlist it must still be flagged.
            "_make_call_via_plivo": True,
        },
    )

    # 3. The audit's exact scenario: a new answer webhook that speaks an order.
    check(
        "ungated answer webhook",
        {VOICE_MODULE: _VOICE_MODULE_GATED, WEBHOOK_REL: _WEBHOOK_UNGATED},
        {"voice_answer.py::serve_answer_xml": True},
    )
    check(
        "gated answer webhook",
        {VOICE_MODULE: _VOICE_MODULE_GATED, WEBHOOK_REL: _WEBHOOK_GATED},
        {"voice_answer.py::serve_answer_xml": False},
    )

    # 4. Rule (D): no XML of its own, just a call to the public voice API.
    check(
        "ungated cross-module caller",
        {VOICE_MODULE: _VOICE_MODULE_GATED, CALLER_REL: _CROSS_MODULE_CALLER},
        {"vendor_caller.py::dial_the_vendor": True},
    )

    # 5. Rule (C) + gate propagation through helpers, both in one module.
    check(
        "helper indirection",
        {VOICE_MODULE: _VOICE_MODULE_GATED, INDIRECT_REL: _INDIRECT_GATED},
        {"voice_helper.py::speak_to_vendor": False, "voice_helper.py::_build": True},
    )

    # 6. A TS answer webhook cannot reach a Python gate — always a failure.
    check(
        "typescript answer webhook",
        {VOICE_MODULE: _VOICE_MODULE_GATED, TS_REL: _TS_WEBHOOK},
        {"ts": True},
    )

    # 7. Cannot check, never a vacuous pass.
    check(
        "gate function deleted",
        {VOICE_MODULE: _GATE_DEF.replace("def ", "def x_")},
        {"cannot_check": True},
    )
    check(
        "voice module missing",
        {CALLER_REL: _CROSS_MODULE_CALLER},
        {"cannot_check": True},
    )

    if failures:
        print("FAIL — the guard does not behave as documented:")
        for line in failures:
            print(f"  {line}")
        return 1
    print(
        "PASS — the guard flags an ungated answer webhook, an ungated "
        "cross-module caller, XML hidden behind a helper, a TS emitter and the "
        "pre-PR-156 module; it is silent once each one reaches the gate, and it "
        "exits 2 rather than pass when the gate or the module is gone."
    )
    return 0


# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test()

    try:
        report = scan(REPO)
    except CannotCheck as exc:
        print(f"CANNOT CHECK: {exc}")
        print("Exiting 2 — a guard that cannot verify must not report success.")
        return 2

    ungated, stale, redundant = evaluate(report, ALLOWLIST)
    gated = sum(1 for e in report.emitters if e.gated)
    print(
        f"== Voice emitters: {len(report.emitters)} enumerated, {gated} reach "
        f"{GATE_FUNCTION}(), {len(ALLOWLIST)} knowingly non-binding "
        f"({report.files_scanned} files scanned)"
    )
    for emitter in report.emitters:
        mark = "gated" if emitter.gated else "allowlisted"
        print(f"   [{mark:>11}] {emitter.key}  — {emitter.why}")

    if stale:
        print("\n== STALE ALLOWLIST ENTRIES — these functions no longer exist")
        for key in stale:
            print(f"   {key}")
            print("      delete the entry; a list nobody prunes is a list nobody reads")

    if redundant:
        print("\n== REDUNDANT ALLOWLIST ENTRIES — these DO pass through the gate now")
        for key in redundant:
            print(f"   {key}  — strike it off; 'commits nothing' is no longer why")

    if report.ts_hits:
        print(f"\n== TYPESCRIPT/JAVASCRIPT CALL XML ({len(report.ts_hits)})")
        for rel in report.ts_hits:
            print(f"   {rel}")

    if ungated:
        print(f"\n== UNGATED ({len(ungated)})")
        for line in ungated:
            print(f"   {line}")

    if ungated or report.ts_hits:
        print(
            "\nFAIL — a voice path can speak to a vendor without passing "
            f"{GATE_FUNCTION}().\n"
            "   FUTURES §8.1: AI never forms or accepts a purchase commitment\n"
            "   without a recorded human tap. Voice is the surface where that\n"
            "   happens in one breath and leaves no draft to review.\n"
            "\n"
            "   Either call the gate on the path that speaks — it lives in\n"
            f"   {VOICE_MODULE} — or add the\n"
            "   function to ALLOWLIST with the reason it commits nothing.\n"
            "   'It is only reachable from a gated caller today' is a claim\n"
            "   about today; write it down as one if that is the argument.\n"
            "\n"
            "   A TS/JS finding cannot be fixed by calling the gate: it is a\n"
            "   Python function. Serving call XML from the gateway means moving\n"
            "   a binding surface out of reach of the only enforcement point we\n"
            "   have, which is an ADR, not a PR."
        )
        return 1

    if stale or redundant:
        print(
            "\nFAIL — the allowlist disagrees with the code. It shrinks; it does\n"
            "   not drift. Strike off what is listed above."
        )
        return 1

    print(
        f"\nPASS — every one of the {len(report.emitters)} voice emitters either "
        f"reaches {GATE_FUNCTION}() or is a named, reasoned non-binding path, "
        "and no TS/JS file builds call XML."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
