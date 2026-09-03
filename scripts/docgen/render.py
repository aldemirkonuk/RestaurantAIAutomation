"""Jinja2 -> HTML -> headless Chrome -> PDF/PNG.

Chrome rather than WeasyPrint. `weasyprint>=60.0` is declared in
services/agent-orchestrator/requirements.txt but its native cairo/pango
libraries do not load on macOS without a Homebrew chain, and more importantly
the HTML/CSS Chrome consumes is the *same* template family the product renders
on screen. One toolchain covers the synthetic dataset and the real WineOps
document; two toolchains would drift.

Every rendered artifact is marked SYNTHETIC. That is not configurable — see
decision D3/§4.4 in .planning/SYNTHETIC_DATA_AND_DOCS_PLAN.md. These files are
test fixtures and must never be mistakable for a genuine commercial document.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path
from typing import Any

from jinja2 import (
    Environment,
    FileSystemLoader,
    StrictUndefined,
    select_autoescape,
)

TEMPLATE_DIR = Path(__file__).parent / "templates"

#: Checked in order. The first that exists wins.
_CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "google-chrome",
    "chromium",
    "chromium-browser",
)

SYNTHETIC_MARK = "SYNTHETIC — NOT A GENUINE COMMERCIAL DOCUMENT"


class ChromeNotFoundError(RuntimeError):
    pass


def find_chrome() -> str:
    for candidate in _CHROME_CANDIDATES:
        if candidate.startswith("/"):
            if Path(candidate).exists():
                return candidate
        else:
            found = shutil.which(candidate)
            if found:
                return found
    raise ChromeNotFoundError(
        "No Chrome/Chromium found. Install Google Chrome, or set one of: "
        + ", ".join(_CHROME_CANDIDATES)
    )


def _env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        # autoescape: these templates interpolate invoice data — producer
        # names, wine names, addresses, line-item descriptions — straight into
        # HTML that Chrome then renders to PDF. Without escaping, a value
        # containing `<` or `&` produces broken markup at best, and injected
        # markup into the rendered document at worst; the renderer executing
        # attacker-authored script during PDF generation is a much larger
        # problem than a mangled invoice.
        #
        # Safe to switch on: no template in scripts/docgen/templates/ uses the
        # `|safe` filter or Markup, so nothing here depends on a variable
        # carrying raw HTML through.
        autoescape=select_autoescape(["html", "xml"]),
        # StrictUndefined: a template that references a field the composer does
        # not produce should fail loudly at generation time, not silently render
        # an invoice with a blank where a quantity belongs.
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["money"] = lambda v: f"{float(v):,.2f}" if v is not None else ""
    env.filters["qty"] = lambda v: "" if v is None else f"{v:g}"
    env.filters["dash"] = lambda v: "—" if v in (None, "") else v

    def _fmt_date(d: Any, fmt: str) -> str:
        if d is None:
            return ""
        if isinstance(d, str):
            return d
        return d.strftime(fmt)

    env.filters["fmtdate"] = _fmt_date

    def _upper_if(text: Any, flag: bool) -> str:
        s = "" if text is None else str(text)
        return s.upper() if flag else s

    env.filters["upper_if"] = _upper_if

    def _truncate_at(text: Any, limit: int | None) -> str:
        s = "" if text is None else str(text)
        if limit is None or len(s) <= limit:
            return s
        return s[: limit - 1].rstrip() + "…"

    env.filters["truncate_at"] = _truncate_at
    return env


def render_html(template: str, context: dict[str, Any]) -> str:
    """Render a template to an HTML string, with the synthetic mark forced in."""
    ctx = dict(context)
    ctx["SYNTHETIC_MARK"] = SYNTHETIC_MARK
    ctx.setdefault("generated_on", date.today())
    return _env().get_template(template).render(**ctx)


#: Flags shared by both output modes.
#
# Deliberately NOT here: `--user-data-dir`. Pointing Chrome at a fresh profile
# directory makes it run first-run setup, which never completes headless and
# hangs until the subprocess timeout fires. Also omitted:
# `--run-all-compositor-stages-before-draw`, which is only useful for animated
# content and adds another way to stall on a static page.
_BASE_FLAGS = (
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--disable-extensions",
)


def _run_chrome(args: list[str], timeout: int = 60) -> None:
    proc = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    # Chrome exits 0 on success but is noisy on stderr; only treat a non-zero
    # exit or a missing output file as failure (checked by the caller).
    if proc.returncode != 0:
        raise RuntimeError(
            f"Chrome failed (exit {proc.returncode}).\n"
            f"stderr tail: {proc.stderr[-800:]}"
        )


def html_to_pdf(html: str, out_pdf: Path, *, chrome: str | None = None) -> Path:
    chrome = chrome or find_chrome()
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "doc.html"
        src.write_text(html, encoding="utf-8")
        _run_chrome(
            [
                chrome,
                *_BASE_FLAGS,
                "--no-pdf-header-footer",
                f"--print-to-pdf={out_pdf}",
                src.as_uri(),
            ]
        )
    if not out_pdf.exists() or out_pdf.stat().st_size == 0:
        raise RuntimeError(f"Chrome produced no PDF at {out_pdf}")
    return out_pdf


def html_to_png(
    html: str,
    out_png: Path,
    *,
    width: int = 1240,  # A4 at 150dpi — the resolution a phone photo lands at
    height: int = 1754,
    chrome: str | None = None,
) -> Path:
    chrome = chrome or find_chrome()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "doc.html"
        src.write_text(html, encoding="utf-8")
        _run_chrome(
            [
                chrome,
                *_BASE_FLAGS,
                "--hide-scrollbars",
                f"--window-size={width},{height}",
                f"--screenshot={out_png}",
                src.as_uri(),
            ]
        )
    if not out_png.exists() or out_png.stat().st_size == 0:
        raise RuntimeError(f"Chrome produced no PNG at {out_png}")
    return out_png
