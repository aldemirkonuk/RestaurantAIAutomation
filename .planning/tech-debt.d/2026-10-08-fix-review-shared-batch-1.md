## ReceivingWorkspace's "proposed alongside submitted" test can type over the prefill — OPEN — 2026-10-08

Found on PR #565's CI at a62b71a1e. Run: https://github.com/aldemirkonuk/RestaurantAIAutomation/actions/runs/37835810878/job/113519611015 (Test TypeScript).

**What.**
- `apps/web/src/pages/inventory/command/ReceivingWorkspace.test.tsx:367`, "sends what the extraction proposed alongside what the manager submitted", failed with `expected 2224 to be 24` at `:382` (`body.invoiceQuantityInInvoiceUom`).
- 2224 is the prefilled 22 followed by the typed 24. The test waits for the "Read from their paperwork" text (`:371`), then runs `user.clear` and `user.type`. The quantity prefill can land after the clear, so the typing is appended to it.
- PR #565 does not touch this file or the receiving workspace. The test passed locally at the same head (full vitest: 5613 passed), and main's CI was green at 8b22448dc.

**Fix.** Before clearing, wait until the input holds the prefill (`await waitFor(() => expect(invoiceQtyInput()).toHaveValue(22))`), or select-all and type. Then confirm the race is gone by running the file many times (for example `--repeat 50`).
