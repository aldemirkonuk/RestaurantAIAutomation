#!/usr/bin/env python3
"""The twelve pulled artifacts are whole: every byte matches what was pinned when they were read as owner.

WHY THIS EXISTS
---------------
ADR 0148 pulled the twelve Mudavym artifacts on claude.ai into
`.planning/07-reference/artifacts/`. The first pull (625ccb98) passed its only check,
"each internal id appears in a file", while missing content:

  * The Arrival, Five Ways publishes six files; only index.html was saved.
  * Three artifacts keep the founder's recorded calls in the artifact database; none
    was saved.

The first version of this guard trusted each file's own header. An adversarial pass
(104 fixture attacks) got 59 false passes: a page cut in the middle, a header saying
fewer documents, a deleted database block with its header line, a duplicated block, and
more. So the facts no longer come from the file being checked. They are PINNED below,
in EXPECTED:

  * live_version, and every other published file's name, size and sha256, come from
    claude.ai frame metadata, read as the owner (org 1138b209) on 2026-09-16.
  * The Arrival's index_sha256 is claude.ai's published hash. The other eleven have no
    published hash. Theirs was pinned from the pull, and two independent owner-org reads
    agree on it byte for byte: 625ccb98's pull, and the owner session's export at 21:32
    the same day.
  * runtime_*: claude.ai serves each page with a frame-runtime block spliced in at a
    fixed offset. It is pinned exactly: two variants, by runtime contract.
  * db: the sorted document ids and a canonical sha256 of the documents in each
    collection, from the documents read as owner. The count matches claude.ai's own
    dbUsage figure.

What passes: each file is header + page + appendix blocks, and nothing else.
  * The header has exactly the pinned identity fields, no duplicate keys, and a real
    description and note.
  * The page is the pinned published bytes with the pinned runtime block spliced in.
  * Every appendix block is expected, appears once, and is byte-exact. A db block holds
    exactly the pinned documents. No stray bytes anywhere.

If an artifact is re-pulled at a new live version, update EXPECTED deliberately: that is
the point.

Exit 0 when all twelve match; 1 otherwise. When the directory is missing, it prints
"No such file or directory" and exits 2, which the claims runner reads as could-not-run.
Wired into CI through CLAIMS.jsonl row ADR-0148-ARTIFACTS-WHOLE.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIR = REPO / ".planning" / "07-reference" / "artifacts"

EXPECTED = {
    "documents-and-reports-redesign": {
        "internal_id": "620c531d-d060-449b-a5e1-cd2b35f9f533",
        "source_url": "https://claude.ai/artifact/D7EJZaPTV2cvSXX9obixAe",
        "live_version": "1788183182-5c78",
        "index_bytes": 2522928,
        "index_sha256": "65c451a97619698b6aa24da7c988d98196d32688c1451bae7bbc24cab15d0650",
        "runtime_at": 27,
        "runtime_bytes": 22016,
        "runtime_sha256": "ff8887c2435181e665ae7ff58dacdc6d255e653a752183b836ab52dab9b2f2f5",
        "files": [],
        "db": {}
    },
    "mudavym-atlas": {
        "internal_id": "a14766c1-b4e3-4578-8338-8b68375f636f",
        "source_url": "https://claude.ai/artifact/Lv6S1GgMycyLEZYrFRdPWe",
        "live_version": "1787844010-163c",
        "index_bytes": 347814,
        "index_sha256": "059e80e510489a99d99b76080b3968feacdba800319fe76bf7e95c4280d5368b",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "mudavym-build-board": {
        "internal_id": "47322370-4b81-445d-ab74-09624d65c847",
        "source_url": "https://claude.ai/artifact/9nuqKGDTVxK7LWqfr912Vk",
        "live_version": "1788290938-151c",
        "index_bytes": 16205,
        "index_sha256": "8169adae24589ef730c55aa01008eb249fb649f1f3613690b9a4a9e15413a841",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "mudavym-cluster-map": {
        "internal_id": "cb024e8e-8687-4043-9742-beba93727003",
        "source_url": "https://claude.ai/artifact/S4yACzsFqvBLJVQsv8rE9g",
        "live_version": "1787844004-f33a",
        "index_bytes": 338704,
        "index_sha256": "66a83a2a647551c074fc258dae892a57000edd315b8ae6a6c4a171c31fbcab84",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "mudavym-go-live-board": {
        "internal_id": "260e2af7-8a3c-4bd0-8ff8-4fd1618007ee",
        "source_url": "https://claude.ai/artifact/5hZELUz2SuswDPGm3boWkD",
        "live_version": "1789159369-1fa3",
        "index_bytes": 25069,
        "index_sha256": "5dd641c909e031b3043ec2c68e35d76fe01ab0b90f082e62216b0ca6dfb114cd",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {
            "verdicts": {
                "ids": [],
                "sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
            }
        }
    },
    "mudavym-identity": {
        "internal_id": "95e8857e-5bc9-4719-acc4-57a94e4e4158",
        "source_url": "https://claude.ai/artifact/KWf4ZygrDXjQQ9NDq2g5KD",
        "live_version": "1788037275-e17e",
        "index_bytes": 27272,
        "index_sha256": "4b54af241991f9daeb13596e08519235db4ca0fbe6b54e057f878b7a0170ef3c",
        "runtime_at": 27,
        "runtime_bytes": 22016,
        "runtime_sha256": "ff8887c2435181e665ae7ff58dacdc6d255e653a752183b836ab52dab9b2f2f5",
        "files": [],
        "db": {}
    },
    "mudavym-motion-canvas": {
        "internal_id": "e281272f-c403-4780-a675-0e9a0a4289ba",
        "source_url": "https://claude.ai/artifact/UyFDGQPXVheake4EVkEG8H",
        "live_version": "1788039327-3da1",
        "index_bytes": 870821,
        "index_sha256": "c9ddaee7b97dffb2018d862faf4082e49833f7413b8f34e250cfaa57c1b8a316",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "mudavym-overlay-census": {
        "internal_id": "23f77c68-7766-40c8-934a-cfa7148c7508",
        "source_url": "https://claude.ai/artifact/5Sbd8DEPctRGpNztw5rez3",
        "live_version": "1788701791-f8af",
        "index_bytes": 177255,
        "index_sha256": "6d8f5cd11e96e16a25539a30431a24f9d03227aed7a70c7520d5719d723f9eb6",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "mudavym-shortlist": {
        "internal_id": "91236693-6fe1-40c8-bb0d-91f428ef9458",
        "source_url": "https://claude.ai/artifact/JvVbe21swPgQE2iKeKhSL7",
        "live_version": "1788039317-e824",
        "index_bytes": 873044,
        "index_sha256": "0aad0fcb2f2d96b73802c51c09f005245d0c035a31f045129a2be2fb97922fc8",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "mudavym-wave-four": {
        "internal_id": "fb2f9455-8d35-411c-85c9-cfb0dbbf7abe",
        "source_url": "https://claude.ai/artifact/Y21sZP2xKshpbGBsnqQ8M3",
        "live_version": "1788419441-42c9",
        "index_bytes": 4648374,
        "index_sha256": "1c69bc2ed4374a719f7da30d0f68945a2ee555bff2096fca9d05e892712bccc6",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {
            "verdicts": {
                "ids": [
                    "calendar",
                    "cellar",
                    "notifications",
                    "profile",
                    "recommendations",
                    "reports",
                    "settings"
                ],
                "sha256": "9e110888616422cedbd9036b5bbd7ac3f3e16a63aa3c2c4302abe2d695bbf5cb"
            }
        }
    },
    "sim-meyhouse-one-friday": {
        "internal_id": "d59646d4-0021-43dd-87e9-9fc70135849e",
        "source_url": "https://claude.ai/artifact/TNjGu67KRetqdmanZhnatd",
        "live_version": "1789158358-e389",
        "index_bytes": 9205889,
        "index_sha256": "78371393dea169ddd060565bab926ae509c53d753f3754fdc58360dc3a4e9bbe",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [],
        "db": {}
    },
    "the-arrival-five-ways": {
        "internal_id": "1d40bc3d-6ddd-49c6-b894-e626fc7f72ad",
        "source_url": "https://claude.ai/artifact/4cWg73gb6zidey1sVKcao6",
        "live_version": "1789159863-d3d8",
        "index_bytes": 31311,
        "index_sha256": "41f3a53f536d42b38d6a804549dc5b2f4cb2dfceb4733d04a38ca79f6eb9b0e6",
        "runtime_at": 27,
        "runtime_bytes": 36864,
        "runtime_sha256": "f388f6c680e8a102fe52492d1d3774908395fd320c0bcaa8382f9d42ac63501f",
        "files": [
            [
                "direction-a.html",
                64829,
                "add73a77e6a298c409b13828209fc0048514e921eb362af9895755ab44d65bee"
            ],
            [
                "direction-b.html",
                82487,
                "9c463691b002d4ece333eb0fd3e2011a626907c826e7762872998c3a0bffd651"
            ],
            [
                "direction-c.html",
                77867,
                "1c408272f1ca5eeadd50425088c2f8ef4824323ba0809c8bffd55bfa51b25a06"
            ],
            [
                "direction-d.html",
                69423,
                "dce42a8202cebc2ca9fa635036545be8fdf81913711f6a9b37bd326a33e2acef"
            ],
            [
                "direction-e.html",
                53322,
                "250c6d4a7931c1d848b27f6ee2ef0eb4dd06b791227fe334f32a6c394617c36a"
            ]
        ],
        "db": {
            "verdicts": {
                "ids": [
                    "a",
                    "b",
                    "c",
                    "d",
                    "e"
                ],
                "sha256": "f9dbec5ca6881c228052a18a3d799c9ca339497c7f96ab1af26f58dcd395674a"
            }
        }
    }
}

REQUIRED = ("title", "source_url", "internal_id", "pulled", "live_version", "files",
            "index_sha256", "description", "note")
RT_OPEN, RT_CLOSE = b"<!-- frame-runtime -->", b"<!-- /frame-runtime -->"
FILE_MARK = re.compile(rb"\n<!-- artifact-file: (\S+) \| (\d+) bytes \| sha256 ([0-9a-f]{64}) -->\n")
DB_MARK = re.compile(rb"\n<!-- artifact-db: (\S+) \| (\d+) documents -->\n```json\n")
DB_END = b"\n```\n"
EMPTY = {"", "~", "null", "none", "todo", "tbd", "-"}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def db_digest(docs: list) -> str:
    canon = json.dumps(sorted(docs, key=lambda d: d["id"]), sort_keys=True,
                       ensure_ascii=False, separators=(",", ":"))
    return sha(canon.encode("utf-8"))


def meaningful(value: str) -> bool:
    v = value.strip().strip("\"'").strip()
    return v.lower() not in EMPTY and len(v) >= 20


def check(slug: str, raw: bytes) -> list[str]:
    exp = EXPECTED[slug]
    m = re.match(rb"---\n(.*?)\n---\n", raw, re.S)
    if not m:
        return ["no frontmatter header"]
    errors: list[str] = []
    fields: dict[str, str] = {}
    for line in m.group(1).decode("utf-8", "replace").splitlines():
        key, sep, value = line.partition(":")
        if not sep:
            continue
        key = key.strip()
        if key in fields:
            errors.append(f"header repeats `{key}`")
        fields[key] = value.strip()
    for key in REQUIRED:
        if not fields.get(key, "").strip().strip("\"'").strip():
            errors.append(f"header lacks `{key}`")
    for key in ("description", "note"):
        if key in fields and not meaningful(fields[key]):
            errors.append(f"header `{key}` is a placeholder")
    for key in ("internal_id", "source_url", "live_version", "index_sha256"):
        if fields.get(key, "").strip("\"") != exp[key]:
            errors.append(f"header `{key}` is not the pinned value")
    want_files = ["index.html"] + [f[0] for f in exp["files"]]
    got_files = [f.strip() for f in fields.get("files", "").strip("[]").split(",") if f.strip()]
    if got_files != want_files:
        errors.append(f"header `files` is {got_files}, pinned {want_files}")
    want_db = ", ".join(f"{c}, {len(d['ids'])} documents" for c, d in sorted(exp["db"].items()))
    if exp["db"]:
        if fields.get("database", "").strip("\"") != want_db:
            errors.append(f"header `database` is not the pinned `{want_db}`")
    elif "database" in fields:
        errors.append("header names a database this artifact does not have")

    body = raw[m.end():]
    page_len = 1 + exp["index_bytes"] + exp["runtime_bytes"]
    if not body.startswith(b"\n") or len(body) < page_len:
        return errors + ["page is shorter than the pinned published file (truncated)"]
    page = body[1:page_len]
    at, n = exp["runtime_at"], exp["runtime_bytes"]
    runtime = page[at: at + n]
    if not (runtime.startswith(RT_OPEN) and runtime.endswith(RT_CLOSE)) or sha(runtime) != exp["runtime_sha256"]:
        errors.append("frame-runtime block is not the pinned block at the pinned offset")
    if sha(page[:at] + page[at + n:]) != exp["index_sha256"]:
        errors.append("published index.html bytes do not match the pinned sha256")

    rest, pos = body[page_len:], 0
    files = {f[0]: (f[1], f[2]) for f in exp["files"]}
    seen_files: set[str] = set()
    seen_db: set[str] = set()
    while pos < len(rest):
        fm = FILE_MARK.match(rest, pos)
        dm = DB_MARK.match(rest, pos)
        if fm:
            name, size, digest = fm.group(1).decode(), int(fm.group(2)), fm.group(3).decode()
            content = rest[fm.end(): fm.end() + size]
            if name not in files:
                errors.append(f"unexpected appended file {name}")
            elif name in seen_files:
                errors.append(f"{name} appended more than once")
            elif (size, digest) != files[name] or len(content) != size or sha(content) != digest:
                errors.append(f"{name} does not match its pinned size and sha256")
            seen_files.add(name)
            pos = fm.end() + size
        elif dm:
            coll, count = dm.group(1).decode(), int(dm.group(2))
            end = rest.find(DB_END, dm.end())
            if end == -1:
                errors.append(f"db {coll}: json block is not closed")
                break
            pinned = exp["db"].get(coll)
            if pinned is None:
                errors.append(f"unexpected db block {coll}")
            elif coll in seen_db:
                errors.append(f"db {coll} appended more than once")
            else:
                try:
                    docs = json.loads(rest[dm.end(): end])
                except ValueError:
                    docs = None
                ok_shape = isinstance(docs, list) and all(
                    isinstance(d, dict) and isinstance(d.get("id"), str) and d["id"]
                    and isinstance(d.get("data"), dict) and d["data"] for d in docs)
                if not ok_shape:
                    errors.append(f"db {coll}: not a list of documents with id and non-empty data")
                elif count != len(pinned["ids"]) or sorted(d["id"] for d in docs) != pinned["ids"] \
                        or db_digest(docs) != pinned["sha256"]:
                    errors.append(f"db {coll}: documents do not match the pinned ids and digest")
            seen_db.add(coll)
            pos = end + len(DB_END)
        else:
            errors.append(f"unexpected bytes after the page at appendix offset {pos}")
            break
    for name in files:
        if name not in seen_files:
            errors.append(f"{name} is published but not appended")
    for coll in exp["db"]:
        if coll not in seen_db:
            errors.append(f"db {coll} is missing")
    return errors


def main() -> int:
    if not DIR.is_dir():
        print(f"cannot check: {DIR}: No such file or directory", file=sys.stderr)
        return 2
    on_disk = {p.stem: p for p in DIR.glob("*.md")}
    failures = 0
    for slug in sorted(set(on_disk) | set(EXPECTED)):
        if slug not in EXPECTED:
            print(f"FAIL {slug}.md\n     - not one of the twelve pinned artifacts")
            failures += 1
            continue
        if slug not in on_disk:
            print(f"FAIL {slug}.md\n     - missing")
            failures += 1
            continue
        errors = check(slug, on_disk[slug].read_bytes())
        failures += bool(errors)
        print(("FAIL " if errors else "ok   ") + f"{slug}.md")
        for err in errors:
            print("     - " + err)
    if failures:
        print(f"\n{failures} artifact(s) do not match their pins: the pull is not whole.")
        return 1
    print(f"\nAll {len(EXPECTED)} artifacts match their pins: published bytes, every other "
          "published file and every database document.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
