/**
 * Promo extraction — deterministic, dependency-free, ZERO-LLM extraction of the structured
 * bits of a vendor promotional email (D3). Promos are highly regular (discount %, $ off,
 * thresholds, validity, codes, free shipping), so regex + keyword + light date parsing pulls
 * the important parts at no cost, fully offline and private.
 *
 * Pure and side-effect-free. The `PromotionExtractorService` consumes this, maps `promo_type`
 * onto the `provider_promotions` CHECK enum, dedups on `signature`, and writes + notifies.
 */

/** Must stay EXACTLY in sync with the provider_promotions.promo_type CHECK constraint. */
export type PromoType =
  | 'volume_discount'
  | 'seasonal'
  | 'bundle'
  | 'loyalty'
  | 'closeout'
  | 'new_vintage'
  | 'free_shipping'
  | 'sample'
  | 'early_payment'
  | 'referral';

export const PROMO_TYPES: readonly PromoType[] = [
  'volume_discount', 'seasonal', 'bundle', 'loyalty', 'closeout',
  'new_vintage', 'free_shipping', 'sample', 'early_payment', 'referral',
] as const;

export interface ExtractedPromo {
  promo_type: PromoType;
  discount_pct: number | null;
  discount_amount: number | null;
  currency: string | null;
  threshold_qty: number | null;
  threshold_amount: number | null;
  valid_until: string | null; // ISO date (YYYY-MM-DD) or null
  valid_text: string | null; // the raw validity phrase, for the description
  promo_code: string | null;
  free_shipping: boolean;
  confidence: number; // 0..1
  signature: string; // stable dedup key
  summary: string; // short human line
}

// Keyword → promo_type, most specific first (first hit wins).
const TYPE_RULES: Array<{ type: PromoType; re: RegExp }> = [
  { type: 'free_shipping', re: /\bfree\s+(?:shipping|delivery|freight)\b|\bcomplimentary\s+shipping\b/i },
  { type: 'closeout', re: /\b(?:close-?out|clearance|liquidation|final\s+sale|last\s+(?:cases?|bottles?|chance)|while\s+(?:supplies|stocks)\s+last|discontinu)/i },
  { type: 'new_vintage', re: /\bnew\s+(?:vintage|release|arrivals?)\b|\bjust\s+arrived\b|\blatest\s+vintage\b|\ben\s+primeur\b|\bpre-?arrival\b/i },
  { type: 'early_payment', re: /\bearly\s+payment\b|\bprepay(?:ment)?\b|\b2\/10\s*net\b|\bnet\s*10\b|\bpay\s+early\b/i },
  { type: 'referral', re: /\brefer(?:ral|\s+a\s+(?:friend|colleague))\b|\brefer-a-/i },
  { type: 'loyalty', re: /\bloyalty\b|\bvip\b|\bmembers?\s+(?:only|price|discount)\b|\brewards?\s+(?:program|points)\b/i },
  { type: 'sample', re: /\bfree\s+samples?\b|\bcomplimentary\s+(?:taste|sample)\b|\btry\s+before\b/i },
  { type: 'bundle', re: /\bbundle\b|\bmixed\s+(?:case|pack|dozen)\b|\b(?:gift|tasting)\s+(?:set|pack)\b/i },
  { type: 'volume_discount', re: /\bvolume\b|\bby\s+the\s+case\b|\bcases?\s+of\b|\bbulk\b|\bbuy\s+more\b|\b\d+\s*\+\s*(?:bottles?|cases?)\b|\bper\s+case\b/i },
  { type: 'seasonal', re: /\b(?:spring|summer|autumn|fall|winter|holiday|christmas|thanksgiving|new\s+year|easter|seasonal|black\s+friday|cyber\s+monday|end[-\s]of[-\s]year)\b/i },
];

function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Best-effort validity date → ISO (YYYY-MM-DD). Handles "Month DD", "M/D[/YY]", weekday, this week(end). */
function parseValidUntil(text: string, now: Date = new Date()): { iso: string | null; raw: string | null } {
  const t = text.toLowerCase();
  const cue = /(?:valid\s+(?:through|until|thru|til)|through|thru|until|til|ends?|expires?(?:\s+on)?|offer\s+ends?|by)\s+([a-z0-9,\/\s]{3,22}?)(?:[.!,;)]|\s+(?:only|est|pst|edt|at)\b|$)/i.exec(text);
  const raw = cue ? cue[1].trim() : null;

  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const iso = (y: number, m: number, d: number) =>
    `${y.toString().padStart(4, '0')}-${(m + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

  // Month DD (e.g. "July 31", "Jul 31")
  const md = /\b([a-z]{3,9})\.?\s+(\d{1,2})\b/i.exec(raw ?? t);
  if (md) {
    const mi = months.findIndex((m) => m.startsWith(md[1].toLowerCase().slice(0, 3)));
    const d = parseInt(md[2], 10);
    if (mi >= 0 && d >= 1 && d <= 31) {
      let y = now.getFullYear();
      if (mi < now.getMonth() || (mi === now.getMonth() && d < now.getDate())) y += 1;
      return { iso: iso(y, mi, d), raw };
    }
  }
  // M/D or M/D/YY(YY)
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(raw ?? t);
  if (slash) {
    const m = parseInt(slash[1], 10) - 1;
    const d = parseInt(slash[2], 10);
    let y = slash[3] ? parseInt(slash[3], 10) : now.getFullYear();
    if (y < 100) y += 2000;
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      if (!slash[3] && (m < now.getMonth() || (m === now.getMonth() && d < now.getDate()))) y += 1;
      return { iso: iso(y, m, d), raw };
    }
  }
  // "this weekend" / "this week" → upcoming Sunday
  if (/\bthis\s+week(?:end)?\b|\bweekend\b/i.test(t)) {
    const d = new Date(now);
    d.setDate(now.getDate() + ((7 - now.getDay()) % 7));
    return { iso: iso(d.getFullYear(), d.getMonth(), d.getDate()), raw: raw ?? 'this week' };
  }
  // Weekday name → next occurrence
  const wdNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const wd = wdNames.findIndex((w) => new RegExp(`\\b${w}\\b`, 'i').test(raw ?? t));
  if (wd >= 0) {
    const d = new Date(now);
    const delta = ((wd - now.getDay() + 7) % 7) || 7;
    d.setDate(now.getDate() + delta);
    return { iso: iso(d.getFullYear(), d.getMonth(), d.getDate()), raw: raw ?? wdNames[wd] };
  }
  if (/\btoday\s+only\b|\bends?\s+today\b/i.test(t)) {
    return { iso: iso(now.getFullYear(), now.getMonth(), now.getDate()), raw: raw ?? 'today' };
  }
  return { iso: null, raw };
}

function classifyPromoType(text: string): PromoType {
  for (const rule of TYPE_RULES) if (rule.re.test(text)) return rule.type;
  return 'seasonal'; // generic catch-all when a discount exists but no specific type keyword
}

/**
 * Extract a structured promotion from a promotional email. Returns null when nothing
 * promotional is detectable (no discount, no free-shipping, no promo keywords).
 */
export function extractPromotion(
  subject: string | null | undefined,
  body: string | null | undefined,
  now: Date = new Date(),
): ExtractedPromo | null {
  const rawText = `${subject ?? ''}\n${body ?? ''}`;
  if (!rawText.trim()) return null;
  const text = rawText.toLowerCase();

  const pctM = /(\d{1,2}(?:\.\d)?)\s*%\s*(?:off|discount|savings?|reduction)?/i.exec(rawText)
    || /(?:save|discount of|up to)\s+(\d{1,2}(?:\.\d)?)\s*%/i.exec(rawText);
  const discount_pct = pctM ? num(pctM[1]) : null;

  const amtM = /(?:save|discount(?: of)?)\s*[£$€]\s?(\d+(?:\.\d+)?)|[£$€]\s?(\d+(?:\.\d+)?)\s*(?:off|discount)/i.exec(rawText);
  const discount_amount = amtM ? num(amtM[1] ?? amtM[2]) : null;

  const currency = /[€]|eur\b/i.test(rawText) ? 'EUR' : /[£]|gbp\b/i.test(rawText) ? 'GBP' : /[$]|usd\b/i.test(rawText) ? 'USD' : null;

  const thQtyM = /(?:cases?\s+of|orders?\s+of|buy|purchase|minimum(?:\s+of)?)\s+(\d{1,3})\b|\b(\d{1,3})\s*\+\s*(?:bottles?|cases?|units?)\b|\b(\d{1,3})\s+(?:or\s+more|\+)\s*(?:bottles?|cases?)\b/i.exec(rawText);
  const threshold_qty = thQtyM ? num(thQtyM[1] ?? thQtyM[2] ?? thQtyM[3]) : null;

  const thAmtM = /(?:orders?\s+(?:over|above)|spend|over)\s*[£$€]\s?(\d[\d,]*)/i.exec(rawText);
  const threshold_amount = thAmtM ? num(thAmtM[1]) : null;

  const free_shipping = /\bfree\s+(?:shipping|delivery|freight)\b|\bcomplimentary\s+shipping\b/i.test(rawText);

  const codeM = /(?:promo\s*code|use\s+code|code)[:\s]+([A-Z0-9][A-Z0-9-]{2,19})/.exec(rawText);
  const promo_code = codeM ? codeM[1] : null;

  const { iso: valid_until, raw: valid_text } = parseValidUntil(rawText, now);

  // Nothing promotional at all → not a promo.
  const anySignal =
    discount_pct != null || discount_amount != null || free_shipping || promo_code != null ||
    threshold_qty != null || threshold_amount != null;
  const hasKeyword = TYPE_RULES.some((r) => r.re.test(text));
  if (!anySignal && !hasKeyword) return null;

  const promo_type: PromoType = free_shipping && discount_pct == null && discount_amount == null
    ? 'free_shipping'
    : classifyPromoType(text);

  // Confidence: how much concrete structure we pulled.
  let score = 0;
  if (discount_pct != null || discount_amount != null) score += 0.4;
  if (threshold_qty != null || threshold_amount != null) score += 0.2;
  if (valid_until != null) score += 0.2;
  if (promo_code != null) score += 0.1;
  if (hasKeyword) score += 0.1;
  const confidence = Math.min(1, Math.round(score * 100) / 100);

  const sig = [
    promo_type,
    discount_pct ?? '',
    discount_amount ?? '',
    threshold_qty ?? '',
    threshold_amount ?? '',
    valid_until ?? '',
    free_shipping ? 'fs' : '',
  ].join('|');

  const parts: string[] = [];
  if (discount_pct != null) parts.push(`${discount_pct}% off`);
  if (discount_amount != null) parts.push(`${currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'}${discount_amount} off`);
  if (free_shipping) parts.push('free shipping');
  if (threshold_qty != null) parts.push(`on ${threshold_qty}+`);
  if (threshold_amount != null) parts.push(`over ${currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'}${threshold_amount}`);
  if (valid_until) parts.push(`until ${valid_until}`);
  const summary = parts.length ? `${promo_type.replace(/_/g, ' ')}: ${parts.join(', ')}` : `${promo_type.replace(/_/g, ' ')} offer`;

  return {
    promo_type,
    discount_pct,
    discount_amount,
    currency,
    threshold_qty,
    threshold_amount,
    valid_until,
    valid_text,
    promo_code,
    free_shipping,
    confidence,
    signature: sig,
    summary,
  };
}
