/**
 * The house's notes on a Mail thread (r110 mail-gap g5): what GET
 * /mail/thread carries, at the seam in mail.thread-notes.testing.ts, and
 * that no code but the notes module can reach a note.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { encodeMailCursor, MAIL_THREAD_PAGE } from "./mail.read-rules";
import {
  AYSE,
  HOUSE_A,
  MEHMET,
  NOTE,
  V2,
  VENDOR,
  call,
  fake,
  has,
  named,
  stored,
  useNotesApp,
  type Answer,
  type Read,
} from "./mail.thread-notes.testing";

useNotesApp();

describe("GET /mail/thread carries the notes", () => {
  const letterRow = (i: number, at: string) => ({
    id: `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    direction: "inbound",
    channel: "email",
    message_text: `letter ${i}`,
    provider_id: VENDOR,
    provider_name: "Ali",
    thread_subject: "Order 12",
    at,
    created_at: at,
    received_at: at,
  });
  const thread =
    (letters: unknown[], notes: unknown[] | "fail") =>
    (r: Read): Answer => {
      if (r.kind === "rpc") return { data: r.name === "mail_thread_letters" ? letters : [] };
      if (r.name === "mail_thread_notes") return notes === "fail" ? { error: { message: "x" } } : { data: notes };
      if (r.name === "users") return { data: [{ user_id: AYSE, name: "Ayşe" }] };
      if (r.name === "providers") return { data: [{ name: "Ali Balık" }] };
      return { data: [] };
    };
  const notesRead = () => named("mail_thread_notes")[0];

  it("staff read the notes of a vendor thread, oldest first, with who wrote them and which are theirs", async () => {
    fake.answer = thread(
      [letterRow(1, "2026-11-27 12:00:00+00"), letterRow(0, "2026-11-27 09:00:00+00")],
      [stored(), stored({ id: "f0000000-0000-4000-8000-000000000002", written_by: MEHMET, body: "Done" })],
    );
    const res = await call("GET", `/thread?key=gm%3At1&with=vendor%3A${VENDOR}`, { role: "staff", user: MEHMET });
    expect(res.status).toBe(200);
    expect(res.body.notesRead).toBe(true);
    expect(res.body.notes).toEqual([
      {
        id: NOTE,
        body: "They promised a credit on the phone",
        createdAt: "2026-11-27 10:00:00+00",
        writtenBy: { id: AYSE, name: "Ayşe" },
        mine: false,
      },
      {
        id: "f0000000-0000-4000-8000-000000000002",
        body: "Done",
        createdAt: "2026-11-27 10:00:00+00",
        writtenBy: { id: MEHMET, name: null },
        mine: true,
      },
    ]);
    const q = notesRead();
    expect(has(q, "eq", "restaurant_id", HOUSE_A)).toBe(true);
    expect(has(q, "eq", "person_key", `vendor:${VENDOR}`)).toBe(true);
    expect(has(q, "eq", "thread_key", "gm:t1")).toBe(true);
    expect(has(q, "is", "deleted_at", null)).toBe(true);
    expect(has(q, "order", "created_at", { ascending: true })).toBe(true);
    // The only page: every note since the thread began, up to now.
    expect(q.calls.some(([m]) => m === "gte" || m === "lt")).toBe(false);
    // Notes are never letters.
    expect(res.body.messages.map((m: any) => m.text)).toEqual(["letter 0", "letter 1"]);
  });

  it("the key alone reads the notes of the person the page names", async () => {
    fake.answer = thread([{ ...letterRow(0, "2026-11-27 09:00:00+00"), provider_id: V2 }], []);
    await call("GET", "/thread?key=gm%3At1");
    expect(has(notesRead(), "eq", "person_key", `vendor:${V2}`)).toBe(true);
  });

  it("each page holds the notes between its letters, none twice", async () => {
    const rows = Array.from({ length: MAIL_THREAD_PAGE + 1 }, (_, i) =>
      letterRow(i, `2026-11-${String(27 - Math.floor(i / 10)).padStart(2, "0")} ${String(23 - (i % 10)).padStart(2, "0")}:00:00+00`),
    );
    fake.answer = thread(rows, []);
    await call("GET", `/thread?key=gm%3At1&with=vendor%3A${VENDOR}`);
    // Newest page: from its oldest letter on.
    const oldestKept = rows[MAIL_THREAD_PAGE - 1].at;
    expect(has(notesRead(), "gte", "created_at", oldestKept)).toBe(true);
    expect(notesRead().calls.some(([m]) => m === "lt")).toBe(false);

    fake.reads = [];
    const before = encodeMailCursor("2026-11-20 08:00:00+00", rows[0].id);
    fake.answer = thread([letterRow(0, "2026-11-20 07:00:00+00")], []);
    await call("GET", `/thread?key=gm%3At1&with=vendor%3A${VENDOR}&before=${encodeURIComponent(before)}`);
    // The oldest page: everything before the newer page's oldest letter.
    expect(has(notesRead(), "lt", "created_at", "2026-11-20 08:00:00+00")).toBe(true);
    expect(notesRead().calls.some(([m]) => m === "gte")).toBe(false);
  });

  it("notes that cannot be read are said to be unread; the letters still show", async () => {
    fake.answer = thread([letterRow(0, "2026-11-27 09:00:00+00")], "fail");
    const res = await call("GET", `/thread?key=gm%3At1&with=vendor%3A${VENDOR}`);
    expect(res.status).toBe(200);
    expect(res.body.notesRead).toBe(false);
    expect(res.body.notes).toEqual([]);
    expect(res.body.messages).toHaveLength(1);
  });

  it("a thread whose letters are all gone still shows its notes, under the person", async () => {
    fake.answer = thread([], [stored()]);
    const res = await call("GET", `/thread?key=gm%3At1&with=vendor%3A${VENDOR}`, { role: "staff" });
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.person).toEqual({ key: `vendor:${VENDOR}`, kind: "vendor", providerId: VENDOR, name: "Ali Balık" });
    expect(res.body.notes.map((n: any) => n.id)).toEqual([NOTE]);
    expect(has(named("providers")[0], "eq", "restaurant_id", HOUSE_A)).toBe(true);
  });

  it("no letters and no notes is the empty page it always was", async () => {
    fake.answer = thread([], []);
    const res = await call("GET", `/thread?key=gm%3At1&with=vendor%3A${VENDOR}`);
    expect(res.body.person).toBeNull();
    expect(named("providers")).toHaveLength(0);
  });

  it("a caller who may not read a team thread reads none of its notes", async () => {
    fake.answer = thread([], [stored()]);
    const res = await call("GET", "/thread?key=mid%3Ax&with=team%3Aayse%40house.test", { role: "staff" });
    expect(res.body.notes).toEqual([]);
    expect(named("mail_thread_notes")).toHaveLength(0);
  });

  it("a key alone with no letters names no person, so no notes are read", async () => {
    fake.answer = thread([], [stored()]);
    const res = await call("GET", "/thread?key=gm%3At1", { role: "staff" });
    expect(res.body.notes).toEqual([]);
    expect(named("mail_thread_notes")).toHaveLength(0);
  });
});

describe("a note is never mail", () => {
  // Only the notes module (and its tests) may name the table: a composer, a
  // preview, a seal, a draft writer or any outbound path that wanted a note
  // would have to name it, and would fail here.
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const ALLOWED = new Set([
    "apps/api-gateway/src/conversations/mail.thread-notes.ts",
    "apps/api-gateway/src/conversations/mail.thread-notes.spec.ts",
    "apps/api-gateway/src/conversations/mail.thread-notes.read.spec.ts",
    "apps/api-gateway/src/conversations/mail.thread-notes.testing.ts",
    // These count the reads a thread page makes.
    "apps/api-gateway/src/conversations/mail.service.spec.ts",
    "apps/api-gateway/src/conversations/mail.every-kind.spec.ts",
    "apps/api-gateway/src/conversations/mail.controller.spec.ts",
  ]);
  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "venv", "__pycache__", "dist", "build"].includes(name) || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) yield* files(p);
      else if (/\.(ts|tsx|js|mjs|py)$/.test(name)) yield p;
    }
  }

  it("no code but the notes module names mail_thread_notes", () => {
    const hits: string[] = [];
    for (const top of ["apps/api-gateway/src", "apps/web/src", "apps/mobile/src", "services"]) {
      let dir: string;
      try {
        dir = join(ROOT, top);
        statSync(dir);
      } catch {
        continue;
      }
      for (const f of files(dir)) {
        const rel = f.slice(ROOT.length + 1);
        if (!ALLOWED.has(rel) && readFileSync(f, "utf8").includes("mail_thread_notes")) hits.push(rel);
      }
    }
    expect(hits).toEqual([]);
  });

  it("MailService reaches the table only through the notes module", () => {
    const service = readFileSync(join(__dirname, "mail.service.ts"), "utf8");
    expect(service).not.toContain("mail_thread_notes");
    expect(service).toContain('from "./mail.thread-notes"');
  });
});
