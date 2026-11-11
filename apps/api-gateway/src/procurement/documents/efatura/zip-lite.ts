import { inflateRawSync } from "zlib";

/**
 * Read the files inside a zip, for the e-invoice that the GİB portal and most
 * integrators hand out zipped. Node's own `zlib` inflates; nothing is added
 * to the gateway image.
 *
 * Bounded on purpose: at most `MAX_ENTRIES` files, each at most
 * `MAX_ENTRY_BYTES` once inflated (checked by zlib's own `maxOutputLength`,
 * so a zip bomb stops at the cap rather than after it). An encrypted entry,
 * a ZIP64 archive and a compression method other than stored or deflate are
 * refused with a sentence, never guessed at.
 */

export const MAX_ENTRIES = 20;
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  bytes: Buffer;
}

export class ZipRefused extends Error {}

export function looksLikeZip(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function readZip(bytes: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new ZipRefused("The zip file is cut short: its index is missing.");
  const count = bytes.readUInt16LE(eocd + 10);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff)
    throw new ZipRefused("The zip file is a ZIP64 archive, which is not read here.");
  if (count > MAX_ENTRIES)
    throw new ZipRefused(
      `The zip file holds ${count} files; at most ${MAX_ENTRIES} are read. Send the e-invoice XML on its own.`,
    );

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50)
      throw new ZipRefused("The zip file's index is damaged.");
    const flags = bytes.readUInt16LE(p + 8);
    const method = bytes.readUInt16LE(p + 10);
    const compSize = bytes.readUInt32LE(p + 20);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const localOffset = bytes.readUInt32LE(p + 42);
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // a folder
    if (flags & 0x1)
      throw new ZipRefused(`"${name}" in the zip file is encrypted; it cannot be read.`);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50)
      throw new ZipRefused(`"${name}" in the zip file is damaged.`);
    const lName = bytes.readUInt16LE(localOffset + 26);
    const lExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lName + lExtra;
    const data = bytes.subarray(start, start + compSize);
    if (data.length !== compSize)
      throw new ZipRefused(`"${name}" in the zip file is cut short.`);

    let inflated: Buffer;
    if (method === 0) inflated = Buffer.from(data);
    else if (method === 8) {
      try {
        inflated = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      } catch (e: any) {
        throw new ZipRefused(
          /maxOutputLength|buffer|larger/i.test(String(e?.message))
            ? `"${name}" in the zip file is larger than ${MAX_ENTRY_BYTES / (1024 * 1024)} MB once unpacked; it was not read.`
            : `"${name}" in the zip file could not be unpacked: ${e?.message ?? "unknown error"}.`,
        );
      }
    } else
      throw new ZipRefused(
        `"${name}" in the zip file uses a compression this reader does not know (method ${method}).`,
      );
    if (inflated.length > MAX_ENTRY_BYTES)
      throw new ZipRefused(
        `"${name}" in the zip file is larger than ${MAX_ENTRY_BYTES / (1024 * 1024)} MB; it was not read.`,
      );
    out.push({ name, bytes: inflated });
  }
  return out;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}
