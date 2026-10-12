/**
 * The vendor-list and opening-stock CSV imports (F-685, S195 coordinator call:
 * every inventory tool takes a spreadsheet on day one).
 *
 * A file is read the house's way: its bytes through `decodeCsvBytes` (UTF-8,
 * else the house's Excel code page; F-1294), its separator the one the header
 * uses most (",", ";" or a tab: Turkish Excel writes ";"), and its numbers
 * through `parseDecimal` with the house's own group mark. Nothing is sent from
 * here: each row is sorted into what will be written and what will not, with
 * the reason in plain words, and the person sees that before anything is sent.
 */

import { decodeCsvBytes } from './menuCsvText';
import { displayGroupMark, parseDecimal } from './parseDecimal';
import { getHouseLocale } from './houseCurrency';

/** The rows of a CSV text, quotes honoured; blank lines dropped. */
export function parseCsvRows(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** A CSV file's text, decoded the house's way (refuses unreadable letters). */
export async function readCsvFile(file: Blob, locale: string = getHouseLocale()): Promise<string> {
  return decodeCsvBytes(await file.arrayBuffer(), locale);
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Which column each field is in, by the header's own words (English or Turkish). */
function columnsOf<K extends string>(header: string[], aliases: Record<K, readonly string[]>): Record<K, number> {
  const folded = header.map(fold);
  const out = {} as Record<K, number>;
  for (const key of Object.keys(aliases) as K[]) {
    out[key] = folded.findIndex((h) => aliases[key].includes(h));
  }
  return out;
}

export interface Refused {
  line: number;
  label: string;
  reason: string;
}

/* ── vendors ─────────────────────────────────────────────────────────── */

const VENDOR_COLUMNS = {
  name: ['name', 'vendor', 'vendor name', 'supplier', 'company', 'tedarikci', 'firma', 'ad', 'isim'],
  email: ['email', 'e mail', 'mail', 'e posta', 'eposta'],
  phone: ['phone', 'telephone', 'tel', 'telefon', 'mobile', 'gsm'],
  address: ['address', 'adres'],
  contact: ['contact', 'contact name', 'yetkili', 'ilgili kisi'],
  terms: ['payment terms', 'terms', 'odeme', 'odeme kosullari', 'vade'],
  notes: ['notes', 'note', 'not', 'notlar', 'aciklama'],
} as const;

export interface VendorRow {
  line: number;
  name: string;
  email: string;
  phone: string;
  physicalAddress: string;
  contactFirstName?: string;
  contactLastName?: string;
  paymentTerms?: string;
  notes?: string;
}

export interface VendorImportPlan {
  fresh: VendorRow[];
  duplicate: { line: number; label: string; reason: string }[];
  refused: Refused[];
  /** Set when the file itself cannot be used; nothing else is filled then. */
  fileProblem: string | null;
}

/**
 * Sorts a vendor CSV into new vendors, vendors already in the book (by name or
 * email, or twice in the file) and rows that cannot be used.
 */
export function planVendorImport(
  rows: string[][],
  existing: { name: string; email?: string | null }[],
): VendorImportPlan {
  const plan: VendorImportPlan = { fresh: [], duplicate: [], refused: [], fileProblem: null };
  if (rows.length < 2) {
    plan.fileProblem = 'The file has no vendors under its header row.';
    return plan;
  }
  const col = columnsOf(rows[0], VENDOR_COLUMNS);
  if (col.name < 0) {
    plan.fileProblem = 'No column is called "Name" or "Vendor", so no vendor could be read. Name the first column "Name".';
    return plan;
  }
  const names = new Set(existing.map((v) => fold(v.name)));
  const emails = new Set(existing.map((v) => (v.email ?? '').trim().toLowerCase()).filter(Boolean));
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = at(r, col.name);
    const email = at(r, col.email);
    if (!name) {
      plan.refused.push({ line, label: email || `Line ${line}`, reason: 'No vendor name on this line.' });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      plan.refused.push({ line, label: name, reason: `"${email}" is not an email address.` });
      return;
    }
    const key = fold(name);
    const mail = email.toLowerCase();
    if (names.has(key) || (mail && emails.has(mail))) {
      const inBook = existing.some((v) => fold(v.name) === key || (mail && (v.email ?? '').toLowerCase() === mail));
      plan.duplicate.push({
        line,
        label: name,
        reason: inBook ? 'Already in your vendors; it is left as it is.' : 'Listed twice in this file; the first one is used.',
      });
      return;
    }
    names.add(key);
    if (mail) emails.add(mail);
    const [first, ...rest] = at(r, col.contact).split(/\s+/).filter(Boolean);
    plan.fresh.push({
      line,
      name,
      email,
      phone: at(r, col.phone),
      physicalAddress: at(r, col.address),
      ...(first ? { contactFirstName: first } : {}),
      ...(rest.length ? { contactLastName: rest.join(' ') } : {}),
      ...(at(r, col.terms) ? { paymentTerms: at(r, col.terms) } : {}),
      ...(at(r, col.notes) ? { notes: at(r, col.notes) } : {}),
    });
  });
  return plan;
}

/* ── opening stock ───────────────────────────────────────────────────── */

const STOCK_COLUMNS = {
  name: ['wine', 'name', 'item', 'product', 'sarap', 'urun', 'urun adi', 'ad', 'isim'],
  producer: ['producer', 'winery', 'uretici', 'bag evi'],
  vintage: ['vintage', 'year', 'yil', 'rekolte'],
  qty: ['qty', 'quantity', 'bottles', 'count', 'stock', 'adet', 'miktar', 'sise', 'stok'],
  shelf: ['shelf', 'location', 'bin', 'storage', 'raf', 'konum', 'yer', 'depo'],
  cost: ['cost', 'cost per bottle', 'unit cost', 'maliyet', 'alis fiyati', 'birim maliyet'],
} as const;

export interface StockReceiveRow {
  line: number;
  name: string;
  producer?: string;
  vintage: number | null;
  qty: number;
  shelfId: string | null;
  shelfName: string | null;
  cost: number | null;
}

export interface StockCountRow {
  line: number;
  name: string;
  inventoryId: string;
  qty: number;
  shelfId: string | null;
  shelfName: string | null;
  /** A cost on the line is not applied to a wine already carried. */
  costIgnored: boolean;
}

export interface OpeningStockPlan {
  /** Wines not on the list yet: received with their quantity and cost. */
  receive: StockReceiveRow[];
  /** Wines already carried: counted to the file's quantity, never added to. */
  count: StockCountRow[];
  refused: Refused[];
  fileProblem: string | null;
}

/**
 * Sorts an opening-stock CSV (wine, quantity, shelf, cost) into wines to
 * receive, wines already carried to count, and rows that cannot be used. A
 * wine already carried is COUNTED to the file's number, so importing the same
 * file twice never doubles the cellar.
 */
export function planOpeningStock(
  rows: string[][],
  carried: { inventoryId?: string; name: string; vintage?: number | null; producer?: string | null }[],
  shelves: { id: string; name: string }[],
  locale: string = getHouseLocale(),
): OpeningStockPlan {
  const plan: OpeningStockPlan = { receive: [], count: [], refused: [], fileProblem: null };
  if (rows.length < 2) {
    plan.fileProblem = 'The file has no wines under its header row.';
    return plan;
  }
  const col = columnsOf(rows[0], STOCK_COLUMNS);
  if (col.name < 0 || col.qty < 0) {
    plan.fileProblem =
      'The file needs a "Wine" column and a "Quantity" column (Shelf and Cost are optional), so nothing could be read.';
    return plan;
  }
  const group = displayGroupMark(locale);
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = at(r, col.name);
    const label = name || `Line ${line}`;
    const refuse = (reason: string) => plan.refused.push({ line, label, reason });
    if (!name) return refuse('No wine name on this line.');
    const qtyRaw = at(r, col.qty);
    const qty = parseDecimal(qtyRaw, group);
    if (qty === null || qty < 0 || !Number.isInteger(qty) || qty > 10000) {
      return refuse(`"${qtyRaw}" is not a number of bottles (a whole number from 0 to 10,000).`);
    }
    const vintageRaw = at(r, col.vintage);
    let vintage: number | null = null;
    if (vintageRaw && !/^(nv|n\/v|vintage yok)$/i.test(vintageRaw)) {
      if (!/^\d{4}$/.test(vintageRaw)) return refuse(`"${vintageRaw}" is not a vintage year.`);
      vintage = Number(vintageRaw);
    }
    const costRaw = at(r, col.cost);
    let cost: number | null = null;
    if (costRaw) {
      cost = parseDecimal(costRaw, group);
      if (cost === null || cost < 0) return refuse(`"${costRaw}" is not a cost per bottle.`);
    }
    const shelfRaw = at(r, col.shelf);
    let shelf: { id: string; name: string } | null = null;
    if (shelfRaw) {
      shelf = shelves.find((s) => fold(s.name) === fold(shelfRaw)) ?? null;
      if (!shelf) {
        return refuse(`No shelf called "${shelfRaw}" in this restaurant. Add it under Locations, or leave the shelf empty.`);
      }
    }
    const producer = at(r, col.producer);
    const key = `${fold(name)}|${vintage ?? ''}|${fold(producer)}|${shelf?.id ?? ''}`;
    if (seen.has(key)) return refuse('Listed twice in this file for the same shelf; the first one is used.');
    seen.add(key);

    const match = carried.find(
      (w) =>
        !!w.inventoryId &&
        fold(w.name) === fold(name) &&
        (w.vintage ?? null) === vintage &&
        (!producer || !w.producer || fold(w.producer) === fold(producer)),
    );
    if (match?.inventoryId) {
      plan.count.push({
        line,
        name,
        inventoryId: match.inventoryId,
        qty,
        shelfId: shelf?.id ?? null,
        shelfName: shelf?.name ?? null,
        costIgnored: cost !== null,
      });
      return;
    }
    plan.receive.push({
      line,
      name,
      ...(producer ? { producer } : {}),
      vintage,
      qty,
      shelfId: shelf?.id ?? null,
      shelfName: shelf?.name ?? null,
      cost,
    });
  });
  return plan;
}
