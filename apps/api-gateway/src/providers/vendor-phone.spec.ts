import { normalizeVendorPhone, ProvidersService } from "./providers.service";

/**
 * F-1178: a vendor phone is read by the house's country, never assumed +1.
 * Before the fix, "5321234567" in a Turkish house was saved as +15321234567.
 */
describe("normalizeVendorPhone reads the number by its country", () => {
  it("a Turkish mobile typed without its 0 becomes +90", () => {
    expect(normalizeVendorPhone("532 123 45 67", "TR")).toBe("+905321234567");
    expect(normalizeVendorPhone("5321234567", "Türkiye")).toBe("+905321234567");
  });

  it("a Turkish mobile typed with its leading 0 drops the 0", () => {
    expect(normalizeVendorPhone("0532 123 45 67", "TR")).toBe("+905321234567");
  });

  it("a Turkish number the rule cannot place is kept as typed", () => {
    expect(normalizeVendorPhone("0212 555 12 34", "TR")).toBe("0212 555 12 34");
    expect(normalizeVendorPhone("12345", "TR")).toBe("12345");
  });

  it("a US house still reads 10 digits as +1", () => {
    expect(normalizeVendorPhone("(415) 555-0123", "US")).toBe("+14155550123");
    expect(normalizeVendorPhone("1 415 555 0123", "US")).toBe("+14155550123");
  });

  it("no country, no invented prefix", () => {
    expect(normalizeVendorPhone("4155550123", null)).toBe("4155550123");
    expect(normalizeVendorPhone("4155550123", "Germany")).toBe("4155550123");
  });

  it("keeps a number already in + form, and empty stays null", () => {
    expect(normalizeVendorPhone("+44 20 7946 0000", "TR")).toBe(
      "+44 20 7946 0000",
    );
    expect(normalizeVendorPhone("", "TR")).toBeNull();
    expect(normalizeVendorPhone(null, "TR")).toBeNull();
  });
});

function makeService(
  house: { country?: string; timezone?: string } | null,
  capture: {
    insert?: Record<string, unknown>;
    update?: Record<string, unknown>;
  },
  houseError: { message: string } | null = null,
) {
  const from = (table: string) => {
    if (table === "restaurants") {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: house, error: houseError });
      return q;
    }
    if (table === "user_onboarding_progress") {
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    }
    if (table === "providers") {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.insert = (p: Record<string, unknown>) => {
        capture.insert = p;
        return q;
      };
      q.update = (p: Record<string, unknown>) => {
        capture.update = p;
        return q;
      };
      const row = async () => ({
        data: { id: "prov-1", name: "Kavaklıdere" },
        error: null,
      });
      q.single = row;
      q.maybeSingle = row;
      return q;
    }
    throw new Error(`unexpected table ${table}`);
  };
  return new ProvidersService(
    { supabase: { from } } as never,
    { createEvent: async () => undefined } as never,
    {} as never,
  );
}

describe("createProvider / updateProvider use the house's country (F-1178)", () => {
  it("a Turkish house's vendor phone is saved as +90, not +1", async () => {
    const capture: Record<string, Record<string, unknown>> = {};
    const svc = makeService({ country: "TR" }, capture);
    await svc.createProvider(
      { name: "Kavaklıdere", phone: "5321234567" } as never,
      "r-1",
    );
    expect(capture.insert!.contact_phone).toBe("+905321234567");
  });

  it("an edit in a Turkish house reads the number the same way", async () => {
    const capture: Record<string, Record<string, unknown>> = {};
    const svc = makeService({ country: "Türkiye" }, capture);
    await svc
      .updateProvider("prov-1", { phone: "0532 123 45 67" } as never, "r-1")
      .catch(() => undefined);
    expect(capture.update!.contact_phone).toBe("+905321234567");
  });

  it("a house whose country cannot be read keeps the number as typed", async () => {
    const capture: Record<string, Record<string, unknown>> = {};
    const svc = makeService(null, capture, { message: "down" });
    await svc.createProvider(
      { name: "Kavaklıdere", phone: "5321234567" } as never,
      "r-1",
    );
    expect(capture.insert!.contact_phone).toBe("5321234567");
  });
});
