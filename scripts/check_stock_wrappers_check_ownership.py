#!/usr/bin/env python3
"""A gateway path that hands an inventory id to a stock-moving SQL wrapper checks
that the item belongs to the caller's house FIRST.

ADR 0141 said the cross-tenant stock write was closed "at both ends". The
adversarial pass on PR #361 found four live routes that still reached stock
through SQL wrappers deriving the house from the item itself and never passing
p_restaurant_id -- so neither database-side refusal ran. A PGlite probe on the
tree's own migrations took a foreign house's lots from 9 to 0.

Each of those paths now calls assertInventoryBelongsToRestaurant before its
RPC. This guard fails if the call disappears or moves after the RPC, because a
check that runs afterwards refuses the response after the stock has moved.
Comments are stripped before matching.

Exit 0 pass, 1 fail, 2 COULD NOT CHECK.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GW = os.path.join(ROOT, "apps", "api-gateway", "src")
PATHS = {
    os.path.join(GW, "inventory", "inventory.service.ts"): ["recordPour", "transferStock", "recordSpotCount"],
    os.path.join(GW, "inventory-ledger", "inventory-ledger.service.ts"): ["reconcileInventory", "createTransaction"],
}


def main():
    bad = []
    for path, methods in PATHS.items():
        if not os.path.isfile(path):
            print("CANNOT CHECK: %s is missing -- not a pass" % path)
            sys.exit(2)
        src = open(path, encoding="utf-8").read()
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
        for m in methods:
            i = src.find("async %s(" % m)
            if i < 0:
                print("CANNOT CHECK: %s no longer defines %s -- the guard no longer describes the tree" % (path, m))
                sys.exit(2)
            j = src.find("\n  async ", i + 1)
            body = src[i: j if j > 0 else len(src)]
            a, r = body.find("assertInventoryBelongsToRestaurant("), body.find(".rpc(")
            if r < 0:
                print("CANNOT CHECK: %s.%s makes no RPC -- the guard no longer describes the tree" % (os.path.basename(path), m))
                sys.exit(2)
            if a < 0 or a > r:
                bad.append("%s.%s: the ownership check is missing or runs after the RPC" % (os.path.basename(path), m))
    if bad:
        print("FAIL -- a stock path can move another house's stock (ADR 0141):")
        for b in bad:
            print("  -> " + b)
        sys.exit(1)
    print("PASS -- every stock path that takes an inventory id checks ownership before its RPC.")
    sys.exit(0)


if __name__ == "__main__":
    main()
