#!/usr/bin/env python3
"""Every ACTIVE feature flag's readBy anchor must resolve to real gating code.

The registry (apps/api-gateway/src/settings/feature-flag-registry.ts) requires
each ACTIVE flag to cite file:line of the code that branches on it. Those
anchors are hand-maintained and every MUDAVYM_PAGES edit moves the line they
point at — the P3 wave re-pointed them four times by hand (Opus correctness
review, NIT: "no CI guard for the nine hand-maintained readBy anchors").

Solve-it-once rule: sweep + blocking guard. This guard exits 2 when it cannot
check (missing registry, unreadable file), 1 on a stale anchor, 0 when every
anchor's cited line actually contains a recognisable gate.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "apps/api-gateway/src/settings/feature-flag-registry.ts"
USE_MUDAVYM_DESIGN = ROOT / "apps/web/src/lib/mudavym/useMudavymDesign.ts"

# What counts as "code that branches on a flag" at the cited line. Keyed by
# anchor file so new families state their expectation explicitly.
GATE_PATTERNS = [
    (re.compile(r"useMudavymDesign\.ts$"), re.compile(r"checkFeatureFlag")),
    (re.compile(r"inbound-responder\.service\.ts$"), re.compile(r"enable_ai_")),
    # The house-inbox reader's own gate. `isEnabled` delegates to
    # `inbox/house-inbox-flag.ts`, which is where the fails-closed read lives;
    # the BRANCH is here, and a branch is what this guard is about.
    (
        re.compile(r"house-inbox\.service\.ts$"),
        re.compile(r"isEnabled|enable_house_inbox_read"),
    ),
]


def fail_cannot_check(msg: str) -> None:
    print(f"CANNOT CHECK -- {msg}")
    sys.exit(2)


def extract_string_array(src: str, const_name: str) -> list[str]:
    """Pull the quoted strings out of `export const <const_name>: ... = [ ... ];`.

    Anchored on `export const <const_name>` — not a bare mention of the name —
    because both files discuss `LIVE_PAGES` in prose before they declare it,
    and an earlier match would run `[^\\[]*` straight through to the FIRST
    unrelated `[` it finds (e.g. `MUDAVYM_PAGES = [...]`, which sits between
    the prose and the real `LIVE_PAGES` declaration and itself holds a
    double-quoted phrase inside a comment) rather than the real array.

    Used for `LIVE_PAGES` (a single-quoted `Set` literal) and
    `LIVE_IN_CODE_FLAGS` (a double-quoted array literal), so both quote styles
    are accepted.
    """
    m = re.search(r"export const " + re.escape(const_name) + r"[^\[]*\[([\s\S]*?)\]\s*\)?\s*;", src)
    if not m:
        fail_cannot_check(f"{const_name} declaration not found (registry/useMudavymDesign shape changed?)")
    return re.findall(r"['\"]([^'\"]+)['\"]", m.group(1))


def check_live_pages_agree(active_keys: set[str]) -> list[str]:
    """LIVE_PAGES (useMudavymDesign.ts) and LIVE_IN_CODE_FLAGS (the registry)
    must name exactly the same set of pages, and neither may also be ACTIVE —
    the exact disagreement live-review.md 2026-09-17 defect 2 found a green
    guard could not see (it only text-matched the cited line, never asking
    whether the line was reachable for that key).
    """
    if not USE_MUDAVYM_DESIGN.is_file():
        fail_cannot_check(f"{USE_MUDAVYM_DESIGN} not found")
    web_src = USE_MUDAVYM_DESIGN.read_text(encoding="utf-8")
    live_pages = extract_string_array(web_src, "LIVE_PAGES")
    if not live_pages:
        fail_cannot_check("LIVE_PAGES parsed to zero pages — extraction broken?")
    live_flag_keys = {f"mudavym_design_{p}" for p in live_pages}

    registry_src = REGISTRY.read_text(encoding="utf-8")
    live_in_code = set(extract_string_array(registry_src, "LIVE_IN_CODE_FLAGS"))

    bad: list[str] = []
    still_active = sorted(live_flag_keys & active_keys)
    if still_active:
        bad.append(
            "LIVE_PAGES key(s) still declared ACTIVE in the registry (the flag "
            f"would be offered as a live switch that changes nothing): {', '.join(still_active)}"
        )
    missing_from_registry = sorted(live_flag_keys - live_in_code)
    if missing_from_registry:
        bad.append(
            "LIVE_PAGES page(s) with no LIVE_IN_CODE_FLAGS entry: "
            f"{', '.join(missing_from_registry)}"
        )
    extra_in_registry = sorted(live_in_code - live_flag_keys)
    if extra_in_registry:
        bad.append(
            "LIVE_IN_CODE_FLAGS key(s) not in LIVE_PAGES (stale — page was "
            f"pulled back behind a flag but the registry wasn't updated): {', '.join(extra_in_registry)}"
        )
    return bad


def main() -> None:
    if not REGISTRY.is_file():
        fail_cannot_check(f"registry not found at {REGISTRY}")
    src = REGISTRY.read_text(encoding="utf-8")
    active = src.split("INACTIVE_FEATURE_FLAGS")[0]

    entries = re.findall(
        r'key:\s*"([^"]+)"[\s\S]*?readBy:\s*"([^"]+)"', active
    )
    if not entries:
        fail_cannot_check("no ACTIVE entries with readBy found — registry shape changed?")

    bad: list[str] = []
    bad.extend(check_live_pages_agree({key for key, _ in entries}))
    for key, read_by in entries:
        # "path:line" or "path:line1,line2,..."
        m = re.match(r"^(.*):(\d+(?:,\d+)*)$", read_by)
        if not m:
            bad.append(f"{key}: readBy '{read_by}' is not path:line")
            continue
        rel, lines = m.group(1), [int(n) for n in m.group(2).split(",")]
        target = ROOT / ("apps/api-gateway/src/" + rel if not rel.startswith("apps/") else rel)
        if not target.is_file():
            fail_cannot_check(f"{key}: anchor file {target} not found")
        content = target.read_text(encoding="utf-8").splitlines()
        pattern = next(
            (p for f, p in GATE_PATTERNS if f.search(str(target))), None
        )
        if pattern is None:
            fail_cannot_check(
                f"{key}: no gate pattern registered for {target.name} — add one to GATE_PATTERNS"
            )
        for line_no in lines:
            if line_no < 1 or line_no > len(content):
                bad.append(f"{key}: {rel}:{line_no} is past EOF ({len(content)} lines)")
            elif not pattern.search(content[line_no - 1]):
                bad.append(
                    f"{key}: {rel}:{line_no} does not contain the expected gate "
                    f"(line reads: {content[line_no - 1].strip()[:80]!r})"
                )

    if bad:
        print(f"FAIL -- {len(bad)} stale readBy anchor(s):")
        for b in bad:
            print(f"  - {b}")
        sys.exit(1)

    print(f"PASS -- {len(entries)} ACTIVE flag anchors all resolve to real gates.")


if __name__ == "__main__":
    main()
