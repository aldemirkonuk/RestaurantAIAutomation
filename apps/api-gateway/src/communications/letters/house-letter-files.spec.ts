import "reflect-metadata";
import { createHash } from "crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { HouseLettersController } from "./house-letters.controller";
import { HouseLetterFilesService, LETTER_FILES_BUCKET } from "./house-letter-files.service";
import { UploadLetterFilesDto } from "./house-letters.dto";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { FakeDb } from "../../notifications/producers/testing/fake-db";

/**
 * g6b step 1a (DD-r107-11 / DD-r108-6, r109): a letter's files are uploaded by
 * an owner or a manager, hashed by the server and kept at `<house>/<uuid>`;
 * the list a seal will hold is read by id AND house, and a file is tied to one
 * letter once. (The seal and the queue: house-letters.files-seal.spec.ts.)
 *
 * Real: HouseLetterFilesService over a FakeDb and an in-memory bucket.
 */

const HOUSE = "house-1";
const OTHER = "house-2";
const OWNER = "u-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const sha = (s: string | Buffer) => createHash("sha256").update(Buffer.from(s)).digest("hex");
const MB = 1024 * 1024;

function build() {
  const db = new FakeDb() as FakeDb & { storage: unknown };
  const bucket = new Map<string, Buffer>();
  db.storage = {
    from: (name: string) => ({
      upload: async (path: string, bytes: Buffer) => {
        if (name !== LETTER_FILES_BUCKET) return { data: null, error: { message: `wrong bucket ${name}` } };
        bucket.set(path, Buffer.from(bytes));
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => (paths.forEach((p) => bucket.delete(p)), { data: null, error: null }),
    }),
  };
  db.tables.house_letter_files = [];
  const files = new HouseLetterFilesService({ supabase: db, client: db } as any);
  const upload = (role: string, items: Array<{ name: string; bytes: string | Buffer }>, house = HOUSE) =>
    files.upload({
      restaurantId: house,
      userId: role === "staff" ? STAFF : MANAGER,
      role,
      files: items.map((i) => ({ name: i.name, contentType: "application/pdf", contentBase64: b64(i.bytes) })),
    });
  return { db, bucket, files, upload };
}

describe("uploading a letter's files", () => {
  it("an owner or a manager stores bytes the server hashes, at <house>/<uuid> in the private bucket", async () => {
    const t = build();
    const [f] = await t.upload("manager", [{ name: "price list.pdf", bytes: "%PDF list" }]);
    expect(f).toMatchObject({ size: 9, sha256: sha("%PDF list") });
    const row = t.db.tables.house_letter_files[0];
    expect(row).toMatchObject({ id: f.id, restaurant_id: HOUSE, path: `${HOUSE}/${f.id}`, uploaded_by: MANAGER });
    expect(row.letter_id ?? null).toBeNull();
    expect(t.bucket.get(`${HOUSE}/${f.id}`)?.toString()).toBe("%PDF list");
  });

  it("refuses staff, and stores nothing", async () => {
    const t = build();
    await expect(t.upload("staff", [{ name: "a.pdf", bytes: "x" }])).rejects.toThrow(/Only an owner or a manager can attach/);
    expect(t.bucket.size).toBe(0);
    expect(t.db.tables.house_letter_files).toHaveLength(0);
  });

  it("refuses a 4th file and more than 5 MB at the upload, and stores nothing", async () => {
    const t = build();
    const four = ["a", "b", "c", "d"].map((n) => ({ name: `${n}.pdf`, bytes: n }));
    await expect(t.upload("owner", four)).rejects.toThrow(/3 files at most/);
    await expect(t.upload("owner", [{ name: "big.pdf", bytes: Buffer.alloc(5 * MB + 1, 1) }])).rejects.toThrow(/over 5 MB/);
    expect(t.bucket.size).toBe(0);
  });

  it("refuses bytes that are not whole base64", async () => {
    const t = build();
    await expect(
      t.files.upload({ restaurantId: HOUSE, userId: OWNER, role: "owner", files: [{ name: "a.pdf", contentType: "application/pdf", contentBase64: "@@not base64@@" }] }),
    ).rejects.toThrow(/did not arrive whole/);
  });

  it("the route is owner/manager only, and the body has no URL or path field", () => {
    expect(Reflect.getMetadata(ROLES_KEY, HouseLettersController.prototype.uploadFiles)).toEqual(["owner", "manager"]);
    const dto = plainToInstance(UploadLetterFilesDto, {
      files: [{ name: "a.pdf", contentType: "application/pdf", contentBase64: b64("x"), url: "https://evil.example/a.pdf", path: "house-2/x" }],
    });
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(JSON.stringify(errors)).toMatch(/property url should not exist/);
    expect(JSON.stringify(errors)).toMatch(/property path should not exist/);
  });
});

describe("the files a letter names, as the seal holds them", () => {
  it("reads them by id AND house, in the order named", async () => {
    const t = build();
    const [a, b] = await t.upload("owner", [{ name: "a.pdf", bytes: "aa" }, { name: "b.pdf", bytes: "bbb" }]);
    await expect(t.files.sealedFiles(HOUSE, [b.id, a.id])).resolves.toEqual([
      { id: b.id, sha256: sha("bbb"), size: 3 },
      { id: a.id, sha256: sha("aa"), size: 2 },
    ]);
  });

  it("refuses another house's file, a missing one, one already on a letter, one named twice, a 4th, and over 5 MB in all", async () => {
    const t = build();
    const [mine] = await t.upload("owner", [{ name: "a.pdf", bytes: "aa" }]);
    const [theirs] = await t.upload("owner", [{ name: "b.pdf", bytes: "bb" }], OTHER);
    await expect(t.files.sealedFiles(HOUSE, [theirs.id])).rejects.toThrow(/not one this house uploaded/);
    await expect(t.files.sealedFiles(HOUSE, ["00000000-0000-4000-8000-000000000000"])).rejects.toThrow(/not one this house uploaded/);
    await expect(t.files.sealedFiles(HOUSE, [mine.id, mine.id])).rejects.toThrow(/same file twice/);
    await expect(t.files.sealedFiles(HOUSE, ["1", "2", "3", "4"])).rejects.toThrow(/3 files at most/);
    const [big1] = await t.upload("owner", [{ name: "1.pdf", bytes: Buffer.alloc(3 * MB, 1) }]);
    const [big2] = await t.upload("owner", [{ name: "2.pdf", bytes: Buffer.alloc(3 * MB, 2) }]);
    await expect(t.files.sealedFiles(HOUSE, [big1.id, big2.id])).rejects.toThrow(/over 5 MB/);
    t.db.tables.house_letter_files.find((r) => r.id === mine.id)!.letter_id = "letter-x";
    await expect(t.files.sealedFiles(HOUSE, [mine.id])).rejects.toThrow(/already on another letter/);
  });

  it("each bound holds alone: a foreign row claiming this house's path, and this house's row pointing at another's", async () => {
    // Rows the table's CHECK would refuse, written straight into the fake, so
    // the house filter and the path prefix are each proven without the other.
    const t = build();
    const row = (id: string, restaurant_id: string, path: string) => ({ id, restaurant_id, path, size: 1, sha256: sha("x"), letter_id: null });
    t.db.tables.house_letter_files.push(row("forged-1", OTHER, `${HOUSE}/forged-1`), row("forged-2", HOUSE, `${OTHER}/forged-2`));
    await expect(t.files.sealedFiles(HOUSE, ["forged-1"])).rejects.toThrow(/not one this house uploaded/);
    await expect(t.files.sealedFiles(HOUSE, ["forged-2"])).rejects.toThrow(/not one this house uploaded/);
  });
});

describe("tying files to their letter", () => {
  it("ties only this house's unused files, and throws unless every one was tied", async () => {
    const t = build();
    const [a, b] = await t.upload("owner", [{ name: "a.pdf", bytes: "aa" }, { name: "b.pdf", bytes: "bb" }]);
    const sealed = await t.files.sealedFiles(HOUSE, [a.id, b.id]);
    t.db.tables.house_letter_files.find((r) => r.id === b.id)!.letter_id = "earlier-letter";
    await expect(t.files.bind(HOUSE, "letter-1", sealed)).rejects.toThrow(/1 of 2 files were tied/);
    await expect(t.files.bind(OTHER, "letter-2", sealed.slice(0, 1))).rejects.toThrow(/0 of 1 files were tied/);
  });
});
