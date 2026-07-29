"""Context for the normalized WineOps document.

This is the inversion the product is actually selling. A distributor's invoice
is organised around *who to pay*: their letterhead, their remit-to, their total,
at the top. The WineOps rendering is organised around *what happened and what it
is worth* — verdict first, dollars at risk second, and the vendor's own totals
demoted to a reconciliation block near the bottom.

Field selection follows `.planning/INVOICE_DOC_UX_RESEARCH.md` §B rather than
whatever happened to be convenient to render. Two of its rules shape almost
every decision here:

  1. **Absence is not agreement.** Every required field that the source document
     did not state renders as an explicit "not stated on source", and an
     unevaluable check (`ok = null`) must look visibly different from a failed
     one. A blank cell is the bug that produced `price_verified: true` on
     deliveries nobody ever looked at.
  2. **Never fabricate a regulated field.** No computed excise line, no inferred
     licence number, no guessed statutory due date. The document is a
     TTB-required record (27 CFR 31.181) and a dispute exhibit. Where we do
     compute something — landed cost, price delta — it is labelled as ours.

`last_price_paid` here is synthesised for design purposes and marked
`synthetic_history: True`. In production it comes from prior verified documents,
and if there is no prior purchase the field renders "first purchase on record",
never a zero.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from scripts.docgen.compose import Delivery, Line

#: Verdicts that put money on the table, from `isClaimable` in invoice-match.ts.
CLAIMABLE = frozenset({"overbilled_vs_ship", "qty_short", "rejected"})

#: Everything that is not a clean match. Mirrors `isDiscrepancy`.
DISCREPANT = frozenset(
    {
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

VERDICT_LABEL = {
    "matched": "Matched",
    "overbilled_vs_ship": "Overbilled vs their own slip",
    "price_variance": "Price above agreed",
    "qty_over": "More delivered than billed",
    "qty_short": "Billed for goods not received",
    "short_shipped": "Lost in transit",
    "rejected": "Rejected on arrival",
    "partial": "Partial — balance outstanding",
    "unmatched": "No invoice on file",
}

#: How strong the evidence is. `self_evidenced` means the vendor's own two
#: documents disagree, so there is nothing for them to dispute — the research
#: calls this the highest-confidence claim the system can make.
VERDICT_EVIDENCE = {
    "overbilled_vs_ship": "self_evidenced",
    "qty_short": "our_count",
    "rejected": "our_count",
    "short_shipped": "their_slip",
    "price_variance": "our_po",
    "qty_over": "our_count",
    "partial": "their_slip",
    "unmatched": "none",
    "matched": "none",
}


@dataclass
class SpineLine:
    """One line rendered as the four-way spine plus what only we know."""

    line: Line
    verdict: str

    ordered: int
    shipped: int | None
    received: int
    billed: int | None
    accepted: int
    rejected: int
    free_goods: int

    po_unit_price: float | None
    billed_unit_price: float | None
    allocated_charges: float
    landed_unit_cost: float | None

    last_price_paid: float | None
    last_price_date: date | None
    last_price_doc: str | None

    claim_amount: float | None

    @property
    def is_discrepant(self) -> bool:
        return self.verdict in DISCREPANT

    @property
    def is_claimable(self) -> bool:
        return self.verdict in CLAIMABLE

    @property
    def evidence(self) -> str:
        return VERDICT_EVIDENCE.get(self.verdict, "none")

    @property
    def price_delta(self) -> float | None:
        if self.last_price_paid is None or self.billed_unit_price is None:
            return None
        return round(self.billed_unit_price - self.last_price_paid, 2)

    @property
    def price_delta_pct(self) -> float | None:
        d = self.price_delta
        if d is None or not self.last_price_paid:
            return None
        return round(100.0 * d / self.last_price_paid, 1)

    @property
    def display_name(self) -> str:
        bits = [self.line.wine_name]
        if self.line.producer:
            bits.insert(0, self.line.producer)
        name = ", ".join(bits)
        if self.line.invoiced_vintage:
            name += f" {self.line.invoiced_vintage}"
        return name

    @property
    def vintage_mismatch(self) -> bool:
        return bool(
            self.line.vintage
            and self.line.invoiced_vintage
            and self.line.vintage != self.line.invoiced_vintage
        )


def _landed_unit_cost(l: Line) -> float | None:
    """`(billed qty x billed price + allocated charges) / accepted`.

    Free-goods aware by construction: the extra bottles raise `accepted` without
    raising what was billed, so the cost per usable bottle falls — which is the
    whole point of an 11-for-10 and the number the books must carry. Mirrors
    `effectiveUnitCost` in invoice-match.ts.

    Returns None when the invoice is not in hand, or when the house buries
    freight in the unit price. In the second case the document genuinely does not
    contain enough information, and saying so is the honest output.
    """
    o = l.outcome
    if o.invoice_qty is None or o.invoice_unit_price is None or o.accepted_qty <= 0:
        return None
    return round(
        (o.invoice_qty * o.invoice_unit_price + o.allocated_charges) / o.accepted_qty, 2
    )


def _claim_amount(l: Line, verdict: str) -> float | None:
    """Units billed but not usably received, at the billed price."""
    o = l.outcome
    if verdict not in CLAIMABLE or o.invoice_qty is None or o.invoice_unit_price is None:
        return None
    billable = max(0, o.accepted_qty + o.rejected_qty - o.free_goods_qty)
    owed = max(0, o.invoice_qty - (billable - o.rejected_qty))
    return round(owed * o.invoice_unit_price, 2) if owed else None


def build_context(delivery: Delivery, *, archetype: str = "bistro") -> dict[str, Any]:
    rng = random.Random(f"wineops:{delivery.delivery_id}")
    spine: list[SpineLine] = []

    for l in delivery.lines:
        o = l.outcome
        verdict = o.expected_verdict

        # Synthetic purchase history for design purposes only.
        has_history = rng.random() < 0.82
        last_paid = (
            round(o.po_unit_price * rng.uniform(0.94, 1.02), 2) if has_history else None
        )

        spine.append(
            SpineLine(
                line=l,
                verdict=verdict,
                ordered=o.ordered_qty,
                shipped=o.shipped_qty,
                received=o.accepted_qty + o.rejected_qty,
                billed=o.invoice_qty,
                accepted=o.accepted_qty,
                rejected=o.rejected_qty,
                free_goods=o.free_goods_qty,
                po_unit_price=o.po_unit_price,
                billed_unit_price=o.invoice_unit_price,
                allocated_charges=o.allocated_charges,
                landed_unit_cost=(
                    None
                    if delivery.house.charge_style == "buried_in_price"
                    else _landed_unit_cost(l)
                ),
                last_price_paid=last_paid,
                last_price_date=(
                    delivery.delivery_date - timedelta(days=rng.randint(12, 90))
                    if last_paid
                    else None
                ),
                last_price_doc=(
                    delivery.house.invoice_no_format.format(seq=rng.randint(70000, 87000))
                    if last_paid
                    else None
                ),
                claim_amount=_claim_amount(l, verdict),
            )
        )

    # Sorted here rather than in the template: Jinja's `sort` filter cannot
    # order a mixed list of floats and None, and "dollars at risk, descending"
    # is a product decision about what a manager reads first, not a display
    # detail. Lines with no computable claim fall to the bottom.
    discrepant = sorted(
        (s for s in spine if s.is_discrepant),
        key=lambda s: (s.claim_amount is None, -(s.claim_amount or 0.0)),
    )
    claimable = [s for s in spine if s.is_claimable]
    at_risk = round(sum(s.claim_amount or 0.0 for s in claimable), 2)

    # Cost drift: lines whose billed price moved against the last verified
    # purchase. The research argues this outranks dollars-recovered as a metric
    # because silent creep across hundreds of SKUs is where margin actually
    # leaks, and unlike a credit request it is verifiable the month it happens.
    drift = [
        s
        for s in spine
        if s.price_delta is not None and abs(s.price_delta_pct or 0) >= 1.0
    ]
    drift_dollars = round(
        sum((s.price_delta or 0) * (s.billed or 0) for s in drift), 2
    )

    verdict_counts: dict[str, int] = {}
    for s in spine:
        verdict_counts[s.verdict] = verdict_counts.get(s.verdict, 0) + 1

    return {
        "d": delivery,
        "spine": spine,
        "discrepant": discrepant,
        "claimable": claimable,
        "drift": sorted(drift, key=lambda s: -abs(s.price_delta or 0)),
        "archetype": archetype,
        "verdict_label": VERDICT_LABEL,
        "summary": {
            "line_count": len(spine),
            "discrepancy_count": len(discrepant),
            "claim_count": len(claimable),
            "dollars_at_risk": at_risk,
            "drift_line_count": len(drift),
            "drift_dollars": drift_dollars,
            "verdict_counts": verdict_counts,
            "has_packing_slip": delivery.has_packing_slip(),
            "has_invoice": delivery.has_invoice(),
            # Deliberately surfaced: a house that buries freight in the unit
            # price makes landed cost unknowable, and the document says so
            # rather than printing a number that looks authoritative.
            "landed_cost_knowable": delivery.house.charge_style != "buried_in_price",
        },
        # Provenance. Absence is a rendered state, never a blank.
        "provenance": [
            {
                "doc": "Purchase order",
                "have": True,
                "ref": delivery.po_number,
                "when": delivery.po_date,
            },
            {
                "doc": "Packing slip",
                "have": delivery.has_packing_slip(),
                "ref": None,
                "when": delivery.ship_date if delivery.has_packing_slip() else None,
                "absent_note": f"{delivery.house.name} does not issue one",
            },
            {
                "doc": "Delivery receipt",
                "have": True,
                "ref": f"Signed by {delivery.signed_by}",
                "when": delivery.delivery_date,
            },
            {
                "doc": "Vendor invoice",
                "have": delivery.has_invoice(),
                "ref": delivery.invoice_number if delivery.has_invoice() else None,
                "when": delivery.invoice_date if delivery.has_invoice() else None,
                "absent_note": "Not received — nothing on this delivery is price-verified",
            },
            {
                "doc": "Credit memo",
                "have": False,
                "ref": None,
                "when": None,
                "absent_note": "None issued. A claim is not a recovery until one lands.",
            },
        ],
        "synthetic_history": True,
    }
