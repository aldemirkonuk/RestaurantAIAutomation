import { getHouseLocale } from './houseCurrency';

/**
 * Why a CSV menu was not read, and the Excel setting that fixes it (F-1294).
 */
export const CSV_NOT_READABLE =
  'Some letters in this file could not be read, so nothing was sent. In Excel, choose Save As and pick "CSV UTF-8 (Comma delimited)", then choose the new file.';

/**
 * A CSV file's bytes as text — a menu (F-1294) or the sales register (F-1361).
 * `file.text()` always read UTF-8, so a file saved by Turkish Excel's default
 * CSV (Windows-1254) lost every ş, ğ and ı: its Turkish headers went unread and
 * its names were kept garbled. UTF-8 is
 * tried strictly first; a file that is not UTF-8 is read as Windows-1254 in a
 * Turkish house and Windows-1252 anywhere else. A file that still holds the
 * replacement character is refused, never sent.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array, locale: string = getHouseLocale()): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder(/^tr(-|$)/i.test(locale) ? 'windows-1254' : 'windows-1252').decode(bytes);
  }
  if (text.includes('�')) throw new Error(CSV_NOT_READABLE);
  return text;
}

/** A CSV menu file as text, read the way `decodeCsvBytes` says. */
export async function readMenuCsv(file: Blob, locale?: string): Promise<string> {
  return decodeCsvBytes(await file.arrayBuffer(), locale);
}
