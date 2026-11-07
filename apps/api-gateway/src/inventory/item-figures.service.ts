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

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

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
    await readHouseItem(client, restaurantId, itemId);
    const seesMoney = view === "shown";

    // Current WAC: read only for a caller who may see money.
    let wac: number | null = null;
    let wacError: string | null = null;
    if (seesMoney) {
      const r = await client
        .from("inventory_lot_rollup")
        .select("wac")
        .eq("inventory_id", itemId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (r.error) wacError = r.error.message;
      else wac = num(r.data?.wac);
    }
    const noWac = wacError
      ? `the average cost could not be read (${wacError})`
      : "no received lot of this item has a cost yet";

    // ── waste vs given (K10: never added together) ──
    const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
    const tx = await client
      .from("inventory_transactions")
      .select("transaction_type, quantity_change, unit_cost")
      .eq("inventory_id", itemId)
      .eq("restaurant_id", restaurantId)
      .eq("stock_type", "live")
      .in("transaction_type", ["waste", "comp"])
      .gte("transaction_date", since30);
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

    // ── count gap: the last 5 counts ──
    const counts = await client
      .from("stock_counts")
      .select("counted_at, expected_qty, counted_qty, variance_qty, counted_by")
      .eq("inventory_id", itemId)
      .eq("restaurant_id", restaurantId)
      .order("counted_at", { ascending: false })
      .limit(5);
    let countGap;
    if (counts.error) {
      countGap = {
        readable: false,
        last: null,
        source: `The counts could not be read (${counts.error.message}).`,
      };
    } else {
      const rows = (counts.data ?? []) as Array<Record<string, any>>;
      const { people, error: peopleError } = await readPeople(
        client,
        rows.map((r) => r.counted_by),
      );
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

    return { waste, countGap, costTrend: await this.costTrend(restaurantId, itemId, view, now) };
  }

  /** What each receipt cost, last 90 days, sample lots excluded (as the WAC excludes them). */
  private async costTrend(restaurantId: string, itemId: string, view: MoneyView, now: Date) {
    if (view !== "shown") {
      return { readable: true, points: null, changePct: null, source: MONEY_HIDDEN[view].replace("Money is", "Cost is") };
    }
    const lots = await this.db.supabase
      .from("inventory_lots")
      .select("received_at, unit_cost")
      .eq("inventory_id", itemId)
      .eq("restaurant_id", restaurantId)
      .not("unit_cost", "is", null)
      .neq("cost_provenance", "sample")
      .gte("received_at", new Date(now.getTime() - 90 * DAY).toISOString())
      .order("received_at", { ascending: true });
    if (lots.error) {
      return {
        readable: false,
        points: null,
        changePct: null,
        source: `What each delivery cost could not be read (${lots.error.message}).`,
      };
    }
    const points = ((lots.data ?? []) as Array<Record<string, any>>).map((r) => ({
      receivedAt: r.received_at as string,
      unitCost: Number(r.unit_cost),
    }));
    const first = points[0]?.unitCost;
    const last = points[points.length - 1]?.unitCost;
    const changePct =
      points.length >= 2 && first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null;
    return {
      readable: true,
      points,
      changePct,
      source:
        points.length < 2
          ? "Not enough receipts in the last 90 days to show a change."
          : "What each delivery cost per unit in the last 90 days, first to last.",
    };
  }
}
