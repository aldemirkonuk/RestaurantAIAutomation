#!/usr/bin/env python3
"""
ngrok Live Test Script — E2E-v2-05
====================================
Enables real Toast data testing via ngrok tunnel.

Usage:
  1. Install ngrok: brew install ngrok/ngrok/ngrok
  2. Start the FastAPI app: uvicorn main:app --port 8000 (from services/agent-orchestrator/)
  3. Start ngrok: ngrok http 8000
  4. Copy the ngrok HTTPS URL (e.g. https://abc123.ngrok.io)
  5. Run this script:
       python3 scripts/ngrok_live_test.py --url https://abc123.ngrok.io

What this script does:
  a) Health-checks the local app via the ngrok URL
  b) Sends a mock Toast webhook to verify the pipeline is live
  c) Optionally imports historical Toast orders (if --import-history flag used)
  d) Prints setup instructions for registering the ngrok URL in Toast dashboard

Requirements:
  - uvicorn running locally on port 8000 with MOCK_POS=false in .env
  - TOAST_WEBHOOK_SECRET set in .env and matching the value in Toast dashboard
  - ngrok installed and tunnel active (ngrok http 8000)
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timezone

# Attempt to use httpx or fall back to urllib
try:
    import httpx

    HTTP_CLIENT = "httpx"
except ImportError:
    import urllib.request
    import urllib.error

    HTTP_CLIENT = "urllib"


# ---------------------------------------------------------------------------
# Sample Toast payload for smoke-testing the pipeline
# ---------------------------------------------------------------------------


def make_test_payload(restaurant_guid: str, order_guid: str = None) -> dict:
    """Build a realistic Toast webhook payload for a single wine bottle sale."""
    if order_guid is None:
        order_guid = f"ngrok-test-{int(time.time())}"
    return {
        "order_guid": order_guid,
        "event_type": "OrderCompleted",
        "eventType": "OrderCompleted",
        "restaurant_id": restaurant_guid,
        "data": {
            "order": {
                "guid": order_guid,
                "restaurantGuid": restaurant_guid,
                "closedDate": datetime.now(timezone.utc).isoformat(),
                "selections": [
                    {
                        "guid": f"{order_guid}-sel-001",
                        "itemGroup": {"name": "Caymus Cabernet 2021"},
                        "menuGroup": {
                            "name": "Bottle Wine",
                            "category": "Bottle Wine",
                        },
                        "quantity": 1,
                        "preDiscountPrice": 12000,  # $120.00 in cents
                        "voided": False,
                    }
                ],
            }
        },
    }


def sign_payload(payload_bytes: bytes, secret: str) -> str:
    """Compute HMAC-SHA256 signature matching Toast's format.

    Uses hmac.HMAC() (the correct form fixed in Phase 19 — not the deprecated hmac.new()).
    """
    return hmac.HMAC(
        secret.encode(),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()


# ---------------------------------------------------------------------------
# HTTP helpers (httpx or urllib fallback)
# ---------------------------------------------------------------------------


def post_json(url: str, payload: dict, headers: dict = None) -> dict:
    """POST JSON and return parsed response."""
    body = json.dumps(payload).encode()
    headers = headers or {}
    headers.setdefault("Content-Type", "application/json")

    if HTTP_CLIENT == "httpx":
        response = httpx.post(url, content=body, headers=headers, timeout=15)
        try:
            return {"status_code": response.status_code, "body": response.json()}
        except Exception:
            return {"status_code": response.status_code, "body": response.text}
    else:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return {"status_code": resp.status, "body": json.loads(resp.read())}
        except urllib.error.HTTPError as e:
            return {"status_code": e.code, "body": str(e.read())}


def get_json(url: str) -> dict:
    """GET and return parsed response."""
    if HTTP_CLIENT == "httpx":
        response = httpx.get(url, timeout=10)
        try:
            return {"status_code": response.status_code, "body": response.json()}
        except Exception:
            return {"status_code": response.status_code, "body": response.text}
    else:
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                return {"status_code": resp.status, "body": json.loads(resp.read())}
        except urllib.error.HTTPError as e:
            return {"status_code": e.code, "body": str(e.read())}


# ---------------------------------------------------------------------------
# Test steps
# ---------------------------------------------------------------------------


def step_health_check(base_url: str) -> bool:
    """Verify the FastAPI app is reachable via ngrok."""
    print(f"\n[1/4] Health check: {base_url}/health")
    try:
        result = get_json(f"{base_url}/health")
        if result["status_code"] == 200:
            print(f"      OK — app is reachable: {result['body']}")
            return True
        else:
            print(f"      FAIL — unexpected status: {result['status_code']}")
            return False
    except Exception as e:
        print(f"      ERROR — {e}")
        print("      Is uvicorn running? (uvicorn main:app --port 8000)")
        return False


def step_smoke_test_webhook(base_url: str, restaurant_guid: str, secret: str) -> bool:
    """Send a single mock Toast webhook and verify it's accepted."""
    print(f"\n[2/4] Smoke test: POST {base_url}/api/v1/pos/webhook/toast")
    payload = make_test_payload(restaurant_guid)
    payload_bytes = json.dumps(payload).encode()
    signature = sign_payload(payload_bytes, secret) if secret else ""

    headers = {}
    if signature:
        headers["Toast-Signature"] = signature

    result = post_json(
        f"{base_url}/api/v1/pos/webhook/toast",
        payload,
        headers=headers,
    )
    if result["status_code"] == 200:
        print(f"      OK — webhook accepted: {result['body']}")
        return True
    elif result["status_code"] == 503:
        print(
            "      FAIL (503) — agents not running. Check RabbitMQ connection in app logs."
        )
        return False
    elif result["status_code"] == 401:
        print(
            "      FAIL (401) — HMAC verification failed. Check TOAST_WEBHOOK_SECRET matches .env."
        )
        return False
    else:
        print(f"      FAIL — {result['status_code']}: {result['body']}")
        return False


def step_print_toast_dashboard_instructions(ngrok_url: str):
    """Print step-by-step instructions for wiring Toast dashboard."""
    print(
        """
[3/4] Toast Dashboard Setup (manual — ngrok URL changes each session)
      ---------------------------------------------------------------
      1. Open: https://www.toasttab.com/restaurants/admin/settings/webhooks
         (ask the restaurant owner to log in)

      2. Add a new webhook endpoint:
           URL:    {url}/api/v1/pos/webhook/toast
           Events: OrderCompleted, OrderItemVoided
           Secret: <value of TOAST_WEBHOOK_SECRET in services/agent-orchestrator/.env>

      3. Click "Test Webhook" in the Toast dashboard to send a ping.
         You should see a 200 response and a log line in uvicorn output.

      Note: ngrok free-tier URLs are ephemeral — repeat step 2 each session.
      Paid ngrok accounts can use a fixed subdomain (ngrok http --subdomain=wineops 8000).
""".format(
            url=ngrok_url
        )
    )


def step_print_historical_import_instructions(base_url: str, restaurant_guid: str):
    """Print curl commands for importing historical Toast orders."""
    print(
        f"""
[4/4] Historical Order Import (optional — requires live Toast API credentials)
      -------------------------------------------------------------------------
      Set TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID in .env, then:

      # 1. Get access token from Toast API
      curl -X POST "https://ws-api.toasttab.com/authentication/v1/authentication/login" \\
        -H "Content-Type: application/json" \\
        -d '{{"clientId": "$TOAST_CLIENT_ID", "clientSecret": "$TOAST_CLIENT_SECRET", "userAccessType": "TOAST_MACHINE_CLIENT"}}'

      # 2. Fetch recent orders (replace TOKEN with access token from step 1)
      curl -X GET "https://ws-api.toasttab.com/orders/v2/ordersBulk?startDate=$(date -u -v-7d +%Y-%m-%dT%H:%M:%S.000Z)&endDate=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \\
        -H "Authorization: Bearer TOKEN" \\
        -H "Toast-Restaurant-External-ID: {restaurant_guid}"

      # 3. Save output to orders.json, then POST each order to the local webhook:
      python3 -c "
import json, subprocess, sys
orders = json.load(open('orders.json'))
for order in orders:
    payload = {{'order_guid': order['guid'], 'event_type': 'OrderCompleted', 'eventType': 'OrderCompleted', 'data': {{'order': order}}}}
    subprocess.run(['curl', '-s', '-X', 'POST', '{base_url}/api/v1/pos/webhook/toast', '-H', 'Content-Type: application/json', '-d', json.dumps(payload)])
    print('Imported:', order.get('guid'))
"
"""
    )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Live ngrok test harness for E2E-v2-05."
    )
    parser.add_argument(
        "--url",
        required=True,
        help="ngrok public HTTPS URL (e.g. https://abc123.ngrok.io)",
    )
    parser.add_argument(
        "--restaurant-guid",
        default=os.getenv(
            "TOAST_RESTAURANT_GUID", "e5d6d489-25fa-4082-9cad-3e9e74225517"
        ),
        help="Toast restaurant GUID (defaults to TOAST_RESTAURANT_GUID env var)",
    )
    parser.add_argument(
        "--secret",
        default=os.getenv("TOAST_WEBHOOK_SECRET", ""),
        help="TOAST_WEBHOOK_SECRET for HMAC signing (defaults to env var)",
    )
    args = parser.parse_args()

    base_url = args.url.rstrip("/")

    print("=" * 60)
    print("WineOps — ngrok Live Test (E2E-v2-05)")
    print("=" * 60)
    print(f"Target: {base_url}")
    print(f"Restaurant GUID: {args.restaurant_guid}")
    print(f"HMAC secret: {'set' if args.secret else 'NOT SET — HMAC will fail'}")

    if not args.secret:
        print("\nWARNING: TOAST_WEBHOOK_SECRET is not set.")
        print(
            "Either set it in services/agent-orchestrator/.env or pass --secret <value>."
        )
        print("The app must be running with MOCK_POS=false for HMAC to be verified.\n")

    ok1 = step_health_check(base_url)
    if not ok1:
        print("\nAborting — app not reachable.")
        sys.exit(1)

    ok2 = step_smoke_test_webhook(base_url, args.restaurant_guid, args.secret)
    step_print_toast_dashboard_instructions(base_url)
    step_print_historical_import_instructions(base_url, args.restaurant_guid)

    print("\n" + "=" * 60)
    if ok2:
        print("LIVE TEST READY — webhook pipeline is working end-to-end.")
        print(
            "Share the ngrok URL with the restaurant owner to configure Toast dashboard."
        )
    else:
        print(
            "SMOKE TEST FAILED — check app logs and fix before sharing with restaurant."
        )
    print("=" * 60)
    sys.exit(0 if ok2 else 1)


if __name__ == "__main__":
    main()
