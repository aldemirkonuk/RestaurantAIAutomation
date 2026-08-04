"""OBS-04 business metrics.

The requirement OBS-04 sat unticked while the module docstring above the endpoint
claimed it was delivered. The point of these metrics is the failure mode that
OBS-01..03 structurally cannot see: every process healthy, every queue drained,
and no wine poured, no notification delivered, no report produced.

The assertions that matter most here are the ones separating **zero** from
**unknown**. A dashboard that renders "0 ms average latency" when the query failed,
or "100% delivery" when nothing was sent, is worse than no dashboard — it reports
health it never measured. Each of those cases has a test below.
"""

import pytest

from api.health_routes import (
    BUSINESS_SAMPLE_LIMIT,
    collect_business_metrics,
)


class FakeQuery:
    """Chainable PostgREST stub. Records nothing; just returns what it was given."""

    def __init__(self, rows, count=None, raises=None):
        self._rows = rows
        self._count = count
        self._raises = raises
        self.not_ = self  # supports .not_.is_(...)

    def select(self, *_a, **_k):
        return self

    def gte(self, *_a, **_k):
        return self

    def is_(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        if self._raises:
            raise self._raises
        return type("Result", (), {"data": self._rows, "count": self._count})()


class FakeClient:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        entry = self._tables.get(name)
        if entry is None:
            return FakeQuery([], count=0)
        return entry


def _client(**tables):
    return FakeClient(tables)


class TestNoClient:
    def test_every_metric_degrades_when_there_is_no_database(self):
        out = collect_business_metrics(None)

        assert out["stock_updates"] is None
        assert out["notification_delivery"] is None
        assert set(out["degraded"]) == {
            "stock_updates",
            "notification_delivery",
            "report_generation_ms",
            "webhook_processing_latency_ms",
        }
        assert "degraded_reason" in out


class TestStockUpdates:
    def test_computes_a_rate_from_the_window(self):
        out = collect_business_metrics(
            _client(inventory_events=FakeQuery([], count=600)),
            window_seconds=300,
        )
        assert out["stock_updates"] == {"count": 600, "per_second": 2.0}

    def test_a_dead_business_reads_as_zero_not_as_missing(self):
        # This is the alarm OBS-04 exists to raise: the platform is fine and
        # nothing is happening. It must be a hard 0, distinguishable from null.
        out = collect_business_metrics(
            _client(inventory_events=FakeQuery([], count=0)),
        )
        assert out["stock_updates"]["per_second"] == 0
        assert "stock_updates" not in out["degraded"]


class TestNotificationDelivery:
    def test_rate_counts_only_delivered_statuses(self):
        rows = [
            {"status": "delivered"},
            {"status": "sent"},
            {"status": "failed"},
            {"status": "queued"},
        ]
        out = collect_business_metrics(
            _client(notification_deliveries=FakeQuery(rows, count=4)),
        )
        assert out["notification_delivery"] == {
            "attempted": 4,
            "delivered": 2,
            "rate": 0.5,
        }

    def test_nothing_attempted_is_not_a_hundred_percent_success(self):
        # The bug this guards: delivered/total with total==0 either divides by
        # zero or gets "helpfully" defaulted to 1.0, painting a silent
        # notification pipeline as perfectly healthy.
        out = collect_business_metrics(
            _client(notification_deliveries=FakeQuery([], count=0)),
        )
        assert out["notification_delivery"]["rate"] is None
        assert out["notification_delivery"]["attempted"] == 0


class TestReportGeneration:
    def test_summarizes_generation_times(self):
        rows = [{"generation_time_ms": v} for v in (100, 200, 300, 400)]
        out = collect_business_metrics(
            _client(generated_reports=FakeQuery(rows)),
        )
        summary = out["report_generation_ms"]
        assert summary["count"] == 4
        assert summary["avg"] == 250.0
        assert summary["p95"] == 400.0

    def test_empty_sample_reports_none_not_zero(self):
        out = collect_business_metrics(_client(generated_reports=FakeQuery([])))
        assert out["report_generation_ms"] == {
            "count": 0,
            "avg": None,
            "p50": None,
            "p95": None,
        }


class TestWebhookLatency:
    def test_measures_created_to_processed(self):
        rows = [
            {
                "created_at": "2026-08-04T12:00:00+00:00",
                "processed_at": "2026-08-04T12:00:00.250000+00:00",
            },
            {
                "created_at": "2026-08-04T12:00:01+00:00",
                "processed_at": "2026-08-04T12:00:01.750000+00:00",
            },
        ]
        out = collect_business_metrics(_client(sales_events=FakeQuery(rows)))
        summary = out["webhook_processing_latency_ms"]
        assert summary["count"] == 2
        assert summary["avg"] == 500.0

    def test_drops_negative_deltas_from_clock_skew(self):
        # processed_at before created_at means two clocks disagreed. Keeping the
        # negative would drag the average toward zero and make a slow webhook
        # look fast — the one direction of error nobody would investigate.
        rows = [
            {
                "created_at": "2026-08-04T12:00:00+00:00",
                "processed_at": "2026-08-04T11:59:59+00:00",
            },
            {
                "created_at": "2026-08-04T12:00:00+00:00",
                "processed_at": "2026-08-04T12:00:00.400000+00:00",
            },
        ]
        out = collect_business_metrics(_client(sales_events=FakeQuery(rows)))
        assert out["webhook_processing_latency_ms"]["count"] == 1
        assert out["webhook_processing_latency_ms"]["avg"] == 400.0

    def test_unparseable_timestamps_are_skipped_not_fatal(self):
        rows = [
            {"created_at": "not-a-date", "processed_at": "also-not"},
            {
                "created_at": "2026-08-04T12:00:00+00:00",
                "processed_at": "2026-08-04T12:00:00.100000+00:00",
            },
        ]
        out = collect_business_metrics(_client(sales_events=FakeQuery(rows)))
        assert out["webhook_processing_latency_ms"]["count"] == 1
        assert "webhook_processing_latency_ms" not in out["degraded"]

    def test_flags_when_the_sample_hit_the_cap(self):
        # A capped sample is a biased sample. Saying so lets a reader discount
        # the percentile instead of trusting a number drawn from the first N rows.
        rows = [
            {
                "created_at": "2026-08-04T12:00:00+00:00",
                "processed_at": "2026-08-04T12:00:00.100000+00:00",
            }
        ] * BUSINESS_SAMPLE_LIMIT
        out = collect_business_metrics(_client(sales_events=FakeQuery(rows)))
        assert out["webhook_processing_latency_ms"]["sample_capped"] is True


class TestIndependentDegradation:
    def test_one_broken_table_does_not_blank_the_others(self):
        # Without per-metric try/except, a missing notification_deliveries table
        # on an older deployment would take the whole endpoint down and hide
        # stock throughput too — losing the signal precisely when investigating.
        out = collect_business_metrics(
            _client(
                inventory_events=FakeQuery([], count=42),
                notification_deliveries=FakeQuery(
                    [], raises=RuntimeError("relation does not exist")
                ),
            ),
        )
        assert out["stock_updates"]["count"] == 42
        assert out["notification_delivery"] is None
        assert out["degraded"] == ["notification_delivery"]

    @pytest.mark.parametrize("window", [0, -5])
    def test_a_nonsense_window_cannot_divide_by_zero(self, window):
        out = collect_business_metrics(
            _client(inventory_events=FakeQuery([], count=10)),
            window_seconds=window,
        )
        assert out["window_seconds"] == 1
        assert out["stock_updates"]["per_second"] == 10.0
