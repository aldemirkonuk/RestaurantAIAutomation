import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { normalizeTaxId, type TaxIdentity } from "./tax-identity";

/**
 * VendorResolutionService — ADR 0104 D15.
 *
 * A document's vendor is resolved BY IDENTITY, without a person and without a
 * guess. Three rules, first match wins, and nothing weaker than rule 2 ever
 * writes anything:
 *
 *   1. the seller's printed tax id normalises, and matches EXACTLY ONE provider
 *      of this restaurant                                          → `matched`
 *   2. it normalises and matches NO provider                       → `created`,
 *      the provider built from the printed identity and flagged provisional
 *   3. anything weaker — nothing printed, malformed, two providers sharing one
 *      id, no seller name to file a new vendor under, a self-billed document,
 *      a disagreement with a vendor the caller already named
 *                                                                  → `unresolved`
 *
 *   and, separately from all three: our own read failed             → `unavailable`
 *
 * WHY `unavailable` IS NOT A KIND OF `unresolved`.
 * "This paper names no identity we can verify" and "we could not look" produce
 * the same picture — a document with no vendor — and only one of them is about
 * the document. Collapsing them is the absence-reported-as-health fault in the
 * place it would be invisible: a broken providers query would look exactly like
 * a corpus of documents that all happen to print no tax id, which is precisely
 * the shape slice 4 measured and precisely what must never be misread again.
 *
 * WHAT IS NOT A RULE, AND WILL NOT BECOME ONE.
 * Name similarity (rejected: not 100%, and it is the failure ADR 0103 A12
 * rejected for shelves). "The only provider we have" (rejected: true today,
 * wrong the day a second vendor appears, and wrong retroactively for every row
 * already written). The caller's last vendor (rejected: it is the caller's
 * context, not the document's). Each of these produces a provider_id that looks
 * identical to a resolved one and is unrecoverable once cost lots, prices and
 * remembered pairings have been written underneath it.
 */

export type VendorResolutionState =
  | "matched"
  | "created"
  | "unresolved"
  | "unavailable";

export interface VendorResolution {
  state: VendorResolutionState;
  /** Non-null ONLY on `matched` and `created`. */
  providerId: string | null;
  source: "matched_tax_id" | "created_from_document" | null;
  /** The identity we read, when we could read one at all. */
  identity: TaxIdentity | null;
  /** A sentence. Always present, on every state including the good ones. */
  reason: string;
  /**
   * The resolution was decided but the append-only log did not take it. The
   * decision still stands and is returned; this names the loss rather than
   * letting a silent catch turn it into "no resolution ever ran".
   */
  logError?: string;
}

export interface SellerParty {
  name?: string | null;
  taxId?: string | null;
  taxOffice?: string | null;
  address?: string | null;
  country?: string | null;
}

export interface ResolveVendorInput {
  restaurantId: string;
  documentId: string;
  seller: SellerParty;
  /** BT-48 — used only to REFUSE, never to resolve. */
  buyerTaxId?: string | null;
  /** `issued_by_us` is our own paper and can never name a provider. */
  direction?: string | null;
  /** UNCL1001; `389` is a self-billed invoice. */
  typeCode?: string | null;
  /** `procurement_documents.jurisdiction`, as a last-resort country. */
  jurisdiction?: string | null;
  /** The provider already on the document, if any. */
  existingProviderId?: string | null;
  documentRevision?: number | null;
  actorUserId?: string | null;
}

/**
 * The columns read from `providers` when matching. Spelled out as a literal so
 * `check_read_columns_exist.py` can see them.
 */
const PROVIDER_MATCH_COLUMNS =
  "id, name, company_name, tax_id, tax_id_normalized, provisional_until_first_order";

@Injectable()
export class VendorResolutionService {
  private readonly logger = new Logger(VendorResolutionService.name);

  constructor(private readonly db: DatabaseService) {}

  async resolveVendor(input: ResolveVendorInput): Promise<VendorResolution> {
    const decided = await this.decide(input);
    const logError = await this.appendResolution(input, decided);
    return logError ? { ...decided, logError } : decided;
  }

  // -------------------------------------------------------------------------

  private async decide(
    input: ResolveVendorInput,
  ): Promise<VendorResolution> {
    const client = this.db.getClient();

    // ---- 0. our own paper never names a provider --------------------------
    if (input.direction === "issued_by_us")
      return unresolved(
        null,
        "This document was issued by us, so its seller block is this restaurant and no vendor is resolved from it.",
      );
    if (String(input.typeCode ?? "").trim() === "389")
      return unresolved(
        null,
        "This document is a self-billed invoice (type 389): the seller block is this restaurant, so no vendor was created from it.",
      );

    // ---- 1. the identity ---------------------------------------------------
    const country =
      input.seller.country ?? countryFromJurisdiction(input.jurisdiction);
    const read = normalizeTaxId(input.seller.taxId, country);
    if (!read.ok)
      return unresolved(
        null,
        `This document names no vendor identity we can verify: ${read.reason}.`,
      );
    const identity = read.identity;

    // ---- 2. is the seller US? ---------------------------------------------
    // Two independent checks, because each catches a case the other cannot: the
    // buyer block catches a document that prints both parties, and the venue's
    // own recorded identity catches one that prints only the seller.
    const buyer = normalizeTaxId(input.buyerTaxId, country);
    if (buyer.ok && buyer.identity.normalized === identity.normalized)
      return unresolved(
        identity,
        `The seller and the buyer on this document carry the same tax identity (${identity.printed}), so it is self-billed or returned and no vendor was created from it.`,
      );

    const venue = await client
      .from("restaurants")
      .select("id, tax_id_normalized")
      .eq("id", input.restaurantId)
      .maybeSingle();
    // A FAILED READ IS NOT "the venue has no tax id". Answering `unresolved`
    // here would be the honest-looking half of the wrong answer; we could not
    // check whether this paper is our own, so we say we could not check.
    if (venue.error)
      return unavailable(
        identity,
        `The venue's own tax identity could not be read, so this document could not be checked for being self-billed: ${venue.error.message}`,
      );
    const venueIdentity =
      (venue.data as { tax_id_normalized: string | null } | null)
        ?.tax_id_normalized ?? null;
    if (venueIdentity && venueIdentity === identity.normalized)
      return unresolved(
        identity,
        `The seller on this document carries this restaurant's own tax identity (${identity.printed}), so it is self-billed or returned and no vendor was created from it.`,
      );

    // ---- 3. rule 1: exactly one provider carries it ------------------------
    const providers = await client
      .from("providers")
      .select(PROVIDER_MATCH_COLUMNS)
      .eq("restaurant_id", input.restaurantId)
      .eq("tax_id_normalized", identity.normalized)
      .is("deleted_at", null);
    if (providers.error)
      return unavailable(
        identity,
        `The providers on file could not be read, so this document's vendor was not looked for: ${providers.error.message}`,
      );

    const rows = (providers.data ?? []) as {
      id: string;
      name: string | null;
      company_name: string | null;
    }[];

    if (rows.length > 1)
      return unresolved(
        identity,
        `${rows.length} providers on file carry the tax identity ${identity.printed}, so it does not identify one vendor. Merge them and the next document resolves.`,
      );

    if (rows.length === 1) {
      const p = rows[0];
      const name = p.company_name || p.name || "this vendor";
      if (
        input.existingProviderId &&
        input.existingProviderId !== p.id
      )
        return unresolved(
          identity,
          `This document is already filed under a different vendor, but its printed tax identity ${identity.printed} belongs to ${name}. Nothing was changed; the disagreement is recorded.`,
        );
      return {
        state: "matched",
        providerId: p.id,
        source: "matched_tax_id",
        identity,
        reason: `Matched on ${schemeWord(identity)} ${identity.printed} — exactly one provider on file carries it (${name}).`,
      };
    }

    // ---- 4. rule 2: create the provider from the printed identity ---------
    if (input.existingProviderId)
      return unresolved(
        identity,
        `This document is already filed under a vendor, and its printed tax identity ${identity.printed} is on no provider we hold. Nothing was changed; the disagreement is recorded.`,
      );

    const printedName = trimmed(input.seller.name);
    // An identity with no name is not enough to CREATE a vendor: we would have
    // to invent what to call it, and a row named after its own tax number reads
    // as fabricated to everyone who meets it later. Refusing is the safe
    // direction and the next document that prints a name resolves it.
    if (!printedName)
      return unresolved(
        identity,
        `This document prints the tax identity ${identity.printed} but no seller name, so there is nothing to file a new vendor under.`,
      );

    const created = await client
      .from("providers")
      .insert({
        // Inline literals, never a spread: `check_order_capture_contract.py`
        // can only read a write whose column names are literal.
        name: printedName,
        company_name: printedName,
        primary_contact: {},
        restaurant_id: input.restaurantId,
        tax_id: identity.printed,
        tax_id_normalized: identity.normalized,
        tax_country: identity.country,
        tax_office: trimmed(input.seller.taxOffice),
        address: trimmed(input.seller.address),
        is_custom: true,
        provisional_until_first_order: true,
        created_from_document_id: input.documentId,
      })
      .select("id")
      .single();

    if (created.error) {
      // 23505 is the race: a second document resolved the same identity between
      // our read and our write. The unique index is what makes that safe — the
      // loser re-reads and finds the row the winner created, so two documents
      // from one vendor arriving together still produce ONE provider.
      if (created.error.code === "23505") {
        const again = await client
          .from("providers")
          .select(PROVIDER_MATCH_COLUMNS)
          .eq("restaurant_id", input.restaurantId)
          .eq("tax_id_normalized", identity.normalized)
          .is("deleted_at", null);
        if (again.error)
          return unavailable(
            identity,
            `Another document created this vendor at the same moment and the re-read failed, so this document was left unresolved: ${again.error.message}`,
          );
        const row = ((again.data ?? []) as { id: string }[])[0];
        if (row)
          return {
            state: "matched",
            providerId: row.id,
            source: "matched_tax_id",
            identity,
            reason: `Matched on ${schemeWord(identity)} ${identity.printed} — the vendor was created from another document arriving at the same moment, and this document was filed under that one row rather than a second copy of it.`,
          };
      }
      return unavailable(
        identity,
        `The vendor could not be created from this document's printed identity, so the document was left unresolved: ${created.error.message}`,
      );
    }

    return {
      state: "created",
      providerId: (created.data as { id: string }).id,
      source: "created_from_document",
      identity,
      reason: `Created from this document's printed identity — ${printedName}, ${schemeWord(identity)} ${identity.printed}. No provider on file carried it. The vendor is provisional until the first order.`,
    };
  }

  /**
   * One immutable row per RUN, whatever the outcome. A refusal is logged as
   * loudly as a match: the question "did resolution ever look at this document"
   * must have an answer, and a table that only records successes answers it
   * wrongly for every document it skipped.
   */
  private async appendResolution(
    input: ResolveVendorInput,
    r: VendorResolution,
  ): Promise<string | undefined> {
    const { error } = await this.db
      .getClient()
      .from("document_vendor_resolutions")
      .insert({
        document_id: input.documentId,
        restaurant_id: input.restaurantId,
        state: r.state,
        source: r.source,
        provider_id: r.providerId,
        matched_tax_id_normalized: r.identity?.normalized ?? null,
        matched_tax_id_printed: r.identity?.printed ?? null,
        tax_id_scheme: r.identity?.scheme ?? null,
        reason: r.reason,
        document_revision: input.documentRevision ?? null,
        resolved_by: input.actorUserId ?? null,
      });
    if (!error) return undefined;
    this.logger.warn(
      `document ${input.documentId} resolved as ${r.state} but the resolution log did not take it: ${error.message}`,
    );
    return error.message;
  }

  /**
   * Write the resolved vendor onto the document — and ONLY when the document
   * names none. A provider a caller supplied is a fact about the order, not a
   * reading of the paper, and D15 does not overwrite it; the disagreement is
   * recorded by `decide` instead.
   */
  async applyToDocument(
    restaurantId: string,
    documentId: string,
    r: VendorResolution,
  ): Promise<string | undefined> {
    if (r.state !== "matched" && r.state !== "created") return undefined;
    if (!r.providerId) return undefined;
    const { error } = await this.db
      .getClient()
      .from("procurement_documents")
      .update({ provider_id: r.providerId })
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .is("provider_id", null);
    if (!error) return undefined;
    this.logger.warn(
      `document ${documentId} resolved to provider ${r.providerId} but the document was not updated: ${error.message}`,
    );
    return error.message;
  }

  /** The latest answer for one document. A failed read says so (ADR 0067). */
  async latestFor(
    restaurantId: string,
    documentId: string,
  ): Promise<
    | { ok: true; value: LatestResolution | null }
    | { ok: false; error: string }
  > {
    const { data, error } = await this.db
      .getClient()
      .from("document_vendor_resolutions")
      .select(
        "id, document_id, restaurant_id, state, source, provider_id, " +
          "matched_tax_id_normalized, matched_tax_id_printed, tax_id_scheme, " +
          "reason, document_revision, resolved_at",
      )
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .order("resolved_at", { ascending: false })
      .limit(1);
    if (error)
      return {
        ok: false,
        error: `document_vendor_resolutions read failed for ${documentId}: ${error.message}`,
      };
    const row = ((data ?? []) as LatestResolution[])[0] ?? null;
    return { ok: true, value: row };
  }
}

export interface LatestResolution {
  id: string;
  state: VendorResolutionState;
  source: "matched_tax_id" | "created_from_document" | null;
  provider_id: string | null;
  matched_tax_id_normalized: string | null;
  matched_tax_id_printed: string | null;
  tax_id_scheme: string | null;
  reason: string;
  document_revision: number | null;
  resolved_at: string;
}

// ---- helpers ---------------------------------------------------------------

function unresolved(
  identity: TaxIdentity | null,
  reason: string,
): VendorResolution {
  return { state: "unresolved", providerId: null, source: null, identity, reason };
}

function unavailable(
  identity: TaxIdentity | null,
  reason: string,
): VendorResolution {
  return {
    state: "unavailable",
    providerId: null,
    source: null,
    identity,
    reason,
  };
}

function trimmed(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** What to CALL the identity in a sentence a bookkeeper reads. */
function schemeWord(i: TaxIdentity): string {
  switch (i.scheme) {
    case "TR_VKN":
      return "VKN";
    case "TR_TCKN":
      return "TCKN";
    case "US_EIN":
      return "EIN";
    case "EU_VAT":
      return `${i.country} VAT id`;
    default:
      return "tax id";
  }
}

/** The document's jurisdiction, where it implies a country. */
function countryFromJurisdiction(j: string | null | undefined): string | null {
  const v = String(j ?? "").trim().toUpperCase();
  if (v === "TR") return "TR";
  if (v.startsWith("US")) return "US";
  return null;
}
