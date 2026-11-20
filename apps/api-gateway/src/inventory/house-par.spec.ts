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
});
