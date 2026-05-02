#!/usr/bin/env python3
"""
Cascading Failure Report Generator — Phase 25 (TEST-PROD-08, D-16, D-17)
==========================================================================
Post-suite script: reads wave JUnit XML outputs, applies the wave dependency
graph (D-17), groups failures by root-cause cluster, annotates each cluster
with a suggested_fix (D-16), writes cascading_report.json and cascading_report.md.

Run after all waves complete in CI:
  python scripts/cascading_report.py --results-dir ../../test-results --output-dir ../../test-results

Wave dependency graph (D-17):
  A → B → C        (API contracts → agent health → agent triggers)
  A + B → D        (API + health → Toast pipeline)
  E (independent)  (Gmail pipeline)
  F (independent)  (Playwright frontend)
  E → G            (Gmail → Calendar)

Output:
  cascading_report.json   — machine-readable (CI / Sentry / PR comment body)
  cascading_report.md     — human-readable (PR comment, artifact preview)
"""

import argparse
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, FrozenSet, List, Optional, Set

# D-17: Wave dependency graph
# Maps each wave → list of waves it depends on
WAVE_DEPS: Dict[str, List[str]] = {
    "A": [],
    "B": ["A"],
    "C": ["B"],
    "D": ["A", "B"],
    "E": [],
    "F": [],
    "G": ["E"],
}

# D-16: Suggested fix per cluster of failed waves
SUGGESTED_FIXES: Dict[FrozenSet, str] = {
    frozenset(["A"]): (
        "Wave A (API contracts) failed. Check: (1) RAILWAY_ORCHESTRATOR_URL is correct. "
        "(2) ADMIN_API_KEY matches the Railway environment variable. "
        "(3) GET /health on the Railway URL returns 200. "
        "All other waves that depend on A (B, C, D) likely auto-recover if A is fixed."
    ),
    frozenset(["B"]): (
        "Wave B (agent health) failed. Check: (1) All 9 agents show Active on /admin/health. "
        "(2) RabbitMQ connection is established (Railway logs). "
        "(3) GET /api/v1/health/agents with X-Admin-Key returns 9 agents."
    ),
    frozenset(["A", "B"]): (
        "Waves A+B failed — cascading failure. Fix Wave A first (auth/connectivity). "
        "Wave B likely auto-recovers. Wave C and D may auto-recover once A+B pass."
    ),
    frozenset(["A", "B", "C"]): (
        "Waves A+B+C failed — root cause is Wave A auth. Fix RAILWAY_ORCHESTRATOR_URL "
        "and ADMIN_API_KEY in Railway. Restart the agent-orchestrator service."
    ),
    frozenset(["A", "B", "D"]): (
        "Toast pipeline (Wave D) cascaded from A+B failure. Fix Wave A auth first. "
        "Wave D will auto-recover once POSIntegrationAgent is healthy."
    ),
    frozenset(["E"]): (
        "Wave E (Gmail pipeline) failed. Check: (1) GMAIL_USER and GMAIL_PASSWORD "
        "are set on Railway orchestrator. (2) NotificationAgent is healthy (Wave B). "
        "(3) notification_deliveries table exists in Supabase."
    ),
    frozenset(["G"]): (
        "Wave G (Calendar) failed independently. Check: (1) CalendarAgent is healthy. "
        "(2) calendar_events table schema matches test payload columns. "
        "(3) CalendarAgent scan interval — the scheduling row may appear after > 30s."
    ),
    frozenset(["E", "G"]): (
        "Gmail failure (Wave E) cascaded to Calendar (Wave G). "
        "Fix GMAIL_USER/GMAIL_PASSWORD on Railway orchestrator. "
        "Wave G will auto-recover once email sending works."
    ),
    frozenset(["F"]): (
        "Wave F (Playwright frontend) failed. Check: (1) E2E_BASE_URL points to the "
        "correct production Vercel URL. (2) Login page selectors match data-testid attributes. "
        "(3) E2E_TEST_EMAIL/PASSWORD are correct. (4) /admin/health UI shows agent status."
    ),
}

FALLBACK_FIX = (
    "Investigate the specific wave failures above. Check Railway logs for the affected "
    "agents and services. Run the failing wave locally against production: "
    "pytest tests/e2e/wave_{X}.py -v --tb=long"
)


def parse_junit_xml(xml_path: Path) -> List[Dict]:
    """Parse a JUnit XML file and return a list of test result dicts."""
    results = []
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        # Handle both <testsuite> (root) and <testsuites> (wrapper)
        testsuites = (
            root.findall("testsuite")
            if root.tag == "testsuites"
            else [root]
        )
        for suite in testsuites:
            for testcase in suite.findall("testcase"):
                failure = testcase.find("failure")
                error = testcase.find("error")
                skipped = testcase.find("skipped")
                status = "passed"
                message: Optional[str] = None
                if failure is not None:
                    status = "failed"
                    message = failure.get("message", str(failure.text or ""))[:500]
                elif error is not None:
                    status = "error"
                    message = error.get("message", str(error.text or ""))[:500]
                elif skipped is not None:
                    status = "skipped"
                results.append({
                    "classname": testcase.get("classname", ""),
                    "name": testcase.get("name", ""),
                    "time": float(testcase.get("time", "0")),
                    "status": status,
                    "message": message,
                })
    except Exception as exc:
        results.append({
            "classname": "ParseError",
            "name": str(xml_path.name),
            "time": 0.0,
            "status": "error",
            "message": f"Failed to parse JUnit XML: {exc}",
        })
    return results


def collect_wave_results(results_dir: Path) -> Dict[str, Dict]:
    """Collect test results keyed by wave letter.

    M-02 fix: B and C now have separate JUnit XML files (wave_b.xml, wave_c.xml).
    This allows cascading_report to distinguish B-only failures from C-only failures,
    producing precise root-cause analysis instead of marking both failed on any issue.
    """
    wave_files = {
        "A": "wave_a.xml",
        "B": "wave_b.xml",
        "C": "wave_c.xml",
        "D": "wave_d.xml",
        "E": "wave_e.xml",
        "F": "wave_f.xml",
        "G": "wave_g.xml",
    }
    wave_results: Dict[str, Dict] = {}

    for wave_key, xml_name in wave_files.items():
        xml_path = results_dir / xml_name
        if not xml_path.exists():
            wave_results[wave_key] = {
                "status": "missing",
                "tests": [],
                "failed_count": 0,
                "passed_count": 0,
                "skipped_count": 0,
            }
            continue

        tests = parse_junit_xml(xml_path)
        failed = [t for t in tests if t["status"] in ("failed", "error")]
        passed = [t for t in tests if t["status"] == "passed"]
        skipped = [t for t in tests if t["status"] == "skipped"]
        wave_results[wave_key] = {
            "status": "failed" if failed else "passed",
            "tests": tests,
            "failed_count": len(failed),
            "passed_count": len(passed),
            "skipped_count": len(skipped),
            "failures": [{"name": t["name"], "message": t["message"]} for t in failed],
        }

    return wave_results


def find_failed_waves(wave_results: Dict[str, Dict]) -> Set[str]:
    """Return set of wave letters that have failures."""
    failed = set()
    for wave, result in wave_results.items():
        if result.get("status") in ("failed", "error", "missing"):
            failed.add(wave)
    return failed


def determine_root_causes(failed_waves: Set[str]) -> List[Dict]:
    """Cluster failed waves by dependency graph; identify root causes."""
    if not failed_waves:
        return []

    # Find root-cause waves: failed waves with no failed dependency
    root_causes = set()
    for wave in failed_waves:
        deps = WAVE_DEPS.get(wave, [])
        all_deps_ok = all(dep not in failed_waves for dep in deps)
        if all_deps_ok:
            root_causes.add(wave)

    # Build clusters: root cause → cascaded waves
    clusters = []
    assigned: Set[str] = set()
    for root in sorted(root_causes):
        cluster_waves = {root}
        for wave in failed_waves:
            if wave != root:
                deps = WAVE_DEPS.get(wave, [])
                if root in deps or any(d in cluster_waves for d in deps):
                    cluster_waves.add(wave)
        assigned.update(cluster_waves)

        frozen_key: FrozenSet = frozenset(cluster_waves)
        suggested_fix = SUGGESTED_FIXES.get(
            frozen_key,
            SUGGESTED_FIXES.get(frozenset([root]), FALLBACK_FIX),
        )
        clusters.append({
            "root_cause_wave": root,
            "cascaded_waves": sorted(cluster_waves - {root}),
            "all_failed_waves": sorted(cluster_waves),
            "suggested_fix": suggested_fix,
        })

    # Append any unassigned failures as standalone clusters
    unassigned = failed_waves - assigned
    for wave in sorted(unassigned):
        clusters.append({
            "root_cause_wave": wave,
            "cascaded_waves": [],
            "all_failed_waves": [wave],
            "suggested_fix": SUGGESTED_FIXES.get(
                frozenset([wave]), FALLBACK_FIX
            ),
        })

    return clusters


def generate_markdown(
    wave_results: Dict[str, Dict],
    clusters: List[Dict],
    failed_waves: Set[str],
) -> str:
    """Generate a Markdown cascading failure report."""
    lines = [
        "# Production E2E Cascading Failure Report",
        "",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
    ]

    if not failed_waves:
        lines += ["## ✅ All Waves Passed", "", "No failures to report."]
        return "\n".join(lines)

    # Wave summary table
    lines += [
        "## Wave Results Summary",
        "",
        "| Wave | Status | Tests | Passed | Failed | Skipped |",
        "|------|--------|-------|--------|--------|---------|",
    ]
    for wave in sorted("ABCDEFG"):
        result = wave_results.get(wave, {"status": "missing"})
        status = result.get("status", "missing")
        if status == "passed":
            status_icon = "✅"
        elif status in ("failed", "error"):
            status_icon = "❌"
        else:
            status_icon = "⚠️"
        tests = (
            result.get("passed_count", 0)
            + result.get("failed_count", 0)
            + result.get("skipped_count", 0)
        )
        lines.append(
            f"| {wave} | {status_icon} {status} | "
            f"{tests} | {result.get('passed_count', '-')} | "
            f"{result.get('failed_count', '-')} | {result.get('skipped_count', '-')} |"
        )

    lines += ["", "## Root Cause Analysis", ""]
    for i, cluster in enumerate(clusters, 1):
        root = cluster["root_cause_wave"]
        cascaded = cluster.get("cascaded_waves", [])
        lines += [
            f"### Cluster {i}: Root Cause in Wave {root}",
            "",
        ]
        if cascaded:
            lines.append(f"**Cascaded failures:** Waves {', '.join(cascaded)}")
        lines += [
            "",
            f"**Suggested fix:** {cluster['suggested_fix']}",
            "",
        ]

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 25 Cascading Failure Report")
    parser.add_argument(
        "--results-dir",
        default="test-results",
        help="Directory containing wave_*.xml JUnit files",
    )
    parser.add_argument(
        "--output-dir",
        default="test-results",
        help="Directory to write cascading_report.json and .md",
    )
    args = parser.parse_args()

    results_dir = Path(args.results_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"[cascading_report] Reading wave XML from: {results_dir}")
    wave_results = collect_wave_results(results_dir)
    failed_waves = find_failed_waves(wave_results)
    clusters = determine_root_causes(failed_waves)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "failed_waves": sorted(failed_waves),
        "all_passed": len(failed_waves) == 0,
        "clusters": clusters,
        "wave_results": {
            k: {
                "status": v.get("status"),
                "failed_count": v.get("failed_count", 0),
                "passed_count": v.get("passed_count", 0),
            }
            for k, v in wave_results.items()
        },
    }

    json_path = output_dir / "cascading_report.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"[cascading_report] JSON report: {json_path}")

    md_path = output_dir / "cascading_report.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(generate_markdown(wave_results, clusters, failed_waves))
    print(f"[cascading_report] Markdown report: {md_path}")

    if failed_waves:
        print(f"\n[cascading_report] ⚠️  Failed waves: {sorted(failed_waves)}")
        for cluster in clusters:
            print(f"  Root cause: Wave {cluster['root_cause_wave']}")
            print(f"  Fix: {cluster['suggested_fix'][:100]}...")
    else:
        print("\n[cascading_report] ✅ All waves passed!")


if __name__ == "__main__":
    main()
