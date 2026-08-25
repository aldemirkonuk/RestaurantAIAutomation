"""Ensure three distinct SIM_* Auth personas + public.users mirrors (D-17..D-19).

Copies the Admin API pattern from ``setup_e2e_anchor.py`` for owner/manager/staff.
Never logs passwords or JWTs. Auth users are durable across archetypes (URA only).
"""

from __future__ import annotations

import os
import sys
from typing import Any

import httpx

PERSONA_ROLES: dict[str, str] = {
    "owner": "owner",
    "manager": "manager",
    "staff": "staff",
}

_PERSONA_ENV: dict[str, tuple[str, str]] = {
    "owner": ("SIM_OWNER_EMAIL", "SIM_OWNER_PASSWORD"),
    "manager": ("SIM_MANAGER_EMAIL", "SIM_MANAGER_PASSWORD"),
    "staff": ("SIM_STAFF_EMAIL", "SIM_STAFF_PASSWORD"),
}

_SUPABASE_ENV = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")


def required_env() -> list[str]:
    """Return env var names required for ensure_personas / apply_seed."""
    keys: list[str] = list(_SUPABASE_ENV)
    for email_k, pass_k in _PERSONA_ENV.values():
        keys.append(email_k)
        keys.append(pass_k)
    return keys


class PersonaConfigError(RuntimeError):
    """Missing or non-distinct SIM_* credentials."""


def _load_persona_credentials() -> dict[str, dict[str, str]]:
    missing = [k for k in required_env() if not os.environ.get(k)]
    if missing:
        raise PersonaConfigError(f"Missing required environment variables: {missing}")

    creds: dict[str, dict[str, str]] = {}
    emails: list[str] = []
    for role, (email_k, pass_k) in _PERSONA_ENV.items():
        email = os.environ[email_k].strip()
        password = os.environ[pass_k]
        if not email or not password:
            raise PersonaConfigError(f"Empty credential for persona role={role}")
        emails.append(email.lower())
        creds[role] = {"email": email, "password": password}
    if len(set(emails)) != 3:
        raise PersonaConfigError(
            "SIM_OWNER/MANAGER/STAFF emails must be three distinct addresses (D-17)"
        )
    return creds


def _admin_headers(service_role_key: str) -> dict[str, str]:
    return {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
    }


def _create_or_find_user(
    client: httpx.Client,
    *,
    supabase_url: str,
    headers: dict[str, str],
    email: str,
    password: str,
    role: str,
) -> str:
    """Create Auth user via Admin API; on 422 already-registered, look up id."""
    url = f"{supabase_url.rstrip('/')}/auth/v1/admin/users"
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "app_metadata": {"roles": ["sim", role]},
        "user_metadata": {"full_name": f"Sim {role.title()} (Phase 37)", "sim_role": role},
    }
    # Do not log payload — contains password
    resp = client.post(url, json=payload, headers=headers, timeout=30.0)
    if resp.status_code in (200, 201):
        data = resp.json()
        user_id = data.get("id")
        if not user_id:
            raise RuntimeError(f"Auth create for {role} returned no id")
        return str(user_id)

    body_l = (resp.text or "").lower()
    if resp.status_code == 422 and (
        "already registered" in body_l or "already been registered" in body_l
    ):
        user_id = _lookup_user_id(client, supabase_url=supabase_url, headers=headers, email=email)
        if not user_id:
            raise RuntimeError(
                f"Auth user {email!r} already registered but id lookup failed"
            )
        return user_id

    # Never echo response body if it might contain tokens — truncate safely
    raise RuntimeError(
        f"Failed to ensure Auth persona role={role} status={resp.status_code}"
    )


def _lookup_user_id(
    client: httpx.Client,
    *,
    supabase_url: str,
    headers: dict[str, str],
    email: str,
) -> str | None:
    """List admin users and find by email (idempotent path)."""
    # Prefer filter query when supported; fall back to list page.
    url = f"{supabase_url.rstrip('/')}/auth/v1/admin/users"
    resp = client.get(url, headers=headers, params={"page": 1, "per_page": 200}, timeout=30.0)
    if resp.status_code != 200:
        return None
    data = resp.json()
    users = data.get("users") if isinstance(data, dict) else data
    if not isinstance(users, list):
        return None
    target = email.lower()
    for user in users:
        if str(user.get("email", "")).lower() == target:
            return str(user["id"])
    return None


def _upsert_public_user(
    client: httpx.Client,
    *,
    supabase_url: str,
    headers: dict[str, str],
    user_id: str,
    email: str,
    role: str,
) -> None:
    """Mirror Auth user into public.users without bcrypt hand-roll."""
    url = f"{supabase_url.rstrip('/')}/rest/v1/users"
    rest_headers = {
        **headers,
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    # Live public.users has no auth_provider column — mirror Auth id only.
    payload = {
        "user_id": user_id,
        "email": email,
        "name": f"Sim {role.title()}",
        "role": role,
        "email_verified": True,
    }
    resp = client.post(url, json=payload, headers=rest_headers, timeout=30.0)
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(
            f"Failed to upsert public.users mirror for role={role} "
            f"status={resp.status_code} body={resp.text[:300]}"
        )


def ensure_personas(*, client: httpx.Client | None = None) -> dict[str, dict[str, Any]]:
    """Idempotently ensure three Auth users + public.users mirrors.

    Returns ``{role: {user_id, email, role}}`` — never includes password/JWT.
    """
    creds = _load_persona_credentials()
    supabase_url = os.environ["SUPABASE_URL"]
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = _admin_headers(service_key)

    own_client = client is None
    http = client or httpx.Client()
    result: dict[str, dict[str, Any]] = {}
    try:
        for role in ("owner", "manager", "staff"):
            email = creds[role]["email"]
            password = creds[role]["password"]
            user_id = _create_or_find_user(
                http,
                supabase_url=supabase_url,
                headers=headers,
                email=email,
                password=password,
                role=role,
            )
            _upsert_public_user(
                http,
                supabase_url=supabase_url,
                headers=headers,
                user_id=user_id,
                email=email,
                role=role,
            )
            result[role] = {
                "user_id": user_id,
                "email": email,
                "role": PERSONA_ROLES[role],
            }
            # Intentionally do not print email+password; status only
            print(f"✓ sim persona ensured role={role}", file=sys.stderr)
    finally:
        if own_client:
            http.close()

    return result


__all__ = [
    "PERSONA_ROLES",
    "PersonaConfigError",
    "ensure_personas",
    "required_env",
]
