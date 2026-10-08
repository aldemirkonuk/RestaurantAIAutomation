/**
 * A failure, in the house's words (INV-W31).
 *
 * The page used to paste `getErrorMessage(e)` into its sentences. That hands a
 * person "Request failed with status code 500", "Network Error" or a database
 * message, and every write failure also said "the gateway refused". Worse, a
 * write whose server failed partway (5xx) or never answered still read
 * "Nothing was written off", when it may have landed.
 *
 * The rules here:
 * - The server's own sentence is kept only when it is written for a person.
 *   This is the /connections rule (`cx-format.ts` plainReason, founder ruling
 *   2026-09-22), widened for this page's servers: camelCase field names, axios
 *   wording and database words are operator text too.
 * - Otherwise the status code says it, in plain words.
 * - A write whose outcome is unknown (`isUnconfirmedWrite`) says so, and says
 *   what to check before trying again. Retrying is safe only where the server
 *   dedupes a key the sheet keeps across attempts: the spot count
 *   (`count:<item>:<clientCountId>`), the ledger write-off
 *   (apply_stock_movement returns the existing row on a replayed key) and the
 *   pour (record_glass_pour returns the existing pour_event).
 */
import axios from 'axios';
import { getErrorStatus, isUnconfirmedWrite } from '../../../services/api/client';

/** Case matters here: these are names written for code, not people. */
const CODE_NAME =
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Z][a-z]+[A-Z]\w*\b|\bID\b|\bOAuth\b|\bJSON\b|\bHTTP\b|\bUUID\b/;
const OPERATOR_WORDS =
  /\/api\/|\b[a-z]+_[a-z_]+\b|https?:\/\/|webhook|status code|network error|timeout of|\bundefined\b|\bnull\b|\buuid\b|\brelation\b|\bconstraint\b|\bcolumn\b|\bsyntax\b|\bgateway\b|\bendpoint\b|\/[a-z][\w-]*\/|\bcannot (get|post|put|patch|delete)\b|^failed to\b|^internal server error|^bad request\b|^forbidden\b|^unauthorized\b|^not found\b/i;

/** A sentence longer than this is a stack or a dump, not a reason. */
const MAX_REASON = 160;

/** `text` when it is written for a person, else null. */
export function plainText(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/\.+$/, '');
  if (t === '' || t.length > MAX_REASON || CODE_NAME.test(t) || OPERATOR_WORDS.test(t)) return null;
  // Lower-case the first letter so it reads inside a sentence, but never an acronym.
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function serverSentence(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const raw = (e.response?.data as { message?: unknown } | undefined)?.message;
  return plainText(Array.isArray(raw) ? raw[0] : raw);
}

const REFUSED_WORDS: Record<number, string> = {
  400: 'the server did not accept it as sent',
  401: 'the sign-in has lapsed; sign in again, then try once more',
  403: 'this account is not allowed to do that in this house',
  404: 'the server could not find it; re-read the page',
  409: 'it clashes with a change made a moment ago; re-read the page',
  413: 'it is too large to send',
  422: 'the server did not accept it as sent',
  429: 'too many requests just now; wait a minute, then try again',
};

/**
 * Why it failed, as a clause that fits after a dash: no capital letter at the
 * start and no full stop at the end.
 */
export function failureReason(e: unknown): string {
  const status = getErrorStatus(e);
  if (status !== null && status >= 500) return 'the server failed before it could answer';
  if (axios.isAxiosError(e) && e.request && !e.response) return 'no answer came back';
  if (status !== null) return serverSentence(e) ?? REFUSED_WORDS[status] ?? 'the server turned it down';
  // Thrown on this device, before any request went out.
  return plainText(e instanceof Error ? e.message : null) ?? 'it stopped on this device before it was sent';
}

export interface WriteWords {
  /** What did not happen, when the write was refused: "Nothing was written off". */
  refused: string;
  /** What may have happened, when the outcome is unknown: "the write-off was recorded". */
  act: string;
  /** What to do before trying again when the outcome is unknown. */
  check: string;
}

/** Said when retrying is safe because the server dedupes the sheet's key. */
export const SAFE_RETRY = 'Trying again is safe: it is recorded once.';

/**
 * A failed write. `unknown` is true when the server failed partway or never
 * answered, so the write may have landed and the caller should re-read.
 */
export function writeFailure(e: unknown, words: WriteWords): { text: string; unknown: boolean } {
  if (isUnconfirmedWrite(e)) {
    const cause = getErrorStatus(e) === null ? 'No answer came back' : 'The server failed before it could answer';
    return { text: `${cause}, so it is not known whether ${words.act}. ${words.check}`, unknown: true };
  }
  return { text: `${words.refused} — ${failureReason(e)}.`, unknown: false };
}
