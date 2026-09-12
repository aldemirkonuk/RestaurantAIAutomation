"""Render one Meyhouse Palo Alto Friday as a SYNTHESISED Square event stream.

Not captured from Square. Every payload here is built by us to the shapes cited in
research-square-day-9d440f0f.md §1.1-1.12 (Square's public reference pages), because
Square's Sandbox cannot produce a restaurant day (§1.13: no Square for Restaurants,
no terminal, refunds not issuable). The manifest labels every event SYNTHESISED.

Inputs: datasets/sim/venues/meyhouse-palo-alto/profile.json (real menu + hours).
Date: 2026-09-04 (Friday) - lunch 11:45-14:00, dinner 17:00-22:00, America/Los_Angeles.
Deterministic: seed 20260904.
"""

from __future__ import annotations

import json
import os
import pathlib
import random
from datetime import datetime, timedelta, timezone

SEED = 20260904
WT = os.environ.get("SQUARE_DAY_REPO") or str(
    pathlib.Path(__file__).resolve().parents[3]
)
PROFILE = os.path.join(WT, "datasets/sim/venues/meyhouse-palo-alto/profile.json")
OUT = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(OUT, "corpus")

SERVICE_DATE = "2026-09-04"
TZ_OFFSET = timedelta(hours=-7)  # America/Los_Angeles, PDT on 2026-09-04
LOCAL = timezone(TZ_OFFSET, "PDT")
MERCHANT_ID = "MLSIMMEYHOUSE9PA"  # synthesised
LOCATION_ID = "LSIMMEYPALOALTO01"  # synthesised
CURRENCY = "USD"

B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def sqid(rng: random.Random, n: int = 25) -> str:
    return "".join(rng.choice(B62) for _ in range(n))


def uid(rng: random.Random, n: int = 22) -> str:
    return "".join(rng.choice(B62) for _ in range(n))


def evid(rng: random.Random) -> str:
    h = "".join(rng.choice("0123456789abcdef") for _ in range(32))
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def money(dollars: float) -> dict:
    """Square Money: INTEGER MINOR UNITS (spec 1.7)."""
    return {"amount": int(round(float(dollars) * 100)), "currency": CURRENCY}


def local(h: int, m: int, s: int = 0) -> datetime:
    y, mo, d = (int(x) for x in SERVICE_DATE.split("-"))
    return datetime(y, mo, d, h, m, s, tzinfo=LOCAL)


# --------------------------------------------------------------------------
# Catalog: one CatalogItem per menu row, one CatalogItemVariation per sale unit
# (spec 1.11 / 1.7). Glass vs bottle => two distinct catalog_object_ids.
# --------------------------------------------------------------------------
def build_catalog(profile: dict, rng: random.Random) -> tuple[list, dict]:
    menu = profile["menu"]
    items: list[dict] = []

    def add(name, category, variations):
        item_id = sqid(rng)
        vs = []
        for vname, price in variations:
            if price is None:
                continue
            vs.append(
                {
                    "type": "ITEM_VARIATION",
                    "id": sqid(rng),
                    "item_variation_data": {
                        "item_id": item_id,
                        "name": vname,  # "Glass 5oz" / "Bottle" / ...
                        "pricing_type": "FIXED_PRICING",
                        "price_money": money(price),
                    },
                }
            )
        if not vs:
            return
        items.append(
            {
                "type": "ITEM",
                "id": item_id,
                "item_data": {
                    "name": name,
                    "category_name": category,
                    "variations": vs,
                },
            }
        )

    for w in menu["wines_by_glass"]:
        add(
            w["name"],
            "Wine by the Glass",
            [
                ("Glass 5oz", w.get("glass_price")),
                ("Glass 8oz", w.get("glass_price_8oz")),
                ("Bottle", w.get("bottle_price")),
            ],
        )
    for w in menu["wines_by_bottle"]:
        add(w["name"], "Wine", [("Bottle", w.get("bottle_price"))])
    for r in menu["raki_and_spirits"]:
        add(
            r["name"],
            r.get("category") or "Spirits",
            [
                ("Single", r.get("price_single")),
                ("Double", r.get("price_double")),
                ("Half Bottle", r.get("price_half_bottle")),
                ("Bottle", r.get("price_full_bottle")),
                ("Pour", r.get("price")),
            ],
        )
    for c in menu["cocktails"]:
        add(c["name"], "Craft Cocktail", [("Regular", c.get("price"))])
    for c in menu["non_alcoholic"]:
        add(c["name"], "Non-Alcoholic", [("Regular", c.get("price"))])
    for f in menu["food"]:
        add(f["name"], f.get("category") or "Food", [("Regular", f.get("price"))])

    index = {}
    for it in items:
        for v in it["item_data"]["variations"]:
            index[v["id"]] = {
                "item_name": it["item_data"]["name"],
                "category": it["item_data"]["category_name"],
                "variation_name": v["item_variation_data"]["name"],
                "price": v["item_variation_data"]["price_money"]["amount"] / 100.0,
            }
    return items, index


def pick(index: dict, rng: random.Random, *, category_in=None, variation_in=None):
    pool = [
        (k, v)
        for k, v in index.items()
        if (category_in is None or v["category"] in category_in)
        and (variation_in is None or v["variation_name"] in variation_in)
    ]
    return rng.choice(sorted(pool)) if pool else None


# --------------------------------------------------------------------------
# The day
# --------------------------------------------------------------------------
TABLES = [f"T{n}" for n in range(1, 23)]  # dining room
BAR_NAMES = ["Sarah", "Deniz", "Marcus", "Elif", "Jon", "Ayla", "Priya", "Emre"]
TEAM = ["TMSIM01ANIL", "TMSIM02LEYLA", "TMSIM03BURAK", "TMSIM04MIRA", "TMSIM05CAN"]
WINE_CATS = {"Wine by the Glass", "Wine"}
FOOD_CATS_EXCL = {"Wine by the Glass", "Wine", "Craft Cocktail", "Non-Alcoholic"}


def check_times(rng: random.Random):
    """Friday shape: lunch 11:45-14:00; dinner prime 18:30-20:00; jazz 2nd seating
    20:00-21:30 heavier. Plus one deliberate out-of-hours check."""
    slots = []
    for _ in range(11):  # lunch
        slots.append(("lunch", local(11, 45) + timedelta(minutes=rng.randint(0, 100))))
    for _ in range(7):  # early dinner
        slots.append(
            ("dinner_early", local(17, 0) + timedelta(minutes=rng.randint(0, 90)))
        )
    for _ in range(12):  # dinner prime 18:30-20:00
        slots.append(
            ("dinner_prime", local(18, 30) + timedelta(minutes=rng.randint(0, 90)))
        )
    for _ in range(9):  # jazz second seating 20:00-21:30
        slots.append(("jazz", local(20, 0) + timedelta(minutes=rng.randint(0, 90))))
    for _ in range(2):  # late, still inside 22:00
        slots.append(("late", local(21, 30) + timedelta(minutes=rng.randint(0, 25))))
    slots.append(("out_of_hours", local(15, 20)))  # deliberate: between services
    slots.sort(key=lambda s: s[1])
    return slots


def build_order(rng, index, seq, band, opened):
    is_bar = band in ("lunch", "late") and rng.random() < 0.35 or rng.random() < 0.18
    covers = 1 if is_bar else rng.choice([2, 2, 2, 3, 4, 4, 5, 6])
    order_id = sqid(rng)
    lines = []

    def line(cid, qty="1", qty_unit=None):
        meta = index[cid]
        li = {
            "uid": uid(rng),
            "catalog_object_id": cid,  # the VARIATION id (spec 1.7)
            "catalog_version": 1725400000000,
            "name": meta["item_name"],
            "variation_name": meta[
                "variation_name"
            ],  # "Glass 5oz" / "Bottle" - we never read it
            "quantity": qty,  # STRING (spec 1.7)
            "item_type": "ITEM",
            "base_price_money": money(meta["price"]),
            "gross_sales_money": money(meta["price"] * float(qty)),
            "total_tax_money": money(round(meta["price"] * float(qty) * 0.0925, 2)),
            "total_discount_money": money(0),
            "total_money": money(round(meta["price"] * float(qty) * 1.0925, 2)),
        }
        if qty_unit:
            li["quantity_unit"] = qty_unit
        lines.append(li)
        return li

    n_food = covers + rng.randint(0, 2) if not is_bar else rng.randint(0, 2)
    for _ in range(n_food):
        p = pick(index, rng, category_in=None, variation_in={"Regular"})
        if p and p[1]["category"] not in FOOD_CATS_EXCL:
            line(p[0], str(rng.choice([1, 1, 1, 2])))

    n_glass = max(0, covers - rng.randint(0, 1))
    for _ in range(n_glass):
        p = pick(
            index,
            rng,
            category_in={"Wine by the Glass"},
            variation_in={"Glass 5oz", "Glass 8oz"},
        )
        if p:
            line(p[0], str(rng.choice([1, 1, 1, 2])))

    if covers >= 3 and rng.random() < 0.55:
        p = pick(index, rng, category_in=WINE_CATS, variation_in={"Bottle"})
        if p:
            line(p[0], "1")

    if rng.random() < 0.35:
        p = pick(index, rng, category_in={"Craft Cocktail", "Non-Alcoholic"})
        if p:
            line(p[0], "1")

    if rng.random() < 0.22:
        p = pick(index, rng, category_in={"Rakı"}, variation_in={"Single", "Double"})
        if p:
            line(p[0], "1")

    if not lines:
        p = pick(index, rng, category_in={"Craft Cocktail"})
        line(p[0], "1")

    gross = sum(line["gross_sales_money"]["amount"] for line in lines)
    tax = sum(line["total_tax_money"]["amount"] for line in lines)
    total = gross + tax
    tip = int(round(total * rng.choice([0.18, 0.20, 0.20, 0.22, 0.25])))
    dwell = timedelta(minutes=(35 if is_bar else rng.randint(70, 135)))
    closed = opened + dwell
    order = {
        "id": order_id,
        "location_id": LOCATION_ID,
        "reference_id": f"SIM-{seq:03d}",
        "source": {"name": "Square for Restaurants"},
        "ticket_name": (rng.choice(BAR_NAMES) if is_bar else rng.choice(TABLES)),
        "line_items": lines,
        "taxes": [
            {
                "uid": uid(rng),
                "name": "Sales Tax",
                "percentage": "9.25",
                "scope": "ORDER",
                "applied_money": money(tax / 100.0),
            }
        ],
        "created_at": rfc3339(opened),
        "updated_at": rfc3339(closed),
        "closed_at": rfc3339(closed),
        "state": "COMPLETED",
        "version": 1,
        "total_money": {"amount": total, "currency": CURRENCY},
        "total_tax_money": {"amount": tax, "currency": CURRENCY},
        "total_discount_money": money(0),
        "total_tip_money": {"amount": tip, "currency": CURRENCY},
        "total_service_charge_money": money(0),
        "net_amounts": {  # BETA; net = sale - return, incl. tax
            "total_money": {"amount": total, "currency": CURRENCY},
            "tax_money": {"amount": tax, "currency": CURRENCY},
            "discount_money": money(0),
            "tip_money": {"amount": tip, "currency": CURRENCY},
            "service_charge_money": money(0),
        },
        "tenders": [
            {
                "id": sqid(rng),
                "location_id": LOCATION_ID,
                "created_at": rfc3339(closed),
                "type": "CARD",
                "amount_money": {"amount": total, "currency": CURRENCY},
                "tip_money": {"amount": tip, "currency": CURRENCY},
                "payment_id": None,
            }
        ],
    }
    return order, {
        "band": band,
        "opened": opened,
        "closed": closed,
        "is_bar": is_bar,
        "covers": covers,
        "team_member_id": rng.choice(TEAM),
    }


# --------------------------------------------------------------------------
# Envelopes (spec 1.1-1.4, 1.10, 1.11)
# --------------------------------------------------------------------------
def env(rng, etype, dtype, did, obj, at):
    return {
        "merchant_id": MERCHANT_ID,
        "type": etype,
        "event_id": evid(rng),
        "created_at": rfc3339(at),
        "data": {"type": dtype, "id": did, "object": obj},
    }


def main() -> None:
    rng = random.Random(SEED)
    profile = json.load(open(PROFILE, encoding="utf-8"))
    catalog, index = build_catalog(profile, rng)

    slots = check_times(rng)
    orders, meta = [], []
    for i, (band, opened) in enumerate(slots, start=1):
        o, m = build_order(rng, index, i, band, opened)
        orders.append(o)
        meta.append(m)

    # one deliberate fractional-quantity line with a quantity_unit (spec 3.2)
    frac = orders[len(orders) // 2]
    fl = frac["line_items"][0]
    fl["quantity"] = "1.5"
    fl["quantity_unit"] = {"measurement_unit": {"generic_unit": "UNIT"}, "precision": 1}
    _base = fl["base_price_money"]["amount"]
    fl["gross_sales_money"] = {"amount": int(round(_base * 1.5)), "currency": CURRENCY}
    fl["total_tax_money"] = {
        "amount": int(round(_base * 1.5 * 0.0925)),
        "currency": CURRENCY,
    }
    fl["total_money"] = {
        "amount": int(round(_base * 1.5 * 1.0925)),
        "currency": CURRENCY,
    }

    events: list[dict] = []

    def emit(kind, e, note, order_id=None):
        events.append({"kind": kind, "note": note, "order_id": order_id, "envelope": e})

    # 1. catalog ping at open (spec 1.11)
    emit(
        "catalog.version.updated",
        env(
            rng,
            "catalog.version.updated",
            "catalog_version",
            evid(rng),
            {"catalog_version": {"updated_at": rfc3339(local(11, 30))}},
            local(11, 30),
        ),
        "bare 'something changed' ping; names no objects",
    )

    cancel_idx = 7  # one CANCELED check
    refund_idx = 19  # one refunded check
    for idx, (o, m) in enumerate(zip(orders, meta)):
        oid, opened, closed = o["id"], m["opened"], m["closed"]
        emit(
            "order.created",
            env(
                rng,
                "order.created",
                "order_created",
                oid,
                {
                    "order_created": {
                        "created_at": rfc3339(opened),
                        "location_id": LOCATION_ID,
                        "order_id": oid,
                        "state": "OPEN",
                        "version": 1,
                    }
                },
                opened,
            ),
            f"{m['band']} check, {m['covers']} covers, ticket_name={o['ticket_name']!r}",
            oid,
        )

        courses = 2 if m["is_bar"] else 3
        for k in range(courses):
            t = opened + (closed - opened) * (k + 1) / (courses + 2)
            emit(
                "order.updated",
                env(
                    rng,
                    "order.updated",
                    "order_updated",
                    oid,
                    {
                        "order_updated": {
                            "created_at": rfc3339(opened),
                            "location_id": LOCATION_ID,
                            "order_id": oid,
                            "state": "OPEN",
                            "updated_at": rfc3339(t),
                            "version": k + 2,
                        }
                    },
                    t,
                ),
                f"course {k + 1} fired",
                oid,
            )

        final_state = "CANCELED" if idx == cancel_idx else "COMPLETED"
        if final_state == "CANCELED":
            o["state"] = "CANCELED"
            o["closed_at"] = None
        emit(
            "order.updated",
            env(
                rng,
                "order.updated",
                "order_updated",
                oid,
                {
                    "order_updated": {
                        "created_at": rfc3339(opened),
                        "location_id": LOCATION_ID,
                        "order_id": oid,
                        "state": final_state,
                        "updated_at": rfc3339(closed),
                        "version": courses + 2,
                    }
                },
                closed,
            ),
            (
                "the void: state=CANCELED, no line-level void flag exists"
                if final_state == "CANCELED"
                else "close"
            ),
            oid,
        )

        if final_state == "CANCELED":
            continue

        pay_id = sqid(rng)
        o["tenders"][0]["payment_id"] = pay_id
        emit(
            "payment.updated",
            env(
                rng,
                "payment.updated",
                "payment",
                pay_id,
                {
                    "payment": {
                        "id": pay_id,
                        "created_at": rfc3339(closed),
                        "updated_at": rfc3339(closed),
                        "amount_money": o["total_money"],
                        "tip_money": o["total_tip_money"],
                        "total_money": {
                            "amount": o["total_money"]["amount"]
                            + o["total_tip_money"]["amount"],
                            "currency": CURRENCY,
                        },
                        "approved_money": o["total_money"],
                        "status": "COMPLETED",
                        "source_type": "CARD",
                        "card_details": {
                            "status": "CAPTURED",
                            "entry_method": "CONTACTLESS",
                        },
                        "location_id": LOCATION_ID,
                        "order_id": oid,
                        "team_member_id": m["team_member_id"],  # the ONLY staff signal
                        "receipt_number": pay_id[:4],
                        "version_token": uid(rng),
                    }
                },
                closed,
            ),
            "carries the FULL Payment; team_member_id is the only staff id Square emits",
            oid,
        )

        # the refund pair: a RETURN ORDER (new Order) + refund.created (spec 1.10)
        if idx == refund_idx:
            src_line = o["line_items"][0]
            ret_id = sqid(rng)
            amt = src_line["total_money"]["amount"]
            ret_at = closed + timedelta(minutes=12)
            ret_order = {
                "id": ret_id,
                "location_id": LOCATION_ID,
                "state": "COMPLETED",
                "version": 1,
                "created_at": rfc3339(ret_at),
                "updated_at": rfc3339(ret_at),
                "closed_at": rfc3339(ret_at),
                "ticket_name": o["ticket_name"],
                "line_items": [],  # EMPTY on a return order
                "returns": [
                    {
                        "uid": uid(rng),
                        "source_order_id": oid,
                        "return_line_items": [
                            {
                                "uid": uid(rng),
                                "source_line_item_uid": src_line["uid"],
                                "name": src_line["name"],
                                "variation_name": src_line["variation_name"],
                                "catalog_object_id": src_line["catalog_object_id"],
                                "quantity": src_line["quantity"],
                                "base_price_money": src_line["base_price_money"],
                                "gross_return_money": src_line["gross_sales_money"],
                                "total_money": {"amount": amt, "currency": CURRENCY},
                            }
                        ],
                    }
                ],
                "return_amounts": {
                    "total_money": {"amount": amt, "currency": CURRENCY}
                },
                "net_amounts": {
                    "total_money": {
                        "amount": o["total_money"]["amount"] - amt,
                        "currency": CURRENCY,
                    }
                },
                "total_money": {"amount": -amt, "currency": CURRENCY},
            }
            orders.append(ret_order)
            emit(
                "order.created",
                env(
                    rng,
                    "order.created",
                    "order_created",
                    ret_id,
                    {
                        "order_created": {
                            "created_at": rfc3339(ret_at),
                            "location_id": LOCATION_ID,
                            "order_id": ret_id,
                            "state": "OPEN",
                            "version": 1,
                        }
                    },
                    ret_at,
                ),
                "RETURN order: line_items[] is empty; items live in returns[]",
                ret_id,
            )
            ref_id = f"{pay_id}_{sqid(rng, 10)}"
            emit(
                "refund.created",
                env(
                    rng,
                    "refund.created",
                    "refund",
                    ref_id,
                    {
                        "refund": {
                            "id": ref_id,
                            "created_at": rfc3339(ret_at),
                            "updated_at": rfc3339(ret_at),
                            "amount_money": {"amount": amt, "currency": CURRENCY},
                            "status": "COMPLETED",
                            "location_id": LOCATION_ID,
                            "payment_id": pay_id,
                            "order_id": ret_id,
                            "version": 1,
                        }
                    },
                    ret_at,
                ),
                "carries the FULL PaymentRefund; no adapter branch exists for it",
                ret_id,
            )

    # the duplicate: byte-identical redelivery of an already-sent envelope, SAME event_id
    dup_src = next(e for e in events if e["kind"] == "payment.updated")
    events.append(
        {
            "kind": "payment.updated",
            "note": "BYTE-IDENTICAL REDELIVERY - same event_id "
            "(Square's at-least-once, spec 1.1)",
            "order_id": dup_src["order_id"],
            "envelope": dup_src["envelope"],
            "redelivery_of": dup_src["envelope"]["event_id"],
        }
    )

    # write corpus, one JSON per event in posting order
    for f in os.listdir(CORPUS):
        os.remove(os.path.join(CORPUS, f))
    manifest = []
    for i, ev in enumerate(events, start=1):
        fn = f"{i:04d}-{ev['kind'].replace('.', '_')}.json"
        raw = json.dumps(
            ev["envelope"], separators=(",", ":"), sort_keys=False, ensure_ascii=False
        )
        with open(os.path.join(CORPUS, fn), "w", encoding="utf-8") as fh:
            fh.write(raw)
        manifest.append(
            {
                "seq": i,
                "file": fn,
                "kind": ev["kind"],
                "event_id": ev["envelope"]["event_id"],
                "order_id": ev.get("order_id"),
                "redelivery_of": ev.get("redelivery_of"),
                "bytes": len(raw.encode("utf-8")),
                "note": ev["note"],
                "provenance": "SYNTHESISED by gen_square_day.py to Square's "
                "documented shapes; NOT captured from Square",
            }
        )

    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "generator": "gen_square_day.py",
                "seed": SEED,
                "service_date": SERVICE_DATE,
                "timezone": "America/Los_Angeles",
                "venue": "Meyhouse Palo Alto (real menu + hours)",
                "provenance": "EVERY EVENT IS SYNTHESISED. Square Sandbox cannot emit a "
                "restaurant day (spec 1.13). Shapes cited from Square's public "
                "reference pages, spec 1.1-1.12.",
                "checks": len(slots),
                "orders_incl_return": len(orders),
                "events": len(manifest),
                "kinds": {
                    k: sum(1 for m in manifest if m["kind"] == k)
                    for k in sorted({m["kind"] for m in manifest})
                },
                "catalog_objects": len(catalog),
                "catalog_variations": len(index),
                "events_manifest": manifest,
            },
            fh,
            indent=1,
        )

    # the companion RetrieveOrder corpus - what a pull path would return
    with open(os.path.join(OUT, "retrieve_orders.json"), "w", encoding="utf-8") as fh:
        json.dump(
            {
                "note": "RetrieveOrder / BatchRetrieveOrders corpus: the FULL Order for every "
                "order_id the webhooks only point at (spec 3.2). Money in integer "
                "minor units; quantity is a string.",
                "orders": {o["id"]: o for o in orders},
            },
            fh,
            indent=1,
        )
    with open(os.path.join(OUT, "catalog.json"), "w", encoding="utf-8") as fh:
        json.dump({"objects": catalog}, fh, indent=1)

    print(
        json.dumps(
            {
                "events": len(manifest),
                "checks": len(slots),
                "orders": len(orders),
                "catalog_items": len(catalog),
                "variations": len(index),
                "kinds": {
                    k: sum(1 for m in manifest if m["kind"] == k)
                    for k in sorted({m["kind"] for m in manifest})
                },
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
