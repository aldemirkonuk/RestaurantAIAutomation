## The leave/delete negative control can see three queue tables appear mid-test — OPEN — 2026-10-08

Filed from docs/flake-leave-delete-negative-control (slot F140-R5, on the coordinator's word).

**What.** `apps/api-gateway/src/auth/leave-and-delete-account.routes.spec.ts:534-548` ("leave answers the documented 500 and the leaver is still there") snapshots `JSON.stringify(db.tables)` before the call and expects it unchanged after. On PR #598's CI at `335aa05bf` (run 37831444382, job 113499065334, 2026-10-08T19:33Z), the "after" snapshot held three extra keys that the "before" did not: `relay_email_queue`, `vendor_send_requests` and `procurement_conversations`, each an empty array. Nothing else differed. #598 touches no gateway file; main was green; the re-run of the failed job passed.

**What it means.** The snapshot is not isolated from those queue tables: something other than the request under test reads them during the call, and the in-memory fake records a table on first read. Which caller does so was not traced.

**Fix (not done).** Find the reader of the three tables during this spec, then either stop it in the spec, or compare only the roster and account tables the negative control is about. Not fixed in #598 (coordinator, 2026-10-08).

## Two gateway links open /orders with `?highlight=`, which /orders does not read — OPEN — 2026-10-08

Filed from docs/flake-leave-delete-negative-control (slot F140-R5; found by the #598 round-15 gate, `p4-scratch/audits/598-f111dee/final.md`).

**What.** `apps/api-gateway/src/dashboard/dashboard.service.ts:1478` sets `actionUrl: /orders?highlight=<id>` and `apps/api-gateway/src/house/house-day.service.ts:182` sets `href: /orders?highlight=<id>`. /orders reads only the route id or `?order=` (`apps/web/src/pages/orders/next/OrdersNext.tsx:67`), so these links open /orders without pointing at the order. The web dashboard's own link already uses `?order=`. (`dashboard.service.ts:1460`/`:1493` send `/inventory?highlight=`; whether /inventory reads it was not checked.)

**Fix (not done).** Emit `?order=` from both gateway lines, and pin it with a test.
