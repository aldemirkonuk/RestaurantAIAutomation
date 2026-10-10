import "reflect-metadata";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * F-245 — a link to an order opened while the session is in another of the
 * person's houses. `GET /auth/houses/holding?order=` names the house of the
 * person's own that holds it, so /orders can offer to switch there; it never
 * names a house the person is not an active member of.
 */

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // "Moda", the session's house
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // "Kadikoy", also theirs
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // same organisation, no row
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // a row, no longer active

const IN_B = "0b0b0b0b-0000-4000-8000-000000000001";
const IN_C = "0c0c0c0c-0000-4000-8000-000000000002";
const IN_D = "0d0d0d0d-0000-4000-8000-000000000003";
const IN_A = "0a0a0a0a-0000-4000-8000-000000000004";
const NOWHERE = "0e0e0e0e-0000-4000-8000-000000000005";

function world(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      user_restaurant_access: [
        { user_id: U, restaurant_id: A, role: "owner", is_active: true },
        { user_id: U, restaurant_id: B, role: "manager", is_active: true },
        { user_id: U, restaurant_id: D, role: "manager", is_active: false },
      ],
      restaurants: [
        { id: A, name: "Moda", city: "Istanbul" },
        { id: B, name: "Kadikoy", city: "Istanbul" },
        { id: C, name: "Cihangir", city: "Istanbul" },
        { id: D, name: "Besiktas", city: "Istanbul" },
      ],
      procurement_orders: [
        { id: IN_A, restaurant_id: A },
        { id: IN_B, restaurant_id: B },
        { id: IN_C, restaurant_id: C },
        { id: IN_D, restaurant_id: D },
      ],
    },
    errors,
  );
}

function service(db: StubDb): AuthService {
  return new AuthService(
    new JwtService({}),
    { get: () => "secret" } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => undefined } as any,
  );
}

const req = { user: { userId: U, restaurantId: A } } as any;

describe("an order link names which of your houses holds it (F-245)", () => {
  it("names the other house of yours that holds it", async () => {
    const res = await new AuthController(service(world())).houseHolding(req, IN_B);
    expect(res).toEqual({
      success: true,
      house: { id: B, name: "Kadikoy", city: "Istanbul" },
    });
  });

  it("names the session's own house when it holds it (the page then shows nothing)", async () => {
    const house = await service(world()).houseHoldingOrder(U, IN_A);
    expect(house?.id).toBe(A);
  });

  it("says nothing of a house the person is not in, even in their organisation", async () => {
    expect(await service(world()).houseHoldingOrder(U, IN_C)).toBeNull();
  });

  it("says nothing of a house whose membership has ended", async () => {
    expect(await service(world()).houseHoldingOrder(U, IN_D)).toBeNull();
  });

  it("an order nobody holds reads the same as another tenant's", async () => {
    expect(await service(world()).houseHoldingOrder(U, NOWHERE)).toBeNull();
  });

  it("a failed read is a 503, never 'not in your houses'", async () => {
    const db = world({ "procurement_orders:select": { message: "boom" } });
    await expect(service(db).houseHoldingOrder(U, IN_B)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("refuses an id that is not an order id before reading anything", async () => {
    const controller = new AuthController(service(world()));
    await expect(controller.houseHolding(req, "not-an-id")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.houseHolding(req, undefined as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
