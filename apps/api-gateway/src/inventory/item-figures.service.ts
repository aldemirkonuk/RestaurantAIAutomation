import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { readPeople } from "../pricing/price-locks";
import { readHouseItem } from "./item-used-in.service";

/** Whether this caller sees money: owner/manager, anyone else, or a role read that failed. */
export type MoneyView = "shown" | "staff" | "unread";

const DAY = 86_400_000;
const MONEY_HIDDEN: Record<Exclude<MoneyView, "shown">, string> = {
  staff: "Money is shown to owners and managers.",
  unread: "Your role in this house could not be read, so money is not shown.",
};

/**
 * The cost trend: one point per delivery whose price was SETTLED, from
 * `inventory_lot_revaluations` (r35, the data-truth call r28-r32 left open).
 *
 * Why that table and nothing else. What a delivery finally cost is written in
 * exactly two places: `finalise_delivery_cost` (a door delivery VERIFIED) and
 * `revalue_lot` (an order's invoice verified, or a cost corrected). Both
 * append a revaluation row holding the new unit cost, and the row outlives
 * its lot (lot_id is SET NULL), so a delivery that has since sold out keeps
 * its point. Rejected, as before (test e):
 *   - `inventory_lots`: a lot is deleted once used up and `transfer_stock`
 *     re-inserts a moved lot dated the day of the move, so a trend from lots
 *     is whichever deliveries happen to survive;
 *   - the ledger's `purchase` row: written at the door with no cost
 *     (receiving.service) and never restated when the price is settled.
 * What this does NOT see, said in the source: a delivery whose cost was
 * booked final at the door (nothing settled it later), and, until the
 * settle-sold-bottles fix lands, one that sold out before its price was
 * settled. An estimate or a sample price is not a settled price and is left
 * out.
 *
 * One delivery is one point: rows are grouped by the order they came from;
 * rows with no order are grouped by the transaction that wrote them
 * (`created_at` is the transaction's start, the same for every lot one
 * settle touched). The point carries the delivery's NEWEST settled cost and
 * is dated when its price was FIRST settled, so a later correction moves the
 * point's price, not its place. `receivedAt` keeps the field name the drawer
 * already reads.
 */
const TREND_ROWS = 200;
const TREND_POINTS = 24;
const TREND_SETTLED = ["invoice", "manual"] as const;

type TrendRow = {
  source_order_id: string | null;
  new_unit_cost: unknown;
  new_cost_provenance: string;
  created_at: string;
};

export function costTrendFrom(rows: TrendRow[]): {
  points: Array<{ receivedAt: string; unitCost: number }>;
  changePct: number | null;
} {
  const byDelivery = new Map<string, { first: string; newest: string; unitCost: number }>();
  for (const r of rows) {
    const cost = num(r.new_unit_cost);
    if (cost === null || !Number.isFinite(cost)) continue;
    if (!(TREND_SETTLED as readonly string[]).includes(r.new_cost_provenance)) continue;
    const key = r.source_order_id ? `order:${r.source_order_id}` : `at:${r.created_at}`;
    const at = new Date(r.created_at).getTime();
    const seen = byDelivery.get(key);
    if (!seen) {
      byDelivery.set(key, { first: r.created_at, newest: r.created_at, unitCost: cost });
      continue;
    }
    if (at < new Date(seen.first).getTime()) seen.first = r.created_at;
    if (at > new Date(seen.newest).getTime()) {
      seen.newest = r.created_at;
      seen.unitCost = cost;
    }
  }
  const points = [...byDelivery.values()]
    .sort((a, b) => new Date(a.first).getTime() - new Date(b.first).getTime())
    .slice(-TREND_POINTS)
    .map((d) => ({ receivedAt: d.first, unitCost: d.unitCost }));
  const first = points[0]?.unitCost;
  const last = points[points.length - 1]?.unitCost;
  const changePct =
    points.length >= 2 && first !== undefined && last !== undefined && first > 0
      ? Math.round(((last - first) / first) * 1000) / 10
      : null;
  return { points, changePct };
}

const TREND_LEAVES_OUT =
  " A delivery whose cost was booked final at the door, with nothing settled later, is not in it.";

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Start a read now; a throw while building it becomes its rejection, so no
 *  read already in flight is left rejected with nobody listening. */
const start = <T>(read: () => PromiseLike<T> | T): Promise<T> => {
  try {
    return Promise.resolve(read());
  } catch (e) {
    return Promise.reject(e);
  }
};

/**
 * The drawer's own figures (proposal K1-K10). On hand, WAC, value, velocity
 * and days of cover are NOT here: the list row carries them from
 * inventory_lot_rollup / inventory_analytics, the one source (K9).
 */
@Injectable()
export class ItemFiguresService {
  constructor(private readonly db: DatabaseService) {}

  async figures(restaurantId: string, itemId: string, view: MoneyView, now = new Date()) {
    const client = this.db.supabase;
    const seesMoney = view === "shown";
    const since30 = new Date(now.getTime() - 30 * DAY).toISOString();

    // Every read starts at once: the drawer waits for the slowest one, not
    // the sum of five. Each read is scoped to the house on its own, and the
    // house check is still settled first, so another house's item is
    // refused with nothing returned.
    const houseRead = start(() => readHouseItem(client, restaurantId, itemId));
    // Current WAC: read only for a caller who may see money.
    const wacRead = seesMoney
      ? start(() =>
          client
            .from("inventory_lot_rollup")
            .select("wac")
            .eq("inventory_id", itemId)
            .eq("restaurant_id", restaurantId)
            .maybeSingle(),
        )
      : null;
    // ── waste vs given (K10: never added together) ──
    const txRead = start(() =>
      client
        .from("inventory_transactions")
        .select("transaction_type, quantity_change, unit_cost")
        .eq("inventory_id", itemId)
        .eq("restaurant_id", restaurantId)
        .eq("stock_type", "live")
        .in("transaction_type", ["waste", "comp"])
        .gte("transaction_date", since30),
    );
    // ── count gap: the last 5 counts, then who counted them ──
    const countsRead = start(() =>
      client
        .from("stock_counts")
        .select("counted_at, expected_qty, counted_qty, variance_qty, counted_by")
        .eq("inventory_id", itemId)
        .eq("restaurant_id", restaurantId)
        .order("counted_at", { ascending: false })
        .limit(5),
    ).then(async (counts) =>
      counts.error
        ? { counts, people: null }
        : {
            counts,
            people: await readPeople(
              client,
              ((counts.data ?? []) as Array<Record<string, any>>).map((r) => r.counted_by),
            ),
          },
    );
    // ── what each settled delivery cost: money, so read only for those who see it ──
    const trendRead = seesMoney
      ? start(() =>
          client
            .from("inventory_lot_revaluations")
            .select("source_order_id, new_unit_cost, new_cost_provenance, created_at")
            .eq("inventory_id", itemId)
            .eq("restaurant_id", restaurantId)
            .in("new_cost_provenance", [...TREND_SETTLED])
            .order("created_at", { ascending: false })
            .limit(TREND_ROWS),
        )
      : null;
    const settled = await Promise.allSettled([houseRead, wacRead, txRead, countsRead, trendRead]);
    for (const r of settled) if (r.status === "rejected") throw r.reason;
    const [, wacR, tx, { counts, people: countPeople }, trendR] = settled.map(
      (r) => (r as PromiseFulfilledResult<any>).value,
    );

    let wac: number | null = null;
    let wacError: string | null = null;
    if (wacR) {
      if (wacR.error) wacError = wacR.error.message;
      else wac = num(wacR.data?.wac);
    }
    const noWac = wacError
      ? `the average cost could not be read (${wacError})`
      : "no received lot of this item has a cost yet";

    let waste;
    if (tx.error) {
      waste = {
        readable: false,
        qty30d: null,
        given30d: null,
        value30d: null,
        source: `Waste and given-away stock could not be read (${tx.error.message}).`,
      };
    } else {
      const rows = (tx.data ?? []) as Array<Record<string, any>>;
      const wasted = rows.filter((r) => r.transaction_type === "waste");
      const sum = (rs: typeof rows) =>
        rs.reduce((s, r) => s + Math.abs(Number(r.quantity_change)), 0);
      let value30d: number | null = null;
      let note = "";
      if (!seesMoney) note = ` ${MONEY_HIDDEN[view as "staff" | "unread"]}`;
      else if (wasted.some((r) => num(r.unit_cost) === null) && wac === null) {
        note = ` Its value is not shown: a wasted line has no cost and ${noWac}.`;
      } else {
        value30d = round2(
          wasted.reduce(
            (s, r) => s + Math.abs(Number(r.quantity_change)) * (num(r.unit_cost) ?? (wac as number)),
            0,
          ),
        );
      }
      waste = {
        readable: true,
        qty30d: sum(wasted),
        given30d: sum(rows.filter((r) => r.transaction_type === "comp")),
        value30d,
        source:
          "Wasted and given-away stock in the last 30 days, from the stock ledger, kept apart." +
          (seesMoney && value30d !== null
            ? " Value uses each line's cost, else the current average cost."
            : note),
      };
    }

    let countGap;
    if (counts.error) {
      countGap = {
        readable: false,
        last: null,
        source: `The counts could not be read (${counts.error.message}).`,
      };
    } else {
      const rows = (counts.data ?? []) as Array<Record<string, any>>;
      const { people, error: peopleError } = countPeople;
      const last = rows.map((r) => ({
        countedAt: r.counted_at,
        expected: r.expected_qty,
        counted: r.counted_qty,
        variance: r.variance_qty,
        by: people.get(r.counted_by)?.name ?? null,
        money: seesMoney && wac !== null ? round2(r.variance_qty * wac) : null,
      }));
      const moneyNote = !seesMoney
        ? MONEY_HIDDEN[view as "staff" | "unread"]
        : wac === null
          ? `Money is not shown: ${noWac}.`
          : "Money is the gap at the current average cost.";
      const parts = rows.length
        ? ["The last 5 counts, newest first.", peopleError ? "Who counted could not be read." : "", moneyNote]
        : ["Never counted."];
      countGap = { readable: true, last, source: parts.filter(Boolean).join(" ") };
    }

    let costTrend;
    if (!trendR) {
      costTrend = { readable: true, points: null, changePct: null, source: MONEY_HIDDEN[view as "staff" | "unread"] };
    } else if (trendR.error) {
      costTrend = {
        readable: false,
        points: null,
        changePct: null,
        source: `What each delivery cost could not be read (${trendR.error.message}).`,
      };
    } else {
      const rows = (trendR.data ?? []) as TrendRow[];
      const { points, changePct } = costTrendFrom(rows);
      const capped = rows.length >= TREND_ROWS ? ` Only the newest ${TREND_ROWS} settled lots were read.` : "";
      costTrend = {
        readable: true,
        points,
        changePct,
        source: points.length
          ? `Each point is one delivery's settled price per unit, from its invoice or as set by hand, dated when it was settled; the last ${TREND_POINTS} at most.` +
            capped +
            TREND_LEAVES_OUT
          : "No delivery of this item has a settled price yet: a price is settled when its delivery is verified against the invoice." +
            TREND_LEAVES_OUT,
      };
    }

    return { waste, countGap, costTrend };
  }
}
