#!/usr/bin/env python3
"""Mirror LIVE-CHECKLIST.md's 'Isolated-mount sweep — wave 5' table into JSON,
so the summary survives even though the harness that produced it does not.

Added 2026-09-19 (wave5/live-confirm.md B3, CLAUDE.md §5b): the table's own
method note used to point at "this PR's session transcript" for re-checking
its per-page results, which is not a location anyone can re-open later. The
underlying harness (apps/web/sweep.html, apps/web/src/__sweep__/) was
deleted after use, so the granular per-element measurements behind each
cell are not recoverable — this script does not try to reconstruct those.
It only mirrors the summary table mechanically (never retypes it), so the
table and the JSON cannot drift silently the way the transcript claim did.

Usage:
    python3 scripts/extract_wave5_sweep.py \
        [.planning/06-pages/LIVE-CHECKLIST.md] \
        [.planning/06-pages/live-checklist-wave5-sweep.json]

Both arguments are optional and default to the paths above. Re-run after
editing the table; do not hand-edit the JSON output.
"""
import json
import sys

DEFAULT_SRC = ".planning/06-pages/LIVE-CHECKLIST.md"
DEFAULT_OUT = ".planning/06-pages/live-checklist-wave5-sweep.json"


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    out = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT

    text = open(src, encoding="utf-8").read()
    lines = text.splitlines()

    start = next(i for i, l in enumerate(lines) if l.startswith("| Route | h1 legible |"))
    header = [c.strip() for c in lines[start].strip("|").split("|")]
    rows = []
    i = start + 2  # skip header + separator row
    while i < len(lines) and lines[i].startswith("|"):
        cells = [c.strip() for c in lines[i].strip("|").split("|")]
        if len(cells) == len(header):
            rows.append(dict(zip(header, cells)))
        i += 1

    payload = {
        "source": "LIVE-CHECKLIST.md, section 'Isolated-mount sweep — wave 5 (2026-09-18)'",
        "generated_by": "scripts/extract_wave5_sweep.py against the checked-in table -- regenerate, do not hand-edit",
        "note": (
            "Mirrors the summary table only. The underlying harness "
            "(apps/web/sweep.html, apps/web/src/__sweep__/) was deleted "
            "after use; per-element measurements behind these cells are "
            "not recoverable (corrected 2026-09-19, CLAUDE.md §5b)."
        ),
        "rows": rows,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
