import { ForbiddenException, HttpException } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * F-633 (2026-10-09). DELETE /inventory/:restaurantId/item/:itemId took any
 * role, ignored the zero-stock rule the remove dialog states, and wrote no
 * who or when. Removing a wine is now owner/manager only, refused while a
 * bottle is left, and filed as an `inventory_item_removed` audit row.
 */

function controller(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  const softDeleteItem = jest.fn(async () => ({ audited: true }));
  const c = new InventoryController(
    { softDeleteItem } as any,
    organizations,
    {} as any,
  );
  return { c, softDeleteItem };
}

describe("DELETE inventory item — who may remove a wine", () => {
  it.each(["owner", "manager"])(
    "a %s may remove, and the service is told who",
    async (role) => {
      const { c, softDeleteItem } = controller(role);
      await expect(
        c.deleteInventoryItem("rest-1", "inv-1", { userId: "u-1" }),
      ).resolves.toEqual({
        success: true,
        audited: true,
      });
      expect(softDeleteItem).toHaveBeenCalledWith("rest-1", "inv-1", "u-1");
    },
  );

  it.each(["staff", null])(
    "%s is refused and nothing is removed",
    async (role) => {
      const { c, softDeleteItem } = controller(role as string | null);
      await expect(
        c.deleteInventoryItem("rest-1", "inv-1", { userId: "u-1" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(softDeleteItem).not.toHaveBeenCalled();
    },
  );

  it("a session naming nobody cannot remove a wine", async () => {
    const { c, softDeleteItem } = controller("owner");
    await expect(
      c.deleteInventoryItem("rest-1", "inv-1", {}),
    ).rejects.toMatchObject({ status: 403 });
    expect(softDeleteItem).not.toHaveBeenCalled();
  });
});

/** A recording fake of the few query-builder calls softDeleteItem makes. */
function fakeDb(opts: {
  rows: any[];
  gone?: Array<{ id: string }>;
  auditError?: { message: string } | null;
}) {
  const calls: Array<{ table: string; op: string; args: any[] }> = [];
  const from = (table: string) => {
    let op = "select";
    let payload: any = null;
    const chain: any = {
      select: (..._a: any[]) => chain,
      update: (p: any) => ((op = "update"), (payload = p), chain),
      insert: (p: any) => {
        calls.push({ table, op: "insert", args: [p] });
        return Promise.resolve({ error: opts.auditError ?? null });
      },
      eq: (...a: any[]) => (
        calls.push({ table, op: `${op}.eq`, args: a }),
        chain
      ),
      in: (...a: any[]) => (
        calls.push({ table, op: `${op}.in`, args: a }),
        chain
      ),
      lte: (...a: any[]) => (
        calls.push({ table, op: `${op}.lte`, args: a }),
        chain
      ),
      or: (...a: any[]) => (
        calls.push({ table, op: `${op}.or`, args: a }),
        chain
      ),
      then: (res: any, rej: any) => {
        if (op === "update") {
          calls.push({ table, op: "update", args: [payload] });
          return Promise.resolve({
            data: opts.gone ?? opts.rows.map((r) => ({ id: r.id })),
            error: null,
          }).then(res, rej);
        }
        return Promise.resolve({ data: opts.rows, error: null }).then(res, rej);
      },
    };
    return chain;
  };
  return { client: { from }, calls };
}

function service(db: ReturnType<typeof fakeDb>) {
  return new InventoryService({ getClient: () => db.client } as any);
}

describe("softDeleteItem — the zero-stock rule and the record", () => {
  it("refuses in plain words while bottles are left, and writes nothing", async () => {
    const db = fakeDb({
      rows: [
        {
          id: "inv-1",
          wine_name: "Opus One 2018",
          stock_live: 3,
          shadow_stock: 0,
        },
      ],
    });
    const err = await service(db)
      .softDeleteItem("rest-1", "inv-1", "u-1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.message).toBe(
      "Opus One 2018 still has 3 bottles on the books. Count it down to zero with a reason first, so the bottles leave on the record. Nothing was removed.",
    );
    expect(db.calls.some((c) => c.op === "update" || c.op === "insert")).toBe(
      false,
    );
  });

  it("counts shadow bottles too", async () => {
    const db = fakeDb({
      rows: [
        {
          id: "inv-1",
          wine_name: null,
          master_wine_library: { name: "Barolo" },
          stock_live: 0,
          shadow_stock: 1,
        },
      ],
    });
    await expect(
      service(db).softDeleteItem("rest-1", "inv-1", "u-1"),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Barolo still has 1 bottle on the books",
      ),
    });
  });

  it("at zero, removes with the zero-stock filter on the write and files who did it", async () => {
    const db = fakeDb({
      rows: [
        {
          id: "inv-1",
          wine_name: "Opus One 2018",
          stock_live: 0,
          shadow_stock: null,
        },
      ],
    });
    await expect(
      service(db).softDeleteItem("rest-1", "inv-1", "u-1"),
    ).resolves.toEqual({ audited: true });
    expect(db.calls).toEqual(
      expect.arrayContaining([
        {
          table: "restaurant_inventory",
          op: "update",
          args: [{ is_active: false }],
        },
        {
          table: "restaurant_inventory",
          op: "update.lte",
          args: ["stock_live", 0],
        },
        {
          table: "restaurant_inventory",
          op: "update.or",
          args: ["shadow_stock.is.null,shadow_stock.lte.0"],
        },
        {
          table: "restaurant_inventory",
          op: "update.eq",
          args: ["restaurant_id", "rest-1"],
        },
      ]),
    );
    const audit = db.calls.find((c) => c.table === "system_audit_log");
    expect(audit?.args[0]).toMatchObject({
      actor_type: "user",
      actor_id: "u-1",
      action: "inventory_item_removed",
      entity_type: "inventory_item",
      entity_id: "inv-1",
      restaurant_id: "rest-1",
      changes: { subject: "Opus One 2018" },
    });
  });

  it("stock that lands between the read and the write refuses the removal", async () => {
    const db = fakeDb({
      rows: [
        {
          id: "inv-1",
          wine_name: "Opus One 2018",
          stock_live: 0,
          shadow_stock: 0,
        },
      ],
      gone: [],
    });
    await expect(
      service(db).softDeleteItem("rest-1", "inv-1", "u-1"),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Nothing was removed."),
    });
    expect(db.calls.some((c) => c.table === "system_audit_log")).toBe(false);
  });

  it("a failed audit write does not undo the removal, and says so", async () => {
    const db = fakeDb({
      rows: [
        {
          id: "inv-1",
          wine_name: "Opus One 2018",
          stock_live: 0,
          shadow_stock: 0,
        },
      ],
      auditError: { message: "boom" },
    });
    await expect(
      service(db).softDeleteItem("rest-1", "inv-1", "u-1"),
    ).resolves.toEqual({ audited: false });
  });
});
