"""Fictional distributor houses and the layout quirks that make extraction hard.

Every house here is invented. Real distributor *records* live in `providers`
(decision D3 in .planning/SYNTHETIC_DATA_AND_DOCS_PLAN.md) so vendor discovery,
catalogues and ordering stay genuine, but nothing this generator renders may be
mistaken for a real company's paperwork.

Why houses exist at all
-----------------------
A generator with one template teaches an extractor the template, not the task.
The variation that actually breaks beverage-invoice parsing is not visual noise
— it is *semantic*: the same fact encoded six incompatible ways.

  pack size    "12/750ML" inside the description   vs a PACK column vs neither
  quantity     cases, bottles, or a bare number whose unit lives in another column
  free goods   a $0.00 line, a "FG" flag, a note in the description, or absent
  vintage      its own column, glued to the description, or dropped entirely
  freight      a footer charge, a per-line allocation, or buried in unit price
  credits      a negative line on a later invoice referencing nothing

Each of those is a real way real distributors differ, and each is a distinct way
`document-extractor.service.ts` can be wrong while looking confident.

Coverage, stated honestly
------------------------
Every encoding value below is used by at least one house, so none of it is dead
configuration. It is NOT true that every value appears twice: with six houses and
dimensions carrying up to four values, two-of-each would require at least eight
houses. An earlier version of this docstring claimed otherwise and was wrong.

The ones that appear only once are recorded in `SINGLETON_ENCODINGS` and asserted
there, as a ratchet: a fix that special-cases a singleton house looks like a
general fix and is not one, so the set must shrink (by adding houses) and must
never silently grow. `coverage_report()` prints the current distribution.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# How a house writes the unit on a line.
UomStyle = Literal[
    "x12_in_description",  # "CAB SAUV RES 2021 12/750ML" — pack hidden in text
    "separate_pack_column",  # explicit PACK column, qty is cases
    "bottles_only",  # everything expressed in bottles, no case concept
    "code_column",  # X12-style codes: CS / BT / EA
]

# How a house expresses "11 for the price of 10".
FreeGoodsStyle = Literal[
    "zero_price_line",  # own line, unit price 0.00
    "flag_column",  # FG column marked Y
    "description_note",  # "(1 FREE)" appended to the description
    "absent",  # not shown at all — qty just runs higher than the PO
]

# Where the vintage lives.
VintageStyle = Literal["own_column", "in_description", "omitted"]

# How freight / fuel / split-case fees appear.
ChargeStyle = Literal[
    "footer_lines",  # itemised beneath the subtotal
    "per_line_allocated",  # spread across lines, already inside the extension
    "buried_in_price",  # not shown anywhere; unit price silently carries it
]

# Physical presentation — drives both CSS and the degradation profile.
Medium = Literal["laser", "carbon_copy", "thermal", "dot_matrix", "letterhead"]


@dataclass(frozen=True)
class House:
    """A fictional distributor and the way its paperwork reads."""

    key: str
    name: str
    tagline: str
    address: str
    city_state_zip: str
    phone: str
    ar_email: str
    ar_phone: str
    # Fictional. Present because a credit claim without the vendor's licence
    # number gets bounced by a real AR desk, so our normalized document has to
    # have somewhere to carry it — including when the source omits it.
    license_no: str | None

    template: str
    medium: Medium

    uom_style: UomStyle
    free_goods_style: FreeGoodsStyle
    vintage_style: VintageStyle
    charge_style: ChargeStyle

    # Format strings / flags that vary the surface without changing meaning.
    date_format: str
    invoice_no_format: str
    po_no_format: str
    uses_vendor_sku: bool
    shows_upc: bool
    uppercase_descriptions: bool
    # Some houses truncate hard. Producer and vintage are the first casualties,
    # which is exactly why line matching cannot rely on description alone.
    description_max_chars: int | None

    # Does this house send a packing slip at all? When False every delivery from
    # it leaves the ship column unknown, which must render as "—" and never as
    # agreement (D4).
    sends_packing_slip: bool
    # Bottle-deposit states bill a per-container deposit that is NOT part of
    # wine cost and must not land in COGS.
    charges_deposits: bool
    # Does the invoice ever cover more than one PO? Multi-PO invoices are the
    # case that makes naive PO-to-invoice matching fall apart.
    multi_po_invoices: bool

    notes: str = ""

    # Optional per-house fee schedule, in dollars.
    freight_flat: float = 0.0
    fuel_surcharge_pct: float = 0.0
    split_case_fee: float = 0.0


HOUSES: dict[str, House] = {
    # The "easy" one. Clean laser invoice, explicit columns for everything.
    # Included as the control: if extraction fails here, nothing else matters.
    "meridian": House(
        key="meridian",
        name="Meridian Wine & Spirits",
        tagline="Fine Wine · Craft Spirits · Since 1974",
        address="4400 Distribution Parkway",
        city_state_zip="Elk Grove Village, IL 60007",
        phone="(847) 555-0142",
        ar_email="ar@meridianws.example",
        ar_phone="(847) 555-0188",
        license_no="IL-DW-114872",
        template="house_meridian.html",
        medium="laser",
        uom_style="separate_pack_column",
        free_goods_style="flag_column",
        vintage_style="own_column",
        charge_style="footer_lines",
        date_format="%m/%d/%Y",
        invoice_no_format="MWS-{seq:07d}",
        po_no_format="PO{seq:06d}",
        uses_vendor_sku=True,
        shows_upc=True,
        uppercase_descriptions=False,
        description_max_chars=None,
        sends_packing_slip=True,
        charges_deposits=False,
        multi_po_invoices=False,
        freight_flat=18.50,
        fuel_surcharge_pct=0.0,
        split_case_fee=2.50,
        notes="Control layout. Every fact has its own column and its own label.",
    ),
    # The common bad case: pack size welded into an uppercase description,
    # quantity in cases, no vintage column. This is what most beverage
    # invoices actually look like.
    "harborpoint": House(
        key="harborpoint",
        name="Harbor Point Beverage Co.",
        tagline="Wholesale Beverage Distribution",
        address="1200 Dockside Ave, Bldg C",
        city_state_zip="Baltimore, MD 21230",
        phone="(410) 555-0119",
        ar_email="credits@harborpointbev.example",
        ar_phone="(410) 555-0177",
        license_no="MD-WD-3391",
        template="house_harborpoint.html",
        medium="laser",
        uom_style="x12_in_description",
        free_goods_style="description_note",
        vintage_style="in_description",
        charge_style="footer_lines",
        date_format="%m/%d/%y",
        invoice_no_format="{seq:08d}",
        po_no_format="{seq:06d}",
        uses_vendor_sku=True,
        shows_upc=False,
        uppercase_descriptions=True,
        description_max_chars=34,
        sends_packing_slip=True,
        charges_deposits=True,
        multi_po_invoices=True,
        freight_flat=0.0,
        fuel_surcharge_pct=0.035,
        split_case_fee=3.00,
        notes=(
            "Truncates descriptions at 34 chars, so producer and vintage are "
            "routinely cut. Multi-PO. Deposits. The realistic worst case that "
            "is still machine-printed."
        ),
    ),
    # Carbon copy handed over at the door. Bottles only, no pack concept,
    # freight buried in the unit price so landed cost is unrecoverable from
    # the document alone — the extractor must report that it cannot know.
    "cellarbrook": House(
        key="cellarbrook",
        name="Cellarbrook Selections",
        tagline="Importer & Distributor of Artisan Wine",
        address="88 Vineyard Row",
        city_state_zip="Napa, CA 94559",
        phone="(707) 555-0163",
        ar_email="office@cellarbrook.example",
        ar_phone="(707) 555-0163",
        license_no=None,  # small importer; licence not printed
        template="house_cellarbrook.html",
        medium="carbon_copy",
        uom_style="bottles_only",
        free_goods_style="zero_price_line",
        vintage_style="in_description",
        charge_style="buried_in_price",
        date_format="%d %b %Y",
        invoice_no_format="CB{seq:05d}",
        po_no_format="CB-PO-{seq:04d}",
        uses_vendor_sku=False,
        shows_upc=False,
        uppercase_descriptions=False,
        description_max_chars=None,
        sends_packing_slip=False,  # never sends one — ship column stays unknown
        charges_deposits=False,
        multi_po_invoices=False,
        notes=(
            "No packing slip, ever. No vendor SKU, so line matching must fall "
            "back to description trigram. Freight is inside the unit price and "
            "the document says so nowhere — landed cost is genuinely unknowable "
            "here and must be reported as such rather than guessed."
        ),
    ),
    # Thermal roll printed by the driver's handheld. Short, faint, decays.
    # Free goods simply absent — quantity runs over the PO with no explanation,
    # which is the input that makes a naive engine cry qty_over on a good deal.
    "tri_state": House(
        key="tri_state",
        name="Tri-State Beverage Group",
        tagline="",
        address="9 Industrial Loop",
        city_state_zip="Secaucus, NJ 07094",
        phone="(201) 555-0104",
        ar_email="ar@tristatebev.example",
        ar_phone="(201) 555-0150",
        license_no="NJ-WW-88214",
        template="house_tristate.html",
        medium="thermal",
        uom_style="code_column",
        free_goods_style="absent",
        vintage_style="omitted",
        charge_style="footer_lines",
        date_format="%m-%d-%Y",
        invoice_no_format="TS{seq:06d}",
        po_no_format="P{seq:05d}",
        uses_vendor_sku=True,
        shows_upc=False,
        uppercase_descriptions=True,
        description_max_chars=28,
        sends_packing_slip=True,
        charges_deposits=True,
        multi_po_invoices=False,
        freight_flat=12.00,
        fuel_surcharge_pct=0.02,
        split_case_fee=0.0,
        notes=(
            "Thermal, so it fades and curls. Vintage omitted entirely — the "
            "same wine across two vintages is indistinguishable on paper, which "
            "is the substitution case line-matcher.ts has to catch."
        ),
    ),
    # Old dot-matrix ERP output. Fixed-width, per-line allocated freight,
    # X12-ish codes. Ugly but internally consistent — the case where a careful
    # extractor should do *better* than on the pretty laser invoice.
    "goldenstate": House(
        key="goldenstate",
        name="Golden State Wine Merchants",
        tagline="SERVING LICENSED RETAILERS STATEWIDE",
        address="2750 E COMMERCE WAY",
        city_state_zip="SACRAMENTO CA 95834",
        phone="(916) 555-0187",
        ar_email="accounting@gswinemerchants.example",
        ar_phone="(916) 555-0190",
        license_no="CA-W-206611",
        template="house_goldenstate.html",
        medium="dot_matrix",
        uom_style="code_column",
        free_goods_style="flag_column",
        vintage_style="own_column",
        charge_style="per_line_allocated",
        date_format="%Y-%m-%d",
        invoice_no_format="INV-{seq:09d}",
        po_no_format="PUR{seq:07d}",
        uses_vendor_sku=True,
        shows_upc=True,
        uppercase_descriptions=True,
        description_max_chars=40,
        sends_packing_slip=True,
        charges_deposits=False,
        multi_po_invoices=True,
        freight_flat=0.0,
        fuel_surcharge_pct=0.0,
        split_case_fee=1.75,
        notes=(
            "Freight is already allocated into each extension, so the footer "
            "total will NOT equal sum(qty x unit price). An arithmetic "
            "self-check that assumes it does will flag every one of these as "
            "needs_review — the false-positive case for B1's tie-out rule."
        ),
    ),
    # Boutique letterhead, hand-annotated, sometimes handwritten totals.
    # Lowest volume, highest extraction difficulty.
    "vinequarter": House(
        key="vinequarter",
        name="Vine Quarter Imports",
        tagline="Grower Champagne · Natural Wine · Small Parcels",
        address="317 W Erie St, Suite 2",
        city_state_zip="Chicago, IL 60654",
        phone="(312) 555-0136",
        ar_email="hello@vinequarter.example",
        ar_phone="(312) 555-0136",
        license_no="IL-DW-220945",
        template="house_vinequarter.html",
        medium="letterhead",
        uom_style="x12_in_description",
        free_goods_style="description_note",
        vintage_style="in_description",
        charge_style="footer_lines",
        date_format="%B %d, %Y",
        invoice_no_format="VQ-{seq:04d}",
        po_no_format="VQ{seq:04d}",
        uses_vendor_sku=False,
        shows_upc=False,
        uppercase_descriptions=False,
        description_max_chars=None,
        sends_packing_slip=False,
        charges_deposits=False,
        multi_po_invoices=False,
        freight_flat=25.00,
        fuel_surcharge_pct=0.0,
        split_case_fee=0.0,
        notes=(
            "Handwritten annotations and a signature block. Allocations and "
            "back-orders are written in pen in the margin, which is where a "
            "surprising amount of real beverage information actually lives."
        ),
    ),
}


#: Houses that never issue a packing slip. Deliveries from these must leave
#: `shippedQty` null so the match reads `unmatched`/unknown on that axis rather
#: than silently comparing the invoice to itself.
NO_SLIP_HOUSES: frozenset[str] = frozenset(
    h.key for h in HOUSES.values() if not h.sends_packing_slip
)


def house(key: str) -> House:
    """Look up a house, failing loudly on a typo rather than defaulting."""
    try:
        return HOUSES[key]
    except KeyError:
        raise KeyError(
            f"Unknown house '{key}'. Known: {sorted(HOUSES)}"
        ) from None


def list_houses() -> list[str]:
    return sorted(HOUSES)


#: Encoding values currently carried by exactly one house, per dimension.
#:
#: A ratchet, not an aspiration. `scripts/test_docgen.py` asserts this matches
#: reality exactly, so:
#:   * making an already-thin encoding thinner fails the test
#:   * adding a 7th/8th house that doubles one of these requires deleting it here,
#:     which is the visible sign of progress
#: `medium` is excluded deliberately — each physical medium is meant to be
#: distinct, so singletons there are the design, not a gap.
SINGLETON_ENCODINGS: dict[str, frozenset[str]] = {
    "uom_style": frozenset({"separate_pack_column", "bottles_only"}),
    "free_goods_style": frozenset({"zero_price_line", "absent"}),
    "vintage_style": frozenset({"omitted"}),
    "charge_style": frozenset({"buried_in_price", "per_line_allocated"}),
}

#: Dimensions whose singletons matter for overfitting. `medium` is not one.
RATCHETED_DIMENSIONS: tuple[str, ...] = tuple(SINGLETON_ENCODINGS)


def coverage_report() -> dict[str, dict[str, int]]:
    """Count how many houses exercise each encoding.

    Consumed by `scripts/test_docgen.py`, which asserts two things against it:
    every value is used at least once (nothing here is dead configuration), and
    the set of single-house values equals `SINGLETON_ENCODINGS` exactly.
    """
    dims = {
        "uom_style": {},
        "free_goods_style": {},
        "vintage_style": {},
        "charge_style": {},
        "medium": {},
    }
    for h in HOUSES.values():
        for dim in dims:
            val = getattr(h, dim)
            dims[dim][val] = dims[dim].get(val, 0) + 1
    return dims
