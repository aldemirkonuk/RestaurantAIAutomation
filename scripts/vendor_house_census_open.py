#!/usr/bin/env python3
"""Has any UNSCOPED site from the 2026-10-08 vendor-house census gained its fence?

The census (ADR 0221 rule: a vendor row is one house's) found 17 gateway
routes UNSCOPED at origin/main 87dafc064. PR-1 (`fix/inbound-mail-vendor-house`)
fixed the inbound bridge path that two of them share (census E #17 Gmail push,
E #44 inbound-email webhook). This script watches the other 15, each by a
STATIC reading of the source (no node_modules; CLAIMS verifies run without
them).

Exit codes, for the open CLAIMS row in
`.planning/decisions/claims.d/fix-inbound-mail-vendor-house.jsonl`:
  0  at least one watched site is fenced or removed. The open row then fails
     the build, and the PR that fenced it must restate the row (drop that site
     here and in the row's text) or mark it resolved when none is left.
  1  every watched site is still unfenced (what "open" expects today).
  2  a watched file is missing, so this cannot check (stderr says which).

What it cannot see: a fence added somewhere other than the files named per
site below (a new guard elsewhere reads as still unfenced, which keeps the row
open: a false "still open", never a false "fixed").
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "apps", "api-gateway", "src")

ROUTE_DECORATOR = re.compile(r"^\s*@(Get|Post|Put|Patch|Delete)\(")
HOUSE_EQ = re.compile(r"""\.eq\(\s*["'](?:\w+\.)?restaurant_id["']""")
FENCE_CALL = re.compile(r"\bawait\s+assertProviderBelongsToRestaurant\(")


def read(rel: str) -> str:
    path = os.path.join(SRC, rel)
    if not os.path.isfile(path):
        print(f"cannot open: No such file or directory: {path}", file=sys.stderr)
        sys.exit(2)
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def handler_region(text: str, route_literal: str) -> str | None:
    """Lines from the decorator block above `route_literal` to the next route
    decorator. None when the route is gone (removed counts as fenced)."""
    lines = text.splitlines()
    idx = next((i for i, ln in enumerate(lines) if route_literal in ln), None)
    if idx is None:
        return None
    start = idx
    while start > 0 and not lines[start - 1].startswith("  }"):
        start -= 1
    end = next(
        (j for j in range(idx + 1, len(lines)) if ROUTE_DECORATOR.match(lines[j])),
        len(lines),
    )
    return "\n".join(lines[start:end])


def route_fenced(rel: str, route_literal: str) -> bool:
    region = handler_region(read(rel), route_literal)
    if region is None:
        return True
    return bool(HOUSE_EQ.search(region)) or "@Roles(" in region


def any_calls_fence(rels: list[str]) -> bool:
    return any(FENCE_CALL.search(read(r)) for r in rels)


# Measured at origin/main 87dafc064: four house filters in contacts.service.ts
# (:73 list, :240 update, :262 remove, :338 removeAddress). A fifth means a
# read or write the census flagged gained one.
CONTACTS_HOUSE_FILTERS_AT_CENSUS = 4


def contacts_fenced() -> bool:
    path = os.path.join(SRC, "contacts", "contacts.service.ts")
    if not os.path.isfile(path):
        return True  # module deleted (census PR-5's other branch)
    return len(HOUSE_EQ.findall(read("contacts/contacts.service.ts"))) > (
        CONTACTS_HOUSE_FILTERS_AT_CENSUS
    )


SITES = [
    # census D #1, #2: documents intake stores body providerId unfenced.
    (
        "D1-D2 POST /procurement/documents, /documents/door-count",
        lambda: any_calls_fence(
            [
                "procurement/documents/documents.controller.ts",
                "procurement/documents/document-intake.service.ts",
            ]
        ),
    ),
    # census D #3: deliveries store body providerId unfenced.
    (
        "D3 POST /procurement/deliveries",
        lambda: any_calls_fence(
            [
                "procurement/deliveries.controller.ts",
                "procurement/canonical/delivery.service.ts",
            ]
        ),
    ),
    # census E #18: force-fetch has no @Roles (any member of any house).
    (
        "E18 POST /communications/webhooks/gmail/force-fetch",
        lambda: route_fenced(
            "communications/communications.controller.ts",
            '"/webhooks/gmail/force-fetch"',
        ),
    ),
    # census E #20-22: non-production test routes, unscoped by id.
    (
        "E20 POST /communications/test/e2e/step3-send-vendor-email",
        lambda: route_fenced(
            "communications/communications.controller.ts",
            '"test/e2e/step3-send-vendor-email"',
        ),
    ),
    (
        "E21 GET /communications/test/e2e/step4-check-inbound",
        lambda: route_fenced(
            "communications/communications.controller.ts",
            '"test/e2e/step4-check-inbound"',
        ),
    ),
    (
        "E22 GET /communications/test/e2e/step6-check-status",
        lambda: route_fenced(
            "communications/communications.controller.ts",
            '"test/e2e/step6-check-status"',
        ),
    ),
    # census F #7: site-sweep status returns the process-wide lastRun.
    (
        "F7 GET /vendor-intel/site-sweep/status",
        lambda: "lastRun: this.lastRun,"
        not in read("vendor-intel/vendor-site-sweep.service.ts"),
    ),
    # census G #14: invoice-confirmed producer reads NULL-house vendors.
    (
        "G14 invoice-confirmed producer -> GET /notifications",
        lambda: "restaurant_id.is.null"
        not in read("notifications/producers/invoice-confirmed.producer.ts"),
    ),
    # census G #18-23: contacts routes (unmounted) with no house filter.
    ("G18-G23 /contacts routes", contacts_fenced),
]


def main() -> int:
    fenced = []
    for name, check in SITES:
        state = check()
        print(f"{'FENCED ' if state else 'OPEN   '} {name}")
        if state:
            fenced.append(name)
    if fenced:
        print(f"{len(fenced)} watched site(s) fenced: restate the CLAIMS row.")
        return 0
    print("every watched site is still unfenced")
    return 1


if __name__ == "__main__":
    sys.exit(main())
