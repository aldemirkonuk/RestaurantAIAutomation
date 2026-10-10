import { isIso4217 } from "../common/iso-4217";

/**
 * A vendor's usual currency, learned from their own invoices.
 *
 * THE FOUNDER, 2026-10-01 (vendors review, ruling VEN-W13), verbatim:
 *   "write auto and when other currencies are discovere then use option 1"
 *   "3 invoices"
 *   "Person's value stays, sheet shows the clash"
 *   "Keep it, switch to the one-tap offer"
 *
 * PURE. Nothing here reads or writes the database; `ProvidersService` and
 * `learnUsualCurrencyFromInvoices` below the pure part do, and both call these.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS AN INVOICE THAT "PRINTED" A CURRENCY
 * ---------------------------------------------------------------------------
 *   * `doc_type = 'invoice'` only. A credit memo is EXCLUDED: it settles an
 *     earlier invoice rather than billing anything, and counting both would
 *     let one transaction vote twice.
 *   * Status `rejected` and `superseded` are excluded — the house said that
 *     paper is not the bill.
 *   * The code is what the PAGE showed: the model's sighting
 *     (`extracted.currencySeen.code`), or, when no model sighting exists, the
 *     code the file itself stated (`extracted.currencyFiledKind = 'file'`,
 *     kept in `currencyFiledCode` — the EDI `CUR02`, or a read page's printed
 *     currency). A document filed under the ORDER's or the HOUSE's currency
 *     printed nothing and is not counted.
 *   * A document whose own sighting DISAGREES with the code its file stated is
 *     not counted at all: it contradicts itself, its money is held for a
 *     manager, and whichever code it "really" is is that manager's answer —
 *     which, once given, is a restatement and is left out anyway.
 *   * A document a manager RESTATED (a `procurement_document_currency_changes`
 *     row with `change_kind = 'restated'`, or with no kind recorded, which this
 *     treats the same way rather than guessing it was a confirmation) is left
 *     out entirely: the paper said one thing and a person decided another, so
 *     it is evidence of neither.
 *   * The same invoice number counted once — an invoice photographed and also
 *     emailed is one invoice.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE STATES THE SHEET CAN BE IN (sketch VEN-W13, approved 2026-10-01)
 * ---------------------------------------------------------------------------
 *   A  written from invoices, nothing disagrees
 *   B  nothing on file, the invoices disagree — one-tap per code
 *   C  a person stated it, and the invoices say otherwise — one-tap switch
 *   D  written from invoices, then a later invoice disagreed — keep or use
 *   E  nothing on file, fewer than 3 agreeing invoices — count + chooser
 * plus `stated` (a person's value nothing contradicts) — the ordinary sheet.
 *
 * "CONTRADICTED" FOR A PERSON'S VALUE (state C), precisely: the NEWEST counted
 * invoice printed a code other than the one the person stated. `lastInvoices`
 * is how many of the newest counted invoices, in an unbroken run, printed that
 * same other code. Older disagreeing invoices followed by an agreeing one are
 * NOT a clash — the vendor's paper came back to the person's answer.
 *
 * "CONTRADICTED" FOR AN INVOICE-WRITTEN VALUE (state D): ANY counted invoice
 * printed another code. At the moment it was written every counted invoice
 * agreed, so a disagreeing one is by construction a later one.
 */

/** How many agreeing invoices it takes to write a vendor's usual currency. */
export const INVOICES_TO_WRITE = 3;

export type UsualCurrencySource = "person" | "invoices";

/** One stored invoice, newest first, as the counter needs it. */
export interface InvoiceCurrencyEvidence {
  /** The code its page printed, or NULL when it printed none we can count. */
  code: string | null;
  /** A manager restated this document's currency. */
  restated: boolean;
}

export interface UsualCurrencyOnFile {
  code: string | null;
  /** NULL on a row read before the source column existed; read as a person. */
  source: UsualCurrencySource | null;
  invoiceCount: number | null;
}

export interface CodeCount {
  code: string;
  invoices: number;
}

export type UsualCurrencyState = "A" | "B" | "C" | "D" | "E" | "stated";

export interface UsualCurrencyDecision {
  state: UsualCurrencyState;
  /** Write this, as the invoices, ONLY when nothing is on file. */
  write: { code: string; invoiceCount: number } | null;
  /** An invoice-written value whose agreeing count grew; store the new count. */
  refreshCount: number | null;
  /** Counted invoices per printed code, most first (ties by code). */
  counts: CodeCount[];
  /** How many invoices were counted (restated and unprinted ones excluded). */
  counted: number;
  /** State C: the code the newest invoices printed instead, and how many. */
  clash: { code: string; lastInvoices: number } | null;
}

function iso(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  return upper !== "" && isIso4217(upper) ? upper : null;
}

/**
 * What one stored document's page printed, from its `extracted` snapshot.
 * Reads structured fields only — never `currencyFiledFrom`, which is prose.
 */
export function printedCurrencyOf(extracted: {
  seenCode?: string | null;
  filedKind?: string | null;
  filedCode?: string | null;
}): string | null {
  const seen = iso(extracted.seenCode);
  const file =
    extracted.filedKind === "file" ? iso(extracted.filedCode) : null;
  if (seen && file && seen !== file) return null; // contradicts itself
  return seen ?? file;
}

export function decideUsualCurrency(args: {
  /** Newest first. */
  evidence: InvoiceCurrencyEvidence[];
  onFile: UsualCurrencyOnFile;
}): UsualCurrencyDecision {
  const printed = args.evidence
    .filter((e) => !e.restated)
    .map((e) => iso(e.code))
    .filter((c): c is string => c !== null);

  const tally = new Map<string, number>();
  for (const c of printed) tally.set(c, (tally.get(c) ?? 0) + 1);
  const counts: CodeCount[] = [...tally.entries()]
    .map(([code, invoices]) => ({ code, invoices }))
    .sort((a, b) => b.invoices - a.invoices || a.code.localeCompare(b.code));
  const counted = printed.length;

  const base = { write: null, refreshCount: null, counts, counted, clash: null };
  const rawOnFile = (args.onFile.code ?? "").trim().toUpperCase();
  const onFile = iso(rawOnFile);

  // Something is on file that is not a currency (`ZZZ` was writable once).
  // It is not empty, so nothing is written over it; the ordinary sheet names it.
  if (rawOnFile !== "" && !onFile) return { ...base, state: "stated" };

  if (onFile) {
    if (args.onFile.source === "invoices") {
      if (counts.some((c) => c.code !== onFile)) return { ...base, state: "D" };
      const agreeing = tally.get(onFile) ?? 0;
      const stored = args.onFile.invoiceCount ?? 0;
      return {
        ...base,
        state: "A",
        refreshCount:
          agreeing > stored && agreeing >= INVOICES_TO_WRITE ? agreeing : null,
      };
    }
    // A person's value (or a row from before the source column: every code
    // on file then had a person behind it).
    const newest = printed[0];
    if (newest && newest !== onFile) {
      let run = 0;
      while (run < printed.length && printed[run] === newest) run += 1;
      return { ...base, state: "C", clash: { code: newest, lastInvoices: run } };
    }
    return { ...base, state: "stated" };
  }

  // Nothing on file.
  if (counts.length >= 2) return { ...base, state: "B" };
  if (counts.length === 1 && counts[0].invoices >= INVOICES_TO_WRITE)
    return {
      ...base,
      state: "E",
      write: { code: counts[0].code, invoiceCount: counts[0].invoices },
    };
  return { ...base, state: "E" };
}

/* ===========================================================================
 * THE READ AND THE WRITE — shared by the providers service (the sheet) and
 * the two invoice doors (intake, and a manager's restatement).
 * ======================================================================== */

/** The minimum of a supabase-js client this needs; a stub satisfies it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (table: string) => any };

export interface UsualCurrencyReading {
  onFile: UsualCurrencyOnFile;
  evidence: InvoiceCurrencyEvidence[];
  decision: UsualCurrencyDecision;
}

/**
 * Read this vendor's counted invoices in this house, newest first.
 *
 * HOUSE-SCOPED TWICE: the documents by `restaurant_id` and `provider_id`, and
 * the restatement log by `restaurant_id` as well — a filter on the document
 * ids alone would be a filter the log's own rows never had to pass.
 *
 * A FAILED READ THROWS. It is never an empty list: "no invoices printed a
 * currency" and "we could not look" are different sentences.
 */
export async function readInvoiceCurrencyEvidence(
  client: Client,
  restaurantId: string,
  providerId: string,
): Promise<InvoiceCurrencyEvidence[]> {
  const { data, error } = await client
    .from("procurement_documents")
    .select(
      "id, doc_number, doc_date, created_at, status, seen_code:extracted->currencySeen->>code, filed_kind:extracted->>currencyFiledKind, filed_code:extracted->>currencyFiledCode",
    )
    .eq("restaurant_id", restaurantId)
    .eq("provider_id", providerId)
    .eq("doc_type", "invoice");
  if (error)
    throw new Error(
      `This vendor's invoices could not be read (${error.message}).`,
    );

  type Row = {
    id: string;
    doc_number?: string | null;
    doc_date?: string | null;
    created_at?: string | null;
    status?: string | null;
    seen_code?: string | null;
    filed_kind?: string | null;
    filed_code?: string | null;
  };
  const rows = ((data ?? []) as Row[]).filter(
    (r) => r.status !== "rejected" && r.status !== "superseded",
  );
  if (rows.length === 0) return [];

  const restated = new Set<string>();
  const { data: changes, error: changesError } = await client
    .from("procurement_document_currency_changes")
    .select("document_id, change_kind")
    .eq("restaurant_id", restaurantId)
    .in(
      "document_id",
      rows.map((r) => r.id),
    );
  if (changesError)
    throw new Error(
      `Which of this vendor's invoices a manager restated could not be read (${changesError.message}).`,
    );
  for (const c of (changes ?? []) as {
    document_id: string;
    change_kind?: string | null;
  }[])
    if (c.change_kind !== "confirmed") restated.add(c.document_id);

  const when = (r: Row) => r.doc_date || r.created_at || "";
  rows.sort((a, b) => when(b).localeCompare(when(a)));

  // One invoice number, one vote — the newest copy speaks for it.
  const seenNumbers = new Set<string>();
  const out: InvoiceCurrencyEvidence[] = [];
  for (const r of rows) {
    const number = (r.doc_number ?? "").trim().toUpperCase();
    if (number) {
      if (seenNumbers.has(number)) continue;
      seenNumbers.add(number);
    }
    out.push({
      code: printedCurrencyOf({
        seenCode: r.seen_code,
        filedKind: r.filed_kind,
        filedCode: r.filed_code,
      }),
      restated: restated.has(r.id),
    });
  }
  return out;
}

/**
 * Read what is on file for this vendor, the evidence, and the decision.
 * Throws on a failed read (see above); returns null when the vendor is not in
 * this house.
 */
export async function readUsualCurrencyFromInvoices(
  client: Client,
  restaurantId: string,
  providerId: string,
): Promise<UsualCurrencyReading | null> {
  const { data, error } = await client
    .from("providers")
    .select("usual_currency, usual_currency_source, usual_currency_invoice_count")
    .eq("id", providerId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error)
    throw new Error(
      `This vendor's usual currency could not be read (${error.message}).`,
    );
  if (!data) return null;
  const row = data as {
    usual_currency?: string | null;
    usual_currency_source?: string | null;
    usual_currency_invoice_count?: number | null;
  };
  const onFile: UsualCurrencyOnFile = {
    code: row.usual_currency ?? null,
    source:
      row.usual_currency_source === "invoices"
        ? "invoices"
        : row.usual_currency_source === "person"
          ? "person"
          : null,
    invoiceCount: row.usual_currency_invoice_count ?? null,
  };
  const evidence = await readInvoiceCurrencyEvidence(
    client,
    restaurantId,
    providerId,
  );
  return { onFile, evidence, decision: decideUsualCurrency({ evidence, onFile }) };
}

export type LearnOutcome =
  | { kind: "written"; code: string; invoiceCount: number }
  | { kind: "count-refreshed"; code: string; invoiceCount: number }
  | { kind: "left"; state: UsualCurrencyState }
  | { kind: "raced" }
  | { kind: "failed"; because: string };

/**
 * After an invoice is matched to a vendor, or a manager restates one: write
 * the vendor's usual currency from their invoices when the rule is met and
 * NOTHING is on file.
 *
 * NEVER THROWS. Its callers are invoice intake and a currency restatement,
 * and neither may fail because a vendor-level nicety could not be worked out.
 * A failure is returned (and logged by the caller), never raised.
 *
 * THE WRITE IS GUARDED BY `.is('usual_currency', null)`, so a person who
 * stated a currency between our read and our write wins: the update matches no
 * row and this reports `raced`. The count refresh is guarded the same way on
 * the value still being the invoices' own.
 */
export async function learnUsualCurrencyFromInvoices(
  client: Client,
  restaurantId: string,
  providerId: string | null | undefined,
): Promise<LearnOutcome> {
  if (!providerId) return { kind: "left", state: "E" };
  try {
    const reading = await readUsualCurrencyFromInvoices(
      client,
      restaurantId,
      providerId,
    );
    if (!reading) return { kind: "failed", because: "the vendor is not in this house" };
    const { decision } = reading;

    if (decision.write) {
      const { data, error } = await client
        .from("providers")
        .update({
          usual_currency: decision.write.code,
          usual_currency_set_by: null,
          usual_currency_set_at: new Date().toISOString(),
          usual_currency_source: "invoices",
          usual_currency_invoice_count: decision.write.invoiceCount,
        })
        .eq("id", providerId)
        .eq("restaurant_id", restaurantId)
        .is("usual_currency", null)
        .select("id");
      if (error) return { kind: "failed", because: error.message };
      if (!data || (data as unknown[]).length === 0) return { kind: "raced" };
      return { kind: "written", ...decision.write };
    }

    if (decision.refreshCount !== null && reading.onFile.code) {
      const code = reading.onFile.code.trim().toUpperCase();
      const { data, error } = await client
        .from("providers")
        .update({ usual_currency_invoice_count: decision.refreshCount })
        .eq("id", providerId)
        .eq("restaurant_id", restaurantId)
        .eq("usual_currency_source", "invoices")
        .eq("usual_currency", code)
        .select("id");
      if (error) return { kind: "failed", because: error.message };
      if (!data || (data as unknown[]).length === 0) return { kind: "raced" };
      return { kind: "count-refreshed", code, invoiceCount: decision.refreshCount };
    }

    return { kind: "left", state: decision.state };
  } catch (err) {
    return {
      kind: "failed",
      because: (err as { message?: string })?.message ?? "unknown error",
    };
  }
}
