import { ParsedDocument } from "../parsed-document";
import { parseInterchange, X12Interchange } from "./x12-envelope";
import { parse810 } from "./x12-invoice";
import { parse856 } from "./x12-ship-notice";
import { parse812 } from "./x12-credit";

export * from "./x12-envelope";
export { parse810 } from "./x12-invoice";
export { parse856 } from "./x12-ship-notice";
export { parse812 } from "./x12-credit";

/** Transaction sets we can turn into documents. */
export const SUPPORTED_SETS = ["810", "856", "812"] as const;

/**
 * What the file's PARSE is told about the house it arrived at.
 *
 * One field, and it exists because an 810 with no `CUR` segment used to file
 * its totals as `USD` (founder, 2026-09-06; `../invoice-currency.ts`). Absent
 * means the caller does not know the house's currency, and a file with no `CUR`
 * then has its money refused rather than dollarised.
 */
export interface X12ParseOptions {
  /** `restaurants.currency`, or null/absent when the house has stated none. */
  houseCurrency?: string | null;
}

export interface X12ParseResult {
  interchange: Omit<X12Interchange, "transactions">;
  documents: ParsedDocument[];
  /** Sets present in the file that we chose not to parse, with the reason. */
  skipped: Array<{ setType: string; reason: string }>;
}

/**
 * Turn a raw X12 interchange into documents.
 *
 * One file routinely carries several transaction sets, and mixed types are
 * normal — a distributor batching a day's 810s and 856s together. Each becomes
 * its own document.
 *
 * `looksLikeX12` guards the entry: a PDF or a photo reaching this parser should
 * be routed elsewhere, not coerced into producing an empty invoice that then
 * looks like a vendor who billed nothing.
 */
export function parseX12(
  raw: string,
  options: X12ParseOptions = {},
): X12ParseResult {
  const interchange = parseInterchange(raw);
  const { transactions, ...envelope } = interchange;

  const documents: ParsedDocument[] = [];
  const skipped: Array<{ setType: string; reason: string }> = [];

  for (const tx of transactions) {
    switch (tx.setType) {
      case "810":
        documents.push(
          withEnvelopeWarnings(
            parse810(tx, interchange.delimiters, {
              houseCurrency: options.houseCurrency,
            }),
            envelope.warnings,
          ),
        );
        break;
      case "856":
        documents.push(
          withEnvelopeWarnings(
            parse856(tx, interchange.delimiters),
            envelope.warnings,
          ),
        );
        break;
      case "812":
        documents.push(
          withEnvelopeWarnings(
            // A credit carries a real `totalCredit` (BCD04) and settles against
            // an 810, so it takes the same house currency the invoice does. The
            // 856 above deliberately does not: it states no money at all.
            parse812(tx, interchange.delimiters, {
              houseCurrency: options.houseCurrency,
            }),
            envelope.warnings,
          ),
        );
        break;
      case "850":
      case "855":
      case "997":
        // Ours, an acknowledgement of ours, or an acknowledgement of theirs.
        // Recognised so they are not reported as unknown noise, but they carry
        // nothing the four-way match needs.
        skipped.push({
          setType: tx.setType,
          reason: "Recognised but not a document the match consumes.",
        });
        break;
      default:
        skipped.push({
          setType: tx.setType || "(none)",
          reason: "Unsupported transaction set.",
        });
    }
  }

  return { interchange: envelope, documents, skipped };
}

/**
 * Envelope-level problems (test-usage flag, assumed delimiters) apply to every
 * document in the file. Attaching them to each one means a document reviewed in
 * isolation still shows why it might be wrong.
 */
function withEnvelopeWarnings(
  doc: ParsedDocument,
  envelopeWarnings: string[],
): ParsedDocument {
  if (!envelopeWarnings.length) return doc;
  return {
    ...doc,
    warnings: [...envelopeWarnings, ...doc.warnings],
    confidence: Math.max(0.3, doc.confidence - envelopeWarnings.length * 0.1),
  };
}

/**
 * Cheap sniff so the intake router can tell EDI from everything else.
 *
 * Requires a segment tag near the start, not merely the letters "ISA" or "ST"
 * somewhere in the file — an invoice PDF whose text contains the word "ISA"
 * would otherwise be handed to this parser and come back as a document with no
 * lines and no total, which reads downstream as a vendor who billed nothing.
 */
export function looksLikeX12(raw: string): boolean {
  const head = raw.slice(0, 512).trimStart();
  return /^(ISA[*|^~\-+])|(^ST[*|^~\-+](8[015][0-9]|997))/.test(head);
}
