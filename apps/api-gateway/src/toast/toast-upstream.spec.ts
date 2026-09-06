import { HttpStatus } from "@nestjs/common";
import { ToastService } from "./toast.service";
import { DatabaseService } from "../database/database.service";
import { ToastUpstream, TOAST_UPSTREAM_ROUTES } from "./toast-upstream";
import {
  orchestratorServesToast,
  toastServiceOrchestratorCalls,
} from "./orchestrator-routes";

/**
 * The failure status for `/api/v1/toast/*` is DERIVED, not declared.
 *
 * Six gateway calls target an orchestrator router that has never existed, and a
 * sibling service change is building it now. Before this file the status was
 * written out per method — PR #230 hardcoded 501 in `getStatistics`, the other
 * five forwarded the upstream status, so a missing router surfaced as a bare
 * 404 indistinguishable from a missing record. Six sites is six chances to
 * forget one on the day the router lands, and a stale 501 is itself a false
 * statement: it tells a monitor to stop retrying something that now works.
 *
 * What these tests pin:
 *   1. Router absent  → 501 on all six, and nothing resolves.
 *   2. Router present, Toast unconfigured → 503 on all six, never 501, and
 *      still nothing resolves. This is the case that must come for free when
 *      the sibling lands, with no edit to any of the six call sites.
 *   3. Router present, record genuinely missing → 404 stays 404. The 501 is
 *      made on evidence, never on the shape of the call.
 *   4. Orchestrator unreachable → 503, never 501. "Never built" is a claim, and
 *      a claim needs evidence we did not get.
 *   5. The derivation and #230's build-time ratchet read the same route set.
 *
 * Which of these FAIL on the pre-change tree (the merge of #223 + #230):
 *   - (1) fails for five of the six: getMenus/getMenu/createOrder/getOrder/
 *     getSalesData forwarded the orchestrator's 404 rather than answering 501.
 *     getStatistics already answered 501 there, by constant.
 *   - (2) fails for getStatistics: its hardcoded 501 fires on ANY upstream
 *     failure, so an orchestrator that exists and says 503 was reported as
 *     "never implemented" anyway.
 *   - (3) fails: getMenu/getOrder had no way to tell the two 404s apart.
 *   - (5) is new.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An axios rejection carrying an HTTP response, the way the real client fails. */
function httpError(status: number, data: any = {}) {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return err;
}

/** An axios rejection with no response at all — nothing was reached. */
function transportError(code = "ECONNREFUSED") {
  const err: any = new Error(code);
  err.code = code;
  return err;
}

/**
 * A service with mock mode OFF, so the real orchestrator path is taken. Mock
 * mode short-circuits before the HTTP call, and a test that ran through it
 * would pass for the wrong reason.
 */
function serviceWith(handlers: { get?: jest.Mock; post?: jest.Mock }) {
  const configService: any = {
    get: (key: string, fallback?: any) =>
      key === "TOAST_MOCK_MODE" ? false : fallback,
  };
  const cacheService: any = {
    get: async () => null,
    set: async () => undefined,
    del: async () => undefined,
    invalidateByPattern: async () => 0,
  };
  const service = new ToastService(configService, cacheService, {
    supabase: {},
  } as unknown as DatabaseService);
  const get = handlers.get ?? jest.fn();
  const post = handlers.post ?? jest.fn();
  (service as any).httpClient = { get, post };
  return { service, get, post };
}

const ORDER_DTO: any = {
  items: [
    { itemGuid: "item-1", name: "Opus One", quantity: 1, unitPrice: 4500 },
  ],
  tableName: "Table 5",
  serverName: "Alex",
};

/** A valid GUID — the SSRF guard rejects anything else before the HTTP call. */
const GUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** Every one of the six, driven through the service's public surface. */
function allSixCalls(
  service: ToastService,
): Array<[string, () => Promise<any>]> {
  return [
    ["getMenus", () => service.getMenus("r1")],
    ["getMenu", () => service.getMenu(GUID)],
    ["createOrder", () => service.createOrder("r1", ORDER_DTO)],
    ["getOrder", () => service.getOrder(GUID)],
    [
      "getSalesData",
      () => service.getSalesData("r1", new Date(0), new Date(3600000)),
    ],
    ["getStatistics", () => service.getStatistics()],
  ];
}

// ---------------------------------------------------------------------------
// 1. The router does not exist → 501, on all six
// ---------------------------------------------------------------------------

describe("orchestrator has no /api/v1/toast router", () => {
  /**
   * Starlette 404s every path it does not route, and its body is
   * `{"detail": "Not Found"}` — note the absence of `message`, so the forwarded
   * branch could not have produced a useful sentence even if it had fired.
   */
  function absentRouterService() {
    const notFound = () =>
      Promise.reject(httpError(404, { detail: "Not Found" }));
    return serviceWith({
      get: jest.fn(notFound),
      post: jest.fn(notFound),
    });
  }

  it.each([
    "getMenus",
    "getMenu",
    "createOrder",
    "getOrder",
    "getSalesData",
    "getStatistics",
  ])("%s answers 501 Not Implemented", async (name) => {
    const { service } = absentRouterService();
    const call = allSixCalls(service).find(([n]) => n === name)![1];
    await expect(call()).rejects.toMatchObject({
      status: HttpStatus.NOT_IMPLEMENTED,
    });
  });

  it("says the route was never implemented, not just that something failed", async () => {
    const { service } = absentRouterService();
    for (const [, call] of allSixCalls(service)) {
      await expect(call()).rejects.toThrow(/never been implemented/i);
    }
  });

  it("resolves nothing — no mock menus, no mock sales, no invented order", async () => {
    // ADR 0020's first half. A refusal that still hands back a plausible body
    // is the failure this whole seam was built to stop.
    const { service } = absentRouterService();
    for (const [name, call] of allSixCalls(service)) {
      let resolved: any = Symbol("did-not-resolve");
      try {
        resolved = await call();
      } catch {
        /* expected */
      }
      expect(`${name}:${typeof resolved}`).toBe(`${name}:symbol`);
    }
  });

  it("costs one confirming request for an id path, then remembers", async () => {
    // /menus/:id can 404 because the router is missing OR because the menu is.
    // The first ambiguous 404 buys one collection request as evidence; the
    // verdict is memoised, so the second does not.
    const { service, get } = absentRouterService();

    await expect(service.getMenu(GUID)).rejects.toMatchObject({
      status: HttpStatus.NOT_IMPLEMENTED,
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toBe(TOAST_UPSTREAM_ROUTES.menus);

    await expect(service.getOrder(GUID)).rejects.toMatchObject({
      status: HttpStatus.NOT_IMPLEMENTED,
    });
    expect(get).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// 2. The router exists, Toast is not connected → 503, on all six
// ---------------------------------------------------------------------------

describe("orchestrator serves /api/v1/toast but Toast is not connected", () => {
  /**
   * The state the sibling's router lands in for a restaurant with no Toast
   * credentials. Nothing in the gateway is edited to reach this — the six 501s
   * stop on their own, which is the entire point of deriving the status.
   */
  function unconfiguredToastService() {
    const unavailable = () =>
      Promise.reject(
        httpError(503, {
          message: "Toast is not connected for this restaurant",
        }),
      );
    return serviceWith({
      get: jest.fn(unavailable),
      post: jest.fn(unavailable),
    });
  }

  it.each([
    "getMenus",
    "getMenu",
    "createOrder",
    "getOrder",
    "getSalesData",
    "getStatistics",
  ])("%s answers 503, and never 501", async (name) => {
    const { service } = unconfiguredToastService();
    const call = allSixCalls(service).find(([n]) => n === name)![1];
    await expect(call()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });

  it("forwards the orchestrator's own sentence rather than inventing one", async () => {
    // The party that knows the condition names it. The gateway does not
    // paraphrase a 503 it did not diagnose.
    const { service } = unconfiguredToastService();
    await expect(service.getMenus("r1")).rejects.toThrow(
      /Toast is not connected for this restaurant/,
    );
  });

  it("still resolves nothing", async () => {
    const { service } = unconfiguredToastService();
    for (const [name, call] of allSixCalls(service)) {
      let resolved: any = Symbol("did-not-resolve");
      try {
        resolved = await call();
      } catch {
        /* expected */
      }
      expect(`${name}:${typeof resolved}`).toBe(`${name}:symbol`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The router exists and the record does not → 404 stays 404
// ---------------------------------------------------------------------------

describe("orchestrator serves the router but the record is missing", () => {
  it("keeps a genuine 404 a 404 — 501 is claimed on evidence, not on shape", async () => {
    // The confirming request to the collection path succeeds, which proves the
    // prefix routes, which means the 404 was about the ORDER and not the router.
    const get = jest.fn(async (url: string) => {
      if (url === TOAST_UPSTREAM_ROUTES.menus)
        return { data: { menus: [], total: 0 } };
      throw httpError(404, { message: "Order not found" });
    });
    const { service } = serviceWith({ get });

    await expect(service.getOrder(GUID)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    await expect(service.getOrder(GUID)).rejects.toThrow(/Order not found/);
  });
});

// ---------------------------------------------------------------------------
// 4. The orchestrator did not answer → 503, never 501
// ---------------------------------------------------------------------------

describe("orchestrator unreachable", () => {
  function downService() {
    const down = () => Promise.reject(transportError());
    return serviceWith({ get: jest.fn(down), post: jest.fn(down) });
  }

  it.each([
    "getMenus",
    "getMenu",
    "createOrder",
    "getOrder",
    "getSalesData",
    "getStatistics",
  ])(
    "%s answers 503 and does not claim the route was never built",
    async (name) => {
      // We never reached the orchestrator, so we learned nothing about its
      // routes. Answering 501 here would be a fabricated diagnosis.
      const { service } = downService();
      const call = allSixCalls(service).find(([n]) => n === name)![1];
      await expect(call()).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
      await expect(call()).rejects.not.toThrow(/never been implemented/i);
    },
  );

  it("keeps the wording the surfaces already use", async () => {
    // #223 pins these strings for the two paths that feed menus and analytics;
    // deriving the STATUS must not quietly reword the MESSAGE.
    const { service } = downService();
    await expect(service.getMenus("r1")).rejects.toThrow(
      /Failed to fetch menus from Toast/,
    );
    await expect(
      service.getSalesData("r1", new Date(0), new Date(3600000)),
    ).rejects.toThrow(/Failed to fetch sales data from Toast/);
  });

  it("tells the caller of an order that nothing was placed", async () => {
    // The acting path's refusal has to answer the question the caller will
    // actually ask next, whichever status the derivation lands on.
    const { service } = downService();
    await expect(service.createOrder("r1", ORDER_DTO)).rejects.toThrow(
      /NOT sent and nothing was placed/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The derivation flips on its own, and agrees with the build-time ratchet
// ---------------------------------------------------------------------------

describe("ToastUpstream verdict lifecycle", () => {
  const silentLogger = { warn: () => undefined, error: () => undefined };

  it("re-derives after the TTL, so a router that lands is noticed without a redeploy", async () => {
    let now = 0;
    let routed = false;
    const http = {
      get: async () => {
        if (!routed) throw httpError(404, { detail: "Not Found" });
        return { data: { menus: [], total: 0 } };
      },
    };
    const upstream = new ToastUpstream(http, silentLogger, 60_000, () => now);

    // Absent: a collection 404 is evidence on its own.
    let refusal = await upstream.describe({
      route: TOAST_UPSTREAM_ROUTES.menus,
      summary: "s",
      error: httpError(404, { detail: "Not Found" }),
    });
    expect(refusal.getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    expect(upstream.routerState()).toBe("absent");

    // The sibling deploys. No gateway code changes.
    routed = true;
    now += 61_000;
    expect(upstream.routerState()).toBe("unknown");

    refusal = await upstream.describe({
      route: TOAST_UPSTREAM_ROUTES.order,
      summary: "s",
      error: httpError(404, { message: "Order not found" }),
    });
    expect(refusal.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(upstream.routerState()).toBe("registered");
  });

  it("will not conclude 'absent' from a check it could not make", async () => {
    const upstream = new ToastUpstream(
      { get: async () => Promise.reject(transportError()) },
      silentLogger,
    );
    const refusal = await upstream.describe({
      route: TOAST_UPSTREAM_ROUTES.menu,
      summary: "Failed to fetch menu",
      error: httpError(404, { message: "Menu not found" }),
    });
    expect(refusal.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(upstream.routerState()).toBe("unknown");
  });

  it("covers exactly the calls the ratchet finds in toast.service.ts", () => {
    // One route table, cross-checked against the source rather than against a
    // second hand-maintained list. A seventh call fails here as well as in
    // toast-dead-surface.spec.ts.
    expect(Object.values(TOAST_UPSTREAM_ROUTES).slice().sort()).toEqual(
      toastServiceOrchestratorCalls(),
    );
  });

  // DELETED 2026-09-03, on this test's own written instruction. It pinned
  // "the orchestrator declares no /api/v1/toast router" as *today's premise*,
  // and said that when the sibling router landed the correct response was to
  // delete it rather than edit `toast-upstream.ts`. PR #236 landed that router.
  // The runtime derivation needed no change at all, which is exactly what it
  // was written for — so this is the ratchet succeeding, not a test lost.
});
