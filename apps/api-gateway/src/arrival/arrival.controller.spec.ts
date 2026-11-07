import "reflect-metadata";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { ArrivalController } from "./arrival.controller";
import { ArrivalService } from "./arrival.service";
import * as dto from "./arrival.dto";

// The routes Nest mounts under /arrival, read from the decorators.
function routes(): string[] {
  const proto = ArrivalController.prototype as unknown as Record<
    string,
    unknown
  >;
  return Object.getOwnPropertyNames(proto).flatMap((name) => {
    const handler = proto[name];
    if (name === "constructor" || typeof handler !== "function") return [];
    const path = Reflect.getMetadata(PATH_METADATA, handler);
    if (path === undefined) return [];
    const method = Reflect.getMetadata(METHOD_METADATA, handler);
    return [`${RequestMethod[method]} ${path}`];
  });
}

describe("ArrivalController routes", () => {
  it("still mounts the evidence and propose doors", () => {
    expect(routes()).toEqual(
      expect.arrayContaining(["POST evidence", "POST config/propose_batch"]),
    );
  });

  it("mounts no menu-evidence door, and nothing behind it remains", () => {
    expect(routes().filter((r) => r.includes("menu-evidence"))).toEqual([]);
    expect(
      (ArrivalService.prototype as unknown as Record<string, unknown>)
        .menuEvidence,
    ).toBeUndefined();
    expect(Object.keys(dto)).not.toContain("MenuEvidenceDto");
  });
});
