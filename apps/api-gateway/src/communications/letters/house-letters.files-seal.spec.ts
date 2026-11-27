import "reflect-metadata";
import { createHash } from "crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { HouseLettersService, houseLetterSealArgs } from "./house-letters.service";
import { HouseLetterFilesService, LETTER_FILES_BUCKET } from "./house-letter-files.service";
import { QueueLetterDto } from "./house-letters.dto";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../../organizations/vendor-send-authority.service";
import { VendorSendRequestsService } from "../../organizations/vendor-send-requests.service";
import { FakeDb } from "../../notifications/producers/testing/fake-db";
import { installGrantLedger } from "../../organizations/testing/grant-ledger-fake";

/**
 * g6b step 1b (DD-r107-11 / DD-r108-6, r109): the seal holds each attached
 * file's id, sha-256 and size, read by id AND house, so a seal over other files
 * (or over a row changed after the hold) queues nothing; staff, a request and a
 * released request carry no files; a file that cannot be tied stops the letter.
 *
 * Real: HouseLetterFilesService, HouseLettersService's seal and queue,
 * SealChallengeService and VendorSendAuthorityService over one FakeDb, plus an
 * in-memory bucket. Stand-ins: the sender identity and the OAuth door.
 */

const HOUSE = "house-1";
const OTHER = "house-2";
const PROVIDER = "11111111-1111-4111-8111-111111111111";
const OWNER = "u-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const DRAFT = { providerId: PROVIDER, to: "fikri@fikritarim.com", subject: "Price list", body: "The list is attached." };
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
  db.tables.users = [
    { user_id: OWNER, name: "Olcay", restaurant_id: HOUSE, role: "owner" },
    { user_id: MANAGER, name: "Mert", restaurant_id: HOUSE, role: "manager" },
    { user_id: STAFF, name: "Ayse", restaurant_id: HOUSE, role: "staff" },
  ];
  db.tables.user_restaurant_access = db.tables.users.map((u) => ({ user_id: u.user_id, restaurant_id: HOUSE, role: u.role, is_active: true }));
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
  const sender = {
    resolve: async () => ({ kind: "house_mailbox", sendable: true, address: "siparis@house.example", ceremony: "undo", undoMs: 120_000, words: "", grant: null }),
  } as any;
  const seal = new SealChallengeService(database);
  (seal as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const authority = new VendorSendAuthorityService(database);
  const files = new HouseLetterFilesService(database);
  const letters = new HouseLettersService(
    database, sender, { getAccessToken: async () => "tok" } as any, authority, seal,
    new VendorSendRequestsService(database, authority), files,
  );
  const queued = () => db.tables.procurement_conversations.filter((r) => r.outbound_email_type === "HOUSE_LETTER");
  const upload = (role: string, items: Array<{ name: string; bytes: string | Buffer }>, house = HOUSE) =>
    files.upload({
      restaurantId: house,
      userId: role === "staff" ? STAFF : MANAGER,
      role,
      files: items.map((i) => ({ name: i.name, contentType: "application/pdf", contentBase64: b64(i.bytes) })),
    });
  return { db, bucket, files, letters, queued, upload };
}

describe("the seal over a letter's files", () => {
  it("fileIds is at most 3 uuids", () => {
    const queue = plainToInstance(QueueLetterDto, { ...DRAFT, fileIds: ["a", "b", "c", "d"] });
    expect(JSON.stringify(validateSync(queue))).toMatch(/fileIds/);
  });

  it("a letter with no files hashes exactly as before", () => {
    expect(houseLetterSealArgs(DRAFT)).toEqual(houseLetterSealArgs(DRAFT, []));
    expect(houseLetterSealArgs(DRAFT)).not.toHaveProperty("files");
  });
});

describe("queueing a letter with files", () => {
  it("binds the files' id, sha-256 and size into the seal, the row and the file rows", async () => {
    const t = build();
    const [f] = await t.upload("manager", [{ name: "a.pdf", bytes: "%PDF a" }]);
    const dto = { ...DRAFT, fileIds: [f.id] } as any;
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    const out = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge, role: "manager" });
    expect(t.queued()[0].email_headers.files).toEqual([{ id: f.id, sha256: sha("%PDF a"), size: 6 }]);
    expect(t.db.tables.house_letter_files[0].letter_id).toBe(out.id);
  });

  it("a seal over other files queues nothing", async () => {
    const t = build();
    const [a, b] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }, { name: "b.pdf", bytes: "bb" }]);
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: { ...DRAFT, fileIds: [a.id] } as any, role: "manager" });
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: { ...DRAFT, fileIds: [b.id] } as any, challenge, role: "manager" }),
    ).rejects.toThrow(/changed after the seal was issued/);
    expect(t.queued()).toHaveLength(0);
  });

  it("a file row changed after the hold queues nothing", async () => {
    const t = build();
    const [a] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }]);
    const dto = { ...DRAFT, fileIds: [a.id] } as any;
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    t.db.tables.house_letter_files[0].sha256 = sha("swapped");
    await expect(t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge, role: "manager" })).rejects.toThrow(
      /changed after the seal was issued/,
    );
    expect(t.queued()).toHaveLength(0);
  });

  it("refuses files from staff at the seal, on a request, and with a released request", async () => {
    const t = build();
    const [a] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }]);
    const dto = { ...DRAFT, fileIds: [a.id] } as any;
    await expect(t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: OWNER, dto, role: "staff" })).rejects.toThrow(/Only an owner or a manager can attach/);
    await expect(t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto })).rejects.toThrow(/A request carries the words only/);
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: { ...dto, requestId: "22222222-2222-4222-8222-222222222222" }, challenge: "x", role: "manager" }),
    ).rejects.toThrow(/released request sends the letter that was asked for, with no files/);
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(0);
  });

  it("a file that cannot be tied stops the letter before it leaves", async () => {
    const t = build();
    const [a] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }]);
    const dto = { ...DRAFT, fileIds: [a.id] } as any;
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    t.files.bind = async () => {
      throw new Error("write refused");
    };
    await expect(t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge, role: "manager" })).rejects.toThrow(
      /could not be tied to this letter .*stopped before it left/,
    );
    expect(t.queued()[0].status).toBe("HOUSE_FAILED");
  });

  // A Mudavym-written draft (maybe carrying a credit claim) must survive a bind that fails.
  it("a draft whose files cannot be tied stays a draft, with its files free", async () => {
    const t = build();
    const [a] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }]);
    t.db.tables.procurement_conversations.push({
      id: "draft-1", restaurant_id: HOUSE, provider_id: PROVIDER, order_id: null, status: "HOUSE_DRAFT", direction: "outbound",
      message_text: "Drafted by Mudavym", email_headers: { credit_id: "credit-1", drafted_by: "mudavym" },
    });
    const dto = { ...DRAFT, draftId: "draft-1", fileIds: [a.id] } as any;
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    t.files.bind = async () => {
      throw new Error("write refused");
    };
    await expect(t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge, role: "manager" })).rejects.toThrow(
      /could not be tied to this letter .*The draft is still a draft/,
    );
    const row = t.db.tables.procurement_conversations.find((r) => r.id === "draft-1")!;
    expect(row.status).toBe("HOUSE_DRAFT");
    expect(row.message_text).toBe("Drafted by Mudavym");
    expect(row.email_headers.credit_id).toBe("credit-1");
    expect(t.db.tables.house_letter_files[0].letter_id ?? null).toBeNull();
  });

  it("a draft with files that ties them becomes the queued letter, files tied to it once", async () => {
    const t = build();
    const [a] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }]);
    t.db.tables.procurement_conversations.push({
      id: "draft-2", restaurant_id: HOUSE, provider_id: PROVIDER, order_id: null, status: "HOUSE_DRAFT", direction: "outbound",
      message_text: "Drafted", email_headers: { drafted_by: "mudavym" },
    });
    const dto = { ...DRAFT, draftId: "draft-2", fileIds: [a.id] } as any;
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    const out = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge, role: "manager" });
    expect(out.id).toBe("draft-2");
    expect(t.db.tables.procurement_conversations.find((r) => r.id === "draft-2")!.status).toBe("HOUSE_QUEUED");
    expect(t.db.tables.house_letter_files[0].letter_id).toBe("draft-2");
  });

  it("pulling a letter back frees its files, so the writer can send again", async () => {
    const t = build();
    const [a] = await t.upload("manager", [{ name: "a.pdf", bytes: "aa" }]);
    const dto = { ...DRAFT, fileIds: [a.id] } as any;
    const first = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    const out = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge: first.challenge, role: "manager" });
    expect(t.db.tables.house_letter_files[0].letter_id).toBe(out.id);
    await t.letters.cancel({ restaurantId: HOUSE, userId: MANAGER, id: out.id, role: "manager" });
    expect(t.db.tables.house_letter_files[0].letter_id ?? null).toBeNull();
    // The same file seals and queues again: no "already on another letter".
    const second = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto, role: "manager" });
    const again = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto, challenge: second.challenge, role: "manager" });
    expect(t.db.tables.house_letter_files[0].letter_id).toBe(again.id);
  });
});
