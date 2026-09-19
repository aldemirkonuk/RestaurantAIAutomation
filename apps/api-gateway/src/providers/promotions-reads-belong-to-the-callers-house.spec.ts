/**
 * Every vendor-promotion read under /providers, at the HTTP seam — the caller's
 * house (ADR 0147, ADR 0177).
 *
 * Before this, `GET /providers/promotions/active`, `/promotions/expiring`,
 * `/promotions/compare`, `/promotions/savings`, `GET /providers/:id/promotions`
 * and the promotion count inside `GET /providers/intelligence/compare` selected
 * `provider_promotions` with no `restaurant_id` clause. The gateway holds the
 * service-role key, so RLS does not apply: any signed-in account of any house
 * received every house's vendor offers, and the embedded `providers(id, name)`
 * carried the vendor names with them.
 *
 * The app below runs the real controller and the real ProviderIntelligenceService.
 * Only JwtAuthGuard is replaced by a stub that sets the request.user shape
 * JwtStrategy.validate returns (userId, restaurantId, role). The database is an
 * in-memory pair of tables that HONOURS every `.eq` / `.lte` / `.gt` / `.in` /
 * `.is` filter and resolves the `providers(...)` embed, so a read that drops its
 * house filter returns another house's rows here and the test sees them. Nothing
 * leaves this process.
 */
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { ProviderIntelligenceService } from "./provider-intelligence.service";

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROV_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const PROV_B = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";

const NAME_A = "Alpine Wine Merchants";
const NAME_B = "Borrowed Vintners Ltd";

type Row = Record<string, any>;

let tables: Record<string, Row[]> = {};
/** Every table the fake database was asked about. */
let touched: string[] = [];

const isoDaysOut = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().split("T")[0];

function seed() {
  touched = [];
  tables = {
    providers: [
      {
        id: PROV_A,
        restaurant_id: HOUSE_A,
        name: NAME_A,
        is_active: true,
        deleted_at: null,
        reliability_score: 4.5,
        tier: "gold",
        minimum_order: 100,
        lead_time_days: 2,
      },
      {
        id: PROV_B,
        restaurant_id: HOUSE_B,
        name: NAME_B,
        is_active: true,
        deleted_at: null,
        reliability_score: 3.1,
        tier: "silver",
        minimum_order: 900,
        lead_time_days: 9,
      },
    ],
    provider_promotions: [
      {
        id: "promo-a1",
        provider_id: PROV_A,
        restaurant_id: HOUSE_A,
        name: "A case discount",
        promo_type: "volume_discount",
        is_active: true,
        end_date: isoDaysOut(3),
        savings_realized: 100,
        status: "active",
      },
      {
        id: "promo-a2",
        provider_id: PROV_A,
        restaurant_id: HOUSE_A,
        name: "A closed offer",
        promo_type: "seasonal",
        is_active: false,
        end_date: isoDaysOut(2),
        savings_realized: 0,
        status: "expired",
      },
      {
        id: "promo-b1",
        provider_id: PROV_B,
        restaurant_id: HOUSE_B,
        name: "B secret bundle",
        promo_type: "bundle",
        is_active: true,
        end_date: isoDaysOut(2),
        savings_realized: 900,
        status: "active",
      },
      {
        id: "promo-b2",
        provider_id: PROV_B,
        restaurant_id: HOUSE_B,
        name: "B loyalty perk",
        promo_type: "volume_discount",
        is_active: true,
        end_date: isoDaysOut(40),
        savings_realized: 50,
        status: "active",
      },
    ],
    provider_sentiment_history: [],
    provider_knowledge: [],
  };
}

/** A chainable query over `tables`; every filter is real, not recorded-and-ignored. */
function makeBuilder(table: string) {
  touched.push(table);
  let embed = false;
  const preds: Array<(r: Row) => boolean> = [];
  const run = () => {
    let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
    if (embed) {
      rows = rows.map((r) => {
        const p = tables.providers.find((x) => x.id === r.provider_id);
        return {
          ...r,
          providers: p ? { id: p.id, name: p.name } : null,
        };
      });
    }
    return { data: rows, error: null };
  };
  const b: any = {
    select: (cols: string) => {
      embed = /providers\(/.test(cols);
      return b;
    },
    order: () => b,
    limit: () => b,
    not: () => b,
    eq: (col: string, val: unknown) => {
      preds.push((r) => r[col] === val);
      return b;
    },
    is: (col: string, val: unknown) => {
      preds.push((r) => (r[col] ?? null) === val);
      return b;
    },
    in: (col: string, vals: unknown[]) => {
      preds.push((r) => vals.includes(r[col]));
      return b;
    },
    lte: (col: string, val: string) => {
      preds.push((r) => r[col] <= val);
      return b;
    },
    gt: (col: string, val: number) => {
      preds.push((r) => r[col] > val);
      return b;
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return b;
}

const db = { supabase: { from: jest.fn((t: string) => makeBuilder(t)) } };

let app: INestApplication;
let base: string;

async function get(
  path: string,
  as: { house?: string | null },
): Promise<{ status: number; body: any; text: string }> {
  const headers: Record<string, string> = {};
  if (as.house !== null) headers["x-test-house"] = as.house ?? HOUSE_A;
  const res = await fetch(`${base}/providers${path}`, { headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body, text };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProviderIntelligenceController],
    providers: [
      ProviderIntelligenceService,
      { provide: DatabaseService, useValue: db },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: "user-1",
          restaurantId: req.headers["x-test-house"],
          role: "manager",
        };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

/** What only the other house may see. */
const FOREIGN = {
  a: { name: NAME_A, promoIds: ["promo-a1", "promo-a2"], provider: PROV_A },
  b: {
    name: NAME_B,
    promoIds: ["promo-b1", "promo-b2"],
    provider: PROV_B,
  },
};

function expectNothingOf(
  who: "a" | "b",
  res: { text: string },
  ownerHouse: string,
) {
  // The whole serialised answer, not one field: a leak through the embedded
  // provider, a promo name or a bare id all fail here.
  const f = FOREIGN[who];
  expect(res.text).not.toContain(f.name);
  expect(res.text).not.toContain(f.provider);
  expect(res.text).not.toContain(ownerHouse);
  for (const id of f.promoIds) expect(res.text).not.toContain(id);
}

const ROUTES: Array<{
  label: string;
  path: (own: string) => string;
  /** The promo ids house A's caller is entitled to see on this route. */
  ownA: string[];
  ownB: string[];
  ids: (body: any) => string[];
}> = [
  {
    label: "GET promotions/active",
    path: () => "/promotions/active",
    ownA: ["promo-a1"],
    ownB: ["promo-b1", "promo-b2"],
    ids: (b) => b.map((r: Row) => r.id),
  },
  {
    label: "GET promotions/expiring",
    path: () => "/promotions/expiring?days=3650",
    ownA: ["promo-a1"],
    ownB: ["promo-b1", "promo-b2"],
    ids: (b) => b.map((r: Row) => r.id),
  },
  {
    label: "GET promotions/compare",
    path: () => "/promotions/compare",
    ownA: ["promo-a1"],
    ownB: ["promo-b1", "promo-b2"],
    ids: (b) =>
      Object.values(b).flatMap((rows: any) => rows.map((r: Row) => r.id)),
  },
  {
    label: "GET :id/promotions (own provider)",
    path: (own) => `/${own === HOUSE_A ? PROV_A : PROV_B}/promotions`,
    ownA: ["promo-a1", "promo-a2"],
    ownB: ["promo-b1", "promo-b2"],
    ids: (b) => b.map((r: Row) => r.id),
  },
];

describe.each(ROUTES)("$label answers only for the caller's house", (route) => {
  it("house A sees its own offers and nothing of house B", async () => {
    const res = await get(route.path(HOUSE_A), { house: HOUSE_A });
    expect(res.status).toBe(200);
    expect(route.ids(res.body).sort()).toEqual([...route.ownA].sort());
    expectNothingOf("b", res, HOUSE_B);
  });

  it("house B sees its own offers and nothing of house A", async () => {
    const res = await get(route.path(HOUSE_B), { house: HOUSE_B });
    expect(res.status).toBe(200);
    expect(route.ids(res.body).sort()).toEqual([...route.ownB].sort());
    expectNothingOf("a", res, HOUSE_A);
  });

  it("a session that names no house is a 403 and reads no promotions", async () => {
    const res = await get(route.path(HOUSE_A), { house: null });
    expect(res.status).toBe(403);
    expect(touched).not.toContain("provider_promotions");
  });
});

describe("GET :id/promotions with another house's provider id", () => {
  it("answers an empty list, never the other house's offers", async () => {
    const res = await get(`/${PROV_B}/promotions`, { house: HOUSE_A });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expectNothingOf("b", res, HOUSE_B);
  });

  it("still honours the status filter inside the house", async () => {
    const res = await get(`/${PROV_A}/promotions?status=expired`, {
      house: HOUSE_A,
    });
    expect(res.status).toBe(200);
    expect(res.body.map((r: Row) => r.id)).toEqual(["promo-a2"]);
  });
});

describe("GET promotions/savings", () => {
  it("totals only the caller's house", async () => {
    const a = await get("/promotions/savings", { house: HOUSE_A });
    expect(a.status).toBe(200);
    expect(a.body.totalSavings).toBe(100);
    expect(a.body.byProvider).toHaveLength(1);
    expectNothingOf("b", a, HOUSE_B);

    const b = await get("/promotions/savings", { house: HOUSE_B });
    expect(b.body.totalSavings).toBe(950);
    expectNothingOf("a", b, HOUSE_A);
  });

  it("a session that names no house is a 403", async () => {
    const res = await get("/promotions/savings", { house: null });
    expect(res.status).toBe(403);
    expect(touched).not.toContain("provider_promotions");
  });
});

describe("GET intelligence/compare", () => {
  it("lists and counts only the caller's house's vendors", async () => {
    const a = await get("/intelligence/compare", { house: HOUSE_A });
    expect(a.status).toBe(200);
    expect(a.body.map((r: Row) => r.id)).toEqual([PROV_A]);
    expect(a.body[0].activePromoCount).toBe(1);
    expectNothingOf("b", a, HOUSE_B);
  });

  it("counts a vendor's offers by the caller's house too, not only by the vendor id", async () => {
    // Each read scopes on its own. Here house B's offer is filed against house
    // A's vendor id (a mis-attributed row): the vendor list is already house A's,
    // so only the count's own restaurant_id filter keeps this row out of it.
    tables.provider_promotions.push({
      id: "promo-b-on-a",
      provider_id: PROV_A,
      restaurant_id: HOUSE_B,
      name: "B offer filed on A's vendor",
      promo_type: "bundle",
      is_active: true,
      end_date: isoDaysOut(5),
    });
    const res = await get("/intelligence/compare", { house: HOUSE_A });
    expect(res.status).toBe(200);
    expect(res.body[0].activePromoCount).toBe(1);
  });

  it("does not let a foreign provider id pull that vendor into the answer", async () => {
    const res = await get(`/intelligence/compare?providerIds=${PROV_B}`, {
      house: HOUSE_A,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expectNothingOf("b", res, HOUSE_B);
  });

  it("a session that names no house is a 403", async () => {
    const res = await get("/intelligence/compare", { house: null });
    expect(res.status).toBe(403);
    expect(touched).not.toContain("provider_promotions");
    expect(touched).not.toContain("providers");
  });
});

describe("the service refuses to run without a house", () => {
  let service: ProviderIntelligenceService;
  beforeEach(() => {
    service = new ProviderIntelligenceService(db as any);
  });

  // The house is the FIRST argument of every method. Each call passes an
  // explicit `undefined` there so that no other argument can stand in for it.
  it.each([
    [
      "getAllActivePromotions",
      () => (service as any).getAllActivePromotions(undefined),
    ],
    [
      "getExpiringPromotions",
      () => (service as any).getExpiringPromotions(undefined, 7),
    ],
    ["getPromoSavings", () => (service as any).getPromoSavings(undefined)],
    ["comparePromotions", () => (service as any).comparePromotions(undefined)],
    ["getPromotions", () => (service as any).getPromotions(undefined, PROV_A)],
    ["compareProviders", () => (service as any).compareProviders(undefined)],
  ])(
    "%s throws and issues no query when no house is passed",
    async (_n, fn) => {
      await expect(fn()).rejects.toThrow(/restaurantId/);
      expect(db.supabase.from).not.toHaveBeenCalled();
    },
  );
});
