/**
 * The human-fetch path: a person brings the file this process cannot fetch.
 *
 * WHY IT EXISTS
 * -------------
 * Michigan is the best jurisdictional match in the estate — three of fourteen
 * houses — and the only tenant state whose posted list is the price the house
 * itself pays (the MLCC `LICENSEE PRICE`). It is also unreadable by any machine
 * here: `www.michigan.gov` answers 403 from an Akamai Kona Site Defender edge
 * to a polite, identifying, anonymous client — on the price-book page, on a
 * direct PDF and on `robots.txt` itself — and the state's own Socrata portal,
 * `data.michigan.gov`, publishes `Disallow: /` for `User-agent: *`. There is no
 * S3, CDN, FTP, legislature or distributor mirror. A browser driven by a person
 * is served normally.
 *
 * So the honest path is the person. That is not a workaround for the block —
 * nothing here fetches michigan.gov, ever — it is the only route by which
 * Michigan's published licensee price reaches a Michigan house without being
 * invented.
 *
 * WHAT KEEPS IT HONEST
 * --------------------
 *  1. **The issuer's date comes from the file, not from us.** The workbook
 *     carries no effective date in any cell (measured on the real book); the
 *     edition date lives only in the file name. `readEditionDate` reads it and
 *     an upload whose name states none is REFUSED before a row is parsed. It is
 *     never stamped with the upload clock — a years-old book presented as this
 *     quarter's is precisely the fault ADR 0117's staleness gate exists for.
 *  2. **The staleness gate still stands.** The same `refuseStale`, against the
 *     book's own measured cadence, before any write. An old book produces a
 *     refusal carrying its age in days, not a register full of 2022.
 *  3. **Dry run is the default.** An upload parses, gates and REPORTS. It
 *     writes only when the caller passes `commit: true` AND the flag is armed.
 *  4. **Off by default.** `PRICE_INDEX_UPLOAD_ENABLED`, the same allow-list
 *     predicate as the scheduled fetch, so a typo leaves it off.
 *  5. **The row says a person brought it.** `raw.upload` carries the file name,
 *     the sha256 of the exact bytes, the user id and the upload time, and
 *     `raw.upload.editionDateFrom` records that the date was read from the file
 *     name. A reader can always tell a hand-carried book from a fetched feed.
 *
 * WHAT IT DOES NOT DO, STATED RATHER THAN LEFT TO BE DISCOVERED
 * ------------------------------------------------------------
 *  - It cannot tell a doctored workbook from a genuine one. Nothing can, short
 *    of a signature the MLCC does not publish. The defence is provenance rather
 *    than detection: the row names the person, and the sha256 lets anyone
 *    re-download the same edition and compare byte for byte. Whether that is
 *    enough is the founder's call, recorded in ADR 0117.
 *  - It carries the uploader's identity inside `raw`, not in a column of its
 *    own, because this session was not authorised to add a migration.
 *  - It does not tell the house, in the panel, that these lines are theirs
 *    rather than a live state feed. The endpoint returns everything needed for
 *    that sentence; drawing it is web work this session did not do.
 */

import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../database/database.service";
import { ParseRun, PostingSighting, contentHash, tally } from "./price-index.types";
import { SOURCES } from "./price-index.registry";
import { priceIndexFetchArmed, refuseStale } from "./staleness";
import {
  MICHIGAN_SOURCE_KEY,
  MICHIGAN_URL,
  parseMichigan,
  readEditionDate,
} from "./parse-michigan";
import {
  MAX_UPLOAD_BYTES,
  WorkbookError,
  base64Bytes,
  michiganRowsFromWorkbook,
} from "./michigan-workbook";

export const PRICE_INDEX_UPLOAD_FLAG = "PRICE_INDEX_UPLOAD_ENABLED";

/**
 * Deliberately the SAME predicate as the scheduled fetch's, not a second copy:
 * one definition of "armed" for this module, so the two can never drift into
 * disagreeing about what `1` means.
 */
export function priceIndexUploadArmed(raw?: string | null): boolean {
  return priceIndexFetchArmed(raw);
}

/** Which sources accept a hand-carried file, and where a person gets it. */
export const UPLOADABLE_SOURCES: Record<string, { url: string }> = {
  [MICHIGAN_SOURCE_KEY]: { url: MICHIGAN_URL },
};

/**
 * The provenance a hand-carried book must state. All four reach columns on the
 * row (`uploaded_by`, `upload_file_name`, `upload_sha256`, `upload_edition_date`);
 * the rest stay in `raw.upload`. `uploadedByUserId` is a **public.users** id —
 * the JWT carries `public.users.user_id`, and `auth.users` is a disjoint table
 * whose ids would 23503 on every real write while CI stayed green.
 */
export interface UploadProvenance {
  fileName: string;
  fileSha256: string;
  fileBytes: number;
  sheetName: string;
  uploadedByUserId: string | null;
  uploadedAt: string;
}

export interface UploadRequest {
  sourceKey: string;
  fileName: string;
  fileBase64: string;
  /** Write the survivors. Default false: an upload reports before it writes. */
  commit?: boolean;
  uploadedByUserId?: string | null;
}

export interface UploadOutcome {
  sourceKey: string;
  accepted: boolean;
  committed: boolean;
  fileName: string;
  fileSha256: string | null;
  fileBytes: number;
  issuedAt: string | null;
  ageDays: number | null;
  rowsRead: number;
  admitted: number;
  refused: number;
  refusalsByReason: Record<string, number>;
  written: number;
  /** Why nothing was written. Null only when rows actually were. */
  silentBecause: string | null;
  /** A handful of admitted rows, so a person can eyeball the parse. */
  sample: Array<{
    productName: string;
    price: number;
    priceUnit: string;
    sizeValue: number | null;
    sizeUnit: string | null;
    pack: number | null;
    priceBasis: string;
  }>;
}

@Injectable()
export class PriceIndexUploadService {
  private readonly logger = new Logger(PriceIndexUploadService.name);
  private readonly lastUploads = new Map<string, UploadOutcome>();

  constructor(private readonly db: DatabaseService) {}

  armed(): boolean {
    return priceIndexUploadArmed(process.env[PRICE_INDEX_UPLOAD_FLAG]);
  }

  lastUploadFor(sourceKey: string): UploadOutcome | null {
    return this.lastUploads.get(sourceKey) ?? null;
  }

  /**
   * Parse an uploaded book and — only on an explicit `commit` with the flag
   * armed — write its survivors.
   *
   * Every rejection returns an outcome with `accepted: false` and a sentence
   * rather than throwing an opaque error: the person who uploaded the file is
   * the one who has to fix it.
   */
  async ingest(
    req: UploadRequest,
    opts: { today?: Date } = {},
  ): Promise<UploadOutcome> {
    const base: UploadOutcome = {
      sourceKey: req.sourceKey,
      accepted: false,
      committed: false,
      fileName: req.fileName ?? "",
      fileSha256: null,
      fileBytes: 0,
      issuedAt: null,
      ageDays: null,
      rowsRead: 0,
      admitted: 0,
      refused: 0,
      refusalsByReason: {},
      written: 0,
      silentBecause: null,
      sample: [],
    };

    const source = SOURCES[req.sourceKey];
    if (!source || !UPLOADABLE_SOURCES[req.sourceKey]) {
      return {
        ...base,
        silentBecause: `'${req.sourceKey}' is not a source this register accepts a file for. Uploadable today: ${Object.keys(UPLOADABLE_SOURCES).join(", ") || "(none)"}.`,
      };
    }
    if (!req.fileBase64 || typeof req.fileBase64 !== "string") {
      return { ...base, silentBecause: "no file was sent." };
    }

    const declaredBytes = base64Bytes(req.fileBase64);
    if (declaredBytes > MAX_UPLOAD_BYTES) {
      return {
        ...base,
        fileBytes: declaredBytes,
        silentBecause: `the file is ${declaredBytes} bytes, past the ${MAX_UPLOAD_BYTES}-byte ceiling for a price book.`,
      };
    }

    // The date FIRST, so a file that cannot state its own edition is refused
    // before a single row is read and there is never a parsed book sitting
    // around waiting for a date to be invented for it.
    const issuedAt = readEditionDate(req.fileName, opts.today);
    if (!issuedAt) {
      return {
        ...base,
        silentBecause:
          "the file name does not state an edition date. The Michigan price book carries its date only in its file name (for example '8-3-25-PRICE-BOOK-EXCEL.xlsx'); upload it under the name the Commission published it with. Nothing is dated by the upload clock.",
      };
    }

    const buffer = Buffer.from(req.fileBase64, "base64");
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");

    let rows: Array<Array<string | number | null>>;
    let sheetName: string;
    try {
      const read = await michiganRowsFromWorkbook(buffer);
      rows = read.rows;
      sheetName = read.sheetName;
    } catch (err) {
      return {
        ...base,
        fileSha256,
        fileBytes: buffer.length,
        issuedAt,
        silentBecause:
          err instanceof WorkbookError
            ? err.message
            : `the workbook could not be read: ${(err as Error).message}`,
      };
    }

    let run: ParseRun;
    try {
      run = parseMichigan(rows, issuedAt, UPLOADABLE_SOURCES[req.sourceKey].url);
    } catch (err) {
      return {
        ...base,
        fileSha256,
        fileBytes: buffer.length,
        issuedAt,
        rowsRead: rows.length,
        silentBecause: (err as Error).message,
      };
    }

    const verdict = refuseStale(run.issuedAt, source.maxAgeDays, opts.today);
    const outcome: UploadOutcome = {
      ...base,
      accepted: !verdict.stale,
      fileSha256,
      fileBytes: buffer.length,
      issuedAt: run.issuedAt,
      ageDays: verdict.ageDays,
      rowsRead: run.rowsRead,
      admitted: run.sightings.length,
      refused: run.refusals.length,
      refusalsByReason: tally(run.refusals),
      sample: run.sightings.slice(0, 5).map((s) => ({
        productName: s.productName,
        price: s.price,
        priceUnit: s.priceUnit,
        sizeValue: s.sizeValue,
        sizeUnit: s.sizeUnit,
        pack: s.pack,
        priceBasis: s.priceBasis,
      })),
    };

    if (verdict.stale) {
      outcome.silentBecause = `REFUSED (stale): ${verdict.reason}`;
      this.lastUploads.set(req.sourceKey, outcome);
      return outcome;
    }
    if (run.sightings.length === 0) {
      outcome.silentBecause = "nothing in the workbook survived the parser's checks.";
      this.lastUploads.set(req.sourceKey, outcome);
      return outcome;
    }
    if (!req.commit) {
      outcome.silentBecause =
        "dry run: this is what the upload WOULD write. Send it again with commit true to record it.";
      this.lastUploads.set(req.sourceKey, outcome);
      return outcome;
    }
    if (!this.armed()) {
      outcome.silentBecause = `commit was asked for, but uploads are disabled (${PRICE_INDEX_UPLOAD_FLAG} is off). Nothing was written.`;
      this.lastUploads.set(req.sourceKey, outcome);
      return outcome;
    }
    // Last gate before the write, and deliberately last: a dry run may name
    // nobody (it writes nothing and a person may want to check a book before
    // they are signed in as anyone), but a ROW may not. The table's
    // all-or-nothing CHECK would reject a half-provenanced row at the database
    // with a 500 the uploader cannot act on; refusing here gives them a
    // sentence instead. ADR 0117 Q17.
    if (!req.uploadedByUserId) {
      outcome.silentBecause =
        "this upload names no person. A hand-carried book must record who carried it, so nothing was written rather than writing rows with an empty uploader.";
      this.lastUploads.set(req.sourceKey, outcome);
      return outcome;
    }

    const uploadedAt = new Date().toISOString();
    outcome.written = await this.write(run.sightings, uploadedAt, {
      fileName: req.fileName,
      fileSha256,
      fileBytes: buffer.length,
      sheetName,
      uploadedByUserId: req.uploadedByUserId ?? null,
      uploadedAt,
    });
    outcome.committed = true;
    outcome.silentBecause = null;
    this.logger.log(
      `price-index upload: ${req.sourceKey} ${run.issuedAt} — ${outcome.written} rows from ${req.fileName} (sha256 ${fileSha256.slice(0, 12)})`,
    );
    this.lastUploads.set(req.sourceKey, outcome);
    return outcome;
  }

  private async write(
    sightings: PostingSighting[],
    fetchedAt: string,
    upload: UploadProvenance,
  ): Promise<number> {
    const rows = sightings.map((s) => ({
      source_key: s.sourceKey,
      source_class: s.sourceClass,
      state: s.state,
      region: s.region,
      issuer: s.issuer,
      issued_at: s.issuedAt,
      // Always the ISSUER's own date on this path, and stated rather than
      // left to a DEFAULT: every source in this registry publishes an
      // edition date, and `refuseStale` has already refused the run if the
      // parser could not read one. The value is written here rather than
      // carried on `PostingSighting` because it is a property of the WRITER
      // (this one reads publishers; the merchant-shop writer reads shops),
      // not of the sighting (ADR 0117 Q27).
      issued_at_basis: "issuer_stated",
      // Our clock: when this row entered the register. The ISSUER's date is
      // `issued_at`, read from the file's own name; the two are never mixed.
      fetched_at: fetchedAt,
      price_basis: s.priceBasis,
      product_name: s.productName,
      brand: s.brand,
      producer: s.producer,
      package_desc: s.packageDesc,
      container_type: s.containerType,
      size_value: s.sizeValue,
      size_unit: s.sizeUnit,
      price: s.price,
      currency: s.currency,
      price_unit: s.priceUnit,
      pack: s.pack,
      container_charge: s.containerCharge,
      is_promotion: s.isPromotion,
      source_status: s.sourceStatus,
      attribution: s.attribution,
      source_url: s.sourceUrl,
      source_ref: s.sourceRef,
      content_hash: contentHash(s),
      external_ids: s.externalIds,
      // The four provenance facts, promoted from `raw.upload` to columns on the
      // founder's call of 2026-09-05 (ADR 0117 Q17). Written with explicit keys
      // — never a conditional spread — so a row can never acquire three of the
      // four and look provenanced. The table's own CHECK refuses that anyway;
      // this is the writer agreeing with it rather than relying on it.
      uploaded_by: upload.uploadedByUserId,
      upload_file_name: upload.fileName,
      upload_sha256: upload.fileSha256,
      // The date the FILE NAME stated. Equal to `issued_at` at write time and
      // kept beside it, because `issued_at` is a value read out of a string a
      // person could have renamed, and the evidence for it must survive any
      // later correction of the date itself.
      upload_edition_date: s.issuedAt,
      // The JSONB copy STAYS. It carries `fileBytes`, `sheetName`, `uploadedAt`
      // and `editionDateFrom`, none of which were promoted, and a column added
      // later must never silently delete the evidence that predates it.
      raw: { ...s.raw, upload: { ...upload, editionDateFrom: "file_name" } },
    }));
    const { error } = await this.db.client
      .from("price_index_postings")
      .upsert(rows, {
        onConflict: "source_ref,content_hash",
        ignoreDuplicates: true,
      });
    if (error) throw error;
    return rows.length;
  }
}
