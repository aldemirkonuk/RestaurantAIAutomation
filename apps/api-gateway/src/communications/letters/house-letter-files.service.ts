/**
 * A letter's files, g6b step 1 (DD-r107-11 / DD-r108-6, r109): where the bytes
 * wait between the upload and the letter leaving, and the binding the seal holds.
 *
 * THE RULE (DD-r107-11, word for word in effect)
 * ----------------------------------------------
 * The seal stores each file's sha-256, size and house-prefixed path when the
 * letter is queued. At release the gateway re-reads each file from the private
 * bucket and refuses the WHOLE letter if any hash, size or house prefix differs
 * or any file is missing (house-letters.service.ts, dispatcher, g6b step 2).
 * The caps (3 files, 5 MB in all) are asked here, at the request, and again at
 * release. Files are uploaded only: no URL, no path, from the caller. Owner and
 * manager only.
 *
 * WHY THE SERVER HASHES
 * ---------------------
 * The sha-256 and size are computed here from the bytes received, never taken
 * from the request. A caller-supplied hash would let the seal bind a hash of
 * bytes nobody uploaded.
 *
 * Session's call (r109, founder delegated 2026-11-07): the upload is base64
 * inside JSON, the house's convention for every upload (menu, receipts; main.ts
 * sizes the 15 MB body limit for it), so 5 MB of files (~6.7 MB encoded) fits
 * with no new interceptor or type package. Rejected: multipart via multer,
 * which needs @types/multer and buffers the same bytes in memory anyway.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { DatabaseService } from "../../database/database.service";
import {
  AttachmentRefusedError,
  OUTBOUND_ATTACHMENT_MAX_BYTES,
  OUTBOUND_ATTACHMENT_MAX_FILES,
  assertMayAttach,
  assertWithinLimits,
  safeFilename,
  type OutboundAttachment,
} from "../mime-attachments";

export const LETTER_FILES_BUCKET = "letter-files";

/** What the seal holds of each file, and what release compares the bytes to. */
export interface SealedFile {
  id: string;
  sha256: string;
  size: number;
}

export interface UploadedLetterFile {
  name: string;
  contentType: string;
  contentBase64: string;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Strict base64: what decodes must encode back to the same text. */
function decode(text: string, name: string): Buffer {
  const clean = String(text ?? "").replace(/\s+/g, "");
  const bytes = Buffer.from(clean, "base64");
  if (!clean || bytes.toString("base64").replace(/=+$/, "") !== clean.replace(/=+$/, "")) {
    throw new BadRequestException(`The file ${safeFilename(name)} did not arrive whole. Nothing was uploaded.`);
  }
  return bytes;
}

function refusal(err: unknown): never {
  if (err instanceof AttachmentRefusedError) {
    if (err.refusal === "staff") throw new ForbiddenException(err.message);
    throw new UnprocessableEntityException(`${err.message} Nothing was uploaded.`);
  }
  throw err;
}

@Injectable()
export class HouseLetterFilesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Store up to 3 files (5 MB in all) for a letter not yet queued. Each object
   * goes to `<restaurant_id>/<uuid>` in the private bucket and its row records
   * the server's own sha-256 and size. Returns the ids the composer sends back
   * as `fileIds`.
   */
  async upload(params: {
    restaurantId: string;
    userId: string;
    role: string | null | undefined;
    files: UploadedLetterFile[];
  }): Promise<Array<{ id: string; name: string; contentType: string; size: number; sha256: string }>> {
    const decoded = (params.files ?? []).map((f) => ({
      filename: safeFilename(f.name),
      contentType: f.contentType,
      content: decode(f.contentBase64, f.name),
    }));
    if (!decoded.length) throw new BadRequestException("No file was sent. Nothing was uploaded.");
    try {
      assertMayAttach(params.role, decoded);
    } catch (err) {
      refusal(err);
    }
    const rows = decoded.map((f) => {
      const id = randomUUID();
      return {
        id,
        restaurant_id: params.restaurantId,
        path: `${params.restaurantId}/${id}`,
        name: f.filename,
        content_type: f.contentType,
        size: f.content.length,
        sha256: sha256(f.content),
        uploaded_by: params.userId,
        bytes: f.content,
      };
    });
    const stored: string[] = [];
    for (const r of rows) {
      const { error } = await this.db.supabase.storage
        .from(LETTER_FILES_BUCKET)
        .upload(r.path, r.bytes, { contentType: r.content_type, upsert: false });
      if (error) {
        await this.forget(stored);
        throw new ServiceUnavailableException(
          `The file ${r.name} could not be stored (${error.message}). Nothing was uploaded.`,
        );
      }
      stored.push(r.path);
    }
    const { error } = await this.db.supabase
      .from("house_letter_files")
      .insert(rows.map(({ bytes: _bytes, ...row }) => row));
    if (error) {
      await this.forget(stored);
      throw new ServiceUnavailableException(`The files could not be recorded (${error.message}). Nothing was uploaded.`);
    }
    return rows.map((r) => ({ id: r.id, name: r.name, contentType: r.content_type, size: r.size, sha256: r.sha256 }));
  }

  /**
   * The files a letter names, as the seal will hold them: read by id AND
   * restaurant_id, in the order named. Refuses with a sentence when an id is
   * missing or another house's, already on a letter, named twice, or the set is
   * over 3 files or 5 MB. Never returns a partial list.
   */
  async sealedFiles(restaurantId: string, fileIds: readonly string[] | undefined): Promise<SealedFile[]> {
    const ids = [...(fileIds ?? [])];
    if (!ids.length) return [];
    if (new Set(ids).size !== ids.length) {
      throw new UnprocessableEntityException("The letter names the same file twice. Nothing was queued and nothing was sent.");
    }
    if (ids.length > OUTBOUND_ATTACHMENT_MAX_FILES) {
      throw new UnprocessableEntityException(
        `A letter can carry ${OUTBOUND_ATTACHMENT_MAX_FILES} files at most; this one names ${ids.length}. Nothing was queued and nothing was sent.`,
      );
    }
    const { data, error } = await this.db.supabase
      .from("house_letter_files")
      .select("id, restaurant_id, path, size, sha256, letter_id")
      .eq("restaurant_id", restaurantId)
      .in("id", ids);
    if (error) {
      throw new ServiceUnavailableException(
        `The letter's files could not be read (${error.message}). Nothing was queued and nothing was sent.`,
      );
    }
    const byId = new Map((data ?? []).map((r: any) => [String(r.id), r]));
    const files = ids.map((id) => {
      const r = byId.get(id);
      if (!r || r.restaurant_id !== restaurantId || !String(r.path ?? "").startsWith(`${restaurantId}/`)) {
        throw new UnprocessableEntityException(
          "A file this letter names is not one this house uploaded. Attach it again. Nothing was queued and nothing was sent.",
        );
      }
      if (r.letter_id) {
        throw new ConflictException(
          "A file this letter names is already on another letter. Attach it again. Nothing was queued and nothing was sent.",
        );
      }
      return { id, sha256: String(r.sha256), size: Number(r.size) };
    });
    if (files.reduce((n, f) => n + f.size, 0) > OUTBOUND_ATTACHMENT_MAX_BYTES) {
      throw new UnprocessableEntityException(
        `The files together are over ${OUTBOUND_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB. Nothing was queued and nothing was sent.`,
      );
    }
    return files;
  }

  /**
   * Tie the sealed files to the letter that now exists. Conditional on each
   * being this house's and on no letter yet, so a file can travel once. Throws
   * unless every file was tied.
   */
  async bind(restaurantId: string, letterId: string, files: readonly SealedFile[]): Promise<void> {
    if (!files.length) return;
    const { data, error } = await this.db.supabase
      .from("house_letter_files")
      .update({ letter_id: letterId })
      .eq("restaurant_id", restaurantId)
      .is("letter_id", null)
      .in("id", files.map((f) => f.id))
      .select("id");
    if (error || (data ?? []).length !== files.length) {
      throw new Error(error?.message ?? `${(data ?? []).length} of ${files.length} files were tied`);
    }
  }

  /**
   * RELEASE (g6b step 2): the files a queued letter may carry, re-read from the
   * bucket and compared to what its seal held (`email_headers.files`). Rows are
   * read by letter_id AND restaurant_id. THROWS, with the sentence the
   * dispatcher records, if the rows are not exactly the sealed files, a path is
   * outside the house, a row or its bytes differ in sha-256 or size, an object
   * is missing, or the set is over the caps: the WHOLE letter is refused and
   * nothing of it leaves. A letter that sealed no files and has none tied
   * returns [] after one read.
   */
  async releaseFiles(restaurantId: string, letterId: string, sealed: unknown): Promise<OutboundAttachment[]> {
    const refuse = (why: string): never => {
      throw new Error(`Its files did not match what was approved (${why}), so the whole letter was held back and nothing of it was sent.`);
    };
    const list = sealed === undefined || sealed === null ? [] : sealed;
    if (!Array.isArray(list) || list.length > OUTBOUND_ATTACHMENT_MAX_FILES) refuse("the sealed list is not readable");
    const want = (list as unknown[]).map((f) => {
      const x = (f ?? {}) as Record<string, unknown>;
      if (typeof x.id !== "string" || typeof x.sha256 !== "string" || typeof x.size !== "number") refuse("the sealed list is not readable");
      return { id: x.id as string, sha256: x.sha256 as string, size: x.size as number };
    });
    const { data, error } = await this.db.supabase
      .from("house_letter_files")
      .select("id, restaurant_id, path, name, content_type, size, sha256")
      .eq("letter_id", letterId)
      .eq("restaurant_id", restaurantId);
    if (error) throw new Error(`Its files could not be read (${error.message}), so the whole letter was held back and nothing of it was sent.`);
    const rows = new Map((data ?? []).map((r: any) => [String(r.id), r]));
    if (rows.size !== want.length || want.some((w) => !rows.has(w.id))) refuse("a file it carries is missing, or one it does not carry is tied to it");
    const out: OutboundAttachment[] = [];
    for (const w of want) {
      const r = rows.get(w.id);
      if (r.restaurant_id !== restaurantId || !String(r.path ?? "").startsWith(`${restaurantId}/`)) refuse("a file is not in this house");
      if (r.sha256 !== w.sha256 || Number(r.size) !== w.size) refuse("a file's record changed after the seal");
      const { data: blob, error: readError } = await this.db.supabase.storage.from(LETTER_FILES_BUCKET).download(r.path);
      if (readError || !blob) refuse(`the file ${safeFilename(r.name)} could not be read: ${readError?.message ?? "no bytes"}`);
      const bytes = Buffer.from(await (blob as Blob).arrayBuffer());
      if (bytes.length !== w.size || sha256(bytes) !== w.sha256) refuse(`the file ${safeFilename(r.name)} was replaced after the seal`);
      out.push({ filename: String(r.name), contentType: String(r.content_type), content: bytes });
    }
    try {
      assertWithinLimits(out);
    } catch (err) {
      refuse(err instanceof Error ? err.message : String(err));
    }
    return out;
  }

  private async forget(paths: string[]): Promise<void> {
    if (!paths.length) return;
    try {
      await this.db.supabase.storage.from(LETTER_FILES_BUCKET).remove(paths);
    } catch {
      // Best effort: an object no row names is never sent, because release
      // reads the rows, and the row is what was not written.
    }
  }
}
