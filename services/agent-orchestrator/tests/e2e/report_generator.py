"""
E2E Report Generator — pytest plugin
=====================================
Collects per-test outcomes (nodeid, status, duration, error) and writes
a JSON report to test-results/e2e-report.json at session finish.

Threat T-14-01: Authorization headers are never written to the report;
only response bodies and tracebacks (already redacted of secrets in tests).
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


class E2EReportGenerator:
    """Pytest plugin that captures test outcomes and emits a JSON report."""

    def __init__(self):
        self._results: List[Dict[str, Any]] = []
        self._session_start: float = time.time()

    @staticmethod
    def _extract_wave_from_nodeid(nodeid: str) -> str:
        """Extract wave letter from test node ID for cascading report correlation."""
        wave_map = {
            "wave_a_api_contracts": "A",
            "wave_b_agent_health": "B",
            "wave_c_agent_triggers": "C",
            "wave_d_toast_pipeline": "D",
            "wave_e_gmail_pipeline": "E",
            "prod_smoke": "F",
            "wave_g_calendar": "G",
        }
        for key, letter in wave_map.items():
            if key in nodeid:
                return letter
        return "unknown"

    def pytest_runtest_makereport(self, item, call):
        if call.when != "call":
            return
        outcome = "passed"
        error: Optional[Dict[str, str]] = None
        duration = call.duration if hasattr(call, "duration") else 0.0

        if call.excinfo is not None:
            import _pytest.outcomes as _outcomes

            if isinstance(call.excinfo.value, _outcomes.Skipped):
                outcome = "skipped"
                error = None
            else:
                outcome = "failed"
                tb = call.excinfo.getrepr(style="short")
                error = {
                    "message": str(call.excinfo.value),
                    "traceback": str(tb),
                }
        elif hasattr(call, "result") and call.result is None:
            outcome = "skipped"

        self._results.append(
            {
                "name": item.nodeid,
                "wave": self._extract_wave_from_nodeid(item.nodeid),
                "outcome": outcome,
                "duration_s": round(duration, 4),
                "error": error,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

    def pytest_runtest_logreport(self, report):
        if report.when != "call":
            return
        # Handle skipped tests (marked with pytest.mark.skip or xfail)
        if report.skipped:
            # Check if already recorded (makereport runs first)
            if not any(r["name"] == report.nodeid for r in self._results):
                self._results.append(
                    {
                        "name": report.nodeid,
                        "outcome": "skipped",
                        "duration_s": round(report.duration, 4),
                        "error": None,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )

    def pytest_sessionfinish(self, session, exitstatus):
        passed = sum(1 for r in self._results if r["outcome"] == "passed")
        failed = sum(1 for r in self._results if r["outcome"] == "failed")
        skipped = sum(1 for r in self._results if r["outcome"] == "skipped")

        report = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total": len(self._results),
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "tests": self._results,
        }

        # Resolve output path relative to the pytest rootdir / working dir
        output_dir = Path(session.config.rootdir) / "test-results"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "e2e-report.json"

        with open(output_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)

        print(f"\n[E2EReportGenerator] Report written to {output_path}")


def pytest_configure(config):
    """Register the E2EReportGenerator plugin with pytest."""
    config.pluginmanager.register(E2EReportGenerator(), "e2e_report_generator")
