/**
 * A drink's photo (r110 drinks-g3): owner or manager sets and removes it,
 * staff get 403; another house's drink is 404; every metadata block (EXIF GPS
 * above all) is gone from the stored bytes; the stored path sits under the
 * house; reads sign only the house's own paths and a failed photo read is no
 * photo, never a failed recipe.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DrinkPhotoController } from "./drink-photo.controller";
import { DrinkPhotoService, PHOTO_BUCKET, PHOTO_URL_SECONDS, photoUrlsOf } from "./drink-photo.service";
import { NOT_THIS_HOUSE } from "./recipes.service";
import { DRINK_NOT_THIS_HOUSE } from "./drink-photo.service";
import { PHOTO_NOT_AN_IMAGE, PHOTO_TOO_BIG } from "./drink-photo";
import { hasGps, jpegWithGps, webpWithGps } from "./drink-photo.testing";

const HOUSE = "8f2b6a52-7c1e-4d0b-9a8e-2b9d7c1e4a10";
const OTHER = "9a3c7b63-8d2f-4e1c-8b9f-3c0e8d2f5b21";
const DRINK = "1c0ffee0-0000-4000-8000-000000000001";

// ── a fake service-key client ────────────────────────────────────────────────
type Row = { id: string; restaurant_id: string; photo_path: string | null; deleted_at: string | null };
function fakeDb(rows: Row[], opts: { signFails?: boolean } = {}) {
  const uploads: Array<{ path: string; bytes: Buffer; contentType: string }> = [];
  const removed: string[] = [];
  const signed: string[][] = [];
  const query = () => {
    const f: Array<(r: Row) => boolean> = [];
    let patch: Partial<Row> | null = null;
    const q: any = {
      select: () => q,
      update: (p: Partial<Row>) => ((patch = p), q),
      eq: (k: keyof Row, v: unknown) => (f.push((r) => r[k] === v), q),
      is: (k: keyof Row, v: unknown) => (f.push((r) => r[k] === v), q),
      in: (k: keyof Row, v: unknown[]) => (f.push((r) => v.includes(r[k])), q),
      not: (k: keyof Row) => (f.push((r) => r[k] !== null), q),
      maybeSingle: async () => {
        const r = rows.find((x) => f.every((g) => g(x)));
        return { data: r ? { ...r } : null, error: null };
      },
      then: (res: any) => {
        const hit = rows.filter((r) => f.every((g) => g(r)));
        if (patch) for (const r of hit) Object.assign(r, patch);
        return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(res);
      },
    };
    return q;
  };
  const client: any = {
    from: () => query(),
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe(PHOTO_BUCKET);
        return {
          upload: async (path: string, bytes: Buffer, o: { contentType: string }) => (uploads.push({ path, bytes, contentType: o.contentType }), { data: { path }, error: null }),
          remove: async (paths: string[]) => (removed.push(...paths), { data: [], error: null }),
          createSignedUrls: async (paths: string[], seconds: number) => {
            expect(seconds).toBe(PHOTO_URL_SECONDS);
            signed.push(paths);
            if (opts.signFails) return { data: null, error: { message: "storage down" } };
            return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}?t=600` })), error: null };
          },
        };
      },
    },
  };
  return { db: { getClient: () => client } as any, client, uploads, removed, signed };
}

const house = (): Row[] => [
  { id: DRINK, restaurant_id: HOUSE, photo_path: null, deleted_at: null },
  { id: "1c0ffee0-0000-4000-8000-000000000002", restaurant_id: OTHER, photo_path: `${OTHER}/1c0ffee0-0000-4000-8000-000000000002/x.webp`, deleted_at: null },
];

describe("drink photo: who may set it", () => {
  let app: INestApplication;
  let base: string;
  const calls: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DrinkPhotoController],
      providers: [
        {
          provide: DrinkPhotoService,
          useValue: {
            put: async () => (calls.push("put"), { photoUrl: "u" }),
            remove: async () => (calls.push("remove"), { photoUrl: null }),
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

  const send = (method: "PUT" | "DELETE", role: string) =>
    fetch(`${base}/recipes/${HOUSE}/cocktails/${DRINK}/photo`, {
      method,
      headers: { "content-type": "application/json", "x-test-role": role },
      body: method === "PUT" ? JSON.stringify({ imageBase64: jpegWithGps().toString("base64") }) : undefined,
    });

  it("staff PUT and DELETE are 403 and never reach the service", async () => {
    calls.length = 0;
    expect((await send("PUT", "staff")).status).toBe(403);
    expect((await send("DELETE", "staff")).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("an owner and a manager reach it", async () => {
    calls.length = 0;
    expect((await send("PUT", "owner")).status).toBe(200);
    expect((await send("PUT", "manager")).status).toBe(200);
    expect((await send("DELETE", "manager")).status).toBe(200);
    expect(calls).toEqual(["put", "put", "remove"]);
  });
});

describe("drink photo: storing", () => {
  it("another house's drink is 404, and nothing is stored", async () => {
    const f = fakeDb(house());
    const svc = new DrinkPhotoService(f.db);
    await expect(svc.put(HOUSE, "1c0ffee0-0000-4000-8000-000000000002", jpegWithGps().toString("base64"))).rejects.toMatchObject({ status: 404 });
    await expect(svc.remove(HOUSE, "1c0ffee0-0000-4000-8000-000000000002")).rejects.toMatchObject({ status: 404 });
    expect(f.uploads).toEqual([]);
    expect(DRINK_NOT_THIS_HOUSE).toBe(NOT_THIS_HOUSE);
  });

  it("stores the photo with no EXIF GPS, under the house, and answers its signed URL", async () => {
    const f = fakeDb(house());
    const raw = jpegWithGps();
    expect(hasGps(raw)).toBe(true);
    const r = await new DrinkPhotoService(f.db).put(HOUSE, DRINK, `data:image/jpeg;base64,${raw.toString("base64")}`);
    expect(f.uploads).toHaveLength(1);
    const { path, bytes, contentType } = f.uploads[0];
    expect(hasGps(bytes)).toBe(false);
    expect(bytes.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]))).toBe(true);
    expect(contentType).toBe("image/jpeg");
    expect(path).toMatch(new RegExp(`^${HOUSE}/${DRINK}/[0-9a-f-]{36}\\.jpg$`));
    expect(r.photoUrl).toBe(`https://signed/${path}?t=600`);
  });

  it("replacing keeps one file: the new one is the drink's, the old one goes", async () => {
    const rows = house();
    rows[0].photo_path = `${HOUSE}/${DRINK}/old.webp`;
    const f = fakeDb(rows);
    await new DrinkPhotoService(f.db).put(HOUSE, DRINK, webpWithGps().toString("base64"));
    expect(rows[0].photo_path).toBe(f.uploads[0].path);
    expect(f.uploads[0].path.endsWith(".webp")).toBe(true);
    expect(f.removed).toEqual([`${HOUSE}/${DRINK}/old.webp`]);
    await new DrinkPhotoService(f.db).remove(HOUSE, DRINK);
    expect(rows[0].photo_path).toBeNull();
    expect(f.removed).toEqual([`${HOUSE}/${DRINK}/old.webp`, f.uploads[0].path]);
  });

  it("refuses a file that is not a JPEG, PNG or WebP, one that does not parse, and one over 5 MB, storing nothing", async () => {
    const f = fakeDb(house());
    const svc = new DrinkPhotoService(f.db);
    await expect(svc.put(HOUSE, DRINK, Buffer.from("GIF89a....").toString("base64"))).rejects.toMatchObject({ status: 400, message: PHOTO_NOT_AN_IMAGE });
    await expect(svc.put(HOUSE, DRINK, jpegWithGps().subarray(0, 40).toString("base64"))).rejects.toMatchObject({ status: 400, message: PHOTO_NOT_AN_IMAGE });
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
    await expect(svc.put(HOUSE, DRINK, big.toString("base64"))).rejects.toMatchObject({ status: 400, message: PHOTO_TOO_BIG });
    expect(f.uploads).toEqual([]);
  });
});

describe("drink photo: reading", () => {
  it("signs only the house's own paths, for 10 minutes", async () => {
    const rows = house();
    rows[0].photo_path = `${HOUSE}/${DRINK}/a.webp`;
    rows.push({ id: "1c0ffee0-0000-4000-8000-000000000003", restaurant_id: HOUSE, photo_path: `${OTHER}/x/stolen.webp`, deleted_at: null });
    const f = fakeDb(rows);
    const urls = await photoUrlsOf(f.client, HOUSE, [DRINK, "1c0ffee0-0000-4000-8000-000000000002", "1c0ffee0-0000-4000-8000-000000000003"]);
    expect([...urls.entries()]).toEqual([[DRINK, `https://signed/${HOUSE}/${DRINK}/a.webp?t=600`]]);
    expect(f.signed).toEqual([[`${HOUSE}/${DRINK}/a.webp`]]);
  });

  it("a failed photo read is no photo, never an error", async () => {
    const rows = house();
    rows[0].photo_path = `${HOUSE}/${DRINK}/a.webp`;
    const f = fakeDb(rows, { signFails: true });
    await expect(photoUrlsOf(f.client, HOUSE, [DRINK])).resolves.toEqual(new Map());
    await expect(photoUrlsOf({ from: () => { throw new Error("down"); } } as any, HOUSE, [DRINK])).resolves.toEqual(new Map());
  });
});
