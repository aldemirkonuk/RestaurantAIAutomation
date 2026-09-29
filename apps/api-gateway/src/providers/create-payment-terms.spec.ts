import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { ValidationPipe } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

/**
 * Web endpoint sweep 2026-09-28, row 15 (/vendors, "add own vendor").
 *
 * The new-vendor sheet offers a Payment terms choice and sends it as
 * `paymentTerms` on POST /providers. CreateProviderDto never declared the
 * field, so the global ValidationPipe (main.ts: whitelist +
 * forbidNonWhitelisted) refused the whole create with a 400
 * ("property paymentTerms should not exist"). UpdateProviderDto already
 * declared it and updateProvider already wrote it; only create was missing.
 *
 * What this suite pins:
 *  - the pipe below is the one main.ts installs (checked against the source,
 *    so the mirror cannot drift silently);
 *  - that pipe ADMITS `paymentTerms` on the create body and still refuses a
 *    non-string one;
 *  - a custom vendor's stated terms reach `providers.payment_terms`, and a
 *    vendor with none stated is written NULL — never a default (the column's
 *    'Net 30' default was dropped on purpose, migration 20260903170000).
 */

const pipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
};
const pipe = new ValidationPipe(pipeOptions);

const createBody = () =>
  Reflect.getMetadata(
    "design:paramtypes",
    ProvidersController.prototype,
    "createProvider",
  )?.[0];

const validate = (value: unknown) =>
  pipe.transform(value, {
    type: "body",
    metatype: createBody(),
    data: "",
  } as any);

describe("POST /providers admits paymentTerms (the real global pipe)", () => {
  it("uses the same ValidationPipe options main.ts installs", () => {
    const main = readFileSync(join(__dirname, "..", "main.ts"), "utf8");
    const block = main.match(
      /useGlobalPipes\(\s*new ValidationPipe\(\{([\s\S]*?)\}\)/,
    );
    expect(block).not.toBeNull();
    const opts = Object.fromEntries(
      [...block![1].matchAll(/(\w+)\s*:\s*(true|false)/g)].map((m) => [
        m[1],
        m[2] === "true",
      ]),
    );
    expect(opts).toEqual(pipeOptions);
  });

  it("the create handler declares a class DTO, so the pipe actually runs", () => {
    expect(createBody()).toBeDefined();
    expect(createBody()).not.toBe(Object);
  });

  it("admits a stated payment term on create", async () => {
    await expect(
      validate({ name: "Kavaklıdere", paymentTerms: "Net 30" }),
    ).resolves.toMatchObject({ paymentTerms: "Net 30" });
  });

  it("still refuses a payment term that is not a string", async () => {
    await expect(
      validate({ name: "Kavaklıdere", paymentTerms: 30 }),
    ).rejects.toBeDefined();
  });

  it("still refuses a field no DTO declares (the whitelist is intact)", async () => {
    await expect(
      validate({ name: "Kavaklıdere", notAField: "x" }),
    ).rejects.toBeDefined();
  });
});

const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `create-payment-terms.spec: ${name}.${String(prop)} was called.`,
        );
      },
    },
  ) as never;

function makeService(capture: { insert?: Record<string, unknown> }) {
  const row = { id: "prov-1", name: "Kavaklıdere", payment_terms: null };
  const from = (table: string) => {
    if (table === "user_onboarding_progress") {
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === "providers") {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.insert = (payload: Record<string, unknown>) => {
        capture.insert = payload;
        return q;
      };
      q.single = async () => ({
        data: { ...row, payment_terms: capture.insert?.payment_terms ?? null },
        error: null,
      });
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

describe("createProvider writes the stated payment terms", () => {
  it("writes a stated term to providers.payment_terms and reads it back", async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService(capture);
    const out = await svc.createProvider(
      { name: "Kavaklıdere", paymentTerms: "COD" } as never,
      "r-1",
    );
    expect(capture.insert!.payment_terms).toBe("COD");
    expect((out as { paymentTerms?: string }).paymentTerms).toBe("COD");
  });

  it("writes NULL when no term was stated — never a default", async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const svc = makeService(capture);
    await svc.createProvider({ name: "Kavaklıdere" } as never, "r-1");
    expect(capture.insert).toHaveProperty("payment_terms", null);
  });
});
