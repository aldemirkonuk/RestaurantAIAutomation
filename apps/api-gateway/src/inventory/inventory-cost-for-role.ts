/**
 * Staff read the house's stock, not what the house paid for it.
 *
 * The r24 walk (2026-11-13, B1) found `GET /inventory/:restaurantId` handing
 * a staff session every row's weighted-average cost, and the list page then
 * summing it into "At cost the cellar holds ...", while the drawer told the
 * same person "Cost is shown to owners and managers." The dashboard already
 * draws this line (amounts-for-role.ts, DASH-W22: "staff see counts, not
 * money, and the gateway stops sending the amounts to staff too"), and the
 * dish and drink cards draw it for recipes (dishes.service.ts). This is the
 * same line for the inventory and inventory-ledger routes.
 *
 * What is withheld is the PURCHASE side: what a unit cost, what the stock is
 * worth at cost, what a lot or a ledger line was paid, the supplier's agreed,
 * target and ceiling prices, and the markup and margin figures (with the
 * selling price beside them, a margin gives the cost back). The selling
 * price (`menuPriceBottle`, `menuPriceGlass`) is not withheld: staff sell at
 * it, the list already shows it to them read-only, and the founder's
 * direction for waiters is toward seeing table invoices (DASH-G6), not away
 * from prices. The library's market reference price is not the house's
 * money and stays too. A title's running revenue is a sales figure, which the
 * same role table keeps from staff, so it goes with the cost.
 *
 * A withheld field keeps its key and reads `null`, so every reader that
 * checks for a field still finds it; nothing is renamed and no shape changes.
 * Who sees money is `seesHouseAmounts`, the /ask role table's one answer, on
 * the role the JWT strategy reads from the person's access row in the house
 * the token names (never the token's own claim).
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, map } from "rxjs";
import { seesHouseAmounts } from "../dashboard/amounts-for-role";

/**
 * Every field name, at any depth of an inventory or ledger response, that
 * carries what the house paid. Both spellings: the list spreads the raw
 * `restaurant_inventory` row beside its mapped camelCase fields.
 */
export const COST_FIELDS: ReadonlySet<string> = new Set([
  // weighted-average and unit cost, and where it came from
  "wac",
  "unitCost",
  "unit_cost",
  "totalCost",
  "total_cost",
  "costBasis",
  "cost_basis",
  "costProvenance",
  "cost_provenance",
  "costPerBottle",
  "cost_per_bottle",
  // what the stock is worth at cost
  "value",
  "totalValue",
  "total_value",
  // restaurant_inventory's purchase-side columns
  "last_purchase_price",
  "lastPurchasePrice",
  "negotiated_price",
  "target_price",
  "max_price",
  "custom_price",
  // what the house has taken on a title (a sales figure, ADR 0145)
  "total_revenue",
  "totalRevenue",
  // margin and markup give the cost back beside the selling price
  "margin_percentage",
  "markup_ratio",
  "markupRatio",
  "markup_classification",
  // an auction lot's own money (AuctionLotRecordResponseDto)
  "hammerPrice",
  "buyersPremium",
  "exchangeRate",
  "houseUnitCost",
  "bookedUnitCost",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * The body with every cost field set to null, at any depth (a row's
 * `locations[].wac` too). Arrays and plain objects are copied; anything else
 * (a string, a number, a Date, a Buffer) is returned as it is.
 */
export function withholdCost<T>(body: T): T {
  if (Array.isArray(body)) return body.map((v) => withholdCost(v)) as T;
  if (!isPlainObject(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = COST_FIELDS.has(k) ? null : withholdCost(v);
  }
  return out as T;
}

/** The body as this role may read it: unchanged for an owner or a manager. */
export function inventoryForRole<T>(body: T, role: string | null | undefined): T {
  return seesHouseAmounts(role) ? body : withholdCost(body);
}

/**
 * Applied to a whole controller, so every route on it, a write's echoed row
 * included, answers a staff session without cost, and a route added later
 * cannot forget to. Runs after `JwtAuthGuard`, which sets `request.user`.
 */
@Injectable()
export class WithholdCostFromStaffInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const role = context.switchToHttp().getRequest()?.user?.role ?? null;
    if (seesHouseAmounts(role)) return next.handle();
    return next.handle().pipe(map((body) => withholdCost(body)));
  }
}
