"""The Playwright job must run on a runner image Playwright can install on.

`ubuntu-latest` moved to Ubuntu 26.04 in November 2026. Playwright refuses to
install Chromium there ("does not support chromium on ubuntu26.04-x64"), so
`playwright install --with-deps` failed, `Test E2E` went red on every pull
request based on main, and `CI Complete` (the one required check) went red with
it -- nothing could merge. The job is pinned to a named release until Playwright
supports the new one; every other job keeps `ubuntu-latest`.

Plain text parsing on purpose: the scripts job installs only pytest and httpx.
"""
import re
from pathlib import Path

CI = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml"


def _job_block(text: str, job: str) -> str:
    m = re.search(rf"^  {re.escape(job)}:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)", text, re.M | re.S)
    assert m, f"job {job!r} not found in ci.yml"
    return m.group(1)


def test_playwright_job_runs_on_a_pinned_ubuntu_release():
    block = _job_block(CI.read_text(), "test-e2e")
    m = re.search(r"^    runs-on:\s*(\S+)", block, re.M)
    assert m, "test-e2e has no runs-on"
    label = m.group(1)
    assert not label.endswith("-latest"), (
        f"test-e2e runs on {label!r}; a moving label broke Playwright's install once already")
    ver = re.fullmatch(r"ubuntu-(\d+)\.\d+", label)
    assert ver, f"test-e2e runner {label!r} is not a pinned ubuntu-NN.MM release"
    assert int(ver.group(1)) <= 24, (
        f"{label} is newer than the releases Playwright installs Chromium on (24.04)")


def test_this_test_runs_in_the_scripts_job():
    text = CI.read_text()
    m = re.search(r"run:\s*python3 -P -m pytest[^\n]*", text)
    assert m and "scripts/test_ci_e2e_runner_pinned.py" in m.group(0), (
        "the scripts unit-test step does not list this file, so the pin guards nothing")


def test_playwright_install_is_chromium_only_and_cached():
    block = _job_block(CI.read_text(), "test-e2e")
    installs = re.findall(r"playwright (install(?:-deps)?)\b([^\n]*)", block)
    assert installs, "test-e2e does not install Playwright browsers"
    for cmd, rest in installs:
        assert rest.split()[-1] == "chromium", (
            f"'playwright {cmd}{rest}' is not limited to chromium; installing every browser "
            "pulled the whole apt set and took ~29 minutes")
    assert any(c == "install" and "--with-deps" in r for c, r in installs), (
        "the cache-miss path must install the browser with its system libraries")
    assert any(c == "install-deps" for c, _ in installs), (
        "the cache-hit path must install only system libraries")
    assert "path: ~/.cache/ms-playwright" in block, "the browser download is not cached"
    assert "steps.playwright-version.outputs.version" in block, (
        "the cache key must include the Playwright version")
    assert "cache-hit != 'true'" in block and "cache-hit == 'true'" in block, (
        "install steps must branch on the cache result")
