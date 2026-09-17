#!/usr/bin/env python3
"""Scrub the nightly's upload set before it becomes a public artifact (ADR 0135).

WHY: the repository is public and the nightly uploads a 30-day artifact. Two
audits of PR #349 reproduced a credential reaching files: a bearer token through
Playwright's "Call log" (2026-09-17, B1) and the plaintext test password through
`error-context.md` and a failed `fill()` call log (2026-09-17, B2). The walk now
redacts at the source; this step is the fail-closed backstop for every file,
whoever wrote it.

WHAT: for each file under --dir:
  * text (UTF-8): the value of E2E_TEST_PASSWORD, JWT-shaped strings and
    `Bearer <token>` are replaced in place;
  * binary: a file whose bytes contain the password is deleted.
Then the whole set is scanned again. Anything left means nothing may upload.

EXIT CODES
    0  the set is clean (or the directory does not exist: nothing to upload)
    1  something survived the scrub, or a file could not be rewritten — the
       upload step must not run
    2  cannot check (argument error)

Only names and counts are printed, never a matched value.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
BEARER = re.compile(r"(?i)(bearer\s+)(?!\[redacted\])[^\s\"',;]+")


def redact_text(text: str, password: str | None) -> str:
    out = JWT.sub("[redacted-jwt]", text)
    out = BEARER.sub(r"\1[redacted]", out)
    if password:
        out = out.replace(password, "[redacted]")
    return out


def _leaks(data: bytes, password: str | None) -> bool:
    if password and password.encode("utf-8") in data:
        return True
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return bool(JWT.search(text) or BEARER.search(text))


def scrub(root: Path, password: str | None) -> tuple[int, int, list[str]]:
    """Return (files rewritten, files deleted, files still leaking)."""
    rewritten = deleted = 0
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        data = path.read_bytes()
        if not _leaks(data, password):
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            path.unlink()
            deleted += 1
            continue
        try:
            path.write_text(redact_text(text, password), encoding="utf-8")
            rewritten += 1
        except OSError:
            pass  # the rescan below reports it
    remaining = [
        str(p.relative_to(root))
        for p in sorted(root.rglob("*"))
        if p.is_file() and _leaks(p.read_bytes(), password)
    ]
    return rewritten, deleted, remaining


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dir", action="append", default=[])
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.dir:
        print("CANNOT CHECK — no --dir given")
        return 2
    password = os.environ.get("E2E_TEST_PASSWORD") or None
    if password and len(password) < 4:
        password = None  # too short to match safely; JWT/bearer rules still run
    worst = 0
    for d in args.dir:
        root = Path(d)
        if not root.is_dir():
            print(f"{d}: does not exist — nothing to upload from it")
            continue
        rewritten, deleted, remaining = scrub(root, password)
        print(
            f"{d}: {rewritten} file(s) redacted, {deleted} binary file(s) deleted, "
            f"{len(remaining)} still carrying a credential"
        )
        if remaining:
            print("FAIL — refusing to upload; still leaking: " + ", ".join(remaining))
            worst = 1
    return worst


def self_test() -> int:
    pw = "PW_SENTINEL_self_test_9"
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWxmLXRlc3QifQ.c2lnbmF0dXJlLXNlbGY"
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "nightly").mkdir()
        (root / "nightly" / "error-context.md").write_text(
            f'- textbox "Password" [ref=e7]: {pw}\n', encoding="utf-8"
        )
        (root / "wave_f.xml").write_text(
            f"<failure>authorization: Bearer {jwt}</failure>", encoding="utf-8"
        )
        (root / "clean.md").write_text("nothing secret here\n", encoding="utf-8")
        (root / "shot.png").write_bytes(b"\x89PNG\x00\xff" + pw.encode() + b"\x00")
        rewritten, deleted, remaining = scrub(root, pw)
        checks = [
            ("two text files redacted", rewritten == 2),
            ("the binary carrying the password deleted", deleted == 1),
            ("nothing left", remaining == []),
            (
                "clean file untouched",
                (root / "clean.md").read_text() == "nothing secret here\n",
            ),
            (
                "password gone from error-context.md",
                pw not in (root / "nightly" / "error-context.md").read_text(),
            ),
            ("jwt gone from wave_f.xml", jwt not in (root / "wave_f.xml").read_text()),
        ]
        for label, ok in checks:
            failures += 0 if ok else 1
            print(f"self-test {'ok  ' if ok else 'FAIL'} {label}")
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        f = root / "locked.md"
        f.write_text(pw, encoding="utf-8")
        f.chmod(0o444)
        root.chmod(0o555)
        try:
            _, _, remaining = scrub(root, pw)
            ok = remaining == ["locked.md"] or os.geteuid() == 0
        finally:
            root.chmod(0o755)
            f.chmod(0o644)
        failures += 0 if ok else 1
        print(
            f"self-test {'ok  ' if ok else 'FAIL'} a file that cannot be rewritten is reported, so the upload is refused"
        )
    print(
        "self-test: every case behaved"
        if not failures
        else f"self-test: {failures} case(s) failed"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
