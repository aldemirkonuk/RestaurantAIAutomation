## ReceivingWorkspace correction test typed "2224" for "24": CLOSED on `fix/receiving-test-flake` (2026-10-08)

`apps/web/src/pages/inventory/command/ReceivingWorkspace.test.tsx`, the ADR 0059 test "sends what the extraction proposed alongside what the manager submitted", flaked twice in main-based CI: on #565 and on #659. The quantity field ended up as "2224" instead of "24".

**Cause.** The test waited only for the banner "Read from their paperwork" before clearing the field. That banner renders before the pre-fill `useEffect` (ReceivingWorkspace.tsx ~:412-455) commits `setInvoiceQty(22)`. On a slow runner, `user.clear` could run first. The effect then refilled 22, and typing appended to it, giving 2224.

**Fixed.** A `prefillLanded(qty)` helper waits for the banner and then for the field's own value. Three tests use it: the correction test, "records agreement too", and the free-goods test. All three read pre-filled figures right after the banner. The correction test also asserts the field is empty after the clear and holds 24 after the typing, so a refill now fails at the step that caused it rather than in the request body.

**Not proven:** the race does not reproduce locally. The file passed 6 runs out of 6 (42/42 each) both before and after the fix on this machine. The fix removes the window the symptom points to; it is not shown by a red-then-green run.
