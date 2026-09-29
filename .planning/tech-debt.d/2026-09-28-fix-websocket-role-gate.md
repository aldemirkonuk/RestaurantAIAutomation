## Staff sockets received the owner/manager-only promotions, vendor-price and injected notices — ~~OPEN~~ CLOSED 2026-09-28 (fix/websocket-role-gate) — 2026-09-28

Found by the ADR 0090 security review of PR #493, then inventoried and verified at `46c3fdb5d` (read-only). Filed and closed in one PR, so it can be checked again.

**What.** `WebsocketGateway.handleConnection` joined every verified member's socket, staff included, to `restaurant:<id>`, and the web toasts `notification:new` with no role check (`apps/web/src/lib/websocket.tsx`, `notification:new` handler). Five doors carried content that an HTTP gate refuses staff, or that no member should be able to inject:
1. `PromotionExtractorService` sent the promotion toast and the 9am digest there, and the digest's inbox rows went to every member through `persistManagerNotification`. The digest line reads `Vendor — 15% off`. `GET /promotions` is owner/manager only (`promotions.controller.ts`; ADR 0124:357-362).
2. The orchestrator's `notification.promo_alert` (`provider_conversation_agent.py`, the new-promotion and expiring-promotion alerts on `provider_promotions`) was forwarded by the bridge to the same room. The bridge threw the routing key away, so it could not tell one `notification.*` key from another.
3. The market-price producer wrote "Vendor is quoting $X … against a 30-day average of $Y" as a row, a live toast and a phone push to every member. `/vendor-intel`, which serves the same read, is owner/manager only (`vendor-intel.controller.ts`). The push also put a vendor and amounts on a locked screen, against ADR 0175 D3.
4. `POST /notifications` (any member) fanned the caller's own row to `restaurant:<id>`. Its body was an inline type, so it was not validated, and the web's View button runs `window.location.href = action_url`. So a staff member could put a `javascript:` link on the owner's screen.
5. `endStaleSessions` read `server.sockets.sockets`. `@WebSocketServer()` under `namespace: "/ws"` is the Namespace, whose `sockets` is already the Map, so a password change closed no socket (ADR 0225). The spec mocked the root-Server shape and passed.

**Fix.**
- `houseMembersInRoles` (`common/tenant/live-membership.ts`) reads `user_restaurant_access` with `isLiveMembership`. It has no `users.restaurant_id` fallback, and it throws on a failed read.
- Each verified socket also joins `member:<house>:<user>`, outside the `restaurant:` prefix that `subscribe:restaurant` builds. `evictFromHouse` leaves it.
- `emitToHouseRoles` / `emitRoleNotification` read the roles at send time and emit to those member rooms. A failed read emits nothing.
- Promotions (both sites, and the digest rows through `persistManagerNotification`'s new `roles` option) go to owners and managers only. The toast now links to `/promotions` instead of `/providers`, which redirects to `/vendors`.
- The bridge passes `msg.fields.routingKey` to its handlers. `NOTIFICATION_AUDIENCE_BY_KEY` maps `notification.promo_alert` to owner_manager and the other 28 keys the orchestrator publishes to house.
- The market-price producer narrows its audience to owners and managers, the way `GrantSuspendedProducer` does, and writes at priority `low` (no push).
- `POST /notifications` has a DTO. It emits only to `user:<id>`, and it refuses an `actionUrl` that `safeActionPath` does not reduce to an in-app path. That function parses the value, so `/\evil`, `/\t/evil` and `/.//evil` are refused too, not only `//evil`. Every gateway `notification:new` emit drops a link that is not such a path.
- `endStaleSessions` reads the Namespace's map.
- The dead `manager:<self>` room, `emitNotification` and `broadcastSystemMessage` are deleted.
- The prospect notice links to `/communications` (ADR 0160 Open item 3). Its audience stays house-wide because `GET /prospects` is open to any member (`prospects.controller.ts`).

**Behaviour that did change.**
- Staff no longer get the three notices above, live or in the inbox.
- The market-price notice no longer pushes.
- A `POST /notifications` with an off-app link now gets a 400. The only web caller sends `/calendar`.
- A password change or reset now closes that person's sockets on the instance that ran it, as ADR 0225 says.

**Evidence.**
- `websocket/websocket-audiences.spec.ts` has 21 cases, 20 of them red on `46c3fdb5d`. It drives the real gateway, extractor, bridge (including `setupSubscriptions` over a fake channel) and `persistManagerNotification`, over a fake Namespace that delivers by room.
- `market-price.producer.spec.ts` has 2 new cases, and `password-change-ends-sessions.spec.ts`, with its mock moved to the Namespace shape, has 2 more. All 4 are red on `46c3fdb5d`.
- 17 of 17 source mutations were killed by those specs, and 8 of 8 by the CLAIMS verify. That verify fails on `46c3fdb5d` with 20 reasons.
- The whole gateway suite on the branch: 599 suites passed and 2 skipped; 10580 tests passed and 14 skipped. Both `tsc --noEmit` configs are clean, and `scripts/check_gateway_boots.sh` passes.

**Still open, stated.**
- The web sinks still navigate to whatever a row holds: `websocket.tsx` (View button and `window.open(download_url)`), `Notifications.tsx`, `nt-format.ts` and `HouseBand.tsx`. Rows written before this fix are not rewritten.
- `persistForRestaurant`'s targeted live emit still goes to `user:<id>`, which is not house-scoped.
- `persistManagerNotification`'s default path, `scheduled-tasks.service.ts` `persistRestaurantNotification` and Python `core/notifications.py` stay role-blind. See OD-180.
- The six older role readers are not migrated. The CLAIMS row pins the count at 7.
- The ungated `/providers/promotions/*` and `/providers/:id/promotions` routes on `provider-intelligence.controller.ts` are a sibling HTTP door to the same rows.
- `getStats` and `cleanupIdleConnections` still read the root-Server shape. A working idle sweep would disconnect mobile sockets, which never send `ping`.
- The connect-time membership read and the room joins are separated by awaits (TOCTOU).
- There is no socket.io adapter, so an eviction on another instance does not reach this one's rooms.
- Also seen: `IntegrationsOAuthService.safeReturnPath` returns `//evil.test` for `/.//evil.test`. Its one server caller prefixes the origin, so no redirect leaves the site. Not traced further.

**Severity:** high. Commercially sensitive vendor pricing reached every staff account's screen and phone, and any member could plant a click-to-run link in the owner's live UI.

**Tracked by** CLAIMS `SEC-2026-09-28-WEBSOCKET-ROLE-GATE` (resolved).
