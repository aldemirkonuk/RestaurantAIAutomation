/**
 * A house's clock and its number formats, read from its own record — ADR 0207.
 *
 * The founder, 2026-09-21: the on-time deadline is the "House's local
 * midnight" (question 6), and the scorecard is "english +TR formats and other
 * languages possible" (question 7) — English words, the house's own number,
 * date and currency formats.
 *
 * WHAT THE RECORD HOLDS
 * ---------------------
 * `restaurants.timezone` — an IANA name, nullable since migration
 * 20260903170000 dropped its `'America/Los_Angeles'` default and cleared every
 * value equal to it (a value equal to a default is unattributable).
 * `restaurants.country` — free text: an ISO code (`TR`), Google's `longText`
 * (`Türkiye`), or a picker name. There is no locale column.
 *
 * THE ZONE: the house's own; else its country's ONLY zone; else none. `Intl`
 * already knows which zones a region keeps (`Intl.Locale#getTimeZones`), so
 * there is no zone table here: Türkiye has one zone and gets it, the United
 * States has twenty-nine and gets none. Never UTC by default — a caller holding
 * no zone must say so (`procurement/delivery-deadline.ts` then counts only the
 * verdicts that hold in every zone).
 *
 * THE LOCALE: the region's likely language (CLDR likely subtags, through
 * `Intl.Locale#maximize`) with that region — `TR` -> `tr-TR`, `JP` -> `ja-JP`,
 * `IT` -> `it-IT` — from the country, else from the region that owns the
 * house's zone, else none. Nothing here names a locale: no `tr-TR` is written
 * in this file. It sets FORMATS only; every word stays English.
 *
 * WHAT IT DOES NOT DO: it does not carry the web's alias table
 * (`apps/web/src/lib/countries.ts`, ADR 0117 Q33 "one country table"). A name
 * CLDR does not know (`Turkey` since CLDR 42, `USA`) is not resolved here; the
 * zone still gives the region when the house records one. The follow-up is in
 * ADR 0207.
 *
 * Pure: no database, no clock.
 */

import { resolveZone } from "../calendar/zoned-time";

export type ZoneSource = "house" | "country" | "none";
export type LocaleSource = "country" | "zone" | "none";

export interface HouseFrame {
  /** The IANA zone the house's deadlines are read in; null when none is known. */
  zone: string | null;
  zoneSource: ZoneSource;
  /** What `restaurants.timezone` holds when it is not a zone this server knows. */
  unreadZone: string | null;
  /** ISO 3166-1 alpha-2, upper case; null when neither country nor zone names one. */
  region: string | null;
  /** How many zones the recorded country keeps; null when no country is resolved. */
  countryZones: number | null;
  /** A BCP 47 tag for formats only (e.g. the region's language + region); null when unknown. */
  locale: string | null;
  localeSource: LocaleSource;
}

export interface HouseRecord {
  timezone?: string | null;
  country?: string | null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

let regionList: string[] | null = null;
/** Every two-letter region `Intl` can name — derived, never typed. */
function knownRegions(): string[] {
  if (regionList) return regionList;
  const names = new Intl.DisplayNames(["en"], {
    type: "region",
    fallback: "none",
  });
  const out: string[] = [];
  for (const a of LETTERS)
    for (const b of LETTERS) {
      const code = a + b;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code && !/^unknown/i.test(name)) out.push(code);
    }
  regionList = out;
  return out;
}

/** The region's likely language, or null (`und` is not a language). */
function languageOf(region: string): string | null {
  try {
    const lang = new Intl.Locale("und", { region }).maximize().language;
    return lang && lang !== "und" ? lang : null;
  } catch {
    return null;
  }
}

let nameIndex: Map<string, string> | null = null;
function byName(): Map<string, string> {
  if (nameIndex) return nameIndex;
  const m = new Map<string, string>();
  const long = new Intl.DisplayNames(["en"], {
    type: "region",
    fallback: "none",
  });
  const short = new Intl.DisplayNames(["en"], {
    type: "region",
    style: "short",
    fallback: "none",
  });
  for (const code of knownRegions()) {
    const names: (string | undefined)[] = [long.of(code), short.of(code)];
    const own = languageOf(code);
    if (own)
      try {
        names.push(
          new Intl.DisplayNames([own], {
            type: "region",
            fallback: "none",
          }).of(code),
        );
      } catch {
        /* a language ICU cannot name regions in adds no name */
      }
    for (const n of names) {
      if (!n) continue;
      const k = fold(n);
      if (k && !m.has(k)) m.set(k, code);
    }
  }
  nameIndex = m;
  return m;
}

/**
 * The ISO alpha-2 code for what `restaurants.country` holds — a code, an
 * English name, a short name (`UK`, `US`) or the country's own name
 * (`Türkiye`) — or null. Never guessed: a wrong country is worse than none.
 */
export function countryCodeOf(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) {
    let code: string;
    try {
      code = new Intl.Locale("und", { region: t.toUpperCase() }).region ?? "";
    } catch {
      return null;
    }
    if (knownRegions().includes(code)) return code;
  }
  return byName().get(fold(t)) ?? null;
}

function zonesOf(region: string): string[] {
  try {
    const l = new Intl.Locale("und", { region }) as Intl.Locale & {
      getTimeZones?: () => string[];
      timeZones?: string[];
    };
    const z =
      typeof l.getTimeZones === "function" ? l.getTimeZones() : l.timeZones;
    return Array.isArray(z) ? z : [];
  } catch {
    return [];
  }
}

/** The country's zone when it keeps exactly one; null when it keeps several or none. */
export function countryZone(region: string): string | null {
  const zones = zonesOf(region);
  return zones.length === 1 ? resolveZone(zones[0]) : null;
}

let zoneIndex: Map<string, string[]> | null = null;
/** The one region that keeps this zone, or null. */
export function regionOfZone(zone: string): string | null {
  if (!zoneIndex) {
    const m = new Map<string, string[]>();
    for (const code of knownRegions())
      for (const z of zonesOf(code)) m.set(z, [...(m.get(z) ?? []), code]);
    zoneIndex = m;
  }
  const hits = zoneIndex.get(zone) ?? [];
  return hits.length === 1 ? hits[0] : null;
}

/** The formats tag for a region: its likely language with the region. */
export function localeFor(region: string): string | null {
  const lang = languageOf(region);
  if (!lang) return null;
  const tag = `${lang}-${region}`;
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0 ? tag : null;
  } catch {
    return null;
  }
}

export function houseFrame(row: HouseRecord | null | undefined): HouseFrame {
  const recorded =
    typeof row?.timezone === "string" && row.timezone.trim()
      ? row.timezone.trim()
      : null;
  const own = resolveZone(recorded);
  const country = countryCodeOf(row?.country ?? null);

  let zone: string | null = own;
  let zoneSource: ZoneSource = own ? "house" : "none";
  if (!zone && country) {
    const z = countryZone(country);
    if (z) {
      zone = z;
      zoneSource = "country";
    }
  }

  let region: string | null = country;
  let localeSource: LocaleSource = country ? "country" : "none";
  if (!region && zone) {
    const r = regionOfZone(zone);
    if (r) {
      region = r;
      localeSource = "zone";
    }
  }
  const locale = region ? localeFor(region) : null;

  return {
    zone,
    zoneSource,
    unreadZone: recorded && !own ? recorded : null,
    region,
    countryZones: country ? zonesOf(country).length : null,
    locale,
    localeSource: locale ? localeSource : "none",
  };
}
