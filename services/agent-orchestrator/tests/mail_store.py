"""
Test support for the inbound-mail tests: a supabase table store that runs
ILIKE the way PostgREST and Postgres do. Not collected (no ``test_`` prefix);
no product code imports it.
"""

import re


def like_to_regex(pattern: str) -> "re.Pattern":
    """ILIKE as PostgREST v14 + Postgres 15 run it (QA rounds 24 and 25,
    measured live): PostgREST first rewrites every ``*`` to ``%``, escaped or
    not; then ``%`` matches any run, ``_`` one character, and a backslash
    escapes the next character. So ``\\*`` reaches Postgres as ``\\%``, a
    literal percent sign."""
    pattern = pattern.replace("*", "%")
    out, i = "", 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            i += 1
            out += re.escape(pattern[i])
        elif ch == "%":
            out += ".*"
        elif ch == "_":
            out += "."
        else:
            out += re.escape(ch)
        i += 1
    return re.compile(f"^{out}$", re.IGNORECASE | re.DOTALL)


def rows(columns: str, *values):
    """``rows("id restaurant_id", ("p-1", "house-A"))`` -> a list of dicts."""
    names = columns.split()
    return [dict(zip(names, v)) for v in values]


def _field(row, col):
    if "->>" in col:
        outer, key = col.split("->>", 1)
        return (row.get(outer) or {}).get(key)
    return row.get(col)


class Result:
    """What supabase-py's ``execute()`` returns. Also awaitable, because one
    agent awaits ``execute()`` and another does not."""

    def __init__(self, data):
        self.data = data

    def __await__(self):
        return self
        yield  # pragma: no cover - makes this a generator


class _Not:
    def __init__(self, query):
        self.query = query

    def is_(self, col, value):
        if value in (None, "null"):
            self.query.filters.append(lambda r: _field(r, col) is not None)
        return self.query


class Query:
    def __init__(self, store, table):
        self.store, self.table, self.filters = store, table, []
        self.payload, self.lim, self.embeds = None, None, {}

    def select(self, columns="*", *_a, **_k):
        # A filter on ``rel.col`` needs ``rel!inner(...)``, as in PostgREST.
        self.embeds = dict(re.findall(r"(\w+)(!inner)?\(", columns))
        return self

    def _check(self, col):
        """A column the table lacks raises, as PostgREST does (400)."""
        rel, sub = col.split(".", 1) if "." in col else (self.table, col)
        known = (self.store.columns or {}).get(rel)
        if "." in col and not self.embeds.get(rel) or known and sub not in known:
            raise LookupError(f"column {col} does not exist here")

    def _filter(self, col, test):
        self._check(col)
        if "." not in col:
            self.filters.append(lambda r: test(_field(r, col)))
            return self
        rel, sub = col.split(".", 1)
        fk = rel[:-1] + "_id"  # providers -> provider_id

        def keep(r):
            parents = self.store.tables.get(rel, [])
            return any(
                p.get("id") == r.get(fk) and test(_field(p, sub)) for p in parents
            )

        self.filters.append(keep)
        return self

    def eq(self, col, value):
        return self._filter(col, lambda v: v == value)

    def ilike(self, col, pattern):
        rx = like_to_regex(pattern)
        return self._filter(col, lambda v: bool(rx.match(str(v or ""))))

    def in_(self, col, values):
        self.filters.append(lambda r: _field(r, col) in values)
        return self

    @property
    def not_(self):
        return _Not(self)

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.lim = n
        return self

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.payload is not None:
            self.store.inserts.append((self.table, self.payload))
            return Result([self.payload])
        self.store.reads.append(self.table)
        found = self.store.tables.get(self.table, [])
        found = [r for r in found if all(f(r) for f in self.filters)]
        return Result(found[: self.lim] if self.lim else found)


class Store:
    """``store.supabase`` stands in for the client; ``inserts`` and ``reads``
    record what the code under test wrote and which tables it read."""

    def __init__(self, tables, columns=None):
        self.tables, self.inserts, self.reads = tables, [], []
        self.columns = columns  # {table: {column}}; None checks nothing
        self.supabase = self

    def table(self, name):
        return Query(self, name)
