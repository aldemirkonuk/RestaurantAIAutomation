/**
 * The house's own notes on a Mail thread (r110 mail-gap g5; Front's internal
 * comments, Help Scout's notes). Table `mail_thread_notes`: service role only.
 *
 *   - A thread is (person, key), as mail_thread_letters reads it: a note on
 *     one vendor's thread never shows on another's under the same key.
 *   - Owners and managers write; every reader of the thread reads; only the
 *     writer deletes their own.
 *   - A note is the house's, not a letter's or a grant's: letters removed by
 *     retention or revoke-by-provenance leave it, shown under the person.
 *   - A note is never mail: this is the only code that names the table
 *     (mail.thread-notes.read.spec.ts scans for it).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PERSON_KEY_RE, UUID_RE, otherPersonOf } from "./mail.read-rules";
import type { MailThreadNote } from "./mail.types";

export const NOTE_TABLE = "mail_thread_notes";
export const NOTE_MAX_CHARS = 1000;
/** Live notes one thread may hold; the read takes this many and a few more. */
export const NOTES_PER_THREAD = 200;
const NOTES_READ_LIMIT = NOTES_PER_THREAD + 50;

export const NOTE_NOT_YOURS_TO_WRITE =
  "Only the house's owner or a manager can leave a note on a thread.";
export const NOTE_NOT_YOURS_TO_DELETE =
  "Only the person who wrote a note can delete it.";
export const NOTE_EMPTY = "Write the note first.";
export const NOTE_TOO_LONG = `A note holds at most ${NOTE_MAX_CHARS} characters.`;
export const NOTE_NO_THREAD = "Name the thread and its person.";
export const NOTE_NO_PERSON =
  "This session names no person, so a note cannot be kept.";
export const NOTE_FULL = `This thread already holds ${NOTES_PER_THREAD} notes. Delete one before adding another.`;
export const NOTE_NOT_FOUND = "That note is not on this house's mail.";
export const NOTE_FAILED =
  "The note could not be saved just now, so nothing changed. Try again.";
export const NOTE_DELETE_FAILED =
  "The note could not be deleted just now, so it is still there. Try again.";

type Db = { from: (table: string) => any };

/**
 * The Mail person key a note is kept under: `vendor:<uuid>` or
 * `team|guest:<address>`, lower case; null when the value names no person.
 */
export function notePersonKeyOf(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  const vendor = PERSON_KEY_RE.exec(text)?.[1];
  if (vendor) return `vendor:${vendor.toLowerCase()}`;
  const other = otherPersonOf(text);
  return other ? `${other.kind}:${other.address}` : null;
}

export function noteThreadKeyOf(raw: unknown): string | null {
  const key = typeof raw === "string" ? raw.trim() : "";
  return key && key.length <= 500 ? key : null;
}

/** The words a note keeps: trimmed, never empty, at most 1000 characters. */
export function noteBodyOf(raw: unknown): string {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) throw new BadRequestException(NOTE_EMPTY);
  if (body.length > NOTE_MAX_CHARS) throw new BadRequestException(NOTE_TOO_LONG);
  return body;
}

function isUser(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** The writers' names, by public.users.user_id. A failed read names nobody; the notes still show. */
async function writerNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  try {
    const { data, error } = await db
      .from("users")
      .select("user_id, name")
      .in("user_id", ids);
    if (error) return out;
    for (const u of (data ?? []) as any[]) {
      const name = typeof u.name === "string" ? u.name.trim() : "";
      if (u.user_id && name) out.set(String(u.user_id), name);
    }
  } catch {
    /* names are a courtesy: the notes are shown without them */
  }
  return out;
}

function noteOf(row: any, names: Map<string, string>, userId: string | null): MailThreadNote {
  const by = String(row.written_by);
  return {
    id: String(row.id),
    body: String(row.body),
    createdAt: String(row.created_at),
    writtenBy: { id: by, name: names.get(by) ?? null },
    mine: userId !== null && by === userId,
  };
}

/**
 * The live notes of one thread written in [from, before), oldest first, so
 * each page of letters carries the notes that fall between its letters and
 * none twice. `from` null = since the thread began; `before` null = up to now.
 * Null when the notes could not be read: the page must say so, never show none.
 */
export async function readThreadNotes(
  db: Db,
  houseId: string,
  personKey: string,
  threadKey: string,
  window: { from: string | null; before: string | null },
  userId: string | null | undefined,
): Promise<MailThreadNote[] | null> {
  try {
    let q = db
      .from(NOTE_TABLE)
      .select("id, body, written_by, created_at")
      .eq("restaurant_id", houseId)
      .eq("person_key", personKey)
      .eq("thread_key", threadKey)
      .is("deleted_at", null);
    if (window.from) q = q.gte("created_at", window.from);
    if (window.before) q = q.lt("created_at", window.before);
    const { data, error } = await q
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(NOTES_READ_LIMIT);
    if (error) return null;
    // Only rows of the shape this table stores are notes.
    const rows = ((data ?? []) as any[]).filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.body === "string" &&
        typeof r.created_at === "string" &&
        isUser(r.written_by),
    );
    const names = await writerNames(db, [
      ...new Set(rows.map((r) => String(r.written_by))),
    ]);
    return rows.map((r) => noteOf(r, names, isUser(userId) ? userId : null));
  } catch {
    return null;
  }
}

/** A vendor's name for a notes-only page; null when it cannot be read. */
export async function vendorName(
  db: Db,
  houseId: string,
  providerId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("providers")
      .select("name")
      .eq("restaurant_id", houseId)
      .eq("id", providerId)
      .limit(1);
    if (error) return null;
    const name = ((data ?? []) as any[])[0]?.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Keep a note on (person, key). The caller's house and person are the
 * token's; the role was checked by the caller. A thread holding 200 live notes
 * takes no more, so the read above is never a capped part of the notes.
 */
export async function writeThreadNote(
  db: Db,
  houseId: string,
  userId: string | null | undefined,
  opts: { key?: unknown; with?: unknown; body?: unknown },
): Promise<MailThreadNote> {
  const threadKey = noteThreadKeyOf(opts.key);
  const personKey = notePersonKeyOf(opts.with);
  if (!threadKey || !personKey) throw new BadRequestException(NOTE_NO_THREAD);
  const body = noteBodyOf(opts.body);
  if (!isUser(userId)) throw new ForbiddenException(NOTE_NO_PERSON);

  const live = await db
    .from(NOTE_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", houseId)
    .eq("person_key", personKey)
    .eq("thread_key", threadKey)
    .is("deleted_at", null);
  if (live.error || typeof live.count !== "number") {
    throw new ServiceUnavailableException(NOTE_FAILED);
  }
  if (live.count >= NOTES_PER_THREAD) throw new ConflictException(NOTE_FULL);

  const { data, error } = await db
    .from(NOTE_TABLE)
    .insert({
      restaurant_id: houseId,
      person_key: personKey,
      thread_key: threadKey,
      body,
      written_by: userId,
    })
    .select("id, body, written_by, created_at")
    .limit(1);
  const row = ((data ?? []) as any[])[0];
  if (error || !row) throw new ServiceUnavailableException(NOTE_FAILED);
  const names = await writerNames(db, [userId]);
  return noteOf(row, names, userId);
}

/**
 * Delete the caller's own note: it stops showing, and the row is kept with
 * its deleted_at. Another house's note, or one that names nothing, is "not
 * found" — never "not yours", which would say it exists. Deleting a note
 * already deleted by its writer is done, not an error.
 */
export async function deleteThreadNote(
  db: Db,
  houseId: string,
  userId: string | null | undefined,
  noteId: unknown,
): Promise<{ id: string; deleted: true }> {
  const id = typeof noteId === "string" ? noteId.trim().toLowerCase() : "";
  if (!UUID_RE.test(id)) throw new NotFoundException(NOTE_NOT_FOUND);
  if (!isUser(userId)) throw new ForbiddenException(NOTE_NO_PERSON);

  const found = await db
    .from(NOTE_TABLE)
    .select("id, written_by, created_at, deleted_at")
    .eq("restaurant_id", houseId)
    .eq("id", id)
    .limit(1);
  if (found.error) throw new ServiceUnavailableException(NOTE_DELETE_FAILED);
  const row = ((found.data ?? []) as any[])[0];
  if (!row) throw new NotFoundException(NOTE_NOT_FOUND);
  if (String(row.written_by) !== userId) {
    throw new ForbiddenException(NOTE_NOT_YOURS_TO_DELETE);
  }
  if (row.deleted_at) return { id, deleted: true };

  // Never before the note was written, whatever this server's clock says.
  const written = Date.parse(String(row.created_at));
  const at = new Date(Math.max(Date.now(), Number.isFinite(written) ? written : 0));
  const { error } = await db
    .from(NOTE_TABLE)
    .update({ deleted_at: at.toISOString() })
    .eq("restaurant_id", houseId)
    .eq("id", id)
    .eq("written_by", userId)
    .is("deleted_at", null)
    .select("id");
  // Zero rows updated means a second delete won the race: the same outcome.
  if (error) throw new ServiceUnavailableException(NOTE_DELETE_FAILED);
  return { id, deleted: true };
}
