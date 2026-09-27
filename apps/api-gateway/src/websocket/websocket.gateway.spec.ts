import { WebsocketGateway } from "./websocket.gateway";

/**
 * Item 1 (HIGH), ADR 0164's websocket sibling: a socket whose token names no
 * house — or names a house it no longer holds active membership in — must
 * never be admitted to that house's `restaurant:{id}` room, at connect or via
 * `subscribe:restaurant`. Before this fix, `handleSubscribeRestaurant` only
 * ever compared the two ids (`metadata.restaurantId !== data.restaurantId`)
 * and never checked they existed, so a token naming no house sailed straight
 * through: `if (undefined && ...)` is `false`, "not unauthorized". And
 * `handleConnection` never checked the token's house against a live
 * membership row at all, so a token surviving past a removal opened the
 * house's socket room exactly as before it was removed.
 */

/**
 * `handleConnection` reads `users` (ADR 0225's session-version check) before
 * it reads `user_restaurant_access` (this file's membership check), so every
 * stub here must answer both tables: `users` with a session that is always
 * current (these tests are about the house, not the session — that gate is
 * `password-change-ends-sessions.spec.ts`'s job), and `user_restaurant_access`
 * with what the test actually cares about.
 */
function currentUsersRow(): any {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({
      data: { session_version: 0 },
      error: null,
    })),
  };
  return builder;
}

function makeSupabaseStub(activeRows: Record<string, boolean>) {
  return {
    from: jest.fn((table: string) => {
      if (table === "users") return currentUsersRow();
      let userId: string | undefined;
      let restaurantId: string | undefined;
      const builder: any = {
        select: jest.fn(() => builder),
        eq: jest.fn((col: string, val: string) => {
          if (col === "user_id") userId = val;
          if (col === "restaurant_id") restaurantId = val;
          return builder;
        }),
        limit: jest.fn(async () => {
          const key = `${userId}:${restaurantId}`;
          return {
            data: activeRows[key] ? [{ id: "row-1" }] : [],
            error: null,
          };
        }),
      };
      return builder;
    }),
  };
}

/**
 * A read that fails must refuse the house, never admit it. Only the
 * `user_restaurant_access` read fails — `users` stays current, so this
 * exercises the membership read's own failure, not the session check's.
 */
function makeFailingSupabaseStub(message: string) {
  return {
    from: jest.fn((table: string) => {
      if (table === "users") return currentUsersRow();
      const builder: any = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        limit: jest.fn(async () => ({ data: null, error: { message } })),
      };
      return builder;
    }),
  };
}

function makeDeps(supabase: ReturnType<typeof makeSupabaseStub>) {
  const jwtService = { verify: jest.fn() } as any;
  const configService = { get: jest.fn().mockReturnValue("test-secret") } as any;
  const databaseService = { supabase } as any;
  return { jwtService, configService, databaseService };
}

function makeSocket(id: string): any {
  return {
    id,
    handshake: { auth: { token: "t" }, headers: {}, query: {} },
    emit: jest.fn(),
    join: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe("WebsocketGateway — a houseless or non-member socket cannot join a restaurant room", () => {
  it("refuses subscribe:restaurant for a socket whose token names no house at all", async () => {
    const { jwtService, configService, databaseService } = makeDeps(
      makeSupabaseStub({}),
    );
    jwtService.verify.mockReturnValue({ sub: "user-1" }); // no restaurantId claim
    const gateway = new WebsocketGateway(jwtService, configService, databaseService);
    const socket = makeSocket("s1");

    await gateway.handleConnection(socket);
    const result = gateway.handleSubscribeRestaurant(socket, {
      restaurantId: "house-A",
    });

    expect(result).toEqual({
      success: false,
      error: "Unauthorized restaurant subscription",
    });
  });

  it("refuses subscribe:restaurant when the token's claimed house has no active membership row", async () => {
    const { jwtService, configService, databaseService } = makeDeps(
      makeSupabaseStub({}), // no active rows anywhere — membership ended
    );
    jwtService.verify.mockReturnValue({ sub: "user-1", restaurantId: "house-A" });
    const gateway = new WebsocketGateway(jwtService, configService, databaseService);
    const socket = makeSocket("s2");

    await gateway.handleConnection(socket);
    const result = gateway.handleSubscribeRestaurant(socket, {
      restaurantId: "house-A",
    });

    expect(result).toEqual({
      success: false,
      error: "Unauthorized restaurant subscription",
    });
  });

  it("refuses the house on a failed membership read at connect (refuses, never admits)", async () => {
    const { jwtService, configService, databaseService } = makeDeps(
      makeFailingSupabaseStub("connection reset") as any,
    );
    jwtService.verify.mockReturnValue({ sub: "user-1", restaurantId: "house-A" });
    const gateway = new WebsocketGateway(jwtService, configService, databaseService);
    const socket = makeSocket("s3");

    await gateway.handleConnection(socket);
    const result = gateway.handleSubscribeRestaurant(socket, {
      restaurantId: "house-A",
    });

    expect(result).toEqual({
      success: false,
      error: "Unauthorized restaurant subscription",
    });
  });

  it("still admits a socket whose token names a house it IS an active member of", async () => {
    const { jwtService, configService, databaseService } = makeDeps(
      makeSupabaseStub({ "user-1:house-A": true }),
    );
    jwtService.verify.mockReturnValue({ sub: "user-1", restaurantId: "house-A" });
    const gateway = new WebsocketGateway(jwtService, configService, databaseService);
    const socket = makeSocket("s4");

    await gateway.handleConnection(socket);
    const result = gateway.handleSubscribeRestaurant(socket, {
      restaurantId: "house-A",
    });

    expect(result).toEqual({ success: true, room: "restaurant:house-A" });
  });

  it("evictFromHouse revokes a live subscription and blocks resubscribing to it", async () => {
    const { jwtService, configService, databaseService } = makeDeps(
      makeSupabaseStub({ "user-1:house-A": true }),
    );
    jwtService.verify.mockReturnValue({ sub: "user-1", restaurantId: "house-A" });
    const gateway = new WebsocketGateway(jwtService, configService, databaseService);
    const socketsLeave = jest.fn();
    (gateway as any).server = { in: jest.fn(() => ({ socketsLeave })) };
    const socket = makeSocket("s5");

    await gateway.handleConnection(socket);
    expect(
      gateway.handleSubscribeRestaurant(socket, { restaurantId: "house-A" })
        .success,
    ).toBe(true);

    gateway.evictFromHouse("user-1", "house-A");
    expect(socketsLeave).toHaveBeenCalledWith("restaurant:house-A");

    const result = gateway.handleSubscribeRestaurant(socket, {
      restaurantId: "house-A",
    });
    expect(result).toEqual({
      success: false,
      error: "Unauthorized restaurant subscription",
    });
  });
});
