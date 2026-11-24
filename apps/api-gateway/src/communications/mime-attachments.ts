/**
 * Outbound attachments, g6a (r106): the multipart/mixed builder and its limits.
 *
 * WHY A SEPARATE FILE
 * -------------------
 * Two senders hand-build MIME (GmailService.createMimeMessage for the shared
 * mailbox, sendThroughGrant for a house's own grant). Both need the same three
 * rules, so they live once, here:
 *
 *   1. Limits. At most 3 files and 5 MB in all (the raw bytes, before base64),
 *      and a refusal says which limit, in words a person can act on. A fourth
 *      file is refused, never dropped: a letter that left without the file the
 *      writer attached is a worse failure than one that did not leave.
 *   2. Who. Only an owner or a manager may attach (founder, DD-r104-25). Staff
 *      are refused here, so no caller can forget to ask.
 *   3. Only uploaded files. An attachment is bytes the person put into the
 *      composer. There is no field for a URL or a server path, so a letter can
 *      never be made to read a file off the gateway or fetch one on the writer's
 *      behalf.
 *
 * Nothing here can start a header: the file name is cut to a safe set (CR, LF,
 * quotes, slashes and control characters collapse) and RFC 2047 encoded by the
 * same encoder as every other header (mime-headers.ts, ADR 0172). A body line
 * can never be a boundary: parts are base64 and the boundary has 128 random bits.
 */
import { randomBytes } from "crypto";
import { base64Body, unstructuredHeader } from "./mime-headers";

export const OUTBOUND_ATTACHMENT_MAX_FILES = 3;
export const OUTBOUND_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** A file the person uploaded into the composer. Bytes only: no URL, no path. */
export interface OutboundAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export type AttachmentRefusal =
  | "staff"
  | "too_many"
  | "too_big"
  | "empty_file";

export class AttachmentRefusedError extends Error {
  constructor(
    readonly refusal: AttachmentRefusal,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentRefusedError";
  }
}

const MAY_ATTACH = new Set(["owner", "manager"]);

/**
 * Throws AttachmentRefusedError when the writer may not send these files or the
 * set is over a limit. A letter with no files always passes (staff still write
 * plain letters). The role is the one the gateway resolved from the token,
 * never a value from the request body.
 */
export function assertMayAttach(
  role: string | null | undefined,
  files: readonly OutboundAttachment[] | undefined,
): void {
  if (!files || files.length === 0) return;
  if (!MAY_ATTACH.has(String(role ?? "").toLowerCase())) {
    throw new AttachmentRefusedError(
      "staff",
      "Only an owner or a manager can attach files to a letter.",
    );
  }
  assertWithinLimits(files);
}

/** The limits alone, for the sender that has already checked the role. */
export function assertWithinLimits(
  files: readonly OutboundAttachment[] | undefined,
): void {
  if (!files || files.length === 0) return;
  if (files.length > OUTBOUND_ATTACHMENT_MAX_FILES) {
    throw new AttachmentRefusedError(
      "too_many",
      `A letter can carry ${OUTBOUND_ATTACHMENT_MAX_FILES} files at most; this one has ${files.length}.`,
    );
  }
  let total = 0;
  for (const f of files) {
    if (!f.content || f.content.length === 0) {
      throw new AttachmentRefusedError(
        "empty_file",
        `The file ${safeFilename(f.filename)} is empty.`,
      );
    }
    total += f.content.length;
  }
  if (total > OUTBOUND_ATTACHMENT_MAX_BYTES) {
    throw new AttachmentRefusedError(
      "too_big",
      `The files together are over ${OUTBOUND_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.`,
    );
  }
}

/** A file name that cannot break a header or name a path. */
export function safeFilename(name: string | undefined): string {
  const cleaned = String(name ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

/** type/subtype or application/octet-stream; never a parameter, never a CR/LF. */
export function safeContentType(type: string | undefined): string {
  const t = String(type ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/.test(
    t,
  )
    ? t
    : "application/octet-stream";
}

function filePart(boundary: string, f: OutboundAttachment): string[] {
  const name = safeFilename(f.filename);
  const encoded = unstructuredHeader("X", name).slice(3); // RFC 2047 value only
  return [
    `--${boundary}`,
    `Content-Type: ${safeContentType(f.contentType)}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${encoded.replace(/"/g, "")}"`,
    "",
    f.content.toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
}

/**
 * Wraps an already-built body (the `Content-Type` header line and the part
 * text that follows it) and the files into one multipart/mixed message body.
 * `inner` is the body's own Content-Type header line plus the body, so the
 * text alone and the text/html alternative both nest unchanged.
 */
export function mixedBody(
  innerContentTypeHeader: string,
  innerBody: string,
  files: readonly OutboundAttachment[],
): { contentTypeHeader: string; body: string } {
  assertWithinLimits(files);
  const boundary = `mudavym_mix_${randomBytes(16).toString("hex")}`;
  const body = [
    `--${boundary}`,
    innerContentTypeHeader,
    "",
    innerBody,
    ...files.flatMap((f) => filePart(boundary, f)),
    `--${boundary}--`,
  ].join("\r\n");
  return {
    contentTypeHeader: `Content-Type: multipart/mixed; boundary="${boundary}"`,
    body,
  };
}

/** Plain-text letter with files, for the grant sender. */
export function plainLetterWithFiles(
  text: string,
  files: readonly OutboundAttachment[],
): { contentTypeHeader: string; body: string } {
  return mixedBody(
    'Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64',
    base64Body(text),
    files,
  );
}
