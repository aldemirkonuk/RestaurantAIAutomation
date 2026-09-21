import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { ORDER_OPEN_WITH_VENDOR_STATUSES } from "../../procurement/order-status";
import {
  AgreedLineRow,
  BuiltScorecard,
  ConversationRow,
  CreditRow,
  DocketEntry,
  HouseRegisters,
  MeasureKey,
  OrderArrivalRow,
  ReceiptEventRow,
  RegisterRead,
  VendorScorecard,
  VerifiedLineRow,
  WindowDays,
  ALERTING_SENTENCE,
  buildVendorScorecard,
  docketFor,
  windowBounds,
} from "./vendor-scorecard";

/**
 * VendorScorecardService — reads this house's registers and hands them to the
 * pure scorecard (vendor-scorecard.ts). ADR 0207.
 *
 * EVERY READ NAMES THE HOUSE. Each query below carries
 * `.eq("restaurant_id", house)` and the house comes from the verified token
 * (the controller's `houseOf`), never from the request. The gateway reads with
 * the service-role client, which bypasses RLS, so this clause IS the tenant
 * boundary — `vendor-scorecard-is-house-scoped.spec.ts` removes each one in
 * turn and expects a foreign house's row to appear.
 *
 * A FAILED READ IS NEVER AN EMPTY ONE. Each register answers `{ ok: false,
 * reason }` when the database refuses, and the measure it feeds says "could not
 * read" with that reason. A register with more rows than one answer holds says
 * so rather than scoring the first page (PostgREST caps an unranged select, and
 * a silently truncated count is a wrong count).
 *
 * NOTHING HERE WRITES. No alert, no label, no row.
 */

const PAGE = 1000;
const MAX_PAGES = 20;
const IN_CHUNK = 150;

type Db = ReturnType<DatabaseService["getClient"]>;
type ReadRows<T> = { ok: true; rows: T[] } | { ok: false; reason: string };

export interface RollCall {
  window: VendorScorecard["window"];
  vendors: VendorScorecard[];
  alerting: { built: false; sentence: string };
}

export interface Docket {
  card: VendorScorecard;
  measure: MeasureKey | null;
  entries: DocketEntry[];
}

function reasonOf(
  error: { code?: string; message?: string } | null | undefined,
): string {
  if (!error) return "no reason given";
  return (
    [error.code, error.message].filter(Boolean).join(" ") || "no reason given"
  );
}

@Injectable()
export class VendorScorecardService {
  private readonly logger = new Logger(VendorScorecardService.name);

  /** The wall clock, replaceable in a spec so a window is a fixed interval. */
  clock: () => Date = () => new Date();

  constructor(private readonly db: DatabaseService) {}

  private client(): Db {
    return this.db.getClient();
  }

  // -------------------------------------------------------------------------
  // Public reads
  // -------------------------------------------------------------------------

  /** The Roll Call: every vendor of this house on the five measures. */
  async rollCall(house: string, days: WindowDays): Promise<RollCall> {
    const now = this.clock();
    const vendors = await this.vendorsOfHouse(house);
    const registers = await this.readRegisters(house, null, now, days);
    const cards = vendors.map(
      (v) =>
        buildVendorScorecard({
          providerId: v.id,
          providerName: v.name,
          days,
          now,
          registers,
        }).card,
    );
    // A scanning order — most orders on the on-time line first, then by name.
    // Not a rank: no measure orders this list.
    cards.sort(
      (a, c) =>
        c.measures[0].rows - a.measures[0].rows ||
        a.providerName.localeCompare(c.providerName),
    );
    const b = windowBounds(now, days);
    return {
      window: {
        days,
        from: new Date(b.from).toISOString(),
        to: new Date(b.to).toISOString(),
        priorFrom: new Date(b.priorFrom).toISOString(),
      },
      vendors: cards,
      alerting: { built: false, sentence: ALERTING_SENTENCE },
    };
  }

  /** The ledger card for one vendor of this house. */
  async vendorCard(
    house: string,
    providerId: string,
    days: WindowDays,
  ): Promise<VendorScorecard> {
    return (await this.build(house, providerId, days)).card;
  }

  /** The Docket: the rows behind the figures, optionally one measure's. */
  async docket(
    house: string,
    providerId: string,
    days: WindowDays,
    measure: MeasureKey | null,
  ): Promise<Docket> {
    const built = await this.build(house, providerId, days);
    return { card: built.card, measure, entries: docketFor(built, measure) };
  }

  private async build(
    house: string,
    providerId: string,
    days: WindowDays,
  ): Promise<BuiltScorecard> {
    const now = this.clock();
    const vendor = await this.vendorOfHouse(house, providerId);
    const registers = await this.readRegisters(house, providerId, now, days);
    return buildVendorScorecard({
      providerId: vendor.id,
      providerName: vendor.name,
      days,
      now,
      registers,
    });
  }

  // -------------------------------------------------------------------------
  // The vendor book
  // -------------------------------------------------------------------------

  private async vendorsOfHouse(
    house: string,
  ): Promise<{ id: string; name: string }[]> {
    const { data, error } = await this.client()
      .from("providers")
      .select("id, name")
      .eq("restaurant_id", house)
      .is("deleted_at", null)
      .order("name", { ascending: true });
    if (error) {
      this.logger.error(`vendor book read failed: ${reasonOf(error)}`);
      throw new ServiceUnavailableException(
        `The vendor book could not be read (${reasonOf(error)}). No scorecard is claimed.`,
      );
    }
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name ?? "Unnamed vendor",
    }));
  }

  private async vendorOfHouse(
    house: string,
    providerId: string,
  ): Promise<{ id: string; name: string }> {
    const { data, error } = await this.client()
      .from("providers")
      .select("id, name")
      .eq("id", providerId)
      .eq("restaurant_id", house)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException(
        `The vendor book could not be read (${reasonOf(error)}). No scorecard is claimed.`,
      );
    }
    // A foreign house's vendor and a missing one are the same answer.
    if (!data)
      throw new NotFoundException(
        `No vendor with id ${providerId} belongs to this house.`,
      );
    return {
      id: (data as any).id,
      name: (data as any).name ?? "Unnamed vendor",
    };
  }

  // -------------------------------------------------------------------------
  // The five registers
  // -------------------------------------------------------------------------

  async readRegisters(
    house: string,
    providerId: string | null,
    now: Date,
    days: WindowDays,
  ): Promise<HouseRegisters> {
    const since = new Date(windowBounds(now, days).priorFrom).toISOString();
    const [arrivals, door, verified, mail, credits] = await Promise.all([
      this.readArrivals(house, providerId, since),
      this.readDoor(house, since),
      this.readVerified(house, providerId, since),
      this.readMail(house, providerId, since),
      this.readCredits(house, since),
    ]);
    const agreedLines: RegisterRead<AgreedLineRow> = verified.ok
      ? await this.readAgreedLines(
          house,
          verified.rows.map((r) => r.id),
        )
      : { ok: true, rows: [], collected: true };
    return { arrivals, door, verified, agreedLines, mail, credits };
  }

  private async readArrivals(
    house: string,
    providerId: string | null,
    since: string,
  ): Promise<RegisterRead<OrderArrivalRow>> {
    const rows = await this.readAll<OrderArrivalRow>(() => {
      let q = this.client()
        .from("procurement_orders")
        .select(
          "id, order_number, provider_id, status, expected_delivery_date, delivered_at",
        )
        .eq("restaurant_id", house)
        .gte("delivered_at", since);
      if (providerId) q = q.eq("provider_id", providerId);
      return q.order("id", { ascending: true });
    });
    if (!rows.ok) return rows;
    // Orders placed and NOT landed whose expected date falls in the windows.
    // The on-time figure counts arrivals only (the built rule), so without
    // these a vendor holding three orders weeks past their date would read
    // "5 of 5 on time" — its non-deliveries absent, and absence read as health.
    // They are listed as open beside the figure, never counted into it.
    const outstanding = await this.readAll<OrderArrivalRow>(() => {
      let q = this.client()
        .from("procurement_orders")
        .select(
          "id, order_number, provider_id, status, expected_delivery_date, delivered_at",
        )
        .eq("restaurant_id", house)
        .in("status", [...ORDER_OPEN_WITH_VENDOR_STATUSES])
        .gte("expected_delivery_date", since.slice(0, 10));
      if (providerId) q = q.eq("provider_id", providerId);
      return q.order("id", { ascending: true });
    });
    if (!outstanding.ok) return outstanding;
    const merged = new Map<string, OrderArrivalRow>();
    for (const r of [...rows.rows, ...outstanding.rows]) merged.set(r.id, r);
    const collected = await this.anyRow(() =>
      this.client()
        .from("procurement_orders")
        .select("id")
        .eq("restaurant_id", house)
        .not("expected_delivery_date", "is", null),
    );
    if (!collected.ok) return collected;
    return { ok: true, rows: [...merged.values()], collected: collected.any };
  }

  private async readDoor(
    house: string,
    since: string,
  ): Promise<
    RegisterRead<
      ReceiptEventRow & {
        provider_id: string | null;
        order_number: string | null;
      }
    >
  > {
    const events = await this.readAll<ReceiptEventRow>(() =>
      this.client()
        .from("procurement_receipt_events")
        .select(
          "id, order_id, stage, outcome, refusal_reason, rejected_qty, damage_photo_path, occurred_at",
        )
        .eq("restaurant_id", house)
        .gte("occurred_at", since)
        .order("id", { ascending: true }),
    );
    if (!events.ok) return events;
    // The event names its order; the order names its vendor. The order read is
    // house-scoped too — an event can never borrow another house's vendor.
    const ids = [
      ...new Set(
        events.rows.map((e) => e.order_id).filter((x): x is string => !!x),
      ),
    ];
    const orders = new Map<
      string,
      { provider_id: string | null; order_number: string | null }
    >();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const { data, error } = await this.client()
        .from("procurement_orders")
        .select("id, order_number, provider_id")
        .eq("restaurant_id", house)
        .in("id", chunk);
      if (error)
        return {
          ok: false,
          reason: `the orders behind the door records did not answer: ${reasonOf(error)}`,
        };
      for (const o of data ?? [])
        orders.set((o as any).id, {
          provider_id: (o as any).provider_id ?? null,
          order_number: (o as any).order_number ?? null,
        });
    }
    const collected = await this.anyRow(() =>
      this.client()
        .from("procurement_receipt_events")
        .select("id")
        .eq("restaurant_id", house),
    );
    if (!collected.ok) return collected;
    return {
      ok: true,
      collected: collected.any,
      rows: events.rows.map((e) => ({
        ...e,
        provider_id: e.order_id
          ? (orders.get(e.order_id)?.provider_id ?? null)
          : null,
        order_number: e.order_id
          ? (orders.get(e.order_id)?.order_number ?? null)
          : null,
      })),
    };
  }

  private async readVerified(
    house: string,
    providerId: string | null,
    since: string,
  ): Promise<RegisterRead<VerifiedLineRow>> {
    const rows = await this.readAll<VerifiedLineRow>(() => {
      let q = this.client()
        .from("procurement_orders")
        .select(
          "id, order_number, provider_id, match_verified_at, match_status, price_verified, invoice_unit_price, final_price, negotiated_price, quoted_price",
        )
        .eq("restaurant_id", house)
        .gte("match_verified_at", since);
      if (providerId) q = q.eq("provider_id", providerId);
      return q.order("id", { ascending: true });
    });
    if (!rows.ok) return rows;
    const collected = await this.anyRow(() =>
      this.client()
        .from("procurement_orders")
        .select("id")
        .eq("restaurant_id", house)
        .not("match_verified_at", "is", null),
    );
    if (!collected.ok) return collected;
    return { ok: true, rows: rows.rows, collected: collected.any };
  }

  private async readAgreedLines(
    house: string,
    orderIds: string[],
  ): Promise<RegisterRead<AgreedLineRow>> {
    const rows: AgreedLineRow[] = [];
    for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
      const chunk = orderIds.slice(i, i + IN_CHUNK);
      const { data, error } = await this.client()
        .from("procurement_order_items")
        .select(
          "order_id, price_uom, price_pack_size, final_unit_price, currency",
        )
        .eq("restaurant_id", house)
        .in("order_id", chunk);
      if (error) return { ok: false, reason: reasonOf(error) };
      rows.push(...((data ?? []) as AgreedLineRow[]));
    }
    return { ok: true, rows, collected: true };
  }

  private async readMail(
    house: string,
    providerId: string | null,
    since: string,
  ): Promise<RegisterRead<ConversationRow>> {
    const COLS =
      "id, provider_id, direction, status, sent_at, received_at, thread_key, gmail_thread_id, thread_id, detected_sentiment";
    const byColumn = async (col: "sent_at" | "received_at") =>
      this.readAll<ConversationRow>(() => {
        let q = this.client()
          .from("procurement_conversations")
          .select(COLS)
          .eq("restaurant_id", house)
          .gte(col, since);
        if (providerId) q = q.eq("provider_id", providerId);
        return q.order("id", { ascending: true });
      });
    const [sent, received] = await Promise.all([
      byColumn("sent_at"),
      byColumn("received_at"),
    ]);
    if (!sent.ok) return sent;
    if (!received.ok) return received;
    const merged = new Map<string, ConversationRow>();
    for (const r of [...sent.rows, ...received.rows]) merged.set(r.id, r);
    const collected = await this.anyRow(() =>
      this.client()
        .from("procurement_conversations")
        .select("id")
        .eq("restaurant_id", house),
    );
    if (!collected.ok) return collected;
    return { ok: true, rows: [...merged.values()], collected: collected.any };
  }

  /**
   * Claims opened in the window, ATTRIBUTED and CURRENCIED from their orders.
   *
   * `openCreditClaim` — the only writer — records neither `provider_id` nor
   * `currency`, and `procurement_credits.currency` defaults to 'USD'. Filtering
   * claims by `provider_id` would therefore show no vendor any claim, and
   * printing the column would call a Turkish house's lira dollars. So every
   * claim of the house in the window is read (no vendor filter), its vendor is
   * the claim's own `provider_id` or else its order's, and its money is in the
   * currency its ORDER states — null, printed as "not recorded", when the order
   * states none. The order read is house-scoped like every other: a claim can
   * never borrow another house's order to find a vendor.
   */
  private async readCredits(
    house: string,
    since: string,
  ): Promise<RegisterRead<CreditRow>> {
    const rows = await this.readAll<CreditRow>(() =>
      this.client()
        .from("procurement_credits")
        .select(
          "id, provider_id, order_id, reason, claimed_amount, credited_amount, state, opened_at, promised_at",
        )
        .eq("restaurant_id", house)
        .gte("opened_at", since)
        .order("id", { ascending: true }),
    );
    if (!rows.ok) return rows;
    const ids = [
      ...new Set(
        rows.rows.map((c) => c.order_id).filter((x): x is string => !!x),
      ),
    ];
    const orders = new Map<
      string,
      { provider_id: string | null; currency: string | null }
    >();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const { data, error } = await this.client()
        .from("procurement_orders")
        .select("id, provider_id, currency")
        .eq("restaurant_id", house)
        .in("id", chunk);
      if (error)
        return {
          ok: false,
          reason: `the orders behind the claims did not answer: ${reasonOf(error)}`,
        };
      for (const o of data ?? [])
        orders.set((o as any).id, {
          provider_id: (o as any).provider_id ?? null,
          currency: (o as any).currency ?? null,
        });
    }
    const collected = await this.anyRow(() =>
      this.client()
        .from("procurement_credits")
        .select("id")
        .eq("restaurant_id", house),
    );
    if (!collected.ok) return collected;
    return {
      ok: true,
      collected: collected.any,
      rows: rows.rows.map((c) => {
        const order = c.order_id ? orders.get(c.order_id) : undefined;
        return {
          ...c,
          provider_id: c.provider_id ?? order?.provider_id ?? null,
          currency: order?.currency ?? null,
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Reading honestly
  // -------------------------------------------------------------------------

  /**
   * Every page, or a refusal. PostgREST caps an unranged select at its
   * max-rows; a register that silently stopped at the cap would score the
   * first thousand deliveries as if they were all of them.
   */
  private async readAll<T>(build: () => any): Promise<ReadRows<T>> {
    const rows: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE;
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) return { ok: false, reason: reasonOf(error) };
      const got = (data ?? []) as T[];
      rows.push(...got);
      if (got.length < PAGE) return { ok: true, rows };
    }
    return {
      ok: false,
      reason: `more than ${PAGE * MAX_PAGES} rows in the window — too many to read in one answer, so none is scored`,
    };
  }

  /** Has this house EVER held such a record? The line between "not collected" and "too few". */
  private async anyRow(
    build: () => any,
  ): Promise<{ ok: true; any: boolean } | { ok: false; reason: string }> {
    const { data, error } = await build().limit(1);
    if (error) return { ok: false, reason: reasonOf(error) };
    return { ok: true, any: (data ?? []).length > 0 };
  }
}
