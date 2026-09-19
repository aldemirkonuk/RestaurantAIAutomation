import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { ALLOWS_NO_HOUSE_KEY } from "../common/tenant/allows-no-house.decorator";

/**
 * A session in no house can do almost nothing (ADR 0164, R4; 44.1t).
 *
 * The list of routes it may call is short on purpose and pinned here in full:
 * who am I, my houses, choose one, accept an invitation, my own account,
 * verify, sign out. A route added to it must be added to this list too, by
 * someone who has decided it belongs.
 */

const SRC = path.resolve(__dirname, "..");

function routesMarkedNoHouse(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (
        e.name.endsWith(".controller.ts") &&
        fs.readFileSync(full, "utf8").includes("@AllowsNoHouse()")
      ) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(full);
        for (const cls of Object.values(mod) as any[]) {
          if (typeof cls !== "function") continue;
          const base = Reflect.getMetadata(PATH_METADATA, cls);
          if (base === undefined) continue;
          for (const name of Object.getOwnPropertyNames(cls.prototype)) {
            const h = cls.prototype[name];
            if (typeof h !== "function") continue;
            const m = Reflect.getMetadata(METHOD_METADATA, h);
            if (m === undefined) continue;
            if (
              Reflect.getMetadata(ALLOWS_NO_HOUSE_KEY, h) === true ||
              Reflect.getMetadata(ALLOWS_NO_HOUSE_KEY, cls) === true
            ) {
              const p = Reflect.getMetadata(PATH_METADATA, h);
              out.push(`${RequestMethod[m]} /${base}/${p}`.replace(/\/+$/, ""));
            }
          }
        }
      }
    }
  };
  walk(SRC);
  return out.sort();
}

describe("a session in no house (ADR 0164, R4)", () => {
  it("may call exactly these routes, and no others", () => {
    expect(routesMarkedNoHouse()).toEqual([
      "DELETE /auth/me",
      "DELETE /auth/me/link/:provider",
      "GET /auth/houses",
      "GET /auth/me",
      "GET /auth/me/linked-providers",
      "GET /auth/verify",
      "GET /organizations/branches",
      "PATCH /auth/me",
      "POST /auth/invite/:code/accept",
      "POST /auth/logout",
      "POST /auth/me/link/:provider",
      "POST /auth/me/password",
      "POST /auth/resend-verification",
      "POST /auth/switch-restaurant",
    ]);
  });

  it("is told by /auth/me that it has no house and no role, whatever the users row says", async () => {
    const controller = new AuthController({
      getProfileForUser: async () => ({
        userId: "u",
        email: "p@house.test",
        role: "owner", // users.role: decides nothing for a session
        restaurantId: "house-a", // users.restaurant_id: the home house, not the session's
        emailVerified: true,
      }),
    } as any);

    const none = await controller.getProfile({
      user: { userId: "u", restaurantId: null, role: null },
    } as any);
    expect(none.user).toMatchObject({ restaurantId: null, role: null });

    const inB = await controller.getProfile({
      user: { userId: "u", restaurantId: "house-b", role: "staff" },
    } as any);
    expect(inB.user).toMatchObject({ restaurantId: "house-b", role: "staff" });
  });
});
