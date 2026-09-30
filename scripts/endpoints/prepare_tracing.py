#!/usr/bin/env python3
"""Prepare the trace phase of ENDPOINTS.md: a shard plan and the census seed.

Reads `.planning/foundation/endpoints/routes.json` (written by
`extract_routes.mjs`) and writes two WORK-ALLOCATION files, next to it or into
`--out-dir`. Neither is committed (ADR 0245): they plan a trace phase and are
deleted once its fragments are folded into `trace.json` with
`render_endpoints.py --merge`. The renderer never reads them.

  shards.json       ten shards of roughly equal route counts. A controller file
                    is never split across shards, and controllers in one
                    feature directory stay together unless that directory alone
                    is larger than a shard, in which case it splits by
                    sub-directory (never by file within a directory unless the
                    directory alone still exceeds the cap).
  census-seed.json  a `seed_from_census` hint for every PATCH/PUT/DELETE route
                    graded in `.planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-
                    2026-09-29.md`. HINTS ONLY: the census's line numbers are at
                    its own commit, and tracers re-verify every one.

Deterministic: the same routes.json always yields the same two files.

Usage:
  python3 scripts/endpoints/prepare_tracing.py            write both files
  python3 scripts/endpoints/prepare_tracing.py --shards N  a different shard count
  python3 scripts/endpoints/prepare_tracing.py --out-dir D write them into D instead

Exit codes: 0 ok, 2 cannot run (routes.json or the census missing/unparseable).
"""

from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DIR = ROOT / ".planning/foundation/endpoints"
ROUTES = DIR / "routes.json"
CENSUS = ROOT / ".planning/07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md"
CENSUS_COMMIT = "71ae5449b"  # stated in the census header ("Measured on origin/main at ...")
SRC_PREFIX = "apps/api-gateway/src/"

# census "scoped" label -> trace house_scope verdict hint. None = the census
# does not settle it; the tracer decides.
LABEL_MAP = {
    "yes": "scoped",
    "yes (guard)": "scoped",
    "yes (user)": "user-scoped",
    "n/a (no resource id)": None,
    "no → fixed": None,
    "no (OD-131 b)": "unscoped",
}


def cannot(msg: str) -> None:
    print(f"CANNOT RUN: {msg}", file=sys.stderr)
    sys.exit(2)


def load_routes() -> dict:
    if not ROUTES.exists():
        cannot(f"{ROUTES.relative_to(ROOT)} missing — run node scripts/endpoints/extract_routes.mjs first")
    try:
        return json.loads(ROUTES.read_text())
    except json.JSONDecodeError as e:
        cannot(f"{ROUTES.relative_to(ROOT)} is not valid JSON: {e}")
    raise AssertionError


# --------------------------------------------------------------------------
# Shards
# --------------------------------------------------------------------------


def plan_shards(data: dict, n: int) -> dict:
    per_file: dict[str, list[str]] = collections.defaultdict(list)
    for r in data["routes"]:
        per_file[r["at"].rsplit(":", 1)[0]].append(r["id"])
    total = sum(len(v) for v in per_file.values())
    cap = -(-total // n)  # ceil: a unit larger than this is split further

    def rel(f: str) -> list[str]:
        return f[len(SRC_PREFIX):].split("/")

    # A unit is a list of files that must stay together.
    def units_for(files: list[str], depth: int) -> list[list[str]]:
        size = sum(len(per_file[f]) for f in files)
        groups: dict[str, list[str]] = collections.defaultdict(list)
        for f in files:
            parts = rel(f)
            key = "/".join(parts[:depth]) if len(parts) > depth else "/".join(parts[:-1]) or "(root)"
            groups[key].append(f)
        if size <= cap or len(groups) == 1 and all(len(rel(f)) <= depth for f in files):
            if size <= cap or len(files) == 1:
                return [sorted(files)]
            # one directory, still too big: split by file (a file is never split)
            return [[f] for f in sorted(files)]
        out: list[list[str]] = []
        for key in sorted(groups):
            out.extend(units_for(groups[key], depth + 1))
        return out

    units = units_for(sorted(per_file), 1)
    # Longest-processing-time packing: biggest unit to the lightest shard.
    units.sort(key=lambda u: (-sum(len(per_file[f]) for f in u), u[0]))
    shards = [{"files": [], "routes": 0} for _ in range(n)]
    for u in units:
        i = min(range(n), key=lambda k: (shards[k]["routes"], k))
        shards[i]["files"].extend(u)
        shards[i]["routes"] += sum(len(per_file[f]) for f in u)
    # Stable naming: order shards by their first file so related shards read in path order.
    for s in shards:
        s["files"].sort()
    shards.sort(key=lambda s: s["files"][0])
    ctrl_by_file: dict[str, list[str]] = collections.defaultdict(list)
    for c in data["controllers"]:
        ctrl_by_file[c["file"]].append(c["class"])
    out = []
    for i, s in enumerate(shards, 1):
        sid = f"s{i:02d}"
        out.append({
            "shard": sid,
            "trace_fragment": f"{sid}.json",
            "route_count": s["routes"],
            "files": [
                {"file": f, "controllers": sorted(ctrl_by_file[f]), "routes": len(per_file[f])} for f in s["files"]
            ],
            "route_ids": sorted(rid for f in s["files"] for rid in per_file[f]),
        })
    routeless = sorted(c["at"] for c in data["controllers"] if c.get("route_count", 0) == 0)
    return {
        "schema": 1,
        "generator": "scripts/endpoints/prepare_tracing.py",
        "note": "Work allocation for the trace phase; not committed. Each tracer writes its shard as a fragment ({schema, traced_at_commit, routes}) and render_endpoints.py --merge folds the fragments into trace.json by route id, so regenerating after code changes (files may move between shards) is harmless.",
        "shard_count": n,
        "cap": cap,
        "total_routes": total,
        "routeless_controllers": routeless,
        "shards": out,
    }


# --------------------------------------------------------------------------
# Census seed
# --------------------------------------------------------------------------

ROW = re.compile(r"^\|\s*(PATCH|PUT|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$")
NO_ROW = re.compile(r"^\|\s*`(PATCH|PUT|DELETE) ([^`]+)`\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$")


def norm_path(p: str) -> str:
    return re.sub(r":[^/]+", ":", p)


def seed_census(data: dict) -> dict:
    if not CENSUS.exists():
        cannot(f"{CENSUS.relative_to(ROOT)} missing")
    text = CENSUS.read_text()
    by_exact = {(r["method"], r["path"]): r for r in data["routes"]}
    by_norm: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for r in data["routes"]:
        by_norm[(r["method"], norm_path(r["path"]))].append(r)

    status_of: dict[tuple[str, str], str] = {}
    for line in text.splitlines():
        m = NO_ROW.match(line)
        if m:
            status_of[(m.group(1), m.group(2))] = re.sub(r"\s+", " ", m.group(4)).strip()

    seeds: dict[str, dict] = {}
    unmatched: list[str] = []
    rows = 0
    for line in text.splitlines():
        m = ROW.match(line)
        if not m:
            continue
        rows += 1
        method, path, ctrl, write, label, evidence = m.groups()
        label = label.replace("**", "").strip()
        if label not in LABEL_MAP:
            cannot(f"census label {label!r} is not in LABEL_MAP — classify it on purpose")
        r = by_exact.get((method, path))
        how = "exact"
        if r is None:
            cands = by_norm.get((method, norm_path(path)), [])
            if len(cands) == 1:
                r, how = cands[0], "param-names-differ"
        if r is None:
            unmatched.append(f"{method} {path}")
            continue
        seed = {
            "census_label": label,
            "verdict_hint": LABEL_MAP[label],
            "write_at_census": write,
            "controller_at_census": ctrl,
            "evidence": evidence.strip(),
        }
        if how != "exact":
            seed["matched_by"] = how
            seed["census_path"] = path
        st = status_of.get((method, path))
        if st:
            seed["census_status"] = st
        if r["id"] in seeds:
            cannot(f"two census rows map to route {r['id']}")
        seeds[r["id"]] = seed

    if rows == 0:
        cannot("no census rows parsed — the table format changed")
    mutating = sorted(r["id"] for r in data["routes"] if r["method"] in ("PATCH", "PUT", "DELETE"))
    not_in_census = [rid for rid in mutating if rid not in seeds]
    counts = collections.Counter(s["census_label"] for s in seeds.values())
    return {
        "schema": 1,
        "generator": "scripts/endpoints/prepare_tracing.py",
        "source": str(CENSUS.relative_to(ROOT)),
        "census_commit": CENSUS_COMMIT,
        "note": ("Hints for trace house_scope, never verdicts. Every file:line here is at the census commit, "
                 "not at HEAD. verdict_hint null means the census did not settle it (no resource id, or "
                 "fixed after the census) and the tracer decides."),
        "label_map": LABEL_MAP,
        "census_rows": rows,
        "matched": len(seeds),
        "label_counts": dict(sorted(counts.items())),
        "unmatched_census_rows": unmatched,
        "mutating_routes_now": len(mutating),
        "mutating_routes_not_in_census": not_in_census,
        "seeds": dict(sorted(seeds.items())),
    }


def dump(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")


def main(argv: list[str]) -> int:
    n = 10
    if "--shards" in argv:
        n = int(argv[argv.index("--shards") + 1])
    out_dir = Path(argv[argv.index("--out-dir") + 1]).resolve() if "--out-dir" in argv else DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    data = load_routes()
    shards = plan_shards(data, n)
    seed = seed_census(data)
    dump(out_dir / "shards.json", shards)
    dump(out_dir / "census-seed.json", seed)
    print(f"shards.json: {n} shards, cap {shards['cap']}, sizes {[s['route_count'] for s in shards['shards']]}")
    print(f"census-seed.json: {seed['matched']}/{seed['census_rows']} census rows matched; "
          f"{len(seed['unmatched_census_rows'])} unmatched; "
          f"{len(seed['mutating_routes_not_in_census'])} of {seed['mutating_routes_now']} PATCH/PUT/DELETE routes not in the census")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
