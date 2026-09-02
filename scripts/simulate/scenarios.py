"""A restaurant's day as a set of named situations, each with what it must produce.

ADR 0093. The founder's request was not "generate traffic" — the simulator already
did that. It was: *the venue opens at twelve, a guest arrives a minute later and
orders a coffee and a glass of wine, a table two minutes later orders five
bottles; show me the product carried every one of those events to the right
place.* That is a measurement, and a measurement needs two halves. This module is
the first half: the day, and the expectation it must satisfy. The second half —
reading the database back and comparing — is the verifier in the SimPOS module.

What is different from `service.py`
-----------------------------------
`generate_service` places every cover on a hard-coded 17:00–23:30 UTC curve. It
knows nothing about when the venue is open, so "at 12:01" was not expressible and
"outside hours" was not detectable. Here, every instant is derived from
`hours.service_windows(...)` in the venue's own timezone, and a scenario that
wants an instant picks it inside a window unless being outside one is the point.

Three properties this file exists to hold
-----------------------------------------
1. **Determinism.** `external_check_id` is
   `uuid5(SIM_SERVICE_NS, "scenario:<archetype>:<date>:<seed>:<scenario>:<n>")`.
   The same inputs reproduce the same checks, so a replay is a no-op at the hub
   rather than a doubled day, and two runs of the same seed produce byte-identical
   expectation JSON.
2. **The expectation mirrors the receiver, it does not assert an opinion.**
   `expect` per wine line is derived by reproducing `resolveWine` +
   `resolveSaleVolume` + `applyStockEffects` from `pos-hub.service.ts`. Where the
   hub queues a line, the expectation says queued; where the hub under-depletes,
   the expectation says under-depleted. The one deliberate exception is
   `void_after_close`, which records what a void *should* do — see that
   scenario's `known_risks`.
3. **Nothing unknown is rendered as a number** (ADR 0020). A scenario that cannot
   be built on this venue's hours declares itself `unverifiable` with a reason
   instead of quietly producing a check that means something else.

Wine names, prices and venues come from `datasets/sim/menus/*.json` and
`datasets/sim/archetypes/*.json`. Nothing here invents one.
"""

from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping

from scripts.simulate.detection import looks_like_wine
from scripts.simulate.hours import (
    WEEKDAYS,
    OperatingHoursError,
    is_open_at,
    parse_operating_hours,
    service_windows,
)
from scripts.simulate.hours import to_json as hours_to_json
from scripts.simulate.payloads import GENERIC_SOURCE, line_idempotency_key
from scripts.simulate.service import (
    DINNER_CURVE,
    FOOD_ITEMS,
    SERVERS,
    SIM_SERVICE_NS,
    Check,
    PouredItem,
    WineList,
    _sim_uuid,
    _wine_item,
    covers_for,
)

#: Bumped only when the shape below changes in a way the verifier must notice.
CONTRACT_VERSION = 1

#: `record_glass_pour` COALESCEs a null `bottle_size_ml` to this
#: (baseline_from_production.sql:1147), and `resolveSaleVolume` uses the same
#: number as the container capacity. The sim seed writes no bottle size, so this
#: is the size the arithmetic actually runs on — recorded, never assumed silently.
RPC_DEFAULT_BOTTLE_ML = 750

#: `restaurant_inventory.pour_size_ml` column DEFAULT
#: (baseline_from_production.sql:3314). Same reasoning as above.
COLUMN_DEFAULT_POUR_ML = 150.0

#: `restaurant_inventory.sale_type` column DEFAULT.
COLUMN_DEFAULT_SALE_TYPE = "bottle"

#: Mirrors the two plausibility bounds in pos-hub.service.ts:28-30.
MIN_PLAUSIBLE_SALE_ML = 10
MAX_PLAUSIBLE_SALE_ML = 30000

#: Every `expect` value an expectation may carry. The verifier switches on these.
EXPECT_VALUES = (
    "food",
    "bottle",
    "volume",
    "unresolved_unmapped",
    "unresolved_no_sale_volume",
    "void_return",
)

#: Top-level keys of `Expectation.to_json()`. Named here so the contract test can
#: assert the set rather than spot-check a few.
CONTRACT_KEYS = (
    "contract_version",
    "source",
    "archetype_id",
    "scenario",
    "seed",
    "service_date",
    "timezone",
    "operating_hours",
    "scenarios",
    "checks",
    "depletion",
    "unresolved",
    "low_stock",
    "outside_hours_count",
    "dropped_check_ids",
    "duplicate_check_ids",
    "voided_check_ids",
    "tables",
    "totals",
)


class ScenarioBuildError(RuntimeError):
    """A scenario could not be built on this venue's hours, menu or inventory."""


# ---------------------------------------------------------------------------
# Inventory snapshot
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class InventoryRow:
    """One `restaurant_inventory` row, as far as depletion arithmetic needs it.

    `bottle_size_ml` and `pour_size_ml` are `None`-able on purpose: they are
    nullable in production and the sim seed writes neither, so the difference
    between "150 because the column defaults to it" and "150 because someone set
    it" is a difference the expectation has to be able to state.
    """

    id: str
    signature_hash: str
    wine_name: str
    master_wine_id: str | None
    stock_live: int
    threshold_min: int
    bottle_size_ml: int | None
    pour_size_ml: float | None
    sale_type: str = COLUMN_DEFAULT_SALE_TYPE
    is_active: bool = True

    @property
    def effective_bottle_ml(self) -> int:
        """What the RPC will actually pour from — its COALESCE, reproduced."""
        return int(self.bottle_size_ml or RPC_DEFAULT_BOTTLE_ML)


def build_inventory_from_archetype(
    archetype_id: str,
    items: Iterable[Mapping[str, Any]],
) -> dict[str, InventoryRow]:
    """The snapshot a dry run uses, computed exactly as `scripts/synth` seeds it.

    `compute_opening_stock` is imported rather than reimplemented: a second
    opinion about opening stock is a second oracle, and the two would drift on
    the first archetype anyone edits. One row per `signature_hash`, deduped in
    snapshot order, the same way `build_seed_plan` dedupes.

    The seed writes `stock_live`, `threshold_min` and nothing about volumes, so
    `bottle_size_ml` is None (no column default) and `pour_size_ml` is the column
    default. Both are recorded as what they are; `params.inventory_defaults` says
    where the numbers came from.
    """
    from scripts.synth.recipes import load_recipe
    from scripts.synth.seed import compute_opening_stock, sim_inventory_id, sim_wine_id

    profile = load_recipe(archetype_id)
    opening_cfg = profile.opening_stock
    threshold_min = int(opening_cfg.get("threshold_min", 5))
    price_tier = (profile.defaults or {}).get("price_tier")

    out: dict[str, InventoryRow] = {}
    for item in items:
        sig = item.get("signature_hash")
        if not sig or sig in out:
            continue
        out[sig] = InventoryRow(
            id=sim_inventory_id(archetype_id, sig),
            signature_hash=sig,
            wine_name=item.get("wine_name") or "",
            master_wine_id=sim_wine_id(sig),
            stock_live=compute_opening_stock(
                item, opening_cfg, restaurant_price_tier=price_tier
            ),
            threshold_min=threshold_min,
            bottle_size_ml=None,
            pour_size_ml=COLUMN_DEFAULT_POUR_ML,
        )
    return out


def inventory_from_rest_rows(
    rows: Iterable[Mapping[str, Any]],
    *,
    signature_by_inventory_id: Mapping[str, str] | None = None,
) -> dict[str, InventoryRow]:
    """The snapshot an `--apply` run uses: live `restaurant_inventory` rows.

    Keyed by `signature_hash` like the archetype path, so every scenario reads one
    shape. Sim inventory ids are deterministic
    (`sim_inventory_id(archetype, signature_hash)`), so the caller inverts that
    map and passes it in rather than this module guessing an archetype.

    A row whose id is not in that map belongs to a wine the simulator cannot pour
    (it is not on the frozen menu). It is dropped rather than invented into the
    snapshot under a made-up hash.
    """
    lookup = dict(signature_by_inventory_id or {})
    out: dict[str, InventoryRow] = {}
    for row in rows:
        row_id = str(row.get("id") or "")
        sig = lookup.get(row_id)
        if not sig:
            continue
        bottle = row.get("bottle_size_ml")
        pour = row.get("pour_size_ml")
        out[sig] = InventoryRow(
            id=row_id,
            signature_hash=sig,
            wine_name=row.get("wine_name") or "",
            master_wine_id=row.get("master_wine_id"),
            stock_live=int(row.get("stock_live") or 0),
            threshold_min=int(row.get("threshold_min") or 0),
            bottle_size_ml=None if bottle in (None, "") else int(bottle),
            pour_size_ml=None if pour in (None, "") else float(pour),
            sale_type=row.get("sale_type") or COLUMN_DEFAULT_SALE_TYPE,
            is_active=bool(row.get("is_active", True)),
        )
    return out


# ---------------------------------------------------------------------------
# The receiver's resolution, mirrored
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SaleVolume:
    """The result of `resolveSaleVolume` — the same three modes, same order."""

    mode: str  # "whole_bottle" | "volume" | "unresolved"
    ml: float | None = None
    reason: str | None = None


def resolve_sale_volume(
    sale_volume_ml: float | None,
    sale_unit: str | None,
    inv: InventoryRow | None,
) -> SaleVolume:
    """Mirror of `resolveSaleVolume` in pos-hub.service.ts (ADR 0011).

    Kept branch-for-branch, in the same precedence: an explicit volume outranks
    the label, `bottle` is a unit move that never consults the inventory row,
    `glass` needs `pour_size_ml` and fails closed without it, and everything else
    fails closed. There is deliberately no "assume a bottle" arm on either side —
    that default is what booked 750ml for every by-the-glass sale across 92
    production mappings, and an expectation that reintroduced it here would
    predict depletion the hub no longer performs.
    """
    label = sale_unit.strip().lower() if isinstance(sale_unit, str) else None

    if sale_volume_ml is not None:
        try:
            ml = float(sale_volume_ml)
        except (TypeError, ValueError):
            return SaleVolume(
                "unresolved", None, f"sale_volume_ml {sale_volume_ml} is not a usable volume"
            )
        if not math.isfinite(ml) or ml < MIN_PLAUSIBLE_SALE_ML:
            return SaleVolume(
                "unresolved", None, f"sale_volume_ml {sale_volume_ml} is not a usable volume"
            )
        capacity = inv.bottle_size_ml if (inv and inv.bottle_size_ml) else RPC_DEFAULT_BOTTLE_ML
        if ml > capacity:
            return SaleVolume(
                "unresolved",
                None,
                f"sale_volume_ml {ml} exceeds the {capacity}ml container it pours from",
            )
        if inv is not None and inv.bottle_size_ml is not None and ml == inv.bottle_size_ml:
            return SaleVolume("whole_bottle")
        return SaleVolume("volume", ml)

    if label == "bottle":
        return SaleVolume("whole_bottle")
    if label == "glass":
        if inv is None or inv.pour_size_ml is None:
            return SaleVolume(
                "unresolved",
                None,
                "sale_unit 'glass' but the inventory row carries no pour_size_ml",
            )
        return SaleVolume("volume", float(inv.pour_size_ml))

    return SaleVolume(
        "unresolved",
        None,
        (
            f"sale_unit '{label}' carries no volume — set sale_volume_ml"
            if label
            else "neither sale_volume_ml nor a derivable sale_unit"
        ),
    )


# ---------------------------------------------------------------------------
# The planned day
# ---------------------------------------------------------------------------


@dataclass
class PlannedLine:
    """One line of a planned check, with what the hub must do to it."""

    line_no: int
    external_item_id: str
    name: str
    qty: int
    price: float
    is_wine: bool
    category: str
    expect: str
    inventory_id: str | None = None
    #: Millilitres per pour — the `p_pour_ml` the RPC receives, NOT qty * ml.
    volume_ml: float | None = None
    #: Whole bottles this line moves (a unit move on `apply_stock_movement`).
    bottles: int = 0
    by_glass: bool = False
    signature_hash: str | None = None
    idempotency_key: str | None = None
    unresolved_reason: str | None = None

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "line_no": self.line_no,
            "external_item_id": self.external_item_id,
            "name": self.name,
            "qty": self.qty,
            "price": round(self.price, 2),
            "is_wine": self.is_wine,
            "expect": self.expect,
            "idempotency_key": self.idempotency_key,
        }
        if self.is_wine:
            out["inventory_id"] = self.inventory_id
            out["volume_ml"] = self.volume_ml
            out["bottles"] = self.bottles
        if self.unresolved_reason:
            out["unresolved_reason"] = self.unresolved_reason
        return out


@dataclass
class PlannedCheck:
    """One check the run will post (or deliberately will not)."""

    external_check_id: str
    scenario: str
    opened_at: datetime
    closed_at: datetime
    covers: int
    table_label: str
    table_seats: int
    server_name: str
    lines: list[PlannedLine] = field(default_factory=list)
    voided: bool = False
    posted: bool = True
    post_count: int = 1
    outside_hours: bool = False
    tip_rate: float = 0.20

    @property
    def server_external_id(self) -> str:
        return _sim_uuid("server", self.server_name)

    @property
    def subtotal(self) -> float:
        return round(sum(line.price * line.qty for line in self.lines), 2)

    @property
    def tip(self) -> float:
        return round(self.subtotal * self.tip_rate, 2)

    @property
    def total(self) -> float:
        return round(self.subtotal + self.tip, 2)

    def to_check(self, *, voided: bool = False) -> Check:
        """The `service.Check` the existing bridge already knows how to post."""
        check = Check(
            external_check_id=self.external_check_id,
            opened_at=self.opened_at,
            closed_at=self.closed_at,
            covers=self.covers,
            table_ref=self.table_label,
            server_name=self.server_name,
            server_external_id=self.server_external_id,
            items=[
                PouredItem(
                    name=line.name,
                    category=line.category,
                    quantity=line.qty,
                    price=line.price,
                    external_item_id=line.external_item_id,
                    is_wine=line.is_wine,
                    signature_hash=line.signature_hash,
                    by_glass=line.by_glass,
                )
                for line in self.lines
            ],
            voided=voided,
        )
        check._tip_rate = self.tip_rate
        return check

    def posts(self) -> list[Check]:
        """Exactly what goes on the wire, in order.

        A dropped check yields nothing. A duplicate yields the same bytes twice.
        A void yields the close first and the void second — the same id, posted
        again with `voided: true`, which is what a POS actually sends.
        """
        if not self.posted:
            return []
        if self.voided:
            return [self.to_check(voided=False), self.to_check(voided=True)]
        return [self.to_check(voided=False) for _ in range(max(1, self.post_count))]

    def to_json(self) -> dict[str, Any]:
        return {
            "external_check_id": self.external_check_id,
            "scenario": self.scenario,
            "opened_at": _iso_z(self.opened_at),
            "closed_at": _iso_z(self.closed_at),
            "voided": self.voided,
            "table_label": self.table_label,
            "covers": self.covers,
            "server_name": self.server_name,
            "subtotal": self.subtotal,
            "total": self.total,
            "tip": self.tip,
            "posted": self.posted,
            "post_count": self.post_count,
            "outside_hours": self.outside_hours,
            "lines": [line.to_json() for line in self.lines],
        }


@dataclass
class ScenarioOutcome:
    """What one scenario contributed, and what it could not."""

    checks: list[PlannedCheck] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)
    #: Set when the scenario cannot be built here. It is NOT an error and NOT a
    #: silent skip: the reason travels into the expectation so the verifier
    #: reports `unverifiable` rather than a pass over nothing (ADR 0020).
    unverifiable: str | None = None


@dataclass
class ScenarioContext:
    """Everything a scenario needs, resolved once."""

    archetype_id: str
    wine_list: WineList
    operating_hours: Mapping[str, Any]
    timezone: str
    service_date: date
    seed: int
    inventory: Mapping[str, InventoryRow]
    mappings: list[dict[str, Any]]
    base_covers: int = 80
    hours_source: str = "unknown"
    inventory_source: str = "unknown"

    def __post_init__(self) -> None:
        parsed = parse_operating_hours(self.operating_hours)
        self._parsed_hours = parsed
        self.windows = service_windows(parsed, self.timezone, self.service_date)
        self._by_external_id = {
            m["external_item_id"]: m for m in self.mappings if m.get("external_item_id")
        }
        self._by_name = {
            str(m["item_name"]).lower(): m for m in self.mappings if m.get("item_name")
        }

    # -- lookups ----------------------------------------------------------

    def mapping_for(self, external_item_id: str | None, name: str) -> dict[str, Any] | None:
        """`resolveWine`'s order: external id first, then an exact name match."""
        if external_item_id and external_item_id in self._by_external_id:
            return self._by_external_id[external_item_id]
        return self._by_name.get((name or "").lower())

    def inventory_for(self, signature_hash: str | None) -> InventoryRow | None:
        return self.inventory.get(signature_hash or "")

    def is_inside_hours(self, instant: datetime) -> bool:
        return is_open_at(self._parsed_hours, self.timezone, instant).open is True

    @property
    def closed_weekdays(self) -> list[str]:
        return [d for d in WEEKDAYS if not self._parsed_hours.get(d)]

    def rng(self, scenario_id: str, salt: str = "") -> random.Random:
        """One generator per (scenario, run). Never a module-level default."""
        return random.Random(
            f"scenario:{self.archetype_id}:{self.service_date.isoformat()}:"
            f"{self.seed}:{scenario_id}:{salt}"
        )

    def check_id(self, scenario_id: str, n: int) -> str:
        return str(
            uuid.uuid5(
                SIM_SERVICE_NS,
                f"scenario:{self.archetype_id}:{self.service_date.isoformat()}:"
                f"{self.seed}:{scenario_id}:{n}",
            )
        )


# ---------------------------------------------------------------------------
# Expectation
# ---------------------------------------------------------------------------


class Expectation:
    """The one document the verifier compares the database against.

    Everything derived here — depletion, low-stock crossings, unresolved counts,
    totals — is computed from the planned checks, never from a scenario's opinion
    about itself. A scenario that thinks it sold a wine down to par and a
    depletion table that disagrees would be two oracles; there is one.
    """

    def __init__(self, ctx: ScenarioContext, scenario_name: str) -> None:
        self.ctx = ctx
        self.scenario_name = scenario_name
        self.checks: list[PlannedCheck] = []
        self.entries: list[dict[str, Any]] = []

    def add(self, scenario: "Scenario", outcome: ScenarioOutcome) -> None:
        self.checks.extend(outcome.checks)
        entry: dict[str, Any] = {
            "id": scenario.id,
            "title": scenario.title,
            "story": scenario.story,
            "check_ids": [c.external_check_id for c in outcome.checks],
            "params": dict(outcome.params),
        }
        if outcome.unverifiable:
            entry["unverifiable"] = outcome.unverifiable
            entry["params"] = {**entry["params"], "unverifiable": outcome.unverifiable}
        self.entries.append(entry)

    # -- derivations ------------------------------------------------------

    def _observable_checks(self) -> list[PlannedCheck]:
        """Checks the database can be asked about. A dropped check cannot be."""
        return [c for c in self.checks if c.posted]

    def _depletion(self) -> list[dict[str, Any]]:
        agg: dict[str, dict[str, Any]] = {}
        for check in self._observable_checks():
            for line in check.lines:
                if not line.inventory_id:
                    continue
                if line.expect not in ("bottle", "volume", "void_return"):
                    continue
                inv = self.ctx.inventory_for(line.signature_hash)
                row = agg.setdefault(
                    line.inventory_id,
                    {
                        "inventory_id": line.inventory_id,
                        "wine_name": inv.wine_name if inv else "",
                        "opening_stock_live": inv.stock_live if inv else 0,
                        "threshold_min": inv.threshold_min if inv else 0,
                        "bottle_size_ml": inv.effective_bottle_ml if inv else RPC_DEFAULT_BOTTLE_ML,
                        "bottles": 0,
                        "pour_ml": 0.0,
                        "void_return": False,
                    },
                )
                # A duplicate is one depletion: `posts()` sends the bytes twice,
                # the hub dedupes on the idempotency key, and the expectation
                # counts the CHECK, never the post.
                if line.expect == "void_return":
                    # Sale then return: the net effect a correct void leaves.
                    row["void_return"] = True
                elif line.expect == "bottle":
                    row["bottles"] += line.bottles
                else:
                    row["pour_ml"] += (line.volume_ml or 0.0) * line.qty

        out: list[dict[str, Any]] = []
        for row in agg.values():
            bottle_ml = row.pop("bottle_size_ml")
            pour_ml = round(row["pour_ml"], 3)
            opened_by_pours = math.ceil(pour_ml / bottle_ml) if pour_ml > 0 else 0
            raw = row["opening_stock_live"] - row["bottles"] - opened_by_pours
            entry = {
                "inventory_id": row["inventory_id"],
                "wine_name": row["wine_name"],
                "opening_stock_live": row["opening_stock_live"],
                "threshold_min": row["threshold_min"],
                "bottles": row["bottles"],
                "pour_ml": pour_ml,
                "bottle_size_ml": bottle_ml,
                "expected_stock_live": max(0, raw),
            }
            if pour_ml > 0:
                # `record_glass_pour` opens a sealed bottle only when the open one
                # cannot cover the pour. `ceil(pour_ml / bottle_ml)` is therefore
                # the MOST bottles the sequence can open — exact when the row
                # starts with no open bottle, an over-estimate when it does. So
                # `expected_stock_live` is a FLOOR: actual stock_live >= it.
                entry["stock_live_is_upper_bound"] = True
                entry["bound_note"] = (
                    "bottles opened by pours is the maximum a pour sequence can "
                    "open, so actual stock_live >= expected_stock_live"
                )
            if raw < 0:
                entry["oversold"] = True
                entry["expected_stock_live_raw"] = raw
                entry["oversold_note"] = (
                    "the plan sells more than the opening stock; apply_stock_movement "
                    "raises 'stock would go negative' rather than going below zero"
                )
            if row["void_return"]:
                entry["void_return"] = True
            out.append(entry)
        return sorted(out, key=lambda r: (r["wine_name"], r["inventory_id"]))

    def _unresolved(self) -> dict[str, Any]:
        by_reason: dict[str, int] = {}
        for check in self._observable_checks():
            for line in check.lines:
                if line.expect == "unresolved_unmapped":
                    by_reason["unmapped"] = by_reason.get("unmapped", 0) + 1
                elif line.expect == "unresolved_no_sale_volume":
                    by_reason["no_sale_volume"] = by_reason.get("no_sale_volume", 0) + 1
        return {
            "count": sum(by_reason.values()),
            "by_reason": dict(sorted(by_reason.items())),
        }

    def _low_stock(self, depletion: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """`stock_live < threshold_min` — the low-stock view's own predicate."""
        out = []
        for row in depletion:
            if row["threshold_min"] and row["expected_stock_live"] < row["threshold_min"]:
                entry = {
                    "inventory_id": row["inventory_id"],
                    "wine_name": row["wine_name"],
                    "threshold_min": row["threshold_min"],
                    "expected_stock_live": row["expected_stock_live"],
                }
                if row.get("stock_live_is_upper_bound"):
                    # A crossing derived from a bound is itself a bound: the
                    # verifier must not fail the run when the venue sits one
                    # bottle above par because a bottle was already open.
                    entry["derived_from_bound"] = True
                out.append(entry)
        return out

    def _tables(self) -> list[dict[str, Any]]:
        seats: dict[str, int] = {}
        for check in self.checks:
            seats[check.table_label] = max(
                seats.get(check.table_label, 0), check.table_seats
            )
        return [
            {"label": label, "seats": seats[label]}
            for label in sorted(seats, key=_table_sort_key)
        ]

    def _totals(self) -> dict[str, Any]:
        posted = self._observable_checks()
        wine_lines = sum(1 for c in posted for line in c.lines if line.is_wine)
        food_lines = sum(1 for c in posted for line in c.lines if not line.is_wine)
        revenue = round(sum(c.total for c in posted if not c.voided), 2)
        return {
            "checks": len(self.checks),
            "posted_checks": len(posted),
            "wine_lines": wine_lines,
            "food_lines": food_lines,
            "revenue": revenue,
            # Said explicitly because `pos_checks` keeps a voided check's total
            # and every reader today sums it (ADR 0093 context). A verifier that
            # compared this figure to a raw SUM(total) without knowing would fail
            # a correct run.
            "revenue_excludes_voided": True,
        }

    def to_json(self) -> dict[str, Any]:
        depletion = self._depletion()
        return {
            "contract_version": CONTRACT_VERSION,
            "source": GENERIC_SOURCE,
            "archetype_id": self.ctx.archetype_id,
            "scenario": self.scenario_name,
            "seed": self.ctx.seed,
            "service_date": self.ctx.service_date.isoformat(),
            "timezone": self.ctx.timezone,
            "operating_hours": hours_to_json(self.ctx._parsed_hours),
            "scenarios": self.entries,
            "checks": [c.to_json() for c in self.checks],
            "depletion": depletion,
            "unresolved": self._unresolved(),
            "low_stock": self._low_stock(depletion),
            "outside_hours_count": sum(
                1 for c in self._observable_checks() if c.outside_hours
            ),
            "dropped_check_ids": [
                c.external_check_id for c in self.checks if not c.posted
            ],
            "duplicate_check_ids": [
                c.external_check_id
                for c in self.checks
                if c.posted and not c.voided and c.post_count > 1
            ],
            "voided_check_ids": [c.external_check_id for c in self.checks if c.voided],
            "tables": self._tables(),
            "totals": self._totals(),
        }


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _iso_z(instant: datetime) -> str:
    return instant.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _table_sort_key(label: str) -> tuple[int, Any]:
    return (0, int(label)) if label.isdigit() else (1, label)


def _seats_for(covers: int) -> int:
    for seats in (2, 4, 6, 8):
        if covers <= seats:
            return seats
    return 10


def _floor_second(instant: datetime) -> datetime:
    return instant.replace(microsecond=0)


def _food_line(line_no: int, name: str, category: str, price: float) -> PlannedLine:
    return PlannedLine(
        line_no=line_no,
        external_item_id=_sim_uuid("food", name),
        name=name,
        qty=1,
        price=price,
        is_wine=False,
        category=category,
        expect="food",
    )


def _pick_food(rng: random.Random, category: str | None = None) -> tuple[str, str, float]:
    pool = [f for f in FOOD_ITEMS if category is None or f[1] == category]
    if not pool:
        raise ScenarioBuildError(f"No FOOD_ITEMS in category {category!r}")
    return rng.choice(pool)


def _wine_line(
    ctx: ScenarioContext,
    wine: Mapping[str, Any],
    *,
    by_glass: bool,
    qty: int,
    line_no: int,
    check_id: str,
    voided: bool = False,
    force_unmapped: bool = False,
) -> PlannedLine:
    """Build one wine line AND derive what the hub will do to it.

    The derivation is the mirror described in this module's docstring, in the
    hub's own order: mapping (external id, then exact name) → inventory id →
    `resolveSaleVolume` → the RPC. Every branch that queues the line in
    `pos_unresolved_lines` is reproduced, including the one that queues a line
    that HAS a mapping but no `inventory_id` — the hub keys that branch on the
    inventory id, not on whether a mapping was found.
    """
    item = _wine_item(dict(wine), by_glass=by_glass, quantity=qty)
    mapping = None if force_unmapped else ctx.mapping_for(item.external_item_id, item.name)

    if mapping is None:
        # No mapping: `resolveWine` falls back to the keyword scan of the NAME.
        is_wine = looks_like_wine(item.name)
        line = PlannedLine(
            line_no=line_no,
            external_item_id=item.external_item_id,
            name=item.name,
            qty=qty,
            price=item.price,
            is_wine=is_wine,
            category=item.category,
            expect="unresolved_unmapped" if is_wine else "food",
            by_glass=by_glass,
            signature_hash=item.signature_hash,
        )
        if is_wine:
            line.unresolved_reason = "no pos_item_mappings row resolves this line to stock"
        return line

    inv = ctx.inventory_for(mapping.get("signature_hash") or item.signature_hash)
    inventory_id = inv.id if inv else None
    line = PlannedLine(
        line_no=line_no,
        external_item_id=item.external_item_id,
        name=item.name,
        qty=qty,
        price=item.price,
        is_wine=bool(mapping.get("is_wine")),
        category=item.category,
        expect="food",
        inventory_id=inventory_id,
        by_glass=by_glass,
        signature_hash=item.signature_hash,
    )
    if not line.is_wine:
        return line
    if inventory_id is None:
        line.expect = "unresolved_unmapped"
        line.unresolved_reason = "no pos_item_mappings row resolves this line to stock"
        return line

    resolved = resolve_sale_volume(mapping.get("sale_volume_ml"), mapping.get("sale_unit"), inv)
    if resolved.mode == "unresolved":
        line.expect = "unresolved_no_sale_volume"
        line.unresolved_reason = resolved.reason
        return line

    line.idempotency_key = line_idempotency_key(
        check_id, item.external_item_id, item.name, line_no
    )
    if voided:
        # B19: every void goes through `apply_stock_movement` with a POSITIVE
        # delta of `qty`, whatever the sale's mode was.
        line.expect = "void_return"
        line.bottles = qty
        if resolved.mode == "volume":
            line.volume_ml = resolved.ml
    elif resolved.mode == "whole_bottle":
        line.expect = "bottle"
        line.bottles = qty
    else:
        line.expect = "volume"
        line.volume_ml = resolved.ml
    return line


def _renumber(lines: list[PlannedLine], check_id: str) -> list[PlannedLine]:
    """Fix `line_no` and every key derived from it after assembling a check.

    Line order is decided when the check is assembled, and the idempotency key
    embeds the index over ALL items — so a key computed while a line was being
    built is only correct if nothing was inserted before it. Recomputing here
    means a scenario can compose its lines in any order without silently
    predicting keys the hub will never write.
    """
    for index, line in enumerate(lines):
        line.line_no = index
        if line.idempotency_key is not None:
            line.idempotency_key = line_idempotency_key(
                check_id, line.external_item_id, line.name, index
            )
    return lines


def _bottle_wines(ctx: ScenarioContext) -> list[dict[str, Any]]:
    """Menu wines that are mapped as bottles AND have an inventory row."""
    out = []
    for wine in ctx.wine_list.bottles:
        sig = wine.get("signature_hash")
        if not sig or sig not in ctx.inventory:
            continue
        item = _wine_item(dict(wine), by_glass=False, quantity=1)
        mapping = ctx.mapping_for(item.external_item_id, item.name)
        if mapping and mapping.get("is_wine"):
            out.append(wine)
    return out


def _glass_wines(ctx: ScenarioContext) -> list[dict[str, Any]]:
    out = []
    for wine in ctx.wine_list.btg:
        sig = wine.get("signature_hash")
        if not sig or sig not in ctx.inventory:
            continue
        item = _wine_item(dict(wine), by_glass=True, quantity=1)
        mapping = ctx.mapping_for(item.external_item_id, item.name)
        if mapping and mapping.get("is_wine"):
            out.append(wine)
    return out


def _require_window(ctx: ScenarioContext, scenario_id: str) -> tuple[datetime, datetime]:
    if not ctx.windows:
        raise ScenarioBuildError(
            f"{scenario_id}: the venue is closed on {ctx.service_date.isoformat()} "
            f"({WEEKDAYS[ctx.service_date.weekday()]}) — no window to place a check in"
        )
    return ctx.windows[0]


def _local(ctx: ScenarioContext, instant: datetime) -> str:
    from zoneinfo import ZoneInfo

    return instant.astimezone(ZoneInfo(ctx.timezone)).strftime("%Y-%m-%d %H:%M")


# ---------------------------------------------------------------------------
# The library
# ---------------------------------------------------------------------------


def build_opening_minute(ctx: ScenarioContext) -> ScenarioOutcome:
    """The founder's first sentence, made executable."""
    scenario_id = "opening_minute"
    start, end = _require_window(ctx, scenario_id)
    rng = ctx.rng(scenario_id)
    glasses = _glass_wines(ctx)
    if not glasses:
        return ScenarioOutcome(
            unverifiable=(
                "no by-the-glass wine on this menu resolves to an inventory row, so "
                "'ordered a coffee and a glass of wine' cannot be built"
            )
        )

    opened = _floor_second(start + timedelta(minutes=1))
    closed = min(_floor_second(opened + timedelta(minutes=40)), end)
    check_id = ctx.check_id(scenario_id, 0)
    coffee_name, coffee_cat, coffee_price = _pick_food(rng, "Coffee")
    wine = glasses[rng.randrange(len(glasses))]
    lines = [
        _food_line(0, coffee_name, coffee_cat, coffee_price),
        _wine_line(ctx, wine, by_glass=True, qty=1, line_no=1, check_id=check_id),
    ]
    check = PlannedCheck(
        external_check_id=check_id,
        scenario=scenario_id,
        opened_at=opened,
        closed_at=closed,
        covers=1,
        table_label=str(rng.randint(1, 24)),
        table_seats=2,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines, check_id),
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    return ScenarioOutcome(
        checks=[check],
        params={
            "opened_local": _local(ctx, opened),
            "window_open_local": _local(ctx, start),
            "coffee": coffee_name,
            "wine": lines[-1].name,
        },
    )


def build_two_tables_two_minutes(ctx: ScenarioContext) -> ScenarioOutcome:
    """Two tables, two minutes apart, one glass then five bottles."""
    scenario_id = "two_tables_two_minutes"
    if not ctx.windows:
        raise ScenarioBuildError(f"{scenario_id}: venue closed on this date")
    rng = ctx.rng(scenario_id)
    bottles = _bottle_wines(ctx)
    glasses = _glass_wines(ctx) or bottles
    if not bottles:
        return ScenarioOutcome(
            unverifiable="no bottle wine on this menu resolves to an inventory row"
        )

    from zoneinfo import ZoneInfo

    tz = ZoneInfo(ctx.timezone)
    target = datetime.combine(ctx.service_date, time(14, 0), tzinfo=tz).astimezone(
        timezone.utc
    )
    placement = "14:00_local"
    base: datetime | None = None
    # Inside a window at 14:00? Otherwise the first open instant after it.
    for start, end in ctx.windows:
        if start <= target < end - timedelta(minutes=3):
            base = target
            break
        if start >= target and end - start > timedelta(minutes=3):
            base = start
            placement = "first_open_minute_after_1400"
            break
    if base is None:
        # Nothing at or after 14:00: fall back to open + 2h, clamped so both
        # checks still land inside the window when the window is long enough.
        first_start, first_end = ctx.windows[0]
        candidate = first_start + timedelta(hours=2)
        latest = first_end - timedelta(minutes=3)
        base = min(candidate, latest) if latest > first_start else candidate
        placement = "fallback_open_plus_2h"
    base = _floor_second(base)
    second = base + timedelta(seconds=120)

    label_a = str(rng.randint(1, 12))
    label_b = str(rng.randint(13, 24))
    glass_wine = glasses[rng.randrange(len(glasses))]
    bottle_wine = bottles[rng.randrange(len(bottles))]

    id_a = ctx.check_id(scenario_id, 0)
    id_b = ctx.check_id(scenario_id, 1)
    lines_a = [_wine_line(ctx, glass_wine, by_glass=True, qty=1, line_no=0, check_id=id_a)]
    lines_b = [_wine_line(ctx, bottle_wine, by_glass=False, qty=5, line_no=0, check_id=id_b)]

    check_a = PlannedCheck(
        external_check_id=id_a,
        scenario=scenario_id,
        opened_at=base,
        closed_at=_floor_second(base + timedelta(minutes=35)),
        covers=2,
        table_label=label_a,
        table_seats=2,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines_a, id_a),
        outside_hours=not ctx.is_inside_hours(base),
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    check_b = PlannedCheck(
        external_check_id=id_b,
        scenario=scenario_id,
        opened_at=second,
        closed_at=_floor_second(second + timedelta(minutes=95)),
        covers=6,
        table_label=label_b,
        table_seats=_seats_for(6),
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines_b, id_b),
        outside_hours=not ctx.is_inside_hours(second),
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    params = {
        "placement": placement,
        "table_a": label_a,
        "table_b": label_b,
        "seconds_apart": 120,
        "bottles_on_table_b": 5,
        "opened_local": [_local(ctx, base), _local(ctx, second)],
    }
    if placement == "fallback_open_plus_2h":
        params["placement_reason"] = (
            "the venue is not open at any time at or after 14:00 on this date, so "
            "the pair is placed two hours after open"
        )
    return ScenarioOutcome(checks=[check_a, check_b], params=params)


def build_service(ctx: ScenarioContext) -> ScenarioOutcome:
    """The day's own traffic, shaped by the hours the venue actually keeps.

    Covers come from `covers_for` — same weekday amplitude, same seasonal drift,
    so a Saturday still carries a restaurant and a Monday still barely does — and
    are then split across EVERY open window in proportion to its length, with the
    two-peak curve stretched to fit each. A venue with a lunch and a dinner
    service gets a peak in both, which the 17:00-UTC curve could not express.
    """
    scenario_id = "service"
    if not ctx.windows:
        return ScenarioOutcome(
            params={"covers": 0},
            unverifiable="the venue is closed on this date — a service has no window to fill",
        )
    rng = ctx.rng(scenario_id)
    covers = covers_for(ctx.service_date, base_covers=ctx.base_covers, seed=ctx.seed)
    spans = [(end - start).total_seconds() for start, end in ctx.windows]
    total_span = sum(spans) or 1.0

    seats: list[tuple[datetime, datetime]] = []
    for (start, end), span in zip(ctx.windows, spans):
        window_covers = int(round(covers * span / total_span))
        for instant in _window_seat_times((start, end), window_covers, rng):
            seats.append((instant, end))
    seats.sort(key=lambda s: s[0])

    bottles = _bottle_wines(ctx)
    glasses = _glass_wines(ctx) or bottles
    if not bottles:
        return ScenarioOutcome(
            unverifiable="no wine on this menu resolves to an inventory row"
        )

    checks: list[PlannedCheck] = []
    idx = 0
    n = 0
    while idx < len(seats):
        party = rng.choices((2, 2, 2, 3, 4, 4, 5, 6), k=1)[0]
        party = min(party, len(seats) - idx)
        opened, window_end = seats[idx]
        idx += party
        check_id = ctx.check_id(scenario_id, n)
        n += 1

        lines: list[PlannedLine] = []
        for _ in range(party + rng.randint(0, 2)):
            fname, fcat, fprice = _pick_food(rng)
            lines.append(_food_line(len(lines), fname, fcat, fprice))

        bottle_bias = 0.22 + 0.11 * party
        if rng.random() < min(0.85, bottle_bias):
            for _ in range(1 if party <= 4 else rng.choice((1, 1, 2))):
                lines.append(
                    _wine_line(
                        ctx,
                        bottles[rng.randrange(len(bottles))],
                        by_glass=False,
                        qty=1,
                        line_no=len(lines),
                        check_id=check_id,
                    )
                )
        n_glasses = (
            rng.choice((0, 0, 1, 1, 2, party)) if party <= 4 else rng.randint(0, party)
        )
        for _ in range(n_glasses):
            lines.append(
                _wine_line(
                    ctx,
                    glasses[rng.randrange(len(glasses))],
                    by_glass=True,
                    qty=1,
                    line_no=len(lines),
                    check_id=check_id,
                )
            )

        duration = timedelta(minutes=rng.randint(55, 135))
        # A check closes at close-out at the latest; the POS does not hold it open
        # past the window it was opened in.
        closed = min(_floor_second(opened + duration), window_end)
        if closed <= opened:
            closed = _floor_second(opened + timedelta(minutes=1))
        checks.append(
            PlannedCheck(
                external_check_id=check_id,
                scenario=scenario_id,
                opened_at=_floor_second(opened),
                closed_at=closed,
                covers=party,
                table_label=str(rng.randint(1, 24)),
                table_seats=_seats_for(party),
                server_name=rng.choice(SERVERS),
                lines=_renumber(lines, check_id),
                tip_rate=round(rng.uniform(0.18, 0.24), 3),
            )
        )

    return ScenarioOutcome(
        checks=checks,
        params={
            "covers": covers,
            "windows": [[_local(ctx, s), _local(ctx, e)] for s, e in ctx.windows],
            "weekday": WEEKDAYS[ctx.service_date.weekday()],
        },
    )


def _window_seat_times(
    window: tuple[datetime, datetime], covers: int, rng: random.Random
) -> list[datetime]:
    """Distribute covers across one window with the peak curve stretched to it."""
    start, end = window
    span = (end - start).total_seconds()
    if covers <= 0 or span <= 0:
        return []
    slot = span / len(DINNER_CURVE)
    total_weight = sum(DINNER_CURVE)
    out: list[datetime] = []
    for index, weight in enumerate(DINNER_CURVE):
        for _ in range(int(round(covers * weight / total_weight))):
            offset = index * slot + rng.uniform(0, slot)
            out.append(_floor_second(start + timedelta(seconds=int(offset))))
    return sorted(out)


def build_sell_through_to_par(ctx: ScenarioContext) -> ScenarioOutcome:
    """Sell one wine below its own par, so the low-stock edge has to fire."""
    scenario_id = "sell_through_to_par"
    if not ctx.windows:
        raise ScenarioBuildError(f"{scenario_id}: venue closed on this date")
    rng = ctx.rng(scenario_id)

    candidates = []
    for wine in _bottle_wines(ctx):
        inv = ctx.inventory_for(wine.get("signature_hash"))
        if inv and inv.threshold_min > 0 and inv.stock_live > inv.threshold_min:
            candidates.append((inv.stock_live - inv.threshold_min, inv.wine_name, wine))
    if not candidates:
        return ScenarioOutcome(
            unverifiable=(
                "no wine on this tenant opens above its threshold_min, so there is no "
                "par to sell through"
            )
        )
    # Smallest gap first: the fewest bottles that still crosses par, and
    # deterministic because the sort key is total.
    candidates.sort(key=lambda c: (c[0], c[1], c[2].get("signature_hash") or ""))
    gap, _name, wine = candidates[0]
    inv = ctx.inventory_for(wine.get("signature_hash"))
    assert inv is not None  # guarded by the candidate filter above
    needed = gap + 1  # one bottle PAST par: the view is `stock_live < threshold_min`

    n_checks = min(4, max(2, math.ceil(needed / 4)))
    per_check = [needed // n_checks] * n_checks
    for i in range(needed % n_checks):
        per_check[i] += 1

    checks: list[PlannedCheck] = []
    start, end = ctx.windows[0]
    usable = max((end - start).total_seconds() - 3600, 600.0)
    for i, qty in enumerate(per_check):
        if qty <= 0:
            continue
        opened = _floor_second(
            start + timedelta(seconds=int(usable * (i + 1) / (len(per_check) + 1)))
        )
        check_id = ctx.check_id(scenario_id, i)
        lines = [
            _wine_line(
                ctx, wine, by_glass=False, qty=qty, line_no=0, check_id=check_id
            )
        ]
        fname, fcat, fprice = _pick_food(rng)
        lines.append(_food_line(len(lines), fname, fcat, fprice))
        checks.append(
            PlannedCheck(
                external_check_id=check_id,
                scenario=scenario_id,
                opened_at=opened,
                closed_at=min(_floor_second(opened + timedelta(minutes=75)), end),
                covers=min(8, max(2, qty * 2)),
                table_label=str(rng.randint(1, 24)),
                table_seats=_seats_for(min(8, max(2, qty * 2))),
                server_name=rng.choice(SERVERS),
                lines=_renumber(lines, check_id),
                tip_rate=round(rng.uniform(0.18, 0.24), 3),
            )
        )

    return ScenarioOutcome(
        checks=checks,
        params={
            "wine": inv.wine_name,
            "inventory_id": inv.id,
            "opening_stock_live": inv.stock_live,
            "threshold_min": inv.threshold_min,
            "bottles_sold": needed,
            "checks": len(checks),
            "crossing": f"{inv.stock_live} -> {inv.stock_live - needed} (< {inv.threshold_min})",
        },
    )


def build_unmapped_item(ctx: ScenarioContext) -> ScenarioOutcome:
    """A POS button nobody mapped, on a wine the heuristic can still smell.

    The line must miss `pos_item_mappings` on BOTH lookups the hub tries — the
    external id and an exact, case-insensitive name match — while still tripping
    `WINE_WORDS`, or it lands as food and proves nothing. So it is built from a
    real presentation of a real menu wine that this menu never mapped: the glass
    button for a bottle-only wine, or the bottle button for a glass-only one.
    Nothing is invented; the id is the same uuid5 the mapped presentation would
    have carried, which is exactly what a new POS button looks like.
    """
    scenario_id = "unmapped_item"
    if not ctx.windows:
        raise ScenarioBuildError(f"{scenario_id}: venue closed on this date")
    rng = ctx.rng(scenario_id)

    btg_sigs = {w.get("signature_hash") for w in ctx.wine_list.btg}
    bottle_sigs = {w.get("signature_hash") for w in ctx.wine_list.bottles}
    choice: tuple[dict[str, Any], bool] | None = None
    for wine in ctx.wine_list.bottles:
        if wine.get("signature_hash") in btg_sigs:
            continue
        if looks_like_wine(_wine_item(dict(wine), by_glass=True, quantity=1).name):
            choice = (wine, True)
            break
    if choice is None:
        for wine in ctx.wine_list.btg:
            if wine.get("signature_hash") in bottle_sigs:
                continue
            if looks_like_wine(_wine_item(dict(wine), by_glass=False, quantity=1).name):
                choice = (wine, False)
                break
    if choice is None:
        return ScenarioOutcome(
            unverifiable=(
                "every presentation of every wine on this menu is mapped, or none of "
                "the unmapped ones trips the hub's WINE_WORDS heuristic — an unmapped "
                "line here would land as food, which is a different measurement"
            )
        )

    wine, by_glass = choice
    start, end = ctx.windows[0]
    opened = _floor_second(start + timedelta(minutes=75))
    if opened >= end:
        opened = _floor_second(start + timedelta(minutes=5))
    check_id = ctx.check_id(scenario_id, 0)
    fname, fcat, fprice = _pick_food(rng)
    lines = [
        _food_line(0, fname, fcat, fprice),
        _wine_line(
            ctx,
            wine,
            by_glass=by_glass,
            qty=1,
            line_no=1,
            check_id=check_id,
            force_unmapped=True,
        ),
    ]
    if lines[-1].expect != "unresolved_unmapped":
        return ScenarioOutcome(
            unverifiable=(
                f"the chosen line resolved as {lines[-1].expect!r} rather than queuing "
                "as unmapped — the menu changed under this scenario"
            )
        )
    check = PlannedCheck(
        external_check_id=check_id,
        scenario=scenario_id,
        opened_at=opened,
        closed_at=min(_floor_second(opened + timedelta(minutes=50)), end),
        covers=2,
        table_label=str(rng.randint(1, 24)),
        table_seats=2,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines, check_id),
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    return ScenarioOutcome(
        checks=[check],
        params={
            "item_name": lines[-1].name,
            "external_item_id": lines[-1].external_item_id,
            "presentation": "glass" if by_glass else "bottle",
            "expected_reason": "unmapped",
        },
    )


def build_void_after_close(ctx: ScenarioContext) -> ScenarioOutcome:
    """Close a check with a bottle on it, then void the same check.

    The expectation records what a void OUGHT to do — the bottle comes back — and
    names, in `known_risks`, the mechanism by which it may not. The verifier
    measures it either way; that is the point of the scenario.
    """
    scenario_id = "void_after_close"
    if not ctx.windows:
        raise ScenarioBuildError(f"{scenario_id}: venue closed on this date")
    rng = ctx.rng(scenario_id)
    bottles = _bottle_wines(ctx)
    if not bottles:
        return ScenarioOutcome(
            unverifiable="no bottle wine on this menu resolves to an inventory row"
        )
    wine = bottles[rng.randrange(len(bottles))]
    start, end = ctx.windows[-1]
    opened = _floor_second(start + timedelta(minutes=40))
    if opened >= end:
        opened = _floor_second(start + timedelta(minutes=2))
    check_id = ctx.check_id(scenario_id, 0)
    lines = [
        _wine_line(
            ctx, wine, by_glass=False, qty=1, line_no=0, check_id=check_id, voided=True
        )
    ]
    check = PlannedCheck(
        external_check_id=check_id,
        scenario=scenario_id,
        opened_at=opened,
        closed_at=min(_floor_second(opened + timedelta(minutes=60)), end),
        covers=2,
        table_label=str(rng.randint(1, 24)),
        table_seats=2,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines, check_id),
        voided=True,
        post_count=2,
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    return ScenarioOutcome(
        checks=[check],
        params={
            "wine": lines[0].name,
            "posts": ["close (voided=false)", "void (voided=true), same check id"],
            "known_risks": [
                # Measured on the SQL, 2026-09-02, not assumed:
                # applyStockEffects computes ONE idempotency key per (check,
                # item, line_no) and uses it for both the sale and the void.
                # apply_stock_movement's first act is
                #   SELECT id FROM inventory_transactions WHERE idempotency_key = $1
                #   IF FOUND THEN RETURN
                # (baseline_from_production.sql:302-305), and the sale wrote a row
                # with that key. So the void of a WHOLE-BOTTLE line is likely to be
                # deduped against its own sale and return nothing. Recorded as the
                # risk, not as the expectation — the verifier decides.
                "the void reuses the sale's idempotency key, and apply_stock_movement "
                "returns early on a key it has already seen (baseline:302-305), so the "
                "return may be silently deduped against the sale it is reversing",
                "B19: a void of a by-the-glass line returns WHOLE BOTTLES, because "
                "record_glass_pour has no reversal mode",
            ],
        },
    )


def build_duplicate_webhook(ctx: ScenarioContext) -> ScenarioOutcome:
    """The same check, posted twice, byte for byte. One depletion, or a bug."""
    scenario_id = "duplicate_webhook"
    if not ctx.windows:
        raise ScenarioBuildError(f"{scenario_id}: venue closed on this date")
    rng = ctx.rng(scenario_id)
    bottles = _bottle_wines(ctx)
    glasses = _glass_wines(ctx) or bottles
    if not bottles:
        return ScenarioOutcome(
            unverifiable="no wine on this menu resolves to an inventory row"
        )
    start, end = ctx.windows[0]
    opened = _floor_second(start + timedelta(minutes=100))
    if opened >= end:
        opened = _floor_second(start + timedelta(minutes=6))
    check_id = ctx.check_id(scenario_id, 0)
    fname, fcat, fprice = _pick_food(rng)
    lines = [
        _food_line(0, fname, fcat, fprice),
        _wine_line(
            ctx,
            bottles[rng.randrange(len(bottles))],
            by_glass=False,
            qty=1,
            line_no=1,
            check_id=check_id,
        ),
        _wine_line(
            ctx,
            glasses[rng.randrange(len(glasses))],
            by_glass=True,
            qty=2,
            line_no=2,
            check_id=check_id,
        ),
    ]
    check = PlannedCheck(
        external_check_id=check_id,
        scenario=scenario_id,
        opened_at=opened,
        closed_at=min(_floor_second(opened + timedelta(minutes=85)), end),
        covers=4,
        table_label=str(rng.randint(1, 24)),
        table_seats=4,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines, check_id),
        post_count=2,
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    return ScenarioOutcome(
        checks=[check],
        params={
            "post_count": 2,
            "expected_depletions": 1,
            "dedupe_key_shape": "pos:<source>:<check>:<item>:<line_no>",
        },
    )


def build_dropped_webhook(ctx: ScenarioContext) -> ScenarioOutcome:
    """A check the POS never delivered. Nothing detects this today."""
    scenario_id = "dropped_webhook"
    if not ctx.windows:
        raise ScenarioBuildError(f"{scenario_id}: venue closed on this date")
    rng = ctx.rng(scenario_id)
    bottles = _bottle_wines(ctx)
    if not bottles:
        return ScenarioOutcome(
            unverifiable="no wine on this menu resolves to an inventory row"
        )
    start, end = ctx.windows[-1]
    opened = _floor_second(start + timedelta(minutes=130))
    if opened >= end:
        opened = _floor_second(start + timedelta(minutes=8))
    check_id = ctx.check_id(scenario_id, 0)
    lines = [
        _wine_line(
            ctx,
            bottles[rng.randrange(len(bottles))],
            by_glass=False,
            qty=1,
            line_no=0,
            check_id=check_id,
        )
    ]
    check = PlannedCheck(
        external_check_id=check_id,
        scenario=scenario_id,
        opened_at=opened,
        closed_at=min(_floor_second(opened + timedelta(minutes=45)), end),
        covers=2,
        table_label=str(rng.randint(1, 24)),
        table_seats=2,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines, check_id),
        posted=False,
        post_count=0,
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    return ScenarioOutcome(
        checks=[check],
        params={
            "posted": False,
            "verdict": "unverifiable",
            # S09's second half. Saying "pass" here would be the exact shape
            # ADR 0093 was written against: absence reported as health.
            "reason": (
                "the check is generated and never sent; no detector for a dropped "
                "webhook exists, so its absence from pos_checks is indistinguishable "
                "from a POS that never fired — the verifier reports unverifiable"
            ),
        },
        unverifiable=(
            "no drop detector exists — absence cannot be told from a sale that never "
            "happened"
        ),
    )


def build_closed_day(ctx: ScenarioContext) -> ScenarioOutcome:
    """A day the venue is shut. Zero checks is the whole expectation."""
    scenario_id = "closed_day"
    closed = ctx.closed_weekdays
    weekday = WEEKDAYS[ctx.service_date.weekday()]
    if not closed:
        return ScenarioOutcome(
            params={
                "closed_weekdays": [],
                "verdict": "unverifiable",
                "reason": "this venue's operating_hours has no closed weekday",
            },
            unverifiable=(
                "this venue is open every weekday, so there is no closed day to "
                "generate zero checks on"
            ),
        )
    if weekday not in closed:
        return ScenarioOutcome(
            params={
                "closed_weekdays": closed,
                "service_date_weekday": weekday,
                "verdict": "unverifiable",
                "reason": (
                    f"the run targets {weekday}, which is an OPEN day; "
                    f"closed_day needs one of {closed}"
                ),
            },
            unverifiable=(
                f"the service date is a {weekday}, on which this venue is open — "
                f"re-run with a date falling on one of {closed}"
            ),
        )
    return ScenarioOutcome(
        checks=[],
        params={
            "closed_day": True,
            "closed_weekdays": closed,
            "service_date_weekday": weekday,
            "expected_checks": 0,
        },
    )


def build_after_hours_order(ctx: ScenarioContext) -> ScenarioOutcome:
    """A check the POS sends when the venue is shut. Recorded and flagged (D3)."""
    scenario_id = "after_hours_order"
    rng = ctx.rng(scenario_id)
    bottles = _bottle_wines(ctx)
    glasses = _glass_wines(ctx) or bottles
    if not glasses:
        return ScenarioOutcome(
            unverifiable="no wine on this menu resolves to an inventory row"
        )

    from zoneinfo import ZoneInfo

    tz = ZoneInfo(ctx.timezone)
    candidates: list[tuple[str, datetime]] = []
    if ctx.windows:
        candidates.append(("last_close_plus_3h", ctx.windows[-1][1] + timedelta(hours=3)))
    for label, day in (
        ("0300_local_next_day", ctx.service_date + timedelta(days=1)),
        ("0300_local_same_day", ctx.service_date),
    ):
        candidates.append(
            (
                label,
                datetime.combine(day, time(3, 0), tzinfo=tz).astimezone(timezone.utc),
            )
        )

    chosen: tuple[str, datetime] | None = None
    for label, instant in candidates:
        if not ctx.is_inside_hours(instant):
            chosen = (label, _floor_second(instant))
            break
    if chosen is None:
        return ScenarioOutcome(
            params={
                "verdict": "unverifiable",
                "reason": "every candidate instant falls inside this venue's hours",
            },
            unverifiable=(
                "this venue is open at every candidate instant (3h after last close, "
                "03:00 local), so an out-of-hours check cannot be placed"
            ),
        )
    placement, opened = chosen
    check_id = ctx.check_id(scenario_id, 0)
    lines = [
        _wine_line(
            ctx,
            glasses[rng.randrange(len(glasses))],
            by_glass=True,
            qty=1,
            line_no=0,
            check_id=check_id,
        )
    ]
    check = PlannedCheck(
        external_check_id=check_id,
        scenario=scenario_id,
        opened_at=opened,
        closed_at=_floor_second(opened + timedelta(minutes=25)),
        covers=1,
        table_label=str(rng.randint(1, 24)),
        table_seats=2,
        server_name=rng.choice(SERVERS),
        lines=_renumber(lines, check_id),
        outside_hours=True,
        tip_rate=round(rng.uniform(0.18, 0.24), 3),
    )
    return ScenarioOutcome(
        checks=[check],
        params={
            "placement": placement,
            "opened_local": _local(ctx, opened),
            # ADR 0093 D3: recorded and flagged, never rejected. Rejecting at
            # ingest loses a real sale on a clock skew or a private event.
            "expected_behaviour": "recorded and flagged, never rejected (ADR 0093 D3)",
        },
    )


# ---------------------------------------------------------------------------
# Registry and composition
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    story: str
    build: Callable[[ScenarioContext], ScenarioOutcome]
    #: True when the scenario decides which DATE the run targets, so it can never
    #: be composed into `random` — it would move the day out from under the rest.
    changes_date: bool = False


LIBRARY: tuple[Scenario, ...] = (
    Scenario(
        "opening_minute",
        "The opening minute",
        "A minute after the doors open, one guest sits down and orders a coffee and a glass of wine.",
        build_opening_minute,
    ),
    Scenario(
        "two_tables_two_minutes",
        "Two tables, two minutes apart",
        "At two in the afternoon a table orders a glass; two minutes later, across the room, another table orders five bottles.",
        build_two_tables_two_minutes,
    ),
    Scenario(
        "service",
        "A full day's service",
        "The whole day as the venue actually keeps it — every open window filled, lunch and dinner each with their own peak.",
        build_service,
    ),
    Scenario(
        "sell_through_to_par",
        "Sold down past par",
        "One wine sells through the day until it drops below the level that is supposed to raise an alert.",
        build_sell_through_to_par,
    ),
    Scenario(
        "unmapped_item",
        "A button nobody mapped",
        "A wine is rung in on a POS button that was never mapped, so the line has to be queued for review rather than silently dropped.",
        build_unmapped_item,
    ),
    Scenario(
        "void_after_close",
        "Voided after close",
        "A check closes with a bottle on it and is then voided, and the bottle has to come back.",
        build_void_after_close,
    ),
    Scenario(
        "duplicate_webhook",
        "The same webhook, twice",
        "The POS delivers one check twice, byte for byte, and it must deplete exactly once.",
        build_duplicate_webhook,
    ),
    Scenario(
        "dropped_webhook",
        "A webhook that never arrived",
        "A check is rung in and the webhook never lands — nothing in the product notices, and the run says so.",
        build_dropped_webhook,
    ),
    Scenario(
        "closed_day",
        "A day the venue is shut",
        "On a day the restaurant does not open, the right amount of traffic is none.",
        build_closed_day,
        changes_date=True,
    ),
    Scenario(
        "after_hours_order",
        "An order after hours",
        "A check arrives hours after the last close, and is recorded and flagged rather than thrown away.",
        build_after_hours_order,
    ),
)

BY_ID: dict[str, Scenario] = {s.id: s for s in LIBRARY}

RANDOM_ID = "random"

#: What `random` may compose onto a service. `closed_day` is excluded because it
#: changes the date; `service` is always included, so it is not in the pool.
RANDOM_POOL: tuple[str, ...] = (
    "opening_minute",
    "two_tables_two_minutes",
    "sell_through_to_par",
    "unmapped_item",
    "void_after_close",
    "duplicate_webhook",
    "dropped_webhook",
    "after_hours_order",
)

SCENARIO_IDS: tuple[str, ...] = tuple([s.id for s in LIBRARY] + [RANDOM_ID])


def compose(scenario: str, seed: int) -> list[str]:
    """Which scenarios a run of `scenario` executes, in order."""
    if scenario != RANDOM_ID:
        if scenario not in BY_ID:
            raise ScenarioBuildError(
                f"Unknown scenario {scenario!r}. Known: {', '.join(SCENARIO_IDS)}"
            )
        return [scenario]
    rng = random.Random(f"compose:{seed}")
    count = rng.randint(2, 5)
    chosen = rng.sample(list(RANDOM_POOL), count)
    # Sorted into library order so the run reads like a day rather than a draw.
    order = {s.id: i for i, s in enumerate(LIBRARY)}
    return ["service"] + sorted(chosen, key=lambda sid: order[sid])


def resolve_service_date(
    scenario: str,
    operating_hours: Mapping[str, Any],
    requested: date,
) -> tuple[date, str]:
    """The date a run targets, and why.

    Only `closed_day` moves it: it needs a weekday the venue is shut, and there
    is no point running it on a day the venue is open. Everything else takes the
    date it was given.
    """
    if scenario != "closed_day":
        return requested, "requested"
    parsed = parse_operating_hours(operating_hours)
    closed = [d for d in WEEKDAYS if not parsed.get(d)]
    if not closed:
        return requested, "no_closed_weekday"
    if WEEKDAYS[requested.weekday()] in closed:
        return requested, "requested"
    for offset in range(1, 8):
        candidate = requested + timedelta(days=offset)
        if WEEKDAYS[candidate.weekday()] in closed:
            return candidate, f"moved_to_next_{WEEKDAYS[candidate.weekday()]}"
    return requested, "no_closed_weekday"


def build_expectation(
    ctx: ScenarioContext, scenario: str
) -> tuple[Expectation, list[tuple[Scenario, ScenarioOutcome]]]:
    """Run every scenario the composition names, into ONE expectation."""
    expectation = Expectation(ctx, scenario)
    outcomes: list[tuple[Scenario, ScenarioOutcome]] = []
    for scenario_id in compose(scenario, ctx.seed):
        definition = BY_ID[scenario_id]
        outcome = definition.build(ctx)
        outcomes.append((definition, outcome))
        expectation.add(definition, outcome)
    return expectation, outcomes


def run_params(ctx: ScenarioContext, scenario: str) -> dict[str, Any]:
    """The `params` column of `sim_scenario_runs` — where the inputs came from.

    Separate from `expected` on purpose: `expected` is what the product must
    produce, `params` is what this run was told. Confusing the two is how a
    harness ends up grading itself against its own assumptions.
    """
    return {
        "scenario": scenario,
        "composed": compose(scenario, ctx.seed),
        "seed": ctx.seed,
        "archetype_id": ctx.archetype_id,
        "base_covers": ctx.base_covers,
        "hours_source": ctx.hours_source,
        "inventory_source": ctx.inventory_source,
        "inventory_defaults": {
            "pour_size_ml": COLUMN_DEFAULT_POUR_ML,
            "bottle_size_ml": RPC_DEFAULT_BOTTLE_ML,
            "source": (
                "restaurant_inventory.pour_size_ml column DEFAULT 150; "
                "record_glass_pour COALESCE(bottle_size_ml, 750) — the sim seed "
                "writes neither, so these are the numbers the RPC runs on"
            ),
        },
        "service_windows_utc": [
            [_iso_z(start), _iso_z(end)] for start, end in ctx.windows
        ],
        "mappings": len(ctx.mappings),
        "inventory_rows": len(ctx.inventory),
    }


__all__ = [
    "CONTRACT_KEYS",
    "CONTRACT_VERSION",
    "EXPECT_VALUES",
    "Expectation",
    "InventoryRow",
    "LIBRARY",
    "BY_ID",
    "PlannedCheck",
    "PlannedLine",
    "RANDOM_ID",
    "RANDOM_POOL",
    "SCENARIO_IDS",
    "Scenario",
    "ScenarioBuildError",
    "ScenarioContext",
    "ScenarioOutcome",
    "build_expectation",
    "build_inventory_from_archetype",
    "compose",
    "inventory_from_rest_rows",
    "resolve_sale_volume",
    "resolve_service_date",
    "run_params",
]
