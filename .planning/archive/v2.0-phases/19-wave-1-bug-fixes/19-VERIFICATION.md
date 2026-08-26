---
phase: 19-wave-1-bug-fixes
verified: "2026-07-31"
status: passed
method: "retroactive — ran the bug suites the UAT names, not SUMMARY aggregation"
score: "12/12 BUG requirements satisfied"
requirements_satisfied:
  [BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06,
   BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, BUG-12]
---

# Phase 19 Verification — Wave 1 Bug Fixes

## Why this exists

The v2.0 audit scored Phase 19 PARTIAL: `19-UAT.md` passes and all four plans have
SUMMARY files, but no VERIFICATION.md existed and REQUIREMENTS.md showed 0 of 12
BUG-* boxes checked. ROADMAP.md still shows `19-01`…`19-04` unchecked.

## Evidence

`19-UAT.md` is unusually good source material: rather than asserting outcomes it
names the exact commands to run — e.g. *"Run pytest
tests/test_pos_integration_bugs.py -v. All 13 tests pass."* So this verification
ran them.

```
tests/test_inventory_engine_bugs.py
tests/test_pos_integration_bugs.py
tests/test_notification_agent_bugs.py
tests/test_reporting_agent_bugs.py

38 passed
```

Full suite: `749 passed, 3 skipped, 0 failed`.

| Plan | Requirements | Suite |
|---|---|---|
| 19-01 InventoryEngine — optimistic locking, dead code | BUG-01, BUG-02 | `test_inventory_engine_bugs.py` |
| 19-02 POSIntegrationAgent — hmac, wine detection, signature, refund | BUG-03..06 | `test_pos_integration_bugs.py` |
| 19-03 NotificationAgent — Redis rate limits, batch monitoring | BUG-07, BUG-08 | `test_notification_agent_bugs.py` |
| 19-04 ReportingAgent — self.db crash, SMS, real reports, PDF | BUG-09..12 | `test_reporting_agent_bugs.py` |

## The part that would have been missed by reading documents

`test_pos_integration_bugs.py` — the file this UAT explicitly expects to see 13
passing tests in — **had 2 failures at the start of this sweep**, in
`TestBUG06RefundLogic`, precisely the BUG-06 refund logic Phase 19 exists to fix.

The cause was an incomplete in-flight refactor rather than a regression in the fix
itself: `MessageBus.publish` was renamed `exchange`→`exchange_name` and
`message`→`message_body`, the agent call sites were updated, and two test doubles
still declared the old parameter names. Because the agent calls `publish()` with
keyword arguments, the stale mock could never be invoked, and the failure presented
as *"0 events published"* — indistinguishable from the refund path being broken.

Repaired in `6162f67`; the file now passes 13/13, matching the UAT's stated
expectation exactly.

**A verification written from the SUMMARY files would have recorded BUG-06 as fixed
while its test was failing.**

## Conclusion

**Phase 19 is verified.** All 12 BUG requirements satisfied, all four named bug
suites green. REQUIREMENTS.md updated from 0/12 to 12/12 and the four ROADMAP plan
boxes checked.
