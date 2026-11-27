import { Test } from "@nestjs/testing";
import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";
import { PhotoCountService } from "./photo-count.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";

// r104 / ADR 0372: the stock.manual_override event carries the row's own par,
// and null when the old row could not be read -- never an invented 6.
describe("updateInventoryItem -- stock.manual_override threshold_min", () => {
  const single = jest.fn();
  const maybeSingle = jest.fn();
  const chain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single,
    maybeSingle,
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  const publishEvent = jest.fn().mockResolvedValue(undefined);
  let service: InventoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    single.mockReset();
    maybeSingle.mockReset();
    chain.rpc.mockResolvedValue({ data: null, error: null });
    for (const k of ["from", "select", "update", "eq"]) chain[k].mockReturnThis();
    maybeSingle.mockResolvedValue({ data: { id: "inv-1" }, error: null });
    const mod = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DatabaseService, useValue: { getClient: () => chain, supabase: chain } },
        { provide: PhotoCountService, useValue: { estimate: jest.fn() } },
        { provide: OrchestratorService, useValue: { publishEvent } },
      ],
    }).compile();
    service = mod.get(InventoryService);
  });

  const payload = () => publishEvent.mock.calls[0][2];

  it("sends null, not 6, when the old row was not read", async () => {
    single
      .mockResolvedValueOnce({ data: null, error: { message: "read failed" } })
      .mockResolvedValueOnce({ data: { id: "inv-1", master_wine_id: null }, error: null });
    await service.updateInventoryItem("rest-1", "inv-1", { stockLive: 4 } as any, "u1");
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(payload().threshold_min).toBeNull();
    // The old counts are unknown too; 0 would claim the shelf was empty.
    expect(payload().old_stock_live).toBeNull();
    expect(payload().old_shadow_stock).toBeNull();
  });

  it("sends the row's own par, a typed 0 included", async () => {
    single
      .mockResolvedValueOnce({ data: { stock_live: 2, shadow_stock: 0, threshold_min: 0, master_wine_id: null }, error: null })
      .mockResolvedValueOnce({ data: { id: "inv-1", master_wine_id: null }, error: null });
    await service.updateInventoryItem("rest-1", "inv-1", { stockLive: 4 } as any, "u1");
    expect(payload().threshold_min).toBe(0);
  });
});
