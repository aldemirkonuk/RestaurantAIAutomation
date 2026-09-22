/**
 * Every word the scorecard's own screens say — ADR 0207.
 *
 * The founder, 2026-09-21 (question 7): "english +TR formats and other
 * languages possiblee for others like japanese, italian, chinese etc." The
 * words are English and live here, in one place, so a translation layer can
 * take them later; no i18n framework is built. The numbers, dates and money
 * are formatted in the house's own locale (`sc-format.ts`, from the gateway's
 * `house.locale`), never a pinned one.
 *
 * The sentences under each figure are the gateway's and are printed verbatim —
 * their words live in the gateway's matching file,
 * `apps/api-gateway/src/providers/scorecard/vendor-scorecard.copy.ts`.
 */

import type { MeasureKey } from './scorecard-types';

export const SC = {
  labels: {
    onTime: 'On time',
    linesAsOrdered: 'Lines as ordered',
    priceAsAgreed: 'Price as agreed',
    replyTime: 'Reply time',
    credits: 'Credits',
  } as Record<MeasureKey, string>,

  figure: {
    didNotAnswer: 'did not answer',
    notCollected: 'not collected',
    nothingToScore: 'nothing to score',
    tooFew: 'too few',
    ofMinimum: (sample: number, minimum: number) => `${sample} of ${minimum}`,
    of: (hits: number, sample: number) => `${hits} of ${sample}`,
    median: (sample: number) => `median · ${sample}`,
    money: (allowed: string, asked: string) => `${allowed} of ${asked}`,
  },

  /** A reply time as a person reads it: `40 min`, `5 h`, `5 h 40`, `3 d`. */
  duration: {
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    hoursMinutes: (n: number, mm: string) => `${n} h ${mm}`,
    days: (n: number) => `${n} d`,
  },

  rowNoun: {
    onTime: ['order', 'orders'],
    linesAsOrdered: ['line', 'lines'],
    priceAsAgreed: ['invoiced line', 'invoiced lines'],
    replyTime: ['message', 'messages'],
    credits: ['claim', 'claims'],
  } as Record<MeasureKey, [string, string]>,

  window: {
    group: 'Window',
    chip: (days: number) => `${days} d`,
    against: (days: number) => `against the ${days} days before it`,
  },

  ledger: {
    heading: 'What they did',
    quiet: (days: number, vendor: string) =>
      `Nothing in the last ${days} days — no deliveries, door verdicts, invoices, replies or claims from ${vendor}. An empty record is not a clean one, so no line is drawn.`,
    tonePrefix: 'Tone · minor, not scored — ',
    readFailed: 'The scorecard could not be read.',
    readFailedTail: 'That is a failed read, not a clean record — no line here is claimed.',
    tryAgain: 'Try again',
    reading: 'Reading the orders, the door, the invoices, the mail and the credits…',
    noRows: 'no rows',
    claimsBelowMinimum: (minimum: number) =>
      `Under ${minimum} claims there is no percent — these are the claims themselves:`,
    howScored: 'How this is scored',
    howScoredBody:
      'Each line is a count of this house’s own records over a count of records, with its percent — nothing is weighted and nothing is added into a grade. The window is set beside the window of the same length before it, both counts printed, and they are compared only when both reach the line’s minimum. Every line needs 5 records before a percent is shown: 5 orders, 5 door verdicts, 5 compared invoice lines, 5 answered messages, 5 claims. An order past its expected date and not landed counts as late, and stays on the list as open until it lands. Price as agreed is the verdict recorded when the invoice was verified. Credits count only money a credit memo allowed — promised is not recovered. A register that did not answer says so on its own line; missing is never zero. Tone is a model’s reading and is in no figure.',
    alertingFallback:
      'No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.',
  },

  roll: {
    columns: [
      { key: 'onTime', label: 'On time', rule: 'before the house’s midnight' },
      { key: 'linesAsOrdered', label: 'Lines as ordered', rule: 'no short · refused · damaged' },
      { key: 'priceAsAgreed', label: 'Price as agreed', rule: 'invoiced at the agreed price' },
      { key: 'replyTime', label: 'Reply time', rule: 'median · same thread' },
      { key: 'credits', label: 'Credits recovered', rule: 'credited of asked' },
    ] as { key: MeasureKey; label: string; rule: string }[],
    priorNone: 'prior window: none',
    cellAria: (vendor: string, label: string, figure: string) => `${vendor} — ${label}: ${figure}. Open the rows.`,
    vendorQuiet: (days: number) => `nothing in ${days} d`,
    vendorRows: (rows: string, days: number) => `${rows} · ${days} d`,
    header: (window: string, days: number) => `${window} · each cell beside the ${days} days before it · ordered by `,
    orderedByMeasure: (label: string) => `${label.toLowerCase()}, vendors that cannot score last`,
    orderedByOrders: 'orders — not a rank',
    readFailed: 'The scorecard could not be read.',
    readFailedTail: 'That is a failed read, not a table of clean vendors — nothing below is claimed.',
    reading: 'Reading the orders, the door, the invoices, the mail and the credits for every vendor…',
    empty: 'No vendors yet — the book is open and empty, so there is nothing to score and no table is drawn.',
    tableLabel: (days: number) => `Vendor scorecard, ${days} days`,
    vendor: 'Vendor',
    vendorRule: (days: number) => `orders · ${days} d`,
    refused: (n: number, label: string) =>
      `${n === 1 ? 'One vendor has' : `${n} vendors have`} no “${label}” figure in this window — listed apart, never ranked among the scored.`,
    footListed:
      'A line listed and not counted — an invoice with no agreed price, a delivery with no expected date — is not a miss. It is set beside the figure and named in the vendor’s rows.',
    footTone:
      'Tone is not a column: it is a model’s reading of a vendor’s mail, never labelled by a person, and it is in no figure.',
  },

  docket: {
    status: {
      overdue: 'late · not landed',
      openAsked: 'open · asked, not recovered',
      openNotCounted: 'open · not counted',
      listed: 'listed · not counted',
      counted: 'counted',
      hit: {
        onTime: 'on time',
        linesAsOrdered: 'as ordered',
        priceAsAgreed: 'at agreed',
        replyTime: 'counted',
        credits: 'credited',
      } as Record<MeasureKey, string>,
      miss: {
        onTime: (days: number | null | undefined) => `+${days ?? '?'} d late`,
        linesAsOrdered: 'not as ordered',
        priceAsAgreed: 'not at agreed',
        credits: 'not recovered',
      },
    },
    agreedInvoiced: (agreed: string, invoiced: string) => ` agreed ${agreed} · invoiced ${invoiced}`,
    notCounted: (because: string) => `Not counted: ${because}.`,
    title: (vendor: string, label: string | null) => (label ? `${vendor} · ${label}` : `${vendor} · every entry`),
    sheetLabel: (what: string | null, vendor: string) =>
      `The rows behind ${what ? what.toLowerCase() : 'the figures'} for ${vendor}`,
    spine: 'Docket',
    eyebrow: (days: number, window: string | null) => (window ? `${days} d · ${window}` : `${days} d`),
    readFailed: 'The rows could not be read.',
    readFailedTail: 'That is a failed read — this list is unknown, not empty.',
    reading: 'Reading the rows…',
    filterGroup: 'Filter by measure',
    filtered: (label: string, n: number, days: number) =>
      `${label}: ${n} ${n === 1 ? 'entry' : 'entries'} in the last ${days} days, newest first. The figure above is counted from exactly these rows.`,
    unfiltered: (days: number) =>
      `Every entry in the last ${days} days, newest first. Each figure above is counted from these rows.`,
    missing: ' Its entries are missing from this list, not absent from the record.',
    empty: (days: number) => `No entries in the last ${days} days — an empty docket is not a clean one.`,
  },

  page: {
    viewGroup: 'View',
    book: 'Book',
    scorecard: 'Scorecard',
    didLabel: 'Did · 90 d',
    didFailed: 'could not be read',
  },
};
