import { Test } from "@nestjs/testing";
import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";
import { PhotoCountService } from "./photo-count.service";
import { WineSubmissionsService } from "../wines/wine-submissions.service";

/**
 * ADR 0130, second half: nothing is renamed under a venue.
 *
 * `/inventory` renders `restaurant_inventory.wine_name`. Bulk receive used to
 * fill that column by reading the name off the library row it had just
 * resolved to — so when "House White Wine" auto-linked to the Sim Meyhouse
 * row, the Antalya venue's own label was overwritten with "HOUSE WHITE" at
 * insert time, permanently, on every screen. Closing the auto-link stops new
 * cases; this stops the overwrite itself, which is a separate write and would
 * still fire for any line whose draft name differs from its library row's.
 */
describe("bulk receive keeps the venue's own label", () => {
  let service: InventoryService;
  let inserted: Record<string, any>;
  let libraryNameWasRead: boolean;
  let resolvedDrafts: Record<string, any>[];

  const LIBRARY_ID = "mw-1";
  const RESTAURANT = "22222222-2222-2222-2222-222222222222";

  function client() {
    return {
      from: (table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => {
            if (table === "master_wine_library") {
              libraryNameWasRead = true;
              return {
                data: { id: LIBRARY_ID, name: "HOUSE WHITE", library_tier: 4 },
                error: null,
              };
            }
            return { data: null, error: null }; // no existing inventory row
          },
          insert: (payload: Record<string, any>) => {
            inserted = payload;
            return {
              select: () => ({
                single: async () => ({ data: { id: "inv-1" }, error: null }),
              }),
            };
          },
        };
        return q;
      },
      rpc: async () => ({ data: null, error: null }),
    };
  }

  beforeEach(async () => {
    inserted = {};
    libraryNameWasRead = false;
    resolvedDrafts = [];
    const moduleRef = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: DatabaseService,
          useValue: { getClient: () => client(), supabase: client() },
        },
        { provide: PhotoCountService, useValue: { estimate: jest.fn() } },
        {
          provide: WineSubmissionsService,
          useValue: {
            resolveOrCreateLibraryWine: async (item: Record<string, any>) => {
              resolvedDrafts.push(item);
              return {
              masterWineId: LIBRARY_ID,
              matched: false,
              provisional: true,
              libraryTier: 3,
              confidence: null,
              };
            },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(InventoryService);
  });

  it("stores the draft's name, not the library row's", async () => {
    const summary = await service.bulkCreateInventoryItems(RESTAURANT, {
      items: [{ wineDraft: { name: "House White Wine" }, stockLive: 0 }],
    } as any);

    expect(summary.failed).toBe(0);
    expect(inserted.wine_name).toBe("House White Wine");
    expect(inserted.wine_name).not.toBe("HOUSE WHITE");
    // And it did not even ask: a line that brought its own label has no
    // reason to read the library's.
    expect(libraryNameWasRead).toBe(false);
  });

  it("reports the line as the venue's own wine", async () => {
    const summary = await service.bulkCreateInventoryItems(RESTAURANT, {
      items: [{ wineDraft: { name: "House White Wine" }, stockLive: 0 }],
    } as any);

    expect(summary.results[0].venueProvisional).toBe(true);
    expect(summary.results[0].libraryMatched).toBe(false);
  });

  it("still falls back to the library name for a bare wineId line", async () => {
    const summary = await service.bulkCreateInventoryItems(RESTAURANT, {
      items: [{ wineId: LIBRARY_ID, stockLive: 0 }],
    } as any);

    expect(summary.failed).toBe(0);
    expect(inserted.wine_name).toBe("HOUSE WHITE");
    expect(libraryNameWasRead).toBe(true);
  });

  // F-740 — a drink received at the door through a draft was never
  // classified: the draft carried no kind, so the library row it created had
  // nothing for the classifier to read and a beer stayed 'unknown'.
  it("hands the draft's kind to the library as its menu category", async () => {
    await service.bulkCreateInventoryItems(RESTAURANT, {
      items: [{ wineDraft: { name: "Efes Pilsen", category: "beer" }, stockLive: 24 }],
    } as any);

    expect(resolvedDrafts[0].menuCategory).toBe("beer");
  });
});
