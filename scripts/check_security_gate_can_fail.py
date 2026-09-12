#!/usr/bin/env python3
"""The security gate can fail, its verdict does not move on its own, and the
baseline it forgives only shrinks.

`security` ("Security Scan") is rolled into `CI Complete`, one of main's required
status contexts. Until 2026-09-12 its only scanning step set neither `exit-code`
nor `severity`, so it reported success whatever it found. ADR 0142 armed it; the
adversarial pass on PR #362 then showed the first version of THIS guard missed 14
of 21 single-property mutations, because it matched flags as substrings anywhere
in the job -- a `name:` field, an `echo`, a second `--exit-code 0` after the first,
a step with `if: false` all satisfied it.

So this version reads what GitHub will actually execute. It parses the `security`
job into steps, joins each `run:` into logical commands, tokenises them with
shlex, and identifies every step by its trivy invocation -- never by its name or
its comments. It refuses:

  * a gate step that is missing, duplicated, conditional, allowed to fail, chained
    to a shell operator, or whose flags do not exit 1 on HIGH,CRITICAL vulns
    against `.trivyignore` with nothing skipped;
  * a gate that reads a database other than one fetched BY DIGEST (founder's
    decision 2026-09-12: the gate's verdict must not move overnight);
  * any step before the gate other than checkout, install and the pinned download,
    because a failing step there would skip the gate;
  * a publishing step that does not name an explicitly EMPTY ignore file -- trivy
    loads `.trivyignore` by default, and doing so hid 107 alerts from the Security
    tab in this guard's first version;
  * an unpinned or moving trivy install, any `@master`/`@main` action;
  * job-level `if` or `continue-on-error`; a `TRIVY_*` environment variable, which
    trivy reads as configuration; a trivy config file at the repo root, which it
    loads automatically;
  * a `.trivyignore` that is not a subset of the recorded baseline (a swapped id is
    a new advisory silenced at the same line count), that repeats an id, carries a
    wildcard, or exceeds the ceiling; and a baseline file that no longer hashes to
    the value pinned below.

Exit 0 pass, 1 fail, 2 COULD NOT CHECK. Two is not a skip.
"""
import hashlib
import os
import re
import shlex
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CI = os.path.join(ROOT, ".github", "workflows", "ci.yml")
IGNORE = os.path.join(ROOT, ".trivyignore")
BASELINE = os.path.join(ROOT, "scripts", "trivy-baseline-2026-09-12.txt")

# sha256 of scripts/trivy-baseline-2026-09-12.txt, the 107 advisories open when
# the gate was armed. Changing that file without changing this constant fails;
# changing both is a visible edit to two gate-owned paths.
BASELINE_SHA256 = "f1ba013c610425fc1570406dd39aa892bf87c84f2c42c0633561f2edfcdf0ce9"
BASELINE_CEILING = 107

TRIVY_CONFIG_NAMES = ("trivy.yaml", "trivy.yml", ".trivy.yaml", ".trivy.yml")
PINNED_DB = re.compile(
    r"^(ghcr\.io/aquasecurity/trivy-db|mirror\.gcr\.io/aquasec/trivy-db)@sha256:[0-9a-f]{64}$"
)
ADVISORY_ID = re.compile(r"^(CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$")
SEMVER_TAG = re.compile(r"^v\d+\.\d+\.\d+$")
SHELL_OPERATORS = {"||", "&&", ";", "|", "&", ";;", "|&", "(", ")", "<", ">", ">>", "<<", "<<<"}
# Flags that take no value. Anything else consumes the next token unless that
# token itself begins with "-".
BOOLEAN_FLAGS = {
    "--skip-db-update", "--download-db-only", "--skip-java-db-update", "--ignore-unfixed",
    "--quiet", "-q", "--no-progress", "--debug", "-d", "--insecure", "--offline-scan",
    "--list-all-pkgs", "--include-dev-deps", "--skip-policy-update", "--reset",
}
GATE_FORBIDDEN_FLAGS = {
    "--skip-files", "--skip-dirs", "--config", "-c", "--ignore-unfixed", "--ignore-policy",
    "--db-repository", "--vex", "--file-patterns", "--download-db-only",
}


def cannot_check(why):
    print("CANNOT CHECK: %s" % why)
    print("  Exit 2 is not a skip. The guard could not read what it claims to read,")
    print("  and a guard with nothing to look at gives the same answer as one that")
    print("  looked and found health.")
    sys.exit(2)


# --------------------------------------------------------------------------- #
# Parsing -- deliberately no PyYAML: the CI job that runs this guard installs
# nothing, and a guard that needs a pip install can fail as itself.
# --------------------------------------------------------------------------- #

def _strip_comments(text):
    return "\n".join(ln for ln in text.split("\n") if not ln.lstrip().startswith("#"))


def _unquote(val):
    val = val.strip()
    if val[:1] in ("'", '"'):
        q = val[0]
        end = val.find(q, 1)
        return val[1:end] if end > 0 else val[1:]
    return re.split(r"\s+#", val, maxsplit=1)[0].strip()


def security_job(ci):
    """The `security` job's text with comment lines removed, or None."""
    text = _strip_comments(ci)
    m = re.search(r"^  security:[ \t]*$", text, re.M)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"^  [A-Za-z0-9_-]+:[ \t]*$", rest, re.M)
    return text[m.start(): m.end() + (nxt.start() if nxt else len(rest))]


def parse_steps(job):
    """A list of dicts: name, uses, run, if, continue-on-error, env, with, dup."""
    lines = job.split("\n")
    try:
        at = next(i for i, ln in enumerate(lines) if re.match(r"^    steps:[ \t]*$", ln))
    except StopIteration:
        return []
    blocks, cur = [], None
    for ln in lines[at + 1:]:
        if ln.startswith("      - "):
            if cur is not None:
                blocks.append(cur)
            cur = ["        " + ln[len("      - "):]]
        elif cur is not None:
            cur.append(ln)
    if cur is not None:
        blocks.append(cur)

    steps = []
    for block in blocks:
        st = {"env": {}, "with": {}, "dup": []}
        seen = set()
        i = 0
        while i < len(block):
            m = re.match(r"^        ([A-Za-z0-9_-]+):[ \t]*(.*)$", block[i])
            if not m:
                i += 1
                continue
            key, val = m.group(1), m.group(2)
            if key in seen:
                st["dup"].append(key)
            seen.add(key)
            if key == "run" and val.strip()[:1] in ("|", ">"):
                folded = val.strip().startswith(">")
                body = []
                i += 1
                while i < len(block) and (block[i].startswith("          ") or not block[i].strip()):
                    body.append(block[i][10:] if block[i].strip() else "")
                    i += 1
                st["run"] = (" " if folded else "\n").join(body).strip()
                continue
            if key in ("env", "with") and not val.strip():
                i += 1
                while i < len(block) and block[i].startswith("          "):
                    mm = re.match(r"^          ([A-Za-z0-9_]+):[ \t]*(.*)$", block[i])
                    if mm:
                        st[key][mm.group(1)] = _unquote(mm.group(2))
                    i += 1
                continue
            st[key] = _unquote(val)
            i += 1
        steps.append(st)
    return steps


def commands(run):
    text = (run or "").replace("\\\n", " ")
    return [c.strip() for c in text.split("\n") if c.strip()]


def tokens(cmd):
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    return list(lex)


def trivy_flags(toks):
    """({flag: [values]}, [positionals]) for a `trivy fs ...` token list."""
    flags, positional = {}, []
    i = 2
    while i < len(toks):
        t = toks[i]
        if t.startswith("-") and t != "-":
            if "=" in t and t.startswith("--"):
                k, v = t.split("=", 1)
            elif t in BOOLEAN_FLAGS:
                k, v = t, True
            else:
                nxt = toks[i + 1] if i + 1 < len(toks) else None
                if nxt is None or (nxt.startswith("-") and nxt != "-"):
                    k, v = t, True
                else:
                    k, v = t, nxt
                    i += 1
            flags.setdefault(k, []).append(v)
        else:
            positional.append(t)
        i += 1
    return flags, positional


def classify(steps):
    """Annotate each step with its single trivy command's tokens and flags."""
    for idx, st in enumerate(steps):
        st["index"] = idx
        st["cmds"] = commands(st.get("run"))
        st["trivy"] = None
        for c in st["cmds"]:
            toks = tokens(c)
            if len(toks) >= 2 and toks[0] == "trivy" and toks[1] == "fs":
                flags, pos = trivy_flags(toks)
                st["trivy"] = {"toks": toks, "flags": flags, "pos": pos}
                break
    return steps


# --------------------------------------------------------------------------- #
# The checks, as a pure function so the self-test runs the real thing.
# --------------------------------------------------------------------------- #

def _one(flags, name):
    vals = flags.get(name, [])
    return vals[0] if len(vals) == 1 else None


def _single_clean_trivy(st):
    """Why a step's `run` is not exactly one operator-free `trivy fs` command, or None."""
    if len(st["cmds"]) != 1:
        return "runs %d commands, not exactly one" % len(st["cmds"])
    toks = tokens(st["cmds"][0])
    ops = [t for t in toks if t in SHELL_OPERATORS]
    if ops:
        return "chains a shell operator (%s), which can mask trivy's exit code" % ", ".join(ops)
    if toks[:2] != ["trivy", "fs"]:
        return "does not begin `trivy fs`"
    return None


def failures_for(ci, ignore_lines, baseline_lines, baseline_sha, config_files_present):
    out = []

    job = security_job(ci)
    if job is None:
        return ["there is no `security` job in ci.yml -- the gate this guard describes is gone or renamed"]

    if re.search(r"^    (continue-on-error|if):", job, re.M):
        out.append("the `security` job itself carries `if:` or `continue-on-error:`, so it can be skipped or allowed to fail")

    # `defaults.run` re-points or re-shells EVERY run step beneath it without a
    # word appearing on the gate itself. Found by the second adversarial pass on
    # PR #362: `working-directory: .github/workflows` made the gate's `.` scan a
    # directory with no lockfiles, trivy exited 0, and this guard passed.
    stripped_ci = _strip_comments(ci)
    wf_defaults = re.search(r"^defaults:[ \t]*\n((?:[ \t]+.*\n?)*)", stripped_ci, re.M)
    if wf_defaults and re.search(r"working-directory|shell", wf_defaults.group(1)):
        out.append("the workflow sets defaults.run working-directory or shell, which silently re-points or re-shells the gate")
    job_defaults = re.search(r"^    defaults:[ \t]*\n((?:      .*\n?)*)", job, re.M)
    if job_defaults and re.search(r"working-directory|shell", job_defaults.group(1)):
        out.append("the `security` job sets defaults.run working-directory or shell, which silently re-points or re-shells the gate")

    if re.search(r"^\s*TRIVY_[A-Z0-9_]+\s*:", _strip_comments(ci), re.M):
        out.append("ci.yml sets a TRIVY_* environment variable; trivy reads those as configuration and can skip or re-scope the scan")

    for name in config_files_present:
        out.append("%s exists at the repo root; trivy loads it automatically and it can skip files the gate must scan" % name)

    steps = classify(parse_steps(job))
    if not steps:
        return out + ["the `security` job has no parseable steps"]

    for st in steps:
        if st["dup"]:
            out.append("step %r repeats key(s) %s; which one GitHub honours is not what a reader sees"
                       % (st.get("name"), ", ".join(st["dup"])))
        uses = st.get("uses") or ""
        if re.search(r"@(master|main)$", uses):
            out.append("step %r pins an action to a moving branch: %s" % (st.get("name"), uses))
        for k in st["env"]:
            if k.startswith("TRIVY_"):
                out.append("step %r sets %s, which trivy reads as configuration" % (st.get("name"), k))

    for st in steps:
        if st.get("trivy") and (st.get("working-directory") is not None or st.get("shell") is not None):
            out.append("trivy step %r sets working-directory or shell; the gate's `.` must be the repository "
                       "root and its exit code must reach the job" % st.get("name"))

    # --- install ---------------------------------------------------------
    installs = [s for s in steps if (s.get("uses") or "").startswith("aquasecurity/setup-trivy@")]
    if len(installs) != 1:
        out.append("expected exactly one aquasecurity/setup-trivy step, found %d" % len(installs))
    else:
        tag = installs[0]["uses"].split("@", 1)[1]
        if not SEMVER_TAG.match(tag):
            out.append("setup-trivy is not pinned to a vX.Y.Z tag: @%s" % tag)
        if not SEMVER_TAG.match(installs[0]["with"].get("version", "")):
            out.append("trivy's version is not pinned to vX.Y.Z: %r" % installs[0]["with"].get("version"))

    trivy_steps = [s for s in steps if s["trivy"]]

    # --- the pinned download ------------------------------------------------
    pinned = [s for s in trivy_steps
              if "--download-db-only" in s["trivy"]["flags"] and "--db-repository" in s["trivy"]["flags"]]
    pinned_cache = None
    if len(pinned) != 1:
        out.append("expected exactly one database download pinned with --db-repository, found %d" % len(pinned))
    else:
        p = pinned[0]
        why = _single_clean_trivy(p)
        if why:
            out.append("the pinned database download %s" % why)
        repo = _one(p["trivy"]["flags"], "--db-repository")
        if not (isinstance(repo, str) and PINNED_DB.match(repo)):
            out.append("the gate's database is not pinned BY DIGEST (got %r); a tag like :2 moves daily" % repo)
        pinned_cache = _one(p["trivy"]["flags"], "--cache-dir")
        if not isinstance(pinned_cache, str):
            out.append("the pinned database download does not name exactly one --cache-dir")
        if p.get("if") is not None or p.get("continue-on-error") is not None:
            out.append("the pinned database download is conditional or allowed to fail")

    # --- the gate -----------------------------------------------------------
    gates = [s for s in trivy_steps if "--exit-code" in s["trivy"]["flags"]]
    if len(gates) != 1:
        out.append("expected exactly one trivy step that sets --exit-code (the gate), found %d" % len(gates))
    else:
        g = gates[0]
        f = g["trivy"]["flags"]
        why = _single_clean_trivy(g)
        if why:
            out.append("the gate step %s" % why)
        if f.get("--exit-code") != ["1"]:
            out.append("the gate's --exit-code is %r, not exactly one value of 1" % f.get("--exit-code"))
        sev = _one(f, "--severity")
        if not (isinstance(sev, str) and set(x.strip().upper() for x in sev.split(",")) == {"HIGH", "CRITICAL"}):
            out.append("the gate's --severity is %r, not exactly HIGH,CRITICAL" % f.get("--severity"))
        if f.get("--scanners") != ["vuln"]:
            out.append("the gate's --scanners is %r, not exactly vuln" % f.get("--scanners"))
        if f.get("--ignorefile") != [".trivyignore"]:
            out.append("the gate's --ignorefile is %r, not exactly .trivyignore" % f.get("--ignorefile"))
        if "--skip-db-update" not in f:
            out.append("the gate does not pass --skip-db-update, so it can fetch a database of its own")
        gate_cache = _one(f, "--cache-dir")
        if pinned_cache is not None and gate_cache != pinned_cache:
            out.append("the gate reads cache %r, not the pinned database's cache %r" % (gate_cache, pinned_cache))
        for bad in sorted(GATE_FORBIDDEN_FLAGS & set(f)):
            out.append("the gate passes %s, which narrows or re-sources what it scans" % bad)
        if g["trivy"]["pos"] != ["."]:
            out.append("the gate scans %r, not the repository root '.'" % g["trivy"]["pos"])
        if g.get("if") is not None:
            out.append("the gate step is conditional (if: %s), so it can be skipped" % g.get("if"))
        if g.get("continue-on-error") is not None:
            out.append("the gate step carries continue-on-error, so its failure does not fail the job")
        allowed_before = {id(s) for s in installs} | {id(s) for s in pinned}
        for s in steps[: g["index"]]:
            if id(s) in allowed_before or (s.get("uses") or "").startswith("actions/checkout@"):
                continue
            out.append("step %r runs BEFORE the gate; if it fails, the gate is skipped" % s.get("name"))

    # --- publishing ---------------------------------------------------------
    latest = [s for s in trivy_steps
              if "--download-db-only" in s["trivy"]["flags"] and "--db-repository" not in s["trivy"]["flags"]]
    latest_cache = _one(latest[0]["trivy"]["flags"], "--cache-dir") if len(latest) == 1 else None
    if len(latest) != 1:
        out.append("expected exactly one unpinned database download for the Security tab, found %d" % len(latest))
    sarifs = [s for s in trivy_steps if s["trivy"]["flags"].get("--format") == ["sarif"]]
    if len(sarifs) != 1:
        out.append("expected exactly one SARIF publishing step, found %d" % len(sarifs))
    else:
        sp = sarifs[0]
        ign = sp["trivy"]["flags"].get("--ignorefile")
        truncated = set()
        for c in sp["cmds"]:
            t = tokens(c)
            if len(t) == 3 and t[0] == ":" and t[1] == ">":
                truncated.add(t[2])
        if not ign or len(ign) != 1:
            out.append("the SARIF step names no --ignorefile, so trivy applies .trivyignore and hides the baseline from the Security tab")
        elif ign[0] == ".trivyignore" or ign[0] not in truncated:
            out.append("the SARIF step's --ignorefile %r is not a file the same step empties with `: >`" % ign[0])
        if latest_cache is not None and sp["trivy"]["flags"].get("--cache-dir") != [latest_cache]:
            out.append("the SARIF step does not read the latest database's cache %r" % latest_cache)
        for c in sp["cmds"]:
            t = tokens(c)
            if t[:2] == ["trivy", "fs"] and any(x in SHELL_OPERATORS for x in t):
                out.append("the SARIF trivy command chains a shell operator")

    # --- the baseline -------------------------------------------------------
    def ids(lines):
        return [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith("#")]

    entries, base = ids(ignore_lines), set(ids(baseline_lines))
    if baseline_sha != BASELINE_SHA256:
        out.append("scripts/trivy-baseline-2026-09-12.txt no longer hashes to the pinned value; the baseline was edited")
    malformed = [e for e in entries if not ADVISORY_ID.match(e)]
    if malformed:
        out.append(".trivyignore carries entries that are not a single CVE or GHSA id: %s" % ", ".join(malformed[:5]))
    dupes = sorted({e for e in entries if entries.count(e) > 1})
    if dupes:
        out.append(".trivyignore lists id(s) twice: %s" % ", ".join(dupes[:5]))
    extra = sorted(set(entries) - base)
    if extra:
        out.append(".trivyignore silences id(s) that were never in the baseline: %s. A swapped or added id "
                   "is a NEW advisory silenced, which is the one thing the gate exists to refuse" % ", ".join(extra[:5]))
    if len(entries) > BASELINE_CEILING:
        out.append(".trivyignore has %d entries against a ceiling of %d" % (len(entries), BASELINE_CEILING))

    return out


# --------------------------------------------------------------------------- #
# --self-test: every shape the adversarial pass used, plus the new ones.
# --------------------------------------------------------------------------- #

_D = "sha256:" + "a" * 64
ARMED = r'''
jobs:
  security:
    name: Security Scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v7
      - name: Install trivy
        uses: aquasecurity/setup-trivy@v0.3.1
        with:
          version: v0.74.0
      - name: Fetch the pinned vulnerability database, for the gate
        run: trivy fs --download-db-only --timeout 15m --cache-dir "$RUNNER_TEMP/trivy-pinned" --db-repository "ghcr.io/aquasecurity/trivy-db@__D__"
      - name: Fail on a new high or critical advisory
        run: |
          trivy fs \
            --scanners vuln \
            --severity HIGH,CRITICAL \
            --ignorefile .trivyignore \
            --skip-db-update \
            --cache-dir "$RUNNER_TEMP/trivy-pinned" \
            --exit-code 1 \
            --format table \
            .
      - name: Fetch the latest vulnerability database, for the Security tab
        if: ${{ !cancelled() }}
        run: trivy fs --download-db-only --timeout 15m --cache-dir "$RUNNER_TEMP/trivy-latest"
      - name: Run Trivy vulnerability scanner
        if: ${{ !cancelled() }}
        run: |
          : > "$RUNNER_TEMP/empty.trivyignore"
          trivy fs --format sarif --output trivy-results.sarif --skip-db-update --cache-dir "$RUNNER_TEMP/trivy-latest" --ignorefile "$RUNNER_TEMP/empty.trivyignore" .
      - name: Upload Trivy results to GitHub Security
        if: ${{ !cancelled() }}
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: "trivy-results.sarif"

  next-job:
    runs-on: ubuntu-latest
'''.replace("__D__", _D)

GATE_NAME = "      - name: Fail on a new high or critical advisory\n"
PINNED_LINE = '        run: trivy fs --download-db-only --timeout 15m --cache-dir "$RUNNER_TEMP/trivy-pinned" --db-repository "ghcr.io/aquasecurity/trivy-db@%s"\n' % _D

# (name, [(old, new), ...]) -- each `old` must occur exactly once in the text it
# is applied to, or the case itself fails: a mutation that silently did not apply
# would report a guard as catching something it never saw.
JOB_MUTATIONS = [
    ("--exit-code 1 removed", [("            --exit-code 1 \\\n", "")]),
    ("--exit-code 0, with '--exit-code 1' moved into the name",
     [("            --exit-code 1 \\\n", "            --exit-code 0 \\\n"),
      (GATE_NAME, "      - name: Fail on a new high or critical advisory --exit-code 1\n")]),
    ("--exit-code 1 then --exit-code 0 (last flag wins)", [("--exit-code 1 \\\n", "--exit-code 1 --exit-code 0 \\\n")]),
    ("--severity removed", [("            --severity HIGH,CRITICAL \\\n", "")]),
    ("--severity CRITICAL, with HIGH,CRITICAL in the name",
     [("--severity HIGH,CRITICAL", "--severity CRITICAL"),
      (GATE_NAME, "      - name: Fail on HIGH,CRITICAL\n")]),
    ("--ignorefile pointed at another file", [("--ignorefile .trivyignore \\\n", "--ignorefile other.trivyignore \\\n")]),
    ("--skip-files pnpm-lock.yaml added", [("            --skip-db-update \\\n", "            --skip-db-update \\\n            --skip-files pnpm-lock.yaml \\\n")]),
    ("|| true on the gate", [("            .\n      - name: Fetch the latest", "            . || true\n      - name: Fetch the latest")]),
    ("continue-on-error on the gate step", [(GATE_NAME, GATE_NAME + "        continue-on-error: true\n")]),
    ("if: false on the gate step", [(GATE_NAME, GATE_NAME + "        if: false\n")]),
    ("if: push-only on the gate step", [(GATE_NAME, GATE_NAME + "        if: github.event_name == 'push'\n")]),
    ("continue-on-error on the whole job", [("    name: Security Scan\n", "    name: Security Scan\n    continue-on-error: true\n")]),
    ("|| true on the pinned download", [(PINNED_LINE, PINNED_LINE.rstrip("\n") + " || true\n")]),
    ("gate replaced by an echo that quotes its flags", [("        run: |\n          trivy fs \\\n", "        run: |\n          echo trivy fs \\\n")]),
    ("setup-trivy@main with version latest",
     [("aquasecurity/setup-trivy@v0.3.1", "aquasecurity/setup-trivy@main"), ("version: v0.74.0", "version: latest")]),
    ("the pinned download deleted", [(PINNED_LINE, ""), ("      - name: Fetch the pinned vulnerability database, for the gate\n", "")]),
    ("the database unpinned to the :2 tag", [("trivy-db@" + _D, "trivy-db:2")]),
    ("the gate reads the latest cache", [('            --cache-dir "$RUNNER_TEMP/trivy-pinned" \\\n', '            --cache-dir "$RUNNER_TEMP/trivy-latest" \\\n')]),
    ("the SARIF step names no ignore file", [(' --ignorefile "$RUNNER_TEMP/empty.trivyignore" .', " .")]),
    ("the SARIF step names .trivyignore", [(' --ignorefile "$RUNNER_TEMP/empty.trivyignore" .', " --ignorefile .trivyignore .")]),
    ("the SARIF step no longer empties its ignore file", [('          : > "$RUNNER_TEMP/empty.trivyignore"\n', "")]),
    ("a failing step inserted before the gate", [(GATE_NAME, "      - name: Something else\n        run: exit 1\n" + GATE_NAME)]),
    ("TRIVY_SKIP_FILES set on the gate step", [(GATE_NAME, GATE_NAME + "        env:\n          TRIVY_SKIP_FILES: pnpm-lock.yaml\n")]),
    ("upload-sarif pinned to @master", [("github/codeql-action/upload-sarif@v3", "github/codeql-action/upload-sarif@master")]),
    ("--skip-db-update removed from the gate", [("            --skip-db-update \\\n", "")]),
    ("--scanners changed to secret", [("--scanners vuln", "--scanners secret")]),
    ("a second run: key on the gate step", [(GATE_NAME, GATE_NAME + "        run: echo hello\n")]),
    ("working-directory on the gate step", [(GATE_NAME, GATE_NAME + "        working-directory: .github/workflows\n")]),
    ("job-level defaults.run.working-directory", [("    name: Security Scan\n", "    name: Security Scan\n    defaults:\n      run:\n        working-directory: .github/workflows\n")]),
    ("workflow-level defaults.run.working-directory", [("\njobs:\n", "\ndefaults:\n  run:\n    working-directory: .github/workflows\njobs:\n")]),
    ("shell: on the gate step", [(GATE_NAME, GATE_NAME + "        shell: bash --noprofile --norc {0} || true\n")]),
    ("job-level defaults.run.shell", [("    name: Security Scan\n", "    name: Security Scan\n    defaults:\n      run:\n        shell: sh\n")]),
    ("working-directory on the pinned download", [("      - name: Fetch the pinned vulnerability database, for the gate\n", "      - name: Fetch the pinned vulnerability database, for the gate\n        working-directory: /tmp\n")]),
]


def self_test():
    ran = [0]
    failed = []
    base_ids = ["CVE-2025-7783", "CVE-2026-59873", "GHSA-abcd-efgh-ijkm"]

    def check(label, got_failures, want_fail):
        ran[0] += 1
        if bool(got_failures) != want_fail:
            failed.append("%s: expected %s, got %d failure(s)%s" % (
                label, "a failure" if want_fail else "a pass", len(got_failures),
                ("" if want_fail else " -- " + "; ".join(got_failures[:3]))))

    def run(ci=ARMED, ignore=base_ids, baseline=base_ids, sha=BASELINE_SHA256, configs=()):
        return failures_for(ci, list(ignore), list(baseline), sha, list(configs))

    check("the armed job and an intact baseline pass", run(), False)
    for name, pairs in JOB_MUTATIONS:
        text = ARMED
        applied = True
        for old, new in pairs:
            if text.count(old) != 1:
                applied = False
                break
            text = text.replace(old, new, 1)
        if not applied:
            ran[0] += 1
            failed.append("%s: the mutation did not apply exactly once, so it proves nothing" % name)
            continue
        check(name, run(ci=text), True)
    check("a trivy.yaml at the repo root", run(configs=["trivy.yaml"]), True)
    check("a baseline id swapped for a new one", run(ignore=base_ids[:-1] + ["CVE-2026-99999"]), True)
    check("a new id added", run(ignore=base_ids + ["CVE-2026-12345"]), True)
    check("an id listed twice", run(ignore=base_ids + [base_ids[0]]), True)
    check("a wildcard entry", run(ignore=base_ids + ["CVE-2026-*"]), True)
    check("the baseline file edited (hash moved)", run(sha="0" * 64), True)
    check("a baseline SHRUNK by one still passes", run(ignore=base_ids[:-1]), False)
    check("comments quoting an armed gate do not arm a disarmed one",
          run(ci=ARMED.replace("            --exit-code 1 \\\n", "            # --exit-code 1 \\\n")), True)

    if failed:
        for f in failed:
            print("SELF-TEST FAILED: " + f)
        print("FAIL -- %d of %d invariants did not hold." % (len(failed), ran[0]))
        sys.exit(1)
    print("SELF-TEST OK -- %d invariants held." % ran[0])
    sys.exit(0)


def main():
    if "--self-test" in sys.argv:
        self_test()
    for path in (CI, IGNORE, BASELINE):
        if not os.path.isfile(path):
            cannot_check("%s is not a file -- the gate reads it, so its absence is not a pass" % path)
    ci = open(CI, encoding="utf-8").read()
    ignore = open(IGNORE, encoding="utf-8").read().splitlines()
    raw = open(BASELINE, "rb").read()
    baseline = raw.decode("utf-8").splitlines()
    sha = hashlib.sha256(raw).hexdigest()
    configs = [n for n in TRIVY_CONFIG_NAMES if os.path.exists(os.path.join(ROOT, n))]
    failures = failures_for(ci, ignore, baseline, sha, configs)
    n = len([ln for ln in ignore if ln.strip() and not ln.strip().startswith("#")])
    print("== security gate: %d baselined advisor%s (ceiling %d)" % (n, "y" if n == 1 else "ies", BASELINE_CEILING))
    if failures:
        print("")
        print("FAIL -- the security gate is not armed the way ADR 0142 decided:")
        for f in failures:
            print("  -> %s" % f)
        sys.exit(1)
    print("PASS -- the gate fails on a new high or critical advisory against a pinned database,")
    print("        publishing hides nothing, and the baseline has not grown or changed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
