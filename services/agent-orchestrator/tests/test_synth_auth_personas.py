"""Wave 2 — SYNTH-03 / D-17 auth personas mapping (37-02)."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx

from scripts.synth.auth_personas import (
    PERSONA_ROLES,
    ensure_personas,
    required_env,
)


def test_persona_roles_map_three_distinct_ura_roles():
    assert set(PERSONA_ROLES.values()) == {"owner", "manager", "staff"}
    assert len(PERSONA_ROLES) == 3
    assert len(set(PERSONA_ROLES.keys())) == 3


def test_required_env_lists_sim_and_supabase_keys():
    keys = set(required_env())
    for prefix in ("SIM_OWNER", "SIM_MANAGER", "SIM_STAFF"):
        assert f"{prefix}_EMAIL" in keys
        assert f"{prefix}_PASSWORD" in keys
    assert "SUPABASE_URL" in keys
    assert "SUPABASE_SERVICE_ROLE_KEY" in keys


def test_ensure_personas_idempotent_on_422_already_registered():
    env = {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
        "SIM_OWNER_EMAIL": "sim-owner@wineops.internal",
        "SIM_OWNER_PASSWORD": "owner-secret",
        "SIM_MANAGER_EMAIL": "sim-manager@wineops.internal",
        "SIM_MANAGER_PASSWORD": "manager-secret",
        "SIM_STAFF_EMAIL": "sim-staff@wineops.internal",
        "SIM_STAFF_PASSWORD": "staff-secret",
    }
    # Distinct emails required
    assert (
        len({env["SIM_OWNER_EMAIL"], env["SIM_MANAGER_EMAIL"], env["SIM_STAFF_EMAIL"]})
        == 3
    )

    create_responses = []
    for i, role in enumerate(("owner", "manager", "staff")):
        # First call: create; subsequent ensure: 422 already registered
        create_responses.append(
            httpx.Response(
                201,
                json={
                    "id": f"00000000-0000-0000-0000-00000000000{i+1}",
                    "email": env[f"SIM_{role.upper()}_EMAIL"],
                },
            )
        )

    with patch.dict(os.environ, env, clear=False):
        with patch("scripts.synth.auth_personas.httpx.Client") as client_cls:
            client = MagicMock()
            client_cls.return_value = client

            # Sequence: for each persona — create (201), then mirror upsert via rest
            rest_ok = httpx.Response(201, json={})
            side_effects = []
            for cr in create_responses:
                side_effects.append(cr)  # admin create
                side_effects.append(rest_ok)  # public.users upsert
            client.post.side_effect = side_effects

            result = ensure_personas()

    assert set(result.keys()) == {"owner", "manager", "staff"}
    assert result["owner"]["role"] == "owner"
    assert result["manager"]["role"] == "manager"
    assert result["staff"]["role"] == "staff"
    # Distinct auth user ids
    ids = {result[r]["user_id"] for r in ("owner", "manager", "staff")}
    assert len(ids) == 3
    # Never leak secrets into returned structure
    blob = str(result).lower()
    assert "owner-secret" not in blob
    assert "manager-secret" not in blob
    assert "staff-secret" not in blob
    assert "eyj" not in blob


def test_ensure_personas_treats_422_as_ok_and_looks_up_user():
    env = {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
        "SIM_OWNER_EMAIL": "sim-owner@wineops.internal",
        "SIM_OWNER_PASSWORD": "owner-secret",
        "SIM_MANAGER_EMAIL": "sim-manager@wineops.internal",
        "SIM_MANAGER_PASSWORD": "manager-secret",
        "SIM_STAFF_EMAIL": "sim-staff@wineops.internal",
        "SIM_STAFF_PASSWORD": "staff-secret",
    }

    already = httpx.Response(422, json={"msg": "User already registered"})
    listed = httpx.Response(
        200,
        json={
            "users": [
                {
                    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    "email": "sim-owner@wineops.internal",
                },
                {
                    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "email": "sim-manager@wineops.internal",
                },
                {
                    "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    "email": "sim-staff@wineops.internal",
                },
            ]
        },
    )
    rest_ok = httpx.Response(201, json={})

    with patch.dict(os.environ, env, clear=False):
        with patch("scripts.synth.auth_personas.httpx.Client") as client_cls:
            client = MagicMock()
            client_cls.return_value = client

            # Per persona: POST create → 422; GET list; POST users mirror
            client.post.side_effect = [
                already,
                rest_ok,
                already,
                rest_ok,
                already,
                rest_ok,
            ]
            client.get.side_effect = [listed, listed, listed]

            result = ensure_personas()

    assert result["owner"]["user_id"] == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    assert result["manager"]["user_id"] == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    assert result["staff"]["user_id"] == "cccccccc-cccc-cccc-cccc-cccccccccccc"
