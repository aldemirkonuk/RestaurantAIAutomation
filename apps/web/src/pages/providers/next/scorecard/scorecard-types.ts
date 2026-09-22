/**
 * The shapes `GET /vendor-scorecard…` answers with — ADR 0207.
 *
 * Mirrors `apps/api-gateway/src/providers/scorecard/vendor-scorecard.ts`. The
 * sentences are the gateway's and are printed verbatim: this client never
 * re-derives a figure, a refusal or a comparison, so the card and the Docket
 * cannot disagree with the rows the gateway counted.
 */

export type MeasureKey = 'onTime' | 'linesAsOrdered' | 'priceAsAgreed' | 'replyTime' | 'credits';

/** The five measures in the order every surface draws them. */
export const MEASURE_ORDER: readonly MeasureKey[] = ['onTime', 'linesAsOrdered', 'priceAsAgreed', 'replyTime', 'credits'];

export type MeasureOutcome = 'answered' | 'too_few' | 'not_collected' | 'could_not_read';

export type WindowDays = 30 | 90 | 365;
export const WINDOWS: readonly WindowDays[] = [30, 90, 365];

export interface Money {
  allowed: number;
  asked: number;
  /** Null when the claim's order states no currency — printed as a bare amount, never as dollars. */
  currency: string | null;
  /** allowed / asked; null when nothing was asked. */
  share: number | null;
  /** The gateway's percent in the house's format; null when there is no share. */
  percent: string | null;
}

export interface WindowTally {
  outcome: MeasureOutcome;
  sample: number;
  hits: number | null;
  value: number | null;
  /**
   * The gateway's percent in the house's format ("86%", "%86"): printed, never
   * computed here, so one rounding rule holds — never 100% short of all, never
   * 0% above none. Null unless answered and a share.
   */
  percent: string | null;
  money: Money[] | null;
}

export interface MeasureResult extends WindowTally {
  key: MeasureKey;
  label: string;
  minimum: number;
  minimumNoun: string;
  excluded: { because: string; count: number }[];
  open: number;
  /**
   * On time only: the orders past their date and not landed, by where they
   * stand — counted late once confirmed ("Not yet"), unconfirmed and not
   * counted, or incomplete and out of the figures. Null on the other lines.
   */
  overdue?: { confirmed: number; unconfirmed: number; incomplete: number } | null;
  rows: number;
  reason: string | null;
  sentence: string;
  prior: WindowTally;
  priorSentence: string;
  slowestHours?: number | null;
  /** Credits only, under the minimum: the claims themselves (question 2). */
  listed?: DocketEntry[] | null;
}

/** The house's clock and formats as the gateway read them (questions 6 and 7). */
export interface HouseClock {
  zone: string | null;
  zoneSource: 'house' | 'country' | 'none';
  /** A BCP 47 tag for formats only; null when the house names none. */
  locale: string | null;
  localeSource: 'country' | 'zone' | 'none';
  /** How the on-time deadline was read, in words. */
  deadline: string;
}


export interface VendorScorecard {
  providerId: string;
  providerName: string;
  window: { days: WindowDays; from: string; to: string; priorFrom: string };
  house: HouseClock;
  measures: MeasureResult[];
  // No tone here since round 3: how a vendor's mail reads is its own route,
  // `GET /vendor-scorecard/:id/mail`, for owners and managers only.
  quiet: boolean;
  fact: { text: string; outcome: MeasureOutcome };
  alerting: { built: false; sentence: string };
}

export interface RollCall {
  window: VendorScorecard['window'];
  house: HouseClock;
  vendors: VendorScorecard[];
  alerting: { built: false; sentence: string };
}

export interface DocketEntry {
  id: string;
  measure: MeasureKey;
  at: string;
  window: 'current' | 'prior';
  counted: boolean;
  hit: boolean | null;
  open: boolean;
  excludedBecause: string | null;
  title: string;
  detail: string;
  source: { table: string; id: string; orderId: string | null };
  hours?: number | null;
  daysLate?: number | null;
  /** On time, an order past its date and not landed: where it stands. */
  overdue?: 'unconfirmed' | 'confirmed' | 'incomplete' | null;
  agreed?: number | null;
  invoiced?: number | null;
  amountAsked?: number | null;
  amountAllowed?: number | null;
  currency?: string | null;
}

export interface Docket {
  card: VendorScorecard;
  measure: MeasureKey | null;
  entries: DocketEntry[];
}

/**
 * "How their mail reads" — `GET /vendor-scorecard/:id/mail`, owners and
 * managers only (ADR 0207, round 3). Mirrors `MailToneSection` in
 * `apps/api-gateway/src/providers/scorecard/vendor-mail-tone.ts`. It carries
 * no number of the point scale: one word per message, and the line it rests on.
 */
export type ToneWord = 'warm' | 'plain' | 'terse';

export interface MailMessage {
  id: string;
  at: string;
  subject: string | null;
  word: ToneWord | null;
  notAssessed: string | null;
  quote: string | null;
  quoteMissing: string | null;
  readBy: 'jev' | 'inbound_model' | null;
}

export interface MailToneSection {
  providerId: string;
  window: { days: number; from: string; to: string; priorFrom: string };
  state: 'answered' | 'too_few' | 'not_assessed' | 'no_mail' | 'could_not_read';
  jev: 'on' | 'off' | 'on_unavailable';
  standing: string;
  messages: MailMessage[];
  shown: number;
  beyondCap: number;
  comparison: string | null;
  note: string;
  reason: string | null;
}
