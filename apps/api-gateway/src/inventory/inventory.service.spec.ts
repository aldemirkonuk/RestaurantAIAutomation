import { Test, TestingModule } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";

describe("InventoryService", () => {
  let service: InventoryService;

  // Each test configures specific return values via these jest.fn references.
  const mockSingle = jest.fn();
  const mockExecute = jest.fn();

  const mockSupabaseChain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: mockSingle,
    execute: mockExecute,
  };

  const mockDatabaseService = {
    getClient: jest.fn(() => mockSupabaseChain),
    supabase: mockSupabaseChain,
    getRestaurantInventory: jest.fn().mockResolvedValue([]),
    getLowStockItems: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore the chain mock after clearAllMocks wipes return values
    mockSupabaseChain.from.mockReturnThis();
    mockSupabaseChain.select.mockReturnThis();
    mockSupabaseChain.insert.mockReturnThis();
    mockSupabaseChain.update.mockReturnThis();
    mockSupabaseChain.eq.mockReturnThis();
    mockSupabaseChain.neq.mockReturnThis();
    mockSupabaseChain.is.mockReturnThis();
    mockSupabaseChain.order.mockReturnThis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DatabaseService, useValue: mockDatabaseService },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  describe("createInventoryItem — wine_name population (regression: Bug 1)", () => {
    it("returns a non-null wineName when the master wine library resolves a name", async () => {
      // Call 1: no existing inventory item (duplicate check → PGRST116 = not found)
      // Call 2: master_wine_library name lookup → 'Château Pétrus'
      // Call 3: the INSERT .single() → full row with wine_name populated
      mockSingle
        .mockResolvedValueOnce({
          data: null,
          error: { code: "PGRST116", message: "not found" },
        })
        .mockResolvedValueOnce({
          data: { name: "Château Pétrus" },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: "inv-uuid-1",
            restaurant_id: "rest-1",
            master_wine_id: "mw-1",
            wine_name: "Château Pétrus",
            stock_live: 6,
            master_wine_library: {
              name: "Château Pétrus",
              bottle_size_ml: 750,
            },
            restaurants: { default_pour_ml: 150, measurement_unit: "oz" },
          },
          error: null,
        });

      const result = await service.createInventoryItem("rest-1", {
        wineId: "mw-1",
        stockLive: 6,
        providerId: null,
        thresholdMin: 6,
        thresholdMax: 24,
      } as any);

      expect(result.wineName).toBe("Château Pétrus");
      expect(result.wine_name).toBe("Château Pétrus");
    });

    it("includes wine_name in the INSERT payload sent to Supabase", async () => {
      // Real call order:
      //  1. master_wine_library name lookup  → single()
      //  2. restaurant_inventory existing check → single() — PGRST116 = not found → proceed to INSERT
      //  3. INSERT .select().single() → inserted row
      mockSingle
        .mockResolvedValueOnce({
          data: { name: "Barolo Riserva" },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { code: "PGRST116", message: "not found" },
        })
        .mockResolvedValueOnce({
          data: {
            id: "inv-uuid-2",
            wine_name: "Barolo Riserva",
            master_wine_library: {
              name: "Barolo Riserva",
              bottle_size_ml: 750,
            },
            restaurants: { default_pour_ml: 150, measurement_unit: "oz" },
          },
          error: null,
        });

      await service.createInventoryItem("rest-1", {
        wineId: "mw-2",
        stockLive: 3,
        providerId: null,
        thresholdMin: 6,
        thresholdMax: 24,
      } as any);

      // Verify the insert call received an object containing wine_name
      const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
      expect(insertCall).toMatchObject({ wine_name: "Barolo Riserva" });
    });

    it("falls back to master_wine_library.name via mapInventoryItem when wine_name column is null", () => {
      // Access the private method via bracket notation for the unit test
      const row = {
        id: "inv-3",
        wine_name: null,
        master_wine_library: {
          name: "Pinot Noir Reserve",
          bottle_size_ml: 750,
        },
        restaurants: { default_pour_ml: 150 },
        bottle_size_ml: null,
        pour_size_ml: null,
        glasses_per_bottle_override: null,
      };
      const result = (service as any).mapInventoryItem(row);
      expect(result.wineName).toBe("Pinot Noir Reserve");
      expect(result.wine_name).toBe("Pinot Noir Reserve");
    });

    it("never returns wineName as undefined — returns null when no source available", () => {
      const row = {
        id: "inv-4",
        wine_name: null,
        master_wine_library: null,
        restaurants: null,
        bottle_size_ml: null,
        pour_size_ml: null,
        glasses_per_bottle_override: null,
      };
      const result = (service as any).mapInventoryItem(row);
      // Must be null, not undefined — undefined as an object key becomes the string "undefined"
      expect(result.wineName).toBeNull();
      expect(result.wine_name).toBeNull();
    });
  });
});
