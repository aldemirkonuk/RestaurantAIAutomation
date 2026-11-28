/**
 * The house's notes on a Mail thread (r110 mail-gap g5): writing and deleting
 * one at the HTTP seam (mail.thread-notes.testing.ts). The thread page's
 * notes, and that no other code can reach one, are pinned in
 * mail.thread-notes.read.spec.ts.
 */
import { NOTES_PER_THREAD } from "./mail.thread-notes";
import {
  AYSE,
  HOUSE_A,
  HOUSE_B,
  MEHMET,
  NOTE,
  VENDOR,
  call,
  fake,
  has,
  isWrite,
  named,
  stored,
  useNotesApp,
  writing,
  type Answer,
  type Read,
} from "./mail.thread-notes.testing";

useNotesApp();

const POST = (key = "gm%3At1", w = `vendor%3A${VENDOR.toUpperCase()}`) => `/thread/notes?key=${key}&with=${w}`;

describe("POST /mail/thread/notes?key=&with=", () => {
  it("keeps the note under the token's house, the person and the key, written by the caller", async () => {
    fake.answer = writing(3);
    const res = await call("POST", `${POST("gm%3At%2F1")}&restaurantId=${HOUSE_B}`, {
      body: { body: "  They promised a credit on the phone \n" },
    });
    expect(res.status).toBe(201);
    const insert = named("mail_thread_notes").find((r) => r.calls.some(([m]) => m === "insert"))!;
    expect(insert.calls.find(([m]) => m === "insert")![1][0]).toEqual({
      restaurant_id: HOUSE_A,
      person_key: `vendor:${VENDOR}`,
      thread_key: "gm:t/1",
      body: "They promised a credit on the phone",
      written_by: AYSE,
    });
    expect(res.body).toEqual({
      id: NOTE,
      body: "They promised a credit on the phone",
      createdAt: "2026-11-27 10:00:00+00",
      writtenBy: { id: AYSE, name: "Ayşe" },
      mine: true,
    });
    expect(JSON.stringify(fake.reads)).not.toContain(HOUSE_B);
  });

  it("takes the house and the writer from the token, never the body", async () => {
    fake.answer = writing(0);
    const res = await call("POST", POST(), {
      body: { body: "Chase Friday", restaurant_id: HOUSE_B, written_by: MEHMET },
    });
    // Extra keys are not read; the pipe does not refuse an untyped body.
    expect(res.status).toBe(201);
    const insert = named("mail_thread_notes").find((r) => r.calls.some(([m]) => m === "insert"))!;
    expect(insert.calls.find(([m]) => m === "insert")![1][0]).toMatchObject({
      restaurant_id: HOUSE_A,
      written_by: AYSE,
    });
  });

  it("a manager may write; a team or guest thread keeps its note under that person", async () => {
    fake.answer = writing(0);
    const res = await call("POST", POST("mid%3Ax", "team%3AAyse%40House.test"), {
      role: "Manager",
      body: { body: "Covered Friday" },
    });
    expect(res.status).toBe(201);
    const insert = named("mail_thread_notes").find((r) => r.calls.some(([m]) => m === "insert"))!;
    expect(insert.calls.find(([m]) => m === "insert")![1][0]).toMatchObject({
      person_key: "team:ayse@house.test",
      thread_key: "mid:x",
    });
  });

  it.each([["staff"], ["chef"], [null]])("%s may read but not write: 403 in words, nothing read or written", async (role) => {
    fake.answer = writing(0);
    const res = await call("POST", POST(), { role, body: { body: "x" } });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Only the house's owner or a manager can leave a note on a thread.");
    expect(fake.reads).toHaveLength(0);
  });

  it.each([
    ["no words", { body: "   " }, "Write the note first."],
    ["no body", {}, "Write the note first."],
    ["not text", { body: 42 }, "Write the note first."],
    ["1001 characters", { body: "a".repeat(1001) }, "A note holds at most 1000 characters."],
  ])("%s is a 400 in words and writes nothing", async (_l, body, words) => {
    fake.answer = writing(0);
    const res = await call("POST", POST(), { body });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(words);
    expect(fake.reads.filter(isWrite)).toHaveLength(0);
  });

  it("1000 characters is a note", async () => {
    fake.answer = writing(0);
    const res = await call("POST", POST(), { body: { body: "a".repeat(1000) } });
    expect(res.status).toBe(201);
  });

  it.each([
    ["no person", "/thread/notes?key=gm%3At1"],
    ["no key", `/thread/notes?with=vendor%3A${VENDOR}`],
    ["a bare id", `/thread/notes?key=gm%3At1&with=${VENDOR}`],
    ["a key over 500", `/thread/notes?key=${"k".repeat(501)}&with=vendor%3A${VENDOR}`],
  ])("%s names no thread: 400, nothing written", async (_l, path) => {
    fake.answer = writing(0);
    const res = await call("POST", path, { body: { body: "x" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Name the thread and its person.");
    expect(fake.reads.filter(isWrite)).toHaveLength(0);
  });

  it("counts only this thread's live notes, and a full thread takes no more (409)", async () => {
    fake.answer = writing(NOTES_PER_THREAD);
    const res = await call("POST", POST(), { body: { body: "one more" } });
    expect(res.status).toBe(409);
    expect(fake.reads.filter(isWrite)).toHaveLength(0);
    const count = named("mail_thread_notes")[0];
    expect(has(count, "eq", "restaurant_id", HOUSE_A)).toBe(true);
    expect(has(count, "eq", "person_key", `vendor:${VENDOR}`)).toBe(true);
    expect(has(count, "eq", "thread_key", "gm:t1")).toBe(true);
    expect(has(count, "is", "deleted_at", null)).toBe(true);

    fake.reads = [];
    fake.answer = writing(NOTES_PER_THREAD - 1);
    expect((await call("POST", POST(), { body: { body: "the last one" } })).status).toBe(201);
  });

  it("a count that cannot be read, or a write that fails, is a 503 in words, never a saved note", async () => {
    fake.answer = writing(null, { countError: true });
    let res = await call("POST", POST(), { body: { body: "x" } });
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("The note could not be saved just now, so nothing changed. Try again.");
    expect(fake.reads.filter(isWrite)).toHaveLength(0);

    // No count at all is not "none yet".
    fake.answer = writing(null);
    res = await call("POST", POST(), { body: { body: "x" } });
    expect(res.status).toBe(503);
    expect(fake.reads.filter(isWrite)).toHaveLength(0);

    fake.answer = writing(0, { insertError: true });
    res = await call("POST", POST(), { body: { body: "x" } });
    expect(res.status).toBe(503);
  });

  it("a session that names no person keeps no note", async () => {
    fake.answer = writing(0);
    const res = await call("POST", POST(), { user: "not-a-user", body: { body: "x" } });
    expect(res.status).toBe(403);
    expect(fake.reads.filter(isWrite)).toHaveLength(0);
  });
});

describe("DELETE /mail/thread/notes/:id", () => {
  const found = (row: Record<string, unknown> | null, updateError = false) => (r: Read): Answer => {
    if (r.name !== "mail_thread_notes") return { data: [] };
    if (r.calls.some(([m]) => m === "update")) return updateError ? { error: { message: "x" } } : { data: [{ id: NOTE }] };
    return { data: row ? [row] : [] };
  };
  const updateOf = () => named("mail_thread_notes").find((r) => r.calls.some(([m]) => m === "update"));

  it("deletes the writer's own note in the token's house, and keeps the row", async () => {
    fake.answer = found(stored({ deleted_at: null }));
    const res = await call("DELETE", `/thread/notes/${NOTE.toUpperCase()}?restaurantId=${HOUSE_B}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: NOTE, deleted: true });
    const u = updateOf()!;
    expect(has(u, "eq", "restaurant_id", HOUSE_A)).toBe(true);
    expect(has(u, "eq", "id", NOTE)).toBe(true);
    expect(has(u, "eq", "written_by", AYSE)).toBe(true);
    expect(has(u, "is", "deleted_at", null)).toBe(true);
    expect(fake.reads.some((r) => r.calls.some(([m]) => m === "delete"))).toBe(false);
    expect(has(named("mail_thread_notes")[0], "eq", "restaurant_id", HOUSE_A)).toBe(true);
  });

  it("is the writer's whatever their role is now, and never before the note was written", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    fake.answer = found(stored({ created_at: future, deleted_at: null }));
    const res = await call("DELETE", `/thread/notes/${NOTE}`, { role: "staff" });
    expect(res.status).toBe(200);
    const set = updateOf()!.calls.find(([m]) => m === "update")![1][0] as { deleted_at: string };
    expect(Date.parse(set.deleted_at)).toBe(Date.parse(future));
  });

  it("someone else's note is a 403 in words, and nothing changes — owner included", async () => {
    fake.answer = found(stored({ written_by: MEHMET, deleted_at: null }));
    const res = await call("DELETE", `/thread/notes/${NOTE}`, { role: "owner" });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Only the person who wrote a note can delete it.");
    expect(updateOf()).toBeUndefined();
  });

  it.each([
    ["another house's or no note", NOTE, null],
    ["an id that is not one", "nope", null],
  ])("%s is not found, never 'not yours'", async (_l, id, row) => {
    fake.answer = found(row);
    const res = await call("DELETE", `/thread/notes/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("That note is not on this house's mail.");
    expect(updateOf()).toBeUndefined();
  });

  it("a note already deleted by its writer is done, not an error", async () => {
    fake.answer = found(stored({ deleted_at: "2026-11-27 11:00:00+00" }));
    const res = await call("DELETE", `/thread/notes/${NOTE}`);
    expect(res.status).toBe(200);
    expect(updateOf()).toBeUndefined();
  });

  it("a delete that fails says the note is still there (503)", async () => {
    fake.answer = found(stored({ deleted_at: null }), true);
    const res = await call("DELETE", `/thread/notes/${NOTE}`);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe("The note could not be deleted just now, so it is still there. Try again.");
  });
});
