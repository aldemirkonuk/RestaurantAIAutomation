/**
 * Admitting a house-obtained distributor catalogue — the surface ADR 0126's
 * batch-56 answer asked for.
 *
 * THE FOUNDER, 2026-09-05: *"Invoices + the built 810 ingest, and a letter for a
 * feed"* and *"Build the ingest route and the panel."* No mirror, no credential,
 * no session hand-over: the house obtains the file itself — from its rep, from
 * its own portal export, from the EDI feed it asked for — and hands it over.
 *
 * WHY THIS IS NOT A SECOND DOOR
 * -----------------------------
 * `POST /procurement/documents` already takes a file, hashes it, dedups it per
 * restaurant, stores the original bytes and records who sent it. An 832 goes
 * through THAT door: `document-intake.service.ts` classifies it as a
 * `price_list` document and stores it with its sha256 and uploader, exactly as
 * it does an invoice. This service is the second half — turning that stored
 * catalogue into class-C sightings — and it is called with the document already
 * on the record, so a catalogue whose lines are all refused is still a document
 * a person can find, open and re-read.
 *
 * WHAT IT REFUSES, AND WHY EVERY REFUSAL IS NAMED
 * ----------------------------------------------
 * "0 rows" is the answer this repo's own cardinal fault would give. A catalogue
 * admits nothing for at least seven distinguishable reasons, and a house shown
 * one number cannot tell "your file is broken" from "nobody has told us what
 * your distributor's price code means" — which is a five-minute fix by the
 * manager holding the guide (ADR 0126 Q3). So every line comes back with its
 * reason, the unmapped codes come back BY NAME, and a mapping read that FAILED
 * refuses the whole admission rather than letting every line be refused as
 * unmapped, which would be a true-shaped lie.
 *
 * NOTHING HERE FETCHES ANYTHING. The bytes were handed over by a person.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { normalizeUnitPrice } from "../analytics/engine/vendor-price-consensus";
import { OrganizationsService } from "../organizations/organizations.service";
import { PriceCodeMappingsService } from "./price-code-mappings.service";
import { DISTRIBUTORS } from "./distributor-feed.registry";
import {
  Edi832Run,
  FeedSighting,
  parseEdi832,
  tallyFeedRefusals,
} from "./parse-edi832";
import { attributionFor } from "./price-code-mappings";

export interface CatalogueIngestInput {
  restaurantId: string;
  /** The registry key the uploader named. An unknown one is refused by name. */
  distributorKey: string;
  /** The catalogue's raw text, exactly as the file carried it. */
  raw: string;
  /** sha256 of the FILE's bytes — the document door's own hash, not ours. */
  sha256: string;
  /** The stored document this catalogue is, when the door wrote one. */
  documentId: string | null;
  uploadedBy: string;
  /** As the session names them. Never a placeholder. */
  uploadedByName: string | null;
  /** Our clock: when the file reached us. */
  receivedAt: string;
  /** Used only when the file carries no `CUR`. Absent = the file is refused. */
  declaredCurrency?: string | null;
  providerId?: string | null;
  filename?: string | null;
}

/** One line's fate, in the words a person can act on. */
export interface CatalogueLineOutcome {
  admitted: boolean;
  /** The item as the catalogue named it, or the refusal's own subject. */
  item: string;
  reason: string | null;
  detail: string | null;
  /** Present only on an admitted line. */
  priceBasis?: string;
  priceCode?: string;
  rawPrice?: number;
  currency?: string;
  attribution?: string;
}

export interface CatalogueAdmission {
  distributorKey: string;
  distributorName: string | null;
  sha256: string;
  documentId: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  uploadedAt: string;
  catalogNumber: string | null;
  catalogVersion: string | null;
  currency: string | null;
  linesRead: number;
  admitted: number;
  refused: number;
  /** Rows the database already held at this exact content. Not a failure. */
  alreadyRecorded: number;
  /** Rows that could not be written, with the database's own message. */
  writeFailed: number;
  writeFailures: string[];
  refusalsByReason: Record<string, number>;
  /** Codes this house has not stated a meaning for, by name. */
  unmappedCodes: string[];
  lines: CatalogueLineOutcome[];
  /** Set when NOTHING was parsed at all, with the sentence saying why. */
  refusedWhole: string | null;
  /** The mapping read's own state — never collapsed into "no mappings". */
  mappings: {
    live: number;
    withdrawn: number;
    conflicted: string[];
    readFailed: boolean;
    note: string;
  };
  /** One sentence for a panel. Never "0 rows" on its own. */
  sentence: string;
}

/** The columns a class-C sighting occupies. Named, never spread. */
interface FeedSightingRow {
  restaurant_id: string;
  provider_id: string | null;
  vendor_name_raw: string;
  product_name_raw: string;
  source_type: string;
  trust_tier: number;
  source_ref: string;
  source_url: string | null;
  observed_at: string;
  effective_date: string;
  raw_price: number;
  currency: string;
  pack_size: number;
  unit_volume_ml: number;
  normalized_unit_price: number;
  normalization_note: string;
  content_hash: string;
  price_code_mapping_id: string | null;
  raw: Record<string, unknown>;
}

/** Postgres' unique-violation code. A dedup hit, not a failure. */
const UNIQUE_VIOLATION = "23505";

@Injectable()
export class CatalogIngestService {
  private readonly logger = new Logger(CatalogIngestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mappings: PriceCodeMappingsService,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * Admit one catalogue for one house.
   *
   * Returns rather than throws for everything a person could fix, because the
   * document is already stored by the time this runs and a thrown error would
   * lose the report while keeping the file.
   */
  async admit(input: CatalogueIngestInput): Promise<CatalogueAdmission> {
    const entry = DISTRIBUTORS[input.distributorKey];
    const base: CatalogueAdmission = {
      distributorKey: input.distributorKey,
      distributorName: entry?.distributor ?? null,
      sha256: input.sha256,
      documentId: input.documentId,
      uploadedBy: input.uploadedBy,
      uploadedByName: input.uploadedByName,
      uploadedAt: input.receivedAt,
      catalogNumber: null,
      catalogVersion: null,
      currency: null,
      linesRead: 0,
      admitted: 0,
      refused: 0,
      alreadyRecorded: 0,
      writeFailed: 0,
      writeFailures: [],
      refusalsByReason: {},
      unmappedCodes: [],
      lines: [],
      refusedWhole: null,
      mappings: {
        live: 0,
        withdrawn: 0,
        conflicted: [],
        readFailed: false,
        note: "",
      },
      sentence: "",
    };

    /**
     * THE DOOR IS OPEN TO STAFF; THE PRICE REGISTER IS NOT.
     *
     * `POST /procurement/documents` carries `JwtAuthGuard` and no role gate,
     * and that is correct: a runner photographs the paper at the delivery door,
     * and a role check there would lose documents at the moment they arrive.
     * Admitting a catalogue's prices is a different act — it writes rows a
     * house buys against — so it is manager-or-owner, the same posture the
     * price-code statements themselves carry (ADR 0126 §7, ADR 0114).
     *
     * It is NOT a thrown 403. The document is already stored by the time this
     * runs, and a throw would turn a stored-and-not-priced file into a 4xx that
     * reads as "your upload failed" — so the refusal comes back as the
     * catalogue's own answer, naming the rule and saying the file is on the
     * record.
     */
    try {
      await this.organizations.assertCanManageRestaurant(
        input.uploadedBy,
        input.restaurantId,
        "admit a distributor catalogue's prices to this house's register",
      );
    } catch (err) {
      return {
        ...base,
        refusedWhole: `${(err as Error).message}. The file itself was stored and nothing was lost — a manager or owner can admit its prices by uploading it again, and the document is already on this house's record either way.`,
        sentence:
          "Stored, and nothing priced: admitting a catalogue's prices is a manager's act.",
      };
    }

    if (!entry) {
      const known = Object.keys(DISTRIBUTORS).sort().join(", ");
      return {
        ...base,
        refusedWhole: `'${input.distributorKey}' is not a distributor this register has measured, so there is no house statement to read its price codes against. The keys it holds are: ${known}. The file was stored; nothing was priced.`,
        sentence: `Nothing was priced: the sender '${input.distributorKey}' is not in this register.`,
      };
    }

    const read = await this.mappings.forSender(
      input.restaurantId,
      input.distributorKey,
    );
    const mappings = {
      live: read.live,
      withdrawn: read.withdrawn,
      conflicted: read.conflicted,
      readFailed: read.readFailed,
      note: read.note,
    };

    /**
     * A FAILED read is not an empty one, and here the difference decides the
     * report. `forSender` returns an empty map on failure, and parsing against
     * it would refuse every line as `unmapped_price_basis` — a report that
     * blamed the house's distributor for this gateway's own database error.
     * `forSender`'s own note says so in as many words.
     */
    if (read.readFailed) {
      return {
        ...base,
        mappings,
        refusedWhole: `This house's price-code statements could not be read, so no line of this catalogue was judged. That is unknown, not none — parsing against an unreadable mapping would refuse every line as unmapped and blame your distributor for our own failed read. The file is stored and can be admitted again once the read works. ${read.note}`,
        sentence:
          "Nothing was priced: this house's price-code statements could not be read. Unknown, not none.",
      };
    }

    const run = parseEdi832(input.raw, {
      restaurantId: input.restaurantId,
      distributorKey: input.distributorKey,
      distributorName: entry.distributor,
      priceBasisByCode: read.byCode,
      receivedAt: input.receivedAt,
      declaredCurrency: input.declaredCurrency ?? null,
      providerId: input.providerId ?? null,
      sourceUrl: null,
    });

    const lines: CatalogueLineOutcome[] = run.refusals.map((r) => ({
      admitted: false,
      item: subjectOf(r.detail),
      reason: r.reason,
      detail: r.detail,
    }));

    if (run.refusedWhole) {
      return {
        ...base,
        mappings,
        catalogNumber: run.catalogNumber,
        catalogVersion: run.catalogVersion,
        currency: run.currency,
        linesRead: run.linesRead,
        refused: run.refusals.length,
        refusalsByReason: tallyFeedRefusals(run.refusals),
        unmappedCodes: run.unmappedCodes,
        lines,
        refusedWhole: run.refusedWhole,
        sentence: `Nothing was priced. ${run.refusedWhole}`,
      };
    }

    let admitted = 0;
    let alreadyRecorded = 0;
    const writeFailures: string[] = [];

    for (const sighting of run.sightings) {
      const outcome = await this.write(sighting, input, entry.distributor);
      if (outcome === "written") admitted += 1;
      else if (outcome === "duplicate") alreadyRecorded += 1;
      else writeFailures.push(outcome.failure);

      lines.push({
        admitted: outcome === "written" || outcome === "duplicate",
        item: sighting.productNameRaw,
        reason:
          outcome === "written"
            ? null
            : outcome === "duplicate"
              ? "already_recorded"
              : "write_failed",
        detail:
          outcome === "written"
            ? null
            : outcome === "duplicate"
              ? "This exact price, at this size and basis, is already on the record for this item. A re-read that found nothing new is not new evidence."
              : outcome.failure,
        priceBasis: sighting.priceBasis,
        priceCode: sighting.priceCode,
        rawPrice: sighting.rawPrice,
        currency: sighting.currency,
        attribution: attributionFor(
          {
            mappingId: sighting.priceCodeMappingId,
            priceBasis: sighting.priceBasis,
            declaredByName: sighting.priceCodeDeclaredByName,
            declaredAt: sighting.priceCodeDeclaredAt,
          },
          sighting.priceCode,
        ),
      });
    }

    const refusalsByReason = tallyFeedRefusals(run.refusals);
    return {
      ...base,
      mappings,
      catalogNumber: run.catalogNumber,
      catalogVersion: run.catalogVersion,
      currency: run.currency,
      linesRead: run.linesRead,
      admitted,
      refused: run.refusals.length,
      alreadyRecorded,
      writeFailed: writeFailures.length,
      writeFailures,
      refusalsByReason,
      unmappedCodes: run.unmappedCodes,
      lines,
      refusedWhole: null,
      sentence: admissionSentence({
        admitted,
        alreadyRecorded,
        refused: run.refusals.length,
        writeFailed: writeFailures.length,
        linesRead: run.linesRead,
        refusalsByReason,
        unmappedCodes: run.unmappedCodes,
        distributor: entry.distributor,
      }),
    };
  }

  /**
   * Write one sighting, and tell the caller which of three things happened.
   *
   * The unique index on `(source_ref, content_hash)` exists so a re-read that
   * found nothing new is discarded rather than inflating the observation count
   * (`20260805154027_vendor_price_observations.sql:141`). A house handing over
   * the same catalogue twice is exactly that, so a 23505 is reported as
   * `duplicate` and NEVER as a failure — but every other error IS a failure and
   * is carried back in words, because a row that did not land must not be
   * counted as one that did.
   */
  private async write(
    sighting: FeedSighting,
    input: CatalogueIngestInput,
    distributorName: string,
  ): Promise<"written" | "duplicate" | { failure: string }> {
    const { unitPrice, note } = normalizeUnitPrice({
      price: sighting.rawPrice,
      sourceType: sighting.sourceType,
      observedAt: sighting.observedAt,
      packSize: sighting.packSize,
      unitVolumeMl: sighting.unitVolumeMl,
      yieldFactor: 1,
    });
    if (unitPrice === null) {
      return {
        failure: `${sighting.productNameRaw}: the price could not be normalised to a 750 ml equivalent (${note}), so it was not written. An un-normalised row cannot be ranked and would sit in the ladder unread.`,
      };
    }

    const row: FeedSightingRow = {
      restaurant_id: sighting.restaurantId,
      provider_id: sighting.providerId,
      vendor_name_raw: sighting.vendorNameRaw,
      product_name_raw: sighting.productNameRaw,
      source_type: sighting.sourceType,
      trust_tier: sighting.trustTier,
      source_ref: sighting.sourceRef,
      source_url: sighting.sourceUrl,
      observed_at: sighting.observedAt,
      effective_date: sighting.effectiveDate as string,
      raw_price: sighting.rawPrice,
      currency: sighting.currency,
      pack_size: sighting.packSize,
      unit_volume_ml: sighting.unitVolumeMl,
      normalized_unit_price: unitPrice,
      normalization_note: note,
      content_hash: sighting.contentHash,
      price_code_mapping_id: sighting.priceCodeMappingId,
      raw: {
        ...sighting.raw,
        /**
         * PROVENANCE, on the row itself.
         *
         * Who handed the file over, when it reached us, the file's own sha256
         * and the sender — so "where did this price come from" is answerable
         * from the row without joining anything, and a catalogue whose stored
         * document is later deleted still names the bytes it came from.
         */
        handover: {
          origin: "house_obtained_edi_832",
          uploadedBy: input.uploadedBy,
          uploadedByName: input.uploadedByName,
          uploadedAt: input.receivedAt,
          fileSha256: input.sha256,
          filename: input.filename ?? null,
          documentId: input.documentId,
          senderKey: input.distributorKey,
          senderName: distributorName,
        },
      },
    };

    try {
      const { error } = await this.db.client
        .from("vendor_price_observations")
        .insert(row);
      if (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION)
          return "duplicate";
        return {
          failure: `${sighting.productNameRaw}: ${error.message}`,
        };
      }
      return "written";
    } catch (err) {
      this.logger.warn(
        `a class-C sighting could not be written for ${input.restaurantId}: ${(err as Error).message}`,
      );
      return {
        failure: `${sighting.productNameRaw}: ${(err as Error).message}`,
      };
    }
  }
}

/** The item a refusal is about, pulled off the front of its own sentence. */
function subjectOf(detail: string): string {
  const m = /^item ([^\s]+)/.exec(detail) ?? /^LIN ([^\s]+)/.exec(detail);
  return m ? m[1] : "(the whole document)";
}

/**
 * The sentence a panel prints.
 *
 * It never says "0 rows" alone. When nothing was admitted the sentence says WHY
 * the largest group was refused and, when that reason is an unstated trade
 * level, names the codes — because that refusal has a fix and the fix is a
 * person typing what they already know (ADR 0126 Q3).
 */
export function admissionSentence(a: {
  admitted: number;
  alreadyRecorded: number;
  refused: number;
  writeFailed: number;
  linesRead: number;
  refusalsByReason: Record<string, number>;
  unmappedCodes: string[];
  distributor: string;
}): string {
  const parts: string[] = [];
  parts.push(
    `${a.linesRead} ${a.linesRead === 1 ? "line" : "lines"} read from ${a.distributor}.`,
  );
  if (a.admitted > 0)
    parts.push(
      `${a.admitted} priced against this house's own statements of what its codes mean.`,
    );
  if (a.alreadyRecorded > 0)
    parts.push(
      `${a.alreadyRecorded} already on the record at this exact price, size and basis.`,
    );
  if (a.writeFailed > 0)
    parts.push(
      `${a.writeFailed} could not be written and ${a.writeFailed === 1 ? "is" : "are"} named below — those prices are NOT recorded.`,
    );
  if (a.refused > 0) {
    const ranked = Object.entries(a.refusalsByReason).sort(
      (x, y) => y[1] - x[1],
    );
    const worded = ranked
      .map(([reason, n]) => `${n} ${REFUSAL_WORDS[reason] ?? reason}`)
      .join("; ");
    parts.push(`${a.refused} refused — ${worded}.`);
  }
  if (a.unmappedCodes.length) {
    parts.push(
      `Nobody at this house has yet said what ${a.unmappedCodes.map((c) => `'${c}'`).join(", ")} ${a.unmappedCodes.length === 1 ? "means" : "mean"} on ${a.distributor}'s paper. State ${a.unmappedCodes.length === 1 ? "it" : "them"} and re-upload the same file: the lines under ${a.unmappedCodes.length === 1 ? "that code" : "those codes"} will price.`,
    );
  }
  if (a.admitted === 0 && a.alreadyRecorded === 0 && a.refused === 0) {
    parts.push(
      "No line carried a price at all, so there was nothing to admit or refuse.",
    );
  }
  return parts.join(" ");
}

/** A refusal reason in the words a manager can act on. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  unmapped_price_basis:
    "priced under a code nobody here has stated a meaning for",
  no_size: "with no stated bottle size (never assumed to be 750 ml)",
  size_unit_not_volume: "sized in a unit that is not a volume",
  bad_pack: "with a pack count that is not a whole number",
  no_price: "carrying no price segment at all",
  price_not_positive: "priced at zero or less",
  no_item_id: "with no vendor, manufacturer or UPC item number",
  no_description: "with no product description",
  no_effective_date: "with no effective date",
  impossible_effective_date: "stating an effective date that is not a real day",
  duplicate_item_id: "repeating an item already read in this file",
});
