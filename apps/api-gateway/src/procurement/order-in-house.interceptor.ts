import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Observable, from, lastValueFrom, mergeMap } from "rxjs";
import { DatabaseService } from "../database/database.service";
import { isNoSuchOrder, orderNotFound } from "./order-not-found";

/**
 * EVERY `orders/:id` ROUTE ANSWERS AN ID THAT NAMES NO ORDER WITH ONE 404.
 *
 * Probed 2026-11-13 (r25) by calling all 32 `orders/:id*` routes on
 * `ProcurementController` with an unknown uuid and with "abc", over HTTP, with
 * the real service and a database that holds no order. Before this file the
 * answers were: 404 on some, with three different bodies ("Order <id> not
 * found", "No pending draft found for this order", the sentence); a 500 on
 * ai-pause, dismiss-deal and discard-draft for any unknown id, and on deliver,
 * confirm-deal, confirm-deal-seal-challenge, conversations and draft for an id
 * that is not a uuid; 400 on the three deal-request routes for "abc"; and 200
 * or 201 with an empty answer on attachments, conversations, deal-proposal,
 * draft, cancel-scheduled-send and generate-ai-reply, so a stale link read as
 * "this order has no letters" instead of "there is no such order".
 *
 * WHY ONE INTERCEPTOR AND NOT A FIX IN EACH HANDLER. Thirty-six handlers across
 * three controllers, each with its own reads, its own catch and its own
 * wording. A fix per handler is thirty-six places to keep agreeing, and the
 * next route added would start wrong. This runs in front of every route whose
 * path starts `orders/:id` on the controllers that carry it (see the spec,
 * which fails when a new `orders/:id` route appears on a controller without
 * it), and asks the one question all of them share: is this id an order of
 * this house?
 *
 * WHAT IT COSTS, AND WHERE.
 *   - A write (POST, PATCH, DELETE) asks FIRST and runs the handler only when
 *     the order is here. One indexed read by primary key and house, before an
 *     act that already does several. Nothing is written, sent or minted for an
 *     id that is not an order.
 *   - A read (GET) asks AT THE SAME TIME as the handler runs, so an order page
 *     that fires five reads waits for no extra round trip. When the order is
 *     not here, whatever the handler answered is discarded for the 404.
 *
 * WHAT IT DOES NOT DECIDE.
 *   - A read of the order that FAILS (a connection fault) is not "no such
 *     order": the handler's own answer stands, failure or not. This is the
 *     404 for a missing order, not a second tenancy fence; every handler keeps
 *     its own house filter.
 *   - A caller with no house on its token is passed through untouched, so the
 *     handler's own "choose a house" answer is the one they get.
 *   - Another house's order gets the same 404 as a missing one (ADR 0147): a
 *     403 would confirm the id exists.
 *
 * An id that is not a uuid is decided by the database, not a pattern here:
 * Postgres accepts more spellings of a uuid than one regular expression says,
 * and a 22P02 from the read is exactly "this cannot name an order".
 */

/** The route paths this answers for: `orders/:id` and everything beneath it. */
export const ORDER_ID_ROUTE = /^\/?orders\/:id(\/|$)/;

export function isOrderIdRoute(path: unknown): boolean {
  return typeof path === "string" && ORDER_ID_ROUTE.test(path);
}

@Injectable()
export class OrderInHouseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OrderInHouseInterceptor.name);

  constructor(private readonly databaseService: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const path = Reflect.getMetadata(PATH_METADATA, context.getHandler());
    if (!isOrderIdRoute(path)) return next.handle();

    const request = context.switchToHttp().getRequest();
    const orderId: unknown = request?.params?.id;
    const restaurantId: unknown = request?.user?.restaurantId;
    if (typeof orderId !== "string" || typeof restaurantId !== "string" || !restaurantId) {
      return next.handle();
    }

    const here = this.orderIsHere(restaurantId, orderId);

    if (String(request.method).toUpperCase() === "GET") {
      // Both at once. The handler's outcome is captured, never thrown early,
      // so a 404 always wins over whatever the handler made of a missing id.
      const handled = lastValueFrom(next.handle()).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );
      return from(
        Promise.all([here, handled]).then(([isHere, outcome]) => {
          if (isHere === false) throw orderNotFound();
          if (outcome.ok) return outcome.value;
          throw outcome.error;
        }),
      );
    }

    return from(here).pipe(
      mergeMap((isHere) => {
        if (isHere === false) throw orderNotFound("nothing was done");
        return next.handle();
      }),
    );
  }

  /**
   * `true` the order is this house's, `false` it is not (or the id cannot name
   * one), `null` the read failed and nothing is known.
   */
  private async orderIsHere(restaurantId: string, orderId: string): Promise<boolean | null> {
    try {
      const { data, error } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("id", orderId)
        .maybeSingle();
      if (error) {
        if (isNoSuchOrder(error)) return false;
        this.logger.warn("Could not confirm the order is this house's; the route answers for itself", {
          restaurantId,
          orderId,
          error: error.message,
        });
        return null;
      }
      return data ? true : false;
    } catch (err: any) {
      this.logger.warn("Could not confirm the order is this house's; the route answers for itself", {
        restaurantId,
        orderId,
        error: err?.message ?? String(err),
      });
      return null;
    }
  }
}
