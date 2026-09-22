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
 * Nothing leaves when the text is empty after masking.
 */

import { MaskCounts, MASK, maskForEgress } from "./pii-mask";
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
  const whole = maskForEgress(latest, knownNames);
  const stripped = whole.text
    .split(MASK.email)
    .join("")
    .split(MASK.phone)
    .join("")
    .split(MASK.name)
    .join("")
    .trim();
  if (stripped.length < 2) return null;

  const names = [...knownNames, ...whole.found];
  const candidates: QuoteCandidate[] = [];
  splitSentences(text).forEach((s, index) => {
    if (candidates.length >= QUOTE_MAX_CANDIDATES) return;
    const masked = maskForEgress(s, names).text;
    if (isSignatureLike(masked)) return;
    candidates.push({ index, text: masked });
  });

  return {
    body: buildJevRequest(whole.text, candidates),
    candidates,
    masked: whole.masked,
  };
}
