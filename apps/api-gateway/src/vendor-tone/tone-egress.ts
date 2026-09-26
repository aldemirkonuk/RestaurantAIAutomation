/**
 * The one way a vendor message becomes a Jev request (ADR 0207, round 3).
 *
 * The founder's egress ruling, 2026-09-21: *"Only with names removed"*. So the
 * request is built HERE, from masked text only, and nowhere else:
 *
 *   1. the latest part of the message (the quoted thread below it is cut —
 *      the house's own earlier words are not the vendor's tone);
 *   2. masked whole, with the line structure intact, so a greeting's and a
 *      sign-off's names are found where they sit;
 *   3. cut into the vendor's sentences, each masked again with every name the
 *      whole-text pass found, so a sign-off's name cannot survive in a
 *      sentence cut away from its sign-off;
 *   4. greetings, sign-offs and signature lines are not offered as quotes —
 *      the line a word rests on is a sentence the vendor wrote about the
 *      business, and a signature line is where a name the masker was never
 *      told is likeliest to sit.
 *
 * Nothing leaves when the text is empty after masking, or when its latest part
 * is not in a language the private-topic pass reads (ADR 0207 round 4).
 */

import { MaskCounts, MASK, maskForEgress } from "./pii-mask";
import { SENSITIVE_MASK, languageCovered } from "./sensitive-mask";
import {
  QUOTE_MAX_CANDIDATES,
  QuoteCandidate,
  buildJevRequest,
  latestPart,
  splitSentences,
} from "./tone-scale";

export interface EgressPayload {
  body: ReturnType<typeof buildJevRequest>;
  candidates: QuoteCandidate[];
  masked: MaskCounts;
}

const OPENERS =
  /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|merhaba|sayın|selam)\b/iu;
const CLOSERS =
  /^(?:best(?: regards| wishes)?|kind regards|warm regards|regards|thanks|thank you|many thanks|cheers|sincerely|yours(?: sincerely)?|saygılarımla|saygılarımızla|teşekkürler|iyi çalışmalar)\b[\s,.!]*$/iu;

/**
 * A line that is not a sentence about the business: an opener, a closer, or a
 * signature line (four words or fewer, none of them starting lower-case — a
 * name, a title, a company, "[name]").
 */
export function isSignatureLike(sentence: string): boolean {
  const s = sentence.trim();
  if (OPENERS.test(s) && s.split(/\s+/).length <= 4) return true;
  if (CLOSERS.test(s)) return true;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && !words.some((w) => /^\p{Ll}/u.test(w))) return true;
  return false;
}

/** Null when there is nothing to send once the people are taken out. */
export function egressFor(
  text: string,
  knownNames: readonly (string | null | undefined)[],
): EgressPayload | null {
  const latest = latestPart(text);
  // ADR 0207 round 4 — the private-topic pass reads Turkish and English only,
  // so a latest part it cannot read is not sent (choice 30, fail closed).
  // Checked HERE, on the part that leaves, so no caller can send around it.
  // [Last call, 2026-09-22: the gate lived only in the sweep, on the raw
  // message — an Italian reply above an English quoted thread passed on the
  // thread's words.]
  if (!languageCovered(latest)) return null;
  const whole = maskForEgress(latest, knownNames);
  // ADR 0207 round 4 — the sensitive-mask tokens join the emptiness check
  // too: a message that was nothing BUT an account number, an id or a
  // private-topic sentence must not be sent as an empty-looking shell.
  const stripped = whole.text
    .split(MASK.email)
    .join("")
    .split(MASK.phone)
    .join("")
    .split(MASK.name)
    .join("")
    .split(SENSITIVE_MASK.account)
    .join("")
    .split(SENSITIVE_MASK.id)
    .join("")
    .split(SENSITIVE_MASK.credential)
    .join("")
    .split(SENSITIVE_MASK.private)
    .join("")
    .trim();
  if (stripped.length < 2) return null;

  const names = [...knownNames, ...whole.found];
  // A candidate is offered only if it is, word for word, in the masked body
  // that leaves. A sentence the whole-text pass removed — a private sentence
  // wrapped across lines, whose line-cut halves each look harmless on their
  // own — is therefore never offered as a quote. [Last call, 2026-09-22.]
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  const sentBody = flat(whole.text);
  const candidates: QuoteCandidate[] = [];
  splitSentences(text).forEach((s, index) => {
    if (candidates.length >= QUOTE_MAX_CANDIDATES) return;
    const masked = maskForEgress(s, names).text;
    if (!sentBody.includes(flat(masked))) return;
    // A sentence the topics pass replaced whole is dropped explicitly — not
    // by isSignatureLike's accident, which was built to catch openers and
    // signatures, not a sentence a person actually wrote about the business
    // that happened to be private. Offering "[private]" as though it were a
    // quote would tell Jev (and, on the sheet, the reader) that this is the
    // line the score rests on, which is exactly the disclosure this pass
    // exists to prevent.
    if (masked.trim() === SENSITIVE_MASK.private) return;
    if (isSignatureLike(masked)) return;
    candidates.push({ index, text: masked });
  });

  return {
    body: buildJevRequest(whole.text, candidates),
    candidates,
    masked: whole.masked,
  };
}
