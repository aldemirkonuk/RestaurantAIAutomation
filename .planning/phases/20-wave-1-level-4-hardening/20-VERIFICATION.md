---
phase: 20-wave-1-level-4-hardening
verified: "2026-07-31"
status: passed
method: "retroactive — ran the suite, did not aggregate the SUMMARY files"
score: "4/4 HARD requirements satisfied"
requirements_satisfied: [HARD-01, HARD-02, HARD-03, HARD-04]
caveat: "A regression this file's own VALIDATION claimed was green was failing when this ran. Fixed first — see below."
---

# Phase 20 Verification — Wave 1 Level 4 Hardening

## Why this exists

The v2.0 milestone audit scored Phase 20 PARTIAL for one reason: it is the
**strongest-evidenced phase in the milestone and had no top-level verification
artifact**. VALIDATION.md (`nyquist_compliant: true`, 74 automated tests, 0 gaps),
SECURITY.md (18/18 threats closed, ASVS L1), and two passing UATs all existed. Only
the document that ties them together was missing.

## The thing that nearly made this a rubber stamp

Aggregating those four documents would have produced a clean VERIFICATION in two
minutes. Running the suite instead found **two failing tests**:

```
FAILED tests/test_pos_integration_bugs.py::TestBUG06RefundLogic::test_refund_publishes_POSSaleRefunded_not_voided
FAILED tests/test_pos_integration_bugs.py::TestBUG06RefundLogic::test_refund_event_contains_amount_and_reason
```

VALIDATION.md states, in its own words, *"Regression suite still passing | PASS
(all bug test files confirmed green)"*. That was true when written and false when
checked.

**Cause: an incomplete in-flight refactor, not a product bug.** `MessageBus.publish`
was renamed `exchange`→`exchange_name` and `message`→`message_body`, and the agent
call sites were updated. Two test doubles still declared the old names:

```python
async def mock_publish(exchange, routing_key, message):   # stale
```

The agent calls `publish()` with keyword arguments, so the stale mock could not be
invoked — and the failure surfaced as *"0 events published"*, which reads exactly
like a broken refund path. A signature mismatch wearing the costume of a product
bug. Mocks updated to the real signature; suite green.

**This is the argument for the whole 44.4 sweep.** Six phases are missing this
artifact, and the tempting close for each is to summarise the SUMMARY files. Had I
done that here, this document would assert a passing regression suite that was
failing at the moment of writing.

## Evidence

Run 2026-07-31 against `services/agent-orchestrator`:

```
749 passed, 3 skipped, 0 failed
```

| Requirement | Claim | Check |
|---|---|---|
| HARD-01 InventoryEngine L4 | 24 tests ≥ 15 required | ✅ suite green |
| HARD-02 POSIntegrationAgent L4 | 18 tests ≥ 15 required | ✅ suite green, incl. the two repaired BUG-06 tests |
| HARD-03 NotificationAgent L4 | 16 tests ≥ 10 required | ✅ suite green |
| HARD-04 ReportingAgent L4 | 16 tests ≥ 10 required | ✅ suite green |

Supporting artifacts, all pre-existing and consistent:

- `20-VALIDATION.md` — `nyquist_compliant: true`, 74 automated, 0 gaps found
- `20-SECURITY.md` — `status: secured`, 18/18 threats closed, 0 open
- `20-UAT.md` — `status: complete`, `result: pass`
- `20-W2-UAT.md` — `status: complete`, 6/6 passed, 0 issues

## Conclusion

**Phase 20 is verified.** All four HARD requirements are satisfied, the security
review is closed, both UATs passed, and the suite is green — after repairing a
regression that the phase's own validation document claimed was already green.

REQUIREMENTS.md checkboxes for HARD-01..04 updated to match.

## Note for the rest of 44.4

Phases 18 and 19 have SUMMARY files plus a UAT — enough to attempt this properly.

Phases **22, 28 and 35 have SUMMARY files and nothing else**. There is no
independent evidence to verify against, so writing a VERIFICATION for them would
be transcribing self-reports into a document that looks like an audit. That is the
same failure mode as everything else this milestone turned up: an artifact that
asserts more than anyone checked. They need verification *work*, not a verification
*file*, and the register says so rather than closing them.
