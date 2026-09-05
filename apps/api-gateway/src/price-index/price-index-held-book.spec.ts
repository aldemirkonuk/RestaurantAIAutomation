/**
 * A carried book is not the market until somebody lets it in (ADR 0128).
 *
 * THE PRE-FIX PROOF, MEASURED AND THEN REMOVED
 * --------------------------------------------
 * The fault this suite closes was demonstrated against the code that was here
 * before, on 2026-09-05, and the probe was deleted rather than committed:
 *
 *   git show HEAD:apps/api-gateway/src/price-index/price-index.service.ts \
 *     > apps/api-gateway/src/price-index/price-index.service.prefixprobe.ts
 *   # class renamed to PriceIndexServiceAtHead so both could be loaded at once;
 *   # same depth, so its relative imports resolved. No git state was changed.
 *   # HEAD was b1d64869 when the probe was taken. The branch has moved since
 *   # (d84d8d39 at the time of writing) and `git show HEAD:` on that file still
 *   # returns a service with no admission predicate, so the measurement stands.
 *
 * Against the register below — ONE row of a book a person carried in and
 * nobody had admitted — HEAD returned it as the index line for Michigan:
 *
 *   BEFORE: an uploaded book was the market the instant it was written
 *     PASS  HEAD draws a carried, unadmitted row as the index line for Michigan
 *           lines: 1  ("Angel's Envy Bourbon")   silence: null
 *           and every query it issued asked nothing about admission,
 *           because there was no such question to ask.
 *
 * Because the read orders by `issued_at` descending, that carried edition also
 * displaced every fetched line above it. The three cases below are the same
 * register through the service as it now stands.
 */

import { PriceIndexService } from "./price-index.service";

/** One row of a book a person carried in and nobody has admitted. */
const HELD_MICHIGAN_ROW = {
  id: "held-1",
  source_key: "michigan-lcc-price-book",
  source_class: "posted_wholesale_list",
  state: "US-MI",
  region: null,
  issuer: "Michigan Liquor Control Commission",
  issued_at: "2025-08-03",
  issued_at_basis: "issuer_stated",
  fetched_at: "2026-09-05T00:00:00Z",
  price_basis: "licensee_price",
  product_name: "Angel's Envy Bourbon",
  brand: "Angel's Envy",
  producer: null,
  package_desc: null,
  container_type: null,
  size_value: 750,
  size_unit: "Milliliter",
  price: 44.99,
  currency: "USD",
  price_unit: "per bottle",
  pack: 6,
  container_charge: null,
  is_promotion: false,
  source_status: null,
  attribution: null,
  source_url: "https://www.michigan.gov/lara",
  source_ref: "mlcc:price-book:2025-08-03#liquor_code=10001",
  uploaded_by: "user-uploader",
  upload_file_name: "8-3-25-PRICE-BOOK-EXCEL.xlsx",
  upload_sha256: "a".repeat(64),
  upload_edition_date: "2025-08-03",
  // Nobody has let this row in.
  admitted_at: null,
};

interface Ctx {
  table: string;
  head: boolean;
  ors: string[];
}

/**
 * A register holding exactly one carried, unadmitted row, which answers a query
 * ONLY when the caller asked for the visibility predicate or did not ask for
 * anything. In other words: the database does the filtering, exactly as
 * PostgREST would, so what is proved here is that the SERVICE asks for it.
 */
function registerWithOneHeldBook(opts: { heldBooks?: number } = {}) {
  const seen: Ctx[] = [];
  const client = {
    from(table: string) {
      const ctx: Ctx = { table, head: false, ors: [] };
      seen.push(ctx);
      const b: Record<string, unknown> = {
        select(_c: string, o?: { head?: boolean }) {
          ctx.head = o?.head === true;
          return b;
        },
        eq() {
          return b;
        },
        or(clause: string) {
          ctx.ors.push(clause);
          return b;
        },
        order() {
          return b;
        },
        limit() {
          return b;
        },
        single() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => unknown) {
          if (ctx.table === "price_index_upload_reviews") {
            return Promise.resolve({
              data: null,
              count: opts.heldBooks ?? 1,
              error: null,
            }).then(resolve);
          }
          const visible = ctx.ors.some((o) => o.includes("admitted_at"));
          const rows = visible ? [] : [HELD_MICHIGAN_ROW];
          return Promise.resolve({
            data: ctx.head ? null : rows,
            count: rows.length,
            error: null,
          }).then(resolve);
        },
      };
      return b;
    },
  };
  return { db: { client } as never, seen };
}

describe("the register the pre-fix probe was run against", () => {
  it("still holds exactly one carried, unadmitted row", () => {
    // The row the deleted probe drew as an index line. Kept here so the fixture
    // the measurement was made on is on the record rather than described.
    expect(HELD_MICHIGAN_ROW.uploaded_by).toBe("user-uploader");
    expect(HELD_MICHIGAN_ROW.admitted_at).toBeNull();
  });
});

describe("AFTER: a carried book waits, and the panel says so", () => {
  it("draws no line, and names the book that is waiting instead of an absence", async () => {
    const { db } = registerWithOneHeldBook({ heldBooks: 1 });
    const svc = new PriceIndexService(db);
    const r = await svc.forState("Michigan");
    expect(r.lines).toHaveLength(0);
    expect(r.heldBooks).toBe(1);
    expect(r.silence).toContain("waiting for a second pair of eyes");
    expect(r.silence).not.toContain("cannot be fetched");
  });

  it("asks for the visibility predicate on the lines AND on the row counts", async () => {
    const { db, seen } = registerWithOneHeldBook();
    const svc = new PriceIndexService(db);
    await svc.forState("Michigan");
    const postingReads = seen.filter((c) => c.table === "price_index_postings");
    expect(postingReads.length).toBeGreaterThan(0);
    for (const c of postingReads) {
      expect(c.ors).toContain("uploaded_by.is.null,admitted_at.not.is.null");
    }
  });

  it("still says the register is UNKNOWN, not empty, when the read fails", async () => {
    const client = {
      from() {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          or: () => b,
          order: () => b,
          limit: () => b,
          single: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              count: null,
              error: { message: "connection reset" },
            }).then(resolve),
        };
        return b;
      },
    };
    const svc = new PriceIndexService({ client } as never);
    const r = await svc.forState("Michigan");
    expect(r.silence).toContain("This is unknown, not empty.");
    // A failed read must NOT be reported as "a book is waiting" either: the
    // held count is not asked for when the lines could not be read at all.
    expect(r.heldBooks).toBe(0);
  });
});
