"""READ-ONLY row counts via PostgREST, service role. No writes, ever."""

from __future__ import annotations
import json
import os
import pathlib
import ssl
import sys
import urllib.parse
import urllib.request

WT = os.environ.get("SQUARE_DAY_REPO") or str(
    pathlib.Path(__file__).resolve().parents[3]
)
RID = "aaecdb17-a764-46d1-8848-fa693a3d4d72"
TABLES = [
    "pos_checks",
    "pos_unresolved_lines",
    "wine_consumption_log",
    "inventory_transactions",
]


def load_env(path: str) -> dict:
    out = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _ctx():
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def count(base: str, key: str, table: str, rid: str) -> int | str:
    q = urllib.parse.urlencode({"select": "*", "restaurant_id": f"eq.{rid}"})
    req = urllib.request.Request(f"{base}/rest/v1/{table}?{q}", method="GET")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Prefer", "count=exact")
    req.add_header("Range", "0-0")
    try:
        with urllib.request.urlopen(req, timeout=30, context=_ctx()) as r:
            cr = r.headers.get("Content-Range", "")
            return int(cr.split("/")[-1]) if "/" in cr else -1
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read()[:160].decode('utf-8', 'replace')}"
    except Exception as e:  # noqa: BLE001
        return f"ERR {type(e).__name__}: {e}"


def snapshot(label: str) -> dict:
    env = load_env(os.path.join(WT, "apps/api-gateway/.env"))
    base = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "label": label,
        "restaurant_id": RID,
        "counts": {t: count(base, key, t, RID) for t in TABLES},
    }


if __name__ == "__main__":
    print(
        json.dumps(snapshot(sys.argv[1] if len(sys.argv) > 1 else "snapshot"), indent=2)
    )
