import { BadRequestException, ValidationPipe } from "@nestjs/common";
import {
  CreateOrderDto,
  MAX_BOTTLES_PER_UNIT,
  MAX_ORDER_QUANTITY,
  UpdateOrderDto,
} from "./dto/procurement.dto";

/**
 * A body sent straight to `POST` / `PATCH /procurement/orders` is held to the
 * same rules the order sheets hold a person to (QA round 3b, B1).
 *
 * Run through the gateway's own global pipe settings (`main.ts`), so what is
 * pinned here is the HTTP answer: a 400 carrying the sentence, before the
 * service or the database sees the body.
 */

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const base = { inventoryId: "inv-1", providerId: "prov-1", quantity: 6 };

async function messages(metatype: any, body: Record<string, unknown>): Promise<string[]> {
  try {
    await pipe.transform(body, { type: "body", metatype });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse()["message"] as string[];
  }
  return [];
}

describe("POST /procurement/orders — money is above zero", () => {
  it.each([
    ["finalPrice", -20, "A price has to be above zero. Leave it out when the vendor has not named one."],
    ["finalPrice", 0, "A price has to be above zero. Leave it out when the vendor has not named one."],
    ["quotedPrice", 0, "A quoted price has to be above zero. Leave it out when the vendor has not named one."],
    ["quotedPrice", -1, "A quoted price has to be above zero. Leave it out when the vendor has not named one."],
    ["negotiatedPrice", -0.01, "A negotiated price has to be above zero. Leave it out when none was agreed."],
    ["totalCost", -120, "An order's total has to be above zero."],
    ["totalCost", 0, "An order's total has to be above zero."],
  ])("refuses %s = %p in words", async (field, value, sentence) => {
    expect(await messages(CreateOrderDto, { ...base, [field]: value })).toEqual([sentence]);
  });

  it("takes a price above zero, and a body with no price at all", async () => {
    expect(await messages(CreateOrderDto, { ...base, finalPrice: 0.01, totalCost: 0.06 })).toEqual([]);
    expect(await messages(CreateOrderDto, base)).toEqual([]);
  });
});

describe("POST /procurement/orders — a quantity is a real count", () => {
  it.each([
    [0, "A quantity has to be at least 1."],
    [-6, "A quantity has to be at least 1."],
    [2.5, "A quantity has to be a whole number."],
    [MAX_ORDER_QUANTITY + 1, "One order line can hold at most 100,000. Split a larger order into several lines."],
  ])("refuses quantity %p in words", async (quantity, sentence) => {
    expect(await messages(CreateOrderDto, { ...base, quantity })).toEqual([sentence]);
  });

  it("takes the largest quantity allowed", async () => {
    expect(await messages(CreateOrderDto, { ...base, quantity: MAX_ORDER_QUANTITY })).toEqual([]);
  });

  it.each(["bottlesPerUnit", "pricePackSize"])("refuses a %s past the largest pack", async (field) => {
    expect(
      await messages(CreateOrderDto, { ...base, [field]: MAX_BOTTLES_PER_UNIT + 1 }),
    ).toEqual(["A pack can hold at most 10,000 bottles."]);
    expect(await messages(CreateOrderDto, { ...base, [field]: MAX_BOTTLES_PER_UNIT })).toEqual([]);
  });

  it("caps quantity and pack so their product always fits the integer bottles_total", () => {
    expect(MAX_ORDER_QUANTITY * MAX_BOTTLES_PER_UNIT).toBeLessThanOrEqual(2_147_483_647);
  });
});

describe("POST /procurement/orders — the expected delivery date is a date", () => {
  it.each(["next tuesday", "2026-02-30", "20/11/2026"])("refuses %p", async (expectedDeliveryDate) => {
    expect(await messages(CreateOrderDto, { ...base, expectedDeliveryDate })).toEqual([
      "The expected delivery date has to be a date, like 2026-11-20.",
    ]);
  });

  it.each(["2026-11-20", "2026-11-20T09:00:00.000Z"])("takes %p", async (expectedDeliveryDate) => {
    expect(await messages(CreateOrderDto, { ...base, expectedDeliveryDate })).toEqual([]);
  });
});

describe("PATCH /procurement/orders/:id — money is above zero", () => {
  it.each([
    ["finalPrice", -20],
    ["quotedPrice", 0],
    ["negotiatedPrice", -5],
    ["totalCost", -120],
  ])("refuses %s = %p", async (field, value) => {
    const said = await messages(UpdateOrderDto, { [field]: value });
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/has to be above zero/);
  });

  it("takes a positive price and a body that names none", async () => {
    expect(await messages(UpdateOrderDto, { finalPrice: 19.5 })).toEqual([]);
    expect(await messages(UpdateOrderDto, { managerNotes: "call Tuesday" })).toEqual([]);
  });
});
