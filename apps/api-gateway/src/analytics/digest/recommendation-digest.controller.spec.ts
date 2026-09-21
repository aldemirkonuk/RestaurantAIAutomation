/**
 * The digest's two doors, through the controller:
 *
 *  - `unsubscribe/:token` — no session. GET renders and changes nothing (mail
 *    scanners follow links); POST stops the one digest the token was mailed
 *    with. Driven through the REAL service against the store that enforces the
 *    migration's constraints; only the page's HTTP response object is a double.
 *  - `subscription` — the person and the house come from the token, never from
 *    the path or the body.
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RATE_LIMIT_KEY, SKIP_RATE_LIMIT_KEY } from "../../common/rate-limit";
import { RecommendationDigestController } from "./recommendation-digest.controller";
import { RecommendationDigestService } from "./recommendation-digest.service";
import { hashUnsubscribeToken, newUnsubscribeToken } from "./digest-schedule";
import { FakeDb } from "./testing/digest-fake-db";

const HOUSE = "house-1";
const ANA = "user-ana";

function fakeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
  };
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.type = (t: string) => {
    res.headers["content-type"] = t;
    return res;
  };
  res.status = (n: number) => {
    res.statusCode = n;
    return res;
  };
  res.send = (b: string) => {
    res.body = b;
    return res;
  };
  return res;
}

function build() {
  const db = new FakeDb();
  const token = newUnsubscribeToken();
  db.tables.restaurants = [{ id: HOUSE, name: "Meyhouse <Palo Alto>" }];
  db.tables.recommendation_digest_subscriptions = [
    {
      id: "sub-ana",
      restaurant_id: HOUSE,
      user_id: ANA,
      frequency: "daily",
      weekday: null,
      subscribed_at: "2026-09-02T10:00:00Z",
      updated_at: "2026-09-02T10:00:00Z",
      unsubscribed_at: null,
      unsubscribed_via: null,
    },
  ];
  db.tables.recommendation_digest_sends = [
    {
      id: "send-1",
      restaurant_id: HOUSE,
      user_id: ANA,
      period_key: "2026-09-17",
      frequency: "daily",
      due_at: "2026-09-17T04:00:00Z",
      time_zone: "Europe/Istanbul",
      claimed_at: "2026-09-17T04:05:00Z",
      outcome: "sent",
      sent_at: "2026-09-17T04:05:01Z",
      unsubscribe_token_hash: hashUnsubscribeToken(token),
    },
  ];
  const database = { getClient: () => db, supabase: db } as any;
  const service = new RecommendationDigestService(
    database,
    {} as any,
    {} as any,
    {} as any,
    { get: () => undefined } as any,
  );
  const controller = new RecommendationDigestController(service);
  const sub = () => db.rows("recommendation_digest_subscriptions")[0];
  return { db, token, service, controller, sub };
}

describe("the unsubscribe link", () => {
  it("GET renders a page with a stop button, escapes the house name, and changes nothing", async () => {
    const { controller, token, sub, db } = build();
    const res = fakeRes();

    await controller.unsubscribeLanding(token, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Stop the recommendations digest?");
    expect(res.body).toContain('<form method="post" action="">');
    expect(res.body).toContain("Meyhouse &lt;Palo Alto&gt;");
    expect(res.body).toContain("support@mudavym.com");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(res.headers["content-security-policy"]).toMatch(
      /default-src 'none'/,
    );
    expect(sub().unsubscribed_at).toBeNull();
    expect(db.writes).toHaveLength(0);
  });

  it("POST (the button, or a mail client's one-click) stops that digest and says so; again says already stopped", async () => {
    const { controller, token, sub } = build();

    const first = fakeRes();
    await controller.unsubscribe(token, first);
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain("The digest is stopped");
    expect(first.body).not.toContain("<form");
    expect(sub()).toMatchObject({ unsubscribed_via: "link" });
    expect(sub().unsubscribed_at).toBeTruthy();

    const second = fakeRes();
    await controller.unsubscribe(token, second);
    expect(second.body).toContain("Already stopped");
  });

  it("a token we never sent is a 404 page, not a stop", async () => {
    const { controller, sub } = build();
    for (const bad of ["x", "b".repeat(64)]) {
      const res = fakeRes();
      await controller.unsubscribe(bad, res);
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("This is not a link we sent");
    }
    expect(sub().unsubscribed_at).toBeNull();
  });

  it("a store that cannot be read is a 503 page saying nothing was changed — never a false 'stopped'", async () => {
    const { controller, token, db, sub } = build();
    db.failures["recommendation_digest_sends:select"] = "connection refused";
    const res = fakeRes();
    await controller.unsubscribe(token, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("nothing was changed");
    expect(res.body).not.toContain("connection refused");
    expect(sub().unsubscribed_at).toBeNull();
  });

  it("a stop that did not land is a 503, not a 'stopped'", async () => {
    const { controller, token, db } = build();
    db.failures["recommendation_digest_subscriptions:update"] = "write failed";
    const res = fakeRes();
    await controller.unsubscribe(token, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("The digest is stopped");
  });

  it("both link routes are @Public and carry no JWT guard; the subscription routes carry JwtAuthGuard", () => {
    const proto = RecommendationDigestController.prototype as any;
    for (const name of ["unsubscribeLanding", "unsubscribe"]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto[name])).toBe(true);
      expect(Reflect.getMetadata("__guards__", proto[name]) ?? []).toEqual([]);
    }
    for (const name of [
      "getSubscription",
      "putSubscription",
      "deleteSubscription",
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto[name])).toBeUndefined();
      expect(Reflect.getMetadata("__guards__", proto[name])).toEqual([
        JwtAuthGuard,
      ]);
    }
  });

  it("the one-click POST is never rate-limited — a provider's servers post for every recipient on it — while the GET page keeps its limit", () => {
    const proto = RecommendationDigestController.prototype as any;
    expect(Reflect.getMetadata(SKIP_RATE_LIMIT_KEY, proto.unsubscribe)).toBe(
      true,
    );
    expect(
      Reflect.getMetadata(RATE_LIMIT_KEY, proto.unsubscribe),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(SKIP_RATE_LIMIT_KEY, proto.unsubscribeLanding),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(RATE_LIMIT_KEY, proto.unsubscribeLanding),
    ).toMatchObject({ limit: 30, windowSeconds: 600 });
  });
});

describe("the person's own subscription takes the person and the house from the token", () => {
  it("passes the token's user and active restaurant, whatever the body says", async () => {
    const service = {
      statusFor: jest.fn().mockResolvedValue({}),
      subscribe: jest.fn().mockResolvedValue({}),
      stopForSelf: jest.fn().mockResolvedValue({}),
    };
    const controller = new RecommendationDigestController(service as any);
    const user = { userId: ANA, restaurantId: HOUSE };

    await controller.getSubscription(user);
    await controller.putSubscription(user, {
      frequency: "daily",
      restaurantId: "other-house",
      userId: "other-user",
    } as any);
    await controller.deleteSubscription(user);

    expect(service.statusFor).toHaveBeenCalledWith(ANA, HOUSE);
    expect(service.subscribe.mock.calls[0].slice(0, 2)).toEqual([ANA, HOUSE]);
    expect(service.stopForSelf).toHaveBeenCalledWith(ANA, HOUSE);
  });

  it("no person is 401 and no active house is 400, before anything is read", async () => {
    const service = { statusFor: jest.fn() };
    const controller = new RecommendationDigestController(service as any);
    expect(() => controller.getSubscription({ restaurantId: HOUSE })).toThrow(
      UnauthorizedException,
    );
    expect(() => controller.getSubscription({ userId: ANA })).toThrow(
      BadRequestException,
    );
    expect(service.statusFor).not.toHaveBeenCalled();
  });
});
