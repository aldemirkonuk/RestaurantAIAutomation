/**
 * The register write itself: what reaches `vendor_price_observations`, and
 * what is refused before it gets there.
 *
 * `writeObservations` is exercised directly with a stubbed supabase client
 * rather than through `extractFromUrl`, so nothing here depends on a network
 * or a model call. The upsert options matter as much as the rows: the dedup
 * index is the only thing stopping a nightly job from "confirming" a stale
 * price thirty times a month.
 */

import { VendorPageExtractorService } from "./vendor-page-extractor.service";
import { ExtractedItem } from "./vendor-page-extraction";
import { readPageSizeEvidence } from "./bottle-size";

const TENANT = "11111111-1111-1111-1111-111111111111";

const item = (over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  name: "Chablis 1er Cru",
  producer: "Domaine X",
  vintage: 2019,
  price: 42,
  currency: "USD",
  packSize: 1,
  volumeMl: 750,
  inStock: true,
  parseConfidence: 0.8,
  warnings: [],
  ...over,
});

/**
 * A supabase double that records the upsert and answers the priors read.
 *
 * `upsertResult` models the real `ignoreDuplicates: true` behaviour: a row
 * that collides with the `(source_ref, content_hash)` unique index is not
 * returned by `.select("id")`, so the written count falls.
 */
function makeService(opts: {
  priors?: Array<{ signature_hash: string; normalized_unit_price: number }>;
  priorsError?: string;
  upsertReturns?: Array<{ id: string }>;
  upsertError?: string;
}) {
  const captured: { rows: any[]; options: any } = { rows: [], options: null };

  const priorsBuilder: any = {
    select: () => priorsBuilder,
    in: () => priorsBuilder,
    not: () => priorsBuilder,
    is: () => priorsBuilder,
    or: () => priorsBuilder,
    limit: () => priorsBuilder,
    then: (resolve: any) =>
      resolve(
        opts.priorsError
          ? { data: null, error: { message: opts.priorsError } }
          : { data: opts.priors ?? [], error: null },
      ),
  };
  const upsertBuilder: any = {
    upsert: (rows: any[], options: any) => {
      captured.rows = rows;
      captured.options = options;
      return {
        select: async () =>
          opts.upsertError
            ? { data: null, error: { message: opts.upsertError } }
            : {
                data:
                  opts.upsertReturns ?? rows.map((_, i) => ({ id: `id${i}` })),
                error: null,
              },
      };
    },
    ...priorsBuilder,
  };
  const database = { supabase: { from: () => upsertBuilder } } as any;

  const service = new VendorPageExtractorService(
    { get: () => undefined } as any,
    database,
    { call: async () => ({}) } as any,
    { record: () => undefined } as any,
  );
  return { service, captured };
}

const ctx = {
  url: "https://merchant.example/wines",
  providerId: "22222222-2222-2222-2222-222222222222",
  vendorCatalogueId: null,
  vendorName: "Merchant Ltd",
  restaurantId: TENANT,
  contentHash: "c".repeat(64),
  httpStatus: 200,
  fetchedAt: "2026-09-04T10:00:00.000Z",
  pageStatedDate: null as string | null,
};

const write = (
  service: any,
  items: ExtractedItem[],
  // `sizeEvidence` joins the context in 2026-09-04's size read, so this is no
  // longer keyed to `ctx` alone.
  over: Record<string, any> = {},
) => service.writeObservations(items, { ...ctx, ...over });

describe("what reaches the register", () => {
  it("writes a tier-4 website_scrape row scoped to this house", async () => {
    const { service, captured } = makeService({});
    const out = await write(service, [item()]);
    expect(out.written).toBe(1);
    expect(captured.rows).toHaveLength(1);
    expect(captured.rows[0]).toMatchObject({
      restaurant_id: TENANT,
      source_type: "website_scrape",
      trust_tier: 4,
      source_url: ctx.url,
      unit_volume_ml: 750,
      pack_size: 1,
      raw_price: 42,
      is_outlier: false,
    });
    expect(captured.rows[0].normalized_unit_price).toBeCloseTo(42, 6);
  });

  it("upserts on the dedup index, so a re-read of the same page adds nothing", async () => {
    const { service, captured } = makeService({ upsertReturns: [] });
    const out = await write(service, [item()]);
    expect(captured.options).toEqual({
      onConflict: "source_ref,content_hash",
      ignoreDuplicates: true,
    });
    // The database refused the duplicate; the count reflects it rather than
    // reporting a write that did not happen.
    expect(out.written).toBe(0);
  });

  it("flags an undated page on the row, and claims no effective date", async () => {
    const { service, captured } = makeService({});
    await write(service, [item()]);
    expect(captured.rows[0].observed_at).toBe(ctx.fetchedAt);
    expect(captured.rows[0].effective_date).toBeNull();
    expect(captured.rows[0].raw.undated).toBe(true);
  });

  it("files the page's own date as effective_date, not as observed_at", async () => {
    const { service, captured } = makeService({});
    await write(service, [item()], {
      pageStatedDate: "2026-07-01T00:00:00.000Z",
    });
    // observed_at stays OUR fetch clock: the comparison window reads it, so it
    // must be a fact about our reading rather than a claim on the vendor's page.
    expect(captured.rows[0].observed_at).toBe(ctx.fetchedAt);
    expect(captured.rows[0].effective_date).toBe("2026-07-01");
    expect(captured.rows[0].raw.undated).toBe(false);
    expect(captured.rows[0].raw.fetchedAt).toBe(ctx.fetchedAt);
  });
});

describe("what is refused, and counted", () => {
  it("refuses a row whose page printed no bottle size", async () => {
    const { service, captured } = makeService({});
    const out = await write(service, [item({ volumeMl: null })]);
    expect(out.written).toBe(0);
    expect(captured.rows).toHaveLength(0);
    expect(out.refusals.no_bottle_volume).toBe(1);
  });

  it("refuses a tenant-less write outright", async () => {
    const { service } = makeService({});
    const out = await write(service, [item()], { restaurantId: null });
    expect(out.written).toBe(0);
    expect(out.refusals.no_restaurant).toBe(1);
  });

  it("counts refusals per reason and still writes the good rows", async () => {
    const { service, captured } = makeService({});
    const out = await write(service, [
      item({ name: "A" }),
      item({ name: "B", volumeMl: null }),
      item({ name: "C", price: 0 }),
    ]);
    expect(captured.rows.map((r: any) => r.product_name_raw)).toEqual(["A"]);
    expect(out.refusals.no_bottle_volume).toBe(1);
    expect(out.refusals.bad_price).toBe(1);
    expect(out.written).toBe(1);
  });

  it("reports a failed write as a failure, not as an empty page", async () => {
    const { service } = makeService({ upsertError: "23514 check violation" });
    const out = await write(service, [item()]);
    expect(out.written).toBe(0);
    expect(out.warnings.join(" ")).toContain("23514");
  });
});

describe("the outlier flag", () => {
  it("flags a wild price against the register's priors, and still writes it", async () => {
    const { service, captured } = makeService({ priors: [] });
    // The priors read is driven by signature_hash, which the service computes.
    // Take it from a first pass, then feed four near-identical priors back.
    await write(service, [item()]);
    const sig = captured.rows[0].signature_hash as string;
    expect(sig).toBeTruthy();

    const priced = (v: number) => ({
      signature_hash: sig,
      normalized_unit_price: v,
    });
    const second = makeService({
      priors: [priced(42), priced(42.1), priced(41.9), priced(42.05)],
    });
    const out = await write(second.service, [item({ price: 4200 })]);
    expect(out.flaggedOutliers).toBe(1);
    // Flagged, never dropped: the row is written so a bad parse stays visible
    // and fixable at source (ADR 0117).
    expect(second.captured.rows).toHaveLength(1);
    expect(second.captured.rows[0].is_outlier).toBe(true);
    expect(out.written).toBe(1);
  });

  it("does not flag below the five-value sample floor", async () => {
    const { service, captured } = makeService({});
    await write(service, [item()]);
    const sig = captured.rows[0].signature_hash as string;
    const second = makeService({
      priors: [
        { signature_hash: sig, normalized_unit_price: 42 },
        { signature_hash: sig, normalized_unit_price: 42 },
      ],
    });
    const out = await write(second.service, [item({ price: 4200 })]);
    expect(out.flaggedOutliers).toBe(0);
    expect(second.captured.rows[0].is_outlier).toBe(false);
  });

  it("writes UNFLAGGED when the priors could not be read", async () => {
    // A flag we could not compute must not be asserted.
    const { service, captured } = makeService({
      priorsError: "permission denied",
    });
    const out = await write(service, [item()]);
    expect(out.written).toBe(1);
    expect(captured.rows[0].is_outlier).toBe(false);
  });
});

/**
 * The size read, reaching the register.
 *
 * Added 2026-09-04 with `bottle-size.ts`. Until then the ONLY source of
 * `unit_volume_ml` was the extraction model, and the only thing the model was
 * shown was `htmlToText(html)` — which drops the contents of `<script>`, and
 * with it every schema.org statement a merchant publishes. These cases run the
 * writer with the page evidence attached, which is what `extractFromUrl` now
 * hands it.
 */
describe("where the unit came from, on the row", () => {
  const LD = (extra: Record<string, unknown>) =>
    `<html><head><title>Chablis 1er Cru</title></head><body>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Chablis 1er Cru",
        offers: { "@type": "Offer", price: 42, priceCurrency: "USD" },
        ...extra,
      })}</script>
    </body></html>`;

  it("reads a size the model never saw, and says where it read it", async () => {
    const html = LD({
      additionalProperty: [
        { "@type": "PropertyValue", name: "Bottle Volume", value: "37.5 cl" },
      ],
    });
    const { service, captured } = makeService({});
    // The model reports NOTHING, exactly as it must when the size is inside a
    // <script> it was never shown.
    const out = await write(service, [item({ volumeMl: null })], {
      sizeEvidence: readPageSizeEvidence(html),
    });
    expect(out.written).toBe(1);
    expect(captured.rows[0].unit_volume_ml).toBe(375);
    expect(captured.rows[0].raw.volume).toMatchObject({
      source: "structured_offer",
      statement: "37.5 cl",
    });
    expect(captured.rows[0].raw.volume.locator).toContain("Bottle Volume");
    expect(out.volumeSources).toEqual({ structured_offer: 1 });
    // And the price is now normalised as a HALF bottle, which is the whole
    // point: at 375ml this is $84/750ml, not $42.
    expect(captured.rows[0].normalized_unit_price).toBeCloseTo(84, 6);
  });

  it("refuses a contradiction as `volume_conflict`, never as an absence", async () => {
    const html = `${LD({
      additionalProperty: [{ name: "Bottle Volume", value: "75 cl" }],
    })}<span title="Bottle size cl: 150">1.5L</span>`;
    const { service, captured } = makeService({});
    const out = await write(service, [item({ volumeMl: 750 })], {
      sizeEvidence: readPageSizeEvidence(html),
    });
    expect(out.written).toBe(0);
    expect(captured.rows).toHaveLength(0);
    expect(out.refusals.volume_conflict).toBe(1);
    expect(out.refusals.no_bottle_volume).toBe(0);
  });

  it("takes a pack out of the size statement when the model defaulted to 1", async () => {
    // `validateItem` assigns packSize 1 whenever the model reported nothing, so
    // a 1 carries no information; "6 x 75cl" on the page does.
    const html = `<script type="application/json">${JSON.stringify({
      title: "Chablis 1er Cru",
      options: ["Format"],
      variants: [{ id: 1, title: "6 x 75cl", options: ["6 x 75cl"], price: 25200 }],
    })}</script>`;
    const { service, captured } = makeService({});
    await write(service, [item({ volumeMl: null, packSize: 1, price: 252 })], {
      sizeEvidence: readPageSizeEvidence(html),
    });
    expect(captured.rows[0].pack_size).toBe(6);
    expect(captured.rows[0].unit_volume_ml).toBe(750);
    // Both packs on the row, so the choice is auditable rather than silent.
    expect(captured.rows[0].raw.modelPackSize).toBe(1);
    expect(captured.rows[0].raw.packFromPageStatement).toBe(6);
  });

  it("keeps the model's own read when the markup says nothing, and labels it", async () => {
    // The manual `POST /vendor-intel/scrape` path has no markup evidence at
    // all; the row must still say where its unit came from.
    const { service, captured } = makeService({});
    const out = await write(service, [item({ volumeMl: 750 })], {
      sizeEvidence: readPageSizeEvidence("<p>A lovely wine.</p>"),
    });
    expect(out.written).toBe(1);
    expect(captured.rows[0].unit_volume_ml).toBe(750);
    expect(captured.rows[0].raw.volume).toMatchObject({ source: "model_text" });
    expect(out.volumeSources).toEqual({ model_text: 1 });
  });

  it("still refuses when neither the markup nor the model has a size", async () => {
    const { service } = makeService({});
    const out = await write(service, [item({ volumeMl: null })], {
      sizeEvidence: readPageSizeEvidence("<p>A lovely wine.</p>"),
    });
    expect(out.written).toBe(0);
    expect(out.refusals.no_bottle_volume).toBe(1);
  });
});
