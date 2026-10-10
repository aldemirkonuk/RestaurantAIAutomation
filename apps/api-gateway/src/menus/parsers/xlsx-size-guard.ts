import { inflateRawSync } from "node:zlib";

/**
 * Refuse an .xlsx that would inflate past a fixed size, BEFORE ExcelJS sees it
 * (F-475).
 *
 * An .xlsx is a zip. ExcelJS 4.4 inflates every entry in full and then builds
 * every cell, with no limit of its own; the only bound was the 15 MB JSON body.
 * An 857 KB workbook (294 MB of sheet XML) took the gateway's heap down for
 * every house it serves. So the archive is checked here, in two steps:
 *
 *  1. The central directory's DECLARED sizes and entry count: cheap, and it
 *     refuses the honest bomb without inflating a byte.
 *  2. Every entry is then actually inflated with `maxOutputLength`, against
 *     the same budget. The declared sizes are the sender's word; a lying header
 *     is stopped here by zlib itself, not by trusting it.
 *
 * Anything this code cannot read (ZIP64, an unknown compression method, a
 * truncated archive) is refused: a menu workbook never needs ZIP64, and "could
 * not tell how big this is" must not mean "open it".
 */

/** A wine list is a few thousand rows; its sheet XML is a few MB. */
export const XLSX_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
/** A workbook has a dozen-odd parts; thousands means something else. */
export const XLSX_MAX_ENTRIES = 1000;

/**
 * `tooLarge` is true when the file was refused for its size; false when it is
 * simply not a zip this code can read (which ExcelJS could not open either).
 */
export class XlsxRefusedError extends Error {
  constructor(
    readonly detail: string,
    readonly tooLarge = false,
  ) {
    super(detail);
    this.name = "XlsxRefusedError";
  }
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD is 22 bytes plus a comment of at most 65535.
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export function assertXlsxWithinLimits(
  buf: Buffer,
  maxBytes = XLSX_MAX_UNCOMPRESSED_BYTES,
  maxEntries = XLSX_MAX_ENTRIES,
): void {
  if (buf.length < 22) throw new XlsxRefusedError("not a zip archive");
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) throw new XlsxRefusedError("not a zip archive");

  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) {
    throw new XlsxRefusedError("ZIP64 archives are not read", true);
  }
  if (entries > maxEntries) {
    throw new XlsxRefusedError(`${entries} entries, over ${maxEntries}`, true);
  }

  type Entry = { method: number; compSize: number; localOffset: number };
  const list: Entry[] = [];
  let declared = 0;
  let p = cdOffset;
  for (let i = 0; i < entries; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) {
      throw new XlsxRefusedError("the zip directory is damaged");
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (size === 0xffffffff || compSize === 0xffffffff) {
      throw new XlsxRefusedError("ZIP64 archives are not read", true);
    }
    declared += size;
    if (declared > maxBytes) {
      throw new XlsxRefusedError(
        `declares over ${maxBytes} bytes unpacked`,
        true,
      );
    }
    list.push({ method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  let actual = 0;
  for (const { method, compSize, localOffset } of list) {
    if (
      localOffset + 30 > buf.length ||
      buf.readUInt32LE(localOffset) !== LFH_SIG
    ) {
      throw new XlsxRefusedError("the zip directory is damaged");
    }
    const start =
      localOffset +
      30 +
      buf.readUInt16LE(localOffset + 26) +
      buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(start, start + compSize);
    const budget = maxBytes - actual;
    if (method === 0) {
      actual += data.length;
    } else if (method === 8) {
      try {
        actual += inflateRawSync(data, { maxOutputLength: budget + 1 }).length;
      } catch (err) {
        if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new XlsxRefusedError(`unpacks to over ${maxBytes} bytes`, true);
        }
        throw new XlsxRefusedError("a part of the archive will not unpack");
      }
    } else {
      throw new XlsxRefusedError(`compression method ${method} is not read`);
    }
    if (actual > maxBytes) {
      throw new XlsxRefusedError(`unpacks to over ${maxBytes} bytes`, true);
    }
  }
}
