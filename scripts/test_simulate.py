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
from scripts.simulate.bridge import Bridge, BridgeConfig, sign_toast  # noqa: E402
from scripts.simulate import detection as detection_mod  # noqa: E402
from scripts.simulate.detection import (  # noqa: E402
    WINE_WORDS,
    classify_wine_category,
    detect_wine,
    detection_report,
    looks_like_wine,
)
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
    produced = sign_toast(secret, body)

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
    a = sign_toast(secret, bridge_mod._encode(toast_webhook(checks[0], "guid-a")))
    b = sign_toast(secret, bridge_mod._encode(toast_webhook(checks[0], "guid-b")))
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
    for check in checks[:40]:
        bridge.send(check)

    assert called == []
    summary = bridge.summary()
    assert summary["applied"] is False
    assert summary["analytics"]["posted"] == 0
    assert summary["stock"]["posted"] == 0
    assert summary["analytics"]["skipped"] == 40


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


#: The four lists that decide whether a POS sale is recorded as wine, and the
#: three files that each hold a copy. The copies exist because the three live in
#: different runtimes (NestJS, the orchestrator's Python, this harness) with no
#: shared import path between them; the test below is what stops them drifting.
WORD_LIST_NAMES = (
    "WINE_CATEGORY_WORDS",
    "WINE_STYLE_CATEGORY_WORDS",
    "NON_WINE_CATEGORY_WORDS",
    "WINE_WORDS",
)
POS_AGENT = (
    REPO_ROOT
    / "services"
    / "agent-orchestrator"
    / "agents"
    / "pos_integration_agent.py"
)


def _extract_word_list(path: Path, name: str) -> tuple[str, ...]:
    """Pull a named array/tuple literal of double-quoted strings out of a source file.

    Textual rather than an import, because the three copies live in three runtimes
    and importing the orchestrator agent from here would drag in its whole
    dependency tree just to read a list of grape names.

    The closing delimiter is found by counting depth rather than by a non-greedy
    match, because the lists carry explanatory comments and a comment containing a
    bracket would otherwise end the block early — silently, comparing two truncated
    prefixes that happen to agree.
    """
    source = path.read_text()
    opener = re.search(rf"\b{name}\b[^=\n]*=\s*([\(\[])", source)
    assert opener, f"could not locate {name} in {path.name}"
    open_ch = opener.group(1)
    close_ch = ")" if open_ch == "(" else "]"
    depth = 0
    for index in range(opener.end(1) - 1, len(source)):
        if source[index] == open_ch:
            depth += 1
        elif source[index] == close_ch:
            depth -= 1
            if depth == 0:
                body = source[opener.end(1) : index]
                break
    else:
        raise AssertionError(f"unterminated {name} literal in {path.name}")
    words = tuple(re.findall(r'"([^"]*)"', body))
    assert words, f"{name} in {path.name} parsed as empty"
    return words


@pytest.mark.parametrize("name", WORD_LIST_NAMES)
def test_wine_words_match_the_typescript_source(name):
    """A drifted copy turns the reported hit rate into a comfortable fiction.

    pos-hub.service.ts is the source of truth. The mirror in detection.py is what
    this harness measures with, and the copy in pos_integration_agent.py is what
    the other POS ingress decides with — the two ingresses disagreed about how
    wine is identified until they were reconciled, and this is what keeps them
    reconciled.
    """
    expected = _extract_word_list(POS_HUB_SERVICE, name)
    for path in (Path(detection_mod.__file__), POS_AGENT):
        actual = _extract_word_list(path, name)
        assert actual == expected, (
            f"{path.name} has drifted from pos-hub.service.ts on {name}.\n"
            f"  only in TypeScript: {[w for w in expected if w not in actual]}\n"
            f"  only in {path.name}: {[w for w in actual if w not in expected]}"
        )


@pytest.mark.parametrize("name", WORD_LIST_NAMES)
def test_word_lists_are_lowercase_and_free_of_duplicates(name):
    """Matching lowercases the input, so an uppercase token is dead weight."""
    words = _extract_word_list(POS_HUB_SERVICE, name)
    assert [w for w in words if w != w.lower()] == []
    assert [w for w in words if w != w.strip() or not w] == []
    duplicated = sorted({w for w in words if words.count(w) > 1})
    assert duplicated == [], f"{name} repeats: {duplicated}"


def test_toast_adapter_still_fails_open_without_a_secret():
    """Documents the behaviour the simulator deliberately signs around.

    If this ever stops being true, the unsigned-run warning is obsolete and should
    become a hard error instead.
    """
    source = TOAST_ADAPTER.read_text()
    assert "if not self._secret" in source
    assert "return True" in source


def test_heuristic_catches_varietals_and_appellations():
    """Both labelling conventions, which is the point of the extended list.

    A grape-only list resolves New World varietal labelling ('Sonoma Pinot Noir')
    and structurally cannot resolve Old World appellation or producer labelling.
    That was the 35.2% ceiling on the bistro list. Each name below was a measured
    miss against the real crawled menu snapshot.
    """
    for name in ("Sonoma Pinot Noir", "Napa Cabernet Sauvignon"):
        assert looks_like_wine(name), name
    for name in (
        "Edmondo Sarti Barbaresco",
        "Pace Arneis Roero",
        "Dettori Vermentino",
        "Moschioni Friulano",
        "San-Lurins Malvasia Istriana Skin Fermented",
        "Cantine Nostre Barbera",
        "Gran Passaia Super Tuscan",
        "Billecart-Salmon Blanc de Blanc",
        "Domaine Carneros Blanc de Noirs",
        "Tenuta Orestiadi Nero d’Avola",  # curly apostrophe, as the menu has it
        "Tenuta Orestiadi Nero d'Avola",
        "Benanti Etna Bianco",
        "Baldovino Cerasuolo d'Abruzzo",
        "Chicago Winery Petite Sirah",
        "House White",
        "Assyrtiko (Santorini)",
        "Xinomavro (Naoussa)",
        "Corton Grand Cru",
        "Romanee-Conti Grand Cru",
        "Vina Tondonia Reserva",
    ):
        assert looks_like_wine(name), name


def test_word_boundaries_keep_short_tokens_safe():
    """Why the scan matches on boundaries rather than as bare substrings.

    Every name here contains a wine token as a substring and is not wine. The
    substring version read the first three as wine.
    """
    assert not looks_like_wine("Cavatelli Bolognese")  # cava
    assert not looks_like_wine("Vietnamese Coffee")  # etna
    assert not looks_like_wine("Rosemary Focaccia")  # rose
    assert not looks_like_wine("Crudo of the Day")  # cru
    assert not looks_like_wine("Portobello Fries")  # port
    # ...and the tokens themselves still resolve as whole words.
    assert looks_like_wine("Raventos Cava Brut")
    assert looks_like_wine("Benanti Etna Rosso")
    assert looks_like_wine("Domaine Ott Rose")
    assert looks_like_wine("Corton Grand Cru")
    assert looks_like_wine("Taylor Fladgate Port")


#: Food and non-wine drinks whose names collide with a wine term. Real menu items,
#: not adversarial nonsense: a Marche white really is called Pecorino, pizza really
#: is bianca, cavolo nero really is on the menu next to the Nerello. Each one that
#: read as wine would inflate depletion for wine that was never poured, which is a
#: worse failure than a miss — a miss is fixed by a mapping row or the category,
#: while a false positive silently invents consumption.
FOOD_NAMES_THAT_LOOK_LIKE_WINE = (
    "Pecorino Romano",
    "Shaved Pecorino",
    "Pecorino & Honey",
    "Cacio e Pepe",
    "Pizza Bianca",
    "Pizza Bianco",
    "Queso Blanco",
    "Cavolo Nero",
    "Cavatelli Bolognese",
    "Cavatappi",
    "Rosemary Focaccia",
    "Vietnamese Coffee",
    "Chicken Marsala",
    "Veal Marsala",
    "Dolce di Latte",
    "Dolci",
    "Salsa Verde",
    "Insalata Verde",
    "Sparkling Water",
    "House Blend Coffee",
    "Red Snapper",
    "White Bean Soup",
    "Red Curry",
    "White Truffle Risotto",
    "Bruschetta",
    "Polenta Fries",
    "Prosciutto e Melone",
    "Grana Padano",
    "Coq au Vin",
    "Blanquette de Veau",
    "Crudite",
    "Portobello Fries",
    "Gin-Cured Salmon",
    "Espresso Martini",
    # The producer words are whole-word matches too, so a Chateaubriand is still
    # a steak. Note the deliberate limit of that group: an item that genuinely
    # carries a producer word ('Winery Tour Package') does read as wine. That is
    # the trade for resolving a winery's proprietary cuvee names, and the category
    # settles it — such an item arrives under Retail, not under Wine.
    "Chateaubriand",
    "Chateaubriand for Two",
)


#: The one collision the NAME alone cannot settle, recorded rather than hidden.
#: 'rose' has to stay on the list — real wines are sold as nothing but 'ROSE', 4
#: line items of the cafe archetype among them — and rose is also an ingredient.
#: The pre-existing substring token was 'rose ' with a trailing space, which
#: matched rose harissa exactly the same way, so this is a known limit of a name
#: scan and not a regression. The category settles it: a carrot dish arrives under
#: a food heading, and a mapping row settles it permanently.
FOOD_NAMES_ONLY_THE_CATEGORY_CAN_DISAMBIGUATE = (
    ("Rose Harissa Carrots", "Starters"),
    ("Rose Water Baklava", "Dessert"),
)


def test_food_names_never_read_as_wine():
    """A food false positive would inflate depletion for wine never poured."""
    from scripts.simulate.service import FOOD_ITEMS

    for name, _category, _price in FOOD_ITEMS:
        assert not looks_like_wine(name), f"{name!r} reads as wine"

    for name in FOOD_NAMES_THAT_LOOK_LIKE_WINE:
        assert not looks_like_wine(name), f"{name!r} reads as wine"


def test_food_never_reads_as_wine_through_the_category_signal_either():
    """The category is consulted before the name, so it needs the same guard."""
    from scripts.simulate.service import FOOD_ITEMS

    for name, category, _price in FOOD_ITEMS:
        assert not detect_wine(name, category), f"{name!r} in {category!r} reads as wine"

    for name in FOOD_NAMES_THAT_LOOK_LIKE_WINE:
        for category in ("Starters", "Mains", "Dessert", "Drinks", "Sides", ""):
            assert not detect_wine(name, category), f"{name!r} in {category!r}"


def test_the_category_settles_what_the_name_scan_cannot():
    """Asserts the limitation above in both directions, so it stays visible."""
    for name, category in FOOD_NAMES_ONLY_THE_CATEGORY_CAN_DISAMBIGUATE:
        assert looks_like_wine(name), (
            f"{name!r} no longer trips the name scan — if the word list changed, "
            "move this case into FOOD_NAMES_THAT_LOOK_LIKE_WINE where the stronger "
            "guard applies"
        )
        assert not detect_wine(name, category), f"{name!r} in {category!r}"


# ---------------------------------------------------------------------------
# The category signal
# ---------------------------------------------------------------------------


def test_category_resolves_wine_a_name_scan_cannot_reach():
    """The structural fix: no keyword list can know that Conterno is a Barolo."""
    for name in ("Conterno 2016", "Caymus", "Opus One", "Giato", "Tiamo Organic"):
        assert not looks_like_wine(name), f"{name} unexpectedly hit the name scan"
        assert detect_wine(name, "Wine"), name
        assert detect_wine(name, "Wine by the Glass"), name


def test_wine_category_words_beat_the_non_wine_families():
    """Order matters: a Dessert Wine heading is wine, not dessert."""
    assert classify_wine_category("Dessert Wine") == "wine"
    assert classify_wine_category("Wine & Cheese") == "wine"
    assert classify_wine_category("Dessert") == "not_wine"
    assert classify_wine_category("Cheese") == "not_wine"


def test_a_style_category_loses_to_a_non_wine_family():
    """'Sparkling Water' as a heading must not read as sparkling wine."""
    assert classify_wine_category("Sparkling Water") == "not_wine"
    assert classify_wine_category("Sparkling") == "wine"
    assert classify_wine_category("Champagne & Sparkling") == "wine"


def test_unrecognised_category_falls_through_rather_than_vetoing():
    """Real POS menus file wine under headings we have not seen.

    Treating an unknown heading as 'not wine' is the undercount the fallback
    exists to avoid, so it must defer to the name instead of overruling it.
    """
    for category in ("Beverages", "Drinks", "Bar", "House Favourites", ""):
        assert classify_wine_category(category) == "unknown", category
        assert detect_wine("Estate Chardonnay 2021", category), category
        assert not detect_wine("Cheese Board", category), category


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
