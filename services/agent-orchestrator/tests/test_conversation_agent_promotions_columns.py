"""ProviderConversationAgent writes provider_promotions with the table's real columns.

Until 2026-09-26 `_process_extracted_promos` inserted `status`, `is_recurring`
and `source_message_text`, and deduped with `.eq("status", "active")`. None of
those columns exist, so PostgREST refused every call, the `except` logged it,
and no offer a vendor wrote in conversation ever landed. PR #464 put the agent
back into production, which made the dead write live code.

`_check_expiring_promos` had the same defect twice over: it read a `status`
column that has never existed, and an `alerted_at` column that did not exist
until migration 20260928000000_a_promotion_remembers_being_alerted (founder
item 54, 2026-09-26 round 8: "add an alerted_at timestamptz NULL column ... and
fix _check_expiring_promos"). Both are fixed here, so the xfail this file used
to pin is gone.

The columns are read from the baseline migration, pinned to a static set so a
parser drift cannot silently widen them, and every later migration is checked
for an ALTER of the table -- except the one named addition below, whose added
column is itself verified against the migration file rather than trusted by
name. Then every query the promotion paths build is recorded, and each column
it names — in a payload or in a filter — must be one the table has (baseline
plus that one addition). A return-value test would pass against the broken
code: every path swallows its error. So the assertions are about what is sent.

Run: cd services/agent-orchestrator && python -m pytest tests/test_conversation_agent_promotions_columns.py -v
"""

import pathlib
import re
from unittest.mock import AsyncMock, MagicMock

from agents.provider_conversation_agent import (
    ProviderConversationAgent,
    promotion_insert_row,
)

REPO = pathlib.Path(__file__).resolve().parents[3]
MIGRATIONS = REPO / "supabase" / "migrations"
BASELINE = MIGRATIONS / "20260805000000_baseline_from_production.sql"

# supabase/migrations/20260805000000_baseline_from_production.sql:4808-4827
PROVIDER_PROMOTIONS_BASELINE_COLUMNS = frozenset(
    {
        "id",
        "provider_id",
        "restaurant_id",
        "name",
        "promo_type",
        "description",
        "conditions",
        "discount_value",
        "applicable_wines",
        "applicable_categories",
        "start_date",
        "end_date",
        "is_active",
        "source_conversation_id",
        "confidence",
        "created_at",
        "updated_at",
    }
)

# Migrations allowed to ALTER provider_promotions after the baseline, each
# named explicitly with the column(s) IT adds -- so a second, unrelated ALTER
# landing under a different name still fails test_no_later_migration_alters_
# the_table_except_the_named_ones below, and a drift in what THIS migration
# adds (parsed straight from its own file, not trusted by name) fails
# test_the_named_additions_add_exactly_what_they_claim.
PROVIDER_PROMOTIONS_ADDED_COLUMNS = {
    "20260928000000_a_promotion_remembers_being_alerted.sql": frozenset({"alerted_at"}),
}

PROVIDER_PROMOTIONS_COLUMNS = frozenset(
    PROVIDER_PROMOTIONS_BASELINE_COLUMNS
    | {c for cols in PROVIDER_PROMOTIONS_ADDED_COLUMNS.values() for c in cols}
)


def _alter_added_columns(sql: str) -> set:
    """Column names ADDed to provider_promotions by ALTER TABLE clauses in sql."""
    stmt_re = re.compile(
        r"ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?"
        r"(?:public\.)?\"?provider_promotions\"?\s+([^;]*);",
        re.IGNORECASE,
    )
    add_re = re.compile(
        r"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?(\w+)\"?", re.IGNORECASE
    )
    cols: set = set()
    for stmt in stmt_re.findall(sql):
        cols |= set(add_re.findall(stmt))
    return cols


REST_ID = "11111111-1111-1111-1111-111111111111"
OTHER_REST_ID = "99999999-9999-9999-9999-999999999999"
PROV_ID = "33333333-3333-3333-3333-333333333333"


def _baseline_columns() -> set:
    sql = BASELINE.read_text()
    m = re.search(
        r"CREATE TABLE public\.provider_promotions \((.*?)\n\);", sql, re.DOTALL
    )
    assert m, "provider_promotions CREATE TABLE not found in the baseline"
    cols = set()
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.upper().startswith("CONSTRAINT"):
            continue
        cols.add(line.split()[0].strip('"'))
    return cols


class TestTheColumnListIsTheMigrations:
    def test_static_list_matches_the_baseline_create_table(self):
        assert _baseline_columns() == set(PROVIDER_PROMOTIONS_BASELINE_COLUMNS)

    def test_no_later_migration_alters_the_table_except_the_named_ones(self):
        alter = re.compile(
            r"ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?"
            r"(?:public\.)?\"?provider_promotions\"?\s+(ADD|DROP|RENAME)",
            re.IGNORECASE,
        )
        hits = [
            p.name
            for p in sorted(MIGRATIONS.glob("*.sql"))
            if p != BASELINE and alter.search(p.read_text())
        ]
        assert set(hits) == set(PROVIDER_PROMOTIONS_ADDED_COLUMNS), (
            "the set of migrations that ALTER provider_promotions changed; "
            "update PROVIDER_PROMOTIONS_ADDED_COLUMNS (and, for a DROP or "
            "RENAME, PROVIDER_PROMOTIONS_BASELINE_COLUMNS / the queries that "
            f"use the affected column) to match: {hits}"
        )

    def test_the_named_additions_add_exactly_what_they_claim(self):
        for name, claimed in PROVIDER_PROMOTIONS_ADDED_COLUMNS.items():
            path = MIGRATIONS / name
            assert path.is_file(), f"{name} is not in {MIGRATIONS}"
            assert _alter_added_columns(path.read_text()) == set(claimed), (
                f"{name} adds different columns than PROVIDER_PROMOTIONS_"
                f"ADDED_COLUMNS claims for it"
            )


# =============================================================================
# A PostgREST double that records every column a query names
# =============================================================================


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op, self.values, self.filters = "select", None, []
        db.queries.append(self)

    def select(self, *a, **k):
        self.op = "select"
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def _filter(self, column, value=None):
        self.filters.append((column, value))
        return self

    eq = lt = lte = gt = gte = neq = _filter

    def is_(self, column, value=None):
        return self._filter(column, value)

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        rows = self.db.rows.get(self.table, [])
        if self.op == "select":
            want = dict(self.filters)
            return MagicMock(
                data=[r for r in rows if all(r.get(c) == v for c, v in want.items())]
            )
        return MagicMock(data=[])

    def columns(self) -> set:
        cols = {c for c, _ in self.filters}
        if isinstance(self.values, dict):
            cols |= set(self.values)
        return cols


class _DB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.queries = []
        self.supabase = self

    def table(self, name):
        return _Query(self, name)

    def promo_queries(self):
        return [q for q in self.queries if q.table == "provider_promotions"]


def _agent(rows=None):
    agent = object.__new__(ProviderConversationAgent)
    agent.logger = MagicMock()
    agent.database = _DB(rows)
    agent.publish = AsyncMock()
    agent.promo_alert_days = 7
    return agent


def _unknown_columns(db) -> list:
    return [
        (q.op, sorted(q.columns() - PROVIDER_PROMOTIONS_COLUMNS))
        for q in db.promo_queries()
        if q.columns() - PROVIDER_PROMOTIONS_COLUMNS
    ]


class _ExpiryFakeQuery:
    """A narrower double than `_Query`: it returns every seeded row regardless
    of the filter (`_Query` matches filters by literal equality, which cannot
    model `.lte(...)` against a date computed at call time or `.is_(...,
    "null")` against a real NULL), and records each update by row id so a
    test can assert exactly which promo was marked alerted."""

    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op = "select"
        self.values = None
        self.filters: list = []

    def select(self, *a, **k):
        self.op = "select"
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def eq(self, column, value=None):
        self.filters.append((column, value))
        return self

    lt = lte = gt = gte = neq = eq

    def is_(self, column, value=None):
        return self.eq(column, value)

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        if self.op == "select":
            return MagicMock(data=list(self.db.rows))
        row_id = dict(self.filters).get("id")
        self.db.updates.append((row_id, dict(self.values or {})))
        return MagicMock(data=[])


class _ExpiryFakeDB:
    def __init__(self, rows):
        self.rows = rows
        self.updates: list = []
        self.supabase = self

    def table(self, name):
        assert name == "provider_promotions"
        return _ExpiryFakeQuery(self, name)


OFFER = {
    "name": "Spring Barolo case deal",
    "type": "volume_discount",
    "discount_percentage": "15%",
    "discount_fixed": None,
    "conditions": "on 12 bottles or more",
    "applicable_wines": ["Barolo 2019"],
    "start_date": "2026-09-20",
    "end_date": "end of October",
    "is_stackable": False,
    "min_quantity": 12,
    "min_spend": None,
}


# =============================================================================
# The insert
# =============================================================================


class TestANewOfferLands:
    async def _run(self, agent, promos=None, restaurant_id=REST_ID):
        await ProviderConversationAgent._process_extracted_promos(
            agent,
            provider_id=PROV_ID,
            restaurant_id=restaurant_id,
            promos=promos if promos is not None else [dict(OFFER)],
            source_message="We are running 15% off Barolo on 12+ bottles",
        )

    async def test_every_column_it_names_exists(self):
        agent = _agent()
        await self._run(agent)
        assert _unknown_columns(agent.database) == []

    async def test_the_insert_happens_and_carries_the_house(self):
        agent = _agent()
        await self._run(agent)
        inserts = [q for q in agent.database.promo_queries() if q.op == "insert"]
        assert len(inserts) == 1
        row = inserts[0].values
        assert set(row) <= PROVIDER_PROMOTIONS_COLUMNS
        assert row["restaurant_id"] == REST_ID
        assert row["provider_id"] == PROV_ID
        assert row["is_active"] is True
        agent.logger.error.assert_not_called()

    async def test_the_dedupe_read_is_scoped_to_the_house(self):
        agent = _agent()
        await self._run(agent)
        dedupe = [q for q in agent.database.promo_queries() if q.op == "select"]
        assert dedupe, "no dedupe read was made"
        assert ("restaurant_id", REST_ID) in dedupe[0].filters
        assert ("is_active", True) in dedupe[0].filters

    async def test_another_houses_offer_does_not_block_this_one(self):
        agent = _agent(
            {
                "provider_promotions": [
                    {
                        "id": "p-other",
                        "restaurant_id": OTHER_REST_ID,
                        "provider_id": PROV_ID,
                        "name": OFFER["name"],
                        "is_active": True,
                    }
                ]
            }
        )
        await self._run(agent)
        ops = [q.op for q in agent.database.promo_queries()]
        assert "insert" in ops and "update" not in ops

    async def test_no_house_means_no_write(self):
        agent = _agent()
        await self._run(agent, restaurant_id="")
        assert agent.database.promo_queries() == []

    async def test_the_same_offer_again_updates_with_real_columns(self):
        agent = _agent(
            {
                "provider_promotions": [
                    {
                        "id": "p-1",
                        "restaurant_id": REST_ID,
                        "provider_id": PROV_ID,
                        "name": OFFER["name"],
                        "is_active": True,
                    }
                ]
            }
        )
        await self._run(agent)
        updates = [q for q in agent.database.promo_queries() if q.op == "update"]
        assert len(updates) == 1
        assert ("restaurant_id", REST_ID) in updates[0].filters
        assert _unknown_columns(agent.database) == []


class TestTheRowSpeaksTheReferenceWritersShape:
    """promotion-extractor.service.ts: discount_value.percent/amount, conditions.min_qty."""

    def test_offer_terms(self):
        row = promotion_insert_row(PROV_ID, REST_ID, dict(OFFER))
        assert row["discount_value"] == {"percent": 15.0}
        assert row["conditions"] == {"text": "on 12 bottles or more", "min_qty": 12.0}
        assert row["applicable_wines"] == ["Barolo 2019"]
        assert row["start_date"] == "2026-09-20"
        # A date column refuses free text; the whole insert would fail on it.
        assert row["end_date"] is None

    def test_free_shipping_and_unknown_type(self):
        row = promotion_insert_row(
            PROV_ID, REST_ID, {"name": "x", "type": "free_shipping"}
        )
        assert row["discount_value"] == {"free_shipping": True}
        row = promotion_insert_row(PROV_ID, REST_ID, {"name": "x", "type": "flash"})
        assert row["promo_type"] == "volume_discount"


# =============================================================================
# The other two paths that touch the table
# =============================================================================


class TestTheReadAndTheSweep:
    async def test_active_promos_read_is_the_houses_and_uses_is_active(self):
        agent = _agent()
        await ProviderConversationAgent._get_active_promos(agent, PROV_ID, REST_ID)
        (q,) = agent.database.promo_queries()
        assert ("restaurant_id", REST_ID) in q.filters
        assert ("is_active", True) in q.filters
        assert _unknown_columns(agent.database) == []

    async def test_active_promos_without_a_house_reads_nothing(self):
        agent = _agent()
        assert (
            await ProviderConversationAgent._get_active_promos(agent, PROV_ID, "") == []
        )
        assert agent.database.promo_queries() == []

    async def test_expiry_sweep_uses_real_columns(self):
        agent = _agent()
        await ProviderConversationAgent._expire_old_promos(agent)
        (q,) = agent.database.promo_queries()
        assert q.op == "update"
        assert q.values["is_active"] is False
        assert _unknown_columns(agent.database) == []
        agent.logger.error.assert_not_called()

    async def test_expiring_alert_sweep_uses_real_columns(self):
        agent = _agent()
        await ProviderConversationAgent._check_expiring_promos(agent)
        assert _unknown_columns(agent.database) == []

    async def test_expiring_alert_sweep_reads_is_active_and_alerted_at(self):
        agent = _agent()
        await ProviderConversationAgent._check_expiring_promos(agent)
        (select_q,) = [q for q in agent.database.promo_queries() if q.op == "select"]
        assert ("is_active", True) in select_q.filters
        assert ("alerted_at", "null") in select_q.filters
        # The old, broken read: a nonexistent `status` column.
        assert not any(c == "status" for c, _ in select_q.filters)

    async def test_expiring_alert_sweep_marks_alerted_only_after_both_publishes(self):
        agent = _agent()
        agent.database = _ExpiryFakeDB(
            [
                {
                    "id": "p-1",
                    "provider_id": PROV_ID,
                    "restaurant_id": REST_ID,
                    "name": "Spring Barolo case deal",
                    "end_date": "2026-10-01",
                }
            ]
        )
        await ProviderConversationAgent._check_expiring_promos(agent)

        publishes = [c.kwargs for c in agent.publish.await_args_list]
        assert len(publishes) == 2
        assert {p["routing_key"] for p in publishes} == {
            "provider.promo.expiring_soon",
            "notification.promo_alert",
        }
        # Both payloads carry the house.
        assert all(
            p["message_body"]["payload"]["restaurant_id"] == REST_ID for p in publishes
        )

        assert len(agent.database.updates) == 1
        row_id, values = agent.database.updates[0]
        assert row_id == "p-1"
        assert set(values) == {"alerted_at"}
        agent.logger.error.assert_not_called()

    async def test_expiring_alert_sweep_leaves_alerted_at_null_on_publish_failure(self):
        agent = _agent()
        agent.database = _ExpiryFakeDB(
            [
                {
                    "id": "p-1",
                    "provider_id": PROV_ID,
                    "restaurant_id": REST_ID,
                    "name": "Spring Barolo case deal",
                    "end_date": "2026-10-01",
                }
            ]
        )
        agent.publish = AsyncMock(side_effect=RuntimeError("broker unreachable"))
        await ProviderConversationAgent._check_expiring_promos(agent)
        assert (
            agent.database.updates == []
        ), "alerted_at must not be set when the alert never sent"
        agent.logger.error.assert_called_once()

    async def test_one_promos_publish_failure_does_not_block_the_others(self):
        agent = _agent()
        agent.database = _ExpiryFakeDB(
            [
                {
                    "id": "p-bad",
                    "provider_id": PROV_ID,
                    "restaurant_id": REST_ID,
                    "name": "Bad deal",
                    "end_date": "2026-10-02",
                },
                {
                    "id": "p-good",
                    "provider_id": PROV_ID,
                    "restaurant_id": REST_ID,
                    "name": "Ok deal",
                    "end_date": "2026-10-01",
                },
            ]
        )

        async def flaky_publish(**kwargs):
            if kwargs["message_body"]["payload"].get("promo_id") == "p-bad":
                raise RuntimeError("broker unreachable")

        agent.publish = AsyncMock(side_effect=flaky_publish)
        await ProviderConversationAgent._check_expiring_promos(agent)

        alerted_ids = {row_id for row_id, _ in agent.database.updates}
        assert alerted_ids == {"p-good"}, (
            "p-bad's failed publish must not stop p-good from being alerted, "
            "and must not mark p-bad alerted either"
        )
        agent.logger.error.assert_called_once()
