/**
 * The manager's statement about a sender's price code: reading it, making it,
 * and withdrawing it.
 *
 * ROLE. Every write here is a manager-or-owner act, gated on the CONTROLLER by
 * `OrganizationsService.assertCanManageRestaurant` — the same door
 * `/settings`'s threshold and flag writes go through. The gate is not repeated
 * here on purpose: two gates that can disagree are worse than one that cannot,
 * and `distributor-feed.controller.ts` is the only caller.
 *
 * WHAT A FAILED READ RETURNS. Not an empty map. `supabase-js` resolves
 * `{ data, error }` and never throws, so a swallowed error would turn "we could
 * not read this house's mappings" into "this house has mapped nothing" — and
 * the second silently refuses every line of a perfectly good catalogue while
 * telling the manager their mapping did not take. `readFailed` is carried out
 * to the caller in words (ADR 0020 / ADR 0051).
 *
 * WHAT A WITHDRAWAL DOES AND DOES NOT DO. It stops the statement admitting NEW
 * rows. It deletes nothing: `vendor_price_observations.price_code_mapping_id`
 * is `ON DELETE RESTRICT`, the rows the statement already admitted stay exactly
 * where they are, and the mark they carry is the join to `withdrawn_at` rather
 * than a flag stamped on each one. A stamped flag needs a backfill that can
 * half-succeed and can then disagree with the mapping it reflects; the join
 * cannot.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CODE_FIELD_EDI_832,
  MappingReadOutcome,
  PriceCodeMapping,
  liveMappingsByCode,
  normalisePriceCode,
} from "./price-code-mappings";

const COLUMNS =
  "id, restaurant_id, distributor_key, code_field, price_code, price_basis, evidence, declared_by, declared_by_name, declared_at, withdrawn_by, withdrawn_by_name, withdrawn_at, withdrawn_reason";

export interface MappingsForSender extends MappingReadOutcome {
  restaurantId: string;
  distributorKey: string;
  rows: PriceCodeMapping[];
  /** True when the register could not be read. NEVER rendered as "none". */
  readFailed: boolean;
  /** Words for the surface, always. */
  note: string;
}

export interface DeclareRequest {
  restaurantId: string;
  distributorKey: string;
  priceCode: string;
  priceBasis: string;
  evidence: string;
  declaredBy: string;
  declaredByName: string;
}

export interface WriteOutcome {
  ok: boolean;
  mappingId: string | null;
  /** Why not. Null only when `ok`. */
  refusedBecause: string | null;
}

@Injectable()
export class PriceCodeMappingsService {
  private readonly logger = new Logger(PriceCodeMappingsService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Every statement this house holds for one sender, live and withdrawn. */
  async forSender(
    restaurantId: string,
    distributorKey: string,
  ): Promise<MappingsForSender> {
    const empty: MappingsForSender = {
      restaurantId,
      distributorKey,
      rows: [],
      byCode: {},
      conflicted: [],
      live: 0,
      withdrawn: 0,
      readFailed: false,
      note: "",
    };
    try {
      const { data, error } = await this.db.client
        .from("distributor_price_code_mappings")
        .select(COLUMNS)
        .eq("restaurant_id", restaurantId)
        .eq("distributor_key", distributorKey)
        .order("declared_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).map(mapRow);
      const read = liveMappingsByCode(rows);
      return { ...empty, rows, ...read, note: noteFor(read) };
    } catch (err) {
      this.logger.warn(
        `could not read this house's price-code mappings for ${distributorKey}: ${(err as Error).message}`,
      );
      return {
        ...empty,
        readFailed: true,
        note: "This house's price-code mappings could not be read. This is unknown, not none — no catalogue should be parsed until it is readable, because every line would be refused as unmapped and the refusal would be a lie.",
      };
    }
  }

  /**
   * A manager says what a code means.
   *
   * Refuses before it writes, in words, so the person gets a sentence rather
   * than a constraint violation. The database refuses the same things a second
   * time; both are deliberate.
   */
  async declare(req: DeclareRequest): Promise<WriteOutcome> {
    const code = normalisePriceCode(req.priceCode);
    if (!code) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause: `'${req.priceCode ?? ""}' is not a price-identifier code. X12 codes are up to sixteen letters and digits.`,
      };
    }
    const basis = (req.priceBasis ?? "").trim();
    if (!basis) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause:
          "say what the code means. There is no default trade level here and there will not be one: a default would be this product naming a price it was never told.",
      };
    }
    const evidence = (req.evidence ?? "").trim();
    if (!evidence) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause:
          "say how you know — the distributor's implementation guide, your rep's email, a printed price sheet. A year from now, 'somebody typed it' and 'page 7 of the guide' are different qualities of evidence and the row must be able to tell them apart.",
      };
    }
    if (!(req.declaredByName ?? "").trim()) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause:
          "the statement must name the person making it; no name was resolved for this account.",
      };
    }

    const existing = await this.forSender(req.restaurantId, req.distributorKey);
    if (existing.readFailed) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause:
          "this house's existing mappings could not be read, so a new one cannot be checked against them. Nothing was written.",
      };
    }
    if (existing.byCode[code] || existing.conflicted.includes(code)) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause: `${code} already has a live meaning for this sender. Withdraw it first, with a reason — the old statement is kept, and the rows it admitted keep pointing at it.`,
      };
    }

    try {
      const { data, error } = await this.db.client
        .from("distributor_price_code_mappings")
        .insert({
          restaurant_id: req.restaurantId,
          distributor_key: req.distributorKey,
          code_field: CODE_FIELD_EDI_832,
          price_code: code,
          price_basis: basis,
          evidence,
          declared_by: req.declaredBy,
          declared_by_name: req.declaredByName.trim(),
        })
        .select("id")
        .single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      this.logger.log(
        `price-code mapping declared: ${req.distributorKey} ${code} -> "${basis}" by ${req.declaredByName} (${id})`,
      );
      return { ok: true, mappingId: id, refusedBecause: null };
    } catch (err) {
      return {
        ok: false,
        mappingId: null,
        refusedBecause: `the mapping was not written: ${(err as Error).message}`,
      };
    }
  }

  /**
   * A manager withdraws a statement. The rows it admitted are marked, not
   * deleted — see `rowsAdmittedBy`.
   */
  async withdraw(args: {
    mappingId: string;
    restaurantId: string;
    withdrawnBy: string;
    withdrawnByName: string;
    reason: string;
  }): Promise<WriteOutcome> {
    const reason = (args.reason ?? "").trim();
    if (!reason) {
      return {
        ok: false,
        mappingId: args.mappingId,
        refusedBecause:
          "say why it is being withdrawn. A statement that stopped working and cannot say why leaves the rows it admitted unexplainable.",
      };
    }
    // The withdrawal is signed, exactly as the statement is. Refused here in
    // words rather than written blank and refused by the CHECK as a 23514: an
    // unsigned withdrawal is the state migration 20260906150000 exists to end,
    // and this register must not be able to say when and why but not by whom.
    const withdrawnByName = (args.withdrawnByName ?? "").trim();
    if (!withdrawnByName) {
      return {
        ok: false,
        mappingId: args.mappingId,
        refusedBecause:
          "the withdrawal must name the person making it; no name was resolved for this account.",
      };
    }
    try {
      const { data, error } = await this.db.client
        .from("distributor_price_code_mappings")
        .update({
          withdrawn_at: new Date().toISOString(),
          withdrawn_by: args.withdrawnBy,
          withdrawn_by_name: withdrawnByName,
          withdrawn_reason: reason,
        })
        .eq("id", args.mappingId)
        // The tenant filter is on the WRITE, not only on the read that found
        // the id: a manager of one house must not be able to withdraw
        // another's statement by guessing a uuid.
        .eq("restaurant_id", args.restaurantId)
        .is("withdrawn_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return {
          ok: false,
          mappingId: args.mappingId,
          refusedBecause:
            "no live mapping of this house has that id. It may already have been withdrawn, in which case its original withdrawal reason stands and is not overwritten.",
        };
      }
      return { ok: true, mappingId: args.mappingId, refusedBecause: null };
    } catch (err) {
      return {
        ok: false,
        mappingId: args.mappingId,
        refusedBecause: `the withdrawal was not written: ${(err as Error).message}`,
      };
    }
  }

  /**
   * Every price this statement admitted — the one query ADR 0126 Q3 asks for.
   *
   * A count, not the rows: the question a person asks after a bad price is
   * "how far did this go", and the answer is a number and then a decision. The
   * rows themselves are read by the ordinary market-box path, which already
   * knows how to render a sighting.
   */
  async rowsAdmittedBy(
    mappingId: string,
  ): Promise<{ count: number | null; unreadable: string | null }> {
    try {
      const { count, error } = await this.db.client
        .from("vendor_price_observations")
        .select("id", { count: "exact", head: true })
        .eq("price_code_mapping_id", mappingId);
      if (error) throw error;
      return { count: count ?? 0, unreadable: null };
    } catch (err) {
      // NEVER 0. "No rows came from this mapping" and "we could not count
      // them" are different answers and only one of them is reassuring.
      return { count: null, unreadable: (err as Error).message };
    }
  }
}

function mapRow(row: Record<string, unknown>): PriceCodeMapping {
  return {
    id: String(row.id),
    restaurantId: String(row.restaurant_id),
    distributorKey: String(row.distributor_key),
    codeField: CODE_FIELD_EDI_832,
    priceCode: String(row.price_code),
    priceBasis: String(row.price_basis),
    evidence: String(row.evidence),
    declaredBy: String(row.declared_by),
    declaredByName: String(row.declared_by_name),
    declaredAt: String(row.declared_at),
    withdrawnBy: (row.withdrawn_by as string) ?? null,
    withdrawnByName: (row.withdrawn_by_name as string) ?? null,
    withdrawnAt: (row.withdrawn_at as string) ?? null,
    withdrawnReason: (row.withdrawn_reason as string) ?? null,
  };
}

function noteFor(read: MappingReadOutcome): string {
  if (read.conflicted.length > 0) {
    return `${read.conflicted.join(", ")} ${read.conflicted.length === 1 ? "has" : "have"} more than one live meaning here, so ${read.conflicted.length === 1 ? "it is" : "they are"} refused rather than resolved by recency. Withdraw the wrong one.`;
  }
  if (read.live === 0) {
    return read.withdrawn > 0
      ? `No code has a live meaning for this sender; ${read.withdrawn} withdrawn ${read.withdrawn === 1 ? "statement is" : "statements are"} kept. Every priced line will be refused until a manager maps its code.`
      : "No code has been mapped for this sender, so every priced line will be refused. That is the safe answer, not a fault: nobody has told this register what the sender's trade levels mean.";
  }
  return `${read.live} live ${read.live === 1 ? "meaning" : "meanings"}${read.withdrawn ? `, ${read.withdrawn} withdrawn and kept` : ""}. Any code outside them is still refused.`;
}
