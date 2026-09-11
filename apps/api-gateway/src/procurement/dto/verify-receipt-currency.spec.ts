/**
 * The WIRE half of "a typed receiving price states its currency".
 *
 * Founder, 2026-09-06 batch 67. `ProcurementService.verifyReceipt` refuses the
 * same pair (`receiving-price-held.spec.ts`), and that is the gate every caller
 * passes; this one is the gate the HTTP request passes, and the two must refuse
 * with the same sentence or a desk clerk gets two different explanations of one
 * act depending on which layer happened to see it first.
 *
 * Validated the way Nest's `ValidationPipe` validates: `plainToInstance` and
 * then `validate`, on a plain object shaped like the JSON body.
 */
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { VerifyReceiptDto } from "./procurement.dto";

async function check(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(VerifyReceiptDto, body), {
    whitelist: false,
  });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const COUNT = {
  acceptedQuantityInCountedUom: 10,
  rejectedQuantityInCountedUom: 0,
};

describe("VerifyReceiptDto — a price on the wire states its currency", () => {
  it("REFUSES a unit price with no currency, in one sentence", async () => {
    const said = await check({ ...COUNT, invoiceUnitPrice: 40 });
    expect(said).toHaveLength(1);
    // The three ways to state a code, and what is not lost by resubmitting.
    expect(said[0]).toContain("no currency");
    expect(said[0]).toContain("this order was placed in");
    expect(said[0]).toContain("house's own reporting currency");
    expect(said[0]).toContain("typed on the spot");
    expect(said[0]).toContain("the count, the rejection and the stock movement");
    // It names the figure it refused, so a person knows WHICH price.
    expect(said[0]).toContain("40");
  });

  it("REFUSES a unit price whose currency names no currency", async () => {
    // "A code that names nothing" and "no code" are the same statement about
    // the money, so they get the same answer rather than two.
    const said = await check({
      ...COUNT,
      invoiceUnitPrice: 40,
      invoiceCurrency: "ZZZ",
    });
    expect(said.some((s) => s.includes("no currency"))).toBe(true);
  });

  it("REFUSES a price of ZERO with no currency — zero is a price", async () => {
    // `!= null`, never truthiness. A free case billed at 0 is a real observation
    // and needs a denomination like any other.
    const said = await check({ ...COUNT, invoiceUnitPrice: 0 });
    expect(said.some((s) => s.includes("no currency"))).toBe(true);
  });

  it("ACCEPTS a price with a real currency", async () => {
    expect(
      await check({ ...COUNT, invoiceUnitPrice: 40, invoiceCurrency: "TRY" }),
    ).toEqual([]);
  });

  it("ACCEPTS the currencies the 96-code list refused", async () => {
    for (const code of ["HKD", "MOP", "XOF"]) {
      expect(
        await check({ ...COUNT, invoiceUnitPrice: 40, invoiceCurrency: code }),
      ).toEqual([]);
    }
  });

  it("ACCEPTS a receipt with NO price at all — the count needs no currency", async () => {
    // The whole shape of the refusal: it closes the price, never the delivery.
    expect(await check(COUNT)).toEqual([]);
  });

  it("ACCEPTS a currency with no price", async () => {
    // Harmless, and refusing it would make a screen that pre-fills the code
    // before a figure is typed unable to submit a count.
    expect(await check({ ...COUNT, invoiceCurrency: "TRY" })).toEqual([]);
  });
});
