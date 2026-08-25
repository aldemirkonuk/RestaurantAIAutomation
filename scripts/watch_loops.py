#!/usr/bin/env python3
"""
The watcher loop — the sixth running loop, and the first this chapter produced.

Why this exists
---------------
The corpus defines 482 feedback loops. Five run. Two of the unwatched ones are
dated rules that fire on a specific morning and then pass silently:

  * 2026-10-23 — all 198 agenda files hit the 60-day staleness rule at once,
    because they were generated in one burst and share `updated: 2026-08-24`.
    A rule that condemns everything condemns nothing.
  * 2026-11-24 — seven units are scheduled to judge whether they should still
    exist (Skills, Sales, Architecture Review, Red Team, and two teams that fold
    with their parents).

Decision Office owns loops for exactly this. Both are `status: proposed`, i.e.
a rule, an owner, and a cadence — with no mechanism. This is the mechanism.

It reports; it never edits the corpus. Findings belong in a unit's questions.md,
written by a human or an advisory pass, not silently by a cron job.

Usage
-----
    python3 scripts/watch_loops.py              # human-readable report
    python3 scripts/watch_loops.py --json       # machine output
    python3 scripts/watch_loops.py --ci         # exit 1 if anything has fired
    python3 scripts/watch_loops.py --asof 2026-11-24   # time-travel to test
"""
from __future__ import annotations
import argparse, datetime as dt, json, pathlib, re, sys, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent / ".planning"
STALE_DAYS = 60          # foundation §3.3: an agenda unchanged in 60 days is finished or fiction
HORIZON_DAYS = 30        # warn this far ahead of a dated trigger

RUNNING = {"active", "running", "live"}


def frontmatter(path: pathlib.Path) -> dict:
    """Parse the leading --- block. Tolerant: this must never crash the watcher."""
    try:
        text = path.read_text(errors="replace")
    except Exception:
        return {}
    if not text.startswith("---"):
        return {}
    block = text.split("---", 2)[1] if text.count("---") >= 2 else ""
    out = {}
    for line in block.splitlines():
        m = re.match(r"^([a-z_]+):\s*(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"\'')
    return out


def parse_date(s: str):
    try:
        return dt.date.fromisoformat(s)
    except Exception:
        return None


def scan(asof: dt.date) -> dict:
    unit_dirs = [ROOT / "01-org", ROOT / "02-advisory"]

    # --- 1. staleness cliff -------------------------------------------------
    agendas = []
    for base in unit_dirs:
        agendas += list(base.rglob("*-agenda-*.md"))
    by_date = collections.Counter()
    stale = []
    for p in agendas:
        d = parse_date(frontmatter(p).get("updated", ""))
        if not d:
            continue
        by_date[d.isoformat()] += 1
        age = (asof - d).days
        if age >= STALE_DAYS:
            stale.append({"file": str(p.relative_to(ROOT)), "updated": d.isoformat(), "age_days": age})

    cliffs = []
    for iso, count in by_date.items():
        d = parse_date(iso)
        fires = d + dt.timedelta(days=STALE_DAYS)
        days_out = (fires - asof).days
        if count >= 10 and days_out <= HORIZON_DAYS:
            cliffs.append({
                "kind": "staleness",
                "fires_on": fires.isoformat(),
                "days_out": days_out,
                "count": count,
                "detail": f"{count} agendas share updated:{iso} and go stale together",
            })

    # --- 2. dated retirement / merge triggers -------------------------------
    date_re = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
    trigger_words = re.compile(r"merge|retire|collapse|fold|disband|sunset|dissolution", re.I)
    triggers = collections.defaultdict(set)
    for base in unit_dirs:
        for p in base.rglob("*.md"):
            try:
                for line in p.read_text(errors="replace").splitlines():
                    if not trigger_words.search(line):
                        continue
                    for iso in date_re.findall(line):
                        d = parse_date(iso)
                        if d and d >= dt.date(2026, 9, 1):   # ignore provenance dates
                            unit = p.relative_to(ROOT).parts
                            triggers[iso].add("/".join(unit[:-1]))
            except Exception:
                continue

    trigger_events = []
    for iso, units in sorted(triggers.items()):
        d = parse_date(iso)
        days_out = (d - asof).days
        if days_out <= HORIZON_DAYS:
            trigger_events.append({
                "kind": "retirement-trigger",
                "fires_on": iso,
                "days_out": days_out,
                "count": len(units),
                "detail": f"{len(units)} units must judge whether they should still exist",
                "units": sorted(units),
            })

    # --- 3. loop activation (the headline number) ---------------------------
    loops_path = ROOT / "00-index/loops.json"
    loops = json.loads(loops_path.read_text()) if loops_path.exists() else []
    status = collections.Counter((l.get("status") or "?").strip().lower() for l in loops)
    running = sum(v for k, v in status.items() if k in RUNNING)
    # status values that are actually close-times, or otherwise not a status (OD-47)
    polluted = {k: v for k, v in status.items()
                if k not in RUNNING | {"proposed", "blocked", "dormant", "gated", "?"}}

    return {
        "asof": asof.isoformat(),
        "cliffs": sorted(cliffs + trigger_events, key=lambda e: e["days_out"]),
        "stale_now": stale,
        "loops": {"total": len(loops), "running": running,
                  "by_status": dict(status.most_common()), "polluted_status": polluted},
    }


def report(r: dict) -> int:
    fired = [c for c in r["cliffs"] if c["days_out"] <= 0]
    soon = [c for c in r["cliffs"] if c["days_out"] > 0]
    L = r["loops"]

    print(f"\n  Loop watcher — as of {r['asof']}")
    print(f"  {'─' * 62}")
    print(f"  Loops: {L['running']} running of {L['total']}")
    if L["polluted_status"]:
        print(f"  ⚠  {len(L['polluted_status'])} non-status values in the status field (OD-47): "
              + ", ".join(f"{k!r}×{v}" for k, v in L["polluted_status"].items()))

    if fired:
        print(f"\n  ● FIRED — {len(fired)}")
        for c in fired:
            print(f"      {c['fires_on']}  {c['detail']}  ({-c['days_out']}d ago)")
            for u in c.get("units", [])[:10]:
                print(f"          {u}")
    if soon:
        print(f"\n  ○ Approaching — {len(soon)}")
        for c in soon:
            print(f"      {c['fires_on']}  in {c['days_out']:>3}d  {c['detail']}")
    if not fired and not soon:
        print(f"\n  Nothing fires within {HORIZON_DAYS} days.")

    if r["stale_now"]:
        print(f"\n  Stale agendas (>{STALE_DAYS}d): {len(r['stale_now'])}")

    print()
    return 1 if fired else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--ci", action="store_true", help="exit 1 if a dated rule has fired")
    ap.add_argument("--asof", default=None, help="YYYY-MM-DD, for testing")
    a = ap.parse_args()

    asof = parse_date(a.asof) if a.asof else dt.date.today()
    if asof is None:
        print(f"error: --asof must be YYYY-MM-DD", file=sys.stderr)
        return 2

    r = scan(asof)
    if a.json:
        print(json.dumps(r, indent=1))
        return 1 if (a.ci and any(c["days_out"] <= 0 for c in r["cliffs"])) else 0
    code = report(r)
    return code if a.ci else 0


if __name__ == "__main__":
    sys.exit(main())
