## Endpoint audit: 51 routes reach another house's rows, 2 are uncertain — OPEN — 2026-09-30

Found by the 817-route trace behind [ADR 0245](../decisions/0245-endpoints-md-is-generated-from-the-controllers-and-cited-by-route.md). Every entry was traced at `5a20d774b`, then re-traced by an adversarial verifier: 0 refuted. Each route's evidence, exploit and note are in its row: `grep -n 'id="<route id>"' .planning/foundation/ENDPOINTS.md`. Grouped by root cause. **Status** is one of: *live* (reachable in production today), *latent* (the path exists but fails before any data today), *env-gated* (answers only when an env flag is set, or when `NODE_ENV` is not `production`), *unmounted* (no module imports it).

Two fix lanes cover the marked groups:
- **[A]** = ADR 0243, `fix/tenant-guard-and-cross-house-runs`: guard refuses non-string names; `clocks/run` operator-only; `execute-check` non-prod and operator-only.
- **[B]** = ADR 0244, `fix/order-approval-and-alert-relays`.

Both are in flight. Neither is merged.

1. **The tenant guard compares only string house names — high, live [A].** `assertTenantMatch` drops a non-string `restaurantId`/`restaurant_id` (`assert-tenant-match.ts:61-62`). So `?restaurantId[]=<other>`, or a body `{"restaurantId":["<other>"]}`, passes the guard. The global `ValidationPipe` then coerces a raw `@Query` value to that string, and postgrest renders `.eq(col, ["B"])` as `eq.B`. The swept inputs split as follows:
   - 9 routes had the guard as their only house binding: [insight catalog](../foundation/ENDPOINTS.md#get-analytics-insight-catalog-types), the 3 Toast query routes, `GET /contacts`, and the 4 test routes in group 12.
   - 17 inputs are DTO-validated and safe.
   - Only the insight catalog was newly unscoped by this; the other 8 carry other causes below.
2. **Runs across every house for any member — high, live [A].**
   - [`POST /procurement/deliveries/clocks/run`](../foundation/ENDPOINTS.md#post-procurement-deliveries-clocks-run): a body `now` in the future lapses every house's open deliveries, writing legal deeming text and sending high-priority pushes. At most 500 timers per call, and it repeats.
   - [`POST /recurring-orders/:restaurantId/execute-check`](../foundation/ENDPOINTS.md#post-recurring-orders-restaurantid-execute-check): runs every house's due schedules now, with a double-run race against the 08:00 cron.
3. **Open relays from the platform senders — medium, live [B].**
   - [daily summary](../foundation/ENDPOINTS.md#post-communications-alerts-daily-summary): about 155 characters of free text by SMS to any number.
   - [low stock](../foundation/ENDPOINTS.md#post-communications-alerts-low-stock): email to any address and SMS to any number.
   - No role check, no allow-list, nothing recorded, and no caller in the repo.
4. **Foreign ids stored unchecked, then read by id alone — medium, live; each needs the other house's uuid.**
   - Procurement documents and deliveries. A body `providerId`, `orderId` or `orderLineId` is stored without a house check. The canonical build then reads `providers` and `procurement_order_items` by id alone. Routes:
     - [canonical](../foundation/ENDPOINTS.md#get-procurement-documents-id-canonical)
     - [upload](../foundation/ENDPOINTS.md#post-procurement-documents)
     - [door count](../foundation/ENDPOINTS.md#post-procurement-documents-door-count)
     - [line link](../foundation/ENDPOINTS.md#post-procurement-documents-id-lines-lineid-link)
     - [corrections](../foundation/ENDPOINTS.md#post-procurement-documents-id-corrections)
     - [fields verify](../foundation/ENDPOINTS.md#post-procurement-documents-id-fields-verify)
     - [extraction](../foundation/ENDPOINTS.md#post-procurement-documents-id-extraction), which persists a foreign provider's name and tax id into this house's `document_revisions`
     - [deliveries](../foundation/ENDPOINTS.md#post-procurement-deliveries), whose 409 text prints the other house's ordered counts
   - **Ledger poisoning.** A planted order id is stamped on this house's `inventory_transactions.order_id`. `deliveryHasBookedOrder` then reads that ledger by `order_id` alone, so the other house's [deliver](../foundation/ENDPOINTS.md#post-procurement-orders-id-deliver), [door receipt](../foundation/ENDPOINTS.md#post-procurement-receiving-orders-id-door) and [name item](../foundation/ENDPOINTS.md#post-procurement-orders-id-name-item) skip booking its stock without any error.
   - Recurring orders, low severity: [create](../foundation/ENDPOINTS.md#post-recurring-orders-restaurantid) and [update](../foundation/ENDPOINTS.md#put-recurring-orders-restaurantid-id) store a foreign `inventory_id`/`provider_id`, and reads then embed that house's names.
5. **Idempotency and dedupe keys without a house — medium, live.**
   - [POS import](../foundation/ENDPOINTS.md#post-pos-hub-import-restaurantid): the stock key `pos:<source>:<check>:<item>:<line>` is deduped globally, so a second house's identical line moves no stock, and any member can pre-claim keys. The webhook shares the key.
   - The vendor-intel scrape, sweep and site-sweep upsert on a global `(source_ref, content_hash)` index. A later house's sighting is dropped without any error, and the drop tells it another house scraped the page.
6. **A house's provisional library rows read without the owner filter — low, live.** [`GET /wines`](../foundation/ENDPOINTS.md#get-wines), [by id](../foundation/ENDPOINTS.md#get-wines-wineid), [similar](../foundation/ENDPOINTS.md#get-wines-wineid-similar), [suggestions](../foundation/ENDPOINTS.md#get-wines-suggestions), [vendor-intel compare](../foundation/ENDPOINTS.md#get-vendor-intel-compare) and [observations](../foundation/ENDPOINTS.md#post-vendor-intel-observations). The MCP `prices.compare` tool reaches the same read.
7. **Platform-wide rows open to any member or any house's manager.**
   - [Wine submissions list](../foundation/ENDPOINTS.md#get-wines-submissions-list): medium, live. Every house's raw submissions and submitter ids.
   - [site-sweep status](../foundation/ENDPOINTS.md#get-vendor-intel-site-sweep-status): env-gated, `VENDOR_SITE_SWEEP_ENABLED`.
   - [outlier re-judge run](../foundation/ENDPOINTS.md#post-vendor-intel-outlier-rejudge-run): env-gated, `PRICE_OUTLIER_REJUDGE_ENABLED`. It rewrites every house's outlier verdicts and names house ids in its failures.
8. **Read by id with no ownership check.**
   - [ledger balance](../foundation/ENDPOINTS.md#get-inventory-ledger-inventory-inventoryid-balance): low to medium, live. One integer of another house's stock.
   - [distributor-feed withdraw](../foundation/ENDPOINTS.md#post-distributor-feed-codes-distributorkey-mappingid-withdraw): low, live. A count oracle.
   - [recurrence generate](../foundation/ENDPOINTS.md#post-calendar-recurrence-ruleid-generate): latent. The RPC is a stub that returns 0.
9. **Organisation chains, OD-131 (b), founder-deferred — medium, live.** [list](../foundation/ENDPOINTS.md#get-organizations-chains) (low), [create](../foundation/ENDPOINTS.md#post-organizations-chains), [rename](../foundation/ENDPOINTS.md#patch-organizations-chains-id) and [delete](../foundation/ENDPOINTS.md#delete-organizations-chains-id), which detaches every house in the chain. Any `organization_members` row admits the caller. Nothing deletes that row when a house membership ends: for organisation owners that is ruled by OD-131 (a); for manager and staff rows it is undecided.
10. **The Toast proxy — latent.** Production answers 503 while `TOAST_MOCK_MODE` is unset. In non-mock mode the proxy sends no `X-Admin-Key`, so the orchestrator answers 401. Routes: [menus](../foundation/ENDPOINTS.md#get-toast-menus), [menu](../foundation/ENDPOINTS.md#get-toast-menus-menuid), [order](../foundation/ENDPOINTS.md#get-toast-orders-orderid), [sales](../foundation/ENDPOINTS.md#get-toast-sales) and [place order](../foundation/ENDPOINTS.md#post-toast-orders), all of which call Toast under the one platform credential. [Cache refresh](../foundation/ENDPOINTS.md#post-toast-cache-refresh) is live but inert: nothing is cached to evict.
11. **The contacts module — unmounted.** Five routes: [`GET /contacts`](../foundation/ENDPOINTS.md#get-contacts), with no house filter when `restaurant_id` is omitted; [by id](../foundation/ENDPOINTS.md#get-contacts-id); [addresses](../foundation/ENDPOINTS.md#get-contacts-id-addresses); [create](../foundation/ENDPOINTS.md#post-contacts), whose nested `contact.restaurant_id` the guard never compares; and [add address](../foundation/ENDPOINTS.md#post-contacts-id-addresses). This is a hazard only if the module is ever mounted.
12. **Test routes — env-gated.** `NonProductionGuard` answers 404 when `NODE_ENV` is `production`. The routes:
    - [scenario](../foundation/ENDPOINTS.md#post-communications-test-scenario) and [step 1](../foundation/ENDPOINTS.md#post-communications-test-e2e-step1-trigger-threshold) write to the default house.
    - [step 2](../foundation/ENDPOINTS.md#post-communications-test-e2e-step2-approve-reorder) approves any order by id.
    - [step 3](../foundation/ENDPOINTS.md#post-communications-test-e2e-step3-send-vendor-email) asks the orchestrator to send any draft.
    - [step 4](../foundation/ENDPOINTS.md#get-communications-test-e2e-step4-check-inbound) and [step 6](../foundation/ENDPOINTS.md#get-communications-test-e2e-step6-check-status) read across houses.
    - [step 5](../foundation/ENDPOINTS.md#post-communications-test-e2e-step5-approve-confirmation) reads any order.
    - [SimPOS sweep](../foundation/ENDPOINTS.md#post-simpos-restaurantid-scenarios-runs-runid-sweep) is mounted only when `NODE_ENV` is not `production`.
13. **Uncertain — unreachable today.** [candidate decide](../foundation/ENDPOINTS.md#post-vendor-intel-identity-candidates-decide) and [decision undo](../foundation/ENDPOINTS.md#post-vendor-intel-identity-decisions-undo) write a subject's identity link by id alone. No application writes `beverage_identity_candidates` (CLAIMS `ADR-0124-NO-CANDIDATE-WRITER`).

**Not checked:** production data (for example how many provisional library rows exist), production env values, and runtime behaviour. The in-process proof of group 1 is the verifier's, not a live request.

## Endpoint audit: systemic side findings — OPEN — 2026-09-30

Same source and method as the entry above. These are counts or classes, not per-route defects. Each cited row's note carries its detail.

- **Writes with no role check.** 231 of the 422 JWT routes that write have `role_check.kind` `none`: any member, staff included, may call them. Many are by design, since staff count, receive and pour. Some set house policy or spend money, for example:
  - [order PATCH to APPROVED without the seal](../foundation/ENDPOINTS.md#patch-procurement-orders-id) [B]
  - [UX review](../foundation/ENDPOINTS.md#post-ux-proposals-id-review), which puts a change live
  - [vendor delete](../foundation/ENDPOINTS.md#delete-providers-id)
  - [retroactive order](../foundation/ENDPOINTS.md#post-providers-id-retroactive-order)
  - [onboarding threshold](../foundation/ENDPOINTS.md#patch-onboarding-threshold)
  - [Gmail force-fetch](../foundation/ENDPOINTS.md#post-communications-webhooks-gmail-force-fetch), an operator action with no operator check
- **Deletes and rejects that answer success for nothing.** A foreign or missing id answers 2xx, for example [exclusions](../foundation/ENDPOINTS.md#delete-analytics-exclusions-restaurantid-businessdate), [event types](../foundation/ENDPOINTS.md#delete-calendar-event-types-id), [templates](../foundation/ENDPOINTS.md#delete-restaurants-restaurantid-templates-templateid), [recurring order](../foundation/ENDPOINTS.md#delete-recurring-orders-restaurantid-id), [catalog-match reject](../foundation/ENDPOINTS.md#post-pos-hub-catalog-match-restaurantid-proposals-proposalid-reject) and [mobile device](../foundation/ENDPOINTS.md#delete-mobile-devices-token) (204 on a database error).
- **GETs that write.** 18 GET routes write, for example [insights](../foundation/ENDPOINTS.md#get-analytics-insights-restaurantid), [recommendations](../foundation/ENDPOINTS.md#get-analytics-recommendations-restaurantid) (impressions), [team members](../foundation/ENDPOINTS.md#get-restaurants-restaurantid-team-members) (roster insert), [UX experiment](../foundation/ENDPOINTS.md#get-ux-experiments-key) (arm assignment) and [SimPOS check](../foundation/ENDPOINTS.md#get-simpos-restaurantid-check). A crawler or prefetch changes state.
- **Unchecked cross-house pointers that are stored but not read back across houses.** Examples: calendar `providerId`/`orderId`, [payment method](../foundation/ENDPOINTS.md#post-payment-methods) `providerRef`, whose delete detaches that id at Stripe, inventory `providerId`/`storageLocationId`, and ledger location, order and delivery refs. Where the pointer is read back across houses, it is in group 4 above.
- **Errors reported as absence.** A failed read answers as an empty result, for example [chains](../foundation/ENDPOINTS.md#get-organizations-chains) (`[]`), [vendor performance](../foundation/ENDPOINTS.md#get-providers-id-performance), [vendor-catalogue match](../foundation/ENDPOINTS.md#get-vendor-catalogue-match) and [mobile feed](../foundation/ENDPOINTS.md#get-mobile-feed). A reader cannot tell "none" from "could not read".
- **Broken routes.**
  - The four commodity admin routes ([proposal](../foundation/ENDPOINTS.md#get-commodity-index-admin-series-key-proposal), [history](../foundation/ENDPOINTS.md#get-commodity-index-admin-series-key-history), [arm](../foundation/ENDPOINTS.md#post-commodity-index-admin-series-key-arm), [disarm](../foundation/ENDPOINTS.md#post-commodity-index-admin-series-key-disarm)) always answer 403, even with the right `X-Admin-Key`. `@Public()` makes `JwtAuthGuard` skip `request.user`, so the class-level `RolesGuard` refuses before `ServiceKeyGuard` runs. The verifier reproduced this with the real guards. No other route has this shape.
  - Conversations [approve](../foundation/ENDPOINTS.md#post-conversations-conversationid-approve), [reject](../foundation/ENDPOINTS.md#post-conversations-conversationid-reject) and [edit message](../foundation/ENDPOINTS.md#put-conversations-conversationid-message) write `manager_approval_status`, `approval_channel`, `resumed_at`, `manager_approved_message` and `manager_notes`. No migration creates those columns on `procurement_conversations`. So on the migrated schema the update fails and the route answers 400, after approve has already spent its seal. Whether production has the columns was not queried. If it does, the later publish still fails, because the orchestrator serves no `/api/v1/events/publish`.
- **POS webhook legacy secret.** On the `POS_HUB_WEBHOOK_SECRET` rung, [the webhook](../foundation/ENDPOINTS.md#post-pos-hub-webhook-provider-restaurantid) signs the raw body only. A body signed for house A therefore verifies on house B's path and depletes B's stock. The per-provider rung signs for every house of that provider; only per-connection secrets bind one house. The production rung configuration is not in the repo.
- **`NODE_ENV: preserve()`.** `.railway/railway.ts` declares a Railway `NODE_ENV` variable for the gateway whose value is not in the repo. A Railway variable overrides the Dockerfile's `ENV NODE_ENV=production`, so that value is what really holds these shut: the 10 `NonProductionGuard` routes, the SimPOS mount and the Toast mock-data refusal. No check probes it. `toast.service.ts`'s comment says the gate holds "regardless of Railway's variable list", and it cites a stale Dockerfile line.
- **Other security notes, each in its row.**
  - [member add](../foundation/ENDPOINTS.md#post-restaurants-restaurantid-members) looks the target up with `.ilike` on email, so wildcards probe addresses platform-wide. Medium.
  - [logout](../foundation/ENDPOINTS.md#post-auth-logout) leaves the refresh token valid for up to 7 days.
  - [account delete](../foundation/ENDPOINTS.md#delete-auth-me) and [provider unlink](../foundation/ENDPOINTS.md#delete-auth-me-link-provider) have no fresh-sign-in step-up.
  - [invite-code accept](../foundation/ENDPOINTS.md#post-auth-invite-code-accept) ignores the invite's target address, which is undecided under ADR 0229.
  - [inbound email](../foundation/ENDPOINTS.md#post-webhooks-inbound-email) accepts its secret in the query string and compares it in non-constant time.
