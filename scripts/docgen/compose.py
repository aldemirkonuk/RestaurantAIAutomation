"""Compose one delivery's worth of documents from real wines and a scenario mix.

A delivery produces up to five documents, and the whole point of modelling all
of them is that they are allowed to *disagree*:

    purchase_order    what we asked for              (850)
    packing_slip      what they say shipped          (856)   — absent for some houses
    delivery_receipt  what a human signed for
    invoice           what we are billed             (810)   — sometimes late
    credit_memo       what they agreed to give back  (812)   — sometimes never

Everything is deterministic given a seed. The same seed reproduces the same
delivery down to the invoice number, which is what makes a regression in the
extractor distinguishable from a change in the data.

Quantities inside this module are BOTTLE-EQUIVALENTS throughout, matching
invoice-match.ts. How a house chooses to *print* them — cases, bottles, "12/750ML"
welded into the description — is a rendering decision made in the template from
`House.uom_style`, never a change to the underlying number.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Any, Iterable

from scripts.docgen.errors import Outcome, Scenario, SCENARIOS
from scripts.docgen.houses import House

# Wholesale is roughly a third of the list price on a restaurant wine list.
# The band is wide because it genuinely is: high-end bottles carry a thinner
# multiple than house pours.
_MARKUP_BY_TIER = (
    (40.0, 2.6),  # cheap by-the-glass wines carry the fattest multiple
    (90.0, 3.0),
    (200.0, 3.3),
    (float("inf"), 2.2),  # collectible bottles are marked up far less
)

_CASE_PACKS = (12, 12, 12, 6, 6, 24)  # 750ml twelves dominate; magnums come in 6


def _wholesale(list_price: float) -> float:
    for ceiling, divisor in _MARKUP_BY_TIER:
        if list_price <= ceiling:
            return round(list_price / divisor, 2)
    return round(list_price / 3.0, 2)


@dataclass
class Line:
    """One wine across all four documents, plus what the match should say."""

    line_no: int
    wine_name: str
    producer: str | None
    vintage: int | None
    country: str | None
    region: str | None
    grape_variety: str | None
    primary_type: str | None

    #: Stable across runs — the sim wine identity from the menu snapshot.
    signature_hash: str
    vendor_sku: str
    upc: str | None

    bottles_per_case: int
    bottle_size: str

    scenario: str
    outcome: Outcome

    #: What the *document* claims, which for a substitution is deliberately not
    #: what the PO says.
    invoiced_vintage: int | None = None

    @property
    def cases_ordered(self) -> float:
        return self.outcome.ordered_qty / self.bottles_per_case

    @property
    def invoice_full_cases(self) -> int:
        """Whole cases billed, floored.

        No distributor prints "1.83 CS". They print the whole cases and let the
        bottle column carry the remainder, which is also why the case column
        alone can never be used to reconstruct a quantity — the split-case
        ambiguity that `normalizeUom` exists to survive.
        """
        if self.outcome.invoice_qty is None:
            return 0
        return self.outcome.invoice_qty // self.bottles_per_case

    @property
    def invoice_loose_bottles(self) -> int:
        """Bottles billed outside a whole case."""
        if self.outcome.invoice_qty is None:
            return 0
        return self.outcome.invoice_qty % self.bottles_per_case

    @property
    def is_discrepant(self) -> bool:
        return self.outcome.expected_verdict != "matched"

    def extension(self) -> float:
        """Printed line total on the invoice, in dollars."""
        o = self.outcome
        if o.invoice_qty is None or o.invoice_unit_price is None:
            return 0.0
        # allocated_charges is already inside the extension for houses that
        # spread freight per line; footer-charge houses carry 0.0 here.
        return round(o.invoice_qty * o.invoice_unit_price + o.allocated_charges, 2)


@dataclass
class Delivery:
    """A single delivery and every document it generates."""

    delivery_id: str
    seed: int
    restaurant_name: str
    restaurant_address: str
    restaurant_city_state_zip: str
    restaurant_license_no: str

    house: House
    lines: list[Line]

    po_number: str
    po_date: date
    ship_date: date
    delivery_date: date
    invoice_number: str
    invoice_date: date
    #: None when the invoice has not arrived. Never inferred from the PO.
    invoice_due_date: date | None
    terms: str

    driver_name: str
    signed_by: str

    #: Second PO number for houses that bill across orders.
    secondary_po_number: str | None = None

    def has_packing_slip(self) -> bool:
        return self.house.sends_packing_slip

    def has_invoice(self) -> bool:
        return any(l.outcome.invoice_qty is not None for l in self.lines)

    # ---- money -----------------------------------------------------------

    def subtotal(self) -> float:
        return round(sum(l.extension() for l in self.lines), 2)

    def freight(self) -> float:
        if self.house.charge_style != "footer_lines":
            return 0.0
        return self.house.freight_flat

    def fuel_surcharge(self) -> float:
        if self.house.charge_style != "footer_lines":
            return 0.0
        return round(self.subtotal() * self.house.fuel_surcharge_pct, 2)

    def split_case_fees(self) -> float:
        if self.house.charge_style != "footer_lines" or not self.house.split_case_fee:
            return 0.0
        # Charged once per line that is not a whole number of cases — the fee
        # that quietly turns a good price into a bad one on small orders.
        n = sum(
            1
            for l in self.lines
            if l.outcome.invoice_qty is not None
            and l.outcome.invoice_qty % l.bottles_per_case != 0
        )
        return round(n * self.house.split_case_fee, 2)

    def deposits(self) -> float:
        if not self.house.charges_deposits:
            return 0.0
        # Per-container deposit. NOT wine cost — must never reach COGS, which is
        # exactly why it is modelled rather than folded into the subtotal.
        bottles = sum(l.outcome.invoice_qty or 0 for l in self.lines)
        return round(bottles * 0.05, 2)

    def total(self) -> float:
        return round(
            self.subtotal()
            + self.freight()
            + self.fuel_surcharge()
            + self.split_case_fees()
            + self.deposits(),
            2,
        )

    # ---- the other three documents ---------------------------------------

    @property
    def packing_slip_number(self) -> str:
        """The 856's own identifier, distinct from the invoice's.

        Distributors number ship notices separately from invoices, and a credit
        claim that quotes the wrong one gets bounced — so the two must never be
        the same string.
        """
        return f"PS-{self.invoice_number}"

    @property
    def delivery_receipt_number(self) -> str:
        return f"POD-{self.delivery_id.upper()}"

    @property
    def credit_memo_number(self) -> str:
        return f"CM-{self.invoice_number}"

    def claimable_lines(self) -> list[Line]:
        """Lines a credit memo could cover.

        Only what the vendor owes money for. A price variance is a discrepancy
        worth a conversation but not a credit, and a short-ship the vendor billed
        honestly is a carrier problem — putting either on a credit memo would be
        claiming money nobody agreed was owed.
        """
        return [l for l in self.lines if l.outcome.expected_credit_due]

    def credit_total(self) -> float:
        return self.dollars_at_risk()

    def rejected_lines(self) -> list[Line]:
        return [l for l in self.lines if l.outcome.rejected_qty > 0]

    def exception_lines(self) -> list[Line]:
        """Lines a receiver would have had to write something about at the door.

        Anything where the physical count diverges from what was shipped, plus
        anything refused. This is the set that must be marked ON the receipt while
        the driver is still there — an unmarked discrepancy is the one that cannot
        be claimed later.
        """
        out: list[Line] = []
        for line in self.lines:
            o = line.outcome
            received = o.accepted_qty + o.rejected_qty
            if o.rejected_qty > 0:
                out.append(line)
            elif o.shipped_qty is not None and received != o.shipped_qty:
                out.append(line)
        return out

    def dollars_at_risk(self) -> float:
        """Sum of credit-worthy discrepancies, at the billed price."""
        at_risk = 0.0
        for l in self.lines:
            o = l.outcome
            if not o.expected_credit_due or o.invoice_unit_price is None:
                continue
            billable = max(0, o.accepted_qty + o.rejected_qty - o.free_goods_qty)
            owed = max(0, (o.invoice_qty or 0) - (billable - o.rejected_qty))
            at_risk += owed * o.invoice_unit_price
        return round(at_risk, 2)


# --------------------------------------------------------------------------
# Building
# --------------------------------------------------------------------------


def render_context(delivery: Delivery) -> dict[str, Any]:
    """Everything a house template needs, derived once so templates stay dumb.

    `billed_lines` is deliberately not `delivery.lines`. A line whose scenario is
    `no_invoice_yet` simply does not appear on the invoice — which is both what
    really happens to a back-ordered line and what makes the match read
    `unmatched` for it instead of inventing an agreement.
    """
    billed = [l for l in delivery.lines if l.outcome.invoice_qty is not None]

    # Deterministic faux barcode. Drawn as rules rather than a barcode font so
    # the artifact stays self-contained with no external font request.
    bar_rng = random.Random(f"{delivery.house.key}:{delivery.invoice_number}")
    bars = [bar_rng.choice((1, 1, 2, 3)) for _ in range(58)]

    return {
        "d": delivery,
        "billed_lines": billed,
        "barcode_bars": bars,
        "page_size": "Letter landscape"
        if delivery.house.key == "goldenstate"
        else "Letter",
    }


def _pick_scenarios(rng: random.Random, n: int, house: House) -> list[Scenario]:
    """Weighted pick, filtered to scenarios this house can actually express.

    A free-goods-with-slip scenario on a house that never sends a slip is not a
    harder test case, it is an incoherent document. Filtering here keeps every
    generated artifact internally consistent.
    """
    eligible = [
        s
        for s in SCENARIOS
        if not (s.requires_packing_slip and not house.sends_packing_slip)
        and not (s.requires_no_packing_slip and house.sends_packing_slip)
    ]
    weights = [s.weight for s in eligible]
    return rng.choices(eligible, weights=weights, k=n)


def _vendor_sku(rng: random.Random, house: House, signature_hash: str) -> str:
    """Deterministic per (house, wine) so the same wine keeps its SKU."""
    h = hashlib.sha256(f"{house.key}:{signature_hash}".encode()).hexdigest()
    if house.key == "goldenstate":
        return f"{int(h[:6], 16) % 900000 + 100000}"
    if house.key == "tri_state":
        return f"{h[:3].upper()}-{int(h[3:7], 16) % 9000 + 1000}"
    return f"{int(h[:7], 16) % 9000000 + 1000000}"


def build_delivery(
    *,
    seed: int,
    house: House,
    wines: list[dict[str, Any]],
    restaurant: dict[str, str],
    delivery_date: date,
    line_count: int | None = None,
    sequence: int = 1,
    force_scenarios: Iterable[str] | None = None,
) -> Delivery:
    """Build one delivery. Deterministic in `seed`."""
    rng = random.Random(seed)

    # A real distributor invoice is 8-40 lines. Small houses send fewer.
    if line_count is None:
        line_count = (
            rng.randint(3, 9)
            if house.key in ("vinequarter", "cellarbrook")
            else rng.randint(8, 26)
        )
    line_count = min(line_count, len(wines))
    chosen = rng.sample(wines, line_count)

    if force_scenarios is not None:
        forced = list(force_scenarios)
        from scripts.docgen.errors import scenario as _scenario

        scenarios = [_scenario(k) for k in forced][:line_count]
        while len(scenarios) < line_count:
            scenarios.append(_scenario("clean"))
    else:
        scenarios = _pick_scenarios(rng, line_count, house)

    lines: list[Line] = []
    for idx, (wine, scen) in enumerate(zip(chosen, scenarios), start=1):
        pack = rng.choice(_CASE_PACKS)
        cases = rng.choice((1, 1, 1, 2, 2, 3, 5))
        ordered = pack * cases
        list_price = float(wine.get("bottle_price") or 0) or 48.0
        unit_cost = _wholesale(list_price)

        outcome = scen.build(ordered, unit_cost)

        # A house that issues no packing slip cannot state a shipped quantity.
        #
        # Most scenarios set `shipped_qty = ordered` unconditionally because they
        # are written against the canonical four-document case. Left alone, a
        # Cellarbrook or Vine Quarter delivery would carry a ship figure for a
        # document nobody ever sent — which is precisely the "silence recorded as
        # agreement" defect this whole system exists to prevent, reintroduced one
        # layer down in the generator. The scenarios that genuinely need a slip
        # are filtered out for these houses upstream in `_pick_scenarios`, so
        # clearing it here cannot change any intended verdict.
        if not house.sends_packing_slip:
            outcome = replace(outcome, shipped_qty=None)

        vintage = wine.get("vintage")

        invoiced_vintage = vintage
        if scen.key == "vintage_substitution" and vintage:
            # They shipped the next year. Same wine, same price, wrong bottle.
            invoiced_vintage = int(vintage) + 1

        lines.append(
            Line(
                line_no=idx,
                wine_name=wine.get("wine_name") or "UNKNOWN",
                producer=wine.get("producer"),
                vintage=int(vintage) if vintage else None,
                country=wine.get("country"),
                region=wine.get("region"),
                grape_variety=wine.get("grape_variety"),
                primary_type=wine.get("primary_type"),
                signature_hash=wine.get("signature_hash") or f"nohash{idx}",
                vendor_sku=_vendor_sku(rng, house, wine.get("signature_hash") or str(idx)),
                upc=(
                    f"0{rng.randrange(10**11):011d}"
                    if house.shows_upc
                    else None
                ),
                bottles_per_case=pack,
                bottle_size="750ml" if pack != 6 else "1.5L",
                scenario=scen.key,
                outcome=outcome,
                invoiced_vintage=int(invoiced_vintage) if invoiced_vintage else None,
            )
        )

    po_date = delivery_date - timedelta(days=rng.randint(3, 10))
    ship_date = delivery_date - timedelta(days=rng.randint(0, 2))
    # The invoice is frequently NOT same-day. Modelling the lag is the reason
    # `unmatched` is a real state rather than an error.
    invoice_date = delivery_date + timedelta(days=rng.randint(0, 6))

    terms = rng.choice(("Net 30", "Net 30", "Net 15", "Net 45", "COD"))

    return Delivery(
        delivery_id=f"{house.key}-{delivery_date.isoformat()}-{sequence:03d}",
        seed=seed,
        restaurant_name=restaurant["name"],
        restaurant_address=restaurant["address"],
        restaurant_city_state_zip=restaurant["city_state_zip"],
        restaurant_license_no=restaurant["license_no"],
        house=house,
        lines=lines,
        po_number=house.po_no_format.format(seq=sequence + 4200),
        po_date=po_date,
        ship_date=ship_date,
        delivery_date=delivery_date,
        invoice_number=house.invoice_no_format.format(seq=sequence + 88110),
        invoice_date=invoice_date,
        invoice_due_date=(
            invoice_date + timedelta(days=int(terms.split()[-1]))
            if terms.startswith("Net")
            else invoice_date
        ),
        terms=terms,
        driver_name=rng.choice(
            ("R. Alvarez", "M. Okafor", "D. Petrov", "J. Whitfield", "S. Nakamura")
        ),
        signed_by=rng.choice(
            ("K. Brennan", "T. Osei", "L. Marchetti", "A. Duarte", "P. Vasquez")
        ),
        secondary_po_number=(
            house.po_no_format.format(seq=sequence + 4173)
            if house.multi_po_invoices and rng.random() < 0.45
            else None
        ),
    )
