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
