## ReceivingWorkspace correction test typed "2224" for "24": CLOSED on `fix/receiving-test-flake` (2026-10-08)

`apps/web/src/pages/inventory/command/ReceivingWorkspace.test.tsx`, the ADR 0059 test "sends what the extraction proposed alongside what the manager submitted", flaked twice in main-based CI: on #565 and on #659. The quantity field ended up as "2224" instead of "24".

**Cause.** The test waited only for the banner "Read from their paperwork" before clearing the field. That banner renders before the pre-fill `useEffect` (ReceivingWorkspace.tsx ~:412-455) commits `setInvoiceQty(22)`. On a slow runner, `user.clear` could run first. The effect then refilled 22, and typing appended to it, giving 2224.

**Fixed.** A `prefillLanded(qty)` helper waits for the banner and then for the field's own value. Three tests use it: the correction test, "records agreement too", and the free-goods test. All three read pre-filled figures right after the banner. The correction test also asserts the field is empty after the clear and holds 24 after the typing, so a refill now fails at the step that caused it rather than in the request body.

**Proven by a forced race (scratch probe, not committed).** The pre-fill effect in ReceivingWorkspace.tsx was patched to commit its figures 30 ms after the banner, through a setTimeout that bumps a state the effect depends on. Running only "sends what the extraction proposed":
- old test: FAILS, `AssertionError: expected 2224 to be 24` at the `invoiceQuantityInInvoiceUom` assertion. This is the CI symptom.
- new test: passes, 1 of 1.

Without the probe, the whole file passes 42/42 on 6 runs out of 6, both before and after the fix. The race does not show on this machine unless forced.
