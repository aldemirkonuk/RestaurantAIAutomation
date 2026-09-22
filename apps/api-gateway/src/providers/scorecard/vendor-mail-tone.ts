/**
 * How a vendor's mail reads — the section under the ledger card in the vendor
 * sheet (ADR 0207, round 3). Pure: rows in, the section out.
 *
 * THE FOUNDER, 2026-09-21, choosing among the sentiment sketch's three
 * directions: *"A, Plus C's lines"*, placed *"Vendor sheet only"*, owners and
 * managers only. So:
 *
 *   A  the vendor's last messages, newest first, each with ONE word — warm,
 *      plain or terse — and the quoted line that word rests on; one act, all
 *      their mail; the honest states (no mail yet, too few, could not read,
 *      tone not assessed; the web draws loading).
 *   C  one sentence at the foot, ONLY when this window and the one before it
 *      each hold at least `MIN_READ` read messages: both counts printed, set
 *      side by side, no direction word, never first-against-last.
 *
 * NEVER A FIGURE. No score, no percent, no arrow leaves this module; the raw
 * point-scale numbers are read here and turned into a word, and only the word
 * goes out. A reading is ONE message's — the section never says the vendor is
 * terse, only that this message read terse.
 *
 * WHERE A WORD COMES FROM, per message:
 *   - automated mail (the inbound classifier's `is_automated`) — not assessed;
 *   - the house has Jev scoring ON and Jev scored it — the word from the point
 *     scale's named thresholds (`vendor-tone/tone-scale.ts`), or `unsure`
 *     below the confidence floor — not assessed;
 *   - Jev scoring ON and Jev FAILED on it — not assessed, with the reason.
 *     Never the inbound model's label in its place: a failure is not a
 *     reading, and a guessed word is the fault this section exists to avoid;
 *   - otherwise (the switch OFF, or ON and not scored yet) — the inbound
 *     model's stored label renamed (positive -> warm, neutral -> plain,
 *     negative -> terse), or not assessed when it holds none of the three.
 *
 * THE LINE A WORD RESTS ON is always the vendor's own sentence: Jev's pick is
 * an index into `splitSentences` of the stored message, and the inbound
 * model's `tone_quote` is shown only when it occurs verbatim in the message.
 * Otherwise the row says the read kept no line.
 */

import {
  THRESHOLDS,
  ToneWord,
  clip,
  latestPart,
  splitSentences,
  wordOfLabel,
  wordOfScore,
} from "../../vendor-tone/tone-scale";
import { languageCovered } from "../../vendor-tone/sensitive-mask";
import { MAIL_COPY } from "./vendor-mail-tone.copy";

/** Read messages each window needs before C's sentence is written. */
export const MIN_READ = 5;
/** Messages shown before the act opens the rest. */
export const SHOWN = 6;
/** The most messages one answer lists (the act opens up to this many). */
export const LISTED_CAP = 60;

export type MailState =
  | "answered"
  | "too_few"
  | "not_assessed"
  | "no_mail"
  | "could_not_read";

export type ReadBy = "jev" | "inbound_model";

export interface InboundMessageRow {
  id: string;
  received_at: string | null;
  message_text: string | null;
  content?: string | null;
  email_headers?: { subject?: unknown } | null;
  detected_sentiment: string | null;
  conversation_context?: {
    analysis?: { tone_quote?: unknown } | null;
    classification?: { is_automated?: unknown } | null;
  } | null;
}

export interface ToneScoreRow {
  message_id: string;
  status: string;
  reason: string | null;
  valence: number | string | null;
  friction: number | string | null;
  confidence: number | string | null;
  quote_index: number | null;
}

export interface MailMessage {
  id: string;
  at: string;
  subject: string | null;
  word: ToneWord | null;
  /** Why there is no word, in words; null when there is one. */
  notAssessed: string | null;
  /** The vendor's own line the word rests on, or null. */
  quote: string | null;
  /** Why no line is quoted, when a word has none; null otherwise. */
  quoteMissing: string | null;
  readBy: ReadBy | null;
}

export interface MailToneSection {
  providerId: string;
  window: { days: number; from: string; to: string; priorFrom: string };
  state: MailState;
  /** Whether Jev reads this house's mail, and whether this server can reach it. */
  jev: "on" | "off" | "on_unavailable";
  /** The standing line — counts of messages and of readings, no figure. */
  standing: string;
  /** Every message in the window, newest first, up to LISTED_CAP. */
  messages: MailMessage[];
  /** How many to show before the act opens the rest. */
  shown: number;
  /** Messages in the window beyond LISTED_CAP, not listed. */
  beyondCap: number;
  /** C's sentence, or null when either window has fewer than MIN_READ read. */
  comparison: string | null;
  /** The note at the foot (the comparison's place when there is none). */
  note: string;
  /** The reason the register did not answer, when it did not. */
  reason: string | null;
}

export interface MailInput {
  providerId: string;
  days: number;
  now: Date;
  jevOn: boolean;
  jevAvailable: boolean;
  /** Inbound mail of this vendor from the prior window's start; or the failure. */
  mail: { ok: true; rows: InboundMessageRow[] } | { ok: false; reason: string };
  /** Jev's rows for those messages (read only when the switch is on); or the failure. */
  scores:
    | { ok: true; rows: ToneScoreRow[] }
    | { ok: false; reason: string }
    | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ms(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function n(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function subjectOf(r: InboundMessageRow): string | null {
  const s = r.email_headers?.subject;
  if (typeof s !== "string" || !s.trim()) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 120 ? t : `${t.slice(0, 119).trimEnd()}…`;
}

function textOf(r: InboundMessageRow): string {
  return String(r.message_text ?? r.content ?? "");
}

/** The inbound model's tone quote, only if it is the vendor's own words verbatim. */
function verbatimQuote(r: InboundMessageRow): string | null {
  const q = r.conversation_context?.analysis?.tone_quote;
  if (typeof q !== "string") return null;
  const t = q.trim();
  if (t.length < 2) return null;
  return textOf(r).includes(t) ? clip(t) : null;
}

/** One message's reading. Exported for the spec. */
export function readingOf(
  r: InboundMessageRow,
  jevOn: boolean,
  score: ToneScoreRow | undefined,
): Omit<MailMessage, "id" | "at" | "subject"> {
  if (r.conversation_context?.classification?.is_automated === true)
    return {
      word: null,
      notAssessed: MAIL_COPY.notAssessed.automated,
      quote: null,
      quoteMissing: null,
      readBy: null,
    };
  // ADR 0207 round 4 — "sensitive topics redacted" can only be true of a
  // language the private-topic pass reads, so while Jev is on, a message in
  // any other language was not sent and says so (no new MailState). While Jev
  // is off nothing is sent at all and the inbound model's own reading shows,
  // whatever the language. [Last call, 2026-09-22: this ran whatever the
  // switch said, so every house — Jev is off for all of them — lost the
  // inbound reading of its Italian and French vendor mail; and it read the
  // raw message, quoted thread included, not the part that would leave.]
  if (jevOn && !languageCovered(latestPart(textOf(r))))
    return {
      word: null,
      notAssessed: MAIL_COPY.notAssessed.language,
      quote: null,
      quoteMissing: null,
      readBy: null,
    };
  if (jevOn && score) {
    if (score.status !== "scored")
      return {
        word: null,
        notAssessed: MAIL_COPY.notAssessed.jevFailed(score.reason),
        quote: null,
        quoteMissing: null,
        readBy: "jev",
      };
    const valence = n(score.valence);
    const friction = n(score.friction);
    const confidence = n(score.confidence);
    if (valence === null || friction === null || confidence === null)
      return {
        word: null,
        notAssessed: MAIL_COPY.notAssessed.jevFailed(null),
        quote: null,
        quoteMissing: null,
        readBy: "jev",
      };
    const w = wordOfScore({ valence, friction, confidence });
    if (w === "unsure")
      return {
        word: null,
        notAssessed: MAIL_COPY.notAssessed.unsure(THRESHOLDS.MIN_CONFIDENCE),
        quote: null,
        quoteMissing: null,
        readBy: "jev",
      };
    const sentences = splitSentences(textOf(r));
    const i = score.quote_index;
    const quote =
      typeof i === "number" &&
      Number.isInteger(i) &&
      i >= 0 &&
      i < sentences.length
        ? clip(sentences[i])
        : null;
    return {
      word: w,
      notAssessed: null,
      quote,
      quoteMissing: quote ? null : MAIL_COPY.quoteMissing,
      readBy: "jev",
    };
  }
  const w = wordOfLabel(r.detected_sentiment);
  if (!w)
    return {
      word: null,
      notAssessed: MAIL_COPY.notAssessed.noReading,
      quote: null,
      quoteMissing: null,
      readBy: null,
    };
  const quote = verbatimQuote(r);
  return {
    word: w,
    notAssessed: null,
    quote,
    quoteMissing: quote ? null : MAIL_COPY.quoteMissing,
    readBy: "inbound_model",
  };
}

function wordCounts(list: { word: ToneWord | null }[]): {
  read: number;
  warm: number;
  plain: number;
  terse: number;
} {
  const c = { read: 0, warm: 0, plain: 0, terse: 0 };
  for (const m of list)
    if (m.word) {
      c.read += 1;
      c[m.word] += 1;
    }
  return c;
}

export function buildMailToneSection(input: MailInput): MailToneSection {
  const to = input.now.getTime();
  const from = to - input.days * DAY_MS;
  const priorFrom = from - input.days * DAY_MS;
  const window = {
    days: input.days,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    priorFrom: new Date(priorFrom).toISOString(),
  };
  const jev: MailToneSection["jev"] = !input.jevOn
    ? "off"
    : input.jevAvailable
      ? "on"
      : "on_unavailable";
  const refuse = (reason: string): MailToneSection => ({
    providerId: input.providerId,
    window,
    state: "could_not_read",
    jev,
    standing: MAIL_COPY.standing.couldNotRead(input.days),
    messages: [],
    shown: 0,
    beyondCap: 0,
    comparison: null,
    note: MAIL_COPY.note.couldNotRead(reason),
    reason,
  });
  if (!input.mail.ok) return refuse(input.mail.reason);
  if (input.jevOn && input.scores && !input.scores.ok)
    return refuse(input.scores.reason);

  const scoreOf = new Map<string, ToneScoreRow>();
  if (input.jevOn && input.scores && input.scores.ok)
    for (const s of input.scores.rows) scoreOf.set(s.message_id, s);

  const current: MailMessage[] = [];
  const prior: { word: ToneWord | null }[] = [];
  const rows = [...input.mail.rows].sort(
    (a, b) => (ms(b.received_at) ?? 0) - (ms(a.received_at) ?? 0),
  );
  for (const r of rows) {
    const at = ms(r.received_at);
    if (at === null || at > to || at < priorFrom) continue;
    const reading = readingOf(r, input.jevOn, scoreOf.get(r.id));
    if (at >= from)
      current.push({
        id: r.id,
        at: new Date(at).toISOString(),
        subject: subjectOf(r),
        ...reading,
      });
    else prior.push({ word: reading.word });
  }

  const cur = wordCounts(current);
  const pri = wordCounts(prior);
  const total = current.length;
  const state: MailState =
    total === 0
      ? "no_mail"
      : cur.read === 0
        ? "not_assessed"
        : cur.read < MIN_READ
          ? "too_few"
          : "answered";

  const comparison =
    cur.read >= MIN_READ && pri.read >= MIN_READ
      ? MAIL_COPY.comparison(MIN_READ, cur, pri)
      : null;

  const note =
    state === "no_mail"
      ? MAIL_COPY.note.noMail(input.days)
      : state === "not_assessed"
        ? MAIL_COPY.note.notAssessed
        : state === "too_few"
          ? MAIL_COPY.note.tooFew(cur.read, MIN_READ)
          : MAIL_COPY.note.answered;

  return {
    providerId: input.providerId,
    window,
    state,
    jev,
    standing: MAIL_COPY.standing.answered(input.days, total, cur.read, jev),
    messages: current.slice(0, LISTED_CAP),
    shown: SHOWN,
    beyondCap: Math.max(0, current.length - LISTED_CAP),
    comparison,
    note,
    reason: null,
  };
}
