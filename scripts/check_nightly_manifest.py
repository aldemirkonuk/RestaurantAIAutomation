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
  7. No file under e2e/nightly (subdirectories included) makes a
     `request.<method>(` or `request[` call except lib.ts's `gateway()`
     wrapper, whose errors are redacted (a Playwright call log carries the
     bearer token). A text match: a renamed variable escapes it.

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
    """Non-test web source, whitespace-collapsed, with a map back to the raw text.

    Comments are masked by CHARACTER, not by line: a sentence counts only when
    none of it sits inside a /* */ block or after a // on its line. A `/*` or
    `//` counts as a comment opener only where code could start one — not
    inside `accept="image/*"` or a URL (audit 2026-09-17, correctness 5).
    """

    def __init__(self, root: Path) -> None:
        self.files: list[tuple[str, str, list[int], str, list[bool]]] = []
        for p in sorted((root / SRC).rglob("*")):
            if p.suffix not in (".ts", ".tsx") or not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if re.search(r"\.(test|spec|stories)\.tsx?$", rel) or "/__tests__/" in rel:
                continue
            raw = p.read_text(encoding="utf-8", errors="replace")
            in_comment = comment_mask(raw)
            flat: list[str] = []
            raw_of: list[int] = []
            prev_space = False
            for i, ch in enumerate(raw):
                ch = "'" if ch in "\u2018\u2019" else ch
                if ch.isspace():
                    if prev_space:
                        continue
                    ch, prev_space = " ", True
                else:
                    prev_space = False
                flat.append(ch.lower())
                raw_of.append(i)
            self.files.append((rel, "".join(flat), raw_of, raw, in_comment))
        if not self.files:
            raise CannotCheck(f"{SRC} scanned to zero source files")

    def find(self, phrase: str, within: tuple[str, ...] = ()) -> tuple[bool, list[str]]:
        """(rendered somewhere, comment-only hits) for one phrase, optionally inside some directories."""
        needle = norm(phrase)
        comment_hits: list[str] = []
        for rel, flat, raw_of, raw, in_comment in self.files:
            if within and not rel.startswith(within):
                continue
            start = flat.find(needle)
            while start != -1:
                a, b = raw_of[start], raw_of[start + len(needle) - 1]
                if not any(in_comment[a : b + 1]):
                    return True, []
                comment_hits.append(f"{rel}:{raw.count(chr(10), 0, a) + 1}")
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


BLOCK_OPEN = re.compile(r"(?:^|(?<=[\s{(,;=:)}\]]))/\*", re.M)
LINE_OPEN = re.compile(r"(?:^|(?<=[\s{(,;=)}\]]))//", re.M)


def comment_mask(raw: str) -> list[bool]:
    """True for every character inside a comment a code position could open."""
    mask = [False] * len(raw)
    pos = 0
    b = BLOCK_OPEN.search(raw, pos)
    l = LINE_OPEN.search(raw, pos)
    while b or l:
        m = b if (b and (not l or b.start() <= l.start())) else l
        if m is b:
            end = raw.find("*/", m.end())
            end = len(raw) if end == -1 else end + 2
        else:
            end = raw.find("\n", m.end())
            end = len(raw) if end == -1 else end
        mask[m.start() : end] = [True] * (end - m.start())
        pos = end
        # Re-search a pattern only when its cached match was swallowed; the
        # naive loop re-scanned whole files per comment and took minutes.
        if b and b.start() < pos:
            b = BLOCK_OPEN.search(raw, pos)
        if l and l.start() < pos:
            l = LINE_OPEN.search(raw, pos)
    return mask


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
    try:
        registry = (root / REGISTRY_TS).read_text(encoding="utf-8")
        app = (root / APP_TSX).read_text(encoding="utf-8")
    except OSError as e:
        raise CannotCheck(f"cannot read {e.filename}: {e.strerror}")
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
        sentences("shared_phrases", key, shared.get(key, []))
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

    # 7. No raw gateway call outside lib.ts `gateway()` (audit 2026-09-17, B1):
    #    a Playwright request error's call log carries the bearer token.
    raw_call = re.compile(r"\brequest(?:\.(get|post|put|patch|delete|fetch|head)\(|\[)")
    for f in sorted((root / NIGHTLY).rglob("*.ts")):
        text = f.read_text(encoding="utf-8")
        if f.name == "lib.ts":
            start = text.find("export async function gateway(")
            end = text.find("\n}\n", start)
            if start == -1 or end == -1:
                problems.append(
                    "[7] lib.ts has no `export async function gateway(` — the only allowed gateway caller is gone"
                )
            else:
                text = text[:start] + text[end:]
        for m in raw_call.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            problems.append(
                f"[7] {f.relative_to(root).as_posix()}:{line}: raw `{m.group(0)}` — call the gateway through lib.ts gateway(), which redacts the error"
            )

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
        "[1] MUDAVYM_PAGES enrols 'admin'",
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

    def raw_request(t: Path) -> None:
        f = t / NIGHTLY / "nightly.spec.ts"
        f.write_text(
            f.read_text(encoding="utf-8")
            + "\nexport async function leak(request: any) { return request.get('x') }\n",
            encoding="utf-8",
        )

    mutate(
        "a raw gateway call outside gateway()",
        raw_request,
        1,
        "[7] apps/web/e2e/nightly/nightly.spec.ts",
    )

    def slash_star_in_string(t: Path) -> None:
        f = t / SRC / "pages/dashboard/next/nightly_self_test_probe.tsx"
        f.write_text(
            'export const P = () => <><input accept="image/*" /><p>nightly self-test rendered after a string</p></>\n'
            "/* a later real comment */\n",
            encoding="utf-8",
        )
        edit_manifest(
            lambda m: m["pages"][0]
            .setdefault("empty", [])
            .append("nightly self-test rendered after a string")
        )(t)

    mutate(
        "a rendered sentence after `image/*` in a string",
        slash_star_in_string,
        0,
        "PASS",
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
