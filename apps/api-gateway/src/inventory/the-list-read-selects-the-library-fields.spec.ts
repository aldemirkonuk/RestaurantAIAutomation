import { DatabaseService } from "../database/database.service";

/**
 * The stock list read must select every library column the row now carries
 * (libraryType, libraryGrape, libraryKind, libraryProducer, libraryVintage,
 * libraryDisplayName). The mapper leaves a column off the wire when the join
 * did not select it, and the page then asks /wines for the whole list again.
 * Found in the r45 browser walk: beverage_kind and display_name were missing.
 */
describe("the stock list read selects what the row carries", () => {
  it("names all six library columns in the embedded select", async () => {
    let selected = "";
    const chain: any = {
      select: (s: string) => {
        selected = s;
        return chain;
      },
      eq: () => chain,
      then: (res: any) => res({ data: [], error: null }),
    };
    const db = new DatabaseService({ get: () => undefined } as any);
    db.supabase = { from: () => chain } as any;
    await db.getRestaurantInventory("r1");
    for (const col of ["primary_type", "grape_variety", "beverage_kind", "producer", "vintage", "display_name"]) {
      expect(selected).toContain(col);
    }
  });
});
