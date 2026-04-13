#!/usr/bin/env python3
"""
Document Ingestion CLI
======================
CLI tool for ingesting wine menus and invoices into the scanning pipeline.

Usage:
  python scripts/ingest.py menu --source dev_pdf --path /path/to/menu.pdf
  python scripts/ingest.py menu --source dev_pdf --path /path/to/folder/
  python scripts/ingest.py invoice --source dev_pdf --path /path/to/invoice.pdf
  python scripts/ingest.py menu --source photo --path /path/to/photo.jpg
  python scripts/ingest.py stats

Sources (quality tiers):
  dev_pdf   - Tier 1: Manual dev upload (curated, no noise)
  user      - Tier 2: User app upload
  scraped   - Tier 3: Web-crawled data
  photo     - Tier 4: Phone camera photo
  other     - Tier 5: Other/unknown source
"""

import asyncio
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVICES_ROOT = PROJECT_ROOT / "services" / "agent-orchestrator"
sys.path.insert(0, str(SERVICES_ROOT))

DATASETS_ROOT = PROJECT_ROOT / "datasets"

# Source -> destination mapping
SOURCE_DIRS = {
    "dev_pdf": "raw_uploads",
    "user": "raw_uploads",
    "scraped": "scraped",
    "photo": "raw_uploads",
    "other": "raw_uploads",
}

try:
    import typer
    from rich.console import Console
    from rich.table import Table
    from rich.progress import Progress
    app = typer.Typer(help="WineOps Document Ingestion CLI")
    console = Console()
except ImportError:
    print("ERROR: typer and rich required. Install: pip install typer rich")
    sys.exit(1)


def _count_files(directory: Path, extensions: tuple = (".pdf", ".jpg", ".jpeg", ".png", ".webp")) -> int:
    """Count matching files in directory."""
    if not directory.exists():
        return 0
    return sum(1 for f in directory.rglob("*") if f.suffix.lower() in extensions)


def _get_dest_dir(source: str, doc_type: str) -> Path:
    """Get destination directory for a given source and doc type."""
    base = SOURCE_DIRS.get(source, "raw_uploads")
    return DATASETS_ROOT / base / f"{doc_type}s"


@app.command()
def menu(
    path: str = typer.Argument(..., help="Path to PDF/image file or folder"),
    source: str = typer.Option("dev_pdf", help="Source tier: dev_pdf, user, scraped, photo, other"),
    restaurant: Optional[str] = typer.Option(None, help="Restaurant name for context"),
    extract: bool = typer.Option(False, help="Run extraction immediately after copy"),
):
    """Ingest a wine menu (PDF or image) into the pipeline."""
    _ingest(path, source, "menu", restaurant, extract)


@app.command()
def invoice(
    path: str = typer.Argument(..., help="Path to PDF/image file or folder"),
    source: str = typer.Option("dev_pdf", help="Source tier: dev_pdf, user, scraped, photo, other"),
    restaurant: Optional[str] = typer.Option(None, help="Restaurant/vendor name"),
    extract: bool = typer.Option(False, help="Run extraction immediately after copy"),
):
    """Ingest an invoice (PDF or image) into the pipeline."""
    _ingest(path, source, "invoice", restaurant, extract)


@app.command()
def stats():
    """Show dataset statistics."""
    console.print("\n[bold]WineOps Dataset Statistics[/bold]\n")

    table = Table(show_header=True, header_style="bold")
    table.add_column("Directory", style="cyan")
    table.add_column("Files", justify="right")

    dirs = [
        ("Raw Uploads / Menus", DATASETS_ROOT / "raw_uploads" / "menus"),
        ("Raw Uploads / Invoices", DATASETS_ROOT / "raw_uploads" / "invoices"),
        ("Annotated / Menus", DATASETS_ROOT / "annotated" / "menus"),
        ("Annotated / Invoices", DATASETS_ROOT / "annotated" / "invoices"),
        ("Scraped / Menus", DATASETS_ROOT / "scraped" / "menus"),
        ("Scraped / Invoices", DATASETS_ROOT / "scraped" / "invoices"),
        ("Restaurant Menus", DATASETS_ROOT / "restaurant_menus"),
        ("YOLO / Wine Menus", DATASETS_ROOT / "wine_menus"),
        ("YOLO / Wine Invoices", DATASETS_ROOT / "wine_invoices"),
    ]

    total = 0
    for label, d in dirs:
        count = _count_files(d)
        total += count
        table.add_row(label, str(count))

    table.add_row("[bold]Total[/bold]", f"[bold]{total}[/bold]")
    console.print(table)

    # Restaurant menu datasets
    rm_dir = DATASETS_ROOT / "restaurant_menus"
    jsonl_files = list(rm_dir.glob("*.jsonl"))
    if jsonl_files:
        console.print(f"\n[bold]Restaurant Menu Datasets:[/bold] {len(jsonl_files)} city files")
        for f in sorted(jsonl_files):
            line_count = sum(1 for _ in open(f))
            console.print(f"  {f.name}: {line_count} restaurants")


def _ingest(
    path: str,
    source: str,
    doc_type: str,
    restaurant: Optional[str],
    extract: bool,
):
    """Core ingestion logic."""
    src_path = Path(path).resolve()
    if not src_path.exists():
        console.print(f"[red]Error: Path not found: {path}[/red]")
        raise typer.Exit(1)

    dest_dir = _get_dest_dir(source, doc_type)
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Collect files
    valid_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tiff", ".heic")
    files = []
    if src_path.is_file():
        if src_path.suffix.lower() in valid_ext:
            files.append(src_path)
        else:
            console.print(f"[red]Error: Unsupported file type: {src_path.suffix}[/red]")
            raise typer.Exit(1)
    elif src_path.is_dir():
        for f in sorted(src_path.rglob("*")):
            if f.suffix.lower() in valid_ext:
                files.append(f)

    if not files:
        console.print("[yellow]No valid files found.[/yellow]")
        raise typer.Exit(0)

    console.print(f"\nIngesting {len(files)} {doc_type}(s) from [cyan]{source}[/cyan] source\n")

    copied = 0
    with Progress() as progress:
        task = progress.add_task("Copying files...", total=len(files))

        for f in files:
            # Create timestamped filename to avoid collisions
            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            new_name = f"{ts}_{source}_{f.name}"
            dest_file = dest_dir / new_name

            # Copy file
            shutil.copy2(f, dest_file)

            # Write metadata sidecar
            meta = {
                "original_name": f.name,
                "source": source,
                "document_type": doc_type,
                "restaurant_name": restaurant,
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "original_path": str(f),
                "file_size_bytes": f.stat().st_size,
            }
            meta_path = dest_file.with_suffix(dest_file.suffix + ".meta.json")
            with open(meta_path, "w") as mf:
                json.dump(meta, mf, indent=2)

            copied += 1
            progress.update(task, advance=1)

    console.print(f"\n[green]Successfully ingested {copied} file(s) to {dest_dir}[/green]")

    if extract:
        console.print("\n[yellow]Running extraction...[/yellow]")
        asyncio.run(_run_extraction(dest_dir, doc_type, restaurant, files))


async def _run_extraction(
    dest_dir: Path,
    doc_type: str,
    restaurant: Optional[str],
    files: list,
):
    """Run extraction on ingested files."""
    try:
        from services.pdf_extraction_service import get_pdf_service
        from services.html_menu_parser import get_menu_parser
        from services.wine_menu_classifier import get_classifier

        pdf_service = get_pdf_service()
        classifier = get_classifier()

        for f in files:
            console.print(f"  Processing: {f.name}")

            if f.suffix.lower() == ".pdf":
                result = await pdf_service.extract_from_file(
                    str(f), doc_type, restaurant
                )
                console.print(
                    f"    -> {result.total_wines} wines, "
                    f"confidence: {result.overall_confidence:.2f}, "
                    f"method: {result.extraction_method}"
                )
            else:
                console.print(f"    -> Image file, skipping (use photo upload for images)")

    except ImportError as e:
        console.print(f"[red]Extraction dependencies not available: {e}[/red]")
    except Exception as e:
        console.print(f"[red]Extraction error: {e}[/red]")


if __name__ == "__main__":
    app()
