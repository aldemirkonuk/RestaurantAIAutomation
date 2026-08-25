#!/usr/bin/env python3
"""Report OD ids that appear twice within the SAME section of the register.

Helper for scripts/check_decision_claims.sh. Kept as its own file rather than a
heredoc because the shell quoting around a nested python -c is exactly the sort
of thing that breaks silently and turns a guard into a no-op.

Appearing once in Open and once in Resolved is legitimate — OD-25 records a
partial agreement in Resolved and the remainder in Open. Twice in one section is
always a collision.

Exit 2 if the register cannot be read or has no sections: a check that cannot
check must not report success.
"""

import collections
import re
import sys

ROW = re.compile(r"^\| (OD-\d+) \|", re.M)


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else ".planning/decisions/OPEN-DECISIONS.md"
    try:
        txt = open(path, encoding="utf-8").read()
    except OSError as e:
        print(f"cannot read {path}: {e}", file=sys.stderr)
        return 2

    try:
        open_i, res_i = txt.index("## Open"), txt.index("## Resolved")
    except ValueError:
        print(f"{path} has no '## Open' / '## Resolved' sections", file=sys.stderr)
        return 2

    for name, seg in (("Open", txt[open_i:res_i]), ("Resolved", txt[res_i:])):
        counts = collections.Counter(m.group(1) for m in ROW.finditer(seg))
        for oid, n in sorted(counts.items()):
            if n > 1:
                print(f"{oid} appears {n}x in the {name} section")
    return 0


if __name__ == "__main__":
    sys.exit(main())
