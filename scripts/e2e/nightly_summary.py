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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrub_artifacts import redact_text  # noqa: E402  (same directory)

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
                    "test": str(c.get("test") or ""),
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
    runner's XML behind. Each failed or errored case must have a non-pass record
    written BY THAT TEST (records carry PYTEST_CURRENT_TEST); one that does not
    is cannot_check, not silence (correctness 1 and re-audit N2, 2026-09-17)."""
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
    nonpass_tests = [
        c.get("test", "")
        for c in checks
        if c.get("source") == f"wave_{letter}"
        and c["state"] in ("fail", "cannot_check")
    ]
    out: list[dict[str, Any]] = []
    for tc in cases:
        node = tc.find("error") if tc.find("error") is not None else tc.find("failure")
        if node is None:
            continue
        name = tc.get("name") or ""
        if any(
            t and t.split("::")[-1].split("[")[0] == name.split("[")[0]
            for t in nonpass_tests
        ):
            continue
        first = (node.get("message") or "").split("\n")[0][:160]
        out.append(
            {
                "id": f"wave.{letter}.unrecorded.{name}",
                "state": "cannot_check",
                "reason": f"{name} failed or errored without recording a non-pass check: {first}",
                "source": f"wave_{letter}",
            }
        )
    return out


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
        # A skipped case asserted nothing. ADR 0135: the job is "never green by
        # skipping", so it is cannot_check, not folded into the pass and not an
        # absence (re-audit 2026-09-17, compliance). Wave C unarmed by the
        # founder's F2 answer is the one decided absence, handled above.
        out.append(
            {
                "id": f"wave.{letter}.skipped",
                "state": "cannot_check",
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
    ap.add_argument(
        "--self-test",
        action="store_true",
        help="prove precedence, Wave C, unrecorded errors, skips, crashes, truncation and redaction",
    )
    ap.add_argument("--base-url", default=os.environ.get("E2E_BASE_URL", ""))
    ap.add_argument("--api-url", default=os.environ.get("API_GATEWAY_URL", ""))
    ap.add_argument(
        "--min-checks",
        type=int,
        default=20,
        help="fewer recorded checks than this = empty corpus = exit 2",
    )
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    results = Path(args.results_dir)
    password = os.environ.get("E2E_TEST_PASSWORD") or None
    if password and len(password) < 4:
        password = None
    checks = collect(results)
    for c in checks:
        c["reason"] = redact_text(str(c.get("reason", "")), password)
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


def self_test() -> int:
    """Synthetic results directories, one behaviour each (re-audit N6, 2026-09-17)."""
    import contextlib
    import io
    import tempfile

    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWxmLXRlc3QifQ.c2lnbmF0dXJlLXNlbGY"

    def base(root: Path, **over: Any) -> None:
        (root / "nightly").mkdir(parents=True, exist_ok=True)
        pw_checks = over.get(
            "pw",
            [
                {"id": f"page.p{i}.next", "state": "pass", "reason": "ok"}
                for i in range(25)
            ],
        )
        (root / "nightly" / "nightly-summary.json").write_text(
            json.dumps({"checks": pw_checks}), encoding="utf-8"
        )
        (root / "wave_h_checks.jsonl").write_bytes(
            over.get(
                "h",
                b'{"id": "h.x", "state": "pass", "reason": "ok", "test": "t.py::test_x (call)"}\n',
            )
        )
        (root / "orchestrator-preflight.json").write_text(
            json.dumps({"reachable": True, "reason": "200"}), encoding="utf-8"
        )
        for letter in "abc":
            (root / f"wave_{letter}.xml").write_text(
                over.get(
                    f"x{letter}", '<testsuite><testcase name="t_ok"/></testsuite>'
                ),
                encoding="utf-8",
            )
        (root / "backtests.json").write_text(
            json.dumps(
                {"steps": over.get("bt", [{"name": "scenario_canned_day", "exit": 0}])}
            ),
            encoding="utf-8",
        )
        if "xh" in over:
            (root / "wave_h.xml").write_text(over["xh"], encoding="utf-8")
        if over.get("unarmed"):
            (root / "wave_c_unarmed.json").write_text(
                '{"unarmed": true, "reason": "F2"}', encoding="utf-8"
            )
        for name, text in over.get("files", {}).items():
            (root / name).write_text(text, encoding="utf-8")

    cases: list[tuple[str, dict[str, Any], int, str | None, str | None]] = [
        ("clean run passes", {}, 0, None, None),
        (
            "a fail outranks an unrun check",
            {
                "pw": [{"id": "page.x.next", "state": "fail", "reason": "broke"}]
                + [{"id": f"p{i}", "state": "pass", "reason": "ok"} for i in range(24)],
                "xa": "<testsuite></testsuite>",
            },
            1,
            "wave.a",
            "cannot_check",
        ),
        (
            "wave C unarmed is absent",
            {
                "unarmed": True,
                "xc": '<testsuite><testcase name="t"><skipped/></testcase></testsuite>',
            },
            0,
            "wave.c",
            "absent",
        ),
        (
            "an errored Wave H test without its own record is cannot_check",
            {
                "xh": '<testsuite><testcase name="test_y"><error message="ReadTimeout"/></testcase></testsuite>'
            },
            2,
            "wave.h.unrecorded.test_y",
            "cannot_check",
        ),
        (
            "a partly skipped wave is cannot_check",
            {
                "xb": '<testsuite><testcase name="ok"/><testcase name="s"><skipped message="ADMIN_API_KEY unset"/></testcase></testsuite>'
            },
            2,
            "wave.b.skipped",
            "cannot_check",
        ),
        (
            "a Jest crash without a failed count is cannot_check",
            {
                "bt": [{"name": "forecast_pinned", "exit": 1}],
                "files": {"backtest_forecast.log": "Error: Cannot find module"},
            },
            2,
            "backtest.forecast_pinned",
            "cannot_check",
        ),
        (
            "a truncated wave_h_checks.jsonl is cannot_check",
            {"h": b'{"id": "h.x", "state": "pass", "reason": "\xe2\x82'},
            2,
            "wave.h",
            "cannot_check",
        ),
    ]
    failures = 0
    for label, over, want_exit, check_id, want_state in cases:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base(root, **over)
            with contextlib.redirect_stdout(io.StringIO()):
                got = main(["--results-dir", str(root)])
            data = json.loads(
                (root / "nightly-summary.json").read_text(encoding="utf-8")
            )
            state = (
                next((c["state"] for c in data["checks"] if c["id"] == check_id), None)
                if check_id
                else None
            )
            ok = got == want_exit and (check_id is None or state == want_state)
            failures += 0 if ok else 1
            print(
                f"self-test {'ok  ' if ok else 'FAIL'} {label}: exit {got} (want {want_exit}), {check_id}={state}"
            )
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        base(
            root,
            pw=[
                {
                    "id": "leak",
                    "state": "fail",
                    "reason": f"authorization: Bearer {jwt} PW_SELFTEST_x",
                }
            ]
            + [{"id": f"p{i}", "state": "pass", "reason": "ok"} for i in range(24)],
        )
        os.environ["E2E_TEST_PASSWORD"] = "PW_SELFTEST_x"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                main(["--results-dir", str(root)])
        finally:
            os.environ.pop("E2E_TEST_PASSWORD", None)
        md = (root / "nightly-summary.md").read_text(encoding="utf-8")
        ok = jwt not in md and "PW_SELFTEST_x" not in md
        failures += 0 if ok else 1
        print(
            f"self-test {'ok  ' if ok else 'FAIL'} a JWT and the password never reach the summary"
        )
    print(
        "self-test: every case behaved"
        if not failures
        else f"self-test: {failures} case(s) failed"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
