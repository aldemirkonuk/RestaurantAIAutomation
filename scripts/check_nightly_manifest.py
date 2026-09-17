#!/usr/bin/env python3
"""
Guard: the nightly's page manifest still describes the tree it ships with.

WHY THIS EXISTS
---------------
apps/web/e2e/nightly/manifest.json tells the production walk which pages to
open and which of each page's own sentences mean "empty", "a read failed" or
"here is where the figure came from". Written 2026-09-11, it was re-read on
2026-09-16 against main and nine of its sentences no longer rendered: four
lived only in source comments, three had been rewritten, one belonged to a
different page, and one named the exact behaviour a test forbids. A twentieth
page (/logs) had been enrolled with no manifest entry at all. Nothing noticed,
because the walk reads a missing sentence as "the page did not say it" — the
suite's own vocabulary rotting reads as a quiet page, which is absence
reported as health.

This guard is read by CI on every push, so the manifest cannot drift from the
pages without a red step naming the sentence.

WHAT IT CHECKS
--------------
  1. pages == MUDAVYM_PAGES (apps/web/src/lib/mudavym/useMudavymDesign.ts),
     both ways, and each page's flag is `mudavym_design_<slug>` and is
     registered in the gateway's feature-flag registry.
  2. Every sentence in a page's empty / failed_read / provenance / static_text
     lists renders from a non-test file in that page's own `source` directory
     or the shared Mudavym components/lib — found outside comments. Shared
     failed_read / denied phrases and public `honest` sentences may render
     from anywhere under apps/web/src.
  3. Every *_testids value exists as a data-testid in non-test source.
  4. public_pages: the route is declared in App.tsx, the file exists, and
     `switch: "public"` holds exactly when that file reads the switch
     (usePublicDesign / isPublicDesignOn).
  5. pending_pages: not enrolled in MUDAVYM_PAGES (the day one enrols, move it
     into pages), and a declared route and existing file unless file is null.
  6. design-verdicts.json names only manifest pages; sim-houses.json lists
     UUIDs with sim- slugs.

WHAT IT DOES NOT CHECK (said, not implied)
------------------------------------------
  * That a sentence renders on the RIGHT page when the page shares a source
    directory with another (receiving and receiving_door both read
    pages/receiving/next), or when it lives in the shared Mudavym components.
  * A sentence split by JSX elements or interpolation: it is reported missing;
    choose a sentence that renders as one run of text.
  * Whether design-verdicts.json still matches the artifact snapshots: the
    snapshots are not on main yet. `scripts/e2e/extract_design_verdicts.py
    --check` does that where they exist; CLAIMS row ADR-0135-h fails the day
    they land, so the check gets wired then.

EXIT CODES
----------
    0   the manifest matches the tree
    1   at least one mismatch; each is printed
    2   cannot check — a required file is missing or unparseable, or a corpus
        scanned to zero
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NIGHTLY = "apps/web/e2e/nightly"
PAGES_TS = "apps/web/src/lib/mudavym/useMudavymDesign.ts"
REGISTRY_TS = "apps/api-gateway/src/settings/feature-flag-registry.ts"
APP_TSX = "apps/web/src/App.tsx"
SRC = "apps/web/src"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SHARED_SOURCE = ("apps/web/src/components/mudavym/", "apps/web/src/lib/mudavym/")
COMMENT_LINE = re.compile(r"^\s*(//|\*|/\*|\{/\*)")


class CannotCheck(Exception):
    pass


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("‘", "'").replace("’", "'")).strip().lower()


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise CannotCheck(f"{path} does not exist")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        raise CannotCheck(f"{path} is unreadable: {e}")


class Corpus:
    """Non-test web source, whitespace-collapsed, with a map back to lines."""

    def __init__(self, root: Path) -> None:
        self.files: list[
            tuple[str, str, list[int], list[str], set[tuple[int, int]]]
        ] = []
        for p in sorted((root / SRC).rglob("*")):
            if p.suffix not in (".ts", ".tsx") or not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if re.search(r"\.(test|spec|stories)\.tsx?$", rel) or "/__tests__/" in rel:
                continue
            raw = p.read_text(encoding="utf-8", errors="replace")
            lines = raw.splitlines()
            flat, line_of = [], []
            prev_space = False
            for n, line in enumerate(lines, 1):
                for ch in line + "\n":
                    ch = "'" if ch in "‘’" else ch
                    if ch.isspace():
                        if prev_space:
                            continue
                        ch, prev_space = " ", True
                    else:
                        prev_space = False
                    flat.append(ch.lower())
                    line_of.append(n)
            self.files.append((rel, "".join(flat), line_of, lines, comment_mask(raw)))
        if not self.files:
            raise CannotCheck(f"{SRC} scanned to zero source files")

    def find(self, phrase: str, within: tuple[str, ...] = ()) -> tuple[bool, list[str]]:
        """(rendered somewhere, comment-only hits) for one phrase, optionally inside some directories."""
        needle = norm(phrase)
        comment_hits: list[str] = []
        for rel, flat, line_of, lines, commented in self.files:
            if within and not rel.startswith(within):
                continue
            start = flat.find(needle)
            while start != -1:
                n = line_of[start]
                if (
                    not COMMENT_LINE.match(lines[n - 1])
                    and (n, 0) not in commented
                    and not trailing_comment(lines[n - 1], needle)
                ):
                    return True, []
                comment_hits.append(f"{rel}:{n}")
                start = flat.find(needle, start + 1)
        return False, comment_hits

    def has_testid(self, tid: str) -> bool:
        pat = re.compile(
            r"""(data-testid|testId)\s*=\s*\{?\s*["'`]"""
            + re.escape(tid)
            + r"""["'`]""",
            re.I,
        )
        return any(pat.search(flat) for _, flat, _, _, _ in self.files)


def comment_mask(raw: str) -> set[tuple[int, int]]:
    """Lines wholly inside a /* ... */ or {/* ... */} block, as (line, 0) keys."""
    inside: set[tuple[int, int]] = set()
    for m in re.finditer(r"/\*.*?\*/", raw, re.S):
        first = raw.count("\n", 0, m.start()) + 1
        last = raw.count("\n", 0, m.end()) + 1
        for n in range(first, last + 1):
            inside.add((n, 0))
    return inside


def trailing_comment(line: str, needle: str) -> bool:
    """True when the phrase sits after a `//` that is not part of a URL."""
    low = norm(line)
    at = low.find(needle)
    cut = re.search(r"(?<![:'\"`])//", low)
    return bool(cut) and at > cut.start()


def mudavym_pages(root: Path) -> list[str]:
    try:
        text = (root / PAGES_TS).read_text(encoding="utf-8")
    except OSError as e:
        raise CannotCheck(f"{PAGES_TS} unreadable: {e}")
    m = re.search(r"export const MUDAVYM_PAGES = \[(.*?)\] as const", text, re.S)
    if not m:
        raise CannotCheck(f"{PAGES_TS}: MUDAVYM_PAGES not found")
    body = re.sub(r"//[^\n]*", "", m.group(1))
    slugs = re.findall(r"'([a-z_]+)'", body)
    if not slugs:
        raise CannotCheck(f"{PAGES_TS}: MUDAVYM_PAGES parsed to zero slugs")
    return slugs


def check(root: Path) -> list[str]:
    problems: list[str] = []
    manifest = load_json(root / NIGHTLY / "manifest.json")
    verdicts = load_json(root / NIGHTLY / "design-verdicts.json")
    sims = load_json(root / NIGHTLY / "sim-houses.json")
    registry = (root / REGISTRY_TS).read_text(encoding="utf-8")
    app = (root / APP_TSX).read_text(encoding="utf-8")
    corpus = Corpus(root)
    enrolled = mudavym_pages(root)

    pages = manifest.get("pages") or []
    if not pages:
        raise CannotCheck("manifest.pages is empty")
    slugs = [p["slug"] for p in pages]

    # 1. pages == MUDAVYM_PAGES, flags named and registered
    for s in sorted(set(enrolled) - set(slugs)):
        problems.append(
            f"[1] MUDAVYM_PAGES enrols '{s}' but manifest.pages has no entry — the walk would never open it"
        )
    for s in sorted(set(slugs) - set(enrolled)):
        problems.append(
            f"[1] manifest.pages lists '{s}' but MUDAVYM_PAGES does not enrol it"
        )
    for dup in sorted({s for s in slugs if slugs.count(s) > 1}):
        problems.append(f"[1] manifest.pages lists '{dup}' twice")
    for p in pages:
        want = f"{manifest.get('flag_prefix', 'mudavym_design_')}{p['slug']}"
        if p.get("flag") != want:
            problems.append(
                f"[1] {p['slug']}: flag is '{p.get('flag')}', expected '{want}'"
            )
        if f'"{want}"' not in registry and f"'{want}'" not in registry:
            problems.append(f"[1] {p['slug']}: {want} is not in {REGISTRY_TS}")

    # 2 + 3. sentences and testids
    def sentences(
        owner: str, key: str, phrases: list[str], within: tuple[str, ...] = ()
    ) -> None:
        for ph in phrases:
            found, comments = corpus.find(ph, within)
            if found:
                continue
            where = (
                f" (only in comments: {', '.join(comments[:3])})" if comments else ""
            )
            scope = ", ".join(within) if within else SRC
            problems.append(
                f'[2] {owner}.{key}: "{ph}" renders from no non-test source under {scope}{where}'
            )

    shared = manifest.get("shared_phrases", {})
    for key in ("failed_read", "denied"):
        sentences("shared_phrases", key, [x for x in shared.get(key, []) if x != "403"])
    for p in pages:
        source = p.get("source")
        if not source or not (root / source).is_dir():
            problems.append(
                f"[2] {p['slug']}: source '{source}' is not a directory — the page's sentences have nowhere to be checked"
            )
            continue
        within = (source.rstrip("/") + "/",) + SHARED_SOURCE
        for key in ("empty", "failed_read", "provenance", "static_text"):
            sentences(p["slug"], key, p.get(key, []), within)
        for key in ("failed_read_testids", "present_testids", "provenance_testids"):
            for tid in p.get(key, []):
                if not corpus.has_testid(tid):
                    problems.append(
                        f"[3] {p['slug']}.{key}: data-testid '{tid}' exists in no non-test source"
                    )

    # 4. public pages
    reads_switch = re.compile(r"\b(usePublicDesign|isPublicDesignOn)\b")
    for e in manifest.get("public_pages") or []:
        route_decl = re.sub(r"/nightly-not-[a-z-]+$", "", e["route"])
        declared = [m.group(1) for m in re.finditer(r'path="([^"]+)"', app)]
        if not any(
            d == e["route"] or d.rsplit("/:", 1)[0] == route_decl for d in declared
        ):
            problems.append(
                f"[4] public {e['slug']}: route {e['route']} is not declared in {APP_TSX}"
            )
        f = root / e["file"]
        if not f.is_file():
            problems.append(f"[4] public {e['slug']}: {e['file']} does not exist")
            continue
        reads = bool(reads_switch.search(f.read_text(encoding="utf-8")))
        if reads != (e["switch"] == "public"):
            problems.append(
                f"[4] public {e['slug']}: manifest says switch '{e['switch']}' but {e['file']} "
                f"{'reads' if reads else 'does not read'} usePublicDesign/isPublicDesignOn"
            )
        sentences(f"public.{e['slug']}", "honest", e.get("honest", []))

    # 5. pending pages
    for e in manifest.get("pending_pages") or []:
        if e["slug"] in enrolled:
            problems.append(
                f"[5] pending {e['slug']} is now in MUDAVYM_PAGES — move it into manifest.pages with its sentences"
            )
        if e.get("file"):
            if f'path="{e["route"]}"' not in app:
                problems.append(
                    f"[5] pending {e['slug']}: route {e['route']} is not declared in {APP_TSX}"
                )
            if not (root / e["file"]).is_file():
                problems.append(f"[5] pending {e['slug']}: {e['file']} does not exist")

    # 6. verdicts and houses
    known = set(slugs)
    for s in sorted(set((verdicts.get("pages") or {}).keys()) - known):
        problems.append(
            f"[6] design-verdicts.json names '{s}', which manifest.pages does not list"
        )
    if verdicts.get("unmapped"):
        problems.append(
            f"[6] design-verdicts.json carries unmapped entries: {verdicts['unmapped']}"
        )
    houses = sims.get("houses") or []
    if not houses:
        raise CannotCheck("sim-houses.json lists no house")
    for h in houses:
        if not UUID.match(str(h.get("id", ""))) or not str(
            h.get("slug", "")
        ).startswith("sim-"):
            problems.append(
                f"[6] sim-houses.json entry {h} is not a uuid with a sim- slug"
            )
    return problems


def main(root: Path = ROOT) -> int:
    try:
        problems = check(root)
    except CannotCheck as e:
        print(f"CANNOT CHECK — {e}")
        return 2
    if problems:
        print(f"== Nightly manifest: {len(problems)} mismatch(es) against the tree")
        for p in problems:
            print(f"  {p}")
        print(
            "FAIL — update apps/web/e2e/nightly/manifest.json (apps/web/e2e/README.md, 'Adding or changing a page')."
        )
        return 1
    print("PASS — the nightly manifest describes this tree.")
    return 0


def self_test() -> int:
    """Prove each check fires, by name, on a tree that breaks it, and that an unreadable input exits 2."""
    base = main()
    if base != 0:
        print(f"self-test: the real tree must pass first (got {base})")
        return 2
    failures = 0

    def mutate(label: str, edit, want: int, expect: str) -> None:
        nonlocal failures
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            for rel in (NIGHTLY, "apps/web/src"):
                shutil.copytree(
                    ROOT / rel, t / rel, ignore=shutil.ignore_patterns("node_modules")
                )
            (t / REGISTRY_TS).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(ROOT / REGISTRY_TS, t / REGISTRY_TS)
            edit(t)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                got = main(t)
            ok = got == want and expect in out.getvalue()
            failures += 0 if ok else 1
            print(
                f"self-test {'ok  ' if ok else 'FAIL'} {label}: exit {got}, expected {want} naming {expect!r}"
            )

    def edit_manifest(fn):
        def run(t: Path) -> None:
            p = t / NIGHTLY / "manifest.json"
            m = json.loads(p.read_text(encoding="utf-8"))
            fn(m)
            p.write_text(json.dumps(m), encoding="utf-8")

        return run

    mutate(
        "a sentence no page renders",
        edit_manifest(
            lambda m: m["pages"][0]
            .setdefault("empty", [])
            .append("nightly self-test sentence that renders nowhere")
        ),
        1,
        '[2] dashboard.empty: "nightly self-test sentence that renders nowhere"',
    )
    mutate(
        "an enrolled page with no entry",
        edit_manifest(lambda m: m["pages"].pop()),
        1,
        "[1] MUDAVYM_PAGES enrols 'logs'",
    )
    mutate(
        "a pending page that has enrolled",
        edit_manifest(
            lambda m: m["pending_pages"].append(
                {
                    "slug": m["pages"][0]["slug"],
                    "route": "/",
                    "file": None,
                    "held_by": "self-test",
                }
            )
        ),
        1,
        "[5] pending dashboard is now in MUDAVYM_PAGES",
    )
    mutate(
        "a public page whose switch claim is wrong",
        edit_manifest(lambda m: m["public_pages"][0].__setitem__("switch", "none")),
        1,
        "[4] public login: manifest says switch 'none'",
    )
    mutate(
        "a testid nothing renders",
        edit_manifest(
            lambda m: m["pages"][0]
            .setdefault("present_testids", [])
            .append("nightly-self-test-testid")
        ),
        1,
        "[3] dashboard.present_testids: data-testid 'nightly-self-test-testid'",
    )

    def comment_only(t: Path) -> None:
        f = t / SRC / "pages/dashboard/next/nightly_self_test_probe.ts"
        f.write_text(
            "// nightly self-test comment-only sentence\n/*\n  nightly self-test block sentence\n*/\n"
            "export const x = 1 // nightly self-test trailing sentence\n",
            encoding="utf-8",
        )
        edit_manifest(
            lambda m: m["pages"][0]
            .setdefault("empty", [])
            .extend(
                [
                    "nightly self-test comment-only sentence",
                    "nightly self-test block sentence",
                    "nightly self-test trailing sentence",
                ]
            )
        )(t)

    for kind in ("comment-only", "block", "trailing"):
        mutate(
            f"a sentence found only in a {kind} comment",
            comment_only,
            1,
            f'"nightly self-test {kind} sentence" renders from no non-test source',
        )
    mutate(
        "a missing manifest",
        lambda t: (t / NIGHTLY / "manifest.json").unlink(),
        2,
        "CANNOT CHECK",
    )
    mutate(
        "MUDAVYM_PAGES that cannot be parsed",
        lambda t: (t / PAGES_TS).write_text(
            "export const PAGES = []\n", encoding="utf-8"
        ),
        2,
        "MUDAVYM_PAGES not found",
    )
    if failures:
        print(f"self-test: {failures} case(s) did not behave")
        return 1
    print("self-test: every case behaved")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    sys.exit(self_test() if args.self_test else main())
