"""The Python mirrors of the shared letter fold (QA round 1, B-1).

Letters Unicode NFD cannot decompose (Turkish dotless "ı") are folded by ONE
table, UNDECOMPOSABLE_LETTERS in apps/api-gateway/src/common/fold-letters.ts,
and its SQL twin public.fold_undecomposable_letters(). Python cannot import the
TypeScript, so each mirror keeps its own copy; this reads the TypeScript table
and requires every importable mirror to fold exactly those letters, and to fold
them where the SQL does (after the mark strip, before lower()).

scripts/load_enriched_wines.py is not imported here (it needs psycopg2); its
copy is checked as source text by fold-letters.spec.ts.

    python3 -m pytest scripts/test_fold_letters_mirrors.py -q
"""

from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

from scripts.synth.identity import wine_normalize_text

REPO_ROOT = Path(__file__).resolve().parents[1]
FOLD_TS = REPO_ROOT / "apps" / "api-gateway" / "src" / "common" / "fold-letters.ts"


def _ts_table() -> dict[str, str]:
    src = FOLD_TS.read_text(encoding="utf-8")
    body = src[src.index("UNDECOMPOSABLE_LETTERS") :]
    body = body[: body.index("];")]
    pairs = re.findall(r'\[\s*"\\u([0-9a-fA-F]{4})",\s*"([^"]*)"\s*\]', body)
    assert pairs, "no letters found in UNDECOMPOSABLE_LETTERS"
    return {chr(int(code, 16)): fold for code, fold in pairs}


def _eval_module():
    spec = importlib.util.spec_from_file_location(
        "eval_merge_policies", REPO_ROOT / "scripts" / "eval_merge_policies.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_typescript_table_is_the_dotless_i_fold():
    assert _ts_table() == {"\u0131": "i"}


@pytest.mark.parametrize("letter,fold", sorted(_ts_table().items()))
def test_beverage_norm_folds_every_shared_letter(letter, fold):
    # norm() is byte-parity with beverage_normalize_text (the 0a gate's key).
    norm = _eval_module().norm
    assert norm(f"x{letter}y") == f"x{fold}y"
    assert norm(f"X{letter.upper()}Y") == norm(f"x{letter}y")


@pytest.mark.parametrize("letter,fold", sorted(_ts_table().items()))
def test_wine_normalize_text_folds_every_shared_letter(letter, fold):
    assert wine_normalize_text(f"x{letter}y") == f"x{fold}y"


def test_menu_and_invoice_spellings_key_together():
    norm = _eval_module().norm
    for mixed, capitals, expected in (
        ("Kavaklıdere", "KAVAKLIDERE", "kavaklidere"),
        ("Kalecik Karası", "KALECIK KARASI", "kalecik karasi"),
        ("Çalkarası", "ÇALKARASI", "calkarasi"),
    ):
        assert norm(mixed) == norm(capitals) == expected
        assert wine_normalize_text(mixed) == wine_normalize_text(capitals) == expected


def test_beverage_norm_still_does_not_expand_abbreviations():
    # The fold must not drag norm() toward wine_normalize_text: "St." stays
    # "st" here (20260817070000_beverages_table, the 67-divergence run).
    assert _eval_module().norm("St. Kavaklıdere") == "st kavaklidere"
