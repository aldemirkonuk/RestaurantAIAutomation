/**
 * Email triage — pure, side-effect-free helpers for classifying inbound vendor mail.
 *
 * These functions take already-parsed data (a header map, subject/body strings) and
 * derive routing signals. They implement Layer A (transport/header signals) and a light
 * Layer B (structural heuristics) of the triage design in
 * `.planning/INBOUND_EMAIL_INTELLIGENCE_PLAN.md` (Appendix A). The semantic Layer C
 * (the LLM's `email_class`) is decided elsewhere.
 *
 * Nothing here calls a model, touches the database, or changes what we send — it only
 * derives signals a caller may log now and, once validated in shadow mode, gate on later.
 * Keeping it pure is deliberate: it makes the security-relevant classification cheap to
 * unit-test in isolation.
 */

export type EmailClass =
  | 'negotiation_reply'
  | 'order_confirmation'
  | 'promotion'
  | 'catalogue_offer'
  | 'automated_transactional'
  | 'bounce_autoreply'
  | 'other';

/**
 * RFC-standard markers of bulk / automated / authenticated mail, distilled from the
 * raw header map. Booleans are best-effort; `spf/dkim/dmarc` are `null` when the
 * corresponding result is absent (unknown), not assumed to pass.
 */
export interface TransportSignals {
  /** `Precedence: bulk|list|junk`. */
  bulk: boolean;
  /** `List-Unsubscribe` / `List-Id` present — mailing list or ESP. */
  listMail: boolean;
  /** `Auto-Submitted: auto-*` (RFC 3834) or an `X-Autoreply`/`X-Autorespond` header. */
  autoSubmitted: boolean;
  /** `From` (or `Return-Path`) is a no-reply / marketing / bounce address. */
  noReplyFrom: boolean;
  /** ESP fingerprint (`mailchimp`, `sendgrid`, …) or `null` if none detected. */
  esp: string | null;
  /** SPF / DKIM / DMARC from `Authentication-Results`; `null` when absent. */
  spfPass: boolean | null;
  dkimPass: boolean | null;
  dmarcPass: boolean | null;
  /** Any strong bulk/automated marker is present. */
  isAutomated: boolean;
  /**
   * Best-effort sender authentication: DMARC pass (implies alignment) or DKIM pass
   * (domain-authenticated). SPF-only is intentionally NOT treated as verified — it can
   * pass without domain alignment. `false` means unverified OR failing, never "unknown".
   */
  senderVerified: boolean;
}

type HeaderMap = Record<string, string | number | null | undefined>;

/** Lower-case every header name and stringify values, tolerating a partial/empty map. */
function normalizeHeaders(headers: HeaderMap | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    if (k && v != null) out[k.toLowerCase()] = String(v);
  }
  return out;
}

/** Pull the bare email address out of a `From`/`Return-Path` header value. */
export function extractEmailAddress(fromHeader: string | null | undefined): string {
  const s = (fromHeader ?? '').toString();
  const angled = s.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : s).trim().toLowerCase();
  const bare = raw.match(/[^\s<>]+@[^\s<>]+/);
  return bare ? bare[0] : '';
}

const NO_REPLY_LOCALPART =
  /^(no-?reply|do-?not-?reply|donotreply|noreply|mailer(-daemon)?|bounce[sd]?|postmaster|notifications?|marketing|newsletter|news|info|updates?|mailer)$/i;

/** ESP / bulk-sender fingerprints keyed off common headers. */
function detectEsp(h: Record<string, string>): string | null {
  const mailer = (h['x-mailer'] || '').toLowerCase();
  if (h['x-sg-eid'] || h['x-sendgrid-eid'] || mailer.includes('sendgrid')) return 'sendgrid';
  if (h['x-mc-user'] || mailer.includes('mailchimp') || (h['feedback-id'] || '').includes('mc')) return 'mailchimp';
  if (h['x-cmail-id'] || mailer.includes('campaign monitor')) return 'campaignmonitor';
  if (mailer.includes('mailgun') || h['x-mailgun-sid']) return 'mailgun';
  if (h['x-ses-outgoing'] || mailer.includes('amazon ses')) return 'ses';
  if (h['x-campaignid'] || h['x-campaign'] || h['x-mailer-version']) return 'esp';
  if (h['feedback-id']) return 'esp';
  return null;
}

/** Read an `spf=/dkim=/dmarc=` verdict from an Authentication-Results value. */
function readAuthMethod(value: string, method: 'spf' | 'dkim' | 'dmarc'): boolean | null {
  if (!value) return null;
  const m = value.toLowerCase().match(
    new RegExp(`\\b${method}=(pass|fail|none|neutral|softfail|hardfail|temperror|permerror|policy)`),
  );
  if (!m) return null;
  return m[1] === 'pass';
}

/**
 * Derive transport/auth signals from a header map (as published by the inbound pipeline)
 * plus an optional explicit `From` value. Never throws.
 */
export function deriveTransportSignals(
  headers: HeaderMap | null | undefined,
  fromHeaderOverride?: string | null,
): TransportSignals {
  const h = normalizeHeaders(headers);

  const precedence = (h['precedence'] || '').toLowerCase();
  const bulk = ['bulk', 'list', 'junk'].includes(precedence.trim());

  const listMail = Boolean(h['list-unsubscribe'] || h['list-id'] || h['list-help']);

  const autoSub = (h['auto-submitted'] || '').toLowerCase().trim();
  const autoSubmitted =
    (autoSub !== '' && autoSub !== 'no') || Boolean(h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']);

  const fromValue = fromHeaderOverride ?? h['from'] ?? '';
  const fromAddr = extractEmailAddress(fromValue);
  const returnPathAddr = extractEmailAddress(h['return-path']);
  const localPart = (addr: string) => addr.split('@')[0] || '';
  const noReplyFrom =
    (fromAddr !== '' && NO_REPLY_LOCALPART.test(localPart(fromAddr))) ||
    (returnPathAddr !== '' && NO_REPLY_LOCALPART.test(localPart(returnPathAddr)));

  const esp = detectEsp(h);

  const auth = `${h['authentication-results'] || ''} ${h['arc-authentication-results'] || ''}`.trim();
  const spfPass = readAuthMethod(auth, 'spf');
  const dkimPass = readAuthMethod(auth, 'dkim');
  const dmarcPass = readAuthMethod(auth, 'dmarc');

  const isAutomated = bulk || listMail || autoSubmitted || noReplyFrom || esp !== null;
  const senderVerified = dmarcPass === true || dkimPass === true;

  return {
    bulk,
    listMail,
    autoSubmitted,
    noReplyFrom,
    esp,
    spfPass,
    dkimPass,
    dmarcPass,
    isAutomated,
    senderVerified,
  };
}

/** Promo/marketing keyword density in the subject + body (Layer B heuristic). */
const PROMO_KEYWORDS = [
  'unsubscribe', '% off', 'sale', 'discount', 'limited time', 'limited stock',
  'exclusive', 'allocation', 'new arrival', 'new release', 'closeout', 'clearance',
  'special offer', 'promo', 'deal', 'flash', 'this week only', 'while supplies last',
];

/**
 * Light structural signal that a message reads like marketing. Not authoritative on its
 * own — it biases the classifier and catches ESPs that strip transport headers.
 */
export function looksPromotional(subject: string | null | undefined, body: string | null | undefined): boolean {
  const text = `${subject ?? ''}\n${body ?? ''}`.toLowerCase();
  if (!text.trim()) return false;
  let hits = 0;
  for (const kw of PROMO_KEYWORDS) if (text.includes(kw)) hits += 1;
  return hits >= 2;
}

/**
 * True when transport signals alone strongly imply we must NOT reply (bulk/automated/
 * no-reply). The full reply gate additionally requires sender verification and the LLM
 * class — this is only the cheap, deterministic half.
 */
export function transportImpliesNoReply(signals: TransportSignals): boolean {
  return signals.bulk || signals.listMail || signals.autoSubmitted || signals.noReplyFrom;
}

/**
 * The reply gate. Returns a human reason to SKIP drafting an outbound reply, or `null` when
 * a reply is appropriate. Deliberately high-precision: it only suppresses cases where replying
 * is clearly wrong (injection, bulk/automated transport, or a class that never warrants a
 * reply). `negotiation_reply` and the ambiguous `other` still draft — so a mis-classification
 * degrades to "manager approves an extra draft", never to "we silently drop a real reply".
 */
export function replySkipReason(input: {
  emailClass: EmailClass;
  injectionSuspected: boolean;
  transport?: TransportSignals | null;
}): string | null {
  if (input.injectionSuspected) return 'possible prompt injection — quarantined for manager review';
  if (input.transport && transportImpliesNoReply(input.transport)) {
    return 'transport signals mark this as bulk / automated / no-reply';
  }
  const noReplyClasses: EmailClass[] = [
    'order_confirmation', 'promotion', 'catalogue_offer', 'automated_transactional', 'bounce_autoreply',
  ];
  if (noReplyClasses.includes(input.emailClass)) return `classified as ${input.emailClass} — no reply needed`;
  return null; // negotiation_reply or other → draft as before
}
