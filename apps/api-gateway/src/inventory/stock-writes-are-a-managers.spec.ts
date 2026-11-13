import { ForbiddenException } from "@nestjs/common";
import { InventoryController, STOCK_FIELDS } from "./inventory.controller";
import { PosHubController } from "../pos-hub/pos-hub.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Inventory r28, gaps 2 and 6. A write-off is an owner's or a manager's
 * (`inventory-ledger.controller.ts`, ADR 0315), but "Remove from inventory",
 * "Mark inactive", setting stock outright and changing what a till button
 * draws were open to any member of the house. Remove reconciles a good to zero
 * and then soft-deletes it, so it did what Write off refuses.
 *
 * The real OrganizationsService decides; only its access-row read is stubbed,
 * as in price-edits-are-role-gated.spec.ts. Counts, pours, transfers, par and
 * the till file import stay open to staff, and the cases below say so.
 */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

function inventory(role: string | null) {
  const service = {
    softDeleteItem: jest.fn(async () => undefined),
    updateInventoryItem: jest.fn(async () => ({ id: "inv-1" })),
    mapToastItem: jest.fn(async () => ({ ok: true })),
    bulkMapToastItems: jest.fn(async () => ({ ok: true })),
    unmapToastItem: jest.fn(async () => ({ ok: true })),
  };
  const c = new InventoryController(service as any, orgs(role), {} as any);
  return { c, service };
}

const me = { userId: "u-1" };

describe("removing a good is an owner's or a manager's", () => {
  it.each(["owner", "manager"])("a %s may remove a good", async (role) => {
    const { c, service } = inventory(role);
    await expect(c.deleteInventoryItem("rest-1", "inv-1", me)).resolves.toEqual({ success: true });
    expect(service.softDeleteItem).toHaveBeenCalledWith("rest-1", "inv-1");
  });

  it.each(["staff", null])("%s is refused, and nothing is removed", async (role) => {
    const { c, service } = inventory(role as string | null);
    await expect(c.deleteInventoryItem("rest-1", "inv-1", me)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.softDeleteItem).not.toHaveBeenCalled();
  });

  it("a session naming nobody cannot remove a good, whatever its role", async () => {
    const { c, service } = inventory("owner");
    await expect(c.deleteInventoryItem("rest-1", "inv-1", {})).rejects.toMatchObject({ status: 403 });
    await expect(c.deleteInventoryItem("rest-1", "inv-1")).rejects.toMatchObject({ status: 403 });
    expect(service.softDeleteItem).not.toHaveBeenCalled();
  });
});

describe("PATCH: stock, the list and what a sale draws are a manager's; par stays open", () => {
  const sample: Record<(typeof STOCK_FIELDS)[number], unknown> = {
    stockLive: 0,
    shadowStock: 0,
    isActive: false,
    toastItemGuid: "guid-1",
    saleType: "glass",
    pourSizeMl: 150,
    bottleSizeMl: 750,
    glassesPerBottleOverride: 5,
  };

  it("names exactly these eight fields", () => {
    expect([...STOCK_FIELDS].sort()).toEqual(Object.keys(sample).sort());
  });

  it.each(Object.entries(sample))("staff may not set %s, and nothing in the PATCH is written", async (field, value) => {
    const { c, service } = inventory("staff");
    await expect(
      c.updateInventoryItem("rest-1", "inv-1", { [field]: value, thresholdMin: 4 } as any, me),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updateInventoryItem).not.toHaveBeenCalled();
  });

  it.each(["owner", "manager"])("a %s may set them", async (role) => {
    const { c, service } = inventory(role);
    await c.updateInventoryItem("rest-1", "inv-1", { ...sample } as any, me);
    expect(service.updateInventoryItem).toHaveBeenCalledTimes(1);
  });

  it("staff may still change par, the supplier and the house's name for it", async () => {
    const { c, service } = inventory("staff");
    await c.updateInventoryItem(
      "rest-1",
      "inv-1",
      { thresholdMin: 4, thresholdMax: 12, providerId: "p-1", wineName: "House red" } as any,
      me,
    );
    expect(service.updateInventoryItem).toHaveBeenCalledTimes(1);
  });

  it("a session naming nobody cannot mark a good inactive", async () => {
    const { c, service } = inventory("owner");
    await expect(c.updateInventoryItem("rest-1", "inv-1", { isActive: false } as any, {})).rejects.toMatchObject({
      status: 403,
    });
    expect(service.updateInventoryItem).not.toHaveBeenCalled();
  });
});

describe("the Toast till map is a manager's", () => {
  it.each(["staff", null])("%s may not map, bulk-map or unmap", async (role) => {
    const { c, service } = inventory(role as string | null);
    await expect(c.mapToastItem("rest-1", {} as any, me)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.bulkMapToastItems("rest-1", {} as any, me)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.unmapToastItem("rest-1", "inv-1", me)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.mapToastItem).not.toHaveBeenCalled();
    expect(service.bulkMapToastItems).not.toHaveBeenCalled();
    expect(service.unmapToastItem).not.toHaveBeenCalled();
  });

  it("a manager may", async () => {
    const { c, service } = inventory("manager");
    await c.mapToastItem("rest-1", {} as any, me);
    await c.bulkMapToastItems("rest-1", {} as any, me);
    await c.unmapToastItem("rest-1", "inv-1", me);
    expect(service.mapToastItem).toHaveBeenCalledTimes(1);
    expect(service.bulkMapToastItems).toHaveBeenCalledTimes(1);
    expect(service.unmapToastItem).toHaveBeenCalledTimes(1);
  });
});

describe("a POS mapping write is a manager's", () => {
  function pos(role: string | null) {
    const posHub = { upsertItemMapping: jest.fn(async () => ({ ok: true })), ingest: jest.fn(async () => ({})) };
    const catalog = {
      pullAndMatch: jest.fn(async () => ({})),
      approveProposalsBatch: jest.fn(async () => ({})),
      approveProposal: jest.fn(async () => ({})),
      rejectProposal: jest.fn(async () => ({})),
    };
    const review = { setSaleUnit: jest.fn(async () => ({})), setSaleUnitBatch: jest.fn(async () => ({})) };
    const c = new PosHubController(posHub as any, catalog as any, review as any, orgs(role));
    const writes = (user?: { userId?: string }) => [
      () => c.upsertMapping("rest-1", { is_wine: true }, user),
      () => c.setSaleUnitBatch("rest-1", { items: [] } as any, user),
      () => c.setSaleUnit("rest-1", "map-1", { sale_unit: "glass" } as any, user),
      () => c.catalogMatch("rest-1", {}, user),
      () => c.approveProposals("rest-1", { items: [] } as any, user),
      () => c.approveProposal("rest-1", "prop-1", {} as any, user),
      () => c.rejectProposal("rest-1", "prop-1", user),
    ];
    const called = () =>
      [
        posHub.upsertItemMapping,
        review.setSaleUnitBatch,
        review.setSaleUnit,
        catalog.pullAndMatch,
        catalog.approveProposalsBatch,
        catalog.approveProposal,
        catalog.rejectProposal,
      ].map((f) => f.mock.calls.length);
    return { c, writes, called, posHub };
  }

  it.each(["staff", null])("%s is refused every one of the seven writes, and none reaches the service", async (role) => {
    const { writes, called } = pos(role as string | null);
    for (const w of writes(me)) await expect(w()).rejects.toBeInstanceOf(ForbiddenException);
    expect(called()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it.each(["owner", "manager"])("a %s may make each of them", async (role) => {
    const { writes, called } = pos(role);
    for (const w of writes(me)) await w();
    expect(called()).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("a session naming nobody is refused before the role is read", async () => {
    const { writes, called } = pos("owner");
    for (const w of writes({})) await expect(w()).rejects.toMatchObject({ status: 403 });
    expect(called()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("staff may still run the till file import", async () => {
    const { c, posHub } = pos("staff");
    await c.importChecks("rest-1", []);
    expect(posHub.ingest).toHaveBeenCalledTimes(1);
  });
});
