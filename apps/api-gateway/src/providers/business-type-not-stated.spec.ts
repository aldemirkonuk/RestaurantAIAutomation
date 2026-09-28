import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

/**
 * A vendor's business type is stated by a person, or it is "Not stated" —
 * never a silent 'Distributor' (founder, 2026-09-21, answer 1: "a vendor added
 * without a business type gets a new 'Not stated' choice instead of silently
 * becoming 'Distributor' - nothing assumed, settable later").
 *
 * What this suite pins, end to end on the gateway side:
 *  - the global ValidationPipe (main.ts: whitelist + forbidNonWhitelisted)
 *    ADMITS `primaryBusinessType` on both the create and the update body.
 *    Before 2026-09-21 UpdateProviderDto never declared it, so a request that
 *    carried it was refused with a 400 — "settable later" could not happen;
 *  - a custom vendor created with no type, or with the sheet's "Not stated"
 *    (''), is written NULL — never 'Distributor', never a stored blank;
 *  - a catalogue vendor carries the catalogue's own stated type, and a
 *    catalogue row with none stays NULL;
 *  - an update that does not mention the type leaves the column alone, an
 *    update that says "Not stated" ('') clears it, and a stated type is
 *    written as typed;
 *  - the row's real column is what reads back.
 */

// Mirrors apps/api-gateway/src/main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function bodyMetatype(handler: "createProvider" | "updateProvider"): any {
  const types = Reflect.getMetadata(
    "design:paramtypes",
    ProvidersController.prototype,
    handler,
  );
  // createProvider(dto, user) / updateProvider(providerId, dto, user)
  return handler === "createProvider" ? types?.[0] : types?.[1];
}

const validate = (
  handler: "createProvider" | "updateProvider",
  value: unknown,
) =>
  pipe.transform(value, {
    type: "body",
    metatype: bodyMetatype(handler),
    data: "",
  } as any);

/**
 * Anything this suite does not exercise THROWS rather than returning
 * undefined, so a new collaborator call cannot pass unnoticed.
 */
const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `business-type-not-stated.spec: ${name}.${String(prop)} was called.`,
        );
      },
    },
  ) as never;

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });

const PROVIDER_ROW = {
  id: "prov-1",
  name: "Kavaklıdere",
  primary_business_type: null as string | null,
};

function makeService(opts: {
  catalogueVendor?: Record<string, unknown>;
  capture: { insert?: Record<string, unknown>; update?: Record<string, unknown> };
  rowBack?: Record<string, unknown>;
}) {
  const from = (table: string) => {
    if (table === "vendor_catalogue") {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.single = async () => ok(opts.catalogueVendor ?? null);
      return q;
    }
    if (table === "user_onboarding_progress") {
      // Fire-and-forget in createProvider; answered, never asserted.
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === "providers") {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.is = () => q;
      // The catalogue duplicate check: no such vendor yet.
      q.maybeSingle = async () =>
        opts.capture.update !== undefined
          ? ok(opts.rowBack ?? PROVIDER_ROW)
          : ok(null);
      q.single = async () => ok(opts.rowBack ?? PROVIDER_ROW);
      q.insert = (payload: Record<string, unknown>) => {
        opts.capture.insert = payload;
        return q;
      };
      q.update = (payload: Record<string, unknown>) => {
        opts.capture.update = payload;
        return q;
      };
      return q;
    }
    throw new Error(`unexpected table ${table}`);
  };
  return new ProvidersService(
    { supabase: { from } } as never,
    { createEvent: async () => undefined } as never,
    forbidden("ProcurementService"),
  );
}

describe("the create and update bodies admit a business type (ValidationPipe)", () => {
  it("both handlers declare a class DTO, so the global pipe actually runs", () => {
    expect(bodyMetatype("createProvider")).not.toBe(Object);
    expect(bodyMetatype("updateProvider")).not.toBe(Object);
  });

  it("admits primaryBusinessType on create", async () => {
    await expect(
      validate("createProvider", { name: "X", primaryBusinessType: "Importer" }),
    ).resolves.toMatchObject({ primaryBusinessType: "Importer" });
  });

  it("admits primaryBusinessType on update — 'settable later' is reachable", async () => {
    await expect(
      validate("updateProvider", { primaryBusinessType: "Wholesaler" }),
    ).resolves.toMatchObject({ primaryBusinessType: "Wholesaler" });
    await expect(
      validate("updateProvider", { primaryBusinessType: "" }),
    ).resolves.toMatchObject({ primaryBusinessType: "" });
  });
});

describe("createProvider — a custom vendor", () => {
  it.each<[string, Record<string, unknown>]>([
    ["no type at all", {}],
    ["the sheet's 'Not stated' ('')", { primaryBusinessType: "" }],
  ])("writes NULL for %s — never 'Distributor', never a stored blank", async (_label, extra) => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService({ capture });
    await svc.createProvider({ name: "Kavaklıdere", ...extra } as never, "r-1");
    expect(capture.insert).toBeDefined();
    expect(capture.insert!.primary_business_type).toBeNull();
  });

  it("writes a stated type exactly as typed", async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService({ capture });
    await svc.createProvider(
      { name: "Kavaklıdere", primaryBusinessType: "Importer" } as never,
      "r-1",
    );
    expect(capture.insert!.primary_business_type).toBe("Importer");
  });

  it("honours the deprecated `type` alias from older callers", async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService({ capture });
    await svc.createProvider(
      { name: "Kavaklıdere", type: "broker" } as never,
      "r-1",
    );
    expect(capture.insert!.primary_business_type).toBe("broker");
  });
});

describe("createProvider — a catalogue vendor", () => {
  it("carries the catalogue's own stated type onto the provider row", async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService({
      capture,
      catalogueVendor: { name: "Breakthru", type: "importer" },
    });
    await svc.createProvider({ catalogue_vendor_id: "cat-1" } as never, "r-1");
    expect(capture.insert!.primary_business_type).toBe("importer");
  });

  it("leaves it NULL when the catalogue row states none", async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService({
      capture,
      catalogueVendor: { name: "Breakthru", type: null },
    });
    await svc.createProvider({ catalogue_vendor_id: "cat-1" } as never, "r-1");
    expect(capture.insert!.primary_business_type).toBeNull();
  });
});

describe("updateProvider — settable later, and clearable", () => {
  it("does not touch the column when the update does not mention it", async () => {
    const capture: { update?: Record<string, unknown> } = {};
    const svc = makeService({ capture });
    await svc.updateProvider("prov-1", { name: "Renamed" } as never, "r-1");
    expect(capture.update).toBeDefined();
    expect("primary_business_type" in capture.update!).toBe(false);
  });

  it("writes a stated type", async () => {
    const capture: { update?: Record<string, unknown> } = {};
    const svc = makeService({ capture });
    await svc.updateProvider(
      "prov-1",
      { primaryBusinessType: "Wholesaler" } as never,
      "r-1",
    );
    expect(capture.update!.primary_business_type).toBe("Wholesaler");
  });

  it("clears it to NULL when the edit says 'Not stated' ('')", async () => {
    const capture: { update?: Record<string, unknown> } = {};
    const svc = makeService({ capture });
    await svc.updateProvider(
      "prov-1",
      { primaryBusinessType: "" } as never,
      "r-1",
    );
    expect("primary_business_type" in capture.update!).toBe(true);
    expect(capture.update!.primary_business_type).toBeNull();
  });

  it("reads the real column back — a NULL reads as not stated, never a guess", async () => {
    const svc = makeService({
      capture: {},
      rowBack: { ...PROVIDER_ROW, primary_business_type: null },
    });
    const notStated = await svc.updateProvider(
      "prov-1",
      { name: "Renamed" } as never,
      "r-1",
    );
    expect(notStated.primaryBusinessType).toBeUndefined();

    const svc2 = makeService({
      capture: {},
      rowBack: { ...PROVIDER_ROW, primary_business_type: "Importer" },
    });
    const stated = await svc2.updateProvider(
      "prov-1",
      { name: "Renamed" } as never,
      "r-1",
    );
    expect(stated.primaryBusinessType).toBe("Importer");
  });
});
