/**
 * A detected title, turned into a question the panel can ask.
 *
 * Deliberately its own file and deliberately PURE. The scanner's output shape
 * (`services/wineDetection.ts::DetectedWine`) is a four-layer record with two
 * deprecated aliases in it — `type` for `wineType`, `grape` for
 * `grapeVariety` — and the panel must not know any of that. Keeping the
 * translation here means:
 *
 *   - the panel takes a `BottleReading` and nothing else, so packet 1 can
 *     re-point it at the carry sheet's detection output without touching it;
 *   - the alias handling has a test of its own, which matters because the
 *     deprecated key is the one older pipeline layers still fill;
 *   - a title with no name or no producer is DROPPED HERE, before the person
 *     is asked about it. The library refuses both (`readingRefusals`), and
 *     asking a person to confirm a bottle nobody can save wastes the only
 *     scarce thing on a floor.
 *
 * WHAT IS NOT INVENTED. A missing confidence is left MISSING, never zeroed: the
 * panel prints "not scored", which is true, where a 0 would print "unsure · 0%"
 * about a field nobody scored. That substitution is the whole reason this file
 * builds the `confidence` object key by key instead of spreading.
 */

import type { BottleReading, ReadingSource } from './IsThisTheBottlePanel';

const KNOWN_TYPES = new Set(['red', 'white', 'sparkling', 'rose', 'dessert']);

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function score(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

/**
 * The reader's per-field scores, built key by key.
 *
 * `field_confidences` (mapped to `fieldConfidences` at
 * `services/wineDetection.ts:182`) is the per-field map; the row's own
 * `confidence` is the WHOLE reading's score and is used only for `name`, which
 * is the field the detector is actually scoring when it says it found a wine.
 */
function confidenceOf(row: Record<string, unknown>): BottleReading['confidence'] {
  const per = (row.fieldConfidences ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  const whole = score(row.confidence);

  const pairs: [string, unknown][] = [
    ['name', per.name ?? whole],
    ['producer', per.producer],
    ['vintage', per.vintage],
    ['type', per.wineType ?? per.type],
    ['region', per.region],
    ['country', per.country],
    ['grape', per.grapeVariety ?? per.grape],
  ];
  for (const [key, value] of pairs) {
    const s = score(value);
    // Absent stays absent. A zero here would be a claim the reader never made.
    if (s !== undefined) out[key] = s;
  }
  return out as BottleReading['confidence'];
}

/**
 * Every detected title the house can honestly ask about, in the order they were
 * read. A row with no name or no producer is dropped — see the header.
 */
export function readingsFrom(
  detected: unknown[],
  source: ReadingSource = 'menu_scan',
): BottleReading[] {
  if (!Array.isArray(detected)) return [];
  const out: BottleReading[] = [];
  for (const raw of detected) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const name = str(row.name);
    const producer = str(row.producer);
    if (name.length < 3 || producer === '') continue;

    const rawType = str(row.wineType) || str(row.type);
    const vintage =
      typeof row.vintage === 'number' && Number.isFinite(row.vintage) ? row.vintage : null;

    out.push({
      name,
      producer,
      vintage,
      // An unrecognised style is EMPTY, not guessed. `fortified` and `orange`
      // exist in the detector's vocabulary and not in the library's, and
      // filing one as `red` would be a fact nobody read off the menu.
      type: KNOWN_TYPES.has(rawType) ? (rawType as BottleReading['type']) : '',
      region: str(row.region),
      country: str(row.country),
      grape: str(row.grapeVariety) || str(row.grape) || undefined,
      confidence: confidenceOf(row),
      source,
    });
  }
  return out;
}
