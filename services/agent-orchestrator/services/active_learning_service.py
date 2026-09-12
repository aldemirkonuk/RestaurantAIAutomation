"""
Active Learning Service
========================
Tracks parser accuracy from dev review corrections and
automatically improves the local parser over time.

Components:
  1. Accuracy Tracker - monitors per-field accuracy rates
  2. Rule Learner - extracts new regex patterns from corrections
  3. Benchmark Manager - 200 gold-standard documents for regression testing
  4. Improvement Logger - tracks accuracy improvement over time

Flow:
  dev review correction -> accuracy tracker updates ->
  rule learner proposes new patterns -> benchmark validates ->
  if improvement, patterns merged into parser
"""

import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
BENCHMARK_DIR = PROJECT_ROOT / "datasets" / "annotated" / "menus"
METRICS_FILE = PROJECT_ROOT / "datasets" / "_active_learning_metrics.jsonl"


class BenchmarkCorpusError(RuntimeError):
    """Raised when the gold-standard benchmark cannot assert accuracy.

    A benchmark run over an empty or below-threshold corpus is not a passing
    run — it is a run that proved nothing. Returning a green ``0/0`` (0.0
    accuracy over 0 documents) is a vacuous pass: the exact failure mode
    ADR 0025 ("a claim that cannot run is a FAILURE") and the ``check_*.sh``
    "exit 2 when it cannot check" discipline exist to stop. So instead of
    silently reporting 0.0, the oracle raises this and callers fail loud.
    """


# =============================================================================
# DATA MODELS
# =============================================================================


@dataclass
class FieldAccuracy:
    """Per-field accuracy tracking."""

    field_name: str
    total_reviewed: int = 0
    correct: int = 0
    incorrect: int = 0
    accuracy: float = 0.0


@dataclass
class CorrectionRecord:
    """A human correction from dev review."""

    review_id: str
    field_name: str
    parser_value: Any
    correct_value: Any
    wine_name: Optional[str] = None
    source_text: Optional[str] = None
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass
class LearnedRule:
    """A regex pattern learned from corrections."""

    pattern: str
    field_name: str
    description: str
    examples: List[str] = field(default_factory=list)
    accuracy_improvement: float = 0.0
    proposed_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    status: str = "proposed"  # proposed, validated, merged, rejected


@dataclass
class BenchmarkResult:
    """Result of running the parser against benchmark documents."""

    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    total_documents: int = 0
    total_wines: int = 0
    field_accuracies: Dict[str, float] = field(default_factory=dict)
    overall_accuracy: float = 0.0
    regression_detected: bool = False
    details: List[Dict[str, Any]] = field(default_factory=list)


# =============================================================================
# ACCURACY TRACKER
# =============================================================================


class AccuracyTracker:
    """Tracks per-field accuracy rates from human corrections."""

    IDENTITY_FIELDS = [
        "wine_name",
        "producer",
        "vintage",
        "country",
        "region",
        "grape_variety",
        "classification",
        "wine_type",
        "price",
        "price_currency",
    ]

    def __init__(self):
        self._field_stats: Dict[str, FieldAccuracy] = {
            f: FieldAccuracy(field_name=f) for f in self.IDENTITY_FIELDS
        }
        self._corrections: List[CorrectionRecord] = []
        self._load_history()

    def record_correction(
        self,
        review_id: str,
        field_name: str,
        parser_value: Any,
        correct_value: Any,
        wine_name: Optional[str] = None,
        source_text: Optional[str] = None,
    ):
        """Record a human correction."""
        correction = CorrectionRecord(
            review_id=review_id,
            field_name=field_name,
            parser_value=parser_value,
            correct_value=correct_value,
            wine_name=wine_name,
            source_text=source_text,
        )
        self._corrections.append(correction)

        if field_name in self._field_stats:
            stats = self._field_stats[field_name]
            stats.total_reviewed += 1
            if self._values_match(parser_value, correct_value):
                stats.correct += 1
            else:
                stats.incorrect += 1
            stats.accuracy = (
                stats.correct / stats.total_reviewed
                if stats.total_reviewed > 0
                else 0.0
            )

        self._save_correction(correction)

    def record_approval(self, review_id: str, fields: Dict[str, Any]):
        """Record that all fields were correct (approval without corrections)."""
        for field_name in self.IDENTITY_FIELDS:
            if field_name in fields and fields[field_name]:
                if field_name in self._field_stats:
                    stats = self._field_stats[field_name]
                    stats.total_reviewed += 1
                    stats.correct += 1
                    stats.accuracy = stats.correct / stats.total_reviewed

    def get_accuracy_report(self) -> Dict[str, Any]:
        """Get current accuracy report."""
        report = {}
        total_correct = 0
        total_reviewed = 0

        for field_name, stats in self._field_stats.items():
            report[field_name] = {
                "total_reviewed": stats.total_reviewed,
                "correct": stats.correct,
                "incorrect": stats.incorrect,
                "accuracy": round(stats.accuracy, 4),
            }
            total_correct += stats.correct
            total_reviewed += stats.total_reviewed

        overall = total_correct / total_reviewed if total_reviewed > 0 else 0.0

        return {
            "overall_accuracy": round(overall, 4),
            "total_reviews": total_reviewed,
            "per_field": report,
            "lowest_accuracy_fields": sorted(
                [
                    (f, s.accuracy)
                    for f, s in self._field_stats.items()
                    if s.total_reviewed >= 5
                ],
                key=lambda x: x[1],
            )[:5],
        }

    def get_common_errors(
        self, field_name: str, top_n: int = 10
    ) -> List[Dict[str, Any]]:
        """Get most common parser errors for a specific field."""
        errors = defaultdict(int)
        for c in self._corrections:
            if c.field_name == field_name and not self._values_match(
                c.parser_value, c.correct_value
            ):
                key = f"{c.parser_value} -> {c.correct_value}"
                errors[key] += 1

        return [
            {"error": k, "count": v}
            for k, v in sorted(errors.items(), key=lambda x: -x[1])[:top_n]
        ]

    @staticmethod
    def _values_match(a: Any, b: Any) -> bool:
        """Check if two values are equivalent."""
        if a is None and b is None:
            return True
        if a is None or b is None:
            return False
        str_a = str(a).strip().lower()
        str_b = str(b).strip().lower()
        return str_a == str_b

    def _save_correction(self, correction: CorrectionRecord):
        """Persist correction to metrics file."""
        try:
            METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(METRICS_FILE, "a") as f:
                f.write(
                    json.dumps(
                        {
                            "type": "correction",
                            "review_id": correction.review_id,
                            "field": correction.field_name,
                            "parser_value": str(correction.parser_value),
                            "correct_value": str(correction.correct_value),
                            "timestamp": correction.timestamp,
                        }
                    )
                    + "\n"
                )
        except Exception as e:
            logger.warning(f"Failed to save correction: {e}")

    def _load_history(self):
        """Load historical corrections from metrics file."""
        if not METRICS_FILE.exists():
            return
        try:
            with open(METRICS_FILE) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    data = json.loads(line)
                    if data.get("type") == "correction":
                        field_name = data.get("field")
                        if field_name in self._field_stats:
                            stats = self._field_stats[field_name]
                            stats.total_reviewed += 1
                            if self._values_match(
                                data.get("parser_value"), data.get("correct_value")
                            ):
                                stats.correct += 1
                            else:
                                stats.incorrect += 1
                            stats.accuracy = stats.correct / stats.total_reviewed
        except Exception as e:
            logger.warning(f"Failed to load accuracy history: {e}")


# =============================================================================
# RULE LEARNER
# =============================================================================


class RuleLearner:
    """
    Learns new regex patterns from human corrections.
    Proposes rules to improve the local parser.
    """

    def __init__(self, tracker: AccuracyTracker):
        self._tracker = tracker
        self._proposed_rules: List[LearnedRule] = []

    def analyze_corrections(self) -> List[LearnedRule]:
        """
        Analyze recent corrections and propose new parser rules.
        """
        rules = []

        # Analyze vintage corrections
        vintage_errors = self._tracker.get_common_errors("vintage")
        for error in vintage_errors:
            if error["count"] >= 3:
                rule = self._propose_vintage_rule(error["error"])
                if rule:
                    rules.append(rule)

        # Analyze region/country misattributions
        region_errors = self._tracker.get_common_errors("region")
        for error in region_errors:
            if error["count"] >= 2:
                rule = self._propose_region_rule(error["error"])
                if rule:
                    rules.append(rule)

        # Analyze wine type misclassifications
        type_errors = self._tracker.get_common_errors("wine_type")
        for error in type_errors:
            if error["count"] >= 3:
                rule = self._propose_type_rule(error["error"])
                if rule:
                    rules.append(rule)

        self._proposed_rules.extend(rules)
        return rules

    def _propose_vintage_rule(self, error_desc: str) -> Optional[LearnedRule]:
        """Propose a vintage extraction fix."""
        parts = error_desc.split(" -> ")
        if len(parts) != 2:
            return None

        wrong_val = parts[0].strip()
        right_val = parts[1].strip()

        if wrong_val == "None" and right_val.isdigit():
            return LearnedRule(
                pattern=f"missed vintage: {right_val}",
                field_name="vintage",
                description=f"Parser missed vintage '{right_val}' - may need expanded pattern",
                examples=[error_desc],
            )
        return None

    def _propose_region_rule(self, error_desc: str) -> Optional[LearnedRule]:
        """Propose a region mapping fix."""
        parts = error_desc.split(" -> ")
        if len(parts) != 2:
            return None

        wrong = parts[0].strip()
        right = parts[1].strip()

        if wrong != "None" and right != "None":
            return LearnedRule(
                pattern=f"region_map: {wrong} -> {right}",
                field_name="region",
                description=f"Parser mapped '{wrong}' but correct is '{right}'",
                examples=[error_desc],
            )
        return None

    def _propose_type_rule(self, error_desc: str) -> Optional[LearnedRule]:
        """Propose a wine type classification fix."""
        parts = error_desc.split(" -> ")
        if len(parts) != 2:
            return None

        return LearnedRule(
            pattern=f"type_fix: {parts[0].strip()} -> {parts[1].strip()}",
            field_name="wine_type",
            description=f"Wine type misclassified as '{parts[0].strip()}', should be '{parts[1].strip()}'",
            examples=[error_desc],
        )

    def get_proposed_rules(self) -> List[Dict[str, Any]]:
        """Get all proposed rules for review."""
        return [
            {
                "pattern": r.pattern,
                "field": r.field_name,
                "description": r.description,
                "examples": r.examples,
                "status": r.status,
                "proposed_at": r.proposed_at,
            }
            for r in self._proposed_rules
        ]


# =============================================================================
# BENCHMARK MANAGER
# =============================================================================


class BenchmarkManager:
    """
    Manages a gold-standard benchmark dataset (200 annotated documents)
    for regression testing when parser rules change.
    """

    BENCHMARK_SIZE_TARGET = 200
    # Minimum documents required before the benchmark may assert an accuracy
    # number. Below this the corpus proves nothing, so ``run_benchmark`` raises
    # rather than reporting a vacuous 0.0. Matches the gate long used inside
    # ``run_improvement_cycle`` (which now reads this constant).
    BENCHMARK_MIN_DOCS = 10

    def __init__(self):
        self._benchmark_docs: List[Dict[str, Any]] = []
        self._load_benchmark()

    def _load_benchmark(self):
        """Load benchmark documents from the annotated directory.

        Loading is intentionally non-fatal: the service (and the API it backs)
        must still construct on an empty corpus. Emptiness is made *loud* at
        assertion time in ``run_benchmark`` — not here — so instantiating the
        service never crashes DI, but no accuracy number can be reported from a
        corpus that does not exist.
        """
        if not BENCHMARK_DIR.exists():
            logger.warning(
                "Benchmark dir does not exist: %s — benchmark cannot assert accuracy",
                BENCHMARK_DIR,
            )
            return

        for f in sorted(BENCHMARK_DIR.glob("*.json")):
            try:
                with open(f) as fh:
                    doc = json.load(fh)
                    if doc.get("benchmark", False):
                        self._benchmark_docs.append(doc)
            except Exception:
                continue

        n = len(self._benchmark_docs)
        if n < self.BENCHMARK_MIN_DOCS:
            logger.warning(
                "Loaded %d benchmark documents from %s (below minimum of %d) — "
                "benchmark cannot assert accuracy until the gold set is populated",
                n,
                BENCHMARK_DIR,
                self.BENCHMARK_MIN_DOCS,
            )
        else:
            logger.info("Loaded %d benchmark documents", n)

    def add_to_benchmark(
        self,
        raw_text: str,
        expected_wines: List[Dict[str, Any]],
        source: str = "dev_review",
    ) -> bool:
        """Add a reviewed document to the benchmark set."""
        if len(self._benchmark_docs) >= self.BENCHMARK_SIZE_TARGET:
            logger.info("Benchmark set is full")
            return False

        doc = {
            "benchmark": True,
            "raw_text": raw_text,
            "expected_wines": expected_wines,
            "source": source,
            "added_at": datetime.now(timezone.utc).isoformat(),
        }

        # Save to file
        doc_id = len(self._benchmark_docs) + 1
        doc_file = BENCHMARK_DIR / f"benchmark_{doc_id:04d}.json"
        BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)

        with open(doc_file, "w") as f:
            json.dump(doc, f, indent=2)

        self._benchmark_docs.append(doc)
        return True

    def run_benchmark(self) -> BenchmarkResult:
        """
        Run the current parser against all benchmark documents.
        Returns accuracy metrics per field.

        Raises:
            BenchmarkCorpusError: if the gold set holds fewer than
                ``BENCHMARK_MIN_DOCS`` documents, or if it holds documents but
                none yield a single comparable field. Either case would
                otherwise produce ``overall_accuracy == 0.0`` over an empty
                comparison set — a vacuous green — so the run fails loud
                instead of reporting a pass it never earned.
        """
        n_docs = len(self._benchmark_docs)
        if n_docs < self.BENCHMARK_MIN_DOCS:
            raise BenchmarkCorpusError(
                f"gold set is empty: {n_docs} documents found under "
                f"{BENCHMARK_DIR}, expected >= {self.BENCHMARK_MIN_DOCS}; "
                f"accuracy cannot be asserted"
            )

        from services.html_menu_parser import get_menu_parser

        parser = get_menu_parser()
        result = BenchmarkResult()
        result.total_documents = n_docs

        field_correct: Dict[str, int] = defaultdict(int)
        field_total: Dict[str, int] = defaultdict(int)

        for doc in self._benchmark_docs:
            raw_text = doc.get("raw_text", "")
            expected = doc.get("expected_wines", [])
            if not raw_text or not expected:
                continue

            # Parse with current parser
            parsed = parser.parse_menu(raw_text, source_type="benchmark")
            parsed_wines = parsed.wines
            result.total_wines += len(expected)

            # Match parsed wines to expected (by name similarity)
            for exp_wine in expected:
                best_match = self._find_best_match(exp_wine, parsed_wines)
                if not best_match:
                    continue

                # Compare fields
                for field_name in AccuracyTracker.IDENTITY_FIELDS:
                    exp_val = exp_wine.get(field_name)
                    parsed_val = best_match.get(field_name)
                    if exp_val:
                        field_total[field_name] += 1
                        if AccuracyTracker._values_match(exp_val, parsed_val):
                            field_correct[field_name] += 1

        # Calculate accuracies
        total_correct = 0
        total_fields = 0
        for field_name in AccuracyTracker.IDENTITY_FIELDS:
            total = field_total.get(field_name, 0)
            correct = field_correct.get(field_name, 0)
            if total > 0:
                result.field_accuracies[field_name] = round(correct / total, 4)
                total_correct += correct
                total_fields += total

        if total_fields == 0:
            raise BenchmarkCorpusError(
                f"gold set has {n_docs} documents under {BENCHMARK_DIR} but none "
                f"yielded a comparable field (missing raw_text/expected_wines, or "
                f"no field matched); accuracy cannot be asserted"
            )

        result.overall_accuracy = total_correct / total_fields

        # Save benchmark result
        self._save_result(result)

        return result

    def _find_best_match(
        self,
        expected: Dict[str, Any],
        parsed_wines: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Find the best matching parsed wine for an expected wine."""
        exp_name = (expected.get("wine_name") or "").lower()
        if not exp_name:
            return None

        best_score = 0.0
        best_match = None

        for pw in parsed_wines:
            pw_name = (pw.get("wine_name") or "").lower()
            if not pw_name:
                continue

            # Simple word overlap scoring
            exp_words = set(exp_name.split())
            pw_words = set(pw_name.split())
            if not exp_words:
                continue

            overlap = len(exp_words & pw_words) / len(exp_words)
            if overlap > best_score:
                best_score = overlap
                best_match = pw

        return best_match if best_score >= 0.3 else None

    def _save_result(self, result: BenchmarkResult):
        """Save benchmark result to metrics file."""
        try:
            METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
            with open(METRICS_FILE, "a") as f:
                f.write(
                    json.dumps(
                        {
                            "type": "benchmark",
                            "timestamp": result.timestamp,
                            "documents": result.total_documents,
                            "wines": result.total_wines,
                            "overall_accuracy": round(result.overall_accuracy, 4),
                            "field_accuracies": result.field_accuracies,
                        }
                    )
                    + "\n"
                )
        except Exception as e:
            logger.warning(f"Failed to save benchmark result: {e}")

    @property
    def benchmark_size(self) -> int:
        return len(self._benchmark_docs)

    @property
    def benchmark_target(self) -> int:
        return self.BENCHMARK_SIZE_TARGET


# =============================================================================
# ACTIVE LEARNING SERVICE (FACADE)
# =============================================================================


class ActiveLearningService:
    """
    Facade combining accuracy tracking, rule learning,
    and benchmark management.
    """

    def __init__(self):
        self.tracker = AccuracyTracker()
        self.learner = RuleLearner(self.tracker)
        self.benchmark = BenchmarkManager()

    def process_review_correction(
        self,
        review_id: str,
        corrections: Dict[str, Tuple[Any, Any]],
        wine_name: Optional[str] = None,
        source_text: Optional[str] = None,
    ):
        """
        Process a dev review correction.

        Args:
            review_id: Review item ID.
            corrections: Dict of {field_name: (parser_value, correct_value)}.
            wine_name: Wine name for context.
            source_text: Original source text.
        """
        for field_name, (parser_val, correct_val) in corrections.items():
            self.tracker.record_correction(
                review_id=review_id,
                field_name=field_name,
                parser_value=parser_val,
                correct_value=correct_val,
                wine_name=wine_name,
                source_text=source_text,
            )

    def process_review_approval(
        self,
        review_id: str,
        fields: Dict[str, Any],
    ):
        """Process a dev review approval (all fields correct)."""
        self.tracker.record_approval(review_id, fields)

    def get_improvement_report(self) -> Dict[str, Any]:
        """Get comprehensive active learning report."""
        accuracy = self.tracker.get_accuracy_report()
        proposed_rules = self.learner.get_proposed_rules()

        return {
            "accuracy": accuracy,
            "proposed_rules": proposed_rules,
            "benchmark": {
                "size": self.benchmark.benchmark_size,
                "target": self.benchmark.benchmark_target,
            },
        }

    def run_improvement_cycle(self) -> Dict[str, Any]:
        """
        Run one cycle of active learning:
        1. Analyze corrections for patterns
        2. Propose new rules
        3. Run benchmark to validate

        Total by construction: an unusable gold set is *reported* in
        ``benchmark_skipped_reason``, never raised, so non-HTTP callers (cron,
        scripts) still receive the step 1–2 rule proposals. Callers that must
        not report success for a validation that never ran check that field —
        the HTTP route (``api/scan_routes.run_learning_cycle``) answers 503 on
        it.
        """
        # Step 1: Analyze corrections
        new_rules = self.learner.analyze_corrections()

        # Step 2: Run the benchmark. Every way the gold set can fail to assert
        # accuracy is funnelled through one path — the oracle already raises
        # BenchmarkCorpusError for BOTH the below-threshold corpus AND the
        # ">= MIN_DOCS documents but none comparable" corpus — so we catch the
        # exception rather than re-deriving the first condition with a size
        # pre-check. That old pre-check covered only the size case, which left
        # its twin (docs present, nothing comparable) escaping this method
        # uncaught, i.e. a 500 at the HTTP boundary, while the size case
        # returned a tidy 200. Catching here removes that asymmetry: both
        # shapes now produce the same reported skip, and the same 503.
        #
        # We do NOT fabricate a pass: the reason is stated plainly rather than
        # returning a silent ``benchmark_result: None`` that reads as
        # "all clear".
        benchmark_result = None
        benchmark_skipped_reason = None
        try:
            benchmark_result = self.benchmark.run_benchmark()
        except BenchmarkCorpusError as exc:
            benchmark_skipped_reason = (
                f"benchmark not run — accuracy not validated: {exc}"
            )

        return {
            "new_rules_proposed": len(new_rules),
            "rules": [r.description for r in new_rules],
            "benchmark_skipped_reason": benchmark_skipped_reason,
            "benchmark_result": (
                {
                    "overall_accuracy": benchmark_result.overall_accuracy,
                    "field_accuracies": benchmark_result.field_accuracies,
                }
                if benchmark_result
                else None
            ),
        }


# =============================================================================
# MODULE-LEVEL SINGLETON
# =============================================================================

_service_instance: Optional[ActiveLearningService] = None


def get_active_learning_service() -> ActiveLearningService:
    """Get module-level singleton active learning service."""
    global _service_instance
    if _service_instance is None:
        _service_instance = ActiveLearningService()
    return _service_instance
