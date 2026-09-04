import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  SettingsAuditService,
  type FieldChange,
} from "../settings-audit/settings-audit.service";
import {
  hhmm,
  inferTerms,
  PAYMENT_TERMS_NOT_INFERABLE,
  type Finding,
  type InferredTerms,
  type OrderFact,
  type Weekday,
  type ZoneUse,
} from "./term-inference";
import type { SetVendorTermsDto } from "./dto/vendor-terms.dto";

/**
 * The terms a house trades on, and where each one came from.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE FIELDS, AND WHAT THE DATABASE ALREADY HELD FOR EACH
 * ---------------------------------------------------------------------------
 * | field           | already stored?                                        |
 * |-----------------|--------------------------------------------------------|
 * | lead time       | YES — `providers.lead_time_days` **DEFAULT 7**          |
 * |                 | (baseline 20260805000000:4864), overridable per tenant  |
 * |                 | by `restaurant_providers.custom_lead_time_days` (:5154) |
 * | minimum order   | YES — `providers.minimum_order`, no default (:4863),    |
 * |                 | overridable by `custom_minimum_order` (:5155)           |
 * | payment terms   | YES — `providers.payment_terms` **DEFAULT 'Net 30'**    |
 * |                 | (:4899)                                                |
 * | delivery days   | NO. The add-provider dialog collects them               |
 * |                 | (`AddProviderModal.tsx:277`) and `Providers.tsx:457`    |
 * |                 | sends them as `statesOrRegionsServed`, which            |
 * |                 | `services/api/providers.ts:162` maps to                 |
 * |                 | `regionsCovered` → `providers.regions_covered`, the     |
 * |                 | GEOGRAPHY column. Its sibling `deliverySchedule`        |
 * |                 | (`Providers.tsx:458`) never reaches the payload at all  |
 * |                 | (`providers.ts:140-177`).                               |
 * | order cutoff    | NO. Nothing named cutoff exists in any migration.       |
 *
 * ---------------------------------------------------------------------------
 * WHY A DEFAULTED COLUMN READS AS **UNKNOWN**, NOT AS "STATED"
 * ---------------------------------------------------------------------------
 * `lead_time_days DEFAULT 7` means every provider row asserts a seven-day lead
 * time from the moment it is created. A row reading 7 is therefore *exactly as
 * likely* to mean "nobody was ever asked" as "the vendor said a week", and the
 * row itself cannot tell the two apart. Rendering it as the house's stated term
 * would be [[absence-reported-as-health]] in its purest form: the absence of an
 * answer, presented as an answer, by a column default.
 *
 * So this service applies one rule: **a value that is indistinguishable from
 * its column default, with no per-tenant override and no stated row, is
 * UNKNOWN** — and the reason it gives names the default. The moment anybody
 * states it here, or sets a per-tenant override, it becomes a fact with an
 * author. The same rule catches `payment_terms = 'Net 30'`.
 *
 * The one thing this does NOT do is alter those columns. Dropping a default
 * from a production column with live readers (`providers.service.ts:1374,1382`
 * map both onto the API; `email-templates/payment-due.template.ts:108` prints
 * the payment terms into vendor mail) is a separate decision with its own blast
 * radius — filed in `06-pages/settings.md` §13 rather than done in passing.
 *
 * ---------------------------------------------------------------------------
 * INFERENCE IS COMPUTED, NEVER STORED
 * ---------------------------------------------------------------------------
 * Same rule `CellarRegistersService` settled: an inference is recomputed on
 * every read and never written back. A guess written into a table becomes a
 * fact the moment somebody reads it without the surrounding sentence, and the
 * table has no column for "we worked this out from 41 receipts".
 */

/** Where one field's value came from. */
export type TermSource = "stated" | "vendor_record" | "inferred" | "unknown";

export interface StatedBy {
  userId: string | null;
  name: string | null;
}

export interface TermCell<T> {
  value: T | null;
  source: TermSource;
  /** `stated` — who said it and when. */
  statedBy?: StatedBy | null;
  statedAt?: string | null;
  /** `vendor_record` — the column the value was read off. */
  column?: string;
  /** `inferred` — the evidence. */
  n?: number;
  confidence?: "high" | "medium" | "low";
  basis?: string;
  /** `unknown` — why. Always present when `source === "unknown"`. */
  reason?: string;
  /**
   * An inference that DISAGREES with the stated value, when both exist. Not a
   * correction — the house's word wins — but a house whose vendor said "Tuesday
   * and Friday" and whose last forty receipts landed on Wednesdays should be
   * told, and no other surface in the product would ever tell them.
   */
  contradiction?: string | null;
}

export interface CutoffValue {
  /** `HH:MM`, when stated. */
  time: string | null;
  /** Days before delivery the cutoff falls. */
  offsetDays: number | null;
  /** When inferred: the bracket, as `HH:MM`. */
  notBefore?: string | null;
  notAfter?: string | null;
}

export interface VendorTermsRow {
  providerId: string;
  providerName: string;
  /** Orders this house has placed with them, in the inference window. */
  ordersInWindow: number;
  lastOrderedAt: string | null;
  deliveryWeekdays: TermCell<Weekday[]>;
  orderCutoff: TermCell<CutoffValue>;
  minimumOrder: TermCell<number>;
  leadTimeDays: TermCell<number>;
  paymentTerms: TermCell<string>;
  notes: string | null;
  /** The whole stated row's authorship, for the register's provenance line. */
  statedBy: StatedBy | null;
  statedAt: string | null;
}

export interface VendorTermsReadout {
  restaurantId: string;
  vendors: VendorTermsRow[];
  /** ISO 4217 from `restaurants.currency`, and whether it is still the default. */
  currency: { code: string; isColumnDefault: boolean };
  zone: ZoneUse;
  /** How far back the inference looked, in days. */
  windowDays: number;
  sources: {
    providers: SourceStatus;
    statedTerms: SourceStatus;
    orders: SourceStatus;
  };
}

export interface SourceStatus {
  readable: boolean;
  /** Verbatim from the driver. Null when readable. */
  reason: string | null;
  /** Rows returned. Null when unreadable — never 0. */
  rows: number | null;
}

/** PostgREST / Postgres codes that mean "the relation is not there". */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

/**
 * The defaults `providers` carries, so a value equal to one can be recognised.
 * Read off the baseline, not guessed — see the class header for the citations.
 */
export const PROVIDER_COLUMN_DEFAULTS = {
  lead_time_days: 7,
  payment_terms: "Net 30",
} as const;

/** `restaurants` defaults, same purpose (baseline:3575 and the line after it). */
export const RESTAURANT_COLUMN_DEFAULTS = {
  timezone: "America/Los_Angeles",
  currency: "USD",
} as const;

/**
 * How far back the inference reads. A year covers a full seasonal cycle without
 * letting a vendor's terms from two summers ago outvote this month's.
 */
export const INFERENCE_WINDOW_DAYS = 365;

/** Hard cap on rows pulled for inference, so one busy tenant cannot stall a read. */
const ORDER_ROW_CAP = 4000;

interface ProviderRow {
  id: string;
  name: string | null;
  minimum_order: number | null;
  lead_time_days: number | null;
  payment_terms: string | null;
}

interface RestaurantProviderRow {
  provider_id: string;
  custom_lead_time_days: number | null;
  custom_minimum_order: number | null;
  last_order_date: string | null;
}

interface StatedTermsRow {
  provider_id: string;
  delivery_weekdays: number[] | null;
  order_cutoff_time: string | null;
  order_cutoff_offset_days: number | null;
  minimum_order_amount: string | number | null;
  lead_time_days: number | null;
  payment_terms: string | null;
  notes: string | null;
  stated_by: string | null;
  stated_at: string | null;
  updated_at: string | null;
}

interface OrderRow {
  provider_id: string;
  requested_at: string | null;
  delivered_at: string | null;
  expected_delivery_date: string | null;
  total_cost: string | number | null;
  status: string | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class VendorTermsService {
  private readonly logger = new Logger(VendorTermsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<VendorTermsReadout> {
    const house = await this.readHouse(restaurantId);

    const providers = await this.readProviders(restaurantId);
    const links = await this.readLinks(restaurantId);
    const stated = await this.readStated(restaurantId);
    const orders = await this.readOrders(restaurantId);

    const actorIds = [
      ...new Set(
        [...stated.rows.values()]
          .map((r) => r.stated_by)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const actors = await this.resolveActors(actorIds);

    const ordersByProvider = new Map<string, OrderFact[]>();
    for (const o of orders.rows) {
      const list = ordersByProvider.get(o.provider_id) ?? [];
      list.push({
        requestedAt: o.requested_at,
        deliveredAt: o.delivered_at,
        expectedDeliveryDate: o.expected_delivery_date,
        totalCost: num(o.total_cost),
        status: o.status,
      });
      ordersByProvider.set(o.provider_id, list);
    }

    const vendors = providers.rows.map((p) =>
      this.assemble(
        p,
        links.rows.get(p.id) ?? null,
        stated.rows.get(p.id) ?? null,
        ordersByProvider.get(p.id) ?? [],
        house.zone,
        actors,
        orders.readable,
      ),
    );

    // Busiest first: the vendor a house orders from weekly is the one whose
    // cutoff being wrong costs money. Alphabetical would bury it.
    vendors.sort(
      (a, b) =>
        b.ordersInWindow - a.ordersInWindow ||
        a.providerName.localeCompare(b.providerName),
    );

    return {
      restaurantId,
      vendors,
      currency: house.currency,
      zone: house.zone,
      windowDays: INFERENCE_WINDOW_DAYS,
      sources: {
        providers: providers.status,
        statedTerms: stated.status,
        orders: orders.status,
      },
    };
  }

  /**
   * Record what a person says the terms are.
   *
   * A field absent from the DTO is left as it was; a field explicitly `null` is
   * WITHDRAWN, because "we were wrong, nobody actually told us that" has to be
   * expressible or the register can only ever accumulate. Both are distinguished
   * with `Object.prototype.hasOwnProperty`, since `undefined` and a missing key
   * arrive identically otherwise.
   */
  async write(
    restaurantId: string,
    providerId: string,
    dto: SetVendorTermsDto,
    actorUserId: string | null,
  ): Promise<{ readout: VendorTermsReadout; audited: boolean; auditReason: string | null }> {
    const provider = await this.requireProvider(restaurantId, providerId);
    const before = await this.readStatedOne(restaurantId, providerId);

    const patch: Record<string, unknown> = {
      restaurant_id: restaurantId,
      provider_id: providerId,
      stated_by: actorUserId,
      stated_at: new Date().toISOString(),
    };
    const has = (k: keyof SetVendorTermsDto) =>
      Object.prototype.hasOwnProperty.call(dto, k);

    if (has("deliveryWeekdays")) patch.delivery_weekdays = dto.deliveryWeekdays ?? null;
    if (has("orderCutoffTime")) patch.order_cutoff_time = dto.orderCutoffTime ?? null;
    if (has("orderCutoffOffsetDays"))
      patch.order_cutoff_offset_days = dto.orderCutoffOffsetDays ?? null;
    if (has("minimumOrderAmount"))
      patch.minimum_order_amount = dto.minimumOrderAmount ?? null;
    if (has("leadTimeDays")) patch.lead_time_days = dto.leadTimeDays ?? null;
    if (has("paymentTerms")) patch.payment_terms = dto.paymentTerms ?? null;
    if (has("notes")) patch.notes = dto.notes ?? null;

    const { error } = await this.databaseService.client
      .from("restaurant_vendor_terms")
      .upsert(patch, { onConflict: "restaurant_id,provider_id" });

    if (error) {
      this.logger.error(
        `Vendor terms for ${providerId} were not saved: ${error.message}`,
      );
      throw new Error(
        MISSING_RELATION_CODES.has((error as { code?: string }).code ?? "")
          ? "The vendor-terms table is not present on this database, so nothing was saved."
          : error.message,
      );
    }

    const fields = this.diff(before, patch);
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId: actorUserId ?? "",
      action: "vendor_terms_changed",
      register: "vendor-terms",
      entityType: "vendor_terms",
      entityId: providerId,
      // The vendor's name AT THE TIME. A join would render the log wrong the
      // day the vendor is renamed, and blank the day it is deleted.
      subject: provider.name ?? providerId,
      fields,
    });

    return {
      readout: await this.read(restaurantId),
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  /* ── Assembly ──────────────────────────────────────────────────────────── */

  private assemble(
    provider: ProviderRow,
    link: RestaurantProviderRow | null,
    stated: StatedTermsRow | null,
    orders: OrderFact[],
    zone: ZoneUse,
    actors: Map<string, string | null>,
    ordersReadable: boolean,
  ): VendorTermsRow {
    const inferred: InferredTerms = inferTerms(orders, zone);
    const author: StatedBy | null = stated
      ? {
          userId: stated.stated_by,
          name: stated.stated_by ? (actors.get(stated.stated_by) ?? null) : null,
        }
      : null;

    const unreadable = ordersReadable
      ? null
      : "the order ledger could not be read, so nothing was inferred";

    return {
      providerId: provider.id,
      providerName: provider.name ?? "(unnamed vendor)",
      ordersInWindow: orders.length,
      lastOrderedAt: link?.last_order_date ?? null,
      deliveryWeekdays: this.weekdayCell(stated, inferred, author, unreadable),
      orderCutoff: this.cutoffCell(stated, inferred, author, unreadable),
      minimumOrder: this.minimumCell(provider, link, stated, inferred, author, unreadable),
      leadTimeDays: this.leadTimeCell(provider, link, stated, inferred, author, unreadable),
      paymentTerms: this.paymentCell(provider, stated, author),
      notes: stated?.notes ?? null,
      statedBy: author,
      statedAt: stated?.stated_at ?? null,
    };
  }

  private weekdayCell(
    stated: StatedTermsRow | null,
    inferred: InferredTerms,
    author: StatedBy | null,
    unreadable: string | null,
  ): TermCell<Weekday[]> {
    const f = inferred.deliveryWeekdays;
    if (stated?.delivery_weekdays != null) {
      const value = [...stated.delivery_weekdays].sort() as Weekday[];
      return {
        value,
        source: "stated",
        statedBy: author,
        statedAt: stated.stated_at,
        contradiction:
          f.known && !sameDays(value, f.weekdays)
            ? `the last ${f.n} deliveries landed on ${dayList(f.weekdays)}`
            : null,
      };
    }
    if (unreadable) return { value: null, source: "unknown", reason: unreadable };
    if (!f.known) return { value: null, source: "unknown", reason: f.reason };
    return {
      value: f.weekdays,
      source: "inferred",
      n: f.n,
      confidence: f.confidence,
      basis: f.basis,
    };
  }

  private cutoffCell(
    stated: StatedTermsRow | null,
    inferred: InferredTerms,
    author: StatedBy | null,
    unreadable: string | null,
  ): TermCell<CutoffValue> {
    const f = inferred.orderCutoff;
    if (stated?.order_cutoff_time) {
      return {
        value: {
          // Postgres `time` comes back as HH:MM:SS; the register wants HH:MM.
          time: String(stated.order_cutoff_time).slice(0, 5),
          offsetDays: stated.order_cutoff_offset_days ?? null,
        },
        source: "stated",
        statedBy: author,
        statedAt: stated.stated_at,
        contradiction:
          f.known && f.notAfterMinute !== null &&
          minutesOf(String(stated.order_cutoff_time)) !== null &&
          (minutesOf(String(stated.order_cutoff_time)) as number) > f.notAfterMinute
            ? `an order placed at ${hhmm(f.notAfterMinute)} already missed the fastest turnaround, which is earlier than the stated cutoff`
            : null,
      };
    }
    if (unreadable) return { value: null, source: "unknown", reason: unreadable };
    if (!f.known) return { value: null, source: "unknown", reason: f.reason };
    return {
      value: {
        time: null,
        offsetDays: null,
        notBefore: hhmm(f.notBeforeMinute),
        notAfter: f.notAfterMinute === null ? null : hhmm(f.notAfterMinute),
      },
      source: "inferred",
      n: f.n,
      confidence: f.confidence,
      basis: f.basis,
    };
  }

  private minimumCell(
    provider: ProviderRow,
    link: RestaurantProviderRow | null,
    stated: StatedTermsRow | null,
    inferred: InferredTerms,
    author: StatedBy | null,
    unreadable: string | null,
  ): TermCell<number> {
    const statedValue = num(stated?.minimum_order_amount ?? null);
    if (statedValue !== null) {
      return {
        value: statedValue,
        source: "stated",
        statedBy: author,
        statedAt: stated?.stated_at ?? null,
        contradiction:
          inferred.minimumOrder.known &&
          inferred.minimumOrder.smallestAccepted < statedValue
            ? `they have accepted an order of ${inferred.minimumOrder.smallestAccepted}, below the stated minimum`
            : null,
      };
    }
    // `minimum_order` carries NO column default, so any value on either row is
    // somebody's answer rather than the schema's.
    if (link?.custom_minimum_order != null) {
      return {
        value: link.custom_minimum_order,
        source: "vendor_record",
        column: "restaurant_providers.custom_minimum_order",
      };
    }
    if (provider.minimum_order != null) {
      return {
        value: provider.minimum_order,
        source: "vendor_record",
        column: "providers.minimum_order",
      };
    }
    if (unreadable) return { value: null, source: "unknown", reason: unreadable };
    const f = inferred.minimumOrder;
    if (!f.known) return { value: null, source: "unknown", reason: f.reason };
    return {
      value: f.smallestAccepted,
      source: "inferred",
      n: f.n,
      confidence: f.confidence,
      // The bound is upward-only and the sentence has to say so, because the
      // number looks exactly like a minimum and is not one.
      basis: `${f.basis} — the smallest they have ACCEPTED, so the real minimum is at most this. A refusal leaves no row.`,
    };
  }

  private leadTimeCell(
    provider: ProviderRow,
    link: RestaurantProviderRow | null,
    stated: StatedTermsRow | null,
    inferred: InferredTerms,
    author: StatedBy | null,
    unreadable: string | null,
  ): TermCell<number> {
    const f = inferred.leadTime;
    if (stated?.lead_time_days != null) {
      return {
        value: stated.lead_time_days,
        source: "stated",
        statedBy: author,
        statedAt: stated.stated_at,
        contradiction:
          f.known && Math.abs(f.medianDays - stated.lead_time_days) >= 2
            ? `${f.n} receipts put the median at ${f.medianDays} days`
            : null,
      };
    }
    if (link?.custom_lead_time_days != null) {
      return {
        value: link.custom_lead_time_days,
        source: "vendor_record",
        column: "restaurant_providers.custom_lead_time_days",
      };
    }
    // THE DEFAULT TRAP, AND WHY IT IS NO LONGER SPRUNG HERE.
    //
    // This branch used to compare the stored value against 7 and report a match
    // as UNKNOWN, because `providers.lead_time_days DEFAULT 7` made a stated
    // seven and an unasked question indistinguishable. Migration
    // `20260903170000_a_default_is_not_an_answer.sql` dropped the default and
    // set every row that carried it to NULL, so the two are no longer the same
    // value: a NULL is the unasked question and a 7 is a seven somebody typed.
    // Keeping the comparison would now DISCARD a real answer — the exact
    // mistake inverted.
    //
    // This code is therefore only correct on a database that has taken that
    // migration. Code and schema move together on merge (migrations auto-apply),
    // and the migration asserts the dropped default in its own transaction, so
    // a gateway running against an un-migrated database is a deploy fault that
    // fails loudly there rather than a case to hedge against here.
    if (provider.lead_time_days != null) {
      return {
        value: provider.lead_time_days,
        source: "vendor_record",
        column: "providers.lead_time_days",
      };
    }
    if (unreadable) return { value: null, source: "unknown", reason: unreadable };
    if (!f.known) return { value: null, source: "unknown", reason: f.reason };
    return {
      value: f.medianDays,
      source: "inferred",
      n: f.n,
      confidence: f.confidence,
      basis: `${f.basis}; median ${f.medianDays}, slowest tenth ${f.p90Days}`,
    };
  }

  private paymentCell(
    provider: ProviderRow,
    stated: StatedTermsRow | null,
    author: StatedBy | null,
  ): TermCell<string> {
    if (stated?.payment_terms) {
      return {
        value: stated.payment_terms,
        source: "stated",
        statedBy: author,
        statedAt: stated.stated_at,
      };
    }
    const onRecord = provider.payment_terms;
    if (onRecord && onRecord !== PROVIDER_COLUMN_DEFAULTS.payment_terms) {
      return {
        value: onRecord,
        source: "vendor_record",
        column: "providers.payment_terms",
      };
    }
    return {
      value: null,
      source: "unknown",
      reason:
        onRecord === PROVIDER_COLUMN_DEFAULTS.payment_terms
          ? `the vendor record reads "${PROVIDER_COLUMN_DEFAULTS.payment_terms}", which is exactly that column's default value (providers.payment_terms), so nobody can tell whether anyone chose it — and ${PAYMENT_TERMS_NOT_INFERABLE}`
          : PAYMENT_TERMS_NOT_INFERABLE,
    };
  }

  /* ── Reads ─────────────────────────────────────────────────────────────── */

  private async readHouse(
    restaurantId: string,
  ): Promise<{ zone: ZoneUse; currency: { code: string; isColumnDefault: boolean } }> {
    const fallback = {
      zone: {
        zone: RESTAURANT_COLUMN_DEFAULTS.timezone,
        isColumnDefault: true,
      },
      currency: {
        code: RESTAURANT_COLUMN_DEFAULTS.currency,
        isColumnDefault: true,
      },
    };
    try {
      const { data, error } = await this.databaseService.client
        .from("restaurants")
        .select("timezone, currency")
        .eq("id", restaurantId)
        .maybeSingle();
      if (error || !data) return fallback;
      const row = data as { timezone: string | null; currency: string | null };
      return {
        zone: {
          zone: row.timezone || RESTAURANT_COLUMN_DEFAULTS.timezone,
          isColumnDefault:
            !row.timezone || row.timezone === RESTAURANT_COLUMN_DEFAULTS.timezone,
        },
        currency: {
          code: row.currency || RESTAURANT_COLUMN_DEFAULTS.currency,
          isColumnDefault:
            !row.currency || row.currency === RESTAURANT_COLUMN_DEFAULTS.currency,
        },
      };
    } catch {
      return fallback;
    }
  }

  private async readProviders(
    restaurantId: string,
  ): Promise<{ rows: ProviderRow[]; status: SourceStatus }> {
    try {
      const { data, error } = await this.databaseService.client
        .from("providers")
        .select("id, name, minimum_order, lead_time_days, payment_terms")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) {
        return { rows: [], status: unreadable(error) };
      }
      const rows = (data ?? []) as unknown as ProviderRow[];
      return { rows, status: { readable: true, reason: null, rows: rows.length } };
    } catch (err) {
      return { rows: [], status: unreadable(err) };
    }
  }

  private async readLinks(
    restaurantId: string,
  ): Promise<{ rows: Map<string, RestaurantProviderRow>; status: SourceStatus }> {
    const rows = new Map<string, RestaurantProviderRow>();
    try {
      const { data, error } = await this.databaseService.client
        .from("restaurant_providers")
        .select("provider_id, custom_lead_time_days, custom_minimum_order, last_order_date")
        .eq("restaurant_id", restaurantId);
      if (error) return { rows, status: unreadable(error) };
      for (const r of (data ?? []) as unknown as RestaurantProviderRow[]) {
        rows.set(r.provider_id, r);
      }
      return { rows, status: { readable: true, reason: null, rows: rows.size } };
    } catch (err) {
      return { rows, status: unreadable(err) };
    }
  }

  private async readStated(
    restaurantId: string,
  ): Promise<{ rows: Map<string, StatedTermsRow>; status: SourceStatus }> {
    const rows = new Map<string, StatedTermsRow>();
    try {
      const { data, error } = await this.databaseService.client
        .from("restaurant_vendor_terms")
        .select(
          "provider_id, delivery_weekdays, order_cutoff_time, order_cutoff_offset_days, minimum_order_amount, lead_time_days, payment_terms, notes, stated_by, stated_at, updated_at",
        )
        .eq("restaurant_id", restaurantId);
      if (error) return { rows, status: unreadable(error) };
      for (const r of (data ?? []) as unknown as StatedTermsRow[]) {
        rows.set(r.provider_id, r);
      }
      return { rows, status: { readable: true, reason: null, rows: rows.size } };
    } catch (err) {
      return { rows, status: unreadable(err) };
    }
  }

  private async readStatedOne(
    restaurantId: string,
    providerId: string,
  ): Promise<StatedTermsRow | null> {
    try {
      const { data } = await this.databaseService.client
        .from("restaurant_vendor_terms")
        .select(
          "provider_id, delivery_weekdays, order_cutoff_time, order_cutoff_offset_days, minimum_order_amount, lead_time_days, payment_terms, notes, stated_by, stated_at, updated_at",
        )
        .eq("restaurant_id", restaurantId)
        .eq("provider_id", providerId)
        .maybeSingle();
      return (data as unknown as StatedTermsRow) ?? null;
    } catch {
      // A before-state we could not read is not the same as no before-state, and
      // the diff below renders every field as a change rather than inventing a
      // "from". Logged so a silently unaudited write is visible.
      this.logger.warn(
        `The previous vendor terms for ${providerId} could not be read; the audit row will show every submitted field as a change.`,
      );
      return null;
    }
  }

  private async requireProvider(
    restaurantId: string,
    providerId: string,
  ): Promise<ProviderRow> {
    const { data, error } = await this.databaseService.client
      .from("providers")
      .select("id, name, minimum_order, lead_time_days, payment_terms")
      .eq("restaurant_id", restaurantId)
      .eq("id", providerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      // Tenant scope, enforced in the row filter rather than only in the guard:
      // a provider belonging to another house is NOT FOUND here, so the write
      // cannot reach it even if the id is guessed.
      throw new NotFoundException(
        "That vendor does not belong to this restaurant, so no terms were recorded for it.",
      );
    }
    return data as unknown as ProviderRow;
  }

  private async readOrders(
    restaurantId: string,
  ): Promise<{ rows: OrderRow[]; readable: boolean; status: SourceStatus }> {
    const since = new Date(
      Date.now() - INFERENCE_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    try {
      const { data, error } = await this.databaseService.client
        .from("procurement_orders")
        .select(
          "provider_id, requested_at, delivered_at, expected_delivery_date, total_cost, status",
        )
        .eq("restaurant_id", restaurantId)
        .gte("requested_at", since)
        .order("requested_at", { ascending: false })
        .limit(ORDER_ROW_CAP);
      if (error) {
        return { rows: [], readable: false, status: unreadable(error) };
      }
      const rows = (data ?? []) as unknown as OrderRow[];
      return {
        rows,
        readable: true,
        status: { readable: true, reason: null, rows: rows.length },
      };
    } catch (err) {
      return { rows: [], readable: false, status: unreadable(err) };
    }
  }

  private async resolveActors(ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (ids.length === 0) return out;
    try {
      const { data } = await this.databaseService.client
        .from("users")
        .select("user_id, name")
        .in("user_id", ids);
      for (const r of (data ?? []) as Array<{ user_id: string; name: string | null }>) {
        out.set(r.user_id, r.name ?? null);
      }
    } catch {
      // A name we cannot resolve renders as the id, never as "nobody".
    }
    return out;
  }

  /* ── The diff that becomes the audit row ───────────────────────────────── */

  /**
   * Only what actually moved.
   *
   * A settings register that filed a row per SAVE rather than per CHANGE would
   * fill with events where somebody opened a form and pressed the button, and
   * the one real change would be indistinguishable from the noise.
   */
  private diff(
    before: StatedTermsRow | null,
    patch: Record<string, unknown>,
  ): Record<string, FieldChange> {
    const out: Record<string, FieldChange> = {};
    const fields = [
      "delivery_weekdays",
      "order_cutoff_time",
      "order_cutoff_offset_days",
      "minimum_order_amount",
      "lead_time_days",
      "payment_terms",
      "notes",
    ] as const;
    for (const f of fields) {
      if (!Object.prototype.hasOwnProperty.call(patch, f)) continue;
      const from = before
        ? ((before as unknown as Record<string, unknown>)[f] ?? null)
        : null;
      const to = patch[f] ?? null;
      if (JSON.stringify(from) !== JSON.stringify(to)) out[f] = { from, to };
    }
    return out;
  }
}

function unreadable(err: unknown): SourceStatus {
  const code = (err as { code?: string })?.code ?? "";
  const message =
    (err as { message?: string })?.message ??
    (err instanceof Error ? err.message : String(err));
  return {
    readable: false,
    reason: MISSING_RELATION_CODES.has(code)
      ? "the table is not present on this database"
      : message,
    // Never 0. An unreadable source has an UNKNOWN row count, and rendering it
    // as zero is the exact fault this whole page is built against.
    rows: null,
  };
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

function dayList(days: readonly Weekday[]): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days.map((d) => names[d]).join(", ") || "no day at all";
}

function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export type { Weekday };
