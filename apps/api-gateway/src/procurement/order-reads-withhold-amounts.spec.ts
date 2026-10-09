import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";
import {
  OrderListResponseDto,
  OrderResponseDto,
  ProcurementOrderStatus,
} from "./dto/procurement.dto";

/**
 * F-433 (sim wave 10, 2026-10-09): staff on /dashboard received every order's
 * money from `GET /procurement/orders/pending` and `/orders/history`. The page
 * hid it; the payload carried it. The rule (DASH-W22, ADR 0145, ADR 0253):
 * staff see counts, names, states and dates, never amounts, and the server
 * stops sending them.
 *
 * Per route, one fixture read as staff and as a manager (and an owner): staff
 * get exactly the allowed keys plus `amountsWithheld: true`; a holder gets the
 * whole order and no marker.
 */

/** One order carrying every money key the DTO has. */
const ORDER: OrderResponseDto = {
  id: "o-1",
  orderNumber: "ORD-2026-00042",
  restaurantId: "r-1",
  inventoryId: "inv-1",
  providerId: "p-1",
  quantity: 2,
  unitType: "case",
  bottlesTotal: 24,
  quotedPrice: 180,
  negotiatedPrice: 170,
  finalPrice: 165,
  totalCost: 330,
  status: ProcurementOrderStatus.DELIVERED,
  requestedAt: "2026-10-01T10:00:00Z",
  deliveredAt: "2026-10-03T15:00:00Z",
  wineName: "Barolo Cannubi 2019",
  providerName: "Kavaklidere",
  currency: "USD",
  priceUom: "case",
  pricePackSize: 12,
  allowance: 10,
  deposit: 6,
  freight: 48,
};

const MONEY_KEYS = [
  "quotedPrice",
  "negotiatedPrice",
  "finalPrice",
  "totalCost",
  "priceUom",
  "pricePackSize",
  "allowance",
  "deposit",
  "freight",
];

/** What staff may read of ORDER, and nothing else. */
const STAFF_KEYS = [
  "id",
  "orderNumber",
  "restaurantId",
  "inventoryId",
  "providerId",
  "quantity",
  "unitType",
  "bottlesTotal",
  "status",
  "requestedAt",
  "deliveredAt",
  "wineName",
  "providerName",
  "currency",
].sort();

function controllerWith(): ProcurementController {
  const list: OrderListResponseDto = {
    orders: [{ ...ORDER }],
    total: 1,
    page: 1,
    limit: 20,
    hasMore: false,
  };
  const svc = {
    listPendingOrders: jest.fn().mockResolvedValue([{ ...ORDER }]),
    listOrders: jest.fn().mockResolvedValue(list),
    getOrder: jest.fn().mockResolvedValue({ ...ORDER }),
  } as unknown as ProcurementService;
  return new ProcurementController(svc);
}

const as = (role: string | null) => ({
  userId: "u-1",
  restaurantId: "r-1",
  role,
});

describe("GET /procurement/orders/pending — amounts by role (F-433)", () => {
  it.each(["staff", "STAFF", null, "sommelier"])(
    "%s reads no amount, and is told they are withheld",
    async (role) => {
      const [row] = await controllerWith().listPendingOrders(as(role));
      for (const key of MONEY_KEYS) expect(row).not.toHaveProperty(key);
      expect(row.amountsWithheld).toBe(true);
      const { amountsWithheld: _m, ...rest } = row;
      expect(Object.keys(rest).sort()).toEqual(STAFF_KEYS);
    },
  );

  it.each(["owner", "manager", "admin"])(
    "%s reads the whole order",
    async (role) => {
      const [row] = await controllerWith().listPendingOrders(as(role));
      expect(row).toEqual(ORDER);
      expect(row).not.toHaveProperty("amountsWithheld");
    },
  );
});

describe("GET /procurement/orders/history — amounts by role (F-433)", () => {
  it("staff read no amount; the page says they are withheld at the root", async () => {
    const res = await controllerWith().listOrderHistory({} as any, as("staff"));
    expect(res.amountsWithheld).toBe(true);
    expect(res.total).toBe(1);
    const [row] = res.orders;
    for (const key of MONEY_KEYS) expect(row).not.toHaveProperty(key);
    expect(row).not.toHaveProperty("amountsWithheld");
    expect(Object.keys(row).sort()).toEqual(STAFF_KEYS);
  });

  it.each(["owner", "manager"])("%s reads the whole page", async (role) => {
    const res = await controllerWith().listOrderHistory({} as any, as(role));
    expect(res).not.toHaveProperty("amountsWithheld");
    expect(res.orders[0]).toEqual(ORDER);
  });
});

/**
 * F-441 (wave 21 residual): the ledger and the single order still carried the
 * money. Same rule, same allowlist, one spec per route.
 */
describe("GET /procurement/orders — amounts by role (F-441)", () => {
  it.each(["staff", null])(
    "%s read the page without an amount, told at the root",
    async (role) => {
      const res = await controllerWith().listOrders({} as any, as(role));
      expect(res.amountsWithheld).toBe(true);
      expect(res.total).toBe(1);
      const [row] = res.orders;
      for (const key of MONEY_KEYS) expect(row).not.toHaveProperty(key);
      expect(Object.keys(row).sort()).toEqual(STAFF_KEYS);
    },
  );

  it.each(["owner", "manager"])("%s reads the whole page", async (role) => {
    const res = await controllerWith().listOrders({} as any, as(role));
    expect(res).not.toHaveProperty("amountsWithheld");
    expect(res.orders[0]).toEqual(ORDER);
  });
});

describe("GET /procurement/orders/:id — amounts by role (F-441)", () => {
  it.each(["staff", null])(
    "%s read the order without an amount, and are told",
    async (role) => {
      const row = await controllerWith().getOrder("o-1", as(role));
      for (const key of MONEY_KEYS) expect(row).not.toHaveProperty(key);
      expect(row.amountsWithheld).toBe(true);
      const { amountsWithheld: _m, ...rest } = row;
      expect(Object.keys(rest).sort()).toEqual(STAFF_KEYS);
    },
  );

  it.each(["owner", "manager"])("%s reads the whole order", async (role) => {
    const row = await controllerWith().getOrder("o-1", as(role));
    expect(row).toEqual(ORDER);
    expect(row).not.toHaveProperty("amountsWithheld");
  });
});
