/**
 * The identity register — the half that touches the database.
 *
 * Every judgement lives in `beverage-identity.ts` and `identity-join.ts` and is
 * tested without a database. This class does the four things those cannot: read
 * the register, propose candidates against it, record a person's decision, and
 * say why the register is quiet.
 *
 * NOTHING HERE MERGES ON ITS OWN. There is no cron, no flag to arm, and no
 * threshold above which a candidate becomes a link. `confirm()` is the only
 * writer of a link and it requires a user id, because a link with no author is
 * the exact shape ADR 0117 Q26 found on `providers.verified_at` — rows stamped
 * verified by something nobody can name.
 *
 * A READ FAILURE IS NEVER AN EMPTY REGISTER. supabase-js resolves
 * `{ data, error }` and never throws, so every read here checks `error` first
 * and the status route distinguishes "0 identities" from "we could not read
 * the register" in words.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  IdentityInput,
  buildIdentityKey,
  identityDisplayLabel,
  normaliseGtin,
  parseLwin,
  readIdentity,
} from "./beverage-identity";
import {
  CandidateRun,
  ExactJoinOutcome,
  IdentityKeyRow,
  RegisteredIdentity,
  joinByExactKey,
  proposeCandidates,
} from "./identity-join";

/** The subjects a candidate may link. Mirrors the table's own CHECK. */
export const IDENTITY_SUBJECT_TABLES = [
  "master_wine_library",
  "beverages",
  "restaurant_inventory",
  "vendor_price_observations",
  "price_index_postings",
] as const;
export type IdentitySubjectTable = (typeof IDENTITY_SUBJECT_TABLES)[number];

/**
 * Which subjects carry the link as a COLUMN and which carry it as a KEY.
 *
 * `restaurant_inventory`, `vendor_price_observations` and
 * `price_index_postings` each name exactly one bottle, so a nullable
 * `identity_id` is the right home. `master_wine_library` and `beverages` do
 * not: one library row is a wine, and a wine sold in 750 ml and in magnum is
 * two trade items (GS1 GTIN Management Standard 1.1 s2.3/s2.8). Forcing them
 * into one column would make the library pick a format — the same mistake the
 * `bottle_size_ml` default already made, measured 750 on all 4,226 rows. So
 * confirming a library row writes a KEY row instead, and one library row may
 * name several identities.
 */
const LINK_BY_COLUMN: ReadonlySet<string> = new Set([
  "restaurant_inventory",
  "vendor_price_observations",
  "price_index_postings",
]);

const KEY_NAMESPACE_BY_TABLE: Readonly<Record<string, string>> = Object.freeze({
  master_wine_library: "mudavym:master_wine_library",
  beverages: "mudavym:beverages",
});

export interface IdentityStatus {
  identities: number | null;
  keys: number | null;
  candidates: { pending: number; confirmed: number; rejected: number } | null;
  linked: { restaurant_inventory: number | null; vendor_price_observations: number | null };
  /** Why a number above is null, or why a zero is a real zero. */
  notes: string[];
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * What the register holds, and why it is quiet when it is.
   *
   * The zero this route reports today is a real zero and the note says so:
   * measured read-only on production 2026-09-05, no identity column in the
   * estate carries a single value (`master_wine_library` 0 of 4,226 upc/ean/
   * barcode; `beverages` 0 of 608; `restaurant_inventory` has no barcode
   * column at all; `vendor_price_observations` 0 rows).
   */
  async status(): Promise<IdentityStatus> {
    const notes: string[] = [];

    // Written out rather than looped over a list of table names on purpose:
    // `check_queried_tables_exist.py` can only audit a relation it can see
    // statically, and a `.from(variable)` is invisible to it. It caught this
    // file on 2026-09-05 with three such sites and it was right to.
    const identities = await this.countRows(
      this.databaseService.supabase
        .from("beverage_identities")
        .select("id", { count: "exact", head: true }),
      "beverage_identities",
      notes,
    );
    const keys = await this.countRows(
      this.databaseService.supabase
        .from("beverage_identity_keys")
        .select("id", { count: "exact", head: true }),
      "beverage_identity_keys",
      notes,
    );

    let candidates: IdentityStatus["candidates"] = null;
    const { data: candRows, error: candErr } = await this.databaseService.supabase
      .from("beverage_identity_candidates")
      .select("status")
      .limit(5000);
    if (candErr) {
      notes.push(
        `The candidate queue could not be read (${candErr.message}). This is unknown, not empty.`,
      );
    } else {
      candidates = { pending: 0, confirmed: 0, rejected: 0 };
      for (const r of (candRows ?? []) as { status: string }[]) {
        if (r.status === "pending") candidates.pending += 1;
        else if (r.status === "confirmed") candidates.confirmed += 1;
        else if (r.status === "rejected") candidates.rejected += 1;
      }
    }

    const linked = {
      restaurant_inventory: await this.countRows(
        this.databaseService.supabase
          .from("restaurant_inventory")
          .select("id", { count: "exact", head: true })
          .not("identity_id", "is", null),
        "restaurant_inventory.identity_id",
        notes,
      ),
      vendor_price_observations: await this.countRows(
        this.databaseService.supabase
          .from("vendor_price_observations")
          .select("id", { count: "exact", head: true })
          .not("identity_id", "is", null),
        "vendor_price_observations.identity_id",
        notes,
      ),
    };

    if (identities === 0) {
      notes.push(
        "The register holds no identities yet. That is a real zero, not a read failure: measured read-only on production 2026-09-05, no identity column in the estate carries a value — master_wine_library has 0 of 4,226 rows with a upc, ean or barcode, beverages 0 of 608, and restaurant_inventory has no barcode column at all. Every identity is an assertion someone makes; nothing was backfilled.",
      );
    }

    return { identities, keys, candidates, linked, notes };
  }

  /**
   * Resolve one count, and turn a read FAILURE into null plus a sentence.
   *
   * The query is built by the caller so the table name stays a literal at the
   * call site; only the awaiting and the error handling are shared. Null is
   * not zero here, and the note says which it was.
   */
  private async countRows(
    query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
    label: string,
    notes: string[],
  ): Promise<number | null> {
    const { count, error } = await query;
    if (error) {
      notes.push(
        `${label} could not be read (${error.message}). This is unknown, not zero.`,
      );
      return null;
    }
    return count ?? 0;
  }

  /**
   * "Which identity does this code name?" — the exact-key join, read-only.
   *
   * A GTIN is normalised to its 14-digit form and its check digit verified
   * BEFORE the lookup, so a mis-typed code comes back as a refusal rather than
   * as "no such bottle". An LWIN is parsed for shape only.
   */
  async lookupByKey(namespace: string, value: string): Promise<
    ExactJoinOutcome | { outcome: "refused"; reason: string; note: string }
  > {
    const ns = namespace.trim().toLowerCase();
    let probeValue = value.trim();

    if (ns === "gtin") {
      const g = normaliseGtin(probeValue);
      if (!g.ok) return { outcome: "refused", reason: g.reason, note: g.note };
      probeValue = g.gtin14;
    } else if (ns === "lwin") {
      const l = parseLwin(probeValue);
      if (!l.ok) return { outcome: "refused", reason: l.reason, note: l.note };
    }

    const { data, error } = await this.databaseService.supabase
      .from("beverage_identity_keys")
      .select("identity_id, key_namespace, key_class, key_value")
      .eq("key_namespace", ns)
      .eq("key_value", probeValue)
      .limit(200);

    if (error) {
      // Never "unknown_key": a register we could not read has not told us
      // anything about this code.
      throw new BadRequestException(
        `The identity register could not be read (${error.message}). This is unknown, not "no such bottle".`,
      );
    }

    const keys: IdentityKeyRow[] = ((data ?? []) as any[]).map((r) => ({
      identityId: r.identity_id,
      keyNamespace: r.key_namespace,
      keyClass: r.key_class,
      keyValue: r.key_value,
    }));
    return joinByExactKey({ namespace: ns, value: probeValue }, keys);
  }

  /**
   * Suggest identities for one described bottle. Writes nothing.
   *
   * Blocking happens in Postgres (`producer_normalised` is indexed) and the
   * scoring happens in `proposeCandidates`, so a register of any size loads
   * only the rows that share a producer word.
   */
  async suggest(subject: IdentityInput): Promise<CandidateRun & { subjectKey: string | null }> {
    const reading = readIdentity(subject);
    if (!reading.ok) {
      return {
        candidates: [],
        refusal: {
          reason: "subject_unreadable",
          note: `${reading.reason}: ${reading.note}`,
        },
        scanned: { identities: 0, blocked: 0, scored: 0 },
        subjectKey: null,
      };
    }
    const subjectKey = buildIdentityKey(reading);

    const { data, error } = await this.databaseService.supabase
      .from("beverage_identities")
      .select(
        "id, producer_normalised, name_normalised, vintage_text, size_ml, pack, display_label",
      )
      .eq("producer_normalised", reading.producerNormalised)
      .limit(500);

    if (error) {
      throw new BadRequestException(
        `The identity register could not be read (${error.message}). No suggestion is offered, because an empty suggestion list would read as "this bottle is new".`,
      );
    }

    const identities: RegisteredIdentity[] = ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      producerNormalised: r.producer_normalised,
      nameNormalised: r.name_normalised,
      vintageText: r.vintage_text,
      sizeMl: r.size_ml === null ? null : Number(r.size_ml),
      pack: r.pack === null ? null : Number(r.pack),
      displayLabel: r.display_label,
    }));

    return { ...proposeCandidates(subject, identities), subjectKey };
  }

  /**
   * Record a described bottle as an identity, asserted by a person.
   *
   * Idempotent on the register's own `identity_key` uniqueness: asserting the
   * same four parts twice returns the row that already exists rather than
   * failing or making a second one.
   */
  async assertIdentity(params: {
    subject: IdentityInput;
    userId: string;
    note?: string | null;
  }): Promise<{ id: string; identityKey: string; created: boolean }> {
    const reading = readIdentity(params.subject);
    if (!reading.ok) {
      throw new BadRequestException(
        `That is not enough to identify a bottle (${reading.reason}): ${reading.note}`,
      );
    }
    const identityKey = buildIdentityKey(reading);

    const existing = await this.databaseService.supabase
      .from("beverage_identities")
      .select("id")
      .eq("identity_key", identityKey)
      .maybeSingle();
    if (existing.error) {
      throw new BadRequestException(
        `The identity register could not be read (${existing.error.message}). Nothing was written.`,
      );
    }
    if (existing.data) {
      return { id: (existing.data as any).id, identityKey, created: false };
    }

    const { data, error } = await this.databaseService.supabase
      .from("beverage_identities")
      .insert({
        producer_normalised: reading.producerNormalised,
        name_normalised: reading.nameNormalised,
        vintage_text: reading.vintageText,
        size_ml: reading.sizeMl,
        pack: reading.pack,
        display_label: identityDisplayLabel(params.subject, reading),
        asserted_by: params.userId,
        asserted_at: new Date().toISOString(),
        assertion_method: "person",
        // Null, not 1.0. A person is not a score, and claiming 1.0 would make
        // a typed assertion the best-evidenced row in the register.
        assertion_confidence: null,
        assertion_note: params.note ?? null,
      })
      .select("id")
      .single();

    if (error) {
      throw new BadRequestException(
        `The identity could not be recorded: ${error.message}`,
      );
    }
    return { id: (data as any).id, identityKey, created: true };
  }

  /** What is waiting for a person, newest first. */
  async pending(restaurantId: string | null, limit = 50) {
    let q = this.databaseService.supabase
      .from("beverage_identity_candidates")
      .select(
        "id, subject_table, subject_id, restaurant_id, identity_id, method, confidence, evidence, created_at",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (restaurantId) {
      q = q.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`);
    }
    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(
        `The candidate queue could not be read (${error.message}). This is unknown, not an empty queue.`,
      );
    }
    return data ?? [];
  }

  /**
   * A person decides. The only writer of a link in this file.
   *
   * On `confirmed` the link is written to the subject: a column where the
   * subject names one bottle, a key row where it names a wine. On `rejected`
   * nothing is linked and the row keeps the refusal so the same pair is not
   * proposed again.
   */
  async decide(params: {
    candidateId: string;
    decision: "confirmed" | "rejected";
    userId: string;
    restaurantId: string | null;
    note?: string | null;
  }): Promise<{ id: string; status: string; linkWritten: string | null }> {
    if (!params.userId) {
      // Belt and braces behind the guard: a decision with no author is the
      // shape this register exists to stop.
      throw new ForbiddenException(
        "A candidate can only be decided by a named person.",
      );
    }

    const { data: row, error: readErr } = await this.databaseService.supabase
      .from("beverage_identity_candidates")
      .select("id, subject_table, subject_id, restaurant_id, identity_id, status")
      .eq("id", params.candidateId)
      .maybeSingle();
    if (readErr) {
      throw new BadRequestException(
        `The candidate could not be read (${readErr.message}). Nothing was decided.`,
      );
    }
    if (!row) throw new NotFoundException("No such candidate.");
    const cand = row as any;

    if (cand.status !== "pending") {
      throw new BadRequestException(
        `That candidate was already ${cand.status}. A decision is not re-taken silently.`,
      );
    }
    if (
      cand.restaurant_id &&
      params.restaurantId &&
      cand.restaurant_id !== params.restaurantId
    ) {
      throw new ForbiddenException(
        "That candidate belongs to another house.",
      );
    }

    let linkWritten: string | null = null;
    if (params.decision === "confirmed") {
      linkWritten = await this.writeLink(
        cand.subject_table as IdentitySubjectTable,
        cand.subject_id,
        cand.identity_id,
        params.userId,
      );
    }

    const { error: updErr } = await this.databaseService.supabase
      .from("beverage_identity_candidates")
      .update({
        status: params.decision,
        decided_by: params.userId,
        decided_at: new Date().toISOString(),
        decision_note: params.note ?? null,
      })
      .eq("id", params.candidateId);
    if (updErr) {
      throw new BadRequestException(
        `The link was ${linkWritten ? "written" : "not written"} but the decision could not be recorded: ${updErr.message}`,
      );
    }

    return { id: params.candidateId, status: params.decision, linkWritten };
  }

  private async writeLink(
    subjectTable: IdentitySubjectTable,
    subjectId: string,
    identityId: string,
    userId: string,
  ): Promise<string> {
    if (LINK_BY_COLUMN.has(subjectTable)) {
      // Three literal branches rather than `.from(subjectTable)`. A dynamic
      // table name is invisible to `check_queried_tables_exist.py`, which is
      // the guard that would notice if one of these columns were ever dropped;
      // it caught this file writing exactly that way on 2026-09-05.
      const patch = { identity_id: identityId };
      const client = this.databaseService.supabase;
      const { error } =
        subjectTable === "restaurant_inventory"
          ? await client.from("restaurant_inventory").update(patch).eq("id", subjectId)
          : subjectTable === "vendor_price_observations"
            ? await client
                .from("vendor_price_observations")
                .update(patch)
                .eq("id", subjectId)
            : await client
                .from("price_index_postings")
                .update(patch)
                .eq("id", subjectId);
      if (error) {
        throw new BadRequestException(
          `The identity could not be written to ${subjectTable}: ${error.message}. Nothing was recorded as confirmed.`,
        );
      }
      return `${subjectTable}.identity_id`;
    }

    const namespace = KEY_NAMESPACE_BY_TABLE[subjectTable];
    if (!namespace) {
      throw new BadRequestException(
        `${subjectTable} has no home for a link. This is a code defect, not a data one.`,
      );
    }
    const { error } = await this.databaseService.supabase
      .from("beverage_identity_keys")
      .upsert(
        {
          identity_id: identityId,
          key_namespace: namespace,
          key_class: "source_local",
          key_value: subjectId,
          asserted_by: userId,
          asserted_at: new Date().toISOString(),
          assertion_method: "person",
          assertion_confidence: null,
          source_ref: `${subjectTable}:${subjectId}`,
          note: null,
        },
        { onConflict: "key_namespace,key_value,identity_id" },
      );
    if (error) {
      throw new BadRequestException(
        `The identity key could not be written: ${error.message}. Nothing was recorded as confirmed.`,
      );
    }
    return `beverage_identity_keys(${namespace})`;
  }
}
