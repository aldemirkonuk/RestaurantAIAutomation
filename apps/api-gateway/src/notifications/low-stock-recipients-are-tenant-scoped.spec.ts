/**
 * A low-stock email for restaurant B never goes to restaurant A's inbox.
 *
 * THE DEFECT THIS FILE PINS (measured against `origin/main` @ 77eb7888):
 *
 *   `LowStockAlertsService.resolveEmails(restaurantId)` is called once per
 *   restaurant, from `emailDigest(restaurantId, …)`. It reached for the global
 *   `MANAGER_EMAIL` env var whenever a restaurant resolved to no recipients of
 *   its own. That env var names ONE restaurant's manager, so every other
 *   tenant's stock levels were addressed to them.
 *
 *   It leaked at two layers, and closing either one alone leaves the hole:
 *
 *     1. `resolveRecipients` was called without `allowDefaultFallback`. That
 *        option defaults to `true`, so the RESOLVER substituted the global
 *        address before this method ever saw an empty list.
 *     2. If the resolver still returned nothing, the `MANAGER_EMAIL` read at
 *        the bottom of the method substituted it a second time.
 *
 *   This is the same cross-tenant leak OD-87 / ADR 0022 closed inside the
 *   resolver, reproduced one layer up in a caller that predated the fix.
 *
 * NOT HYPOTHETICAL: verified in production 2026-08-26, 6 of 10 restaurants
 * have only an `owner` row in `user_restaurant_access` and no `manager`, while
 * this job asks for `["manager"]` — so those six resolved to zero users and
 * took this path every time.
 *
 * Tests marked `[PRE-FIX-FAILS]` were observed failing against `origin/main`;
 * counts are in ADR 0093. The legacy-tenant test is a both-states guard: it
 * passes before and after, and is what stops "delete the fallback outright"
 * from satisfying this suite, since the legacy tenant's recipient list must not
 * move by a single address as part of a multi-tenancy fix.
 */

import { LowStockAlertsService } from "./low-stock-alerts.service";

const LEGACY = "legacy-restaurant-id";
const OTHER = "some-other-tenant-id";
const GLOBAL_MANAGER = "founder@legacy.test";

/**
 * Builds the service with a resolver that resolves NOBODY — the condition that
 * triggered the leak. `resolveRecipients` is a spy so the test can assert on
 * the options it was handed, not just on what came back: layer 1 of the leak is
 * invisible in the return value once layer 2 is fixed.
 */
function makeService(opts: { resolverThrows?: boolean } = {}) {
  const resolveRecipients = jest.fn(async () => {
    if (opts.resolverThrows) throw new Error("db down");
    return { emails: [], phones: [] };
  });

  const config = {
    get: (key: string) =>
      key === "MANAGER_EMAIL"
        ? GLOBAL_MANAGER
        : key === "DEFAULT_RESTAURANT_ID"
          ? LEGACY
          : undefined,
  };

  const service = new LowStockAlertsService(
    {} as any, // DatabaseService — resolveEmails never touches it
    {} as any, // NotificationsService — likewise
    config as any,
    undefined, // GmailService is @Optional()
    { resolveRecipients } as any,
  );

  const warnings: string[] = [];
  jest.spyOn((service as any).logger, "warn").mockImplementation((m: any) => {
    warnings.push(String(m));
  });
  for (const level of ["log", "debug", "error"]) {
    jest
      .spyOn((service as any).logger, level as any)
      .mockImplementation(() => {});
  }

  return { service, resolveRecipients, warnings };
}

const resolveEmails = (service: LowStockAlertsService, id: string) =>
  (service as any).resolveEmails(id) as Promise<string[]>;

describe("LowStockAlertsService.resolveEmails — tenant scoping", () => {
  it("[PRE-FIX-FAILS] returns no address for a tenant that resolves to nobody", async () => {
    // Layer 2. Pre-fix this returned [GLOBAL_MANAGER].
    const { service } = makeService();
    expect(await resolveEmails(service, OTHER)).toEqual([]);
  });

  it("[PRE-FIX-FAILS] forbids the resolver's own env fallback for a non-default tenant", async () => {
    // Layer 1. Asserted on the CALL, because with layer 2 fixed this leak
    // would be invisible in the return value — the resolver would substitute
    // the global address and this method would hand it straight back as a
    // legitimately-resolved recipient.
    const { service, resolveRecipients } = makeService();
    await resolveEmails(service, OTHER);
    expect(resolveRecipients).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: OTHER,
        allowDefaultFallback: false,
      }),
    );
  });

  it("[PRE-FIX-FAILS] says so in the log rather than sending nothing silently", async () => {
    // An empty recipient list that nobody announces is indistinguishable from
    // "this tenant had no low stock" — absence reported as health.
    const { service, warnings } = makeService();
    await resolveEmails(service, OTHER);
    expect(warnings.join("\n")).toMatch(/RECIPIENTS_NONE/);
    expect(warnings.join("\n")).toContain(OTHER);
  });

  it("[PRE-FIX-FAILS] does not fall back to the global address when the resolver throws", async () => {
    // The pre-fix `catch {}` swallowed the error and fell through to the env
    // var, so an outage became a cross-tenant send.
    const { service } = makeService({ resolverThrows: true });
    expect(await resolveEmails(service, OTHER)).toEqual([]);
  });

  it("still uses the env fallback for the legacy default tenant", async () => {
    // Both-states guard. MANAGER_EMAIL genuinely IS this restaurant's manager,
    // and ADR 0022 requires its recipient list not move as part of this fix.
    const { service } = makeService();
    expect(await resolveEmails(service, LEGACY)).toEqual([GLOBAL_MANAGER]);
  });

  it("[PRE-FIX-FAILS] allows the resolver’s env fallback only for the legacy default tenant", async () => {
    const { service, resolveRecipients } = makeService();
    await resolveEmails(service, LEGACY);
    expect(resolveRecipients).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: LEGACY,
        allowDefaultFallback: true,
      }),
    );
  });

  it("returns resolved tenant addresses untouched when there are any", async () => {
    // Never-vacuous guard: proves the empty results above come from the
    // fallback being refused, not from this method being unable to return
    // anything at all.
    const { service, resolveRecipients } = makeService();
    resolveRecipients.mockResolvedValueOnce({
      emails: ["their-own@tenant.test"],
      phones: [],
    } as any);
    expect(await resolveEmails(service, OTHER)).toEqual([
      "their-own@tenant.test",
    ]);
  });
});
