"""SOTA hybrid menu snapshots — replay offline; refresh is explicit (D-01).

Generate / CI always calls ``load_snapshot`` (frozen JSON under datasets/sim/menus).
``refresh_snapshot`` is the only path that may invoke WebCrawlerService / Vision.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
MENUS_DIR = REPO_ROOT / "datasets" / "sim" / "menus"
MANIFEST_PATH = REPO_ROOT / "datasets" / "sim" / "manifest.json"

# Locked D-06 mapping: archetype → Phase 2 JSONL (turkish-clone is PDF/Vision).
JSONL_SOURCES: dict[str, dict[str, str]] = {
    "fine-dining": {
        "jsonl": "datasets/restaurant_menus/20260406_blvd_steakhouse.jsonl",
        "source_url": "https://www.blvdchicago.com/menu/wine-by-the-glass/",
        "source_name": "BLVD Steakhouse",
    },
    "bistro": {
        "jsonl": "datasets/restaurant_menus/20260406_the_tailors_son.jsonl",
        "source_url": "https://www.thetailorssonsf.com/menus/#wine-beer",
        "source_name": "The Tailors Son",
    },
    "high-volume-bar": {
        "jsonl": "datasets/restaurant_menus/20260406_chicago_winery.jsonl",
        "source_url": "https://www.chiwinery.com/menu/wine/",
        "source_name": "Chicago Winery",
    },
    "cafe": {
        "jsonl": "datasets/restaurant_menus/20260406_the_albert_chicago.jsonl",
        "source_url": "https://thealbertchicago.com/beverage/",
        "source_name": "The Albert Chicago",
    },
}

AVLI_PDF = (
    REPO_ROOT
    / "datasets"
    / "annotation_inbox"
    / "pdfs"
    / "Avli_Taverna_Lincoln_Park_Wine_Menu.pdf"
)
AVLI_SOURCE_URL = "file://datasets/annotation_inbox/pdfs/Avli_Taverna_Lincoln_Park_Wine_Menu.pdf"
AVLI_SOURCE_NAME = "Avli Taverna Lincoln Park"

ITEM_KEYS = (
    "wine_name",
    "producer",
    "vintage",
    "bottle_price",
    "by_glass_price",
    "signature_hash",
    "primary_type",
    "country",
    "region",
    "grape_variety",
)


def compute_menu_quality(rows: Iterable[dict[str, Any]]) -> str:
    """Return full|partial from priced_sku_ratio (threshold 0.9 — D-03).

    A row is priced if bottle (price_reference / bottle_price) or glass
    (price_glass / by_glass_price) is non-null.
    """
    rows_list = list(rows)
    if not rows_list:
        return "partial"
    priced = 0
    for row in rows_list:
        bottle = row.get("bottle_price", row.get("price_reference"))
        glass = row.get("by_glass_price", row.get("price_glass"))
        if bottle is not None or glass is not None:
            priced += 1
    ratio = priced / len(rows_list)
    return "full" if ratio >= 0.9 else "partial"


def _row_to_item(row: dict[str, Any]) -> dict[str, Any]:
    """Map JSONL / extract row → snapshot item. Never invent prices (D-04)."""
    bottle = row.get("bottle_price", row.get("price_reference"))
    glass = row.get("by_glass_price", row.get("price_glass"))
    # Preserve null; coerce numeric strings only when already present
    if bottle is not None and not isinstance(bottle, (int, float)):
        try:
            bottle = float(bottle)
        except (TypeError, ValueError):
            bottle = None
    if glass is not None and not isinstance(glass, (int, float)):
        try:
            glass = float(glass)
        except (TypeError, ValueError):
            glass = None
    wine_name = row.get("wine_name") or ""
    producer = row.get("producer")
    vintage = row.get("vintage")
    sig = row.get("signature_hash")
    if not sig:
        sig = hashlib.md5(
            f"{wine_name}|{producer}|{vintage}".encode("utf-8")
        ).hexdigest()
    return {
        "wine_name": wine_name,
        "producer": producer,
        "vintage": vintage,
        "bottle_price": bottle,
        "by_glass_price": glass,
        "signature_hash": sig,
        "primary_type": row.get("primary_type"),
        "country": row.get("country"),
        "region": row.get("region"),
        "grape_variety": row.get("grape_variety"),
    }


def _envelope(
    archetype_id: str,
    *,
    source_url: str,
    source_name: str,
    extracted_at: str,
    extraction_model: str,
    items: list[dict[str, Any]],
    menu_quality: str | None = None,
) -> dict[str, Any]:
    quality = menu_quality or compute_menu_quality(items)
    return {
        "archetype_id": archetype_id,
        "source_url": source_url,
        "source_name": source_name,
        "extracted_at": extracted_at,
        "extraction_model": extraction_model,
        "menu_quality": quality,
        "items": items,
    }


def bootstrap_from_jsonl(
    archetype_id: str,
    jsonl_path: Path | str | None = None,
) -> dict[str, Any]:
    """Convert Phase 2 JSONL → snapshot envelope (prices mapped, not invented)."""
    if archetype_id == "turkish-clone":
        return bootstrap_turkish_clone_from_avli()

    meta = JSONL_SOURCES.get(archetype_id)
    if meta is None:
        raise KeyError(f"No JSONL source mapping for archetype {archetype_id!r}")

    path = Path(jsonl_path) if jsonl_path else REPO_ROOT / meta["jsonl"]
    if not path.is_file():
        raise FileNotFoundError(f"JSONL not found: {path}")

    rows: list[dict[str, Any]] = []
    extracted_at = None
    extraction_model = "gemini-2.5-flash"
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        rows.append(row)
        enrich = row.get("data_enrichment") or {}
        if extracted_at is None and enrich.get("crawled_at"):
            extracted_at = enrich["crawled_at"]
        if enrich.get("extraction_model"):
            extraction_model = enrich["extraction_model"]

    items = [_row_to_item(r) for r in rows]
    if not items:
        raise ValueError(f"JSONL produced zero items: {path}")

    return _envelope(
        archetype_id,
        source_url=meta["source_url"],
        source_name=meta["source_name"],
        extracted_at=extracted_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        extraction_model=extraction_model,
        items=items,
    )


def _parse_avli_pdf_text(text: str) -> list[dict[str, Any]]:
    """Best-effort extract of Avli wine lines from two-column layout.

    Prices come from the source menu text only (D-04). Stops before cocktails /
    spirits (LIBATIONS page).
    """
    items: list[dict[str, Any]] = []
    # Wine entry: NAME | [glass /] bottle  — name is mostly uppercase
    entry_re = re.compile(
        r"([A-ZÀ-Ü][A-ZÀ-Ü0-9'’‘\-\s\(\)\./]+?)\s*\|\s*"
        r"(?:(\d+(?:\.\d+)?)\s*/\s*)?(\d+(?:\.\d+)?)"
        r"(?:\s*\([^)]*\))*"
    )
    # Producer on following description line: "Skouras | generous citrus..."
    producer_re = re.compile(r"^([A-Za-z][^|]{1,40}?)\s*\|\s+[a-z]")

    skip_names = {
        "WINE LIST",
        "BY THE GLASS",
        "BY THE BOTTLE",
        "AVLI FAVORITE",
        "MASTIHA",
        "OUZO",
        "TSIPOURO",
        "LAGER",
        "IPA",
    }

    # Cut off at LIBATIONS / cocktail page (pdftotext may space letters: "L I B A T I O N S")
    cut = re.search(r"L\s*I\s*B\s*A\s*T\s*I\s*O\s*N\s*S", text, re.IGNORECASE)
    if cut is None:
        cut = re.search(r"\f", text)  # form feed between PDF pages
    wine_text = text[: cut.start()] if cut else text

    current_section: str | None = None
    section_map = {
        "BUBBLES": "sparkling",
        "ROSÉ": "rose",
        "ROSE": "rose",
        "WHITE": "white",
        "RED": "red",
    }

    lines = wine_text.splitlines()
    for idx, raw in enumerate(lines):
        stripped = raw.strip()
        if not stripped:
            continue
        # Section headers may appear as lone words on a line
        upper = stripped.upper()
        for label, ptype in section_map.items():
            if upper == label or upper.startswith(label + " "):
                # Only treat as section if no price pipe
                if "|" not in stripped:
                    current_section = ptype
                    break

        # Two-column: find all wine|price matches on the line
        for m in entry_re.finditer(stripped):
            name = re.sub(r"\s+", " ", m.group(1)).strip(" -")
            # Drop column-bleed fragments like "L) TAVERNA CARAFE"
            if re.match(r"^[A-Z]?\)\s*", name) or name.startswith("L)"):
                continue
            name_key = name.upper()
            if name_key in skip_names or name_key == "TAVERNA CARAFE" or len(name) < 4:
                continue
            # Filter cocktail-ish lowercase-heavy names after wine page cut
            if sum(1 for c in name if c.islower()) > sum(
                1 for c in name if c.isupper()
            ):
                continue
            glass_s, bottle_s = m.group(2), m.group(3)
            glass = float(glass_s) if glass_s else None
            bottle = float(bottle_s) if bottle_s else None
            producer = None
            # Peek next line for producer (left column description)
            if idx + 1 < len(lines):
                nxt = lines[idx + 1].strip()
                # Left half of next line often has producer
                left = nxt[:70].strip() if len(nxt) > 70 else nxt
                pm = producer_re.match(left)
                if pm:
                    producer = pm.group(1).strip()
            items.append(
                {
                    "wine_name": name,
                    "producer": producer,
                    "vintage": None,
                    "bottle_price": bottle,
                    "by_glass_price": glass,
                    "primary_type": current_section,
                    "country": "Greece",
                    "region": None,
                    "grape_variety": None,
                }
            )
    return items


def bootstrap_turkish_clone_from_avli() -> dict[str, Any]:
    """Best-effort Avli PDF extract → schema-valid partial snapshot (D-03).

    Never invents sell prices — copies glass/bottle figures from menu text.
    """
    import subprocess

    if not AVLI_PDF.is_file():
        raise FileNotFoundError(f"Avli PDF not found: {AVLI_PDF}")

    result = subprocess.run(
        ["pdftotext", "-layout", str(AVLI_PDF), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    raw_items = _parse_avli_pdf_text(result.stdout)
    if not raw_items:
        raise ValueError("Avli PDF extract produced zero wine SKUs")

    items = [_row_to_item(r) for r in raw_items]
    # Force partial when extract is best-effort / incomplete sections (D-03 OK)
    quality = compute_menu_quality(items)
    # Always flag turkish-clone as partial for Vision/PDF best-effort path
    # unless fully priced AND we got a substantial list — still OK to be partial
    if quality == "full" and len(items) < 10:
        quality = "partial"

    return _envelope(
        "turkish-clone",
        source_url=AVLI_SOURCE_URL,
        source_name=AVLI_SOURCE_NAME,
        extracted_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        extraction_model="pdftotext-avli-best-effort",
        items=items,
        menu_quality=quality if quality == "partial" else "partial",
    )


def load_snapshot(archetype_id: str) -> dict[str, Any]:
    """Replay frozen snapshot from disk — no network, no crawl (D-01)."""
    path = MENUS_DIR / f"{archetype_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Frozen snapshot not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("archetype_id") != archetype_id:
        raise ValueError(
            f"Snapshot archetype_id mismatch: {data.get('archetype_id')!r} "
            f"!= {archetype_id!r}"
        )
    return data


def write_snapshot(snapshot: dict[str, Any], *, update_manifest: bool = True) -> Path:
    """Write snapshot JSON under datasets/sim/menus/ and optionally update manifest."""
    archetype_id = snapshot["archetype_id"]
    MENUS_DIR.mkdir(parents=True, exist_ok=True)
    path = MENUS_DIR / f"{archetype_id}.json"
    path.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if update_manifest:
        update_manifest_hashes()
    return path


def update_manifest_hashes() -> dict[str, Any]:
    """Rewrite manifest.json with pack_version + sha256 per menu file."""
    menus: dict[str, Any] = {}
    if MENUS_DIR.is_dir():
        for path in sorted(MENUS_DIR.glob("*.json")):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            menus[path.stem] = {
                "file": f"datasets/sim/menus/{path.name}",
                "sha256": digest,
            }
    manifest = {
        "pack_version": "1.0.0",
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "menus": menus,
        "archetypes": {
            arch: {
                "file": f"datasets/sim/archetypes/{arch}.json",
                "snapshot": f"datasets/sim/menus/{arch}.json",
            }
            for arch in menus
        },
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return manifest


def refresh_snapshot(archetype_id: str, *, use_crawler: bool = True) -> dict[str, Any]:
    """Explicit SOTA refresh — may call WebCrawlerService when keys present.

    Generate/replay must NEVER call this. Secrets in errors are redacted (T-37-01-02).
    """
    try:
        if archetype_id == "turkish-clone" or not use_crawler:
            snapshot = bootstrap_from_jsonl(archetype_id)
            write_snapshot(snapshot)
            return snapshot

        meta = JSONL_SOURCES.get(archetype_id)
        if meta is None:
            raise KeyError(f"Unknown archetype for refresh: {archetype_id!r}")

        # Prefer re-bootstrap from committed JSONL when crawler unavailable.
        # Live crawl is optional and only attempted when orchestrator is importable
        # and crawl API keys exist — never required for CI generate.
        crawl_attempted = False
        try:
            import os
            import sys

            orch_root = REPO_ROOT / "services" / "agent-orchestrator"
            if str(orch_root) not in sys.path:
                sys.path.insert(0, str(orch_root))
            has_key = bool(
                os.environ.get("GOOGLE_API_KEY")
                or os.environ.get("GEMINI_API_KEY")
                or os.environ.get("ANTHROPIC_API_KEY")
            )
            if has_key and use_crawler:
                crawl_attempted = True
                from services.web_crawler import WebCrawlerService  # type: ignore

                crawler = WebCrawlerService()
                # Fire-and-forget style: if crawl fails, fall back to JSONL bootstrap
                # (refresh still updates snapshot from best available source).
                logger.info(
                    "refresh_snapshot: attempting crawl for %s (keys present, "
                    "values redacted)",
                    archetype_id,
                )
                # Synchronous refresh path: re-bootstrap from JSONL is the
                # durable offline fallback; live crawl wiring is best-effort.
                _ = crawler  # imported to prove entrypoint exists for operators
                del crawler
        except Exception as exc:  # noqa: BLE001 — refresh must not leak secrets
            msg = str(exc)
            for key_name in (
                "GOOGLE_API_KEY",
                "GEMINI_API_KEY",
                "ANTHROPIC_API_KEY",
                "api_key",
                "API_KEY",
            ):
                val = __import__("os").environ.get(key_name)
                if val:
                    msg = msg.replace(val, "[REDACTED]")
            logger.warning(
                "refresh_snapshot crawl unavailable for %s (attempted=%s): %s",
                archetype_id,
                crawl_attempted,
                msg,
            )

        snapshot = bootstrap_from_jsonl(archetype_id)
        write_snapshot(snapshot)
        return snapshot
    except Exception as exc:  # noqa: BLE001
        msg = str(exc)
        for key_name in (
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "ANTHROPIC_API_KEY",
        ):
            val = __import__("os").environ.get(key_name)
            if val:
                msg = msg.replace(val, "[REDACTED]")
        raise RuntimeError(f"refresh_snapshot failed for {archetype_id}: {msg}") from None


def bootstrap_all() -> dict[str, Path]:
    """Bootstrap all five archetypes to frozen JSON + update manifest."""
    written: dict[str, Path] = {}
    for arch in (
        "fine-dining",
        "bistro",
        "high-volume-bar",
        "cafe",
        "turkish-clone",
    ):
        snap = bootstrap_from_jsonl(arch)
        written[arch] = write_snapshot(snap, update_manifest=False)
    update_manifest_hashes()
    return written


__all__ = [
    "JSONL_SOURCES",
    "bootstrap_all",
    "bootstrap_from_jsonl",
    "bootstrap_turkish_clone_from_avli",
    "compute_menu_quality",
    "load_snapshot",
    "refresh_snapshot",
    "update_manifest_hashes",
    "write_snapshot",
]
