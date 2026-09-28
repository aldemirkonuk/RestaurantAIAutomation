import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpException, HttpStatus, ValidationPipe } from "@nestjs/common";
import { StorageLocationsController } from "./storage-locations.controller";
import { StorageLocationsService } from "./storage-locations.service";

/**
 * Web endpoint sweep 2026-09-28, defect #4 (/inventory zones).
 *
 * The zone editor sent `parentId`; the DTO declares `parent_id`; main.ts runs
 * the pipe with forbidNonWhitelisted, so every edit of a zone with a parent
 * was a 400 that the web then showed as saved. The web now sends `parent_id`
 * (null to clear). This suite pins the gateway half:
 *
 *  - the pipe is main.ts's own (read from source, not restated);
 *  - `parent_id: null` and a UUID pass the pipe; the camelCase key does not;
 *  - `storage_locations` has NO parent column (baseline migration,
 *    20260805000000_baseline_from_production.sql:5487-5511), so a non-null
 *    parent cannot be stored. It used to be dropped in silence and answered
 *    200. It is now refused with a 422 that says so, and a null parent (the
 *    only thing the table can hold) is accepted.
 */

const mainSource = readFileSync(join(__dirname, "..", "main.ts"), "utf8");
const pipeOptions = (() => {
  const m = mainSource.match(/new ValidationPipe\((\{[\s\S]*?\})\)/);
  if (!m) throw new Error("main.ts no longer builds a global ValidationPipe");
  // The literal is plain `key: boolean` pairs; parse it without eval.
  const opts: Record<string, boolean> = {};
  for (const [, k, v] of m[1].matchAll(/(\w+):\s*(true|false)/g)) {
    opts[k] = v === "true";
  }
  return opts;
})();
const pipe = new ValidationPipe(pipeOptions);

function bodyMetatype(handler: "createLocation" | "updateLocation"): any {
  const types = Reflect.getMetadata(
    "design:paramtypes",
    StorageLocationsController.prototype,
    handler,
  );
  // createLocation(restaurantId, dto) / updateLocation(restaurantId, locationId, dto)
  return handler === "createLocation" ? types?.[1] : types?.[2];
}

const validate = (
  handler: "createLocation" | "updateLocation",
  value: unknown,
) =>
  pipe.transform(value, {
    type: "body",
    metatype: bodyMetatype(handler),
    data: "",
  } as any);

const PARENT = "22222222-2222-4222-8222-222222222222";

describe("zone parent through main.ts's ValidationPipe", () => {
  it("uses main.ts's options: whitelist + forbidNonWhitelisted", () => {
    expect(pipeOptions).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  });

  it("admits parent_id: null on an update (the web's 'clear the parent')", async () => {
    await expect(
      validate("updateLocation", { name: "Rack A", parent_id: null }),
    ).resolves.toMatchObject({ name: "Rack A", parent_id: null });
  });

  it("admits a UUID parent_id on an update", async () => {
    await expect(
      validate("updateLocation", { parent_id: PARENT }),
    ).resolves.toMatchObject({ parent_id: PARENT });
  });

  it("refuses the camelCase key the web used to send", async () => {
    await expect(
      validate("updateLocation", { name: "Rack A", parentId: PARENT }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("admits parent_id: null on a create", async () => {
    await expect(
      validate("createLocation", { name: "Rack A", capacity: 12, parent_id: null }),
    ).resolves.toMatchObject({ parent_id: null });
  });
});

/** A supabase chain that records the payload and answers one row. */
function fakeDb() {
  const calls: { op: string; payload: unknown }[] = [];
  const row = { id: "loc-1", zone: "Rack A", capacity_bottles: 12 };
  const chain: any = {
    from: () => chain,
    update: (payload: unknown) => {
      calls.push({ op: "update", payload });
      return chain;
    },
    insert: (payload: unknown) => {
      calls.push({ op: "insert", payload });
      return chain;
    },
    eq: () => chain,
    is: () => chain,
    select: () => chain,
    single: async () => ({ data: row, error: null }),
  };
  return { dbService: { supabase: chain } as any, calls };
}

describe("a parent the table cannot hold is refused, not dropped", () => {
  it("update with a non-null parent_id answers 422 and writes nothing", async () => {
    const { dbService, calls } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const err = await svc
      .updateLocation("r1", "loc-1", { name: "Rack A", parent_id: PARENT })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(String((err as HttpException).message)).toMatch(/parent/i);
    expect(calls).toHaveLength(0);
  });

  it("create with a non-null parent_id answers 422 and inserts nothing", async () => {
    const { dbService, calls } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const err = await svc
      .createLocation("r1", { name: "Rack A", capacity: 12, parent_id: PARENT })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
    expect(calls).toHaveLength(0);
  });

  it("update with parent_id: null saves the rest of the edit", async () => {
    const { dbService, calls } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await svc.updateLocation("r1", "loc-1", { name: "Rack B", parent_id: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({ zone: "Rack B" });
  });
});
