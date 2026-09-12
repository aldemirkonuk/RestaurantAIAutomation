"""Post the synthesised Square day at the LOCAL gateway. HTTP only - no DB writes.

  --run i    every corpus event -> POST /pos-hub/webhook/square/<rid>
             with ONLY the genuine Square header (x-square-hmacsha256-signature).
  --run ii   the SAME bytes -> same route, with ONLY X-Pos-Hub-Signature
             (hex HMAC-SHA256 of the raw body, legacy_global rung).
  --run iii  the same day re-rendered as canonical CanonicalCheck payloads ->
             /pos-hub/webhook/generic_webhook/<rid>, legacy signature. The control.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import time
import urllib.error
import urllib.request
from collections import Counter

import sign_square

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "corpus")
WT = os.environ.get("SQUARE_DAY_REPO") or str(
    pathlib.Path(__file__).resolve().parents[3]
)
BASE = "http://localhost:4010/api/v1"
RID = "aaecdb17-a764-46d1-8848-fa693a3d4d72"
LOG = os.environ.get("SQUARE_DAY_GATEWAY_LOG")  # optional: gateway log to sample

# Simulated Square signature key. We are simulating Square, not receiving from it;
# the algorithm/header/concatenation are Square's, which is what the run tests.
SQUARE_SIGNATURE_KEY = "sq0sim-signature-key-meyhouse-20260904"


def root_env_secret() -> str:
    """POS_HUB_WEBHOOK_SECRET from the ROOT .env - ConfigModule lists it first and
    the first file wins, so it is the value the running gateway holds."""
    with open(os.path.join(WT, ".env"), encoding="utf-8") as fh:
        for line in fh:
            k, _, v = line.strip().partition("=")
            if k.strip() == "POS_HUB_WEBHOOK_SECRET":
                return v.strip().strip('"').strip("'")
    raise SystemExit("POS_HUB_WEBHOOK_SECRET not in root .env")


def post(url: str, raw: bytes, headers: dict) -> tuple[int, str]:
    req = urllib.request.Request(url, data=raw, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, r.read().decode("utf-8", "replace")[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:  # noqa: BLE001
        return -1, f"{type(e).__name__}: {e}"[:300]


def log_size() -> int:
    return os.path.getsize(LOG)


def log_since(off: int) -> list[str]:
    with open(LOG, "rb") as fh:
        fh.seek(off)
        return fh.read().decode("utf-8", "replace").splitlines()


def canonical_from_orders() -> list[dict]:
    """Run (iii): the SAME day in the shape scripts/simulate/payloads.py:canonical_check
    emits (CanonicalCheck, apps/api-gateway/src/pos-hub/pos-types.ts). One POST per check,
    matching bridge.py's one-check-per-request transport."""
    ro = json.load(open(os.path.join(HERE, "retrieve_orders.json"), encoding="utf-8"))
    out = []
    for oid, o in ro["orders"].items():
        if not o.get("line_items"):
            continue  # the return order has none
        closed = o.get("closed_at")
        out.append(
            {
                "externalCheckId": oid,
                "openedAt": o["created_at"],
                "closedAt": closed or o["updated_at"],
                "voided": o["state"] == "CANCELED",
                "tableRef": o.get("ticket_name"),
                "serverExternalId": None,
                "serverName": None,
                "covers": None,
                "subtotal": round(
                    (o["total_money"]["amount"] - o["total_tax_money"]["amount"]) / 100,
                    2,
                ),
                "total": round(o["total_money"]["amount"] / 100, 2),
                "tip": round(o["total_tip_money"]["amount"] / 100, 2),
                "items": [
                    {
                        "name": li["name"],
                        "externalItemId": li["catalog_object_id"],
                        "category": None,
                        "qty": float(li["quantity"]),
                        "price": round(li["base_price_money"]["amount"] / 100, 2),
                    }
                    for li in o["line_items"]
                ],
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, choices=["i", "ii", "iii"])
    a = ap.parse_args()

    secret = root_env_secret()
    if a.run == "iii":
        url = f"{BASE}/pos-hub/webhook/generic_webhook/{RID}"
        bodies = [
            (
                f"check-{i:03d}",
                json.dumps(c, separators=(",", ":"), ensure_ascii=False).encode(
                    "utf-8"
                ),
                "canonical_check",
            )
            for i, c in enumerate(canonical_from_orders(), 1)
        ]
    else:
        url = f"{BASE}/pos-hub/webhook/square/{RID}"
        man = json.load(open(os.path.join(HERE, "manifest.json"), encoding="utf-8"))
        bodies = []
        for e in man["events_manifest"]:
            with open(os.path.join(CORPUS, e["file"]), "rb") as fh:
                bodies.append((e["file"], fh.read(), e["kind"]))

    results, statuses, kind_status = [], Counter(), Counter()
    off0 = log_size()
    t0 = time.time()
    for name, raw, kind in bodies:
        if a.run == "i":
            hdrs = {
                sign_square.SQUARE_HEADER: sign_square.square_signature(
                    SQUARE_SIGNATURE_KEY, url, raw
                )
            }
        else:
            hdrs = {
                sign_square.LEGACY_HEADER: sign_square.legacy_signature(secret, raw)
            }
        off = log_size()
        status, body = post(url, raw, hdrs)
        lines = [line for line in log_since(off) if line.strip()]
        statuses[status] += 1
        kind_status[(kind, status)] += 1
        results.append(
            {
                "event": name,
                "kind": kind,
                "bytes": len(raw),
                "headers_sent": list(hdrs.keys()),
                "status": status,
                "response": body,
                "gateway_log_lines": lines[:6],
            }
        )

    all_log = log_since(off0)
    out = {
        "run": a.run,
        "url": url,
        "signature_header": (
            sign_square.SQUARE_HEADER if a.run == "i" else sign_square.LEGACY_HEADER
        ),
        "signature_recipe": (
            "base64(HMAC-SHA256(square_key, notification_url + raw_body))"
            if a.run == "i"
            else "hex(HMAC-SHA256(POS_HUB_WEBHOOK_SECRET, raw_body))"
        ),
        "restaurant_id": RID,
        "posted": len(results),
        "elapsed_s": round(time.time() - t0, 1),
        "status_histogram": {str(k): v for k, v in sorted(statuses.items())},
        "status_by_kind": {f"{k[0]}:{k[1]}": v for k, v in sorted(kind_status.items())},
        "distinct_responses": sorted({r["response"] for r in results})[:8],
        "gateway_log_all": [line for line in all_log if line.strip()],
        "results": results,
    }
    p = os.path.join(HERE, f"results-run-{a.run}.json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(
        json.dumps(
            {
                k: out[k]
                for k in [
                    "run",
                    "url",
                    "posted",
                    "elapsed_s",
                    "status_histogram",
                    "status_by_kind",
                    "distinct_responses",
                ]
            },
            indent=1,
        )
    )
    print(f"-> {p}")


if __name__ == "__main__":
    main()
