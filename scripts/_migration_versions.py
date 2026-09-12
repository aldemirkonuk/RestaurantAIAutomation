#!/usr/bin/env python3
"""Report Supabase migration files that share a version prefix.

Helper for scripts/check_decision_claims.sh.

WHY: `supabase_migrations.schema_migrations` keys on `version`, so two files
beginning `20260825120000_` make the second INSERT violate the primary key and
`supabase db reset` dies partway through. That happened on 2026-08-25 —
`api_spend_cost_usd_nullable` and `pos_sale_volume_contract`, written by two
sessions the same day — and the failure surfaced as `Fresh database equals
remote`, a message that says *drift* when the truth was a duplicate key. It cost
a full CI cycle to read.

Same failure class as the OD-id collisions: two sessions each pick "a number
that looks free" off the same trunk, and git merges both in silence because the
text after the version differs.

Exit 2 if the directory is missing or holds no migrations — a check that cannot
check must not report success.
"""

import collections
import os
import re
import sys

VERSIONED = re.compile(r"^(\d{14})_.+\.sql$")


def main() -> int:
    d = sys.argv[1] if len(sys.argv) > 1 else "supabase/migrations"
    if not os.path.isdir(d):
        print(f"{d} is not a directory", file=sys.stderr)
        return 2

    by_version = collections.defaultdict(list)
    for name in sorted(os.listdir(d)):
        m = VERSIONED.match(name)
        if m:
            by_version[m.group(1)].append(name)

    if not by_version:
        print(f"{d} contains no versioned migrations", file=sys.stderr)
        return 2

    for version, names in sorted(by_version.items()):
        if len(names) > 1:
            print(f"{version} is used by {len(names)} migrations: {', '.join(names)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
