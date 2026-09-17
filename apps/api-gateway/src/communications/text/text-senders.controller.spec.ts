import { TextSendersController } from "./text-senders.controller";

/**
 * REGRESSION (found 2026-09-17 by the nightly E2E walk, PR #349 / ADR 0135):
 * every route on this controller read `user.id`, which `JwtStrategy.validate`
 * never sets (only `userId`, auth/strategies/jwt.strategy.ts). `@CurrentUser()`
 * hands the object over untyped, so `Actor { id: string; restaurantId: string }`
 * compiled and every actor was `undefined` at runtime:
 *
 *   - GET /communications/text-senders returned
 *     `myConsent.reason: 'invalid input syntax for type uuid: "undefined"'`
 *     for every caller (measured live).
 *   - declareOwn/requestRegistration/revoke called
 *     `assertCanManageRestaurant(undefined, ...)`, which resolves no role for
 *     any user and throws FORBIDDEN — every manager was refused, always.
 *   - consent/withdraw wrote `user_id: undefined` to `person_text_consents`,
 *     dropped by JSON serialization, so the insert/update touched no row for
 *     the intended person.
 *
 * `user` below carries no `id` field at all, matching the real JwtStrategy
 * shape — a regression back to `.id` fails these on `undefined`, not silently.
 */
describe("TextSendersController — actor identity", () => {
  const user = { userId: "u1", restaurantId: "rest-1" } as any;

  function build(opts: { role?: string | null } = {}) {
    const roleChecks: any[] = [];
    const senderCalls: Record<string, any[]> = {};
    const record = (name: string) => (args: any) => {
      (senderCalls[name] ??= []).push(args);
    };

    const senders: any = {
      readout: async () => ({ whatsapp: null, sms: null, readable: true, reason: null }),
      myConsent: async (restaurantId: string, userId: string) => {
        record("myConsent")({ restaurantId, userId });
        return { consent: null, readable: userId !== undefined, reason: userId === undefined ? 'invalid input syntax for type uuid: "undefined"' : null };
      },
      liveConsentCount: async () => 0,
      declareOwn: async (args: any) => {
        record("declareOwn")(args);
        return { id: "sender-1", ...args };
      },
      requestRegistration: async (args: any) => {
        record("requestRegistration")(args);
        return { id: "sender-2", ...args };
      },
      revoke: async (args: any) => {
        record("revoke")(args);
        return { revoked: true, words: "done" };
      },
      consent: async (args: any) => {
        record("consent")(args);
        return { userId: args.userId, phone: args.phone, channel: args.channel, consentedAt: "now" };
      },
      withdraw: async (args: any) => {
        record("withdraw")(args);
        return { withdrawn: 1 };
      },
    };

    const organizations: any = {
      assertCanManageRestaurant: async (userId: string, restaurantId: string) => {
        roleChecks.push({ userId, restaurantId });
        if (opts.role !== "manager" && opts.role !== "owner") {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        }
      },
    };

    const controller = new TextSendersController(senders, organizations);
    return { controller, roleChecks, senderCalls };
  }

  it("readout resolves the caller's OWN consent by a real userId, not undefined", async () => {
    const { controller, senderCalls } = build();

    const result = await controller.readout(user);

    expect(senderCalls.myConsent).toEqual([{ restaurantId: "rest-1", userId: "u1" }]);
    expect(result.myConsent.readable).toBe(true);
  });

  it("declareOwn checks the manager gate with the caller's real userId", async () => {
    const { controller, roleChecks, senderCalls } = build({ role: "manager" });

    await controller.declareOwn(user, {
      channel: "sms",
      market: "US",
      identity: "+15550000000",
      identityKind: "e164",
    } as any);

    expect(roleChecks).toEqual([{ userId: "u1", restaurantId: "rest-1" }]);
    expect(senderCalls.declareOwn[0].declaredBy).toBe("u1");
  });

  it("requestRegistration files the requester, never undefined", async () => {
    const { controller, senderCalls } = build({ role: "owner" });

    await controller.requestRegistration(user, {
      channel: "whatsapp",
      market: "TR",
      legalName: "Test House",
      registeredAddress: "Addr",
      contactName: "A",
      contactEmail: "a@example.com",
      useCase: "orders",
      sampleMessages: ["hi"],
      optInDescription: "opt in",
    } as any);

    expect(senderCalls.requestRegistration[0].declaredBy).toBe("u1");
  });

  it("revoke files who revoked it", async () => {
    const { controller, senderCalls } = build({ role: "manager" });

    await controller.revoke(user, { senderId: "s1", reason: "no longer used" });

    expect(senderCalls.revoke[0].revokedBy).toBe("u1");
  });

  it("a manager gate with no manager role still names the real caller before refusing", async () => {
    const { controller, roleChecks } = build({ role: "staff" });

    await expect(
      controller.declareOwn(user, {
        channel: "sms",
        market: "US",
        identity: "+15550000000",
        identityKind: "e164",
      } as any),
    ).rejects.toMatchObject({ status: 403 });

    // The refusal is a real role decision, not an accident of an undefined
    // actor resolving to "no role" the way it did in production.
    expect(roleChecks).toEqual([{ userId: "u1", restaurantId: "rest-1" }]);
  });

  it("consent writes the person's own userId", async () => {
    const { controller, senderCalls } = build();

    await controller.consent(user, { phone: "+15550000000", channel: "sms" });

    expect(senderCalls.consent[0].userId).toBe("u1");
  });

  it("withdraw reads back the person's own userId", async () => {
    const { controller, senderCalls } = build();

    await controller.withdraw(user);

    expect(senderCalls.withdraw[0].userId).toBe("u1");
  });

  it("myConsent (GET /consent) never asks with an undefined userId", async () => {
    const { controller, senderCalls } = build();

    await controller.myConsent(user);

    expect(senderCalls.myConsent).toEqual([{ restaurantId: "rest-1", userId: "u1" }]);
  });
});
