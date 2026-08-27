"""
`ontology_v1` — the strongest machine ground truth in this repository (OD-59, P3.0).

`OntologyValidationService.run_ontology_validation()` applies four hard domain
rules to a wine's extracted fields: region/country consistency, grape/appellation
compatibility, vintage plausibility, colour/grape consistency. **A Bordeaux
appellation carrying a Nebbiolo grape is wrong, provably, with no human in the
loop.** That is a rarer thing than it sounds — most of the census's task types
bottom out at "did the output parse".

WHY THIS IS A DEFERRED GRADER
-----------------------------
The validation runs as a Celery task keyed by `wine_id`, minutes after the
extraction call it judges and in another process. So the verdict cannot ride the
emit; it has to find the earlier NF row and grade it after the fact. That is
exactly the shape `nf_verdict` was designed for, and it is why
`neural_footprint.record_verdict` exists.

WHAT IT CAN AND CANNOT REACH, MEASURED
--------------------------------------
The census filed eight task types under "deferred: needs a wine_id join", which
was optimistic. Checked site by site on 2026-08-27, only **`wine_enrichment`**
can actually be reached, and the reason the others cannot is not plumbing:

  * `vision_extraction`, `text_extraction`, `crawl_extraction` — one call
    extracts MANY wines from one document. There is no single `wine_id` to
    attach a per-wine verdict to, and picking one would be a fabrication.
  * `field_extraction`, `wine_field_parse`, `wine_enrichment_grounded`,
    `wine_enrichment_fallback` — the wine does not exist yet. These calls run
    while the wine is being IDENTIFIED; `wine_id` is the output, not an input.
    Threading it in is not possible, because at call time there is nothing to
    thread.

`wine_enrichment` is reachable precisely because it enriches a wine that is
already in the library, so it already carries `wine_id` in its NF context.

Grading the reachable one and stating plainly why the rest are not is the honest
result. Recording seven as "deferred, needs a join" would imply work that is
merely unscheduled, when four of them are blocked on causality.
"""

import logging
from typing import Any, Dict

from services.neural_footprint import record_drop

logger = logging.getLogger(__name__)

ONTOLOGY_BASIS = "ontology_v1"

#: Task types whose NF rows carry a `wine_id` and describe work on ONE wine.
GRADABLE_TASK_TYPES = ("wine_enrichment",)

#: How far back to look for the extraction that produced this wine. The
#: validation is queued off the enrichment chain, so the gap is minutes; a day
#: is loose enough to survive a backed-up queue and tight enough that a re-run
#: months later does not re-grade ancient rows under fresh evidence.
LOOKBACK_HOURS = 24


def ontology_verdict(
    checks_passed: int, checks_failed: int, checks_total: int
) -> Dict[str, Any]:
    """
    Turn a validation result into a verdict.

    `failure` on any hard-rule failure — these rules do not produce false
    positives by design; a grape that cannot grow in an appellation is not a
    matter of degree.

    `null` when NO check could run. That happens when the wine has too few
    fields for any rule to apply, and it is untestable rather than passing —
    the distinction OD-59 keeps insisting on, because a wine with three empty
    fields would otherwise score identically to one that satisfied every rule.
    """
    evidence = {
        "checks_passed": checks_passed,
        "checks_failed": checks_failed,
        "checks_total": checks_total,
    }
    if checks_total == 0:
        return {
            "outcome": None,
            "evidence": {**evidence, "untestable": "no_ontology_rule_applied"},
        }
    if checks_failed > 0:
        return {"outcome": "failure", "evidence": evidence}
    return {"outcome": "success", "evidence": evidence}


def grade_wine_extractions(
    supabase,
    wine_id: str,
    checks_passed: int,
    checks_failed: int,
    checks_total: int,
) -> int:
    """
    Attach an `ontology_v1` verdict to every gradable NF row for this wine.

    Never raises: this runs at the tail of a Celery task that has already done
    its real work, and an instrument that can kill a validation run is worse
    than one with a gap.

    Returns the number of verdicts written.
    """
    from services.neural_footprint import record_verdict

    verdict = ontology_verdict(checks_passed, checks_failed, checks_total)
    written = 0
    try:
        # `context->>wine_id` is the join key. Only rows that already carry it
        # are reachable — see the module docstring for why that is most of them.
        rows = (
            supabase.table("neural_footprint_event")
            .select("id")
            .eq("context->>wine_id", str(wine_id))
            # `task_type` is NOT a column — `spend_logger.py:395` writes it into
            # `context`, and `nf_a_verdict_coverage` reads it back as
            # `e.context->>'task_type'`. Filtering the bare name made PostgREST
            # reject the request with `column does not exist`; the surrounding
            # try/except then swallowed it as a warning, so this grader wrote
            # ZERO verdicts while reporting nothing wrong. Found 2026-08-27
            # while building the beverage twin of this function, which had
            # copied the same line.
            .in_("context->>task_type", list(GRADABLE_TASK_TYPES))
            .order("occurred_at", desc=True)
            .limit(20)
            .execute()
        )
        for row in getattr(rows, "data", None) or []:
            event_id = row.get("id")
            if not event_id:
                continue
            if record_verdict(
                supabase,
                event_id,
                ONTOLOGY_BASIS,
                verdict["outcome"],
                verdict["evidence"],
            ):
                written += 1
    except Exception as exc:
        logger.warning(
            "ontology_v1 re-grade skipped for wine_id=%s (non-fatal): %s",
            wine_id,
            exc,
        )
        # COUNTABLE, not merely logged. A `logger.warning` is exactly what hid
        # the `task_type` column defect for hours: the grader ran, failed every
        # time, and the only trace was a line nobody greps. `record_drop` puts
        # the failure in the same ledger NF emit drops use, so "this grader is
        # silently broken" becomes a number someone can read instead of a
        # string someone must notice. Still non-fatal — an instrument must not
        # kill the Celery task it measures.
        record_drop("ontology_v1")
    return written
