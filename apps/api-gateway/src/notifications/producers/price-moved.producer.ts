import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import {
  OWNER_AND_MANAGER,
  houseMembersInRoles,
} from "../../common/tenant/live-membership";
import {
  DEFAULT_MOVE_THRESHOLD_PCT,
  money,
  perBottlePrinted,
  printedPriceMove,
  speakPct,
  type PrintedLine,
} from "../../procurement/documents/price-move";
import { readLastPrintedPrices } from "../../procurement/documents/last-printed-prices";

/**
 * "A price moved on a paper that was just checked."
 *
 * New goods side of price moves (r109 g4). Until now a move was computed only
 * on read (GET documents/:id/price-moves), so the house learned of a 40 percent
 * rise only if someone opened that paper. This producer scans the papers
 * verified in the last 48 hours (the same window and cap as
 * `invoice-confirmed`) and says it once.
 *
 * ONE COMPUTE, NOT A SECOND ONE. The verdict is `price-move.ts`'s
 * `printedPriceMove`, unchanged: the exact BigInt threshold (DD-r107-38), the
 * refusal to compare across currencies (DD-r105-19: a paper in another money
 * than the house's is not compared, never converted), and the basis is the
 * good's last OTHER verified paper (#2236), read by the same
 * `readLastPrintedPrices` the controller uses.
 *
 * WHO HEARS IT. A price is the house's money, so the audience is narrowed to
 * owners and managers (the `holdsHouseMoney` rule; the same narrowing
 * `market-price` makes). Staff are never in it. The role read throws on
 * failure, which fails the run (`runOne` records it) and sends nothing. The
 * row travels by the bell only: no email, no push (priority `medium`).
 *
 * DEDUPE: paper id + `verified_at`, so a re-run writes nothing.
 *
 * Not subjects: credit memos, purchase orders and statements are not a price
 * the house paid (the basis read already leaves them out the same way).
 */

const PRODUCER = "price_moved";
const NOT_A_PURCHASE_PRICE = new Set(["credit_memo", "purchase_order", "statement"]);
const LISTED = 3;

interface Moved {
  name: string;
  pct: number;
  prev: number;
  next: number;
}

@Injectable()
export class PriceMovedProducer {
  private readonly logger = new Logger(PriceMovedProducer.name);

  static readonly PRODUCER = PRODUCER;
  static readonly LOOKBACK_HOURS = 48;
  static readonly CANDIDATE_CAP = 200;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  /** Owners and managers of the house; staff and anyone else are dropped. */
  private async managingAudience(
    restaurantId: string,
    audience: ProducerAudience,
  ): Promise<ProducerAudience> {
    const managing = new Set(
      await houseMembersInRoles(
        this.databaseService.getClient(),
        restaurantId,
        OWNER_AND_MANAGER,
      ),
    );
    return {
      ready: audience.ready.filter((u) => managing.has(u)),
      deferred: audience.deferred.filter((u) => managing.has(u)),
      ...(audience.away
        ? { away: audience.away.filter((u) => managing.has(u)) }
        : {}),
    };
  }

  async sweepTenant(
    restaurantId: string,
    _timeZone: string,
    handedAudience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const client = this.databaseService.getClient();
    const audience = await this.managingAudience(restaurantId, handedAudience);
    const since = new Date(
      now.getTime() - PriceMovedProducer.LOOKBACK_HOURS * 3_600_000,
    ).toISOString();

    const { data, error } = await client
      .from("procurement_documents")
      .select("id, doc_type, doc_number, provider_id, currency, verified_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", "verified")
      .gte("verified_at", since)
      .order("verified_at", { ascending: true })
      .limit(PriceMovedProducer.CANDIDATE_CAP + 1);
    if (error) {
      throw new Error(`could not read procurement_documents: ${error.message}`);
    }
    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > PriceMovedProducer.CANDIDATE_CAP;
    const docs = (
      tally.truncated ? rows.slice(0, PriceMovedProducer.CANDIDATE_CAP) : rows
    ).filter((d) => !NOT_A_PURCHASE_PRICE.has(String(d.doc_type ?? "")));

    if (docs.length === 0) {
      tally.withheldReason = `No paper has been verified in the last ${PriceMovedProducer.LOOKBACK_HOURS} hours.`;
      return tally;
    }

    // The house's own money. Unreadable is a failed read, not "no moves".
    const { data: house, error: houseErr } = await client
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (houseErr) {
      throw new Error(`could not read the house's currency: ${houseErr.message}`);
    }
    const houseCurrency = String(house?.currency ?? "").trim().toUpperCase();

    const { data: lineRows, error: lineErr } = await client
      .from("procurement_document_lines")
      .select(
        "document_id, line_no, description, inventory_id, line_total, qty, pack_size, qty_bottles, uom, format_ml",
      )
      .eq("restaurant_id", restaurantId)
      .in("document_id", docs.map((d) => d.id))
      .order("line_no", { ascending: true });
    if (lineErr) {
      throw new Error(`could not read procurement_document_lines: ${lineErr.message}`);
    }
    const linesByDoc = new Map<string, any[]>();
    for (const l of (lineRows ?? []) as any[]) {
      const list = linesByDoc.get(l.document_id) ?? [];
      list.push(l);
      linesByDoc.set(l.document_id, list);
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
          `PRICE_MOVED_VERIFIED_AT_UNREADABLE restaurant=${restaurantId} document=${doc.id} — skipped rather than guessed.`,
        );
        continue;
      }
      const paperCurrency = String(doc.currency ?? "").trim().toUpperCase();
      // DD-r105-19: no comparison across currencies, and none when either
      // money is unknown. Nothing is said; the paper's own page says why.
      if (!paperCurrency || !houseCurrency || paperCurrency !== houseCurrency) {
        continue;
      }

      let moves: Moved[];
      try {
        moves = await this.movesOn(
          restaurantId,
          doc.id,
          paperCurrency,
          linesByDoc.get(doc.id) ?? [],
        );
      } catch (e: any) {
        tally.failed += 1;
        this.logger.warn(
          `PRICE_MOVED_COMPARE_FAILED restaurant=${restaurantId} document=${doc.id} — ${e?.message}. ` +
            "No row is written for this paper; it is retried on the next sweep inside the window.",
        );
        continue;
      }
      if (moves.length === 0) continue;

      const vendor = doc.provider_id ? (vendors.get(doc.provider_id) ?? null) : null;
      const number = doc.doc_number ? String(doc.doc_number) : null;
      const kind = String(doc.doc_type ?? "document").replace(/_/g, " ").trim() || "document";
      const head = [vendor, number ? `${kind} ${number}` : kind]
        .filter(Boolean)
        .join(", ");
      const shown = moves.slice(0, LISTED).map(sayMove).join(", ");
      const more = moves.length > LISTED ? `, and ${moves.length - LISTED} more` : "";

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally, now },
        {
          dedupeKey: `price_moved:${doc.id}:${doc.verified_at}`,
          occurredAt: verifiedAt,
          payload: {
            type: "price_change",
            title: `A price moved${vendor ? ` — ${vendor}` : ""}`,
            message: `${head}: ${shown}${more}.`,
            priority: "medium",
            actionUrl: `/receipts?doc=${encodeURIComponent(doc.id)}`,
            actionLabel: "Open the paper",
            metadata: {
              documentId: doc.id,
              docNumber: number,
              vendorName: vendor,
              thresholdPct: DEFAULT_MOVE_THRESHOLD_PCT,
              moveCount: moves.length,
              verifiedAt: verifiedAt.toISOString(),
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason =
        "No verified paper in the window moved a price, or each had already been reported.";
    }
    return tally;
  }

  /** The moved lines of one paper: price-move.ts's verdict, line by line. */
  private async movesOn(
    restaurantId: string,
    paperId: string,
    currency: string,
    lines: any[],
  ): Promise<Moved[]> {
    const goods = [
      ...new Set(lines.map((l) => l.inventory_id).filter((x): x is string => !!x)),
    ];
    const last = await readLastPrintedPrices(
      this.databaseService.getClient(),
      paperId,
      currency,
      goods,
      restaurantId,
    );
    const out: Moved[] = [];
    for (const l of lines) {
      const next = perBottlePrinted(l as PrintedLine);
      if (typeof next === "string") continue;
      const prev = l.inventory_id ? last.get(l.inventory_id) : undefined;
      // A 375 ml bottle is not the same unit as a 750 ml one of the good.
      if (
        prev &&
        prev.formatMl != null &&
        l.format_ml != null &&
        Number(prev.formatMl) !== Number(l.format_ml)
      )
        continue;
      const verdict = printedPriceMove(prev?.price, next, DEFAULT_MOVE_THRESHOLD_PCT);
      if (!verdict.compared || !verdict.moved || !prev) continue;
      out.push({
        name: String(l.description ?? "A line").trim() || "A line",
        pct: verdict.pct,
        prev: prev.price.value,
        next: next.value,
      });
    }
    return out;
  }

  private async vendorNames(
    restaurantId: string,
    providerIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = Array.from(new Set(providerIds));
    if (!ids.length) return out;
    const { data, error } = await this.databaseService
      .getClient()
      .from("providers")
      .select("id, name")
      .in("id", ids)
      .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`);
    if (error) {
      this.logger.warn(
        `PRICE_MOVED_VENDOR_NAMES_UNREADABLE — ${error.message}. The notification names the paper without its vendor.`,
      );
      return out;
    }
    for (const row of (data ?? []) as any[]) {
      if (row?.id && row?.name) out.set(row.id, String(row.name));
    }
    return out;
  }
}

function sayMove(m: Moved): string {
  return `${m.name} ${m.pct > 0 ? "up" : "down"} ${speakPct(m.pct, DEFAULT_MOVE_THRESHOLD_PCT)}% (${money(m.prev)} -> ${money(m.next)})`;
}
