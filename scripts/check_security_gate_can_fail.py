#!/usr/bin/env python3
"""The security gate can fail, and the baseline it forgives only shrinks.

`security` ("Security Scan") is one of main's five required status contexts. Until
2026-09-12 its only scanning step set neither `exit-code` nor `severity`, so it
reported success whatever it found -- a required check that could not fail, green
over 143 high-or-critical findings. See ADR 0142.

This guard refuses three ways of quietly undoing that:

  1. the failing step disappearing, or losing `--exit-code 1`, or losing its
     severity filter -- the gate going back to advisory;
  2. `.trivyignore` GROWING -- a new advisory silenced by adding a line, which is
     the one thing the gate exists to refuse;
  3. the database download being folded back into the scan step -- trivy exits 1
     for a fatal error as readily as for a finding (measured 2026-09-12: a timed-out
     database download exited 1, and so did an unknown flag), so fused together
     "a new critical advisory landed" and "the scanner could not run" are the same
     red, and the second kind teaches people to ignore the first.

Exit 0 pass, 1 fail, 2 COULD NOT CHECK. Two is not a skip: a guard that could not
read what it claims to read gives the same answer as one that looked and found
health, which is the fault this repository tracks.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CI = os.path.join(ROOT, ".github", "workflows", "ci.yml")
IGNORE = os.path.join(ROOT, ".trivyignore")

# The number of advisories the baseline forgave when the gate was armed, measured
# by `trivy fs --scanners vuln --severity HIGH,CRITICAL` on a clean archive of
# 941d9cb4 on 2026-09-12: 143 finding rows, 107 distinct advisories. This number
# may be LOWERED when the backlog is paid down. Raising it is how the gate dies,
# and needs a founder decision and its own record (ADR 0142).
BASELINE_CEILING = 107


def cannot_check(why):
    print("CANNOT CHECK: %s" % why)
    print("  Exit 2 is not a skip. The guard could not read what it claims to read,")
    print("  and a guard with nothing to look at gives the same answer as one that")
    print("  looked and found health.")
    sys.exit(2)


def job_slice(ci):
    """The `security` job's body, with comment lines removed.

    Comments are stripped before anything looks at the job. This job is heavily
    commented and those comments quote the very flags being checked for -- a
    guard that reads them is satisfied by prose describing a step that is not
    there. (`git log` carries this exact bug once already: "fix(p1): guard
    ignores comments", 7109522d.)
    """
    start = ci.index("\n  security:\n")
    rest = ci[start + 1:]
    nxt = re.search(r"\n  [A-Za-z0-9_-]+:\n", rest)
    job = rest[: nxt.start()] if nxt else rest
    return "\n".join(ln for ln in job.split("\n") if not ln.lstrip().startswith("#"))


def failures_for(job, entries):
    """Every way the gate can be disarmed, as a list of sentences. Empty is pass."""
    out = []

    if "--exit-code 1" not in job and 'exit-code: "1"' not in job:
        out.append(
            "the `security` job has no step that sets a failing exit code. It can report\n"
            "     findings and it cannot fail, which is what ADR 0142 fixed."
        )

    if "--severity HIGH,CRITICAL" not in job and 'severity: "HIGH,CRITICAL"' not in job:
        out.append(
            "the `security` job's failing step does not filter to HIGH,CRITICAL. Without a\n"
            "     severity filter it either fails over every LOW advisory or over none."
        )

    if "--download-db-only" not in job:
        out.append(
            "the vulnerability-database download is not its own step. trivy exits 1 for a\n"
            "     fatal error as readily as for a finding, so fused into the scan a download\n"
            "     failure is indistinguishable from a new critical advisory."
        )

    if "--skip-db-update" not in job:
        out.append(
            "the scan step does not pass --skip-db-update, so it can re-enter the download\n"
            "     path that was just separated out and fail there under the scan's name."
        )

    if "@master" in job:
        out.append(
            "the `security` job pins an action to @master. The gate's verdict must not\n"
            "     change under us on someone else's release schedule (ADR 0142)."
        )

    dupes = sorted({e for e in entries if entries.count(e) > 1})
    if dupes:
        out.append(
            ".trivyignore lists %d advisory id(s) twice: %s" % (len(dupes), ", ".join(dupes[:5]))
        )

    if len(entries) > BASELINE_CEILING:
        out.append(
            ".trivyignore has GROWN: %d entries against a ceiling of %d. A line added here\n"
            "     silences a NEW advisory, which is the one thing this gate exists to refuse.\n"
            "     Lowering the ceiling is how the backlog is paid down; raising it needs a\n"
            "     founder decision and its own record." % (len(entries), BASELINE_CEILING)
        )

    return out


ARMED_JOB = """  security:
    steps:
      - name: Install trivy
        uses: aquasecurity/setup-trivy@v0.3.1
      - name: Fetch the vulnerability database
        run: trivy fs --download-db-only --timeout 15m
      - name: Fail on a new high or critical advisory
        run: trivy fs --scanners vuln --severity HIGH,CRITICAL --ignorefile .trivyignore --skip-db-update --exit-code 1 --format table .
"""

PRE_FIX_JOB = """  security:
    steps:
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: "fs"
          format: "sarif"
"""

COMMENTED_JOB = """  security:
    steps:
      # This job used to run trivy with --severity HIGH,CRITICAL --exit-code 1
      # and --download-db-only and --skip-db-update in one step.
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@v0.36.0
"""


def self_test():
    """Fire the guard at inputs whose verdict is known. Exit 0 only if all hold."""
    ok = True
    base = ["CVE-1"] * 1

    def case(name, job_yaml, entries, want_any):
        nonlocal ok
        got = failures_for(job_slice("\n" + job_yaml + "\n  next-job:\n"), entries)
        hit = bool(got)
        if hit != want_any:
            ok = False
            print("  FAIL %-46s expected %s, got %d failure(s)"
                  % (name, "a failure" if want_any else "a pass", len(got)))
        else:
            print("  ok   %-46s %d failure(s)" % (name, len(got)))

    print("== self-test")
    case("the armed job passes", ARMED_JOB, base, False)
    case("main's pre-fix job fails", PRE_FIX_JOB, base, True)
    case("a job that only MENTIONS the flags fails", COMMENTED_JOB, base, True)
    case("a grown baseline fails", ARMED_JOB, ["CVE-%d" % i for i in range(BASELINE_CEILING + 1)], True)
    case("a duplicated id fails", ARMED_JOB, ["CVE-1", "CVE-1"], True)

    # The comment-stripping itself, stated as its own case: the pre-fix job with
    # the armed one quoted at it in a comment must still fail.
    quoted = PRE_FIX_JOB + "".join("      # %s\n" % ln for ln in ARMED_JOB.split("\n"))
    case("armed text quoted inside a comment does not count", quoted, base, True)

    if not ok:
        print("")
        print("FAIL -- the guard does not fire on the shapes it exists to catch.")
        sys.exit(1)
    print("PASS -- the guard fires on every shape it exists to catch.")
    sys.exit(0)


def main():
    if "--self-test" in sys.argv:
        self_test()

    if not os.path.isfile(CI):
        cannot_check("%s is not a file" % CI)
    if not os.path.isfile(IGNORE):
        cannot_check("%s is not a file -- the gate reads it, so its absence is not a pass" % IGNORE)

    ci = open(CI, encoding="utf-8").read()
    if "\n  security:\n" not in ci:
        cannot_check("no `security:` job in %s -- the job this guard describes is gone or renamed" % CI)

    job = job_slice(ci)
    entries = [
        ln.strip()
        for ln in open(IGNORE, encoding="utf-8").read().splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]
    failures = failures_for(job, entries)
    n = len(entries)

    print("== security gate: %d baselined advisor%s (ceiling %d)"
          % (n, "y" if n == 1 else "ies", BASELINE_CEILING))

    if failures:
        print("")
        print("FAIL -- the security gate is not armed the way ADR 0142 decided:")
        for f in failures:
            print("  -> %s" % f)
        sys.exit(1)

    print("PASS -- the gate can fail on a new high or critical advisory, a database")
    print("        failure fails under its own name, and the baseline has not grown.")
    sys.exit(0)


if __name__ == "__main__":
    main()
