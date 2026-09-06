import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  CanonicalDocumentService,
  ReadResult,
} from "./canonical-document.service";
import { CanonicalDocument, FieldEnvelope } from "./canonical-types";
import { CORRECTABLE_PATHS, labelFor, splitPath } from "./correctable-paths";
import { normalizeUom, UOMS } from "../documents/document-types";

/**
 * DocumentCorrectionService — the correction door of ADR 0104 D5 (slice 3).
 *
 * TWO WRITES, ONE ACT, IN THIS ORDER, AND THE ORDER IS THE DESIGN:
 *
 *   1. a NEW `document_revisions` row carrying the whole corrected layer 1;
 *   2. a `document_corrections` row saying who changed which field, from what,
 *      to what, and why.
 *
 * Both tables refuse UPDATE and DELETE by trigger, and supabase-js gives this
 * gateway no transaction, so the two writes cannot be made atomic. The revision
 * goes FIRST because it is the one carrying `UNIQUE (document_id, revision)`:
 * two people correcting the same document at the same instant both compute
 * revision n+1 and one of them loses on that index with a 23505 — BEFORE it has
 * written an audit row that would then point at a revision somebody else owns.
 * The loser is told to re-read and try again. If the SECOND write fails, the
 * response says so in those words: a revision landed and its audit row did not.
 * It is not reported as a success, and it is not reported as a failure to
 * correct — both of those would be a lie about what is now in the database.
 *
 * LAYER 1 IS NEVER EDITED IN PLACE. Every path here clones before it writes.
 *
 * WHY A CORRECTION CLEARS THE FIELD'S `verified_by`. A tick asserts that a human
 * looked at THAT VALUE and stood behind it. Carrying it onto a different value
 * would print "Verified by Ayşe" beside a number Ayşe never saw — a fabricated
 * human assertion, which is worse than no assertion at all. The old tick is not
 * lost: it is inside the correction row's `before` envelope, which is
 * append-only. A correction that re-states the SAME value keeps the tick,
 * because nothing about what was verified changed.
 *
 * THE MAPPING MEMORY (slice 4) IS NOT BUILT HERE. `correctable-paths.ts`
 * declares `learnableKey` per field as the named seam; nothing reads it.
 */

/** A write that can fail with a status, unlike a pure read. */
export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export interface CorrectionLogEntry {
  revision: number;
  /** `correction` changed the value; `verification` is the per-field tick. */
  kind: "correction" | "verification";
  path: string;
  label: string;
  before: FieldEnvelope<unknown> | null;
  after: FieldEnvelope<unknown> | null;
  reason: string | null;
  correctedBy: string | null;
  /** The person's name, or null when we hold no row for them. */
  correctedByName: string | null;
  correctedAt: string;
}

export interface CorrectionOutcome {
  revision: number;
  entry: CorrectionLogEntry;
  document: CanonicalDocument;
}

interface CorrectionRow {
  revision: number;
  kind: string | null;
  field_path: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  corrected_by: string | null;
  corrected_at: string;
}

const CORRECTION_COLUMNS =
  "revision, kind, field_path, before, after, reason, corrected_by, corrected_at";

/** Postgres 23505 — the unique index on (document_id, revision) fired. */
function isRevisionRace(message: string): boolean {
  return (
    message.includes("23505") ||
    message.toLowerCase().includes("duplicate key value")
  );
}

@Injectable()
export class DocumentCorrectionService {
  private readonly logger = new Logger(DocumentCorrectionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly canonical: CanonicalDocumentService,
  ) {}

  /**
   * The correction log for one document, newest first.
   *
   * TENANT-SCOPED THROUGH THE DOCUMENT. `document_corrections` carries no
   * `restaurant_id` — it hangs off `procurement_documents` — so the existence
   * check below IS the isolation. The gateway holds the service role; without
   * this read, any authenticated user could ask for any tenant's correction log
   * by id.
   */
  async correctionLog(
    restaurantId: string,
    documentId: string,
  ): Promise<ReadResult<CorrectionLogEntry[]>> {
    const owns = await this.db
      .getClient()
      .from("procurement_documents")
      .select("id")
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (owns.error)
      return {
        ok: false,
        error: `procurement_documents read failed for ${documentId}: ${owns.error.message}`,
      };
    if (!owns.data)
      return {
        ok: false,
        error: `document ${documentId} not found for restaurant ${restaurantId}`,
      };

    const read = await this.db
      .getClient()
      .from("document_corrections")
      .select(CORRECTION_COLUMNS)
      .eq("document_id", documentId)
      .order("revision", { ascending: false });

    // A FAILED READ IS NEVER AN EMPTY LOG (ADR 0067). `(data ?? [])` here would
    // render "nobody has ever corrected this document" on top of a broken query,
    // which is the sentence a vendor dispute would be argued from.
    if (read.error)
      return {
        ok: false,
        error: `document_corrections read failed for ${documentId}: ${read.error.message}`,
      };

    const rows = (read.data ?? []) as unknown as CorrectionRow[];
    const names = await this.namesFor(
      rows.map((r) => r.corrected_by).filter((v): v is string => !!v),
    );
    if (!names.ok) return names;

    return { ok: true, value: rows.map((r) => this.toEntry(r, names.value)) };
  }

  /**
   * Correct one layer-1 field: append revision n+1 and the audit row.
   *
   * `value: null` is a legitimate correction and means "the document states
   * nothing here" — the case where an extraction invented a figure the paper
   * never printed. It is deliberately reachable.
   */
  async correct(
    restaurantId: string,
    documentId: string,
    userId: string | null,
    input: { path: string; value: unknown; reason?: string | null },
  ): Promise<WriteResult<CorrectionOutcome>> {
    const parsedPath = splitPath(input.path);
    if (!parsedPath)
      return {
        ok: false,
        status: 400,
        error: `\`${input.path}\` is not a field path. Use a layer-1 field name (\`documentNumber\`, \`seller.name\`, \`totals.taxInclusiveAmount\`) or \`lines[n].field\`.`,
      };

    const spec = CORRECTABLE_PATHS[parsedPath.template];
    if (!spec)
      return {
        ok: false,
        status: 400,
        error: `\`${input.path}\` is not a correctable field. Correctable fields are: ${Object.keys(
          CORRECTABLE_PATHS,
        ).join(", ")}.`,
      };

    const typed = this.checkType(spec.type, input.value, input.path);
    if (typed) return typed;

    // A unit we cannot read must be refused at the door rather than stored and
    // silently ignored by the mapper — a stored `kasa` would show on the sheet
    // and convert as nothing.
    if (
      (parsedPath.template === "lines[].unit" ||
        parsedPath.template === "lines[].priceBaseUnit") &&
      input.value != null &&
      !normalizeUom(String(input.value))
    )
      return {
        ok: false,
        status: 400,
        error: `\`${String(input.value)}\` is not a unit this system can convert. Readable units: ${UOMS.join(", ")}.`,
      };

    return this.append(restaurantId, documentId, userId, {
      path: input.path,
      template: parsedPath.template,
      line: parsedPath.line,
      kind: "correction",
      reason: input.reason ?? null,
      mutate: (prior, nextRevision) => {
        const changed = !Object.is(prior.value ?? null, input.value ?? null);
        return {
          ...prior,
          value: input.value ?? null,
          // A human typing a number has no notion of confidence, and a stale
          // model confidence carried onto a human's value would route the
          // review queue on a number nobody computed.
          confidence: null,
          source: "human_corrected",
          revision: nextRevision,
          // The paper's own glyphs. NEVER rewritten — a correction is a claim
          // about what the document MEANS, never about what it printed.
          as_printed: prior.as_printed ?? null,
          // See the class comment: a tick survives a correction that changed
          // nothing and is cleared by one that changed the value.
          verified_by: changed ? null : (prior.verified_by ?? null),
          verified_at: changed ? null : (prior.verified_at ?? null),
        };
      },
    });
  }

  /**
   * The per-field `verified_by` tick (ADR 0104 D5).
   *
   * THE FIELD'S `source` DOES NOT CHANGE. A manager confirming that the page
   * really does say 142,00 has not entered that number by hand; it is still an
   * extracted value, now with a human standing behind it. Relabelling it
   * `human_entered` would erase the fact that a model read it, which is the one
   * thing the provenance trail is for.
   */
  async verifyField(
    restaurantId: string,
    documentId: string,
    userId: string | null,
    input: { path: string },
  ): Promise<WriteResult<CorrectionOutcome>> {
    const parsedPath = splitPath(input.path);
    if (!parsedPath || !CORRECTABLE_PATHS[parsedPath.template])
      return {
        ok: false,
        status: 400,
        error: `\`${input.path}\` is not a verifiable field.`,
      };

    const at = new Date().toISOString();
    return this.append(restaurantId, documentId, userId, {
      path: input.path,
      template: parsedPath.template,
      line: parsedPath.line,
      kind: "verification",
      reason: null,
      mutate: (prior, nextRevision) => ({
        ...prior,
        revision: nextRevision,
        verified_by: userId,
        verified_at: at,
      }),
    });
  }

  // -------------------------------------------------------------------------

  private checkType(
    expected: "string" | "number",
    value: unknown,
    path: string,
  ): { ok: false; status: number; error: string } | null {
    if (value === null || value === undefined) return null;
    if (expected === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        return {
          ok: false,
          status: 400,
          error: `\`${path}\` is a number. Send a JSON number, or null to say the document states nothing there.`,
        };
      return null;
    }
    if (typeof value !== "string")
      return {
        ok: false,
        status: 400,
        error: `\`${path}\` is text. Send a JSON string, or null to say the document states nothing there.`,
      };
    if (value.length > 500)
      return {
        ok: false,
        status: 400,
        error: `\`${path}\` is longer than 500 characters, which no field on an invoice is.`,
      };
    return null;
  }

  private async append(
    restaurantId: string,
    documentId: string,
    userId: string | null,
    op: {
      path: string;
      template: string;
      line: number | null;
      kind: "correction" | "verification";
      reason: string | null;
      mutate: (
        prior: FieldEnvelope<unknown>,
        nextRevision: number,
      ) => FieldEnvelope<unknown>;
    },
  ): Promise<WriteResult<CorrectionOutcome>> {
    // The tenant check and the current state of the document in one read: this
    // is scoped by restaurantId, so another tenant's id is a 404 here.
    const built = await this.canonical.buildFromDocumentId(
      restaurantId,
      documentId,
    );
    if (!built.ok)
      return {
        ok: false,
        status: built.error.includes("not found") ? 404 : 500,
        error: built.error,
      };

    const spec = CORRECTABLE_PATHS[op.template];
    const prior = spec.read(built.value.layer1, op.line);
    if (!prior)
      return {
        ok: false,
        status: 400,
        error:
          op.line == null
            ? `This document carries no \`${op.path}\` to correct.`
            : `This document has ${built.value.layer1.lines.length} line(s); there is no line ${op.line + 1}.`,
      };

    /**
     * ONE SOURCE FOR THE NUMBER. The envelope carries its own `revision`, so it
     * has to be stamped before the row exists — and if this computed it while
     * `persistRevision` computed another, an envelope would claim a revision the
     * row does not have. The number is read once here and passed down.
     */
    const next = await this.canonical.nextRevision(documentId);
    if (!next.ok) return { ok: false, status: 500, error: next.error };
    let nextRevision = next.value;

    /**
     * THE EXTRACTION IS REVISION 1, AND THE FIRST CORRECTION WRITES IT DOWN.
     *
     * Nothing on the read path writes a revision row — the canonical object is
     * rebuilt from the document's columns every time — so a document nobody has
     * corrected has NO row at all. If the first correction simply took revision
     * 1, the log would open with "someone corrected this" and the reader would
     * have nothing to compare it against: what the machine originally read would
     * exist only in the correction's `before` for the one field that changed.
     *
     * So the first correction persists the PRE-CORRECTION document as revision 1
     * first, labelled with the source the document actually arrived by, and
     * takes revision 2 for itself. Two inserts, both append-only, both guarded
     * by the same unique index.
     */
    if (nextRevision === 1) {
      const base = await this.canonical.persistRevision(
        documentId,
        built.value,
        // The channel-derived source the builder stamped on every extracted
        // envelope (`edi` for EDI and SFTP, `extracted` for everything else).
        // Read off the document rather than restated, so the two cannot drift.
        built.value.layer1.documentNumber.source,
        null,
        1,
      );
      if (!base.ok)
        return isRevisionRace(base.error)
          ? {
              ok: false,
              status: 409,
              error:
                "Another correction to this document landed first. Re-open the document and make the change again — nothing was written.",
            }
          : { ok: false, status: 500, error: base.error };
      nextRevision = 2;
    }

    const after = op.mutate(prior, nextRevision);

    // structuredClone, not a spread: the envelopes are nested three deep inside
    // `lines[]` and `totals`, and a shallow copy would mutate the object the
    // caller is still holding — the "never edited in place" rule broken in
    // memory even though the database row is append-only.
    const nextLayer1 = structuredClone(built.value.layer1);
    spec.write(nextLayer1, op.line, after);

    const revision = await this.canonical.persistRevision(
      documentId,
      { ...built.value, layer1: nextLayer1 },
      op.kind === "correction" ? "human_corrected" : "human_entered",
      userId,
      nextRevision,
    );
    if (!revision.ok)
      return isRevisionRace(revision.error)
        ? {
            ok: false,
            status: 409,
            error:
              "Another correction to this document landed first. Re-open the document and make the change again — nothing was written.",
          }
        : { ok: false, status: 500, error: revision.error };

    /**
     * THE CASTS ARE HOISTED, AND THAT IS NOT A STYLE CHOICE.
     * `check_order_capture_contract.py` reads a write's column names only when
     * the payload is a plain object literal; an inline
     * `as unknown as Record<string, unknown>` splits its parser on the comma and
     * makes the WHOLE write invisible to the guard — the exact defect its own
     * header records against `document-intake.service.ts`. Hoisted, the payload
     * below is a literal again and every column name is checked.
     */
    const beforeJson = prior as unknown as Record<string, unknown>;
    const afterJson = after as unknown as Record<string, unknown>;

    const audit = await this.db
      .getClient()
      .from("document_corrections")
      .insert({
        document_id: documentId,
        revision: revision.value.revision,
        field_path: op.path,
        before: beforeJson,
        after: afterJson,
        reason: op.reason,
        kind: op.kind,
        corrected_by: userId,
      })
      .select(CORRECTION_COLUMNS)
      .single();

    if (audit.error || !audit.data) {
      // NAMED, NOT SWALLOWED. Revision n+1 exists and is append-only, so this
      // cannot be undone; saying "the correction failed" would leave a caller
      // believing the document is unchanged when the next read will show the
      // new value.
      const detail = audit.error?.message ?? "no row and no error came back";
      this.logger.error(
        `document_corrections insert failed for ${documentId} revision ${revision.value.revision}: ${detail}`,
      );
      return {
        ok: false,
        status: 500,
        error:
          `Revision ${revision.value.revision} WAS written and the document now shows the new value, ` +
          `but its audit row was not: ${detail}. Record the change by hand before relying on the log.`,
      };
    }

    const row = audit.data as unknown as CorrectionRow;
    const names = await this.namesFor(userId ? [userId] : []);
    const rebuilt = await this.canonical.buildFromDocumentId(
      restaurantId,
      documentId,
    );
    if (!rebuilt.ok)
      return {
        ok: false,
        status: 500,
        error: `The correction was written but the document could not be re-read: ${rebuilt.error}`,
      };

    return {
      ok: true,
      value: {
        revision: revision.value.revision,
        entry: this.toEntry(row, names.ok ? names.value : new Map()),
        document: rebuilt.value,
      },
    };
  }

  /** user_id → name. An id we hold no row for maps to null, never to the id. */
  private async namesFor(
    ids: string[],
  ): Promise<ReadResult<Map<string, string>>> {
    const unique = Array.from(new Set(ids));
    if (!unique.length) return { ok: true, value: new Map() };
    const read = await this.db
      .getClient()
      .from("users")
      .select("user_id, name")
      .in("user_id", unique);
    if (read.error)
      return {
        ok: false,
        error: `users read failed for the correction log: ${read.error.message}`,
      };
    return {
      ok: true,
      value: new Map(
        ((read.data ?? []) as { user_id: string; name: string | null }[])
          .filter((u) => !!u.name)
          .map((u) => [u.user_id, u.name as string]),
      ),
    };
  }

  private toEntry(
    row: CorrectionRow,
    names: Map<string, string>,
  ): CorrectionLogEntry {
    const split = splitPath(row.field_path);
    return {
      revision: row.revision,
      // A row written before `kind` existed is a correction — that is what the
      // column's default records — and anything unrecognised is read the same
      // way rather than silently becoming a verification tick.
      kind: row.kind === "verification" ? "verification" : "correction",
      path: row.field_path,
      label: split ? labelFor(split.template, split.line) : row.field_path,
      before: (row.before as FieldEnvelope<unknown> | null) ?? null,
      after: (row.after as FieldEnvelope<unknown> | null) ?? null,
      reason: row.reason,
      correctedBy: row.corrected_by,
      correctedByName: row.corrected_by
        ? (names.get(row.corrected_by) ?? null)
        : null,
      correctedAt: row.corrected_at,
    };
  }
}
