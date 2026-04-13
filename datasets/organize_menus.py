#!/usr/bin/env python3
"""
Menu PDF Classifier & Organizer
================================
Reads every PDF in annotation_inbox/pdfs/, classifies content type,
then copies files into organized subdirectories:

  annotation_inbox/
    classified/
      01_wine_only/          — Pure wine lists (no cocktails/spirits/beer)
      02_wine_and_beverage/  — Wine + cocktails/spirits/beer/NA
      03_beverage_only/      — Full bar program, wine is secondary
      04_food_and_wine/      — Food + wine together (single doc)
      _review/               — Ambiguous — needs human review

Run from Mac terminal:
    cd ~/Desktop/UnicornProjects/Restaurant\ AI\ Automation/datasets
    python3 organize_menus.py
"""

import os
import re
import shutil
import json
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
PDF_DIR      = SCRIPT_DIR / "annotation_inbox" / "pdfs"
OUTPUT_DIR   = SCRIPT_DIR / "annotation_inbox" / "classified"

CATEGORIES = {
    "01_wine_only":          "Pure wine lists — no cocktails, spirits, or beer sections",
    "02_wine_and_beverage":  "Wine + cocktails / spirits / beer / NA beverages",
    "03_beverage_only":      "Full beverage program — cocktails & spirits are the focus",
    "04_food_and_wine":      "Single doc with food menu AND wine/beverage sections",
    "_review":               "Ambiguous — needs human review",
}

# ── Signal patterns ────────────────────────────────────────────────────────
WINE_PATTERNS = [
    r'\b(red wine|white wine|rosé|rose wine|sparkling|champagne|prosecco|cava|crémant|cremant)\b',
    r'\b(cabernet|merlot|pinot|chardonnay|sauvignon blanc|riesling|grenache|syrah|shiraz)\b',
    r'\b(nebbiolo|sangiovese|barolo|brunello|chianti|amarone|ripasso|soave|gavi|vermentino)\b',
    r'\b(bordeaux|burgundy|rhone|alsace|loire|champagne|tuscany|napa|sonoma|rioja|priorat)\b',
    r'\b(winery|estate|château|chateau|domaine|bodega|cantina|tenuta|weingut|cellars?)\b',
    r'\b(wine list|by the glass|by the bottle|half.bottle|magnum|reserve|grand cru|premier cru)\b',
    r'\b(aoc|doc|docg|ava|igt|appellation|vintage|bin \d+)\b',
    r'\b(malbec|tempranillo|zinfandel|viognier|gewurztraminer|gruner veltliner|grüner)\b',
    r'\b(fiano|falanghina|greco|pecorino|verdicchio|arneis|barbera|dolcetto|primitivo)\b',
]
COCKTAIL_PATTERNS = [
    r'\b(cocktail|martini|negroni|manhattan|old fashioned|margarita|mojito|daiquiri)\b',
    r'\b(spritz|aperol|campari|aperitivo|digestif|signature drink|craft cocktail)\b',
    r'\b(gin|vodka|rum|tequila|mezcal|agave|triple sec|vermouth|bitters|amaro)\b',
    r'\b(highball|sour|smash|fizz|mule|collins|gimlet|cosmo|boulevardier)\b',
]
SPIRITS_PATTERNS = [
    r'\b(whiskey|whisky|bourbon|scotch|rye whiskey|irish whiskey|japanese whisky)\b',
    r'\b(single malt|blended scotch|cognac|armagnac|brandy|calvados|eau de vie)\b',
    r'\b(tequila blanco|tequila reposado|tequila añejo|mezcal|sotol|raicilla)\b',
    r'\b(barrel.?aged|cask|neat|on the rocks|spirit selection|premium spirit)\b',
]
BEER_PATTERNS = [
    r'\b(beer|lager|ale|ipa|stout|porter|pilsner|draught|draft|craft beer)\b',
    r'\b(pale ale|wheat beer|hefeweizen|sour beer|saison|farmhouse|on tap|keg)\b',
]
NA_PATTERNS = [
    r'\b(coffee|espresso|cappuccino|latte|tea|herbal tea|juice|lemonade)\b',
    r'\b(soda|sparkling water|still water|san pellegrino|perrier|soft drink)\b',
    r'\b(mocktail|non.?alcoholic|no.?alcohol|virgin|zero.?proof|shrub)\b',
]
FOOD_PATTERNS = [
    r'\b(appetizer|starter|antipast[io]|entree|entrée|main course|dessert|desserts)\b',
    r'\b(pasta|pizza|steak|seafood|fish|chicken|lamb|pork|salad|soup|risotto)\b',
    r'\b(tasting menu|prix fixe|à la carte|a la carte|chef.?s menu|omakase)\b',
    r'\b(small plate|sharing plate|meze|mezze|tapas|charcuterie|crudité)\b',
]

def score(text: str, patterns: list) -> int:
    t = text.lower()
    return sum(len(re.findall(p, t, re.IGNORECASE)) for p in patterns)


# Module-level cache so Surya models are loaded once per script run, not once
# per PDF.  None = not yet initialised.  False = import failed (don't retry).
_surya_det: object = None
_surya_rec: object = None


def _get_surya_predictors():
    """Lazy-initialise Surya predictors and cache them in module globals.

    On a CPU-only Mac the 1.3 GB recognition model takes ~3–4 min on first
    load; subsequent calls in the same process reuse the cached objects.
    Set DISABLE_TQDM=1 in the environment to suppress surya progress bars.
    """
    global _surya_det, _surya_rec
    if _surya_det is False:
        raise ImportError("Surya predictors failed to load on a previous attempt")
    if _surya_det is not None:
        return _surya_det, _surya_rec

    try:
        import os
        os.environ.setdefault("DISABLE_TQDM", "1")  # suppress surya progress bars

        import pdf2image  # noqa: F401 — confirms pdf2image is importable
        from surya.recognition import RecognitionPredictor
        from surya.detection import DetectionPredictor
        from surya.foundation import FoundationPredictor

        print("    [Surya] loading models — first call may take several minutes on CPU…",
              flush=True)
        det = DetectionPredictor()
        rec = RecognitionPredictor(FoundationPredictor())
        print("    [Surya] models loaded", flush=True)

        _surya_det = det
        _surya_rec = rec
        return det, rec
    except Exception:
        _surya_det = False  # mark as permanently failed so we don't retry
        raise


def ocr_pdf_with_surya(path: Path, dpi: int = 300) -> str:
    """Convert each PDF page to an image and run Surya OCR; return joined text.

    Requires (optional):
        pip install surya-ocr pdf2image
        brew install poppler          # macOS — needed by pdf2image

    Raises ImportError if surya-ocr or pdf2image are not installed, or if
    model loading fails (caller catches this and falls back silently).
    """
    import pdf2image

    det, rec = _get_surya_predictors()
    images = pdf2image.convert_from_path(str(path), dpi=dpi)
    pages = []
    for img in images:
        result = rec([img], det_predictor=det)
        if result:
            pages.append("\n".join(line.text for line in result[0].text_lines))
    return "\n".join(pages)


def extract_text(path: Path) -> tuple[str, str]:
    """Extract text from a PDF, returning ``(text, extraction_quality)``.

    ``extraction_quality`` values:
      ``'text'``          — pdfplumber or pypdf produced meaningful text
      ``'ocr'``           — Surya OCR was needed and produced text
      ``'filename_only'`` — all extractors failed; classification is filename-based only
    """
    # ── Step 1: pdfplumber ──────────────────────────────────────────────────
    text = ""
    try:
        import pdfplumber
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                text += (page.extract_text() or "") + "\n"
        if text.strip():
            return text, "text"
    except Exception:
        pass

    # ── Step 2: pypdf fallback ──────────────────────────────────────────────
    text = ""
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n"
        if text.strip():
            return text, "text"
    except Exception:
        pass

    # ── Step 3: Surya OCR fallback (scanned / image-only PDFs) ─────────────
    # Because predictors are cached globally (see _get_surya_predictors), the
    # first call loads models once; every subsequent call is fast.
    # We still wrap in a daemon thread with a 300 s hard cap so a broken
    # environment can never block the script forever.
    try:
        import threading

        _result_box: list = []
        _exc_box: list = []

        def _run_surya():
            try:
                _result_box.append(ocr_pdf_with_surya(path))
            except Exception as exc:
                _exc_box.append(exc)

        t = threading.Thread(target=_run_surya, daemon=True)
        t.start()
        t.join(timeout=600)

        if t.is_alive():
            # Thread still running after 600 s — abandon it (daemon=True means
            # Python will not wait for it on exit).
            print("    [Surya OCR timed out — falling back to filename heuristic]",
                  flush=True)
        elif _exc_box:
            raise _exc_box[0]  # re-raise to hit the except branches below
        elif _result_box and _result_box[0].strip():
            return _result_box[0], "ocr"
    except ImportError:
        pass  # surya-ocr or pdf2image not installed — fall through silently
    except Exception:
        pass  # OCR failed for an unrelated reason — fall through

    # ── Step 4: filename heuristic (last resort) ────────────────────────────
    return "__EXTRACTION_ERROR__: all extractors failed", "filename_only"


def classify(filename: str, text: str) -> tuple[str, dict, str]:
    """
    Returns (category_key, scores, reasoning).
    """
    fn_lower = filename.lower()

    # Score content signals
    wine_s     = score(text, WINE_PATTERNS)
    cocktail_s = score(text, COCKTAIL_PATTERNS)
    spirits_s  = score(text, SPIRITS_PATTERNS)
    beer_s     = score(text, BEER_PATTERNS)
    na_s       = score(text, NA_PATTERNS)
    food_s     = score(text, FOOD_PATTERNS)

    bev_s = cocktail_s + spirits_s + beer_s  # non-wine beverage total

    scores = {
        "wine": wine_s, "cocktail": cocktail_s, "spirits": spirits_s,
        "beer": beer_s, "na": na_s, "food": food_s,
        "non_wine_bev": bev_s,
    }

    # ── Decision tree ──────────────────────────────────────────────────────

    # Extraction failed completely
    if "__EXTRACTION_ERROR__" in text and wine_s == 0:
        # Fall back to filename-only heuristic
        if "beverage" in fn_lower and "wine" in fn_lower:
            return "02_wine_and_beverage", scores, "filename: wine+bev (text unavailable)"
        if "beverage" in fn_lower:
            return "03_beverage_only", scores, "filename: beverage (text unavailable)"
        if "menu" in fn_lower and "wine" not in fn_lower:
            return "04_food_and_wine", scores, "filename: food menu (text unavailable)"
        if "wine" in fn_lower:
            return "01_wine_only", scores, "filename: wine (text unavailable)"
        return "_review", scores, "text unavailable + ambiguous filename"

    # Not enough text extracted
    if wine_s + bev_s + food_s < 5:
        return "_review", scores, "too little text extracted — likely scanned image PDF"

    # Full beverage program (cocktails dominate)
    if bev_s > wine_s * 0.8 and bev_s >= 15:
        if wine_s >= 10:
            return "02_wine_and_beverage", scores, f"high non-wine bev ({bev_s}) + strong wine ({wine_s})"
        return "03_beverage_only", scores, f"bev dominates ({bev_s} vs wine {wine_s})"

    # Food + wine/bev together
    if food_s >= 10 and (wine_s >= 5 or bev_s >= 5):
        return "04_food_and_wine", scores, f"food ({food_s}) + wine ({wine_s}) + bev ({bev_s})"

    # Wine + some cocktails/spirits/beer
    if wine_s >= 5 and bev_s >= 5:
        return "02_wine_and_beverage", scores, f"wine ({wine_s}) + non-wine bev ({bev_s})"

    # Pure wine list (possibly with some NA)
    if wine_s >= 5 and bev_s < 5:
        return "01_wine_only", scores, f"wine ({wine_s}), minimal non-wine bev ({bev_s})"

    # Filename-based tiebreaker
    if "wine" in fn_lower and "bev" not in fn_lower:
        return "01_wine_only", scores, "wine in filename, low signal text"

    return "_review", scores, f"scores: wine={wine_s} bev={bev_s} food={food_s}"


def main():
    print("=" * 65)
    print("  WineOps Menu PDF Classifier & Organizer")
    print("=" * 65)

    # Check pdfplumber is available
    try:
        import pdfplumber  # noqa: F401
        print("  ✓ pdfplumber available")
    except ImportError:
        print("  Installing pdfplumber...")
        os.system("pip3 install pdfplumber -q")

    # Check Surya OCR + pdf2image availability (optional — OCR fallback)
    # Use find_spec() so we NEVER trigger model loading at startup — just metadata check.
    import importlib.util
    _surya_ok    = importlib.util.find_spec("surya")     is not None
    _pdf2img_ok  = importlib.util.find_spec("pdf2image") is not None
    if _surya_ok and _pdf2img_ok:
        print("  ✓ surya-ocr + pdf2image available (OCR fallback enabled)")
    else:
        _missing = [p for p, ok in [("surya-ocr", _surya_ok), ("pdf2image", _pdf2img_ok)] if not ok]
        print(f"  ℹ  {', '.join(_missing)} not installed — OCR fallback disabled")
        print("     To enable: pip install surya-ocr pdf2image && brew install poppler")

    # Create output directories
    for cat in CATEGORIES:
        (OUTPUT_DIR / cat).mkdir(parents=True, exist_ok=True)
    print(f"  ✓ Output dir: {OUTPUT_DIR}\n")

    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    print(f"  Found {len(pdfs)} PDFs to process\n", flush=True)

    results = {}
    category_counts = {k: [] for k in CATEGORIES}

    for i, pdf_path in enumerate(pdfs, 1):
        print(f"  [{i:02}/{len(pdfs)}] {pdf_path.name}", flush=True)
        text, extraction_quality = extract_text(pdf_path)
        category, scores, reason = classify(pdf_path.name, text)

        dest = OUTPUT_DIR / category / pdf_path.name
        if dest.exists():
            dest.unlink()
        shutil.copy2(str(pdf_path), str(dest))

        category_counts[category].append(pdf_path.name)
        results[pdf_path.name] = {
            "category": category,
            "extraction_quality": extraction_quality,
            "reason": reason,
            "scores": scores,
        }

        label = {
            "01_wine_only": "🍷 WINE ONLY",
            "02_wine_and_beverage": "🍷🍸 WINE + BEV",
            "03_beverage_only": "🍸 BEV ONLY",
            "04_food_and_wine": "🍽 FOOD + WINE",
            "_review": "⚠️  REVIEW",
        }[category]

        quality_tag = {"text": "text", "ocr": "OCR", "filename_only": "filename-only"}[extraction_quality]
        print(f"           → {label}  [{quality_tag}]  ({reason})", flush=True)
        print(f"              wine={scores['wine']}  cocktail={scores['cocktail']}  "
              f"spirits={scores['spirits']}  beer={scores['beer']}  food={scores['food']}", flush=True)

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("  CLASSIFICATION SUMMARY")
    print("=" * 65)
    for cat, files in category_counts.items():
        if files:
            desc = CATEGORIES[cat]
            print(f"\n  {cat}/ ({len(files)} files)")
            print(f"  {desc}")
            for f in sorted(files):
                print(f"    • {f}")

    # Write JSON report
    report_path = OUTPUT_DIR / "classification_report.json"
    with open(report_path, "w") as f:
        json.dump({
            "total": len(pdfs),
            "categories": {k: len(v) for k, v in category_counts.items()},
            "files": results,
        }, f, indent=2)

    print(f"\n  ✓ JSON report: {report_path}")
    print(f"  ✓ All files organized in: {OUTPUT_DIR}")
    print("\n  Done. 🎉")

if __name__ == "__main__":
    main()
