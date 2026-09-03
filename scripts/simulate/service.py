"""A restaurant's service, simulated: covers, checks, and what got poured.

Deterministic in a seed, so a run is reproducible and a regression in anything
downstream is distinguishable from a change in the traffic.

The demand model is deliberately modest. It exists to make the *shape* of a
service realistic enough that analytics and depletion see plausible inputs — two
dinner peaks, weekends heavier than Tuesdays, a slow seasonal drift, a handful of
wines that sell out and stop appearing. It is not a forecasting model and nothing
it produces is evidence about real demand.

What this module refuses to do
------------------------------
It does not invent wine names. Every wine on a check comes from the archetype's
frozen menu snapshot in `datasets/sim/menus/`, which was extracted from a real
restaurant's list. Generated names would sail past the hub's wine-detection
heuristic in ways real names do not, and the hit rate would then be a property of
the generator rather than a measurement of the system.
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterator

#: Deterministic namespace for simulator ids, mirroring scripts/synth/ids.py's
#: approach so a simulated check is recognisable and removable.
SIM_SERVICE_NS = uuid.uuid5(uuid.NAMESPACE_DNS, "wineops.simulate.service")

#: Two dinner peaks with a lull between, expressed as relative weight per
#: half-hour from 17:00 to 23:30. Early seating, a dip, then the late rush.
DINNER_CURVE: tuple[float, ...] = (
    0.35, 0.55, 0.80, 1.00, 0.95, 0.70,  # 17:00-19:30
    0.60, 0.75, 0.95, 1.00, 0.85, 0.60,  # 20:00-22:30
    0.35, 0.20,                          # 23:00-23:30
)
SERVICE_START = time(17, 0)

#: Monday=0. Friday and Saturday carry a restaurant; Monday barely does.
WEEKDAY_AMPLITUDE: tuple[float, ...] = (0.62, 0.70, 0.78, 0.92, 1.25, 1.40, 0.85)


@dataclass
class PouredItem:
    """One line on a check."""

    name: str
    category: str
    quantity: int
    #: Unit price in dollars.
    price: float
    external_item_id: str
    is_wine: bool
    #: Set for wine only — the sim wine identity from the menu snapshot.
    signature_hash: str | None = None
    #: True when sold by the glass rather than as a bottle.
    by_glass: bool = False


@dataclass
class Check:
    """One closed check."""

    external_check_id: str
    opened_at: datetime
    closed_at: datetime
    covers: int
    table_ref: str
    server_name: str
    server_external_id: str
    items: list[PouredItem] = field(default_factory=list)
    #: Whole check voided after close. The hub reverses stock for every line
    #: instead of depleting it (CanonicalCheck.voided, decision B19). Default
    #: False, so every existing caller keeps posting exactly what it posted
    #: before; only the ADR 0093 void scenario ever sets it.
    voided: bool = False

    @property
    def subtotal(self) -> float:
        return round(sum(i.price * i.quantity for i in self.items), 2)

    @property
    def tip(self) -> float:
        # 18-24% on the subtotal, which is where US full-service actually lands.
        return round(self.subtotal * self._tip_rate, 2)

    _tip_rate: float = 0.20

    @property
    def total(self) -> float:
        return round(self.subtotal + self.tip, 2)


#: Non-wine food, so a check is not implausibly all-wine. Names are generic on
#: purpose: they must NOT trip the hub's wine keyword heuristic, and a false
#: positive here would silently inflate the wine-detection hit rate.
FOOD_ITEMS: tuple[tuple[str, str, float], ...] = (
    ("Marinated Olives", "Snacks", 9.0),
    ("Focaccia", "Snacks", 7.0),
    ("Little Gem Salad", "Starters", 16.0),
    ("Beef Tartare", "Starters", 21.0),
    ("Cacio e Pepe", "Pasta", 26.0),
    ("Tagliatelle Bolognese", "Pasta", 29.0),
    ("Roast Chicken", "Mains", 34.0),
    ("Dry-Aged Ribeye", "Mains", 68.0),
    ("Grilled Branzino", "Mains", 41.0),
    ("Olive Oil Cake", "Dessert", 13.0),
    ("Affogato", "Dessert", 11.0),
    ("Sparkling Water", "Drinks", 6.0),
    # Coffee, added for ADR 0093: the founder's opening-minute scenario is "a
    # customer came, ordered a coffee, ordered a wine", and there was no coffee
    # on the list. "Espresso" moved here from ("Espresso", "Drinks", 5.0) rather
    # than being added a second time: `external_item_id` is uuid5 over the NAME
    # alone (`_sim_uuid("food", name)`), so two rows called Espresso would carry
    # ONE external id with two categories and two prices, and `food_mappings`
    # would emit a pair that upsert onto each other.
    ("Espresso", "Coffee", 4.0),
    ("Cappuccino", "Coffee", 5.5),
    ("Filter Coffee", "Coffee", 4.5),
)

SERVERS: tuple[str, ...] = (
    "Devon R.", "Marta S.", "Kwame A.", "Ines B.", "Tobias L.", "Priya N.",
)


def _sim_uuid(*parts: Any) -> str:
    return str(uuid.uuid5(SIM_SERVICE_NS, ":".join(str(p) for p in parts)))


def covers_for(
    day: date,
    *,
    base_covers: int,
    seed: int,
    season_drift: float = 0.0,
) -> int:
    """Covers for one service. Weekday amplitude x seasonal drift x noise."""
    rng = random.Random(f"covers:{seed}:{day.isoformat()}")
    amplitude = WEEKDAY_AMPLITUDE[day.weekday()]
    # A slow sinusoid across the run rather than a trend, so a 60-day window does
    # not end with implausibly double the covers it started with.
    seasonal = 1.0 + season_drift * math.sin(day.timetuple().tm_yday / 58.0)
    noise = rng.uniform(0.86, 1.14)
    return max(1, int(round(base_covers * amplitude * seasonal * noise)))


def _seat_times(day: date, covers: int, seed: int) -> list[datetime]:
    """Distribute covers across the service by the two-peak curve."""
    rng = random.Random(f"seats:{seed}:{day.isoformat()}")
    total_weight = sum(DINNER_CURVE)
    seats: list[datetime] = []
    start = datetime.combine(day, SERVICE_START, tzinfo=timezone.utc)
    for slot, weight in enumerate(DINNER_CURVE):
        n = int(round(covers * weight / total_weight))
        for _ in range(n):
            offset = timedelta(minutes=30 * slot + rng.uniform(0, 30))
            seats.append(start + offset)
    return sorted(seats)


@dataclass
class WineList:
    """The archetype's wines, split into by-the-glass and bottle-only pools."""

    btg: list[dict[str, Any]]
    bottles: list[dict[str, Any]]

    @classmethod
    def from_snapshot(cls, items: list[dict[str, Any]]) -> "WineList":
        btg = [w for w in items if w.get("by_glass_price")]
        bottles = [w for w in items if w.get("bottle_price")]
        if not bottles:
            raise ValueError("Menu snapshot has no wines with a bottle price")
        return cls(btg=btg or bottles, bottles=bottles)


def _wine_item(
    wine: dict[str, Any], *, by_glass: bool, quantity: int
) -> PouredItem:
    price = float(
        (wine.get("by_glass_price") if by_glass else wine.get("bottle_price")) or 0
    )
    producer = (wine.get("producer") or "").strip()
    name = wine.get("wine_name") or "Wine"
    # How it reads on a POS ticket: producer then wine, glass marked. Vintage is
    # omitted because POS buttons usually omit it, which is exactly the ambiguity
    # pos_item_mappings has to resolve.
    display = f"{producer} {name}".strip() if producer else name
    if by_glass:
        display = f"{display} (Glass)"
    return PouredItem(
        name=display,
        category="Wine by the Glass" if by_glass else "Wine",
        quantity=quantity,
        price=price,
        external_item_id=_sim_uuid("item", wine.get("signature_hash") or display, by_glass),
        is_wine=True,
        signature_hash=wine.get("signature_hash"),
        by_glass=by_glass,
    )


def generate_service(
    day: date,
    *,
    wines: WineList,
    base_covers: int,
    seed: int,
    sold_out: set[str] | None = None,
    season_drift: float = 0.12,
) -> Iterator[Check]:
    """Yield the checks for one night's service."""
    sold_out = sold_out or set()
    covers = covers_for(day, base_covers=base_covers, seed=seed, season_drift=season_drift)
    rng = random.Random(f"service:{seed}:{day.isoformat()}")

    available_btg = [w for w in wines.btg if w.get("signature_hash") not in sold_out]
    available_bottles = [
        w for w in wines.bottles if w.get("signature_hash") not in sold_out
    ]
    if not available_btg:
        available_btg = wines.btg
    if not available_bottles:
        available_bottles = wines.bottles

    seats = _seat_times(day, covers, seed)
    idx = 0
    check_no = 0
    while idx < len(seats):
        party = rng.choices((2, 2, 2, 3, 4, 4, 5, 6), k=1)[0]
        party = min(party, len(seats) - idx)
        opened = seats[idx]
        idx += party
        check_no += 1

        duration = timedelta(minutes=rng.randint(55, 135))
        items: list[PouredItem] = []

        # Food: roughly one plate per cover plus shared snacks.
        for _ in range(party + rng.randint(0, 2)):
            fname, fcat, fprice = rng.choice(FOOD_ITEMS)
            items.append(
                PouredItem(
                    name=fname,
                    category=fcat,
                    quantity=1,
                    price=fprice,
                    external_item_id=_sim_uuid("food", fname),
                    is_wine=False,
                )
            )

        # Wine. Larger parties tip toward bottles; pairs drink by the glass.
        bottle_bias = 0.22 + 0.11 * party
        if rng.random() < min(0.85, bottle_bias):
            n_bottles = 1 if party <= 4 else rng.choice((1, 1, 2))
            for _ in range(n_bottles):
                items.append(
                    _wine_item(rng.choice(available_bottles), by_glass=False, quantity=1)
                )
        # Glasses are ordered even when a bottle is, just fewer.
        n_glasses = rng.choice((0, 0, 1, 1, 2, party)) if party <= 4 else rng.randint(0, party)
        for _ in range(n_glasses):
            items.append(
                _wine_item(rng.choice(available_btg), by_glass=True, quantity=1)
            )

        server = rng.choice(SERVERS)
        check = Check(
            # Stable per (seed, day, check number) so a re-run posts the SAME id
            # and the ingress dedupes it instead of doubling the night.
            external_check_id=_sim_uuid("check", seed, day.isoformat(), check_no),
            opened_at=opened,
            closed_at=opened + duration,
            covers=party,
            table_ref=str(rng.randint(1, 24)),
            server_name=server,
            server_external_id=_sim_uuid("server", server),
            items=items,
        )
        check._tip_rate = round(rng.uniform(0.18, 0.24), 3)
        yield check


def wine_units_poured(checks: list[Check]) -> dict[str, float]:
    """Bottle-equivalents poured per wine, keyed by signature_hash.

    A glass is counted as 1/5 of a bottle — the standard 5-pour assumption. This
    is the number that SHOULD show up as depletion downstream, so it is the
    oracle a stock assertion compares against.
    """
    out: dict[str, float] = {}
    for check in checks:
        for item in check.items:
            if not item.is_wine or not item.signature_hash:
                continue
            units = item.quantity * (0.2 if item.by_glass else 1.0)
            out[item.signature_hash] = round(out.get(item.signature_hash, 0.0) + units, 3)
    return out
