import { Logger } from "@nestjs/common";
import { describeConfirmedOrderTerms } from "./procurement.service";
import {
  agreementLineTotal,
  agreedOrderTotal,
  describeAgreedPrice,
} from "./agreed-price";
import { SmsService } from "../communications/sms.service";
import { InboundResponderService } from "../common/orchestrator/inbound-responder.service";

/**
 * The words said to a vendor, and the working sentences about an agreement,
 * print each figure in its own money (ADR 0117: a figure carries the currency
 * it was recorded in). Before this, every one of them hardcoded a dollar sign,
 * so a lira order was mailed to the vendor as dollars.
 *
 * The rule (2026-11-12): the record's currency; none known, the bare figure.
 * Never a dollar sign by default.
 */

const WINE = "Barolo Riserva";
const order = {
  quantity: 5,
  unitType: "case",
  bottlesPerUnit: 12,
  wineName: WINE,
  finalPrice: 1240.5,
};

describe("the vendor's order confirmation says the price in the agreement's currency", () => {
  it("TRY: lira, no dollar sign (price stated in a unit)", () => {
    const s = describeConfirmedOrderTerms({
      ...order,
      statedPriceUnit: { priceUom: "case", pricePackSize: 12 },
      currency: "TRY",
    });
    expect(s).toContain("at ₺1,240.50 per case (12 bottles).");
    expect(s).not.toContain("$");
  });

  it("TRY: lira, no dollar sign (no stated unit)", () => {
    const s = describeConfirmedOrderTerms({ ...order, currency: "TRY" });
    expect(s).toContain("at ₺1,240.50 per case.");
    expect(s).not.toContain("$");
  });

  it("no currency: the bare figure, no mark at all", () => {
    for (const currency of [null, undefined]) {
      const stated = describeConfirmedOrderTerms({
        ...order,
        statedPriceUnit: { priceUom: "case", pricePackSize: 12 },
        currency,
      });
      const unstated = describeConfirmedOrderTerms({ ...order, currency });
      expect(stated).toContain("at 1,240.50 per case (12 bottles).");
      expect(unstated).toContain("at 1,240.50 per case.");
      expect(stated + unstated).not.toMatch(/[$₺€£]/);
    }
  });

  it("USD still reads in dollars", () => {
    const s = describeConfirmedOrderTerms({ ...order, currency: "USD" });
    expect(s).toContain("at $1,240.50 per case.");
  });
});

describe("describeAgreedPrice", () => {
  it("is bare by default: it is not told the agreement's currency", () => {
    expect(
      describeAgreedPrice({
        price: 420,
        stated: { priceUom: "case", pricePackSize: 12 },
      }),
    ).toBe("420.00 per case (12 bottles)");
  });

  it("says the figure through the caller's own formatter when one is passed", () => {
    expect(
      describeAgreedPrice({
        price: 420,
        stated: { priceUom: "case", pricePackSize: 12 },
        say: (n) => `₺${n.toFixed(2)}`,
      }),
    ).toBe("₺420.00 per case (12 bottles)");
  });
});

describe("the agreement's working sentences print bare figures, never a dollar sign", () => {
  const fiveCasesOfTwelve = {
    price: 420,
    stated: { priceUom: "case", pricePackSize: 12 },
    quantity: 5,
    unitType: "case",
    bottlesTotal: 60,
    opaque: false,
  };

  it("agreementLineTotal: goods and each fee", () => {
    const r = agreementLineTotal({
      ...fiveCasesOfTwelve,
      fees: { allowance: 100, deposit: 30, freight: 48 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.working).toContain("Goods 2100.00");
    expect(r.working).toContain("less allowance 100.00");
    expect(r.working).toContain("plus deposit 30.00");
    expect(r.working).toContain("plus freight 48.00");
    expect(r.working).not.toContain("$");
  });

  it("agreedOrderTotal: the 'Totalled as' notes, in unit and per-bottle form", () => {
    const sameUnit = agreedOrderTotal({
      price: 35,
      stated: { priceUom: "bottle", pricePackSize: 1 },
      quantity: 6,
      unitType: "bottle",
      bottlesTotal: 6,
      opaque: false,
    });
    expect(sameUnit.ok && sameUnit.note).toContain("6 × 35.00 per bottle.");
    const packed = agreedOrderTotal({
      price: 420,
      stated: { priceUom: "case", pricePackSize: 12 },
      quantity: 60,
      unitType: "bottle",
      bottlesTotal: 60,
      opaque: false,
    });
    expect(packed.ok && packed.note).toContain("× 420.00.");
    expect(JSON.stringify([sameUnit, packed])).not.toContain("$");
  });
});

describe("the inbound responder's prompt states the target price in the order's currency", () => {
  const promptFor = async (currency?: string | null) => {
    const call = jest.fn().mockRejectedValue(new Error("no model in a spec"));
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    const service = new InboundResponderService(
      {} as any,
      {} as any,
      { call } as any,
      {} as any,
      {} as any,
    );
    await (service as any).runLlm({
      providerName: "Vendor",
      wineName: WINE,
      quantity: 6,
      targetPrice: 1090,
      ...(currency === undefined ? {} : { currency }),
      transcript: "",
      restaurantId: "rest-1",
    });
    return String(call.mock.calls[0][0].body.messages[0].content[0].text);
  };

  afterEach(() => jest.restoreAllMocks());

  it("TRY: lira, no dollar sign", async () => {
    const p = await promptFor("TRY");
    expect(p).toContain("Our target price is ₺1,090.00 per bottle.");
    expect(p).not.toContain("Our target price is $");
  });

  it("no currency: the bare figure, then 'in the order's currency' so the model invents none", async () => {
    for (const currency of [null, undefined]) {
      const p = await promptFor(currency);
      expect(p).toContain(
        "Our target price is 1090.00 in the order's currency per bottle.",
      );
      expect(p).not.toContain("Our target price is $");
    }
  });

  it("USD still reads in dollars", async () => {
    const p = await promptFor("USD");
    expect(p).toContain("Our target price is $1,090.00 per bottle.");
  });
});

describe("the order-request text", () => {
  const textFor = async (currency?: string | null) => {
    const service = new SmsService({ get: () => undefined } as any);
    const send = jest
      .spyOn(service, "sendSms")
      .mockResolvedValue({ success: true } as any);
    await service.sendOrderApprovalRequest({
      to: "+15550001111",
      wineName: "Malbec",
      quantity: 6,
      totalPrice: 1241.4,
      orderId: "abcdef01-2345",
      ...(currency === undefined ? {} : { currency }),
    });
    return String(send.mock.calls[0][0].message);
  };

  it("TRY: whole lira, no dollar sign", async () => {
    const m = await textFor("TRY");
    expect(m).toContain("6x Malbec (₺1,241)");
    expect(m).not.toContain("$");
  });

  it("no currency: the bare whole figure", async () => {
    for (const c of [null, undefined]) {
      const m = await textFor(c);
      expect(m).toContain("6x Malbec (1,241)");
      expect(m).not.toContain("$");
    }
  });

  it("USD: dollars", async () => {
    expect(await textFor("USD")).toContain("6x Malbec ($1,241)");
  });
});
