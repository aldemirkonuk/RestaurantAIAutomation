#!/usr/bin/env python3
"""
One-time Production Setup Script — Phase 25 E2E Infrastructure
================================================================
Creates the permanent e2e-test-restaurant anchor record and the
e2e-test@wineops.internal service account in production Supabase.

Run ONCE before first CI execution. Safe to re-run (idempotent).

Required environment variables:
  SUPABASE_URL              — production Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — service role key (admin access, never git-committed)
  E2E_TEST_EMAIL            — e.g. e2e-test@wineops.internal
  E2E_TEST_PASSWORD         — strong random password (store in GitHub Actions secrets)

Usage:
  export SUPABASE_URL=https://xxxxx.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...
  export E2E_TEST_EMAIL=e2e-test@wineops.internal
  export E2E_TEST_PASSWORD=<strong-random-password>
  python scripts/setup_e2e_anchor.py
"""

import os
import sys

import httpx

REQUIRED_ENV = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "E2E_TEST_EMAIL",
    "E2E_TEST_PASSWORD",
]


def check_env() -> dict:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print(
            f"ERROR: Missing required environment variables: {missing}",
            file=sys.stderr,
        )
        sys.exit(1)
    return {k: os.environ[k] for k in REQUIRED_ENV}


def create_e2e_restaurant(supabase_url: str, service_role_key: str) -> None:
    """Upsert the permanent e2e-test-restaurant anchor record.

    D-02: This record is NEVER deleted — it is the anchor for all e2e test writes.
    The `restaurants` table name is assumed from Supabase schema conventions.
    If the table name differs, update `url` below.
    """
    url = f"{supabase_url}/rest/v1/restaurants"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    payload = {
        "id": "e2e-test-restaurant",
        "name": "E2E Test Restaurant (DO NOT DELETE — Phase 25 anchor)",
        "slug": "e2e-test-restaurant",
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=30.0)
    if resp.status_code in (200, 201, 204):
        print("✓ e2e-test-restaurant anchor record created/verified")
    else:
        # The table might not be named `restaurants`. Print instructions.
        print(
            f"WARNING: POST /rest/v1/restaurants returned {resp.status_code}.\n"
            "If the table name is different, update the `url` variable in "
            "create_e2e_restaurant() and re-run.\n"
            f"Response: {resp.text[:200]}",
            file=sys.stderr,
        )


def create_e2e_service_account(
    supabase_url: str, service_role_key: str, email: str, password: str
) -> None:
    """Create e2e service account via Supabase Auth Admin API.

    D-06: This account is NEVER deleted.
    Role: 'developer' — minimum required for Wave A–G tests.
    """
    url = f"{supabase_url}/auth/v1/admin/users"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"roles": ["developer"]},
        "user_metadata": {"full_name": "E2E Test Service Account (Phase 25)"},
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=30.0)
    if resp.status_code in (200, 201):
        print(f"✓ {email} service account created with role='developer'")
    elif resp.status_code == 422 and (
        "already registered" in resp.text.lower()
        or "already been registered" in resp.text.lower()
    ):
        print(f"✓ {email} already exists (idempotent — no action needed)")
    else:
        print(
            f"ERROR: Failed to create service account: {resp.status_code}\n"
            f"Body: {resp.text[:300]}",
            file=sys.stderr,
        )
        sys.exit(1)


def main() -> None:
    print("=== Phase 25 E2E Production Setup ===")
    env = check_env()
    create_e2e_restaurant(
        supabase_url=env["SUPABASE_URL"],
        service_role_key=env["SUPABASE_SERVICE_ROLE_KEY"],
    )
    create_e2e_service_account(
        supabase_url=env["SUPABASE_URL"],
        service_role_key=env["SUPABASE_SERVICE_ROLE_KEY"],
        email=env["E2E_TEST_EMAIL"],
        password=env["E2E_TEST_PASSWORD"],
    )
    print("\n✓ Setup complete.")
    print("Next step: Add these to GitHub Actions repository secrets:")
    print(f"  E2E_TEST_EMAIL = {env['E2E_TEST_EMAIL']}")
    print("  E2E_TEST_PASSWORD = <the password you set (DO NOT print it here)>")
    print("  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY")
    print("  ADMIN_API_KEY, RAILWAY_ORCHESTRATOR_URL, RABBITMQ_URL, SENTRY_DSN")
    print("  VERCEL_PRODUCTION_URL")


if __name__ == "__main__":
    main()
