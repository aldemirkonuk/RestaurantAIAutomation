"""
`beverage_ontology_v1` reaching the neural footprint (ADR 0029 P3.B).

This is the beverage twin of `services/ontology_verdict.py`, and it is
deliberately the same shape: a deferred grader that finds the extraction row it
judges after the fact and attaches a sidecar verdict keyed `(event_id, basis)`.
ADR 0017 settled that verdicts never edit the event, and `nf_verdict`'s own
comment settles what a second grader does — *"a genuinely different grader takes
a new basis string and lands as a SECOND row"*.

WHAT IT ADDS THAT `ontology_v1` DOES NOT
----------------------------------------
`ontology_v1` grades wine fields. Handed a Scotch it examines nothing and — for
the reason set out at length in `services/beverage_ontology.py` — returns
**success** anyway. This module grades the rows `ontology_v1` cannot examine,
and its `checks_total` counts the rules that actually ran, so a row nothing
could be checked on comes back `null`/untestable instead.

Where both graders touch the same event the sidecar keeps the disagreement
visible rather than resolving it: `ontology_v1 = success` and
`beverage_ontology_v1 = null` on one Scotch is the evidence that the wine
oracle's `checks_total` is a constant. That is worth more as a queryable row
than as a sentence in a document nobody re-reads.

REACHABILITY IS THE SAME, AND FOR THE SAME REASONS
--------------------------------------------------
Only NF rows that carry `context.wine_id` and describe work on ONE item can be
graded, which today is `wine_enrichment` alone. `GRADABLE_TASK_TYPES` is
imported from `ontology_verdict` rather than restated: the constraint is a
property of the emit sites, not of the grader, so two copies of it would drift
the moment a new single-item emit appears.
"""

import logging
from typing import Any, Dict, Optional

from services.beverage_ontology import (
    BEVERAGE_ONTOLOGY_BASIS,
    applies_to_row,
    run_beverage_ontology_checks,
)
from services.ontology_verdict import GRADABLE_TASK_TYPES

logger = logging.getLogger(__name__)

#: Keys read out of a submission. `alcohol_pct` is what the enrichment service
#: actually writes (haiku_enrichment_service.py:74); `abv_pct`, `proof`,
#: `age_years` and `volume_ml` are the `public.beverages` column names, present
#: here so the same reader works once the beverage catalogue has a writer.
#:
#: `producer` and `description` are flattened but **no rule reads them** —
#: `beverage_ontology` excludes both deliberately (proper nouns and free prose
#: are how a category rule invents failures; see `_CLASSIFYING_FIELDS` there).
#: They are carried so a reader can see what was available and chose not to use
#: it. Do not "wire them up".
_SUBMISSION_FIELDS = (
    "name",
    "display_name",
    "producer",
    "description",
    "primary_type",
    "beverage_type",
    "menu_category",
    "country",
    "grape_variety",
    "appellation",
    "vintage",
    "alcohol_pct",
    "abv_pct",
    "proof",
    "age_years",
    "volume_ml",
)


def beverage_ontology_verdict(
    checks_passed: int, checks_failed: int, checks_total: int
) -> Dict[str, Any]:
    """
    Turn a rule run into a verdict.

    `failure` on any hard-rule failure. These rules are arithmetic, law, or a
    row contradicting itself — none of them is a matter of degree, which is the
    bar `ontology_v1` set and the reason a shape check does not qualify.

    `null` when NO rule could run, which is the branch that matters. In the wine
    path the equivalent branch is unreachable because its caller passes a
    constant `checks_total` of 4; here `checks_total` is produced by counting,
    so "nothing was checkable" and "everything checked out" cannot collapse into
    the same verdict.
    """
    evidence = {
        "checks_passed": checks_passed,
        "checks_failed": checks_failed,
        "checks_total": checks_total,
    }
    if checks_total == 0:
        return {
            "outcome": None,
            "evidence": {**evidence, "untestable": "no_beverage_rule_applied"},
        }
    if checks_failed > 0:
        return {"outcome": "failure", "evidence": evidence}
    return {"outcome": "success", "evidence": evidence}


def extract_fields(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten one `master_wine_library_submissions` row into plain scalars.

    Two shapes carry the same fields. `field_confidence` holds
    `{value, confidence, source}` per field and is what enrichment writes;
    `payload` holds the raw extraction and is the only place `name` appears
    (api/scan_routes.py:482). `field_confidence` wins where both have a value,
    matching `run_ontology_validation`'s "use FC values, not raw payload" rule
    (ontology_validation_service.py:570).
    """
    payload = row.get("payload") or {}
    field_confidence = row.get("field_confidence") or {}
    if not isinstance(payload, dict):
        payload = {}
    if not isinstance(field_confidence, dict):
        field_confidence = {}

    fields: Dict[str, Any] = {}
    for key in _SUBMISSION_FIELDS:
        entry = field_confidence.get(key)
        value = entry.get("value") if isinstance(entry, dict) else None
        if value is None:
            value = payload.get(key)
        if value is not None:
            fields[key] = value
    return fields


def grade_beverage_extractions(supabase, wine_id: str) -> Optional[int]:
    """
    Attach a `beverage_ontology_v1` verdict to every gradable NF row for this id.

    Returns the number of verdicts written, or **None** when the row is wine and
    was deliberately not graded. None and 0 are different answers: 0 means the
    grader ran and found no event to attach to, None means it correctly declined
    to run. Collapsing them would make "we grade beverages" indistinguishable
    from "we grade nothing".

    Never raises. It runs at the tail of a Celery task that has already done its
    real work, and an instrument that can kill a validation run is worse than
    one with a gap — the same posture as `grade_wine_extractions`.
    """
    from services.neural_footprint import record_verdict

    try:
        response = (
            supabase.table("master_wine_library_submissions")
            .select("id, payload, field_confidence")
            .eq("id", str(wine_id))
            .maybe_single()
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "beverage_ontology_v1 skipped for wine_id=%s (fetch failed, non-fatal): %s",
            wine_id,
            exc,
        )
        return 0

    row = getattr(response, "data", None)
    if not row:
        logger.info("beverage_ontology_v1: wine_id=%s not found", wine_id)
        return 0

    fields = extract_fields(row)
    if not applies_to_row(fields):
        # A wine. `ontology_v1` already grades it, and writing an untestable
        # verdict here would count as `graded` in nf_a_verdict_coverage while
        # having examined nothing — inflating the one number that currently
        # reports coverage honestly.
        return None

    result = run_beverage_ontology_checks(fields)
    verdict = beverage_ontology_verdict(
        result["checks_passed"], result["checks_failed"], result["checks_total"]
    )
    evidence = {
        **verdict["evidence"],
        "checks_applied": result["checks_applied"],
        "checks_skipped": result["checks_skipped"],
        "failures": result["failures"],
    }

    written = 0
    try:
        rows = (
            supabase.table("neural_footprint_event")
            .select("id")
            .eq("context->>wine_id", str(wine_id))
            # Both filters are JSON paths. `task_type` has never been a column
            # on this table — see the note in `ontology_verdict.py`, where the
            # bare-column form silently wrote no verdicts at all.
            .in_("context->>task_type", list(GRADABLE_TASK_TYPES))
            .order("occurred_at", desc=True)
            .limit(20)
            .execute()
        )
        for event in getattr(rows, "data", None) or []:
            event_id = event.get("id")
            if not event_id:
                continue
            if record_verdict(
                supabase,
                event_id,
                BEVERAGE_ONTOLOGY_BASIS,
                verdict["outcome"],
                evidence,
            ):
                written += 1
    except Exception as exc:
        logger.warning(
            "beverage_ontology_v1 grade skipped for wine_id=%s (non-fatal): %s",
            wine_id,
            exc,
        )
    return written
