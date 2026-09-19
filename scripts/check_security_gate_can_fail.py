#!/usr/bin/env python3
"""The security gate can fail, its verdict does not move on its own, and the
baseline it forgives only shrinks.

`security` ("Security Scan") is rolled into `CI Complete`, one of main's required
status contexts. Until 2026-09-12 its only scanning step set neither `exit-code`
nor `severity`, so it reported success whatever it found. ADR 0142 armed it, and
three adversarial passes on PR #362 overturned three versions of THIS guard:

  1. it matched flags as substrings anywhere in the job (14 of 21 mutations
     passed);
  2. it read the gate's own flags and nothing GitHub applies from outside them --
     `working-directory`, `shell`, `defaults.run`;
  3. it parsed ci.yml with a hand-written line parser, so every layout that parser
     did not model was invisible to it: `defaults` in flow style, a quoted or
     `? explicit` key, a comment or blank line inside a block, `"if": false`
     (29 of 47 layout mutations passed).

So the workflow is now read with PyYAML, through a SafeLoader that REFUSES a
repeated mapping key and a `<<` merge key. safe_load alone keeps the last of two
duplicates, and a second `run:` or `if:` is exactly how a reader and GitHub come
to see different things. Every check runs on the parsed structure, so quoting,
indentation and flow style no longer change what the guard sees. `run:` strings
are tokenised with shlex the way bash splits them: line continuations removed,
`#` never a comment, shell operators kept as tokens.

It refuses:

  * a gate step that is missing, duplicated, conditional, allowed to fail,
    chained to a shell operator, expanded by the shell before trivy sees it, or
    whose flags are anything but --scanners vuln, --severity HIGH,CRITICAL,
    --ignorefile .trivyignore, --skip-db-update, --cache-dir, --exit-code 1 and
    --format, scanning `.`;
  * a gate that reads a database other than one fetched BY DIGEST into a cache
    under $RUNNER_TEMP (founder's decision 2026-09-12: the gate's verdict must not
    move overnight; a cache inside the checkout is content the PR controls);
  * any step before the gate other than the checkout, the install and the pinned
    download, because a failing step there skips the gate;
  * `working-directory`, `shell`, `continue-on-error` or `env` on the checkout,
    the install or any trivy step, and `if` on any of them except exactly
    `${{ !cancelled() }}` on the two publishing trivy steps after the gate;
  * a checkout that carries `with:` -- path, ref, sparse-checkout and repository
    all change what the gate scans;
  * `defaults.run` at workflow or job level; a job-level `if` or
    `continue-on-error`, or any job key outside the ones the gate runs with
    (`uses` replaces its steps, `needs` can skip it, `container` changes what
    `trivy` is); an entry under `jobs:` that is not a runnable job;
  * an env key BASH_ENV, ENV, BASH_FUNC_*, TRIVY_*, PATH, LD_PRELOAD,
    LD_LIBRARY_PATH, BASHOPTS, SHELLOPTS, RUNNER_TEMP, HOME, XDG_CACHE_HOME or
    TMPDIR at workflow, job or step level;
  * a publishing step that does not name an explicitly EMPTY ignore file -- trivy
    loads `.trivyignore` by default, and doing so hid 107 alerts from the
    Security tab in this guard's first version;
  * an unpinned or moving trivy install, any `@master`/`@main` action;
  * a tracked `.trivyignore`, `trivy.yaml`, `trivy.yml`, `.trivy.yaml` or
    `.trivy.yml` anywhere but the root `.trivyignore` (from `git ls-files`), and
    a root `.trivyignore` git does not track;
  * a `.trivyignore` that is not a subset of the recorded baseline (a swapped id is
    a new advisory silenced at the same line count), that repeats an id, carries a
    wildcard, or exceeds the ceiling; and a baseline file that no longer hashes to
    the value pinned below.

Exit 0 pass, 1 fail, 2 COULD NOT CHECK. Two is not a skip.

What a parse failure is (decided 2026-09-12, round four):

  * ci.yml that is not valid YAML -- a tab used as indentation, two documents, an
    unknown tag, an unhashable key -- exits 2. No job can be read out of it, and
    GitHub refuses a workflow it cannot parse, so no gate runs and CI Complete
    never reports. It is CANNOT CHECK, the same class as every other unreadable
    input here and as check_decision_claims.sh's malformed JSON.
  * ci.yml that parses but repeats a mapping key or uses a merge key exits 1. The
    file WAS read; its ambiguity is the defect.
  * PyYAML not importable, git not runnable, or this guard not at the top of a
    git repository: exit 2. When the workflow ALSO fails a check, the exit is 1
    and the could-not-check reason is printed with it.
"""
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile

try:
    import yaml
    _YAML_IMPORT_ERROR = None
except Exception as _exc:  # noqa: BLE001 -- any failure to import is CANNOT CHECK, never a crash
    yaml = None
    _YAML_IMPORT_ERROR = "%s: %s" % (type(_exc).__name__, _exc)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CI = os.path.join(ROOT, ".github", "workflows", "ci.yml")
IGNORE = os.path.join(ROOT, ".trivyignore")
BASELINE = os.path.join(ROOT, "scripts", "trivy-baseline-2026-09-12.txt")

# sha256 of scripts/trivy-baseline-2026-09-12.txt, the 107 advisories open when
# the gate was armed. Changing that file without changing this constant fails;
# changing both is a visible edit to two gate-owned paths.
BASELINE_SHA256 = "f1ba013c610425fc1570406dd39aa892bf87c84f2c42c0633561f2edfcdf0ce9"
BASELINE_CEILING = 107

ROOT_IGNORE = ".trivyignore"
# trivy loads a file by each of these names from whatever directory it runs in.
TRIVY_FILE_NAMES = (".trivyignore", "trivy.yaml", "trivy.yml", ".trivy.yaml", ".trivy.yml")
PINNED_DB = re.compile(
    r"^(ghcr\.io/aquasecurity/trivy-db|mirror\.gcr\.io/aquasec/trivy-db)@sha256:[0-9a-f]{64}$"
)
ADVISORY_ID = re.compile(r"^(CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4})$")
SEMVER_TAG = re.compile(r"^v\d+\.\d+\.\d+$")
SHELL_OPERATORS = {"||", "&&", ";", "|", "&", ";;", "|&", "(", ")", "<", ">", ">>", "<<", "<<<"}
# Anything the shell rewrites before trivy runs: command and process substitution,
# globs, brace expansion. What would run is then not what this guard reads.
SHELL_EXPANSIONS = ("`", "$(", "<(", ">(", "*", "?", "[", "{", "}")
# Flags that take no value. Anything else consumes the next token unless that
# token itself begins with "-".
BOOLEAN_FLAGS = {
    "--skip-db-update", "--download-db-only", "--skip-java-db-update", "--ignore-unfixed",
    "--quiet", "-q", "--no-progress", "--debug", "-d", "--insecure", "--offline-scan",
    "--list-all-pkgs", "--include-dev-deps", "--skip-policy-update", "--reset",
}
# The gate's flags, exactly. Anything else is refused -- the named ones below with
# the reason, the rest because the decision never named them.
GATE_FLAGS = ("--scanners", "--severity", "--ignorefile", "--skip-db-update", "--cache-dir",
              "--exit-code", "--format")
GATE_FORBIDDEN_FLAGS = {
    "--skip-files", "--skip-dirs", "--config", "-c", "--ignore-unfixed", "--ignore-policy",
    "--db-repository", "--vex", "--file-patterns", "--download-db-only",
    "--pkg-types", "--vuln-type", "--ignore-status", "--severity-src",
}
CACHE_ROOT = "$RUNNER_TEMP/"
PUBLISH_IF = "${{ !cancelled() }}"
JOB_KEYS = ("name", "runs-on", "permissions", "steps", "timeout-minutes", "env")
ENV_WHY = {
    "BASH_ENV": "a file bash sources before the step's command runs",
    "ENV": "a file sh sources before the step's command runs",
    "PATH": "which decides what `trivy` is",
    "LD_PRELOAD": "which injects code into every process the step starts",
    "LD_LIBRARY_PATH": "which injects code into every process the step starts",
    "BASHOPTS": "which changes how bash runs the step before its command does",
    "SHELLOPTS": "which changes how bash runs the step before its command does",
    "RUNNER_TEMP": "which moves the database caches the gate is pinned to",
    "HOME": "which moves trivy's default cache and config directories",
    "XDG_CACHE_HOME": "which moves trivy's default cache directory",
    "TMPDIR": "which moves where trivy unpacks what it scans",
}
ENV_PREFIX_WHY = (
    ("BASH_FUNC_", "an exported shell function, which can replace `trivy` itself"),
    ("TRIVY_", "which trivy reads as configuration and can skip or re-scope the scan"),
)
OUTSIDE_WHY = {
    "working-directory": "GitHub `cd`s there first, so `.` stops being the repository root",
    "shell": "a custom shell can swallow the command's exit code",
    "continue-on-error": "its failure no longer fails the job",
}


class CannotCheck(Exception):
    """The guard could not read what it claims to read. Exit 2."""


class Ambiguous(Exception):
    """ci.yml parses, but a reader and GitHub can see different things. Exit 1."""


def cannot_check(why):
    print("CANNOT CHECK: %s" % why)
    print("  Exit 2 is not a skip. The guard could not read what it claims to read,")
    print("  and a guard with nothing to look at gives the same answer as one that")
    print("  looked and found health.")
    sys.exit(2)


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #

if yaml is not None:
    class StrictLoader(yaml.SafeLoader):
        """SafeLoader that refuses a repeated mapping key and a `<<` merge key."""

        def construct_mapping(self, node, deep=False):
            if isinstance(node, yaml.MappingNode):
                seen = set()
                for key_node, _value_node in node.value:
                    line = key_node.start_mark.line + 1
                    if key_node.tag == "tag:yaml.org,2002:merge":
                        raise Ambiguous(
                            "ci.yml line %d uses a `<<` merge key. Keys merged in from elsewhere are "
                            "invisible where they land, and whether GitHub merges them the way PyYAML "
                            "does is not something this guard can check" % line)
                    if key_node.tag == "tag:yaml.org,2002:value":
                        key = "="
                    else:
                        key = self.construct_object(key_node, deep=True)
                    try:
                        repeated = key in seen
                    except TypeError:
                        break  # unhashable: the base constructor raises its own YAMLError
                    if repeated:
                        raise Ambiguous(
                            "ci.yml line %d repeats the mapping key %r. safe_load keeps the last copy, a "
                            "reader may stop at the first, and a second `run:` or `if:` is exactly how "
                            "the two come to disagree" % (line, key))
                    seen.add(key)
            return super().construct_mapping(node, deep=deep)


def load_workflow(text):
    """The parsed workflow. Raises Ambiguous (a fail) or CannotCheck (exit 2)."""
    if yaml is None:
        raise CannotCheck("PyYAML is not importable (%s). CI installs pyyaml==6.0.2 before this guard "
                          "runs; locally, `python3 -m pip install pyyaml==6.0.2`" % _YAML_IMPORT_ERROR)
    try:
        doc = yaml.load(text, Loader=StrictLoader)  # noqa: S506 -- StrictLoader is a SafeLoader
    except Ambiguous:
        raise
    except yaml.YAMLError as exc:
        raise CannotCheck("ci.yml is not valid YAML (%s). GitHub refuses a workflow it cannot parse, so no "
                          "gate runs at all -- there is no job here to vouch for"
                          % " ".join(str(exc).split())[:240])
    if not isinstance(doc, dict):
        raise CannotCheck("ci.yml does not parse to a mapping (it is %s)" % type(doc).__name__)
    return doc


def _keys(value, where, out, strict=True):
    """A mapping with its string keys lower-cased, or None (with a failure) if it is not one."""
    if not isinstance(value, dict):
        out.append("%s is not a mapping (it is %s), so this guard cannot read what GitHub will do with it"
                   % (where, type(value).__name__))
        return None
    res = {}
    for k, v in value.items():
        if not isinstance(k, str):
            if strict:
                out.append("%s has a key that is not a string: %r" % (where, k))
            continue
        low = k.lower()
        if low in res:
            out.append("%s has keys that differ only by case (%r); which one GitHub honours is not what a "
                       "reader sees" % (where, k))
        res[low] = v
    return res


def _env_failures(env, where, out):
    if env is None:
        return
    if not isinstance(env, dict):
        out.append("%s env is not a mapping (%r); an env this guard cannot read cannot be vouched for"
                   % (where, env))
        return
    for k in env:
        name = str(k)
        up = name.upper()
        if "${{" in name:
            out.append("%s env has a key built from an expression (%s), which this guard cannot read" % (where, name))
        elif up in ENV_WHY:
            out.append("%s env sets %s, %s" % (where, name, ENV_WHY[up]))
        else:
            for prefix, why in ENV_PREFIX_WHY:
                if up.startswith(prefix):
                    out.append("%s env sets %s, %s" % (where, name, why))
                    break


def _defaults_failure(value, where):
    if value is None:
        return None
    if isinstance(value, dict):
        run, other = None, []
        for k, v in value.items():
            if isinstance(k, str) and k.lower() == "run":
                run = v
            else:
                other.append(k)
        if not other and (run is None or run == {}):
            return None
        if not other and isinstance(run, dict):
            return ("%s sets defaults.run %s, which silently re-points or re-shells every run step beneath "
                    "it, the gate included" % (where, ", ".join(sorted(str(k) for k in run))))
    return "%s sets `defaults` to %r, which this guard cannot read as harmless" % (where, value)


def commands(run):
    """Logical command lines, the way bash reads them: backslash-newline removed."""
    text = (run or "").replace("\\\n", "")
    return [c.strip() for c in text.split("\n") if c.strip()]


def tokens(cmd):
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    # shlex treats `#` as a comment even mid-word; bash does not. `.#||true` is a
    # path and an operator to bash, and a clean `.` to a comment-aware shlex.
    lex.commenters = ""
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


def read_steps(raw_steps, out):
    """Each step's lower-cased keys, commands, tokens and single `trivy fs` invocation."""
    steps = []
    for idx, raw in enumerate(raw_steps):
        keys = _keys(raw, "step %d of the `security` job" % (idx + 1), out)
        keys = keys if keys is not None else {}
        name = keys.get("name")
        st = {
            "index": idx, "keys": keys, "cmds": [], "toks": [], "trivy": None, "tok_error": None,
            "label": repr(name) if isinstance(name, str) else "#%d" % (idx + 1),
            "uses": keys.get("uses") if isinstance(keys.get("uses"), str) else "",
        }
        if "uses" in keys and not isinstance(keys["uses"], str):
            out.append("step %s: `uses` is not a string" % st["label"])
        if "run" in keys:
            run = keys["run"]
            if not isinstance(run, str):
                out.append("step %s: `run` is not a string (it is %s), so what the shell receives cannot be read"
                           % (st["label"], type(run).__name__))
            else:
                st["cmds"] = commands(run)
                for c in st["cmds"]:
                    try:
                        toks = tokens(c)
                    except ValueError as exc:
                        st["tok_error"] = str(exc)
                        out.append("step %s: `run` cannot be tokenised the way a shell would split it (%s)"
                                   % (st["label"], exc))
                        break
                    st["toks"].append(toks)
                    if st["trivy"] is None and toks[:2] == ["trivy", "fs"]:
                        flags, pos = trivy_flags(toks)
                        st["trivy"] = {"toks": toks, "flags": flags, "pos": pos}
        if "uses" in keys and "run" in keys:
            out.append("step %s carries both `uses` and `run`" % st["label"])
        steps.append(st)
    return steps


def tracked_files(root, git="git"):
    """`git ls-files` at the repository top. Raises CannotCheck when git cannot say."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}

    def git_run(*args):
        try:
            r = subprocess.run([git, "-C", root] + list(args), capture_output=True, env=env, timeout=120)
        except (OSError, subprocess.SubprocessError) as exc:
            raise CannotCheck("git could not be run (%s: %s); the sweep for trivy config and ignore files "
                              "anywhere in the repository needs `git ls-files`" % (type(exc).__name__, exc))
        if r.returncode != 0:
            raise CannotCheck("`git %s` failed in %s (exit %d: %s)" % (
                " ".join(args), root, r.returncode, r.stderr.decode("utf-8", "replace").strip()[:200]))
        return r.stdout.decode("utf-8", "surrogateescape")

    top = git_run("rev-parse", "--show-toplevel").strip()
    if os.path.realpath(top) != os.path.realpath(root):
        raise CannotCheck("%s is not the top of its git repository (%s is), so `git ls-files` there would not "
                          "list the tree CI checks out" % (root, top))
    files = [p for p in git_run("ls-files", "-z").split("\0") if p]
    if not files:
        raise CannotCheck("`git ls-files` listed nothing in %s" % root)
    return files


# --------------------------------------------------------------------------- #
# The checks, as a pure function of the inputs so the self-test runs the real thing.
# --------------------------------------------------------------------------- #

def _one(flags, name):
    vals = flags.get(name, [])
    return vals[0] if len(vals) == 1 else None


def _cache_ok(path):
    return (isinstance(path, str) and path.startswith(CACHE_ROOT) and len(path) > len(CACHE_ROOT)
            and ".." not in path.split("/"))


def _single_clean_trivy(st):
    """Why a step's `run` is not exactly one operator-free `trivy fs` command, or None."""
    if st["tok_error"]:
        return "cannot be tokenised the way a shell would split it"
    if len(st["cmds"]) != 1:
        return "runs %d commands, not exactly one" % len(st["cmds"])
    toks = st["toks"][0]
    ops = [t for t in toks if t in SHELL_OPERATORS]
    if ops:
        return "chains a shell operator (%s), which can mask trivy's exit code" % ", ".join(ops)
    if toks[:2] != ["trivy", "fs"]:
        return "does not begin `trivy fs`"
    return None


def failures_for(ci_text, ignore_lines, baseline_lines, baseline_sha, tracked):
    """Every reason the tree's gate cannot be vouched for. `tracked` is `git ls-files`, or None
    when git could not say (the caller reports that separately). Raises CannotCheck."""
    out = []
    try:
        doc = load_workflow(ci_text)
    except Ambiguous as exc:
        return [str(exc)]

    top = _keys(doc, "ci.yml", out, strict=False)
    msg = _defaults_failure(top.get("defaults"), "the workflow")
    if msg:
        out.append(msg)
    _env_failures(top.get("env"), "the workflow's", out)

    jobs = top.get("jobs")
    if not isinstance(jobs, dict):
        return out + ["ci.yml has no `jobs` mapping"]
    for jid, jv in jobs.items():
        if not (isinstance(jv, dict) and any(isinstance(k, str) and k.lower() in ("runs-on", "uses") for k in jv)):
            out.append("jobs.%s is not a job GitHub can run (no `runs-on` or `uses`). GitHub rejects the "
                       "workflow, and a key indented under `jobs:` is not the block it looks like" % jid)
    sec_ids = [j for j in jobs if isinstance(j, str) and j.lower() == "security"]
    if not sec_ids:
        return out + ["there is no `security` job in ci.yml -- the gate this guard describes is gone or renamed"]
    if len(sec_ids) > 1:
        return out + ["ci.yml has %d jobs whose ids differ from `security` only by case" % len(sec_ids)]

    job = _keys(jobs[sec_ids[0]], "the `security` job", out)
    if job is None:
        return out
    for k in job:
        if k in ("if", "continue-on-error"):
            out.append("the `security` job itself carries `%s:`, so it can be skipped or allowed to fail" % k)
        elif k == "defaults":
            msg = _defaults_failure(job[k], "the `security` job")
            if msg:
                out.append(msg)
        elif k == "env":
            _env_failures(job[k], "the `security` job's", out)
        elif k not in JOB_KEYS:
            out.append("the `security` job carries `%s:`, which is not one of the keys the gate runs with (%s): "
                       "`uses` replaces its steps, `needs` can skip it, `container` changes what `trivy` is"
                       % (k, ", ".join(JOB_KEYS)))

    raw_steps = job.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        return out + ["the `security` job has no parseable steps"]
    steps = read_steps(raw_steps, out)

    for st in steps:
        if re.search(r"@(master|main)$", st["uses"]):
            out.append("step %s pins an action to a moving branch: %s" % (st["label"], st["uses"]))
        _env_failures(st["keys"].get("env"), "step %s" % st["label"], out)

    checkouts = [s for s in steps if s["uses"].startswith("actions/checkout@")]
    installs = [s for s in steps if s["uses"].startswith("aquasecurity/setup-trivy@")]
    trivy_steps = [s for s in steps if s["trivy"]]
    pinned = [s for s in trivy_steps
              if "--download-db-only" in s["trivy"]["flags"] and "--db-repository" in s["trivy"]["flags"]]
    gates = [s for s in trivy_steps if "--exit-code" in s["trivy"]["flags"]]
    latest = [s for s in trivy_steps
              if "--download-db-only" in s["trivy"]["flags"] and "--db-repository" not in s["trivy"]["flags"]]
    sarifs = [s for s in trivy_steps if s["trivy"]["flags"].get("--format") == ["sarif"]]
    gate = gates[0] if len(gates) == 1 else None

    # --- what GitHub applies around a command, on every step the verdict rests on
    publishing = {id(s) for s in latest + sarifs}
    strict = {id(s) for s in checkouts + installs + trivy_steps}
    for st in steps:
        if id(st) not in strict and not (gate and st["index"] < gate["index"]):
            continue
        keys = st["keys"]
        for key, why in OUTSIDE_WHY.items():
            if key in keys:
                out.append("step %s sets `%s`; %s" % (st["label"], key, why))
        if "env" in keys:
            out.append("step %s carries `env:`; nothing the gate decided needs one, and HOME, XDG_CACHE_HOME, "
                       "TMPDIR or TRIVY_* all move what trivy reads" % st["label"])
        if "if" in keys and not (id(st) in publishing and keys["if"] == PUBLISH_IF):
            out.append("step %s is conditional (`if: %s`), so it can be skipped" % (st["label"], keys["if"]))

    # --- checkout -----------------------------------------------------------
    if len(checkouts) != 1:
        out.append("expected exactly one actions/checkout step, found %d" % len(checkouts))
    for s in checkouts:
        if "with" in s["keys"]:
            w = s["keys"]["with"]
            out.append("the checkout step %s carries `with:` (%s); path, ref, sparse-checkout and repository all "
                       "change what the gate scans" % (s["label"], ", ".join(sorted(map(str, w))) if isinstance(w, dict) else repr(w)))
        if gate and s["index"] > gate["index"]:
            out.append("the checkout step %s runs after the gate" % s["label"])

    # --- install ---------------------------------------------------------
    if len(installs) != 1:
        out.append("expected exactly one aquasecurity/setup-trivy step, found %d" % len(installs))
    else:
        tag = installs[0]["uses"].split("@", 1)[1]
        if not SEMVER_TAG.match(tag):
            out.append("setup-trivy is not pinned to a vX.Y.Z tag: @%s" % tag)
        with_ = installs[0]["keys"].get("with")
        version = with_.get("version") if isinstance(with_, dict) else None
        if not (isinstance(version, str) and SEMVER_TAG.match(version)):
            out.append("trivy's version is not pinned to vX.Y.Z: %r" % (version,))

    for st in trivy_steps:
        bad = sorted({t for toks in st["toks"] for t in toks if any(x in t for x in SHELL_EXPANSIONS)})
        if bad:
            out.append("trivy step %s has token(s) the shell expands before trivy sees them (%s): command "
                       "substitution, a glob or a brace, so what runs is not what this guard reads"
                       % (st["label"], ", ".join(bad[:3])))

    # --- the pinned download ------------------------------------------------
    pinned_cache = None
    if len(pinned) != 1:
        out.append("expected exactly one database download pinned with --db-repository, found %d" % len(pinned))
    else:
        p = pinned[0]
        why = _single_clean_trivy(p)
        if why:
            out.append("the pinned database download %s" % why)
        if p["trivy"]["flags"].get("--download-db-only") != [True]:
            out.append("the pinned database download gives --download-db-only a value")
        repo = _one(p["trivy"]["flags"], "--db-repository")
        if not (isinstance(repo, str) and PINNED_DB.match(repo)):
            out.append("the gate's database is not pinned BY DIGEST (got %r); a tag like :2 moves daily" % repo)
        pinned_cache = _one(p["trivy"]["flags"], "--cache-dir")
        if not isinstance(pinned_cache, str):
            out.append("the pinned database download does not name exactly one --cache-dir")
        elif not _cache_ok(pinned_cache):
            out.append("the pinned database's --cache-dir %r is not under $RUNNER_TEMP; a cache inside the "
                       "checkout is content the PR controls" % pinned_cache)

    # --- the gate -----------------------------------------------------------
    if gate is None:
        out.append("expected exactly one trivy step that sets --exit-code (the gate), found %d" % len(gates))
    else:
        f = gate["trivy"]["flags"]
        why = _single_clean_trivy(gate)
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
        elif f["--skip-db-update"] != [True]:
            out.append("the gate gives --skip-db-update a value (%r), so it can fetch a database of its own"
                       % f["--skip-db-update"])
        gate_cache = _one(f, "--cache-dir")
        if pinned_cache is not None and gate_cache != pinned_cache:
            out.append("the gate reads cache %r, not the pinned database's cache %r" % (gate_cache, pinned_cache))
        if not _cache_ok(gate_cache):
            out.append("the gate's --cache-dir %r is not a single path under $RUNNER_TEMP; a cache inside the "
                       "checkout is content the PR controls" % (gate_cache,))
        for bad in sorted(GATE_FORBIDDEN_FLAGS & set(f)):
            out.append("the gate passes %s, which narrows or re-sources what it scans" % bad)
        for extra in sorted(set(f) - set(GATE_FLAGS) - GATE_FORBIDDEN_FLAGS):
            out.append("the gate passes %s, which is not one of the flags ADR 0142 decided (%s)"
                       % (extra, ", ".join(GATE_FLAGS)))
        for k in GATE_FLAGS:
            if len(f.get(k, [])) > 1:
                out.append("the gate passes %s %d times; trivy honours the last" % (k, len(f[k])))
        if gate["trivy"]["pos"] != ["."]:
            out.append("the gate scans %r, not the repository root '.'" % gate["trivy"]["pos"])
        allowed_before = {id(s) for s in installs + pinned + checkouts}
        for s in steps[: gate["index"]]:
            if id(s) not in allowed_before:
                out.append("step %s runs BEFORE the gate; if it fails, the gate is skipped" % s["label"])

    # --- publishing ---------------------------------------------------------
    latest_cache = _one(latest[0]["trivy"]["flags"], "--cache-dir") if len(latest) == 1 else None
    if len(latest) != 1:
        out.append("expected exactly one unpinned database download for the Security tab, found %d" % len(latest))
    if len(sarifs) != 1:
        out.append("expected exactly one SARIF publishing step, found %d" % len(sarifs))
    else:
        sp = sarifs[0]
        ign = sp["trivy"]["flags"].get("--ignorefile")
        truncated = {t[2] for t in sp["toks"] if len(t) == 3 and t[0] == ":" and t[1] == ">"}
        if not ign or len(ign) != 1:
            out.append("the SARIF step names no --ignorefile, so trivy applies .trivyignore and hides the baseline "
                       "from the Security tab")
        elif ign[0] == ".trivyignore" or ign[0] not in truncated:
            out.append("the SARIF step's --ignorefile %r is not a file the same step empties with `: >`" % ign[0])
        if latest_cache is not None and sp["trivy"]["flags"].get("--cache-dir") != [latest_cache]:
            out.append("the SARIF step does not read the latest database's cache %r" % latest_cache)
        for t in sp["toks"]:
            if t[:2] == ["trivy", "fs"] and any(x in SHELL_OPERATORS for x in t):
                out.append("the SARIF trivy command chains a shell operator")

    # --- trivy config and ignore files anywhere in the tree -----------------
    if tracked is not None:
        if ROOT_IGNORE not in tracked:
            out.append(".trivyignore is not tracked by git, so the checkout CI scans will not contain it")
        for path in tracked:
            if path.rsplit("/", 1)[-1] in TRIVY_FILE_NAMES and path != ROOT_IGNORE:
                out.append("%s is tracked; trivy loads a file by that name from whatever directory it runs in, so "
                           "any copy but the root .trivyignore can re-scope or silence a scan" % path)

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
# --self-test: every shape an adversarial pass used, each a named case.
# --------------------------------------------------------------------------- #

_D = "sha256:" + "a" * 64
# A whole workflow whose `security` job is ci.yml's, digest aside -- an invariant
# below proves that, so the mutations prove things about the job CI really runs.
ARMED = r'''name: CI

on:
  push:
    branches: [main]

env:
  NODE_VERSION: 20.x

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo build

  security:
    name: Security Scan
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
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
    steps:
      - run: echo next
'''.replace("__D__", _D)

WD = ".github/workflows"
WF_JOBS = "\njobs:\n"
WF_ENV = "env:\n  NODE_VERSION: 20.x\n"
JOB_HEAD = "  security:\n    name: Security Scan\n"
NEXT_JOB = "  next-job:\n"
CHECKOUT = "      - name: Checkout code\n        uses: actions/checkout@v7\n"
INSTALL_NAME = "      - name: Install trivy\n"
PINNED_NAME = "      - name: Fetch the pinned vulnerability database, for the gate\n"
PINNED_LINE = ('        run: trivy fs --download-db-only --timeout 15m --cache-dir "$RUNNER_TEMP/trivy-pinned" '
               '--db-repository "ghcr.io/aquasecurity/trivy-db@%s"\n' % _D)
GATE_NAME = "      - name: Fail on a new high or critical advisory\n"
GATE_RUN = "        run: |\n          trivy fs \\\n            --scanners vuln"
GATE_TAIL = "            --format table \\\n            .\n"
GATE_CACHE = '            --cache-dir "$RUNNER_TEMP/trivy-pinned" \\\n'
LATEST_NAME = "      - name: Fetch the latest vulnerability database, for the Security tab\n"
SARIF_NAME = "      - name: Run Trivy vulnerability scanner\n"
UPLOAD_NAME = "      - name: Upload Trivy results to GitHub Security\n"
DISARMED_JOB = "  security:\n    name: Security Scan\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n\n"


def _tail(flag):
    return [(GATE_TAIL, "            --format table \\\n            %s \\\n            .\n" % flag)]


# (name, [(old, new), ...] or text -> text, expected outcome, a phrase the refusal
# must contain). Each `old` must occur exactly once, or the case itself fails: a
# mutation that silently did not apply would report a guard as catching something
# it never saw. And a refusal for some OTHER reason than the case's needle fails
# too -- a guard that refuses everything proves nothing.
JOB_MUTATIONS = [
    # ---- the first two adversarial passes -----------------------------------
    ("--exit-code 1 removed", [("            --exit-code 1 \\\n", "")], "fail", "--exit-code"),
    ("--exit-code 0, with '--exit-code 1' moved into the name",
     [("            --exit-code 1 \\\n", "            --exit-code 0 \\\n"),
      (GATE_NAME, "      - name: Fail on a new high or critical advisory --exit-code 1\n")], "fail", "--exit-code"),
    ("--exit-code 1 then --exit-code 0 (last flag wins)", [("--exit-code 1 \\\n", "--exit-code 1 --exit-code 0 \\\n")],
     "fail", "--exit-code"),
    ("--severity removed", [("            --severity HIGH,CRITICAL \\\n", "")], "fail", "--severity"),
    ("--severity CRITICAL, with HIGH,CRITICAL in the name",
     [("--severity HIGH,CRITICAL", "--severity CRITICAL"), (GATE_NAME, "      - name: Fail on HIGH,CRITICAL\n")],
     "fail", "--severity"),
    ("--ignorefile pointed at another file", [("--ignorefile .trivyignore \\\n", "--ignorefile other.trivyignore \\\n")],
     "fail", "--ignorefile"),
    ("--skip-files pnpm-lock.yaml added",
     [("            --skip-db-update \\\n", "            --skip-db-update \\\n            --skip-files pnpm-lock.yaml \\\n")],
     "fail", "--skip-files"),
    ("|| true on the gate", [("            .\n      - name: Fetch the latest", "            . || true\n      - name: Fetch the latest")],
     "fail", "shell operator"),
    ("continue-on-error on the gate step", [(GATE_NAME, GATE_NAME + "        continue-on-error: true\n")], "fail", "continue-on-error"),
    ("if: false on the gate step", [(GATE_NAME, GATE_NAME + "        if: false\n")], "fail", "conditional"),
    ("if: push-only on the gate step", [(GATE_NAME, GATE_NAME + "        if: github.event_name == 'push'\n")], "fail", "conditional"),
    ("continue-on-error on the whole job", [("    name: Security Scan\n", "    name: Security Scan\n    continue-on-error: true\n")],
     "fail", "continue-on-error"),
    ("|| true on the pinned download", [(PINNED_LINE, PINNED_LINE.rstrip("\n") + " || true\n")], "fail", "shell operator"),
    ("gate replaced by an echo that quotes its flags", [("        run: |\n          trivy fs \\\n", "        run: |\n          echo trivy fs \\\n")],
     "fail", "the gate"),
    ("setup-trivy@main with version latest",
     [("aquasecurity/setup-trivy@v0.3.1", "aquasecurity/setup-trivy@main"), ("version: v0.74.0", "version: latest")], "fail", "@main"),
    ("the pinned download deleted", [(PINNED_LINE, ""), (PINNED_NAME, "")], "fail", "pinned with --db-repository"),
    ("the database unpinned to the :2 tag", [("trivy-db@" + _D, "trivy-db:2")], "fail", "BY DIGEST"),
    ("the gate reads the latest cache", [(GATE_CACHE, '            --cache-dir "$RUNNER_TEMP/trivy-latest" \\\n')], "fail", "cache"),
    ("the SARIF step names no ignore file", [(' --ignorefile "$RUNNER_TEMP/empty.trivyignore" .', " .")], "fail", "SARIF"),
    ("the SARIF step names .trivyignore", [(' --ignorefile "$RUNNER_TEMP/empty.trivyignore" .', " --ignorefile .trivyignore .")],
     "fail", "SARIF"),
    ("the SARIF step no longer empties its ignore file", [('          : > "$RUNNER_TEMP/empty.trivyignore"\n', "")], "fail", "SARIF"),
    ("a failing step inserted before the gate", [(GATE_NAME, "      - name: Something else\n        run: exit 1\n" + GATE_NAME)],
     "fail", "BEFORE the gate"),
    ("TRIVY_SKIP_FILES set on the gate step", [(GATE_NAME, GATE_NAME + "        env:\n          TRIVY_SKIP_FILES: pnpm-lock.yaml\n")],
     "fail", "TRIVY_SKIP_FILES"),
    ("upload-sarif pinned to @master", [("github/codeql-action/upload-sarif@v3", "github/codeql-action/upload-sarif@master")],
     "fail", "@master"),
    ("--skip-db-update removed from the gate", [("            --skip-db-update \\\n", "")], "fail", "--skip-db-update"),
    ("--scanners changed to secret", [("--scanners vuln", "--scanners secret")], "fail", "--scanners"),
    ("a second run: key on the gate step", [(GATE_NAME, GATE_NAME + "        run: echo hello\n")], "fail", "repeats the mapping key"),
    ("job-level defaults.run.shell", [("    name: Security Scan\n", "    name: Security Scan\n    defaults:\n      run:\n        shell: sh\n")],
     "fail", "defaults.run shell"),
    ("working-directory on the pinned download", [(PINNED_NAME, PINNED_NAME + "        working-directory: /tmp\n")],
     "fail", "working-directory"),

    # ---- the third pass: harness.py, layouts the line parser did not model ---
    ("C1 step working-directory", [(GATE_NAME, GATE_NAME + "        working-directory: %s\n" % WD)], "fail", "working-directory"),
    ("C2 job defaults wd", [(JOB_HEAD, JOB_HEAD + "    defaults:\n      run:\n        working-directory: %s\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("C3 workflow defaults wd", [(WF_JOBS, "\ndefaults:\n  run:\n    working-directory: %s\njobs:\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("C4 step shell", [(GATE_NAME, GATE_NAME + "        shell: bash --noprofile --norc {0} || true\n")], "fail", "`shell`"),
    ("D1 wf defaults flow style", [(WF_JOBS, "\ndefaults: {run: {working-directory: %s}}\njobs:\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D2 job defaults flow style", [(JOB_HEAD, JOB_HEAD + "    defaults: {run: {working-directory: %s}}\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D3 job defaults run: at indent 5", [(JOB_HEAD, JOB_HEAD + "    defaults:\n     run:\n       working-directory: %s\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D4 wf defaults trailing comment", [(WF_JOBS, "\ndefaults:  # all run steps\n  run:\n    working-directory: %s\njobs:\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D5 job defaults trailing comment",
     [(JOB_HEAD, JOB_HEAD + "    defaults:  # all run steps\n      run:\n        working-directory: %s\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D6 wf defaults blank line inside", [(WF_JOBS, "\ndefaults:\n\n  run:\n    working-directory: %s\njobs:\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D7 job defaults blank line inside", [(JOB_HEAD, JOB_HEAD + "    defaults:\n\n      run:\n        working-directory: %s\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D8 wf defaults comment line inside", [(WF_JOBS, "\ndefaults:\n  # note\n  run:\n    working-directory: %s\njobs:\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D9 wf defaults tab indent (invalid YAML)", [(WF_JOBS, "\ndefaults:\n\trun:\n\t\tworking-directory: %s\njobs:\n" % WD)],
     "cannot-check", "not valid YAML"),
    ("D10 job defaults quoted key", [(JOB_HEAD, JOB_HEAD + "    \"defaults\":\n      run:\n        working-directory: %s\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D11 wf defaults quoted key", [(WF_JOBS, "\n\"defaults\":\n  run:\n    working-directory: %s\njobs:\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D12 job defaults run: flow", [(JOB_HEAD, JOB_HEAD + "    defaults:\n      run: {working-directory: %s}\n" % WD)],
     "fail", "defaults.run working-directory"),
    ("D13 wf defaults at col0 after jobs (end of file)",
     lambda t: t.rstrip("\n") + "\n\ndefaults:\n  run:\n    working-directory: %s\n" % WD, "fail", "defaults.run working-directory"),
    ("D14 defaults: at indent 2 inside jobs", [(JOB_HEAD, "  defaults:\n    run:\n      working-directory: %s\n" % WD + JOB_HEAD)],
     "fail", "jobs.defaults is not a job"),
    ("K1 step \"working-directory\"", [(GATE_NAME, GATE_NAME + "        \"working-directory\": %s\n" % WD)], "fail", "working-directory"),
    ("K2 step working-directory : x", [(GATE_NAME, GATE_NAME + "        working-directory : %s\n" % WD)], "fail", "working-directory"),
    ("K3 step 'working-directory'", [(GATE_NAME, GATE_NAME + "        'working-directory': %s\n" % WD)], "fail", "working-directory"),
    ("K4 step explicit ? key", [(GATE_NAME, GATE_NAME + "        ? working-directory\n        : %s\n" % WD)], "fail", "working-directory"),
    ("K5 step \"shell\": true {0}", [(GATE_NAME, GATE_NAME + "        \"shell\": true {0}\n")], "fail", "`shell`"),
    ("K6 step \"if\": false", [(GATE_NAME, GATE_NAME + "        \"if\": false\n")], "fail", "conditional"),
    ("K7 step if : false", [(GATE_NAME, GATE_NAME + "        if : false\n")], "fail", "conditional"),
    ("K8 step \"continue-on-error\": true", [(GATE_NAME, GATE_NAME + "        \"continue-on-error\": true\n")], "fail", "continue-on-error"),
    ("K9 job \"if\": false", [(JOB_HEAD, JOB_HEAD + "    \"if\": false\n")], "fail", "`if:`"),
    ("R1 cd && trivy", [(GATE_RUN, "        run: |\n          cd %s && trivy fs \\\n            --scanners vuln" % WD)], "fail", "the gate"),
    ("R2 cd newline trivy", [(GATE_RUN, "        run: |\n          cd %s\n          trivy fs \\\n            --scanners vuln" % WD)],
     "fail", "commands, not exactly one"),
    ("R3 pushd newline trivy", [(GATE_RUN, "        run: |\n          pushd %s\n          trivy fs \\\n            --scanners vuln" % WD)],
     "fail", "commands, not exactly one"),
    ("R4 second positional", [(GATE_TAIL, "            --format table \\\n            . %s\n" % WD)], "fail", "repository root"),
    ("R5 --ignorefile elsewhere", [("            --ignorefile .trivyignore \\\n", "            --ignorefile %s/.trivyignore \\\n" % WD)],
     "fail", "--ignorefile"),
    ("R6 --cache-dir elsewhere", [(GATE_CACHE, '            --cache-dir "$RUNNER_TEMP/trivy-latest" \\\n')], "fail", "cache"),
    ("E1 gate env HOME", [(GATE_NAME, GATE_NAME + "        env:\n          HOME: /tmp/x\n")], "fail", "carries `env:`"),
    ("E2 gate env XDG_CACHE_HOME+TMPDIR",
     [(GATE_NAME, GATE_NAME + "        env:\n          XDG_CACHE_HOME: ${{ runner.temp }}/x\n          TMPDIR: ${{ runner.temp }}/t\n")],
     "fail", "carries `env:`"),
    ("E3 job env BASH_ENV", [(JOB_HEAD, JOB_HEAD + "    env:\n      BASH_ENV: .github/trivy-env.sh\n")], "fail", "sets BASH_ENV"),
    ("E4 step env flow TRIVY_PKG_TYPES", [(GATE_NAME, GATE_NAME + "        env: {TRIVY_PKG_TYPES: os}\n")], "fail", "TRIVY_PKG_TYPES"),
    ("E5 job env flow TRIVY_PKG_TYPES", [(JOB_HEAD, JOB_HEAD + "    env: {TRIVY_PKG_TYPES: os}\n")], "fail", "TRIVY_PKG_TYPES"),
    ("J1 job uses reusable workflow, steps removed",
     lambda t: t[:t.index(JOB_HEAD)] + JOB_HEAD + "    uses: ./.github/workflows/security-reusable.yml\n\n" + t[t.index(NEXT_JOB):],
     "fail", "`uses:`"),
    ("J2 duplicate security job (disarmed second)", [(NEXT_JOB, DISARMED_JOB + NEXT_JOB)], "fail", "repeats the mapping key"),
    ("J3 duplicate security job (disarmed first)", [(JOB_HEAD, DISARMED_JOB + JOB_HEAD)], "fail", "repeats the mapping key"),
    ("X1 checkout sparse-checkout .github only",
     [(CHECKOUT, CHECKOUT + "        with:\n          sparse-checkout: .github\n          sparse-checkout-cone-mode: false\n")],
     "fail", "sparse-checkout"),
    ("X2 checkout ref: base sha",
     [(CHECKOUT, CHECKOUT + "        with:\n          ref: ${{ github.event.pull_request.base.sha || github.sha }}\n")], "fail", "ref"),
    ("F1 gate --pkg-types os", _tail("--pkg-types os"), "fail", "--pkg-types"),
    ("F2 gate --ignore-status all",
     _tail("--ignore-status unknown,not_affected,affected,fixed,under_investigation,will_not_fix,fix_deferred,end_of_life"),
     "fail", "--ignore-status"),

    # ---- round four: the refusals added with the PyYAML rewrite --------------
    ("workflow defaults.run.shell, flow style", [(WF_JOBS, "\ndefaults: {run: {shell: sh}}\njobs:\n")], "fail", "defaults.run shell"),
    ("job defaults as an expression", [(JOB_HEAD, JOB_HEAD + "    defaults: ${{ fromJSON('{}') }}\n")], "fail", "`defaults`"),
    ("if: false on checkout", [(CHECKOUT, CHECKOUT + "        if: false\n")], "fail", "conditional"),
    ("working-directory on checkout", [(CHECKOUT, CHECKOUT + "        working-directory: /tmp\n")], "fail", "working-directory"),
    ("continue-on-error on checkout", [(CHECKOUT, CHECKOUT + "        continue-on-error: true\n")], "fail", "continue-on-error"),
    ("shell on checkout", [(CHECKOUT, CHECKOUT + "        shell: sh\n")], "fail", "`shell`"),
    ("if: false on the install step", [(INSTALL_NAME, INSTALL_NAME + "        if: false\n")], "fail", "conditional"),
    ("if: always() on the pinned download", [(PINNED_NAME, PINNED_NAME + "        if: always()\n")], "fail", "conditional"),
    ("continue-on-error on the pinned download", [(PINNED_NAME, PINNED_NAME + "        continue-on-error: true\n")],
     "fail", "continue-on-error"),
    ("continue-on-error on the latest download", [(LATEST_NAME, LATEST_NAME + "        continue-on-error: true\n")],
     "fail", "continue-on-error"),
    ("working-directory on the latest download", [(LATEST_NAME, LATEST_NAME + "        working-directory: /tmp\n")],
     "fail", "working-directory"),
    ("shell on the SARIF step", [(SARIF_NAME, SARIF_NAME + "        shell: sh {0}\n")], "fail", "`shell`"),
    ("if: false on the SARIF step instead of !cancelled()",
     [(SARIF_NAME + "        if: ${{ !cancelled() }}\n", SARIF_NAME + "        if: false\n")], "fail", "conditional"),
    ("`If:` with a capital on the gate", [(GATE_NAME, GATE_NAME + "        If: false\n")], "fail", "conditional"),
    ("job-level if: false, plain", [(JOB_HEAD, JOB_HEAD + "    if: false\n")], "fail", "`if:`"),
    ("job needs another job, which can skip it", [(JOB_HEAD, JOB_HEAD + "    needs: build\n")], "fail", "`needs:`"),
    ("job runs in a container", [(JOB_HEAD, JOB_HEAD + "    container: alpine:3\n")], "fail", "`container:`"),
    ("workflow env BASH_ENV", [(WF_ENV, WF_ENV + "  BASH_ENV: .github/x.sh\n")], "fail", "sets BASH_ENV"),
    ("workflow env ENV", [(WF_ENV, WF_ENV + "  ENV: .github/x.sh\n")], "fail", "sets ENV"),
    ("workflow env TRIVY_SEVERITY, flow style", [(WF_ENV, "env: {NODE_VERSION: 20.x, TRIVY_SEVERITY: LOW}\n")],
     "fail", "TRIVY_SEVERITY"),
    ("job env BASH_FUNC_trivy%%", [(JOB_HEAD, JOB_HEAD + "    env:\n      BASH_FUNC_trivy%%: \"() { exit 0; }\"\n")],
     "fail", "BASH_FUNC_trivy%%"),
    ("job env PATH", [(JOB_HEAD, JOB_HEAD + "    env:\n      PATH: ./.github/bin:/usr/bin:/bin\n")], "fail", "sets PATH"),
    ("job env RUNNER_TEMP", [(JOB_HEAD, JOB_HEAD + "    env:\n      RUNNER_TEMP: .github/cache\n")], "fail", "sets RUNNER_TEMP"),
    ("job env HOME (E1 lifted to the job)", [(JOB_HEAD, JOB_HEAD + "    env:\n      HOME: /tmp/x\n")], "fail", "sets HOME"),
    ("workflow env XDG_CACHE_HOME (E2 lifted to the workflow)",
     [(WF_ENV, WF_ENV + "  XDG_CACHE_HOME: .github/cache\n")], "fail", "sets XDG_CACHE_HOME"),
    ("step env BASH_ENV on the gate", [(GATE_NAME, GATE_NAME + "        env:\n          BASH_ENV: x.sh\n")], "fail", "sets BASH_ENV"),
    ("step env ENV on the upload step, after the gate", [(UPLOAD_NAME, UPLOAD_NAME + "        env:\n          ENV: x.sh\n")],
     "fail", "sets ENV"),
    ("checkout with path", [(CHECKOUT, CHECKOUT + "        with:\n          path: elsewhere\n")], "fail", "path"),
    ("checkout with repository", [(CHECKOUT, CHECKOUT + "        with:\n          repository: octocat/hello-world\n")],
     "fail", "repository"),
    ("no checkout step", [(CHECKOUT, "")], "fail", "actions/checkout"),
    ("--vuln-type os on the gate", _tail("--vuln-type os"), "fail", "--vuln-type"),
    ("--severity-src nvd on the gate", _tail("--severity-src nvd"), "fail", "--severity-src"),
    ("--offline-scan, a flag the decision never named", _tail("--offline-scan"), "fail", "--offline-scan"),
    ("-s CRITICAL, a short flag", _tail("-s CRITICAL"), "fail", "passes -s"),
    ("--skip-db-update=false on the gate", [("            --skip-db-update \\\n", "            --skip-db-update=false \\\n")],
     "fail", "--skip-db-update a value"),
    ("mid-word # hides || true from a comment-aware tokeniser", [(GATE_TAIL, "            --format table \\\n            .#||true\n")],
     "fail", "shell operator"),
    ("command substitution in a gate flag value",
     [("            --format table \\\n", '            --format "$(: > pnpm-lock.yaml; echo table)" \\\n')], "fail", "expands"),
    ("backticks on the pinned download", [(PINNED_LINE, PINNED_LINE.replace("--timeout 15m", "--timeout `rm -f pnpm-lock.yaml`15m"))],
     "fail", "expands"),
    ("gate and pinned download share a cache inside the checkout",
     [('--cache-dir "$RUNNER_TEMP/trivy-pinned" --db', "--cache-dir .github/cache --db"),
      (GATE_CACHE, "            --cache-dir .github/cache \\\n")], "fail", "not under $RUNNER_TEMP"),
    ("an unclosed quote", [(GATE_CACHE, '            --cache-dir "$RUNNER_TEMP/trivy-pinned \\\n')], "fail", "tokenised"),
    ("a `<<` merge key on the gate step", [(GATE_NAME, GATE_NAME + "        <<: {continue-on-error: true}\n")], "fail", "merge key"),
    ("`run:` that is not a string", [(PINNED_LINE, "        run: [trivy, fs]\n")], "fail", "not a string"),
    ("two YAML documents (invalid for a workflow)", lambda t: t + "\n---\nname: other\n", "cannot-check", "not valid YAML"),
    ("an unhashable key (invalid YAML)", [(WF_JOBS, "\n? [a, b]\n: c\njobs:\n")], "cannot-check", "not valid YAML"),
]


class _NotApplied(Exception):
    pass


def _mutate(text, spec):
    if callable(spec):
        try:
            return spec(text)
        except ValueError as exc:
            raise _NotApplied(str(exc))
    for old, new in spec:
        if text.count(old) != 1:
            raise _NotApplied("anchor found %d times: %r" % (text.count(old), old[:60]))
        text = text.replace(old, new, 1)
    return text


def _normalised_job(text):
    job = yaml.load(text, Loader=StrictLoader)["jobs"]["security"]
    return re.sub(r"sha256:[0-9a-f]{64}", "sha256:<digest>", json.dumps(job, sort_keys=True, default=str))


def _yaml_blocked_run():
    """Run this guard with `import yaml` failing, the way a runner without PyYAML would."""
    me = os.path.abspath(__file__)
    code = ("import sys, runpy; sys.modules['yaml'] = None; sys.argv = [%r]; "
            "runpy.run_path(%r, run_name='__main__')" % (me, me))
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
    if r.returncode == 2 and "Traceback" not in r.stderr:
        raise CannotCheck(r.stdout.strip())
    return ["exit %d with `import yaml` blocked; stderr: %s" % (r.returncode, r.stderr.strip()[-300:])]


def self_test():
    if yaml is None:
        cannot_check("PyYAML is not importable (%s); the self-test parses workflows with it" % _YAML_IMPORT_ERROR)
    for path in (CI, IGNORE, BASELINE):
        if not os.path.isfile(path):
            cannot_check("%s is not a file; the self-test proves the real tree passes" % path)
    try:
        real_ci = open(CI, encoding="utf-8").read()
        real_ignore = open(IGNORE, encoding="utf-8").read().splitlines()
        raw = open(BASELINE, "rb").read()
        real_baseline, real_sha = raw.decode("utf-8").splitlines(), hashlib.sha256(raw).hexdigest()
        real_tracked = tracked_files(ROOT)
    except (OSError, UnicodeDecodeError, CannotCheck) as exc:
        cannot_check("the self-test could not read the real tree: %s" % exc)

    base_ids = ["CVE-2025-7783", "CVE-2026-59873", "GHSA-abcd-efgh-ijkm"]
    fixture_tracked = [ROOT_IGNORE, "scripts/check_security_gate_can_fail.py"]

    def run(ci=ARMED, ignore=base_ids, baseline=base_ids, sha=BASELINE_SHA256, tracked=fixture_tracked):
        return failures_for(ci, list(ignore), list(baseline), sha, None if tracked is None else list(tracked))

    def fixture_is_real():
        try:
            real = _normalised_job(real_ci)
        except Exception as exc:  # noqa: BLE001
            return ["ci.yml's security job could not be read: %s" % exc]
        return [] if real == _normalised_job(ARMED) else [
            "the self-test's fixture job is no longer ci.yml's security job; update ARMED so the mutations "
            "below prove things about the job CI runs"]

    def no_git_repo():
        with tempfile.TemporaryDirectory() as d:
            return tracked_files(d)

    # (label, thunk, expected outcome, needle)
    cases = [
        ("the real ci.yml, .trivyignore, baseline and git tree pass",
         lambda: failures_for(real_ci, real_ignore, real_baseline, real_sha, real_tracked), "pass", None),
        ("the fixture's security job is ci.yml's, digest aside", fixture_is_real, "pass", None),
        ("the armed fixture and an intact baseline pass", run, "pass", None),
    ]
    for name, spec, expect, needle in JOB_MUTATIONS:
        def thunk(spec=spec):
            return run(ci=_mutate(ARMED, spec))
        cases.append((name, thunk, expect, needle))
    cases += [
        ("a trivy.yaml at the repo root", lambda: run(tracked=fixture_tracked + ["trivy.yaml"]), "fail", "trivy.yaml is tracked"),
        ("a .trivyignore in a subdirectory", lambda: run(tracked=fixture_tracked + [".github/workflows/.trivyignore"]),
         "fail", ".github/workflows/.trivyignore is tracked"),
        ("a trivy.yml in a subdirectory", lambda: run(tracked=fixture_tracked + ["apps/web/trivy.yml"]), "fail", "trivy.yml is tracked"),
        ("a .trivy.yaml at the repo root", lambda: run(tracked=fixture_tracked + [".trivy.yaml"]), "fail", ".trivy.yaml is tracked"),
        ("a .trivy.yml in a subdirectory", lambda: run(tracked=fixture_tracked + ["services/x/.trivy.yml"]),
         "fail", ".trivy.yml is tracked"),
        ("the root .trivyignore not tracked by git", lambda: run(tracked=["README.md"]), "fail", "not tracked"),
        ("git is not installed", lambda: tracked_files(ROOT, git="git-not-installed-%d" % os.getpid()),
         "cannot-check", "git could not be run"),
        ("the guard's root is not a git repository", no_git_repo, "cannot-check", "git"),
        ("PyYAML is not importable", _yaml_blocked_run, "cannot-check", "PyYAML is not importable"),
        ("a baseline id swapped for a new one", lambda: run(ignore=base_ids[:-1] + ["CVE-2026-99999"]), "fail", "never in the baseline"),
        ("a new id added", lambda: run(ignore=base_ids + ["CVE-2026-12345"]), "fail", "never in the baseline"),
        ("an id listed twice", lambda: run(ignore=base_ids + [base_ids[0]]), "fail", "twice"),
        ("a wildcard entry", lambda: run(ignore=base_ids + ["CVE-2026-*"]), "fail", "not a single CVE"),
        ("the baseline file edited (hash moved)", lambda: run(sha="0" * 64), "fail", "hashes"),
        ("a baseline SHRUNK by one still passes", lambda: run(ignore=base_ids[:-1]), "pass", None),
        ("comments quoting an armed gate do not arm a disarmed one",
         lambda: run(ci=ARMED.replace("            --exit-code 1 \\\n", "            # --exit-code 1 \\\n")), "fail", None),
    ]

    failed = []
    for label, thunk, expect, needle in cases:
        try:
            msgs = thunk()
            state = "fail" if msgs else "pass"
        except _NotApplied as exc:
            failed.append("%s: the mutation did not apply exactly once, so it proves nothing (%s)" % (label, exc))
            continue
        except CannotCheck as exc:
            state, msgs = "cannot-check", [str(exc)]
        except Exception as exc:  # noqa: BLE001 -- a crash is never an expected outcome
            state, msgs = "crash", ["%s: %s" % (type(exc).__name__, exc)]
        if state != expect:
            failed.append("%s: expected %s, got %s -- %s" % (label, expect, state, "; ".join(msgs[:3])))
        elif needle and not any(needle in m for m in msgs):
            failed.append("%s: %s, but not for the reason the case exists to prove (wanted %r in: %s)"
                          % (label, state, needle, "; ".join(msgs[:3])))

    if failed:
        for f in failed:
            print("SELF-TEST FAILED: " + f)
        print("FAIL -- %d of %d invariants did not hold." % (len(failed), len(cases)))
        sys.exit(1)
    print("SELF-TEST OK -- %d invariants held." % len(cases))
    sys.exit(0)


def main():
    if "--self-test" in sys.argv:
        self_test()
    if yaml is None:
        cannot_check("PyYAML is not importable (%s). CI installs pyyaml==6.0.2 before this guard runs; "
                     "a guard that cannot parse the workflow has nothing to vouch for" % _YAML_IMPORT_ERROR)
    for path in (CI, IGNORE, BASELINE):
        if not os.path.isfile(path):
            cannot_check("%s is not a file -- the gate reads it, so its absence is not a pass" % path)
    try:
        ci = open(CI, encoding="utf-8").read()
        ignore = open(IGNORE, encoding="utf-8").read().splitlines()
        raw = open(BASELINE, "rb").read()
        baseline = raw.decode("utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as exc:
        cannot_check("an input could not be read: %s" % exc)
    sha = hashlib.sha256(raw).hexdigest()
    git_problem = None
    try:
        tracked = tracked_files(ROOT)
    except CannotCheck as exc:
        tracked, git_problem = None, str(exc)
    try:
        failures = failures_for(ci, ignore, baseline, sha, tracked)
    except CannotCheck as exc:
        cannot_check(str(exc))
    n = len([ln for ln in ignore if ln.strip() and not ln.strip().startswith("#")])
    print("== security gate: %d baselined advisor%s (ceiling %d)" % (n, "y" if n == 1 else "ies", BASELINE_CEILING))
    if failures:
        print("")
        print("FAIL -- the security gate is not armed the way ADR 0142 decided:")
        for f in failures:
            print("  -> %s" % f)
        if git_problem:
            print("  (and CANNOT CHECK the repository-wide file sweep: %s)" % git_problem)
        sys.exit(1)
    if git_problem:
        cannot_check(git_problem)
    print("PASS -- the gate fails on a new high or critical advisory against a pinned database,")
    print("        publishing hides nothing, and the baseline has not grown or changed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
