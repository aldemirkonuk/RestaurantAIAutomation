#!/usr/bin/env python3
"""Lift loop blocks from fenced YAML bodies into queryable frontmatter + build LOOP-MAP.

`--check` validates and writes nothing: every loop is checked against the
ORG_STRUCTURE §5.1 vocabularies, and the generated index is confirmed current.
Wired into CI as a hard gate — see `.github/workflows/ci.yml`.
"""
import re, json, sys, pathlib, collections

R = pathlib.Path(__file__).resolve().parent.parent / ".planning"   # repo-relative: this runs on CI too
ORG = R / "foundation" / "ORG_STRUCTURE.md"
CHECK = "--check" in sys.argv

files = sorted(list((R/"01-org").rglob("*-loops.md")) + list((R/"02-advisory").rglob("*-loops.md")))

SCALAR = ("id", "owner", "close_time", "status", "evidence")
LIST = ("measures", "changes", "inputs_from", "outputs_to")
LIVE = ("active", "running")   # §5.1: the two statuses that claim a mechanism runs today


def vocabulary(field):
    """Read the permitted values for `field` out of ORG_STRUCTURE §5.1's own table.

    That table is the contract, so it is also the source of truth. A second copy
    here in Python could drift from it, which is the class of failure OD-47 exists
    to end. An unreadable table aborts rather than falling back to a built-in set:
    a silent fallback would disable enforcement at the exact moment the contract
    went missing.
    """
    rows = re.findall(rf"^\|\s*`{field}`\s*\|(.+?)\|\s*$", ORG.read_text(), re.M)
    if len(rows) != 1:
        raise SystemExit(
            f"ORG_STRUCTURE §5.1: expected exactly one `{field}` row, found {len(rows)}.\n"
            f"  {ORG}\n"
            f"That table is the contract this script enforces. Restore the row\n"
            f"    | `{field}` | `value` · `value` … |\n"
            f"before regenerating the loop index.")
    values = tuple(re.findall(r"`([^`]+)`", rows[0]))
    if not values:
        raise SystemExit(f"ORG_STRUCTURE §5.1: the `{field}` row lists no values.")
    return values


CLOSE_TIMES = vocabulary("close_time")
STATUSES = vocabulary("status")


def parse_blocks(body):
    loops = []
    for m in re.finditer(r"```ya?ml\s*\n(.*?)```", body, re.S):
        blk = m.group(1)
        if not re.search(r"^\s*id:", blk, re.M):
            continue
        d = {}
        for k in SCALAR:
            mm = re.search(rf"^\s*{k}:\s*(.+?)\s*$", blk, re.M)
            if mm:
                d[k] = mm.group(1).strip().strip('"\'')
        for k in LIST:
            mm = re.search(rf"^\s*{k}:\s*\[(.*?)\]", blk, re.M | re.S)
            if mm:
                d[k] = [x.strip().strip('"\'') for x in mm.group(1).split(",") if x.strip()]
        if "id" in d:
            loops.append(d)
    return loops


all_loops, pending = [], []
for f in files:
    txt = f.read_text()
    if not txt.startswith("---"):
        continue
    _, fm, body = txt.split("---", 2)
    loops = parse_blocks(body)
    if not loops:
        continue
    unit = f.name.replace("-loops.md", "")
    dm = re.search(r"^division:\s*(.+)$", fm, re.M)
    tm = re.search(r"^department:\s*(.+)$", fm, re.M)
    for L in loops:
        L["unit"] = unit
        L["division"] = dm.group(1).strip() if dm else ""
        L["department"] = tm.group(1).strip() if tm else ""
        L["file"] = str(f.relative_to(R))
    all_loops += loops
    pending.append((f, fm, body, loops))

# §5.1 is a contract, not a convention. Everything is checked before anything is
# written, so a violation leaves the vault untouched rather than half-rewritten.
problems = []
for L in all_loops:
    for field, allowed in (("close_time", CLOSE_TIMES), ("status", STATUSES)):
        if L.get(field) not in allowed:
            problems.append(f"  {L['file']} :: {L['id']}\n"
                            f"      {field}={L.get(field)!r} is not in: {' · '.join(allowed)}")
    # §5.1: `active`/`running` require evidence in the block. Without this the two
    # statuses are self-declared and the live-loop count inflates — the corpus cited
    # 6 while only 2 carried a citation.
    if L.get("status") in LIVE and not (L.get("evidence") or "").strip():
        problems.append(f"  {L['file']} :: {L['id']}\n"
                        f"      status={L['status']!r} but no `evidence:` — cite a file:line,"
                        f" a workflow path, or a query, or set status: proposed")
if problems:
    raise SystemExit(
        f"ORG_STRUCTURE §5.1 (OD-47) — {len(problems)} violation(s):\n\n"
        + "\n".join(problems)
        + "\n\nNothing was written. Fix the loop blocks, or amend §5.1 first if the"
          " contract itself is wrong.")


def frontmatter(fm, loops):
    """Rebuild the queryable arrays. Idempotent: the old lines are stripped first."""
    fm = re.sub(r"^loop_(count|ids|close_times|owners|statuses):.*\n", "", fm, flags=re.M)
    def arr(key):
        return "[" + ", ".join('"%s"' % L.get(key, "") for L in loops) + "]"
    fm = fm.rstrip("\n") + "\n"
    fm += f"loop_count: {len(loops)}\n"
    fm += f"loop_ids: {arr('id')}\n"
    fm += f"loop_close_times: {arr('close_time')}\n"
    fm += f"loop_statuses: {arr('status')}\n"
    return fm


outputs = {f: "---" + frontmatter(fm, loops) + "---" + body for f, fm, body, loops in pending}
outputs[R/"00-index/loops.json"] = json.dumps(all_loops, indent=1)

# LOOP-MAP.md — 56 docs link to it and it did not exist
ct = collections.Counter(L.get("close_time", "—") for L in all_loops)
st = collections.Counter(L.get("status", "—") for L in all_loops)
by_div = collections.defaultdict(list)
for L in all_loops:
    by_div[L["division"]].append(L)

out = ["---", "type: moc", "title: Loop Map", "updated: 2026-08-24", "---", "",
 "# Loop Map", "",
 "> Generated by `scripts/build_loop_index.py` from every `*-loops.md`. **Do not hand-edit.**",
 "",
 f"**{len(all_loops)} loops** across **{len(files)} units** in **{len(by_div)} divisions**.", "",
 "Loop data now also lives in each file's frontmatter (`loop_ids`, `loop_close_times`,",
 "`loop_statuses`) so Dataview can query it — the fenced YAML bodies alone were not",
 "machine-readable, which broke the promise in ORG_STRUCTURE §5.", "",
 "## Status", "", "| Status | Loops |", "|---|---|"]
out += [f"| `{k}` | {v} |" for k, v in st.most_common()]
out += ["", f"> Only the `active`/`running` rows describe something that actually runs today —"
 f" **{st['active'] + st['running']} of {len(all_loops)}**, each citing the mechanism that closes"
 " it. The other statuses are written down, not cycling.", "",
 "## Close-time distribution", "", "| close_time | Loops |", "|---|---|"]
out += [f"| `{k}` | {v} |" for k, v in ct.most_common()]
out += ["", f"**{len(ct)} of the {len(CLOSE_TIMES)} permitted `close_time` values are in use.**"
 " Both `close_time` and `status` are closed vocabularies, locked by OD-47 in"
 " ORG_STRUCTURE §5.1 and read straight from that table by this script — a value outside"
 " either set fails CI rather than landing here.", "",
 "## By division", "", "| Division | Units | Loops |", "|---|---|---|"]
for d in sorted(by_div):
    out.append(f"| {d} | {len({L['unit'] for L in by_div[d]})} | {len(by_div[d])} |")
out += ["", "## Live Dataview query", "",
 "```dataview", "TABLE loop_count, loop_ids, loop_close_times",
 'FROM "01-org" OR "02-advisory"', "WHERE type = \"loops\"", "SORT loop_count DESC", "```"]
outputs[R/"00-index/LOOP-MAP.md"] = "\n".join(out)

if CHECK:
    stale = [p for p, c in outputs.items() if not p.exists() or p.read_text() != c]
    if stale:
        raise SystemExit(
            f"The loop index is stale — {len(stale)} file(s) do not match the loop blocks:\n"
            + "\n".join(f"  {p.relative_to(R)}" for p in sorted(stale))
            + "\n\nRun `python3 scripts/build_loop_index.py` and commit the result.")
    print(f"ok — {len(all_loops)} loops in {len(pending)} units; vocabulary and index current")
else:
    (R/"00-index").mkdir(exist_ok=True)
    for p, c in outputs.items():
        p.write_text(c)
    print(f"files updated: {len(pending)} | loops indexed: {len(all_loops)}")
    print(f"distinct close_time values: {len(ct)} of {len(CLOSE_TIMES)} permitted")
    print("status:", dict(st.most_common(6)))
