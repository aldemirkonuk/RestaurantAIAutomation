/**
 * "Logged at door" — a truck that came with no order on file (F-669, founder
 * S198; ADR 0103 D5 as amended 2026-10-11).
 *
 * Staff at the door tap New delivery → No order on file, say which vendor and
 * wine and how many came, answer "When was this ordered?" (Today / Yesterday /
 * Don't know, the last preselected so it never blocks receiving), and tap Add
 * to the books. That one tap does two things, in this order:
 *
 *   1. it writes the order, already delivered, with `source = 'retroactive'`
 *      (the `alreadyFulfilled` path of `createOrder`: no dedup merge, no AI
 *      draft to the vendor, `placed_on_stated` from the answer);
 *   2. it counts the delivery into stock through the ordinary door receipt,
 *      exactly as a truck on an order is counted.
 *
 * So the order is in spend and the bottles are on the shelf, and every
 * vendor figure that differences a placement time (lead time, on-time, fill
 * rate) skips it by its source. No price is asked: the door shows none (the
 * receiving controller's rule), so the order's money is what the paper says
 * when a manager checks it at the desk (F-700), as for any order placed with
 * no price.
 *
 * ONE KEY, BOTH WRITES. The phone sends one id for the tap. It is the order's
 * `placement_id` (the column that says "these were one placement", F-731) and
 * the door receipt's idempotency key. A retry after a dropped answer finds
 * the order it already wrote and the receipt it already booked, so the same
 * tap never books a second order or a second count.
 *
 * THE KEY BINDS TO WHAT WAS SAID (F-1501). A key that comes back with a
 * different vendor, wine or bottle count is not a retry: the order it wrote
 * is compared with the request and a mismatch is refused in words (409), so
 * the old truck is never booked under the new answers. A 409 from the
 * receipt is the same kind of answer, and is never told as "did not reach
 * stock": the first count did reach it.
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { DoorReceiptInput, DoorReceiptResult } from "./receiving.service";

/** The answers to "When was this ordered?". */
export const ORDERED_ON_ANSWERS = ["today", "yesterday", "unknown"] as const;
export type OrderedOnAnswer = (typeof ORDERED_ON_ANSWERS)[number];

/** The units the door sheet offers. A case states its bottles. */
export const LOGGED_AT_DOOR_UNITS = ["case", "bottle"] as const;
export type LoggedAtDoorUnit = (typeof LOGGED_AT_DOOR_UNITS)[number];

const DAY_MS = 86_400_000;

function dayShift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The stated order day, `YYYY-MM-DD`, or null for "Don't know".
 *
 * "Today" is the PHONE's day (`phoneToday`): the house's own calendar, and
 * stamped where the tap happened. It must lie within a day of the server's
 * UTC day, which covers every time zone; anything else is a phone clock that
 * is wrong, and a wrong day is refused rather than written down as a fact.
 */
export function statedOrderDay(
  answer: OrderedOnAnswer,
  phoneToday: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (answer === "unknown") return null;
  const day = typeof phoneToday === "string" ? phoneToday.trim() : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? Date.parse(`${day}T00:00:00Z`)
    : NaN;
  const utcToday = now.toISOString().slice(0, 10);
  const off =
    Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day
      ? Infinity
      : Math.abs(parsed - Date.parse(`${utcToday}T00:00:00Z`)) / DAY_MS;
  if (off > 1) {
    throw new BadRequestException({
      reason: "phone_day_unreadable",
      message:
        "This phone's date could not be trusted, so the order day was not written. " +
        "Nothing was booked. Choose Don't know, or set the phone's date and try again.",
    });
  }
  return answer === "today" ? day : dayShift(day, -1);
}

export interface LogAtDoorInput {
  restaurantId: string;
  userId: string;
  role: string | null;
  /** The tap's id: the order's placement and the receipt's key. */
  key: string;
  providerId: string;
  inventoryId: string;
  quantity: number;
  unit: LoggedAtDoorUnit;
  bottlesPerCase: number | null;
  orderedOn: OrderedOnAnswer;
  phoneToday: string | null;
  clientCapturedAt: string | null;
  signedByInitials: string | null;
}

/** The order a tap already wrote, with what it was written for. */
export interface LoggedOrder {
  id: string;
  orderNumber: string | null;
  providerId?: string | null;
  inventoryId?: string | null;
  bottlesTotal?: number | string | null;
}

export interface LogAtDoorDeps {
  /** The order this tap already wrote, if a first attempt got that far. */
  findLogged: (
    restaurantId: string,
    key: string,
  ) => Promise<LoggedOrder | null>;
  createOrder: (
    restaurantId: string,
    userId: string,
    dto: {
      inventoryId: string;
      providerId: string;
      quantity: number;
      unitType: LoggedAtDoorUnit;
      bottlesPerUnit?: number;
      placementId: string;
      managerNotes: string;
    },
    provenance: {
      source: "retroactive";
      alreadyFulfilled: {
        deliveredAt: null;
        invoiceTotal: null;
        placedOnStated: string | null;
      };
    },
  ) => Promise<{ id: string; orderNumber?: string | null }>;
  recordDoorReceipt: (input: DoorReceiptInput) => Promise<DoorReceiptResult>;
}

export interface LogAtDoorResult {
  orderId: string;
  orderNumber: string | null;
  loggedAtDoor: true;
  placedOnStated: string | null;
  /** True when this tap's order was already written by an earlier attempt. */
  orderAlreadyWritten: boolean;
  receipt: DoorReceiptResult;
}

export async function logDeliveryAtDoor(
  deps: LogAtDoorDeps,
  input: LogAtDoorInput,
): Promise<LogAtDoorResult> {
  const placedOnStated = statedOrderDay(input.orderedOn, input.phoneToday);
  if (
    input.unit === "case" &&
    !(input.bottlesPerCase && input.bottlesPerCase > 0)
  ) {
    throw new BadRequestException({
      reason: "case_needs_bottles",
      message:
        "Say how many bottles are in each case, or count the bottles instead. Nothing was booked.",
    });
  }

  let existing: LoggedOrder | null;
  try {
    existing = await deps.findLogged(input.restaurantId, input.key);
  } catch {
    // Not knowing whether this tap already wrote an order is not "it did
    // not": writing on would book the same truck twice.
    throw new ServiceUnavailableException({
      reason: "logged_order_unreadable",
      message:
        "We could not check whether this delivery was already added, so nothing was booked. Try again in a moment.",
    });
  }

  const asOrder = (o: LoggedOrder | null) =>
    o?.orderNumber ? ` as order ${o.orderNumber}` : "";
  if (existing) {
    const bottles =
      input.unit === "case"
        ? input.quantity * (input.bottlesPerCase as number)
        : input.quantity;
    const differs =
      (existing.providerId != null &&
        existing.providerId !== input.providerId) ||
      (existing.inventoryId != null &&
        existing.inventoryId !== input.inventoryId) ||
      (existing.bottlesTotal != null &&
        Number(existing.bottlesTotal) !== bottles);
    if (differs) {
      throw new ConflictException({
        reason: "logged_tap_differs",
        orderId: existing.id,
        message:
          `This delivery was already added to the books${asOrder(existing)} with a different vendor, wine or count, ` +
          "so nothing new was booked. Check that order under Orders before adding this delivery again.",
      });
    }
  }

  const order: { id: string; orderNumber: string | null } = existing
    ? { id: existing.id, orderNumber: existing.orderNumber }
    : await deps
        .createOrder(
          input.restaurantId,
          input.userId,
          {
            inventoryId: input.inventoryId,
            providerId: input.providerId,
            quantity: input.quantity,
            unitType: input.unit,
            ...(input.unit === "case"
              ? { bottlesPerUnit: input.bottlesPerCase as number }
              : {}),
            placementId: input.key,
            managerNotes: "Logged at door: no order on file",
          },
          {
            source: "retroactive",
            alreadyFulfilled: {
              deliveredAt: null,
              invoiceTotal: null,
              placedOnStated,
            },
          },
        )
        .then((o) => ({ id: o.id, orderNumber: o.orderNumber ?? null }));

  let receipt: DoorReceiptResult;
  try {
    receipt = await deps.recordDoorReceipt({
      restaurantId: input.restaurantId,
      orderId: order.id,
      userId: input.userId,
      countedQty: input.quantity,
      countedUom: input.unit,
      packSize: input.unit === "case" ? input.bottlesPerCase : null,
      idempotencyKey: `logged-at-door:${input.key}`,
      clientCapturedAt: input.clientCapturedAt,
      role: input.role,
      outcome: "accepted",
      signedByInitials: input.signedByInitials,
      expectedQtyInCountedUom: input.quantity,
    });
  } catch (err) {
    // A receipt already counted under this key with a different count: the
    // first count IS in stock, so "did not reach stock" would be false and
    // a retry would only repeat it (F-1501).
    if (
      err instanceof HttpException &&
      err.getStatus() === HttpStatus.CONFLICT &&
      (err.getResponse() as { reason?: string })?.reason ===
        "receipt_key_reused"
    ) {
      throw new ConflictException({
        reason: "logged_count_differs",
        orderId: order.id,
        message:
          `This delivery was already added to the books${asOrder(order)} and counted into stock with a different count, ` +
          "so nothing new was added. Check that order under Orders before counting it again.",
      });
    }
    // The order exists; the count did not land. Said in words, with what to
    // do: the same tap again reuses this order and books the count once.
    const why =
      err instanceof HttpException
        ? ((err.getResponse() as { message?: string })?.message ?? err.message)
        : (err as Error)?.message;
    throw new ServiceUnavailableException({
      reason: "logged_but_not_counted",
      orderId: order.id,
      message:
        `The delivery was added to the books${order.orderNumber ? ` as order ${order.orderNumber}` : ""}, ` +
        `but the bottles did not reach stock${why ? ` (${why})` : ""}. ` +
        "Tap Add to the books again: the same order is used and nothing is booked twice.",
    });
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    loggedAtDoor: true,
    placedOnStated,
    orderAlreadyWritten: existing !== null,
    receipt,
  };
}
