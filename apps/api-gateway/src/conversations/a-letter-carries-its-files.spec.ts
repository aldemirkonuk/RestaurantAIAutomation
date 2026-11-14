/**
 * r28 mail gap 13: a letter in Mail shows the files it carried, and one can
 * be opened. At the HTTP seam: the real MailController and MailService, a
 * JwtAuthGuard stub that sets request.user from test headers, and a database
 * that records every read and answers from the tables below. Storage is a
 * stub that records which path it signed. Nothing leaves this process.
 */
import { ExecutionContext, INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { MailController } from "./mail.controller";
import { ATTACHMENT_LINK_SECONDS, MailService } from "./mail.service";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VENDOR = "c0000000-0000-4000-8000-000000000001";
const L1 = "d0000000-0000-4000-8000-000000000001"; // vendor letter, two files
const L2 = "d0000000-0000-4000-8000-000000000002"; // house letter, none
const LD = "d0000000-0000-4000-8000-0000000000dd"; // a house draft (withheld from staff)
const LX = "d0000000-0000-4000-8000-0000000000ee"; // another house's letter
const F1 = "f0000000-0000-4000-8000-000000000001";
const F2 = "f0000000-0000-4000-8000-000000000002";
const FD = "f0000000-0000-4000-8000-0000000000dd";
const FX = "f0000000-0000-4000-8000-0000000000ee";
const FR = "f0000000-0000-4000-8000-0000000000aa"; // removed by retention

type Filter = [string, unknown[]];
type Read = { kind: "rpc" | "from"; name: string; filters: Filter[] };
let reads: Read[] = [];
let failTable: string | null = null;
let signed: string[] = [];
let signFails = false;

const letters = [
  { id: L1, restaurant_id: HOUSE, status: "RECEIVED" },
  { id: L2, restaurant_id: HOUSE, status: "SENT" },
  { id: LD, restaurant_id: HOUSE, status: "HOUSE_DRAFT" },
  { id: LX, restaurant_id: OTHER, status: "RECEIVED" },
];
const files = [
  { id: F2, conversation_id: L1, filename: "prices.xlsx", mime_type: null, size_bytes: "2048", storage_path: "h/l1/b-prices.xlsx", bytes_deleted_at: null, created_at: "2026-11-06T09:00:01Z" },
  { id: F1, conversation_id: L1, filename: "invoice.pdf", mime_type: "application/pdf", size_bytes: 120000, storage_path: "h/l1/a-invoice.pdf", bytes_deleted_at: null, created_at: "2026-11-06T09:00:00Z" },
  { id: FD, conversation_id: LD, filename: "claim.pdf", mime_type: "application/pdf", size_bytes: 10, storage_path: "h/ld/claim.pdf", bytes_deleted_at: null, created_at: "2026-11-06T09:00:00Z" },
  { id: FX, conversation_id: LX, filename: "theirs.pdf", mime_type: "application/pdf", size_bytes: 10, storage_path: "o/lx/theirs.pdf", bytes_deleted_at: null, created_at: "2026-11-06T09:00:00Z" },
  { id: FR, conversation_id: L1, filename: "", mime_type: "image/jpeg", size_bytes: null, storage_path: "h/l1/c.jpg", bytes_deleted_at: "2026-11-10T00:00:00Z", created_at: "2026-11-06T09:00:02Z" },
];

/** Applies the recorded filters to a table, the way PostgREST would. */
function rowsFor(r: Read): any[] {
  let rows: any[] = r.name === "conversation_attachments" ? files : letters;
  for (const [m, args] of r.filters) {
    if (m === "eq") rows = rows.filter((x) => x[args[0] as string] === args[1]);
    if (m === "in") rows = rows.filter((x) => (args[1] as unknown[]).includes(x[args[0] as string]));
    if (m === "or" && String(args[0]).includes("HOUSE_DRAFT")) rows = rows.filter((x) => x.status !== "HOUSE_DRAFT");
    if (m === "or" && String(args[0]).includes("HOUSE_CANCELLED")) rows = rows.filter((x) => x.status !== "HOUSE_CANCELLED");
  }
  const orders = r.filters.filter(([m]) => m === "order").map(([, a]) => a[0] as string);
  return [...rows].sort((a, b) => {
    for (const k of orders) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    return 0;
  });
}

function chain(r: Read): any {
  const c: any = {};
  for (const m of ["select", "eq", "in", "or", "not", "order", "limit", "maybeSingle"]) {
    c[m] = (...args: unknown[]) => {
      r.filters.push([m, args]);
      return c;
    };
  }
  c.then = (ok: any, bad: any) => {
    let out: any;
    if (failTable === r.name) out = { data: null, error: { message: "boom" } };
    else if (r.kind === "rpc") {
      out = {
        data: [
          { id: L2, provider_id: VENDOR, provider_name: "Ali", direction: "outbound", channel: "email", message_text: "Thanks", status: "SENT", sent_at: "2026-11-06T10:00:00Z", received_at: null, created_at: "2026-11-06T10:00:00Z", at: "2026-11-06T10:00:00Z", thread_waiting: false },
          { id: L1, provider_id: VENDOR, provider_name: "Ali", direction: "inbound", channel: "email", message_text: "See attached", status: "RECEIVED", sent_at: null, received_at: "2026-11-06T09:00:00Z", created_at: "2026-11-06T09:00:00Z", at: "2026-11-06T09:00:00Z", thread_waiting: false },
        ],
        error: null,
      };
    } else out = { data: rowsFor(r), error: null };
    return Promise.resolve(out).then(ok, bad);
  };
  return c;
}

const db = {
  supabase: {
    rpc: (name: string) => {
      const r: Read = { kind: "rpc", name, filters: [] };
      reads.push(r);
      return chain(r);
    },
    from: (name: string) => {
      const r: Read = { kind: "from", name, filters: [] };
      reads.push(r);
      return chain(r);
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, seconds: number) => {
          signed.push(`${bucket}:${path}:${seconds}`);
          if (signFails) return { data: null, error: { message: "storage down" } };
          return { data: { signedUrl: `https://files.test/${path}?t=1` }, error: null };
        },
      }),
    },
  },
};

let app: INestApplication;
let base = "";

async function get(path: string, as: { house?: string; role?: string } = {}) {
  const res = await fetch(`${base}/mail${path}`, {
    headers: { "x-test-house": as.house ?? HOUSE, "x-test-role": as.role ?? "owner" },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MailController],
    providers: [
      MailService,
      { provide: DatabaseService, useValue: db },
      { provide: ConfigService, useValue: { get: () => undefined } },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = { userId: "user-1", restaurantId: req.headers["x-test-house"], role: req.headers["x-test-role"] };
        return true;
      },
    })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  reads = [];
  failTable = null;
  signed = [];
  signFails = false;
});

describe("GET /mail/thread: each letter's files", () => {
  it("lists a letter's files in the order they arrived, and a letter with none has none", async () => {
    const res = await get(`/thread?key=t-1&with=vendor:${VENDOR}`);
    expect(res.status).toBe(200);
    expect(res.body.attachmentsRead).toBe(true);
    const byId = Object.fromEntries(res.body.messages.map((m: any) => [m.id, m.attachments]));
    expect(byId[L1]).toEqual([
      { id: F1, filename: "invoice.pdf", mimeType: "application/pdf", sizeBytes: 120000, removedAt: null },
      { id: F2, filename: "prices.xlsx", mimeType: null, sizeBytes: 2048, removedAt: null },
      { id: FR, filename: "A file with no name", mimeType: "image/jpeg", sizeBytes: null, removedAt: "2026-11-10T00:00:00Z" },
    ]);
    expect(byId[L2]).toEqual([]);
  });

  it("reads the files by the page's own letters, and never signs an address while listing", async () => {
    await get(`/thread?key=t-1`);
    const read = reads.find((r) => r.name === "conversation_attachments")!;
    const inFilter = read.filters.find(([m]) => m === "in")!;
    expect(inFilter[1]).toEqual(["conversation_id", [L2, L1]]);
    expect(read.filters.filter(([m]) => m === "select")[0][1][0]).not.toMatch(/storage_path/);
    expect(signed).toEqual([]);
  });

  it("a failed read of the files still shows the letters, and says the files were not read", async () => {
    failTable = "conversation_attachments";
    const res = await get(`/thread?key=t-1`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.attachmentsRead).toBe(false);
    expect(res.body.messages.every((m: any) => Array.isArray(m.attachments) && m.attachments.length === 0)).toBe(true);
  });
});

describe("GET /mail/attachments/:id/link", () => {
  it("gives a five-minute address for a file of a letter in this house", async () => {
    const res = await get(`/attachments/${F1}/link`, { role: "staff" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: F1,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      url: "https://files.test/h/l1/a-invoice.pdf?t=1",
      expiresInSeconds: ATTACHMENT_LINK_SECONDS,
    });
    expect(ATTACHMENT_LINK_SECONDS).toBe(300);
    expect(signed).toEqual(["vendor-attachments:h/l1/a-invoice.pdf:300"]);
    const letter = reads.find((r) => r.name === "procurement_conversations")!;
    expect(letter.filters).toContainEqual(["eq", ["restaurant_id", HOUSE]]);
  });

  it("another house's file is not in this house's mail: 404, nothing signed", async () => {
    const res = await get(`/attachments/${FX}/link`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("That file is not in this house's mail.");
    expect(signed).toEqual([]);
  });

  it("staff never reach a withheld letter's file; an owner does", async () => {
    const staff = await get(`/attachments/${FD}/link`, { role: "staff" });
    expect(staff.status).toBe(404);
    expect(signed).toEqual([]);
    const owner = await get(`/attachments/${FD}/link`, { role: "owner" });
    expect(owner.status).toBe(200);
  });

  it("a file that does not exist, or an id that is not one, is 404", async () => {
    expect((await get(`/attachments/f0000000-0000-4000-8000-000000000999/link`)).status).toBe(404);
    const bad = await get(`/attachments/not-a-uuid/link`);
    expect(bad.status).toBe(404);
    expect(reads).toHaveLength(1);
  });

  it("a file removed under the retention rule is 410 in words, nothing signed", async () => {
    const res = await get(`/attachments/${FR}/link`);
    expect(res.status).toBe(410);
    expect(res.body.message).toBe(
      "This file was removed under the house's mail retention rule. Its name is kept with the letter.",
    );
    expect(signed).toEqual([]);
  });

  it("a storage failure is 503 in words, never a link that does not work", async () => {
    signFails = true;
    const res = await get(`/attachments/${F1}/link`);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe(
      "The file could not be opened just now. Nothing was changed; try again in a moment.",
    );
  });

  it.each(["conversation_attachments", "procurement_conversations"])(
    "a failed read of %s is 503, never 404",
    async (table) => {
      failTable = table;
      const res = await get(`/attachments/${F1}/link`);
      expect(res.status).toBe(503);
      expect(signed).toEqual([]);
    },
  );
});
