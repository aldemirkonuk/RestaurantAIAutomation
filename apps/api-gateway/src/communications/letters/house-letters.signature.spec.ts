/**
 * A signature per sending address (r110 mail-gap g3).
 *
 * Stored in communication_templates as type 'mail_signature', name = the
 * lower-cased address, body at most 600 characters. Owner or manager only;
 * an address this house does not send from is a 404. One row per house and
 * address, even when two saves race (the partial unique index answers 23505
 * to the loser, which then updates the winner's row).
 */

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { HouseLettersController } from "./house-letters.controller";
import { HouseLettersService, MAIL_SIGNATURE_TYPE } from "./house-letters.service";
import { HouseSenderService } from "./house-sender.service";
import { HouseLettersCron } from "./house-letters.cron";
import { HouseInboxCron } from "../inbox/house-inbox.cron";
import { HouseInboxService } from "../inbox/house-inbox.service";
import { fakeDb, grants, HOUSE, OTHER, ME } from "../mail-setup/fake-db.testing";

type Row = Record<string, any>;

/** communication_templates with the migration's partial unique index. */
function templates(rows: Row[]) {
  let n = 0;
  const from = () => {
    const q: { op: string; payload?: any; f: Array<[string, any]> } = { op: "select", f: [] };
    const hit = (r: Row) => q.f.every(([k, v]) => String(r[k]) === String(v));
    const run = () => {
      if (q.op === "insert") {
        const p = q.payload;
        const clash = rows.some(
          (r) => r.type === MAIL_SIGNATURE_TYPE && p.type === MAIL_SIGNATURE_TYPE &&
            r.restaurant_id === p.restaurant_id && String(r.name).toLowerCase() === String(p.name).toLowerCase(),
        );
        if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows.push({ id: `t${++n}`, ...p });
        return { data: null, error: null };
      }
      if (q.op === "update") {
        rows.filter(hit).forEach((r) => Object.assign(r, q.payload));
        return { data: null, error: null };
      }
      if (q.op === "delete") {
        for (let i = rows.length - 1; i >= 0; i--) if (hit(rows[i])) rows.splice(i, 1);
        return { data: null, error: null };
      }
      return { data: rows.filter(hit)[0] ?? null, error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: any) => (q.f.push([k, v]), chain),
      maybeSingle: () => Promise.resolve(run()),
      insert: (p: any) => ((q.op = "insert"), (q.payload = p), Promise.resolve(run())),
      update: (p: any) => ((q.op = "update"), (q.payload = p), chain),
      delete: () => ((q.op = "delete"), chain),
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return chain;
  };
  return from;
}

function world(rows: Row[] = []) {
  const base = fakeDb({ integration_oauth_connections: { rows: grants() } });
  const tpl = templates(rows);
  const from = (t: string) => (t === "communication_templates" ? tpl() : base.client.from(t));
  const db = { client: { from }, supabase: { from } } as any;
  const sender = new HouseSenderService(db, { get: () => undefined } as any);
  const gates = [{}, {}] as [any, any];
  const svc = new HouseLettersService(db, sender, {} as any, ...gates);
  return { svc, sender, rows };
}

describe("HouseSenderService.sendsFrom", () => {
  it("names this house's live send grants, lower case, and nothing of another house's or a revoked one", async () => {
    const { sender } = world();
    const got = await sender.sendsFrom(HOUSE, ME);
    expect(got.has("me@house.test")).toBe(true);
    expect(got.has("office@house.test")).toBe(true);
    expect(got.has("files@house.test")).toBe(false); // no send scope
    expect(got.has("them@other.test")).toBe(false); // another house
    expect(got.has("old@house.test")).toBe(false); // revoked
  });

  it("throws when the grants cannot be read, rather than answering 'not ours'", async () => {
    const db = fakeDb({ integration_oauth_connections: { error: { message: "down" } } });
    const sender = new HouseSenderService(db as any, { get: () => undefined } as any);
    await expect(sender.sendsFrom(HOUSE, ME)).rejects.toThrow(/could not be read/);
  });
});

describe("HouseLettersService signature", () => {
  it("saves under the lower-cased address and reads it back", async () => {
    const { svc, rows } = world();
    const out = await svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "Me@House.TEST", body: "Ayşe\nKitchenette" });
    expect(out).toMatchObject({ address: "me@house.test", body: "Ayşe\nKitchenette", saved: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ restaurant_id: HOUSE, type: MAIL_SIGNATURE_TYPE, name: "me@house.test", updated_by: ME });
    expect(await svc.signature(HOUSE, ME, "ME@house.test")).toMatchObject({ address: "me@house.test", body: "Ayşe\nKitchenette" });
  });

  it("a second save of the same address updates the one row", async () => {
    const { svc, rows } = world();
    await svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "one" });
    const out = await svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "ME@HOUSE.TEST", body: "two" });
    expect(rows).toHaveLength(1);
    expect(out.body).toBe("two");
  });

  it("two saves racing still leave one row: the loser updates the winner", async () => {
    const { svc, rows } = world();
    await Promise.all([
      svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "first" }),
      svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "second" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("second");
  });

  it("an address this house does not send from is a 404, and nothing is written", async () => {
    const { svc, rows } = world();
    await expect(svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "them@other.test", body: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(svc.signature(HOUSE, ME, "files@house.test")).rejects.toMatchObject({ status: 404 });
    expect(rows).toHaveLength(0);
  });

  it("another house's signature for the same address is never read", async () => {
    const { svc } = world([{ id: "x", restaurant_id: OTHER, type: MAIL_SIGNATURE_TYPE, name: "me@house.test", body: "theirs" }]);
    expect((await svc.signature(HOUSE, ME, "me@house.test")).body).toBeNull();
  });

  it("refuses more than 600 characters and writes nothing; exactly 600 is kept", async () => {
    const { svc, rows } = world();
    await expect(svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "a".repeat(601) })).rejects.toMatchObject({ status: 400 });
    expect(rows).toHaveLength(0);
    const out = await svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "a".repeat(600) });
    expect(out.body).toHaveLength(600);
  });

  it("an empty body clears the signature", async () => {
    const { svc, rows } = world();
    await svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "one" });
    const out = await svc.saveSignature({ restaurantId: HOUSE, userId: ME, address: "me@house.test", body: "  \n" });
    expect(out.body).toBeNull();
    expect(rows).toHaveLength(0);
  });
});

describe("GET/PUT /communications/letters/signature over HTTP", () => {
  let app: INestApplication;
  let base: string;
  let rows: Row[];

  beforeAll(async () => {
    const w = world();
    rows = w.rows;
    const moduleRef = await Test.createTestingModule({
      controllers: [HouseLettersController],
      providers: [
        { provide: HouseLettersService, useValue: w.svc },
        { provide: HouseSenderService, useValue: w.sender },
        { provide: HouseLettersCron, useValue: { lastRun: () => null } },
        { provide: HouseInboxCron, useValue: { lastRun: () => null } },
        { provide: HouseInboxService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { userId: ME, restaurantId: HOUSE, role: req.headers["x-test-role"] ?? null };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(async () => app.close());

  const put = (role: string, body: unknown) =>
    fetch(`${base}/communications/letters/signature`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-role": role },
      body: JSON.stringify(body),
    });
  const get = (role: string, address: string) =>
    fetch(`${base}/communications/letters/signature?address=${encodeURIComponent(address)}`, { headers: { "x-test-role": role } });

  it.each(["staff", "admin"])("refuses %s with 403 on both, and writes nothing", async (role) => {
    expect((await put(role, { address: "me@house.test", body: "x" })).status).toBe(403);
    expect((await get(role, "me@house.test")).status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it.each(["owner", "manager"])("lets a %s save and read back", async (role) => {
    const res = await put(role, { address: "office@house.test", body: `by ${role}` });
    expect(res.status).toBe(200);
    const back = await (await get(role, "office@house.test")).json();
    expect(back).toMatchObject({ address: "office@house.test", body: `by ${role}` });
  });

  it("answers 404 for an address this house does not send from", async () => {
    expect((await get("owner", "them@other.test")).status).toBe(404);
  });

  it("refuses 601 characters at the door (400)", async () => {
    const res = await put("owner", { address: "me@house.test", body: "a".repeat(601) });
    expect(res.status).toBe(400);
    // The DTO refuses it before the service is reached.
    expect(JSON.stringify(await res.json())).toMatch(/shorter than or equal to 600/);
  });
});
