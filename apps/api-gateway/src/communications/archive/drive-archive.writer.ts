/**
 * The four Google Drive calls an export makes, and nothing else.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * The service below it decides WHAT to export and records what happened; this
 * decides how to say it to Google. Keeping them apart is what lets every spec in
 * this module run with a fixtured `fetch` and no network — the same seam
 * `house-inbox.service.ts` uses (`fetchImpl`), for the same reason: a test that
 * needs a real Google account is a test nobody runs.
 *
 * THE SCOPE THIS RUNS UNDER, MEASURED
 * -----------------------------------
 * `https://www.googleapis.com/auth/drive.file`, already consented on the
 * `google_drive` grant (`integrations-oauth.constants.ts:96`). It is Google's
 * create-and-manage scope for files THE APP ITSELF CREATED. All four calls here
 * are inside it:
 *
 *   1. `files.list`   — with `drive.file` this returns ONLY files this app
 *                       created, which is precisely the set we need (our own
 *                       archive folders) and cannot see the person's own
 *                       documents. The narrowness is the scope's, not ours.
 *   2. `files.create` — a folder.
 *   3. `files.create` (upload) — the document.
 *   4. `files.get?alt=media` — reading back what we just wrote, to verify it.
 *
 * No scope is widened by this build and none is asked for. If Google refuses a
 * call the refusal is returned in words, with its status, and the caller records
 * it as a FAILED export — never as "nothing to export".
 *
 * THE REQUEST AND RESPONSE SHAPES ARE RECORDED HERE
 * ------------------------------------------------
 * so the fixtures in `drive-archive.writer.spec.ts` are a transcript of this
 * file rather than a guess about Google:
 *
 *   GET  https://www.googleapis.com/drive/v3/files
 *          ?q=<query>&spaces=drive&pageSize=1&fields=files(id,name)
 *        -> 200 {"files":[{"id":"...","name":"..."}]}
 *   POST https://www.googleapis.com/drive/v3/files?fields=id,name
 *        Content-Type: application/json
 *        {"name":"...","mimeType":"application/vnd.google-apps.folder",
 *         "parents":["<parent id>"]}
 *        -> 200 {"id":"...","name":"..."}
 *   POST https://www.googleapis.com/upload/drive/v3/files
 *          ?uploadType=multipart&fields=id,name,size
 *        Content-Type: multipart/related; boundary=<b>
 *        -> 200 {"id":"...","name":"...","size":"4096"}
 *   GET  https://www.googleapis.com/drive/v3/files/<id>?alt=media
 *        -> 200 <the bytes>
 */

import { Injectable, Logger } from "@nestjs/common";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
}

/**
 * Escape a value for a Drive `q` clause. Drive's query language is
 * single-quoted with backslash escapes; a vendor called `O'Brien Wines` is a
 * perfectly ordinary name and an unescaped apostrophe would make the query a
 * syntax error rather than a wrong answer, so this is correctness and not
 * defence.
 */
export function driveQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

@Injectable()
export class DriveArchiveWriter {
  private readonly logger = new Logger(DriveArchiveWriter.name);

  /** The seam every spec replaces. Never called with a real token in tests. */
  fetchImpl: typeof fetch = fetch;

  /**
   * The folder at `path`, creating each missing segment.
   *
   * `parentId` of `null` means My Drive's root, which is where the archive's
   * top folder goes. Each segment is looked up first: an export that created a
   * second "Mudavym mail archive" every night would scatter one house's mail
   * across a folder per run.
   */
  async ensureFolderPath(
    token: string,
    segments: string[],
    parentId: string | null = null,
  ): Promise<DriveFile> {
    let parent = parentId;
    let last: DriveFile | null = null;
    for (const segment of segments) {
      last = await this.ensureFolder(token, segment, parent);
      parent = last.id;
    }
    if (!last) {
      throw new Error(
        "No folder path was given, so no archive folder could be resolved. An export with nowhere to write is a failure, not an empty run.",
      );
    }
    return last;
  }

  async ensureFolder(
    token: string,
    name: string,
    parentId: string | null,
  ): Promise<DriveFile> {
    const clauses = [
      `name = ${driveQueryLiteral(name)}`,
      `mimeType = ${driveQueryLiteral(FOLDER_MIME)}`,
      "trashed = false",
      parentId
        ? `${driveQueryLiteral(parentId)} in parents`
        : "'root' in parents",
    ];
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set("q", clauses.join(" and "));
    url.searchParams.set("spaces", "drive");
    url.searchParams.set("pageSize", "1");
    url.searchParams.set("fields", "files(id,name)");

    const found = await this.json<{ files?: DriveFile[] }>(
      token,
      url.toString(),
      { method: "GET" },
      "look for the archive folder",
    );
    const existing = found.files?.[0];
    if (existing?.id) return { id: existing.id, name: existing.name ?? name };

    const created = await this.json<DriveFile>(
      token,
      `${DRIVE_API}/files?fields=id,name`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          parents: parentId ? [parentId] : undefined,
        }),
      },
      "create the archive folder",
    );
    if (!created?.id) {
      throw new Error(
        `Drive accepted the folder creation but returned no id, so nothing can be written into "${name}".`,
      );
    }
    return { id: created.id, name: created.name ?? name };
  }

  /**
   * Write one document, as a multipart upload.
   *
   * The boundary is built here rather than handed to `FormData`, because Drive
   * requires `multipart/related` with the metadata part FIRST, and `FormData`
   * emits `multipart/form-data` with no control over part order.
   */
  async uploadJson(
    token: string,
    params: { name: string; parentId: string; body: string },
  ): Promise<{ id: string; name: string; size: number | null }> {
    const boundary = `mudavym-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const metadata = JSON.stringify({
      name: params.name,
      parents: [params.parentId],
      mimeType: "application/json",
    });
    const payload =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      "Content-Type: application/json\r\n\r\n" +
      `${params.body}\r\n` +
      `--${boundary}--\r\n`;

    const uploaded = await this.json<{
      id?: string;
      name?: string;
      size?: string;
    }>(
      token,
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,size`,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: payload,
      },
      "upload the archived reply",
    );

    if (!uploaded?.id) {
      throw new Error(
        "Drive accepted the upload and returned no file id, so there is nothing to read back and nothing to prove was written.",
      );
    }
    const size = Number(uploaded.size);
    return {
      id: uploaded.id,
      name: uploaded.name ?? params.name,
      size: Number.isFinite(size) ? size : null,
    };
  }

  /**
   * Read a file back out of the house's Drive.
   *
   * THIS IS THE VERIFICATION, and it is not decoration. A 200 on the upload is
   * Google's claim that it stored something; the bytes coming back and hashing
   * to what was sent is the evidence. The sweep deletes Mudavym's only copy on
   * the strength of this read, so it is made every time and never skipped for a
   * "successful" upload.
   */
  async readBack(token: string, fileId: string): Promise<string> {
    const response = await this.fetchImpl(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        this.refusal(response.status, "read back the archived reply", detail),
      );
    }
    return response.text();
  }

  // =========================================================================

  private async json<T>(
    token: string,
    url: string,
    init: RequestInit,
    what: string,
  ): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(this.refusal(response.status, what, detail));
    }
    return (await response.json()) as T;
  }

  /**
   * Google's refusal, in words a person can act on. Never "request failed": a
   * message that does not name the cause is a message that makes an operator
   * retry the same broken thing.
   */
  private refusal(status: number, what: string, detail: string): string {
    if (status === 401) {
      return `Google refused the attempt to ${what} (401). The Drive grant's token was rejected; the connection has to be made again by the person who owns it. ${detail.slice(0, 200)}`;
    }
    if (status === 403) {
      return `Google refused the attempt to ${what} (403). The connected account's grant does not carry https://www.googleapis.com/auth/drive.file, or the Drive is out of space. That consent has to be asked for by name, never widened behind the account holder's back. ${detail.slice(0, 300)}`;
    }
    if (status === 404) {
      return `Google could not find what it was asked for while trying to ${what} (404). With drive.file this usually means the folder was created by a different app or a different account and this grant cannot see it. ${detail.slice(0, 200)}`;
    }
    if (status === 429) {
      return `Google rate-limited the attempt to ${what} (429). This run stopped rather than retrying in a loop; the conversations it did not reach are recorded as not exported. ${detail.slice(0, 200)}`;
    }
    return `Google refused the attempt to ${what} (${status}). ${detail.slice(0, 300)}`;
  }
}
