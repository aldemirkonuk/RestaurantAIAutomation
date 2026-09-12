#!/usr/bin/env python3
"""ADR 0140 — the door outbox keeps the receipt and claims nothing it cannot prove.

Five successive designs gave the "strand" (a receipt given up on whose drop
record could not be written) a durable, screen-facing witness. Each fixed the
one before it and each shipped a defect: an inflated count, a silent alarm, an
unclearable alarm over a delivered receipt, an erased witness, and a fabricated
loss record. They are one defect — the outbox cannot durably record a fact whose
cause is that durable storage failed, on a layer that reports failed writes and
failed reads as success.

This asserts the shape that decision left behind. It EXITS NON-ZERO when it
cannot check: a guard that goes quiet when its subject disappears is the fault
it exists to catch.
"""
import os
import re
import sys

DOOR = "apps/web/src/lib/doorOutbox.ts"
DUR = "apps/web/src/lib/doorOutbox.durability.test.ts"
SCREENS = [
    "apps/web/src/pages/receiving/next/DoorNext.tsx",
    "apps/web/src/pages/receiving/DoorReceipt.tsx",
]

missing = [p for p in [DOOR, DUR] + SCREENS if not os.path.exists(p)]
if missing:
    sys.exit("CANNOT CHECK: missing " + ", ".join(missing))

door = open(DOOR, encoding="utf-8").read()
bad = []

# D2 — the module exposes no strand reader and keeps no module-level witness.
for pattern, why in [
    (r"export\s+(?:async\s+)?function\s+readStrandedDoorReceipts", "exports readStrandedDoorReceipts"),
    (r"export\s+interface\s+StrandedDoorReceipt", "exports StrandedDoorReceipt"),
    (r"^const\s+\w*[Ss]tranded\w*\s*=\s*new\s+(?:Set|Map)\b", "keeps a module-level strand ledger"),
]:
    if re.search(pattern, door, re.M):
        bad.append("doorOutbox.ts " + why)

# D4 — no screen carries a standing strand surface.
for screen in SCREENS:
    if "door:stranded" in open(screen, encoding="utf-8").read():
        bad.append(f"{screen} renders a door:stranded surface")

# The suite that proves the receipt survives must not mock the storage whose
# refusal is the condition under test. That mock is why 920 green tests once
# passed over an alarm that had gone silent.
dur = open(DUR, encoding="utf-8").read()
if re.search(r"vi\.mock\(\s*['\"]\./offline-storage['\"]", dur):
    bad.append("doorOutbox.durability.test.ts mocks ./offline-storage")
if "receivingApi" not in dur:
    bad.append("doorOutbox.durability.test.ts does not stub the network")

if bad:
    sys.exit("ADR-0140 violated: " + "; ".join(bad))
print("ADR-0140 holds")
