#!/usr/bin/env python3
"""Claim ADR-0177-PROMOTION-READS-HOUSE-SCOPED: every vendor-promotion read under
/providers answers only for the caller's house (ADR 0177, v3.0-TECH-DEBT 44.1w).

Static and source-only, so it runs in the claims CI job with no node_modules. It
checks the SHAPE; the behaviour is proved by
apps/api-gateway/src/providers/promotions-reads-belong-to-the-callers-house.spec.ts.

Run from the repo root. Exit 0 = the shape holds, 1 = it does not (each failed
check is printed), 2 = a file it reads is missing, so nothing was checked.
"""
import pathlib
import re
import sys

P = "apps/api-gateway/src/providers/"
CONTROLLER = P + "provider-intelligence.controller.ts"
SERVICE = P + "provider-intelligence.service.ts"
SPEC = P + "promotions-reads-belong-to-the-callers-house.spec.ts"

# The six methods that read provider_promotions (directly, or for a count).
METHODS = (
    "getPromotions",
    "getAllActivePromotions",
    "getExpiringPromotions",
    "getPromoSavings",
    "comparePromotions",
    "compareProviders",
)
SCOPE = '.eq("restaurant_id", restaurantId)'


def source(path: str) -> str:
    """The file with comments stripped and whitespace collapsed to single spaces."""
    p = pathlib.Path(path)
    if not p.is_file():
        print(f"cannot check: {path} is missing")
        sys.exit(2)
    text = re.sub(r"/[*].*?[*]/", "", p.read_text(), flags=re.S)
    text = re.sub(r"(?m)^[ \t]*//.*", "", text)
    return " ".join(text.split())


def body(text: str, method: str) -> str:
    """From `async <method>(` to the next method."""
    i = text.find("async " + method + "(")
    if i < 0:
        return ""
    j = text.find(" async ", i + 5)
    return text[i : j if j > 0 else len(text)]


def every_read_is_scoped(text: str, table: str) -> bool:
    """Every `.from("<table>")` is `.select(...)` and then the house filter."""
    read = '.from("' + table + '")'
    lead = read + " .select("
    total = text.count(read)
    scoped = 0
    i = text.find(lead)
    while i >= 0:
        depth = 0
        for k in range(text.index("(", i + len(lead) - 1), len(text)):
            if text[k] == "(":
                depth += 1
            elif text[k] == ")":
                depth -= 1
                if depth == 0:
                    break
        scoped += text[k + 1 :].lstrip().startswith(SCOPE)
        i = text.find(lead, i + 5)
    return total > 0 and total == scoped


ctl = source(CONTROLLER)
svc = source(SERVICE)
house_fn = ctl[ctl.index("function houseOf(") :][:250] if "function houseOf(" in ctl else ""
require_fn = (
    svc[svc.index("private requireHouse(") :][:200]
    if "private requireHouse(" in svc
    else ""
)

checks = {
    "controller class is behind JwtAuthGuard": "@UseGuards(JwtAuthGuard)" in ctl,
    "houseOf refuses a session naming no house with a 403": (
        "if (!user?.restaurantId)" in house_fn
        and "throw new ForbiddenException" in house_fn
    ),
    "requireHouse throws when no house is passed": (
        "if (!restaurantId)" in require_fn and "throw new Error(" in require_fn
    ),
    "the spec that proves the behaviour exists": pathlib.Path(SPEC).is_file(),
    "every provider_promotions read is filtered by house right after select": (
        every_read_is_scoped(svc, "provider_promotions")
    ),
    "compareProviders' providers read is filtered by house right after select": (
        every_read_is_scoped(body(svc, "compareProviders"), "providers")
    ),
}
for m in METHODS:
    c, s = body(ctl, m), body(svc, m)
    checks[f"controller {m} resolves the house with houseOf(user) before its try"] = (
        "houseOf(user)" in c
        and c.count("restaurantId") >= 2
        and c.find("houseOf(user)") < c.find("try {")
    )
    checks[f"service {m} calls requireHouse(restaurantId)"] = (
        "this.requireHouse(restaurantId)" in s
    )

failed = [name for name, ok in checks.items() if not ok]
for name in failed:
    print("FAIL:", name)
sys.exit(1 if failed else 0)
