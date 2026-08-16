#!/usr/bin/env python3
"""Score candidate identity policies against the labelled set.

Reports, for each policy, how many provably-distinct products it would fuse
(false merges -- silent, global, unrecoverable) and how many provably-same
products it would keep apart (false splits -- visible, cheap, recoverable).

These two errors are not symmetric and must never be summed into one score.
"""
from __future__ import annotations

import collections
import difflib
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVAL = ROOT / "datasets/merge_eval/entries.json"


def norm(value) -> str:
    s = unicodedata.normalize("NFD", str(value or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


# --- the proposed rule -----------------------------------------------------
# A closed, versioned equivalence relation. Every entry is a claim that two
# spellings mean the same thing, and each must survive this evaluation.
EQUIV = {"yrs": "yr", "year": "yr", "years": "yr", "yo": "yr"}
# Tokens carrying no identity. Deliberately tiny. 'label' is here because
# "Johnnie Walker Blue" and "Johnnie Walker Blue Label" are one product.
# 'black' and 'blue' are NOT here, and never will be -- that is the point.
NOISE = {"the", "label", "co", "company", "distillery", "distillers", "and"}


def tokens(text: str) -> list[str]:
    t = norm(text)
    t = re.sub(r"(\d)\s*(yr|yrs|year|years|yo)\b", r"\1 yr", t)
    t = re.sub(r"(?<=\d)(?=[a-z])", " ", t)      # unglue 12yr, 107proof
    out = []
    for word in t.split():
        word = EQUIV.get(word, word)
        if word and word not in NOISE:
            out.append(word)
    return out


def residual_key(entry: dict):
    """brand + the COMPLETE multiset of every remaining token, plus vintage.

    Nothing is dropped for being unrecognised. An unknown token is assumed to
    discriminate, so a gap in EQUIV/NOISE costs a false split, never a false
    merge. Incompleteness fails safe.
    """
    producer_tokens = tokens(entry["producer"])
    rest = collections.Counter(tokens(entry["name"]))
    for token in producer_tokens:
        if rest[token]:
            rest[token] -= 1
    return (
        tuple(producer_tokens),
        frozenset((k, v) for k, v in rest.items() if v > 0),
        entry.get("vintage"),
    )


def signature_key(entry: dict):
    """Today's wine signature: exact normalised producer + name + vintage."""
    return (norm(entry["producer"]), norm(entry["name"]), entry.get("vintage"))


def fuzzy_factory(threshold: float):
    def same(a: dict, b: dict) -> bool:
        if a.get("vintage") != b.get("vintage"):
            return False
        ta = norm(f"{a['producer']} {a['name']}")
        tb = norm(f"{b['producer']} {b['name']}")
        return difflib.SequenceMatcher(None, ta, tb).ratio() >= threshold
    return same


def main() -> None:
    entries = json.loads(EVAL.read_text())
    by_menu: dict[str, list[dict]] = collections.defaultdict(list)
    for entry in entries:
        if not entry["under_identified"]:
            by_menu[entry["menu"]].append(entry)

    def full(e):
        return norm(f"{e['producer']} {e['name']}")

    adjudicated = json.loads((EVAL.parent / "adjudicated.json").read_text())
    excused = {
        frozenset((norm(f"{x['a']['producer']} {x['a']['name']}"),
                   norm(f"{x['b']['producer']} {x['b']['name']}")))
        for x in adjudicated["mislabeled_negatives"]
    }

    negatives = []
    for rows in by_menu.values():
        for i, a in enumerate(rows):
            for b in rows[i + 1:]:
                if full(a) != full(b) and frozenset((full(a), full(b))) not in excused:
                    negatives.append((a, b))

    def canon_loose(text: str) -> str:
        for pattern, repl in (
            (r"\byrs?\b|\byears?\b|\byo\b", "yr"), (r"\bthe\b", ""),
            (r"\blabel\b", ""), (r"\bsingle malt\b", ""),
            (r"\bscotch\b|\bwhisky\b|\bwhiskey\b|\bbourbon\b", ""),
            (r"\bold\b", ""), (r"\s+", " "),
        ):
            text = re.sub(pattern, repl, text)
        return text.strip()

    buckets: dict[str, list[dict]] = collections.defaultdict(list)
    for entry in entries:
        if not entry["under_identified"]:
            buckets[canon_loose(full(entry))].append(entry)
    positives = [
        (a, b)
        for rows in buckets.values()
        for i, a in enumerate(rows)
        for b in rows[i + 1:]
        if a["menu"] != b["menu"] and full(a) != full(b)
    ]

    print(f"negatives (provably different): {len(negatives):,}")
    print(f"positives (provably same)     : {len(positives)}\n")
    print(f"{'policy':<40}{'false MERGES':>14}{'false splits':>14}")
    print("-" * 68)

    policies = [
        ("exact signature (today, wine)", lambda a, b: signature_key(a) == signature_key(b)),
        ("residual-token key (proposed)", lambda a, b: residual_key(a) == residual_key(b)),
    ] + [
        (f"fuzzy similarity >= {t:.2f}", fuzzy_factory(t))
        for t in (0.98, 0.95, 0.90, 0.85)
    ]

    for label, same in policies:
        fm = sum(1 for a, b in negatives if same(a, b))
        fs = sum(1 for a, b in positives if not same(a, b))
        flag = "  <-- unusable" if fm else ""
        print(f"{label:<40}{fm:>14,}{fs:>14}{flag}")

    print("\nfalse merges by category (proposed rule):")
    counts = collections.Counter(
        a["category"] for a, b in negatives if residual_key(a) == residual_key(b)
    )
    print(f"  {dict(counts) or 'none in any category'}")

    keys = collections.defaultdict(set)
    for entry in entries:
        if not entry["under_identified"]:
            keys[residual_key(entry)].add(entry["menu"])
    print(f"\ndedup value retained: {len(entries):,} rows -> {len(keys):,} products; "
          f"{sum(1 for v in keys.values() if len(v) > 1):,} appear on more than one menu")


if __name__ == "__main__":
    main()
