"""Export the scenario table as a fixture the TypeScript engine can be tested against.

The problem this solves: the scenario table lives in Python (`errors.py`) and the
match engine lives in TypeScript (`apps/api-gateway/src/procurement/invoice-match.ts`).
Nothing in the build system connects them, so the expectations could drift from
the engine — or from each other — with nothing failing.

The bridge is a generated JSON fixture, committed, plus a staleness check:

    python3 -m scripts.docgen backtest            # regenerate the fixture
    python3 -m scripts.docgen backtest --check    # fail if committed file is stale

`invoice-match.backtest.spec.ts` loads the fixture and asserts the engine returns
what each scenario intends. Two rules make this honest rather than decorative:

1. **The fixture is generated, never hand-edited.** `--check` compares a content
   hash of the rows, so editing the JSON to make a test pass fails the check
   instead. Run it in CI alongside the Jest suite.
2. **A known failure is asserted, not skipped.** Where the engine currently
   disagrees with the intended verdict, the fixture carries both, and the spec
   asserts the engine returns the *known-failing* value. That means fixing the
   bug BREAKS the test — loudly, on purpose — forcing the fixture to be
   regenerated and the intent to be re-affirmed. A skipped test would let the fix
   land silently and the next regression go unnoticed.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from scripts.docgen.errors import SCENARIOS

FIXTURE_VERSION = "1.0.0"

FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "scenario-expectations.json"
)

#: Three quantity/price profiles per scenario. Chosen to exercise the integer
#: arithmetic at different magnitudes: a standard two-case order, a large
#: by-the-glass order where a 10% free-goods deal is 12 bottles, and a six-pack
#: of something expensive where every rounding error is visible in dollars.
PROFILES: tuple[tuple[int, float], ...] = (
    (24, 22.0),
    (120, 14.5),
    (6, 78.0),
)

#: Must equal MatchVerdict in invoice-match.ts. A verdict here with no scenario
#: producing it is a verdict nothing exercises.
ALL_VERDICTS: frozenset[str] = frozenset(
    {
        "matched",
        "overbilled_vs_ship",
        "price_variance",
        "qty_over",
        "qty_short",
        "short_shipped",
        "rejected",
        "partial",
        "unmatched",
    }
)


def build_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for scenario in SCENARIOS:
        for ordered, price in PROFILES:
            outcome = scenario.build(ordered, price)
            row = {
                "scenario": scenario.key,
                "label": scenario.label,
                "story": scenario.story,
                "profile": {"ordered": ordered, "price": price},
                # The exact MatchInput the engine should be called with. Named to
                # match invoice-match.ts's field names so the spec is a direct
                # pass-through with no translation layer to get wrong.
                "input": {
                    "orderedQty": outcome.ordered_qty,
                    "poUnitPrice": outcome.po_unit_price,
                    "shippedQty": outcome.shipped_qty,
                    "invoiceQty": outcome.invoice_qty,
                    "invoiceUnitPrice": outcome.invoice_unit_price,
                    "acceptedQty": outcome.accepted_qty,
                    "rejectedQty": outcome.rejected_qty,
                    "freeGoodsQty": outcome.free_goods_qty,
                    "allocatedCharges": outcome.allocated_charges,
                    "priceOverrideReason": outcome.price_override_reason,
                    # The delivery path stocks optimistically at invoice
                    # quantity before anyone counts; the tests pin it to what was
                    # accepted so ledgerDelta is deterministic.
                    "stockedQty": outcome.accepted_qty,
                },
                "expect": {
                    "verdict": outcome.expected_verdict,
                    "creditDue": outcome.expected_credit_due,
                    "lineMatch": outcome.expected_line_match,
                },
                "knownFailing": (
                    {
                        "verdict": outcome.known_failing_verdict,
                        "note": outcome.known_failing_note,
                    }
                    if outcome.known_failing_verdict
                    else None
                ),
            }
            rows.append(row)
    return rows


def content_hash(rows: list[dict[str, Any]]) -> str:
    """Hash the rows, not the file.

    Hashing file bytes would make a reworded comment or a reformat look like a
    changed expectation. Hashing the rows means the fixture is stale if and only
    if an actual input or expectation moved.
    """
    payload = json.dumps(rows, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_fixture() -> dict[str, Any]:
    rows = build_rows()
    verdicts = sorted({r["expect"]["verdict"] for r in rows})
    missing = sorted(ALL_VERDICTS - set(verdicts))
    if missing:
        raise SystemExit(
            "Refusing to write a fixture that does not exercise every verdict. "
            f"Missing: {missing}. Add a scenario to scripts/docgen/errors.py."
        )
    return {
        "fixture_version": FIXTURE_VERSION,
        "generated_by": "python3 -m scripts.docgen backtest",
        # Deliberately no timestamp: a generated-at field would make every
        # regeneration a diff and train everyone to ignore the diff.
        "source": "scripts/docgen/errors.py::SCENARIOS",
        "content_hash": content_hash(rows),
        "verdicts_covered": verdicts,
        "row_count": len(rows),
        "known_failing_count": sum(1 for r in rows if r["knownFailing"]),
        "rows": rows,
    }


def write_fixture(path: Path | None = None) -> Path:
    path = path or FIXTURE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(build_fixture(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def check_fixture(path: Path | None = None) -> list[str]:
    """Return a list of problems. Empty means the committed fixture is current."""
    path = path or FIXTURE_PATH
    if not path.exists():
        return [f"fixture missing: {path}"]

    try:
        committed = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        return [f"fixture is not valid JSON: {exc}"]

    expected = build_fixture()
    problems: list[str] = []

    if committed.get("fixture_version") != expected["fixture_version"]:
        problems.append(
            f"fixture_version {committed.get('fixture_version')!r} != "
            f"{expected['fixture_version']!r}"
        )
    if committed.get("content_hash") != expected["content_hash"]:
        problems.append(
            "content_hash differs — errors.py has changed since the fixture was "
            "generated. Run: python3 -m scripts.docgen backtest"
        )
    if committed.get("row_count") != expected["row_count"]:
        problems.append(
            f"row_count {committed.get('row_count')} != {expected['row_count']}"
        )

    # Catch a hand-edited fixture whose stored hash was updated to match its own
    # tampered rows: recompute from the committed rows and compare to expected.
    if isinstance(committed.get("rows"), list):
        recomputed = content_hash(committed["rows"])
        if recomputed != committed.get("content_hash"):
            problems.append(
                "content_hash does not match the fixture's own rows — the file "
                "was edited by hand. It is generated; do not edit it."
            )
    return problems
