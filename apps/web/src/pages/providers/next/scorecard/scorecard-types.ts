/**
 * The shapes `GET /vendor-scorecard…` answers with — ADR 0207.
 *
 * Mirrors `apps/api-gateway/src/providers/scorecard/vendor-scorecard.ts`. The
 * sentences are the gateway's and are printed verbatim: this client never
 * re-derives a figure, a refusal or a comparison, so the card and the Docket
 * cannot disagree with the rows the gateway counted.
 */

export type MeasureKey = 'onTime' | 'linesAsOrdered' | 'priceAsAgreed' | 'replyTime' | 'credits';

export type MeasureOutcome = 'answered' | 'too_few' | 'not_collected' | 'could_not_read';

export type WindowDays = 30 | 90 | 365;
export const WINDOWS: readonly WindowDays[] = [30, 90, 365];

export interface Money {
  allowed: number;
  asked: number;
  /** Null when the claim's order states no currency — printed as a bare amount, never as dollars. */
  currency: string | null;
}

export interface WindowTally {
  outcome: MeasureOutcome;
  sample: number;
  hits: number | null;
  value: number | null;
  money: Money[] | null;
}

export interface MeasureResult extends WindowTally {
  key: MeasureKey;
  label: string;
  minimum: number;
  minimumNoun: string;
  excluded: { because: string; count: number }[];
  open: number;
  rows: number;
  reason: string | null;
  sentence: string;
  prior: WindowTally;
  priorSentence: string;
  slowestHours?: number | null;
}

export interface ToneReading {
  outcome: 'answered' | 'could_not_read';
  read: number;
  messages: number;
  labelledByPerson: 0;
  sentence: string;
}

export interface VendorScorecard {
  providerId: string;
  providerName: string;
  window: { days: WindowDays; from: string; to: string; priorFrom: string };
  measures: MeasureResult[];
  tone: ToneReading;
  quiet: boolean;
  fact: { text: string; outcome: MeasureOutcome };
  alerting: { built: false; sentence: string };
}

export interface RollCall {
  window: VendorScorecard['window'];
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
