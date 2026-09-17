#!/usr/bin/env python3
"""Merge every nightly result into ONE honest summary (ADR 0135).

Inputs (any may be missing — a missing input is itself recorded as
cannot_check, never dropped):

  test-results/nightly/nightly-summary.json   the browser walk (honest-reporter.ts)
  test-results/wave_h_checks.jsonl            Wave H four-state records
  test-results/wave_[a-h].xml                 pytest / Playwright JUnit
  test-results/orchestrator-preflight.json    {"reachable": bool, "status": int|null, "reason": str}
  test-results/backtests.json                 {"steps": [{"name", "exit", "reason"}]}

Output: test-results/nightly-summary.json + nightly-summary.md, and the same
Markdown appended to $GITHUB_STEP_SUMMARY when set.

Exit codes (founder's call 2026-09-17: a failure is always the headline):
  0  every recorded check passed or was an honest absence
  1  at least one check FAILED (a production signal) — whatever else could not run
  2  no check failed, but at least one COULD NOT RUN, or the corpus was empty —
     the run proves nothing about those surfaces and must not read as a pass

Why a separate script: JUnit knows pass/fail/skip; it has no word for "the
thing I would have checked is not on this build" and no word for "the check
did not run". Both are read as green by everything that reads JUnit. This
script is where those two states are counted, named, and made red on purpose.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

STATES = ("pass", "fail", "absent", "cannot_check")
BADGE = {
    "pass": "✅ pass",
    "fail": "❌ fail",
    "absent": "⬜ absent",
    "cannot_check": "🚫 cannot_check",
}
WAVE_NAMES = {
    "a": "A — orchestrator API contracts",
    "b": "B — orchestrator agent health",
    "c": "C — RabbitMQ triggers",
    # d, e, g retired 2026-09-12 (ADR 0137); a stray wave_d/e/g.xml still renders by letter
    "f": "F — browser walk (Playwright)",
    "h": "H — gateway contracts + backtest honesty (read-only)",
}


def _load_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        return {"__parse_error__": str(exc)}
    except (OSError, UnicodeDecodeError) as exc:
        # A truncated or unreadable artifact is the REPORTER failing to read its
        # own inputs, not a product failure (audit of PR #349, finding 1.4). It is
        # returned as a parse error so the caller records cannot_check.
        return {"__parse_error__": f"{type(exc).__name__}: {exc}"}


def collect(results: Path) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    # 1. Browser walk
    pw = _load_json(results / "nightly" / "nightly-summary.json")
    if pw is None:
        checks.append(
            {
                "id": "wave.f",
                "state": "cannot_check",
                "reason": "no nightly-summary.json — the browser walk produced no summary (crashed before the reporter ran, or never started)",
                "source": "playwright",
            }
        )
    elif "__parse_error__" in pw:
        checks.append(
            {
                "id": "wave.f",
                "state": "cannot_check",
                "reason": f"nightly-summary.json unreadable: {pw['__parse_error__']}",
                "source": "playwright",
            }
        )
    else:
        for c in pw.get("checks") or []:
            checks.append(
                {
                    "id": f"f.{c.get('id')}",
                    "state": (
                        c.get("state") if c.get("state") in STATES else "cannot_check"
                    ),
                    "reason": str(c.get("reason", "")),
                    "source": "playwright",
                }
            )
        if not pw.get("checks"):
            checks.append(
                {
                    "id": "wave.f",
                    "state": "cannot_check",
                    "reason": "the browser walk recorded zero checks",
                    "source": "playwright",
                }
            )

    # 2. Wave H records
    hp = results / "wave_h_checks.jsonl"
    try:
        h_lines = hp.read_text(encoding="utf-8").splitlines() if hp.exists() else None
    except (OSError, UnicodeDecodeError) as exc:
        # A truncated artifact is the summary failing to read its input, never a
        # product failure (security N5, 2026-09-17).
        checks.append(
            {
                "id": "wave.h",
                "state": "cannot_check",
                "reason": f"wave_h_checks.jsonl unreadable: {type(exc).__name__}",
                "source": "wave_h",
            }
        )
        h_lines = []
    if h_lines is not None:
        n = 0
        for line in h_lines:
            if not line.strip():
                continue
            try:
                c = json.loads(line)
            except json.JSONDecodeError:
                checks.append(
                    {
                        "id": "wave.h.parse",
                        "state": "cannot_check",
                        "reason": "a wave_h_checks.jsonl line was not JSON",
                        "source": "wave_h",
                    }
                )
                continue
            n += 1
            checks.append(
                {
                    "id": str(c.get("id")),
                    "state": (
                        c.get("state") if c.get("state") in STATES else "cannot_check"
                    ),
                    "reason": str(c.get("reason", "")),
                    "source": "wave_h",
                }
            )
        if n == 0:
            checks.append(
                {
                    "id": "wave.h",
                    "state": "cannot_check",
                    "reason": "wave_h_checks.jsonl is empty — Wave H recorded nothing",
                    "source": "wave_h",
                }
            )
        checks.extend(unrecorded_junit("h", results / "wave_h.xml", checks))
    else:
        checks.append(
            {
                "id": "wave.h",
                "state": "cannot_check",
                "reason": "no wave_h_checks.jsonl — Wave H did not run",
                "source": "wave_h",
            }
        )

    # 3. Orchestrator preflight + legacy waves A–E, G
    pre = _load_json(results / "orchestrator-preflight.json")
    if pre is None or "__parse_error__" in pre:
        checks.append(
            {
                "id": "orchestrator.preflight",
                "state": "cannot_check",
                "reason": "no orchestrator-preflight.json — the orchestrator was never probed",
                "source": "preflight",
            }
        )
        reachable = None
    else:
        reachable = bool(pre.get("reachable"))
        checks.append(
            {
                "id": "orchestrator.preflight",
                "state": "pass" if reachable else "cannot_check",
                "reason": str(pre.get("reason", "")),
                "source": "preflight",
            }
        )
    # D, E and G were deleted 2026-09-12 (ADR 0137). Expecting their XML made
    # every run end cannot_check (exit 2) forever; measured 2026-09-17 on the
    # first full local pipeline run. A stray wave_d/e/g.xml is ignored.
    unarmed = _load_json(results / "wave_c_unarmed.json")
    for letter in "abc":
        xml_path = results / f"wave_{letter}.xml"
        if letter == "c" and isinstance(unarmed, dict) and unarmed.get("unarmed"):
            # Founder's F2 answer keeps Wave C unarmed; decided 2026-09-17 that
            # this reads as an absence, not as an unrun check. The day
            # RABBITMQ_URL is set the marker is not written and C counts again.
            checks.append(
                {
                    "id": "wave.c",
                    "state": "absent",
                    "reason": str(
                        unarmed.get("reason")
                        or "Wave C is unarmed by decision (RABBITMQ_URL unset)"
                    ),
                    "source": "junit",
                }
            )
            continue
        if not xml_path.exists():
            if reachable is False:
                checks.append(
                    {
                        "id": f"wave.{letter}",
                        "state": "cannot_check",
                        "reason": f"Wave {letter.upper()} did not run: the orchestrator is unreachable (see orchestrator.preflight)",
                        "source": "junit",
                    }
                )
            else:
                checks.append(
                    {
                        "id": f"wave.{letter}",
                        "state": "cannot_check",
                        "reason": f"Wave {letter.upper()} produced no wave_{letter}.xml",
                        "source": "junit",
                    }
                )
            continue
        checks.extend(junit_checks(letter, xml_path))

    # 4. Backtests (offline, this checkout)
    bt = _load_json(results / "backtests.json")
    if bt is None or "__parse_error__" in bt:
        checks.append(
            {
                "id": "backtests",
                "state": "cannot_check",
                "reason": "no backtests.json — the offline backtests did not run",
                "source": "backtests",
            }
        )
    else:
        steps = bt.get("steps") or []
        if not steps:
            checks.append(
                {
                    "id": "backtests",
                    "state": "cannot_check",
                    "reason": "backtests.json lists no steps",
                    "source": "backtests",
                }
            )
        for st in steps:
            code = st.get("exit")
            state = backtest_state(st.get("name"), code, results)
            checks.append(
                {
                    "id": f"backtest.{st.get('name')}",
                    "state": state,
                    "reason": f"{st.get('reason', '')} (exit {code})",
                    "source": "backtests",
                }
            )
    return checks


def backtest_state(name: Any, code: Any, results: Path) -> str:
    """0 passes. Only a run that reached its assertions and saw them fail is a
    fail: pytest exits 1 for that and 2-5 for interruption, internal error,
    usage error or no tests; Jest exits 1 for failures AND for a config crash,
    so its log must show a failed test count (correctness 4, 2026-09-17)."""
    if code == 0:
        return "pass"
    if code != 1:
        return "cannot_check"
    if name == "forecast_pinned":
        try:
            log = (results / "backtest_forecast.log").read_text(
                encoding="utf-8", errors="replace"
            )
        except OSError:
            return "cannot_check"
        return "fail" if re.search(r"Tests:\s.*\d+ failed", log) else "cannot_check"
    return "fail"


def unrecorded_junit(
    letter: str, xml_path: Path, checks: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """A test that raised before, or after, recording its check leaves only the
    runner's XML behind. More failed/errored cases than recorded non-pass
    checks means some were never recorded: that is cannot_check, not silence
    (correctness 1, 2026-09-17: an errored Wave H merged to PASS)."""
    if not xml_path.exists():
        return []
    try:
        cases = list(ET.parse(xml_path).getroot().iter("testcase"))
    except ET.ParseError as exc:
        return [
            {
                "id": f"wave.{letter}.junit",
                "state": "cannot_check",
                "reason": f"wave_{letter}.xml unparseable: {exc}",
                "source": f"wave_{letter}",
            }
        ]
    bad = [
        tc
        for tc in cases
        if tc.find("failure") is not None or tc.find("error") is not None
    ]
    recorded = sum(
        1
        for c in checks
        if c.get("source") == f"wave_{letter}"
        and c["state"] in ("fail", "cannot_check")
    )
    if len(bad) <= recorded:
        return []
    node = (
        bad[0].find("error")
        if bad[0].find("error") is not None
        else bad[0].find("failure")
    )
    first = (node.get("message") or "").split("\n")[0][:160] if node is not None else ""
    return [
        {
            "id": f"wave.{letter}.unrecorded",
            "state": "cannot_check",
            "reason": f"{len(bad)} Wave {letter.upper()} test(s) failed or errored but only {recorded} recorded a non-pass check — first: {bad[0].get('name')}: {first}",
            "source": f"wave_{letter}",
        }
    ]


def junit_checks(letter: str, xml_path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError as exc:
        return [
            {
                "id": f"wave.{letter}",
                "state": "cannot_check",
                "reason": f"wave_{letter}.xml unparseable: {exc}",
                "source": "junit",
            }
        ]
    cases = list(root.iter("testcase"))
    if not cases:
        return [
            {
                "id": f"wave.{letter}",
                "state": "cannot_check",
                "reason": f"wave_{letter}.xml holds zero test cases — an empty corpus is not a pass",
                "source": "junit",
            }
        ]
    tally = {"pass": 0, "fail": 0, "skipped": 0}
    first_fail = ""
    first_skip = ""
    for tc in cases:
        if tc.find("failure") is not None or tc.find("error") is not None:
            tally["fail"] += 1
            node = (
                tc.find("failure")
                if tc.find("failure") is not None
                else tc.find("error")
            )
            first_fail = (
                first_fail or f"{tc.get('name')}: {(node.get('message') or '')[:160]}"
            )
        elif tc.find("skipped") is not None:
            tally["skipped"] += 1
            first_skip = (
                first_skip
                or f"{tc.get('name')}: {(tc.find('skipped').get('message') or '')[:160]}"
            )
        else:
            tally["pass"] += 1
    if letter == "f":
        # The browser wave's real verdict is in nightly-summary.json; the XML is the runner's view.
        state = "fail" if tally["fail"] else "pass"
    elif tally["fail"]:
        state = "fail"
    elif tally["pass"] == 0:
        # Every case skipped: the wave asserted nothing about production.
        state = "cannot_check"
    else:
        state = "pass"
    reason = (
        f"{tally['pass']} passed · {tally['fail']} failed · {tally['skipped']} skipped"
    )
    if first_fail:
        reason += f" — first failure: {first_fail}"
    elif state == "cannot_check" and first_skip:
        reason += f" — every case skipped; first reason: {first_skip}"
    out.append(
        {"id": f"wave.{letter}", "state": state, "reason": reason, "source": "junit"}
    )
    if state == "pass" and tally["skipped"]:
        # A case skipped for an unset optional secret asserted nothing; it is
        # an absence, never folded into the wave's pass (correctness 4).
        out.append(
            {
                "id": f"wave.{letter}.skipped",
                "state": "absent",
                "reason": f"{tally['skipped']} case(s) skipped — first: {first_skip}",
                "source": "junit",
            }
        )
    return out


def _cell(text: str) -> str:
    """Make one string safe to sit in a Markdown table cell.

    The backslash is escaped FIRST, because it is the character doing the
    escaping: escaping only ``|`` leaves a ``\\|`` in the input rendering as an
    escaped backslash followed by a LIVE pipe, which ends the cell early and
    shifts every later column. (CodeQL's js/incomplete-sanitization caught the
    same bug in the TypeScript half on PR #349; this is its twin.) Newlines end
    the ROW, so they fold to spaces. The text reaching here is page-derived --
    sentences read out of the browser, gateway error messages, pytest failure
    lines -- so it is not ours to trust.
    """
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r\n", " ")
        .replace("\n", " ")
        .replace("\r", " ")
    )


def render(
    checks: list[dict[str, Any]],
    counts: dict[str, int],
    verdict: str,
    meta: dict[str, Any],
    design_calls: list[dict[str, Any]] | None = None,
) -> str:
    lines = [f"# Production E2E nightly — **{verdict.upper()}**", ""]
    if verdict == "fail" and counts["cannot_check"]:
        lines.append(
            f"_{counts['cannot_check']} other check(s) could not run; they are listed below. A failure is the headline either way._"
        )
        lines.append("")
    lines.append(
        f"Target `{meta.get('base_url') or '(unset)'}` · gateway `{meta.get('api_url') or '(unset)'}` · run {meta.get('run_id') or '-'} · sha `{(meta.get('sha') or '')[:12]}`"
    )
    lines.append("")
    lines.append("| pass | fail | absent | cannot_check |")
    lines.append("|---|---|---|---|")
    lines.append(
        f"| {counts['pass']} | {counts['fail']} | {counts['absent']} | {counts['cannot_check']} |"
    )
    lines.append("")
    lines.append(
        "**How to read this.** _fail_ is a production signal. _absent_ means the surface is not on this build or this house has nothing to open it on — it is reported, never counted as a pass. _cannot_check_ means the check did not run (a missing secret, an unreachable service, an empty corpus) and the run proves nothing about that surface; it is red on purpose."
    )
    lines.append("")
    by_source: dict[str, list[dict[str, Any]]] = {}
    for c in checks:
        by_source.setdefault(c.get("source", "?"), []).append(c)
    order = ["preflight", "junit", "wave_h", "playwright", "backtests"]
    for src in sorted(by_source, key=lambda s: order.index(s) if s in order else 99):
        lines.append(f"## {src}")
        lines.append("")
        lines.append("| check | state | reason |")
        lines.append("|---|---|---|")
        for c in by_source[src]:
            lines.append(
                f"| `{_cell(c['id'])}` | {BADGE[c['state']]} | {_cell(c['reason'])} |"
            )
        lines.append("")
    if design_calls:
        # Context from design-verdicts.json, joined by the browser reporter.
        # Never counted and never gating (founder's call, 2026-09-16).
        lines.append("## Founder's recorded design calls (context, not checks)")
        lines.append("")
        lines.append("| page | walked (override on) | recorded call |")
        lines.append("|---|---|---|")
        for d in design_calls:
            walked = str(d.get("walked", ""))
            lines.append(
                f"| `{_cell(str(d.get('page', '')))}` | {BADGE.get(walked, _cell(walked))} | {_cell('; '.join(str(c) for c in d.get('calls') or []))} |"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--results-dir", default="test-results")
    ap.add_argument("--base-url", default=os.environ.get("E2E_BASE_URL", ""))
    ap.add_argument("--api-url", default=os.environ.get("API_GATEWAY_URL", ""))
    ap.add_argument(
        "--min-checks",
        type=int,
        default=20,
        help="fewer recorded checks than this = empty corpus = exit 2",
    )
    args = ap.parse_args(argv)
    results = Path(args.results_dir)
    checks = collect(results)
    counts = {s: 0 for s in STATES}
    for c in checks:
        counts[c["state"]] += 1
    if len(checks) < args.min_checks:
        checks.append(
            {
                "id": "summary.corpus",
                "state": "cannot_check",
                "reason": f"only {len(checks)} checks were recorded (minimum {args.min_checks}); a verdict over so few is a verdict over nothing",
                "source": "summary",
            }
        )
        counts["cannot_check"] += 1
    verdict = (
        "fail"
        if counts["fail"]
        else ("cannot_check" if counts["cannot_check"] else "pass")
    )
    meta = {
        "base_url": args.base_url,
        "api_url": args.api_url,
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "sha": os.environ.get("GITHUB_SHA"),
    }
    pw = _load_json(results / "nightly" / "nightly-summary.json")
    design_calls = (
        pw.get("design_calls")
        if isinstance(pw, dict) and isinstance(pw.get("design_calls"), list)
        else None
    )
    md = render(checks, counts, verdict, meta, design_calls)
    results.mkdir(parents=True, exist_ok=True)
    (results / "nightly-summary.json").write_text(
        json.dumps(
            {"verdict": verdict, "counts": counts, "meta": meta, "checks": checks},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (results / "nightly-summary.md").write_text(md, encoding="utf-8")
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(md)
    print(md)
    return {"pass": 0, "fail": 1, "cannot_check": 2}[verdict]


if __name__ == "__main__":
    sys.exit(main())
