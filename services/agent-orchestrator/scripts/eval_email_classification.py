#!/usr/bin/env python3
"""
Accuracy + cost sweep for EmailIntelAgent classification (ADR 0010 follow-up).

Answers one question: which model configuration gives the highest classification
accuracy per dollar, and where is the accuracy ceiling actually located?

Design note — each model is run over the fixture ONCE and per-email results are
persisted. Every cascade variant (tier pairing x confidence threshold) is then
simulated offline from those stored results, so exploring the whole cascade space
costs no additional API calls.

Usage:
    GEMINI_API_KEY=... python3 scripts/eval_email_classification.py
    python3 scripts/eval_email_classification.py --report-only   # re-analyse cached run

The fixture is tests/fixtures/email_classification_eval.jsonl. `difficulty` splits
the headline number from the genuinely ambiguous boundary cases — see the ceiling
discussion in ADR 0010.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

FIXTURE = ROOT / "tests" / "fixtures" / "email_classification_eval.jsonl"
HOLDOUT = ROOT / "tests" / "fixtures" / "email_classification_holdout.jsonl"
CACHE = ROOT / "tests" / "fixtures" / ".eval_run_cache.json"

# Only the shipped configuration. The candidate sweep that selected it
# (2.5-flash-lite, 3.1-flash-lite, 3.7-flash with and without thinking, plus
# confidence-gated cascades between them) is recorded in ADR 0010; re-add
# candidates here if the model choice is ever reopened.
#
# "off" suppresses reasoning tokens — Google bills thinking at the output rate,
# so it dominates cost on a task whose answer is ~80 tokens.
CONFIGS = [
    ("gemini-3.5-flash-lite", "off"),
]


def build_prompt(subject: str, body: str) -> str:
    """
    Uses the agent's own CLASSIFICATION_PROMPT — imported, never copied.

    A local copy would drift the moment production's prompt changed, and the eval
    would keep reporting a number for a string nothing sends.
    """
    from agents.email_intel_agent import CLASSIFICATION_PROMPT

    return CLASSIFICATION_PROMPT.format(subject=subject, body=body)


def load_cases(path: pathlib.Path = FIXTURE) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def run_config(client, gt, model: str, thinking: str, cases: list[dict]) -> list[dict]:
    safety = [
        gt.SafetySetting(category=c, threshold="BLOCK_ONLY_HIGH")
        for c in (
            "HARM_CATEGORY_DANGEROUS_CONTENT",
            "HARM_CATEGORY_HARASSMENT",
            "HARM_CATEGORY_HATE_SPEECH",
            "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        )
    ]
    if thinking == "off":
        tc = (
            gt.ThinkingConfig(thinking_budget=0)
            if model.startswith("gemini-2.5")
            else gt.ThinkingConfig(thinking_level="low")
        )
    else:
        tc = None

    def one(case: dict) -> dict:
        try:
            r = client.models.generate_content(
                model=model,
                contents=build_prompt(case["subject"], case["body"]),
                config=gt.GenerateContentConfig(
                    response_mime_type="application/json",
                    safety_settings=safety,
                    thinking_config=tc,
                ),
            )
            u = r.usage_metadata
            parsed = json.loads(r.text)
            return {
                "id": case["id"],
                "pred": parsed.get("category"),
                "confidence": float(parsed.get("confidence") or 0.0),
                "in_tok": u.prompt_token_count or 0,
                "out_tok": (u.candidates_token_count or 0)
                + (getattr(u, "thoughts_token_count", None) or 0),
            }
        except Exception as exc:  # noqa: BLE001 — eval script, record and continue
            return {
                "id": case["id"],
                "pred": "ERROR",
                "confidence": 0.0,
                "in_tok": 0,
                "out_tok": 0,
                "error": str(exc)[:160],
            }

    with ThreadPoolExecutor(max_workers=10) as ex:
        return list(ex.map(one, cases))


def cost_per_1k(results: list[dict], model: str) -> float:
    from services.spend_logger import estimate_llm_cost

    ain = statistics.mean(r["in_tok"] for r in results)
    aout = statistics.mean(r["out_tok"] for r in results)
    return estimate_llm_cost(model, ain, aout) * 1000


def score(results: list[dict], cases: list[dict]) -> dict:
    by_id = {c["id"]: c for c in cases}
    clear = [r for r in results if by_id[r["id"]]["difficulty"] == "clear"]
    bound = [r for r in results if by_id[r["id"]]["difficulty"] == "boundary"]

    def acc(rs):
        return (
            sum(1 for r in rs if r["pred"] == by_id[r["id"]]["label"]) / len(rs)
            if rs
            else 0.0
        )

    return {
        "clear": acc(clear),
        "boundary": acc(bound),
        "overall": acc(results),
        "n_clear": len(clear),
        "n_boundary": len(bound),
        "errors": sum(1 for r in results if r["pred"] == "ERROR"),
    }


def simulate_cascade(
    tier1: list[dict], tier2: list[dict], cases: list[dict], threshold: float
) -> dict:
    """Escalate to tier2 only where tier1 confidence < threshold."""
    t2 = {r["id"]: r for r in tier2}
    merged, escalated = [], 0
    for r in tier1:
        if r["confidence"] < threshold and r["id"] in t2:
            merged.append(t2[r["id"]])
            escalated += 1
        else:
            merged.append(r)
    s = score(merged, cases)
    s["escalation_rate"] = escalated / len(tier1) if tier1 else 0.0
    s["_merged"] = merged
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args()

    cases = load_cases()
    print(
        f"fixture: {len(cases)} cases "
        f"({sum(1 for c in cases if c['difficulty'] == 'clear')} clear, "
        f"{sum(1 for c in cases if c['difficulty'] == 'boundary')} boundary)\n"
    )

    if args.report_only and CACHE.exists():
        runs = {
            tuple(k.split("|")): v for k, v in json.loads(CACHE.read_text()).items()
        }
    else:
        from google import genai
        from google.genai import types as gt

        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            sys.exit("GEMINI_API_KEY not set")
        client = genai.Client(api_key=key)
        runs = {}
        for model, thinking in CONFIGS:
            runs[(model, thinking)] = run_config(client, gt, model, thinking, cases)
            print(f"  ran {model} (thinking={thinking})")
        CACHE.write_text(
            json.dumps({f"{m}|{t}": v for (m, t), v in runs.items()}, indent=1)
        )
        print()

    print(
        f"{'model':24s} {'think':6s} {'clear':>7s} {'bound':>7s} {'all':>7s} {'$/1k':>9s}"
    )
    print("-" * 66)
    singles = {}
    for (model, thinking), res in runs.items():
        s = score(res, cases)
        c = cost_per_1k(res, model)
        singles[(model, thinking)] = (s, c)
        print(
            f"{model:24s} {thinking:6s} {s['clear']*100:6.1f}% {s['boundary']*100:6.1f}% "
            f"{s['overall']*100:6.1f}% {c:9.4f}"
        )

    print(
        f"\n{'cascade (tier1 -> tier2)':44s} {'thr':>5s} {'esc':>6s} {'all':>7s} {'$/1k':>9s}"
    )
    print("-" * 76)
    best = None
    for t1 in [("gemini-2.5-flash-lite", "off"), ("gemini-3.5-flash-lite", "off")]:
        for t2 in [("gemini-3.7-flash", "off"), ("gemini-3.7-flash", "on")]:
            for thr in (0.75, 0.85, 0.95):
                if t1 not in runs or t2 not in runs:
                    continue
                s = simulate_cascade(runs[t1], runs[t2], cases, thr)
                c1 = cost_per_1k(runs[t1], t1[0])
                c2 = cost_per_1k(
                    [r for r in runs[t2] if r["id"] in {m["id"] for m in s["_merged"]}],
                    t2[0],
                )
                cost = c1 + c2 * s["escalation_rate"]
                label = f"{t1[0]}/{t1[1]} -> {t2[0]}/{t2[1]}"
                print(
                    f"{label:44s} {thr:5.2f} {s['escalation_rate']*100:5.0f}% "
                    f"{s['overall']*100:6.1f}% {cost:9.4f}"
                )
                if best is None or (s["overall"], -cost) > (
                    best[0]["overall"],
                    -best[1],
                ):
                    best = (s, cost, label, thr)

    if best:
        s, cost, label, thr = best
        print(
            f"\nbest cascade: {label} @ conf<{thr} -> {s['overall']*100:.1f}% at ${cost:.4f}/1k"
        )


if __name__ == "__main__":
    main()
