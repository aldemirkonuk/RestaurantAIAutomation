#!/usr/bin/env python3
"""
Guard: a queue dispatcher whose queue cannot be READ says so. It never returns
the shape it returns when the queue is merely empty.  (ADR 0161)

WHY THIS EXISTS
---------------
`HouseLettersService.dispatchDue` (2026-09-04) and `RelayEmailService.
dispatchQueued` (2026-09-17, a copy of it) both began::

    const { data, error } = await this.db.client.from(<queue>).select(...)...;
    if (error) {
      this.logger.error(`could not read the queue: ${error.message}`);
      return { considered: 0, sent: 0, failed: 0, skipped: 0 };
    }

`error` IS bound, so `check_read_errors_not_swallowed.py` passes. What it does
NOT check is what the branch DOES with the error -- and this branch returned,
byte for byte, what the same function returns when nothing is due. The cron
then wrote `last = { at, error: null, ...result }`. A database outage on the
queue read therefore reported `error: null`, all zeros: a quiet minute. The
surface that shows it (`GET /communications/letters/sender` ->
`dispatcher`) exists to say whether letters can still leave, and for the length
of the outage it said yes.

That is the repo's standing fault -- a system reporting ABSENCE as HEALTH -- one
step past what the sibling guard sees. `check_read_errors_not_swallowed.py`
proves the error was *bound*; this proves it was *surfaced*.

WHAT IT CHECKS (two independent rules)
--------------------------------------
1. PRESENCE. Every dispatcher in `EXPECTED` must exist, and the first `if` at the
   top level of its body that tests an error variable (`error`, `err`, `xxxError`)
   must have a `throw` at ITS OWN top level -- not nested in an inner `if`, a
   callback or a try, none of which leaves the method -- and no `return` anywhere. A dispatcher that is missing, renamed, or
   whose body cannot be parsed is exit 2 -- never a silent pass. The registry is
   what stops a rename from quietly un-guarding the function.

2. ABSENCE, EVERYWHERE. In any non-test source under `apps/api-gateway/src`, an
   `if (... error ...)` branch (braced or braceless, its `else` too) or a `catch`
   block that RETURNS an object literal with two or
   more RUN COUNTERS set to a literal `0` (`considered`, `sent`, `failed`,
   `skipped`, `processed`, `exported`, `emitted`, `dispatched`, `delivered`) is a
   violation. That is the fault's exact shape, so a future copy-paste of either
   dispatcher is caught even though nobody added it to `EXPECTED`.

WHAT IT DOES NOT CATCH, ON PURPOSE
----------------------------------
* A read-error branch on a DASHBOARD or other read path that returns zeros under
  other names (`todayCount: 0`, `totalProcurementSpend: 0`). Two such sites exist
  in `dashboard.service.ts` (~:282, ~:331), measured 2026-09-18 and listed in
  ADR 0161 as NOT FIXED here: same fault, different surface, different owner.
* Zero-shapes that are not a literal object with >=2 named run counters:
  `return { ...ZERO }`, `return EMPTY_RUN`, `return this.zeroRun()`, a single
  counter (`{ considered: 0 }`), a nested `{ counts: { ... } }`. Found by adversarial
  review 2026-09-18 and left uncaught on purpose: catching a constant needs type
  information this text scan does not have. Copy-pasting either dispatcher does not
  produce these shapes; a deliberate refactor into a shared constant would.
* An `if (error) { log }` that falls through in an UNREGISTERED file (only a
  registered dispatcher is checked for "must throw"; this is why the registry
  exists and why CLAIMS row ADR-0161-RELAY-DISPATCHER-REGISTERED is a tripwire).
* A read-error branch that returns `[]`, `null` or a helper call
  (`return emptyTally()`) -- the shape differs, the population is large, and
  `check_read_errors_not_swallowed.py` already owns "was the error bound".
  Naming the gap is the price of a guard nobody has to turn off.
* A per-row failure inside a dispatcher's loop. `claimError` is counted as
  `skipped` (read as "claimed elsewhere") and the post-send status writes never
  read their `.error`. Both are real and are listed in ADR 0161 as NOT FIXED
  here: fixing them changes the return shape the cron and the doors spec assert
  on, which is a decision, not a patch.
* Whether the cron RECORDS the thrown error. The behavioural specs
  (`house-letters.spec.ts`, `relay-dispatch-read-failure.spec.ts`) prove that
  half -- this guard cannot run a cron.

NEVER VACUOUS
-------------
Exit 0 clean, 1 violation, **2 cannot check**. Exit 2 blocks CI exactly like
exit 1. It fires when: a registered dispatcher's file or method is missing; a
method body will not parse; the shared comment stripper is gone; zero source
files were scanned; or the detector's own read-error-block finder returns ZERO
blocks across the whole tree (which would mean the pattern rotted -- the tree
has hundreds).

`--self-test` proves the guard fires: synthetic fixtures for each verdict, AND
the real `dispatchDue` source with its fix reverted in memory. A mutation that
changes nothing is itself a failure (memory `checks-cannot-see-their-own-removal`, PR #349): a check proven against a no-op
proves nothing.

EXIT CODES
----------
    0   checked, clean
    1   checked, violations found (each printed with file:line)
    2   CANNOT CHECK -- treat as failure, never as a skip
"""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCE_ROOT = Path("apps") / "api-gateway" / "src"

# (file relative to repo root, method). A missing entry is exit 2.
#
# `RelayEmailService.dispatchQueued` (relay-email.service.ts) is NOT listed
# here because that file lands with feat/finish-relay, not before it. It is
# still covered by rule 2 the moment it exists, and CLAIMS row
# ADR-0161-RELAY-DISPATCHER-REGISTERED fails the build until it is added here.
EXPECTED: list[tuple[str, str]] = [
    (
        "apps/api-gateway/src/communications/letters/house-letters.service.ts",
        "dispatchDue",
    ),
]

# Files the shared comment stripper cannot follow, so rule 2 cannot parse them.
# Key: path. Value: WHY. This is a blind spot named rather than a skip made
# quietly. Such a file is NEVER parsed (a de-synced stripper yields quote-parity
# garbage that can bracket-balance by luck) and gets a crude raw-text pass
# (`crude_scan`) instead, so it is not wholly unexamined. A row whose file is gone
# fails the build with the instruction to delete it.
UNPARSEABLE: dict[str, str] = {
    "apps/api-gateway/src/wines/wines.service.ts": (
        'a regex literal containing a double quote (line 46, `/[,.:()"\\\\]/`) makes '
        "check_order_capture_contract.strip_comments read the rest of the file as one "
        "string; no dispatcher and no zero-shape branch lives in this file"
    ),
}

TEST_FILE = re.compile(r"\.(spec|test|e2e-spec)\.tsx?$")
SKIP_DIRS = {"node_modules", "dist", "build", "coverage", "__tests__"}


class CannotCheck(Exception):
    """The guard cannot see what it claims to. Exit 2, never 0."""


def _load_strip_comments():
    # The repo's own idiom (check_read_errors_not_swallowed.py, ADR 0074): one
    # comment stripper, loaded by path. Always from THIS checkout's scripts/,
    # never from `--root`, so a fixture tree does not need a copy of it.
    path = HERE / "check_order_capture_contract.py"
    if not path.is_file():
        raise CannotCheck(f"{path} is missing; the shared comment stripper is gone")
    try:
        spec = importlib.util.spec_from_file_location("_occ_shared_drf", path)
        if spec is None or spec.loader is None:
            raise CannotCheck(f"{path} could not be loaded as a module")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:  # noqa: BLE001 - a stray sys.exit() is the point
        raise CannotCheck(f"{path} would not import: {e!r}") from e
    if not hasattr(mod, "strip_comments"):
        raise CannotCheck(f"{path} no longer exports strip_comments")
    return mod.strip_comments


STRIP_COMMENTS = _load_strip_comments()


# ---------------------------------------------------------------------------
# A tiny bracket matcher. Strings are skipped so a `}` inside one cannot close
# a block; a `${...}` inside a template literal is skipped WITH the string,
# which is safe because it is balanced.
# ---------------------------------------------------------------------------
def _match(src: str, i: int, open_c: str, close_c: str) -> int:
    """Index of the bracket closing the one at `src[i]`; CannotCheck if none."""
    depth, n, quote = 0, len(src), None
    while i < n:
        c = src[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise CannotCheck("unbalanced brackets while extracting a block")


def _brace_depths(src: str) -> list[int]:
    """`{`-depth at every index of `src`, computed once (string-aware)."""
    out, depth, quote, i, n = [0] * len(src), 0, None, 0, len(src)
    while i < n:
        c = src[i]
        out[i] = depth
        if quote:
            if c == "\\" and i + 1 < n:
                out[i + 1] = depth
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        i += 1
    return out


def _line(src: str, idx: int) -> int:
    return src.count("\n", 0, idx) + 1


def method_body(src: str, name: str) -> tuple[int, str] | None:
    """(offset of the body's `{`, body text incl. braces) of `async name(...)`."""
    m = re.search(rf"\basync\s+{re.escape(name)}\s*\(", src)
    if not m:
        return None
    close_paren = _match(src, m.end() - 1, "(", ")")
    # Skip an optional return type. `Promise<{ a: number }>` holds braces, so a
    # `{` only opens the body at angle depth 0 and brace depth 0.
    i, angle, brace, n = close_paren + 1, 0, 0, len(src)
    while i < n:
        c = src[i]
        if c == "<":
            angle += 1
        elif c == ">" and src[i - 1] != "=":
            angle -= 1
        elif c == "{":
            if angle == 0 and brace == 0:
                end = _match(src, i, "{", "}")
                return i, src[i : end + 1]
            brace += 1
        elif c == "}":
            brace -= 1
        i += 1
    raise CannotCheck(f"could not find the body of {name}()")


def blank_strings(src: str) -> str:
    """Blank the CONTENT of every string / template literal (delimiters and
    newlines kept), so a `return` or an `error` inside a message can never be
    read as code. Run after comment stripping."""
    out, quote, i, n = [], None, 0, len(src)
    while i < n:
        c = src[i]
        if quote:
            if c == "\\" and i + 1 < n:
                out.append(" ")
                out.append("\n" if src[i + 1] == "\n" else " ")
                i += 2
                continue
            if c == quote:
                quote = None
                out.append(c)
            else:
                out.append("\n" if c == "\n" else " ")
        else:
            if c in "\"'`":
                quote = c
            out.append(c)
        i += 1
    return "".join(out)


def prepare(src: str) -> str:
    return blank_strings(STRIP_COMMENTS(src))


# The variable a supabase read's error is bound to is `error` OR, by the repo's
# own convention (256 `error: xxxError` destructures), `queueError`, `readError`,
# `claimError`, ... An earlier draft matched only `error` and so passed
# `if (queueError) { return zeros }` -- found by adversarial review 2026-09-18.
ERROR_NAME = r"(?:error|err|\w*Error)"
IF_OPEN = re.compile(r"\bif\s*\(")
ERROR_WORD = re.compile(rf"\b{ERROR_NAME}\b")
CATCH_OPEN = re.compile(r"\bcatch\s*(?:\([^)]*\))?\s*\{")


def _statement_end(src: str, j: int) -> int:
    """End index (exclusive) of the braceless statement starting at `src[j]`."""
    depth, i, n = 0, j, len(src)
    while i < n:
        c = src[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth < 0:
                return i
        elif c == ";" and depth == 0:
            return i + 1
        i += 1
    return n


def _after(src: str, k: int) -> int:
    while k < len(src) and src[k].isspace():
        k += 1
    return k


def _branch(src: str, j: int) -> tuple[str, int]:
    """(`{ ... }` text, index after it) of the branch starting at `src[j]`,
    braced or braceless (a braceless one is wrapped so callers see one shape)."""
    if src[j] == "{":
        e = _match(src, j, "{", "}")
        return src[j : e + 1], e + 1
    e = _statement_end(src, j)
    return "{" + src[j:e] + "}", e


def error_blocks(src: str) -> list[tuple[int, int, str, str]]:
    """Every `if (...error...)` and every `catch` in `src`:
    (index, `{`-depth of it, THEN block, ELSE block or "").

    Braceless branches are wrapped in braces -- `if (error) return {...};` is the
    same bug as the braced form, and an earlier draft treated braceless as
    "already throws". A `catch` is included because `catch (e) { return zeros }`
    around the read is the same fault by another road; its else is "".
    """
    depths = _brace_depths(src)
    out: list[tuple[int, int, str, str]] = []
    for m in IF_OPEN.finditer(src):
        try:
            cond_end = _match(src, m.end() - 1, "(", ")")
        except CannotCheck:
            continue
        if not ERROR_WORD.search(src[m.end() : cond_end]):
            continue
        j = _after(src, cond_end + 1)
        if j >= len(src):
            continue
        then, k = _branch(src, j)
        k = _after(src, k)
        els = ""
        if src.startswith("else", k) and not src[k + 4 : k + 5].isalnum():
            k2 = _after(src, k + 4)
            if k2 < len(src):
                els, _ = _branch(src, k2)
        out.append((m.start(), depths[m.start()], then, els))
    for m in CATCH_OPEN.finditer(src):
        j = m.end() - 1
        out.append((m.start(), depths[m.start()], src[j : _match(src, j, "{", "}") + 1], ""))
    return out


def top_level(block: str) -> str:
    """The statements of `{ ... }` that are NOT nested in any bracket. A `throw`
    inside an inner `if`, callback or try is not a throw out of the method."""
    inner = block[1:-1]
    out, depth = [], 0
    for c in inner:
        if c in "([{":
            depth += 1
            out.append(" ")
        elif c in ")]}":
            depth -= 1
            out.append(" ")
        else:
            out.append(c if depth == 0 else (c if c == "\n" else " "))
    return "".join(out)


# The counters a queue run reports. Deliberately NOT `\w+`: a first draft matched
# any `x: 0` and flagged `vendor-page-extractor.service.ts`, whose failed write
# returns `written: 0` WITH a warning saying so -- a deliberate, surfaced zero.
COUNTERS = "considered|sent|failed|skipped|processed|exported|emitted|dispatched|delivered"
RETURN_OBJECT = re.compile(r"\breturn\s*\{([^{}]*)\}")
ZERO_PROP = re.compile(rf"\b(?:{COUNTERS})\s*:\s*0\b")


def returns_zero_shape(block: str) -> bool:
    return any(
        len(set(ZERO_PROP.findall(m.group(1)))) >= 2 for m in RETURN_OBJECT.finditer(block)
    )


def scan_source(src: str, path: str, sites: list[int]) -> list[str]:
    """Rule 2 over one file. Appends how many blocks it saw to `sites`."""
    code = prepare(src)
    blocks = error_blocks(code)
    sites.append(len(blocks))
    return [
        f"{path}:{_line(code, idx)}: an `if (error)` / `catch` block returns an all-zero "
        "counts object -- the same value the function returns when nothing was due. "
        "Throw instead (ADR 0161)."
        for idx, _depth, then, els in blocks
        if returns_zero_shape(then) or returns_zero_shape(els)
    ]


def check_expected(root: Path) -> list[str]:
    """Rule 1 for every registered dispatcher."""
    problems: list[str] = []
    for rel, method in EXPECTED:
        f = root / rel
        if not f.is_file():
            raise CannotCheck(
                f"{rel} is missing, but this guard EXPECTS {method}() in it. If the "
                "dispatcher moved, repoint EXPECTED; do not delete the row."
            )
        code = prepare(f.read_text(encoding="utf-8"))
        found = method_body(code, method)
        if found is None:
            raise CannotCheck(
                f"{rel} no longer defines async {method}(). Renamed? Repoint EXPECTED."
            )
        offset, body = found
        top = [b for b in error_blocks(body) if b[1] == 1 and IF_OPEN.match(body, b[0])]
        if not top:
            problems.append(
                f"{rel}:{_line(code, offset)}: {method}() never tests the queue read's "
                "error at the top level of its body, so a failed read falls through as "
                "an empty queue."
            )
            continue
        idx, _depth, then, _els = top[0]
        line = _line(code, offset + idx)
        if not re.search(r"\bthrow\b", top_level(then)):
            problems.append(
                f"{rel}:{line}: {method}()'s queue-read error branch has no `throw` at "
                "its own top level (a throw nested in an `if`, callback or try does not "
                "leave the method)."
            )
        if re.search(r"\breturn\b", then):
            problems.append(
                f"{rel}:{line}: {method}()'s queue-read error branch RETURNS -- a "
                "failed read must not resolve as a completed run."
            )
    return problems


def source_files(root: Path):
    base = root / SOURCE_ROOT
    if not base.is_dir():
        raise CannotCheck(f"{base} does not exist; nothing to scan")
    for p in sorted(base.rglob("*.ts")):
        if TEST_FILE.search(p.name) or SKIP_DIRS.intersection(p.relative_to(root).parts):
            continue
        yield p


CRUDE = re.compile(
    r"if\s*\([^)]*\berror\b[^)]*\)\s*\{[^{}]*\breturn\s*\{"
    rf"(?:[^{{}}]*\b(?:{COUNTERS})\s*:\s*0\b){{2}}"
)


def crude_scan(src: str, path: str) -> list[str]:
    """Raw-text fallback for a file the stripper cannot follow (comments included)."""
    return [
        f"{path}:{_line(src, m.start())}: an `if (error)` block appears to return an "
        "all-zero counts object (raw-text fallback; the file is in UNPARSEABLE)."
        for m in CRUDE.finditer(src)
    ]


def run(root: Path, unparseable: dict[str, str] | None = None) -> list[str]:
    unparseable = UNPARSEABLE if unparseable is None else unparseable
    problems = check_expected(root)
    sites: list[int] = []
    scanned, unparsed = 0, set()
    for p in source_files(root):
        scanned += 1
        rel = str(p.relative_to(root))
        text = p.read_text(encoding="utf-8")
        if rel in unparseable:
            # Never parsed, not even "if it happens to": a file the shared stripper
            # de-syncs on yields quote-parity garbage that can balance by luck.
            unparsed.add(rel)
            problems += crude_scan(text, rel)
            continue
        try:
            problems += scan_source(text, rel, sites)
        except CannotCheck as e:
            raise CannotCheck(
                f"{rel}: {e}. If this is valid TypeScript, the shared comment "
                "stripper lost sync (a regex literal holding a quote is the known "
                "cause) -- add the file to UNPARSEABLE with the reason."
            ) from e
    if scanned == 0:
        raise CannotCheck(f"scanned zero files under {root / SOURCE_ROOT}")
    if sum(sites) == 0:
        raise CannotCheck(
            "the error-block finder matched ZERO `if (error)` blocks in the whole "
            "tree, which would mean the pattern rotted, not that the tree is clean"
        )
    for rel in sorted(set(unparseable) - unparsed):
        problems.append(
            f"{rel}: listed in UNPARSEABLE but the file is gone. The list only shrinks "
            "-- delete its row."
        )
    return problems


# ---------------------------------------------------------------------------
# Self-test: prove the guard still fires. Every mutation is asserted to have
# CHANGED its input -- a no-op mutation proves nothing (memory `checks-cannot-see-their-own-removal`, PR #349).
# ---------------------------------------------------------------------------
THROW = "throw new Error(`could not read the queue: ${error.message}`);"
FIXED = f"""
export class S {{
  async dispatchDue(nowMs = Date.now()): Promise<{{
    considered: number;
    sent: number;
  }}> {{
    const {{ data, error }} = await this.db.client.from("q").select("id");
    if (error) {{
      {THROW}
    }}
    return {{ considered: (data ?? []).length, sent: 0 }};
  }}
}}
"""
_SERVICE_REL = EXPECTED[0][0]


def self_test() -> int:
    failures: list[str] = []
    ran = [0]

    def expect(label: str, got, want) -> None:
        ran[0] += 1
        if got != want:
            failures.append(f"{label}: expected exit {want}, got {got}")

    def mutate(label: str, base: str, old: str, new: str) -> str:
        out = base.replace(old, new)
        if out == base:
            failures.append(f"{label}: the mutation changed NOTHING -- the test is void")
        return out

    def verdict(files: dict[str, str]) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, body in files.items():
                p = root / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(body, encoding="utf-8")
            try:
                return 1 if run(root, unparseable={}) else 0
            except CannotCheck:
                return 2

    svc, other = _SERVICE_REL, "apps/api-gateway/src/x/other.service.ts"
    zeros = "this.logger.error(error.message);\n      return { considered: 0, sent: 0 };"

    expect("the fixed shape passes", verdict({svc: FIXED}), 0)
    expect(
        "returning the zero-shape fails",
        verdict({svc: mutate("zeros", FIXED, THROW, zeros)}),
        1,
    )
    expect(
        "an error branch that only logs and falls through fails",
        verdict({svc: mutate("fall-through", FIXED, THROW, "this.logger.error(error.message);")}),
        1,
    )
    expect(
        "a `throw` that exists only in a comment does not count",
        verdict({svc: mutate("comment", FIXED, THROW, "// " + THROW + "\n      this.logger.error(1);")}),
        1,
    )
    no_test = mutate("no-test", FIXED, "if (error) {", "if (data === undefined) {")
    expect(
        "a dispatcher that never tests `error` at the top level fails",
        verdict({svc: no_test, other: FIXED.replace("dispatchDue", "dispatchOther")}),
        1,
    )
    expect(
        "a tree with no `if (error)` block anywhere is exit 2 (pattern rot)",
        verdict({svc: no_test.replace("error.message", "String(data)")}),
        2,
    )
    expect(
        "an UNREGISTERED clone returning zeros fails (rule 2 alone)",
        verdict({svc: FIXED, other: mutate("clone", FIXED, THROW, zeros).replace("dispatchDue", "dispatchOther")}),
        1,
    )
    # ---- Escapes found by adversarial review, 2026-09-18. Each was exit 0 on a
    # tree that still had the bug before the guard was hardened.
    ZEROS = "{ considered: 0, sent: 0, failed: 0, skipped: 0 }"
    clone = lambda body: FIXED.replace("dispatchDue", "dispatchOther").replace(THROW, body)  # noqa: E731
    braceless = FIXED.replace("dispatchDue", "dispatchOther").replace(
        "if (error) {\n      " + THROW + "\n    }", "if (error) return " + ZEROS + ";"
    )
    if braceless == FIXED.replace("dispatchDue", "dispatchOther"):
        failures.append("braceless: the mutation changed NOTHING -- the test is void")
    expect("braceless `if (error) return zeros` fails", verdict({svc: FIXED, other: braceless}), 1)
    expect(
        "the error variable is `queueError`, not `error`",
        verdict({svc: FIXED, other: clone("return " + ZEROS + ";").replace("if (error)", "if (queueError)").replace("const { data, error }", "const { data, error: queueError }")}),
        1,
    )
    expect(
        "the zero-shape sits in the ELSE of `if (!error)`",
        verdict({svc: FIXED, other: FIXED.replace("dispatchDue", "dispatchOther").replace("if (error) {", "if (!error) { void 0; } else {").replace(THROW, "return " + ZEROS + ";")}),
        1,
    )
    expect(
        "a `catch` that returns zeros",
        verdict({svc: FIXED, other: FIXED.replace("dispatchDue", "dispatchOther").replace("return { considered: (data ?? []).length, sent: 0 };", "return { considered: (data ?? []).length, sent: 0 };\n  } catch (e) {\n    return " + ZEROS + ";").replace("    const { data, error }", "  try {\n    const { data, error }")}),
        1,
    )
    # Rule 1 was lexical (`\bthrow\b` present, `\breturn\b` absent). It is now structural.
    for label, body in [
        ("a throw nested in a condition that may not hold", "if (error.code !== 'X') { " + THROW + " }"),
        ("a throw inside a callback that never propagates", "setTimeout(() => { " + THROW + " }, 0);"),
        ("a throw swallowed by its own try/catch", "try { " + THROW + " } catch (e) { this.logger.error(e); }"),
    ]:
        expect(label + " fails", verdict({svc: mutate(label, FIXED, THROW, body)}), 1)
    # ...and the false FAILS it had: the word `return` inside a message, a renamed var.
    talky = mutate("talky", FIXED, THROW, "throw new Error(`cannot read; will return next tick: ${error.message}`);")
    expect("the word `return` inside the message is not a return", verdict({svc: talky}), 0)
    renamed = FIXED.replace("if (error) {", "if (queueError) {").replace("const { data, error }", "const { data, error: queueError }").replace("error.message", "queueError.message")
    if renamed == FIXED:
        failures.append("renamed: the mutation changed NOTHING -- the test is void")
    expect("a registered dispatcher that binds `error: queueError` and throws passes", verdict({svc: renamed}), 0)

    # The narrowing. A surfaced zero (a failed WRITE that returns `written: 0`
    # beside an explicit warning) is not this fault and must not be flagged.
    surfaced = FIXED.replace(
        "dispatchDue", "persist"
    ).replace(THROW, "warnings.push(error.message);\n      return { written: 0, flagged: 0 };")
    expect(
        "a surfaced zero under non-counter names is not flagged",
        verdict({svc: FIXED, other: surfaced}),
        0,
    )
    expect("the registered file missing is exit 2", verdict({other: FIXED}), 2)
    expect(
        "the registered method missing is exit 2",
        verdict({svc: mutate("rename", FIXED, "dispatchDue", "sendDue")}),
        2,
    )

    # The REAL dispatchDue with its fix reverted in memory: proof the guard
    # would have caught the actual defect, not a paraphrase of it.
    real = ROOT / _SERVICE_REL
    if not real.is_file():
        failures.append(f"{_SERVICE_REL} is missing; cannot prove the guard against the real source")
    else:
        text = real.read_text(encoding="utf-8")
        m = re.search(
            r"throw new Error\(\s*`letter dispatch could not read the queue: \$\{error\.message\}`,?\s*\);",
            text,
        )
        if not m:
            failures.append(
                "the real dispatchDue no longer has its throw in the expected form; the "
                "self-test cannot revert it. Either the fix regressed (run the guard "
                "itself) or the message changed (update this pattern)."
            )
        else:
            reverted = mutate(
                "real dispatchDue reverted",
                text,
                m.group(0),
                "this.logger.error(`could not read the queue: ${error.message}`);\n"
                "      return { considered: 0, sent: 0, failed: 0, skipped: 0 };",
            )
            expect("the REAL dispatchDue with its fix reverted fails", verdict({svc: reverted}), 1)

    if failures:
        print("SELF-TEST FAILED -- the guard does not fire where it must:", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print(f"self-test ok: {ran[0]} verdicts, incl. the real dispatchDue with its fix reverted")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="A failed queue read is not a quiet minute (ADR 0161).")
    ap.add_argument("--self-test", action="store_true", help="prove the guard fires")
    ap.add_argument("--list-expected", action="store_true", help="print the registered dispatcher files")
    ap.add_argument("--root", type=Path, default=ROOT, help="tree to check (default: this repo)")
    args = ap.parse_args()
    try:
        if args.list_expected:
            print("\n".join(rel for rel, _ in EXPECTED))
            return 0
        if args.self_test:
            return self_test()
        problems = run(args.root.resolve())
    except CannotCheck as e:
        print(f"CANNOT CHECK (exit 2): {e}", file=sys.stderr)
        return 2
    if problems:
        print("A queue dispatcher reports an unreadable queue as an empty one:\n", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        print(
            "\nThrow on a failed queue read. The cron already catches it and records it as "
            "`lastRun().error`; `considered: 0` with `error: null` must mean a real quiet "
            "minute. See ADR 0161.",
            file=sys.stderr,
        )
        return 1
    print("ok: no queue dispatcher reports an unreadable queue as an empty one")
    return 0


if __name__ == "__main__":
    sys.exit(main())
