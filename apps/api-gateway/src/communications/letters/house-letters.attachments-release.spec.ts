import "reflect-metadata";
import { createHash } from "crypto";
import { HouseLettersService, LETTER_STATUS } from "./house-letters.service";
import { HouseLetterFilesService, LETTER_FILES_BUCKET } from "./house-letter-files.service";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../../organizations/vendor-send-authority.service";
import { VendorSendRequestsService } from "../../organizations/vendor-send-requests.service";
import { FakeDb } from "../../notifications/producers/testing/fake-db";
import { installGrantLedger } from "../../organizations/testing/grant-ledger-fake";

/**
 * g6b step 2 (DD-r107-11, r109): at release the dispatcher re-reads the
 * letter's files by letter_id AND restaurant_id, re-hashes the bytes in the
 * private bucket, and refuses the WHOLE letter on any difference from the seal
 * (a swapped object, a changed row, a missing file, a file outside the house,
 * an extra file tied to it, the caps). A refused letter is recorded as failed,
 * in words, and Gmail is never called. A letter whose files match leaves with
 * them, in the order sealed.
 *
 * Real: HouseLetterFilesService, HouseLettersService's seal, queue and
 * dispatcher, SealChallengeService and VendorSendAuthorityService over one
 * FakeDb, plus an in-memory bucket. Stand-ins: the sender identity, the OAuth
 * door and Gmail's HTTP endpoint (a stubbed fetch that keeps the MIME).
 */

const HOUSE = "house-1";
const OTHER = "house-2";
const PROVIDER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "u-manager";
const DRAFT = { providerId: PROVIDER, to: "fikri@fikritarim.com", subject: "Price list", body: "The list is attached." };
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const sha = (s: string | Buffer) => createHash("sha256").update(Buffer.from(s)).digest("hex");
const LATER = () => Date.now() + 3_600_000;

const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

async function build(items: Array<{ name: string; bytes: string | Buffer }>) {
  const db = new FakeDb() as FakeDb & { storage: unknown };
  const bucket = new Map<string, Buffer>();
  db.storage = {
    from: (name: string) => ({
      upload: async (path: string, bytes: Buffer) => {
        if (name !== LETTER_FILES_BUCKET) return { data: null, error: { message: `wrong bucket ${name}` } };
        bucket.set(path, Buffer.from(bytes));
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const bytes = name === LETTER_FILES_BUCKET ? bucket.get(path) : undefined;
        return bytes
          ? { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }, error: null }
          : { data: null, error: { message: "Object not found" } };
      },
      remove: async (paths: string[]) => (paths.forEach((p) => bucket.delete(p)), { data: null, error: null }),
    }),
  };
  db.tables.users = [{ user_id: MANAGER, name: "Mert", restaurant_id: HOUSE, role: "manager" }];
  db.tables.user_restaurant_access = [{ user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true }];
  db.tables.providers = [
    { id: PROVIDER, restaurant_id: HOUSE, name: "Fikri", contact_email: "fikri@fikritarim.com", primary_contact: {}, deleted_at: null },
  ];
  db.tables.provider_contacts = [];
  db.tables.procurement_conversations = [];
  db.tables.authority_grants = [];
  db.tables.mcp_seal_challenges = [];
  db.tables.vendor_send_requests = [];
  db.tables.house_letter_files = [];
  installGrantLedger(db);
  const database = { supabase: db, client: db, getClient: () => db } as any;
  const identity = {
    kind: "house_mailbox", sendable: true, address: "siparis@house.example", ceremony: "undo", undoMs: 120_000, words: "",
    grant: { personUserId: MANAGER, integrationId: "gmail_send", accountEmail: "siparis@house.example" },
  };
  const sender = { resolve: async () => identity, pinned: async () => identity } as any;
  const seal = new SealChallengeService(database);
  (seal as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const authority = new VendorSendAuthorityService(database);
  const files = new HouseLetterFilesService(database);
  const letters = new HouseLettersService(
    database, sender, { getAccessToken: async () => "tok" } as any, authority, seal,
    new VendorSendRequestsService(database, authority), files,
  );
  const sent: string[] = [];
  (globalThis as any).fetch = jest.fn(async (_url: string, init: RequestInit) => {
    sent.push(Buffer.from(JSON.parse(String(init.body)).raw, "base64url").toString("utf8"));
    return { ok: true, status: 200, json: async () => ({ id: "g-1" }), text: async () => "" };
  });
  const uploaded = items.length
    ? await files.upload({
        restaurantId: HOUSE, userId: MANAGER, role: "manager",
        files: items.map((i) => ({ name: i.name, contentType: "application/pdf", contentBase64: b64(i.bytes) })),
      })
    : [];
  const dto = { ...DRAFT, ...(uploaded.length ? { fileIds: uploaded.map((f) => f.id) } : {}) } as any;
  const { challenge } = await letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
  const { id } = await letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge, role: "manager" });
  const letter = () => db.tables.procurement_conversations.find((r) => r.id === id)!;
  const row = (i: number) => db.tables.house_letter_files.find((r) => r.id === uploaded[i].id)!;
  const failure = () => String(letter().constraint_flags?.house_letter_failure ?? "");
  return { db, bucket, files, letters, sent, uploaded, id, letter, row, failure };
}

describe("a letter's files at release", () => {
  it("leave with the letter, re-read from the bucket, in the order sealed", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }, { name: "terms.pdf", bytes: "%PDF terms" }]);
    const out = await t.letters.dispatchDue(LATER());
    expect(out).toMatchObject({ sent: 1, failed: 0 });
    expect(t.sent).toHaveLength(1);
    const mime = t.sent[0];
    expect(mime.indexOf('filename="list.pdf"')).toBeGreaterThan(-1);
    expect(mime.indexOf('filename="list.pdf"')).toBeLessThan(mime.indexOf('filename="terms.pdf"'));
    expect(mime).toContain(b64("%PDF list"));
  });

  it("a letter that sealed no files leaves as before, with none", async () => {
    const t = await build([]);
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).not.toMatch(/Content-Disposition: attachment/i);
  });

  it("a swapped object refuses the whole letter, and nothing is sent", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }, { name: "terms.pdf", bytes: "%PDF terms" }]);
    t.bucket.set(t.row(1).path, Buffer.from("%PDF TERMS")); // same size, other bytes
    const out = await t.letters.dispatchDue(LATER());
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(t.sent).toHaveLength(0);
    expect(t.letter().status).toBe(LETTER_STATUS.FAILED);
    expect(t.failure()).toMatch(/terms\.pdf was replaced after the seal.*whole letter was held back/);
  });

  it("an object grown past its sealed size is refused", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    t.bucket.set(t.row(0).path, Buffer.from("%PDF list and more"));
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(0);
    expect(t.failure()).toMatch(/list\.pdf was replaced after the seal/);
  });

  it("a row changed after the seal is refused, before any byte is read", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    t.row(0).sha256 = sha("other");
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(0);
    expect(t.failure()).toMatch(/record changed after the seal/);
  });

  it("a missing object, or a missing row, is refused", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    t.bucket.delete(t.row(0).path);
    await t.letters.dispatchDue(LATER());
    expect(t.failure()).toMatch(/list\.pdf could not be read/);
    const u = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    u.db.tables.house_letter_files.splice(0, 1);
    await u.letters.dispatchDue(LATER());
    expect([t.sent.length, u.sent.length]).toEqual([0, 0]);
    expect(u.failure()).toMatch(/a file it carries is missing/);
  });

  it("an extra file tied to the letter after the seal is refused", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    const [extra] = await t.files.upload({
      restaurantId: HOUSE, userId: MANAGER, role: "manager", files: [{ name: "x.pdf", contentType: "application/pdf", contentBase64: b64("x") }],
    });
    t.db.tables.house_letter_files.find((r) => r.id === extra.id)!.letter_id = t.id;
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(0);
    expect(t.failure()).toMatch(/one it does not carry is tied to it/);
  });

  it("a file moved to another house, or pointing outside this one, is refused", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    t.row(0).restaurant_id = OTHER; // the read is by house: it is now missing
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(0);
    expect(t.failure()).toMatch(/a file it carries is missing/);
    const u = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    u.bucket.set(`${OTHER}/stolen`, Buffer.from("%PDF list"));
    u.row(0).path = `${OTHER}/stolen`; // a row the table CHECK would refuse
    await u.letters.dispatchDue(LATER());
    expect(u.sent).toHaveLength(0);
    expect(u.failure()).toMatch(/a file is not in this house/);
  });

  it("over the caps at release is refused, whatever the seal says", async () => {
    const MB = 1024 * 1024;
    const t = await build([{ name: "a.pdf", bytes: Buffer.alloc(3 * MB, 1) }]);
    const big = Buffer.alloc(6 * MB, 2);
    t.bucket.set(t.row(0).path, big);
    Object.assign(t.row(0), { size: big.length, sha256: sha(big) });
    t.letter().email_headers.files = [{ id: t.uploaded[0].id, sha256: sha(big), size: big.length }];
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(0);
    // The MIME builder caps too (g6a); this pins the release's own check,
    // which refuses before the token is fetched.
    expect(t.failure()).toMatch(/over 5 MB.*whole letter was held back/);
  });

  it("a sealed list that cannot be read is refused", async () => {
    const t = await build([{ name: "list.pdf", bytes: "%PDF list" }]);
    t.letter().email_headers.files = "list.pdf";
    await t.letters.dispatchDue(LATER());
    expect(t.sent).toHaveLength(0);
    expect(t.failure()).toMatch(/the sealed list is not readable/);
  });
});
