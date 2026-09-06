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
