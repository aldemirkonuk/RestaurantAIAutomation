"""Ground truth: what each rendered artifact says, written before it is degraded.

Extraction accuracy has to be a diff, not a judgement call. Every artifact ships
with a sibling `.truth.json` holding the exact values used to render it — before
degradation, before layout, before any model sees it.

Two separate axes are recorded, because they fail independently:

  * **extraction** — did we read the number that is on the paper?
  * **match**      — given those numbers, did `computeMatch` return the verdict
                     the scenario was built to produce?

An extractor can be perfect and the match still wrong, or vice versa. Collapsing
them into one score hides which half broke.

`expected_verdict` is always the *intended* answer. Where the engine is known to
disagree today, `known_failing_verdict` records what it actually returns and why.
Writing the buggy answer into ground truth would make the bug permanent by
turning it into the specification.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from scripts.docgen.compose import Delivery, Line

SCHEMA_VERSION = "1.0.0"


def _git_rev() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return out.stdout.strip() or None if out.returncode == 0 else None
    except Exception:
        return None


def _iso(d: Any) -> str | None:
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.isoformat()
    return str(d)


def line_truth(l: Line) -> dict[str, Any]:
    o = l.outcome
    received = o.accepted_qty + o.rejected_qty
    billable = max(0, received - o.free_goods_qty)
    return {
        "line_no": l.line_no,
        # --- identity, as printed --------------------------------------
        "wine_name": l.wine_name,
        "producer": l.producer,
        # The PO's vintage vs what the document claims. Equal except on a
        # substitution, which is the whole point of keeping both.
        "vintage_ordered": l.vintage,
        "vintage_on_document": l.invoiced_vintage,
        "region": l.region,
        "grape_variety": l.grape_variety,
        "vendor_sku": l.vendor_sku,
        "upc": l.upc,
        "signature_hash": l.signature_hash,
        # --- units -----------------------------------------------------
        # Bottle-equivalents throughout. A house may PRINT cases; the truth
        # file never does, because a quantity whose unit depends on the reader
        # is not ground truth.
        "bottles_per_case": l.bottles_per_case,
        "bottle_size": l.bottle_size,
        "uom_on_document": "case" if l.invoice_loose_bottles == 0 else "bottle",
        # --- the four documents ----------------------------------------
        "ordered_qty": o.ordered_qty,
        "shipped_qty": o.shipped_qty,
        "invoice_qty": o.invoice_qty,
        "accepted_qty": o.accepted_qty,
        "rejected_qty": o.rejected_qty,
        "free_goods_qty": o.free_goods_qty,
        "received_qty": received,
        "billable_received_qty": billable,
        # --- money -----------------------------------------------------
        "po_unit_price": o.po_unit_price,
        "invoice_unit_price": o.invoice_unit_price,
        "allocated_charges": o.allocated_charges,
        "line_total_printed": l.extension(),
        "rejection_reason": o.rejection_reason,
        # --- what should come back -------------------------------------
        "scenario": l.scenario,
        "expected_verdict": o.expected_verdict,
        "expected_credit_due": o.expected_credit_due,
        "expected_line_match": o.expected_line_match,
        "known_failing_verdict": o.known_failing_verdict,
        "known_failing_note": o.known_failing_note or None,
    }


@dataclass(frozen=True)
class Artifact:
    """One rendered file belonging to a delivery."""

    doc_type: str
    path: str
    content_type: str
    degradation_profile: str
    stroke_retention: float | None = None
    source_channel: str = "photo"


def delivery_truth(
    d: Delivery,
    artifacts: list[Artifact],
    *,
    archetype: str,
    pack_version: str = SCHEMA_VERSION,
) -> dict[str, Any]:
    h = d.house
    lines = [line_truth(l) for l in d.lines]

    verdict_counts: dict[str, int] = {}
    for lt in lines:
        v = lt["expected_verdict"]
        verdict_counts[v] = verdict_counts.get(v, 0) + 1

    return {
        "schema_version": SCHEMA_VERSION,
        # Never omitted. Anything consuming this file should be able to tell at
        # a glance that it describes a fabricated document.
        "synthetic": True,
        "generator": {
            "name": "scripts.docgen",
            "pack_version": pack_version,
            "git_rev": _git_rev(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "delivery_id": d.delivery_id,
        "seed": d.seed,
        "archetype": archetype,
        # --- who ---------------------------------------------------------
        "vendor": {
            "house_key": h.key,
            "name": h.name,
            "fictional": True,
            "license_no": h.license_no,
            "ar_email": h.ar_email,
            "ar_phone": h.ar_phone,
            "medium": h.medium,
            # The encodings that make this house hard, recorded so a failure can
            # be attributed to a cause rather than to "the model was bad".
            "encodings": {
                "uom_style": h.uom_style,
                "free_goods_style": h.free_goods_style,
                "vintage_style": h.vintage_style,
                "charge_style": h.charge_style,
                "uses_vendor_sku": h.uses_vendor_sku,
                "shows_upc": h.shows_upc,
                "description_max_chars": h.description_max_chars,
                "sends_packing_slip": h.sends_packing_slip,
                "charges_deposits": h.charges_deposits,
                "multi_po_invoices": h.multi_po_invoices,
            },
        },
        "restaurant": {
            "name": d.restaurant_name,
            "license_no": d.restaurant_license_no,
        },
        # --- header ------------------------------------------------------
        "header": {
            "po_number": d.po_number,
            "secondary_po_number": d.secondary_po_number,
            "invoice_number": d.invoice_number,
            "po_date": _iso(d.po_date),
            "ship_date": _iso(d.ship_date),
            "delivery_date": _iso(d.delivery_date),
            "invoice_date": _iso(d.invoice_date) if d.has_invoice() else None,
            "invoice_due_date": _iso(d.invoice_due_date) if d.has_invoice() else None,
            "terms": d.terms,
            "driver_name": d.driver_name,
            "signed_by": d.signed_by,
        },
        # --- money -------------------------------------------------------
        "totals": {
            "subtotal": d.subtotal(),
            "freight": d.freight(),
            "fuel_surcharge": d.fuel_surcharge(),
            "split_case_fees": d.split_case_fees(),
            # Broken out because a deposit is not wine cost and must never
            # reach COGS — a naive total that swallows it corrupts margin.
            "deposits": d.deposits(),
            "total": d.total(),
            # Whether Sum(printed line totals) equals the printed subtotal.
            # False for houses that allocate freight per line, which is the
            # false-positive case for the extractor's arithmetic self-check.
            "lines_tie_out_to_subtotal": h.charge_style != "per_line_allocated",
        },
        # --- documents present -------------------------------------------
        "documents_present": {
            "purchase_order": True,
            "packing_slip": d.has_packing_slip(),
            "delivery_receipt": True,
            "invoice": d.has_invoice(),
            "credit_memo": False,
        },
        "artifacts": [
            {
                "doc_type": a.doc_type,
                "path": a.path,
                "content_type": a.content_type,
                "degradation_profile": a.degradation_profile,
                "stroke_retention": a.stroke_retention,
                "source_channel": a.source_channel,
            }
            for a in artifacts
        ],
        # --- expectations --------------------------------------------------
        "lines": lines,
        "expected": {
            "line_count": len(lines),
            "billed_line_count": sum(
                1 for l in d.lines if l.outcome.invoice_qty is not None
            ),
            "verdict_counts": verdict_counts,
            "dollars_at_risk": d.dollars_at_risk(),
            "discrepancy_line_count": sum(1 for l in d.lines if l.is_discrepant),
            "known_failing_lines": [
                lt["line_no"] for lt in lines if lt["known_failing_verdict"]
            ],
        },
    }


def write_truth(path: Path, payload: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path
