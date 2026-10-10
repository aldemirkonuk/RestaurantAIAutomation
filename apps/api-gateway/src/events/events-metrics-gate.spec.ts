/**
 * F-437 — `GET /events/metrics` takes the service key, not nothing.
 *
 * It was `@Public()` and nothing else: platform-wide ingestion counters (every
 * house's event volume by type and source) served to anyone. It now carries
 * `ServiceKeyGuard` (`X-Admin-Key`, ADR 0099). `@Public()` stays because the
 * global TenantGuard would otherwise refuse a caller with no user; a
 * `@Public()` WITHOUT the key guard is the hole, so that pairing is what this
 * pins — and that the two house routes did not go public along with it.
 * The guard's own behaviour (fail closed on an unset key, refuse a wrong one)
 * is pinned in ux-optimizer.admin-routes.spec.ts.
 */
import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ServiceKeyGuard } from "../auth/guards/service-key.guard";
import { EventsController } from "./events.controller";

const proto = EventsController.prototype as unknown as Record<string, object>;
const guardsOn = (name: string): unknown[] => Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? [];
const isPublic = (name: string) => Reflect.getMetadata(IS_PUBLIC_KEY, proto[name]) === true;

const SERVICE_ROUTES = ["getMetrics"];
const HOUSE_ROUTES = ["createEvent", "listEvents"];

describe("GET /events/metrics is for the service key only (F-437)", () => {
  it("getMetrics is guarded by ServiceKeyGuard, not left open", () => {
    for (const r of SERVICE_ROUTES) {
      expect(guardsOn(r)).toContain(ServiceKeyGuard);
    }
  });

  it("every public handler on this controller carries the service key", () => {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || !isPublic(name)) continue;
      expect([name, guardsOn(name)]).toEqual([name, expect.arrayContaining([ServiceKeyGuard])]);
    }
  });

  it("the house routes still need a user token and did not go public", () => {
    for (const r of HOUSE_ROUTES) {
      expect(isPublic(r)).toBe(false);
      expect(guardsOn(r)).toContain(JwtAuthGuard);
    }
  });

  it("names every handler, so a new route cannot slip past unlisted", () => {
    const onTheClass = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== "constructor" && typeof proto[n] === "function",
    );
    expect(onTheClass.sort()).toEqual([...SERVICE_ROUTES, ...HOUSE_ROUTES].sort());
  });
});
