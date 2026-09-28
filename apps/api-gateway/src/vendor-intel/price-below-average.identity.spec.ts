import { ObservationRow, priceBelowAverage } from "./price-below-average";

/**
 * What grouping by identity actually changes in the ladder.
 *
 * These cases are in their own file rather than appended to
 * `price-below-average.spec.ts` because that file is shared and was being
 * edited by another builder in the same worktree on 2026-09-05.
 *
 * THE DEFECT THIS DEMONSTRATES IS REAL AND PRE-EXISTING.
 * `normalizeUnitPrice` (`analytics/engine/vendor-price-consensus.ts:132`)
 * scales every sighting to a price per 750 ml, so a 375 ml half bottle at $30
 * and a 750 ml bottle at $60 are the SAME per-750 number, and before this
 * change they landed in one group because the group key was the wine. ADR 0119
 * Q7 named that: "volumetrically right, commercially wrong."
 */

function row(over: Partial<ObservationRow>): ObservationRow {
  return {
    identity_id: null,
    master_wine_id: "11111111-1111-1111-1111-111111111111",
    signature_hash: null,
    product_name_raw: "Test Wine",
    vendor_name_raw: "Vendor",
    provider_id: null,
    source_type: "quote",
    observed_at: "2026-09-01T00:00:00.000Z",
    raw_price: 60,
    currency: "USD",
    pack_size: 1,
    unit_volume_ml: 750,
    yield_factor: 1,
    ...over,
  };
}

describe("priceBelowAverage grouped by identity", () => {
  it("keeps two formats of one wine apart when both carry an identity", () => {
    const bottle = "aaaaaaaa-0000-0000-0000-000000000001";
    const magnum = "aaaaaaaa-0000-0000-0000-000000000002";
    const rows: ObservationRow[] = [
      // Four 750ml sightings, the last one cheap.
      row({ identity_id: bottle, observed_at: "2026-08-01T00:00:00Z", raw_price: 60 }),
      row({ identity_id: bottle, observed_at: "2026-08-05T00:00:00Z", raw_price: 60 }),
      row({ identity_id: bottle, observed_at: "2026-08-09T00:00:00Z", raw_price: 60 }),
      row({ identity_id: bottle, observed_at: "2026-08-20T00:00:00Z", raw_price: 30 }),
      // Four magnum sightings at a steady per-750 price.
      row({
        identity_id: magnum,
        unit_volume_ml: 1500,
        observed_at: "2026-08-02T00:00:00Z",
        raw_price: 120,
      }),
      row({
        identity_id: magnum,
        unit_volume_ml: 1500,
        observed_at: "2026-08-06T00:00:00Z",
        raw_price: 120,
      }),
      row({
        identity_id: magnum,
        unit_volume_ml: 1500,
        observed_at: "2026-08-10T00:00:00Z",
        raw_price: 120,
      }),
      row({
        identity_id: magnum,
        unit_volume_ml: 1500,
        observed_at: "2026-08-21T00:00:00Z",
        raw_price: 120,
      }),
    ];

    const result = priceBelowAverage(rows, { minObservations: 3 });

    // Two products, two comparisons — the magnum did not join the bottle.
    expect(result.scanned.products).toBe(2);
    expect(result.scanned.comparisons).toBe(2);
    expect(result.keyedBy).toEqual({ identity: 2, wine: 0, signature: 0 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productKey).toBe(`identity:${bottle}`);
    expect(result.items[0].keyedBy).toBe("identity");
    expect(result.groupingNote).toContain("cannot be averaged away");
  });

  it("falls back to the wine key when nothing carries an identity, and SAYS it did", () => {
    const rows: ObservationRow[] = [
      row({ observed_at: "2026-08-01T00:00:00Z", raw_price: 60 }),
      row({ observed_at: "2026-08-05T00:00:00Z", raw_price: 60 }),
      row({ observed_at: "2026-08-09T00:00:00Z", raw_price: 60 }),
      row({
        observed_at: "2026-08-20T00:00:00Z",
        raw_price: 30,
        unit_volume_ml: 375,
      }),
    ];

    const result = priceBelowAverage(rows, { minObservations: 3 });

    // The pre-existing behaviour, unchanged and now visible: the 375ml at $30
    // is $60 per 750ml, so it is NOT below the average — but it did enter the
    // same group as the 750s, which is the thing the identity key stops.
    expect(result.keyedBy).toEqual({ identity: 0, wine: 1, signature: 0 });
    expect(result.items.concat(result.publicSiteItems).every((i) => i.keyedBy === "wine")).toBe(
      true,
    );
    expect(result.groupingNote).toContain("grouped the old way");
    expect(result.groupingNote).toContain("one group");
  });

  it("reports a mixture honestly rather than as one story", () => {
    const identified = "bbbbbbbb-0000-0000-0000-000000000001";
    const rows: ObservationRow[] = [
      row({ identity_id: identified, observed_at: "2026-08-01T00:00:00Z" }),
      row({ identity_id: identified, observed_at: "2026-08-02T00:00:00Z" }),
      row({
        master_wine_id: "22222222-2222-2222-2222-222222222222",
        observed_at: "2026-08-03T00:00:00Z",
      }),
      row({
        master_wine_id: null,
        signature_hash: "f".repeat(64),
        observed_at: "2026-08-04T00:00:00Z",
      }),
    ];

    const result = priceBelowAverage(rows, { minObservations: 3 });
    expect(result.keyedBy).toEqual({ identity: 1, wine: 1, signature: 1 });
    expect(result.groupingNote).toContain("1 of 3 comparisons");
  });

  it("does not merge a row's identity group with its own wine group", () => {
    // The same row carries BOTH keys. Grouping by identity is a preference,
    // not a fallback: the identity group must not silently absorb sightings
    // that are keyed by the wine, because the wine group may hold other
    // formats.
    const identified = "cccccccc-0000-0000-0000-000000000001";
    const wine = "33333333-3333-3333-3333-333333333333";
    const rows: ObservationRow[] = [
      row({ identity_id: identified, master_wine_id: wine, observed_at: "2026-08-01T00:00:00Z" }),
      row({ identity_id: null, master_wine_id: wine, observed_at: "2026-08-02T00:00:00Z" }),
    ];
    const result = priceBelowAverage(rows, { minObservations: 1 });
    expect(result.scanned.comparisons).toBe(2);
    expect(result.keyedBy).toEqual({ identity: 1, wine: 1, signature: 0 });
  });

  it("leaves a caller that never selected identity_id working unchanged", () => {
    const legacy = [
      {
        master_wine_id: "44444444-4444-4444-4444-444444444444",
        signature_hash: null,
        product_name_raw: "Legacy",
        vendor_name_raw: null,
        provider_id: null,
        source_type: "quote",
        observed_at: "2026-08-01T00:00:00Z",
        raw_price: 10,
        currency: "USD",
        pack_size: 1,
        unit_volume_ml: 750,
        yield_factor: 1,
      },
    ] as ObservationRow[];
    const result = priceBelowAverage(legacy, { minObservations: 3 });
    expect(result.keyedBy).toEqual({ identity: 0, wine: 1, signature: 0 });
    expect(result.skipped.noProductKey).toBe(0);
  });
});
