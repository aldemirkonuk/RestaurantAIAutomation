import { ForbiddenException } from "@nestjs/common";
import {
  readVendorCurrency,
  vendorCurrencySentence,
} from "./vendor-currency";
import { ProvidersController } from "./providers.controller";
import {
  orderCurrencyOffer,
  orderCurrencySource,
} from "../procurement/agreement-currency";

/**
 * B1 and B2 — a vendor states its usual currency; the ORDER carries the currency
 * it was placed in and says where that came from.
 *
 * THE FOUNDER, 2026-09-06, batch 65:
 *   "maybe Every vendor and their profile will show their default currency, but
 *    we won't use that as the invoice... definitely invoice receipt. However, we
 *    will use the currency from where we order it."
 *
 * The one thing every block below is really testing is the SEPARATION: the
 * vendor's fact never prices anything, and the order's fact can only ever be
 * `vendor_usual` or `typed`. A default that leaks into either is the
 * `restaurants.currency DEFAULT 'USD'` defect wearing a different name.
 */

describe("readVendorCurrency — what a person typed", () => {
  it("accepts an ISO 4217 alpha-3, upper-casing and trimming", () => {
    expect(readVendorCurrency(" try ")).toEqual({ ok: true, code: "TRY" });
    expect(readVendorCurrency("EUR")).toEqual({ ok: true, code: "EUR" });
  });

  it("REFUSES a blank rather than treating it as 'clear it'", () => {
    const r = readVendorCurrency("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.because).toContain("blank");
      // The consequence a silent clear would have had, named.
      expect(r.because).toContain("erase somebody's answer");
    }
  });

  it("refuses an absent field with the same explicitness", () => {
    expect(readVendorCurrency(undefined).ok).toBe(false);
    expect(readVendorCurrency(null).ok).toBe(false);
  });

  it("refuses the three near-misses that would become three currencies", () => {
    for (const bad of ["TL", "$", "US Dollars", "TRYY", "tr"]) {
      const r = readVendorCurrency(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.because).toContain("ISO 4217");
    }
  });

  /*
   * MEMBERSHIP, NOT SHAPE (2026-09-06). Every code below passes
   * `/^[A-Z]{3}$/`, which is what this function asked on the day it was
   * written, so a manager could state that a vendor "usually invoices in ZZZ"
   * and have it pre-filled on every order sheet for them.
   */
  it("REFUSES a well-formed code that names no currency, and names it back", () => {
    for (const fake of ["ZZZ", "XTS", "XTT", "ABC"]) {
      const r = readVendorCurrency(fake);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.because).toContain(`${fake} is not a currency`);
        expect(r.because).toContain("Nothing was changed");
      }
    }
  });
});

describe("vendorCurrencySentence — the profile says what it is FOR", () => {
  it("a vendor nobody has asked gets a sentence, never an empty box", () => {
    const s = vendorCurrencySentence({ code: null, vendorName: "Bir Dagitim" });
    expect(s).toContain("has not stated a usual currency");
    expect(s).toContain("Nothing is assumed in its place");
  });

  it("NAMES a stored value that is not a currency, rather than calling it absent", () => {
    // Rows can hold one: `ZZZ` was writable here until 2026-09-06. Saying the
    // field is empty about a field that plainly reads ZZZ sends a manager
    // looking for something that is not there.
    const s = vendorCurrencySentence({ code: "ZZZ", vendorName: "Bir Dagitim" });
    expect(s).toContain("recorded as ZZZ");
    expect(s).toContain("does not name a currency");
    expect(s).not.toContain("has not stated a usual currency");
  });

  it("a stated currency prints the person and the date, and what it never does", () => {
    const s = vendorCurrencySentence({
      code: "TRY",
      setByName: "Aslı",
      setAt: "2026-09-06T09:00:00.000Z",
      vendorName: "Bir Dagitim",
    });
    expect(s).toContain("usually invoices in TRY");
    expect(s).toContain("Aslı");
    expect(s).toContain("2026-09-06");
    // THE LOAD-BEARING CLAUSE.
    expect(s).toContain("NEVER FILES AN INVOICE");
  });
});

describe("orderCurrencyOffer — only the vendor's own stated currency is pre-filled", () => {
  it("offers the vendor's usual currency with the founder's own words", () => {
    const o = orderCurrencyOffer({
      vendorUsualCurrency: "TRY",
      vendorPaperCurrency: "EUR",
      houseCurrency: "USD",
      vendorName: "Bir Dagitim",
    });
    expect(o.code).toBe("TRY");
    expect(o.basis).toBe("vendor_usual");
    expect(o.sentence).toContain("the currency this vendor usually uses");
  });

  it("offers NOTHING when the vendor has stated none, even though the house has one", () => {
    const o = orderCurrencyOffer({
      vendorUsualCurrency: null,
      vendorPaperCurrency: "EUR",
      houseCurrency: "USD",
      vendorName: "Bir Dagitim",
    });
    expect(o.code).toBeNull();
    expect(o.basis).toBeNull();
    expect(o.sentence).toContain("has not stated a usual currency");
    expect(o.sentence).toContain("nothing is pre-filled");
    // The house's currency and the vendor's paper are SHOWN, not chosen.
    expect(o.alsoKnown).toEqual({ vendorPaper: "EUR", house: "USD" });
    expect(o.sentence).toContain("EUR");
    expect(o.sentence).toContain("USD");
  });

  it("a non-ISO vendor currency offers nothing rather than a fourth spelling", () => {
    const o = orderCurrencyOffer({
      vendorUsualCurrency: "TL",
      vendorPaperCurrency: null,
      houseCurrency: null,
    });
    expect(o.code).toBeNull();
  });
});

describe("orderCurrencySource — the provenance the order records", () => {
  it("calls it vendor_usual when the recorded code is the vendor's stated one", () => {
    expect(
      orderCurrencySource({ recorded: "TRY", vendorUsualCurrency: "TRY" }),
    ).toBe("vendor_usual");
  });

  it("calls it typed when it is anything else", () => {
    expect(
      orderCurrencySource({ recorded: "EUR", vendorUsualCurrency: "TRY" }),
    ).toBe("typed");
    expect(
      orderCurrencySource({ recorded: "EUR", vendorUsualCurrency: null }),
    ).toBe("typed");
  });

  it("records NOTHING when no code was stated — never a source for nothing", () => {
    expect(
      orderCurrencySource({ recorded: null, vendorUsualCurrency: "TRY" }),
    ).toBeNull();
    expect(
      orderCurrencySource({ recorded: "TL", vendorUsualCurrency: "TRY" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The route. Manager-gated, blank refused, and a failed read never renders as
// "this vendor has stated none".
// ---------------------------------------------------------------------------
describe("ProvidersController — the vendor's usual currency", () => {
  const user = { id: "u1", restaurantId: "rest-1" };

  function build(opts: {
    role?: string | null;
    stated?: any;
    statedThrows?: Error;
    written?: any;
  }) {
    const writes: any[] = [];
    const providersService: any = {
      getUsualCurrency: async () => {
        if (opts.statedThrows) throw opts.statedThrows;
        return (
          opts.stated ?? {
            code: null,
            setAt: null,
            setByName: null,
            vendorName: "Bir Dagitim",
          }
        );
      },
      setUsualCurrency: async (args: any) => {
        writes.push(args);
        return (
          opts.written ?? {
            code: args.code,
            setAt: "2026-09-06T09:00:00.000Z",
            previous: null,
          }
        );
      },
    };
    const organizations: any = {
      resolveRestaurantRole: async () => opts.role ?? null,
    };
    const controller = new ProvidersController(providersService, organizations);
    return { controller, writes };
  }

  it("refuses staff in a sentence naming what they are and who can do it", async () => {
    const { controller, writes } = build({ role: "staff" });
    await expect(
      controller.setUsualCurrency("p1", { currency: "TRY" }, user),
    ).rejects.toMatchObject({ status: 403 });
    const err = await controller
      .setUsualCurrency("p1", { currency: "TRY" }, user)
      .catch((e) => e);
    expect(err.message).toContain("signed in as staff");
    expect(err.message).toContain("manager");
    expect(writes).toHaveLength(0);
  });

  it("refuses a session that could not be shown to hold any role", async () => {
    const { controller, writes } = build({ role: null });
    const err = await controller
      .setUsualCurrency("p1", { currency: "TRY" }, user)
      .catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.message).toContain("could not be shown to hold any role");
    expect(writes).toHaveLength(0);
  });

  it("refuses a blank BEFORE it asks who the person is", async () => {
    const { controller, writes } = build({ role: "owner" });
    const err = await controller
      .setUsualCurrency("p1", { currency: "  " }, user)
      .catch((e) => e);
    expect(err.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("writes for a manager, filing the author from the session", async () => {
    const { controller, writes } = build({ role: "manager" });
    const res = await controller.setUsualCurrency(
      "p1",
      { currency: "try" },
      user,
    );
    expect(writes).toEqual([
      {
        providerId: "p1",
        restaurantId: "rest-1",
        code: "TRY",
        userId: "u1",
      },
    ]);
    expect(res.code).toBe("TRY");
    expect(res.sentence).toContain("It files no invoice");
  });

  it("names the previous value when it changes", async () => {
    const { controller } = build({
      role: "owner",
      written: { code: "EUR", setAt: "x", previous: "TRY" },
    });
    const res = await controller.setUsualCurrency(
      "p1",
      { currency: "EUR" },
      user,
    );
    expect(res.sentence).toContain("Changed from TRY to EUR");
  });

  it("a failed READ propagates rather than rendering as 'no currency stated'", async () => {
    const { controller } = build({
      role: "manager",
      statedThrows: new ForbiddenException("read broke"),
    });
    await expect(controller.getUsualCurrency("p1", user)).rejects.toThrow(
      "read broke",
    );
  });

  it("the GET carries the sentence that says what the code is NOT for", async () => {
    const { controller } = build({
      role: "manager",
      stated: {
        code: "TRY",
        setAt: "2026-09-06T09:00:00.000Z",
        setByName: "Aslı",
        vendorName: "Bir Dagitim",
      },
    });
    const res = await controller.getUsualCurrency("p1", user);
    expect(res.code).toBe("TRY");
    expect(res.sentence).toContain("NEVER FILES AN INVOICE");
  });
});
