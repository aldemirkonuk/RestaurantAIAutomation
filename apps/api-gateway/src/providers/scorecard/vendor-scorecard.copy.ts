/**
 * Every word the vendor scorecard's gateway read says to a person — ADR 0207.
 *
 * The founder, 2026-09-21 (question 7): "english +TR formats and other
 * languages possiblee for others like japanese, italian, chinese etc." So the
 * words are English, the numbers, dates and money are formatted in the house's
 * own locale through `Intl` (`common/house-frame.ts` finds it), and every
 * user-facing string this read sends is HERE — the measure names, the
 * sentences, the refusals, the Docket's entry texts and the errors — so a
 * translation layer can take this one file later. No i18n framework is built.
 *
 * The web's own chrome (headings, chips, status words) is the matching file on
 * that side: `apps/web/src/pages/providers/next/scorecard/sc-copy.ts`. Two
 * files because the sentences are composed here, where the rows are counted:
 * the client prints them verbatim so a figure cannot disagree with its rows.
 *
 * A function here formats and words; it never decides what is counted.
 */

import type { HouseFrame } from "../../common/house-frame";

// ---------------------------------------------------------------------------
// Formats — the house's locale, never a pinned one
// ---------------------------------------------------------------------------

export interface Fmt {
  /** The formats tag in use; null when the house names none. */
  locale: string | null;
  /** A share as a percent: whole, except at the ends — never 100% unless all, never 0% unless none. */
  pct(part: number, whole: number): string | null;
  /** A signed difference as a percent with one decimal (always positive here). */
  pct1(fraction: number): string;
  /** Money in its currency; a bare amount when none is recorded — never a guessed dollar. */
  money(amount: number, currency: string | null): string;
  /** A calendar date (`YYYY-MM-DD`), all numerals, in the house's order; ISO when the house names no locale. */
  date(dateOnly: string): string;
  /** Hours as words a person reads: `40 min`, `5 h 40`, `3 d`. */
  hours(h: number): string;
}

/**
 * The share as a number of percent, with the two ends guarded: a share just
 * under 1 is truncated to one decimal so it never prints 100%, and a share just
 * above 0 is raised to one decimal so it never prints 0%. Exported for its spec.
 */
export function percentOf(part: number, whole: number): number | null {
  if (!(whole > 0) || !Number.isFinite(part)) return null;
  const v = part / whole;
  const whole100 = Math.round(v * 100);
  if (whole100 === 100 && part < whole) return Math.floor(v * 1000) / 10;
  if (whole100 === 0 && part > 0) return Math.ceil(v * 1000) / 10;
  return whole100;
}

export function makeFmt(locale: string | null): Fmt {
  const tag = locale ?? "en";
  const pctWhole = new Intl.NumberFormat(tag, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const plain2 = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const dates = locale
    ? new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
  return {
    locale,
    pct(part, whole) {
      const p = percentOf(part, whole);
      return p === null ? null : pctWhole.format(p / 100);
    },
    pct1(fraction) {
      return new Intl.NumberFormat(tag, {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(fraction);
    },
    money(amount, currency) {
      if (!currency) return plain2.format(amount);
      try {
        return new Intl.NumberFormat(tag, {
          style: "currency",
          currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount);
      } catch {
        return `${plain2.format(amount)} ${currency}`;
      }
    },
    date(dateOnly) {
      const d = dateOnly.slice(0, 10);
      if (!dates || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const t = new Date(`${d}T00:00:00Z`);
      return Number.isFinite(t.getTime()) ? dates.format(t) : d;
    },
    hours(h) {
      if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
      const whole = Math.floor(h);
      const mins = Math.round((h - whole) * 60);
      if (whole >= 48) return `${Math.round(h / 24)} d`;
      return mins === 0
        ? `${whole} h`
        : `${whole} h ${String(mins).padStart(2, "0")}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Key =
  | "onTime"
  | "linesAsOrdered"
  | "priceAsAgreed"
  | "replyTime"
  | "credits";

export const COPY = {
  label: {
    onTime: "On time",
    linesAsOrdered: "Lines as ordered",
    priceAsAgreed: "Price as agreed",
    replyTime: "Reply time",
    credits: "Credits",
  } as Record<Key, string>,

  /** Which register each measure is counted from — named in every refusal. */
  register: {
    onTime: "the orders book",
    linesAsOrdered: "the receiving door's records",
    priceAsAgreed: "the verified invoices",
    replyTime: "the vendor mail register",
    credits: "the credits register",
  } as Record<Key, string>,

  /** What the minimum counts, plural and singular. */
  noun: {
    onTime: ["order that landed or fell due", "orders that landed or fell due"],
    linesAsOrdered: ["line with a door verdict", "lines with a door verdict"],
    priceAsAgreed: [
      "invoiced line compared with an agreed price",
      "invoiced lines compared with an agreed price",
    ],
    replyTime: ["answered message", "answered messages"],
    credits: ["claim", "claims"],
  } as Record<Key, [string, string]>,

  alerting:
    "No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.",

  notCollected: {
    onTime:
      "No order in this house carries an expected delivery date, so no delivery can be on time or late. Not late — unknown.",
    linesAsOrdered:
      "No delivery in this house has been received through the door yet, so there is no verdict to count. Not clean — unknown.",
    priceAsAgreed:
      "No invoice in this house has been verified against its order yet, so no price has been compared. Not at the agreed price — unknown.",
    replyTime:
      "No vendor mail is recorded for this house, so reply times cannot be measured. Not slow — unknown.",
    credits:
      "No credit claim has ever been recorded for this house, so nothing has been asked back or recovered.",
  } as Record<Key, string>,

  nothingInWindow: (key: Key, days: number): string =>
    ({
      onTime: `No order with an expected date landed or fell due in the last ${days} days — nothing to score.`,
      linesAsOrdered: `No door verdict in the last ${days} days — nothing to score.`,
      priceAsAgreed: `No invoiced line was compared with an agreed price in the last ${days} days — nothing to score.`,
      replyTime: `No answered message in the last ${days} days — nothing to score.`,
      credits: `No claim opened in the last ${days} days — nothing asked, nothing to score.`,
    })[key],

  couldNotRead: (key: Key, reason: string | null): string =>
    `${capital(COPY.register[key])} did not answer (${reason ?? COPY.noReason}). This line is unknown, not zero.`,

  tooFew: (key: Key, sample: number, days: number, minimum: number): string =>
    `${plural(sample, COPY.noun[key][0], COPY.noun[key][1])} in ${days} days — too few to score; ${minimum} are needed.`,

  head: {
    onTime: (
      pct: string,
      hits: number,
      sample: number,
      landedLateDays: number[],
    ): string =>
      `${pct} on time — ${hits} of ${sample} by the expected date.` +
      (landedLateDays.length
        ? ` ${landedLateDays.length} landed late, by ${landedLateDays.join(", ")} ${landedLateDays.length === 1 && landedLateDays[0] === 1 ? "day" : "days"}.`
        : ""),
    linesAsOrdered: (
      pct: string,
      hits: number,
      sample: number,
      misses: number,
    ): string =>
      `${pct} as ordered — ${hits} of ${sample} lines had no short, refused or damaged verdict at the door.${misses ? ` ${plural(misses, "line was not", "lines were not")}.` : ""}`,
    priceAsAgreed: (
      pct: string,
      hits: number,
      sample: number,
      above: number,
      below: number,
    ): string =>
      `${pct} at the agreed price — ${hits} of ${sample} invoiced lines.${above ? ` ${above} above it.` : ""}${below ? ` ${below} below it.` : ""}`,
    replyTime: (median: string, sample: number, slowest: string): string =>
      `Median ${median} from our message to their next reply in the same thread, over ${plural(sample, "reply", "replies")}. Slowest ${slowest}.`,
    credits: (
      parts: { allowed: string; asked: string; pct: string | null }[],
      sample: number,
      hits: number,
      severalCurrencies: boolean,
      bareAmount: boolean,
      thinCurrencyUnder: number | null = null,
    ): string =>
      `${parts
        .map(
          (p) =>
            `${p.pct ? `${p.pct} recovered — ` : ""}${p.allowed} by credit memo of ${p.asked} asked`,
        )
        .join(
          "; ",
        )}, on ${plural(sample, "claim", "claims")}; ${hits} credited.` +
      (severalCurrencies
        ? " Money in two currencies is not added together, so each is its own total."
        : "") +
      (thinCurrencyUnder !== null
        ? ` A currency with fewer than ${thinCurrencyUnder} claims of its own shows its money and no percent.`
        : "") +
      (bareAmount
        ? " The currency is not recorded on the order behind a claim, so its amount is printed with none."
        : ""),
  },

  listedNotCounted: (count: number, because: string): string =>
    `${count} ${count === 1 ? "is" : "are"} listed and not counted: ${because}.`,

  open: {
    onTime: (n: number): string =>
      `${plural(n, "order is", "orders are")} past the expected date and not landed — counted as late, still open.`,
    replyTime: (n: number): string =>
      `${plural(n, "message has", "messages have")} no reply yet — not counted, not forgotten.`,
    credits: (n: number): string =>
      `${plural(n, "claim is", "claims are")} still open or promised — in what was asked, not in what was recovered.`,
  },

  prior: {
    label: (days: number): string => `prior ${days} d`,
    couldNotRead: "could not be read",
    notCollected: "not collected",
    nothing: "nothing to compare with",
    tooFew: (sample: number): string => `${sample} — too few to compare`,
  },

  tally: {
    rate: (pct: string | null, hits: number, sample: number): string =>
      pct ? `${pct} · ${hits} of ${sample}` : `${hits} of ${sample}`,
    reply: (median: string, sample: number): string =>
      `${median} median · ${plural(sample, "reply", "replies")}`,
    money: (pct: string | null, allowed: string, asked: string): string =>
      pct ? `${pct} · ${allowed} of ${asked}` : `${allowed} of ${asked}`,
  },

  fact: {
    answered: (pct: string, hits: number, sample: number): string =>
      `${pct} on time · ${hits} of ${sample}`,
    overdue: (n: number): string => ` · ${n} overdue`,
    couldNotRead: "the orders book did not answer",
    notCollected: "no expected dates recorded",
    quiet: (days: number): string => `nothing in ${days} d — nothing to score`,
    none: (days: number): string => `no dated orders in ${days} d`,
    tooFew: (sample: number): string =>
      `${plural(sample, "order", "orders")} — too few to score`,
  },

  tone: {
    couldNotRead: (reason: string): string =>
      `The vendor mail register did not answer (${reason}).`,
    none: "No vendor message in this window, so nothing was read for tone. Tone is in no figure above.",
    read: (read: number, messages: number): string =>
      `A model read the tone of ${read} of ${plural(messages, "vendor message", "vendor messages")}; no person has labelled one. Tone is in no figure above.`,
  },

  /** How the on-time deadline was read for this house (question 6). */
  deadline: (h: HouseFrame): string => {
    if (h.zone && h.zoneSource === "house")
      return `A delivery is on time when it lands before midnight at the end of its expected day in ${h.zone}, this house's time zone.`;
    if (h.zone)
      return `A delivery is on time when it lands before midnight at the end of its expected day in ${h.zone}. This house records no time zone of its own, so its country's only zone is used.`;
    const why = h.unreadZone
      ? `This house's recorded time zone ("${h.unreadZone}") is not one this server knows`
      : "This house records no time zone";
    const country =
      h.countryZones === null
        ? ", and no country this server can read is recorded"
        : h.countryZones > 1
          ? `, and its country keeps ${h.countryZones} time zones`
          : ", and its country names no single time zone";
    return `${why}${country}. So a delivery is called on time only if it landed before midnight at the end of its expected day in every time zone, and late only if it landed after midnight in every zone; one that landed in between is listed, not counted. Setting the house's time zone settles those.`;
  },

  entry: {
    order: (id: string): string => `Order ${id.slice(0, 8)}`,
    claim: (id: string, reason: string | null): string =>
      `Claim ${id.slice(0, 8)}${reason ? ` · ${reason.replace(/_/g, " ")}` : ""}`,
    ourMessage: "Our message",

    noExpectedDate: "no expected date",
    noExpectedDateDetail:
      "Landed with no expected date on the order, so it cannot be early or late.",
    onTime: (date: string): string => `Landed by the expected date (${date}).`,
    late: (days: number, date: string): string =>
      `Landed ${plural(days, "day", "days")} after the expected date (${date}).`,
    undecided:
      "landed within a day of midnight, and this house's time zone is not known",
    undecidedDetail: (date: string): string =>
      `Landed close to midnight at the end of the expected date (${date}); this house records no time zone, so it cannot be called on time or late.`,
    overdueDetail: (date: string, days: number): string =>
      `Expected by ${date}; ${plural(days, "day", "days")} past it and not landed — counted as late.`,

    noVerdict: "counted at the door with no verdict recorded",
    noVerdictDetail:
      "A count was taken at the door, but no accepted, short or refused verdict was recorded with it.",
    refused: (why: string | null): string =>
      `Refused at the door${why ? ` (${why.replace(/_/g, " ")})` : ""}.`,
    short: "Short at the door.",
    partRefused: (n: number): string =>
      `Accepted, with ${n} refused at the door.`,
    photographed: "Accepted, with damage photographed at the door.",
    asOrdered: "Accepted at the door as ordered.",

    noInvoicedPrice: "no invoiced price recorded",
    noInvoicedPriceDetail:
      "Verified with no invoiced unit price, so there was nothing to compare.",
    notChecked: "not checked against the agreed price",
    notCheckedDetail: "The verification recorded no price check for this line.",
    noAgreedPrice: "no agreed price it can be compared with",
    noAgreedPriceDetail: (reason: string): string => `Not compared: ${reason}.`,
    atAgreed: "Invoiced at the agreed price.",
    awayFromAgreed: "Invoiced away from the agreed price.",
    offAgreed: (above: boolean, pct: string): string =>
      `Invoiced ${above ? "above" : "below"} the agreed price by ${pct}.`,

    neverConfirmed: "the send was never confirmed",
    neverConfirmedDetail: (status: string): string =>
      `Recorded as ${status ? status.toLowerCase().replace(/_/g, " ") : "no status"}, so it may never have reached them.`,
    noThread: "no thread on record, so no reply can be matched to it",
    noThreadDetail:
      "Sent with no thread on the record, so no reply can be matched to it.",
    noReplyYet: "no reply yet — open, not counted",
    answered: (hours: string): string =>
      `Answered in ${hours} in the same thread.`,
    unanswered: "No reply in this thread yet.",

    credited: (allowed: string, asked: string): string =>
      `Credited ${allowed} of ${asked} asked.`,
    promised: (days: number): string =>
      `Promised, ${plural(days, "day", "days")} ago, not recovered — promised is not recovered.`,
    requested: (asked: string): string =>
      `${asked} asked of the vendor; no answer recorded.`,
    openClaim: (asked: string): string =>
      `${asked} owed back; not yet asked of the vendor.`,
    rejected: (asked: string): string => `The vendor refused ${asked}.`,
    writtenOff: (asked: string): string => `${asked} written off by the house.`,
    otherState: (state: string): string => `State ${state}.`,
  },

  reason: {
    agreedLines: (r: string): string => `the agreed lines did not answer: ${r}`,
    doorOrders: (r: string): string =>
      `the orders behind the door records did not answer: ${r}`,
    claimOrders: (r: string): string =>
      `the orders behind the claims did not answer: ${r}`,
    tooMany: (n: number): string =>
      `more than ${n} rows in the window — too many to read in one answer, so none is scored`,
  },

  noReason: "no reason given",
  unnamedVendor: "Unnamed vendor",

  error: {
    vendorBook: (r: string): string =>
      `The vendor book could not be read (${r}). No scorecard is claimed.`,
    noSuchVendor: (id: string): string =>
      `No vendor with id ${id} belongs to this house.`,
    houseRecord: (r: string): string =>
      `This house's own record (its time zone and country) could not be read (${r}). No scorecard is claimed, because no deadline or format can be read without it.`,
    noHouseRecord:
      "This session's house has no record, so no deadline or format can be read. No scorecard is claimed.",
    noHouse: "This session names no restaurant.",
    badWindow: (list: string, raw: string): string =>
      `A window is ${list} days. "${raw}" is not one of them, so nothing was counted.`,
    badMeasure: (list: string, raw: string): string =>
      `A measure is one of ${list}. "${raw}" is not one of them.`,
  },
};
