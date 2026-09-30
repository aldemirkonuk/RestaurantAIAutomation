import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { StorageLocationsController } from "./storage-locations.controller";

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
 *
 * What the service then does with a parent (stores it, or refuses another
 * restaurant's zone, the zone itself, or a cycle) is pinned in
 * storage-locations-hierarchy.spec.ts. The 422 "zone parents are not stored
 * yet" this suite used to pin is gone: migration
 * 20261203110000_a_zone_can_sit_inside_another_zone added the column
 * (founder answer 2026-09-29, "Add parent column (Recommended)").
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
  // The body is the last parameter: createLocation(user, restaurantId, dto) /
  // updateLocation(user, restaurantId, locationId, dto) since ADR 0238 added
  // the caller. Reading it by position from the end keeps this pin on the DTO.
  return types?.[types.length - 1];
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
