"""Shared by the master_wine_library promotion specs (QA round 5, B-1, 2026-11-07).

The column set is REPLAYED from the migrations (baseline CREATE TABLE, then
every later ADD / DROP in filename order, generated columns excluded because a
direct write to one errors), and a PostgREST double records every column each
query names. Used by test_library_promotion_columns.py (the row, the review
queue), test_library_promotion_manual.py and test_library_promotion_auto.py.
"""

import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[3]
MIGRATIONS = REPO / "supabase" / "migrations"
BASELINE = MIGRATIONS / "20260805000000_baseline_from_production.sql"


# =============================================================================
# The columns, replayed from the migrations
# =============================================================================


def _create_table_columns(table: str) -> dict:
    """{column: definition} from the baseline CREATE TABLE."""
    sql = BASELINE.read_text()
    m = re.search(rf"CREATE TABLE public\.{table} \((.*?)\n\);", sql, re.DOTALL)
    assert m, f"{table} CREATE TABLE not found in the baseline"
    cols = {}
    for line in m.group(1).splitlines():
        line = line.strip().rstrip(",")
        if not line or line.upper().startswith("CONSTRAINT"):
            continue
        name, _, rest = line.partition(" ")
        cols[name.strip('"')] = rest
    return cols


def _replayed_columns(table: str) -> dict:
    """Baseline columns, then every later ALTER TABLE ADD/DROP COLUMN in order."""
    cols = _create_table_columns(table)
    stmt_re = re.compile(
        r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?\"?"
        + table
        + r"\"?\s+(.*?);",
        re.IGNORECASE | re.DOTALL,
    )
    clause_re = re.compile(
        r"(ADD|DROP)\s+COLUMN\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?\"?(\w+)\"?"
        r"((?:(?!\b(?:ADD|DROP)\s+COLUMN\b).)*)",
        re.IGNORECASE | re.DOTALL,
    )
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path == BASELINE:
            continue
        # Strip line comments so prose naming a column cannot add it.
        sql = re.sub(r"--[^\n]*", "", path.read_text())
        for body in stmt_re.findall(sql):
            for op, name, rest in clause_re.findall(body):
                if op.upper() == "DROP":
                    cols.pop(name, None)
                else:
                    cols[name] = rest
    return cols


LIBRARY = _replayed_columns("master_wine_library")
LIBRARY_WRITABLE = frozenset(
    c for c, d in LIBRARY.items() if "GENERATED ALWAYS" not in d.upper()
)
SUBMISSIONS = frozenset(_replayed_columns("master_wine_library_submissions"))


# =============================================================================
# A PostgREST double that records every column a query names
# =============================================================================


class _Resp:
    def __init__(self, data=None, count=None):
        self.data, self.count = data, count


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
        self.filters.append(column)
        return self

    eq = ilike = neq = is_ = _filter

    def limit(self, *a, **k):
        return self

    maybe_single = single = order = range = limit

    def execute(self):
        return self.db.respond(self)


class _DB:
    """Enough of the client for the three promotion paths."""

    def __init__(self, submission, insert_error=None):
        self.submission, self.insert_error = submission, insert_error
        self.queries = []

    def table(self, name):
        return _Query(self, name)

    def respond(self, q):
        if q.table == "master_wine_library" and q.op == "insert":
            if self.insert_error is not None:
                raise self.insert_error
            return _Resp([{"id": q.values.get("id", "lib-1")}])
        if q.table == "master_wine_library":
            return _Resp([])  # the manual path's name pre-check: no match
        if q.table == "master_wine_library_submissions" and q.op == "select":
            return _Resp(dict(self.submission))
        if q.table == "field_review_queue" and q.op == "select":
            return _Resp([], count=0)
        if q.table == "override_events" and q.op == "insert":
            return _Resp([{"id": "ov-1"}])
        if q.table == "user_roles":
            return _Resp([])
        return _Resp([{}])

    def library_inserts(self):
        return [
            q.values
            for q in self.queries
            if q.table == "master_wine_library" and q.op == "insert"
        ]

    def submission_updates(self):
        return [
            q.values
            for q in self.queries
            if q.table == "master_wine_library_submissions" and q.op == "update"
        ]


def _fc(value, confidence=0.95):
    return {"value": value, "confidence": confidence, "source": "visible"}


# Every field any of the three old rows read, so a dropped mapping cannot hide.
FIELD_CONFIDENCE = {
    "wine_name": _fc("Barolo Riserva"),
    "producer": _fc("Giacomo Conterno"),
    "vintage": _fc("NV"),
    "region": _fc("Piedmont"),
    "sub_region": _fc("Serralunga d'Alba"),
    "appellation": _fc("Barolo DOCG"),
    "country": _fc("Italy"),
    "grape_variety": _fc("Nebbiolo"),
    "primary_type": _fc("red"),
    "color": _fc("red"),
    "alcohol_pct": _fc("14.5"),
    "sweetness_level": _fc("dry"),
    "tasting_notes": _fc("tar and roses"),
    "description": _fc("a long-lived Barolo"),
    "food_pairing": _fc("braised beef"),
    "producer_bio": _fc("Monforte family estate"),
    "price_bottle": _fc("180"),
    "price_glass": _fc("28"),
    "section_name": _fc("Piedmont reds"),
    "bin_number": _fc("B-14"),
}

SUBMISSION = {
    "id": "sub-1",
    "status": "pending_review",
    "auto_blocked": False,
    "restaurant_id": "rest-1",
    "payload": {},
    "field_confidence": FIELD_CONFIDENCE,
    "grape_family": {"primary": "Nebbiolo", "blend": False, "family": "Nebbiolo"},
    "wine_structure": {"acidity": "high", "tannins": "firm"},
    "sensory_profile": {},
    "practical_attributes": None,
    "region_hierarchy": {"country": "Italy"},
    "critic_scores": {},
    "winemaking_details": {},
}


def _assert_real_columns(db):
    inserts = db.library_inserts()
    assert inserts, "no master_wine_library insert was sent"
    for row in inserts:
        assert set(row) <= LIBRARY_WRITABLE, (
            f"columns master_wine_library does not have (or cannot be written): "
            f"{sorted(set(row) - LIBRARY_WRITABLE)}"
        )
        assert row["wine_id"] and len(row["wine_id"]) <= 20  # varchar(20) NOT NULL
        assert row["primary_type"]  # NOT NULL
    for values in db.submission_updates():
        assert set(values) <= SUBMISSIONS, sorted(set(values) - SUBMISSIONS)
