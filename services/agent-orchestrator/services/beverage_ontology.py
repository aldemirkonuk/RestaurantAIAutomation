"""
`beverage_ontology_v1` — hard domain rules for the beverages that are NOT wine
(ADR 0029 P3.B, FUTURES stage 1: full beverages).

WHY THIS EXISTS — THE MEASURED GAP
----------------------------------
ADR 0029 §2 places the beverage lane *alongside* the P3.0 gate because
"extraction with an oracle is the best second source of graded task types".
Checked before writing a line of this module, the oracle we have does not cover
beverages, and the way it fails is worse than a gap:

    OntologyValidationService.run_ontology_validation() hard-codes
    `checks_total = 4` (ontology_validation_service.py:585), and each of its
    four checkers returns None — indistinguishable from "passed" — when the
    field it needs is absent (:118, :183, :249, :328).

A single-malt Scotch has no appellation, no grape, no vintage and no colour, so
all four rules skip, `checks_failed` is 0, and `ontology_verdict(4, 0, 4)`
returns **success**. Reproduced 2026-08-27 on "Lagavulin 16 Year Old":

    RESULT: 4 0 4 failures= []
    VERDICT: {'outcome': 'success',
              'evidence': {'checks_passed': 4, 'checks_failed': 0,
                           'checks_total': 4}}

`ontology_verdict`'s own docstring anticipates exactly this — *"a wine with
three empty fields would otherwise score identically to one that satisfied every
rule"* — and guards it with a `checks_total == 0` branch that the live caller
can never reach, because the caller's `checks_total` is a constant. So the
strongest grader in the tree stamps a fabricated success on every non-wine row
it is handed.

That defect is in the WINE path and fixing it means changing the four checkers'
return contract; it is filed as a proposal, not fixed here (see
`.planning/04-specs/HANDOFF-p3b-beverages.md`). What this module does is refuse
to inherit it: **`checks_total` here counts the rules that actually RAN.** When
nothing could be checked, the verdict is `null`/untestable, never success.

WHAT MAKES A RULE ADMISSIBLE HERE
---------------------------------
The wine oracle earns the name because a Bordeaux appellation carrying a
Nebbiolo grape is wrong with no human in the loop. Every rule below meets the
same bar — arithmetic, a legally defined designation of origin, or a
self-contradiction inside one row:

  1. abv_proof         US proof is DEFINED as twice ABV. Arithmetic.
  2. abv_category      A distilled spirit at 3% ABV is not a distilled spirit.
  3. protected_origin  Bourbon must be made in the USA (27 CFR 5.22), Scotch in
                       Scotland, Cognac in France, Tequila in Mexico. These are
                       law, not taste.
  4. age_statement     A bottle whose name says "16 year old" and whose
                       age_years says 12 contradicts itself.
  5. volume_unit       A 0.75 ml bottle is a unit error, not a small bottle.

EVERY RULE IS SELF-GROUNDING, AND THAT IS DELIBERATE
----------------------------------------------------
No rule fires on a classification column. Each fires only when the row itself
carries positive evidence for it — a recognised category token AND the number
the rule needs. The first draft keyed the ABV band on `beverage_kind`, which
would have been a SECOND home for the classifier that
`20260817060000_beverage_kind_classification.sql` already owns in PL/pgSQL, and
this repository has been closing "one fact, two homes" everywhere else. Grounding
each rule in its own row removes the need for the classifier entirely.

Bare integers are never read as ages. BEVERAGE_CATALOGUE_ARCHITECTURE.md:190
measured what that costs: *"`Weller 107` is a proof, `Macallan 12` is an age"* —
one token shape, four meanings. Only an explicit unit ("12 yr", "16 year old")
counts.

And what a rule may read is not uniform, because a NAME is weaker evidence than
a DECLARED TYPE. `_NAME_UNSAFE_CATEGORIES` and `check_protected_origin` carry
the three real bottles that forced the distinction — `Port Charlotte 10`,
`Glenfiddich 15 Solera Sherry Cask`, `Balvenie Cognac Cask Finish` — each of
which an earlier, name-reading draft marked CRITICAL. None was a data error;
all three were this module guessing from a proper noun.

WINE ROWS ARE NOT GRADED HERE
-----------------------------
`applies_to_row()` returns False when the row carries a grape, an appellation or
a real vintage — the fields the wine oracle needs. The two graders are made
non-overlapping by construction, so this one covers precisely the rows the wine
one cannot examine, and a wine never picks up a second, weaker verdict.
"""

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

BEVERAGE_ONTOLOGY_BASIS = "beverage_ontology_v1"

#: Above 96% is past the ethanol/water azeotrope at atmospheric pressure — not a
#: strong spirit, a bad number.
_ABV_CEILING = 96.0

#: Fields that DECLARE a type, as opposed to naming a product. These are the
#: same signals, in the same order, that `wine_classify_beverage_kind` uses in
#: `20260817060000_beverage_kind_classification.sql`.
#:
#: `producer` and `description` are on NEITHER list and are read by no rule.
#: Producer names are proper nouns that collide with category tokens — `Port
#: Ellen` and `Bourbon Brothers` are real distilleries — and `description` is
#: free prose, where "finished in sherry casks" appears constantly.
_CLASSIFYING_FIELDS = (
    "primary_type",
    "beverage_type",
    "menu_category",
)

#: Categories that a bottle's NAME may not assert — only a declared type may.
#:
#: The first draft let names assert anything. Working real products through it
#: found the systematic defeater: **every fortified-wine token doubles as a cask
#: name or a place name**, and cask-finish naming is ubiquitous in spirits.
#: Three genuine bottles, all of which a name-reading version failed:
#:
#:   * `Port Charlotte 10` — Bruichladdich, ~50% ABV. "port" bands it at
#:     15-24% and fails it.
#:   * `Port Ellen 1983` — a closed Islay distillery, ~55% ABV. Same.
#:   * `Glenfiddich 15 Solera Sherry Cask` — "sherry" names the cask, not the
#:     drink.
#:
#: The exclusion is one category rather than a hand-tuned token allowlist,
#: because the reason is structural: this whole category's vocabulary is
#: borrowed by the cask trade. Everything else a name can say — "single malt",
#: "IPA", "lager", "gin" — is a style, not a place, and stays usable, which is
#: what keeps the rule firing on rows whose only text is a name.
#:
#: `protected_origin` goes further and reads no name at all: cask-finish naming
#: defeats every designation token, not merely the fortified ones — "Cognac Cask
#: Finish" on a Scotch would demand France.
_NAME_UNSAFE_CATEGORIES = frozenset({"fortified_wine"})

#: The age-statement rule reads the NAME instead, and is the one rule that
#: safely can: its token must carry an explicit unit ("16 year old"), so it
#: disambiguates itself rather than relying on the field it came from. A number
#: in a menu section header is not a bottle's age, hence name fields only.
_NAME_FIELDS = ("name", "display_name")

#: US proof is exactly twice ABV (27 CFR 5.1). Labels round, so a discrepancy
#: under this many proof points is rounding, not an error.
_PROOF_TOLERANCE = 1.0

#: Imperial ("sikes") proof is ABV x 7/4. A value matching THAT convention in a
#: column that means US proof is still wrong, but it is a different mistake and
#: is reported under its own name rather than as a random mismatch.
_IMPERIAL_PROOF_RATIO = 7.0 / 4.0

#: Smallest real commercial format is a 50 ml miniature; largest named bottle is
#: the 30 L Melchizedek. Outside this is a unit error (litres typed as ml, or ml
#: typed as litres), which is why the severity is `warning`, not `critical`.
_VOLUME_MIN_ML = 30
_VOLUME_MAX_ML = 30000

#: Category -> (min_abv, max_abv). Bands are deliberately WIDE: the rule exists
#: to catch a number in the wrong unit or attached to the wrong bottle, not to
#: adjudicate style. A band that excluded a real product would be a false
#: positive, and a false positive here is worse than a gap — it is the thing
#: ADR 0020 forbids, a fabricated verdict, pointed the other way.
_CATEGORY_ABV_BANDS: Dict[str, Tuple[float, float]] = {
    # Distilled spirits. US minimum bottling strength is 40% for most named
    # types; 15% is far below any of them and still leaves room for a
    #  low-strength outlier without admitting a beer.
    "spirit": (15.0, _ABV_CEILING),
    # Liqueurs and cream liqueurs run low; amari and chartreuse run high.
    "liqueur": (10.0, 60.0),
    # Beer. The strongest commercial beers are freeze-concentrated stunts in the
    # 40-60% range, so this band admits them rather than calling them errors.
    "beer": (0.0, 67.5),
    "cider": (0.5, 14.0),
    "sake": (5.0, 22.0),
    # Fortified wine is the reason wine is not one band: Port and Sherry sit
    # above unfortified wine's ceiling.
    "fortified_wine": (15.0, 24.0),
    "vermouth": (14.5, 22.0),
    # Alcohol-free. The US and EU thresholds differ (0.5%); anything above it is
    # not the thing the label says it is.
    "non_alcoholic": (0.0, 0.5),
}

#: Category tokens, matched on whole words against the row's name/type text.
#: Only tokens whose presence is strong evidence of the category are listed —
#: "reserve", "select", "old" and friends say nothing and are absent on purpose.
_CATEGORY_TOKENS: Dict[str, Tuple[str, ...]] = {
    "spirit": (
        "whiskey",
        "whisky",
        "bourbon",
        "scotch",
        "rye",
        "vodka",
        "gin",
        "rum",
        "tequila",
        "mezcal",
        "brandy",
        "cognac",
        "armagnac",
        "calvados",
        "grappa",
        "pisco",
        "cachaca",
        "aquavit",
        "akvavit",
        "genever",
        "shochu",
        "baijiu",
        "eau de vie",
        "single malt",
        "blended malt",
    ),
    "liqueur": (
        "liqueur",
        "amaro",
        "amaretto",
        "curacao",
        "triple sec",
        "creme de",
        "schnapps",
        "sambuca",
        "ouzo",
        "limoncello",
        "aperitif",
        "aperitivo",
    ),
    "beer": (
        "beer",
        "lager",
        "pilsner",
        "pilsener",
        "ale",
        "ipa",
        "stout",
        "porter",
        "saison",
        "witbier",
        "hefeweizen",
        "kolsch",
        "gose",
        "lambic",
        "tripel",
        "dubbel",
        "quadrupel",
    ),
    "cider": ("cider", "cidre", "sidra", "perry", "poire"),
    "sake": ("sake", "junmai", "ginjo", "daiginjo", "nigori", "honjozo"),
    "fortified_wine": (
        "port",
        "sherry",
        "madeira",
        "marsala",
        "tawny",
        "oloroso",
        "amontillado",
        "fino",
        "manzanilla",
        "pedro ximenez",
    ),
    "vermouth": ("vermouth", "vermut", "americano"),
    "non_alcoholic": (
        "non alcoholic",
        "nonalcoholic",
        "alcohol free",
        "alcohol removed",
        "dealcoholized",
        "zero proof",
        "spirit free",
        "mocktail",
    ),
}

#: Legally defined designations of origin. Each maps a token to the set of
#: countries that may lawfully produce it. Only designations with a real legal
#: instrument are listed: "rum", "gin", "vodka" and "whisky" (unqualified) are
#: NOT origin-protected and are absent, as is "sake", which is made outside
#: Japan. An entry here is a claim about law, so each carries its instrument.
_PROTECTED_ORIGIN: Dict[str, Tuple[Tuple[str, ...], str]] = {
    # 27 CFR 5.22(b)(1)(i) — bourbon is a product of the United States.
    "bourbon": (("us",), "27 CFR 5.22(b)(1)(i)"),
    "tennessee whiskey": (("us",), "27 CFR 5.22 / TN Code 57-3-101(a)(2)"),
    # Scotch Whisky Regulations 2009.
    "scotch": (("gb",), "Scotch Whisky Regulations 2009"),
    # Irish Whiskey Technical File (2014); made in Ireland or Northern Ireland.
    "irish whiskey": (("ie", "gb"), "Irish Whiskey Technical File 2014"),
    "irish whisky": (("ie", "gb"), "Irish Whiskey Technical File 2014"),
    # EU 2019/787 Annex III geographical indications.
    "cognac": (("fr",), "EU 2019/787 GI"),
    "armagnac": (("fr",), "EU 2019/787 GI"),
    "calvados": (("fr",), "EU 2019/787 GI"),
    "grappa": (("it",), "EU 2019/787 GI"),
    # NOM 006-SCFI-2005 / CRT.
    "tequila": (("mx",), "NOM-006-SCFI-2005"),
    "mezcal": (("mx",), "NOM-070-SCFI-2016"),
    # Brazilian designation, recognised by the US under the 2013 agreement.
    "cachaca": (("br",), "Decreto 4.851/2003"),
    # DO Jerez / DOC Porto / DOP Madeira.
    "sherry": (("es",), "DO Jerez-Xeres-Sherry"),
    "madeira": (("pt",), "DOP Madeira"),
}

#: Country free text -> ISO 3166-1 alpha-2. Deliberately its own table rather
#: than a reuse of `ontology_validation_service._COUNTRY_NAME_TO_CODE`: that one
#: covers wine-producing countries and has no entry for Scotland, Mexico, Japan
#: or Brazil, which is most of what this module needs.
_COUNTRY_ALIASES: Dict[str, str] = {
    "united states": "us",
    "united states of america": "us",
    "usa": "us",
    "us": "us",
    "u s a": "us",
    "america": "us",
    "scotland": "gb",
    "united kingdom": "gb",
    "uk": "gb",
    "gb": "gb",
    "great britain": "gb",
    "england": "gb",
    "wales": "gb",
    "northern ireland": "gb",
    "ireland": "ie",
    "eire": "ie",
    "republic of ireland": "ie",
    "ie": "ie",
    "france": "fr",
    "fr": "fr",
    "italy": "it",
    "italia": "it",
    "it": "it",
    "mexico": "mx",
    "mx": "mx",
    "brazil": "br",
    "brasil": "br",
    "br": "br",
    "spain": "es",
    "espana": "es",
    "es": "es",
    "portugal": "pt",
    "pt": "pt",
    "japan": "jp",
    "jp": "jp",
}

#: An age statement needs an explicit unit. `Macallan 12` is an age, `Weller
#: 107` is a proof and `Buffalo Trace 1792` is neither — one token shape, four
#: meanings (BEVERAGE_CATALOGUE_ARCHITECTURE.md:190). Only the unit disambiguates,
#: so only the unit is accepted.
_AGE_STATEMENT = re.compile(
    r"\b(\d{1,3})\s*-?\s*(?:yr|yrs|yo|year|years)\b(?:\s*-?\s*old)?", re.IGNORECASE
)

#: Fields whose presence means the WINE oracle can examine this row, so this one
#: must not. Kept beside `applies_to_row` so the two never drift.
_WINE_ONLY_FIELDS = ("grape_variety", "appellation")


def _strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text) if not unicodedata.combining(ch)
    )


def normalize_text(text: Optional[str]) -> str:
    """Lowercase, de-accent, collapse non-alphanumerics to single spaces.

    Mirrors `beverage_normalize_text` in
    `supabase/migrations/20260817070000_beverages_table.sql` in intent, not in
    code: that function is IMMUTABLE SQL used for identity keys and must stay
    byte-compatible with `scripts/eval_merge_policies.py`. This one only feeds
    whole-word token matching, so it additionally collapses separators — which
    the identity function must not do. They are not two homes for one fact; they
    answer different questions.
    """
    if not text or isinstance(text, (dict, list, tuple, set)):
        return ""
    lowered = _strip_accents(str(text)).lower()
    return re.sub(r"[^a-z0-9]+", " ", lowered).strip()


def _as_float(value: Any) -> Optional[float]:
    """Best-effort numeric read. `"43.5%"` and `"43,5"` both appear in extracted
    text; a value that is not a number at all yields None, which makes the rule
    SKIP rather than fail — an unparseable field is not evidence of an error."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (dict, list, tuple, set)):
        # A caller that forgot to unwrap `{value, confidence, source}` must get
        # a SKIP, never a number scraped out of the repr — a confidence of 0.95
        # read as an ABV would invent a failure out of nothing.
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "").replace(",", ".")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _contains_token(haystack: str, token: str) -> bool:
    """Whole-word containment on already-normalized text.

    Substring matching would fire "ale" inside "Chardonnay"-adjacent words and
    "port" inside "Portugal"; both were reachable with the token lists above, so
    the boundaries are load-bearing rather than stylistic.
    """
    return (
        re.search(rf"(?<![a-z0-9]){re.escape(token)}(?![a-z0-9])", haystack) is not None
    )


def detect_categories(text: str) -> List[str]:
    """Categories with positive token evidence in `text`, in table order."""
    normalized = normalize_text(text)
    if not normalized:
        return []
    return [
        category
        for category, tokens in _CATEGORY_TOKENS.items()
        if any(_contains_token(normalized, token) for token in tokens)
    ]


def normalize_country(value: Optional[str]) -> Optional[str]:
    """Free-text country to ISO alpha-2, or None when unrecognised.

    None means SKIP, never fail: an unmapped country is our gap, not the row's
    error, and a rule that failed on it would be punishing the data for this
    table's incompleteness.
    """
    normalized = normalize_text(value)
    return _COUNTRY_ALIASES.get(normalized) if normalized else None


class BeverageCheckFailure:
    """One hard-rule violation. Shape mirrors `OntologyCheckFailure` so a reader
    moving between the two oracles is not re-learning a vocabulary."""

    __slots__ = ("check", "severity", "expected", "found", "message")

    def __init__(
        self,
        check: str,
        severity: str,
        message: str,
        expected: Optional[str] = None,
        found: Optional[str] = None,
    ) -> None:
        self.check = check
        self.severity = severity
        self.message = message
        self.expected = expected
        self.found = found

    def to_dict(self) -> Dict[str, Any]:
        return {
            "check": self.check,
            "severity": self.severity,
            "expected": self.expected,
            "found": self.found,
            "message": self.message,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<BeverageCheckFailure {self.check} {self.severity}: {self.message}>"


#: A rule returns (ran, failure). `ran=False` means the rule could not be
#: applied and is counted in NEITHER passed nor total — the distinction the wine
#: path loses by hard-coding `checks_total = 4`.
CheckResult = Tuple[bool, Optional[BeverageCheckFailure]]

_SKIPPED: CheckResult = (False, None)


def check_abv_proof_consistency(abv_pct: Any, proof: Any) -> CheckResult:
    """US proof is defined as exactly twice ABV. Both numbers present and
    disagreeing is arithmetic, not judgement."""
    abv = _as_float(abv_pct)
    proof_value = _as_float(proof)
    if abv is None or proof_value is None:
        return _SKIPPED

    if abs(proof_value - 2.0 * abv) <= _PROOF_TOLERANCE:
        return (True, None)

    if abs(proof_value - _IMPERIAL_PROOF_RATIO * abv) <= _PROOF_TOLERANCE:
        return (
            True,
            BeverageCheckFailure(
                check="abv_proof",
                severity="critical",
                expected=f"{2.0 * abv:.1f} (US proof = 2 x ABV)",
                found=f"{proof_value:g}",
                message=(
                    f"proof {proof_value:g} matches the IMPERIAL convention "
                    f"(ABV x 7/4) for {abv:g}% ABV, but this column is US proof"
                ),
            ),
        )

    return (
        True,
        BeverageCheckFailure(
            check="abv_proof",
            severity="critical",
            expected=f"{2.0 * abv:.1f}",
            found=f"{proof_value:g}",
            message=(f"proof {proof_value:g} is not twice the stated ABV of {abv:g}%"),
        ),
    )


def check_abv_category_plausibility(
    text: Optional[str], abv_pct: Any, name_text: Optional[str] = None
) -> CheckResult:
    """ABV must sit inside the band for a category the row's own text names.

    `text` is the row's DECLARED type (`_CLASSIFYING_FIELDS`) and may assert any
    category. `name_text` is the bottle's name and may assert any category
    EXCEPT `fortified_wine` — see `_NAME_UNSAFE_CATEGORIES`.

    Skips unless exactly one category survives: "Sherry Cask Islay Single Malt"
    names two, and picking one of them would be a guess. Guessing is how a
    grader manufactures false positives.
    """
    abv = _as_float(abv_pct)
    if abv is None:
        return _SKIPPED

    detected = set(detect_categories(text or ""))
    detected |= {
        c
        for c in detect_categories(name_text or "")
        if c not in _NAME_UNSAFE_CATEGORIES
    }
    categories = [c for c in _CATEGORY_ABV_BANDS if c in detected]

    # `non_alcoholic` is a QUALIFIER, not a competing category — "Zero Proof
    # Gin", "Alcohol-Free Lager" and "Dealcoholized Riesling" all name a base
    # style and then negate it. Without this precedence every one of them would
    # detect two categories and skip, which would blank the rule on the product
    # class where it has the most to say: a "non-alcoholic beer" at 4.5% ABV is
    # a mislabelled bottle, and that is exactly the kind of error worth catching.
    if "non_alcoholic" in categories:
        categories = ["non_alcoholic"]

    if len(categories) != 1:
        return _SKIPPED

    category = categories[0]
    low, high = _CATEGORY_ABV_BANDS[category]
    if low <= abv <= high:
        return (True, None)

    return (
        True,
        BeverageCheckFailure(
            check="abv_category",
            severity="critical",
            expected=f"{low:g}-{high:g}% for {category}",
            found=f"{abv:g}%",
            message=(
                f"{abv:g}% ABV is outside the {low:g}-{high:g}% band that "
                f"{category} occupies"
            ),
        ),
    )


def check_protected_origin(text: Optional[str], country: Any) -> CheckResult:
    """A legally defined designation must match its country of origin.

    Skips when the row names more than one designation, when the country is
    absent, or when the country string is not in `_COUNTRY_ALIASES` — all three
    are missing evidence rather than a violation.
    """
    normalized = normalize_text(text)
    if not normalized:
        return _SKIPPED

    hits = [token for token in _PROTECTED_ORIGIN if _contains_token(normalized, token)]
    if len(hits) != 1:
        return _SKIPPED

    token = hits[0]
    allowed, instrument = _PROTECTED_ORIGIN[token]

    code = normalize_country(country)
    if code is None:
        return _SKIPPED

    if code in allowed:
        return (True, None)

    return (
        True,
        BeverageCheckFailure(
            check="protected_origin",
            severity="critical",
            expected="/".join(c.upper() for c in allowed),
            found=code.upper(),
            message=(
                f"'{token}' is a protected designation producible only in "
                f"{'/'.join(c.upper() for c in allowed)} ({instrument}); this row "
                f"claims {code.upper()}"
            ),
        ),
    )


def check_age_statement_consistency(text: Optional[str], age_years: Any) -> CheckResult:
    """An explicit age statement in the name must agree with the parsed age.

    Only "12 yr" / "16 year old" style tokens count. A bare integer is refused
    on the architecture's own measurement: `Weller 107` is a proof and
    `Buffalo Trace 1792` is a year (BEVERAGE_CATALOGUE_ARCHITECTURE.md:190).
    """
    parsed_age = _as_float(age_years)
    if parsed_age is None:
        return _SKIPPED

    normalized = normalize_text(text)
    if not normalized:
        return _SKIPPED

    matches = {int(m) for m in _AGE_STATEMENT.findall(normalized)}
    if len(matches) != 1:
        # Zero matches: nothing to compare. More than one ("12 yr" and "18 yr"
        # in one string) is an extraction artifact upstream of this rule, and
        # naming it here would be grading the wrong thing.
        return _SKIPPED

    stated = matches.pop()
    if abs(stated - parsed_age) < 0.5:
        return (True, None)

    return (
        True,
        BeverageCheckFailure(
            check="age_statement",
            severity="critical",
            expected=str(stated),
            found=f"{parsed_age:g}",
            message=(
                f"the name states a {stated} year age but age_years is "
                f"{parsed_age:g}"
            ),
        ),
    )


def check_volume_plausibility(volume_ml: Any) -> CheckResult:
    """A volume outside 30 ml - 30 L is a unit error, not a bottle.

    `warning`, not `critical`: the row is still the right bottle, the number is
    in the wrong unit. Severity is what tells a reader whether the identity is
    in doubt.
    """
    volume = _as_float(volume_ml)
    if volume is None:
        return _SKIPPED

    if _VOLUME_MIN_ML <= volume <= _VOLUME_MAX_ML:
        return (True, None)

    return (
        True,
        BeverageCheckFailure(
            check="volume_unit",
            severity="warning",
            expected=f"{_VOLUME_MIN_ML}-{_VOLUME_MAX_ML} ml",
            found=f"{volume:g} ml",
            message=(
                f"{volume:g} ml is outside every real commercial format — "
                f"almost certainly a unit error"
            ),
        ),
    )


def applies_to_row(fields: Dict[str, Any]) -> bool:
    """False when the WINE oracle can examine this row.

    A row carrying a grape variety, an appellation or a four-digit vintage is
    wine's to grade. Returning False means NO verdict is written at all, not an
    untestable one: an untestable row still counts as graded in
    `nf_a_verdict_coverage`, so emitting one for every wine would inflate the
    only number that currently tells the truth about coverage.
    """
    for field in _WINE_ONLY_FIELDS:
        if normalize_text(fields.get(field)):
            return False

    vintage = fields.get("vintage")
    normalized_vintage = normalize_text(vintage)
    if normalized_vintage and re.fullmatch(r"(19|20)\d{2}", normalized_vintage):
        return False

    return True


def run_beverage_ontology_checks(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Run every rule that CAN run over one beverage row.

    `fields` is source-agnostic on purpose — the same keys appear in
    `master_wine_library_submissions.field_confidence` (name, country,
    alcohol_pct) and on `public.beverages` (abv_pct, proof, age_years,
    volume_ml), so this runs over extraction output today and over catalogue
    rows when the beverage catalogue has a writer. Recognised keys:

        primary_type, beverage_type, menu_category   -> declared type; may
                                          assert any category
        name, display_name             -> the bottle's name; may assert a
                                          category except `fortified_wine`, and
                                          may never assert a designation
        alcohol_pct | abv_pct          -> ABV
        country                        -> the designation rule
        proof, age_years, volume_ml    -> the columns that exist on `beverages`

    `producer` and `description` are read by NOTHING here, deliberately — see
    `_CLASSIFYING_FIELDS` and `_NAME_UNSAFE_CATEGORIES`.

    Returns a dict, not a pydantic model, because it is written straight into
    `nf_verdict.evidence` as jsonb.
    """
    text = " ".join(str(fields.get(key) or "") for key in _CLASSIFYING_FIELDS).strip()
    name_text = " ".join(str(fields.get(key) or "") for key in _NAME_FIELDS).strip()

    abv = fields.get("alcohol_pct")
    if abv is None:
        abv = fields.get("abv_pct")

    results: List[Tuple[str, CheckResult]] = [
        ("abv_proof", check_abv_proof_consistency(abv, fields.get("proof"))),
        ("abv_category", check_abv_category_plausibility(text, abv, name_text)),
        ("protected_origin", check_protected_origin(text, fields.get("country"))),
        (
            "age_statement",
            check_age_statement_consistency(name_text, fields.get("age_years")),
        ),
        ("volume_unit", check_volume_plausibility(fields.get("volume_ml"))),
    ]

    ran = [(name, failure) for name, (did_run, failure) in results if did_run]
    failures = [failure for _name, failure in ran if failure is not None]

    return {
        "checks_total": len(ran),
        "checks_failed": len(failures),
        "checks_passed": len(ran) - len(failures),
        "checks_applied": [name for name, _failure in ran],
        "checks_skipped": [name for name, (did_run, _f) in results if not did_run],
        "failures": [failure.to_dict() for failure in failures],
    }
