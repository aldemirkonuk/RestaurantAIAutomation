"""
Ontology Validation Service
============================
Phase 9: Rule-based cross-validation of wine records against ontology facts.

Runs AFTER Phase 7 (field_confidence) and Phase 8 (web verification).
Called by ontology_tasks.py Celery task.

4 checkers (D-03):
  1. check_region_country_consistency     — CRITICAL if mismatch
  2. check_grape_appellation_compatibility — CRITICAL if impossible combo
  3. check_vintage_plausibility           — CRITICAL if vintage impossible given release rules
  4. check_color_grape_consistency        — WARNING if color contradicts grape's known color

Autofill (D-04):
  - Only writes if existing field confidence < 0.8 OR field is NULL
  - Written with confidence=1.0, source="ontology"
  - Uses merge_field_confidence with overwrite_lower=True

Severity routing (D-03):
  - CRITICAL: auto_blocked=True + insert into field_review_queue
  - WARNING: logged in ontology_validation JSONB; routes to field_review_queue ONLY IF
    field_confidence for that field is also < DEFAULT_ACCEPT_THRESHOLD (0.8);
    does NOT set auto_blocked
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel
from supabase import create_client

from config.settings import get_settings
from services.field_confidence import DEFAULT_ACCEPT_THRESHOLD, merge_field_confidence

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Country name → ISO code mapping for check_region_country_consistency
# ---------------------------------------------------------------------------
_COUNTRY_NAME_TO_CODE: Dict[str, str] = {
    "france": "FR",
    "italy": "IT",
    "spain": "ES",
    "germany": "DE",
    "united states": "US",
    "usa": "US",
    "australia": "AU",
    "argentina": "AR",
    "chile": "CL",
    "portugal": "PT",
    "new zealand": "NZ",
    "south africa": "ZA",
    "austria": "AT",
}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class OntologyCheckFailure(BaseModel):
    check: str            # "region_country" | "grape_appellation" | "vintage_plausibility" | "color_grape"
    severity: str         # "critical" | "warning"
    expected: Optional[str] = None
    found: Optional[str] = None
    message: str          # human-readable explanation


class OntologyValidationResult(BaseModel):
    checks_passed: int
    checks_failed: int
    checks_total: int
    failures: List[OntologyCheckFailure]
    autofills_applied: int
    validated_at: str     # ISO timestamp


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class OntologyValidationService:

    def __init__(self):
        settings = get_settings()
        self.supabase = create_client(settings.supabase_url, settings.supabase_key)

    # ------------------------------------------------------------------
    # Checker 1: Region ↔ Country consistency (ONTO-01, ONTO-05)
    # ------------------------------------------------------------------

    def check_region_country_consistency(
        self,
        appellation_value: Optional[str],
        country_value: Optional[str],
    ) -> Optional[OntologyCheckFailure]:
        """
        ONTO-01, ONTO-05: Check that the appellation's known country matches the claimed country.

        Logic:
          1. If appellation_value is None → skip
          2. Lookup appellation in wine_regions via lookup_region_by_name()
          3. Walk ancestors to find the country-level row via get_region_ancestors()
          4. If found_country_code exists AND country_value is not None:
             - Normalize country_value to country_code
             - If codes don't match → CRITICAL failure
          5. Return None if check passes or cannot be performed (insufficient data)
        """
        from services.ontology_normalization import (
            get_region_ancestors,
            lookup_region_by_name,
        )

        if not appellation_value:
            return None

        region_row = lookup_region_by_name(appellation_value)
        if not region_row:
            return None  # Appellation not in our DB — cannot check

        # Determine the country code for this appellation
        known_country_code: Optional[str] = region_row.get("country_code")
        if not known_country_code:
            ancestors = get_region_ancestors(region_row["id"])
            for ancestor in ancestors:
                if ancestor.get("country_code"):
                    known_country_code = ancestor["country_code"]
                    break

        if not known_country_code or not country_value:
            return None  # Insufficient data to compare

        # Normalize claimed country to ISO code
        claimed_lower = country_value.strip().lower()
        claimed_code = _COUNTRY_NAME_TO_CODE.get(claimed_lower, claimed_lower.upper()[:2])

        if known_country_code.upper() != claimed_code.upper():
            return OntologyCheckFailure(
                check="region_country",
                severity="critical",
                expected=known_country_code,
                found=claimed_code,
                message=(
                    f"Appellation '{appellation_value}' belongs to country '{known_country_code}', "
                    f"but wine claims country '{country_value}' (code: {claimed_code})"
                ),
            )
        return None

    # ------------------------------------------------------------------
    # Checker 2: Grape ↔ Appellation compatibility (ONTO-03, ONTO-05)
    # ------------------------------------------------------------------

    def check_grape_appellation_compatibility(
        self,
        appellation_value: Optional[str],
        grape_value: Optional[str],
    ) -> Optional[OntologyCheckFailure]:
        """
        ONTO-03, ONTO-05: Check that the grape variety is compatible with the appellation.

        Logic:
          1. If appellation_value or grape_value is None → skip
          2. Normalize grape to canonical form via normalize_grape_name()
          3. Fetch appellation_rules via lookup_appellation_rules()
          4. If no rule found → skip (appellation not in our rules DB)
          5. Check required_grapes: if list non-empty, canonical_grape must be in required_grapes[*].grape
             - Mismatch → CRITICAL
          6. If no required_grapes but allowed_grapes is non-empty: canonical_grape must be in allowed_grapes
             - Not in list → CRITICAL
        """
        from services.ontology_normalization import (
            lookup_appellation_rules,
            normalize_grape_name,
        )

        if not appellation_value or not grape_value:
            return None

        canonical_grape = normalize_grape_name(grape_value) or grape_value
        rules = lookup_appellation_rules(appellation_value)
        if not rules:
            return None  # No rules in DB for this appellation — skip

        required_grapes: List[Dict[str, Any]] = rules.get("required_grapes") or []
        allowed_grapes: List[Dict[str, Any]] = rules.get("allowed_grapes") or []

        if required_grapes:
            required_names = [g["grape"] for g in required_grapes if "grape" in g]
            canonical_lower = canonical_grape.lower()
            match = any(r.lower() == canonical_lower for r in required_names)
            if not match:
                expected_grape = required_names[0] if required_names else "unknown"
                return OntologyCheckFailure(
                    check="grape_appellation",
                    severity="critical",
                    expected=expected_grape,
                    found=canonical_grape,
                    message=(
                        f"{appellation_value} requires {expected_grape}, "
                        f"found {canonical_grape}"
                    ),
                )
        elif allowed_grapes:
            allowed_names = [g["grape"] for g in allowed_grapes if "grape" in g]
            canonical_lower = canonical_grape.lower()
            match = any(a.lower() == canonical_lower for a in allowed_names)
            if not match:
                return OntologyCheckFailure(
                    check="grape_appellation",
                    severity="critical",
                    expected=", ".join(allowed_names[:3]),
                    found=canonical_grape,
                    message=(
                        f"{canonical_grape} is not an allowed grape for {appellation_value}. "
                        f"Allowed: {', '.join(allowed_names[:5])}"
                    ),
                )
        return None

    # ------------------------------------------------------------------
    # Checker 3: Vintage plausibility (ONTO-04, ONTO-05)
    # ------------------------------------------------------------------

    def check_vintage_plausibility(
        self,
        vintage_value: Optional[str],
        appellation_value: Optional[str],
    ) -> Optional[OntologyCheckFailure]:
        """
        ONTO-04, ONTO-05: Check that the vintage year could legally exist today.

        Logic:
          1. If vintage_value is None → skip
          2. If value is NV / NON-VINTAGE / N/V → PASS always
          3. Parse as integer year; if unparseable → skip
          4. If appellation_value is None → skip
          5. Fetch vintage_rules where appellation_name ILIKE appellation_value, rule_type='standard'
          6. If no rule → skip
          7. earliest_release = datetime(vintage_year, 10, 1) + timedelta(days=30 * min_release_delay_months)
          8. If now(UTC) < earliest_release → CRITICAL
        """
        if not vintage_value:
            return None

        if vintage_value.strip().upper() in ("NV", "NON-VINTAGE", "N/V", "NON VINTAGE"):
            return None  # NV always passes

        try:
            vintage_year = int(vintage_value.strip())
        except (ValueError, TypeError):
            return None  # Not a parseable year — not our job to validate format

        if not appellation_value:
            return None

        try:
            resp = (
                self.supabase.table("vintage_rules")
                .select("min_release_delay_months,allows_nv,rule_type")
                .ilike("appellation_name", appellation_value.strip())
                .eq("rule_type", "standard")
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.warning("check_vintage_plausibility DB query failed: %s", exc)
            return None

        if not resp.data:
            return None  # No rule for this appellation

        rule = resp.data[0]
        min_release_delay_months: int = rule.get("min_release_delay_months", 0)

        # October 1 = canonical Northern-hemisphere harvest date
        earliest_release = datetime(vintage_year, 10, 1, tzinfo=timezone.utc) + timedelta(
            days=30 * min_release_delay_months
        )
        now = datetime.now(timezone.utc)

        if now < earliest_release:
            return OntologyCheckFailure(
                check="vintage_plausibility",
                severity="critical",
                expected=f">= {earliest_release.strftime('%Y-%m')}",
                found=str(vintage_year),
                message=(
                    f"{vintage_year} {appellation_value} cannot be released until "
                    f"{earliest_release.strftime('%Y-%m')} "
                    f"({min_release_delay_months} month minimum release delay)"
                ),
            )
        return None

    # ------------------------------------------------------------------
    # Checker 4: Color ↔ Grape consistency (ONTO-02, ONTO-05)
    # ------------------------------------------------------------------

    def check_color_grape_consistency(
        self,
        color_value: Optional[str],
        grape_value: Optional[str],
    ) -> Optional[OntologyCheckFailure]:
        """
        ONTO-02, ONTO-05: Check that the wine's declared color matches the grape's known color.
        Severity is WARNING (not CRITICAL) per D-03.

        Logic:
          1. If color_value or grape_value is None → skip
          2. Normalize grape to canonical form
          3. Fetch grape color via get_grape_color()
          4. If grape_color is None or 'unknown' → skip
          5. Normalize color_value: lowercase, map "rose" → "rosé"
          6. If color_value != grape_color → WARNING
        """
        from services.ontology_normalization import get_grape_color, normalize_grape_name

        if not color_value or not grape_value:
            return None

        canonical_grape = normalize_grape_name(grape_value) or grape_value
        grape_color = get_grape_color(canonical_grape)
        if not grape_color:
            return None  # Unknown grape color — cannot check

        # Normalize claimed color
        color_lower = color_value.strip().lower()
        if color_lower in ("rose", "rosé", "rosé"):
            color_lower = "rosé"

        if color_lower != grape_color.lower():
            return OntologyCheckFailure(
                check="color_grape",
                severity="warning",
                expected=grape_color,
                found=color_lower,
                message=(
                    f"Grape '{canonical_grape}' is typically {grape_color}, "
                    f"but wine declares color '{color_lower}'"
                ),
            )
        return None

    # ------------------------------------------------------------------
    # Autofill: D-04
    # ------------------------------------------------------------------

    def _apply_ontology_autofills(
        self,
        fc: Dict[str, Any],
        appellation_value: Optional[str],
        canonical_grape: Optional[str],
    ) -> tuple:
        """
        D-04: Write ontology-derived facts into field_confidence with confidence=1.0.
        Only writes if existing confidence < DEFAULT_ACCEPT_THRESHOLD (0.8) OR field absent.

        Autofill sources:
          1. appellation → country (via get_country_for_appellation → ISO code)
          2. appellation → region (via get_region_for_appellation → region name)
          3. grape_variety → color (via get_grape_color)

        Returns (updated_fc, autofill_count).
        """
        from services.ontology_normalization import (
            get_country_for_appellation,
            get_grape_color,
            get_region_for_appellation,
        )

        updated_fc = dict(fc)
        autofill_count = 0

        def _should_autofill(field: str) -> bool:
            existing = updated_fc.get(field)
            if existing is None:
                return True
            if not isinstance(existing, dict):
                return True
            existing_conf = float(existing.get("confidence", 0.0))
            return existing_conf < DEFAULT_ACCEPT_THRESHOLD  # T-09-08

        def _do_autofill(field: str, value: Any) -> int:
            if value is None:
                return 0
            if not _should_autofill(field):
                return 0
            ontology_fill = {
                field: {
                    "value": value,
                    "confidence": 1.0,
                    "source": "ontology",
                    "verification_status": "ontology_verified",
                }
            }
            nonlocal updated_fc
            updated_fc = merge_field_confidence(updated_fc, ontology_fill, overwrite_lower=True)
            return 1

        # 1. appellation → country
        if appellation_value:
            country_code = get_country_for_appellation(appellation_value)
            if country_code:
                autofill_count += _do_autofill("country", country_code)

        # 2. appellation → region
        if appellation_value:
            region_row = get_region_for_appellation(appellation_value)
            if region_row:
                region_name = region_row.get("name") or region_row.get("canonical_name")
                autofill_count += _do_autofill("region", region_name)

        # 3. grape_variety → color
        if canonical_grape:
            grape_color = get_grape_color(canonical_grape)
            if grape_color:
                autofill_count += _do_autofill("color", grape_color)

        return updated_fc, autofill_count

    # ------------------------------------------------------------------
    # Failure routing: D-03
    # ------------------------------------------------------------------

    def _route_failures(
        self,
        wine_id: str,
        failures: List[OntologyCheckFailure],
        fc: Dict[str, Any],
    ) -> None:
        """
        D-03: Route failures based on severity + field confidence:
          - CRITICAL: always insert into field_review_queue + set auto_blocked=True
          - WARNING: insert into field_review_queue ONLY IF field_confidence for that
            field is < DEFAULT_ACCEPT_THRESHOLD (0.8); do NOT set auto_blocked

        Maps check names to field names for field_review_queue:
          "region_country"      → "country"
          "grape_appellation"   → "grape_variety"
          "vintage_plausibility"→ "vintage"
          "color_grape"         → "color"
        """
        field_map = {
            "region_country": "country",
            "grape_appellation": "grape_variety",
            "vintage_plausibility": "vintage",
            "color_grape": "color",
        }

        has_critical = any(f.severity == "critical" for f in failures)

        for failure in failures:
            field_name = field_map.get(failure.check, failure.check)
            current_entry = fc.get(field_name, {})
            current_value = current_entry.get("value") if isinstance(current_entry, dict) else None
            current_confidence = (
                float(current_entry.get("confidence", 1.0))
                if isinstance(current_entry, dict)
                else 1.0
            )

            should_route = False
            if failure.severity == "critical":
                should_route = True
            elif failure.severity == "warning" and current_confidence < DEFAULT_ACCEPT_THRESHOLD:
                # D-03: WARNING routes to field_review_queue only if confidence also low
                should_route = True

            if not should_route:
                continue

            try:
                self.supabase.table("field_review_queue").insert({
                    "submission_id": wine_id,
                    "field_name": field_name,
                    "current_value": str(current_value) if current_value is not None else None,
                    "confidence": current_confidence,
                    "source": "ontology",
                    "status": "pending",
                }).execute()
            except Exception as exc:
                logger.warning(
                    "field_review_queue insert failed for wine_id=%s field=%s: %s",
                    wine_id, field_name, exc,
                )

        # Set auto_blocked=True only for CRITICAL failures (D-03)
        if has_critical:
            try:
                self.supabase.table("master_wine_library_submissions").update({
                    "auto_blocked": True,
                }).eq("id", wine_id).execute()
            except Exception as exc:
                logger.warning("auto_blocked update failed for wine_id=%s: %s", wine_id, exc)

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def run_ontology_validation(self, wine_id: str) -> Optional[OntologyValidationResult]:
        """
        Main entry point. Called by ontology_tasks.py.

        Flow:
          1. Fetch wine field_confidence from master_wine_library_submissions
          2. Extract relevant fields (appellation, country, region, grape_variety, color, vintage)
          3. Normalize grape aliases via ontology_normalization.normalize_grape_name()
          4. Run 4 checkers
          5. Compile OntologyValidationResult
          6. Apply deterministic autofills (D-04) via merge_field_confidence
          7. Write ontology_validation JSONB to submissions row
          8. Route CRITICAL failures: auto_blocked + field_review_queue INSERT
          9. Return result
        """
        from services.ontology_normalization import normalize_grape_name

        # 1. Fetch wine field_confidence
        try:
            resp = (
                self.supabase.table("master_wine_library_submissions")
                .select("id, field_confidence")
                .eq("id", wine_id)
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.error("run_ontology_validation: DB fetch failed for wine_id=%s: %s", wine_id, exc)
            return None

        if not resp.data:
            logger.warning("run_ontology_validation: wine_id=%s not found", wine_id)
            return None

        fc: Dict[str, Any] = resp.data.get("field_confidence") or {}

        # 2. Extract fields from field_confidence (D-04: use FC values, not raw payload)
        def _fc_val(field: str) -> Optional[str]:
            entry = fc.get(field, {})
            return entry.get("value") if isinstance(entry, dict) else None

        appellation = _fc_val("appellation")
        country = _fc_val("country")
        grape_variety = _fc_val("grape_variety")
        color = _fc_val("color")
        vintage = _fc_val("vintage")

        # 3. Normalize grape alias before checking
        canonical_grape = normalize_grape_name(grape_variety) if grape_variety else None

        # 4. Run 4 checkers
        failures: List[OntologyCheckFailure] = []
        checks_total = 4

        r1 = self.check_region_country_consistency(appellation, country)
        if r1:
            failures.append(r1)

        r2 = self.check_grape_appellation_compatibility(appellation, canonical_grape or grape_variety)
        if r2:
            failures.append(r2)

        r3 = self.check_vintage_plausibility(vintage, appellation)
        if r3:
            failures.append(r3)

        r4 = self.check_color_grape_consistency(color, canonical_grape or grape_variety)
        if r4:
            failures.append(r4)

        checks_failed = len(failures)
        checks_passed = checks_total - checks_failed

        # 5. Compile result
        result = OntologyValidationResult(
            checks_passed=checks_passed,
            checks_failed=checks_failed,
            checks_total=checks_total,
            failures=failures,
            autofills_applied=0,
            validated_at=datetime.now(timezone.utc).isoformat(),
        )

        # 6. Apply deterministic autofills (D-04)
        updated_fc, autofill_count = self._apply_ontology_autofills(fc, appellation, canonical_grape)
        result.autofills_applied = autofill_count

        # 7. Write ontology_validation JSONB + updated field_confidence to submission
        validation_payload = {
            "checks_passed": result.checks_passed,
            "checks_failed": result.checks_failed,
            "checks_total": result.checks_total,
            "failures": [f.model_dump() for f in result.failures],
            "autofills_applied": result.autofills_applied,
        }

        try:
            self.supabase.table("master_wine_library_submissions").update({
                "ontology_validation": validation_payload,
                "ontology_validated_at": result.validated_at,
                "field_confidence": updated_fc,
            }).eq("id", wine_id).execute()
        except Exception as exc:
            logger.error("ontology_validation write failed for wine_id=%s: %s", wine_id, exc)
            return result  # Return result even if write fails

        # 8. Route failures (D-03: CRITICAL always; WARNING only if low confidence)
        self._route_failures(wine_id, failures, updated_fc)

        logger.info(
            "run_ontology_validation: wine_id=%s checks=%d/%d failures=%d autofills=%d",
            wine_id, checks_passed, checks_total, checks_failed, autofill_count,
        )
        return result
