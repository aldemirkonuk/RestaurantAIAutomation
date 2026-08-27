"""ontology_v1 — the only grader in the tree with real domain ground truth."""

from services.ontology_verdict import ontology_verdict


def test_all_rules_passing_is_success():
    v = ontology_verdict(checks_passed=4, checks_failed=0, checks_total=4)
    assert v["outcome"] == "success"


def test_any_hard_rule_failure_is_failure():
    # These rules do not produce false positives by design: a grape that cannot
    # grow in an appellation is not a matter of degree.
    v = ontology_verdict(checks_passed=3, checks_failed=1, checks_total=4)
    assert v["outcome"] == "failure"
    assert v["evidence"]["checks_failed"] == 1


def test_no_rule_applied_is_untestable_not_success():
    # A wine with too few fields for any rule to apply must NOT score the same
    # as one that satisfied every rule. This is the distinction OD-59 keeps
    # insisting on, and the one a bare count(*) loses.
    v = ontology_verdict(checks_passed=0, checks_failed=0, checks_total=0)
    assert v["outcome"] is None
    assert v["evidence"]["untestable"] == "no_ontology_rule_applied"


def test_untestable_and_passing_are_distinguishable():
    assert ontology_verdict(0, 0, 0)["outcome"] != ontology_verdict(4, 0, 4)["outcome"]


def test_evidence_carries_the_counts_for_recheck():
    # A disputed verdict must be re-checkable without re-running validation.
    v = ontology_verdict(checks_passed=2, checks_failed=2, checks_total=4)
    assert v["evidence"] == {
        "checks_passed": 2,
        "checks_failed": 2,
        "checks_total": 4,
    }
