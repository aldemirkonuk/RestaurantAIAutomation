import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn, money } from "./producer-copy";

/**
 * "A document was certified against the paper."
 *
 * WHAT VERIFY ACTUALLY ASSERTS, AND WHY THE COPY IS SO CAREFUL
 * -----------------------------------------------------------
 * `POST /procurement/documents/:id/verify` sets `status = 'verified'` and stamps
 * `verified_by` from the token (documents.controller.ts:305-331). Its own
 * OpenAPI description is the exact wording this producer must not exceed:
 *
 *   "Records who checked it and when. This asserts only that the transcription
 *    is right — it does not accept the charges, apply anything to stock, or
 *    settle a discrepancy."
 *
 * So the notification says "certified as a faithful transcription", never
 * "approved" and never "paid". A row that said an invoice had been accepted
 * would be a claim about money that nobody made, written permanently into an
 * inbox. There is also deliberately no un-verify (documents.controller.ts:262),
 * which is what makes `verified_at` a stable component of the dedupe key.
 *
 * THE TIE-OUT TRAVELS WITH IT
 * ---------------------------
 * `ties_out` and `tie_out_delta` (baseline:4454-4455) are the document's own
 * arithmetic check: do the lines add up to the stated total? Both are NULLABLE,
 * and the three states are genuinely different — true (the paper is internally
 * consistent), false (it is not, and `tie_out_delta` says by how much), NULL
 * (nobody has computed it). The sentence prints whichever is true and says
 * "not computed" for the third rather than letting a missing check read as a
 * passing one, which is this codebase's standing fault wearing a small hat.
 *
 * SCOPE
 * -----
 * Every `doc_type` in the CHECK constraint is reported, not just `invoice`: a
 * certified credit memo or delivery receipt is the same event to a reader, and
 * the type is in the title. The founder's word was "invoice confirmations", and
 * narrowing to `doc_type = 'invoice'` would silently drop the credit memo a
 * short delivery produces — the document a manager most wants to see confirmed.
 */

const PRODUCER = "invoice_confirmed";

/** `invoice` → `Invoice`, `credit_memo` → `Credit memo`. */
function docTypeLabel(raw: unknown): string {
  const t = String(raw ?? "document").replace(/_/g, " ").trim();
  if (!t) return "Document";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

@Injectable()
export class InvoiceConfirmedProducer {
  private readonly logger = new Logger(InvoiceConfirmedProducer.name);

  static readonly PRODUCER = PRODUCER;
  static readonly LOOKBACK_HOURS = 48;
  static readonly CANDIDATE_CAP = 200;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const client = this.databaseService.getClient();
    const since = new Date(
      now.getTime() - InvoiceConfirmedProducer.LOOKBACK_HOURS * 3_600_000,
    ).toISOString();

    const { data, error } = await client
      .from("procurement_documents")
      .select(
        "id, doc_type, doc_number, doc_date, provider_id, total, currency, ties_out, tie_out_delta, verified_at, verified_by",
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", "verified")
      .gte("verified_at", since)
      .order("verified_at", { ascending: true })
      .limit(InvoiceConfirmedProducer.CANDIDATE_CAP + 1);

    if (error) {
      throw new Error(`could not read procurement_documents: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > InvoiceConfirmedProducer.CANDIDATE_CAP;
    const docs = tally.truncated
      ? rows.slice(0, InvoiceConfirmedProducer.CANDIDATE_CAP)
      : rows;

    if (docs.length === 0) {
      tally.withheldReason = `No document has been certified in the last ${InvoiceConfirmedProducer.LOOKBACK_HOURS} hours.`;
      return tally;
    }

    const vendors = await this.vendorNames(
      restaurantId,
      docs.map((d) => d.provider_id).filter(Boolean),
    );

    for (const doc of docs) {
      const verifiedAt = new Date(doc.verified_at);
      if (!Number.isFinite(verifiedAt.getTime())) {
        tally.failed += 1;
        this.logger.warn(
          `DOCUMENT_VERIFIED_AT_UNREADABLE restaurant=${restaurantId} document=${doc.id} — ` +
            "status is verified but verified_at is not a readable instant; skipped rather than guessed.",
        );
        continue;
      }

      const vendor = doc.provider_id
        ? (vendors.get(doc.provider_id) ?? null)
        : null;
      const label = docTypeLabel(doc.doc_type);
      const number = doc.doc_number ? String(doc.doc_number) : null;
      const total =
        doc.total === null || doc.total === undefined ? null : Number(doc.total);
      const currency = String(doc.currency || "USD");

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally, now },
        {
          // `verified_at` is in the key even though there is no un-verify today:
          // if one is ever added, a re-certification is a new event and this key
          // lets it be said. Without it, the second certification would be
          // permanently unsayable.
          dedupeKey: `document:${doc.id}:${doc.verified_at}`,
          occurredAt: verifiedAt,
          payload: {
            // `invoice_received` — the type the page's register map already
            // carries (nt-format.ts:106 maps it to "Vendor mail") and the
            // one this page's note §13.19 asks for: two producers already write
            // it on a DISCREPANCY (procurement.service.ts:1747, :2365) and this
            // is the matching-good case they were missing.
            type: "invoice_received",
            title: number
              ? `${label} ${number} certified${vendor ? ` — ${vendor}` : ""}`
              : `${label} certified${vendor ? ` — ${vendor}` : ""}`,
            message: this.sentence({
              label,
              vendor,
              total: Number.isFinite(total as number) ? (total as number) : null,
              currency,
              tiesOut: doc.ties_out,
              tieOutDelta:
                doc.tie_out_delta === null || doc.tie_out_delta === undefined
                  ? null
                  : Number(doc.tie_out_delta),
              verifiedAt,
              timeZone,
            }),
            priority: "medium",
            actionUrl: "/receipts",
            actionLabel: "Open the document",
            metadata: {
              documentId: doc.id,
              docType: doc.doc_type ?? null,
              docNumber: number,
              docDate: doc.doc_date ?? null,
              providerId: doc.provider_id ?? null,
              vendorName: vendor,
              // `null` means the extraction never produced a total. It is not a
              // zero-dollar invoice.
              total: Number.isFinite(total as number) ? total : null,
              currency,
              tiesOut: doc.ties_out ?? null,
              tieOutDelta:
                doc.tie_out_delta === null || doc.tie_out_delta === undefined
                  ? null
                  : Number(doc.tie_out_delta),
              verifiedAt: verifiedAt.toISOString(),
              verifiedBy: doc.verified_by ?? null,
              assertion:
                "The transcription is faithful to the paper. This is not an acceptance of the charges, a stock movement, or a settlement.",
              timeZone,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason =
        "Every certification in the window had already been reported.";
    }

    return tally;
  }

  private sentence(input: {
    label: string;
    vendor: string | null;
    total: number | null;
    currency: string;
    tiesOut: boolean | null;
    tieOutDelta: number | null;
    verifiedAt: Date;
    timeZone: string;
  }): string {
    const parts: string[] = [];

    parts.push(
      input.total === null
        ? `${input.label} from ${input.vendor ?? "an unnamed vendor"} carries no extracted total.`
        : `${money(input.total, input.currency)} from ${input.vendor ?? "an unnamed vendor"}.`,
    );

    if (input.tiesOut === true) {
      parts.push("The lines tie out to the stated total.");
    } else if (input.tiesOut === false) {
      parts.push(
        input.tieOutDelta === null
          ? "The lines do not tie out to the stated total."
          : `The lines do not tie out: ${money(Math.abs(input.tieOutDelta), input.currency)} apart from the stated total.`,
      );
    } else {
      parts.push("The tie-out was not computed for this document.");
    }

    parts.push(
      `Certified ${dayIn(input.verifiedAt, input.timeZone)} at ${clockIn(input.verifiedAt, input.timeZone)} as a faithful transcription — not as an acceptance of the charges.`,
    );

    return parts.join(" ");
  }

  private async vendorNames(
    restaurantId: string,
    providerIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = Array.from(new Set(providerIds));
    if (!ids.length) return out;
    // `providers.restaurant_id` is NULLABLE (baseline:4882): a NULL row is a
    // shared catalogue vendor and a non-NULL one belongs to a house. The ids
    // already came from this tenant's own documents, so the filter is not what
    // makes this safe — but a document pointing at another restaurant's private
    // vendor row would otherwise leak that vendor's NAME into this inbox, and a
    // read that is only tenant-safe because of its input is one refactor away
    // from not being. Same clause shape as
    // `vendor-comparison.service.ts:152-156`.
    const { data, error } = await this.databaseService
      .getClient()
      .from("providers")
      .select("id, name")
      .in("id", ids)
      .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`);
    if (error) {
      this.logger.warn(
        `DOCUMENT_VENDOR_NAMES_UNREADABLE — ${error.message}. ` +
          "Notifications will name the document without its vendor.",
      );
      return out;
    }
    for (const row of (data ?? []) as any[]) {
      if (row?.id && row?.name) out.set(row.id, String(row.name));
    }
    return out;
  }
}
