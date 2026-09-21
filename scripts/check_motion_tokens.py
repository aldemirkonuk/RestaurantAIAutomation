#!/usr/bin/env python3
"""
Guard: every motion in the Mudavym house is a named token, or a disclosed,
cited exception -- never a bare number.

ADR 0134 rule 7 (`.planning/decisions/0134-...md` §10, locked 2026-09-21) --
"Ship it, re-specified." As originally drafted the guard the ADR describes
could see neither `/inventory` nor `components/layout/Sidebar.tsx`, the two
defects it was written for, while going red on approved exceptions. A green
guard over a standing defect is worse than no guard.

WHY THIS EXISTS
---------------
`ls scripts/ | grep -iE 'motion|token|overlay|modal'` returned nothing across
57 other `check_*` scripts before this one. `{ easing: settle.easing, ms: 420 }`
-- the house curve at `turn`'s own duration, a pairing that matches NEITHER
token -- sat as valid TypeScript in four rebuilt pages
(`DashboardNext.tsx:80`, `SalesCalendar.tsx:75`, `ReportsNext.tsx:141`,
`CalendarNext.tsx:213`, all pre-ADR-0134-rule-1 line numbers) with nothing to
see it, because `components/mudavym/housePolicy.test.tsx`'s own token check
scans only `components/mudavym/` -- the primitive's OWN family, never the
pages that consume it. This guard is that same check, widened to where the
tokens are actually spent.

WHAT THIS CHECKS
-----------------
1. Every `animate(el, keyframes, TOKEN)` call in a scanned `.ts`/`.tsx` file
   (the house WAAPI wrapper, `lib/mudavym/motion.ts`) is handed a bare
   identifier from the seven named tokens (`settle`, `ink`, `tuck`, `turn`,
   `pour`, `press`, `stamp`, `tally`), the `TOKEN[shape]` three-shape lookup
   map `components/mudavym/Sheet.tsx` itself defines, or a file:line the
   ALLOWLIST below names and cites an ADR for. A raw object literal --
   `{ easing: ..., ms: ... }` -- is never a token, whatever numbers it carries;
   ADR 0134 rule 1 folded the one real instance of this into `settle` rather
   than promote it, and the rule is "no eighth token", not "no eighth token
   unless the numbers happen to match one already".
2. Every plain-CSS `animation:`/`transition:` declaration in a scanned `.css`
   file that names a duration is checked two ways: the duration must be one of
   the seven tokens' own millisecond values (160/300/320/360/420/620/840,
   `ALLOWED_MS`), and where that duration is one a plain CSS easing keyword can
   faithfully express (`ink`/`settle`/`turn`/`pour`, in `CSS_ALLOWED_PAIRS` --
   `tuck`/`stamp`/`tally` are sampled springs no CSS keyword reproduces), the
   easing must be the matching token's own curve. A duration outside the seven,
   or a duration correctly matching a token but paired with a foreign easing,
   fails unless allow-listed. A `0s`/`0ms` duration is not motion and is never
   checked.
3. Every slug in `MUDAVYM_PAGES` (`lib/mudavym/useMudavymDesign.ts`) resolves
   to the directory its `next=` component actually lives in, read live from
   `App.tsx`'s own routing -- never a `pages/<slug>/next` guess. `/inventory`
   is the proof this matters: it lives at `pages/inventory/command`, and a
   guard written against `pages/*/next` cannot see the page it was written
   for. A slug that does not resolve -- because `App.tsx`'s wiring changed
   shape, or a lazy import this parser cannot follow -- is CANNOT CHECK, not a
   silent pass: exit 2.
4. Scanned roots: `components/mudavym/`, `components/layout/` (the ADR names
   `Sidebar.tsx` by name -- it sits in neither `pages/` nor `next/`, so a guard
   that only walks resolved page directories would never see it), and every
   resolved page directory, deduplicated (`/receiving` and `/receiving_door`
   share one).

WHAT THIS DOES NOT CATCH, SAID PLAINLY
---------------------------------------
`components/layout/Sidebar.tsx`, `Header.tsx` and
`RestaurantBranchSwitcher.tsx`, and `pages/cellar/next/WineRegister.tsx`,
animate through **framer-motion** (`transition={{ duration: 0.15, ease: […] }}`
JSX props), a second, older motion system this ADR does not fold into the
token vocabulary. This guard checks the house `animate()` wrapper and plain
CSS only -- framer-motion's prop-object literals are invisible to it, which
means the sidebar's own known drift (`Sidebar.tsx:259-260,279-280,514-515`,
raw `duration: 0.15/0.2` and a non-house cubic-bezier) is a real, disclosed gap
in coverage, not a silent one. Bringing framer-motion under this guard is
follow-up work, not done here (see the lane's build note); pretending
otherwise would be exactly the "machinery that structurally cannot report
failure" shape this repo's own guards exist to end.

Also invisible, measured 2026-09-21 over the same scan roots:
  * Tailwind motion utilities in className strings -- `transition-colors
    duration-150` at `pages/receiving/next/DoorNext.tsx:652` (150ms on
    Tailwind's own curve, not a token) and seven `transition-*` /
    `animate-spin` classes in `pages/inventory/command`.
  * The NATIVE `el.animate(keyframes, options)` call (`DraftRail.tsx:65`,
    `:191` -- today one is a timer drain, the other hands over `turn.ms` /
    `turn.easing`, so neither is a violation; a future one could be).
  * CSS longhands (`transition-duration:`), a duration reached through a
    custom property (`transition: opacity var(--x)`), and inline `style`
    transitions -- none carries a duration in the scanned roots today.
And ADR 0134 §10 draws two more reds this guard does not check at all:
`/inventory` has no reduced-motion guard and `/documents/:id` has no
`MOTIONS.md`. Both still stand; both are owed, not covered.

EXEMPTIONS
----------
`ALLOWLIST` below, by `(file, line): reason citing an ADR`. Three entries
ship on the day this guard lands, all disclosed, none silent:
  * `Sheet.tsx` -- ADR 0134 §6's reduced-motion entrance fade, 120ms, the one
    exception "no eighth token" (§1) explicitly allows to stay a literal
    rather than be promoted.
  * `dashboard-next.css` / `reports-next.css` -- the two pre-existing 1.9s
    shimmer sheens ADR 0134 rule 11 locks a fix for ("two cycles, then static
    words at named thresholds"); the fix is owned by the dashboard and reports
    lanes and is not built here. Disclosing them here means this guard does
    not silently pass a defect it can see; it means the fix is still owed.
Add a line only for a real, ADR-cited exception -- never to silence a genuine
miss. A guard that goes red on an approved exception gets disabled within a
week (ADR 0134 §10); a guard with an empty, honest allow-list is the guard
this repo actually wants.

Exit codes:  0 pass  |  1 an unallowed motion literal exists  |  2 cannot check
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
import tempfile
from pathlib import Path

WEB_SRC = "apps/web/src"
USE_MUDAVYM_DESIGN = f"{WEB_SRC}/lib/mudavym/useMudavymDesign.ts"
APP_TSX = f"{WEB_SRC}/App.tsx"

# Reassigned wholesale by --self-test, exactly like check_od_ids_exist.py's
# ROOT/REGISTER: a synthetic fixture tree, never the real one mutated in place.
ROOT = "."

HOUSE = "cubic-bezier(0.16, 1, 0.3, 1)"  # settle, ink
TURN_EASING = "cubic-bezier(0.32, 0.72, 0, 1)"  # turn
LINEAR_EASING = "linear"  # pour, press

KNOWN_TOKENS = {"settle", "ink", "tuck", "turn", "pour", "press", "stamp", "tally"}

# The seven tokens' own millisecond values (pour/press share 620, so the 8
# names collapse to 7 numbers).
ALLOWED_MS = {160, 300, 320, 360, 420, 620, 840}

# The durations a plain CSS easing keyword can faithfully reproduce, and the
# ONE curve each admits. `tuck`/`stamp`/`tally` are sampled damped-spring
# `linear(…)` curves (see lib/mudavym/motion.ts's `springLinear`) that no
# static CSS keyword reproduces, so 300/360/840ms in a CSS declaration is
# always unrecognized -- allow-list it like any other exception, never widen
# this map to admit it.
CSS_ALLOWED_PAIRS: dict[int, set[str]] = {
    160: {HOUSE},
    320: {HOUSE},
    420: {TURN_EASING},
    620: {LINEAR_EASING},
}

# (repo-relative file, 1-based line) -> why, citing the ADR. Path-listed, not
# pattern-matched, so a new entry shows up in a diff. See "EXEMPTIONS" above.
ALLOWLIST: dict[tuple[str, int], str] = {
    (f"{WEB_SRC}/components/mudavym/Sheet.tsx", 715): (
        "ADR 0134 §6 (2026-09-21, locked) -- REDUCED_FADE, the reduced-motion "
        "entrance cross-fade, 120ms opacity-only. Disclosed, not an eighth "
        "token; §1's \"no eighth token\" stays literally true."
    ),
    (f"{WEB_SRC}/pages/dashboard/next/dashboard-next.css", 44): (
        "ADR 0134 rule 11 (2026-09-21, locked) -- the honest-skeleton shimmer, "
        "1.9s. The rule is locked (two cycles, then static words at named "
        "thresholds); the build is owned by the dashboard lane and is not "
        "done here."
    ),
    (f"{WEB_SRC}/pages/reports/next/reports-next.css", 391): (
        "ADR 0134 rule 11 (2026-09-21, locked) -- the honest-skeleton shimmer, "
        "1.9s. The rule is locked (two cycles, then static words at named "
        "thresholds); the build is owned by the reports lane and is not done "
        "here."
    ),
}

SKIP_NAME_RE = re.compile(r"\.(test|spec|stories)\.[tj]sx?$")
ANIMATE_NEEDLE = "animate("
TOKEN_LOOKUP_RE = re.compile(r"^TOKEN\[")
BARE_IDENT_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _read(rel: str) -> str:
    return Path(ROOT, rel).read_text(encoding="utf-8")


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


# ── slug -> directory, read live from the two files, never guessed ─────────


def _parse_mudavym_pages() -> list[str] | None:
    text = _read(USE_MUDAVYM_DESIGN)
    m = re.search(r"export const MUDAVYM_PAGES\s*=\s*\[(.*?)\]\s*as const", text, re.S)
    if not m:
        return None
    return re.findall(r"'([a-z_]+)'", m.group(1))


def _parse_import_map(app_text: str) -> dict[str, str]:
    imports: dict[str, str] = {}
    for m in re.finditer(
        r"const (\w+)\s*=\s*lazyWithRefresh\(\(\)\s*=>\s*import\('(\./[^']+)'\)\)", app_text
    ):
        imports[m.group(1)] = m.group(2)
    for m in re.finditer(r"import\s*\{\s*(\w+)\s*\}\s*from\s*'(\./[^']+)'", app_text):
        imports.setdefault(m.group(1), m.group(2))
    return imports


def resolve_page_dirs() -> tuple[dict[str, str], list[str]]:
    """slug -> repo-relative directory, plus the slugs that could not be
    resolved (CANNOT CHECK, never a silent skip)."""
    slugs = _parse_mudavym_pages()
    if slugs is None:
        return {}, ["<MUDAVYM_PAGES itself unparseable>"]
    app_text = _read(APP_TSX)
    imports = _parse_import_map(app_text)
    dirs: dict[str, str] = {}
    unresolved: list[str] = []
    for slug in slugs:
        m = re.search(r'page="' + re.escape(slug) + r'"[\s\S]{0,600}?next=\{<\s*(\w+)', app_text)
        comp = m.group(1) if m else None
        path = imports.get(comp) if comp else None
        if not path:
            unresolved.append(slug)
            continue
        rel = path[2:] if path.startswith("./") else path
        srcfile = f"{WEB_SRC}/{rel}"
        dirs[slug] = os.path.dirname(srcfile)
    return dirs, unresolved


# ── the house `animate()` wrapper: the 3rd argument must be a token ────────


def _skip_ws_and_comments(text: str, i: int, end: int) -> int:
    """Advance `i` past whitespace and `//…`/`/*…*/` comments — the house
    style cites the ADR in a comment directly above the token it explains
    (see the rule-1 call sites this guard exists to keep fixed), and the
    finding must land on the token's own line, not the comment's."""
    while i < end:
        c = text[i]
        if c.isspace():
            i += 1
        elif text.startswith("//", i):
            nl = text.find("\n", i, end)
            i = end if nl == -1 else nl + 1
        elif text.startswith("/*", i):
            close = text.find("*/", i, end)
            i = end if close == -1 else close + 2
        else:
            break
    return i


def _trimmed_span(text: str, start: int, end: int) -> tuple[int, str]:
    """(offset of the first real token char, trimmed text) for
    `text[start:end]` — a call formatted across lines (the normal house
    style, often with an explanatory comment before the argument) puts the
    argument's own text on a LATER line than the comma that precedes it, and
    the line a finding names must be the argument's own line, not the comma's
    or a comment's."""
    i = _skip_ws_and_comments(text, start, end)
    trimmed = text[i:end].rstrip()
    return i, trimmed


def find_animate_token_args(text: str) -> list[tuple[int, str]]:
    """[(start_offset, text) for the 3rd argument of every `animate(...)`
    call], found by balancing brackets -- the keyframe array is multi-line and
    full of commas, and a regex reads it wrong in both directions. Ported
    verbatim from housePolicy.test.tsx's `motionArgs`."""
    out: list[tuple[int, str]] = []
    at = text.find(ANIMATE_NEEDLE)
    while at >= 0:
        prev = text[at - 1] if at > 0 else ""
        # `.` excludes `el.animate(...)` — the NATIVE two-argument WAAPI call
        # (`DraftRail.tsx:191`), a different call entirely from the free
        # `animate(el, keyframes, token)` the house wrapper exports. Widening
        # this guard to native WAAPI call sites is real, separate work (they
        # bypass the wrapper's token discipline AND its reduced-motion
        # handling) and is not silently done here.
        if prev.isalnum() or prev in ("_", "$", "."):
            at = text.find(ANIMATE_NEEDLE, at + 1)
            continue
        depth = 0
        arg = 0
        start = at + len(ANIMATE_NEEDLE)
        i = start
        n = len(text)
        while i < n:
            c = text[i]
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    if arg == 2:
                        out.append(_trimmed_span(text, start, i))
                    break
                depth -= 1
            elif c == "," and depth == 0:
                if arg == 2:
                    out.append(_trimmed_span(text, start, i))
                    break
                arg += 1
                start = i + 1
            i += 1
        at = text.find(ANIMATE_NEEDLE, at + 1)
    return out


def check_ts_file(relpath: str, findings: list[str], allowed_hits: set[tuple[str, int]]) -> int:
    text = _read(relpath)
    checked = 0
    for start, arg in find_animate_token_args(text):
        if not arg:
            # A trailing comma after the real last argument — `animate(el,
            # kf, token,)` — makes the balancer see a phantom, empty 4th slot
            # at index 2 when the call has only two real arguments (or an
            # empty phantom slot past the real 3rd when it has three); either
            # way there is no argument here to judge.
            continue
        checked += 1
        line = _line_of(text, start)
        if TOKEN_LOOKUP_RE.match(arg):
            continue  # `TOKEN[shape]` -- Sheet.tsx's own 3-shape map, house-only
        if BARE_IDENT_RE.match(arg) and arg in KNOWN_TOKENS:
            continue
        key = (relpath, line)
        if key in ALLOWLIST:
            allowed_hits.add(key)
            continue
        findings.append(
            f'{relpath}:{line}: animate() handed "{arg}" -- not a named token from '
            f"lib/mudavym/motion.ts, and not allow-listed"
        )
    return checked


# ── plain CSS `animation:`/`transition:` declarations ──────────────────────

DECL_RE = re.compile(r"(?:^|[;{])\s*(animation|transition)\s*:\s*([^;{}]+);", re.S)
TIME_RE = re.compile(r"(\d+(?:\.\d+)?)(ms|s)\b", re.I)
EASING_RE = re.compile(r"cubic-bezier\([^)]*\)|(?<![\w-])linear(?![\w(-])")


def _blank_var_fallbacks(segment: str) -> str:
    """Blank out every `var(...)` call, INCLUDING its nested parens (a
    fallback commonly nests `cubic-bezier(...)`, which a non-nesting regex
    cannot span) — see `check_css_file`'s own comment for why a fallback's
    duration/easing is never checked."""
    out: list[str] = []
    i, n = 0, len(segment)
    while i < n:
        if segment.startswith("var(", i) and (i == 0 or not (segment[i - 1].isalnum() or segment[i - 1] in "_-$")):
            depth, j = 0, i
            while j < n:
                if segment[j] == "(":
                    depth += 1
                elif segment[j] == ")":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            out.append(" ")
            i = j
            continue
        out.append(segment[i])
        i += 1
    return "".join(out)


def _split_top_level(segment: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    start = 0
    for i, c in enumerate(segment):
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(segment[start:i])
            start = i + 1
    parts.append(segment[start:])
    return parts


def check_css_file(relpath: str, findings: list[str], allowed_hits: set[tuple[str, int]]) -> int:
    text = _read(relpath)
    checked = 0
    for m in DECL_RE.finditer(text):
        value = m.group(2)
        value_start = m.start(2)
        for segment in _split_top_level(value):
            # A CSS custom-property fallback — `var(--rp-tuck, 300ms
            # cubic-bezier(…))` — is not a claimed motion: the PROPERTY's
            # real value is set by the token itself at runtime (see
            # `reports-next.css`'s own `--rp-tuck` comment); the fallback
            # only ever paints if that injection failed, and a spring token's
            # fallback can never be an exact plain-CSS pairing by
            # construction (no static keyword reproduces a sampled curve).
            # Checking it would make the guard punish the one place a spring
            # duration is HONESTLY approximated for a case CSS cannot express.
            checkable = _blank_var_fallbacks(segment)
            tm = TIME_RE.search(checkable)
            if not tm:
                continue
            num = float(tm.group(1))
            unit = tm.group(2).lower()
            ms = round(num * 1000) if unit == "s" else round(num)
            if ms == 0:
                continue  # a 0-duration declaration is not motion
            checked += 1
            seg_offset = value_start + value.index(segment)
            line = _line_of(text, seg_offset)
            easing_m = EASING_RE.search(checkable)
            easing = easing_m.group(0) if easing_m else None
            ok = False
            if ms in CSS_ALLOWED_PAIRS:
                ok = easing in CSS_ALLOWED_PAIRS[ms]
            # ms in ALLOWED_MS but not in CSS_ALLOWED_PAIRS (300/360/840) is a
            # spring duration no plain CSS easing reproduces -- never OK here.
            if ok:
                continue
            key = (relpath, line)
            if key in ALLOWLIST:
                allowed_hits.add(key)
                continue
            paired = f' paired with "{easing}"' if easing else " with no easing named"
            findings.append(
                f"{relpath}:{line}: {segment.strip()!r} declares {ms}ms{paired} -- not a "
                f"token pairing from lib/mudavym/motion.ts, and not allow-listed"
            )
    return checked


# ── walking the scan roots ──────────────────────────────────────────────────


def _iter_files(rootdir: str, exts: tuple[str, ...]) -> list[str]:
    base = Path(ROOT, rootdir)
    if not base.is_dir():
        return []
    out = []
    for p in sorted(base.rglob("*")):
        if not p.is_file() or p.suffix not in exts:
            continue
        if SKIP_NAME_RE.search(p.name):
            continue
        out.append(str(p.relative_to(ROOT)))
    return out


def main() -> int:
    page_dirs, unresolved = resolve_page_dirs()
    if unresolved:
        print("CANNOT CHECK -- the following MUDAVYM_PAGES slugs did not resolve to a")
        print("directory by reading App.tsx's own routing (never guessed):")
        for slug in unresolved:
            print(f"  - {slug}")
        print(
            "A guard that cannot resolve a page is not a guard that skips it -- "
            "exit 2, per ADR 0134 §10."
        )
        return 2

    scan_roots = {f"{WEB_SRC}/components/mudavym", f"{WEB_SRC}/components/layout"}
    scan_roots.update(page_dirs.values())

    findings: list[str] = []
    allowed_hits: set[tuple[str, int]] = set()
    ts_checked = 0
    css_checked = 0
    ts_files = 0
    css_files = 0
    for root in sorted(scan_roots):
        for f in _iter_files(root, (".ts", ".tsx")):
            ts_files += 1
            ts_checked += check_ts_file(f, findings, allowed_hits)
        for f in _iter_files(root, (".css",)):
            css_files += 1
            css_checked += check_css_file(f, findings, allowed_hits)

    if findings:
        print(f"FAIL -- {len(findings)} motion literal(s) outside the token set:")
        for line in findings:
            print(f"  {line}")
        return 1

    unused = sorted(set(ALLOWLIST) - allowed_hits)
    if unused:
        print(
            "FAIL -- the allow-list carries a line this run never hit, which is how an "
            "allow-list rots into cover for a DIFFERENT, later defect:"
        )
        for f, ln in unused:
            print(f"  {f}:{ln}")
        return 1

    print(
        f"PASS -- {len(page_dirs)} MUDAVYM_PAGES slugs resolved, {ts_files} .ts/.tsx + "
        f"{css_files} .css files scanned, {ts_checked} animate() calls + {css_checked} CSS "
        f"declarations checked, {len(allowed_hits)} disclosed exception(s) hit and none unused"
    )
    return 0


# ── mutation self-test — proves the guard actually catches what it claims ──


def self_test() -> int:
    global ROOT, ALLOWLIST
    real_root, real_allowlist = ROOT, ALLOWLIST
    failures: list[str] = []

    def run() -> tuple[int, str]:
        buf = io.StringIO()
        real_stdout, sys.stdout = sys.stdout, buf
        try:
            code = main()
        finally:
            sys.stdout = real_stdout
        return code, buf.getvalue()

    def write(d: str, rel: str, content: str) -> None:
        p = Path(d, rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")

    def base_fixture(d: str) -> None:
        write(
            d,
            USE_MUDAVYM_DESIGN,
            "export const MUDAVYM_PAGES = [\n  'dashboard',\n  'inventory',\n] as const;\n",
        )
        write(
            d,
            APP_TSX,
            "const DashboardNext = lazyWithRefresh(() => import('./pages/dashboard/next/DashboardNext'))\n"
            "import { InventoryCommandPage } from './pages/inventory/command/InventoryCommandPage'\n"
            '<Route path="/" element={<PageGate page="dashboard" legacy={<Dashboard />} next={<DashboardNext />} />} />\n'
            '<Route path="/inventory" element={<PageGate page="inventory" legacy={<InventoryCommandPage />} next={<InventoryCommandPage />} />} />\n',
        )
        write(
            d,
            f"{WEB_SRC}/components/mudavym/Clean.tsx",
            "animate(el, KF, settle);\nanimate(el, KF, TOKEN[shape]);\n",
        )
        write(d, f"{WEB_SRC}/pages/dashboard/next/DashboardNext.tsx", "animate(el, KF, settle);\n")
        write(
            d,
            f"{WEB_SRC}/pages/inventory/command/InventoryCommandPage.tsx",
            "animate(el, KF, ink);\n",
        )
        write(
            d,
            f"{WEB_SRC}/components/mudavym/clean.css",
            ".x { transition: border-color 160ms cubic-bezier(0.16, 1, 0.3, 1); }\n"
            ".y { animation: none; }\n",
        )
        write(d, f"{WEB_SRC}/components/layout/Sidebar.tsx", "// no house animate() calls here\n")

    # 1. A clean tree passes.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        code, out = run()
        if code != 0:
            failures.append(f"a clean fixture tree exited {code}, not 0 -- output:\n{out}")

    # 2. The rule-1 literal, exactly as it shipped pre-fix, fails and names
    #    the file:line.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            f"{WEB_SRC}/pages/dashboard/next/DashboardNext.tsx",
            "animate(\n  el,\n  KF,\n  { easing: settle.easing, ms: 420 },\n);\n",
        )
        code, out = run()
        if code != 1:
            failures.append(f"the rule-1 literal exited {code}, not 1 -- output:\n{out}")
        elif "DashboardNext.tsx:4" not in out:
            failures.append(f"the rule-1 literal was not named by file:line -- output:\n{out}")

    # 3. `/inventory` is genuinely seen: a literal planted in its OWN
    #    resolved directory (pages/inventory/command, NOT pages/*/next) is
    #    caught. A guard hard-coded to `pages/*/next` would miss this file
    #    entirely and silently PASS.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            f"{WEB_SRC}/pages/inventory/command/InventoryCommandPage.tsx",
            "animate(el, KF, { easing: ink.easing, ms: 999 });\n",
        )
        code, out = run()
        if code != 1:
            failures.append(f"an /inventory literal exited {code}, not 1 (guard cannot see the page) -- output:\n{out}")
        elif "pages/inventory/command/InventoryCommandPage.tsx:1" not in out:
            failures.append(f"the /inventory literal was not named -- output:\n{out}")

    # 4. `components/layout/` is genuinely scanned: a literal planted in
    #    Sidebar.tsx, which lives in neither `pages/` nor `next/`, is caught.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(d, f"{WEB_SRC}/components/layout/Sidebar.tsx", "animate(el, KF, { ms: 150 });\n")
        code, out = run()
        if code != 1:
            failures.append(f"a Sidebar.tsx literal exited {code}, not 1 (layout/ not scanned) -- output:\n{out}")
        elif "Sidebar.tsx:1" not in out:
            failures.append(f"the Sidebar.tsx literal was not named -- output:\n{out}")

    # 5. A CSS duration outside the seven tokens (the two shimmer sheens'
    #    shape, 1.9s) fails.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            f"{WEB_SRC}/components/mudavym/clean.css",
            ".sheen { animation: dn-sheen 1.9s cubic-bezier(0.45, 0, 0.55, 1) infinite; }\n",
        )
        code, out = run()
        if code != 1:
            failures.append(f"a 1.9s CSS animation exited {code}, not 1 -- output:\n{out}")

    # 6. The SAME duration, allow-listed by its exact file:line, passes --
    #    and citing the WRONG line for it still fails, proving the allow-list
    #    is read by exact location, not by file alone.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        css_rel = f"{WEB_SRC}/components/mudavym/clean.css"
        write(
            d,
            css_rel,
            ".x { transition: border-color 160ms cubic-bezier(0.16, 1, 0.3, 1); }\n"
            ".sheen { animation: dn-sheen 1.9s cubic-bezier(0.45, 0, 0.55, 1) infinite; }\n",
        )
        ALLOWLIST = {(css_rel, 1): "wrong line on purpose"}
        code, _ = run()
        if code != 1:
            failures.append("allow-listing the WRONG line let a real defect pass")
        ALLOWLIST = {(css_rel, 2): "ADR 0134 rule 11 -- test fixture"}
        code, out = run()
        if code != 0:
            failures.append(f"allow-listing the CORRECT file:line still failed -- output:\n{out}")

    # 7. A CSS declaration that pairs a KNOWN token duration with a FOREIGN
    #    easing (the exact shape of the real rule-1 defect, in CSS form)
    #    fails even though the duration alone is one of the seven.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            f"{WEB_SRC}/components/mudavym/clean.css",
            ".x { transition: opacity 320ms ease-in-out; }\n",
        )
        code, out = run()
        if code != 1:
            failures.append(
                f"a 320ms transition on a non-house easing exited {code}, not 1 -- output:\n{out}"
            )

    # 8. An unresolvable MUDAVYM_PAGES slug is CANNOT CHECK (exit 2), never a
    #    silent pass.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            USE_MUDAVYM_DESIGN,
            "export const MUDAVYM_PAGES = [\n  'dashboard',\n  'ghost_page',\n] as const;\n",
        )
        code, out = run()
        if code != 2:
            failures.append(f"an unresolvable slug exited {code}, not 2 -- output:\n{out}")
        elif "ghost_page" not in out:
            failures.append(f"the unresolved slug was not named -- output:\n{out}")

    # 9. An allow-list entry that no scanned line ever hits fails the run --
    #    an allow-list is exception cover for what actually exists, not a
    #    standing waiver that outlives its own defect.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        ALLOWLIST = {
            (f"{WEB_SRC}/components/mudavym/Clean.tsx", 999): "cites nothing real"
        }
        code, out = run()
        if code != 1:
            failures.append(f"an unused allow-list entry exited {code}, not 1 -- output:\n{out}")

    # 10. A comment directly above a real, correct token argument (the house
    #     style at every rule-1 call site this guard exists to keep fixed)
    #     is not mistaken for part of the argument, and does not itself
    #     manufacture a finding.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            f"{WEB_SRC}/pages/dashboard/next/DashboardNext.tsx",
            "animate(\n  el,\n  KF,\n  // ADR 0134 rule 1: folded into settle.\n  settle,\n);\n",
        )
        code, out = run()
        if code != 0:
            failures.append(f"a comment-preceded, correct token FAILed -- output:\n{out}")

    # 11. A CSS custom-property fallback with a NESTED cubic-bezier — the
    #     exact shape at `reports-next.css:76`, `var(--rp-tuck, 300ms
    #     cubic-bezier(...))` — is not checked (the token drives the real
    #     value at runtime); a plain, non-fallback 300ms transition right
    #     beside it still fails, proving the exclusion is `var(...)`-scoped,
    #     not a blanket pass for 300ms.
    with tempfile.TemporaryDirectory() as d:
        ROOT = d
        ALLOWLIST = {}
        base_fixture(d)
        write(
            d,
            f"{WEB_SRC}/components/mudavym/clean.css",
            ".x { transition: box-shadow var(--rp-tuck, 300ms cubic-bezier(0.16, 1, 0.3, 1)); }\n"
            ".y { transition: box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1); }\n",
        )
        code, out = run()
        if code != 1:
            failures.append(f"a bare (non-var) 300ms/HOUSE pairing beside a var() fallback exited {code}, not 1 -- output:\n{out}")
        elif "clean.css:1" in out:
            failures.append(f"the var()-fallback line was flagged; it should be excluded -- output:\n{out}")
        elif "clean.css:2" not in out:
            failures.append(f"the bare 300ms line was not the one named -- output:\n{out}")

    ROOT, ALLOWLIST = real_root, real_allowlist

    print("== --self-test: 11 invariants")
    if failures:
        for f in failures:
            print(f"   FAIL — {f}")
        return 1
    print("   a clean fixture tree PASSes")
    print("   the shipped rule-1 literal FAILs, named by file:line")
    print("   /inventory (pages/inventory/command, not pages/*/next) is genuinely scanned")
    print("   components/layout/ (Sidebar.tsx) is genuinely scanned")
    print("   a CSS duration outside the seven tokens FAILs (the shimmer sheens' shape)")
    print("   the allow-list is read by EXACT file:line, not by file alone")
    print("   a known duration paired with a foreign easing still FAILs")
    print("   an unresolvable MUDAVYM_PAGES slug is CANNOT CHECK (exit 2), never silent")
    print("   an allow-list entry nothing hits FAILs the run")
    print("   a comment directly above a correct token is not mistaken for the argument")
    print("   a var(...) fallback's nested cubic-bezier is excluded; a bare pairing beside it still FAILs")
    print("PASS")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="Every Mudavym motion is a named token, or a disclosed, cited exception."
    )
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove the detection invariants against synthetic fixture trees, then exit",
    )
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
