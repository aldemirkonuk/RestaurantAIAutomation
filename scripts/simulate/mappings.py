"""POS item mappings, derived from the menu the restaurant already imported.

Why this exists
---------------
`PosHubService.resolveWine` checks `pos_item_mappings` first and only falls back to
a keyword scan of the item name. Measured against a real crawled bistro list, that
fallback resolves **35%** of wine line items: `WINE_WORDS` is varietal-oriented, so
"Sonoma Pinot Noir" matches and "Edmondo Sarti Barbaresco", "Pace Arneis Roero" and
"Umani Ronchi Pecorino" do not. On a tenant with no mappings, roughly two thirds of
wine sales are written to `pos_checks` as food — silently, with nothing erroring —
and every downstream wine analytic undercounts by that much.

So mappings are not an optimisation here, they are a precondition. A simulator run
against an unmapped tenant measures the keyword list, not the pipeline.

The honest design, and the one onboarding should use
---------------------------------------------------
Mappings are generated from the SAME menu snapshot the simulator pours from, which
is the same list a real restaurant imports at onboarding. That is deliberate: it
mirrors what production should do (map POS buttons to the imported wine list once,
at setup) rather than inventing a shortcut only the simulator can take.

It does mean a mapped run cannot measure wine *detection* — the mapping answers
the question before the heuristic is asked. That is the point, and it is why
`scripts/simulate wines` reports the unmapped hit rate separately: one command
measures the heuristic, the other measures everything downstream of it.
"""

from __future__ import annotations

from typing import Any, Iterator

from scripts.simulate.service import FOOD_ITEMS, WineList, _sim_uuid, _wine_item

#: `source: "*"` applies the mapping across every provider, which is right here:
#: the same wine sells through the analytics ingress and the stock ingress, and a
#: per-provider mapping would resolve on one path and not the other.
ANY_SOURCE = "*"


def wine_mappings(wine_list: WineList) -> Iterator[dict[str, Any]]:
    """One mapping per (wine, sold-as) pair the simulator can actually emit.

    Both the bottle and the glass presentation get a row, because they carry
    different `external_item_id`s and different display names — exactly as two POS
    buttons for the same wine would.
    """
    seen: set[str] = set()

    for by_glass, pool in ((False, wine_list.bottles), (True, wine_list.btg)):
        for wine in pool:
            item = _wine_item(wine, by_glass=by_glass, quantity=1)
            if item.external_item_id in seen:
                continue
            seen.add(item.external_item_id)
            yield {
                "source": ANY_SOURCE,
                "external_item_id": item.external_item_id,
                "item_name": item.name,
                "category": item.category,
                "is_wine": True,
                # SimPOS decision B36: sale_unit is read from the mapping row and
                # NEVER inferred from the item name in pos-hub.service.ts. Without
                # this, every sale — bottle or glass — queues in
                # pos_unresolved_lines rather than depleting anything, because
                # `resolveWine` only returns an inventoryId/saleUnit from a
                # mapping hit (decision B21).
                "sale_unit": "glass" if by_glass else "bottle",
                # The sim wine identity. `master_wine_id` is intentionally left
                # unset: the provisional sim wine rows are created by
                # scripts/synth's seed under uuid5(sim.wine.<hash>), and asserting
                # an id here that the tenant may not have would produce a mapping
                # pointing at nothing. The hash is carried so a seeded tenant can
                # be joined to it.
                "signature_hash": item.signature_hash,
            }


def food_mappings() -> Iterator[dict[str, Any]]:
    """Explicit `is_wine: false` rows for food.

    Not redundant. Without them the keyword heuristic still runs on food names, and
    a future addition to `WINE_WORDS` could start classifying "Rosemary Focaccia"
    as wine and inflate depletion for wine nobody poured. An explicit negative
    mapping is a lock, and `scripts/test_simulate.py` already asserts none of the
    current food names trip the heuristic.
    """
    for name, category, _price in FOOD_ITEMS:
        yield {
            "source": ANY_SOURCE,
            "external_item_id": _sim_uuid("food", name),
            "item_name": name,
            "category": category,
            "is_wine": False,
        }


def build_mappings(wine_list: WineList, *, include_food: bool = True) -> list[dict[str, Any]]:
    rows = list(wine_mappings(wine_list))
    if include_food:
        rows.extend(food_mappings())
    return rows


def to_upsert_body(row: dict[str, Any], *, inventory_id: str | None = None) -> dict[str, Any]:
    """Shape `upsertItemMapping` accepts.

    `signature_hash` is dropped: it is our join key, not a column on
    `pos_item_mappings`, and posting an unknown field would be silently ignored at
    best. `inventory_id` is passed through when a caller has resolved it against a
    seeded tenant.
    """
    body = {
        "source": row["source"],
        "external_item_id": row["external_item_id"],
        "item_name": row["item_name"],
        "category": row.get("category"),
        "is_wine": row["is_wine"],
    }
    if inventory_id:
        body["inventory_id"] = inventory_id
    if row.get("sale_unit"):
        # Forward-compatible: `PosHubService.upsertItemMapping` does not
        # currently whitelist this key (verified 2026-08-05 — it destructures
        # source/external_item_id/item_name/category/is_wine/master_wine_id/
        # inventory_id only, so sale_unit is silently dropped on that path).
        # Sending it is still correct: it costs nothing today and stops being a
        # silent gap the moment that whitelist is extended. Direct-SQL seeding
        # is what actually sets sale_unit locally until then.
        body["sale_unit"] = row["sale_unit"]
    return body
