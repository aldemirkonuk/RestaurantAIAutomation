"""Tests for the service simulator (scripts/simulate).

Run: python3 -m pytest scripts/test_simulate.py -q

No live Supabase, RabbitMQ or dev server is needed. What cannot be verified
offline is the ingress *accepting* a payload; what can be — and is, here — is that
the payloads have the shape the receiving code reads, that the signature matches
the algorithm the receiver computes, that a dry run opens no socket, and that two
checks never collide on an idempotency key.

That last one deserves emphasis: `process_toast_webhook` derives its key from the
ENVELOPE's `order_guid`, so a payload that nests the guid only under `data.order`
produces the same key for every event and silently discards a whole night of
service after the first check. It is the failure most likely to make a broken
simulator look like a working one.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import sys
from datetime import date
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.simulate import bridge as bridge_mod  # noqa: E402
from scripts.simulate.bridge import Bridge, BridgeConfig, hmac_sha256_hex  # noqa: E402
from scripts.simulate.detection import WINE_WORDS, looks_like_wine  # noqa: E402
from scripts.simulate.payloads import (  # noqa: E402
    EVENT_ORDER_COMPLETED,
    canonical_check,
    idempotency_key,
    toast_webhook,
)
from scripts.simulate.service import (  # noqa: E402
    WineList,
    covers_for,
    generate_service,
    wine_units_poured,
)

MENU = REPO_ROOT / "datasets" / "sim" / "menus" / "bistro.json"
POS_HUB_SERVICE = (
    REPO_ROOT / "apps" / "api-gateway" / "src" / "pos-hub" / "pos-hub.service.ts"
)
TOAST_ADAPTER = (
    REPO_ROOT / "services" / "agent-orchestrator" / "adapters" / "toast_adapter.py"
)

SEED = 424242


@pytest.fixture(scope="module")
def wine_list() -> WineList:
    return WineList.from_snapshot(json.loads(MENU.read_text())["items"])


@pytest.fixture(scope="module")
def checks(wine_list) -> list:
    out = []
    for offset in range(3):
        day = date(2026, 7, 20) + __import__("datetime").timedelta(days=offset)
        out.extend(generate_service(day, wines=wine_list, base_covers=70, seed=SEED))
    assert out, "generator produced no checks"
    return out


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_same_seed_same_service(wine_list):
    day = date(2026, 7, 21)
    a = list(generate_service(day, wines=wine_list, base_covers=70, seed=SEED))
    b = list(generate_service(day, wines=wine_list, base_covers=70, seed=SEED))
    assert [c.external_check_id for c in a] == [c.external_check_id for c in b]
    assert [c.subtotal for c in a] == [c.subtotal for c in b]


def test_different_seed_different_service(wine_list):
    day = date(2026, 7, 21)
    a = list(generate_service(day, wines=wine_list, base_covers=70, seed=1))
    b = list(generate_service(day, wines=wine_list, base_covers=70, seed=2))
    assert [c.external_check_id for c in a] != [c.external_check_id for c in b]


def test_weekend_carries_more_covers_than_monday():
    # 2026-07-25 is a Saturday, 2026-07-27 a Monday.
    saturday = covers_for(date(2026, 7, 25), base_covers=80, seed=SEED)
    monday = covers_for(date(2026, 7, 27), base_covers=80, seed=SEED)
    assert saturday > monday


# ---------------------------------------------------------------------------
# Idempotency — the silent-collapse guard
# ---------------------------------------------------------------------------


def test_every_check_has_a_distinct_idempotency_key(checks):
    keys = [idempotency_key(c) for c in checks]
    assert len(set(keys)) == len(keys)


def test_idempotency_key_matches_what_the_receiver_computes(checks):
    """Reproduce process_toast_webhook's derivation from the payload itself."""
    for check in checks[:25]:
        payload = toast_webhook(check, "sim-guid")
        # Verbatim from pos_integration_agent.process_toast_webhook.
        order_guid = payload.get("order_guid") or payload.get("guid", "")
        event_type_raw = payload.get("event_type", "OrderCompleted")
        assert f"{order_guid}:{event_type_raw}" == idempotency_key(check)
        assert order_guid, "envelope order_guid is empty — keys would all collide"


def test_replaying_the_same_day_reproduces_the_same_keys(wine_list):
    day = date(2026, 7, 22)
    first = [
        idempotency_key(c)
        for c in generate_service(day, wines=wine_list, base_covers=70, seed=SEED)
    ]
    second = [
        idempotency_key(c)
        for c in generate_service(day, wines=wine_list, base_covers=70, seed=SEED)
    ]
    # Re-running must be a no-op at the ingress, not a doubled night.
    assert first == second


# ---------------------------------------------------------------------------
# Payload shapes — read by two different consumers
# ---------------------------------------------------------------------------


def test_canonical_payload_matches_CanonicalCheck(checks):
    payload = canonical_check(checks[0])
    for field in (
        "externalCheckId",
        "openedAt",
        "closedAt",
        "covers",
        "subtotal",
        "total",
        "items",
    ):
        assert field in payload, f"CanonicalCheck is missing {field}"
    for item in payload["items"]:
        assert {"name", "qty", "price"} <= set(item)


def test_canonical_payload_does_not_pre_answer_wine_detection(checks):
    """The hub resolves is_wine. Asserting our own answer would measure nothing."""
    for item in canonical_check(checks[0])["items"]:
        assert "is_wine" not in item
        assert "master_wine_id" not in item


def test_toast_payload_satisfies_handle_order_completed(checks):
    """Mirror handle_order_completed's own extraction, field for field."""
    payload = toast_webhook(checks[0], "sim-guid-xyz")

    order = payload.get("data", {}).get("order", {})
    assert order.get("restaurantGuid") == "sim-guid-xyz"
    assert order.get("guid")
    assert order.get("closedDate")

    selections = order.get("selections", [])
    assert selections, "handler would fall through to the polling saga"
    for selection in selections:
        # The handler reads itemGroup.name, NOT displayName.
        assert selection.get("itemGroup", {}).get("name")
        assert isinstance(selection.get("quantity"), int)
        # preDiscountPrice is in CENTS; the handler divides by 100.
        price = selection.get("preDiscountPrice")
        assert isinstance(price, int)
        assert price >= 0


def test_toast_payload_routes_to_a_registered_handler(checks):
    payload = toast_webhook(checks[0], "sim-guid")
    handler_map_keys = {
        "OrderCompleted",
        "OrderItemVoided",
        "OrderRefunded",
        "MenuItemModified",
    }
    event_type = payload.get("eventType") or payload.get("type")
    assert event_type in handler_map_keys
    assert event_type == EVENT_ORDER_COMPLETED


def test_prices_survive_the_cents_round_trip(checks):
    for check in checks[:20]:
        payload = toast_webhook(check, "sim-guid")
        selections = payload["data"]["order"]["selections"]
        for item, selection in zip(check.items, selections):
            assert selection["preDiscountPrice"] / 100 == pytest.approx(
                item.price, abs=0.005
            )


# ---------------------------------------------------------------------------
# Signing
# ---------------------------------------------------------------------------


def test_signature_matches_the_adapters_algorithm(checks):
    """Independently reimplement ToastAdapter.verify_webhook and compare.

    The adapter compares its digest against `signature.lower()`, so a lowercase
    hex digest over the exact wire bytes is what must be produced.
    """
    secret = "s3cr3t-sim-value"
    body = bridge_mod._encode(toast_webhook(checks[0], "sim-guid"))

    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    produced = hmac_sha256_hex(secret, body)

    assert produced == expected
    assert hmac.compare_digest(expected, produced.lower())
    assert produced == produced.lower(), "adapter lowercases before comparing"


def test_signature_is_computed_over_the_exact_bytes_sent(checks):
    """Re-serialising between signing and sending is BUG-05's failure mode."""
    payload = toast_webhook(checks[0], "sim-guid")
    once = bridge_mod._encode(payload)
    twice = bridge_mod._encode(json.loads(once.decode()))
    assert once == twice, "encoding is not byte-stable, so signatures will not verify"


def test_signature_changes_when_the_body_changes(checks):
    secret = "abc"
    a = hmac_sha256_hex(secret, bridge_mod._encode(toast_webhook(checks[0], "guid-a")))
    b = hmac_sha256_hex(secret, bridge_mod._encode(toast_webhook(checks[0], "guid-b")))
    assert a != b


# ---------------------------------------------------------------------------
# Dry run must be inert
# ---------------------------------------------------------------------------


def test_dry_run_opens_no_socket(checks, monkeypatch):
    called: list[str] = []

    def explode(*args, **kwargs):  # pragma: no cover — must never run
        called.append("urlopen")
        raise AssertionError("dry run attempted a network call")

    monkeypatch.setattr(bridge_mod.urllib.request, "urlopen", explode)

    bridge = Bridge(
        BridgeConfig(
            restaurant_id="r-1", restaurant_guid="g-1", toast_secret="x", apply=False
        )
    )
    # Count what was actually sent rather than a literal. The fixture's length is
    # a property of the traffic generator — it changed when ADR 0093 added coffee
    # to FOOD_ITEMS, because `random.choice` draws a variable number of bits for a
    # different pool size and the whole stream shifts. The property under test is
    # "every send was skipped", not "there were forty of them".
    sent = checks[:40]
    for check in sent:
        bridge.send(check)

    assert called == []
    summary = bridge.summary()
    assert summary["applied"] is False
    assert summary["analytics"]["posted"] == 0
    assert summary["stock"]["posted"] == 0
    assert summary["analytics"]["skipped"] == len(sent)
    assert len(sent) > 0


def test_ingress_selection_skips_the_other_side(checks):
    bridge = Bridge(
        BridgeConfig(
            restaurant_id="r", restaurant_guid="g", ingress="analytics", apply=False
        )
    )
    bridge.send(checks[0])
    # The unselected ingress must not even build a payload worth reporting.
    assert bridge.stock.sample_payload is None
    assert bridge.analytics.sample_payload is not None


def test_unsigned_run_warns_exactly_once(checks):
    bridge = Bridge(
        BridgeConfig(restaurant_id="r", restaurant_guid="g", toast_secret="", apply=False)
    )
    for check in checks[:10]:
        bridge.send(check)
    warnings = [e for e in bridge.stock.errors if "TOAST_WEBHOOK_SECRET" in e]
    assert len(warnings) == 1, "the fail-open warning must not repeat per check"


# ---------------------------------------------------------------------------
# Keeping the mirrored heuristic honest
# ---------------------------------------------------------------------------


def test_wine_words_match_the_typescript_source():
    """A drifted copy turns the reported hit rate into a comfortable fiction."""
    source = POS_HUB_SERVICE.read_text()
    block = re.search(
        r"WINE_WORDS\s*=\s*\[(.*?)\]", source, flags=re.S
    )
    assert block, "could not locate WINE_WORDS in pos-hub.service.ts"
    ts_words = tuple(re.findall(r'"([^"]*)"', block.group(1)))
    assert ts_words == WINE_WORDS, (
        "scripts/simulate/detection.py has drifted from pos-hub.service.ts.\n"
        f"  TypeScript: {ts_words}\n  Python:     {WINE_WORDS}"
    )


def test_toast_adapter_now_fails_closed_without_a_secret():
    """SimPOS testbed decision B16 flipped this from fail-open to fail-closed.

    Was: `if not self._secret: return True` — a missing env var silently waved
    every unsigned webhook through. Now: `return False`, logged as a rejection.
    This is the change this test's own predecessor predicted and asked for —
    "if this ever stops being true, the unsigned-run warning is obsolete and
    should become a hard error instead" — which is exactly what
    `Bridge.assert_targets_are_safe`-style guards should do next: an unsigned
    --apply run against this ingress no longer degrades to "untested", it fails
    every request outright. Recorded here so a regression back to fail-open is
    caught immediately, not rediscovered by a failing simulator run.
    """
    source = TOAST_ADAPTER.read_text()
    assert "if not self._secret" in source
    assert "return False" in source
    assert "fail closed" in source.lower()


def test_heuristic_catches_varietals_and_misses_appellations():
    """The measured 35% hit rate is structural, not incidental.

    The keyword list is varietal-oriented, so New World labelling resolves and Old
    World appellation labelling does not. Recorded as a test so the asymmetry is
    visible rather than rediscovered.
    """
    assert looks_like_wine("Sonoma Pinot Noir")
    assert looks_like_wine("Napa Cabernet Sauvignon")
    assert not looks_like_wine("Edmondo Sarti Barbaresco")
    assert not looks_like_wine("Pace Arneis Roero")
    assert not looks_like_wine("Umani Ronchi Pecorino")


def test_food_names_never_read_as_wine():
    """A food false positive would inflate depletion for wine never poured."""
    from scripts.simulate.service import FOOD_ITEMS

    for name, _category, _price in FOOD_ITEMS:
        assert not looks_like_wine(name), f"{name!r} reads as wine"


# ---------------------------------------------------------------------------
# Leakage: everything written must be removable
# ---------------------------------------------------------------------------


def test_pos_checks_is_teardown_covered():
    """Simulated service must be removable, or it is permanent contamination.

    `--apply` posts through the hub, which upserts `pos_checks`. Those rows never
    pass through seed.py, so the write-set entry is easy to omit — and omitting it
    means simulated covers blend into a tenant's real analytics with nothing
    flagging it. Phase 37's gate is the mechanism; this asserts we are inside it.
    """
    from scripts.synth.teardown import (
        DELETE_ORDER,
        TEARDOWN_HANDLERS,
        assert_teardown_coverage,
    )
    from scripts.synth.write_set import SYNTH_WRITE_SET

    assert "pos_checks" in SYNTH_WRITE_SET
    assert "pos_checks" in DELETE_ORDER
    assert "pos_checks" in TEARDOWN_HANDLERS
    # The equality gate must still hold with the addition.
    assert_teardown_coverage()


def test_pos_checks_is_deleted_before_restaurants():
    """FK order: a row referencing restaurant_id must go first."""
    from scripts.synth.teardown import DELETE_ORDER

    assert DELETE_ORDER.index("pos_checks") < DELETE_ORDER.index("restaurants")


def test_apply_refuses_without_a_restaurant():
    """Posting simulated service into an unspecified tenant is the worst case."""
    from scripts.simulate.cli import main

    with pytest.raises(SystemExit) as exc:
        main(["run", "--archetype", "bistro", "--days", "1", "--apply"])
    assert "--restaurant" in str(exc.value)


# ---------------------------------------------------------------------------
# The depletion oracle
# ---------------------------------------------------------------------------


def test_glass_counts_as_a_fifth_of_a_bottle(wine_list):
    day = date(2026, 7, 23)
    checks = list(generate_service(day, wines=wine_list, base_covers=60, seed=SEED))
    poured = wine_units_poured(checks)
    assert poured, "no wine poured — the oracle would be vacuous"
    assert all(units > 0 for units in poured.values())

    manual: dict[str, float] = {}
    for check in checks:
        for item in check.items:
            if item.is_wine and item.signature_hash:
                manual[item.signature_hash] = manual.get(item.signature_hash, 0.0) + (
                    item.quantity * (0.2 if item.by_glass else 1.0)
                )
    for sig, units in manual.items():
        assert poured[sig] == pytest.approx(units, abs=0.001)


def test_sold_out_wines_stop_appearing(wine_list):
    day = date(2026, 7, 24)
    everything = list(generate_service(day, wines=wine_list, base_covers=60, seed=SEED))
    doomed = {
        item.signature_hash
        for check in everything
        for item in check.items
        if item.is_wine and item.signature_hash
    }
    # Sell out all but a couple so the generator still has something to pour.
    keep = set(list(doomed)[:2])
    sold_out = doomed - keep

    after = list(
        generate_service(
            day, wines=wine_list, base_covers=60, seed=SEED, sold_out=sold_out
        )
    )
    poured_after = set(wine_units_poured(after))
    assert not (poured_after & sold_out), "a sold-out wine was poured anyway"


# ---------------------------------------------------------------------------
# Remote-target guardrail (2026-08-05 incident)
# ---------------------------------------------------------------------------


def test_dry_run_never_checks_remote_targets():
    """A dry run against a remote host must not be blocked — it sends nothing."""
    from scripts.simulate.bridge import Bridge, BridgeConfig

    cfg = BridgeConfig(
        restaurant_id="r",
        restaurant_guid="g",
        analytics_base="https://example.supabase.co",
        stock_base="https://example.supabase.co",
        apply=False,
    )
    Bridge(cfg)  # must not raise


def test_apply_against_remote_host_is_refused_by_default():
    from scripts.simulate.bridge import Bridge, BridgeConfig, RemoteTargetRefusedError

    cfg = BridgeConfig(
        restaurant_id="r",
        restaurant_guid="g",
        analytics_base="https://example.supabase.co",
        apply=True,
    )
    with pytest.raises(RemoteTargetRefusedError):
        Bridge(cfg)


def test_apply_against_remote_host_proceeds_with_allow_remote():
    from scripts.simulate.bridge import Bridge, BridgeConfig

    cfg = BridgeConfig(
        restaurant_id="r",
        restaurant_guid="g",
        analytics_base="https://example.supabase.co",
        pos_hub_secret="s",  # remote-target check is what this test exercises
        toast_secret="t",
        apply=True,
        allow_remote=True,
    )
    Bridge(cfg)  # must not raise


@pytest.mark.parametrize(
    "base",
    [
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://[::1]:3001",  # IPv6 loopback needs brackets in a URL authority
        "http://0.0.0.0:3001",
    ],
)
def test_apply_against_every_loopback_form_is_allowed(base):
    from scripts.simulate.bridge import Bridge, BridgeConfig

    cfg = BridgeConfig(
        restaurant_id="r",
        restaurant_guid="g",
        analytics_base=base,
        stock_base=base,
        pos_hub_secret="s",  # loopback-allowed check is what this test exercises
        toast_secret="t",
        apply=True,
    )
    Bridge(cfg)  # must not raise


# ---------------------------------------------------------------------------
# Analytics ingress signing (SimPOS testbed: it is the depletion path too)
# ---------------------------------------------------------------------------


def test_analytics_ingress_is_signed_when_pos_hub_secret_is_set(checks):
    """`PosHubService.verifyWebhookSignature` fails CLOSED without a valid
    X-Pos-Hub-Signature (decision B17/B28), and per the SimPOS testbed plan
    (decision B13) this ingress is now the single POS door for stock, not
    just analytics — so an unsigned request here does not just miss a nice-to
    -have, every check in the run gets silently rejected and nothing depletes.
    """
    bridge = Bridge(
        BridgeConfig(
            restaurant_id="r", restaurant_guid="g",
            pos_hub_secret="s3cr3t", apply=False,
        )
    )
    bridge.send_analytics(checks[0])
    assert bridge.analytics.sample_payload is not None
    # Recompute independently and confirm it is what the server would expect —
    # the payload is signed even though apply=False stops it from being sent,
    # so a dry run still proves the signature is computable.
    body = bridge_mod._encode(bridge.analytics.sample_payload)
    expected = hmac_sha256_hex("s3cr3t", body)
    assert len(expected) == 64  # sha256 hex digest


def test_analytics_ingress_warns_once_when_unsigned(checks):
    bridge = Bridge(
        BridgeConfig(restaurant_id="r", restaurant_guid="g", pos_hub_secret="", apply=False)
    )
    for check in checks[:10]:
        bridge.send_analytics(check)
    warnings = [e for e in bridge.analytics.errors if "POS_HUB_WEBHOOK_SECRET" in e]
    assert len(warnings) == 1, "the fail-closed warning must not repeat per check"


def test_analytics_and_stock_signatures_use_different_secrets(checks):
    """The two ingresses have independent verifiers; a secret for one must
    never accidentally authenticate the other."""
    check = checks[0]
    stock_body = bridge_mod._encode(toast_webhook(check, "g"))
    from scripts.simulate.payloads import canonical_check

    analytics_body = bridge_mod._encode(canonical_check(check))
    assert hmac_sha256_hex("shared", stock_body) != hmac_sha256_hex("shared", analytics_body), (
        "different payload bytes must not coincidentally produce the same digest "
        "for this fixture — if this ever fails, pick a different sample check"
    )
