import { HttpException, HttpStatus } from "@nestjs/common";
import { HOUSE_PAR_FALLBACK, readHouseThresholdMin } from "./house-par";

const clientReading = (data: unknown) => ({
  from: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  }),
});

describe("readHouseThresholdMin", () => {
  it("reads the par the house stated", async () => {
    await expect(
      readHouseThresholdMin(clientReading({ default_threshold_min: 12 }), "r1"),
    ).resolves.toBe(12);
  });

  it("keeps a stated 0 as 0", async () => {
    await expect(
      readHouseThresholdMin(clientReading({ default_threshold_min: 0 }), "r1"),
    ).resolves.toBe(0);
  });

  it("falls back to the one column default (3) for a house that stated none", async () => {
    expect(HOUSE_PAR_FALLBACK).toBe(3);
    await expect(readHouseThresholdMin(clientReading(null), "r1")).resolves.toBe(3);
    await expect(
      readHouseThresholdMin(clientReading({ default_threshold_min: null }), "r1"),
    ).resolves.toBe(3);
  });

  // ADR 0116: a default is not an answer. A read that failed is not "the house
  // stated none"; writing 3 would hold a house that stated 12 to 3.
  it("refuses with a 503 when the read failed, instead of answering 3", async () => {
    const failing = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest
              .fn()
              .mockResolvedValue({ data: null, error: { message: "timeout" } }),
          }),
        }),
      }),
    };
    const err = await readHouseThresholdMin(failing, "r1").catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(err.message).toBe(
      "The house's par could not be read; nothing was added.",
    );
  });
});
