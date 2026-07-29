"""Discrepancy injection, keyed to the verdict the match engine should return.

The generator does not sprinkle random noise. It names the outcome it wants —
`overbilled_vs_ship`, `price_variance`, `qty_short` — and works backwards to the
four documents' quantities that produce it. A run is then checkable: extract the
documents, feed the numbers to `computeMatch`, and assert the verdict we asked
for came back.

Verdict precedence in `invoice-match.ts:283-291`, which every scenario below
must respect to land on its target:

    1. no invoice                              -> unmatched
    2. invoiceQty  >  shippedQty               -> overbilled_vs_ship
    3. price differs and no override reason    -> price_variance
    4. billableReceived >  invoiceQty          -> qty_over
    5. billableReceived <  invoiceQty          -> qty_short
    6. billableReceived <  shippedQty          -> short_shipped
    7. rejectedQty > 0                         -> rejected
    8. acceptedQty  <  orderedQty              -> partial
    9. otherwise                               -> matched

with `receivedQty = accepted + rejected` and
`billableReceived = max(0, receivedQty - freeGoods)`.

The two false-alarm scenarios matter as much as the real discrepancies. An
engine that reports a problem on a split case or an agreed bonus trains the
manager to ignore it, and `YC_WEDGE_PLAN.md` names that as the most common way
ops software dies. `SPLIT_CASE` and `FREE_GOODS_*` exist to fail the run when
that regresses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

# Every quantity below is in BOTTLE-EQUIVALENTS, matching the contract in
# invoice-match.ts. Case/bottle presentation is a rendering concern handled by
# the house template, never a quantity concern.


@dataclass(frozen=True)
class Outcome:
    """The four documents' numbers for a single line, plus what we expect back."""

    ordered_qty: int
    po_unit_price: float

    #: None means the house sent no packing slip. Must stay None all the way
    #: through — an inferred ship quantity is the "silence recorded as
    #: agreement" defect, on a new axis.
    shipped_qty: int | None

    #: None means the invoice has not arrived yet. Never defaults to the PO.
    invoice_qty: int | None
    invoice_unit_price: float | None

    accepted_qty: int
    rejected_qty: int
    free_goods_qty: int

    #: Freight / fuel / split-case dollars apportioned to this line.
    allocated_charges: float

    expected_verdict: str
    expected_credit_due: bool

    #: Set when the engine is known to disagree with `expected_verdict` today.
    #: The generator still emits the document; the eval reports it as a known
    #: failure rather than silently adopting the buggy answer as ground truth.
    known_failing_verdict: str | None = None
    known_failing_note: str = ""

    #: A second, independent axis: what `line-matcher.ts` should conclude.
    expected_line_match: str = "exact"

    rejection_reason: str | None = None
    price_override_reason: str | None = None


ScenarioFn = Callable[[int, float], Outcome]


@dataclass(frozen=True)
class Scenario:
    key: str
    label: str
    #: Plain sentence a human can check the rendered document against.
    story: str
    weight: int
    build: ScenarioFn
    #: True when the scenario needs a house that actually sends packing slips.
    requires_packing_slip: bool = False
    #: True when it needs a house that does NOT send one.
    requires_no_packing_slip: bool = False


# --------------------------------------------------------------------------
# The scenarios
# --------------------------------------------------------------------------


def _clean(ordered: int, price: float) -> Outcome:
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="matched",
        expected_credit_due=False,
    )


def _split_case(ordered: int, price: float) -> Outcome:
    # Ordered as cases, invoiced as loose bottles, counted as cases. In
    # bottle-equivalents everything is equal and the verdict must be `matched`.
    # The failure this guards against is comparing "2" to "24" and reporting a
    # 22-unit overage — normalizeUom's stated reason for existing.
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="matched",
        expected_credit_due=False,
    )


def _free_goods_no_slip(ordered: int, price: float) -> Outcome:
    # "11 for the price of 10" from a house that never sends a packing slip.
    # Billed for `ordered`, one extra bottle per ten physically arrives.
    free = max(1, ordered // 10)
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=None,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered + free,
        rejected_qty=0,
        free_goods_qty=free,
        allocated_charges=0.0,
        expected_verdict="matched",
        expected_credit_due=False,
    )


def _free_goods_with_slip(ordered: int, price: float) -> Outcome:
    # Same agreed deal, from a house that DOES send a packing slip. The slip
    # counts physical bottles on the truck, free ones included — which is what a
    # real packing slip does.
    #
    # KNOWN FAILING. `physical_vs_ship` compares `billableReceived` (free goods
    # netted out, a billing quantity) against `shippedQty` (a physical count),
    # so every free bottle reads as a bottle lost in transit and the engine
    # returns `short_shipped` with the summary "N lost between the warehouse and
    # the door." Verified against the live module. Tracked separately; the
    # dataset records the intended answer so the fix has something to pass.
    free = max(1, ordered // 10)
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered + free,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered + free,
        rejected_qty=0,
        free_goods_qty=free,
        allocated_charges=0.0,
        expected_verdict="matched",
        expected_credit_due=False,
        known_failing_verdict="short_shipped",
        known_failing_note=(
            "physical_vs_ship compares billableReceived (billing qty) to "
            "shippedQty (physical count); free goods read as transit loss"
        ),
    )


def _overbilled_vs_ship(ordered: int, price: float) -> Outcome:
    # Their own two documents disagree: the slip says 22 left the warehouse, the
    # invoice bills 24. Nothing on our side is being counted, so there is
    # nothing to argue about. The highest-confidence claim the system can make.
    short = max(2, ordered // 12)
    shipped = ordered - short
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=shipped,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=shipped,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="overbilled_vs_ship",
        expected_credit_due=True,
    )


def _price_creep(ordered: int, price: float) -> Outcome:
    # Silent price increase — no note, no call, just a different number on the
    # invoice. Structurally the biggest leak in a wine programme and invisible
    # without a system that remembers the agreed price.
    billed = round(price * 1.11 + 0.25, 2)
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=billed,
        accepted_qty=ordered,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="price_variance",
        expected_credit_due=False,
    )


def _short_shipped_honest(ordered: int, price: float) -> Outcome:
    # The slip says 24, only 22 arrived, and the vendor billed 22. They were
    # honest; the goods went missing between warehouse and door. A carrier
    # problem, not a billing problem — different remedy, different counterparty.
    lost = max(1, ordered // 12)
    arrived = ordered - lost
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=arrived,
        invoice_unit_price=price,
        accepted_qty=arrived,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="short_shipped",
        expected_credit_due=False,
    )


def _qty_short(ordered: int, price: float) -> Outcome:
    # Billed for the full order, fewer bottles arrived, slip agrees with the
    # invoice. Money is owed.
    missing = max(1, ordered // 8)
    arrived = ordered - missing
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=arrived,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="qty_short",
        expected_credit_due=True,
    )


def _qty_over(ordered: int, price: float) -> Outcome:
    # More arrived than was billed, and it is NOT an agreed deal — no free-goods
    # flag anywhere. Either a picking error in our favour or an invoice that has
    # not caught up. Worth surfacing, but it is not money owed to us.
    extra = max(1, ordered // 12)
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered + extra,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered + extra,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="qty_over",
        expected_credit_due=False,
    )


def _damaged(ordered: int, price: float) -> Outcome:
    # Everything shipped arrived; some of it arrived broken. Billed in full.
    broken = max(1, ordered // 12)
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered - broken,
        rejected_qty=broken,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="rejected",
        expected_credit_due=True,
        rejection_reason="Breakage in transit — cork saturated, label soaked",
    )


def _partial_backorder(ordered: int, price: float) -> Outcome:
    # Half the order shipped, the rest is allocated and follows. Billed only for
    # what shipped, so nobody is wrong — the order simply stays open.
    shipped = max(1, ordered // 2)
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=shipped,
        invoice_qty=shipped,
        invoice_unit_price=price,
        accepted_qty=shipped,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="partial",
        expected_credit_due=False,
    )


def _no_invoice_yet(ordered: int, price: float) -> Outcome:
    # Goods at the door, invoice follows by post or email days later — the
    # ordinary case, and the one the old code turned into a manufactured
    # `price_verified: true`. Must read `unmatched`: unknown, never agreement.
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=None,
        invoice_unit_price=None,
        accepted_qty=ordered,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="unmatched",
        expected_credit_due=False,
    )


def _vintage_substitution(ordered: int, price: float) -> Outcome:
    # Quantities and money are all correct, so the verdict is `matched`. The
    # problem is on the other axis entirely: they shipped the 2022 against a PO
    # for the 2021. A wine tool that only checks arithmetic never notices, and
    # the cost basis silently attaches to the wrong vintage.
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=0.0,
        expected_verdict="matched",
        expected_credit_due=False,
        expected_line_match="substitution",
    )


def _freight_allocated(ordered: int, price: float) -> Outcome:
    # A house that folds freight into each line extension. Quantities are clean
    # and the verdict is `matched`, but Σ(qty × unit price) will NOT equal the
    # printed line total. B1's arithmetic self-check must not flag this as
    # needs_review — it is the false-positive case for the tie-out rule.
    return Outcome(
        ordered_qty=ordered,
        po_unit_price=price,
        shipped_qty=ordered,
        invoice_qty=ordered,
        invoice_unit_price=price,
        accepted_qty=ordered,
        rejected_qty=0,
        free_goods_qty=0,
        allocated_charges=round(ordered * 0.42, 2),
        expected_verdict="matched",
        expected_credit_due=False,
    )


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("clean", "Clean delivery", "Everything matches.", 34, _clean),
    Scenario(
        "split_case",
        "Split case",
        "Ordered in cases, invoiced in bottles, counted in cases. Must not alarm.",
        8,
        _split_case,
    ),
    Scenario(
        "free_goods_no_slip",
        "Free goods, no packing slip",
        "Agreed 11-for-10 from a house that sends no slip. Must not alarm.",
        5,
        _free_goods_no_slip,
        requires_no_packing_slip=True,
    ),
    Scenario(
        "free_goods_with_slip",
        "Free goods, slip present",
        "Same deal, slip counts the free bottle. Must not alarm. Currently does.",
        4,
        _free_goods_with_slip,
        requires_packing_slip=True,
    ),
    Scenario(
        "overbilled_vs_ship",
        "Overbilled vs their own slip",
        "Slip says 22 shipped, invoice bills 24. Self-evidenced; credit due.",
        7,
        _overbilled_vs_ship,
        requires_packing_slip=True,
    ),
    Scenario(
        "price_creep",
        "Silent price increase",
        "Billed above the agreed price with no notice.",
        11,
        _price_creep,
    ),
    Scenario(
        "short_shipped_honest",
        "Short shipped, billed honestly",
        "Slip says 24, 22 arrived, billed 22. Carrier problem, not billing.",
        5,
        _short_shipped_honest,
        requires_packing_slip=True,
    ),
    Scenario(
        "qty_short",
        "Billed for goods that never arrived",
        "Full order billed, fewer bottles delivered. Credit due.",
        7,
        _qty_short,
    ),
    Scenario(
        "qty_over",
        "Over-delivered, not an agreed deal",
        "More arrived than billed, no free-goods marking anywhere.",
        3,
        _qty_over,
    ),
    Scenario(
        "damaged",
        "Breakage on arrival",
        "All shipped units arrived, some broken, billed in full. Credit due.",
        6,
        _damaged,
    ),
    Scenario(
        "partial_backorder",
        "Partial shipment, balance allocated",
        "Half shipped and billed; the order stays open for the balance.",
        5,
        _partial_backorder,
    ),
    Scenario(
        "no_invoice_yet",
        "Goods arrived, invoice has not",
        "Must read unmatched. Silence is not agreement.",
        6,
        _no_invoice_yet,
    ),
    Scenario(
        "vintage_substitution",
        "Vintage substituted",
        "Arithmetic is perfect; they shipped the wrong year.",
        5,
        _vintage_substitution,
    ),
    Scenario(
        "freight_allocated",
        "Freight folded into the line",
        "Line totals will not tie out to qty x price. Must not be needs_review.",
        4,
        _freight_allocated,
    ),
)

SCENARIO_BY_KEY: dict[str, Scenario] = {s.key: s for s in SCENARIOS}


def scenario(key: str) -> Scenario:
    try:
        return SCENARIO_BY_KEY[key]
    except KeyError:
        raise KeyError(
            f"Unknown scenario '{key}'. Known: {sorted(SCENARIO_BY_KEY)}"
        ) from None


def verdicts_covered() -> set[str]:
    """Every verdict the scenario table can produce.

    The docgen test asserts this equals the nine verdicts in `MatchVerdict`. A
    verdict with no scenario is a verdict nothing ever exercises.
    """
    return {s.build(24, 22.0).expected_verdict for s in SCENARIOS}


def known_failing() -> list[tuple[str, str, str]]:
    """(scenario key, intended verdict, verdict the engine returns today)."""
    out = []
    for s in SCENARIOS:
        o = s.build(24, 22.0)
        if o.known_failing_verdict:
            out.append((s.key, o.expected_verdict, o.known_failing_verdict))
    return out
