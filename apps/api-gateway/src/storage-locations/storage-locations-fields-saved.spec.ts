import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { StorageLocationsService } from "./storage-locations.service";
import {
  CreateStorageLocationDto,
  UpdateStorageLocationDto,
} from "./dto/storage-locations.dto";

/**
 * F-1332: the zone form's temperature and humidity were accepted by the DTO
 * and never written, and its description had no column to live in (a trigger
 * rewrites full_location from the name on every write). Temperature now lands
 * in temperature_zone, humidity in humidity_controlled, and description is no
 * longer taken at all.
 *
 * F-1333: a zone a person adds by hand is stored `created` and confirmed by
 * them (migration 20260904130000's own vocabulary), not left 'unconfirmed'
 * so the cellar floor calls it seeder-made.
 */

const R1 = "11111111-1111-4111-8111-111111111111";
const ZONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "99999999-9999-4999-8999-999999999999";

function fakeDb() {
  const writes: { op: string; payload: any }[] = [];
  const make = () => {
    const state: { write?: any; filters: Record<string, unknown> } = {
      filters: {},
    };
    const chain: any = {
      select: () => chain,
      insert: (payload: any) => {
        state.write = { op: "insert", payload };
        writes.push(state.write);
        return chain;
      },
      update: (payload: any) => {
        state.write = { op: "update", payload };
        writes.push(state.write);
        return chain;
      },
      eq: (k: string, v: unknown) => ((state.filters[k] = v), chain),
      is: () => chain,
      in: () => chain,
      // F-1104: updateLocation now reads the zone's live lots for its count
      // (fix/sim-w91-storage-counts, F-1331); this zone holds none.
      gt: () => chain,
      not: () => chain,
      limit: async () => ({ data: [], error: null, count: 0 }),
      order: () => chain,
      single: async () => ({
        data: {
          id: state.filters.id ?? ZONE,
          restaurant_id: R1,
          zone: state.write?.payload?.zone ?? "Zone",
          capacity_bottles: 12,
          ...state.write?.payload,
        },
        error: null,
      }),
      maybeSingle: async () => chain.single(),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    return chain;
  };
  return { dbService: { supabase: { from: () => make() } } as any, writes };
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
});
const validate = (metatype: any, value: unknown) =>
  pipe.transform(value, { type: "body", metatype, data: "" } as any);

describe("the zone form's temperature and humidity are saved (F-1332)", () => {
  it("create writes temperature_zone and humidity_controlled", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const out: any = await svc.createLocation(
      R1,
      {
        name: "Cellar",
        capacity: 120,
        temperature: "13°C",
        humidity: "Controlled",
      },
      USER,
    );
    expect(writes[0].payload).toMatchObject({
      temperature_zone: "13°C",
      humidity_controlled: true,
    });
    expect(out).toMatchObject({ temperature: "13°C", humidity: "Controlled" });
  });

  it("update writes them, and an emptied temperature clears it", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await svc.updateLocation(R1, ZONE, { temperature: "  ", humidity: "None" });
    expect(writes[0].payload).toMatchObject({
      temperature_zone: null,
      humidity_controlled: false,
    });
  });

  it("an update that names neither leaves both alone", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    await svc.updateLocation(R1, ZONE, { name: "Bar" });
    expect(writes[0].payload).not.toHaveProperty("temperature_zone");
    expect(writes[0].payload).not.toHaveProperty("humidity_controlled");
  });

  it("humidity takes only the two words the column can hold", async () => {
    await expect(
      validate(UpdateStorageLocationDto, { humidity: "70%" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validate(UpdateStorageLocationDto, { humidity: "Controlled" }),
    ).resolves.toMatchObject({ humidity: "Controlled" });
  });

  it("description is refused rather than accepted and dropped", async () => {
    await expect(
      validate(CreateStorageLocationDto, {
        name: "Cellar",
        capacity: 12,
        description: "under the stairs",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("a zone a person creates is theirs, not a seeder's (F-1333)", () => {
  it("create stores zone_provenance 'created', confirmed now, by the caller", async () => {
    const { dbService, writes } = fakeDb();
    const svc = new StorageLocationsService(dbService);
    const before = Date.now();
    await svc.createLocation(R1, { name: "Cellar", capacity: 120 }, USER);
    const p = writes[0].payload;
    expect(p).toMatchObject({
      zone_provenance: "created",
      zone_confirmed_by: USER,
    });
    expect(Date.parse(p.zone_confirmed_at)).toBeGreaterThanOrEqual(before - 1);
  });
});
