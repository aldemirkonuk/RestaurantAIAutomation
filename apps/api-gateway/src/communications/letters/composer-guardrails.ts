/**
 * The composer's guardrails, as one pure function two channels call.
 *
 * WHY THIS FILE APPEARED (ADR 0121 P1)
 * ------------------------------------
 * These rules were a method on `HouseLettersService`. ADR 0121 says the
 * WhatsApp send path runs *"the composer's existing guards … unchanged"* — and
 * the text path cannot inject `HouseLettersService`, because that service lives
 * in `CommunicationsModule` and `TextSendersModule` exists precisely to stay off
 * the `auth -> communications -> auth` require ring
 * (`text-senders.module.ts` header).
 *
 * The two ways out were: copy the rules into the text path, or move them
 * somewhere both can call. Copying is what makes two guards drift — a
 * commitment phrase added to the letter's list and not the text's would be a
 * hole nobody could see, on the channel ADR 0121 says needs the guard MORE
 * ("a text is short and reads as casual, which is precisely when a person types
 * 'yes, send them'").
 *
 * So the code moved and did not change. `HouseLettersService.guardrails` now
 * delegates here; the letter path's behaviour is byte-identical, and the text
 * path runs the same function rather than a second copy of it.
 *
 * NOTHING IS ADDED HERE. The text-specific rules ADR 0121 names — STOP/HELP,
 * quiet hours, the 24-hour window — are NOT in this file. They are not the
 * composer's guardrails, they are the transport's rules, and they live where
 * they are enforced (the window in `WhatsAppBookService.windowFor`, the
 * Türkiye opt-out in `TwilioAdapter.buildRequest`). Putting them here would
 * make the letter path run checks that have no meaning for it.
 */

import { COMMITMENT_PATTERN_SOURCES } from "../../common/orchestrator/commitment-patterns";

export interface GuardrailHit {
  rule: string;
  /** The sentence shown to the writer. Never a code, never silent. */
  says: string;
  blocking: boolean;
}

export const COMMITMENT_RE = COMMITMENT_PATTERN_SOURCES.map(
  (s) => new RegExp(s, "i"),
);

/** An unresolved merge token: `{{ anything }}`. */
// `[^{}]+` between the literal braces: one quantifier, nothing adjacent for it
// to share a character with, so the match is linear in the letter's length. The
// earlier `\s*[^}]+\s*` let a space match either side and backtracked
// quadratically on a body full of them.
export const UNRESOLVED_TOKEN_RE = /\{\{[^{}]+\}\}/;

function firstMatch(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  return m ? m[0] : null;
}

/**
 * The rules, in the words the writer reads.
 *
 * `subject` is `""` for a channel that has none. That is not a special case:
 * the commitment scan runs over subject-and-body joined, and joining an empty
 * subject changes nothing about what it finds in the body.
 */
export function composerGuardrails(params: {
  body: string;
  subject: string;
  priorOutboundOnOrder: number | null;
}): GuardrailHit[] {
  const hits: GuardrailHit[] = [];
  const text = `${params.subject}\n${params.body}`;

  const matched = COMMITMENT_RE.filter((p) => p.test(text));
  if (matched.length > 0) {
    const phrase = firstMatch(text, matched[0]);
    hits.push({
      rule: "commitment_language",
      says: `This letter contains language that can form a binding purchase commitment${phrase ? ` — "${phrase}"` : ""}. Mudavym will not send a commitment from a free-text letter. Rewrite the sentence, or place the order so the commitment is the order and not the prose.`,
      blocking: true,
    });
  }

  const token = UNRESOLVED_TOKEN_RE.exec(params.body);
  if (token) {
    hits.push({
      rule: "unresolved_merge_field",
      says: `The letter still contains an unfilled merge field (${token[0]}). Fill it or delete the sentence — a letter that ships a raw placeholder tells the vendor a figure exists when none was found.`,
      blocking: true,
    });
  }

  if (
    params.priorOutboundOnOrder !== null &&
    params.priorOutboundOnOrder + 1 >= 3
  ) {
    hits.push({
      rule: "max_rounds",
      says: `This is message ${params.priorOutboundOnOrder + 1} from the house on this order. The AI reply path stops and asks for approval at three; you are the approval, so this is stated, not blocked.`,
      blocking: false,
    });
  }

  return hits;
}
