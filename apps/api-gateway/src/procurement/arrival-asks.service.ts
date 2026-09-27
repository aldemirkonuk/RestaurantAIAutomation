import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { houseFrame } from "../common/house-frame";
import { DAY_MS, deadlineOf } from "./delivery-deadline";
import { ORDER_OPEN_WITH_VENDOR_STATUSES } from "./order-status";
import {
  NOT_YET,
  overdueStanding,
  INCOMPLETE_AFTER_DAYS,
} from "./overdue-order";
import {
  ARRIVAL_ANSWERS_TABLE,
  readOverdueContext,
} from "./overdue-order-reads";
import {
  ArrivalAsk,
  AskOrderRow,
  IncompleteOrder,
  askFor,
  incompleteFor,
  mayAnswerArrival,
} from "./arrival-asks";

/**
 * The reads and the one write behind "Did it arrive?" and the Incomplete orders
 * register (ADR 0207, round 3). Rule: `overdue-order.ts`. Shape and audience:
 * `arrival-asks.ts`.
 *
 * EVERY READ NAMES THE HOUSE (`.eq("restaurant_id", house)`; the house record
 * by `.eq("id", house)`), and the house is the token's. The service-role client
 * bypasses RLS, so those clauses are the tenant boundary.
 *
 * A FAILED READ IS AN ERROR: the orders, the vendor names, the answers or the
 * credits failing is a 503 with the reason — never "nothing is overdue".
 *
 * PERMISSION IN CODE: `mayAnswerArrival` decides who is asked and who may
 * answer; the write is refused with 403 for anyone else, and the answer row
 * itself names who answered and when (the record is the audit).
 */

const PAGE = 1000;
const MAX_PAGES = 10;

export const ASK_COPY = {
  notForYou:
    "\"Did it arrive?\" is asked of this house's owners and managers (and, once the house names a receiving area, of that area's people).",
  houseRecord: (r: string) =>
    `This house's own record could not be read (${r}).`,
  noHouseRecord: "This house has no record here.",
  ordersFailed: (r: string) => `The orders book did not answer (${r}).`,
  vendorsFailed: (r: string) => `The vendor book did not answer (${r}).`,
  noSuchOrder: (id: string) => `No order ${id} in this house.`,
  notOverdue:
    "This order is not past its expected date and not received, so there is nothing to answer. Nothing was recorded.",
  incomplete: `This order is more than ${INCOMPLETE_AFTER_DAYS} days past its expected date and is in Incomplete orders under Documents & Reports: receive it, cancel it, or close it with a credit. Nothing was recorded.`,
  writeFailed: "The answer could not be recorded. Nothing was changed.",
  tooMany: `More than ${PAGE * MAX_PAGES} orders are out with vendors; the list cannot be read whole.`,
} as const;

function reasonOf(
  error: { code?: string; message?: string } | null | undefined,
): string {
  if (!error) return "no reason given";
  return (
    [error.code, error.message].filter(Boolean).join(" ") || "no reason given"
  );
}

export interface ArrivalAsksReadout {
  /** Whether the caller is one of the people asked. False is a rule, not a failure. */
  forYou: boolean;
  sentence: string | null;
  asks: ArrivalAsk[];
}

export interface IncompleteOrdersReadout {
  forYou: boolean;
  sentence: string | null;
  orders: IncompleteOrder[];
  /** Days past the expected date after which an order is listed here. */
  afterDays: number;
}

@Injectable()
export class ArrivalAsksService {
  private readonly logger = new Logger(ArrivalAsksService.name);

  clock: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  private client() {
    return this.db.getClient();
  }

  /**
   * The receiving area's members, when the house names one. The areas model is
   * not on this branch (ADR 0218, PR #441), so there is none to read and the
   * ask reaches owners and managers only.
   */
  private async receivingAreaMembers(_house: string): Promise<string[] | null> {
    return null;
  }

  private async mayAnswer(house: string, userId: string): Promise<boolean> {
    const role = await this.organizations.resolveRestaurantRole(userId, house);
    return mayAnswerArrival(
      role,
      userId,
      await this.receivingAreaMembers(house),
    );
  }

  /** The standing of every order this house has out with a vendor. */
  private async standings(house: string) {
    const now = this.clock().getTime();
    const { data: rec, error: recErr } = await this.client()
      .from("restaurants")
      .select("id, timezone, country")
      .eq("id", house)
      .maybeSingle();
    if (recErr)
      throw new ServiceUnavailableException(
        ASK_COPY.houseRecord(reasonOf(recErr)),
      );
    if (!rec) throw new NotFoundException(ASK_COPY.noHouseRecord);
    const zone = houseFrame(
      rec as { timezone?: string; country?: string },
    ).zone;

    // Only orders whose expected date can have passed: up to tomorrow in UTC
    // covers every zone's "yesterday".
    const upTo = new Date(now + DAY_MS).toISOString().slice(0, 10);
    const orders: AskOrderRow[] = [];
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES)
        throw new ServiceUnavailableException(ASK_COPY.tooMany);
      const { data, error } = await this.client()
        .from("procurement_orders")
        .select(
          "id, order_number, provider_id, status, expected_delivery_date, total_cost, currency",
        )
        .eq("restaurant_id", house)
        .in("status", [...ORDER_OPEN_WITH_VENDOR_STATUSES])
        .not("expected_delivery_date", "is", null)
        .lte("expected_delivery_date", upTo)
        .order("expected_delivery_date", { ascending: true })
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error)
        throw new ServiceUnavailableException(
          ASK_COPY.ordersFailed(reasonOf(error)),
        );
      const rows = (data ?? []) as (AskOrderRow & { status: string })[];
      orders.push(...rows);
      if (rows.length < PAGE) break;
    }

    const context = await readOverdueContext(
      this.client(),
      house,
      orders.map((o) => o.id),
    );
    if (!context.ok) throw new ServiceUnavailableException(context.reason);

    const names = new Map<string, string>();
    const providerIds = [
      ...new Set(orders.map((o) => o.provider_id).filter(Boolean)),
    ] as string[];
    for (let i = 0; i < providerIds.length; i += 150) {
      const { data, error } = await this.client()
        .from("providers")
        .select("id, name")
        .eq("restaurant_id", house)
        .in("id", providerIds.slice(i, i + 150));
      if (error)
        throw new ServiceUnavailableException(
          ASK_COPY.vendorsFailed(reasonOf(error)),
        );
      for (const p of (data ?? []) as { id: string; name: string | null }[])
        if (p.name) names.set(p.id, p.name);
    }

    return orders.map((o) => {
      const deadline = deadlineOf(o.expected_delivery_date, zone);
      const standing = overdueStanding({
        status: (o as { status?: string }).status ?? null,
        expectedDate: o.expected_delivery_date,
        deadline,
        nowMs: now,
        answers: context.answers.get(o.id) ?? [],
        closedWithCredit: context.closedWithCredit.has(o.id),
      });
      return {
        order: o,
        providerName: o.provider_id ? (names.get(o.provider_id) ?? null) : null,
        standing,
      };
    });
  }

  async asks(house: string, userId: string): Promise<ArrivalAsksReadout> {
    if (!(await this.mayAnswer(house, userId)))
      return { forYou: false, sentence: ASK_COPY.notForYou, asks: [] };
    const all = await this.standings(house);
    const asks = all
      .map((s) => askFor(s.order, s.providerName, s.standing))
      .filter((a): a is ArrivalAsk => a !== null)
      // The question first, then the orders already said to be late.
      .sort(
        (a, b) =>
          (a.standing === "unconfirmed" ? 0 : 1) -
            (b.standing === "unconfirmed" ? 0 : 1) || b.daysPast - a.daysPast,
      );
    return { forYou: true, sentence: null, asks };
  }

  async incomplete(
    house: string,
    userId: string,
  ): Promise<IncompleteOrdersReadout> {
    if (!(await this.mayAnswer(house, userId)))
      return {
        forYou: false,
        sentence: ASK_COPY.notForYou,
        orders: [],
        afterDays: INCOMPLETE_AFTER_DAYS,
      };
    const all = await this.standings(house);
    const orders = all
      .map((s) => incompleteFor(s.order, s.providerName, s.standing))
      .filter((o): o is IncompleteOrder => o !== null)
      .sort((a, b) => b.daysPast - a.daysPast);
    return {
      forYou: true,
      sentence: null,
      orders,
      afterDays: INCOMPLETE_AFTER_DAYS,
    };
  }

  /** "Not yet" for one order — the one choice this act records itself. */
  async notYet(
    house: string,
    userId: string,
    orderId: string,
  ): Promise<ArrivalAsk> {
    if (!(await this.mayAnswer(house, userId)))
      throw new ForbiddenException(ASK_COPY.notForYou);
    const all = await this.standings(house);
    const found = all.find((s) => s.order.id === orderId);
    if (!found) {
      // Not among this house's orders out with a vendor and due: either not
      // this house's, not placed, received, cancelled, or not yet due.
      const { data, error } = await this.client()
        .from("procurement_orders")
        .select("id")
        .eq("id", orderId)
        .eq("restaurant_id", house)
        .maybeSingle();
      if (error)
        throw new ServiceUnavailableException(
          ASK_COPY.ordersFailed(reasonOf(error)),
        );
      if (!data) throw new NotFoundException(ASK_COPY.noSuchOrder(orderId));
      throw new ConflictException(ASK_COPY.notOverdue);
    }
    const kind = found.standing?.kind;
    if (kind === "incomplete") throw new ConflictException(ASK_COPY.incomplete);
    if (kind !== "unconfirmed" && kind !== "confirmed_late")
      throw new ConflictException(ASK_COPY.notOverdue);

    const answeredAt = this.clock().toISOString();
    const { error } = await this.client()
      .from(ARRIVAL_ANSWERS_TABLE)
      .insert({
        restaurant_id: house,
        order_id: orderId,
        answer: NOT_YET,
        expected_date: String(found.order.expected_delivery_date).slice(0, 10),
        answered_by: userId,
        answered_at: answeredAt,
      });
    if (error) {
      this.logger.error(`arrival answer write failed: ${reasonOf(error)}`);
      throw new ServiceUnavailableException(ASK_COPY.writeFailed);
    }
    const ask = askFor(found.order, found.providerName, {
      kind: "confirmed_late",
      days:
        found.standing && "days" in found.standing ? found.standing.days : 0,
      answeredAt,
    });
    // A confirmed_late standing always yields an ask; the guard keeps the type honest.
    if (!ask) throw new ServiceUnavailableException(ASK_COPY.writeFailed);
    return ask;
  }
}
