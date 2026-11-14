import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AddMenuItemDto } from "./dto/add-menu-item.dto";
import { addedPrice, MenusService } from "./menus.service";
import type { DatabaseService } from "../database/database.service";

/**
 * r28 menu audit G7: the /menu Add form read its price boxes with Number(), so
 * in a lira house "45,50" went in unpriced and "1.250" became 1.25. A typed
 * price is now read by the gateway's parseMenuPrice, the same as the Change
 * price boxes on the same page.
 */
describe("addedPrice: a line's price as sent, or as typed (r28 G7)", () => {
  it("reads a typed price the way the Change price boxes do", () => {
    expect(addedPrice(undefined, "45,50", "glass")).toBe(45.5);
    expect(addedPrice(undefined, " 1.250,00 ", "bottle")).toBe(1250);
    expect(addedPrice(undefined, "₺ 90", "bottle")).toBe(90);
    expect(addedPrice(undefined, "70", "bottle")).toBe(70);
  });

  it("keeps a number a caller sent, and sends nothing for an empty box", () => {
    expect(addedPrice(42, undefined, "bottle")).toBe(42);
    expect(addedPrice(42, "   ", "bottle")).toBe(42);
    expect(addedPrice(undefined, "", "glass")).toBeUndefined();
    expect(addedPrice(null, undefined, "glass")).toBeUndefined();
  });

  it("refuses what is not a price, with the reason, and says nothing was added", () => {
    const refused = (typed: string) => {
      try {
        addedPrice(undefined, typed, "bottle");
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return (e as Error).message;
      }
      throw new Error(`"${typed}" was taken for a price`);
    };
    expect(refused("1.250")).toMatch(/^The bottle price "1\.250" is not a price: it could be 1250 or 1\.25.*Nothing was added\.$/);
    expect(refused("-5")).toMatch(/not a price/);
    expect(refused("abc")).toMatch(/Nothing was added\./);
    expect(refused("abc")).not.toMatch(/Nothing was changed/);
  });

  it("refuses a price sent twice, as a number and as text", () => {
    expect(() => addedPrice(45, "45,50", "glass")).toThrow(/sent twice.*Nothing was added/);
  });
});

describe("AddMenuItemDto: a price is never below zero, and typed text is short (r28 G7)", () => {
  const errors = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(AddMenuItemDto, { menuId: "6f1c3c2e-6a52-4c39-9a0e-0a3c1d1b2e10", name: "Barolo", ...body }))).map(
      (e) => e.property,
    );

  it("refuses a negative number price, keeps zero and a typed price", async () => {
    expect(await errors({ bottle_price: -1 })).toEqual(["bottle_price"]);
    expect(await errors({ by_glass_price: -0.5 })).toEqual(["by_glass_price"]);
    expect(await errors({ bottle_price: 0, by_glass_typed: "45,50" })).toEqual([]);
    expect(await errors({ bottle_typed: "x".repeat(41) })).toEqual(["bottle_typed"]);
  });
});

describe("MenusService.addMenuItem: a typed price that is not one refuses the line before any read (r28 G7)", () => {
  it("throws 400 and touches no table", async () => {
    const from = jest.fn(() => {
      throw new Error("no table may be read");
    });
    const service = new MenusService({ supabase: { from, rpc: from } } as unknown as DatabaseService, undefined as any, undefined as any, undefined as any);
    await expect(
      service.addMenuItem({ menuId: "menu-1", name: "Barolo", bottle_typed: "1.250" } as any, "user-1", "rest-1", true),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(from).not.toHaveBeenCalled();
  });
});
