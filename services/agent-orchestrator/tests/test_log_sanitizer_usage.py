"""
Test wrapper around scripts/check_log_sanitizer_usage.py.

The detection logic lives in that script, not here, so there is exactly one implementation:
the claims guard runs it directly (the claims job installs no dependencies, so it must stay
stdlib-only), and this makes the same guard part of the normal test run.

What it guards: `sanitize_for_log` returns a str, and a numeric %-spec cannot format a str.
The logger does NOT raise — `logging` traps formatting errors in `Handler.handleError`, so
an enabled level LOSES the intended line and prints a logging-internal traceback instead,
and a disabled level does nothing at all. The live instance was a `logger.debug` in
`override_service._maybe_promote_submission`: invisible in production, and it would have
eaten the very line someone turned DEBUG on to read. Verified by running it, not inferred.
"""

import subprocess
import sys
import pathlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
GUARD = REPO_ROOT / "scripts" / "check_log_sanitizer_usage.py"


def _run(*args, cwd=None):
    return subprocess.run(
        [sys.executable, str(GUARD), *args],
        cwd=str(cwd or REPO_ROOT),
        capture_output=True,
        text=True,
    )


def test_guard_script_exists():
    assert GUARD.is_file(), f"guard script missing at {GUARD}"


def test_no_sanitized_value_reaches_a_numeric_format_spec():
    result = _run()
    assert result.returncode == 0, (
        "sanitize_for_log() returns a str; logging would trap the TypeError and silently "
        f"drop these lines:\n{result.stdout}\n{result.stderr}"
    )


def test_guard_actually_fails_on_a_planted_fault(tmp_path):
    """A guard that cannot fail is not a guard — plant one and prove it fires."""
    pkg = tmp_path / "services" / "agent-orchestrator" / "services"
    pkg.mkdir(parents=True)
    (pkg / "planted.py").write_text(
        "import logging\n"
        "from services.log_safety import sanitize_for_log\n"
        "logger = logging.getLogger(__name__)\n"
        "def f(n):\n"
        "    logger.debug('pending=%d for %s', sanitize_for_log(n), 'x')\n"
    )
    # Copy the guard so its ROOT resolves to the temp tree.
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    (scripts_dir / "check_log_sanitizer_usage.py").write_text(GUARD.read_text())

    result = subprocess.run(
        [sys.executable, str(scripts_dir / "check_log_sanitizer_usage.py")],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1, (
        f"guard did not flag the planted fault (rc={result.returncode})\n"
        f"{result.stdout}\n{result.stderr}"
    )
    assert "%d fed sanitize_for_log" in result.stdout


def test_guard_fails_loudly_when_it_can_scan_nothing(tmp_path):
    """
    An empty scan must be exit 2, not a quiet pass — a guard that silently matches nothing
    is worse than no guard, because the green tick is read as evidence.

    Note the guard is deliberately NOT placed under `scripts/` here: that is one of its own
    scan roots, so a copy there would scan itself and legitimately report 1 file. The empty
    case needs a home outside every scan root.
    """
    home = tmp_path / "elsewhere"
    home.mkdir()
    (home / "check_log_sanitizer_usage.py").write_text(GUARD.read_text())

    result = subprocess.run(
        [sys.executable, str(home / "check_log_sanitizer_usage.py")],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
    )
    assert (
        result.returncode == 2
    ), f"expected exit 2 on an empty scan, got {result.returncode}: {result.stdout}"
    assert "scanned 0 files" in result.stderr
