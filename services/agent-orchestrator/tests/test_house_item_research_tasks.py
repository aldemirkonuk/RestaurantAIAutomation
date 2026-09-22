"""
The enrich chain works the house item research queue, linked by id.

Founder, 2026-09-22 (round 6u), verbatim pick: "Existing enrich chain
(Recommended)" (ADR 0192, third amendment).

Real: ``dispatch_claimed`` and the task's flag gate. Stand-ins: the Supabase
client (a recorder that answers the claim RPC with the rows the SQL would
return; the SQL itself — claim, lease, one submission per item, the flip to
matched, placeholders never claimed — is proven in PGlite,
p4-scratch/pglite-probe/E4-migrations.mjs) and the Celery hand-off.
"""

from unittest.mock import patch

import pytest

from jobs import house_item_research_tasks as tasks


class _Exec:
    def __init__(self, data=None, raises=None):
        self._data = data
        self._raises = raises

    def execute(self):
        if self._raises:
            raise self._raises
        return type("Resp", (), {"data": self._data})()


class _Update:
    def __init__(self, client, table, patch):
        self.client = client
        self.table = table
        self.patch = patch
        self.filters = []

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        self.filters.append(("is", col, val))
        return self

    def execute(self):
        self.client.updates.append(
            {"table": self.table, "patch": self.patch, "filters": self.filters}
        )
        if self.client.update_raises:
            raise self.client.update_raises
        return type("Resp", (), {"data": []})()


class _Table:
    def __init__(self, client, name):
        self.client = client
        self.name = name

    def update(self, patch):
        return _Update(self.client, self.name, patch)


class FakeClient:
    def __init__(self, claimed=None, claim_raises=None, update_raises=None):
        self.claimed = claimed or []
        self.claim_raises = claim_raises
        self.update_raises = update_raises
        self.rpcs = []
        self.updates = []

    def rpc(self, name, args):
        self.rpcs.append((name, args))
        return _Exec(self.claimed, self.claim_raises)

    def table(self, name):
        return _Table(self, name)


ROW = {
    "research_id": "hir-1",
    "house_id": "house-1",
    "item_id": "item-1",
    "library_submission_id": "sub-1",
    "name_to_research": "Kavaklidere Yakut 2019",
}


def test_each_claimed_submission_goes_to_the_chain_with_its_classified_name():
    client = FakeClient(claimed=[ROW])
    handed = []
    counts = tasks.dispatch_claimed(
        client, lambda sid, name: handed.append((sid, name))
    )
    assert handed == [("sub-1", "Kavaklidere Yakut 2019")]
    assert client.rpcs == [
        (
            "claim_house_item_research",
            {"p_limit": 10, "p_lease_minutes": 30, "p_max_attempts": 5},
        )
    ]
    assert counts == {"claimed": 1, "handed": 1, "failed": 0, "unstamped": 0}
    # Stamped by id, for THIS submission, only if not already stamped.
    [stamp] = client.updates
    assert stamp["table"] == "house_item_research"
    assert set(stamp["patch"]) == {"dispatched_at", "last_dispatch_error"}
    assert stamp["patch"]["last_dispatch_error"] is None
    assert stamp["filters"] == [
        ("eq", "id", "hir-1"),
        ("eq", "submission_id", "sub-1"),
        ("is", "dispatched_at", "null"),
    ]


def test_a_refused_hand_off_is_recorded_and_the_row_is_not_stamped_dispatched():
    client = FakeClient(claimed=[ROW])

    def refuse(_sid, _name):
        raise ConnectionError("broker unreachable")

    counts = tasks.dispatch_claimed(client, refuse)
    assert counts == {"claimed": 1, "handed": 0, "failed": 1, "unstamped": 0}
    [record] = client.updates
    assert "dispatched_at" not in record["patch"]
    assert record["patch"]["dispatch_claimed_at"] is None
    assert "broker unreachable" in record["patch"]["last_dispatch_error"]
    assert record["filters"] == [("eq", "id", "hir-1"), ("is", "dispatched_at", "null")]


def test_a_row_without_its_name_or_submission_is_never_handed_off():
    client = FakeClient(
        claimed=[
            {**ROW, "name_to_research": "  "},
            {**ROW, "research_id": "hir-2", "library_submission_id": None},
        ]
    )
    handed = []
    counts = tasks.dispatch_claimed(client, lambda sid, name: handed.append(sid))
    assert handed == []
    assert counts["failed"] == 2
    assert client.updates == []


def test_a_claim_that_cannot_be_read_is_an_error_never_nothing_to_do():
    client = FakeClient(claim_raises=RuntimeError("permission denied for function"))
    with pytest.raises(RuntimeError, match="permission denied"):
        tasks.dispatch_claimed(client, lambda sid, name: None)


def test_a_stamp_that_cannot_be_written_is_counted_not_read_as_stamped():
    client = FakeClient(claimed=[ROW], update_raises=RuntimeError("timeout"))
    counts = tasks.dispatch_claimed(client, lambda sid, name: None)
    assert counts == {"claimed": 1, "handed": 1, "failed": 0, "unstamped": 1}


def test_the_sweep_is_off_unless_the_flag_says_true(monkeypatch):
    for value in (None, "", "false", "1", "yes", "TRUE "):
        if value is None:
            monkeypatch.delenv(tasks.DISPATCH_FLAG, raising=False)
        else:
            monkeypatch.setenv(tasks.DISPATCH_FLAG, value)
        expected = value is not None and value.strip().lower() == "true"
        assert tasks.dispatch_enabled() is expected


def test_the_task_claims_nothing_while_off(monkeypatch):
    monkeypatch.delenv(tasks.DISPATCH_FLAG, raising=False)
    with patch.object(tasks, "create_client") as create:
        out = tasks.dispatch_house_item_research()
    assert out == {"enabled": False}
    create.assert_not_called()


def test_the_task_hands_off_to_haiku_enrich_by_submission_id_when_on(monkeypatch):
    monkeypatch.setenv(tasks.DISPATCH_FLAG, "true")
    client = FakeClient(claimed=[ROW])
    with (
        patch.object(tasks, "create_client", return_value=client),
        patch("jobs.haiku_tasks.haiku_enrich_task.delay") as delay,
    ):
        out = tasks.dispatch_house_item_research()
    delay.assert_called_once_with(
        wine_id="sub-1", wine_name="Kavaklidere Yakut 2019", vintage=None
    )
    assert out == {
        "enabled": True,
        "claimed": 1,
        "handed": 1,
        "failed": 0,
        "unstamped": 0,
    }


def test_the_beat_runs_it_hourly_and_the_worker_imports_it():
    from jobs.celery_app import celery_app

    entry = celery_app.conf.beat_schedule["house-item-research-dispatch"]
    assert entry["task"] == "house_item_research.dispatch"
    assert "jobs.house_item_research_tasks" in celery_app.conf.imports
