/**
 * Who may save a recipe (ADR 0360, F13): owner or manager. Staff read without
 * money. A real Nest pipeline with the real RolesGuard; only JwtAuthGuard is a
 * stub that sets the role from a header, as in receiving-credits-roles.spec.ts.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RecipesController } from "./recipes.controller";
import { RecipesService } from "./recipes.service";

const HOUSE = "8f2b6a52-7c1e-4d0b-9a8e-2b9d7c1e4a10";
const DRINK = "1c0ffee0-0000-4000-8000-000000000001";
const body = { expectedVersionId: null, yieldServes: 1, lines: [{ role: "untracked", label: "Ice", qty: 1, unit: "each" }] };

describe("recipes: owner or manager saves, staff reads", () => {
  let app: INestApplication;
  let base: string;
  const saves: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RecipesController],
      providers: [
        {
          provide: RecipesService,
          useValue: {
            saveRecipe: async (_r: string, _c: string, author: string) => (saves.push(author), { versionId: "v1", version: 1, lines: [] }),
            getRecipe: async () => ({ ok: true }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: `user-${role}`, restaurantId: HOUSE, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const put = (role: string) =>
    fetch(`${base}/recipes/${HOUSE}/cocktails/${DRINK}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(body),
    });

  it("refuses staff a save with 403 and never reaches the service", async () => {
    saves.length = 0;
    expect((await put("staff")).status).toBe(403);
    expect(saves).toEqual([]);
  });

  it.each(["owner", "manager"])("lets %s save, as the author", async (role) => {
    const res = await put(role);
    expect(res.status).toBe(200);
    expect(saves).toContain(`user-${role}`);
  });

  it("lets staff read", async () => {
    const res = await fetch(`${base}/recipes/${HOUSE}/cocktails/${DRINK}`, { headers: { "x-test-role": "staff" } });
    expect(res.status).toBe(200);
  });
});

describe("recipes: only an owner or manager may price a draft", () => {
  let app: INestApplication;
  let base: string;
  const previews: string[] = [];
  const draft = { yieldServes: 1, lines: [{ role: "stocked", inventoryId: DRINK, qtyEntered: 50, unitCode: "ml" }] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RecipesController],
      providers: [{ provide: RecipesService, useValue: { previewCost: async () => (previews.push("asked"), { perServe: 2 }) } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = { userId: `user-${role}`, restaurantId: HOUSE, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const post = (role: string, payload: unknown = draft, drink = DRINK) =>
    fetch(`${base}/recipes/${HOUSE}/cocktails/${drink}/cost-preview`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(payload),
    });

  it("refuses staff with 403 and never reaches the service", async () => {
    previews.length = 0;
    expect((await post("staff")).status).toBe(403);
    expect(previews).toEqual([]);
  });

  it.each(["owner", "manager"])("lets %s price a draft", async (role) => {
    expect((await post(role)).status).toBe(201);
  });

  it("refuses a malformed draft before the service: a unit outside the list, too many lines, a drink id that is not a uuid", async () => {
    previews.length = 0;
    expect((await post("owner", { ...draft, lines: [{ ...draft.lines[0], unitCode: "pint" }] })).status).toBe(400);
    expect((await post("owner", { yieldServes: 1, lines: Array(61).fill(draft.lines[0]) })).status).toBe(400);
    expect((await post("owner", { ...draft, yieldServes: 0 })).status).toBe(400);
    expect((await post("owner", draft, "not-a-uuid")).status).toBe(400);
    expect(previews).toEqual([]);
  });
});
