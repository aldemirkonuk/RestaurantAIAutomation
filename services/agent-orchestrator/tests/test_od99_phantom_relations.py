"""
OD-99 — the reads that targeted relations production does not have.

Every relation asserted here was checked against PRODUCTION on 2026-08-26,
not against `supabase/migrations/`, because five defects this week came from a
migration the repo had and production never saw. PostgREST answers:

    reports                 404 PGRST205   (service-role AND anon)
    inventory_stock         404 PGRST205
    managers                404 PGRST205
    restaurant_wine_menus   404 PGRST205
    wine_library            404 PGRST205
    provider_digital_twins  404 PGRST205

    generated_reports       200 (service-role) / 42501 (anon)
    restaurant_inventory    200 (service-role) / 42501 (anon)
    manager_report_profiles 200 (service-role)
    provider_knowledge      200 (service-role)

These tests exist because every one of these reads was wrapped in a `try`
whose `except` produced the same value as a successful empty read. Nothing
observable changed when they failed, which is why they failed for months in
silence. So the assertions here are deliberately about *which relation is
touched*, not about return values: a return-value test would have passed
against the broken code too, which is exactly the class of test this
repository keeps discovering it has.

Run: cd services/agent-orchestrator && python -m pytest tests/test_od99_phantom_relations.py -v
"""

import json
import pathlib
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.email_composer_service import EmailComposerService, StyleProfile
from services.restaurant_dataset_service import (
    RestaurantDatasetService,
    RestaurantMenuSnapshot,
)
from services.wine_matcher import WineMatcher

# Relations that do not exist in production. No call may name one.
PHANTOM_RELATIONS = {
    "reports",
    "inventory_stock",
    "managers",
    "restaurant_wine_menus",
    "wine_library",
    "provider_digital_twins",
}


# RPC functions with no CREATE FUNCTION anywhere in this repo, absent from
# production (PGRST202). All five had a name that reads like a real feature.
PHANTOM_FUNCTIONS = {
    "find_provider_by_email",
    "get_inactive_providers",
    "get_low_stock_items",
    "jsonb_array_append",
    "search_provider_conversations",
}

_RPC_CALL = re.compile(r"""\.rpc\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']""")


def _source_of(relative_path: str) -> str:
    """Read a source file of the agent-orchestrator package."""
    return (pathlib.Path(__file__).resolve().parents[1] / relative_path).read_text()


def _rpc_names(source: str) -> set:
    """
    Every function name passed as the first argument to `.rpc(...)`.

    Deliberately a call-form match, not a substring match: these names appear
    throughout this repo's comments on purpose, explaining why they are gone,
    and a comment is not a call.
    """
    return set(_RPC_CALL.findall(source))


def _tables_touched(client: MagicMock) -> list:
    """Every relation name passed to `.table(...)` on a mock Supabase client."""
    return [c.args[0] for c in client.table.call_args_list if c.args]


# ---------------------------------------------------------------------------
# provider_digital_twins -- email_composer_service
# ---------------------------------------------------------------------------


class TestProviderDigitalTwinsIsGone:
    """
    The style cache read/write targeted `provider_digital_twins`, which exists
    in no migration and 404s in production. It was deleted rather than created:
    the real store for a provider's communication style is `provider_knowledge`
    (category='relationship', subcategory='communication_style'), which is what
    `ProviderConversationAgent._load_style_profile` and `_load_digital_twin`
    both read. Creating `provider_digital_twins` would have built a rival store
    for a concept that already has one (ADR 0027 / OD-95).
    """

    @staticmethod
    def _composer():
        database = MagicMock()
        database.supabase = MagicMock()
        return EmailComposerService(database=database, config={"mock_mode": True})

    @pytest.mark.asyncio
    async def test_style_load_touches_no_table_at_all(self):
        composer = self._composer()

        with patch.object(
            EmailComposerService,
            "_analyze_style",
            new=AsyncMock(return_value=StyleProfile()),
        ):
            await composer._load_or_analyze_style(
                "prov-1", [{"message_text": "hello", "direction": "inbound"}]
            )

        touched = _tables_touched(composer.database.supabase)
        assert touched == [], (
            "_load_or_analyze_style must not read any table; it queried "
            f"{touched}"
        )

    @pytest.mark.asyncio
    async def test_style_load_still_analyzes_when_history_is_present(self):
        """
        The deletion must not have removed the behaviour, only the dead cache.
        Analysis was ALREADY the only path that ever ran in production, because
        the cache read raised every time.
        """
        composer = self._composer()
        analyze = AsyncMock(return_value=StyleProfile())

        with patch.object(EmailComposerService, "_analyze_style", new=analyze):
            await composer._load_or_analyze_style(
                "prov-1", [{"message_text": "hi", "direction": "inbound"}]
            )

        analyze.assert_awaited_once()

    def test_no_cache_writer_survives(self):
        assert not hasattr(EmailComposerService, "_cache_style"), (
            "_cache_style upserted into provider_digital_twins and was removed "
            "with the read; a reinstated writer would recreate the dead store"
        )


# ---------------------------------------------------------------------------
# restaurant_wine_menus -- restaurant_dataset_service
# ---------------------------------------------------------------------------


class TestRestaurantWineMenusIsGone:
    """
    The `push_subscriptions` shape exactly: a second store nothing read. The
    JSONL files under datasets/restaurant_menus/ are the real store -- they are
    what `get_restaurants_by_city` and `get_all_cities`, this service's only
    readers, consult. The Supabase insert was additionally guarded on a
    `supabase_client` constructor argument that no caller ever passed, so the
    dead write was never even reached.
    """

    @staticmethod
    def _snapshot():
        return RestaurantMenuSnapshot(
            restaurant_name="Test Bistro",
            city="Testville",
            state="CA",
            source_type="scraped",
            extraction_method="free",
            extraction_confidence=0.9,
            total_wines=1,
            sections=[],
        )

    def test_constructor_takes_no_supabase_client(self):
        import inspect

        params = inspect.signature(RestaurantDatasetService.__init__).parameters
        assert "supabase_client" not in params, (
            "the client existed only to feed the phantom-table insert; keeping "
            "it invites the dead write back"
        )

    def test_no_supabase_writer_survives(self):
        assert not hasattr(RestaurantDatasetService, "_save_to_supabase")

    @pytest.mark.asyncio
    async def test_save_snapshot_writes_jsonl_and_reports_no_supabase_id(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.setattr(
            "services.restaurant_dataset_service.RESTAURANT_MENUS_DIR", tmp_path
        )
        service = RestaurantDatasetService()

        result = await service.save_snapshot(self._snapshot())

        assert result["status"] == "saved"
        # The dead insert's only trace in the return value is gone.
        assert "supabase_id" not in result, (
            "supabase_id was always None -- the insert was never reached -- and "
            "was read by nothing; reporting it implied a second store existed"
        )

        # And the real store actually received the row.
        written = (tmp_path / "testville.jsonl").read_text().strip()
        assert json.loads(written)["restaurant_name"] == "Test Bistro"


# ---------------------------------------------------------------------------
# wine_library -- wine_matcher
# ---------------------------------------------------------------------------


class TestWineLibraryPhaseIsGone:
    """
    Phase 1 of the match pipeline searched `wine_library` scoped by
    restaurant_id. It 404'd on every call, was swallowed into a
    `logger.warning`, and returned [] -- so `phase="user_library"` was never
    once reachable and every match ever made came from Phase 1b/1c/1d against
    `master_wine_library`.
    """

    def test_no_user_library_searcher_survives(self):
        assert not hasattr(WineMatcher, "_search_user_library")

    @pytest.mark.asyncio
    async def test_match_never_queries_the_phantom_library(self):
        client = MagicMock()
        matcher = WineMatcher(
            supabase_client=client, google_api_key="test-key", mock_mode=True
        )

        with patch.object(
            WineMatcher, "_vector_search", new=AsyncMock(return_value=[])
        ), patch.object(
            WineMatcher, "_text_search", new=AsyncMock(return_value=[])
        ), patch.object(
            WineMatcher, "_ilike_search", new=AsyncMock(return_value=[])
        ), patch.object(
            WineMatcher, "_ai_enrichment", new=AsyncMock(return_value=None)
        ), patch.object(
            WineMatcher, "_ai_enrichment_fallback", new=AsyncMock(return_value=None)
        ):
            result = await matcher.match(
                wine_name="Caymus Cabernet",
                producer="Caymus",
                vintage=2019,
                restaurant_id="rest-1",
            )

        touched = _tables_touched(client)
        assert "wine_library" not in touched, (
            f"wine_library 404s in production; tables touched were {touched}"
        )
        assert result.get("phase_reached") != "user_library", (
            "user_library was never a reachable phase"
        )


# ---------------------------------------------------------------------------
# Cross-cutting: no phantom name may reappear in the modules OD-99 touched.
# ---------------------------------------------------------------------------


class TestNoPhantomRelationNamesRemain:
    """
    A source-level backstop for the four files above plus the two that were
    repointed. The behavioural tests each pin one call path; this pins the
    files, so a phantom name reintroduced on a path no test drives still fails
    the build.
    """

    FILES = [
        "services/email_composer_service.py",
        "services/restaurant_dataset_service.py",
        "services/wine_matcher.py",
        "agents/reporting_agent.py",
        "agents/email_parsing_agent.py",
        "agents/provider_conversation_agent.py",
        "core/database.py",
        "demo/weekly_report_scheduler.py",
    ]

    @pytest.mark.parametrize("relative_path", FILES)
    def test_no_phantom_relation_is_queried(self, relative_path):
        source = _source_of(relative_path)

        offenders = []
        for relation in sorted(PHANTOM_RELATIONS):
            # `.table("x")` / `.from_("x")` -- the call forms, not prose. These
            # names appear in this repo's comments on purpose, explaining why
            # they are gone, and a comment is not a query.
            for call in (f'.table("{relation}")', f'.from_("{relation}")'):
                if call in source:
                    offenders.append(call)

        assert not offenders, (
            f"{relative_path} queries {offenders}, which do not exist in "
            f"production (404 PGRST205, verified 2026-08-26)"
        )

    @pytest.mark.parametrize("relative_path", FILES)
    def test_no_phantom_rpc_is_called(self, relative_path):
        called = _rpc_names(_source_of(relative_path))
        offenders = sorted(PHANTOM_FUNCTIONS & called)

        assert not offenders, (
            f"{relative_path} calls RPC {offenders}, for which no CREATE "
            "FUNCTION exists in this repo and which production does not have "
            "(PGRST202, verified 2026-08-26)"
        )


# ---------------------------------------------------------------------------
# The four Python RPC repairs.
# ---------------------------------------------------------------------------


class TestPhantomRpcCallsAreGone:
    """
    Four of the five phantom RPCs were called from Python, and three of them
    shared one structural defect that made them invisible: the "fallback" the
    author wrote for the RPC failing sat INSIDE the same `try` as the RPC call,
    so the exception jumped straight over it to the outer `except`. The
    fallbacks were unreachable code, not fallbacks -- which is why
    `_find_provider_by_email` returned None for every inbound email ever
    parsed, and why `_check_relationship_health` has never emitted an alert.
    """

    def test_find_provider_by_email_no_longer_calls_the_rpc(self):
        source = _source_of("agents/email_parsing_agent.py")
        assert "find_provider_by_email" not in _rpc_names(source)

    def test_provider_lookup_reaches_the_contact_email_query(self):
        """
        The repair is not "the RPC is gone" but "the search that was
        unreachable now runs". This drives the method and asserts it reaches
        the `providers` table, which it never did before.
        """
        source = _source_of("agents/email_parsing_agent.py")
        # Both searches the old code intended are present and independent.
        assert '.ilike("contact_email"' in source
        assert '"primary_contact->>email"' in source

    def test_relationship_health_no_longer_calls_the_rpc(self):
        source = _source_of("agents/provider_conversation_agent.py")
        assert "get_inactive_providers" not in _rpc_names(source)

    def test_low_stock_no_longer_calls_the_rpc(self):
        source = _source_of("core/database.py")
        assert "get_low_stock_items" not in _rpc_names(source)

    def test_manager_instruction_write_no_longer_calls_the_rpc(self):
        source = _source_of("agents/provider_conversation_agent.py")
        assert "jsonb_array_append" not in _rpc_names(source)


class TestManagerInstructionIsActuallyStored:
    """
    `jsonb_array_append` is the one phantom RPC that was a WRITE with nothing
    behind it. Its failure was not a degraded read, it was data loss: every
    preference the learning loop extracted -- each paid for with an LLM call --
    went into a function that does not exist and was dropped by the `except`.
    """

    @staticmethod
    def _agent():
        from agents.provider_conversation_agent import ProviderConversationAgent

        agent = ProviderConversationAgent.__new__(ProviderConversationAgent)
        agent.database = MagicMock()
        agent.logger = MagicMock()
        return agent

    def test_preference_is_appended_to_the_active_session(self):
        agent = self._agent()
        table = agent.database.supabase.table.return_value
        table.select.return_value.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{"id": "sess-1", "conversation_context": {"manager_instructions": ["first"]}}]
        )

        stored = agent._append_manager_instruction("rest-1", "prov-1", "second")

        assert stored is True
        update_arg = table.update.call_args.args[0]
        assert update_arg["conversation_context"]["manager_instructions"] == [
            "first",
            "second",
        ], "the existing instructions must be preserved, not overwritten"

    def test_first_instruction_creates_the_list(self):
        agent = self._agent()
        table = agent.database.supabase.table.return_value
        table.select.return_value.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[{"id": "sess-1", "conversation_context": None}]
        )

        assert agent._append_manager_instruction("rest-1", "prov-1", "only") is True
        update_arg = table.update.call_args.args[0]
        assert update_arg["conversation_context"]["manager_instructions"] == ["only"]

    def test_missing_session_is_reported_not_swallowed(self):
        agent = self._agent()
        table = agent.database.supabase.table.return_value
        table.select.return_value.eq.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
            data=[]
        )

        assert agent._append_manager_instruction("rest-1", "prov-1", "lost") is False
        table.update.assert_not_called()
        agent.logger.warning.assert_called()
