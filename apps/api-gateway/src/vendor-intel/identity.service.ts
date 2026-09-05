/**
 * The identity register — the half that touches the database.
 *
 * Every judgement lives in `beverage-identity.ts` and `identity-join.ts` and is
 * tested without a database. This class does the five things those cannot: read
 * the register, propose candidates against it, record a person's decision, let a
 * manager take one back, and say why the register is quiet.
 *
 * NOTHING HERE MERGES ON ITS OWN. There is no cron, no flag to arm, and no
 * threshold above which a candidate becomes a link. `decide()` is the only
 * writer of a link and it requires a named actor, because a link with no author
 * is the exact shape ADR 0117 Q26 found on `providers.verified_at` — rows
 * stamped verified by something nobody can name.
 *
 * WHO MAY DECIDE, AND WHY IT IS NOT THE SAME GATE AS THE REST OF THIS MODULE.
 * The founder, 2026-09-05: *"staff may confirm, log the decisions."* Everything
 * else under `/vendor-intel` is owner/manager because a vendor's price to this
 * house is its negotiating position; **an identity is not commercially
 * sensitive at all** — it is the question "are these two bottles the same
 * bottle", and the people who can answer it are the ones holding the bottles.
 * So confirming, rejecting and reading the log are open to staff, taking a
 * decision BACK is owner/manager, and every one of the three is logged.
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
import { readFile } from "fs/promises";
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
  LWIN_ATTRIBUTION,
} from "./beverage-identity";
import {
  LwinSearchHit,
  identityFromLwin,
  readLwinFile,
  searchLwin,
} from "./lwin-file";
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
 * Who is deciding, as the token says at the moment of the decision.
 *
 * The name and role travel INTO the log rather than being joined out of
 * `public.users` later, because `decided_by` is ON DELETE SET NULL: a person
 * who leaves would take the answer to "who confirmed this" with them.
 */
export interface IdentityActor {
  userId: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  /** Filled by `requireActor`; never sent by a caller. */
  label?: string;
}

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
        "id, producer_normalised, name_normalised, vintage_text, size_ml, pack, display_label, standing, asserted_for_restaurant_id",
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
      // The founder's rule (Q3, 2026-09-05): a provisional identity is printed
      // as provisional EVERYWHERE it appears, never as official. So `standing`
      // travels with every identity this service hands out, and a caller that
      // renders a suggestion has the fact rather than having to look it up.
      standing: r.standing ?? "source",
      assertedForRestaurantId: r.asserted_for_restaurant_id ?? null,
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
    /**
     * The house asserting it. Present makes the identity PROVISIONAL and puts
     * it in the curation queue (ADR 0124 Q3); absent makes it a platform-wide
     * assertion, which is what a transcription from a published file is.
     */
    restaurantId?: string | null;
    note?: string | null;
  }): Promise<{
    id: string;
    identityKey: string;
    created: boolean;
    standing: "library" | "provisional" | "source";
    curationState: string;
  }> {
    const reading = readIdentity(params.subject);
    if (!reading.ok) {
      throw new BadRequestException(
        `That is not enough to identify a bottle (${reading.reason}): ${reading.note}`,
      );
    }
    const identityKey = buildIdentityKey(reading);

    const existing = await this.databaseService.supabase
      .from("beverage_identities")
      .select("id, standing, curation_state")
      .eq("identity_key", identityKey)
      .maybeSingle();
    if (existing.error) {
      throw new BadRequestException(
        `The identity register could not be read (${existing.error.message}). Nothing was written.`,
      );
    }
    if (existing.data) {
      // Idempotent, and deliberately NOT a re-assertion: an identity somebody
      // else already asserted is not re-attributed to whoever typed it second,
      // and a promoted one is not dragged back into the queue.
      const row = existing.data as any;
      return {
        id: row.id,
        identityKey,
        created: false,
        standing: row.standing ?? "source",
        curationState: row.curation_state ?? "none",
      };
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
        // Q3: a house's assertion is PROVISIONAL and queued. The generated
        // `standing` column derives the word from this; nothing sets it.
        asserted_for_restaurant_id: params.restaurantId ?? null,
        curation_state: params.restaurantId ? "queued" : "none",
      })
      .select("id, standing, curation_state")
      .single();

    if (error) {
      throw new BadRequestException(
        `The identity could not be recorded: ${error.message}`,
      );
    }
    const row = data as any;
    return {
      id: row.id,
      identityKey,
      created: true,
      standing: row.standing ?? "source",
      curationState: row.curation_state ?? "none",
    };
  }

  // -------------------------------------------------------------------------
  // Curation — Mudavym's, not a house's (ADR 0124 Q3).
  // -------------------------------------------------------------------------

  /**
   * What is waiting for Mudavym, oldest first.
   *
   * Oldest first, unlike every other queue in this module: a house that named a
   * bottle three weeks ago should not be behind one that named a bottle today.
   * A failed read THROWS — an empty queue and an unreadable one are different
   * facts and only one of them means there is nothing to do.
   */
  async curationQueue(limit = 50): Promise<{
    items: any[];
    limit: number;
    complete: boolean;
  }> {
    const capped = Math.min(Math.max(limit, 1), 200);
    const { data, error } = await this.databaseService.supabase
      .from("beverage_identities")
      .select(
        "id, identity_key, display_label, producer_normalised, name_normalised, vintage_text, size_ml, pack, standing, curation_state, asserted_for_restaurant_id, asserted_by, asserted_at, assertion_method, assertion_note",
      )
      .eq("curation_state", "queued")
      .order("asserted_at", { ascending: true })
      .limit(capped);
    if (error) {
      throw new BadRequestException(
        `The curation queue could not be read (${error.message}). This is a failure, not an empty queue.`,
      );
    }
    const items = data ?? [];
    return { items, limit: capped, complete: items.length < capped };
  }

  /**
   * Mudavym promotes a provisional identity into the library, and the item
   * follows it.
   *
   * FOUR THINGS HAPPEN, IN THIS ORDER, AND THE ORDER IS THE POINT:
   *   1. the library row is chosen or created — nothing else can be done until
   *      there is something to point at;
   *   2. the identity names it (`master_wine_id`), which flips the generated
   *      `standing` to `library`;
   *   3. every house item carrying this identity is RE-POINTED
   *      (`restaurant_inventory.master_wine_id`), which is the founder's
   *      "promotion re-points the item";
   *   4. the curation is stamped.
   * If (3) fails the call fails, and it says the identity was promoted — a
   * half-done promotion that reported success would leave an item pointing at
   * the placeholder row forever.
   *
   * `asserted_for_restaurant_id` is NEVER touched: it is the house's original
   * assertion and the founder's option text keeps it as provenance.
   */
  async promote(params: {
    identityId: string;
    /** An existing library row to attach to, or null to create one. */
    masterWineId?: string | null;
    note?: string | null;
    curatedBy?: string | null;
  }): Promise<{
    identityId: string;
    masterWineId: string;
    libraryRowCreated: boolean;
    itemsRepointed: number;
    standing: string;
  }> {
    const identity = await this.loadIdentity(params.identityId);

    if (identity.curation_state === "promoted") {
      throw new BadRequestException(
        `That identity was already promoted onto ${identity.master_wine_id}. A promotion is not re-taken silently.`,
      );
    }
    if (identity.standing === "library") {
      throw new BadRequestException(
        "That identity already names a library row, so there is nothing to promote.",
      );
    }

    let masterWineId = params.masterWineId ?? null;
    let libraryRowCreated = false;

    if (masterWineId) {
      const target = await this.databaseService.supabase
        .from("master_wine_library")
        .select("id, provisional_for_restaurant_id")
        .eq("id", masterWineId)
        .maybeSingle();
      if (target.error) {
        throw new BadRequestException(
          `The library row could not be read (${target.error.message}). Nothing was promoted.`,
        );
      }
      if (!target.data) {
        throw new NotFoundException(
          "That library row does not exist, so the identity was not promoted onto it.",
        );
      }
      if ((target.data as any).provisional_for_restaurant_id) {
        // ADR 0130's own rule, enforced from this side too: a venue-owned row
        // is not the shared library, so promoting onto it would move the
        // identity from one provisional state into another and call it official.
        throw new BadRequestException(
          "That library row is itself one venue's provisional wine (ADR 0130). Promote onto a shared entry, or let this create one.",
        );
      }
    } else {
      const created = await this.createLibraryRow(identity);
      masterWineId = created.id;
      libraryRowCreated = true;
    }

    const link = await this.databaseService.supabase
      .from("beverage_identities")
      .update({
        master_wine_id: masterWineId,
        curation_state: "promoted",
        curated_by: params.curatedBy ?? null,
        curated_at: new Date().toISOString(),
        curation_note: params.note ?? null,
      })
      .eq("id", params.identityId);
    if (link.error) {
      throw new BadRequestException(
        `The identity could not be promoted: ${link.error.message}.${libraryRowCreated ? ` A library row (${masterWineId}) WAS created and is now unreferenced.` : ""}`,
      );
    }

    const itemsRepointed = await this.repointItems(params.identityId, masterWineId);
    const after = await this.loadIdentity(params.identityId);

    return {
      identityId: params.identityId,
      masterWineId,
      libraryRowCreated,
      itemsRepointed,
      standing: after.standing,
    };
  }

  /**
   * Mudavym declines a provisional identity.
   *
   * The identity is NOT deleted and the house keeps it. Declining says "this is
   * not going into the shared library", not "this bottle does not exist" — the
   * house's own item still names it, and `standing` stays `provisional`, which
   * is what the house is already being shown.
   */
  async decline(params: {
    identityId: string;
    reason: string;
    curatedBy?: string | null;
  }): Promise<{ identityId: string; curationState: string; standing: string }> {
    if (!params.reason || !params.reason.trim()) {
      throw new BadRequestException(
        "A decline states its reason. The house sees it, and 'declined' with no reason is a verdict nobody can act on.",
      );
    }
    const identity = await this.loadIdentity(params.identityId);
    if (identity.curation_state === "promoted") {
      throw new BadRequestException(
        "That identity is already in the library; it cannot be declined.",
      );
    }
    const { error } = await this.databaseService.supabase
      .from("beverage_identities")
      .update({
        curation_state: "declined",
        curated_by: params.curatedBy ?? null,
        curated_at: new Date().toISOString(),
        curation_note: params.reason.trim(),
      })
      .eq("id", params.identityId);
    if (error) {
      throw new BadRequestException(
        `The identity could not be declined: ${error.message}.`,
      );
    }
    return {
      identityId: params.identityId,
      curationState: "declined",
      standing: identity.standing,
    };
  }

  private async loadIdentity(identityId: string): Promise<any> {
    const { data, error } = await this.databaseService.supabase
      .from("beverage_identities")
      .select(
        "id, producer_normalised, name_normalised, vintage_text, size_ml, pack, display_label, standing, curation_state, master_wine_id, asserted_for_restaurant_id, assertion_note",
      )
      .eq("id", identityId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        `The identity could not be read (${error.message}). Nothing was changed.`,
      );
    }
    if (!data) throw new NotFoundException("No such identity.");
    return data;
  }

  /**
   * Create the shared library row a promotion points at.
   *
   * Only the fields the identity actually states are written. `primary_type`
   * and `country` are NOT NULL on that table and the identity does not carry
   * either, so both are written as the literal `unknown` rather than guessed —
   * the library already uses `unknown` as a primary_type (59 rows, measured
   * 2026-09-05) and a wrong country is harder to find later than a blank one.
   * `provisional_for_restaurant_id` is left NULL: this IS the shared entry.
   */
  private async createLibraryRow(identity: any): Promise<{ id: string }> {
    const vintage = /^\d{4}$/.test(String(identity.vintage_text ?? ""))
      ? Number(identity.vintage_text)
      : null;
    const { data, error } = await this.databaseService.supabase
      .from("master_wine_library")
      .insert({
        wine_id: `IDN-${String(identity.id).slice(0, 12)}`,
        name: identity.display_label,
        producer: identity.producer_normalised,
        vintage,
        primary_type: "unknown",
        country: "unknown",
        bottle_size_ml: identity.size_ml ?? 750,
        source: "identity_curation",
        review_status: "approved",
      })
      .select("id")
      .single();
    if (error) {
      throw new BadRequestException(
        `The library entry could not be created: ${error.message}. Nothing was promoted.`,
      );
    }
    return { id: (data as any).id };
  }

  /**
   * Re-point every house item that names this identity.
   *
   * Returns how many rows were re-pointed, and that number is REPORTED rather
   * than assumed: zero is a real answer (nobody has linked an item yet) and the
   * caller prints it instead of implying the promotion moved something.
   */
  private async repointItems(
    identityId: string,
    masterWineId: string,
  ): Promise<number> {
    const { data, error } = await this.databaseService.supabase
      .from("restaurant_inventory")
      .update({ master_wine_id: masterWineId })
      .eq("identity_id", identityId)
      .select("id");
    if (error) {
      throw new BadRequestException(
        `The identity was promoted onto ${masterWineId} but the house items could not be re-pointed: ${error.message}. They still name the row they had.`,
      );
    }
    return (data ?? []).length;
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
   * proposed again. **Either way a row is appended to
   * `beverage_identity_decisions`** naming who (id, name and role as they were),
   * when, which candidate, and the evidence the server had rendered to them.
   *
   * THE ORDER IS DELIBERATE: link, then log, then projection. If the log write
   * fails the call fails and says the link was written, rather than leaving a
   * link nobody can account for while reporting success.
   */
  async decide(params: {
    candidateId: string;
    decision: "confirmed" | "rejected";
    actor: IdentityActor;
    restaurantId: string | null;
    note?: string | null;
  }): Promise<{
    id: string;
    status: string;
    linkWritten: string | null;
    decisionId: string;
  }> {
    const actor = this.requireActor(params.actor);

    const cand = await this.loadCandidate(params.candidateId);

    if (cand.status !== "pending") {
      throw new BadRequestException(
        `That candidate was already ${cand.status}. A decision is not re-taken silently; a manager can undo it, which is itself logged.`,
      );
    }
    this.requireSameHouse(cand.restaurant_id, params.restaurantId);

    let linkWritten: string | null = null;
    if (params.decision === "confirmed") {
      linkWritten = await this.writeLink(
        cand.subject_table as IdentitySubjectTable,
        cand.subject_id,
        cand.identity_id,
        actor.userId,
      );
    }

    const decisionId = await this.appendDecision({
      candidate: cand,
      action: params.decision,
      actor,
      note: params.note ?? null,
      linkWritten,
      undoesDecisionId: null,
    });

    const { error: updErr } = await this.databaseService.supabase
      .from("beverage_identity_candidates")
      .update({
        status: params.decision,
        decided_by: actor.userId,
        decided_at: new Date().toISOString(),
        decision_note: params.note ?? null,
      })
      .eq("id", params.candidateId);
    if (updErr) {
      throw new BadRequestException(
        `The link was ${linkWritten ? "written" : "not written"} and the decision was logged as ${decisionId}, but the candidate's own status could not be updated: ${updErr.message}. The log is the record; the candidate row is stale.`,
      );
    }

    return {
      id: params.candidateId,
      status: params.decision,
      linkWritten,
      decisionId,
    };
  }

  /**
   * A manager takes a decision back. The undo is itself a decision.
   *
   * Nothing is erased. The candidate returns to `pending` — which CLEARS its
   * `decided_by`/`decided_at`, because `bic_decision_is_dated` says a pending
   * row has no decision recorded — and the whole history stays in the log,
   * which is the reason the log exists at all.
   *
   * The link written by the confirmation is taken back first. A key row is
   * DELETED rather than marked, because the keys table has no state: a key that
   * names an identity is an assertion, and withdrawing the assertion is
   * removing it. The removal is accounted for by the undo row that names it.
   */
  async undo(params: {
    decisionId: string;
    actor: IdentityActor;
    restaurantId: string | null;
    note?: string | null;
  }): Promise<{
    decisionId: string;
    undid: string;
    candidateId: string;
    linkCleared: string | null;
  }> {
    const actor = this.requireActor(params.actor);
    if (actor.role !== "owner" && actor.role !== "manager" && actor.role !== "admin") {
      // Belt and braces behind the route's own @Roles: the asymmetry the
      // founder drew — staff confirm, a manager takes it back — is a rule
      // about this operation, so it is stated where the operation is.
      throw new ForbiddenException(
        "Taking a decision back is a manager's call. Staff may confirm and reject; only an owner or a manager may undo.",
      );
    }

    const { data: prior, error: readErr } = await this.databaseService.supabase
      .from("beverage_identity_decisions")
      .select("id, candidate_id, restaurant_id, action, link_written")
      .eq("id", params.decisionId)
      .maybeSingle();
    if (readErr) {
      throw new BadRequestException(
        `The decision could not be read (${readErr.message}). Nothing was undone.`,
      );
    }
    if (!prior) throw new NotFoundException("No such decision.");
    const before = prior as any;

    if (before.action === "undone") {
      throw new BadRequestException(
        "That row IS an undo. Undoing an undo would be a re-confirmation, which is a decision somebody has to take on the evidence.",
      );
    }
    this.requireSameHouse(before.restaurant_id, params.restaurantId);

    const alreadyUndone = await this.databaseService.supabase
      .from("beverage_identity_decisions")
      .select("id")
      .eq("undoes_decision_id", params.decisionId)
      .maybeSingle();
    if (alreadyUndone.error) {
      throw new BadRequestException(
        `Could not check whether that decision was already undone (${alreadyUndone.error.message}). Nothing was undone, because doing so blind could take a link back twice.`,
      );
    }
    if (alreadyUndone.data) {
      throw new BadRequestException(
        `That decision was already undone (${(alreadyUndone.data as any).id}).`,
      );
    }

    const cand = await this.loadCandidate(before.candidate_id);

    const linkCleared =
      before.action === "confirmed"
        ? await this.clearLink(
            cand.subject_table as IdentitySubjectTable,
            cand.subject_id,
            cand.identity_id,
          )
        : null;

    const decisionId = await this.appendDecision({
      candidate: cand,
      action: "undone",
      actor,
      note: params.note ?? null,
      linkWritten: linkCleared,
      undoesDecisionId: params.decisionId,
    });

    const { error: updErr } = await this.databaseService.supabase
      .from("beverage_identity_candidates")
      .update({
        status: "pending",
        decided_by: null,
        decided_at: null,
        decision_note: null,
      })
      .eq("id", cand.id);
    if (updErr) {
      throw new BadRequestException(
        `The undo was logged as ${decisionId} but the candidate could not be returned to pending: ${updErr.message}.`,
      );
    }

    return {
      decisionId,
      undid: params.decisionId,
      candidateId: cand.id,
      linkCleared,
    };
  }

  /**
   * This house's decision log, newest first.
   *
   * A failed read THROWS. An empty array here would say "nobody in this house
   * has ever decided anything", which is a claim, and a query that failed has
   * made no claim at all.
   */
  async decisions(
    restaurantId: string | null,
    limit = 50,
  ): Promise<{ items: any[]; scope: string; limit: number; complete: boolean }> {
    const capped = Math.min(Math.max(limit, 1), 200);
    let q = this.databaseService.supabase
      .from("beverage_identity_decisions")
      .select(
        "id, candidate_id, restaurant_id, action, decided_by, decided_by_label, decided_by_role, decided_at, evidence_shown, note, link_written, undoes_decision_id",
      )
      .order("decided_at", { ascending: false })
      .limit(capped);
    if (restaurantId) {
      q = q.or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`);
    }
    const { data, error } = await q;
    if (error) {
      throw new BadRequestException(
        `The identity decision log could not be read (${error.message}). This is a failure, not an empty log.`,
      );
    }
    const items = data ?? [];
    return {
      items,
      scope: restaurantId
        ? "this house's decisions, plus decisions on the public registers"
        : "every decision",
      limit: capped,
      // A full page is a FLOOR, not a total. The page must not print `items.length`
      // as "N decisions" when the query was capped at exactly that many.
      complete: items.length < capped,
    };
  }

  // -------------------------------------------------------------------------

  private requireActor(actor: IdentityActor): Required<IdentityActor> {
    if (!actor?.userId) {
      // Belt and braces behind the guard: a decision with no author is the
      // shape this register exists to stop.
      throw new ForbiddenException(
        "A candidate can only be decided by a named person.",
      );
    }
    const label = (actor.name ?? actor.email ?? "").trim();
    if (!label) {
      // The log's `decided_by_label` is NOT NULL for a reason: the id goes null
      // when the person is removed. Refusing here is better than inventing a
      // placeholder that would later read as the person's name.
      throw new ForbiddenException(
        "This account has no name or email on it, so the decision could not be attributed. The log records who decided, and it will not record a placeholder.",
      );
    }
    return {
      userId: actor.userId,
      name: actor.name ?? "",
      email: actor.email ?? "",
      role: (actor.role ?? "").toLowerCase(),
      label,
    };
  }

  private requireSameHouse(rowHouse: string | null, actorHouse: string | null) {
    if (rowHouse && actorHouse && rowHouse !== actorHouse) {
      throw new ForbiddenException("That candidate belongs to another house.");
    }
  }

  private async loadCandidate(candidateId: string): Promise<any> {
    const { data, error } = await this.databaseService.supabase
      .from("beverage_identity_candidates")
      .select(
        "id, subject_table, subject_id, restaurant_id, identity_id, method, confidence, evidence, status",
      )
      .eq("id", candidateId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        `The candidate could not be read (${error.message}). Nothing was decided.`,
      );
    }
    if (!data) throw new NotFoundException("No such candidate.");
    return data;
  }

  /**
   * Append one row to the log, capturing what the person was shown.
   *
   * `evidence_shown` is built HERE, from the candidate and the identity as the
   * server holds them, and is never taken from the request body. A client that
   * supplies "this is what I saw" is making an attestation; a log has to be a
   * record.
   */
  private async appendDecision(args: {
    candidate: any;
    action: "confirmed" | "rejected" | "undone";
    actor: Required<IdentityActor>;
    note: string | null;
    linkWritten: string | null;
    undoesDecisionId: string | null;
  }): Promise<string> {
    const identity = await this.databaseService.supabase
      .from("beverage_identities")
      .select("id, display_label, identity_key, standing")
      .eq("id", args.candidate.identity_id)
      .maybeSingle();
    // A missing identity label does not stop the log — it is recorded as
    // unread, with the reason, because a decision that happened must be logged
    // even when the decoration around it could not be fetched.
    const identityShown = identity.error
      ? { unread: true, reason: identity.error.message }
      : (identity.data ?? { unread: true, reason: "the identity row was not found" });

    const { data, error } = await this.databaseService.supabase
      .from("beverage_identity_decisions")
      .insert({
        candidate_id: args.candidate.id,
        restaurant_id: args.candidate.restaurant_id ?? null,
        action: args.action,
        decided_by: args.actor.userId,
        decided_by_label: args.actor.label,
        decided_by_role: args.actor.role || "unstated",
        decided_at: new Date().toISOString(),
        evidence_shown: {
          method: args.candidate.method,
          confidence: args.candidate.confidence,
          evidence: args.candidate.evidence ?? {},
          identity: identityShown,
          subject: {
            table: args.candidate.subject_table,
            id: args.candidate.subject_id,
          },
          capturedBy: "server",
        },
        note: args.note,
        link_written: args.linkWritten,
        undoes_decision_id: args.undoesDecisionId,
      })
      .select("id")
      .single();

    if (error) {
      throw new BadRequestException(
        `The decision could not be logged (${error.message}). The founder's rule is that a confirmation IS a logged decision, so an unlogged one is not recorded as taken.`,
      );
    }
    return (data as any).id;
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

  /**
   * Take back the link a confirmation wrote.
   *
   * The column case sets `identity_id` to NULL — the state it was in before,
   * and the state the reader already knows how to say out loud ("no sighting
   * carries a confirmed identity yet"). The key case DELETES the key row,
   * because that table has no state: a key is an assertion, and withdrawing an
   * assertion is removing it. Neither is silent — the undo row in the log names
   * exactly which of the two happened.
   */
  private async clearLink(
    subjectTable: IdentitySubjectTable,
    subjectId: string,
    identityId: string,
  ): Promise<string> {
    if (LINK_BY_COLUMN.has(subjectTable)) {
      const patch = { identity_id: null };
      const client = this.databaseService.supabase;
      const { error } =
        subjectTable === "restaurant_inventory"
          ? await client
              .from("restaurant_inventory")
              .update(patch)
              .eq("id", subjectId)
              .eq("identity_id", identityId)
          : subjectTable === "vendor_price_observations"
            ? await client
                .from("vendor_price_observations")
                .update(patch)
                .eq("id", subjectId)
                .eq("identity_id", identityId)
            : await client
                .from("price_index_postings")
                .update(patch)
                .eq("id", subjectId)
                .eq("identity_id", identityId);
      if (error) {
        throw new BadRequestException(
          `The identity could not be cleared from ${subjectTable}: ${error.message}. Nothing was undone.`,
        );
      }
      return `${subjectTable}.identity_id cleared`;
    }

    const namespace = KEY_NAMESPACE_BY_TABLE[subjectTable];
    if (!namespace) {
      throw new BadRequestException(
        `${subjectTable} has no link to take back. This is a code defect, not a data one.`,
      );
    }
    const { error } = await this.databaseService.supabase
      .from("beverage_identity_keys")
      .delete()
      .eq("key_namespace", namespace)
      .eq("key_value", subjectId)
      .eq("identity_id", identityId);
    if (error) {
      throw new BadRequestException(
        `The identity key could not be withdrawn: ${error.message}. Nothing was undone.`,
      );
    }
    return `beverage_identity_keys(${namespace}) withdrawn`;
  }

  // -------------------------------------------------------------------------
  // Q4 — two ways in: the LWIN file, and a hand nomination.
  // -------------------------------------------------------------------------

  /**
   * Search the recorded LWIN file.
   *
   * The founder, 2026-09-05 (batch 49): *"A house searches the LWIN file and
   * confirms identities from it, and can also nominate a wine by hand ... Two
   * ways in; nothing invented."* Batch 43 settled the file: a RECORDED one-off,
   * refreshed on a stated cadence, never a live fetch.
   *
   * WHEN THE FILE IS NOT THERE THIS SAYS SO, and names the path, the licence
   * and where a person gets it. It does not return an empty list: "no wine
   * matched your words" and "there is no file on this deployment" are different
   * answers, and only the first is about the wine.
   */
  async lwinSearch(
    query: string,
    limit = 20,
  ): Promise<{
    available: boolean;
    hits: LwinSearchHit[];
    rowsInFile: number | null;
    note: string;
    attribution: string;
    filePath: string | null;
  }> {
    const filePath = (process.env.LWIN_FILE_PATH ?? "").trim();
    if (!filePath) {
      return {
        available: false,
        hits: [],
        rowsInFile: null,
        filePath: null,
        attribution: LWIN_ATTRIBUTION,
        note: "No LWIN file is recorded on this deployment. LWIN_FILE_PATH is unset. The database is Liv-ex's, free under CC BY 4.0 (https://www.liv-ex.com/lwin/lwin-creative-commons/), and is served through a form rather than a URL, so a person downloads it and points LWIN_FILE_PATH at it. This is not an empty search result.",
      };
    }

    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (e: any) {
      return {
        available: false,
        hits: [],
        rowsInFile: null,
        filePath,
        attribution: LWIN_ATTRIBUTION,
        note: `The recorded LWIN file at ${filePath} could not be read (${e?.message ?? "no reason given"}). This is a failure, not an empty search.`,
      };
    }

    const parsed = readLwinFile(text);
    if (!parsed.ok) {
      return {
        available: false,
        hits: [],
        rowsInFile: null,
        filePath,
        attribution: LWIN_ATTRIBUTION,
        note: `The recorded LWIN file was refused (${parsed.reason}): ${parsed.note}`,
      };
    }

    return {
      available: true,
      hits: searchLwin(parsed.rows, query, limit),
      rowsInFile: parsed.rows.length,
      filePath,
      attribution: LWIN_ATTRIBUTION,
      note: `${parsed.rows.length} row(s) read from the recorded LWIN file; ${Object.values(parsed.refusals).reduce((a, b) => a + b, 0)} refused.`,
    };
  }

  /**
   * Confirm one LWIN row as an identity, with the format the house states.
   *
   * The row names the WINE. The vintage, size and pack come from the house and
   * are not invented here — an LWIN-7 carries none of them, and the longer
   * forms are built from a bottle somebody actually has.
   *
   * The identity's standing is `source`, NOT `provisional`: it came from a
   * published file, so it is nobody's house assertion and it does not enter the
   * curation queue. The CC BY 4.0 attribution travels on the row, the same rule
   * Iowa's licence gets in the sibling register.
   */
  async confirmFromLwin(params: {
    lwin: string;
    displayName: string;
    producer: string;
    vintage?: string | number | null;
    sizeMl?: number | null;
    pack?: number | null;
    userId: string;
    note?: string | null;
  }): Promise<{ id: string; identityKey: string; created: boolean; lwin: string }> {
    if (!/^\d{7}$/.test(params.lwin)) {
      throw new BadRequestException(
        "An LWIN-7 is seven digits. The longer forms are built from the wine plus the format this house states, not sent whole.",
      );
    }
    const subject = identityFromLwin(
      {
        lwin: params.lwin,
        displayName: params.displayName,
        producer: params.producer,
        region: null,
        country: null,
        colour: null,
        status: null,
        raw: {},
      },
      { vintage: params.vintage, sizeMl: params.sizeMl, pack: params.pack },
    );

    const asserted = await this.assertIdentity({
      subject,
      userId: params.userId,
      // NOT a house assertion: it came from a published file, so it is `source`
      // standing and never enters the curation queue.
      restaurantId: null,
      note: params.note ?? `Confirmed from the recorded LWIN file (LWIN ${params.lwin}).`,
    });

    const { error } = await this.databaseService.supabase
      .from("beverage_identity_keys")
      .upsert(
        {
          identity_id: asserted.id,
          key_namespace: "lwin",
          key_class: "global_standard",
          key_value: params.lwin,
          asserted_by: params.userId,
          asserted_at: new Date().toISOString(),
          assertion_method: "source_transcript",
          assertion_confidence: null,
          source_ref: `lwin:${params.lwin}`,
          note: LWIN_ATTRIBUTION,
        },
        { onConflict: "key_namespace,key_value,identity_id" },
      );
    if (error) {
      throw new BadRequestException(
        `The identity was recorded as ${asserted.id} but its LWIN key could not be written: ${error.message}.`,
      );
    }

    return { ...asserted, lwin: params.lwin };
  }

  /**
   * How many confirmed identities a sweep would have to read.
   *
   * The founder's Q4 text: *"The sweep reads confirmed identities and says how
   * many it read."* This is that number, and it is reported even when it is
   * zero — an empty sweep whose subject list is empty is a different silence
   * from one whose subject list could not be read.
   */
  async confirmedIdentityCount(restaurantId: string | null): Promise<{
    confirmed: number | null;
    scope: string;
    note: string;
  }> {
    const { count, error } = await this.databaseService.supabase
      .from("beverage_identities")
      .select("id", { count: "exact", head: true })
      .in("standing", ["library", "source"]);
    if (error) {
      return {
        confirmed: null,
        scope: restaurantId ? "this house" : "the platform",
        note: `The register could not be counted (${error.message}). This is unknown, not zero.`,
      };
    }
    const n = count ?? 0;
    return {
      confirmed: n,
      scope: restaurantId ? "this house" : "the platform",
      note:
        n === 0
          ? "No confirmed identity exists yet, so a sweep has nothing to read. That is a real zero: identities are confirmed by people, from the LWIN file or by hand, and nothing fills the register on its own."
          : `${n} confirmed identit${n === 1 ? "y" : "ies"} a sweep can read. Provisional ones are excluded: a house's own unconfirmed name is not a subject to go fetching prices for.`,
    };
  }

}
