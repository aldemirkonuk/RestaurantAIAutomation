"""
Wine Text Normalizer
====================
Multi-language abbreviation expansion, OCR error correction,
accent normalization, and token-order-independent matching preparation.

Supports: English, Turkish, French, Italian, Spanish, German
"""

import re
import unicodedata
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# =============================================================================
# ABBREVIATION DICTIONARY (200+ entries, extensible)
# =============================================================================

WINE_ABBREVIATIONS: Dict[str, str] = {
    # --- Producers / Titles ---
    "ch.": "chateau",
    "cht.": "chateau",
    "cht ": "chateau ",
    "château": "chateau",
    "dom.": "domaine",
    "dom ": "domaine ",
    "sev.": "sevilen",
    "vig.": "vignoble",
    "vign.": "vignoble",
    "bod.": "bodega",
    "ten.": "tenuta",
    "weing.": "weingut",
    "fatt.": "fattoria",
    "cas.": "castello",
    "cast.": "castello",
    "msn.": "maison",
    "ms.": "maison",
    "coop.": "cooperativa",
    "hrd.": "herederos",
    "mqs.": "marques",
    "marq.": "marques",
    "cts.": "comtes",
    "ctss.": "comtesse",
    "vda.": "viuda",
    "fca.": "finca",
    "hda.": "hacienda",
    "az.": "azienda",
    "az. agr.": "azienda agricola",
    "ca.": "cantina",
    "cant.": "cantina",
    "clos ": "clos ",
    "st.": "saint",
    "st-": "saint-",
    "ste.": "sainte",
    "ss.": "societa semplice",
    "srl": "societa a responsabilita limitata",

    # --- Grapes ---
    "cab.": "cabernet",
    "cab ": "cabernet ",
    "sauv.": "sauvignon",
    "sauv ": "sauvignon ",
    "chard.": "chardonnay",
    "chard ": "chardonnay ",
    "p.n.": "pinot noir",
    "p. noir": "pinot noir",
    "p.noir": "pinot noir",
    "pn": "pinot noir",
    "p.g.": "pinot grigio",
    "p. grigio": "pinot grigio",
    "p.grigio": "pinot grigio",
    "pg": "pinot grigio",
    "p.b.": "pinot blanc",
    "p. blanc": "pinot blanc",
    "pb": "pinot blanc",
    "sg": "sangiovese",
    "sangio.": "sangiovese",
    "sang.": "sangiovese",
    "temp.": "tempranillo",
    "ries.": "riesling",
    "ries ": "riesling ",
    "grn.": "grenache",
    "gren.": "grenache",
    "garn.": "garnacha",
    "garnacha": "grenache",
    "syrah": "syrah",
    "shz": "shiraz",
    "shz.": "shiraz",
    "merlot": "merlot",
    "merl.": "merlot",
    "mal.": "malbec",
    "malb.": "malbec",
    "mourv.": "mourvedre",
    "nebr.": "nebbiolo",
    "nebb.": "nebbiolo",
    "barb.": "barbera",
    "treb.": "trebbiano",
    "verm.": "vermentino",
    "gewurz.": "gewurztraminer",
    "gewurzt.": "gewurztraminer",
    "gew.": "gewurztraminer",
    "gruv.": "gruner veltliner",
    "gr. velt.": "gruner veltliner",
    "sauv. bl.": "sauvignon blanc",
    "sb": "sauvignon blanc",
    "cb": "cabernet sauvignon",
    "cs": "cabernet sauvignon",
    "cf": "cabernet franc",
    "cab. franc": "cabernet franc",
    "zin.": "zinfandel",
    "zin ": "zinfandel ",
    "prim.": "primitivo",
    "viogn.": "viognier",
    "viog.": "viognier",
    "alb.": "albarino",
    "albar.": "albarino",
    "verd.": "verdejo",
    "muscat.": "muscatel",
    "musc.": "muscatel",

    # --- Regions ---
    "bdx": "bordeaux",
    "bdx.": "bordeaux",
    "burg.": "burgundy",
    "bourg.": "bourgogne",
    "champ.": "champagne",
    "cham.": "champagne",
    "b.v.": "barossa valley",
    "n.v.": "napa valley",
    "son.": "sonoma",
    "wilm.": "willamette",
    "rha.": "rhone",
    "rhô.": "rhone",
    "lang.": "languedoc",
    "prov.": "provence",
    "pied.": "piemonte",
    "tosc.": "toscana",
    "tusc.": "tuscany",
    "sic.": "sicilia",
    "rioj.": "rioja",
    "rib.": "ribera",
    "rib. del d.": "ribera del duero",
    "rdd": "ribera del duero",
    "mend.": "mendoza",
    "stel.": "stellenbosch",
    "marl.": "marlborough",
    "hawk.": "hawkes bay",
    "marg. r.": "margaret river",
    "val.": "vallee",
    "cdr": "cotes du rhone",
    "cdp": "chateauneuf du pape",
    "cdp.": "chateauneuf du pape",

    # --- Turkish ---
    "byz": "beyaz",
    "byz.": "beyaz",
    "krm": "kirmizi",
    "krm.": "kirmizi",
    "srp": "sarap",
    "srp.": "sarap",
    "bağ": "bag",
    "şar.": "sarap",
    "kav.": "kavaklidere",
    "dlc.": "doluca",

    # --- Classifications ---
    "rsv": "reserve",
    "rsv.": "reserve",
    "res.": "reserve",
    "res ": "reserve ",
    "rva.": "reserva",
    "rva ": "reserva ",
    "g.c.": "grand cru",
    "gc": "grand cru",
    "gcc": "grand cru classe",
    "1er": "premier cru",
    "1er cru": "premier cru",
    "2eme": "deuxieme cru",
    "3eme": "troisieme cru",
    "4eme": "quatrieme cru",
    "5eme": "cinquieme cru",
    "sup.": "superiore",
    "ris.": "riserva",
    "ris ": "riserva ",
    "sel.": "selection",
    "spm.": "spumante",
    "brut nat.": "brut nature",
    "gran res.": "gran reserva",
    "cr.": "crianza",
    "jov.": "joven",
    "clas.": "classico",
    "clss.": "classico",

    # --- Appellations ---
    "doc": "denominazione di origine controllata",
    "docg": "denominazione di origine controllata e garantita",
    "aoc": "appellation d'origine controlee",
    "aop": "appellation d'origine protegee",
    "igt": "indicazione geografica tipica",
    "vdp": "vin de pays",
    "vdt": "vino de tavola",
    "do": "denominacion de origen",
    "doca": "denominacion de origen calificada",
    "qba": "qualitatswein bestimmter anbaugebiete",
    "qmp": "qualitatswein mit pradikat",
    "ava": "american viticultural area",

    # --- Other / Serving ---
    "btl": "bottle",
    "btl.": "bottle",
    "gl": "glass",
    "gl.": "glass",
    "crf": "carafe",
    "crf.": "carafe",
    "mag": "magnum",
    "mag.": "magnum",
    "jero": "jeroboam",
    "halb.": "halbtrocken",
    "trk.": "trocken",
    "suss.": "suss",
    "sec": "sec",
    "demi-sec": "demi-sec",
    "blc.": "blanc",
    "bl.": "blanc",
    "blc ": "blanc ",
    "rge.": "rouge",
    "rge ": "rouge ",
    "nv": "non-vintage",
    "n.v.": "non-vintage",
    "ml": "milliliters",
    "cl": "centiliters",
    "abv": "alcohol by volume",
}


# =============================================================================
# OCR ERROR CORRECTION MAP
# =============================================================================

OCR_CORRECTIONS: Dict[str, str] = {
    # --- Digit/letter confusion ---
    "l8": "18",
    "l9": "19",
    "2O": "20",
    "2o": "20",
    "20l": "201",
    "20I": "201",
    "19l": "191",
    "201B": "2018",
    "201S": "2015",
    "20lB": "2018",
    "20l8": "2018",
    "20l9": "2019",
    "2Ol8": "2018",
    "2Ol9": "2019",
    "2O18": "2018",
    "2O19": "2019",
    "2O20": "2020",
    "2O21": "2021",
    "2O22": "2022",
    "2O23": "2023",
    "2O24": "2024",
    "2O25": "2025",

    # --- Common OCR misreads for wine terms ---
    "Sauv1gnon": "Sauvignon",
    "Cab3rnet": "Cabernet",
    "Chardonnav": "Chardonnay",
    "Chardonney": "Chardonnay",
    "Merlct": "Merlot",
    "Sauvlgnon": "Sauvignon",
    "Ries1ing": "Riesling",
    "Reisling": "Riesling",
    "Riesllng": "Riesling",
    "Plnot": "Pinot",
    "Pin0t": "Pinot",
    "B0rdeaux": "Bordeaux",
    "Bordeauz": "Bordeaux",
    "Bourgoqne": "Bourgogne",
    "Bourgcgne": "Bourgogne",
    "Champaone": "Champagne",
    "Champaqne": "Champagne",
    "Proseccc": "Prosecco",
    "Pr0secco": "Prosecco",
    "Zinfande1": "Zinfandel",
    "Zinfandei": "Zinfandel",
    "Sangiovess": "Sangiovese",
    "Nebbio1o": "Nebbiolo",
    "Tempranl11o": "Tempranillo",
    "Grenacne": "Grenache",
    "Rieslling": "Riesling",

    # --- Missing accents (OCR frequently drops diacritics) ---
    "Chateau": "Château",
    "chateau": "château",
    "Cote": "Côte",
    "cote": "côte",
    "Cotes": "Côtes",
    "cotes": "côtes",
    "Cremant": "Crémant",
    "cremant": "crémant",
    "Rose": "Rosé",
    "rose": "rosé",
    "Beaune": "Beaune",
    "Medoc": "Médoc",
    "medoc": "médoc",
    "Pessac-Leognan": "Pessac-Léognan",
    "Saint-Emilion": "Saint-Émilion",
    "saint-emilion": "saint-émilion",
    "Montrachet": "Montrachet",
    "Gewurztraminer": "Gewürztraminer",
    "Muller-Thurgau": "Müller-Thurgau",
    "Grüner": "Grüner",
    "Gruner": "Grüner",
    "Kumkapi": "Kumkapı",
    "Sarap": "Şarap",

    # --- Currency / symbol misreads ---
    "S ": "$ ",
    "€ ": "€ ",
    "£ ": "£ ",
    "TL ": "₺ ",
}


# =============================================================================
# ACCENT NORMALIZATION MAP
# =============================================================================

ACCENT_MAP: Dict[str, str] = {
    "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a",
    "è": "e", "é": "e", "ê": "e", "ë": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o",
    "ù": "u", "ú": "u", "û": "u", "ü": "u",
    "ñ": "n",
    "ç": "c",
    "ğ": "g",
    "ş": "s",
    "ı": "i",
    "ß": "ss",
    "æ": "ae",
    "ø": "o",
    "ð": "d",
    "þ": "th",
    "œ": "oe",
}


# =============================================================================
# WINE TYPE KEYWORDS (for inferring wine type from text)
# =============================================================================

WINE_TYPE_KEYWORDS: Dict[str, List[str]] = {
    "red": [
        "red", "rouge", "rojo", "rosso", "kirmizi", "kırmızı", "rot", "tinto",
        "cabernet", "merlot", "pinot noir", "syrah", "shiraz", "malbec",
        "sangiovese", "nebbiolo", "tempranillo", "zinfandel", "grenache",
        "mourvedre", "barbera", "primitivo", "carmenere", "petit verdot",
    ],
    "white": [
        "white", "blanc", "blanco", "bianco", "beyaz", "weiss", "weiß", "branco",
        "chardonnay", "sauvignon blanc", "riesling", "pinot grigio", "pinot gris",
        "viognier", "gewurztraminer", "albarino", "verdejo", "gruner veltliner",
        "trebbiano", "vermentino", "muscadet", "chenin blanc", "semillon",
    ],
    "rose": [
        "rose", "rosé", "rosato", "rosado", "roze",
    ],
    "sparkling": [
        "sparkling", "champagne", "prosecco", "cava", "cremant", "crémant",
        "sekt", "spumante", "brut", "extra brut", "brut nature", "metodo classico",
        "methode traditionnelle", "methode champenoise", "blanc de blancs",
        "blanc de noirs", "dosage zero",
    ],
    "dessert": [
        "dessert", "sweet", "port", "porto", "sherry", "madeira", "sauternes",
        "tokaji", "ice wine", "eiswein", "vin santo", "moscato d'asti",
        "late harvest", "vendange tardive", "selection de grains nobles",
        "trockenbeerenauslese", "beerenauslese", "auslese",
    ],
    "fortified": [
        "fortified", "port", "porto", "sherry", "madeira", "marsala",
        "vermouth", "vin doux naturel",
    ],
}


# =============================================================================
# NORMALIZER CLASS
# =============================================================================

class WineTextNormalizer:
    """
    Multi-step text normalization pipeline for wine OCR text.
    
    Pipeline:
    1. Unicode normalization
    2. OCR error correction
    3. Abbreviation expansion
    4. Accent-aware normalization (preserves original + creates normalized)
    5. Token-order-independent preparation
    """

    def __init__(
        self,
        abbreviations: Optional[Dict[str, str]] = None,
        ocr_corrections: Optional[Dict[str, str]] = None,
    ):
        self.abbreviations = abbreviations or WINE_ABBREVIATIONS
        self.ocr_corrections = ocr_corrections or OCR_CORRECTIONS

        # Pre-compile abbreviation patterns sorted by length (longest first).
        # Patterns use word-boundary anchors so short abbreviations like "ava"
        # don't match mid-word (e.g., inside "Kavaklidere").
        self._abbr_patterns: List[Tuple[re.Pattern, str]] = []
        sorted_abbrs = sorted(
            self.abbreviations.items(),
            key=lambda kv: len(kv[0]),
            reverse=True,
        )
        for abbr, expansion in sorted_abbrs:
            escaped = re.escape(abbr.strip("."))
            # Use word boundaries; trailing dot variants already stripped above
            pattern = re.compile(r"(?<!\w)" + escaped + r"(?!\w)", re.IGNORECASE)
            self._abbr_patterns.append((pattern, expansion))

        # Pre-compile OCR correction patterns sorted by length (longest first)
        self._ocr_patterns: List[Tuple[re.Pattern, str]] = []
        sorted_corrections = sorted(
            self.ocr_corrections.items(),
            key=lambda kv: len(kv[0]),
            reverse=True,
        )
        for wrong, correct in sorted_corrections:
            # Case-sensitive for OCR corrections (digit/letter swaps are case-sensitive)
            pattern = re.compile(re.escape(wrong))
            self._ocr_patterns.append((pattern, correct))

    # ---- Public API ----

    def normalize(self, text: str) -> Dict[str, str]:
        """
        Full normalization pipeline.

        Returns:
            Dict with keys:
            - 'original': original input text
            - 'corrected': after OCR correction + abbreviation expansion (display-quality)
            - 'normalized': lowercased, accent-stripped, for matching
            - 'tokens_sorted': space-joined sorted tokens, for order-independent matching
        """
        if not text or not text.strip():
            return {
                "original": text or "",
                "corrected": "",
                "normalized": "",
                "tokens_sorted": "",
            }

        original = text.strip()

        # Step 1: Unicode normalization (NFC form)
        step1 = unicodedata.normalize("NFC", original)

        # Step 2: OCR error correction
        step2 = self._apply_ocr_corrections(step1)

        # Step 3: Abbreviation expansion
        step3 = self._expand_abbreviations(step2)

        # Clean up whitespace
        corrected = re.sub(r"\s+", " ", step3).strip()

        # Step 4: Accent-stripped lowercase form for matching
        normalized = self._strip_accents_and_lower(corrected)
        normalized = re.sub(r"[^\w\s\-]", "", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()

        # Step 5: Token-order-independent form
        tokens = sorted(set(normalized.split()))
        tokens_sorted = " ".join(tokens)

        return {
            "original": original,
            "corrected": corrected,
            "normalized": normalized,
            "tokens_sorted": tokens_sorted,
        }

    def correct_ocr(self, text: str) -> str:
        """Apply only OCR error corrections (step 2)."""
        return self._apply_ocr_corrections(text)

    def expand_abbreviations(self, text: str) -> str:
        """Apply only abbreviation expansion (step 3)."""
        return self._expand_abbreviations(text)

    def normalize_for_matching(self, text: str) -> str:
        """Quick path: lowercase + strip accents + remove punctuation."""
        lowered = text.lower().strip()
        stripped = self._strip_accents_and_lower(lowered)
        return re.sub(r"[^\w\s\-]", "", stripped).replace("  ", " ").strip()

    def tokens_sorted(self, text: str) -> str:
        """Return sorted unique tokens for order-independent matching."""
        normalized = self.normalize_for_matching(text)
        return " ".join(sorted(set(normalized.split())))

    def infer_wine_type(self, text: str) -> Optional[str]:
        """
        Infer wine type (red/white/rose/sparkling/dessert/fortified)
        from text using keyword matching.
        """
        lower = text.lower()
        scores: Dict[str, int] = {}
        for wine_type, keywords in WINE_TYPE_KEYWORDS.items():
            count = sum(1 for kw in keywords if kw in lower)
            if count > 0:
                scores[wine_type] = count

        if not scores:
            return None
        return max(scores, key=scores.get)  # type: ignore[arg-type]

    def extract_vintage(self, text: str) -> Optional[int]:
        """Extract a 4-digit vintage year from text."""
        match = re.search(r"\b(19\d{2}|20[0-3]\d)\b", text)
        if match:
            return int(match.group(1))
        # Handle 2-digit shorthand: "15" → 2015
        short_match = re.search(r"(?:^|\s)\'?(\d{2})(?:\s|$)", text)
        if short_match:
            year_short = int(short_match.group(1))
            if 0 <= year_short <= 30:
                return 2000 + year_short
            elif 50 <= year_short <= 99:
                return 1900 + year_short
        return None

    def extract_price(self, text: str) -> Optional[Tuple[float, str]]:
        """
        Extract price and currency from text.
        Returns (price, currency_code) or None.
        """
        patterns = [
            (r"\$\s*([\d,]+\.?\d{0,2})", "USD"),
            (r"([\d,]+\.?\d{0,2})\s*\$", "USD"),
            (r"€\s*([\d,]+\.?\d{0,2})", "EUR"),
            (r"([\d,]+\.?\d{0,2})\s*€", "EUR"),
            (r"£\s*([\d,]+\.?\d{0,2})", "GBP"),
            (r"([\d,]+\.?\d{0,2})\s*£", "GBP"),
            (r"₺\s*([\d,]+\.?\d{0,2})", "TRY"),
            (r"([\d,]+\.?\d{0,2})\s*₺", "TRY"),
            (r"([\d,]+\.?\d{0,2})\s*TL", "TRY"),
        ]
        for pattern, currency in patterns:
            match = re.search(pattern, text)
            if match:
                price_str = match.group(1).replace(",", "")
                try:
                    return (float(price_str), currency)
                except ValueError:
                    continue
        return None

    # ---- Private helpers ----

    def _apply_ocr_corrections(self, text: str) -> str:
        """Apply OCR error corrections."""
        result = text
        for pattern, replacement in self._ocr_patterns:
            result = pattern.sub(replacement, result)
        return result

    def _expand_abbreviations(self, text: str) -> str:
        """Expand known abbreviations."""
        result = text
        for pattern, expansion in self._abbr_patterns:
            result = pattern.sub(expansion, result)
        return result

    @staticmethod
    def _strip_accents_and_lower(text: str) -> str:
        """Remove diacritics/accents and lowercase."""
        lowered = text.lower()
        result = []
        for char in lowered:
            if char in ACCENT_MAP:
                result.append(ACCENT_MAP[char])
            else:
                # Use Unicode decomposition as fallback
                nfkd = unicodedata.normalize("NFKD", char)
                stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
                result.append(stripped)
        return "".join(result)


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_normalizer_instance: Optional[WineTextNormalizer] = None


def get_normalizer() -> WineTextNormalizer:
    """Get module-level singleton normalizer."""
    global _normalizer_instance
    if _normalizer_instance is None:
        _normalizer_instance = WineTextNormalizer()
    return _normalizer_instance
