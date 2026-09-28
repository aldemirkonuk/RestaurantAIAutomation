import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { VendorPortalService } from "./vendor-portal.service";
function service(
  pageResult: unknown,
  listingResult: unknown = { data: [], error: null },
) {
  const page: any = {};
  for (const name of ["select", "eq"]) page[name] = jest.fn(() => page);
  page.maybeSingle = jest.fn().mockResolvedValue(pageResult);
  const listings: any = {};
  for (const name of ["select", "eq"]) listings[name] = jest.fn(() => listings);
  listings.order = jest
    .fn()
    .mockReturnValueOnce(listings)
    .mockResolvedValueOnce(listingResult);
  const from = jest.fn((table) =>
    table === "vendor_portal_pages" ? page : listings,
  );
  return {
    value: new VendorPortalService({ supabase: { from } } as any),
    from,
    page,
    listings,
  };
}
const row = {
  id: "page-1",
  slug: "vendor",
  display_name: "Vendor",
  updated_at: "2026-09-13",
};
describe("public catalogue reads fail honestly", () => {
  it("keeps missing and unpublished pages indistinguishable", async () => {
    const s = service({ data: null, error: null });
    await expect(s.value.getPublishedPage("Vendor")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(s.page.eq).toHaveBeenCalledWith("is_published", true);
    expect(s.from).not.toHaveBeenCalledWith("vendor_portal_listings");
  });
  it("does not disguise a page read failure as a missing vendor", async () => {
    const s = service({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(s.value.getPublishedPage("vendor")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it("does not disguise a listings failure as an empty catalogue", async () => {
    const s = service(
      { data: row, error: null },
      { data: null, error: { message: "database unavailable" } },
    );
    await expect(s.value.getPublishedPage("vendor")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it("still returns a genuinely empty catalogue and never selects its editing secret", async () => {
    const s = service({ data: row, error: null });
    await expect(s.value.getPublishedPage(" VENDOR ")).resolves.toMatchObject({
      displayName: "Vendor",
      listings: [],
    });
    expect(s.page.select.mock.calls[0][0]).not.toMatch(/edit_token|\*/);
    expect(s.page.eq).toHaveBeenCalledWith("slug", "vendor");
  });
  it("does not publish unknown availability as in stock", () => {
    const s = service({ data: row, error: null });
    const json: any = s.value.buildJsonLd(
      {
        displayName: "Vendor",
        listings: [
          {
            productName: "Wine",
            price: 10,
            currency: "USD",
            inStock: null,
            packSize: 1,
          },
        ],
      } as any,
      "https://mudavym.com/v/vendor",
    );
    expect(json.itemListElement[0].item.offers).not.toHaveProperty(
      "availability",
    );
  });
});
