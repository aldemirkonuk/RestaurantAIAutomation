"""
HTML Wine Menu Parser
=====================
FREE-first structured extraction engine.
Takes raw text (from Playwright DOM, PyPDF2, or Surya OCR) and
converts it into structured wine entries with section hierarchy.

Pipeline:
  raw text -> line splitting -> section detection -> wine entry detection
           -> per-entry field extraction -> WineParsedFields output

Leverages:
  - text_normalizer.py (200+ abbreviations, 200+ OCR corrections)
  - wine_field_parser.py RegexWineParser (price/vintage extraction)
  - Wine knowledge rules (region -> country, grape -> type, etc.)
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field as PydanticField

from services.text_normalizer import get_normalizer, WINE_TYPE_KEYWORDS
from services.wine_field_parser import RegexWineParser, WineParsedFields

logger = logging.getLogger(__name__)


# =============================================================================
# SECTION HIERARCHY MODEL
# =============================================================================

@dataclass
class MenuSection:
    """A section in the wine menu hierarchy."""
    name: str
    level: int  # 0 = top, 1 = sub, 2 = sub-sub
    parent: Optional[str] = None
    wines: List["ParsedWineEntry"] = field(default_factory=list)
    subsections: List["MenuSection"] = field(default_factory=list)


@dataclass
class ParsedWineEntry:
    """A single wine entry extracted from the menu."""
    raw_text: str
    parsed: WineParsedFields
    section_path: str = ""  # e.g. "Sparkling/Champagne"
    line_number: int = 0
    source_lines: List[str] = field(default_factory=list)


class MenuParseResult(BaseModel):
    """Complete result of parsing a wine menu."""
    wines: List[Dict[str, Any]] = PydanticField(default_factory=list)
    sections: List[Dict[str, Any]] = PydanticField(default_factory=list)
    section_hierarchy: Dict[str, Any] = PydanticField(default_factory=dict)
    total_wines: int = 0
    total_sections: int = 0
    parser_confidence: float = 0.0
    warnings: List[str] = PydanticField(default_factory=list)
    raw_line_count: int = 0
    wine_density: float = 0.0  # wines per line


# =============================================================================
# SECTION HEADER PATTERNS
# =============================================================================

# Common wine section headers (case-insensitive matching)
SECTION_HEADER_PATTERNS: List[Tuple[re.Pattern, str]] = [
    # Exact type categories
    (re.compile(r"^\s*(?:red\s+wines?|reds)\s*$", re.I), "Red"),
    (re.compile(r"^\s*(?:white\s+wines?|whites)\s*$", re.I), "White"),
    (re.compile(r"^\s*(?:ros[eé]\s+wines?|ros[eé]s?)\s*$", re.I), "Rosé"),
    (re.compile(r"^\s*(?:sparkling\s+wines?|sparkling|bubbles)\s*$", re.I), "Sparkling"),
    (re.compile(r"^\s*(?:champagne)\s*$", re.I), "Champagne"),
    (re.compile(r"^\s*(?:dessert\s+wines?|sweet\s+wines?)\s*$", re.I), "Dessert"),
    (re.compile(r"^\s*(?:fortified\s+wines?|fortified)\s*$", re.I), "Fortified"),
    (re.compile(r"^\s*(?:by\s+the\s+glass)\s*$", re.I), "By the Glass"),
    (re.compile(r"^\s*(?:wine\s+list|wine\s+menu|wine\s+program)\s*$", re.I), "Wine List"),
    (re.compile(r"^\s*(?:reserve\s+(?:list|wines?|selection))\s*$", re.I), "Reserve"),
    (re.compile(r"^\s*(?:half\s+bottles?)\s*$", re.I), "Half Bottles"),
    (re.compile(r"^\s*(?:large\s+format|magnums?)\s*$", re.I), "Large Format"),
    # Region-based sections
    (re.compile(r"^\s*(?:france|french\s+wines?)\s*$", re.I), "France"),
    (re.compile(r"^\s*(?:italy|italian\s+wines?)\s*$", re.I), "Italy"),
    (re.compile(r"^\s*(?:spain|spanish\s+wines?)\s*$", re.I), "Spain"),
    (re.compile(r"^\s*(?:california)\s*$", re.I), "California"),
    (re.compile(r"^\s*(?:oregon)\s*$", re.I), "Oregon"),
    (re.compile(r"^\s*(?:washington)\s*$", re.I), "Washington"),
    (re.compile(r"^\s*(?:new\s+york)\s*$", re.I), "New York"),
    (re.compile(r"^\s*(?:napa\s+valley)\s*$", re.I), "Napa Valley"),
    (re.compile(r"^\s*(?:sonoma)\s*$", re.I), "Sonoma"),
    (re.compile(r"^\s*(?:bordeaux)\s*$", re.I), "Bordeaux"),
    (re.compile(r"^\s*(?:burgundy|bourgogne)\s*$", re.I), "Burgundy"),
    (re.compile(r"^\s*(?:rh[oô]ne|rhone\s+valley)\s*$", re.I), "Rhône"),
    (re.compile(r"^\s*(?:loire|loire\s+valley)\s*$", re.I), "Loire"),
    (re.compile(r"^\s*(?:alsace)\s*$", re.I), "Alsace"),
    (re.compile(r"^\s*(?:tuscany|toscana)\s*$", re.I), "Tuscany"),
    (re.compile(r"^\s*(?:piedmont|piemonte)\s*$", re.I), "Piedmont"),
    (re.compile(r"^\s*(?:rioja)\s*$", re.I), "Rioja"),
    (re.compile(r"^\s*(?:germany|german\s+wines?)\s*$", re.I), "Germany"),
    (re.compile(r"^\s*(?:australia|australian\s+wines?)\s*$", re.I), "Australia"),
    (re.compile(r"^\s*(?:new\s+zealand)\s*$", re.I), "New Zealand"),
    (re.compile(r"^\s*(?:south\s+america|argentina|chile)\s*$", re.I), "South America"),
    (re.compile(r"^\s*(?:portugal|portuguese\s+wines?)\s*$", re.I), "Portugal"),
    # Grape-based sections
    (re.compile(r"^\s*(?:cabernet\s+sauvignon)\s*$", re.I), "Cabernet Sauvignon"),
    (re.compile(r"^\s*(?:pinot\s+noir)\s*$", re.I), "Pinot Noir"),
    (re.compile(r"^\s*(?:chardonnay)\s*$", re.I), "Chardonnay"),
    (re.compile(r"^\s*(?:sauvignon\s+blanc)\s*$", re.I), "Sauvignon Blanc"),
    (re.compile(r"^\s*(?:merlot)\s*$", re.I), "Merlot"),
    (re.compile(r"^\s*(?:riesling)\s*$", re.I), "Riesling"),
    (re.compile(r"^\s*(?:syrah|shiraz)\s*$", re.I), "Syrah/Shiraz"),
    (re.compile(r"^\s*(?:malbec)\s*$", re.I), "Malbec"),
    (re.compile(r"^\s*(?:zinfandel)\s*$", re.I), "Zinfandel"),
    (re.compile(r"^\s*(?:sangiovese)\s*$", re.I), "Sangiovese"),
    (re.compile(r"^\s*(?:nebbiolo)\s*$", re.I), "Nebbiolo"),
    (re.compile(r"^\s*(?:tempranillo)\s*$", re.I), "Tempranillo"),
]

# Heuristic patterns for detecting section headers
HEADER_HEURISTICS = [
    # ALL CAPS lines that are short (likely headers)
    re.compile(r"^[A-Z\s&\-/,]{4,60}$"),
    # Lines ending with colon
    re.compile(r"^.{3,60}:\s*$"),
    # Lines with only a few words, no price, no vintage
    re.compile(r"^(?!.*\$)(?!.*\d{4})[A-Za-z\s&\-/,\']{4,50}$"),
]


# =============================================================================
# WINE ENTRY DETECTION PATTERNS
# =============================================================================

# A line likely contains a wine if it has:
WINE_LINE_SIGNALS = {
    "has_vintage": re.compile(r"\b(19\d{2}|20[0-3]\d)\b"),
    "has_price_usd": re.compile(r"\$\s*\d+"),
    "has_price_eur": re.compile(r"€\s*\d+|\d+\s*€"),
    "has_price_gbp": re.compile(r"£\s*\d+"),
    "has_price_bare": re.compile(r"(?:^|[\s.])(\d{2,4})(?:\s*$)"),  # trailing number
    "has_producer_pattern": re.compile(
        r"\b(?:ch[aâ]teau|domaine|tenuta|bodega|weingut|maison|cantina|"
        r"estate|vineyard|winery|vignoble|fattoria|castello|finca|azienda)\b",
        re.I,
    ),
    "has_region": re.compile(
        r"\b(?:bordeaux|burgundy|champagne|napa|sonoma|tuscany|piemonte|"
        r"rioja|barolo|barossa|marlborough|willamette|oregon|california|"
        r"côtes?\s+du\s+rhône|saint-[eé]milion|pauillac|margaux|pommard|"
        r"meursault|chablis|sancerre|pouilly|chianti|brunello|barbaresco)\b",
        re.I,
    ),
    "has_grape": re.compile(
        r"\b(?:cabernet|chardonnay|pinot|merlot|sauvignon|riesling|syrah|"
        r"shiraz|malbec|zinfandel|sangiovese|nebbiolo|tempranillo|"
        r"grenache|mourvedre|viognier|gewurztraminer|chenin|semillon|"
        r"gamay|barbera|primitivo|gruner|albarino|verdejo|trebbiano)\b",
        re.I,
    ),
}

# Minimum signals for a line to be considered a wine entry
MIN_WINE_SIGNALS = 1


# =============================================================================
# REGION -> COUNTRY KNOWLEDGE MAP
# =============================================================================

REGION_TO_COUNTRY: Dict[str, Tuple[str, Optional[str]]] = {
    # France
    "bordeaux": ("France", "Bordeaux"),
    "burgundy": ("France", "Burgundy"),
    "bourgogne": ("France", "Burgundy"),
    "champagne": ("France", "Champagne"),
    "rhone": ("France", "Rhône"),
    "rhône": ("France", "Rhône"),
    "loire": ("France", "Loire Valley"),
    "alsace": ("France", "Alsace"),
    "provence": ("France", "Provence"),
    "languedoc": ("France", "Languedoc"),
    "beaujolais": ("France", "Beaujolais"),
    "chablis": ("France", "Burgundy"),
    "sancerre": ("France", "Loire Valley"),
    "pouilly-fume": ("France", "Loire Valley"),
    "saint-emilion": ("France", "Bordeaux"),
    "pauillac": ("France", "Bordeaux"),
    "margaux": ("France", "Bordeaux"),
    "pessac-leognan": ("France", "Bordeaux"),
    "pommard": ("France", "Burgundy"),
    "meursault": ("France", "Burgundy"),
    "gevrey-chambertin": ("France", "Burgundy"),
    "vosne-romanee": ("France", "Burgundy"),
    "cotes du rhone": ("France", "Rhône"),
    "chateauneuf-du-pape": ("France", "Rhône"),
    "hermitage": ("France", "Rhône"),
    "cote-rotie": ("France", "Rhône"),
    # Italy
    "tuscany": ("Italy", "Tuscany"),
    "toscana": ("Italy", "Tuscany"),
    "piedmont": ("Italy", "Piedmont"),
    "piemonte": ("Italy", "Piedmont"),
    "veneto": ("Italy", "Veneto"),
    "sicily": ("Italy", "Sicily"),
    "sicilia": ("Italy", "Sicily"),
    "chianti": ("Italy", "Tuscany"),
    "brunello": ("Italy", "Tuscany"),
    "barolo": ("Italy", "Piedmont"),
    "barbaresco": ("Italy", "Piedmont"),
    "amarone": ("Italy", "Veneto"),
    "soave": ("Italy", "Veneto"),
    "prosecco": ("Italy", "Veneto"),
    # Spain
    "rioja": ("Spain", "Rioja"),
    "ribera del duero": ("Spain", "Ribera del Duero"),
    "priorat": ("Spain", "Priorat"),
    "rueda": ("Spain", "Rueda"),
    "rias baixas": ("Spain", "Rías Baixas"),
    # USA
    "napa valley": ("USA", "California"),
    "napa": ("USA", "California"),
    "sonoma": ("USA", "California"),
    "california": ("USA", "California"),
    "oregon": ("USA", "Oregon"),
    "willamette": ("USA", "Oregon"),
    "washington": ("USA", "Washington"),
    "paso robles": ("USA", "California"),
    "santa barbara": ("USA", "California"),
    # Other
    "barossa": ("Australia", "Barossa Valley"),
    "mclaren vale": ("Australia", "McLaren Vale"),
    "marlborough": ("New Zealand", "Marlborough"),
    "mendoza": ("Argentina", "Mendoza"),
    "stellenbosch": ("South Africa", "Stellenbosch"),
    "douro": ("Portugal", "Douro"),
    "mosel": ("Germany", "Mosel"),
    "rheingau": ("Germany", "Rheingau"),
    "pfalz": ("Germany", "Pfalz"),
}


# =============================================================================
# MAIN PARSER CLASS
# =============================================================================

class HtmlMenuParser:
    """
    Parses raw text from HTML DOM, PDF, or OCR into structured wine entries.
    This is the CORE FREE extraction engine.
    """

    def __init__(self):
        self._normalizer = get_normalizer()
        self._regex_parser = RegexWineParser()

    def parse_menu(
        self,
        raw_text: str,
        source_type: str = "html",
        restaurant_name: Optional[str] = None,
    ) -> MenuParseResult:
        """
        Parse a complete wine menu from raw text.

        Args:
            raw_text: Raw text extracted from HTML DOM, PDF, or OCR.
            source_type: One of 'html', 'pdf', 'ocr'.
            restaurant_name: Optional restaurant name for context.

        Returns:
            MenuParseResult with structured wines and section hierarchy.
        """
        if not raw_text or not raw_text.strip():
            return MenuParseResult(warnings=["Empty input text"])

        lines = self._split_and_clean_lines(raw_text)
        if not lines:
            return MenuParseResult(warnings=["No usable lines after cleaning"])

        # Phase 1: Classify each line
        classified = self._classify_lines(lines)

        # Phase 2: Build section hierarchy
        sections, section_stack = self._build_sections(classified)

        # Phase 3: Extract wine entries
        wines = self._extract_wines(classified, section_stack)

        # Phase 4: Apply wine knowledge enrichment
        wines = self._enrich_from_context(wines)

        # Phase 5: Calculate confidence
        total_wines = len(wines)
        wine_density = total_wines / max(len(lines), 1)

        confidence = self._calculate_confidence(wines, lines, sections)

        # Build result
        wine_dicts = []
        for w in wines:
            d = w.parsed.model_dump()
            d["section_path"] = w.section_path
            d["line_number"] = w.line_number
            wine_dicts.append(d)

        section_dicts = self._sections_to_dicts(sections)
        hierarchy = self._build_hierarchy_dict(sections)

        warnings = []
        if total_wines == 0:
            warnings.append("No wines detected in text")
        if confidence < 0.5:
            warnings.append(f"Low parser confidence: {confidence:.2f}")

        return MenuParseResult(
            wines=wine_dicts,
            sections=section_dicts,
            section_hierarchy=hierarchy,
            total_wines=total_wines,
            total_sections=len(sections),
            parser_confidence=confidence,
            warnings=warnings,
            raw_line_count=len(lines),
            wine_density=wine_density,
        )

    # =========================================================================
    # LINE SPLITTING AND CLEANING
    # =========================================================================

    def _split_and_clean_lines(self, text: str) -> List[str]:
        """Split text into lines and clean them."""
        # Normalize line endings
        text = text.replace("\r\n", "\n").replace("\r", "\n")

        # Split on newlines
        raw_lines = text.split("\n")

        # Clean each line
        cleaned = []
        for line in raw_lines:
            line = line.strip()
            # Skip empty lines and very short lines (likely noise)
            if not line or len(line) < 2:
                continue
            # Skip obvious non-content lines
            if self._is_noise_line(line):
                continue
            cleaned.append(line)

        return cleaned

    def _is_noise_line(self, line: str) -> bool:
        """Check if a line is noise (page numbers, URLs, etc.)."""
        lower = line.lower().strip()
        # Page numbers
        if re.match(r"^\d{1,3}$", lower):
            return True
        # URLs
        if re.match(r"^https?://", lower):
            return True
        # Common noise patterns
        noise_patterns = [
            r"^page\s+\d+",
            r"^continued\s*$",
            r"^\*\s*prices\s+(?:subject|may)",
            r"^all\s+(?:prices|wines)",
            r"^tax\s+(?:not\s+)?included",
            r"^©\s*\d{4}",
            r"^menu\s+(?:updated|revised)",
            r"^please\s+(?:ask|inquire)",
            r"^corkage\s+fee",
        ]
        for pattern in noise_patterns:
            if re.match(pattern, lower):
                return True
        return False

    # =========================================================================
    # LINE CLASSIFICATION
    # =========================================================================

    @dataclass
    class ClassifiedLine:
        text: str
        line_number: int
        is_section_header: bool = False
        is_wine_entry: bool = False
        is_continuation: bool = False
        section_name: Optional[str] = None
        section_level: int = 0
        wine_signals: int = 0
        signal_details: Dict[str, bool] = field(default_factory=dict)

    def _classify_lines(self, lines: List[str]) -> List["HtmlMenuParser.ClassifiedLine"]:
        """Classify each line as section header, wine entry, or continuation."""
        classified = []

        for i, line in enumerate(lines):
            cl = self.ClassifiedLine(text=line, line_number=i)

            # Check if it's a section header
            section_match = self._match_section_header(line)
            if section_match:
                cl.is_section_header = True
                cl.section_name = section_match[0]
                cl.section_level = section_match[1]
                classified.append(cl)
                continue

            # Check for heuristic headers (ALL CAPS, short, no price/vintage)
            if self._is_heuristic_header(line):
                cl.is_section_header = True
                cl.section_name = line.strip().title()
                cl.section_level = 1
                classified.append(cl)
                continue

            # Count wine signals
            signals = {}
            for name, pattern in WINE_LINE_SIGNALS.items():
                signals[name] = bool(pattern.search(line))
            cl.signal_details = signals
            cl.wine_signals = sum(1 for v in signals.values() if v)

            if cl.wine_signals >= MIN_WINE_SIGNALS:
                cl.is_wine_entry = True
            else:
                # Could be continuation of previous wine entry
                cl.is_continuation = True

            classified.append(cl)

        return classified

    def _match_section_header(self, line: str) -> Optional[Tuple[str, int]]:
        """Match line against known section header patterns."""
        stripped = line.strip()
        for pattern, name in SECTION_HEADER_PATTERNS:
            if pattern.match(stripped):
                # Determine level: type-level = 0, region = 1, grape = 2
                level = 0
                if name in ("Red", "White", "Rosé", "Sparkling", "Dessert",
                            "Fortified", "By the Glass", "Wine List", "Reserve",
                            "Half Bottles", "Large Format", "Champagne"):
                    level = 0
                elif name in REGION_TO_COUNTRY or name in (
                    "France", "Italy", "Spain", "California", "Oregon",
                    "Washington", "New York", "Germany", "Australia",
                    "New Zealand", "South America", "Portugal",
                ):
                    level = 1
                else:
                    level = 2
                return (name, level)
        return None

    def _is_heuristic_header(self, line: str) -> bool:
        """Detect section headers using heuristics."""
        stripped = line.strip()
        # Must be reasonably short
        if len(stripped) > 60 or len(stripped) < 3:
            return False
        # Must not have price indicators
        if re.search(r"\$|€|£|₺|\d{4}", stripped):
            return False
        # ALL CAPS check (at least 4 chars, mostly uppercase)
        if stripped.isupper() and len(stripped) >= 4:
            return True
        # Ends with colon
        if stripped.endswith(":") and len(stripped) <= 50:
            return True
        return False

    # =========================================================================
    # SECTION HIERARCHY BUILDING
    # =========================================================================

    def _build_sections(
        self, classified: List["HtmlMenuParser.ClassifiedLine"]
    ) -> Tuple[List[MenuSection], Dict[int, str]]:
        """Build section hierarchy and track which section each line belongs to."""
        sections: List[MenuSection] = []
        section_stack: Dict[int, str] = {}
        current_path_parts: List[str] = []

        for cl in classified:
            if cl.is_section_header and cl.section_name:
                level = cl.section_level

                # Trim the path to current level
                current_path_parts = current_path_parts[:level]
                current_path_parts.append(cl.section_name)

                section = MenuSection(
                    name=cl.section_name,
                    level=level,
                    parent=current_path_parts[-2] if len(current_path_parts) > 1 else None,
                )
                sections.append(section)

            # Record the current section path for this line
            section_stack[cl.line_number] = "/".join(current_path_parts) if current_path_parts else ""

        return sections, section_stack

    # =========================================================================
    # WINE EXTRACTION
    # =========================================================================

    def _extract_wines(
        self,
        classified: List["HtmlMenuParser.ClassifiedLine"],
        section_stack: Dict[int, str],
    ) -> List[ParsedWineEntry]:
        """Extract structured wine entries from classified lines."""
        wines: List[ParsedWineEntry] = []
        pending_lines: List["HtmlMenuParser.ClassifiedLine"] = []

        for cl in classified:
            if cl.is_section_header:
                # Flush pending lines
                if pending_lines:
                    wine = self._parse_wine_lines(pending_lines, section_stack)
                    if wine:
                        wines.append(wine)
                    pending_lines = []
                continue

            if cl.is_wine_entry:
                # Flush previous pending if this is a new wine
                if pending_lines and pending_lines[0].is_wine_entry:
                    wine = self._parse_wine_lines(pending_lines, section_stack)
                    if wine:
                        wines.append(wine)
                    pending_lines = []
                pending_lines.append(cl)

            elif cl.is_continuation and pending_lines:
                # Append as continuation of current wine
                pending_lines.append(cl)
            elif cl.is_continuation:
                # Orphan continuation line: try to parse as standalone
                pending_lines.append(cl)

        # Flush final pending
        if pending_lines:
            wine = self._parse_wine_lines(pending_lines, section_stack)
            if wine:
                wines.append(wine)

        return wines

    def _parse_wine_lines(
        self,
        lines: List["HtmlMenuParser.ClassifiedLine"],
        section_stack: Dict[int, str],
    ) -> Optional[ParsedWineEntry]:
        """Parse one or more lines into a single wine entry."""
        if not lines:
            return None

        # Combine text from all lines
        combined_text = " ".join(cl.text for cl in lines)
        first_line = lines[0]

        # Get section context
        section_path = section_stack.get(first_line.line_number, "")
        section_header = section_path.split("/")[-1] if section_path else None

        # Use the existing RegexWineParser for field extraction
        parsed = self._regex_parser.parse(
            combined_text,
            section_header=section_header,
        )

        # Override confidence based on signal strength
        signal_count = first_line.wine_signals
        if signal_count >= 3:
            parsed.confidence = max(parsed.confidence, 0.75)
        elif signal_count >= 2:
            parsed.confidence = max(parsed.confidence, 0.60)
        elif signal_count >= 1:
            parsed.confidence = max(parsed.confidence, 0.45)

        # Skip entries that are clearly not wines
        if parsed.wine_name == "Unknown Wine" and not parsed.vintage and not parsed.price:
            return None

        return ParsedWineEntry(
            raw_text=combined_text,
            parsed=parsed,
            section_path=section_path,
            line_number=first_line.line_number,
            source_lines=[cl.text for cl in lines],
        )

    # =========================================================================
    # WINE KNOWLEDGE ENRICHMENT
    # =========================================================================

    def _enrich_from_context(self, wines: List[ParsedWineEntry]) -> List[ParsedWineEntry]:
        """Enrich wine entries using wine knowledge rules and section context."""
        for wine in wines:
            parsed = wine.parsed

            # Infer country/region from section path
            if wine.section_path and (not parsed.country or not parsed.region):
                self._infer_from_section(parsed, wine.section_path)

            # Infer country/region from wine name or text
            if not parsed.country:
                self._infer_from_text(parsed, wine.raw_text)

            # Infer wine type from section path
            if not parsed.wine_type and wine.section_path:
                wtype = self._normalizer.infer_wine_type(wine.section_path)
                if wtype:
                    parsed.wine_type = wtype
                    parsed.field_sources["wine_type"] = "section_context"

        return wines

    def _infer_from_section(self, parsed: WineParsedFields, section_path: str) -> None:
        """Infer country/region from section hierarchy path."""
        parts = section_path.lower().split("/")
        for part in parts:
            part = part.strip()
            if part in REGION_TO_COUNTRY:
                country, region = REGION_TO_COUNTRY[part]
                if not parsed.country:
                    parsed.country = country
                    parsed.field_sources["country"] = "section_context"
                if not parsed.region and region:
                    parsed.region = region
                    parsed.field_sources["region"] = "section_context"
                return

    def _infer_from_text(self, parsed: WineParsedFields, text: str) -> None:
        """Infer country/region from wine name or description text."""
        lower = text.lower()
        for region_key, (country, region) in REGION_TO_COUNTRY.items():
            if region_key in lower:
                if not parsed.country:
                    parsed.country = country
                    parsed.field_sources["country"] = "ai_inferred"
                    parsed.warnings.append(f"Country '{country}' inferred from region '{region_key}'")
                if not parsed.region and region:
                    parsed.region = region
                    parsed.field_sources["region"] = "ai_inferred"
                return

    # =========================================================================
    # CONFIDENCE CALCULATION
    # =========================================================================

    def _calculate_confidence(
        self,
        wines: List[ParsedWineEntry],
        lines: List[str],
        sections: List[MenuSection],
    ) -> float:
        """Calculate overall parse confidence."""
        if not wines:
            return 0.0

        # Factor 1: Wine density (expect ~0.3-0.8 for a wine list)
        density = len(wines) / max(len(lines), 1)
        density_score = min(density / 0.5, 1.0)

        # Factor 2: Average wine confidence
        avg_confidence = sum(w.parsed.confidence for w in wines) / len(wines)

        # Factor 3: Section structure detected
        section_score = min(len(sections) / 3.0, 1.0)

        # Factor 4: Identity fields populated
        identity_scores = []
        for w in wines:
            p = w.parsed
            populated = sum([
                bool(p.wine_name and p.wine_name != "Unknown Wine"),
                bool(p.vintage),
                bool(p.price),
                bool(p.country),
                bool(p.region),
                bool(p.wine_type),
            ])
            identity_scores.append(populated / 6.0)
        avg_identity = sum(identity_scores) / len(identity_scores)

        # Weighted composite
        confidence = (
            density_score * 0.15
            + avg_confidence * 0.35
            + section_score * 0.15
            + avg_identity * 0.35
        )

        return round(min(max(confidence, 0.0), 1.0), 3)

    # =========================================================================
    # OUTPUT HELPERS
    # =========================================================================

    def _sections_to_dicts(self, sections: List[MenuSection]) -> List[Dict[str, Any]]:
        """Convert sections to serializable dicts."""
        return [
            {
                "name": s.name,
                "level": s.level,
                "parent": s.parent,
            }
            for s in sections
        ]

    def _build_hierarchy_dict(self, sections: List[MenuSection]) -> Dict[str, Any]:
        """Build a nested hierarchy dict from flat section list."""
        hierarchy: Dict[str, Any] = {}
        for s in sections:
            if s.level == 0:
                hierarchy[s.name] = {"subsections": {}}
            elif s.level == 1 and s.parent and s.parent in hierarchy:
                hierarchy[s.parent]["subsections"][s.name] = {"subsections": {}}
            elif s.level == 2 and s.parent:
                for top in hierarchy.values():
                    if s.parent in top.get("subsections", {}):
                        top["subsections"][s.parent]["subsections"][s.name] = {}
        return hierarchy


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_parser_instance: Optional[HtmlMenuParser] = None


def get_menu_parser() -> HtmlMenuParser:
    """Get module-level singleton parser."""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = HtmlMenuParser()
    return _parser_instance
