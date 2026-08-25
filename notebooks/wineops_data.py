"""WineOps notebook data layer.

Loads live data from Supabase when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
are set (same env vars as the API gateway); otherwise generates SYNTHETIC
data that mirrors the production schema exactly (pos_checks,
restaurant_tables, wine_consumption_log, procurement_orders,
restaurant_inventory). Synthetic mode never writes to the database — it only
exists so every notebook runs end-to-end offline.

Usage:
    from wineops_data import get_checks, get_tables, get_consumption, get_orders, get_inventory
"""

from __future__ import annotations

import os
import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)
RESTAURANT_ID = os.environ.get("WINEOPS_RESTAURANT_ID")

_WINES = [
    ("Caymus Cabernet", "red", 38.0, 110.0),
    ("La Crema Pinot Noir", "red", 18.0, 58.0),
    ("Catena Malbec", "red", 14.0, 46.0),
    ("Barolo Vietti", "red", 52.0, 145.0),
    ("Chianti Classico", "red", 12.0, 40.0),
    ("Sancerre Blanc", "white", 21.0, 62.0),
    ("Chablis 1er Cru", "white", 28.0, 78.0),
    ("Riesling Kabinett", "white", 15.0, 44.0),
    ("Whispering Angel Rosé", "rose", 16.0, 48.0),
    ("Veuve Clicquot Brut", "sparkling", 45.0, 120.0),
]
_FOODS = [
    ("Ribeye", 58.0), ("Branzino", 42.0), ("Duck Breast", 39.0),
    ("Burrata", 19.0), ("Tuna Tartare", 23.0), ("Mushroom Risotto", 28.0),
    ("Lamb Chops", 49.0), ("Caesar Salad", 16.0), ("Oysters (6)", 24.0),
]
# Affinity pairs the basket notebook should recover.
_PAIR_BOOST = {("Ribeye", "Catena Malbec"): 0.55, ("Branzino", "Sancerre Blanc"): 0.5,
               ("Oysters (6)", "Chablis 1er Cru"): 0.6, ("Duck Breast", "La Crema Pinot Noir"): 0.45}
_SERVERS = ["Maya", "Deniz", "Jonah", "Elif", "Sam", "Ada"]
_SERVER_SKILL = {"Maya": 1.18, "Deniz": 1.08, "Jonah": 1.0, "Elif": 0.97, "Sam": 0.92, "Ada": 1.03}


def _client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client  # type: ignore

        return create_client(url, key)
    except Exception as exc:  # pragma: no cover
        print(f"[wineops_data] supabase client unavailable ({exc}); using synthetic data")
        return None


def _fetch(table: str, columns: str = "*", limit: int = 20000) -> pd.DataFrame | None:
    client = _client()
    if client is None:
        return None
    try:
        q = client.table(table).select(columns).limit(limit)
        if RESTAURANT_ID:
            q = q.eq("restaurant_id", RESTAURANT_ID)
        rows = q.execute().data
        if rows:
            print(f"[wineops_data] {table}: {len(rows)} LIVE rows")
            return pd.DataFrame(rows)
        print(f"[wineops_data] {table}: empty — falling back to synthetic")
        return None
    except Exception as exc:
        print(f"[wineops_data] {table}: fetch failed ({exc}) — synthetic fallback")
        return None


# ---------------------------------------------------------------------------
# Synthetic generators (schema-faithful)
# ---------------------------------------------------------------------------

def synth_tables(n: int = 14) -> pd.DataFrame:
    rows = []
    for i in range(n):
        zone = RNG.choice(["dining_room", "bar", "patio", "pool"], p=[0.5, 0.2, 0.2, 0.1])
        rows.append({
            "id": f"tbl-{i+1}", "label": str(i + 1),
            "seats": int(RNG.choice([2, 2, 4, 4, 4, 6, 8])),
            "zone": zone, "is_outdoor": zone in ("patio", "pool"),
            "distance_to_kitchen_m": float(np.round(RNG.uniform(3, 30), 1)),
            "distance_to_bar_m": float(np.round(RNG.uniform(2, 25), 1)),
            "distance_to_pool_m": float(np.round(RNG.uniform(5, 40), 1)),
        })
    return pd.DataFrame(rows)


def synth_checks(days: int = 120, tables: pd.DataFrame | None = None) -> pd.DataFrame:
    """Checks with REAL structure: weekday seasonality, distance effects on
    spend, server skill effects, and planted food↔wine affinities."""
    tables = tables if tables is not None else synth_tables()
    end = pd.Timestamp.utcnow().normalize()
    rows = []
    cid = 0
    for d in range(days):
        day = end - pd.Timedelta(days=days - d)
        dow = day.dayofweek  # 0=Mon
        n_checks = RNG.poisson([14, 15, 17, 20, 30, 34, 24][dow])
        for _ in range(n_checks):
            cid += 1
            t = tables.iloc[int(RNG.integers(0, len(tables)))]
            server = str(RNG.choice(_SERVERS))
            covers = int(np.clip(RNG.poisson(2.4) + 1, 1, t["seats"]))
            # geometry effect: closer to bar → +spend; far from kitchen → −
            geo = 1.0 + 0.012 * (12 - t["distance_to_bar_m"]) - 0.006 * (t["distance_to_kitchen_m"] - 15)
            skill = _SERVER_SKILL[server]
            items, total = [], 0.0
            for _ in range(covers):
                food = _FOODS[int(RNG.integers(0, len(_FOODS)))]
                items.append({"name": food[0], "qty": 1, "price": food[1], "is_wine": False})
                total += food[1]
            # wine attach probability rises with skill and geometry
            base_attach = 0.42 * skill * geo
            for it in list(items):
                boost = max((v for (f, w), v in _PAIR_BOOST.items() if f == it["name"]), default=0.0)
                if RNG.random() < min(0.95, base_attach + boost):
                    if boost and RNG.random() < 0.75:
                        wname = next(w for (f, w) in _PAIR_BOOST if f == it["name"])
                        wine = next(x for x in _WINES if x[0] == wname)
                    else:
                        wine = _WINES[int(RNG.integers(0, len(_WINES)))]
                    glass = RNG.random() < 0.6
                    price = round(wine[3] * (0.28 if glass else 1.0), 2)
                    items.append({"name": wine[0], "qty": 1, "price": price, "is_wine": True})
                    total += price
            opened = day + pd.Timedelta(hours=float(RNG.uniform(17.5, 21.5)))
            dur = float(RNG.uniform(45, 130))
            rows.append({
                "id": f"chk-{cid}", "source": "synthetic",
                "external_check_id": f"ext-{cid}", "table_id": t["id"],
                "server_name": server, "opened_at": opened.isoformat(),
                "closed_at": (opened + pd.Timedelta(minutes=dur)).isoformat(),
                "covers": covers, "total": round(total * geo * skill, 2),
                "tip": round(total * geo * skill * RNG.uniform(0.15, 0.24), 2),
                "items": items,
            })
    return pd.DataFrame(rows)


def synth_consumption(days: int = 180) -> pd.DataFrame:
    end = pd.Timestamp.utcnow().normalize()
    rows = []
    for d in range(days):
        day = end - pd.Timedelta(days=days - d)
        dow_factor = [0.8, 0.85, 0.95, 1.05, 1.5, 1.7, 1.2][day.dayofweek]
        trend = 1.0 + 0.0015 * d
        for i, (name, wtype, _, _) in enumerate(_WINES):
            lam = max(0.05, (2.2 - 0.15 * i) * dow_factor * trend)
            qty = int(RNG.poisson(lam))
            if qty:
                rows.append({
                    "master_wine_id": f"wine-{i}", "wine_name": name,
                    "wine_type": wtype, "quantity": qty,
                    "created_at": (day + pd.Timedelta(hours=20)).isoformat(),
                })
    return pd.DataFrame(rows)


def synth_orders(days: int = 365) -> pd.DataFrame:
    vendors = [("v1", "Grand Cru Imports", 1.0), ("v2", "Coastal Wines", 1.06), ("v3", "Anatolia Cellars", 0.96)]
    end = pd.Timestamp.utcnow().normalize()
    rows = []
    oid = 0
    for w in range(0, days, 7):
        day = end - pd.Timedelta(days=days - w)
        for vid, vname, pricing in vendors:
            if RNG.random() < 0.55:
                oid += 1
                wine = _WINES[int(RNG.integers(0, len(_WINES)))]
                bottles = int(RNG.integers(6, 36))
                lead = float(np.clip(RNG.normal(6 if vid == "v1" else 9, 2.2), 1, 21))
                created = day + pd.Timedelta(hours=10)
                rows.append({
                    "id": f"po-{oid}", "provider_id": vid, "provider_name": vname,
                    "wine_name": wine[0], "bottles_total": bottles,
                    "total_cost": round(bottles * wine[2] * pricing * RNG.uniform(0.95, 1.08), 2),
                    "status": "delivered", "created_at": created.isoformat(),
                    "delivered_at": (created + pd.Timedelta(days=lead)).isoformat(),
                })
    return pd.DataFrame(rows)


def synth_inventory() -> pd.DataFrame:
    return pd.DataFrame([
        {"master_wine_id": f"wine-{i}", "wine_name": n, "wine_type": t,
         "unit_cost": c, "unit_price": p, "stock_live": int(RNG.integers(4, 40))}
        for i, (n, t, c, p) in enumerate(_WINES)
    ])


# ---------------------------------------------------------------------------
# Public loaders: live → synthetic
# ---------------------------------------------------------------------------

def get_tables() -> pd.DataFrame:
    live = _fetch("restaurant_tables")
    return live if live is not None and len(live) >= 4 else synth_tables()


def get_checks() -> pd.DataFrame:
    live = _fetch("pos_checks")
    if live is not None and len(live) >= 50:
        return live
    print("[wineops_data] using synthetic checks (POS feed not connected yet)")
    return synth_checks(tables=get_tables() if live is not None else None)


def get_consumption() -> pd.DataFrame:
    live = _fetch("wine_consumption_log")
    return live if live is not None and len(live) >= 50 else synth_consumption()


def get_orders() -> pd.DataFrame:
    live = _fetch("procurement_orders")
    return live if live is not None and len(live) >= 20 else synth_orders()


def get_inventory() -> pd.DataFrame:
    live = _fetch("restaurant_inventory")
    return live if live is not None and len(live) >= 5 else synth_inventory()


def daily_series(df: pd.DataFrame, date_col: str, value_col: str) -> pd.Series:
    """Dense daily sum series (missing days = 0)."""
    d = df.copy()
    d[date_col] = pd.to_datetime(d[date_col], utc=True, format="ISO8601").dt.normalize()
    s = d.groupby(date_col)[value_col].sum()
    idx = pd.date_range(s.index.min(), s.index.max(), freq="D", tz="UTC")
    return s.reindex(idx, fill_value=0.0)
