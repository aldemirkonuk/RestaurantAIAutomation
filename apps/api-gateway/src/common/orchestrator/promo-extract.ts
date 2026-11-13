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
  | "volume_discount"
  | "seasonal"
  | "bundle"
  | "loyalty"
  | "closeout"
  | "new_vintage"
  | "free_shipping"
  | "sample"
  | "early_payment"
  | "referral";

export const PROMO_TYPES: readonly PromoType[] = [
  "volume_discount",
  "seasonal",
  "bundle",
  "loyalty",
  "closeout",
  "new_vintage",
  "free_shipping",
  "sample",
  "early_payment",
  "referral",
] as const;

export interface ExtractedPromo {
  promo_type: PromoType;
  discount_pct: number | null;
  discount_amount: number | null;
  /**
   * What the amount off is taken from, when the mail says: "case" for "$15 off
   * per case", "bottle" for "$2 off a bottle". Null when the mail does not say.
   * A per-case amount is never taken from a bottle price (offer-grade.ts).
   */
  amount_unit: "case" | "bottle" | null;
  /** Bottles in the vendor's case, when the mail states it ("12 x 750ml", "6-bottle case"). */
  pack_size: number | null;
  currency: string | null;
  threshold_qty: number | null;
  threshold_amount: number | null;
  valid_until: string | null; // ISO date (YYYY-MM-DD) or null
  valid_text: string | null; // the raw validity phrase, for the description
  /** The validity date was already behind `now` when the mail was read: the offer had ended. */
  ended: boolean;
  promo_code: string | null;
  free_shipping: boolean;
  confidence: number; // 0..1
  signature: string; // stable dedup key
  summary: string; // short human line
}

// Keyword → promo_type, most specific first (first hit wins).
const TYPE_RULES: Array<{ type: PromoType; re: RegExp }> = [
  {
    type: "free_shipping",
    re: /\bfree\s+(?:shipping|delivery|freight)\b|\bcomplimentary\s+shipping\b/i,
  },
  {
    type: "closeout",
    re: /\b(?:close-?out|clearance|liquidation|final\s+sale|last\s+(?:cases?|bottles?|chance)|while\s+(?:supplies|stocks)\s+last|discontinu)/i,
  },
  {
    type: "new_vintage",
    re: /\bnew\s+(?:vintage|release|arrivals?)\b|\bjust\s+arrived\b|\blatest\s+vintage\b|\ben\s+primeur\b|\bpre-?arrival\b/i,
  },
  {
    type: "early_payment",
    re: /\bearly\s+payment\b|\bprepay(?:ment)?\b|\b2\/10\s*net\b|\bnet\s*10\b|\bpay\s+early\b/i,
  },
  {
    type: "referral",
    re: /\brefer(?:ral|\s+a\s+(?:friend|colleague))\b|\brefer-a-/i,
  },
  {
    type: "loyalty",
    re: /\bloyalty\b|\bvip\b|\bmembers?\s+(?:only|price|discount)\b|\brewards?\s+(?:program|points)\b/i,
  },
  {
    type: "sample",
    re: /\bfree\s+samples?\b|\bcomplimentary\s+(?:taste|sample)\b|\btry\s+before\b/i,
  },
  {
    type: "bundle",
    re: /\bbundle\b|\bmixed\s+(?:case|pack|dozen)\b|\b(?:gift|tasting)\s+(?:set|pack)\b/i,
  },
  {
    type: "volume_discount",
    re: /\bvolume\b|\bby\s+the\s+case\b|\bcases?\s+of\b|\bbulk\b|\bbuy\s+more\b|\b\d+\s*\+\s*(?:bottles?|cases?)\b|\bper\s+case\b/i,
  },
  {
    type: "seasonal",
    re: /\b(?:spring|summer|autumn|fall|winter|holiday|christmas|thanksgiving|new\s+year|easter|seasonal|black\s+friday|cyber\s+monday|end[-\s]of[-\s]year)\b/i,
  },
];

function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "jul", "july", "sept", "sep" → 6, 8, 8; anything else ("market", "margin") → -1. */
function monthIndex(word: string): number {
  const w = word.toLowerCase();
  if (w === "sept") return 8;
  return MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)));
}

/**
 * The year a year-less "Month DD" means: the one that puts it NEAREST to the
 * day the mail is read. "Nov 6" read on 2026-11-07 is yesterday (2026), not
 * 2027 — an offer that has ended has ended, and is never pushed a year ahead
 * to look live. "Jan 15" read on 2026-12-20 is next month (2027), and
 * "Dec 31" read on 2027-01-02 is two days ago (2026). A date more than half a
 * year behind is read forward, because a vendor naming a day eight months gone
 * is less likely than one naming next spring.
 */
function nearestYear(month: number, day: number, now: Date): number {
  const y = now.getFullYear();
  const today = Date.UTC(y, now.getMonth(), now.getDate());
  let best = y;
  let bestGap = Infinity;
  for (const c of [y - 1, y, y + 1]) {
    const gap = Math.abs(Date.UTC(c, month, day) - today);
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/** `now` as YYYY-MM-DD in the same calendar the dates above are read in. */
function isoDay(now: Date): string {
  return `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
}

/** Best-effort validity date → ISO (YYYY-MM-DD). Handles "Month DD", "M/D[/YY]", weekday, this week(end). */
function parseValidUntil(
  text: string,
  now: Date = new Date(),
): { iso: string | null; raw: string | null } {
  const t = text.toLowerCase();
  const cue =
    /(?:valid\s+(?:through|until|thru|til)|through|thru|until|til|ends?|expires?(?:\s+on)?|offer\s+ends?|by)\s+([a-z0-9,/\s]{3,22}?)(?:[.!;)]|,(?!\s*\d{4}\b)|\s+(?:only|est|pst|edt|at)\b|$)/i.exec(
      text,
    );
  const raw = cue ? cue[1].trim() : null;

  const iso = (y: number, m: number, d: number) =>
    `${y.toString().padStart(4, "0")}-${(m + 1).toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;

  // Cue-less, a passed date ("Harvest finished Sept 3") is not the offer's
  // end and is skipped: only a cued date can end an offer.
  const today = isoDay(now);
  const usable = (date: string) => raw != null || date >= today;

  // Month DD[, YYYY] ("Jul 31st", "Sept. 3", "June 30, 2027"); a stated year
  // is kept. A month name only: "Market 12 cases" is not March 12.
  const md = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  const src = raw ?? t;
  for (let m = md.exec(src); m; m = md.exec(src)) {
    const mi = monthIndex(m[1]);
    const d = parseInt(m[2], 10);
    if (mi >= 0 && d >= 1 && d <= 31) {
      const y = m[3] ? parseInt(m[3], 10) : nearestYear(mi, d, now);
      const date = iso(y, mi, d);
      if (usable(date)) return { iso: date, raw };
    }
  }
  // M/D or M/D/YY(YY)
  const sl = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  for (let slash = sl.exec(src); slash; slash = sl.exec(src)) {
    const m = parseInt(slash[1], 10) - 1;
    const d = parseInt(slash[2], 10);
    if (m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      let y = slash[3] ? parseInt(slash[3], 10) : nearestYear(m, d, now);
      if (y < 100) y += 2000;
      const date = iso(y, m, d);
      if (usable(date)) return { iso: date, raw };
    }
  }
  // "this weekend" / "this week" → upcoming Sunday
  if (/\bthis\s+week(?:end)?\b|\bweekend\b/i.test(t)) {
    const d = new Date(now);
    d.setDate(now.getDate() + ((7 - now.getDay()) % 7));
    return {
      iso: iso(d.getFullYear(), d.getMonth(), d.getDate()),
      raw: raw ?? "this week",
    };
  }
  // Weekday name → next occurrence
  const wdNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const wd = wdNames.findIndex((w) =>
    new RegExp(`\\b${w}\\b`, "i").test(raw ?? t),
  );
  if (wd >= 0) {
    const d = new Date(now);
    const delta = (wd - now.getDay() + 7) % 7 || 7;
    d.setDate(now.getDate() + delta);
    return {
      iso: iso(d.getFullYear(), d.getMonth(), d.getDate()),
      raw: raw ?? wdNames[wd],
    };
  }
  if (/\btoday\s+only\b|\bends?\s+today\b/i.test(t)) {
    return {
      iso: iso(now.getFullYear(), now.getMonth(), now.getDate()),
      raw: raw ?? "today",
    };
  }
  return { iso: null, raw };
}

/* ── percentages that are not discounts ───────────────────────────────────── */

/**
 * A wine's spec sheet is full of percentages: "14.5% ABV", "Alc. 13.5% vol",
 * "85% Sangiovese, 15% Merlot", "40% new oak". None of them is money off, and
 * a vendor's new-arrivals mail carries them far more often than a sale does.
 */
const SPEC_BEFORE =
  /(?:\ba\.?b\.?v\.?|\balc(?:ohol)?\.?(?:\s*(?:content|level|by\s+vol(?:ume)?|\/\s*vol\.?))?|\bvol\b\.?|\bproof\b)\s*[:=\-–]?\s*$/i;
const SPEC_AFTER =
  /^\s*(?:a\.?b\.?v\b|alc\b|alc\.|alcohol\b|vol\b|vol\.|by\s+vol|proof\b|(?:new\s+|french\s+|american\s+|hungarian\s+)*oak\b|whole[-\s]cluster|residual\s+sugar)/i;
const GRAPES =
  "cabernet|merlot|sangiovese|nebbiolo|syrah|shiraz|grenache|garnacha|tempranillo|pinot|chardonnay|sauvignon|riesling|malbec|zinfandel|primitivo|mourv[eè]dre|monastrell|carignan|cari[ñn]ena|cinsault|viognier|s[eé]millon|chenin|gamay|barbera|dolcetto|petit\\s+verdot|touriga|montepulciano|corvina|rondinella|molinara|trebbiano|vermentino|albari[ñn]o|gr[uü]ner|torront[eé]s|carmen[eè]re|tannat|aglianico|nero\\s+d'avola|marsanne|roussanne|muscat|moscato|gew[uü]rztraminer|[oö]k[uü]zg[oö]z[uü]|bo[gğ]azkere|kalecik|narince|emir|[cç]alkarası|blend";
const GRAPE_AFTER = new RegExp(`^\\s*(?:of\\s+)?(?:${GRAPES})(?![a-z])`, "i");

function isWineSpec(before: string, after: string): boolean {
  return SPEC_BEFORE.test(before) || SPEC_AFTER.test(after) || GRAPE_AFTER.test(after);
}

/** The first percentage in the mail that is not part of a wine's spec, or null. */
function discountPercent(rawText: string): number | null {
  const re = /(?<![\d.,])(\d{1,2}(?:\.\d{1,2})?)\s*%/g;
  for (let m = re.exec(rawText); m; m = re.exec(rawText)) {
    const before = rawText.slice(Math.max(0, m.index - 32), m.index);
    const after = rawText.slice(m.index + m[0].length, m.index + m[0].length + 32);
    if (isWineSpec(before, after)) continue;
    return num(m[1]);
  }
  return null;
}

/* ── what an amount off is taken from ──────────────────────────────────────── */

/** "per case", "/cs", "on each bottle", "any case", "per mixed case", "each 12-bottle case", "off case orders" → unit. */
function amountUnitAfter(after: string): "case" | "bottle" | null {
  const m =
    /^\s*(?:off|discount)?\s*(?:\/\s*|(?:on\s+)?(?:per|a|an|each|every|any|your|the|all)\s+|on\s+)?(?:(?:mixed|full|straight|whole|\d{1,2}[-\s]?(?:bottles?|btls?|bt|pack|pk))\s+)?(cases?|cs|bottles?|btls?|bt)\b/i.exec(
      after,
    );
  if (!m) return null;
  return /^c/i.test(m[1]) ? "case" : "bottle";
}

/**
 * No unit after the amount, but its sentence names a case → per case. The
 * grader then divides or refuses, which can only make the offer look smaller.
 */
function sentenceNamesCase(rawText: string, start: number, end: number): boolean {
  const from = Math.max(
    rawText.lastIndexOf(".", start - 1),
    rawText.lastIndexOf("!", start - 1),
    rawText.lastIndexOf("?", start - 1),
    rawText.lastIndexOf("\n", start - 1),
  );
  const rest = rawText.slice(end);
  const stop = rest.search(/[.!?\n]/);
  const sentence =
    rawText.slice(from + 1, start) + " " + (stop < 0 ? rest : rest.slice(0, stop));
  return /\b(?:cases?|cs)\b/i.test(sentence);
}

/** Bottles to the vendor's case, when the mail states it; 2..48 only. */
function packSizeOf(rawText: string): number | null {
  const res = [
    /\b(\d{1,2})\s*[x×]\s*\d{2,4}\s*(?:ml|cl)\b/i, // 12 x 750ml, 6x75cl
    /\b(\d{1,2})[-\s]?(?:bottles?|btls?)\s+(?:case|carton|box)\b/i, // 12-bottle case
    /\b(\d{1,2})\s*(?:bottles?|btls?)\s*(?:per|\/|a|to\s+the|in\s+(?:a|each|the))\s*(?:case|cs|carton)\b/i, // 12 bottles per case, 12 btl/cs
    /\b(?:case|carton)s?\s+of\s+(\d{1,2})\s*(?:bottles?|btls?)\b/i, // case of 6 bottles
  ];
  for (const re of res) {
    const m = re.exec(rawText);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n >= 2 && n <= 48) return n;
  }
  return null;
}

function classifyPromoType(text: string): PromoType {
  for (const rule of TYPE_RULES) if (rule.re.test(text)) return rule.type;
  return "seasonal"; // generic catch-all when a discount exists but no specific type keyword
}

/**
 * Extract a structured promotion from a promotional email. Returns null when nothing
 * promotional is detectable (no discount, no free-shipping, no promo keywords).
 */

/**
 * An amount as the mail wrote it, with the sign of the money the mail named.
 * The fallback for anything not EUR or GBP used to be `$`, so a mail that
 * named no currency was summarised in dollars on the house's promo list and
 * digest (r9 left list, 2026-11-12). Now: € £ $ only when the mail named
 * EUR, GBP or USD; another stated code follows the figure; no currency named
 * prints the figure bare. The figure keeps the mail's own digits (no
 * rounding, no added decimals), which is why this is not `moneyIn`.
 */
export function amountIn(
  amount: number | string,
  currency: string | null | undefined,
): string {
  const c = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (c === "EUR") return `€${amount}`;
  if (c === "GBP") return `£${amount}`;
  if (c === "USD") return `$${amount}`;
  return /^[A-Z]{3}$/.test(c) ? `${amount} ${c}` : `${amount}`;
}

export function extractPromotion(
  subject: string | null | undefined,
  body: string | null | undefined,
  now: Date = new Date(),
): ExtractedPromo | null {
  const rawText = `${subject ?? ""}\n${body ?? ""}`;
  if (!rawText.trim()) return null;
  const text = rawText.toLowerCase();

  const discount_pct = discountPercent(rawText);

  const amtRe =
    /(?:save|discount(?: of)?)\s*[£$€]\s?(\d+(?:\.\d+)?)|[£$€]\s?(\d+(?:\.\d+)?)\s*(?:off|discount)/i;
  const amtM = amtRe.exec(rawText);
  const discount_amount = amtM ? num(amtM[1] ?? amtM[2]) : null;
  const amtEnd = amtM ? amtM.index + amtM[0].length : 0;
  const amount_unit = amtM
    ? (amountUnitAfter(rawText.slice(amtEnd)) ??
      (sentenceNamesCase(rawText, amtM.index, amtEnd) ? "case" : null))
    : null;
  const pack_size = packSizeOf(rawText);

  const currency = /[€]|eur\b/i.test(rawText)
    ? "EUR"
    : /[£]|gbp\b/i.test(rawText)
      ? "GBP"
      : /[$]|usd\b/i.test(rawText)
        ? "USD"
        : null;

  const thQtyM =
    /(?:cases?\s+of|orders?\s+of|buy|purchase|minimum(?:\s+of)?)\s+(\d{1,3})\b|\b(\d{1,3})\s*\+\s*(?:bottles?|cases?|units?)\b|\b(\d{1,3})\s+(?:or\s+more|\+)\s*(?:bottles?|cases?)\b/i.exec(
      rawText,
    );
  const threshold_qty = thQtyM
    ? num(thQtyM[1] ?? thQtyM[2] ?? thQtyM[3])
    : null;

  const thAmtM =
    /(?:orders?\s+(?:over|above)|spend|over)\s*[£$€]\s?(\d[\d,]*)/i.exec(
      rawText,
    );
  const threshold_amount = thAmtM ? num(thAmtM[1]) : null;

  const free_shipping =
    /\bfree\s+(?:shipping|delivery|freight)\b|\bcomplimentary\s+shipping\b/i.test(
      rawText,
    );

  const codeM =
    /(?:promo\s*code|use\s+code|code)[:\s]+([A-Z0-9][A-Z0-9-]{2,19})/.exec(
      rawText,
    );
  const promo_code = codeM ? codeM[1] : null;

  const { iso: valid_until, raw: valid_text } = parseValidUntil(rawText, now);
  // Only a date the mail named as the offer's end can end it.
  const ended =
    valid_until != null && valid_text != null && valid_until < isoDay(now);

  // Nothing promotional at all → not a promo.
  const anySignal =
    discount_pct != null ||
    discount_amount != null ||
    free_shipping ||
    promo_code != null ||
    threshold_qty != null ||
    threshold_amount != null;
  const hasKeyword = TYPE_RULES.some((r) => r.re.test(text));
  if (!anySignal && !hasKeyword) return null;

  const promo_type: PromoType =
    free_shipping && discount_pct == null && discount_amount == null
      ? "free_shipping"
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
    discount_pct ?? "",
    discount_amount ?? "",
    threshold_qty ?? "",
    threshold_amount ?? "",
    valid_until ?? "",
    free_shipping ? "fs" : "",
  ];
  // Appended only when stated, so a unit-less offer keeps the signature it
  // was stored under before the unit was read (dedup keeps holding).
  if (amount_unit) sig.push(`per:${amount_unit}`);

  const parts: string[] = [];
  if (discount_pct != null) parts.push(`${discount_pct}% off`);
  if (discount_amount != null)
    parts.push(
      `${amountIn(discount_amount, currency)} off${amount_unit ? ` per ${amount_unit}` : ""}`,
    );
  if (free_shipping) parts.push("free shipping");
  if (threshold_qty != null) parts.push(`on ${threshold_qty}+`);
  if (threshold_amount != null)
    parts.push(
      `over ${amountIn(threshold_amount, currency)}`,
    );
  if (valid_until) parts.push(ended ? `ended ${valid_until}` : `until ${valid_until}`);
  const summary = parts.length
    ? `${promo_type.replace(/_/g, " ")}: ${parts.join(", ")}`
    : `${promo_type.replace(/_/g, " ")} offer`;

  return {
    promo_type,
    discount_pct,
    discount_amount,
    amount_unit,
    pack_size,
    currency,
    threshold_qty,
    threshold_amount,
    valid_until,
    valid_text,
    ended,
    promo_code,
    free_shipping,
    confidence,
    signature: sig.join("|"),
    summary,
  };
}
