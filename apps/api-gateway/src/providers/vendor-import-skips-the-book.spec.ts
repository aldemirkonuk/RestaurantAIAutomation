import { ServiceUnavailableException } from "@nestjs/common";
import { ProvidersService } from "./providers.service";

/**
 * F-1458 (sim 48, integ19-w95-97-regress.md). The vendor import screen could
 * send its file while the book was still being read, with nothing to match
 * against, so every vendor already in the book was created again. The
 * gateway now reads the book itself and leaves a vendor already in it as it
 * is, by the key the screen sorts on (folded name, or email). A book it
 * cannot read refuses the import rather than reading as "no vendors yet".
 */
const HOUSE = "house-a";

function service(book: { rows?: any[]; fails?: boolean }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    then: (res: any, rej: any) =>
      Promise.resolve(
        book.fails
          ? { data: null, error: { message: "statement timeout" } }
          : { data: book.rows ?? [], error: null },
      ).then(res, rej),
  };
  const svc = Object.create(ProvidersService.prototype) as any;
  svc.databaseService = { supabase: { from: () => chain } };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  svc.createProvider = jest.fn().mockResolvedValue({ id: "new" });
  return svc as ProvidersService & { createProvider: jest.Mock };
}

describe("vendor import leaves the book's vendors as they are (F-1458)", () => {
  it("skips a vendor already in the book by name or by email", async () => {
    const svc = service({
      rows: [
        { name: "Kavaklıdere", contact_email: null },
        { name: "Doluca", contact_email: "orders@doluca.example" },
      ],
    });
    const out = await svc.bulkImportProviders(
      {
        restaurantId: HOUSE,
        providers: [
          { name: "KAVAKLIDERE " },
          { name: "Doluca Şarapları", email: "Orders@Doluca.example" },
          { name: "Sevilen" },
        ],
      } as any,
      HOUSE,
    );
    expect(svc.createProvider).toHaveBeenCalledTimes(1);
    expect(svc.createProvider.mock.calls[0][0]).toMatchObject({
      name: "Sevilen",
    });
    expect(out).toMatchObject({ imported: 1, failed: 0, skipped: 2 });
  });

  it("adds a vendor named twice in one file only once", async () => {
    const svc = service({ rows: [] });
    const out = await svc.bulkImportProviders(
      {
        restaurantId: HOUSE,
        providers: [{ name: "Sevilen" }, { name: "sevilen" }],
      } as any,
      HOUSE,
    );
    expect(svc.createProvider).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ imported: 1, skipped: 1 });
  });

  it("refuses the import when the book cannot be read", async () => {
    const svc = service({ fails: true });
    await expect(
      svc.bulkImportProviders(
        { restaurantId: HOUSE, providers: [{ name: "Sevilen" }] } as any,
        HOUSE,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(svc.createProvider).not.toHaveBeenCalled();
  });
});
