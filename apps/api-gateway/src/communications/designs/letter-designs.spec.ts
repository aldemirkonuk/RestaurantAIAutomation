/**
 * ADR 0357 step 2: the designs service against an in-memory database, and
 * who may write. The block validator has its own spec.
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { LetterDesignsController } from "./letter-designs.controller";
import { LetterDesignsService } from "./letter-designs.service";

// --- a tiny in-memory stand-in for the supabase client ----------------------
type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    letter_designs: [],
    letter_design_versions: [],
    ...seed,
  };
  let n = 0;
  const client = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      let orderBy: { col: string; asc: boolean } | null = null;
      const run = () => {
        const rows = tables[table];
        if (op === "insert") {
          const dupe =
            table === "letter_design_versions" &&
            rows.some((r) => r.design_id === payload.design_id && r.version === payload.version);
          if (dupe) return { data: null, error: { code: "23505", message: "duplicate" } };
          const row = {
            id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
            published_version: null,
            look: "paper",
            archived_at: null,
            created_at: "t",
            updated_at: "t",
            ...payload,
          };
          rows.push(row);
          return { data: [row], error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          hit.forEach((r) => Object.assign(r, payload));
          return { data: hit, error: null };
        }
        const out = [...hit];
        if (orderBy) {
          const { col, asc } = orderBy;
          out.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1));
        }
        return { data: out, error: null };
      };
      const q: any = {
        select: () => q,
        insert: (p: Row) => ((op = "insert"), (payload = p), q),
        update: (p: Row) => ((op = "update"), (payload = p), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        order: (col: string, o: { ascending: boolean }) => ((orderBy = { col, asc: o.ascending }), q),
        maybeSingle: async () => {
          const r = run();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        single: async () => {
          const r = run();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  };
  return { client, tables };
}

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

describe("LetterDesignsService", () => {
  const make = (seed?: Record<string, Row[]>) => {
    const db = fakeDb(seed);
    return { svc: new LetterDesignsService({ client: db.client } as any), tables: db.tables };
  };

  it("creates with starter blocks, scoped to the house and naming the author", async () => {
    const { svc, tables } = make();
    const d: any = await svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: " Price check ", purpose: "price_query" } });
    expect(d.name).toBe("Price check");
    expect(tables.letter_designs[0]).toMatchObject({ restaurant_id: HOUSE, created_by: USER, updated_by: USER });
    expect(tables.letter_designs[0].blocks.length).toBe(2);
  });

  it("refuses a staff broadcast purpose and bad blocks before writing", async () => {
    const { svc, tables } = make();
    await expect(svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: "x", purpose: "staff_broadcast" } })).rejects.toThrow(/purposes/);
    await expect(
      svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: "x", purpose: "price_query", blocks: [{ id: "a", t: "nope", p: {} }] } }),
    ).rejects.toThrow(/cannot be saved/);
    expect(tables.letter_designs).toHaveLength(0);
  });

  it("will not read or change another house's design", async () => {
    const { svc } = make();
    const d: any = await svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: "x", purpose: "price_query" } });
    await expect(svc.get(OTHER, d.id)).rejects.toThrow(/No such letter design/);
    await expect(svc.update({ restaurantId: OTHER, userId: USER, id: d.id, dto: { name: "y" } })).rejects.toThrow(/No such letter design/);
    await expect(svc.archive({ restaurantId: OTHER, userId: USER, id: d.id })).rejects.toThrow(/No such letter design/);
  });

  it("publishes immutable, increasing versions and restores one into the draft only", async () => {
    const { svc, tables } = make();
    const d: any = await svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: "x", purpose: "price_query" } });
    const v1 = await svc.publish({ restaurantId: HOUSE, userId: USER, id: d.id });
    expect(v1.version).toBe(1);
    await svc.update({ restaurantId: HOUSE, userId: USER, id: d.id, dto: { blocks: [{ id: "z", t: "divider", p: { style: "dots" } }] } });
    const v2 = await svc.publish({ restaurantId: HOUSE, userId: USER, id: d.id });
    expect(v2.version).toBe(2);
    expect(tables.letter_design_versions.map((r) => r.version)).toEqual([1, 2]);
    const restored: any = await svc.restore({ restaurantId: HOUSE, userId: USER, id: d.id, version: 1 });
    expect(restored.blocks.length).toBe(2);
    expect(restored.published_version).toBe(2); // restoring does not publish
    await expect(svc.restore({ restaurantId: HOUSE, userId: USER, id: d.id, version: 9 })).rejects.toThrow(/no version 9/);
    const list: any = await svc.versions(HOUSE, d.id);
    expect(list.versions.map((v: Row) => v.version)).toEqual([2, 1]);
  });

  it("refuses to publish an empty design", async () => {
    const { svc } = make();
    const d: any = await svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: "x", purpose: "price_query", blocks: [] } });
    await expect(svc.publish({ restaurantId: HOUSE, userId: USER, id: d.id })).rejects.toThrow(/empty design/);
  });

  it("duplicates unpublished, and archiving hides the design but keeps its versions", async () => {
    const { svc, tables } = make();
    const d: any = await svc.create({ restaurantId: HOUSE, userId: USER, dto: { name: "x", purpose: "price_query" } });
    await svc.publish({ restaurantId: HOUSE, userId: USER, id: d.id });
    const copy: any = await svc.duplicate({ restaurantId: HOUSE, userId: USER, id: d.id });
    expect(copy.name).toBe("x (copy)");
    expect(copy.published_version).toBeNull();
    await svc.archive({ restaurantId: HOUSE, userId: USER, id: d.id });
    expect(((await svc.list(HOUSE)) as any).designs.map((r: Row) => r.id)).toEqual([copy.id]);
    expect(tables.letter_design_versions).toHaveLength(1);
  });

  it("refuses a write that names nobody", async () => {
    const { svc } = make();
    await expect(svc.create({ restaurantId: HOUSE, userId: "", dto: { name: "x", purpose: "price_query" } })).rejects.toThrow(/Missing user identity/);
  });
});

describe("LetterDesignsController roles", () => {
  const reflect = (name: keyof LetterDesignsController) =>
    Reflect.getMetadata(ROLES_KEY, LetterDesignsController.prototype[name]);

  it("marks every write owner/manager and leaves every read open to the house", () => {
    for (const w of ["create", "update", "publish", "restore", "duplicate", "remove"] as const) {
      expect(reflect(w)).toEqual(["owner", "manager"]);
    }
    for (const r of ["blocks", "list", "one", "versions"] as const) {
      expect(reflect(r)).toBeUndefined();
    }
  });

  describe("over HTTP", () => {
    let app: INestApplication;
    let base: string;
    const svc = { create: jest.fn().mockResolvedValue({ id: "d" }), list: jest.fn().mockResolvedValue({ designs: [] }) };

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        controllers: [LetterDesignsController],
        providers: [{ provide: LetterDesignsService, useValue: svc }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: any) => {
            const req = ctx.switchToHttp().getRequest();
            req.user = { userId: USER, restaurantId: HOUSE, role: req.headers["x-test-role"] };
            return true;
          },
        })
        .compile();
      app = mod.createNestApplication();
      await app.listen(0);
      base = await app.getUrl();
    });
    afterAll(() => app.close());

    const call = (method: string, role: string, body?: unknown) =>
      fetch(`${base}/communications/designs`, {
        method,
        headers: { "content-type": "application/json", "x-test-role": role },
        body: body ? JSON.stringify(body) : undefined,
      });

    it("lets staff read and refuses staff writing; a manager writes", async () => {
      expect((await call("GET", "staff")).status).toBe(200);
      const body = { name: "x", purpose: "price_query" };
      expect((await call("POST", "staff", body)).status).toBe(403);
      expect(svc.create).not.toHaveBeenCalled();
      expect((await call("POST", "manager", body)).status).toBe(201);
      expect(svc.create).toHaveBeenCalledTimes(1);
    });
  });
});
