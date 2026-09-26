/**
 * The point scale a vendor message is scored on, and the one word the vendor
 * sheet shows for it (ADR 0207, round 3).
 *
 * THE FOUNDER, 2026-09-21: *"talk with JEV, put that onto point scale, very
 * detailed, seuper intelligent ML data needed. this feature can also be
 * disabled. other than that use warm/plain/terse"*.
 *
 * THE SCALE (`tone-scale/1`), every number rounded to 0.01:
 *
 *   valence     -1 .. 1   how the message reads toward the house — Jev's Score
 *                         on five ordered levels (hostile .. very warm), mapped
 *                         linearly: level 0 is -1, level 2 is 0, level 4 is 1
 *   friction     0 .. 1   pushes back, refuses, disputes or complains
 *   urgency      0 .. 1   presses for a quick answer or signals scarcity
 *   commitment   0 .. 1   commits to a concrete act, date, quantity or price
 *   apology      0 .. 1   apologises or admits a fault
 *   escalation   0 .. 1   threatens or signals escalation (a senior person,
 *                         legal, stopping supply, ending the account)
 *   confidence   0 .. 1   Jev's own confidence in the valence answer
 *   quote        which of the message's sentences best shows how it reads — a
 *                Choice over OUR candidate sentences, so the line the word rests
 *                on is always the vendor's own words, never generated text
 *
 * One call, every question in parallel (TypeSafe's Speculative Fan-Out). Jev
 * does not count, compare dates or generate text (its own limitations page),
 * and none of these questions asks it to.
 *
 * THE WORD, from the scale — named thresholds, all Proposed (the founder asked
 * for warm / plain / terse and a point scale; where the lines fall is the
 * builder's, listed in ADR 0207):
 *
 *   unsure  confidence below MIN_CONFIDENCE          -> "not assessed"
 *   terse   valence at or below TERSE_AT_MOST, or friction at or above
 *           TERSE_FRICTION
 *   warm    valence at or above WARM_AT_LEAST
 *   plain   everything between
 *
 * The raw numbers never leave the gateway on a house route. A reader sees one
 * word and the line it rests on.
 */

export const TONE_SCALE_VERSION = "tone-scale/1";
/** The model alias asked for; the answering version is stored when Jev names it. */
export const JEV_MODEL = "jev-latest";

export const THRESHOLDS = {
  /** At or above: warm. */
  WARM_AT_LEAST: 0.25,
  /** At or below: terse. */
  TERSE_AT_MOST: -0.25,
  /** Friction at or above this reads terse whatever the valence. */
  TERSE_FRICTION: 0.6,
  /** Below this confidence the reading is not shown as a word. */
  MIN_CONFIDENCE: 0.5,
} as const;

export type ToneWord = "warm" | "plain" | "terse";

/** Five ordered levels. Jev returns a position on them, possibly between two. */
export const VALENCE_LEVELS = [
  "Hostile: the vendor writes to the restaurant with anger, contempt or threats.",
  "Cold: curt, grudging or displeased; no warmth toward the restaurant.",
  "Neutral: plain and businesslike; neither warm nor cold.",
  "Warm: friendly, appreciative or helpful toward the restaurant.",
  "Very warm: openly glad to help, thanks the restaurant, goes out of its way.",
] as const;

export const FACETS = {
  friction:
    "Does the vendor push back, refuse, dispute something, or complain in this message?",
  urgency:
    "Does the vendor press for a quick answer or decision, or signal that stock, a price or an offer is running out?",
  commitment:
    "Does the vendor commit to a concrete action, date, quantity or price in this message?",
  apology:
    "Does the vendor apologise or admit a mistake or a fault in this message?",
  escalation:
    "Does the vendor threaten or signal escalation — involving someone senior, legal action, stopping supply, or ending the account?",
} as const;

export type FacetKey = keyof typeof FACETS;
export const FACET_KEYS = Object.keys(FACETS) as FacetKey[];

/** The most sentences offered to the quote Choice; longer mail offers its first ones. */
export const QUOTE_MAX_CANDIDATES = 12;
/** A sentence longer than this is offered cut, and shown cut. */
export const QUOTE_MAX_CHARS = 240;

export interface ToneScore {
  valence: number;
  friction: number;
  urgency: number;
  commitment: number;
  apology: number;
  escalation: number;
  confidence: number;
  /**
   * The picked sentence's index in `splitSentences(original)` — the vendor's
   * own sentence, read back through the same splitter — or null.
   */
  quoteIndex: number | null;
  quoteConfidence: number | null;
  /** The model that answered, when the reply names it in Jev's own shape. */
  modelVersion: string | null;
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * The labels a mail client writes in the header block above a message it
 * quotes, in English and Turkish (Gmail, Outlook, Outlook on the web, Apple
 * Mail). A FROM label must be one line of the pair that marks a block.
 */
const FROM_LABELS = /^(?:from|kimden|gönderen)$/iu;
const HEADER_LABELS =
  /^(?:from|sent|date|to|cc|bcc|subject|kimden|gönderen|gönderildi|gönderilme tarihi|gönderim tarihi|tarih|kime|bilgi|gizli|konu)$/iu;
/** "From:", "From :", "**From:**", "Kimden:" — the label a header line starts with, or null. */
function headerLabelOf(line: string): string | null {
  const m =
    /^[ \t]*[*_]{0,2}[ \t]*(\p{L}[\p{L} ]{0,24}?)[ \t]*[*_]{0,2}[ \t]*:/u.exec(
      line,
    );
  if (!m) return null;
  const label = m[1].trim();
  return HEADER_LABELS.test(label) ? label : null;
}
/** A line that can open a reply header: "On Mon, …", "21 Eyl 2026 …", "… tarihinde …". */
function opensReplyHeader(line: string): boolean {
  return (
    /^[ \t]*On\s/iu.test(line) ||
    /(?:^|\s)tarihinde(?:\s|$)/iu.test(line) ||
    /^[ \t]*\d{1,2}[ ./-]+\p{L}{3,}\.?[ ./-]+\d{4}/u.test(line) ||
    /^[ \t]*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/u.test(line) ||
    /^[ \t]*\d{4}-\d{2}-\d{2}/u.test(line)
  );
}
/** Separator lines that start a quoted or forwarded message, whatever sits below them. */
const SEPARATOR_LINES = [
  /^[ \t]*-{2,}[ \t]*(?:Original Message|Forwarded message|(?:Özgün|Orijinal|Orjinal|Asıl|İletilen|Yönlendirilen|İletilmiş) [İIi]leti)[ \t]*-{2,}/iu,
  /^[ \t]*(?:Begin forwarded message|İletilmiş ileti başlangıcı)[ \t]*:/iu,
  /^[ \t]*_{10,}[ \t]*$/u,
  /^[ \t]*>/u,
];
/** How far above a "wrote:" / "yazdı:" line a wrapped reply header may have started. */
const WRAPPED_HEADER_LINES = 2;

/**
 * The latest message only: a reply quotes the thread below it, and the tone of
 * the house's own earlier words is not the vendor's — nor may the earlier
 * thread leave with it (the terms, `house-data-terms.ts` `jev-tone-scoring`).
 * Cut at the first line where any of these starts, on the text's own lines:
 *
 *   - a header block: two header lines within three lines of each other, one
 *     of them a FROM label ("From:", "Kimden:", "Gönderen:") and the other any
 *     header label ("Sent:", "Date:", "Gönderildi:", "Tarih:", "Konu:", …) —
 *     in any order, with or without a space after the colon, bold or not, and
 *     with the FROM value wrapped onto the next line;
 *   - a reply line ending "wrote:" or "yazdı:" — cut where its header opens,
 *     up to two lines above when the client wrapped it ("On …", a date,
 *     "… tarihinde …");
 *   - a separator ("-----Original Message-----", "-----Özgün İleti-----",
 *     "---------- Forwarded message ---------", "Begin forwarded message:",
 *     Outlook's underscore rule) or a quoted ">" line.
 *
 * A cut that fires on the vendor's own words only makes the part shorter —
 * less leaves, never more. A thread quoted in a shape none of these know is
 * not cut: the terms name that residual risk.
 *
 * [Audit of PR #435 at 2f78b659, 2026-09-26: the cut knew English headers only,
 * on one line, with a space after "From:" — a Turkish Outlook reply
 * ("Kimden: … Gönderildi: …"), "From:X\nSent:Y", and a wrapped "On … wrote:"
 * header all sent the earlier thread whole.]
 */
export function latestPart(text: string): string {
  const src = typeof text === "string" ? text.replace(/\r\n?/g, "\n") : "";
  const lines = src.split("\n");
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const cutAt = (i: number) => src.slice(0, starts[i]).trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SEPARATOR_LINES.some((re) => re.test(line))) return cutAt(i);

    const label = headerLabelOf(line);
    if (label !== null) {
      for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
        const next = headerLabelOf(lines[j]);
        if (
          next !== null &&
          (FROM_LABELS.test(label) || FROM_LABELS.test(next))
        )
          return cutAt(i);
      }
    }

    if (/(?:wrote|yazdı|yazmış)[ \t]*:[ \t]*$/iu.test(line)) {
      let open = i;
      for (let k = i; k >= Math.max(0, i - WRAPPED_HEADER_LINES); k--) {
        if (k < i && lines[k].trim() === "") break;
        if (opensReplyHeader(lines[k])) open = k;
      }
      return cutAt(open);
    }
  }
  return src.trim();
}

/**
 * The message's sentences, in order: split at . ! ? followed by space or line
 * end, and at blank lines and line breaks. A dot inside an address or a number
 * ("a.b@c.com", "1.620") has no space after it, so it never splits. Empty and
 * one-character pieces are dropped. Deterministic and part of the scale's
 * version: the stored quote index is read back through this same function.
 */
export function splitSentences(text: string): string[] {
  const src = latestPart(text);
  const out: string[] = [];
  for (const line of src.split(/\n+/)) {
    for (const piece of line.split(/(?<=[.!?…])\s+/)) {
      const s = piece.replace(/\s+/g, " ").trim();
      if (s.length > 1) out.push(s);
    }
  }
  return out;
}

/** A sentence as offered and as shown: whole up to the cap, else cut with an ellipsis. */
export function clip(s: string): string {
  return s.length <= QUOTE_MAX_CHARS
    ? s
    : `${s.slice(0, QUOTE_MAX_CHARS - 1).trimEnd()}…`;
}

/** Candidate keys are ours ("s1".."s12"), so the Choice can only name one of them. */
export function candidateKey(i: number): string {
  return `s${i + 1}`;
}

/** A sentence offered to the quote Choice: its index in `splitSentences(original)`, masked. */
export interface QuoteCandidate {
  index: number;
  text: string;
}

/**
 * The request body for one message. `maskedText` is the message's latest part
 * AFTER masking and `candidates` its sentences after masking — the only text
 * that leaves. Nothing here masks; `tone-egress.ts` does, before this is called.
 */
export function buildJevRequest(
  maskedText: string,
  candidates: readonly QuoteCandidate[],
): {
  state: { vendor_message: string };
  model: string;
  questions: Record<string, unknown>;
} {
  const offered = candidates.slice(0, QUOTE_MAX_CANDIDATES);
  const questions: Record<string, unknown> = {
    valence: {
      type: "score",
      instructions:
        "This is one email a supplier sent to a restaurant. How does it read toward the restaurant? Judge only the supplier's own words in this message.",
      criteria: [...VALENCE_LEVELS],
    },
  };
  for (const k of FACET_KEYS)
    questions[k] = { type: "noul", instructions: FACETS[k] };
  if (offered.length > 0) {
    const criteria: Record<string, string> = {};
    offered.forEach((c, i) => {
      criteria[candidateKey(i)] = clip(c.text);
    });
    questions.quote = {
      type: "choice",
      instructions:
        "Which one sentence of this email shows most clearly how it reads toward the restaurant?",
      criteria,
    };
  }
  return {
    state: { vendor_message: maskedText },
    model: JEV_MODEL,
    questions,
  };
}

/** A real number in range, or null. Rejects bool, strings and NaN. */
function num(value: unknown, low: number, high: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < low || value > high) return null;
  return value;
}

function section(
  answers: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const v = answers[key];
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * Read Jev's reply. EVERY FIELD IS REMOTE INPUT: a number must be a number in
 * its range, the quote must be one of OUR candidate keys, and the model name is
 * kept only in Jev's own shape. Anything missing or out of range fails the
 * whole reading — a message is `not assessed`, never half-scored.
 */
export function readJevAnswers(
  raw: unknown,
  candidates: readonly QuoteCandidate[],
): { ok: true; score: ToneScore } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, reason: "Jev answered with no object" };
  const body = raw as Record<string, unknown>;
  const answers =
    body.answers &&
    typeof body.answers === "object" &&
    !Array.isArray(body.answers)
      ? (body.answers as Record<string, unknown>)
      : null;
  if (!answers) return { ok: false, reason: "Jev answered with no answers" };

  const v = section(answers, "valence");
  const level = num(v.score, 0, VALENCE_LEVELS.length - 1);
  if (level === null)
    return { ok: false, reason: "Jev's valence was missing or out of range" };
  const confidence = num(v.confidence, 0, 1);
  if (confidence === null)
    return {
      ok: false,
      reason: "Jev's valence carried no confidence in range",
    };

  const facets = {} as Record<FacetKey, number>;
  for (const k of FACET_KEYS) {
    const f = num(section(answers, k).noul, 0, 1);
    if (f === null)
      return { ok: false, reason: `Jev's ${k} was missing or out of range` };
    facets[k] = round2(f);
  }

  let quoteIndex: number | null = null;
  let quoteConfidence: number | null = null;
  const offered = candidates.slice(0, QUOTE_MAX_CANDIDATES);
  if (offered.length > 0) {
    const q = section(answers, "quote");
    const choice = q.choice;
    if (typeof choice === "string") {
      offered.forEach((c, i) => {
        if (candidateKey(i) === choice) quoteIndex = c.index;
      });
    }
    const qc = num(q.confidence, 0, 1);
    quoteConfidence = quoteIndex === null || qc === null ? null : round2(qc);
  }

  const model =
    typeof body.model === "string" &&
    /^jev-[A-Za-z0-9.-]{1,40}$/.test(body.model)
      ? body.model
      : null;

  const half = (VALENCE_LEVELS.length - 1) / 2;
  return {
    ok: true,
    score: {
      valence: round2(Math.max(-1, Math.min(1, (level - half) / half))),
      ...facets,
      confidence: round2(confidence),
      quoteIndex,
      quoteConfidence,
      modelVersion: model,
    },
  };
}

/**
 * The one word for a score, or `unsure` when Jev was not confident enough to
 * show one. The thresholds are named above and nowhere else.
 */
export function wordOfScore(s: {
  valence: number;
  friction: number;
  confidence: number;
}): ToneWord | "unsure" {
  if (!(s.confidence >= THRESHOLDS.MIN_CONFIDENCE)) return "unsure";
  if (
    s.valence <= THRESHOLDS.TERSE_AT_MOST ||
    s.friction >= THRESHOLDS.TERSE_FRICTION
  )
    return "terse";
  if (s.valence >= THRESHOLDS.WARM_AT_LEAST) return "warm";
  return "plain";
}

/**
 * The inbound model's stored label (`procurement_conversations.detected_sentiment`,
 * the Haiku call), renamed for reading — the fallback when Jev has not scored
 * a message. Anything but the three labels is no reading at all.
 */
export function wordOfLabel(label: string | null | undefined): ToneWord | null {
  switch (
    String(label ?? "")
      .trim()
      .toLowerCase()
  ) {
    case "positive":
      return "warm";
    case "neutral":
      return "plain";
    case "negative":
      return "terse";
    default:
      return null;
  }
}
