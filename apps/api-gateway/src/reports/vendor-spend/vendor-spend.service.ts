import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { houseDayBounds, houseDayOf } from "../../common/house-day";
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
 * OWED, AND NOT MARKED (F-1635). Payment is a fact on the invoice (`paid_at`,
 * ADR 0103 A3), and an invoice can only be marked paid since that writer
 * existed. So an unmarked invoice dated BEFORE this house first marked one
 * paid says nothing about whether it was paid: it is "not marked", never
 * "owed". `owedSince` is that first marking, on the house's clock. Dated on or
 * after it, an unmarked invoice is OWED, and the vendor's credit notes dated
 * since then are taken off it.
 *
 * EACH PAYMENT (F-1672, F-1674, S235). An invoice now keeps its payments
 * (`procurement_invoice_payments`): an amount, the day, how, and the credit
 * note one used. An invoice its payments do not cover yet is owed only what is
 * left on it, and a credit note comes off only by what it has not paid yet —
 * a credit that paid an invoice is in that invoice's payments, so it is not
 * taken off a second time. `owedSince` is the day a marking was RECORDED, not
 * the back-dated day of the payment. An invoice marked paid before payments
 * were kept has none; legacy `paid_by` `credit_applied` still counts there.
 * The copies of one bill are one bill, and the bill is paid when any copy of it
 * is.
 *
 * CREDIT ALREADY ON THE PRINTED TOTAL, AND OLDER CREDIT (wave 109, S237).
 * A vendor that prints an invoice with its credit already taken off has used
 * that credit; the house says so (`procurement_credit_taken_on_invoice`) and
 * the credit note stops coming off Owed, without paying the invoice twice.
 * Owed says how many credit notes not yet used it includes. A credit note
 * dated before `owedSince` is never taken off Owed — nothing then could say
 * whether it was used — but it is said beside it (`earlyCredit`), not dropped.
 *
 * NOT NETTED ACROSS VENDORS (F-1673). One vendor's credit pays only that
 * vendor, so a vendor whose credit is more than its bills is "in your favour"
 * on its own row and kept out of the all-vendor Owed; those credits are a
 * total of their own (`inFavour`).
 *
 * Neither Owed nor Not marked is period-bound: what is owed today does not
 * depend on the dates picked. A house that has never marked an invoice paid
 * has no `owedSince`, and every unmarked invoice is "not marked".
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
  /**
   * Invoices not marked paid and dated before `owedSince` (all of them when the
   * house has never marked one): NOT MARKED, never called owed (F-1635).
   */
  unpaid: MoneyTotal[];
  unpaidInvoices: number;
  /** Of `unpaidInvoices`, those with no total or no currency, so not in `unpaid`. */
  unpaidWithoutTotal: number;
  /** Unmarked invoices dated since `owedSince`, less credit notes since then (F-1635). */
  owed: MoneyTotal[];
  owedInvoices: number;
  /** Credit notes dated since `owedSince`, not used up yet, taken off `owed`. */
  owedCreditNotes: number;
  /** Of `owedInvoices` and `owedCreditNotes`, those with no total or no currency, so not in `owed`. */
  owedWithoutTotal: number;
  /**
   * Credit notes dated before `owedSince` with credit not used up: NOT taken
   * off `owed`, said beside it (wave 109, S237). Zero when there is no `owedSince`.
   */
  earlyCreditNotes: number;
  earlyCredit: MoneyTotal[];
}

/**
 * One vendor's Owed and Not marked paid, any date (F-1643, sim 54): every
 * vendor the house owes or has unmarked invoices from, whether or not it had
 * any activity in the period. The period's rows carry the same figures for
 * their own vendors; this list is where a vendor with only old paper is said.
 */
export type VendorOwedRow = Pick<
  VendorSpendRow,
  | "providerId"
  | "name"
  | "unpaid"
  | "unpaidInvoices"
  | "unpaidWithoutTotal"
  | "owed"
  | "owedInvoices"
  | "owedCreditNotes"
  | "owedWithoutTotal"
  | "earlyCreditNotes"
  | "earlyCredit"
>;

export interface VendorSpendDto {
  from: string;
  to: string;
  zone: string;
  /** The house's money; null when it has stated none. */
  currency: string | null;
  /** Vendors with orders or paper in the period only (F-1643). */
  vendors: VendorSpendRow[];
  /** Every vendor with something owed or not marked paid, any date (F-1643). */
  owing: VendorOwedRow[];
  totals: {
    received: MoneyTotal[];
    awaiting: MoneyTotal[];
    invoiced: MoneyTotal[];
    credited: MoneyTotal[];
    unpaid: MoneyTotal[];
    /** Every vendor's Owed that is more than nothing; never less a credit of another vendor (F-1673). */
    owed: MoneyTotal[];
    /** Vendors whose credit is more than their bills: credit in the house's favour, kept apart (F-1673). */
    inFavour: MoneyTotal[];
  };
  /**
   * The house day this house first marked an invoice paid; null when it never
   * has. Invoices dated from it on are owed or paid; older ones are not marked.
   */
  owedSince: string | null;
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

export function spendBasis(
  currency: string | null,
  owedSince: string | null = null,
): string[] {
  return [
    "Received is the delivered and completed orders, at each order's total, filed on the house day they were delivered — the same figure the month close keeps as Bought (delivered). Once an invoice is checked against an order, the order's total is what the invoice charged for the goods plus its freight and fees, without tax; an invoice in another currency leaves the order's total as it was. So Received does not include tax, and Invoiced does.",
    "An order delivered in the period that is still open — part of it still to come, or its invoice not checked yet — is not in Received until it is closed. It is listed beside Received at its order total.",
    "Invoiced is the vendor's invoices dated in the period, at the total printed on them, so any tax on the invoice is inside it. Credit notes are their own column and are not taken off. Rejected and replaced paper is left out, and the same invoice number from one vendor counts once.",
    "Received and Invoiced are two views of the same buying and are never added together.",
    owedSince
      ? `Owed is every invoice dated from ${owedSince}, the day this house first marked an invoice paid, that is not paid in full yet: what is left on it after the payments recorded on it, less that vendor's credit notes dated since then that are not used yet. A credit note comes off only by what it has not paid yet; the part of it recorded as paying an invoice is in that invoice's payments, and credit the vendor already took off an invoice's printed total is used and does not come off again. A credit note dated before ${owedSince} is not taken off Owed, since nothing then could say whether it was used; it is listed beside it. Any copy of an invoice marked paid marks the whole invoice paid. Owed, all vendors adds only the vendors still owed something: one vendor's credit is never taken off another vendor's bills, and a vendor whose credit is more than its bills is said apart, as credit in your favour.`
      : "Owed is not worked out yet: no invoice has been marked paid here, so nothing says which invoices are still to pay.",
    owedSince
      ? `Not marked paid is the invoices dated before ${owedSince} that nobody marked paid. Invoices could not be marked paid then, so this is not what is owed. Credit notes are not taken off it.`
      : "Not marked paid is every invoice on file, from any date, that nobody has marked paid, at the total printed on it. Invoices could not always be marked paid, so this is not what is owed. Credit notes are not taken off it.",
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
    const [orders, paper, allPaper, payments, taken] = await Promise.all([
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
      // Every invoice and credit note on file, paid or not, any date (F-1635):
      // a bill is paid when ANY copy of it is, and the first marking dates Owed.
      readWholeWindow<Record<string, unknown>>(
        "The invoices and credit notes on file",
        () =>
          this.db
            .from("procurement_documents")
            .select(
              "id, provider_id, doc_type, doc_number, doc_date, status, total, currency, created_at, paid_at, paid_by",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            .in("doc_type", ["invoice", "credit_memo"]) as never,
      ),
      // Each payment on an invoice, and the credit note one used (F-1672, F-1674).
      readWholeWindow<Record<string, unknown>>(
        "The payments recorded on invoices",
        () =>
          this.db
            .from("procurement_invoice_payments")
            .select("id, invoice_id, credit_note_id, amount, recorded_at", {
              count: "exact",
            })
            .eq("restaurant_id", restaurantId) as never,
      ),
      // Credit a vendor already took off an invoice's printed total (wave 109).
      readWholeWindow<Record<string, unknown>>(
        "The credit notes already taken off an invoice's total",
        () =>
          this.db
            .from("procurement_credit_taken_on_invoice")
            .select("id, credit_note_id, amount", { count: "exact" })
            .eq("restaurant_id", restaurantId) as never,
      ),
    ]);

    const blank = (key: string | null): VendorSpendRow => ({
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
      owed: [],
      owedInvoices: 0,
      owedCreditNotes: 0,
      owedWithoutTotal: 0,
      earlyCreditNotes: 0,
      earlyCredit: [],
    });
    const rows = new Map<string | null, VendorSpendRow>();
    const rowOf = (id: unknown): VendorSpendRow => {
      const key = typeof id === "string" && id ? id : null;
      let r = rows.get(key);
      if (!r) {
        r = blank(key);
        rows.set(key, r);
      }
      return r;
    };
    // Owed and not marked are any date, so they are kept apart from the
    // period's rows: a vendor with only old unpaid paper is not a row in
    // every period (F-1643). They are copied onto the period's rows below.
    const owing = new Map<string | null, VendorSpendRow>();
    const owingOf = (id: unknown): VendorSpendRow => {
      const key = typeof id === "string" && id ? id : null;
      let r = owing.get(key);
      if (!r) {
        r = blank(key);
        owing.set(key, r);
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

    // Owed, and not marked (F-1635): the same one-bill rule, any date.
    const ledger = owedLedger(allPaper, zone, payments, taken);
    for (const d of ledger.notMarked) {
      const r = owingOf(d.provider_id);
      r.unpaidInvoices += 1;
      const money = moneyOf(d);
      if (!money) r.unpaidWithoutTotal += 1;
      else add(r.unpaid, money.code, money.n);
    }
    for (const d of ledger.owed) {
      const r = owingOf(d.provider_id);
      r.owedInvoices += 1;
      const money = moneyOf(d);
      if (!money) r.owedWithoutTotal += 1;
      else add(r.owed, money.code, money.n);
    }
    // Credit notes since then come off Owed by what they have not paid yet
    // (the ledger's totals are that remainder); legacy invoices marked paid by
    // credit, with no payments kept, still spend it, so it is not taken twice.
    const credit = new Map<
      VendorSpendRow,
      { notes: MoneyTotal[]; spent: MoneyTotal[] }
    >();
    const creditOf = (r: VendorSpendRow) => {
      let c = credit.get(r);
      if (!c) credit.set(r, (c = { notes: [], spent: [] }));
      return c;
    };
    for (const d of ledger.credits) {
      const r = owingOf(d.provider_id);
      r.owedCreditNotes += 1;
      const money = moneyOf(d);
      if (!money) r.owedWithoutTotal += 1;
      // A credit note may be printed negative or positive; it is a credit either way.
      else add(creditOf(r).notes, money.code, Math.abs(money.n));
    }
    for (const d of ledger.paidByCredit) {
      const money = moneyOf(d);
      if (money)
        add(creditOf(owingOf(d.provider_id)).spent, money.code, money.n);
    }
    for (const [r, c] of credit)
      for (const t of c.notes) {
        const left =
          t.total -
          (c.spent.find((x) => x.currency === t.currency)?.total ?? 0);
        if (left > 0) add(r.owed, t.currency, -left);
      }
    // Older credit is said, never silently netted (wave 109, S237).
    for (const d of ledger.earlyCredits) {
      const r = owingOf(d.provider_id);
      r.earlyCreditNotes += 1;
      const money = moneyOf(d);
      if (money) add(r.earlyCredit, money.code, Math.abs(money.n));
    }

    // A vendor with activity in the period carries its Owed and Not marked
    // paid on its row too; the rest are said only in `owing` (F-1643).
    for (const [key, o] of owing) {
      const r = rows.get(key);
      if (!r) continue;
      r.unpaid = o.unpaid;
      r.unpaidInvoices = o.unpaidInvoices;
      r.unpaidWithoutTotal = o.unpaidWithoutTotal;
      r.owed = o.owed;
      r.owedInvoices = o.owedInvoices;
      r.owedCreditNotes = o.owedCreditNotes;
      r.owedWithoutTotal = o.owedWithoutTotal;
      r.earlyCreditNotes = o.earlyCreditNotes;
      r.earlyCredit = o.earlyCredit;
    }

    const ids = [...new Set([...rows.keys(), ...owing.keys()])].filter(
      (k): k is string => k !== null,
    );
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
        if (typeof p.name !== "string" || !p.name.trim()) continue;
        for (const r of [rows.get(p.id), owing.get(p.id)])
          if (r) r.name = p.name.trim();
      }
    }

    const totals = {
      received: [] as MoneyTotal[],
      awaiting: [] as MoneyTotal[],
      invoiced: [] as MoneyTotal[],
      credited: [] as MoneyTotal[],
      unpaid: [] as MoneyTotal[],
      owed: [] as MoneyTotal[],
      inFavour: [] as MoneyTotal[],
    };
    const vendors = [...rows.values()].map((r) => {
      for (const t of r.received) add(totals.received, t.currency, t.total);
      for (const t of r.awaiting) add(totals.awaiting, t.currency, t.total);
      for (const t of r.invoiced) add(totals.invoiced, t.currency, t.total);
      for (const t of r.credited) add(totals.credited, t.currency, t.total);
      return {
        ...r,
        received: ordered(r.received, currency),
        awaiting: ordered(r.awaiting, currency),
        invoiced: ordered(r.invoiced, currency),
        credited: ordered(r.credited, currency),
        unpaid: ordered(r.unpaid, currency),
        owed: ordered(r.owed, currency),
        earlyCredit: ordered(r.earlyCredit, currency),
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
    // Owed and Not marked paid total every vendor, not only the period's.
    const owingRows: VendorOwedRow[] = [...owing.values()]
      .filter(
        (o) =>
          o.unpaidInvoices > 0 ||
          o.owedInvoices + o.owedCreditNotes > 0 ||
          o.earlyCreditNotes > 0,
      )
      .map((o) => {
        for (const t of o.unpaid) add(totals.unpaid, t.currency, t.total);
        // Only what each vendor is still owed adds up; a vendor's credit is
        // that vendor's alone, said apart as in the house's favour (F-1673).
        for (const t of o.owed)
          if (t.total > 0.005) add(totals.owed, t.currency, t.total);
          else if (t.total < -0.005) add(totals.inFavour, t.currency, -t.total);
        return {
          providerId: o.providerId,
          name: o.name,
          unpaid: ordered(o.unpaid, currency),
          unpaidInvoices: o.unpaidInvoices,
          unpaidWithoutTotal: o.unpaidWithoutTotal,
          owed: ordered(o.owed, currency),
          owedInvoices: o.owedInvoices,
          owedCreditNotes: o.owedCreditNotes,
          owedWithoutTotal: o.owedWithoutTotal,
          earlyCreditNotes: o.earlyCreditNotes,
          earlyCredit: ordered(o.earlyCredit, currency),
        };
      })
      // Most owed first in the house's money; a vendor with no name last.
      .sort(
        (a, b) =>
          Number(a.providerId === null) - Number(b.providerId === null) ||
          inHouse(b.owed, currency) +
            inHouse(b.unpaid, currency) -
            (inHouse(a.owed, currency) + inHouse(a.unpaid, currency)) ||
          String(a.name ?? "").localeCompare(String(b.name ?? "")),
      );

    return {
      from,
      to,
      zone,
      currency,
      vendors,
      owing: owingRows,
      totals: {
        received: ordered(totals.received, currency),
        awaiting: ordered(totals.awaiting, currency),
        invoiced: ordered(totals.invoiced, currency),
        credited: ordered(totals.credited, currency),
        unpaid: ordered(totals.unpaid, currency),
        owed: ordered(totals.owed, currency),
        inFavour: ordered(totals.inFavour, currency),
      },
      owedSince: ledger.since,
      unverifiedPaper,
      duplicatePaper,
      paperWithoutCurrency,
      basis: spendBasis(currency, ledger.since),
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

/** A printed total and its currency, or null when either is missing. */
function moneyOf(
  d: Record<string, unknown>,
): { code: string; n: number } | null {
  const n = Number(d.total);
  const code = codeOf(d.currency);
  if (d.total === null || d.total === undefined || !Number.isFinite(n) || !code)
    return null;
  return { code, n };
}

/** One bill's key, as `onePerBill` keys it; null for paper with no number. */
function billKey(d: Record<string, unknown>): string | null {
  const number = typeof d.doc_number === "string" ? d.doc_number.trim() : "";
  return number
    ? `${String(d.provider_id)}|${String(d.doc_type)}|${number.toUpperCase()}`
    : null;
}

/**
 * OWED, AND NOT MARKED (F-1635), from every invoice and credit note on file.
 *
 * `since` is the house day of the first `paid_at` on any invoice: before it no
 * invoice here could be marked paid. A bill (copies counted once) is paid when
 * any live copy of it carries `paid_at`. An unpaid invoice is `owed` when it is
 * dated on or after `since` (its printed date, else the day it came in), and
 * `notMarked` otherwise. `credits` are the credit notes dated since then;
 * `paidByCredit` the invoices since then paid with a credit, whose credit
 * should not be taken off again.
 *
 * With `payments` (F-1672, F-1674): an unpaid invoice's `total` here is what
 * is LEFT on it after its payments (all copies of the bill together); a credit
 * note's `total` is the credit it has NOT paid yet, and one used up is not in
 * `credits`. `since` counts a bill with payments from the day its first
 * payment was recorded (a back-dated payment does not move it), and a bill
 * without from its `paid_at`. `paidByCredit` is then only the bills marked
 * paid by credit with no payment kept, from before payments were.
 *
 * With `taken` (wave 109, S237): credit a vendor already took off an
 * invoice's printed total is used, exactly as a payment by it is, but pays no
 * invoice. `earlyCredits` are the credit notes dated BEFORE `since` with credit
 * not used up, `total` the credit left: never taken off Owed, only said.
 */
export function owedLedger(
  paper: Record<string, unknown>[],
  zone: string,
  payments: Record<string, unknown>[] = [],
  taken: Record<string, unknown>[] = [],
): {
  since: string | null;
  owed: Record<string, unknown>[];
  notMarked: Record<string, unknown>[];
  credits: Record<string, unknown>[];
  earlyCredits: Record<string, unknown>[];
  paidByCredit: Record<string, unknown>[];
} {
  const live = paper.filter((d) => !NOT_THE_BILL.has(String(d.status)));
  const marked = live.filter(
    (d) =>
      d.doc_type === "invoice" && typeof d.paid_at === "string" && d.paid_at,
  );
  // Copies of one bill share a key; paper with no number is its own bill.
  const keyOf = (d: Record<string, unknown>): string =>
    billKey(d) ?? `id:${String(d.id)}`;
  const keyById = new Map(paper.map((d) => [String(d.id), keyOf(d)]));
  const paidOnBill = new Map<string, number>();
  const usedOfNote = new Map<string, number>();
  const recordedDays: string[] = [];
  for (const p of payments) {
    const n = Number(p.amount);
    const bill = keyById.get(String(p.invoice_id));
    if (!bill || !Number.isFinite(n)) continue;
    paidOnBill.set(bill, (paidOnBill.get(bill) ?? 0) + n);
    const note =
      typeof p.credit_note_id === "string"
        ? keyById.get(p.credit_note_id)
        : undefined;
    if (note) usedOfNote.set(note, (usedOfNote.get(note) ?? 0) + n);
    const day = houseDayOf(
      typeof p.recorded_at === "string" ? p.recorded_at : null,
      zone,
    );
    if (day) recordedDays.push(day);
  }
  for (const t of taken) {
    const n = Number(t.amount);
    const note = keyById.get(String(t.credit_note_id));
    if (note && Number.isFinite(n))
      usedOfNote.set(note, (usedOfNote.get(note) ?? 0) + n);
  }
  const markedDays = marked
    .filter((d) => !paidOnBill.has(keyOf(d)))
    .map((d) => houseDayOf(String(d.paid_at), zone))
    .filter((day): day is string => day !== null)
    .concat(recordedDays)
    .sort();
  const since = markedDays[0] ?? null;
  const paidKeys = new Set(
    marked.map(billKey).filter((k): k is string => k !== null),
  );
  const dayOf = (d: Record<string, unknown>): string | null =>
    typeof d.doc_date === "string" && d.doc_date
      ? d.doc_date.slice(0, 10)
      : houseDayOf(
          typeof d.created_at === "string" ? d.created_at : null,
          zone,
        );
  const sinceThen = (d: Record<string, unknown>): boolean => {
    const day = dayOf(d);
    return since !== null && day !== null && day >= since;
  };
  const owed: Record<string, unknown>[] = [];
  const notMarked: Record<string, unknown>[] = [];
  const credits: Record<string, unknown>[] = [];
  const earlyCredits: Record<string, unknown>[] = [];
  const paidByCredit: Record<string, unknown>[] = [];
  for (const d of onePerBill(live).bills) {
    const n = Number(d.total);
    const priced =
      d.total !== null && d.total !== undefined && Number.isFinite(n);
    if (d.doc_type === "credit_memo") {
      // Before `since` it is said apart, never taken off Owed (wave 109).
      if (since === null) continue;
      const into = sinceThen(d) ? credits : earlyCredits;
      const used = usedOfNote.get(keyOf(d)) ?? 0;
      if (!priced || used === 0) into.push(d);
      // A credit note comes off only by what it has not paid yet.
      else if (Math.abs(n) - used > 0.005)
        into.push({ ...d, total: Math.abs(n) - used });
      continue;
    }
    const key = billKey(d);
    const paid =
      (typeof d.paid_at === "string" && d.paid_at !== "") ||
      (key !== null && paidKeys.has(key));
    if (paid) {
      if (sinceThen(d) && !paidOnBill.has(keyOf(d))) {
        const how =
          d.paid_by ??
          marked.find((m) => key !== null && billKey(m) === key)?.paid_by;
        if (how === "credit_applied") paidByCredit.push(d);
      }
      continue;
    }
    // Part paid: what is left on it is what is owed (F-1674).
    const part = paidOnBill.get(keyOf(d)) ?? 0;
    const left = priced && part !== 0 ? { ...d, total: n - part } : d;
    (sinceThen(d) ? owed : notMarked).push(left);
  }
  return { since, owed, notMarked, credits, earlyCredits, paidByCredit };
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

/** Owed is not a zero before the house has marked any invoice paid; it is not known. */
function owedCell(s: VendorSpendDto, owed: MoneyTotal[]): Cell {
  return s.owedSince === null
    ? withheld("not worked out: no invoice has been marked paid here yet")
    : moneyCell(owed, s.currency);
}

export function spendDoc(s: VendorSpendDto): ExportDoc {
  const notes: string[] = [];
  const unpriced = s.vendors.reduce((n, v) => n + v.unpricedOrders, 0);
  const noTotal = s.vendors.reduce((n, v) => n + v.paperWithoutTotal, 0);
  const awaiting = s.vendors.reduce((n, v) => n + v.awaitingOrders, 0);
  // Any date, every vendor (F-1643): the same set as the two totals.
  const unpaidNoTotal = s.owing.reduce((n, v) => n + v.unpaidWithoutTotal, 0);
  const owedNoTotal = s.owing.reduce((n, v) => n + v.owedWithoutTotal, 0);
  if (awaiting > 0)
    notes.push(
      `${awaiting} ${awaiting === 1 ? "order was" : "orders were"} delivered in this period but ${awaiting === 1 ? "is" : "are"} still open — part still to come, or the invoice not checked yet — so Received leaves ${awaiting === 1 ? "it" : "them"} out until ${awaiting === 1 ? "it is" : "they are"} closed. Still open, at order total: ${moneyWords(s.totals.awaiting, s.currency)}.`,
    );
  if (unpaidNoTotal > 0)
    notes.push(
      `${unpaidNoTotal} ${unpaidNoTotal === 1 ? "invoice" : "invoices"} not marked paid ${unpaidNoTotal === 1 ? "has" : "have"} no total or no currency yet, so Not marked paid leaves ${unpaidNoTotal === 1 ? "it" : "them"} out.`,
    );
  if (owedNoTotal > 0)
    notes.push(
      `${owedNoTotal} ${owedNoTotal === 1 ? "invoice or credit note" : "invoices or credit notes"} since ${s.owedSince} ${owedNoTotal === 1 ? "has" : "have"} no total or no currency yet, so Owed leaves ${owedNoTotal === 1 ? "it" : "them"} out.`,
    );
  const early = s.owing.filter((v) => v.earlyCreditNotes > 0);
  if (early.length > 0)
    notes.push(
      `Not taken off Owed: ${early
        .map(
          (v) =>
            `${v.providerId === null ? "no vendor named" : (v.name ?? "a vendor no longer on your list")}, ${v.earlyCreditNotes} credit ${v.earlyCreditNotes === 1 ? "note" : "notes"} dated before ${s.owedSince}${v.earlyCredit.length ? ` (${moneyWords(v.earlyCredit, s.currency)})` : ""}`,
        )
        .join(
          "; ",
        )}. Nothing then could say whether ${early.length === 1 && early[0].earlyCreditNotes === 1 ? "it was" : "they were"} used.`,
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
        label: "Owed, all vendors",
        value: owedCell(s, s.totals.owed),
        unit: "money",
      },
      {
        // Each vendor's credit is that vendor's alone (F-1673): not netted above.
        label: "Credit in your favour, all vendors",
        value: owedCell(s, s.totals.inFavour),
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
          { label: "Owed", unit: "money" },
          { label: "Invoices owed", unit: "count" },
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
          owedCell(s, v.owed),
          v.owedInvoices,
          moneyCell(v.unpaid, s.currency),
          v.unpaidInvoices,
        ]),
      },
      {
        // Any date, so a vendor with only old unpaid invoices is listed here
        // and not as a row of the period (F-1643).
        title: "Owed and not marked paid, any date",
        columns: [
          { label: "Vendor", unit: "text" },
          { label: "Owed", unit: "money" },
          { label: "Invoices owed", unit: "count" },
          { label: "Credit notes not yet used, in Owed", unit: "count" },
          { label: "Not marked paid", unit: "money" },
          { label: "Invoices not marked paid", unit: "count" },
        ],
        rows: s.owing.map((v) => [
          v.providerId === null
            ? "No vendor named"
            : (v.name ?? "A vendor no longer on your list"),
          owedCell(s, v.owed),
          v.owedInvoices,
          v.owedCreditNotes,
          moneyCell(v.unpaid, s.currency),
          v.unpaidInvoices,
        ]),
      },
    ],
    notes,
    basis: s.basis,
  };
}
