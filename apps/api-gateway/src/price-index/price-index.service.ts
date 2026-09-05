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

/** The columns the endpoint reads. Named explicitly so the read-column guard
 *  can verify every one exists in supabase/migrations/. */
const SELECT_COLUMNS =
  "id, source_key, source_class, state, region, issuer, issued_at, issued_at_basis, fetched_at, price_basis, product_name, brand, producer, package_desc, container_type, size_value, size_unit, price, currency, price_unit, pack, container_charge, is_promotion, source_status, attribution, source_url, source_ref";

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
  /** Words, never an empty list mistaken for "nothing costs anything". */
  silence: string | null;
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
    return {
      requested: rawState,
      state,
      lines,
      sources,
      silence: this.silenceFor(state, sourcesForState, lines.length, readFailed),
    };
  }

  private silenceFor(
    state: string,
    sourcesForState: SourceEntry[],
    lineCount: number,
    readFailed: boolean,
  ): string | null {
    if (readFailed) {
      return "The index register could not be read. This is unknown, not empty.";
    }
    if (lineCount > 0) return null;

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
      if (uploadable.length > 0) {
        return `${base} A manager can download the ${uploadable[0].cadence.split(" (")[0]} book from the issuer and upload it, and these lines will fill.`;
      }
      return base;
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

  private async countFor(sourceKey: string, state: string): Promise<number> {
    try {
      const { count, error } = await this.db.client
        .from("price_index_postings")
        .select("id", { count: "exact", head: true })
        .eq("source_key", sourceKey)
        .eq("state", state);
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
  };
}
