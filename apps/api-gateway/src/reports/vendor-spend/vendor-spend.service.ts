import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { houseDayBounds } from "../../common/house-day";
import { houseFrame } from "../../common/house-frame";
import { readWholeWindow } from "../../common/read-whole-window";
import { ORDER_ARRIVED_STATUSES } from "../../procurement/order-status";
import { ProcurementOrderStatus } from "../../procurement/dto/procurement.dto";
import { orderCurrency, orderSpend } from "../../procurement/order-spend";
import { renderCsv } from "../exports/report-export-render";
import {
  withheld,
  type Cell,
  type ExportDoc,
} from "../exports/report-export-doc";
import { countWithheld } from "../exports/report-export-cuttings";
import { houseSlug } from "../exports/report-export-naming";

/**
 * Spend by vendor for any period — F-1608 (sim 52, owner-year-and-accountant
 * finding 5). Before this, the month close kept one purchase total per
 * currency and the only other spend view was two 30-day windows, so an
 * accountant's purchases-by-supplier list for a year could not be produced.
 *
 * NOTHING NEW IS COUNTED. Two figures per vendor, each read the way an
 * existing reader already reads it:
 *
 *  - RECEIVED: orders delivered on the period's house days, at the order's
 *    total — the month close's "Bought (delivered)" read, statuses
 *    `ORDER_SPEND_STATUSES`, `orderSpend` (an order with no price is counted,
 *    never summed as 0), and an order naming no money is the house's (F-1052).
 *  - INVOICED: the vendor's invoices dated in the period, at the total printed
 *    on them (so any tax on the paper is inside it), and credit notes beside
 *    them as their own figure. Rejected and superseded paper is not the bill
 *    (the rule `usual-currency-from-invoices.ts` states), and the same invoice
 *    number from one vendor counts once — photographed and emailed is one bill.
 *
 * OPEN DELIVERIES ARE SAID, NOT COUNTED (F-1632, sim 53). A delivery still
 * waiting on its invoice check, or one with a backorder still to come, stays
 * `PARTIALLY_RECEIVED`, which is not in `ORDER_SPEND_STATUSES`; widening that
 * set is a house-wide money-rule change (F-130 / D6 chose to disclose). So
 * they are read beside Received — counted and summed at their order total as
 * `awaiting` — and the page and the file say why they are not in it. The
 * month close says the same of "Bought (delivered)".
 *
 * NOT MARKED PAID (F-1635). Every invoice on file with no `paid_at` (ADR 0103
 * A3: payment is a fact on the invoice), any date, at its printed total per
 * currency: what the house has not recorded paying. It is not period-bound,
 * because what is owed today does not depend on the dates picked.
 *
 * The two are never added together: an order's total becomes the invoiced
 * total once its invoice is verified (F-700), so the same money can sit in
 * both columns. Money in another currency is kept in its own code; there is no
 * exchange rate on record, so it is never added to the house's money.
 *
 * Owners and managers only, at the server (the controller's @Roles). The house
 * is the one on the token.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The longest period one read covers: three years, so a year against the one before it fits. */
export const MAX_PERIOD_DAYS = 1096;

/** Paper statuses that are not the bill (`usual-currency-from-invoices.ts`). */
const NOT_THE_BILL = new Set(["rejected", "superseded"]);

export interface MoneyTotal {
  /** ISO 4217; null when neither the paper nor the house names one. */
  currency: string | null;
  total: number;
}

export interface VendorSpendRow {
  /** Null for orders and paper that name no vendor. */
  providerId: string | null;
  /** Null when the vendor is not on this house's book any more. */
  name: string | null;
  received: MoneyTotal[];
  /** Delivered orders counted in `received`. */
  receivedOrders: number;
  /** Delivered orders with no price, left out of `received` and counted. */
  unpricedOrders: number;
  /**
   * Delivered in the period but still open (F-1632): a backorder still to
   * come, or the invoice not checked yet. Not in `received`; at order total.
   */
  awaitingOrders: number;
  awaiting: MoneyTotal[];
  invoiced: MoneyTotal[];
  invoices: number;
  credited: MoneyTotal[];
  creditNotes: number;
  /** Invoices and credit notes on file with no total (still being read, or their money held). */
  paperWithoutTotal: number;
  /** Invoices on file, any date, not marked paid, at their printed totals (F-1635). */
  unpaid: MoneyTotal[];
  unpaidInvoices: number;
  /** Of `unpaidInvoices`, those with no total or no currency, so not in `unpaid`. */
  unpaidWithoutTotal: number;
}

export interface VendorSpendDto {
  from: string;
  to: string;
  zone: string;
  /** The house's money; null when it has stated none. */
  currency: string | null;
  vendors: VendorSpendRow[];
  totals: {
    received: MoneyTotal[];
    awaiting: MoneyTotal[];
    invoiced: MoneyTotal[];
    credited: MoneyTotal[];
    unpaid: MoneyTotal[];
  };
  /** Invoices counted above that nobody has checked against the paper yet. */
  unverifiedPaper: number;
  /** The same invoice number from the same vendor, counted once. */
  duplicatePaper: number;
  /** Paper with a total but no currency on it, not added anywhere. */
  paperWithoutCurrency: number;
  /** How each figure is counted, in plain words — written into the file too. */
  basis: string[];
}

function codeOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null;
}

function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  // 2026-02-30 parses as 2 March; refuse it rather than move it.
  return new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

function daysBetween(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
}

function add(totals: MoneyTotal[], currency: string | null, n: number): void {
  const t = totals.find((x) => x.currency === currency);
  if (t) t.total += n;
  else totals.push({ currency, total: n });
}

/** The house's money first, then the others by code. */
function ordered(totals: MoneyTotal[], house: string | null): MoneyTotal[] {
  return [...totals]
    .map((t) => ({ ...t, total: Math.round(t.total * 100) / 100 }))
    .sort((a, b) =>
      a.currency === house
        ? -1
        : b.currency === house
          ? 1
          : String(a.currency).localeCompare(String(b.currency)),
    );
}

function inHouse(totals: MoneyTotal[], house: string | null): number {
  return totals.find((t) => t.currency === house)?.total ?? 0;
}

/** The period as the file states it: ISO dates, which a spreadsheet sorts. */
export function periodLabel(from: string, to: string): string {
  return `${from} to ${to}, both days included, on the house's own days`;
}

export function spendBasis(currency: string | null): string[] {
  return [
    "Received is the delivered and completed orders, at each order's total, filed on the house day they were delivered — the same figure the month close keeps as Bought (delivered). Once an invoice is checked against an order, the order's total is what the invoice charged for the goods plus its freight and fees, without tax; an invoice in another currency leaves the order's total as it was. So Received does not include tax, and Invoiced does.",
    "An order delivered in the period that is still open — part of it still to come, or its invoice not checked yet — is not in Received until it is closed. It is listed beside Received at its order total.",
    "Invoiced is the vendor's invoices dated in the period, at the total printed on them, so any tax on the invoice is inside it. Credit notes are their own column and are not taken off. Rejected and replaced paper is left out, and the same invoice number from one vendor counts once.",
    "Received and Invoiced are two views of the same buying and are never added together.",
    "Not marked paid is every invoice on file, from any date, that nobody has marked paid, at the total printed on it. Credit notes are not taken off it.",
    currency
      ? `Money is in ${currency}, the house's currency. An amount in another currency stays in its own currency and is not added in, because there is no exchange rate on record.`
      : "This house has not set its currency, so each amount is given in the currency its order or invoice names.",
  ];
}

@Injectable()
export class VendorSpendService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.supabase;
  }

  async read(
    restaurantId: string,
    rawFrom: unknown,
    rawTo: unknown,
  ): Promise<
    VendorSpendDto & { houseName: string | null; locale: string | null }
  > {
    const from = validDay(rawFrom);
    const to = validDay(rawTo);
    if (!from || !to)
      throw new BadRequestException(
        "Give the period as two dates, from and to, each written YYYY-MM-DD.",
      );
    if (from > to)
      throw new BadRequestException("The period starts after it ends.");
    if (daysBetween(from, to) > MAX_PERIOD_DAYS)
      throw new BadRequestException(
        `A period can be at most ${MAX_PERIOD_DAYS} days (three years).`,
      );

    const { data: h, error: houseError } = await this.db
      .from("restaurants")
      .select("name, currency, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (houseError)
      throw new Error(`The house could not be read: ${houseError.message}`);
    const house = (h ?? {}) as Record<string, unknown>;
    const currency = codeOf(house.currency);
    // The zone and formats as `readHouseZone` reads them, from the same row.
    const frame = houseFrame({
      timezone: typeof house.timezone === "string" ? house.timezone : null,
      country: typeof house.country === "string" ? house.country : null,
    });
    const zone = frame.zone;
    const locale = frame.locale;
    if (!zone)
      throw new BadRequestException(
        "This house's time zone isn't set, so a period cannot be cut on the house's days. An owner or manager can set it in Settings, under Time zone.",
      );

    const bounds = houseDayBounds(from, to, zone);
    const [orders, paper, unpaidPaper] = await Promise.all([
      readWholeWindow<Record<string, unknown>>(
        "The orders delivered in this period",
        () =>
          this.db
            .from("procurement_orders")
            .select(
              "id, provider_id, status, total_cost, currency, delivered_at",
              {
                count: "exact",
              },
            )
            .eq("restaurant_id", restaurantId)
            // Spend statuses, and the still-open deliveries said beside them (F-1632).
            .in("status", ORDER_ARRIVED_STATUSES as unknown as string[])
            .gte("delivered_at", bounds.startIso)
            .lt("delivered_at", bounds.endIso) as never,
      ),
      readWholeWindow<Record<string, unknown>>(
        "The invoices dated in this period",
        () =>
          this.db
            .from("procurement_documents")
            .select(
              "id, provider_id, doc_type, doc_number, doc_date, status, total, currency, created_at",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            .in("doc_type", ["invoice", "credit_memo"])
            .gte("doc_date", from)
            .lte("doc_date", to) as never,
      ),
      readWholeWindow<Record<string, unknown>>(
        "The invoices not marked paid",
        () =>
          this.db
            .from("procurement_documents")
            .select(
              "id, provider_id, doc_type, doc_number, status, total, currency, created_at",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            .eq("doc_type", "invoice")
            .is("paid_at", null) as never,
      ),
    ]);

    const rows = new Map<string | null, VendorSpendRow>();
    const rowOf = (id: unknown): VendorSpendRow => {
      const key = typeof id === "string" && id ? id : null;
      let r = rows.get(key);
      if (!r) {
        r = {
          providerId: key,
          name: null,
          received: [],
          receivedOrders: 0,
          unpricedOrders: 0,
          awaitingOrders: 0,
          awaiting: [],
          invoiced: [],
          invoices: 0,
          credited: [],
          creditNotes: 0,
          paperWithoutTotal: 0,
          unpaid: [],
          unpaidInvoices: 0,
          unpaidWithoutTotal: 0,
        };
        rows.set(key, r);
      }
      return r;
    };

    for (const o of orders) {
      const r = rowOf(o.provider_id);
      const cost = orderSpend(o);
      if (o.status === ProcurementOrderStatus.PARTIALLY_RECEIVED) {
        // Delivered but still open (F-1632): said beside Received, not in it.
        r.awaitingOrders += 1;
        if (cost !== null) add(r.awaiting, orderCurrency(o) ?? currency, cost);
        continue;
      }
      if (cost === null) {
        r.unpricedOrders += 1;
        continue;
      }
      r.receivedOrders += 1;
      // An order naming no currency is in the house's money (F-1052).
      add(r.received, orderCurrency(o) ?? currency, cost);
    }

    const { bills: periodBills, duplicates: duplicatePaper } =
      onePerBill(paper);

    let unverifiedPaper = 0;
    let paperWithoutCurrency = 0;
    for (const d of periodBills) {
      const r = rowOf(d.provider_id);
      const credit = d.doc_type === "credit_memo";
      if (credit) r.creditNotes += 1;
      else r.invoices += 1;
      if (d.status !== "verified") unverifiedPaper += 1;
      const n = Number(d.total);
      if (d.total === null || d.total === undefined || !Number.isFinite(n)) {
        r.paperWithoutTotal += 1;
        continue;
      }
      const code = codeOf(d.currency);
      if (!code) {
        paperWithoutCurrency += 1;
        continue;
      }
      // A credit note may be printed negative or positive; it is a credit either way.
      add(credit ? r.credited : r.invoiced, code, credit ? Math.abs(n) : n);
    }

    // Not marked paid (F-1635): the same one-bill rule, any date.
    for (const d of onePerBill(unpaidPaper).bills) {
      const r = rowOf(d.provider_id);
      r.unpaidInvoices += 1;
      const n = Number(d.total);
      const code = codeOf(d.currency);
      if (
        d.total === null ||
        d.total === undefined ||
        !Number.isFinite(n) ||
        !code
      ) {
        r.unpaidWithoutTotal += 1;
        continue;
      }
      add(r.unpaid, code, n);
    }

    const ids = [...rows.keys()].filter((k): k is string => k !== null);
    if (ids.length) {
      const { data: named, error: nameError } = await this.db
        .from("providers")
        .select("id, name")
        .eq("restaurant_id", restaurantId)
        .in("id", ids);
      if (nameError)
        throw new Error(
          `The vendors' names could not be read: ${nameError.message}`,
        );
      for (const p of (named ?? []) as Array<{ id: string; name?: unknown }>) {
        const r = rows.get(p.id);
        if (r && typeof p.name === "string" && p.name.trim())
          r.name = p.name.trim();
      }
    }

    const totals = {
      received: [] as MoneyTotal[],
      awaiting: [] as MoneyTotal[],
      invoiced: [] as MoneyTotal[],
      credited: [] as MoneyTotal[],
      unpaid: [] as MoneyTotal[],
    };
    const vendors = [...rows.values()].map((r) => {
      for (const t of r.received) add(totals.received, t.currency, t.total);
      for (const t of r.awaiting) add(totals.awaiting, t.currency, t.total);
      for (const t of r.invoiced) add(totals.invoiced, t.currency, t.total);
      for (const t of r.credited) add(totals.credited, t.currency, t.total);
      for (const t of r.unpaid) add(totals.unpaid, t.currency, t.total);
      return {
        ...r,
        received: ordered(r.received, currency),
        awaiting: ordered(r.awaiting, currency),
        invoiced: ordered(r.invoiced, currency),
        credited: ordered(r.credited, currency),
        unpaid: ordered(r.unpaid, currency),
      };
    });
    // Biggest first in the house's money; a vendor with no name last.
    vendors.sort(
      (a, b) =>
        Number(a.providerId === null) - Number(b.providerId === null) ||
        Math.max(inHouse(b.received, currency), inHouse(b.invoiced, currency)) -
          Math.max(
            inHouse(a.received, currency),
            inHouse(a.invoiced, currency),
          ) ||
        String(a.name ?? "").localeCompare(String(b.name ?? "")),
    );

    return {
      from,
      to,
      zone,
      currency,
      vendors,
      totals: {
        received: ordered(totals.received, currency),
        awaiting: ordered(totals.awaiting, currency),
        invoiced: ordered(totals.invoiced, currency),
        credited: ordered(totals.credited, currency),
        unpaid: ordered(totals.unpaid, currency),
      },
      unverifiedPaper,
      duplicatePaper,
      paperWithoutCurrency,
      basis: spendBasis(currency),
      houseName:
        typeof house.name === "string" && house.name ? house.name : null,
      locale,
    };
  }

  /** The same figures as a spreadsheet file, written as the export shelf writes its files. */
  async csv(
    restaurantId: string,
    from: unknown,
    to: unknown,
  ): Promise<{ filename: string; body: string }> {
    const spend = await this.read(restaurantId, from, to);
    const doc = spendDoc(spend);
    const body = renderCsv(doc, {
      houseName: spend.houseName,
      currency: spend.currency,
      title: "Spend by vendor",
      windowLabel: periodLabel(spend.from, spend.to),
      writtenAt: new Date().toISOString(),
      timezone: spend.zone,
      locale: spend.locale,
      withheldCount: countWithheld(doc),
    });
    return {
      // Named for its house, as the exports shelf names its files (F-1631):
      // two houses' same period no longer save as "(1)".
      filename: `mudavym-${houseSlug(spend.houseName)}-spend-by-vendor-${spend.from}-to-${spend.to}.csv`,
      body,
    };
  }
}

/** One bill per vendor, kind and number: the verified copy, else the newest. */
function onePerBill(paper: Record<string, unknown>[]): {
  bills: Record<string, unknown>[];
  duplicates: number;
} {
  const bills = new Map<string, Record<string, unknown>>();
  const loose: Record<string, unknown>[] = [];
  let duplicates = 0;
  for (const d of paper) {
    if (NOT_THE_BILL.has(String(d.status))) continue;
    const number = typeof d.doc_number === "string" ? d.doc_number.trim() : "";
    if (!number) {
      loose.push(d);
      continue;
    }
    const key = `${String(d.provider_id)}|${String(d.doc_type)}|${number.toUpperCase()}`;
    const kept = bills.get(key);
    if (!kept) {
      bills.set(key, d);
      continue;
    }
    duplicates += 1;
    const better =
      (d.status === "verified") !== (kept.status === "verified")
        ? d.status === "verified"
        : String(d.created_at ?? "") > String(kept.created_at ?? "");
    if (better) bills.set(key, d);
  }
  return { bills: [...bills.values(), ...loose], duplicates };
}

/**
 * One money cell in the house's money. An amount in another currency is not a
 * bare number under the house's header (F-1145); it is withheld, and the reason
 * gives it in its own code.
 */
/** Amounts in a sentence, each in its own code. */
function moneyWords(totals: MoneyTotal[], house: string | null): string {
  if (totals.length === 0) return "no priced order";
  return totals
    .map((t) => `${t.total} ${t.currency ?? house ?? "in no named currency"}`)
    .join(" and ");
}

function moneyCell(totals: MoneyTotal[], house: string | null): Cell {
  if (totals.length === 0) return 0;
  const own = totals.find((t) => t.currency === house);
  const others = totals.filter((t) => t.currency !== house);
  if (others.length === 0) return own ? own.total : 0;
  const said = others
    .map((t) => `${t.total} ${t.currency ?? "in no named currency"}`)
    .join(" and ");
  return withheld(
    own
      ? `${own.total} in the house's money, plus ${said}, which is not added in with no exchange rate on record`
      : `${said}: not the house's money, and with no exchange rate on record it is not written as the house's money`,
  );
}

export function spendDoc(s: VendorSpendDto): ExportDoc {
  const notes: string[] = [];
  const unpriced = s.vendors.reduce((n, v) => n + v.unpricedOrders, 0);
  const noTotal = s.vendors.reduce((n, v) => n + v.paperWithoutTotal, 0);
  const awaiting = s.vendors.reduce((n, v) => n + v.awaitingOrders, 0);
  const unpaidNoTotal = s.vendors.reduce((n, v) => n + v.unpaidWithoutTotal, 0);
  if (awaiting > 0)
    notes.push(
      `${awaiting} ${awaiting === 1 ? "order was" : "orders were"} delivered in this period but ${awaiting === 1 ? "is" : "are"} still open — part still to come, or the invoice not checked yet — so Received leaves ${awaiting === 1 ? "it" : "them"} out until ${awaiting === 1 ? "it is" : "they are"} closed. Still open, at order total: ${moneyWords(s.totals.awaiting, s.currency)}.`,
    );
  if (unpaidNoTotal > 0)
    notes.push(
      `${unpaidNoTotal} ${unpaidNoTotal === 1 ? "invoice" : "invoices"} not marked paid ${unpaidNoTotal === 1 ? "has" : "have"} no total or no currency yet, so Not marked paid leaves ${unpaidNoTotal === 1 ? "it" : "them"} out.`,
    );
  if (unpriced > 0)
    notes.push(
      `${unpriced} delivered ${unpriced === 1 ? "order carries" : "orders carry"} no price, so Received leaves ${unpriced === 1 ? "it" : "them"} out and may be short by what ${unpriced === 1 ? "it" : "they"} cost.`,
    );
  if (noTotal > 0)
    notes.push(
      `${noTotal} ${noTotal === 1 ? "invoice or credit note has" : "invoices or credit notes have"} no total yet (still being read, or the money is waiting for someone to confirm its currency), so Invoiced leaves ${noTotal === 1 ? "it" : "them"} out.`,
    );
  if (s.paperWithoutCurrency > 0)
    notes.push(
      `${s.paperWithoutCurrency} ${s.paperWithoutCurrency === 1 ? "invoice names" : "invoices name"} no currency, so ${s.paperWithoutCurrency === 1 ? "its total is" : "their totals are"} not added anywhere.`,
    );
  if (s.unverifiedPaper > 0)
    notes.push(
      `${s.unverifiedPaper} of the invoices and credit notes counted ${s.unverifiedPaper === 1 ? "has" : "have"} not been checked against the paper yet.`,
    );
  if (s.duplicatePaper > 0)
    notes.push(
      `${s.duplicatePaper} ${s.duplicatePaper === 1 ? "copy" : "copies"} of an invoice already on file ${s.duplicatePaper === 1 ? "was" : "were"} counted once.`,
    );
  return {
    say:
      s.vendors.length === 0
        ? "No order was delivered and no invoice is dated in this period."
        : null,
    figures: [
      {
        label: "Received, all vendors",
        value: moneyCell(s.totals.received, s.currency),
        unit: "money",
      },
      {
        label: "Invoiced, all vendors",
        value: moneyCell(s.totals.invoiced, s.currency),
        unit: "money",
      },
      {
        label: "Credited, all vendors",
        value: moneyCell(s.totals.credited, s.currency),
        unit: "money",
      },
      {
        label: "Delivered, still open, all vendors",
        value: moneyCell(s.totals.awaiting, s.currency),
        unit: "money",
      },
      {
        label: "Not marked paid, all vendors",
        value: moneyCell(s.totals.unpaid, s.currency),
        unit: "money",
      },
    ],
    tables: [
      {
        title: "Spend by vendor",
        columns: [
          { label: "Vendor", unit: "text" },
          { label: "Received", unit: "money" },
          { label: "Delivered orders", unit: "count" },
          { label: "Orders with no price", unit: "count" },
          { label: "Invoiced", unit: "money" },
          { label: "Invoices", unit: "count" },
          { label: "Credited", unit: "money" },
          { label: "Credit notes", unit: "count" },
          { label: "Delivered, still open", unit: "money" },
          { label: "Orders still open", unit: "count" },
          { label: "Not marked paid", unit: "money" },
          { label: "Invoices not marked paid", unit: "count" },
        ],
        rows: s.vendors.map((v) => [
          v.providerId === null
            ? "No vendor named"
            : (v.name ?? "A vendor no longer on your list"),
          moneyCell(v.received, s.currency),
          v.receivedOrders,
          v.unpricedOrders,
          moneyCell(v.invoiced, s.currency),
          v.invoices,
          moneyCell(v.credited, s.currency),
          v.creditNotes,
          moneyCell(v.awaiting, s.currency),
          v.awaitingOrders,
          moneyCell(v.unpaid, s.currency),
          v.unpaidInvoices,
        ]),
      },
    ],
    notes,
    basis: s.basis,
  };
}
