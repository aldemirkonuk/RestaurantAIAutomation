#!/usr/bin/env python3
"""Scrub the nightly's upload set before it becomes a public artifact (ADR 0135).

WHY: the repository is public and the nightly uploads a 30-day artifact. Two
audits of PR #349 reproduced a credential reaching files: a bearer token through
Playwright's "Call log" (2026-09-17, B1) and the plaintext test password through
`error-context.md` and a failed `fill()` call log (2026-09-17, B2). The walk now
redacts at the source; this step is the fail-closed backstop for the files the
nightly actually produces: UTF-8 text, and gzip.

WHAT IT CANNOT DO, said plainly because the previous version of this docstring
got it wrong (corrected 2026-09-21, PR #349 adversarial pass): it reads BYTES.
A credential that a page RENDERS is pixels in a PNG and matches no regex here.
This docstring used to justify not reading binaries on the ground that
"apps/web/test-results is never copied" — `e2e-prod.yml` copies its `nightly/`
subtree, screenshots included, and always did. So for a PNG, a zip, or a UTF-16
log this scan now reports a `not_scanned` bucket rather than counting the file
clean; the byte scan still runs, so a credential sitting literally in PNG
metadata is still caught and the file deleted. The control that actually
protects a screenshot is the capture-time mask in `nightly.spec.ts`, which
blanks `[data-secret]` before the shutter. Adding a new binary class to the
upload means teaching this scan, or masking at the source, first.

WHAT: for each file under --dir:
  * text (UTF-8): the password value, JWT-shaped strings, `Bearer <token>` and
    `name: value` pairs for token / password / authorization / api-key / secret
    / cookie names are replaced in place — the same set lib.ts `redact()` uses,
    so the two halves of the suite cannot drift apart;
  * a file that does NOT decode cleanly (a truncated log, a gzip) is scanned
    lossily and by gzip-decompression, and DELETED if it carries a credential,
    because it cannot be rewritten safely. Deleted and redacted files are named
    in the log, in <dir>/scrub-report.json (inside the artifact) and in the job
    summary: evidence must never vanish quietly (this repo's
    absence-reported-as-health fault). The four-state summary runs BEFORE this
    step, so it cannot carry the deletion; the job-summary line is what a reader
    sees next to the verdict.
    The alternatives — refusing the whole upload, or zeroing the matched bytes —
    were rejected in ADR 0135: a lost screenshot must not cost the whole run's
    evidence, and a partially zeroed binary is still a file nobody can trust.
  * a symlink is never followed; its presence fails the step, because
    actions/upload-artifact would follow it out of the scrubbed set.
Then the whole set is scanned again. Anything left means nothing may upload.

EXIT CODES
    0  the set is clean (or the directory does not exist: nothing to upload)
    1  something survived the scrub, or a file could not be rewritten — the
       upload step must not run
    2  cannot check — no --dir, or E2E_TEST_PASSWORD is unset or too short to
       match, so "no password found" would mean "nothing was looked for"

Only names and counts are printed, never a matched value.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import tempfile
from pathlib import Path

JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")
BEARER = re.compile(r"(?i)(bearer\s+)(?!\[redacted\])[^\s\"',;]+")
# The same names lib.ts `redact()` covers; kept in step with it on purpose.
# The VALUE is replaced and the quotes around it are kept, so a redacted JSON
# file still parses (adversarial pass 2026-09-17).
SECRET_PAIR = re.compile(
    r"(?i)\b((?:access|refresh|id)?[_-]?token|password|passwd|authorization"
    r"|x-api-key|api[_-]?key|secret|cookie|set-cookie)\b([\"']?\s*[:=]\s*)"
    r"(?![\"']?\[redacted\])(?:([\"'])(?:[^\"']*)\3|[^\s,;]*?[\"'][^\"']*[\"']|[^\s,;\"']+)"
)
# user:password@host in a URL (amqp://, postgres://): the password half only.
URL_USERINFO = re.compile(
    r"(?i)([a-z][a-z0-9+.-]*://[^\s:/@]+:)(?!\[redacted\]@)[^\s@/]+(@)"
)


def redact_text(text: str, password: str | None) -> str:
    out = JWT.sub("[redacted-jwt]", text)
    out = BEARER.sub(r"\1[redacted]", out)
    out = SECRET_PAIR.sub(
        lambda m: f"{m.group(1)}{m.group(2)}{m.group(3) or ''}[redacted]{m.group(3) or ''}",
        out,
    )
    out = URL_USERINFO.sub(r"\1[redacted]\2", out)
    if password:
        out = out.replace(password, "[redacted]")
    return out


def _scannable(data: bytes) -> str:
    """Everything worth scanning in a file, whether or not it decodes cleanly."""
    text = data.decode("utf-8", errors="replace")
    if data[:2] == b"\x1f\x8b":  # gzip: a compressed log hides its own bytes
        try:
            text += gzip.decompress(data).decode("utf-8", errors="replace")
        except Exception:  # a broken gzip is scanned as raw bytes above
            pass
    return text


# Container and picture magic numbers. A file starting with one of these holds
# no scannable text at all: its payload is pixels or a compressed member this
# scan does not open. gzip is deliberately ABSENT -- `_scannable` decompresses
# it, so a gzipped log IS scanned and must not land in `not_scanned`.
_OPAQUE_MAGIC = (
    b"\x89PNG\r\n\x1a\n",  # PNG  -- the nightly's page screenshots
    b"\xff\xd8\xff",         # JPEG
    b"GIF87a",
    b"GIF89a",
    b"RIFF",                   # WebP / WAV container
    b"PK\x03\x04",            # zip -- a Playwright trace, off today
    b"\x00\x00\x00\x18ftyp",  # MP4 -- video, off today
    b"\x00\x00\x00\x1cftyp",
    b"\xff\xfe",              # UTF-16 LE BOM
    b"\xfe\xff",              # UTF-16 BE BOM
)


def _unscannable(data: bytes) -> bool:
    """True when this scan provably cannot read the file's content.

    Not the same question as "does it leak". A PNG of a page that renders a
    token carries that token as PIXELS: every regex here misses it and the file
    would otherwise be counted clean. Saying "I did not read this" is the honest
    answer, and it is what lets the capture-time mask be audited rather than
    assumed.
    """
    return data.startswith(_OPAQUE_MAGIC)


def _leaks(data: bytes, password: str | None) -> bool:
    # The password is looked for in the SCANNABLE text as well as the raw bytes:
    # a gzipped error-context.md hides it from a byte search, and its aria shape
    # (`textbox "Password" [ref=e7]: <pw>`) matches none of the regexes
    # (adversarial pass 2026-09-17, B3).
    text = _scannable(data)
    if password and (password.encode("utf-8") in data or password in text):
        return True
    return bool(
        JWT.search(text)
        or BEARER.search(text)
        or SECRET_PAIR.search(text)
        or URL_USERINFO.search(text)
    )


def scrub(root: Path, password: str | None) -> dict[str, list[str]]:
    """Return what was redacted, deleted, refused and left leaking — by name."""
    report: dict[str, list[str]] = {
        "redacted": [],
        "deleted": [],
        "symlinks": [],
        "still_leaking": [],
        "not_scanned": [],
    }
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            # upload-artifact follows a symlinked directory out of this set.
            report["symlinks"].append(str(path.relative_to(root)))
            continue
        if not path.is_file():
            continue
        data = path.read_bytes()
        if _unscannable(data):
            # A picture, a zip, a UTF-16 log. The byte scan below STILL runs --
            # a credential sitting literally in PNG metadata is caught and the
            # file deleted, exactly as before. What this bucket records is that
            # a clean result here is not authoritative: `_leaks()` reads bytes,
            # and a token DRAWN as glyphs matches nothing. Such a file would
            # otherwise be counted clean, which is this repo's
            # absence-reported-as-health fault committed by the guard built to
            # stop it.
            #
            # It does not fail the step. A screenshot is the run's evidence, and
            # the control that actually protects it runs earlier, at capture
            # time: nightly.spec.ts masks `[data-secret]` before the shutter.
            # This bucket is what makes that earlier control auditable rather
            # than assumed -- a reader sees "12 files this scan cannot read"
            # next to the verdict instead of silence.
            report["not_scanned"].append(str(path.relative_to(root)))
        if not _leaks(data, password):
            continue
        name = str(path.relative_to(root))
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            # Cannot be rewritten safely (a truncated log, a compressed one, an
            # image): it goes, and it is named.
            path.unlink()
            report["deleted"].append(name)
            continue
        try:
            path.write_text(redact_text(text, password), encoding="utf-8")
            report["redacted"].append(name)
        except OSError:
            pass  # the rescan below reports it
    report["still_leaking"] = [
        str(p.relative_to(root))
        for p in sorted(root.rglob("*"))
        if p.is_file() and not p.is_symlink() and _leaks(p.read_bytes(), password)
    ]
    return report


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
    if not password or len(password) < 4:
        # "No password found" would mean "nothing was looked for" — the repo's
        # own cross-cutting fault. Refuse instead (re-audit 2026-09-17, N3).
        print(
            "CANNOT CHECK — E2E_TEST_PASSWORD is unset or shorter than 4 characters, "
            "so this step cannot tell a clean set from an unscanned one; nothing uploads"
        )
        return 2
    worst = 0
    for d in args.dir:
        root = Path(d)
        if not root.is_dir():
            print(f"{d}: does not exist — nothing to upload from it")
            continue
        report = scrub(root, password)
        print(
            f"{d}: {len(report['redacted'])} file(s) redacted, "
            f"{len(report['deleted'])} file(s) deleted, "
            f"{len(report['symlinks'])} symlink(s), "
            f"{len(report['not_scanned'])} file(s) this scan cannot read, "
            f"{len(report['still_leaking'])} still carrying a credential"
        )
        for key in ("redacted", "deleted", "symlinks", "not_scanned"):
            if report[key]:
                print(f"  {key}: " + ", ".join(report[key]))
        try:
            (root / "scrub-report.json").write_text(
                json.dumps(report, indent=2) + "\n", encoding="utf-8"
            )
        except OSError as e:
            print(f"  could not write scrub-report.json: {e.strerror}")
            worst = 1
        step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if step_summary and (
            report["deleted"]
            or report["still_leaking"]
            or report["symlinks"]
            or report["not_scanned"]
        ):
            # A file removed from the evidence is named where the run is read,
            # not only in a log line nobody opens.
            with open(step_summary, "a", encoding="utf-8") as fh:
                fh.write(
                    f"\n**Artifact scrub ({d}):** {len(report['deleted'])} file(s) deleted"
                    f" ({', '.join(report['deleted']) or 'none'}), "
                    f"{len(report['still_leaking'])} still leaking, "
                    f"{len(report['symlinks'])} symlink(s), "
                    f"{len(report['not_scanned'])} not readable by this scan "
                    f"(masked at capture, not scanned here).\n"
                )
        if report["still_leaking"]:
            print(
                "FAIL — refusing to upload; still leaking: "
                + ", ".join(report["still_leaking"])
            )
            worst = 1
        if report["symlinks"]:
            print(
                "FAIL — refusing to upload; a symlink leaves the scrubbed set: "
                + ", ".join(report["symlinks"])
            )
            worst = 1
    return worst


def self_test() -> int:
    pw = "PW_SENTINEL_self_test_9"
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWxmLXRlc3QifQ.c2lnbmF0dXJlLXNlbGY"
    failures = 0

    def case(label: str, ok: bool) -> None:
        nonlocal failures
        failures += 0 if ok else 1
        print(f"self-test {'ok  ' if ok else 'FAIL'} {label}")

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "nightly").mkdir()
        (root / "nightly" / "error-context.md").write_text(
            f'- textbox "Password" [ref=e7]: {pw}\n', encoding="utf-8"
        )
        (root / "wave_f.xml").write_text(
            f"<failure>authorization: Bearer {jwt}</failure>", encoding="utf-8"
        )
        # A bare JWT with no Bearer and no secret-named key in front, so the JWT
        # rule alone is what has to catch it.
        (root / "wave_h.log").write_text(
            f"the walk saw {jwt} in a body\n", encoding="utf-8"
        )
        # Names lib.ts redacts that the scrub used to miss entirely.
        (root / "cascading_report.md").write_text(
            "x-api-key: ADMINKEY_SENTINEL_r3\nrefresh_token: REFRESH_SENTINEL_r3\n",
            encoding="utf-8",
        )
        # A truncated log: it does not decode, and used to be reported clean.
        (root / "wave_a.log").write_bytes(
            b"\xff\xfe authorization: Bearer " + jwt.encode()
        )
        (root / "shot.png").write_bytes(b"\x89PNG\r\n\x1a\n" + pw.encode() + b"\x00")
        # A gzipped log: `_scannable` DOES decompress it, so it must be scanned
        # and redacted-or-deleted like any text, never filed as unreadable.
        (root / "wave_b.log.gz").write_bytes(
            gzip.compress(f"authorization: Bearer {jwt}\n".encode())
        )
        (root / "clean.md").write_text("nothing secret here\n", encoding="utf-8")
        report = scrub(root, pw)
        case("the four text files are redacted", len(report["redacted"]) == 4)
        case(
            "the three undecodable files are deleted and named",
            sorted(report["deleted"])
            == ["shot.png", "wave_a.log", "wave_b.log.gz"],
        )
        case("nothing is left leaking", report["still_leaking"] == [])
        case(
            "the clean file is untouched",
            (root / "clean.md").read_text() == "nothing secret here\n",
        )
        case(
            "the password is gone",
            pw not in (root / "nightly" / "error-context.md").read_text(),
        )
        case("a bare JWT is gone", jwt not in (root / "wave_h.log").read_text())
        case(
            "an api key and a refresh token are gone",
            "ADMINKEY_SENTINEL_r3" not in (root / "cascading_report.md").read_text()
            and "REFRESH_SENTINEL_r3" not in (root / "cascading_report.md").read_text(),
        )
        # The screenshot class. `shot.png` above carries the password in its
        # raw bytes, so it is deleted AND named as unreadable; a PNG whose
        # credential is only RENDERED would match nothing, survive, and be
        # reported clean -- which is why "not scanned" has to be said out loud.
        case(
            "the opaque files are named as ones this scan cannot read",
            sorted(report["not_scanned"]) == ["shot.png", "wave_a.log"],
        )
        case(
            "a gzip is NOT called unreadable -- _scannable decompresses it",
            "wave_b.log.gz" not in report["not_scanned"],
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        import gzip as _gzip

        (root / "wave_h.log.gz").write_bytes(_gzip.compress(f"Bearer {jwt}".encode()))
        report = scrub(root, pw)
        case(
            "a gzip carrying a token is deleted", report["deleted"] == ["wave_h.log.gz"]
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        outside = Path(tmp).parent / "scrub-self-test-outside.txt"
        outside.write_text("untouched\n", encoding="utf-8")
        (root / "link.txt").symlink_to(outside)
        report = scrub(root, pw)
        case("a symlink is refused, not followed", report["symlinks"] == ["link.txt"])
        case(
            "the file behind the symlink is untouched",
            outside.read_text() == "untouched\n",
        )
        outside.unlink()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        f = root / "locked.md"
        f.write_text(pw, encoding="utf-8")
        f.chmod(0o444)
        root.chmod(0o555)
        try:
            report = scrub(root, pw)
            ok = report["still_leaking"] == ["locked.md"] or os.geteuid() == 0
        finally:
            root.chmod(0o755)
            f.chmod(0o644)
        case(
            "a file that cannot be rewritten is reported, so the upload is refused", ok
        )

    import contextlib
    import io

    # main() itself, not just scrub(): the step's exit code is the fail-closed
    # gate, and deleting `worst = 1` used to leave every case green
    # (adversarial pass 2026-09-17).
    def run_main(build) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build(root)
            os.environ["E2E_TEST_PASSWORD"] = pw
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    return main(["--dir", str(root)])
            finally:
                os.environ.pop("E2E_TEST_PASSWORD", None)

    def unwritable(root: Path) -> None:
        # The FILE is unwritable, the directory is not: the exit code must come
        # from the surviving credential, not from a failed report write.
        f = root / "locked.md"
        f.write_text(pw, encoding="utf-8")
        f.chmod(0o444)

    got = run_main(unwritable)
    case(
        f"main() exits 1 when a credential survives (exit {got})",
        got == 1 or os.geteuid() == 0,
    )

    def with_symlink(root: Path) -> None:
        (root / "link.txt").symlink_to(root.parent / "nowhere.txt")

    got = run_main(with_symlink)
    case(f"main() exits 1 on a symlink (exit {got})", got == 1)

    def gzipped_password(root: Path) -> None:
        import gzip as _g

        (root / "error-context.md.gz").write_bytes(
            _g.compress(f'- textbox "Password" [ref=e7]: {pw}\n'.encode())
        )

    got = run_main(gzipped_password)
    case(
        f"a gzipped error-context leaves the step clean once deleted (exit {got})",
        got == 0,
    )
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        gzipped_password(root)
        report = scrub(root, pw)
        case(
            "and it is named as deleted, not reported clean",
            report["deleted"] == ["error-context.md.gz"]
            and report["still_leaking"] == [],
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "x.json").write_text(
            '{"x-api-key":"ADMINKEY_SENTINEL_adv","ok":1}', encoding="utf-8"
        )
        (root / "wave_c.xml").write_text(
            "<failure>amqp://user:RABBITPASS_SENTINEL@rabbit:5672 refused</failure>",
            encoding="utf-8",
        )
        report = scrub(root, pw)
        body = (root / "x.json").read_text(encoding="utf-8")
        case(
            "a quoted key is redacted and the JSON still parses",
            "ADMINKEY_SENTINEL_adv" not in body and json.loads(body)["ok"] == 1,
        )
        case(
            "a password inside a URL is redacted",
            "RABBITPASS_SENTINEL"
            not in (root / "wave_c.xml").read_text(encoding="utf-8")
            and report["still_leaking"] == [],
        )

    # The two channels that replaced the false "the summary reads it" claim are
    # themselves checked (adversarial pass 2026-09-17, N2).
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        summary = root / "step-summary.md"
        summary.write_text("", encoding="utf-8")
        gzipped_password(root)
        os.environ["E2E_TEST_PASSWORD"] = pw
        os.environ["GITHUB_STEP_SUMMARY"] = str(summary)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                main(["--dir", str(root)])
        finally:
            os.environ.pop("E2E_TEST_PASSWORD", None)
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
        written = json.loads((root / "scrub-report.json").read_text(encoding="utf-8"))
        case(
            "scrub-report.json names the deleted file",
            written["deleted"] == ["error-context.md.gz"],
        )
        case(
            "the job summary says a file was deleted",
            "error-context.md.gz" in summary.read_text(encoding="utf-8"),
        )

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "x.md").write_text(
            'set-cookie: sb-token="VALUE_SENTINEL_adv"', encoding="utf-8"
        )
        report = scrub(root, pw)
        case(
            "a value that starts unquoted and then quotes is fully redacted",
            "VALUE_SENTINEL_adv" not in (root / "x.md").read_text(encoding="utf-8")
            and report["still_leaking"] == [],
        )

    for label, env, want in (
        ("an unset password is cannot_check", {}, 2),
        ("a 3-character password is cannot_check", {"E2E_TEST_PASSWORD": "abc"}, 2),
    ):
        before = os.environ.pop("E2E_TEST_PASSWORD", None)
        os.environ.update(env)
        try:
            with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(
                io.StringIO()
            ):
                got = main(["--dir", tmp])
        finally:
            os.environ.pop("E2E_TEST_PASSWORD", None)
            if before is not None:
                os.environ["E2E_TEST_PASSWORD"] = before
        case(f"{label} (exit {got})", got == want)

    print(
        "self-test: every case behaved"
        if not failures
        else f"self-test: {failures} case(s) failed"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
