/**
 * Turning a scraped vendor page into price observations.
 *
 * This module is the pure half: HTML in, candidate observations out, with no
 * network and no LLM. The service alongside it does the fetching and the model
 * call; everything that decides whether a number is believable lives here so it
 * can be tested against the failures that actually occur.
 *
 * The generic extractor is deliberately the first strategy. Twenty per-vendor
 * parsers give better precision and are the right end state for the vendors
 * that matter, but they cover nothing on day one and every one of them breaks
 * silently when a vendor redesigns. A generic pass covers the whole
 * vendor_catalogue immediately at lower confidence — and because the consensus
 * engine already weights by parse_confidence, low-confidence coverage degrades
 * gracefully instead of poisoning the comparison. Harden the vendors that earn
 * it; let the long tail stay generic.
 *
 * What the LLM is and is not asked to do
 * --------------------------------------
 * It is asked to read a page and report what it sees. It is NOT asked to
 * normalise, convert currency, infer a vintage it cannot see, or decide
 * whether a price is plausible. Every one of those is done here, in code that
 * can be unit-tested, because a model that silently invents a missing vintage
 * produces a confident wrong match against the master library and there is no
 * way to tell afterwards which fields were read and which were guessed.
 */

/** One row as the model reports it, before any of our validation. */
export interface RawExtractedItem {
  name?: unknown;
  producer?: unknown;
  vintage?: unknown;
  price?: unknown;
  currency?: unknown;
  packSize?: unknown;
  volumeMl?: unknown;
  inStock?: unknown;
  /** The model's own 0–1 read on whether it parsed this row correctly. */
  confidence?: unknown;
}

export interface ExtractedItem {
  name: string;
  producer: string | null;
  vintage: number | null;
  price: number;
  currency: string;
  packSize: number;
  volumeMl: number | null;
  inStock: boolean | null;
  /** Combined model confidence and our own structural checks. */
  parseConfidence: number;
  warnings: string[];
}

export interface ExtractionResult {
  items: ExtractedItem[];
  rejected: Array<{ raw: RawExtractedItem; reason: string }>;
  warnings: string[];
}

/** Bottle formats we recognise, in ml. */
const KNOWN_FORMATS = [
  187, 200, 250, 330, 375, 500, 620, 700, 720, 750, 1000, 1500, 3000, 6000,
];

/**
 * Prices outside this band on a wine list are almost always a parse failure
 * rather than a real listing. The bounds are deliberately wide — real bottles
 * do sell at both ends — so this catches decimal slips, not unusual wines.
 */
const MIN_PLAUSIBLE_UNIT_PRICE = 1;
const MAX_PLAUSIBLE_UNIT_PRICE = 100_000;

/** The earliest vintage worth believing off a scraped page. */
const MIN_VINTAGE = 1800;

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // Strip currency symbols, thousands separators and whitespace, but do NOT
    // strip the decimal point — that is exactly the character whose loss
    // produces the $1,200-that-is-really-$12.00 failure.
    const cleaned = v.replace(/[^0-9.-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === ".") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/**
 * Vintage validation.
 *
 * Rejects anything that is not a plausible year. The specific trap is a model
 * reporting the pack size, the volume, or a price as a vintage — 750 and 2000
 * are both numbers that appear all over a wine page.
 */
export function parseVintage(
  v: unknown,
  now = new Date(),
): { vintage: number | null; warning: string | null } {
  const n = asFiniteNumber(v);
  if (n === null) return { vintage: null, warning: null };
  if (!Number.isInteger(n)) {
    return {
      vintage: null,
      warning: `Vintage ${n} is not a whole year; dropped.`,
    };
  }
  const maxVintage = now.getUTCFullYear() + 1;
  if (n < MIN_VINTAGE || n > maxVintage) {
    return {
      vintage: null,
      warning: `Vintage ${n} is outside ${MIN_VINTAGE}–${maxVintage}; dropped rather than guessed.`,
    };
  }
  return { vintage: n, warning: null };
}

/**
 * Bottle format. An unrecognised volume is kept but flagged — plenty of real
 * formats exist outside the common list, and dropping the volume silently
 * would make a 1.5L rank as if it were a 750ml.
 */
export function parseVolumeMl(v: unknown): {
  volumeMl: number | null;
  warning: string | null;
} {
  const n = asFiniteNumber(v);
  if (n === null) return { volumeMl: null, warning: null };
  if (n <= 0 || n > 30_000) {
    return {
      volumeMl: null,
      warning: `Volume ${n}ml is implausible; dropped.`,
    };
  }
  if (!KNOWN_FORMATS.includes(n)) {
    return {
      volumeMl: n,
      warning: `Volume ${n}ml is not a standard format — kept, but verify before trusting the per-unit comparison.`,
    };
  }
  return { volumeMl: n, warning: null };
}

/**
 * Validate one model-reported row.
 *
 * Returns null when the row cannot be trusted at all. A rejected row is
 * reported with a reason rather than dropped silently, because a page that
 * yields ten rejections is a broken parser and somebody needs to see that.
 */
export function validateItem(
  raw: RawExtractedItem,
  now = new Date(),
): { item: ExtractedItem | null; reason: string | null } {
  const warnings: string[] = [];

  const name = asNonEmptyString(raw.name);
  if (!name) return { item: null, reason: "No product name." };

  const price = asFiniteNumber(raw.price);
  if (price === null)
    return { item: null, reason: `No usable price for "${name}".` };
  if (price <= 0)
    return { item: null, reason: `Non-positive price for "${name}".` };

  const packSizeRaw = asFiniteNumber(raw.packSize);
  const packSize =
    packSizeRaw !== null && Number.isInteger(packSizeRaw) && packSizeRaw > 0
      ? packSizeRaw
      : 1;
  if (packSizeRaw !== null && packSize !== packSizeRaw) {
    warnings.push(
      `Pack size ${packSizeRaw} is not a positive integer; assumed single unit.`,
    );
  }

  // Plausibility is checked on the PER-UNIT price, not the listed price: a
  // $2,400 case of twelve is ordinary, a $2,400 bottle is worth flagging.
  const perUnit = price / packSize;
  if (
    perUnit < MIN_PLAUSIBLE_UNIT_PRICE ||
    perUnit > MAX_PLAUSIBLE_UNIT_PRICE
  ) {
    return {
      item: null,
      reason: `Per-unit price ${perUnit.toFixed(2)} for "${name}" is outside the plausible band; almost certainly a parse error.`,
    };
  }

  const { vintage, warning: vintageWarning } = parseVintage(raw.vintage, now);
  if (vintageWarning) warnings.push(vintageWarning);

  const { volumeMl, warning: volumeWarning } = parseVolumeMl(raw.volumeMl);
  if (volumeWarning) warnings.push(volumeWarning);

  const currency = (asNonEmptyString(raw.currency) ?? "USD")
    .toUpperCase()
    .slice(0, 3);

  const modelConfidence = asFiniteNumber(raw.confidence);
  const baseConfidence =
    modelConfidence !== null && modelConfidence >= 0 && modelConfidence <= 1
      ? modelConfidence
      : 0.5;

  // Structural penalties. The model's self-reported confidence is about
  // whether it read the page correctly; these are about how much of the row we
  // actually got. A price with no producer and no vintage may be right, but it
  // will be hard to match to the library, so it should not carry full weight.
  let parseConfidence = baseConfidence;
  if (!asNonEmptyString(raw.producer)) parseConfidence *= 0.85;
  if (vintage === null) parseConfidence *= 0.9;
  if (volumeMl === null) parseConfidence *= 0.95;
  if (warnings.length) parseConfidence *= 0.9;

  return {
    item: {
      name,
      producer: asNonEmptyString(raw.producer),
      vintage,
      price,
      currency,
      packSize,
      volumeMl,
      inStock: typeof raw.inStock === "boolean" ? raw.inStock : null,
      parseConfidence: Math.max(0.05, Math.min(1, parseConfidence)),
      warnings,
    },
    reason: null,
  };
}

/**
 * Parse the model's JSON response into validated items.
 *
 * Forgiving about envelope shape (models wrap arrays in different keys, and
 * sometimes fence them in markdown), strict about the contents of each row.
 */
export function normalizeExtraction(
  rawText: string,
  now = new Date(),
): ExtractionResult {
  const warnings: string[] = [];
  let parsed: unknown;

  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    parsed = JSON.parse(stripped);
  } catch {
    return {
      items: [],
      rejected: [],
      warnings: [
        "Model response was not valid JSON; no observations recorded.",
      ],
    };
  }

  let rows: unknown[] = [];
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const arrayKey = ["items", "wines", "products", "results"].find((k) =>
      Array.isArray(obj[k]),
    );
    if (arrayKey) rows = obj[arrayKey] as unknown[];
    else {
      return {
        items: [],
        rejected: [],
        warnings: ["Model response contained no recognisable item array."],
      };
    }
  }

  const items: ExtractedItem[] = [];
  const rejected: Array<{ raw: RawExtractedItem; reason: string }> = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      rejected.push({
        raw: {} as RawExtractedItem,
        reason: "Row was not an object.",
      });
      continue;
    }
    const { item, reason } = validateItem(row as RawExtractedItem, now);
    if (item) items.push(item);
    else
      rejected.push({
        raw: row as RawExtractedItem,
        reason: reason ?? "Rejected.",
      });
  }

  // A page where most rows fail is a broken parse, not a sparse catalogue. Say
  // so loudly — the alternative is a vendor silently contributing three prices
  // from a hundred-wine list and nobody noticing the parser regressed.
  if (rows.length > 0 && rejected.length > rows.length / 2) {
    warnings.push(
      `${rejected.length} of ${rows.length} rows were rejected — treat this page's parser as broken rather than the catalogue as small.`,
    );
  }

  return { items, rejected, warnings };
}

/**
 * Reduce an HTML document to text the model can read cheaply.
 *
 * Scripts and styles are removed rather than merely ignored: a page's inline
 * JSON-LD and analytics payloads routinely contain numbers that look like
 * prices, and feeding them to the model invites confident extraction of a
 * tracking value.
 */
export function htmlToText(html: string, maxChars = 60_000): string {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Minimal robots.txt check for a single path.
 *
 * Not a full RFC implementation — it handles the directives that actually
 * appear, and fails CLOSED on a malformed file. Politeness here is not
 * decoration: a vendor whose site we hammer is a vendor who blocks us, and
 * losing a price source to impatience is a worse outcome than a slower crawl.
 */
export function isPathAllowed(
  robotsTxt: string,
  path: string,
  userAgent = "*",
): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.replace(/#.*$/, "").trim());
  let applies = false;
  let sawAnyGroup = false;
  const disallows: string[] = [];
  const allows: string[] = [];

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || !rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      sawAnyGroup = true;
      applies =
        value === "*" || value.toLowerCase() === userAgent.toLowerCase();
    } else if (applies && key === "disallow") {
      if (value) disallows.push(value);
      // An empty Disallow means "allow everything" for this group.
    } else if (applies && key === "allow") {
      if (value) allows.push(value);
    }
  }

  if (!sawAnyGroup) return true;

  const longestMatch = (patterns: string[]) =>
    patterns
      .filter((p) => path.startsWith(p))
      .reduce((best, p) => (p.length > best.length ? p : best), "");

  const allowMatch = longestMatch(allows);
  const disallowMatch = longestMatch(disallows);

  if (!disallowMatch) return true;
  // Longest match wins; Allow breaks a tie, per the de-facto standard.
  return allowMatch.length >= disallowMatch.length;
}
