## Edit-by-id census side findings: no cross-house write, eight smaller gaps — OPEN — 2026-09-29

Found while tracing, one by one, the 75 "safe" rows of `07-reference/GATEWAY-EDIT-BY-ID-SCOPE-2026-09-29.md` that #529 graded without a filter-level citation (evidence: that census's 2026-09-29 addendum, cited on `origin/main` d80e41e69). All 75 hold; none of these is a write into another house. Census line numbers below are `census:<line>`.

- **census:90 `PATCH /organizations/locations/:id`** — scoped by the caller's role in the *target* house; `lookupRestaurantRole` (`organizations.service.ts:39-45`) reads `is_active` but not `valid_until`, and `chainId` may be any chain in any of the caller's organisations (`:404-412`). Same `is_active`-only reading as ADR 0242's named follow-up for the gates and last-owner counts.
- **census:127 SimPOS check PATCH** — body `tableId` written unchecked; the FK accepts another house's table (a cross-house reference). Not mounted in production (`app.module.ts:117`).
- **census:112/113 tool revoke** — `.ilike(tool_name, <caller text>)`, so `%`/`_` act as wildcards within the caller's own connection.
- **census:122 `PATCH /onboarding/threshold`** — protected only by the guard's body `restaurantId` comparison; adding `@AllowsTenantChange` would open it.
- **census:77 `DELETE /notifications/read/all`** — clears the caller's read notifications in every house; the PATCH counterpart filters by house.
- **No role check** (any member acts): census:81-84, 95, 97-101, 120, 122, 123, 151. Whether each should be role-gated is a product question, not settled here.
- **A delete that matched no row reports success**: census:57, 65, 84 (parent delete error dropped), 123, 126, 131, 133, 134.
- **Census evidence incomplete, grades unchanged**: census:92 omits the `users` oauth update, :121 a self-heal write, :94 two inserts, :136 names 2 of `cancelOrder`'s 7 writes, :180 the `zone_setup_access` compare-and-set filter.
