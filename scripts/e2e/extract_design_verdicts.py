#!/usr/bin/env python3
"""Pin the founder's recorded design calls for the nightly (ADR 0135, 2026-09-16).

The nightly browser walk reports, beside each page, the call the founder
recorded on it in a claude.ai artifact. Those artifacts are snapshotted into
git under .planning/07-reference/artifacts/ (ADR 0148). This script reads the
snapshots and writes a small pinned file the walk can read at run time:

  apps/web/e2e/nightly/design-verdicts.json

It copies the CALL (keep / rework / merge, a board label and state), its date
and the document version — never the founder's note text, which stays in the
snapshot the entry points at.

Sources, each read from the snapshot's own header and body:
  mudavym-wave-four       artifact-db `verdicts`: one call per page
  mudavym-build-board     the ten page cards: label + state, as of the board date
  the-arrival-five-ways   artifact-db `verdicts`: one call per onboarding direction
                          (a set, not a page; the routes its notes name are listed)
  mudavym-go-live-board   artifact-db `verdicts`: recorded as holding 0 documents,
                          so an empty board says so instead of vanishing

Usage:
  extract_design_verdicts.py [--ref origin/claude/artifact-pull] [--write | --check]

  --ref     read the snapshots from a git ref instead of the working tree
            (they are not on main yet; ADR 0148's branch carries them)
  --write   regenerate the pinned file (default: print it)
  --check   regenerate and compare with the pinned file:
              0  identical
              1  drifted (a snapshot moved; re-run with --write and review)
              2  cannot check (a snapshot is missing or unparseable)
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
ART_DIR = ".planning/07-reference/artifacts"
OUT = ROOT / "apps/web/e2e/nightly/design-verdicts.json"
MANIFEST = ROOT / "apps/web/e2e/nightly/manifest.json"
SOURCES = (
    "mudavym-wave-four",
    "mudavym-build-board",
    "the-arrival-five-ways",
    "mudavym-go-live-board",
)
HEADER_KEYS = (
    "title",
    "internal_id",
    "live_version",
    "pulled",
    "index_sha256",
    "database",
)


class CannotCheck(Exception):
    pass


def read_snapshot(name: str, ref: str | None) -> str:
    rel = f"{ART_DIR}/{name}.md"
    if ref:
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "show", f"{ref}:{rel}"],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise CannotCheck(f"{rel} is not on {ref}: {proc.stderr.strip()[:200]}")
        return proc.stdout
    path = ROOT / rel
    if not path.is_file():
        raise CannotCheck(f"{rel} is not in the working tree (pass --ref)")
    return path.read_text(encoding="utf-8")


def header(text: str, name: str) -> dict[str, str]:
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        raise CannotCheck(f"{name}: no front-matter header")
    out: dict[str, str] = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        if k.strip() in HEADER_KEYS:
            out[k.strip()] = v.strip().strip('"')
    missing = [
        k
        for k in ("title", "internal_id", "live_version", "index_sha256")
        if k not in out
    ]
    if missing:
        raise CannotCheck(f"{name}: header lacks {', '.join(missing)}")
    return out


def db_block(text: str, name: str) -> list[dict[str, Any]]:
    m = re.search(
        r"<!-- artifact-db: verdicts \| (\d+) documents -->\n```json\n(.*?)\n```",
        text,
        re.S,
    )
    if not m:
        raise CannotCheck(f"{name}: no artifact-db verdicts block")
    docs = json.loads(m.group(2))
    if len(docs) != int(m.group(1)):
        raise CannotCheck(
            f"{name}: the block says {m.group(1)} documents and holds {len(docs)}"
        )
    return docs


def body_text(text: str) -> str:
    s = re.sub(
        r"<!-- frame-runtime -->.*?<!-- /frame-runtime -->", "", text, flags=re.S
    )
    return re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def route_to_slug(manifest: dict[str, Any]) -> dict[str, str]:
    table: dict[str, str] = {}
    for entry in manifest["pages"]:
        if "{" not in entry["route"]:  # a param route would shadow its parent
            table[entry["route"]] = entry["slug"]
    # The board titles two pages without a route of their own.
    table["receiving door"] = "receiving_door"
    table["/ dashboard"] = "dashboard"
    return table


def extract(ref: str | None) -> dict[str, Any]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    slugs = {p["slug"] for p in manifest["pages"]}
    routes = route_to_slug(manifest)
    sources: list[dict[str, Any]] = []
    pages: dict[str, list[dict[str, Any]]] = {}
    sets: list[dict[str, Any]] = []
    unmapped: list[str] = []

    for name in SOURCES:
        text = read_snapshot(name, ref)
        h = header(text, name)
        sources.append(
            {
                "artifact": name,
                "snapshot": f"{ART_DIR}/{name}.md",
                "snapshot_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                **h,
            }
        )
        if name == "mudavym-wave-four":
            for doc in db_block(text, name):
                slug = doc["data"].get("page") or doc["id"]
                if slug not in slugs:
                    unmapped.append(f"{name}:{slug}")
                    continue
                pages.setdefault(slug, []).append(
                    {
                        "source": name,
                        "kind": "verdict",
                        "call": doc["data"]["verdict"],
                        "at": doc["data"]["at"],
                        "doc_version": doc["version"],
                    }
                )
        elif name == "mudavym-build-board":
            body = body_text(text)
            date = re.search(r"Build board · (\d{1,2} \w+ \d{4})", strip_tags(body))
            as_of = date.group(1) if date else None
            for card in re.findall(r'<div class="card">(.*?)\n    </div>', body, re.S):
                title = re.search(r"<h3>(.*?)</h3>", card, re.S)
                label = re.search(r'<span class="verdict">(.*?)</span>', card, re.S)
                state = re.search(r'<div class="state[^"]*">(.*?)</div>', card, re.S)
                if not (title and label and state):
                    # A card the parser cannot read is named, never dropped.
                    unmapped.append(f"{name}:unreadable card #{len(unmapped) + 1}")
                    continue
                t = strip_tags(title.group(1))
                slug = routes.get(t) or routes.get(t.lower())
                if not slug:
                    unmapped.append(f"{name}:{t}")
                    continue
                pages.setdefault(slug, []).append(
                    {
                        "source": name,
                        "kind": "board",
                        "label": strip_tags(label.group(1)),
                        "state": strip_tags(state.group(1)),
                        "as_of": as_of,
                    }
                )
        else:
            docs = db_block(text, name)
            # Only routes the manifest knows: a note's "sales division/skills" is not a route.
            known = {p["route"] for p in manifest["pages"]} | {
                p["route"] for p in manifest.get("public_pages", [])
            }
            named = sorted(
                {
                    r
                    for d in docs
                    for r in re.findall(r"/[a-z][a-z-]+", d["data"].get("note", ""))
                    if r in known
                }
            )
            sets.append(
                {
                    "source": name,
                    "documents": len(docs),
                    "calls": [
                        {
                            "id": d["id"],
                            "call": d["data"].get("verdict"),
                            "at": d["data"].get("at"),
                            "doc_version": d["version"],
                        }
                        for d in sorted(docs, key=lambda d: d["id"])
                    ],
                    "routes_named_in_notes": named,
                }
            )

    for slug in pages:
        pages[slug].sort(
            key=lambda r: (r["source"], r.get("at") or r.get("as_of") or "")
        )
    return {
        "$comment": "GENERATED by scripts/e2e/extract_design_verdicts.py from the ADR 0148 artifact snapshots; do not hand-edit. The nightly reports these calls beside each page and never passes or fails a page on them (founder's call, 2026-09-16). The founder's note text is not copied: open the snapshot named in `sources`.",
        "sources": sources,
        "pages": dict(sorted(pages.items())),
        "sets": sets,
        "unmapped": sorted(unmapped),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--ref", default=None)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = ap.parse_args(argv)
    try:
        data = extract(args.ref)
    except (CannotCheck, json.JSONDecodeError, KeyError) as e:
        print(f"CANNOT CHECK — {e}", file=sys.stderr)
        return 2
    rendered = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if args.write:
        OUT.write_text(rendered, encoding="utf-8")
        print(
            f"wrote {OUT.relative_to(ROOT)}: {len(data['pages'])} pages, {len(data['sets'])} sets, {len(data['unmapped'])} unmapped"
        )
        return 0
    if args.check:
        if not OUT.is_file():
            print(
                f"CANNOT CHECK — {OUT.relative_to(ROOT)} does not exist",
                file=sys.stderr,
            )
            return 2
        if OUT.read_text(encoding="utf-8") != rendered:
            print(
                f"DRIFT — {OUT.relative_to(ROOT)} no longer matches the snapshots; re-run with --write and review the diff",
                file=sys.stderr,
            )
            return 1
        print(f"OK — {OUT.relative_to(ROOT)} matches the snapshots")
        return 0
    sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
