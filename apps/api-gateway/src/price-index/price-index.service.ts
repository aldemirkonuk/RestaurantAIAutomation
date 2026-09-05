/**
 * Reading the price-index register — the labelled index lines for one state,
 * and the per-source status.
 *
 * THE ONE RULE THIS SERVICE ENFORCES (ADR 0111 / ADR 0117)
 * --------------------------------------------------------
 * An index line is a SEPARATE register. It is returned with its class, its
 * issuer and its date so the caller can draw it as its own line, and it is
 * NEVER joined to a vendor quote here. The endpoint that reads this is the
 * market box's neighbour, not its content.
 *
 * The empty answer is a first-class result, not an error: a state with no
 * posted list, a source withheld because it cannot be fetched, and a source
 * armed-but-not-yet-run are three different silences and this service names
 * which.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  SourceEntry,
  SOURCES,
  normalizeJurisdiction,
} from "./price-index.registry";
import {
  jurisdictionCovers,
  marketSilenceFor,
  priceScopeOf,
  unarmedDisplaySilenceFor,
} from "./jurisdiction";
import { noSourceSentence } from "./silence-notes";
import { priceIndexFetchArmed, PRICE_INDEX_FETCH_FLAG } from "./staleness";
// The hold's LENGTH, imported rather than repeated. A number the panel prints
// and a number the escalation sweep waits out have to be the same number, and
// two copies of "24" is how a sentence starts lying about a clock. This is a
// plain const, not a provider: `PriceIndexService` deliberately takes no
// dependency on the review service (see `carriedBooksFor` below).
import { ESCALATION_HOURS } from "./price-index-review.service";

/** The columns the endpoint reads. Named explicitly so the read-column guard
 *  can verify every one exists in supabase/migrations/. */
const SELECT_COLUMNS =
  "id, source_key, source_class, state, region, issuer, issued_at, issued_at_basis, fetched_at, price_basis, product_name, brand, producer, package_desc, container_type, size_value, size_unit, price, currency, price_unit, pack, container_charge, is_promotion, source_status, attribution, source_url, source_ref, uploaded_by, upload_file_name, upload_sha256, upload_edition_date, admitted_at";

/**
 * WHICH ROWS ARE THE MARKET (ADR 0128).
 *
 * A row is the market when nobody carried it (`uploaded_by IS NULL` — it was
 * fetched, and was never held) or when somebody let it in (`admitted_at IS NOT
 * NULL`). A hand-carried book that is still waiting for a second pair of eyes
 * has rows in this table and is NOT an index line.
 *
 * One exported constant, applied by every read in this file, because the whole
 * value of holding a book is lost the moment one query forgets the predicate —
 * and a query that forgets it does not fail, it just shows unconfirmed numbers,
 * which is the absence-reported-as-health shape at the door that puts prices on
 * three houses' screens.
 *
 * PostgREST ANDs repeated top-level parameters, so this composes with the
 * product search's own `.or()` rather than replacing it.
 */
export const MARKET_VISIBILITY = "uploaded_by.is.null,admitted_at.not.is.null";

/**
 * The review columns this file reads, as a module-level `const` of literal
 * names, for `scripts/check_read_columns_exist.py`.
 */
const REVIEW_BASIS_COLUMNS =
  "file_sha256, file_name, edition_date, status, confirmation_evidence, confirmation_reason, confirmed_at, uploaded_at";

export interface IndexLine {
  id: string;
  sourceKey: string;
  sourceClass: string;
  state: string;
  region: string | null;
  issuer: string;
  issuedAt: string;
  /**
   * Whose clock `issuedAt` came from: 'issuer_stated', 'fetch_date', or null
   * for a row written before the column existed (ADR 0117 Q27). The panel
   * prints "issued" only for the first; anything else is "read on", because a
   * date we chose must never be rendered as one a publisher chose.
   */
  issuedAtBasis: string | null;
  fetchedAt: string;
  priceBasis: string;
  productName: string;
  brand: string | null;
  producer: string | null;
  packageDesc: string | null;
  containerType: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  price: number;
  currency: string;
  priceUnit: string;
  pack: number | null;
  containerCharge: number | null;
  isPromotion: boolean;
  sourceStatus: string | null;
  attribution: string | null;
  sourceUrl: string;
  /**
   * Set only on a row a PERSON carried in (ADR 0117 Q17). All four together or
   * all four null — the table's own CHECK enforces it — so a reader can say
   * "this line came from the book <name> brought in on <date>" and never half
   * of that. `uploadedBy` is a public.users id.
   */
  uploadedBy: string | null;
  uploadFileName: string | null;
  uploadSha256: string | null;
  uploadEditionDate: string | null;
  /**
   * When this carried row was let into the market (ADR 0128). Null on every
   * fetched row, which was never held — so it is `uploadedBy` that says whether
   * a null here means anything at all. A line that reaches a reader always has
   * one or the other; `MARKET_VISIBILITY` is what guarantees it.
   */
  admittedAt: string | null;
}

export interface StateIndexResult {
  requested: string;
  state: string | null; // the normalised ISO key, or null if unrecognised
  lines: IndexLine[];
  /** The sources that publish for this state, and whether each is readable. */
  sources: Array<{
    key: string;
    sourceClass: string;
    issuer: string;
    cadence: string;
    /** We could not read the bytes. */
    withheld: { reason: string; measuredOn: string } | null;
    /** We read them and there is no price in them. Never the same fact. */
    silent: { kind: string; reason: string; measuredOn: string } | null;
    /**
     * What a reader is to be told this source IS, when its rows are drawn.
     * Present only on a source whose rows get their own labelled box — today
     * the produce index (ADR 0117 Q24). Absent means "draw it as a drinks
     * posting", which is what every other source is.
     */
    display: { category: string; shortIssuer: string; extent: string } | null;
    rows: number;
  }>;
  /**
   * How many hand-carried books this state is holding, waiting for a second
   * pair of eyes (ADR 0128). `null` means the question could not be answered,
   * which is not zero: a held book that reads as "nothing here" would tell a
   * house to go and fetch a book its own manager already brought in.
   */
  heldBooks: number | null;
  /**
   * How long a held book waits before the people who could act are told again,
   * and before the person who brought it may admit it themselves (ADR 0128 Q2,
   * the founder: 24 hours). Sent rather than assumed by the page, so the hold
   * is PRINTED where the waiting book is shown and never left to be inferred.
   */
  heldBookHoldHours: number;
  /**
   * The hand-carried books whose rows are in the market, and on what basis each
   * was let in (ADR 0128 Q4, the founder: *"Acceptable: reason + record"*).
   *
   * `null` means the question could not be answered. An admitted line whose
   * basis is unknown is drawn WITHOUT a basis rather than with a guessed one.
   */
  carriedBooks: CarriedBook[] | null;
  /** Words, never an empty list mistaken for "nothing costs anything". */
  silence: string | null;
}

/** One hand-carried book that is in the market, and how it got there. */
export interface CarriedBook {
  sha256: string;
  fileName: string;
  editionDate: string;
  /**
   * `routine` - one person's upload stood; every band was inside and nobody was
   * asked. `byte_match` - a second person fetched the book themselves and the
   * bytes agreed. `attested` - a second person vouched for the summary.
   * `same_person` - the person who brought it in admitted it, because the
   * jurisdiction has nobody else. That last one is printed in the box in those
   * words: it is not a second pair of eyes and the reader is told so.
   */
  basis: string;
  /** The words the lone admitter gave. Null on every other basis. */
  reason: string | null;
  admittedAt: string | null;
}

export interface SourceStatus {
  key: string;
  sourceClass: string;
  issuer: string;
  jurisdiction: string;
  cadence: string;
  withheld: { reason: string; measuredOn: string } | null;
  silent: { kind: string; reason: string; measuredOn: string } | null;
  display: { category: string; shortIssuer: string; extent: string } | null;
  rows: number;
  lastFetchedAt: string | null;
  silentBecause: string | null;
}

@Injectable()
export class PriceIndexService {
  private readonly logger = new Logger(PriceIndexService.name);

  constructor(private readonly db: DatabaseService) {}

  private armed(): boolean {
    return priceIndexFetchArmed(process.env[PRICE_INDEX_FETCH_FLAG]);
  }

  /**
   * The index for the CALLER's own house — resolves the restaurant's state
   * server-side so the web never has to carry it. `restaurants.state_province`
   * is free text ('CA' / 'California'), normalised the same way as `:state`. A
   * house with no state recorded (2 of 14 tenants) gets WORDS, not a guess.
   */
  async forHouse(restaurantId: string | null): Promise<StateIndexResult> {
    if (!restaurantId) {
      return {
        requested: "me",
        state: null,
        lines: [],
        sources: [],
        heldBooks: 0,
        heldBookHoldHours: ESCALATION_HOURS,
        carriedBooks: [],
        silence: "No active restaurant on this session, so no state to scope the index to.",
      };
    }
    // REGION FIRST, THEN COUNTRY (2026-09-05). `state_province` is free text
    // ('CA' / 'California' / 'Muğla' / 'England'); `country` is free text too
    // ('Türkiye' / 'USA' / 'united States'). Reading only the province was
    // measured wrong on this estate: The Old House Pub in Antalya records NO
    // province and country 'Türkiye', so it was told "this house has no state
    // recorded" when its country is known and is the level Türkiye publishes
    // at. The country is the FALLBACK, never the override — a province is the
    // more specific fact and wins whenever it resolves.
    let rawState: string | null = null;
    let rawCountry: string | null = null;
    try {
      const { data, error } = await this.db.client
        .from("restaurants")
        .select("state_province, country")
        .eq("id", restaurantId)
        .single();
      if (error) throw error;
      const row = data as {
        state_province: string | null;
        country: string | null;
      } | null;
      rawState = row?.state_province ?? null;
      rawCountry = row?.country ?? null;
    } catch (err) {
      this.logger.warn(
        `could not read this house's jurisdiction for the price index: ${(err as Error).message}`,
      );
    }
    if (rawState && rawState.trim() && normalizeJurisdiction(rawState)) {
      return this.forState(rawState);
    }
    if (rawCountry && rawCountry.trim() && normalizeJurisdiction(rawCountry)) {
      return this.forState(rawCountry);
    }
    // A province WAS recorded and this register does not recognise it: say
    // that, rather than "no state recorded", which would be false.
    if (rawState && rawState.trim()) {
      return this.forState(rawState);
    }
    return {
      requested: "me",
      state: null,
      lines: [],
      sources: [],
      heldBooks: 0,
      heldBookHoldHours: ESCALATION_HOURS,
      carriedBooks: [],
      silence:
        "This house records neither a state nor a country, so no jurisdiction can be scoped. Set the address in Settings to draw an index line.",
    };
  }

  /** The index lines for one state, plus who publishes there and why it is quiet. */
  async forState(
    rawState: string,
    product?: string,
    basis?: string,
    limit = 25,
  ): Promise<StateIndexResult> {
    const state = normalizeJurisdiction(rawState);
    // Coverage is CONTAINMENT, not equality (2026-09-05): a national
    // instrument speaks for a house in one of its provinces, and an
    // England-and-Wales series speaks for a house in England. It does NOT
    // speak for a house known only as 'GB', which may be in Scotland.
    const sourcesForState = state
      ? Object.values(SOURCES).filter((s) =>
          jurisdictionCovers(s.jurisdiction, state),
        )
      : [];

    if (!state) {
      return {
        requested: rawState,
        state: null,
        lines: [],
        sources: [],
        heldBooks: 0,
        heldBookHoldHours: ESCALATION_HOURS,
        carriedBooks: [],
        silence: `"${rawState}" is not a jurisdiction this register recognises. No index line is drawn rather than guessing a state.`,
      };
    }

    let lines: IndexLine[] = [];
    let readFailed = false;
    try {
      let query = this.db.client
        .from("price_index_postings")
        .select(SELECT_COLUMNS)
        .eq("state", state)
        // A book somebody carried in is not an index line until somebody let
        // it in (ADR 0128). Before this, an uploaded book was the market the
        // instant it was written — and because the order below is by
        // `issued_at`, a newer carried edition displaced every fetched line
        // above it.
        .or(MARKET_VISIBILITY)
        .order("issued_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 100));
      if (basis) query = query.eq("price_basis", basis);
      if (product) {
        const p = product.replace(/[^a-zA-Z0-9 ]/g, "").trim();
        if (p) query = query.or(`product_name.ilike.*${p}*,brand.ilike.*${p}*`);
      }
      const { data, error } = await query;
      if (error) throw error;
      lines = (data ?? []).map(mapLine);
    } catch (err) {
      readFailed = true;
      this.logger.warn(
        `price_index_postings read failed for ${state}: ${(err as Error).message}`,
      );
    }

    const sources = await this.sourcesWithCounts(sourcesForState, state);
    // Asked on EVERY successful read, not only on an empty one. A jurisdiction
    // can hold a new book while an older admitted edition is still drawn, and a
    // pending label that appeared only when the panel was empty would hide the
    // waiting book precisely when the panel looks healthy — the same inversion
    // this whole change exists to close. Skipped only when the lines could not
    // be read at all, because "a book is waiting" is not a thing to claim on
    // top of "the register is unknown" (ADR 0128).
    const carried = readFailed
      ? { held: 0 as number | null, admitted: [] as CarriedBook[] | null }
      : await this.carriedBooksFor(state);
    const heldBooks = carried.held;
    return {
      requested: rawState,
      state,
      lines,
      sources,
      heldBooks,
      heldBookHoldHours: ESCALATION_HOURS,
      carriedBooks: carried.admitted,
      silence: this.silenceFor(
        state,
        sourcesForState,
        lines.length,
        readFailed,
        heldBooks,
      ),
    };
  }

  private silenceFor(
    state: string,
    sourcesForState: SourceEntry[],
    lineCount: number,
    readFailed: boolean,
    heldBooks: number | null,
  ): string | null {
    if (readFailed) {
      return "The index register could not be read. This is unknown, not empty.";
    }
    if (lineCount > 0) return null;

    // A book IS here and is waiting for a person. Said before every other
    // sentence below, all of which would tell the house to go and find a book
    // that its own manager already carried in — the same fault ADR 0117
    // corrected for Illinois, wearing the other hat (ADR 0128).
    if (heldBooks !== null && heldBooks > 0) {
      const one = heldBooks === 1;
      // The hold's LENGTH is in the sentence, not implied by it (ADR 0128 Q2).
      // "waiting for a second pair of eyes" with no clock beside it reads as
      // "waiting indefinitely", and the whole point of the 24 hours is that it
      // bounds how long one person can be blocked by another person's inbox.
      return `${one ? "A price book has" : `${heldBooks} price books have`} been brought in for ${state} and ${one ? "is" : "are"} waiting for a second pair of eyes. Nothing is drawn from ${one ? "it" : "them"} until an owner or manager admits ${one ? "it" : "them"}. After ${ESCALATION_HOURS} hours the people who could act are told again, and the person who brought ${one ? "it" : "them"} in may admit ${one ? "it" : "them"} with a stated reason.`;
    }

    // A house that records only a country, in a country whose prices are
    // published state by state. That is a missing ADDRESS, not a missing
    // market, and "nothing is posted for US" would be false. (2026-09-05)
    if (!state.includes("-") && priceScopeOf(state) === "subnational") {
      return `This house records the country (${state}) but no state, and ${state} publishes prices state by state. Set the state in Settings to scope an index line.`;
    }

    if (sourcesForState.length === 0) {
      // The market's own researched sentence where there is one: it names the
      // cause, which an empty box never can. (2026-09-05, ADR 0117)
      const market = marketSilenceFor(state);
      if (market) return market;
      // The researched sentence where the question has been settled, and an
      // explicit "nobody has looked" where it has not. The line this replaced
      // — "A house here has no index line until one is found" — was true of an
      // unresearched state and false of Illinois, whose price-filing section
      // was repealed in 1998: it reported a settled legal fact as a pending
      // search. (2026-09-05, ADR 0117 "Michigan and Illinois")
      return noSourceSentence(state);
    }

    const withheld = sourcesForState.filter((s) => s.withheld);
    if (withheld.length === sourcesForState.length) {
      const first = withheld[0];
      const base = `${state} has a posted list (${first.issuer}) but it cannot be fetched: ${first.withheld!.reason}`;
      // A source that cannot be fetched but CAN be carried in by hand must say
      // so. Ending on "cannot be fetched" tells a Michigan house to give up on
      // a book its own manager can download in a minute. (2026-09-05)
      const uploadable = withheld.filter((s) => s.intake === "upload");
      // A second withheld list in the same state that is FILED rather than
      // published gets its own clause, because "a manager can upload the book"
      // is true of the spirits book and false of the beer and wine schedules —
      // and a wine house reading only the upload sentence would wait for lines
      // that will never fill from it. (2026-09-05, ADR 0126)
      const byRequest = withheld.filter((s) => s.intake === "foia");
      const embargo = byRequest[0]?.standingRequest?.statutoryEmbargoDays ?? null;
      const requestClause =
        byRequest.length === 0
          ? ""
          : ` A second list here is filed with the issuer rather than published and reaches this register only through a written public-records request${
              embargo
                ? `, and the statute holds each filing back for ${embargo} days — so even a granted request returns a schedule at least that old`
                : ""
            }.`;
      if (uploadable.length > 0) {
        return `${base} A manager can download the ${uploadable[0].cadence.split(" (")[0]} book from the issuer and upload it, and these lines will fill.${requestClause}`;
      }
      return `${base}${requestClause}`;
    }

    // Every source for this jurisdiction was READ and none holds a price — a
    // tax schedule, an index number, a discontinued series, an HTML grid. That
    // is a different fact from "we could not fetch it", and the market
    // sentence is the one that explains it. (2026-09-05)
    const silent = sourcesForState.filter((s) => s.silent);
    if (silent.length > 0 && silent.length + withheld.length === sourcesForState.length) {
      const market = marketSilenceFor(state);
      const named = silent
        .map((s) => `${s.issuer}: ${s.silent!.reason}`)
        .join(" ");
      return market ? `${market} ${named}` : named;
    }

    // When every source that COULD be fetched here is one whose rows get their
    // own labelled box (the produce index), the generic "posted list" sentence
    // is wrong twice: the UK has no posting regime, and there is no drinks
    // source waiting to be switched on. Say what was actually found, and name
    // the switch. (2026-09-05, ADR 0117 Q24)
    const fetchable = sourcesForState.filter(
      (s) => !s.withheld && !s.silent && s.parse,
    );
    if (
      !this.armed() &&
      fetchable.length > 0 &&
      fetchable.every((s) => s.display)
    ) {
      const d = fetchable[0].display!;
      return unarmedDisplaySilenceFor(
        state,
        d.category,
        d.shortIssuer,
        d.extent,
        PRICE_INDEX_FETCH_FLAG,
      );
    }

    if (!this.armed()) {
      return `${state} has a fetchable posted list, but the scheduled fetch is off (${PRICE_INDEX_FETCH_FLAG}). No index line has been recorded yet.`;
    }
    return `${state} has a fetchable posted list and the fetch is armed, but no rows have been recorded yet.`;
  }

  private async sourcesWithCounts(entries: SourceEntry[], state: string) {
    const out: StateIndexResult["sources"] = [];
    for (const s of entries) {
      out.push({
        key: s.key,
        sourceClass: s.sourceClass,
        issuer: s.issuer,
        cadence: s.cadence,
        withheld: s.withheld ?? null,
        silent: s.silent ?? null,
        display: s.display ?? null,
        rows: await this.countFor(s.key, state),
      });
    }
    return out;
  }

  /**
   * The carried books this state has, in ONE read: how many are waiting, and
   * on what basis each of the admitted ones was let in (ADR 0128 Q4).
   *
   * Read here rather than by asking `PriceIndexReviewService`, deliberately.
   * That service decides WHO may admit a book and what a confirmation is worth,
   * and none of that policy is duplicated by reading four columns; taking it as
   * a constructor dependency would instead have changed the shape of
   * `new PriceIndexService(db)` in five spec files, two of which other builders
   * had open the same day. A reader reading rows is not a second opinion about
   * a rule.
   *
   * `null` on a failed read, never 0 and never `[]`: "nothing is waiting" and
   * "we could not look" produce different sentences, and the second one must
   * not silently become the first at the exact place a house is told to go and
   * find a book its own manager already carried in.
   */
  private async carriedBooksFor(state: string): Promise<{
    held: number | null;
    admitted: CarriedBook[] | null;
  }> {
    try {
      const { data, error } = await this.db.client
        .from("price_index_upload_reviews")
        .select(REVIEW_BASIS_COLUMNS)
        .eq("state", state)
        .order("uploaded_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const admitted: CarriedBook[] = [];
      let held = 0;
      for (const r of rows) {
        const status = String(r.status);
        if (status === "pending") {
          held += 1;
          continue;
        }
        if (status !== "stood" && status !== "confirmed") continue;
        admitted.push({
          sha256: String(r.file_sha256),
          fileName: String(r.file_name),
          editionDate: String(r.edition_date).slice(0, 10),
          // A routine book was never confirmed by anybody, so its basis is the
          // tier that let it stand — not the empty confirmation column, which
          // would draw as "admitted by nobody".
          basis:
            status === "stood"
              ? "routine"
              : r.confirmation_evidence
                ? String(r.confirmation_evidence)
                : "attested",
          reason: r.confirmation_reason ? String(r.confirmation_reason) : null,
          admittedAt: r.confirmed_at ? String(r.confirmed_at) : null,
        });
      }
      return { held, admitted };
    } catch (err) {
      this.logger.warn(
        `could not read the carried books for ${state}: ${(err as Error).message}`,
      );
      return { held: null, admitted: null };
    }
  }

  private async countFor(sourceKey: string, state: string): Promise<number> {
    try {
      const { count, error } = await this.db.client
        .from("price_index_postings")
        .select("id", { count: "exact", head: true })
        .eq("source_key", sourceKey)
        .eq("state", state)
        // The same predicate the lines are read through: a source whose only
        // rows are a held book has no rows a reader can see, and reporting the
        // held ones here would make the panel say "12,530 rows" beside an empty
        // list (ADR 0128).
        .or(MARKET_VISIBILITY);
      if (error) throw error;
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  /** Per-source status for GET /price-index/status. */
  async status(): Promise<{
    armed: boolean;
    flag: string;
    sources: SourceStatus[];
  }> {
    const armed = this.armed();
    const sources: SourceStatus[] = [];
    for (const s of Object.values(SOURCES)) {
      const { rows, lastFetchedAt } = await this.lastFetch(s.key);
      sources.push({
        key: s.key,
        sourceClass: s.sourceClass,
        issuer: s.issuer,
        jurisdiction: s.jurisdiction,
        cadence: s.cadence,
        withheld: s.withheld ?? null,
        silent: s.silent ?? null,
        display: s.display ?? null,
        rows,
        lastFetchedAt,
        silentBecause: s.withheld
          ? `withheld: ${s.withheld.reason}`
          : s.silent
            ? `${s.silent.kind}: ${s.silent.reason}`
            : rows > 0
              ? null
              : armed
                ? "armed, but no rows recorded yet"
                : `fetch disabled (${PRICE_INDEX_FETCH_FLAG} is off)`,
      });
    }
    return { armed, flag: PRICE_INDEX_FETCH_FLAG, sources };
  }

  private async lastFetch(
    sourceKey: string,
  ): Promise<{ rows: number; lastFetchedAt: string | null }> {
    try {
      const { data, count, error } = await this.db.client
        .from("price_index_postings")
        .select("fetched_at", { count: "exact" })
        .eq("source_key", sourceKey)
        .order("fetched_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const last = data && data.length ? (data[0] as { fetched_at: string }).fetched_at : null;
      return { rows: count ?? 0, lastFetchedAt: last };
    } catch {
      return { rows: 0, lastFetchedAt: null };
    }
  }
}

function mapLine(row: Record<string, unknown>): IndexLine {
  const n = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    sourceClass: String(row.source_class),
    state: String(row.state),
    region: (row.region as string) ?? null,
    issuer: String(row.issuer),
    issuedAt: String(row.issued_at),
    // NULL stays NULL. A row written before the basis column existed has no
    // basis, and coercing it to 'issuer_stated' here would be this codebase's
    // standing fault moved from the DDL into the mapper.
    issuedAtBasis: (row.issued_at_basis as string) ?? null,
    fetchedAt: String(row.fetched_at),
    priceBasis: String(row.price_basis),
    productName: String(row.product_name),
    brand: (row.brand as string) ?? null,
    producer: (row.producer as string) ?? null,
    packageDesc: (row.package_desc as string) ?? null,
    containerType: (row.container_type as string) ?? null,
    sizeValue: n(row.size_value),
    sizeUnit: (row.size_unit as string) ?? null,
    price: Number(row.price),
    currency: String(row.currency),
    priceUnit: String(row.price_unit),
    pack: n(row.pack),
    containerCharge: n(row.container_charge),
    isPromotion: row.is_promotion === true,
    sourceStatus: (row.source_status as string) ?? null,
    attribution: (row.attribution as string) ?? null,
    sourceUrl: String(row.source_url),
    uploadedBy: (row.uploaded_by as string) ?? null,
    uploadFileName: (row.upload_file_name as string) ?? null,
    uploadSha256: (row.upload_sha256 as string) ?? null,
    uploadEditionDate: (row.upload_edition_date as string) ?? null,
    admittedAt: (row.admitted_at as string) ?? null,
  };
}
