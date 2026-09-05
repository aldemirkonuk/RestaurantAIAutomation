import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
  forwardRef,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { InboundResponderService } from "../common/orchestrator/inbound-responder.service";
import { InboundAddressService } from "../common/orchestrator/inbound-address.service";
import { GmailService } from "../communications/gmail.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { EventType, SourcePage } from "../events/dto/event.dto";
import {
  CreateOrderDto,
  OrderFilterDto,
  OrderListResponseDto,
  OrderResponseDto,
  ProcurementOrderStatus,
  UpdateOrderDto,
  VerifyReceiptDto,
} from "./dto/procurement.dto";
import {
  computeMatch,
  isDiscrepancy,
  MatchResult,
  MatchUnitError,
  toBottleOperands,
} from "./invoice-match";
import { readAliasedQuantity } from "./quantity-aliases";
import { draftClaimFromMatch } from "./documents/credit-ledger";
import { ApproveDraftDto } from "./dto/approve-draft.dto";
import {
  OrderSource,
  PriceHistorySource,
  resolveOrderUnits,
} from "./order-units";
import {
  decideOwnPaperSighting,
  isOutlierAgainstPriors,
  isOwnPaperSource,
} from "./own-paper-sighting";
import { normalizeUnitPrice } from "../analytics/engine/vendor-price-consensus";
// The calendar owns the vocabulary of calendar_events. Importing the enums
// rather than restating the strings makes a divergence a compile error instead
// of a row nothing can read (see ADR 0066).
import {
  CalendarEventSource,
  CalendarEventStatus,
  CalendarEventType,
} from "../calendar/dto/calendar.dto";
import { ApprovalThresholdsService } from "../settings/approval-thresholds.service";
import {
  decideApproval,
  type ApprovalDecision,
  type OrderUnderTest,
} from "../settings/approval-thresholds";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  policyNote,
  recordApprovalRefusal,
  refusalSentence,
  roleSatisfies,
} from "./order-approval-gate";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { ORDER_SEAL_ACT, orderSealArgs } from "./order-seal";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The two terminal states of a calendar event, built from `CalendarEventStatus`
// rather than restated as literals so a divergence is a compile error (ADR
// 0066).
const TERMINAL_CALENDAR_STATUSES = [
  CalendarEventStatus.COMPLETED,
  CalendarEventStatus.CANCELLED,
] as const;

/**
 * The statuses an order can be in while it is still waiting for a signature.
 *
 * `PENDING` is where an order lands when it is written; `APPROVAL_NEEDED` is
 * where the gate parks one it refused. Both are "somebody still has to seal
 * this", and `/orders` buckets both into its `pending` station
 * (`apps/web/src/pages/orders/next/useOrdersNextData.ts:33-37`).
 */
const PENDING_APPROVAL_STATUSES = new Set<string>([
  ProcurementOrderStatus.PENDING,
  ProcurementOrderStatus.APPROVAL_NEEDED,
]);

/**
 * How far back the approval gate walks the order ledger for first-order-ness
 * and price history. Matches `RETROSPECTIVE_WINDOW_DAYS` in
 * `settings/approval-thresholds.service.ts:43` on purpose: the register tells a
 * house how often a rule WOULD have fired over this window, and a gate that
 * judged over a different one would make that number a different question.
 */
const APPROVAL_GATE_WINDOW_DAYS = 365;

/**
 * `numeric` comes back from PostgREST as a string. A value that is not a finite
 * number becomes `null` — never `0`, which `decideApproval` would read as a
 * genuine total below every ceiling.
 */
function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A uuid column takes a uuid or nothing.
 *
 * `executeRecurringOrder` passes the literal string `"system"` as the actor when
 * a recurring order has no creator (`recurring-orders.service.ts`), and the
 * WebSocket-only use of `userId` never noticed. Writing it to `created_by` would
 * fail the insert with a 22P02 and take the whole order down with it, so a
 * non-uuid actor becomes NULL — "we do not know who" is true, and an order that
 * exists beats an order that 500s over an attribution field.
 */
export function asUuid(value: string | null | undefined): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/**
 * How much was ordered, in the unit it was actually ordered in.
 *
 * `procurement_orders.quantity` is stated in the order's own `unit_type` — the
 * column sits directly beside it, is CHECK-constrained to
 * `bottle | case | keg | pack | split_case | each | liter`
 * (`20260901150000_order_line_capture_and_units.sql:122`), and ADR 0062 named
 * the whole class: a quantity that does not say what unit it is in.
 *
 * The two delivery-calendar descriptions said `(${order.quantity} bottles)`
 * unconditionally, so a five-CASE order of a twelve-pack read "5 bottles" on
 * `/calendar` for a sixty-bottle delivery — off by the pack size, in the one
 * sentence a manager reads to decide whether the right thing turned up. It is
 * the same defect ADR 0068 fixed in the sibling recurring-order path on the
 * same day ("`5 bottles` for a five-case schedule is the unit bug wearing a
 * notification"), left standing here because the two lanes were separate PRs.
 *
 * When `unitType` is absent — the column is nullable, and `mapOrderRow` maps a
 * blank to `undefined` — this says "units" rather than defaulting to bottles.
 * `bottle` is the column DEFAULT, so guessing it would be right most of the
 * time and silently wrong exactly where it matters; "units" claims nothing.
 */
export function describeOrderedQuantity(order: {
  quantity: number;
  unitType?: string | null;
}): string {
  const unit = (order.unitType ?? "").trim() || "unit";
  return `${order.quantity} ${unit}${order.quantity === 1 ? "" : "s"}`;
}

/**
 * The confirmation sentence a vendor reads — ADR 0119 phase 0.
 *
 * `confirmDeal` used to write "${quantity} bottles ... at $X per bottle" for
 * every order, while `procurement_orders.quantity` is a count in the order's
 * own `unit_type` and `final_price` names no unit at all. A five-case order of
 * a twelve-pack therefore told the vendor **five bottles** for a sixty-bottle
 * delivery and quoted a case price as a bottle price — the outbound twin of the
 * calendar defect `describeOrderedQuantity` (above) fixed.
 *
 * The rule here is the ADR 0020/0083 one: **the mail states only what it has
 * read.** The quantity is stated in the order's own unit word; the price is
 * "per <unit_type>", never "per bottle" unless the unit IS bottle; the pack is
 * named only when `bottlesPerUnit` was actually resolved, and where it was not,
 * the mail SAYS the pack is not on record and asks — it does not quietly assume
 * one bottle per unit, which is exactly the assumption that made the old
 * sentence wrong.
 */
export function describeConfirmedOrderTerms(input: {
  quantity: number;
  unitType: string | null;
  bottlesPerUnit: number | null;
  wineName: string;
  finalPrice: number | null;
}): string {
  const unit = (input.unitType ?? "").trim() || "unit";
  const isBottle = unit === "bottle";
  const pack = input.bottlesPerUnit;
  const packKnown = pack != null && Number.isFinite(pack) && pack > 0;

  const quantityPhrase =
    `${input.quantity} ${unit}${input.quantity === 1 ? "" : "s"}` +
    (!isBottle && packKnown
      ? ` (${pack} bottle${pack === 1 ? "" : "s"} each)`
      : "");

  const priceLine =
    input.finalPrice != null
      ? ` at $${Number(input.finalPrice).toFixed(2)} per ${unit}`
      : "";

  // Nothing to ask about when the unit IS the bottle, or when the pack is known.
  const packNote =
    isBottle || packKnown
      ? ""
      : ` Our records do not state how many bottles are in a ${unit}, so please confirm the pack size.`;

  return `We'd like to confirm our order: ${quantityPhrase} of ${input.wineName}${priceLine}.${packNote}`;
}

interface ProcurementOrderRow {
  id: string;
  order_number: string;
  restaurant_id: string;
  inventory_id: string;
  provider_id: string;
  quantity: number;
  unit_type: string | null;
  bottles_total: number | null;
  quoted_price: number | null;
  negotiated_price: number | null;
  final_price: number | null;
  total_cost: number | null;
  status: string;
  requested_at: string | null;
  approved_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  is_emergency: boolean | null;
  priority_level: number | null;
  wine_name?: string | null;
}

@Injectable()
export class ProcurementService {
  private readonly logger = new Logger(ProcurementService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventsService: EventsService,
    private readonly inventoryLedgerService: InventoryLedgerService,
    @Optional() private readonly orchestratorService?: OrchestratorService,
    @Optional() private readonly gmailService?: GmailService,
    @Optional() private readonly inboundResponder?: InboundResponderService,
    @Optional() private readonly websocketGateway?: WebsocketGateway,
    @Optional() private readonly inboundAddress?: InboundAddressService,
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService?: NotificationsService,
    // ── The approval gate's two halves ──────────────────────────────────────
    // Declared LAST so the seven specs that build this service positionally
    // (`new ProcurementService(db, events, ledger)`) keep compiling; none of
    // them calls `approveOrder`. They are NOT `@Optional()` in the DI graph —
    // `ProcurementModule` imports `SettingsModule` and `OrganizationsModule`,
    // so Nest always supplies them — and `approveOrder` REFUSES rather than
    // seals when either is missing. A gate that opens when its own dependency
    // is absent is the [[absence-reported-as-health]] fault written into a
    // constructor.
    @Optional()
    private readonly approvalThresholds?: ApprovalThresholdsService,
    @Optional()
    private readonly organizations?: OrganizationsService,
    // ── The seal (founder, 2026-09-04) ──────────────────────────────────────
    // Also declared LAST, and for the same reason as the two above: the specs
    // that build this service positionally must keep compiling. Also NOT
    // optional in the DI graph — `ProcurementModule` imports `SealModule` — and
    // `approveOrder` REFUSES rather than seals when it is missing, because a
    // seal check that disappears with its own dependency is not a seal check.
    @Optional()
    private readonly sealChallenges?: SealChallengeService,
  ) {}

  /**
   * Manually (re)run the autonomous responder for an order's most recent inbound
   * vendor reply: understand it, decide the next move, and stage a one-tap-approve
   * draft. Used to process replies that arrived before this feature existed and
   * to recover any that slipped through the live pipeline.
   */
  async generateAiReply(
    restaurantId: string,
    orderId: string,
    opts?: { instruction?: string; regenerate?: boolean; force?: boolean },
  ): Promise<{
    triggered: boolean;
    draftId?: string;
    needsApproval?: boolean;
    autoSendScheduled?: boolean;
    reason?: string;
  }> {
    if (!this.inboundResponder) {
      return { triggered: false, reason: "Responder service unavailable" };
    }

    // Confirm the order belongs to this restaurant.
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id, provider_id")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // Regenerate: clear any waiting/scheduled draft so the responder writes a fresh one.
    if (opts?.regenerate) {
      await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "DISCARDED", scheduled_send_at: null })
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .in("status", ["PENDING_APPROVAL", "AUTO_SEND_SCHEDULED"]);
    }

    // Find the most recent inbound vendor reply for this order.
    const { data: inbound } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id, provider_id, gmail_thread_id, message_id, email_headers")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!inbound) {
      return {
        triggered: false,
        reason: "No inbound vendor reply found for this order",
      };
    }

    const row = inbound as any;
    const headers = (row.email_headers ?? {}) as Record<string, any>;
    // A7 — the live pipeline discarded attachment bytes after the first vision pass, so a
    // manual (re)generate used to lose all vision context. They're persisted now (D2), so
    // re-hydrate them from Storage and feed them back to the responder.
    const inboundAttachments = await this.loadPersistedAttachmentsForVision(
      restaurantId,
      row.id,
    );
    const result = await this.inboundResponder.analyzeAndDraftReply({
      inboundConversationId: row.id,
      orderId,
      restaurantId,
      providerId: row.provider_id || (order as any).provider_id,
      gmailThreadId: row.gmail_thread_id || null,
      inboundRfc822MessageId: row.message_id || headers.message_id || null,
      inboundReferences: headers.references || null,
      inboundSubject: headers.subject || null,
      inboundAttachments: inboundAttachments.length
        ? inboundAttachments
        : undefined,
      instruction: opts?.instruction,
      forceReply: opts?.force,
    });

    return {
      triggered: result.drafted,
      draftId: result.draftId,
      needsApproval: result.needsApproval,
      autoSendScheduled: result.autoSendScheduled,
      reason: result.reason,
    };
  }

  /**
   * Emit order_change event for cross-page sync
   */
  private async emitOrderChangeEvent(
    restaurantId: string,
    userId: string,
    order: OrderResponseDto,
    changeType:
      | "created"
      | "updated"
      | "approved"
      | "delivered"
      | "completed"
      | "cancelled",
  ): Promise<void> {
    try {
      await this.eventsService.createEvent(restaurantId, userId, {
        eventType: EventType.ORDER_CHANGE,
        sourcePage: SourcePage.ORDERS,
        payload: {
          type: changeType,
          orderId: order.id,
          orderNumber: order.orderNumber,
          inventoryId: order.inventoryId,
          providerId: order.providerId,
          quantity: order.quantity,
          status: order.status,
          totalCost: order.totalCost,
        },
      });
      this.logger.log("Order change event emitted", {
        orderId: order.id,
        type: changeType,
      });
    } catch (error) {
      this.logger.warn("Failed to emit order change event", {
        error: error.message,
      });
      // Don't fail the operation if event emission fails
    }
  }

  /**
   * Place an order, and write down what was actually ordered.
   *
   * THREE THINGS THIS DOES THAT IT DID NOT BEFORE
   *
   * 1. It writes a `procurement_order_items` row. Nothing in the repository ever
   *    wrote that table, and `matchDocumentLines` returns early when an order
   *    has no lines (`document-intake.service.ts:449`) — so the whole invoice
   *    line-matching engine was unreachable and no order carried a wine identity
   *    at line level. Production held 1 line row against 2 orders and 0
   *    documents; every row that will ever exist is written from here.
   *
   * 2. It multiplies by the pack size. `bottles_total` was `dto.quantity`
   *    regardless of `unit_type`, so five CASES booked five bottles — and the
   *    receiving door back-derives pack size from `bottles_total / quantity`,
   *    which therefore always came out as 1. See `order-units.ts`.
   *
   * 3. It records where the order came from. A manual order, an Ask-AI order and
   *    a recurring materialisation produced byte-identical rows, so "did the AI
   *    place this?" was unanswerable — the first question anyone asks of an
   *    autonomous ordering system.
   *
   * `provenance` is a service argument and deliberately NOT a DTO field: it is
   * an assertion about which code path ran, and a client must not be able to
   * claim an order was manual when the agent placed it.
   *
   * ORDERS THAT RECORD RATHER THAN REQUEST
   *
   * `provenance.alreadyFulfilled` says this order documents a purchase that has
   * already happened off-app — a paper or emailed invoice being entered after
   * the wine is in the cellar. Everything that distinguishes it follows from
   * that one fact, which is why it is one flag and not four:
   *
   *   - it opens DELIVERED, not PENDING. A PENDING order for wine already on
   *     the shelf is a request the restaurant will act on twice.
   *   - `requested_at` is the invoice date, not now. Otherwise the order's
   *     delivery precedes its own request.
   *   - no dedup merge. The merge exists to fold a re-quote into an open
   *     REQUEST; an off-app purchase is a different purchase, and folding it in
   *     would overwrite a live order's quantity and price with an unrelated
   *     invoice's.
   *   - no AI draft. `triggerDraftHttp` opens a negotiation with the vendor.
   *     Negotiating the price of wine that has been delivered and invoiced is
   *     the one thing this path must never do.
   */
  async createOrder(
    restaurantId: string,
    userId: string,
    dto: CreateOrderDto,
    provenance?: {
      source: OrderSource;
      recurringOrderId?: string | null;
      alreadyFulfilled?: {
        /** ISO date/timestamp from the invoice. Absent means "we know only that it happened". */
        deliveredAt?: string | null;
        /** The total printed on the invoice, stored verbatim in final_confirmed_cost. */
        invoiceTotal?: number | null;
      };
    },
  ): Promise<OrderResponseDto> {
    const fulfilled = provenance?.alreadyFulfilled;
    // Guard: restaurant must have at least one active provider before placing orders
    const { count: providerCount, error: countError } =
      await this.databaseService.supabase
        .from("providers")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true);

    if (countError) {
      this.logger.error("Failed to count active providers", {
        restaurantId,
        error: countError.message,
      });
      throw new InternalServerErrorException(
        "Could not verify vendor availability. Please try again.",
      );
    }
    if (providerCount === 0) {
      throw new ForbiddenException({
        reason: "no_vendors",
        message: "You must add at least one vendor before placing orders.",
        redirect: "/providers",
      });
    }

    // Units first: everything downstream — bottles booked, total cost, the line
    // row, the pack size the receiving door will back-derive — is wrong if this
    // is wrong, and it was unconditionally `bottles_total = dto.quantity`.
    const units = resolveOrderUnits({
      quantity: dto.quantity,
      unitType: dto.unitType,
      bottlesPerUnit: dto.bottlesPerUnit,
    });
    if (!units.ok) {
      this.logger.warn("Refused an order whose units cannot be resolved", {
        restaurantId,
        inventoryId: dto.inventoryId,
        reason: units.reason,
        unitType: dto.unitType ?? null,
      });
      throw new BadRequestException({
        reason: units.reason,
        message: units.message,
      });
    }

    const finalPrice = dto.finalPrice ?? dto.quotedPrice ?? 0;
    const bottlesTotal = units.bottlesTotal;
    // Prices in this table are per BOTTLE — `confirmDeal` emails the vendor
    // "$X per bottle" from the same column. Multiplying by `quantity` therefore
    // understated a case order by the pack size, which is the same wound as
    // `bottles_total` seen through the money. An opaque unit (keg, litre) has no
    // bottle count, so its quantity is the only multiplier available.
    const totalCost = dto.totalCost ?? finalPrice * bottlesTotal;

    // Dedup guard: a price/quantity change for the same wine+vendor should
    // update the existing open order, not spawn a second one. Match on
    // restaurant + inventory + provider, excluding orders already past
    // negotiation (confirmed/delivered/cancelled/rejected/failed).
    const TERMINAL_STATUSES = [
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.IN_TRANSIT,
      ProcurementOrderStatus.DELIVERED,
      ProcurementOrderStatus.COMPLETED,
      ProcurementOrderStatus.CANCELLED,
      ProcurementOrderStatus.REJECTED,
      ProcurementOrderStatus.FAILED,
    ];

    // Skipped entirely for an order that RECORDS a completed purchase. The
    // merge folds a re-quote into an open REQUEST; an off-app invoice is a
    // second, separate purchase, and folding it into a live pending order would
    // silently replace that order's quantity and price with the invoice's — one
    // delivery recorded, one real order destroyed, no trace of either.
    let existing: any | undefined;
    if (!fulfilled) {
      const { data: existingRows, error: existingError } =
        await this.databaseService.supabase
          .from("procurement_orders")
          .select("*, inventory:inventory_id(wine_name)")
          .eq("restaurant_id", restaurantId)
          .eq("inventory_id", dto.inventoryId)
          .eq("provider_id", dto.providerId ?? "")
          .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
          .order("requested_at", { ascending: false })
          .limit(1);

      if (existingError) {
        this.logger.warn("Dedup lookup for procurement order failed", {
          restaurantId,
          error: existingError.message,
        });
      }

      existing = existingRows?.[0] as any | undefined;
    }

    if (existing && dto.providerId) {
      const { data: updated, error: updateError } =
        await this.databaseService.supabase
          .from("procurement_orders")
          .update({
            quantity: dto.quantity,
            unit_type: units.unitType,
            bottles_total: bottlesTotal,
            quoted_price: dto.quotedPrice ?? existing.quoted_price ?? null,
            negotiated_price:
              dto.negotiatedPrice ?? existing.negotiated_price ?? null,
            final_price: finalPrice,
            total_cost: totalCost,
            is_emergency: dto.isEmergency ?? existing.is_emergency,
            priority_level: dto.priorityLevel ?? existing.priority_level,
            manager_notes: dto.managerNotes ?? existing.manager_notes,
            expected_delivery_date:
              dto.expectedDeliveryDate ?? existing.expected_delivery_date,
          })
          .eq("id", existing.id)
          .select("*, inventory:inventory_id(wine_name)")
          .single();

      if (updateError) {
        this.logger.error("Failed to update existing procurement order", {
          restaurantId,
          orderId: existing.id,
          error: updateError.message,
        });
        throw updateError;
      }

      this.logger.log("Merged order request into existing open order", {
        restaurantId,
        orderId: existing.id,
        inventoryId: dto.inventoryId,
        providerId: dto.providerId,
      });

      // The line has to move with the header. A merge that left the old line
      // behind would produce an order whose header says 5 cases and whose only
      // line says 2 — and the invoice matcher reads the LINE, so the discrepancy
      // would surface as a vendor overage rather than as our own stale row.
      await this.upsertOrderLine({
        restaurantId,
        orderId: existing.id,
        dto,
        units,
        finalPrice,
      });

      const updatedRow = updated as any;
      const mergedRow: ProcurementOrderRow = {
        ...updatedRow,
        wine_name:
          updatedRow.inventory?.wine_name ||
          (updatedRow.inventory as any)?.wine?.name ||
          null,
      };
      const mergedOrder = this.mapOrderRow(mergedRow);
      await this.emitOrderChangeEvent(
        restaurantId,
        userId,
        mergedOrder,
        "updated",
      );
      return mergedOrder;
    }

    const orderNumber = this.generateOrderNumber();

    // An order that RECORDS a delivery opens DELIVERED and is dated from the
    // invoice. `requested_at` takes the same timestamp rather than now(),
    // because an order whose delivery predates its own request reads as a
    // data error to every report that sorts on either column.
    const fulfilledAt = fulfilled
      ? (fulfilled.deliveredAt ?? new Date().toISOString())
      : null;

    const payload = {
      order_number: orderNumber,
      restaurant_id: restaurantId,
      inventory_id: dto.inventoryId,
      provider_id: dto.providerId,
      quantity: dto.quantity,
      unit_type: units.unitType,
      bottles_total: bottlesTotal,
      quoted_price: dto.quotedPrice ?? null,
      negotiated_price: dto.negotiatedPrice ?? null,
      final_price: finalPrice,
      total_cost: totalCost,
      status: fulfilled
        ? ProcurementOrderStatus.DELIVERED
        : ProcurementOrderStatus.PENDING,
      requested_at: fulfilledAt ?? new Date().toISOString(),
      delivered_at: fulfilledAt,
      // The number printed on the invoice, kept verbatim beside the derived
      // per-bottle arithmetic so a rounding difference between them is visible
      // rather than absorbed.
      final_confirmed_cost: fulfilled?.invoiceTotal ?? null,
      is_emergency: dto.isEmergency ?? false,
      priority_level: dto.priorityLevel ?? 5,
      manager_notes: dto.managerNotes ?? null,
      expected_delivery_date: dto.expectedDeliveryDate ?? null,
      // Provenance. `userId` reached this method already and was spent only on a
      // WebSocket event; nothing durable recorded who or what placed the order.
      //
      // `source` is NULL rather than 'manual' when the caller did not state one.
      // A default of 'manual' would label an unlabelled agent path as a human
      // decision — the exact false claim this column exists to prevent — whereas
      // NULL reads correctly as "placed before anyone recorded this".
      created_by: asUuid(userId),
      source: provenance?.source ?? null,
      recurring_order_id: asUuid(provenance?.recurringOrderId),
    };

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .insert(payload)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to create procurement order", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    // The line row. Not best-effort: an order with no line is invisible to the
    // invoice matcher and carries no wine identity, which is the state every
    // order in production was in before this change.
    await this.upsertOrderLine({
      restaurantId,
      orderId: order.id,
      dto,
      units,
      finalPrice,
    });

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, "created");

    // Phase 32: Trigger silent AI draft pre-computation when provider_id is set (D-32-01)
    //
    // Never for an order that records a completed purchase. `triggerDraftHttp`
    // opens a price negotiation with the vendor; running it here would email a
    // vendor asking them to reconsider the price of wine they have already
    // delivered and invoiced. That is the single most damaging thing this
    // method could do, and before `alreadyFulfilled` existed the retroactive
    // path had no way to say "do not".
    if (dto.providerId && this.orchestratorService && !fulfilled) {
      // Resolve provider name and restaurant name in parallel.
      let resolvedProviderName = "";
      let resolvedRestaurantName = "";
      try {
        const [provResult, restResult] = await Promise.all([
          this.databaseService.supabase
            .from("providers")
            .select("name")
            .eq("id", dto.providerId)
            .eq("restaurant_id", restaurantId)
            .single(),
          this.databaseService.supabase
            .from("restaurants")
            .select("name")
            .eq("id", restaurantId)
            .single(),
        ]);
        resolvedProviderName = (provResult.data as any)?.name || "";
        resolvedRestaurantName = (restResult.data as any)?.name || "";
      } catch {
        /* non-fatal */
      }

      const draftPayload = {
        order_id: order.id,
        order_number: order.orderNumber || "",
        restaurant_id: restaurantId,
        provider_id: dto.providerId,
        provider_name: resolvedProviderName,
        wine_name: order.wineName || "",
        quantity: order.quantity,
        target_price_per_bottle: dto.quotedPrice ?? null,
        urgency: dto.isEmergency ? "urgent" : "normal",
        restaurant_name: resolvedRestaurantName,
      };

      // Primary path: direct HTTP POST to the Python orchestrator.
      // This is the only path that gives guaranteed delivery — RabbitMQ publish
      // succeeds even when no consumer is listening, so relying on it as the
      // sole trigger silently drops drafts.
      try {
        await this.orchestratorService.triggerDraftHttp(draftPayload);
        this.logger.log(`AI draft triggered via HTTP for order ${order.id}`);
      } catch (httpErr: any) {
        this.logger.error(
          `[createOrder] HTTP draft trigger failed for order ${order.id} ` +
            `(restaurant ${restaurantId}). Error: ${httpErr?.message}. ` +
            `Ensure AGENT_ORCHESTRATOR_URL and ADMIN_API_KEY are set in Railway env vars.`,
        );
      }

      // Secondary: also publish to RabbitMQ for any async consumers (best-effort).
      try {
        await this.orchestratorService.publishEvent(
          "procurement.events",
          "procurement.order.created",
          draftPayload,
        );
      } catch {
        /* non-fatal — RabbitMQ is optional */
      }
    }

    return order;
  }

  /**
   * Write (or move) the order's one line row.
   *
   * WHY AN ORDER NEEDS A LINE WHEN THE HEADER ALREADY HAS THE QUANTITY
   *
   * Because an invoice does not arrive as a header. `matchDocumentLines` pairs
   * each `procurement_document_lines` row against a `procurement_order_items`
   * row and returns early when the order has none
   * (`document-intake.service.ts:449`), so with an empty line table the entire
   * matching engine — vendor SKU, description, quantity/price triangulation, the
   * credit claims that come out of it — was unreachable code. Production ran
   * with 1 line row against 2 orders and 0 documents, which is why nothing had
   * yet failed visibly.
   *
   * The line also carries the only wine IDENTITY an invoice can be matched on.
   * `procurement_orders` names an `inventory_id`, which is this restaurant's
   * shelf slot; `master_wine_id` is the wine itself, and it is what a vendor's
   * paperwork and any cross-restaurant price series have to agree about.
   *
   * `total_bottles` is GENERATED ALWAYS AS (quantity * bottles_per_unit)
   * (`baseline:4488`) and must never be written — it is the database re-deriving
   * the same arithmetic `resolveOrderUnits` did, which is a free consistency
   * check on every insert.
   *
   * `vendor_sku` comes only from the caller. There is no table in this schema
   * that maps (provider, wine) to a vendor's SKU, and inferring one from another
   * vendor's paperwork would put vendor A's part number on a vendor B order —
   * the strongest match method pointed at the wrong wine, which is worse than no
   * match at all.
   */
  private async upsertOrderLine(args: {
    restaurantId: string;
    orderId: string;
    dto: CreateOrderDto;
    units: { unitType: string; bottlesPerUnit: number; bottlesTotal: number };
    finalPrice: number;
  }): Promise<void> {
    const { restaurantId, orderId, dto, units, finalPrice } = args;

    // The wine identity. `restaurant_inventory.master_wine_id` is NOT NULL
    // (`baseline`), so a resolvable inventory row always yields one.
    let masterWineId: string | null = null;
    let wineName: string | null = null;
    let sku: string | null = null;
    let producer: string | null = null;
    let vintage: number | null = null;

    try {
      const { data: inv, error: invErr } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select(
          "master_wine_id, wine_name, sku, master_wine_library(name, producer, vintage)",
        )
        .eq("id", dto.inventoryId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (invErr) throw new Error(invErr.message);
      const row = inv as any;
      masterWineId = asUuid(row?.master_wine_id);
      const mw = Array.isArray(row?.master_wine_library)
        ? row.master_wine_library[0]
        : row?.master_wine_library;
      wineName = row?.wine_name || mw?.name || null;
      sku = row?.sku ?? null;
      producer = mw?.producer ?? null;
      vintage = mw?.vintage ?? null;
    } catch (e: any) {
      // A lookup failure must not strand the order, but it must not be silent
      // either: a line with no master_wine_id is a line no invoice can be
      // matched to, and that is exactly the state this method exists to end.
      this.logger.warn("Order line could not resolve its wine identity", {
        restaurantId,
        orderId,
        inventoryId: dto.inventoryId,
        error: e?.message,
      });
    }

    const lineTotal = Number.isFinite(finalPrice)
      ? Math.round(finalPrice * units.bottlesTotal * 100) / 100
      : null;

    const line = {
      order_id: orderId,
      restaurant_id: restaurantId,
      inventory_id: dto.inventoryId,
      master_wine_id: masterWineId,
      // NOT NULL in the schema. Falling back to the order number keeps the row
      // writable when the inventory lookup failed, and reads as the placeholder
      // it is rather than as a wine nobody stocks.
      wine_name: wineName || `Order ${orderId}`,
      producer,
      vintage,
      sku,
      vendor_sku: dto.vendorSku ?? null,
      quantity: dto.quantity,
      unit_type: units.unitType,
      bottles_per_unit: units.bottlesPerUnit,
      // total_bottles is GENERATED — writing it raises 428C9.
      quoted_unit_price: dto.quotedPrice ?? null,
      negotiated_unit_price: dto.negotiatedPrice ?? null,
      final_unit_price: finalPrice || null,
      line_total: lineTotal,
      line_no: 1,
    };

    // One line per order today: CreateOrderDto carries exactly one inventory id.
    // Delete-then-insert rather than an upsert because there is no unique
    // constraint on (order_id, line_no) to conflict against, and a merge that
    // left a stale second line behind would make the matcher pair an invoice
    // against a quantity nobody ordered.
    const { error: delErr } = await this.databaseService.supabase
      .from("procurement_order_items")
      .delete()
      .eq("order_id", orderId)
      .eq("restaurant_id", restaurantId);
    if (delErr)
      this.logger.warn("Could not clear previous order lines", {
        orderId,
        error: delErr.message,
      });

    const { error } = await this.databaseService.supabase
      .from("procurement_order_items")
      .insert(line);

    if (error) {
      this.logger.error("Failed to write the order line", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    this.logger.log("Order line written", {
      orderId,
      masterWineId,
      unitType: units.unitType,
      bottlesPerUnit: units.bottlesPerUnit,
      totalBottles: units.bottlesTotal,
    });
  }

  /**
   * Record what a wine cost from a vendor on a date.
   *
   * `price_history` has existed since the production baseline (`baseline:4274`),
   * is keyed exactly right — (restaurant, master wine, provider, price,
   * effective date, source, order) — carries an index on
   * (master_wine_id, provider_id, effective_date DESC), and had **zero writers
   * anywhere in the repository**. Production holds 0 rows. No price series has
   * ever existed, so nothing that depends on one — vendor comparison, "you are
   * paying more than you were", any forecast of what a reorder will cost — could
   * be built at all.
   *
   * Two sources, and they are not interchangeable: `order_confirmed` is what a
   * vendor AGREED to charge, `receipt_verified` is what they actually DID charge
   * once the invoice was checked. Collapsing them would make a vendor who quotes
   * low and bills high indistinguishable from one who does neither.
   *
   * Best-effort by design. A delivery that has been counted and an order a
   * manager has confirmed are facts; failing either of them because an analytics
   * row would not write is the wrong trade.
   */
  private async recordPriceHistory(args: {
    restaurantId: string;
    orderId: string;
    providerId: string | null;
    masterWineId: string | null;
    /** Per bottle. */
    price: number | null | undefined;
    source: PriceHistorySource;
    quantity?: number | null;
    notes?: string | null;
    /**
     * The same event as a row in the PRICE REGISTER — `vendor_price_observations`
     * — which is the table every price reader actually joins on (ADR 0117 class
     * A, "own paper"). Carried separately from the `price` above because the two
     * tables mean different things by a number: `price_history.unit` is
     * hardcoded `'BOTTLE'` and its `price` is per bottle, while a sighting must
     * carry the DOCUMENT's own figure in the DOCUMENT's own unit, with the pack
     * size and bottle volume beside it, so that `normalizeUnitPrice` — and only
     * it — does the conversion.
     *
     * Absent means no sighting, and `recordOwnPaperSighting` says so in a
     * sentence rather than defaulting one into existence.
     */
    sighting?: {
      vendorName?: string | null;
      productName?: string | null;
      unitPrice?: number | null;
      unitLabel?: string | null;
      packSize?: number | null;
      unitVolumeMl?: number | null;
      observedAt?: string | null;
      currency?: string | null;
    };
  }): Promise<void> {
    // The register mirror runs first and on its own operands: a price_history
    // row that cannot be written must not silently take the sighting down with
    // it, and the sighting's refusals are different refusals.
    await this.recordOwnPaperSighting(args);

    const price = Number(args.price);
    // A zero or absent price is not an observation. Writing one would put a
    // fabricated $0 into the series and drag every average through it.
    if (!Number.isFinite(price) || price <= 0) return;

    try {
      const { error } = await this.databaseService.supabase
        .from("price_history")
        .insert({
          restaurant_id: args.restaurantId,
          master_wine_id: args.masterWineId,
          provider_id: args.providerId,
          price: Math.round(price * 100) / 100,
          quantity: args.quantity ?? 1,
          // The vocabulary of the column, not of this codebase: price_history
          // predates the canonical singular unit list and defaults to 'BOTTLE'.
          //
          // This label is now TRUE rather than merely constant. All three
          // callers pass a bottle count and a per-bottle price: the two
          // `order_confirmed` writers use `bottles_total`, and
          // `receipt_verified` passes the match's normalised bottle figure
          // alongside `effectiveUnitCost`. Before the units reached
          // `computeMatch`, the receipt writer put a raw invoice number — a case
          // count on any order not placed in bottles — into a column asserting
          // bottles, and no reader could tell.
          //
          // It stays hardcoded, deliberately: this is a per-bottle price series
          // by construction, so a `unit` that could vary would invite a caller
          // to write a case price into it and make the whole series
          // incomparable. Any future non-bottle observation needs a decision
          // about what the series means, not a widened column.
          unit: "BOTTLE",
          effective_date: new Date().toISOString().slice(0, 10),
          source: args.source,
          order_id: args.orderId,
          notes: args.notes ?? null,
        });
      if (error) throw new Error(error.message);

      if (!args.masterWineId)
        // Still worth keeping — it is a real observation of what this vendor
        // charged, joinable through order_id — but it cannot join a
        // cross-restaurant price series, so say so rather than let the gap be
        // discovered as a hole in the data months later.
        this.logger.warn("price_history row written without a wine identity", {
          orderId: args.orderId,
          source: args.source,
        });
    } catch (e: any) {
      this.logger.warn("Could not record price history", {
        orderId: args.orderId,
        source: args.source,
        error: e?.message,
      });
    }
  }

  /**
   * Mirror the house's own paper into the price register.
   *
   * `vendor_price_observations` is the table the price READERS join on — the
   * market box (`vendor-comparison.service.ts:333`), the beverage register's
   * quote line, the market producer — and measured 2026-09-04 it held 0 rows
   * with no writer for a class-A price anywhere in the repository. ADR 0117
   * decided this mirror is the register's first fill: no vendor, no fetch, no
   * terms, no rate limit, and the best provenance the platform will ever have.
   *
   * THREE PROPERTIES, EACH BOUGHT DELIBERATELY
   *
   * 1. **Tenant-scoped, always.** `restaurant_id` is never null here.
   *    `belowTrailingAverage` reads `restaurant_id.is.null OR
   *    restaurant_id.eq.<tenant>` (`vendor-comparison.service.ts:341`), so a
   *    null would publish this house's invoice price into every other house's
   *    market box — the fifth of the six counts ADR 0117's rejected candidate
   *    lost on.
   * 2. **Idempotent.** The table's UNIQUE `(source_ref, content_hash)` index
   *    (`20260805154027_vendor_price_observations.sql:141`) already exists for
   *    exactly this, so no migration is added. The pre-check below turns the
   *    ordinary case into a silent skip; the 23505 catch covers the race the
   *    pre-check cannot, because two verifications of one receipt landing
   *    together must still produce one row.
   * 3. **`is_outlier` written, by the MAD test, at write time.** The column has
   *    been `DEFAULT false NOT NULL` with no writer anywhere, so
   *    `belowTrailingAverage`'s `.eq("is_outlier", false)` has been excluding
   *    nothing and certifying every row — including a catastrophic parse — as
   *    clean (`notifications.md` §13.25(b)). The test is `flagOutliers`
   *    (`analytics/engine/vendor-price-consensus.ts:188`), already an exported
   *    pure function, run over this product's existing sightings plus the
   *    candidate. NOTE the deliberate divergence: ADR 0117 specifies this
   *    writer as a pass over the GROUP after a batch lands, not at write time.
   *    Write time is the founder's instruction of 2026-09-04 and is recorded as
   *    such in the ADR and in `notifications.md` §13.25(b). It is never a bound:
   *    no value is clamped or rejected for being extreme, a flagged row is still
   *    written and still visible, and a row flagged against a thin history is
   *    never flagged at all (`MIN_OUTLIER_SAMPLE`).
   *
   * Best-effort, like the price history beside it. A delivery that has been
   * counted is a fact; failing it because an analytics row would not write is
   * the wrong trade.
   */
  private async recordOwnPaperSighting(args: {
    restaurantId: string;
    orderId: string;
    providerId: string | null;
    masterWineId: string | null;
    source: PriceHistorySource;
    notes?: string | null;
    sighting?: {
      vendorName?: string | null;
      productName?: string | null;
      unitPrice?: number | null;
      unitLabel?: string | null;
      packSize?: number | null;
      unitVolumeMl?: number | null;
      observedAt?: string | null;
      currency?: string | null;
    };
  }): Promise<void> {
    if (!isOwnPaperSource(args.source)) return;

    const s = args.sighting;
    if (!s) {
      this.logger.warn(
        `No price sighting written for ${args.source} on order ${args.orderId}: ` +
          `the caller supplied no document figures, so there is no unit, no ` +
          `pack and no date to put on the row. ADR 0117 refuses a sighting ` +
          `that cannot name all five.`,
      );
      return;
    }

    const provisional = decideOwnPaperSighting({
      restaurantId: args.restaurantId,
      orderId: args.orderId,
      providerId: args.providerId,
      vendorName: s.vendorName ?? null,
      masterWineId: args.masterWineId,
      productName: s.productName ?? null,
      source: args.source,
      unitPrice: s.unitPrice,
      unitLabel: s.unitLabel,
      packSize: s.packSize,
      unitVolumeMl: s.unitVolumeMl,
      observedAt: s.observedAt,
      currency: s.currency ?? null,
      notes: args.notes ?? null,
    });

    // The refusal is a logged SENTENCE, not a silent return. A register that
    // stays empty because every write quietly declined itself is the
    // absence-reported-as-health fault this whole build exists to end.
    if (!provisional.write) {
      this.logger.warn(provisional.reason);
      return;
    }

    try {
      // supabase-js RESOLVES with { data, error }. A dropped `error` here makes
      // a FAILED dedup read indistinguishable from "not on the register yet",
      // so the guard fails open and we insert the duplicate it exists to
      // prevent. If we cannot tell, we do not write: the catch below turns this
      // into the logged sentence "Could not record the price sighting".
      const { data: existing, error: existingError } =
        await this.databaseService.supabase
          .from("vendor_price_observations")
          .select("id")
          .eq("source_ref", provisional.sourceRef)
          .eq("content_hash", provisional.contentHash)
          .maybeSingle();
      if (existingError) {
        throw new Error(
          `could not read the register to check whether ${provisional.sourceRef} ` +
            `is already on it, so this sighting is not written rather than ` +
            `written twice: ${existingError.message}`,
        );
      }
      if (existing) {
        this.logger.log(
          `Price sighting already on the register for ${provisional.sourceRef}; ` +
            `the figures are unchanged, so this is not new evidence.`,
        );
        return;
      }

      const isOutlier = isOutlierAgainstPriors(
        await this.priorSightingUnitPrices(
          args.restaurantId,
          args.masterWineId,
        ),
        provisional.normalizedUnitPrice,
      );

      const decision = decideOwnPaperSighting(
        {
          restaurantId: args.restaurantId,
          orderId: args.orderId,
          providerId: args.providerId,
          vendorName: s.vendorName ?? null,
          masterWineId: args.masterWineId,
          productName: s.productName ?? null,
          source: args.source,
          unitPrice: s.unitPrice,
          unitLabel: s.unitLabel,
          packSize: s.packSize,
          unitVolumeMl: s.unitVolumeMl,
          observedAt: s.observedAt,
          currency: s.currency ?? null,
          notes: args.notes ?? null,
        },
        { isOutlier },
      );
      if (!decision.write) {
        this.logger.warn(decision.reason);
        return;
      }

      const row = decision.row;
      const { error } = await this.databaseService.supabase
        .from("vendor_price_observations")
        // Explicit keys, one per column, so `check_order_capture_contract.py`
        // and any future guard can read what this write actually claims
        // without executing it.
        .insert({
          restaurant_id: row.restaurant_id,
          provider_id: row.provider_id,
          vendor_name_raw: row.vendor_name_raw,
          master_wine_id: row.master_wine_id,
          product_name_raw: row.product_name_raw,
          source_type: row.source_type,
          trust_tier: row.trust_tier,
          source_ref: row.source_ref,
          observed_at: row.observed_at,
          effective_date: row.effective_date,
          raw_price: row.raw_price,
          currency: row.currency,
          pack_size: row.pack_size,
          unit_volume_ml: row.unit_volume_ml,
          normalized_unit_price: row.normalized_unit_price,
          normalization_note: row.normalization_note,
          content_hash: row.content_hash,
          is_outlier: row.is_outlier,
          raw: row.raw,
        });

      if (error) {
        // 23505 is the dedup index doing its job against a concurrent twin.
        // Not a failure: the row it collided with is the row we wanted.
        if ((error as any).code === "23505") {
          this.logger.log(
            `Price sighting for ${row.source_ref} was already written concurrently.`,
          );
          return;
        }
        throw new Error(error.message);
      }

      this.logger.log("Price sighting written to the register", {
        orderId: args.orderId,
        sourceRef: row.source_ref,
        sourceType: row.source_type,
        trustTier: row.trust_tier,
        packSize: row.pack_size,
        unitVolumeMl: row.unit_volume_ml,
        isOutlier: row.is_outlier,
      });
    } catch (e: any) {
      this.logger.warn("Could not record the price sighting", {
        orderId: args.orderId,
        source: args.source,
        error: e?.message,
      });
    }
  }

  /**
   * The per-750ml prices already on the register for this product and house.
   *
   * The scope matches `belowTrailingAverage` exactly (`restaurant_id IS NULL OR
   * = this tenant`, `vendor-comparison.service.ts:341`) so the MAD test is run
   * over the same population the ladder will later read. `master_wine_id` is
   * the key `priceBelowAverage` groups on (`price-below-average.ts:141-144`);
   * with no identity there is no group, so there is nothing to be an outlier
   * against and the answer is an empty list.
   */
  private async priorSightingUnitPrices(
    restaurantId: string,
    masterWineId: string | null,
  ): Promise<number[]> {
    if (!masterWineId) return [];
    try {
      const { data, error } = await this.databaseService.supabase
        .from("vendor_price_observations")
        .select("raw_price, source_type, observed_at, pack_size, unit_volume_ml, yield_factor")
        .eq("master_wine_id", masterWineId)
        .or(`restaurant_id.is.null,restaurant_id.eq.${restaurantId}`)
        .order("observed_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);

      const out: number[] = [];
      for (const r of (data ?? []) as any[]) {
        const { unitPrice } = normalizeUnitPrice({
          price: Number(r.raw_price),
          sourceType: r.source_type,
          observedAt: r.observed_at,
          packSize: Number(r.pack_size) || 1,
          unitVolumeMl: r.unit_volume_ml ?? undefined,
          yieldFactor: Number(r.yield_factor) || 1,
        });
        if (unitPrice !== null && Number.isFinite(unitPrice))
          out.push(unitPrice);
      }
      return out;
    } catch (e: any) {
      // A register we could not read is not a register with nothing in it. Say
      // so, and decline to flag rather than flagging against an empty list.
      this.logger.warn(
        `Could not read the price register to screen for outliers: ${e?.message}`,
      );
      return [];
    }
  }

  /**
   * The unit an order was placed in, and how many bottles one of them is.
   *
   * `procurement_orders` carries `unit_type` and `bottles_total` but NOT
   * `bottles_per_unit` — only the LINE (`procurement_order_items`) has it, which
   * is why this reads the line rather than trusting the header alone.
   *
   * The fallback derives the pack size as `bottles_total / quantity`, and does
   * so only when that division is exact and at least 1. That guard matters:
   * back-deriving pack size is the move that let a legacy order which booked 5
   * bottles for 5 cases teach the door that a case holds one bottle
   * (`order-units.ts`). An inexact or absent derivation yields NO pack size, and
   * `computeMatch` then refuses a multiplying unit outright rather than
   * guessing — which is the correct outcome for a row we cannot read.
   */
  private async resolveOrderMatchUnits(
    restaurantId: string,
    orderId: string,
    orderRow: Record<string, any>,
  ): Promise<{ unitType: string | null; bottlesPerUnit: number | null }> {
    const unitType = orderRow.unit_type ?? null;

    try {
      const { data } = await this.databaseService.supabase
        .from("procurement_order_items")
        .select("unit_type, bottles_per_unit")
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .maybeSingle();
      const line = data as any;
      if (line?.bottles_per_unit != null) {
        return {
          unitType: line.unit_type ?? unitType,
          bottlesPerUnit: Number(line.bottles_per_unit),
        };
      }
    } catch (e: any) {
      // A missing line must not strand a delivery someone is standing in front
      // of; the derivation below still has a chance, and failing that the match
      // refuses rather than guesses.
      this.logger.warn("Could not read the order line's pack size", {
        orderId,
        error: e?.message,
      });
    }

    const quantity = Number(orderRow.quantity);
    const bottlesTotal = Number(orderRow.bottles_total);
    if (
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Number.isFinite(bottlesTotal) &&
      bottlesTotal > 0 &&
      Number.isInteger(bottlesTotal / quantity) &&
      bottlesTotal / quantity >= 1
    ) {
      return { unitType, bottlesPerUnit: bottlesTotal / quantity };
    }

    return { unitType, bottlesPerUnit: null };
  }

  /**
   * The shelf slot this order is for: its wine identity, its bottle volume and
   * its name.
   *
   * `bottleSizeMl` is nullable and stays nullable all the way to the register,
   * where its absence is a REFUSAL rather than a 750 — the defect
   * `20260903171000_the_house_item_is_the_ledgers_key.sql:61` names, and the
   * "what unit is it in" leg of ADR 0117's five.
   */
  private async resolveOrderShelfItem(
    restaurantId: string,
    inventoryId: string | null | undefined,
  ): Promise<{
    masterWineId: string | null;
    bottleSizeMl: number | null;
    wineName: string | null;
  }> {
    const empty = { masterWineId: null, bottleSizeMl: null, wineName: null };
    if (!inventoryId) return empty;
    try {
      const { data } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("master_wine_id, bottle_size_ml, wine_name")
        .eq("id", inventoryId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      const row = data as any;
      const ml = Number(row?.bottle_size_ml);
      return {
        masterWineId: asUuid(row?.master_wine_id),
        bottleSizeMl: Number.isFinite(ml) && ml > 0 ? ml : null,
        wineName: row?.wine_name ?? null,
      };
    } catch {
      return empty;
    }
  }

  /** The wine this order is for, as the price series needs to key it. */
  private async resolveOrderMasterWineId(
    restaurantId: string,
    inventoryId: string | null | undefined,
  ): Promise<string | null> {
    return (await this.resolveOrderShelfItem(restaurantId, inventoryId))
      .masterWineId;
  }

  async listOrders(
    restaurantId: string,
    query: OrderFilterDto,
  ): Promise<OrderListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const fromIndex = (page - 1) * limit;
    const toIndex = fromIndex + limit - 1;

    let supabaseQuery = this.databaseService.supabase
      .from("procurement_orders")
      .select("*, inventory:inventory_id(wine_name)", { count: "exact" })
      .eq("restaurant_id", restaurantId);

    if (query.status) {
      supabaseQuery = supabaseQuery.eq("status", query.status);
    }

    if (query.providerId) {
      supabaseQuery = supabaseQuery.eq("provider_id", query.providerId);
    }

    if (query.dateFrom) {
      supabaseQuery = supabaseQuery.gte("created_at", query.dateFrom);
    }

    if (query.dateTo) {
      supabaseQuery = supabaseQuery.lte("created_at", query.dateTo);
    }

    const { data, error, count } = await supabaseQuery
      .order("created_at", { ascending: false })
      .range(fromIndex, toIndex);

    if (error) {
      this.logger.error("Failed to list procurement orders", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const orders = (data || []).map((row: any) => {
      const orderRow: ProcurementOrderRow = {
        ...row,
        wine_name:
          row.inventory?.wine_name ||
          (row.inventory as any)?.wine?.name ||
          null,
      };
      return this.mapOrderRow(orderRow);
    });
    const total = count ?? orders.length;

    return {
      orders,
      total,
      page,
      limit,
      hasMore: fromIndex + orders.length < total,
    };
  }

  async getOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<OrderResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("*, inventory:inventory_id(wine_name)")
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .single();

    if (error) {
      this.logger.error("Failed to fetch procurement order", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    return this.mapOrderRow(orderRow);
  }

  async updateOrder(
    restaurantId: string,
    orderId: string,
    dto: UpdateOrderDto,
  ): Promise<OrderResponseDto> {
    // D-06: Block location assignment while order is in a pending state.
    if (dto.locationId !== undefined) {
      const BLOCKED_STATUSES = [
        ProcurementOrderStatus.PENDING,
        ProcurementOrderStatus.APPROVAL_NEEDED,
        ProcurementOrderStatus.NEGOTIATING,
      ];
      const { data: existing, error: fetchError } =
        await this.databaseService.supabase
          .from("procurement_orders")
          .select("status")
          .eq("restaurant_id", restaurantId)
          .eq("id", orderId)
          .single();

      if (
        !fetchError &&
        existing &&
        BLOCKED_STATUSES.includes((existing as any).status)
      ) {
        throw new UnprocessableEntityException({
          reason: "order_not_approved",
          message: "Location can only be assigned after the order is approved.",
        });
      }
    }

    const updatePayload: Record<string, any> = {
      status: dto.status ?? undefined,
      quoted_price: dto.quotedPrice ?? undefined,
      negotiated_price: dto.negotiatedPrice ?? undefined,
      final_price: dto.finalPrice ?? undefined,
      total_cost: dto.totalCost ?? undefined,
      manager_notes: dto.managerNotes ?? undefined,
      rejection_reason: dto.rejectionReason ?? undefined,
      delivery_notes: dto.deliveryNotes ?? undefined,
      tracking_number: dto.trackingNumber ?? undefined,
      // Stored in the order's own unit_type, beside `quantity`. The canonical
      // field says so in its name; the old unitless one is still accepted, and
      // the two disagreeing is a 400 rather than a silent choice.
      quantity_received:
        readAliasedQuantity({
          canonicalName: "quantityReceivedInOrderUom",
          canonical: dto.quantityReceivedInOrderUom,
          aliasName: "quantityReceived",
          alias: dto.quantityReceived,
        }) ?? undefined,
      price_verified: dto.priceVerified ?? undefined,
      invoice_image_url: dto.invoiceImageUrl ?? undefined,
      discrepancy_notes: dto.discrepancyNotes ?? undefined,
      location_id: dto.locationId ?? undefined,
    };

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(updatePayload)
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to update procurement order", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    return this.mapOrderRow(orderRow);
  }

  async cancelOrder(
    restaurantId: string,
    orderId: string,
    userId: string,
    reason?: string,
  ): Promise<OrderResponseDto> {
    // Capture current order state BEFORE cancelling so we can decide
    // whether to release shadow stock (only if order was in an active state).
    const { data: preCancelRow } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("status, inventory_id, quantity")
      .eq("id", orderId)
      .single();

    const order = await this.updateOrder(restaurantId, orderId, {
      status: ProcurementOrderStatus.CANCELLED,
      rejectionReason: reason,
    });

    // D-10: Cascade PENDING_APPROVAL conversations to CANCELLED so they don't
    // appear in the active conversations panel after order cancellation.
    try {
      await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "CANCELLED" })
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .eq("status", "PENDING_APPROVAL");
      this.logger.log(
        `Cascaded PENDING_APPROVAL conversations to CANCELLED for order ${orderId}`,
      );
    } catch (cascadeError: any) {
      this.logger.warn(
        `cancelOrder conversation cascade failed (non-fatal): ${cascadeError?.message}`,
      );
    }

    // Cancel any pending calendar delivery event linked to this order.
    await this.cancelCalendarEventForOrder(restaurantId, orderId, order);

    // Release shadow stock if the order had already been approved/sent and
    // inventory was reserved (shadow_stock was incremented for this order).
    const preStatus = (preCancelRow as any)?.status ?? "";
    const RESERVED_STATUSES = [
      ProcurementOrderStatus.APPROVED,
      ProcurementOrderStatus.CONFIRMED,
      ProcurementOrderStatus.IN_TRANSIT,
    ];
    if (
      order.inventoryId &&
      order.quantity &&
      RESERVED_STATUSES.includes(preStatus as ProcurementOrderStatus)
    ) {
      await this.releaseOrderShadowStock(
        restaurantId,
        order.inventoryId,
        order.quantity,
      );
    }

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, "cancelled");

    return order;
  }

  /**
   * Close the open delivery calendar event for an order — the one
   * implementation behind both `cancelCalendarEventForOrder` and
   * `updateCalendarEventForDelivery`.
   *
   * Those two are the same job in two directions, and before this they were
   * the same job written twice. Both were broken the same two ways, and
   * neither fault could be seen. They are the read/update counterparts of the
   * write ADR 0066 repaired:
   *
   *  1. Each located the event with `.select("id, tags")` and JSON-parsed
   *     `tags` looking for an `order_id`. `calendar_events` has no `tags`
   *     column, so PostgREST answered 42703 for the whole query — and the
   *     destructure took only `data`, so the error was never read. Supabase
   *     *returns* `{data, error}` rather than throwing, which made the
   *     wrapping `try`/`catch` inert for exactly the failure that was
   *     occurring. `events` came back `undefined`, `(events || [])` was empty,
   *     and the function returned having done nothing — indistinguishable
   *     from a run that legitimately found no event. `order_id` is a real
   *     uuid column with an FK to `procurement_orders`, and since ADR 0066 it
   *     is written, so the scan is replaced by `.eq("order_id", orderId)`.
   *  2. Each wrote and filtered on uppercase `COMPLETED`/`CANCELLED`. The
   *     column carries no CHECK, so the write would have *succeeded* and
   *     produced a row no reader recognises, while the filters matched
   *     nothing. The real vocabulary is `CalendarEventStatus` — all lowercase;
   *     production holds `active`, `completed`, `pending` — and it is
   *     imported, not restated.
   *
   * Until ADR 0066 there was never an event to find, so failing cost nothing.
   * Now that events are created for real, an unclosed event leaves a `pending`
   * delivery on `/calendar` for an order that has long since arrived or been
   * cancelled.
   *
   * Sharing one body is not only deduplication. Written twice, the two drifted:
   * one excluded the terminal statuses with `.not("status", "in", ...)` and the
   * other with `.neq(...)`, for no reason either recorded. Here the one thing
   * that legitimately differs — which statuses are already closed and must not
   * be reopened — is an argument with a name, so the difference is a decision
   * instead of an accident.
   *
   * One statement, not select-then-update: it cannot match a row it then fails
   * to write, and `.select("id")` makes the success branch unreachable without
   * rows to name. All three outcomes are reported, and "nothing matched" is
   * stated rather than being indistinguishable from success.
   */
  private async closeDeliveryCalendarEvent(
    restaurantId: string,
    orderId: string,
    order: OrderResponseDto,
    close: {
      /** The status to write. Also reads as the verb in every log line. */
      status: CalendarEventStatus;
      /** Statuses already closed for this transition; never reopened. */
      leaveAlone: readonly CalendarEventStatus[];
      description: string;
    },
  ): Promise<void> {
    // PostgREST wants an `in` value as a parenthesised, quoted list. A
    // one-element list is valid, so this covers both callers.
    const alreadyClosed = `(${close.leaveAlone.map((s) => `"${s}"`).join(",")})`;

    const context = {
      restaurantId,
      orderId,
      orderNumber: order.orderNumber,
    };

    try {
      const { data, error } = await this.databaseService.supabase
        .from("calendar_events")
        .update({
          status: close.status,
          description: close.description,
        })
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .eq("event_type", CalendarEventType.DELIVERY)
        .not("status", "in", alreadyClosed)
        .select("id");

      if (error) {
        this.logger.error(
          `Calendar delivery event NOT ${close.status} for order ${order.orderNumber}`,
          {
            ...context,
            code: (error as { code?: string }).code,
            error: error.message,
          },
        );
        return;
      }

      const ids = (data ?? []).map((row: { id: string }) => row.id);
      if (ids.length === 0) {
        // Legitimate in two known cases: an order cancelled before approval
        // never had an event, and any order approved before ADR 0066 shipped
        // never got one either. Said out loud regardless — reporting nothing
        // here is precisely what kept the 42703 above invisible for the whole
        // life of both functions.
        this.logger.warn(
          `No open delivery calendar event matched this order — nothing was ${close.status}`,
          context,
        );
        return;
      }

      this.logger.log(
        `Calendar event(s) ${ids.join(", ")} ${close.status} for order ${order.orderNumber}`,
      );
    } catch (e: any) {
      this.logger.error(
        `Calendar delivery event NOT ${close.status} for order ${order.orderNumber}`,
        { ...context, error: e?.message },
      );
    }
  }

  /**
   * Close the delivery event when its order is cancelled (non-fatal — the
   * order is already cancelled by the time this runs).
   *
   * A **completed** event is left alone: a recorded delivery is a physical
   * fact, and a later administrative cancellation should not erase it. That is
   * why `leaveAlone` here is both terminal statuses and only one of them in
   * `updateCalendarEventForDelivery` — see that function for the other side.
   */
  private async cancelCalendarEventForOrder(
    restaurantId: string,
    orderId: string,
    order: OrderResponseDto,
  ): Promise<void> {
    return this.closeDeliveryCalendarEvent(restaurantId, orderId, order, {
      status: CalendarEventStatus.CANCELLED,
      leaveAlone: TERMINAL_CALENDAR_STATUSES,
      // The pre-fix text was the raw uuid, which is nothing a manager reading
      // /calendar can use. The order number is already in hand at the caller.
      description: `Order ${order.orderNumber} was cancelled — this delivery is not coming.`,
    });
  }

  /** Subtract order quantity from shadow_stock + in_transit_quantity, flooring at 0. Non-fatal. */
  private async releaseOrderShadowStock(
    restaurantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<void> {
    try {
      // Shadow stock is a projection of inventory_lots — release via the ledger RPC, clamped
      // to what is actually on-order (floor at 0). in_transit_quantity is a separate display counter.
      const { data: inv } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("shadow_stock, in_transit_quantity")
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single();

      if (inv) {
        const currentShadow = (inv as any).shadow_stock ?? 0;
        const currentInTransit = (inv as any).in_transit_quantity ?? 0;
        const release = Math.min(quantity, currentShadow);
        if (release > 0) {
          const { error } = await this.databaseService.supabase.rpc(
            "apply_stock_movement",
            {
              p_inventory_id: inventoryId,
              p_stock_state: "shadow",
              p_delta: -release,
              p_transaction_type: "adjustment",
              p_source: "order",
              p_reason: "released on order close",
            },
          );
          if (error) throw new Error(error.message);
        }
        await this.databaseService.supabase
          .from("restaurant_inventory")
          .update({
            in_transit_quantity: Math.max(0, currentInTransit - quantity),
          })
          .eq("restaurant_id", restaurantId)
          .eq("id", inventoryId);
        this.logger.log(
          `Released ${quantity} shadow/in-transit stock for inventory ${inventoryId}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`releaseOrderShadowStock failed: ${e?.message}`);
    }
  }

  /** Add order quantity to shadow_stock + in_transit_quantity (marks stock as "on order"). Non-fatal. */
  private async reserveOrderShadowStock(
    restaurantId: string,
    inventoryId: string,
    quantity: number,
  ): Promise<void> {
    try {
      // Shadow stock is a projection of inventory_lots — reserve via the ledger RPC (creates a
      // shadow lot). in_transit_quantity is a separate denormalized display counter.
      const { error } = await this.databaseService.supabase.rpc(
        "apply_stock_movement",
        {
          p_inventory_id: inventoryId,
          p_stock_state: "shadow",
          p_delta: quantity,
          p_transaction_type: "purchase",
          p_source: "order",
          p_reason: "reserved on order placement",
        },
      );
      if (error) throw new Error(error.message);

      const { data: inv } = await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("in_transit_quantity")
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .single();
      await this.databaseService.supabase
        .from("restaurant_inventory")
        .update({
          in_transit_quantity:
            ((inv as any)?.in_transit_quantity ?? 0) + quantity,
        })
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId);
      this.logger.log(
        `Reserved ${quantity} shadow/in-transit stock for inventory ${inventoryId}`,
      );
    } catch (e: any) {
      this.logger.warn(`reserveOrderShadowStock failed: ${e?.message}`);
    }
  }

  /**
   * Seal an order — if the house's own policy lets this person seal it.
   *
   * =========================================================================
   * THE GATE (added 2026-09-03, ADR 0116)
   * =========================================================================
   * Until today this method wrote `status/approved_at/approved_by` and read
   * neither a role nor an amount, so anyone who could reach
   * `POST /procurement/orders/:id/approve` could seal any figure. The settings
   * page has carried the house's thresholds since the fourth pass and printed,
   * as its first sentence, that nothing consulted them. This is the code that
   * consults them.
   *
   * The order of operations is deliberate and each step is load-bearing:
   *
   *   1. READ THE ORDER FIRST. It was not read at all before, so a bad id
   *      became a PostgREST error from an UPDATE that matched nothing. Now a
   *      missing order is a 404 with a sentence.
   *   2. READ THE POLICY, and treat an UNREADABLE policy as a refusal, never as
   *      permission. A house whose thresholds table cannot be read has not said
   *      "anyone, any amount"; it has said nothing, and sealing on nothing is
   *      how a ceiling silently stops existing.
   *   3. BUILD THE FACTS the rules test, and pass `null` — never `false` —
   *      for a fact that could not be established. `decideApproval` already
   *      refuses to fire a rule on an unknown, and reports it as `untestable`.
   *   4. DECIDE with the SAME pure function the settings register renders. Two
   *      implementations of "does this need an owner" is how a policy page and
   *      a policy diverge.
   *   5. COMPARE RANKS. `owner` ⪰ `manager` ⪰ everything else, and an unknown
   *      role satisfies nothing (`order-approval-gate.ts`).
   *   6. ON REFUSAL: park the order in `APPROVAL_NEEDED` so the row itself says
   *      it is waiting, file `order_approval_refused` in `system_audit_log`, and
   *      throw a `ForbiddenException` whose message is the WHOLE sentence —
   *      which rule fired, what the number was, and who may sign. A person told
   *      only "forbidden" learns to split the order in two.
   *
   * A house with NO rule at all keeps exactly today's behaviour: `policySet` is
   * false, `decideApproval` fires nothing, the seal goes through, and the fact
   * that nothing was consulted is stated in the readout rather than implied by
   * silence.
   */
  async approveOrder(
    restaurantId: string,
    orderId: string,
    userId: string,
    challenge?: string | null,
  ): Promise<OrderResponseDto> {
    await this.assertApprovalAllowed(restaurantId, orderId, userId);
    await this.redeemOrderSeal(restaurantId, orderId, userId, challenge);

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({
        status: ProcurementOrderStatus.APPROVED,
        approved_at: new Date().toISOString(),
        approved_by: userId,
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to approve procurement order", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    // Reserve shadow stock so managers can see "X bottles on order" before delivery.
    if (order.inventoryId && order.quantity) {
      await this.reserveOrderShadowStock(
        restaurantId,
        order.inventoryId,
        order.quantity,
      );
    }

    // NOTE: Calendar event is intentionally NOT created here.
    // It is created in approveDraft(), only after the manager reviews and approves
    // the outbound email to the provider — ensuring the calendar reflects
    // confirmed provider communication, not just internal approval.

    // Emit order_change event for cross-page sync
    await this.emitOrderChangeEvent(restaurantId, userId, order, "approved");

    // Trigger AI to draft vendor email via ProviderConversationAgent
    if (this.orchestratorService) {
      try {
        await this.orchestratorService.publishEvent(
          "procurement.events",
          "procurement.conversation_request",
          {
            intent_type: "order_inquiry",
            order_id: orderId,
            provider_id: (data as ProcurementOrderRow).provider_id,
            restaurant_id: restaurantId,
            wine_name: order.wineName || "",
            quantity: order.quantity,
            target_price: order.negotiatedPrice || order.quotedPrice || 0,
            max_acceptable_price:
              (order.negotiatedPrice || order.quotedPrice || 0) * 1.1,
            urgency: order.isEmergency ? "high" : "normal",
            channel_preference: "email",
          },
        );
        this.logger.log(`Conversation intent published for order ${orderId}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to publish conversation intent: ${err?.message}`,
        );
      }
    }

    return order;
  }

  /* ── The seal on an order ───────────────────────────────────────────────── */

  /**
   * Mint the proof, at the moment the hold BEGINS.
   *
   * =========================================================================
   * WHY A SEAL ON AN ORDER IS NOW REDEEMED RATHER THAN ASSERTED
   * =========================================================================
   * ADR 0116 gave `POST orders/:id/approve` a real gate: the house's own
   * thresholds, the actor's role, a refusal in words. What it could not give
   * was evidence that a PERSON did this. The hold-to-approve gesture lived
   * entirely in the browser and left no trace the server could check, so
   * anything holding a manager's session — a stolen token, a script, an agent
   * with more autonomy than anybody granted it — could seal an order by
   * calling the endpoint. ADR 0114 was explicit that its seal was "an assertion
   * by an authenticated manager, recorded with their id — not a cryptographic
   * proof of the gesture". The founder's decision of 2026-09-04 closes that for
   * orders and for payments.
   *
   * THE ROLE IS CHECKED HERE **AND** AGAIN AT REDEMPTION. Not once: a manager
   * demoted between the two must not be able to spend a token they were
   * legitimately given, and a manager who could never have sealed this order
   * must not be handed a seal that will be refused two seconds later — that
   * teaches people the seal is decoration.
   *
   * THE ORDER'S MONEY IS HASHED INTO THE SEAL (`order-seal.ts`), so a token
   * minted over an order of 2,000 cannot be spent after somebody made it
   * 20,000. That is the property the assertion model had no way to express.
   */
  async issueOrderSealChallenge(
    restaurantId: string,
    orderId: string,
    userId: string,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    if (!this.sealChallenges) {
      throw new InternalServerErrorException(
        "The seal could not be issued (the seal service is not wired into procurement), " +
          "so nothing can be approved. This is a gateway fault, not a decision about this order.",
      );
    }

    // Everything that would refuse the approval refuses the SEAL, first.
    await this.assertApprovalAllowed(restaurantId, orderId, userId);

    const args = await this.readOrderSealArgs(restaurantId, orderId);
    const issued = await this.sealChallenges.issue({
      restaurantId,
      actorUserId: userId,
      subjectKind: "procurement_order",
      subjectId: orderId,
      action: ORDER_SEAL_ACT,
      args,
    });
    return {
      challenge: issued.challenge,
      expiresAt: issued.expiresAt,
      act: issued.action,
    };
  }

  /**
   * Spend it. Throws with the whole sentence on every refusal.
   *
   * Runs AFTER `assertApprovalAllowed` and BEFORE the write. After, so a person
   * whose role cannot seal this order is told that rather than having their
   * seal burned by a request that was never going to succeed. Before, so the
   * status is never written on an unproven seal.
   */
  private async redeemOrderSeal(
    restaurantId: string,
    orderId: string,
    userId: string,
    challenge: string | null | undefined,
  ): Promise<void> {
    if (!this.sealChallenges) {
      // Refuse, never seal. A seal check that vanishes with its own dependency
      // is the [[absence-reported-as-health]] fault pointed at money.
      throw new InternalServerErrorException(
        "The seal could not be checked (the seal service is not wired into procurement), " +
          "so nothing was approved. This is a gateway fault, not a decision about this order.",
      );
    }

    const args = await this.readOrderSealArgs(restaurantId, orderId);
    await this.sealChallenges.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "procurement_order",
      subjectId: orderId,
      action: ORDER_SEAL_ACT,
      args,
      challenge: challenge ?? null,
    });
  }

  /**
   * Read the facts the seal is taken over. ONE reader, used by both ends —
   * two readers is how issue and redemption learn to disagree.
   */
  private async readOrderSealArgs(
    restaurantId: string,
    orderId: string,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id, total_cost, provider_id")
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(
        `The order could not be read, so the seal could not be taken over its own figures: ${error.message}`,
      );
    }
    if (!data) {
      throw new NotFoundException(
        "No order with that id belongs to this restaurant, so there was nothing to seal.",
      );
    }
    const row = data as {
      id: string;
      total_cost: string | number | null;
      provider_id: string | null;
    };
    return orderSealArgs({
      id: row.id,
      total: row.total_cost,
      providerId: row.provider_id,
    });
  }

  /* ── The approval gate ──────────────────────────────────────────────────── */

  /**
   * Throw unless this person may seal this order under this house's rules.
   *
   * Returns quietly when the seal is allowed. Every refusal path throws with a
   * whole sentence; none of them returns a boolean, because a boolean is a
   * thing a caller can forget to check.
   */
  private async assertApprovalAllowed(
    restaurantId: string,
    orderId: string,
    userId: string,
  ): Promise<void> {
    // The gate cannot open when it cannot see. `ProcurementModule` imports both
    // modules, so this is unreachable in the running gateway — it exists so a
    // future wiring mistake refuses loudly instead of sealing silently.
    if (!this.approvalThresholds || !this.organizations) {
      throw new InternalServerErrorException(
        "The approval policy could not be consulted (the thresholds service is not wired into procurement), " +
          "so nothing was sealed. This is a gateway fault, not a decision about this order.",
      );
    }

    const { data: orderRow, error: orderError } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id, total_cost, provider_id, inventory_id, final_price, status")
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      throw new InternalServerErrorException(
        `The order could not be read, so its amount could not be tested against this house's rules: ${orderError.message}`,
      );
    }
    if (!orderRow) {
      throw new NotFoundException(
        "No order with that id belongs to this restaurant, so there was nothing to approve.",
      );
    }

    const readout = await this.approvalThresholds.read(restaurantId);
    if (!readout.readable) {
      // An unreadable policy is NOT an empty policy. See the method header.
      throw new InternalServerErrorException(
        `This house's approval rules could not be read (${readout.reason ?? "no reason given"}), ` +
          "so nothing was sealed. A rule that cannot be read is not a rule that does not exist.",
      );
    }

    const row = orderRow as {
      total_cost: string | number | null;
      provider_id: string | null;
      inventory_id: string | null;
      final_price: string | number | null;
      status: string | null;
    };

    const order: OrderUnderTest = {
      total: toFiniteNumber(row.total_cost),
      isFirstOrderToVendor: await this.isFirstOrderToVendor(
        restaurantId,
        orderId,
        row.provider_id,
      ),
      pricePremiumPct: await this.pricePremiumPct(
        restaurantId,
        orderId,
        row.inventory_id,
        toFiniteNumber(row.final_price),
      ),
    };

    const decision = decideApproval(readout.thresholds, order);
    if (!decision.requiredRole) return; // No rule fired — seal as before.

    const actorRole = await this.organizations.resolveRestaurantRole(
      userId,
      restaurantId,
    );
    if (roleSatisfies(actorRole, decision.requiredRole)) return;

    await this.parkOrderAwaitingApproval(restaurantId, orderId, row.status);

    const sentence = refusalSentence(decision, actorRole);
    const receipt = await recordApprovalRefusal(
      this.databaseService.supabase as never,
      this.logger,
      {
        restaurantId,
        orderId,
        actorUserId: userId,
        actorRole,
        requiredRole: decision.requiredRole,
        firedBy: decision.firedBy,
        reasons: decision.reasons,
        untestable: decision.untestable,
        total: order.total,
        sentence,
      },
    );
    if (!receipt.audited) {
      this.logger.error(
        `ORDER_APPROVAL_REFUSAL_UNRECORDED order=${orderId} restaurant=${restaurantId} — ` +
          `${receipt.reason}. The refusal stands; the paper did not.`,
      );
    }

    throw new ForbiddenException(sentence);
  }

  /**
   * What every pending order in this house needs, and whether the caller can
   * give it — the read behind `/orders`' honest ceremony.
   *
   * ONE query set for the whole house rather than one call per row: the facts
   * the rules test (first-order-ness, the premium over the last price paid) are
   * a single forward walk through the order ledger, exactly as the settings
   * register's retrospective computes them. Asking per row would recompute that
   * walk once per row and still not agree with itself.
   *
   * The page uses this to render the ceremony DISABLED with the reason in
   * words. It is a courtesy, not a gate: `approveOrder` refuses independently,
   * and the page prints that refusal too.
   */
  async approvalGate(
    restaurantId: string,
    userId: string,
  ): Promise<{
    restaurantId: string;
    callerRole: string | null;
    policySet: boolean;
    policyNote: string;
    readable: boolean;
    reason: string | null;
    orders: Array<{
      orderId: string;
      requiredRole: "owner" | "manager" | null;
      firedBy: string[];
      reasons: string[];
      untestable: string[];
      mayApprove: boolean;
      sentence: string | null;
    }>;
  }> {
    const base = {
      restaurantId,
      callerRole: null as string | null,
      policySet: false,
      policyNote: policyNote(false),
      readable: false,
      reason: null as string | null,
      orders: [] as Array<{
        orderId: string;
        requiredRole: "owner" | "manager" | null;
        firedBy: string[];
        reasons: string[];
        untestable: string[];
        mayApprove: boolean;
        sentence: string | null;
      }>,
    };

    if (!this.approvalThresholds || !this.organizations) {
      return {
        ...base,
        reason:
          "the thresholds service is not wired into procurement, so this house's rules could not be consulted",
      };
    }

    const readout = await this.approvalThresholds.read(restaurantId);
    if (!readout.readable) {
      return { ...base, reason: readout.reason };
    }

    const callerRole = await this.organizations.resolveRestaurantRole(
      userId,
      restaurantId,
    );

    const walk = await this.walkOrdersUnderTest(restaurantId);
    if (!walk.readable) {
      return {
        ...base,
        callerRole,
        policySet: !readout.policyEmpty,
        policyNote: policyNote(!readout.policyEmpty),
        reason: walk.reason,
      };
    }

    const orders = walk.rows
      .filter((r) => PENDING_APPROVAL_STATUSES.has((r.status ?? "").toUpperCase()))
      .map((r) => {
        const decision: ApprovalDecision = decideApproval(readout.thresholds, r.test);
        const mayApprove =
          decision.requiredRole === null ||
          roleSatisfies(callerRole, decision.requiredRole);
        return {
          orderId: r.id,
          requiredRole: decision.requiredRole,
          firedBy: decision.firedBy,
          reasons: decision.reasons,
          untestable: decision.untestable,
          mayApprove,
          sentence: mayApprove ? null : refusalSentence(decision, callerRole),
        };
      });

    return {
      restaurantId,
      callerRole,
      policySet: !readout.policyEmpty,
      policyNote: policyNote(!readout.policyEmpty),
      readable: true,
      reason: null,
      orders,
    };
  }

  /**
   * Park a refused order where the row itself says it is waiting.
   *
   * `APPROVAL_NEEDED` is an existing member of `ProcurementOrderStatus` and the
   * column is a plain `varchar(50)` with no CHECK
   * (`baseline_from_production.sql:4527`), so this introduces no new vocabulary
   * and no migration. Only a `PENDING` order is moved: an order already in
   * `APPROVAL_NEEDED`, `NEGOTIATING` or anything further along must not be
   * rewound by somebody pressing a button they were never going to be allowed
   * to press.
   *
   * A failure here is logged and swallowed. The refusal is the answer; failing
   * to write the waiting state must not turn a 403 into a 500 and tell the
   * person something false about why they were stopped.
   */
  private async parkOrderAwaitingApproval(
    restaurantId: string,
    orderId: string,
    currentStatus: string | null,
  ): Promise<void> {
    if ((currentStatus ?? "").toUpperCase() !== ProcurementOrderStatus.PENDING) {
      return;
    }
    try {
      const { error } = await this.databaseService.supabase
        .from("procurement_orders")
        .update({ status: ProcurementOrderStatus.APPROVAL_NEEDED })
        .eq("restaurant_id", restaurantId)
        .eq("id", orderId);
      if (error) {
        this.logger.error(
          `ORDER_NOT_PARKED order=${orderId} — ${error.message}. The seal was refused; the row still reads PENDING.`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `ORDER_NOT_PARKED order=${orderId} — ${err?.message}. The seal was refused; the row still reads PENDING.`,
      );
    }
  }

  /**
   * Has this house ordered from this vendor before THIS order?
   *
   * `null` when it cannot be told — no vendor on the row, or a read that failed.
   * Never `false`: `decideApproval` treats `null` as untestable and refuses to
   * fire `new_vendor` on it, which is the difference between a rule and a rule
   * that fires during a database outage.
   */
  private async isFirstOrderToVendor(
    restaurantId: string,
    orderId: string,
    providerId: string | null,
  ): Promise<boolean | null> {
    if (!providerId) return null;
    try {
      const { count, error } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("provider_id", providerId)
        .neq("id", orderId);
      if (error || count === null || count === undefined) return null;
      return count === 0;
    } catch {
      return null;
    }
  }

  /**
   * How far above the last unit price this house paid for the same item.
   *
   * `null` when there is no earlier price — a first purchase has no premium, it
   * has no comparison at all, and `new_vendor` is the rule that covers it.
   */
  private async pricePremiumPct(
    restaurantId: string,
    orderId: string,
    inventoryId: string | null,
    unitPrice: number | null,
  ): Promise<number | null> {
    if (!inventoryId || unitPrice === null || unitPrice <= 0) return null;
    try {
      const { data, error } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("final_price, requested_at")
        .eq("restaurant_id", restaurantId)
        .eq("inventory_id", inventoryId)
        .neq("id", orderId)
        .order("requested_at", { ascending: false })
        .limit(1);
      if (error) return null;
      const prior = toFiniteNumber(
        (data as Array<{ final_price: string | number | null }> | null)?.[0]
          ?.final_price ?? null,
      );
      if (prior === null || prior <= 0) return null;
      return ((unitPrice - prior) / prior) * 100;
    } catch {
      return null;
    }
  }

  /**
   * The order ledger walked forward once, reduced to the facts the rules test.
   *
   * Same window and same arithmetic as `ApprovalThresholdsService`'s
   * retrospective, and the caveat travels with it: a "first order" is first
   * among the orders inside the window, so a vendor last used two years ago
   * reads as new here.
   */
  private async walkOrdersUnderTest(restaurantId: string): Promise<{
    rows: Array<{ id: string; status: string | null; test: OrderUnderTest }>;
    readable: boolean;
    reason: string | null;
  }> {
    const since = new Date(
      Date.now() - APPROVAL_GATE_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    try {
      const { data, error } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("id, status, provider_id, inventory_id, requested_at, total_cost, final_price")
        .eq("restaurant_id", restaurantId)
        .gte("requested_at", since)
        .order("requested_at", { ascending: true })
        .limit(4000);
      if (error) {
        return { rows: [], readable: false, reason: error.message };
      }
      const seenVendors = new Set<string>();
      const lastPriceByItem = new Map<string, number>();
      const rows: Array<{ id: string; status: string | null; test: OrderUnderTest }> = [];
      for (const raw of (data ?? []) as Array<{
        id: string;
        status: string | null;
        provider_id: string | null;
        inventory_id: string | null;
        total_cost: string | number | null;
        final_price: string | number | null;
      }>) {
        const vendor = raw.provider_id;
        const isFirst = vendor ? !seenVendors.has(vendor) : null;
        if (vendor) seenVendors.add(vendor);

        const unit = toFiniteNumber(raw.final_price);
        let premium: number | null = null;
        if (raw.inventory_id && unit !== null && unit > 0) {
          const prior = lastPriceByItem.get(raw.inventory_id);
          if (prior !== undefined && prior > 0) {
            premium = ((unit - prior) / prior) * 100;
          }
          lastPriceByItem.set(raw.inventory_id, unit);
        }

        rows.push({
          id: raw.id,
          status: raw.status,
          test: {
            total: toFiniteNumber(raw.total_cost),
            isFirstOrderToVendor: isFirst,
            pricePremiumPct: premium,
          },
        });
      }
      return { rows, readable: true, reason: null };
    } catch (err: any) {
      return { rows: [], readable: false, reason: err?.message ?? String(err) };
    }
  }

  async markDelivered(
    restaurantId: string,
    orderId: string,
    userId: string,
    quantityReceived?: number,
  ): Promise<OrderResponseDto> {
    // What the ledger is about to be told, decided ONCE and written down in the
    // same breath. `resolvedQuantity` below used to be computed separately and
    // the column written as `quantityReceived ?? null` — so the web client,
    // which sends no quantity (useOrdersData.ts:68), booked `order.quantity`
    // into the ledger and left the column NULL.
    //
    // That gap is the door's anti-double-book guard, defeated. recordDoorReceipt
    // reads `alreadyBooked = Number(order.quantity_received ?? 0)`
    // (receiving.service.ts:194) to work out what is left to book; a NULL reads
    // as 0, so the door books the full count a second time on top of what this
    // method already booked. The column has to record what was BOOKED, not what
    // the caller happened to say.
    //
    // Read before the update so `resolvedQuantity` is available to write. A
    // failed read is raised, not defaulted to 0: silently booking nothing and
    // recording nothing is how this defect stayed invisible the first time.
    const { data: existingOrder, error: existingError } =
      await this.databaseService.supabase
        .from("procurement_orders")
        .select("quantity")
        .eq("restaurant_id", restaurantId)
        .eq("id", orderId)
        .maybeSingle();

    if (existingError) {
      this.logger.error("Failed to read order before marking delivered", {
        restaurantId,
        orderId,
        error: existingError.message,
      });
      throw existingError;
    }
    if (!existingOrder) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const resolvedQuantity =
      quantityReceived ?? (existingOrder as any).quantity ?? 0;

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({
        status: ProcurementOrderStatus.DELIVERED,
        delivered_at: new Date().toISOString(),
        received_by: userId,
        quantity_received: resolvedQuantity,
      })
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error("Failed to mark procurement order delivered", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    const row = data as any;
    const orderRow: ProcurementOrderRow = {
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    };

    const order = this.mapOrderRow(orderRow);

    if (!order.inventoryId) {
      this.logger.warn(
        `markDelivered: order ${orderId} has no inventoryId — stock update skipped`,
      );
    } else if (resolvedQuantity <= 0) {
      this.logger.warn(
        `markDelivered: order ${orderId} resolved quantity is ${resolvedQuantity} — stock update skipped`,
      );
    }

    if (order.inventoryId && resolvedQuantity > 0) {
      const idempotencyKey = `order-delivered:${orderId}`;
      const { data: existingEvent } = await this.databaseService.supabase
        .from("inventory_events")
        .select("id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (!existingEvent) {
        try {
          const { data: inventoryRow, error: inventoryError } =
            await this.databaseService.supabase
              .from("restaurant_inventory")
              .select("master_wine_id")
              .eq("restaurant_id", restaurantId)
              .eq("id", order.inventoryId)
              .single();

          const masterWineId = inventoryError
            ? null
            : inventoryRow?.master_wine_id;

          if (masterWineId) {
            // Move shadow -> live through the ledger RPC (lots = source of truth). Two idempotent
            // movements: release the reserved shadow, then receive the physical lot at cost.
            const { data: currentStock } = await this.databaseService.supabase
              .from("restaurant_inventory")
              .select("shadow_stock, in_transit_quantity")
              .eq("restaurant_id", restaurantId)
              .eq("id", order.inventoryId)
              .single();

            const currentShadow = currentStock?.shadow_stock ?? 0;
            const currentInTransit = currentStock?.in_transit_quantity ?? 0;
            const shadowRelease = Math.min(resolvedQuantity, currentShadow);

            // WHAT KIND OF PRICE THIS IS.
            //
            // `final_price` is the price we AGREED at ordering time. Nobody has
            // read an invoice at this point — markDelivered runs when the goods
            // arrive, and verifyReceipt is the step where a human compares the
            // vendor's document against what is on the floor. So this number is
            // an expectation, and the lot must say so.
            //
            // It used to be passed with no provenance at all, and
            // apply_stock_movement inferred `'invoice'` from the mere presence
            // of a number — so every delivery booked a lot stamped
            // invoice-verified, `inventory_lot_rollup.has_invoice_cost` went
            // true, and analytics labelled the PO's own quote "invoiced lot
            // WAC". `receiving.service.ts:215-218` refuses to guess a cost for
            // exactly this reason; this path guessed one and then dressed it up.
            //
            // A `suggested_price` fallback was also read off the order row
            // here. `procurement_orders` has no such column (production
            // information_schema, 2026-09-02:
            // the price columns are final_price, negotiated_price,
            // quoted_price, invoice_unit_price, final_confirmed_cost,
            // prefilled_invoice_unit_price) — so it was always `undefined` and
            // the `??` chain fell through it silently. Reading a column that
            // does not exist is not a fallback, it is a no-op wearing one.
            const unitCost = row.final_price ?? null;
            const costProvenance = unitCost == null ? null : "estimated";

            if (shadowRelease > 0) {
              await this.databaseService.supabase.rpc("apply_stock_movement", {
                p_inventory_id: order.inventoryId,
                p_stock_state: "shadow",
                p_delta: -shadowRelease,
                p_transaction_type: "adjustment",
                p_source: "order",
                p_reason: "shadow released on delivery",
                p_order_id: orderId,
                p_idempotency_key: `order-delivered-shadow:${orderId}`,
              });
            }
            await this.databaseService.supabase.rpc("apply_stock_movement", {
              p_inventory_id: order.inventoryId,
              p_stock_state: "live",
              p_delta: resolvedQuantity,
              p_transaction_type: "purchase",
              p_source: "order",
              p_reason: "order delivered — physical receipt",
              p_unit_cost: unitCost,
              p_cost_provenance: costProvenance,
              p_order_id: orderId,
              p_idempotency_key: `order-delivered-live:${orderId}`,
            });

            // in_transit_quantity is a separate denormalized display counter.
            await this.databaseService.supabase
              .from("restaurant_inventory")
              .update({
                in_transit_quantity: Math.max(
                  0,
                  currentInTransit - resolvedQuantity,
                ),
              })
              .eq("restaurant_id", restaurantId)
              .eq("id", order.inventoryId);
          }

          await this.databaseService.supabase.from("inventory_events").insert({
            restaurant_id: restaurantId,
            inventory_id: order.inventoryId,
            master_wine_id: masterWineId ?? null,
            event_type: "order_delivered",
            quantity_change: resolvedQuantity,
            source: "procurement",
            idempotency_key: idempotencyKey,
            metadata: {
              orderId,
              deliveredAt: order.deliveredAt,
            },
          });
        } catch (eventError) {
          this.logger.warn(
            "Failed to record inventory event for delivered order",
            {
              orderId,
              error: eventError?.message ?? eventError,
            },
          );
        }
      }
    }

    // Update calendar event to COMPLETED on delivery
    await this.updateCalendarEventForDelivery(restaurantId, orderId, order);

    // Emit order_change event for cross-page sync (triggers inventory update)
    await this.emitOrderChangeEvent(restaurantId, userId, order, "delivered");

    // Pinned receipt-verification task: stock is already in (above), but a human
    // must confirm the physical count against the vendor's digital invoice.
    // Critical priority keeps it at the top of the inbox until verified; the
    // group key lets verifyReceipt() resolve it for every member at once.
    if (this.notificationsService) {
      await this.notificationsService.persistForRestaurant(
        restaurantId,
        {
          type: "invoice_received",
          title: `Verify delivery: ${order.wineName || order.orderNumber || "order"}`,
          message: `${resolvedQuantity} bottles stocked in. Confirm the physical count against the vendor invoice.`,
          priority: "critical",
          actionUrl: `/inventory?verify=${orderId}`,
          actionLabel: "Verify receipt",
          groupKey: `receipt_verify:${orderId}`,
          metadata: {
            orderId,
            inventoryId: order.inventoryId,
            wineName: order.wineName,
            quantity: resolvedQuantity,
            providerId: order.providerId,
          },
        },
        { dedupeWithinMinutes: 24 * 60 },
      );
    }

    return order;
  }

  /**
   * Apply one signed correction to live stock through the ledger.
   * The idempotency key is per (order, inventory) so a replayed request — the mobile
   * outbox retries — can never double-count.
   */
  /**
   * Open a vendor credit claim from a match verdict.
   *
   * The claim is opened, never sent. Contacting a distributor stays a human act
   * behind the existing draft-then-approve flow, in line with every other
   * outbound path in this codebase.
   *
   * Deliberately silent about what it declines to claim: draftClaimFromMatch
   * returns null for `partial` and `unmatched` (paperwork still in flight, not a
   * vendor error) and for any discrepancy whose amount cannot be computed. A $0
   * claim in a distributor's inbox costs more credibility than it recovers.
   */
  private async openCreditClaim(
    restaurantId: string,
    orderId: string,
    userId: string,
    match: MatchResult,
  ): Promise<void> {
    try {
      const claim = draftClaimFromMatch(match);
      if (!claim) return;

      const { error } = await this.databaseService.supabase
        .from("procurement_credits")
        .insert({
          restaurant_id: restaurantId,
          order_id: orderId,
          reason: claim.reason,
          summary: claim.summary,
          claimed_amount: claim.claimedAmount,
          // True only when the vendor's own packing slip proves the overbill.
          // Worth knowing which claims are winnable before spending a call.
          self_evidenced: claim.selfEvidenced,
          state: "open",
          opened_by: userId,
          // Snapshot: the order can be corrected later, and the claim must still
          // be able to say what it was based on when it was raised.
          evidence: match as unknown as Record<string, unknown>,
        });

      // 23505 = a claim for this line and reason is already open. Re-running the
      // match must not manufacture a second claim for money already being
      // chased — that would double-count recovery and embarrass the restaurant.
      if (error && error.code !== "23505")
        this.logger.warn(
          `openCreditClaim failed for order ${orderId}: ${error.message}`,
        );
    } catch (err: any) {
      this.logger.warn(`openCreditClaim threw for ${orderId}: ${err?.message}`);
    }
  }

  /**
   * @param unitCost What the bottle VERIFIABLY cost, from the invoice — landed,
   *   including allocated freight and fees. Passing it is the difference between
   *   a match that means something and a match that is decoration: without it
   *   the lot keeps the price we hoped for at ordering time, so catching a $2
   *   overcharge changes a badge on a screen and leaves inventory valuation,
   *   WAC, pour cost and COGS all still quoting the old number. Non-null only
   *   when an invoice was actually read (`computeMatch` returns
   *   `effectiveUnitCost = null` without one), which is why `'invoice'` is a
   *   safe provenance for it and would not be for anything markDelivered has.
   * @param userId Who verified the receipt. Recorded on the revaluation so the
   *   valuation change has an author. Resolves to `public.users(user_id)` —
   *   `auth.users` is a disjoint table and an FK to it 23503s on every write.
   */
  private async applyReceiptAdjustment(
    restaurantId: string,
    orderId: string,
    inventoryId: string,
    delta: number,
    reason: string,
    unitCost?: number | null,
    userId?: string | null,
  ): Promise<void> {
    // TENANCY. `apply_stock_movement` derives restaurant_id from the inventory
    // row it is pointed at, not from the caller — so an id this method does not
    // check is an id that writes stock wherever it happens to live. The
    // adjustments array arrives from the client, which means the caller chooses
    // the id. Every one of them is proven to belong to THIS restaurant here,
    // before the RPC, because this method is the only choke point both the
    // matched line and the free-form adjustments pass through.
    //
    // The DTO's @IsUUID only rejects ids that are not UUID-shaped. A well-formed
    // UUID belonging to another restaurant is exactly the case that matters, and
    // no decorator can see it.
    const { data: owned, error: ownershipError } =
      await this.databaseService.supabase
        .from("restaurant_inventory")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("id", inventoryId)
        .maybeSingle();

    // A failed lookup is NOT permission. Saying so out loud rather than falling
    // through is the whole point (ADR 0051): the alternative reports the absence
    // of an answer as a yes.
    if (ownershipError) {
      this.logger.error(
        `verifyReceipt ownership check failed for ${inventoryId}: ${ownershipError.message}`,
      );
      throw new UnprocessableEntityException(
        `Could not confirm that item ${inventoryId} belongs to this restaurant, ` +
          `so no stock was moved: ${ownershipError.message}`,
      );
    }

    if (!owned) {
      this.logger.warn(
        `verifyReceipt rejected a foreign inventory id on order ${orderId}: ${inventoryId}`,
      );
      throw new ForbiddenException(
        `Item ${inventoryId} does not belong to this restaurant. ` +
          `A receipt adjustment can only move stock on this restaurant's own ` +
          `inventory, so nothing was written.`,
      );
    }

    // QUANTITY FIRST, THEN PRICE. The two are separate writes because they are
    // separate facts: `apply_stock_movement` only ever creates or consumes
    // bottles, and `revalue_lot` only ever restates what bottles cost.
    //
    // Order matters. A negative delta consumes lots FIFO, so revaluing before
    // adjusting would restate lots that are about to be deleted and the
    // revaluation receipt would overstate what it covered.
    if (delta !== 0) {
      const { error } = await this.databaseService.supabase.rpc(
        "apply_stock_movement",
        {
          p_inventory_id: inventoryId,
          p_stock_state: "live",
          p_delta: delta,
          p_transaction_type: "adjustment",
          // `inventory_transaction_source` is exactly (pos, manual, order,
          // mobile_count, reconciliation, system, import, api) — read from
          // production 2026-09-02. There is no 'receiving'. The RPC casts
          // `p_source::inventory_transaction_source`, so this raised on EVERY
          // call and verifyReceipt returned 422 for every stock correction it
          // ever attempted. `receiving.service.ts:205-212` hit the identical
          // bug on the door path and settled on 'order' — a receipt correction
          // is sourced from a procurement order in exactly the same sense.
          //
          // `verify-receipt.spec.ts` stubs rpc() as always-succeeds, which is
          // why the enum never got a chance to say no. `lot-cost-truth.spec.ts`
          // checks these literals against the enum in the production dump
          // instead of against a mock.
          p_source: "order",
          p_reason: reason,
          // A price only rides along when it CREATES bottles: those extra
          // bottles are covered by the same invoice, so the lot is genuinely
          // invoice-priced. On a negative delta the price would land on a
          // ledger row nothing values stock from, so it is left off entirely
          // and the correction below carries it to the lot instead.
          p_unit_cost: delta > 0 ? (unitCost ?? null) : null,
          p_cost_provenance: delta > 0 && unitCost != null ? "invoice" : null,
          p_order_id: orderId,
          p_idempotency_key: `receipt-verify:${orderId}:${inventoryId}`,
        },
      );
      if (error) {
        this.logger.error(
          `verifyReceipt adjustment failed for ${inventoryId}: ${error.message}`,
        );
        throw new UnprocessableEntityException(
          `Adjustment failed for item ${inventoryId}: ${error.message}`,
        );
      }
    }

    // THE CORRECTION ITSELF.
    //
    // Before this, a verified invoice price could not reach the lot it
    // corrected. A negative ledgerDelta only DELETEd lots, so the price landed
    // on a ledger row and inventory valuation kept quoting the estimate. A
    // positive one created a SECOND lot at invoice cost beside the estimated
    // original, and `inventory_lot_rollup.wac` blended the guess with the
    // correction forever — under the label "invoiced lot WAC". A zero delta,
    // the commonest case of all (the count matched, only the price differed),
    // wrote nothing anywhere.
    //
    // `revalue_lot` restates the lots THIS order created, preserving the prior
    // cost in `inventory_lot_revaluations` rather than overwriting it.
    if (unitCost != null) {
      const { data: receipt, error: revalError } =
        await this.databaseService.supabase.rpc("revalue_lot", {
          p_inventory_id: inventoryId,
          p_source_order_id: orderId,
          p_unit_cost: unitCost,
          p_cost_provenance: "invoice",
          p_performed_by: userId ?? null,
          p_reason: reason,
        });

      if (revalError) {
        this.logger.error(
          `verifyReceipt revaluation failed for ${inventoryId}: ${revalError.message}`,
        );
        throw new UnprocessableEntityException(
          `The count was corrected but the price was not, for item ${inventoryId}: ${revalError.message}`,
        );
      }

      // A revaluation that reached nothing is reported, not assumed away. It
      // is a legitimate outcome — every bottle from this delivery has already
      // been poured — but "the correction covered no bottles" and "the
      // correction covered them all" must not look identical in the log.
      const covered = (receipt as any)?.lots_revalued ?? 0;
      const matched = (receipt as any)?.lots_matched ?? 0;
      if (matched === 0) {
        this.logger.warn(
          `verifyReceipt: no live lot from order ${orderId} remains for ${inventoryId}, ` +
            `so the verified unit cost ${unitCost} was recorded on the order but corrected no stock.`,
        );
      } else {
        this.logger.log({
          message: "Receipt verification revalued stock",
          orderId,
          inventoryId,
          unitCost,
          lotsMatched: matched,
          lotsRevalued: covered,
          bottlesRevalued: (receipt as any)?.bottles_revalued ?? 0,
        });
      }
    }
  }

  /**
   * RECEIPT VERIFICATION — three-way match (PO <-> Invoice <-> Receipt).
   *
   * Delivery already stocked bottles in at invoice quantity; this is the audit layer that
   * reconciles what we ordered, what the vendor billed, and what physically arrived.
   * computeMatch() decides the verdict server-side — the client never dictates the outcome.
   *
   * Two payload shapes are supported on purpose:
   *  - Legacy `{ adjustments }` only: the mobile receive screen queues requests in an
   *    offline outbox, so payloads composed before this shipped can still arrive. They keep
   *    exactly the old behavior (apply deltas, complete the order).
   *  - Match payload: quantities/prices are reconciled, the order completes or stays open
   *    as PARTIALLY_RECEIVED with a backorder, and any discrepancy alerts the manager.
   */
  async verifyReceipt(
    restaurantId: string,
    orderId: string,
    userId: string,
    body: VerifyReceiptDto,
  ): Promise<OrderResponseDto> {
    const adjustments = (body.adjustments || []).filter(
      (a) => a.inventoryId && Number.isFinite(a.delta) && a.delta !== 0,
    );

    // Every quantity on this payload has a canonical unit-declaring name and a
    // deprecated unitless alias. Read them ONCE, here, through the helper that
    // refuses a disagreeing pair — so nothing below can reach past it to
    // `body.acceptedQuantity` and reintroduce the ambiguity.
    const invoiceQuantity = readAliasedQuantity({
      canonicalName: "invoiceQuantityInInvoiceUom",
      canonical: body.invoiceQuantityInInvoiceUom,
      aliasName: "invoiceQuantity",
      alias: body.invoiceQuantity,
    });
    const shippedQuantity = readAliasedQuantity({
      canonicalName: "shippedQuantityInShippedUom",
      canonical: body.shippedQuantityInShippedUom,
      aliasName: "shippedQuantity",
      alias: body.shippedQuantity,
    });
    const freeGoodsQuantity = readAliasedQuantity({
      canonicalName: "freeGoodsQuantityInCountedUom",
      canonical: body.freeGoodsQuantityInCountedUom,
      aliasName: "freeGoodsQuantity",
      alias: body.freeGoodsQuantity,
    });
    const acceptedQuantity = readAliasedQuantity({
      canonicalName: "acceptedQuantityInCountedUom",
      canonical: body.acceptedQuantityInCountedUom,
      aliasName: "acceptedQuantity",
      alias: body.acceptedQuantity,
    });
    const rejectedQuantity = readAliasedQuantity({
      canonicalName: "rejectedQuantityInCountedUom",
      canonical: body.rejectedQuantityInCountedUom,
      aliasName: "rejectedQuantity",
      alias: body.rejectedQuantity,
    });
    // The ADR 0059 pre-fill trio. Read through the same gate as their twins:
    // an extraction proposal that could silently disagree with itself would
    // poison the only corpus that can grade the extractor.
    readAliasedQuantity({
      canonicalName: "prefilledInvoiceQuantityInInvoiceUom",
      canonical: body.prefilledInvoiceQuantityInInvoiceUom,
      aliasName: "prefilledInvoiceQuantity",
      alias: body.prefilledInvoiceQuantity,
    });
    readAliasedQuantity({
      canonicalName: "prefilledShippedQuantityInShippedUom",
      canonical: body.prefilledShippedQuantityInShippedUom,
      aliasName: "prefilledShippedQuantity",
      alias: body.prefilledShippedQuantity,
    });
    readAliasedQuantity({
      canonicalName: "prefilledFreeGoodsQuantityInCountedUom",
      canonical: body.prefilledFreeGoodsQuantityInCountedUom,
      aliasName: "prefilledFreeGoodsQuantity",
      alias: body.prefilledFreeGoodsQuantity,
    });

    const hasMatchFields =
      acceptedQuantity != null ||
      invoiceQuantity != null ||
      body.invoiceUnitPrice != null ||
      rejectedQuantity != null;

    const { data: orderRow, error: fetchError } =
      await this.databaseService.supabase
        .from("procurement_orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("id", orderId)
        .single();

    if (fetchError || !orderRow) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    // What was already pushed into the ledger; corrections are relative to it.
    //
    // ⚠️ ITS UNIT IS NOT AGREED, AND THIS LINE ASSUMES ONE. Read this before
    // trusting any verdict this method produces on a door-counted order.
    //
    // Three of the four parties say `procurement_orders.quantity_received` is
    // stated in the ORDER's own unit, beside `quantity`:
    //
    //   * `markDelivered` writes `quantityReceived ?? existingOrder.quantity`
    //     (:1602)
    //   * `updateOrder` writes it from `quantityReceivedInOrderUom` (:1128) —
    //     the DTO field name is itself the claim
    //   * this method writes back `acceptedQty + rejectedQty` in the COUNTED
    //     unit as submitted, and says so (:2353)
    //
    // The fourth writes BOTTLES. `ReceivingService.recordDoorReceipt` sets
    // `quantity_received = totals.receivedBottles` (receiving.service.ts:504),
    // a sum of `counted_qty_bottles - rejected_qty_bottles` (ADR 0062, #228).
    //
    // So on a door-counted order this number is already in bottles, and the
    // line below hands it to `computeMatch` as `stockedQtyInCountedUom`, where
    // `conv(rawStocked, counted)` (invoice-match.ts:558) multiplies it by the
    // pack size a SECOND time. MEASURED by calling `toBottleOperands` /
    // `computeMatch` directly on a 5-case order of a twelve-pack, door-counted
    // at 5 cases, desk-verified at 5, with no `countedUom` sent (neither desk
    // client sends one, so it falls back to the order's `case`):
    //
    //   no invoice on file    accepted 60  stocked 720  ledgerDelta -660  "unmatched"
    //   matching invoice      accepted 60  stocked 720  ledgerDelta -660  "matched"
    //
    // THE INVOICE CHANGES ONLY WHAT THE MANAGER IS TOLD, NOT WHETHER STOCK
    // MOVES. `-660` is identical either way, and the gate at :2267 fires on
    // `match.ledgerDelta !== 0`, so `applyReceiptAdjustment` removes 660
    // bottles from live stock on BOTH paths. (`invoice-match.ts:706` is where
    // an absent invoice becomes "unmatched"; it touches no operand.) With no invoice the screen at
    // least says "unmatched", which a manager might question; with a matching
    // invoice it says "matched", which they would not. The precondition is
    // about detection, not about reachability.
    //
    // The `?? quantity` fallback carries the same assumption for an order
    // nothing has booked at all.
    //
    // NOT REPAIRED HERE, because the repair is a choice between the two
    // writers and it has consequences either way: bottles is the more precise
    // unit and the one the ledger speaks, while the order's unit is what the
    // column name, three writers and every client that renders it assume, and
    // `quantity_received` is an `integer`, so converting bottles→cases rounds
    // a part-case delivery away. Filed for the founder rather than guessed at.
    const stockedQty =
      (orderRow as any).quantity_received ?? (orderRow as any).quantity ?? 0;
    const orderedQty = (orderRow as any).quantity ?? 0;
    const poUnitPrice =
      (orderRow as any).final_price ??
      (orderRow as any).negotiated_price ??
      (orderRow as any).quoted_price ??
      null;

    // The order's own unit, which every comparison below is anchored to. It was
    // sitting on the row this method already reads and was never looked at:
    // `computeMatch` got `quantity` as a bare number, so an order placed in
    // cases of 12 and invoiced in bottles produced a confident wrong verdict.
    const orderUnits = await this.resolveOrderMatchUnits(
      restaurantId,
      orderId,
      orderRow as any,
    );

    // Silence is NOT agreement. An unstated invoice used to be inferred from the
    // PO, which had two consequences: physical_vs_bill compared a number to
    // itself and always passed, and price_verified=true was written for a
    // delivery where nobody had looked at a document. That is a manufactured
    // audit assertion in a column a customer will lean on in a vendor dispute.
    // Absent now means absent, and the verdict comes back `unmatched`.
    //
    // EVERY operand now declares its unit. `computeMatch` converts them all to
    // bottles before it compares anything, and refuses — rather than guessing —
    // a unit it cannot read or a case with no pack size. A refusal reaches the
    // caller as a 400 that names the document; the alternative is the thing this
    // whole change exists to end, a verdict nobody can doubt and nothing can check.
    const matchInput = {
      orderedQtyInOrderedUom: orderedQty,
      orderedUom: orderUnits.unitType,
      orderedBottlesPerUnit: orderUnits.bottlesPerUnit,
      poUnitPrice,
      shippedQtyInShippedUom: shippedQuantity ?? null,
      shippedUom: body.shippedUom ?? null,
      shippedBottlesPerUnit: body.shippedBottlesPerUnit ?? null,
      invoiceQtyInInvoiceUom: invoiceQuantity ?? null,
      invoiceUom: body.invoiceUom ?? null,
      invoiceBottlesPerUnit: body.invoiceBottlesPerUnit ?? null,
      invoiceUnitPrice: body.invoiceUnitPrice ?? null,
      acceptedQtyInCountedUom: acceptedQuantity ?? stockedQty,
      rejectedQtyInCountedUom: rejectedQuantity ?? 0,
      freeGoodsQtyInCountedUom: freeGoodsQuantity ?? 0,
      stockedQtyInCountedUom: stockedQty,
      countedUom: body.countedUom ?? null,
      countedBottlesPerUnit: body.countedBottlesPerUnit ?? null,
      allocatedCharges: body.allocatedCharges ?? 0,
      priceOverrideReason: body.priceOverrideReason ?? null,
    };

    let match: MatchResult | null = null;
    let bottles: ReturnType<typeof toBottleOperands> | null = null;
    if (hasMatchFields) {
      try {
        match = computeMatch(matchInput);
        bottles = toBottleOperands(matchInput);
      } catch (e) {
        if (e instanceof MatchUnitError) {
          // 400, not 500: the caller can fix this by stating the unit. Degrading
          // to a verdict would manufacture exactly the confident wrong answer
          // the unit fields were added to prevent.
          throw new BadRequestException(
            `Cannot verify this receipt: ${e.message}`,
          );
        }
        throw e;
      }
    }
    const hasInvoice = invoiceQuantity != null;

    // A price that differs from the agreed one is never accepted silently (D-B).
    if (match?.requiresOverride) {
      throw new UnprocessableEntityException(
        `${match.summary} Accept the price difference with a reason, or correct the invoice price.`,
      );
    }

    // Correct the ordered line to the accepted count, then apply any unlisted extras.
    //
    // The gate used to be `match.ledgerDelta !== 0` alone, which silently
    // dropped the entire point of the three-way match: when the count was right
    // and only the PRICE was wrong — the commonest discrepancy there is, and
    // the one this screen exists to catch — ledgerDelta is 0, so nothing ran
    // and the verified landed cost never reached the books. A verified price is
    // now reason enough to write, on its own.
    if (
      match &&
      (match.ledgerDelta !== 0 || match.effectiveUnitCost != null) &&
      (orderRow as any).inventory_id
    ) {
      await this.applyReceiptAdjustment(
        restaurantId,
        orderId,
        (orderRow as any).inventory_id,
        match.ledgerDelta,
        `receipt verification for order ${orderId}: ${match.summary}`,
        // Verified landed cost, so the corrected lot carries what the bottle
        // really cost rather than what we expected it to.
        match.effectiveUnitCost,
        userId,
      );
    }

    for (const adj of adjustments) {
      // Skip the ordered line when the match already corrected it.
      if (match && adj.inventoryId === (orderRow as any).inventory_id) continue;
      await this.applyReceiptAdjustment(
        restaurantId,
        orderId,
        adj.inventoryId,
        adj.delta,
        adj.reason ||
          `receipt verification for order ${orderId}${body.note ? `: ${body.note}` : ""}`,
        // No unit cost: a free-form adjustment is a count correction on an item
        // the invoice line does not describe, so there is no verified price to
        // put on it. Passing one would be inventing the number the whole of
        // this change exists to stop inventing.
        null,
        userId,
      );
    }

    // Accepting less than was ordered keeps the order open, so the outstanding bottles stay
    // visible as a backorder instead of stranding phantom shadow stock (D17).
    // An order also stays open when no invoice has arrived. Many distributors
    // bill weekly in arrears — the paper at the door is a packing slip with no
    // prices — so closing on the goods alone would mark the delivery finished
    // before anyone could check what was charged for it, and reconciling late
    // is exactly where the recoverable money lives.
    const awaitingInvoice = match?.verdict === "unmatched";
    const status =
      match && (match.backorderQty > 0 || awaitingInvoice)
        ? ProcurementOrderStatus.PARTIALLY_RECEIVED
        : ProcurementOrderStatus.COMPLETED;

    const update: Record<string, any> = {
      status,
    };

    // `procurement_orders` has NO `notes` column. It has delivery_notes,
    // manager_notes and discrepancy_notes, and this note — what the person
    // holding the delivery typed while verifying it — is a delivery note; the
    // same column `updateOrder` writes `dto.deliveryNotes` into (:934).
    //
    // Writing `notes` was worse than a no-op. `?? undefined` drops the key from
    // the JSON body when no note was typed, so the update only ever reached
    // PostgREST with a `notes` key — and only ever failed — on the runs where a
    // manager DID type one, i.e. exactly the discrepancy runs. By then the
    // ledger correction and the credit claim above have already been written, so
    // a PGRST204 here leaves the order permanently half-verified: status,
    // match_status, accepted_quantity, the invoice_* columns and the price
    // history below never land, and the retry fails identically.
    //
    // Appended rather than assigned. A note left at the door and a note left at
    // verification are two different observations of the same delivery, and the
    // second one silently erasing the first is the kind of data loss nobody
    // reports because nobody sees it happen. `orderRow` is already in hand, so
    // the merge costs no extra read.
    if (body.note != null && String(body.note).trim() !== "") {
      const existingNote = ((orderRow as any).delivery_notes ?? "").trim();
      update.delivery_notes = existingNote
        ? `${existingNote}\n${body.note}`
        : body.note;
    }

    if (match) {
      // These columns sit beside `quantity` and are read back by clients that
      // display the order's own unit, so they stay in the COUNTED unit as
      // submitted — not in the bottle-equivalents the verdict was computed from.
      // Converting them here would silently restate a manager's count.
      const acceptedQty = acceptedQuantity ?? stockedQty;
      const rejectedQty = rejectedQuantity ?? 0;
      Object.assign(update, {
        quantity_received: acceptedQty + rejectedQty,
        accepted_quantity: acceptedQty,
        rejected_quantity: rejectedQty,
        rejected_reason: body.rejectedReason ?? null,
        invoice_quantity: invoiceQuantity ?? null,
        invoice_unit_price: body.invoiceUnitPrice ?? null,
        backorder_quantity: match.backorderQty,
        match_status: match.verdict,
        // NULL, not false, when there was no invoice to verify against: "we
        // checked and it did not match" and "nobody has checked" are different
        // facts, and only one of them is an accusation.
        price_verified: hasInvoice ? match.priceVerified : null,
        price_override_reason: body.priceOverrideReason ?? null,
        discrepancy_notes: isDiscrepancy(match.verdict) ? match.summary : null,
        match_verified_at: new Date().toISOString(),
        match_verified_by: userId,
      });
    }

    // Raise a vendor credit claim when the match found money owed back.
    // Best-effort: a failure here must not strand a delivery that has already
    // been counted, and the claim can be raised again from the discrepancy queue.
    if (match) await this.openCreditClaim(restaurantId, orderId, userId, match);

    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(update)
      .eq("restaurant_id", restaurantId)
      .eq("id", orderId)
      .select("*, inventory:inventory_id(wine_name)")
      .single();

    if (error) {
      this.logger.error(`verifyReceipt status update failed: ${error.message}`);
      throw error;
    }

    // Resolve the pinned notification for every member.
    await this.databaseService.supabase
      .from("notifications")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .eq("group_key", `receipt_verify:${orderId}`)
      .eq("status", "unread");

    // What the vendor actually charged, once a human checked the invoice against
    // the delivery. `effectiveUnitCost` is the landed cost the match computed —
    // the same number written onto the corrected inventory lot — so the price
    // series and the cost of goods agree by construction rather than by luck.
    //
    // Written only when there WAS an invoice: `verdict === 'unmatched'` means
    // nobody has seen a document, and recording the PO price as an observation
    // of what was charged would manufacture a confirmation that never happened.
    if (match && hasInvoice) {
      const shelfItem = await this.resolveOrderShelfItem(
        restaurantId,
        (orderRow as any).inventory_id,
      );
      await this.recordPriceHistory({
        restaurantId,
        orderId,
        providerId: (orderRow as any).provider_id ?? null,
        masterWineId: shelfItem.masterWineId,
        price: match.effectiveUnitCost ?? body.invoiceUnitPrice,
        source: "receipt_verified",
        // BOTTLES, which is what the `unit: 'BOTTLE'` this table hardcodes has
        // always claimed. It used to be the raw invoice number: on an order
        // billed in cases of 12, a 2 was written into a column labelled BOTTLE,
        // and `effectiveUnitCost` — a per-bottle amount divided by a case count
        // — was written beside it. Both are now genuinely per bottle, so the
        // hardcoded label is true rather than merely constant.
        quantity: bottles?.invoiceQty ?? null,
        notes: `Verified against the invoice: ${match.verdict}.`,
        // The register row, in the INVOICE's own unit — the whole point of ADR
        // 0117's class A. `bottles.units.invoice` is the unit `toBottleOperands`
        // already resolved and already refused if it could not read
        // (`invoice-match.ts:438`), so the pack size here is the one the verdict
        // itself was computed from rather than a second reading of the same
        // document. `body.invoiceUnitPrice` is the number PRINTED on the paper;
        // `effectiveUnitCost` above is that number landed and per-bottle, and
        // putting a converted figure on a sighting is exactly what the register
        // must not hold — `normalizeUnitPrice` converts, once, at read time.
        sighting: {
          vendorName: null,
          productName: shelfItem.wineName,
          unitPrice: body.invoiceUnitPrice ?? null,
          unitLabel: bottles?.units.invoice.uom ?? null,
          packSize: bottles?.units.invoice.bottlesPerUnit ?? null,
          unitVolumeMl: shelfItem.bottleSizeMl,
          // The receipt's own moment. `procurement_documents` carries no
          // issued-date column this path can read, so the date recorded is the
          // one this event actually has: when a person checked the paper. It is
          // an event date, never `now()` stamped onto an undated number.
          observedAt: update.match_verified_at ?? new Date().toISOString(),
        },
      });
    }

    const row = data as any;
    const order = this.mapOrderRow({
      ...row,
      wine_name:
        row.inventory?.wine_name || (row.inventory as any)?.wine?.name || null,
    });

    // The manager hears about a bad delivery immediately, as its own task — the verify
    // task above has just been resolved, so the discrepancy needs its own thread (D-E).
    if (match && isDiscrepancy(match.verdict) && this.notificationsService) {
      await this.notificationsService.persistForRestaurant(
        restaurantId,
        {
          type: "invoice_received",
          title: `Delivery discrepancy: ${order.wineName || order.orderNumber || "order"}`,
          message: match.summary,
          priority: "critical",
          actionUrl: `/inventory?verify=${orderId}`,
          actionLabel: "Review match",
          groupKey: `receipt_discrepancy:${orderId}`,
          metadata: {
            orderId,
            inventoryId: (orderRow as any).inventory_id,
            matchStatus: match.verdict,
            backorderQty: match.backorderQty,
            creditDue: match.creditDue,
            effectiveUnitCost: match.effectiveUnitCost,
            providerId: (orderRow as any).provider_id,
          },
        },
        { dedupeWithinMinutes: 24 * 60 },
      );
    }

    await this.emitOrderChangeEvent(
      restaurantId,
      userId,
      order,
      status === ProcurementOrderStatus.COMPLETED ? "completed" : "updated",
    );

    this.logger.log(
      `Receipt verified for order ${orderId}: verdict=${match?.verdict ?? "legacy"}, ` +
        `status=${status}, adjustments=${adjustments.length}`,
    );
    return order;
  }

  /**
   * Create the expected-delivery calendar event for an order.
   *
   * This function had never once succeeded. It wrote four things
   * `calendar_events` does not accept, and every one of them was invisible
   * because the whole body was a `try`/`catch` that logged a warning:
   *
   *  1. `priority` — the column does not exist (PostgREST `PGRST204`).
   *  2. `tags` — the column does not exist. Identity was JSON-stuffed into it
   *     while the real `order_id`/`provider_id` uuid columns sat unused, both
   *     with foreign keys (`calendar_events_order_id_fkey` →
   *     `procurement_orders`, `calendar_events_provider_id_fkey` →
   *     `providers`) and `idx_calendar_events_provider` on the second.
   *  3. `source` was omitted — it is `varchar(50) NOT NULL` with **no default**
   *     (`supabase/migrations/20260805000000_baseline_from_production.sql:2353`),
   *     so this alone is a `23502` even with the column names corrected.
   *  4. `status: "SCHEDULED"` — not a constraint failure (the column carries no
   *     CHECK), which makes it the worse kind: the write would have *succeeded*
   *     and produced a row no reader recognises. The table's real vocabulary is
   *     `CalendarEventStatus` (pending/approved/dismissed/completed/cancelled);
   *     production holds `active`, `completed`, `pending`, all lowercase, and
   *     has never held `SCHEDULED` in any case.
   *
   * The values chosen here, and why (evidence in ADR 0066):
   *  - `source: system_generated` — one of the two values production actually
   *    holds, and true: not a person, not an inference from a conversation.
   *  - `status: pending` — the column's own default, in `CalendarEventStatus`
   *    (so the calendar's own update endpoint can transition it, which `active`
   *    could not), live in production, and mapped to iCal `TENTATIVE`
   *    (`calendar.service.ts:1276`). A +7-day estimate is exactly tentative.
   *  - `event_type: delivery` — live in production, and the value
   *    `dashboard.service.ts:288` counts `deliveriesThisWeek` on. That counter
   *    has been reading zero for want of this row.
   *
   * On failure this does **not** throw. Its one caller reaches it only after
   * the purchase order has been emailed to the vendor and committed; taking the
   * order down over a calendar row would ask a manager to re-approve an order
   * the vendor already has. But it no longer reads as success either: the
   * failure is `logger.error` with structured context, and the insert selects
   * the new id back so the success branch is unreachable without a row to point
   * at — a bare insert cannot tell "wrote a row" from "wrote nothing", and
   * reporting the second as the first is how this went unnoticed. The id (or
   * `null`) is returned so the omission is enumerable by a caller.
   */
  private async createCalendarEventForOrder(
    restaurantId: string,
    order: OrderResponseDto,
    trigger: "approved" | "created",
  ): Promise<string | null> {
    // Expected delivery: 7 days out. An estimate, not a vendor commitment.
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 7);
    const eventDate = expectedDate.toISOString().split("T")[0];

    // `calendar_events` has no priority column and this change must not add
    // one, so the emergency flag rides in the two human-visible text columns
    // rather than being dropped. title is varchar(255).
    const title = (
      order.isEmergency
        ? `URGENT — Delivery: ${order.orderNumber}`
        : `Delivery: ${order.orderNumber}`
    ).slice(0, 255);

    const description =
      `Expected delivery for order ${order.orderNumber} ` +
      `(${describeOrderedQuantity(order)}). Created on order ${trigger}.` +
      (order.isEmergency ? " Emergency order." : "");

    try {
      const { data, error } = await this.databaseService.supabase
        .from("calendar_events")
        .insert({
          restaurant_id: restaurantId,
          // Identity in the real columns, not a JSON blob in a column that
          // does not exist. Both are FK-checked; providerId may be absent.
          order_id: order.id,
          provider_id: order.providerId ?? null,
          title,
          description,
          event_type: CalendarEventType.DELIVERY,
          event_date: eventDate,
          event_time: "10:00",
          all_day: false,
          source: CalendarEventSource.SYSTEM_GENERATED,
          status: CalendarEventStatus.PENDING,
          reminder_enabled: true,
          reminder_days_before: 1,
        })
        .select("id")
        .single();

      if (error) {
        this.logger.error(
          "Calendar delivery event NOT created for an order that was approved",
          {
            restaurantId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            trigger,
            code: (error as { code?: string }).code,
            error: error.message,
          },
        );
        return null;
      }

      // No error and no row is the shape that hid this defect for its whole
      // life: absence read as health. It is a failure, and it is reported.
      if (!data?.id) {
        this.logger.error(
          "Calendar delivery event insert reported no error and returned no row",
          {
            restaurantId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            trigger,
          },
        );
        return null;
      }

      this.logger.log(
        `Calendar event ${data.id} created for order ${order.orderNumber} delivery`,
      );
      return data.id;
    } catch (e: any) {
      this.logger.error(
        "Calendar delivery event NOT created for an order that was approved",
        {
          restaurantId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          trigger,
          error: e?.message,
        },
      );
      return null;
    }
  }

  /**
   * Close the delivery event when its order arrives (non-fatal).
   *
   * Only a **completed** event is left alone here, so a `cancelled` one is
   * still eligible. That asymmetry with `cancelCalendarEventForOrder` is
   * deliberate and it is the pre-fix intent preserved: an arrival is a
   * physical fact and outranks an earlier administrative cancellation.
   * `markDelivered` does not require the order to be un-cancelled either, so
   * refusing here would leave a delivered order facing a `cancelled` event
   * with nothing to reconcile the two. Cancellation is the weaker claim and
   * yields; delivery is the stronger one and wins.
   */
  private async updateCalendarEventForDelivery(
    restaurantId: string,
    orderId: string,
    order: OrderResponseDto,
  ): Promise<void> {
    return this.closeDeliveryCalendarEvent(restaurantId, orderId, order, {
      status: CalendarEventStatus.COMPLETED,
      leaveAlone: [CalendarEventStatus.COMPLETED],
      description: `Delivered: ${order.orderNumber} (${describeOrderedQuantity(order)}). Actual delivery: ${order.deliveredAt}`,
    });
  }

  async listPendingOrders(restaurantId: string): Promise<OrderResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("*, inventory:inventory_id(wine_name)")
      .eq("restaurant_id", restaurantId)
      .in("status", [
        ProcurementOrderStatus.PENDING,
        ProcurementOrderStatus.APPROVAL_NEEDED,
      ])
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("Failed to list pending orders", {
        restaurantId,
        error: error.message,
      });
      return [];
    }

    return (data || []).map((row: any) => {
      const orderRow: ProcurementOrderRow = {
        ...row,
        wine_name:
          row.inventory?.wine_name ||
          (row.inventory as any)?.wine?.name ||
          null,
      };
      return this.mapOrderRow(orderRow);
    });
  }

  private mapOrderRow(row: ProcurementOrderRow): OrderResponseDto {
    return {
      id: row.id,
      orderNumber: row.order_number,
      restaurantId: row.restaurant_id,
      inventoryId: row.inventory_id,
      providerId: row.provider_id,
      quantity: row.quantity,
      unitType: row.unit_type || undefined,
      bottlesTotal: row.bottles_total ?? undefined,
      quotedPrice: row.quoted_price ?? undefined,
      negotiatedPrice: row.negotiated_price ?? undefined,
      finalPrice: row.final_price ?? undefined,
      totalCost: row.total_cost ?? undefined,
      status: row.status as ProcurementOrderStatus,
      requestedAt: row.requested_at ?? undefined,
      approvedAt: row.approved_at ?? undefined,
      deliveredAt: row.delivered_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      isEmergency: row.is_emergency ?? undefined,
      priorityLevel: row.priority_level ?? undefined,
      wineName: row.wine_name ?? undefined,
    };
  }

  private generateOrderNumber(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const suffix = Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0");
    return `ORD-${year}-${suffix}`;
  }

  // =========================================================================
  // PHASE 32: DRAFT MANAGEMENT
  // =========================================================================

  async approveDraft(
    restaurantId: string,
    orderId: string,
    dto: ApproveDraftDto,
  ): Promise<{ conversationId: string; sentAt: string }> {
    // Fetch conversation + provider email before updating
    const { data: conv, error: fetchError } =
      await this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          "id, content, created_at, gmail_thread_id, message_id, email_headers, providers!left(name, contact_email, contact_first_name, primary_contact), procurement_orders!inner(inventory:inventory_id(wine_name))",
        )
        .eq("restaurant_id", restaurantId)
        .eq("order_id", orderId)
        .eq("status", "PENDING_APPROVAL")
        .single();

    if (fetchError || !conv) {
      this.logger.error("approveDraft fetch failed", {
        restaurantId,
        orderId,
        fetchError: fetchError?.message,
      });
      throw new NotFoundException("No pending draft found for this order");
    }

    // Gate: don't send a draft that's stale because a newer vendor reply just
    // arrived and is still being analyzed.
    if (
      await this.newerReplyStillAnalyzing(orderId, (conv as any).created_at)
    ) {
      throw new BadRequestException(
        "A newer vendor reply just arrived and the AI is still reading it. Please wait a moment and review the updated draft before sending.",
      );
    }

    const rawEmailBody = dto.modifiedContent ?? (conv as any).content ?? "";
    const providerEmail = (conv as any).providers?.contact_email ?? null;
    const rawOrder = (conv as any).procurement_orders;
    const wineName =
      rawOrder?.inventory?.wine_name ?? rawOrder?.wine_name ?? "Wine Order";

    // Reply-threading metadata. AI-generated replies (and any draft created as a
    // reply to an inbound vendor email) carry the original Gmail thread id plus
    // the RFC822 In-Reply-To / References so the approved email lands in the same
    // thread instead of starting a new one. Initial outbound drafts have none of
    // these, so the email is sent fresh exactly as before.
    const emailHeaders = ((conv as any).email_headers ?? {}) as Record<
      string,
      any
    >;
    const subject =
      emailHeaders.subject ||
      (conv as any).subject ||
      `Order Request: ${wineName}`;
    const replyThreadId = (conv as any).gmail_thread_id || undefined;
    const replyInReplyTo = emailHeaders.in_reply_to || undefined;
    const replyReferences = emailHeaders.references || undefined;

    if (!providerEmail) {
      throw new BadRequestException(
        `Provider has no email address — cannot send order email for order ${orderId}`,
      );
    }

    const conversationId = (conv as any).id as string;

    // ── Atomic claim, BEFORE the send ────────────────────────────────────────
    // Two managers tapping "approve" at the same moment both used to pass the
    // status check above and both reached sendProviderEmail — a duplicate
    // purchase order at a real vendor. Claim the row first with a conditional
    // UPDATE off the expected prior state (same pattern as
    // processScheduledAutoSends): exactly one caller can move
    // PENDING_APPROVAL → SENDING, and only the winner sends.
    //
    // The Message-ID is minted here, before the send, and stored on the row as
    // part of the claim. If the process dies mid-send, the id on the row is
    // still the id on the wire, so the message is identifiable in the vendor
    // thread and a duplicate is detectable after the fact.
    //
    // On a RETRY the stored id is reused rather than re-minted. If a previous
    // attempt did deliver despite reporting failure, the vendor's mail server
    // sees the same Message-ID and drops the second copy; a fresh id would
    // arrive as a second, unrelated purchase order. Nothing else ever writes
    // message_id on an outbound draft, so a value here is always a prior
    // attempt of ours.
    const outboundMessageId =
      ((conv as any).message_id as string | null) || this.mintRfc822MessageId();
    const { data: claimed } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "SENDING", message_id: outboundMessageId })
      .eq("id", conversationId)
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .select("id")
      .maybeSingle();

    if (!claimed) {
      // Someone (or something) else already owns this draft. Never send.
      this.logger.warn(
        `approveDraft: draft ${conversationId} for order ${orderId} was already claimed — refusing to send a second copy.`,
      );
      throw new ConflictException(
        "This draft is already being sent (or has been sent). Refresh the order to see its status — do not approve again.",
      );
    }

    // ── Send ─────────────────────────────────────────────────────────────────
    const emailHtml = this.buildEmailHtml(rawEmailBody);
    const attemptedAt = new Date().toISOString();
    let gmailMessageId: string | undefined;
    let gmailThreadId: string | undefined;
    let rfc822MessageId: string | undefined;
    try {
      ({ gmailMessageId, gmailThreadId, rfc822MessageId } =
        await this.sendProviderEmail({
          to: providerEmail,
          cc: dto.ccEmails,
          subject,
          html: emailHtml,
          restaurantId,
          threadId: replyThreadId,
          inReplyTo: replyInReplyTo,
          references: replyReferences,
          recipientFirstName: this.resolveFirstName((conv as any).providers),
          senderName: await this.resolveSenderName(restaurantId),
          messageId: outboundMessageId,
        }));
    } catch (sendError: any) {
      // "The send threw" does NOT mean "the vendor did not get it". A socket
      // timeout, an ECONNRESET, or a hang-up after the server accepted DATA
      // all surface here while the message is already on its way, and the
      // client cannot tell them apart from a real refusal. Handing an
      // ambiguous failure back as PENDING_APPROVAL would re-open this very
      // bug through the error path — a human sees a re-approvable draft, taps
      // again, and the vendor holds two purchase orders. That needs only an
      // ordinary timeout, not two simultaneous taps.
      //
      // So: release only on a positively-identified refusal; park everything
      // else as unconfirmed. The costs are asymmetric — a stuck draft costs a
      // phone call, a duplicate PO costs money and a vendor relationship.
      if (this.isDefiniteSendRefusal(sendError)) {
        await this.releaseSendClaim(conversationId, sendError?.message);
        throw sendError;
      }
      this.logger.error(
        `approveDraft: ambiguous send failure for order ${orderId} (${sendError?.message}) — ` +
          `parking ${conversationId} as SEND_UNCONFIRMED (Message-ID ${outboundMessageId}).`,
      );
      await this.parkSendUnconfirmed(conversationId, attemptedAt);
      throw new InternalServerErrorException(
        `The email for order ${orderId} may or may not have reached the vendor — the send failed in a way that ` +
          `cannot distinguish the two (${sendError?.message}). Message-ID ${outboundMessageId}. ` +
          "Do NOT approve it again; check the vendor thread first.",
      );
    }
    if (gmailThreadId) {
      this.logger.log(
        `Provider email sent to ${providerEmail} for order ${orderId} — threadId: ${gmailThreadId}`,
      );
    }

    // ── Record the outcome ───────────────────────────────────────────────────
    const sentAt = new Date().toISOString();
    const updatePayload: Record<string, any> = {
      sent_at: sentAt,
      status: "SENT",
      ...(gmailMessageId && { gmail_message_id: gmailMessageId }),
      ...(gmailThreadId && { gmail_thread_id: gmailThreadId }),
      message_id: rfc822MessageId || outboundMessageId,
    };
    if (dto.modifiedContent) {
      updatePayload.content = dto.modifiedContent;
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update(updatePayload)
      .eq("id", conversationId)
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "SENDING")
      .select("id, sent_at")
      .single();

    if (error || !data) {
      // The email IS at the vendor. Reverting to PENDING_APPROVAL here is what
      // invited the duplicate tap in the first place — so park the row in
      // SEND_UNCONFIRMED instead: sent, outcome unrecorded, visible to a human,
      // and not re-approvable. If even this write fails the row stays SENDING,
      // which is also not re-approvable.
      this.logger.error("approveDraft DB update failed after email sent", {
        restaurantId,
        orderId,
        conversationId,
        messageId: outboundMessageId,
        error: error?.message,
      });
      await this.parkSendUnconfirmed(conversationId, sentAt);
      throw new InternalServerErrorException(
        `The email for order ${orderId} WAS delivered to the vendor (Message-ID ${outboundMessageId}) ` +
          "but its status could not be recorded. Do NOT approve it again — check the vendor thread and reconcile manually.",
      );
    }

    // Create calendar delivery event NOW — only after manager approves the draft email.
    // This means we've actually communicated with the provider, so the expected
    // delivery window is meaningful.
    try {
      const { data: orderRow } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("*, inventory:inventory_id(wine_name)")
        .eq("id", orderId)
        .eq("restaurant_id", restaurantId)
        .single();
      if (orderRow) {
        const raw = orderRow as any;
        const mappedRow: ProcurementOrderRow = {
          ...raw,
          wine_name: raw.inventory?.wine_name || null,
        };
        await this.createCalendarEventForOrder(
          restaurantId,
          this.mapOrderRow(mappedRow),
          "approved",
        );
      }
    } catch (e: any) {
      this.logger.warn(
        `Calendar creation after draft approval failed: ${e?.message}`,
      );
    }

    return { conversationId: (data as any).id, sentAt: (data as any).sent_at };
  }

  /**
   * Did this failure PROVE the vendor did not get the email?
   *
   * Only an explicit refusal proves it. A timeout, a connection reset, or a
   * hang-up can all occur after the remote server accepted the message, and
   * an SMTP 4xx is a transient "try later" that may still have been relayed.
   * This is therefore a deliberate allow-list of positively-identified
   * refusals: anything unrecognised is ambiguous, because guessing wrong in
   * that direction sends a real vendor a second purchase order.
   */
  private isDefiniteSendRefusal(error: any): boolean {
    const text = `${error?.message ?? ""} ${error?.response?.data ? JSON.stringify(error.response.data) : ""}`;
    if (!text.trim()) return false;

    // No transport was ever attempted — GmailService says so in as many words.
    if (/No email delivery method available/i.test(text)) return true;

    // Credentials refused: the request never became a message.
    if (
      /invalid_grant|invalid_client|unauthorized_client|authentication failed|invalid credentials|Username and Password not accepted/i.test(
        text,
      )
    ) {
      return true;
    }

    // SMTP permanent failures (5xx) and the recipient rejections they carry.
    // Explicitly NOT 4xx — those are transient and may still have been queued.
    if (
      /\b5\d{2}[ -]/.test(text) ||
      /\b5\.\d\.\d\b/.test(text) ||
      /user unknown|no such user|recipient address rejected|mailbox unavailable|address rejected|does not exist/i.test(
        text,
      )
    ) {
      return true;
    }

    // A malformed request we built — nothing deliverable left the process.
    if (/invalid recipient|no recipients defined|invalid to header/i.test(text))
      return true;

    return false;
  }

  /**
   * Park a claimed draft as sent-but-unconfirmed: the vendor may hold this
   * email, so it must never become re-approvable, and a human has to reconcile
   * it against the vendor thread. Best-effort — if this write fails the row
   * stays SENDING, which is also not re-approvable.
   */
  private async parkSendUnconfirmed(
    conversationId: string,
    attemptedAt: string,
  ): Promise<void> {
    try {
      await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "SEND_UNCONFIRMED", sent_at: attemptedAt })
        .eq("id", conversationId)
        .eq("status", "SENDING");
    } catch (e: any) {
      this.logger.error(
        `Could not park ${conversationId} as SEND_UNCONFIRMED: ${e?.message}. Row remains SENDING (still not re-approvable).`,
      );
    }
  }

  /**
   * Hand a claimed draft back for one-tap approval. ONLY safe when the send
   * provably did not happen — once an email is at the vendor, returning the row
   * to PENDING_APPROVAL is what invites a duplicate. Gated by
   * isDefiniteSendRefusal; never call it on an ambiguous failure.
   */
  private async releaseSendClaim(
    conversationId: string,
    reason?: string,
  ): Promise<void> {
    try {
      await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "PENDING_APPROVAL" })
        .eq("id", conversationId)
        .eq("status", "SENDING");
      this.logger.warn(
        `approveDraft send failed for ${conversationId} (${reason ?? "unknown"}) — draft released for retry.`,
      );
    } catch (e: any) {
      this.logger.error(
        `Could not release send claim for ${conversationId}: ${e?.message}`,
      );
    }
  }

  // =========================================================================
  // SHARED EMAIL DELIVERY
  // =========================================================================

  /** Convert plain-text body to simple HTML (paragraph/line breaks); pass HTML through. */
  private buildEmailHtml(rawBody: string): string {
    const body = rawBody ?? "";
    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    return isHtml
      ? body
      : body
          .split(/\n\n+/)
          .map(
            (p) =>
              `<p style="margin:0 0 1em 0">${p.replace(/\n/g, "<br>")}</p>`,
          )
          .join("");
  }

  /** Provider first name: contact_first_name → primary_contact.name → company name. */
  private resolveFirstName(provider: any): string {
    if (!provider) return "";
    const direct = (provider.contact_first_name || "").toString().trim();
    if (direct) return direct.split(/\s+/)[0];
    const pc = provider.primary_contact;
    const pcName = (pc && typeof pc === "object" ? (pc as any).name : "") || "";
    if (String(pcName).trim()) return String(pcName).trim().split(/\s+/)[0];
    const company = (provider.name || "").toString().trim();
    if (company) return company.split(/\s+/)[0];
    return "";
  }

  /** Rewrite a leading generic greeting ("Hi there,", "Hello,", "Hi Acme,") to use the first name. */
  private personalizeGreeting(html: string, firstName?: string): string {
    if (!html || !firstName || !firstName.trim()) return html;
    const name = firstName.trim();
    return html.replace(
      /(^|>)(\s*)(hi|hello|hey|dear)\b[^,<]*,/i,
      `$1$2Hi ${name},`,
    );
  }

  /**
   * Final polish applied to every outbound email at send time: personalize the
   * greeting AND replace unfilled signature placeholders ("[Manager Name]",
   * "[Your Name]", etc.) with the real sender name. This is the safety net that
   * cleans up whatever the draft generator (Python agent or LLM) produced.
   */
  private applyEmailPlaceholders(
    html: string,
    firstName?: string,
    senderName?: string,
  ): string {
    let out = this.personalizeGreeting(html, firstName);
    const sig = (senderName || "").trim();
    // Replace any leftover [Manager Name] / [Your Name] / [Name] / [Signature] placeholder.
    out = out.replace(
      /\[\s*(manager\s*name|your\s*name|name|signature|manager)\s*\]/gi,
      sig,
    );
    return out;
  }

  /**
   * Resolve the outbound sender/signature name for a restaurant. Precedence:
   * a configured 'sender_identity' template (manager-set) → branding display name
   * → restaurant name. Drives the [Manager Name] signature substitution.
   */
  private async resolveSenderName(restaurantId: string): Promise<string> {
    try {
      const { data: t } = await this.databaseService.supabase
        .from("communication_templates")
        .select("body")
        .eq("restaurant_id", restaurantId)
        .eq("type", "sender_identity")
        .eq("is_active", true)
        .maybeSingle();
      const configured = String((t as any)?.body || "").trim();
      if (configured) return configured.split("\n")[0].trim();

      const { data: b } = await this.databaseService.supabase
        .from("restaurant_branding")
        .select("display_name")
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if ((b as any)?.display_name && String((b as any).display_name).trim()) {
        return String((b as any).display_name).trim();
      }
      const { data: r } = await this.databaseService.supabase
        .from("restaurants")
        .select("name")
        .eq("id", restaurantId)
        .maybeSingle();
      return String((r as any)?.name || "").trim();
    } catch {
      return "";
    }
  }

  /**
   * Mint an RFC822 Message-ID before the send so the outbound email is
   * identifiable even if the send crashes before its outcome is recorded.
   * A stored id that is later found on a vendor thread proves the message left;
   * two stored ids for one draft would prove a duplicate.
   */
  private mintRfc822MessageId(): string {
    return `<mudavym-${randomUUID()}@wineops.ai>`;
  }

  /** Send a provider email (threaded when reply metadata is supplied). Throws on failure. */
  private async sendProviderEmail(params: {
    to: string;
    cc?: string[];
    subject: string;
    html: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    recipientFirstName?: string;
    senderName?: string;
    restaurantId?: string;
    /** Pre-minted RFC822 Message-ID; stamped on the wire and echoed back. */
    messageId?: string;
  }): Promise<{
    gmailMessageId?: string;
    gmailThreadId?: string;
    rfc822MessageId?: string;
  }> {
    if (!this.gmailService) return {};
    // Phase 3 — outbound unification (interim). When the restaurant has a dedicated inbound
    // address (INBOUND_EMAIL_DOMAIN configured), set Reply-To to it so vendor replies come back
    // to a per-restaurant address and attribute deterministically via the inbound webhook.
    // No-op until the domain is provisioned, so the shared-Gmail path is unaffected.
    const replyTo =
      params.restaurantId && this.inboundAddress
        ? (await this.inboundAddress.addressFor(params.restaurantId)) ||
          undefined
        : undefined;
    const result = await this.gmailService.sendEmail({
      to: [params.to],
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      subject: params.subject,
      html: this.applyEmailPlaceholders(
        params.html,
        params.recipientFirstName,
        params.senderName,
      ),
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      references: params.references,
      messageIdHeader: params.messageId,
      replyTo,
    });
    if (!result.success) {
      throw new BadRequestException(
        `Email could not be delivered to ${params.to}: ${result.error ?? "unknown error"}. ` +
          "Check Gmail credentials (GMAIL_REFRESH_TOKEN may be expired — run scripts/gmail-reauth.js).",
      );
    }
    return {
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
      rfc822MessageId: result.rfc822MessageId,
    };
  }

  private emitConvUpdate(
    restaurantId: string,
    orderId: string,
    providerId: string | null,
    conversationId: string,
  ): void {
    try {
      this.websocketGateway?.emitConversationUpdated(restaurantId, {
        conversation_id: conversationId,
        order_id: orderId,
        provider_id: providerId || undefined,
        direction: "outbound",
        channel: "email",
      });
    } catch {
      /* best-effort */
    }
  }

  // =========================================================================
  // AUTONOMOUS AUTO-SEND (2-minute undo window)
  // =========================================================================

  /**
   * Every 30s, deliver AI replies whose 2-minute undo window has elapsed. Claims
   * each row atomically (so cancels and overlapping ticks can't double-send), and
   * on any failure reverts the reply to a normal one-tap-approval draft.
   */
  @Interval(30000)
  async processScheduledAutoSends(): Promise<void> {
    if (!this.gmailService) return;
    let due: any[] = [];
    try {
      const { data } = await this.databaseService.supabase
        .from("procurement_conversations")
        .select(
          "id, order_id, restaurant_id, provider_id, content, message_text, gmail_thread_id, email_headers, created_at",
        )
        .eq("status", "AUTO_SEND_SCHEDULED")
        .lte("scheduled_send_at", new Date().toISOString())
        .limit(20);
      due = (data as any[]) || [];
    } catch (e: any) {
      this.logger.warn(`processScheduledAutoSends query failed: ${e?.message}`);
      return;
    }
    if (!due.length) return;

    for (const row of due) {
      // Atomic claim — only one worker wins; a cancel (which flips status) loses the race.
      const { data: claimed } = await this.databaseService.supabase
        .from("procurement_conversations")
        .update({ status: "AUTO_SENDING" })
        .eq("id", row.id)
        .eq("status", "AUTO_SEND_SCHEDULED")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        const { data: order } = await this.databaseService.supabase
          .from("procurement_orders")
          .select(
            "id, ai_autonomy_paused, providers!left(contact_email, name, contact_first_name, primary_contact), restaurant_inventory:inventory_id(wine_name)",
          )
          .eq("id", row.order_id)
          .single();
        const providerEmail = (order as any)?.providers?.contact_email ?? null;
        const wineName =
          (order as any)?.restaurant_inventory?.wine_name ?? "Wine Order";

        // Respect a late pause, and never send without a recipient.
        if ((order as any)?.ai_autonomy_paused === true || !providerEmail) {
          await this.revertScheduledToDraft(
            row.id,
            !providerEmail ? "no provider email" : "order paused",
          );
          continue;
        }

        // A17 — stale-send guard: a newer vendor reply arrived after this draft was
        // staged, so the reply is now potentially answering the wrong message. Revert
        // to a one-tap approval draft and let the manager review against the latest reply
        // (the responder will re-draft against it). Never auto-send a stale reply.
        if (await this.newerInboundSince(row.order_id, row.created_at)) {
          await this.revertScheduledToDraft(
            row.id,
            "newer vendor reply arrived",
          );
          try {
            this.websocketGateway?.emitRestaurantNotification(
              row.restaurant_id,
              {
                id: row.id,
                title: "AI held a reply — a newer vendor email arrived",
                message:
                  "The scheduled auto-send was paused because the vendor replied again. Review the updated draft before sending.",
                type: "warning",
                action_url: `/orders?order=${row.order_id}`,
              },
            );
            void this.inboundResponder?.persistManagerNotification(
              row.restaurant_id,
              {
                type: "vendor_reply",
                title: "AI held a reply — a newer vendor email arrived",
                message:
                  "The scheduled auto-send was paused because the vendor replied again. Review the updated draft before sending.",
                priority: "high",
                actionUrl: `/orders?order=${row.order_id}`,
                metadata: {
                  order_id: row.order_id,
                  draft_id: row.id,
                  provider_id: row.provider_id,
                  reason: "newer_inbound_pending",
                },
              },
            );
          } catch {
            /* best-effort */
          }
          this.emitConvUpdate(
            row.restaurant_id,
            row.order_id,
            row.provider_id,
            row.id,
          );
          continue;
        }

        const headers = (row.email_headers ?? {}) as Record<string, any>;
        const ids = await this.sendProviderEmail({
          to: providerEmail,
          subject: headers.subject || `Re: Order Request: ${wineName}`,
          html: this.buildEmailHtml(row.content ?? row.message_text ?? ""),
          restaurantId: row.restaurant_id,
          threadId: row.gmail_thread_id || undefined,
          inReplyTo: headers.in_reply_to || undefined,
          references: headers.references || undefined,
          recipientFirstName: this.resolveFirstName((order as any)?.providers),
          senderName: await this.resolveSenderName(row.restaurant_id),
        });

        await this.databaseService.supabase
          .from("procurement_conversations")
          .update({
            status: "AUTO_SENT",
            sent_at: new Date().toISOString(),
            scheduled_send_at: null,
            ...(ids.gmailMessageId && { gmail_message_id: ids.gmailMessageId }),
            ...(ids.gmailThreadId && { gmail_thread_id: ids.gmailThreadId }),
            ...(ids.rfc822MessageId && { message_id: ids.rfc822MessageId }),
          })
          .eq("id", row.id);

        this.logger.log(
          `Auto-sent reply ${row.id} for order ${row.order_id} to ${providerEmail}`,
        );
        try {
          this.websocketGateway?.emitRestaurantNotification(row.restaurant_id, {
            id: row.id,
            title: "AI auto-sent a vendor reply",
            message: `Reply sent to ${providerEmail}.`,
            type: "success",
            action_url: `/orders?order=${row.order_id}`,
          });
          void this.inboundResponder?.persistManagerNotification(
            row.restaurant_id,
            {
              type: "vendor_reply",
              title: "AI auto-sent a vendor reply",
              message: `Reply sent to ${providerEmail}.`,
              priority: "medium",
              actionUrl: `/orders?order=${row.order_id}`,
              metadata: {
                order_id: row.order_id,
                draft_id: row.id,
                provider_id: row.provider_id,
              },
            },
          );
        } catch {
          /* best-effort */
        }
        this.emitConvUpdate(
          row.restaurant_id,
          row.order_id,
          row.provider_id,
          row.id,
        );
      } catch (e: any) {
        this.logger.error(
          `Auto-send failed for ${row.id} (order ${row.order_id}): ${e?.message}`,
        );
        await this.revertScheduledToDraft(row.id, "send failed");
        try {
          this.websocketGateway?.emitRestaurantNotification(row.restaurant_id, {
            id: row.id,
            title: "AI auto-send failed — needs your approval",
            message:
              "The scheduled reply could not be sent automatically. It is back in your queue for one-tap approval.",
            type: "warning",
            action_url: `/orders?order=${row.order_id}`,
          });
          void this.inboundResponder?.persistManagerNotification(
            row.restaurant_id,
            {
              type: "vendor_reply",
              title: "AI auto-send failed — needs your approval",
              message:
                "The scheduled reply could not be sent automatically. It is back in your queue for one-tap approval.",
              priority: "high",
              actionUrl: `/orders?order=${row.order_id}`,
              metadata: {
                order_id: row.order_id,
                draft_id: row.id,
                provider_id: row.provider_id,
              },
            },
          );
        } catch {
          /* best-effort */
        }
      }
    }
  }

  private async revertScheduledToDraft(
    conversationId: string,
    reason: string,
  ): Promise<void> {
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "PENDING_APPROVAL", scheduled_send_at: null })
      .eq("id", conversationId);
    this.logger.log(
      `Auto-send reverted to PENDING_APPROVAL for ${conversationId} (${reason}).`,
    );
  }

  /** Undo a scheduled auto-send: revert it to a normal draft for one-tap approval. */
  async cancelScheduledSend(
    restaurantId: string,
    orderId: string,
  ): Promise<{ cancelled: boolean }> {
    const { data } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "PENDING_APPROVAL", scheduled_send_at: null })
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "AUTO_SEND_SCHEDULED")
      .select("id");
    const cancelled = !!(data && (data as any[]).length);
    if (cancelled)
      this.logger.log(
        `Manager cancelled scheduled auto-send for order ${orderId}.`,
      );
    return { cancelled };
  }

  // =========================================================================
  // MANUAL REPLY + AI PAUSE
  // =========================================================================

  /** Manager writes and sends their own threaded reply (bypasses the AI draft). */
  async manualReply(
    restaurantId: string,
    orderId: string,
    content: string,
    ccEmails?: string[],
  ): Promise<{ conversationId: string; sentAt: string }> {
    if (!content || !content.trim()) {
      throw new BadRequestException("Reply content cannot be empty");
    }

    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(
        "id, provider_id, providers!left(contact_email), restaurant_inventory:inventory_id(wine_name)",
      )
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    const providerEmail = (order as any)?.providers?.contact_email ?? null;
    const wineName =
      (order as any)?.restaurant_inventory?.wine_name ?? "Wine Order";
    if (!providerEmail) {
      throw new BadRequestException(
        "Provider has no email address — cannot send reply",
      );
    }

    // Thread to the vendor's latest inbound message if there is one.
    const { data: lastInbound } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("gmail_thread_id, message_id, email_headers")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const inHeaders = ((lastInbound as any)?.email_headers ?? {}) as Record<
      string,
      any
    >;
    const subject = inHeaders.subject || `Re: Order Request: ${wineName}`;
    const threadId = (lastInbound as any)?.gmail_thread_id || undefined;
    const inReplyTo =
      (lastInbound as any)?.message_id || inHeaders.message_id || undefined;
    const references = inHeaders.references || undefined;

    const ids = await this.sendProviderEmail({
      to: providerEmail,
      cc: ccEmails,
      subject,
      html: this.buildEmailHtml(content),
      restaurantId,
      threadId,
      inReplyTo,
      references,
    });

    const sentAt = new Date().toISOString();
    const { data: inserted, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .insert({
        order_id: orderId,
        restaurant_id: restaurantId,
        provider_id: (order as any).provider_id,
        direction: "outbound",
        channel: "email",
        content,
        message_text: content,
        ai_generated: false,
        status: "SENT",
        sent_at: sentAt,
        outbound_email_type: "MANUAL_REPLY",
        gmail_thread_id: ids.gmailThreadId || threadId || null,
        gmail_message_id: ids.gmailMessageId || null,
        message_id: ids.rfc822MessageId || null,
        email_headers: {
          subject,
          in_reply_to: inReplyTo || null,
          references: references || null,
        },
      })
      .select("id, sent_at")
      .single();
    if (error) {
      this.logger.error(
        `manualReply insert failed for order ${orderId}: ${error.message}`,
      );
      throw error;
    }

    // A manual reply supersedes any waiting AI draft for this order.
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "DISCARDED", scheduled_send_at: null })
      .eq("order_id", orderId)
      .in("status", ["PENDING_APPROVAL", "AUTO_SEND_SCHEDULED"]);

    this.emitConvUpdate(
      restaurantId,
      orderId,
      (order as any).provider_id,
      (inserted as any).id,
    );
    return {
      conversationId: (inserted as any).id,
      sentAt: (inserted as any).sent_at,
    };
  }

  /** Pause or resume AI autonomy for a single order (manager grabs the wheel). */
  async setOrderAiPaused(
    restaurantId: string,
    orderId: string,
    paused: boolean,
  ): Promise<{ paused: boolean }> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_orders")
      .update({ ai_autonomy_paused: paused })
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .select("id");
    if (error) throw error;
    if (!data || (data as any[]).length === 0)
      throw new NotFoundException(`Order ${orderId} not found`);
    this.logger.log(
      `AI autonomy ${paused ? "paused" : "resumed"} for order ${orderId}.`,
    );
    return { paused };
  }

  // =========================================================================
  // DEAL APPROVAL (AI-detected offer / verification → one-tap confirm)
  // =========================================================================

  /**
   * Per-vendor earned trust. Manager decides every deal until a vendor's
   * relationship health (rating + completed-order history) crosses a threshold;
   * then clean deals may auto-confirm for that vendor. New vendors are never eligible.
   */
  async getVendorTrust(
    restaurantId: string,
    providerId: string,
  ): Promise<{ score: number; eligible: boolean; completedOrders: number }> {
    try {
      const { data: provider } = await this.databaseService.supabase
        .from("providers")
        .select("rating")
        .eq("id", providerId)
        .maybeSingle();
      const { count } = await this.databaseService.supabase
        .from("procurement_orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("provider_id", providerId)
        .in("status", ["CONFIRMED", "DELIVERED", "COMPLETED"]);
      const completedOrders = count ?? 0;
      const ratingScore = Math.min(
        1,
        Number((provider as any)?.rating ?? 0) / 5,
      );
      const historyScore = Math.min(1, completedOrders / 5);
      const score =
        Math.round((ratingScore * 0.5 + historyScore * 0.5) * 100) / 100;
      const eligible = completedOrders >= 3 && score >= 0.7;
      return { score, eligible, completedOrders };
    } catch {
      return { score: 0, eligible: false, completedOrders: 0 };
    }
  }

  /**
   * Approve-gating guard: true if a vendor reply newer than `draftCreatedAt` exists
   * but the AI hasn't analyzed it yet (detected_intent null) AND it arrived within the
   * last 10 minutes. Blocks acting on a now-stale draft/deal while the AI is still
   * reading the latest reply — but won't lock forever if analysis permanently failed.
   */
  private async newerReplyStillAnalyzing(
    orderId: string,
    draftCreatedAt?: string | null,
  ): Promise<boolean> {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let q = this.databaseService.supabase
      .from("procurement_conversations")
      .select("id")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .is("detected_intent", null)
      .gt("created_at", tenMinAgo);
    if (draftCreatedAt) q = q.gt("created_at", draftCreatedAt);
    const { data } = await q.limit(1);
    return !!(data && (data as any[]).length);
  }

  /**
   * A7 — re-hydrate an inbound message's persisted attachments (D2) into the base64 shape
   * the responder's vision pass expects. Downloads image/PDF bytes from the private
   * vendor-attachments bucket. Best-effort and capped: a missing/oversized object is skipped
   * so a manual regenerate degrades gracefully rather than failing.
   */
  private async loadPersistedAttachmentsForVision(
    restaurantId: string,
    conversationId: string,
  ): Promise<Array<{ filename: string; mime_type: string; data: string }>> {
    const MAX_FILES = 3;
    const MAX_BYTES = 5 * 1024 * 1024; // mirror the ingestion cap
    const out: Array<{ filename: string; mime_type: string; data: string }> =
      [];
    try {
      const { data: rows } = await this.databaseService.supabase
        .from("conversation_attachments")
        .select("filename, mime_type, size_bytes, storage_path")
        .eq("restaurant_id", restaurantId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(MAX_FILES);
      for (const r of (rows as any[]) || []) {
        const mime = (r.mime_type ?? "").toString();
        const isVisionable =
          mime.startsWith("image/") || mime === "application/pdf";
        if (!isVisionable || !r.storage_path) continue;
        if (r.size_bytes != null && r.size_bytes > MAX_BYTES) continue;
        try {
          const { data: blob } = await this.databaseService.supabase.storage
            .from("vendor-attachments")
            .download(r.storage_path);
          if (!blob) continue;
          const buf = Buffer.from(await (blob as any).arrayBuffer());
          if (buf.byteLength > MAX_BYTES) continue;
          out.push({
            filename: r.filename ?? "attachment",
            mime_type: mime,
            data: buf.toString("base64"),
          });
        } catch {
          /* best-effort — skip an object we can't fetch */
        }
      }
    } catch (e: any) {
      this.logger.warn(
        `loadPersistedAttachmentsForVision failed for ${conversationId}: ${e?.message}`,
      );
    }
    return out;
  }

  /**
   * A17 — true if any inbound vendor reply arrived after `sinceIso` (the draft's staging
   * time). Unlike newerReplyStillAnalyzing, this fires whether or not the AI has analyzed
   * the new reply: a scheduled auto-send should never fire once the vendor has spoken again.
   */
  private async newerInboundSince(
    orderId: string,
    sinceIso?: string | null,
  ): Promise<boolean> {
    if (!sinceIso) return false;
    const { data } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .gt("created_at", sinceIso)
      .limit(1);
    return !!(data && (data as any[]).length);
  }

  /** Latest unresolved AI deal proposal for an order (drives the approval modal). */
  async getDealProposal(
    restaurantId: string,
    orderId: string,
  ): Promise<Record<string, any> | null> {
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id, status, provider_id, providers!left(name)")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!order) return null;
    const terminal = [
      "CONFIRMED",
      "APPROVED",
      "IN_TRANSIT",
      "DELIVERED",
      "COMPLETED",
      "CANCELLED",
      "REJECTED",
      "FAILED",
    ];
    if (terminal.includes(String((order as any).status || "").toUpperCase()))
      return null;

    const { data: rows } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id, conversation_context, rolling_summary, created_at")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(6);

    const row = (rows || []).find(
      (r: any) =>
        r.conversation_context?.deal_proposal &&
        !r.conversation_context?.deal_resolved_at,
    );
    if (!row) return null;

    const proposal = (row as any).conversation_context.deal_proposal;
    const trust = await this.getVendorTrust(
      restaurantId,
      (order as any).provider_id,
    );
    return {
      orderId,
      conversationId: (row as any).id,
      providerName:
        proposal.providerName || (order as any).providers?.name || "Provider",
      wineName: proposal.wineName,
      quantity: proposal.quantity,
      proposedPrice: proposal.proposedPrice,
      finalPrice: proposal.finalPrice,
      deliveryEstimate: proposal.deliveryEstimate,
      conditions: proposal.conditions,
      specialConditions: proposal.specialConditions || [],
      commercialTerms: proposal.commercialTerms ?? null,
      sourceQuote: proposal.sourceQuote,
      conversationSummary:
        proposal.summary || (row as any).rolling_summary || "",
      dealKind: proposal.dealKind,
      urgency: proposal.urgency,
      confidence: proposal.confidence,
      timestamp: proposal.detectedAt || (row as any).created_at,
      trust,
    };
  }

  /** Mark the latest deal proposal on an order resolved so the modal stops showing it. */
  private async resolveLatestDealProposal(
    orderId: string,
    resolution: string,
  ): Promise<void> {
    const { data: rows } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select("id, conversation_context")
      .eq("order_id", orderId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(6);
    const row = (rows || []).find(
      (r: any) =>
        r.conversation_context?.deal_proposal &&
        !r.conversation_context?.deal_resolved_at,
    );
    if (!row) return;
    const ctx = { ...((row as any).conversation_context || {}) };
    ctx.deal_resolved_at = new Date().toISOString();
    ctx.deal_resolution = resolution;
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ conversation_context: ctx })
      .eq("id", (row as any).id);
  }

  /**
   * Manager confirms an AI-detected deal: commit the order to CONFIRMED at the
   * (possibly edited) terms and, by default, send the vendor a confirmation email.
   */
  async confirmDeal(
    restaurantId: string,
    orderId: string,
    opts: {
      finalPrice?: number;
      quantity?: number;
      sendConfirmation?: boolean;
    },
  ): Promise<{ confirmed: boolean; sentConfirmation: boolean }> {
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select(
        "id, provider_id, inventory_id, quantity, bottles_total, final_price, negotiated_price, quoted_price, providers!left(name, contact_email, contact_first_name, primary_contact), restaurant_inventory:inventory_id(wine_name)",
      )
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .single();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    // Gate: don't commit terms while a newer reply is still being analyzed.
    if (await this.newerReplyStillAnalyzing(orderId, null)) {
      throw new BadRequestException(
        "A newer vendor reply just arrived and the AI is still reading it. Please review the updated terms before confirming.",
      );
    }

    const providerEmail = (order as any)?.providers?.contact_email ?? null;
    const greetName =
      this.resolveFirstName((order as any)?.providers) || "there";
    const wineName =
      (order as any)?.restaurant_inventory?.wine_name ?? "the wine";
    const quantity = opts.quantity ?? (order as any).quantity;
    const finalPrice = opts.finalPrice ?? null;

    // "Confirmed by us" = we accepted the deal and are emailing the vendor to
    // confirm. That lands the order in APPROVED — NOT ORDERED. It only advances to
    // ORDERED (CONFIRMED) once the vendor sends back a receipt/order-confirmation
    // whose terms match ours (handled in InboundResponder.syncOrderState), or the
    // manager clicks "Mark as Ordered".
    const update: Record<string, any> = {
      status: ProcurementOrderStatus.APPROVED,
      approved_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
    };
    if (finalPrice != null) {
      update.negotiated_price = finalPrice;
      update.final_price = finalPrice;
    }
    if (opts.quantity != null) update.quantity = opts.quantity;

    const { error: upErr } = await this.databaseService.supabase
      .from("procurement_orders")
      .update(update)
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId);
    if (upErr) throw upErr;

    // The agreed price, recorded the moment it becomes a commitment. This is the
    // first of the two writers `price_history` has ever had; before this the
    // table was correctly designed, correctly indexed and permanently empty, so
    // no price series could exist for any wine from any vendor.
    const shelfItem = await this.resolveOrderShelfItem(
      restaurantId,
      (order as any).inventory_id,
    );
    const agreedPrice =
      finalPrice ??
      (order as any).final_price ??
      (order as any).negotiated_price ??
      (order as any).quoted_price;

    // The unit the agreed price is stated in. `price_history` hardcodes
    // `unit: 'BOTTLE'` and its docblock (:925) records that all three of its
    // callers pass a per-bottle figure — an assertion this mirror INHERITS
    // rather than re-derives, because nothing on `procurement_orders` states
    // the unit of `final_price` separately from the order's own unit.
    //
    // So the register only accepts this price when the order's unit holds
    // exactly one bottle. On an order placed in cases the two readings diverge
    // by the pack size, and a case price filed as a bottle price — or the
    // reverse — is the single error that makes a whole ladder wrong. Refusing
    // is the ADR 0117 answer; the founder's call on how to state a case-priced
    // agreement is a question, not a default.
    const confirmUnits = await this.resolveOrderMatchUnits(
      restaurantId,
      orderId,
      order as any,
    );
    const bottlesPerConfirmedUnit =
      confirmUnits.bottlesPerUnit ??
      (confirmUnits.unitType == null || confirmUnits.unitType === "bottle"
        ? 1
        : null);

    await this.recordPriceHistory({
      restaurantId,
      orderId,
      providerId: (order as any).provider_id ?? null,
      masterWineId: shelfItem.masterWineId,
      price: agreedPrice,
      source: "order_confirmed",
      quantity: (order as any).bottles_total ?? quantity ?? 1,
      notes: `Agreed on order confirmation${finalPrice != null ? "" : " (price unchanged from the order)"}.`,
      sighting: {
        vendorName: (order as any)?.providers?.name ?? null,
        productName: shelfItem.wineName ?? wineName ?? null,
        unitPrice: agreedPrice ?? null,
        unitLabel: confirmUnits.unitType ?? "bottle",
        packSize: bottlesPerConfirmedUnit === 1 ? 1 : null,
        unitVolumeMl: shelfItem.bottleSizeMl,
        // `confirmed_at` was just written onto the order above: the moment the
        // house committed to these terms. That is the date this quote carries.
        observedAt: update.confirmed_at ?? new Date().toISOString(),
      },
    });

    // Send the vendor a confirmation (manager-authorized, so commitment language is fine).
    let sentConfirmation = false;
    if (opts.sendConfirmation !== false && providerEmail) {
      try {
        const { data: lastInbound } = await this.databaseService.supabase
          .from("procurement_conversations")
          .select("gmail_thread_id, message_id, email_headers")
          .eq("order_id", orderId)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const inHeaders = ((lastInbound as any)?.email_headers ?? {}) as Record<
          string,
          any
        >;
        const subject =
          inHeaders.subject || `Re: Order Confirmation: ${wineName}`;
        // The vendor's copy of the terms, stated in the order's OWN unit.
        // Until ADR 0119 phase 0 this sentence said "${quantity} bottles ... at
        // $X per bottle" unconditionally, while `quantity` is a count in
        // `unit_type` (:4890) — so a five-case order told the vendor five
        // bottles for sixty and priced a case as a bottle. The mail may not
        // assert a unit it has not read (ADR 0020/0083), and it has read only
        // `confirmUnits` (:4897).
        const confirmSentence = describeConfirmedOrderTerms({
          quantity,
          unitType: confirmUnits.unitType,
          bottlesPerUnit: confirmUnits.bottlesPerUnit,
          wineName,
          finalPrice,
        });
        const body =
          `Hi ${greetName},\n\n` +
          `${confirmSentence} ` +
          `Please send an order confirmation along with the expected delivery date.\n\n` +
          `Thank you!`;
        const ids = await this.sendProviderEmail({
          to: providerEmail,
          subject,
          html: this.buildEmailHtml(body),
          restaurantId,
          threadId: (lastInbound as any)?.gmail_thread_id || undefined,
          inReplyTo:
            (lastInbound as any)?.message_id ||
            inHeaders.message_id ||
            undefined,
          references: inHeaders.references || undefined,
          senderName: await this.resolveSenderName(restaurantId),
        });
        await this.databaseService.supabase
          .from("procurement_conversations")
          .insert({
            order_id: orderId,
            restaurant_id: restaurantId,
            provider_id: (order as any).provider_id,
            direction: "outbound",
            channel: "email",
            content: body,
            message_text: body,
            ai_generated: false,
            status: "SENT",
            sent_at: new Date().toISOString(),
            outbound_email_type: "ORDER_CONFIRMATION",
            gmail_thread_id:
              ids.gmailThreadId ||
              (lastInbound as any)?.gmail_thread_id ||
              null,
            gmail_message_id: ids.gmailMessageId || null,
            message_id: ids.rfc822MessageId || null,
            email_headers: { subject },
          });
        sentConfirmation = true;
      } catch (e: any) {
        this.logger.warn(
          `confirmDeal: confirmation email failed for order ${orderId}: ${e?.message}`,
        );
      }
    }

    // Resolve the proposal + clear any waiting drafts; the deal is done.
    await this.resolveLatestDealProposal(orderId, "confirmed");
    await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "DISCARDED", scheduled_send_at: null })
      .eq("order_id", orderId)
      .in("status", ["PENDING_APPROVAL", "AUTO_SEND_SCHEDULED"]);

    this.emitConvUpdate(
      restaurantId,
      orderId,
      (order as any).provider_id,
      orderId,
    );
    this.logger.log(
      `Deal confirmed for order ${orderId} (price=${finalPrice ?? "unchanged"}, qty=${quantity}, emailed=${sentConfirmation}).`,
    );
    return { confirmed: true, sentConfirmation };
  }

  /** Decline an AI-detected deal without committing — order stays in negotiation. */
  async dismissDeal(
    restaurantId: string,
    orderId: string,
  ): Promise<{ dismissed: boolean }> {
    const { data: order } = await this.databaseService.supabase
      .from("procurement_orders")
      .select("id")
      .eq("id", orderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    await this.resolveLatestDealProposal(orderId, "dismissed");
    this.emitConvUpdate(restaurantId, orderId, null, orderId);
    return { dismissed: true };
  }

  async discardDraft(
    restaurantId: string,
    orderId: string,
  ): Promise<{ success: boolean }> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ status: "DISCARDED" })
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .select("id");

    if (error) {
      this.logger.error("discardDraft failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    if (!data || (data as any[]).length === 0) {
      throw new NotFoundException(
        `No PENDING_APPROVAL draft found for order ${orderId}`,
      );
    }

    if (this.orchestratorService) {
      await this.orchestratorService.publishEvent(
        "provider.events",
        "provider.draft.discarded",
        { order_id: orderId, restaurant_id: restaurantId },
      );
    }

    return { success: true };
  }

  async editDraft(
    restaurantId: string,
    orderId: string,
    newContent: string,
  ): Promise<{ success: boolean }> {
    if (!newContent || newContent.trim().length === 0) {
      throw new BadRequestException("Draft content cannot be empty");
    }

    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .update({ content: newContent })
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .select("id");

    if (error) {
      this.logger.error("editDraft failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    if (!data || (data as any[]).length === 0) {
      throw new NotFoundException(
        `No PENDING_APPROVAL draft found for order ${orderId}`,
      );
    }

    return { success: true };
  }

  async getPendingDraft(
    restaurantId: string,
    orderId: string,
  ): Promise<Record<string, any> | null> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id, content, message_text, outbound_email_type, constraint_flags, round_count, created_at,
        providers!left(name, contact_email),
        procurement_orders!inner(
          order_number,
          inventory:inventory_id(wine_name)
        )
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .eq("status", "PENDING_APPROVAL")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) return null;
    if (!data) return null;
    const row = data as any;
    return {
      ...row,
      content: row.content ?? row.message_text ?? null,
      provider_name: row.providers?.name ?? null,
      provider_email: row.providers?.contact_email ?? null,
      wine_name: row.procurement_orders?.inventory?.wine_name ?? null,
      order_number: row.procurement_orders?.order_number ?? null,
    };
  }

  // =========================================================================
  // PHASE 34: CONVERSATION READ ENDPOINTS
  // =========================================================================

  /**
   * Returns all PENDING_APPROVAL conversations for the restaurant, joined with
   * order (wine name, quantity) and provider (name) data.
   * D-08: Used by the Active Conversations panel on /orders.
   */
  async getActiveConversations(restaurantId: string): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id,
        order_id,
        provider_id,
        outbound_email_type,
        round_count,
        created_at,
        constraint_flags,
        content,
        message_text,
        procurement_orders!inner(
          id, order_number, quantity, quoted_price,
          inventory:inventory_id(wine_name)
        ),
        providers!left(name, contact_email)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", "PENDING_APPROVAL")
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("getActiveConversations failed", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      providerId: row.provider_id,
      emailType: row.outbound_email_type,
      roundCount: row.round_count,
      createdAt: row.created_at,
      constraintFlags: row.constraint_flags,
      draftContent: row.content ?? row.message_text ?? null,
      orderNumber: row.procurement_orders?.order_number ?? null,
      quantity: row.procurement_orders?.quantity ?? null,
      quotedPrice: row.procurement_orders?.quoted_price ?? null,
      wineName: row.procurement_orders?.inventory?.wine_name ?? null,
      providerName: row.providers?.name ?? null,
      providerEmail: row.providers?.contact_email ?? null,
    }));
  }

  /**
   * Every vendor conversation this restaurant has had, except the ones still
   * waiting on the manager.
   *
   * D-03: Used by the Procurement Emails tab on /communications, the page that
   * describes itself as the one place a manager sees every vendor
   * conversation. ADR 0084 — it was showing ONE row out of twenty-six.
   *
   * MEASURED ON PRODUCTION (`exzueerziesmczwlhomd`, 2026-09-02), because the
   * two constraints below have very different sizes and only one of them was
   * suspected:
   *
   *   27 conversation rows in total, across 2 restaurants
   *   12 pass the old status allow-list
   *    2 survive `procurement_orders!inner`
   *    2 the old query returned in total  ← the join was the binding constraint
   *
   * 25 of 27 rows carry `order_id IS NULL`, so the INNER embed dropped them
   * before the status filter was ever consulted. Widening the status list
   * ALONE would have moved the count from 2 to 2 and shipped as a fix. The
   * embed is now `!left`: a conversation that is not attached to a purchase
   * order is still a conversation, and every inbound vendor reply in
   * production is one of those.
   *
   * On the main tenant that is 1 visible row before, 25 after.
   *
   * WHAT IS EXCLUDED, AND WHY IT IS A DENY-LIST NOW
   *
   * The allow-list was the second half of the fault: a status absent from it
   * is invisible, so every value the workflow gains — `DISCARDED` and
   * `CANCELLED` both post-date the list — disappears silently and nothing
   * reports that it did. A ledger must fail toward showing too much, so the
   * filter is inverted. Exactly two things are withheld, and both are withheld
   * because they are LIVE ELSEWHERE, never because they are uninteresting:
   *
   *   status = PENDING_APPROVAL       — the approval queue on /orders
   *                                     (`getActiveConversations`, which
   *                                     selects exactly this status)
   *   status = DRAFT AND outbound     — an unsent draft of ours, same queue
   *
   * Showing either in the history ledger would put the same row in two live
   * places and invite a second send of an email already awaiting approval.
   *
   * `DRAFT` inbound is NOT excluded. `procurement_conversations.status`
   * defaults to `'DRAFT'` at the column level, and the inbound path does not
   * set it, so every vendor reply we have ever received wears a status that
   * describes us rather than them — 10 of the 27 rows. They are received mail,
   * not drafts, and they were the largest single thing missing from the page.
   *
   * DISCARDED (3) and CANCELLED (1) are shown. "We drafted this and killed it"
   * is part of the record of what happened with a vendor; the page renders an
   * unrecognised status as its own lowercase chip, so they arrive labelled.
   */
  async getConversationHistory(restaurantId: string): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id,
        order_id,
        provider_id,
        direction,
        outbound_email_type,
        round_count,
        created_at,
        sent_at,
        status,
        content,
        message_text,
        constraint_flags,
        rolling_summary,
        procurement_orders!left(
          id, order_number, quantity,
          inventory:inventory_id(wine_name)
        ),
        providers!left(name)
      `,
      )
      .eq("restaurant_id", restaurantId)
      // The two exclusions, as filters rather than a post-fetch drop, so
      // `limit` counts rows the manager can actually see.
      //
      // Each is written `status.is.null,<test>` because `neq` against a NULL
      // status evaluates to NULL, i.e. EXCLUDES the row — which for a
      // deny-list ledger is backwards: an unrecognised or absent status is the
      // case we most want on screen. `status` is nullable (it only has a
      // DEFAULT), so this is reachable, and it is the same shape as
      // `one-tap-actions.service.ts:90`. Two separate `.or()` calls are ANDed.
      .or("status.is.null,status.neq.PENDING_APPROVAL")
      // NOT (status = DRAFT AND direction = outbound), by De Morgan.
      .or("status.is.null,status.neq.DRAFT,direction.eq.inbound")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      this.logger.error("getConversationHistory failed", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      providerId: row.provider_id,
      // The DB stores lowercase 'inbound'/'outbound'; `getOrderConversations`
      // already normalises to uppercase for the UI, so this does too rather
      // than shipping two conventions for one field.
      direction: String(row.direction ?? "outbound").toUpperCase() as
        | "OUTBOUND"
        | "INBOUND",
      emailType: row.outbound_email_type,
      status: row.status,
      roundCount: row.round_count,
      createdAt: row.created_at,
      sentAt: row.sent_at ?? row.created_at,
      // `content` only, until ADR 0084. `content` is NULL on all ten inbound
      // rows in production — their body is in `message_text`, which is the
      // NOT NULL column — so the page printed "No message body was recorded
      // for this exchange" about ten messages whose bodies were recorded.
      // `getActiveConversations` and `getOrderConversations` have always read
      // the pair; this method was the odd one out.
      draftContent: row.content ?? row.message_text ?? null,
      constraintFlags: row.constraint_flags,
      rollingSummary: row.rolling_summary,
      orderNumber: row.procurement_orders?.order_number ?? null,
      quantity: row.procurement_orders?.quantity ?? null,
      wineName: row.procurement_orders?.inventory?.wine_name ?? null,
      providerName: row.providers?.name ?? null,
    }));
  }

  async getOrderConversations(
    restaurantId: string,
    orderId: string,
  ): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("procurement_conversations")
      .select(
        `
        id,
        order_id,
        provider_id,
        outbound_email_type,
        round_count,
        created_at,
        sent_at,
        status,
        direction,
        content,
        message_text,
        rolling_summary,
        constraint_flags,
        scheduled_send_at,
        detected_intent,
        detected_sentiment,
        ai_generated,
        conversation_context,
        email_headers,
        procurement_orders!inner(
          id, order_number, quantity, quoted_price, status, ai_autonomy_paused,
          inventory:inventory_id(wine_name)
        ),
        providers!left(name, contact_email)
      `,
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error("getOrderConversations failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      // DB stores direction lowercase ('inbound'/'outbound'); the UI compares
      // against uppercase, so normalize here or inbound replies render as rounds.
      direction: String(row.direction ?? "outbound").toUpperCase() as
        | "OUTBOUND"
        | "INBOUND",
      emailType: row.outbound_email_type,
      roundCount: row.round_count,
      createdAt: row.created_at,
      sentAt: row.sent_at ?? null,
      scheduledSendAt: row.scheduled_send_at ?? null,
      draftContent: row.content ?? row.message_text ?? null,
      rollingSummary: row.rolling_summary ?? null,
      constraintFlags: row.constraint_flags ?? null,
      detectedIntent: row.detected_intent ?? null,
      detectedSentiment: row.detected_sentiment ?? null,
      aiGenerated: row.ai_generated ?? null,
      specialConditions:
        row.conversation_context?.analysis?.special_conditions ?? [],
      // Triage classification (P6 card): email_class, is_automated, requires_reply,
      // injection_suspected, confidence, transport. Null on outbound / pre-triage rows.
      classification: row.conversation_context?.classification ?? null,
      orderNumber: row.procurement_orders?.order_number ?? null,
      quantity: row.procurement_orders?.quantity ?? null,
      quotedPrice: row.procurement_orders?.quoted_price ?? null,
      orderStatus: row.procurement_orders?.status ?? null,
      aiPaused: row.procurement_orders?.ai_autonomy_paused ?? false,
      wineName: row.procurement_orders?.inventory?.wine_name ?? null,
      providerName: row.providers?.name ?? null,
      providerEmail: row.providers?.contact_email ?? null,
      // Sender authentication (DKIM/DMARC) captured on inbound rows in Phase 0; null on
      // outbound rows and on inbound rows that predate transport capture.
      senderVerified: row.email_headers?.transport?.senderVerified ?? null,
    }));
  }

  /** D2 — list an order's persisted email attachments with short-lived signed URLs. */
  async getOrderAttachments(
    restaurantId: string,
    orderId: string,
  ): Promise<any[]> {
    const { data, error } = await this.databaseService.supabase
      .from("conversation_attachments")
      .select(
        "id, conversation_id, filename, mime_type, size_bytes, storage_path, created_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    if (error) {
      this.logger.error("getOrderAttachments failed", {
        restaurantId,
        orderId,
        error: error.message,
      });
      return [];
    }
    const out: any[] = [];
    for (const row of (data as any[]) || []) {
      let url: string | null = null;
      try {
        const { data: signed } = await this.databaseService.supabase.storage
          .from("vendor-attachments")
          .createSignedUrl(row.storage_path, 3600);
        url = signed?.signedUrl ?? null;
      } catch {
        /* best-effort — a missing object just yields no url */
      }
      out.push({
        id: row.id,
        conversationId: row.conversation_id,
        filename: row.filename,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        url,
      });
    }
    return out;
  }
}
