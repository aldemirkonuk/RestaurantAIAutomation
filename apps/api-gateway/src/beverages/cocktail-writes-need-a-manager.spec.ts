/**
 * Changing the house's cocktail list is an owner's or a manager's (r34 walk w1
 * F13, 2026-11-13).
 *
 * WHY THIS EXISTS
 * ---------------
 * On c459b0a12 the four cocktail writes on BeveragesController — record
 * (`POST /cocktails/:rid`), amend (`PATCH /cocktails/:rid/:id`), retire
 * (`DELETE /cocktails/:rid/:id`) and replace the recipe
 * (`PUT /cocktails/:rid/:id/ingredients`) — carried only the class-level
 * `JwtAuthGuard`. A staff member of the house could put a drink on the list,
 * reprice it or take it off; the walker created one as staff and got 201.
 *
 * Everything on the request path is real except the service: the controller
 * and its decorators, `JwtAuthGuard` (tenant match, email and house checks),
 * passport verifying a signed token, `JwtStrategy`, and
 * `AuthService.validateJwtPayload` reading the caller's access row from the
 * stub database. `BeveragesService` is a recorder, so "the write did not
 * happen" means the service was never called.
 *
 * Tests marked [REVERT-FAILS] fail against c459b0a12's controller.
 */
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { AddressInfo } from "net";
import { AuthService } from "../auth/auth.service";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";
import { BeveragesController } from "./beverages.controller";
import { BeveragesService } from "./beverages.service";

const SECRET = "test-secret-for-cocktail-writes-need-a-manager";
const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COCKTAIL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PEOPLE = {
  staff: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  owner: "33333333-3333-4333-8333-333333333333",
  // An active access row naming no role, held by someone whose account-wide
  // `users.role` says manager: the house role decides, and there is none.
  unroled: "55555555-5555-4555-8555-555555555555",
  // An owner, but of house B: the tenant match refuses them at house A.
  ownerOfB: "66666666-6666-4666-8666-666666666666",
} as const;
type Who = keyof typeof PEOPLE;
const HOUSE_OF: Record<Who, string> = {
  staff: HOUSE_A,
  manager: HOUSE_A,
  owner: HOUSE_A,
  unroled: HOUSE_A,
  ownerOfB: HOUSE_B,
};
const ROLE_OF: Record<Who, string | null> = {
  staff: "staff",
  manager: "manager",
  owner: "owner",
  unroled: null,
  ownerOfB: "owner",
};

function world(): StubDb {
  return makeStubDb({
    users: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      email: `${who}@house.test`,
      name: who,
      role: who === "unroled" ? "manager" : ROLE_OF[who],
      restaurant_id: HOUSE_OF[who],
      email_verified: true,
    })),
    user_restaurant_access: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      restaurant_id: HOUSE_OF[who],
      role: ROLE_OF[who],
      is_active: true,
    })),
  });
}

/** What the service was asked to do, in order. */
const calls: Array<[string, ...unknown[]]> = [];
const service = {
  createCocktail: async (...a: unknown[]) => {
    calls.push(["createCocktail", ...a]);
    return { id: COCKTAIL, name: "Negroni" };
  },
  updateCocktail: async (...a: unknown[]) => {
    calls.push(["updateCocktail", ...a]);
    return { id: COCKTAIL, name: "Negroni" };
  },
  deleteCocktail: async (...a: unknown[]) => {
    calls.push(["deleteCocktail", ...a]);
    return { id: COCKTAIL, retired: true };
  },
  setCocktailIngredients: async (...a: unknown[]) => {
    calls.push(["setCocktailIngredients", ...a]);
    return { cocktailId: COCKTAIL, lines: 1 };
  },
  listCocktails: async (...a: unknown[]) => {
    calls.push(["listCocktails", ...a]);
    return { rows: [], count: 0 };
  },
  readCocktailIngredients: async (...a: unknown[]) => {
    calls.push(["readCocktailIngredients", ...a]);
    return { cocktailId: COCKTAIL, rows: [], count: 0 };
  },
};

let db: StubDb;
let app: INestApplication;
let base: string;
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (who: Who) =>
  jwt.sign({
    sub: PEOPLE[who],
    email: `${who}@house.test`,
    role: ROLE_OF[who] ?? "staff",
    restaurantId: HOUSE_OF[who],
  });
const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  db = world();
  const auth = new AuthService(
    new JwtService({}),
    { get: (k: string) => (k === "JWT_SECRET" ? SECRET : undefined) } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => undefined } as any,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
    controllers: [BeveragesController],
    providers: [
      JwtAuthGuard,
      JwtStrategy,
      { provide: AuthService, useValue: auth },
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
      { provide: BeveragesService, useValue: service },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  process.env.JWT_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  calls.length = 0;
});

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** [label, method, path, body, the service method it reaches, success status] */
const WRITES: Array<[string, string, string, unknown, string, number]> = [
  [
    "record a cocktail (POST)",
    "POST",
    `/cocktails/${HOUSE_A}`,
    { name: "Staff Test Spritz", price: 12 },
    "createCocktail",
    201,
  ],
  [
    "amend a cocktail (PATCH)",
    "PATCH",
    `/cocktails/${HOUSE_A}/${COCKTAIL}`,
    { price: 1 },
    "updateCocktail",
    200,
  ],
  [
    "take a cocktail off the list (DELETE)",
    "DELETE",
    `/cocktails/${HOUSE_A}/${COCKTAIL}`,
    undefined,
    "deleteCocktail",
    200,
  ],
  [
    "replace its recipe (PUT ingredients)",
    "PUT",
    `/cocktails/${HOUSE_A}/${COCKTAIL}/ingredients`,
    { lines: [{ freeText: "gin", quantity: 30, unit: "ml", sortOrder: 0 }] },
    "setCocktailIngredients",
    200,
  ],
];

describe("a staff member of the house may not change its cocktail list", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] staff: %s answers 403 and nothing is written",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("staff"), body);
      expect(res.status).toBe(403);
      // RolesGuard's own refusal, before the handler runs.
      expect(res.body?.message).toBe("Forbidden resource");
      expect(calls).toEqual([]);
    },
  );
});

describe("an access row naming no role is not a manager, whatever users.role says", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] no role in the house: %s answers 403",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("unroled"), body);
      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    },
  );
});

describe("an owner or a manager of the house may", () => {
  it.each(
    WRITES.flatMap((w) => [
      ["manager", ...w] as const,
      ["owner", ...w] as const,
    ]),
  )(
    "%s: %s reaches the service and answers 2xx",
    async (who, _label, method, path, body, reached, ok) => {
      const res = await call(method, path, tokenFor(who as Who), body);
      expect(res.status).toBe(ok);
      expect(calls.map((c) => c[0])).toEqual([reached]);
      expect(calls[0][1]).toBe(HOUSE_A);
    },
  );
});

describe("another house's owner is still refused at the door", () => {
  it.each(WRITES)(
    "owner of house B: %s answers 403 and nothing is written",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("ownerOfB"), body);
      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    },
  );
});

describe("the reads stay open to the whole house", () => {
  it("staff can still read the list and a recipe", async () => {
    const list = await call("GET", `/cocktails/${HOUSE_A}`, tokenFor("staff"));
    expect(list.status).toBe(200);
    const recipe = await call(
      "GET",
      `/cocktails/${HOUSE_A}/${COCKTAIL}/ingredients`,
      tokenFor("staff"),
    );
    expect(recipe.status).toBe(200);
    expect(calls.map((c) => c[0])).toEqual([
      "listCocktails",
      "readCocktailIngredients",
    ]);
  });

  it("no token is refused before any role is asked", async () => {
    const res = await call("POST", `/cocktails/${HOUSE_A}`, null, {
      name: "x",
    });
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
