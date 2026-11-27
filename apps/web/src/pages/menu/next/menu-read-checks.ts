/**
 * "Worth a second look" on a read, before it is made current (r108 menu-g12).
 *
 * These only SAY something, in words. They never change a value: a likely
 * decimal shift is named ("may be 45.00"), never corrected, because a guess
 * on money goes against the never-guess rule (#761). A price that is not
 * there is never flagged; glass and bottle are compared separately.
 */
import { formatMoney } from '../../../lib/currency';
import type { MenuImportReviewItem, PlanLine } from '../../../services/api/menus';

export interface CheckLine {
  id: string;
  name: string;
  section: string | null | undefined;
  glass: number | null;
  bottle: number | null;
}

export type CheckKind = 'outlier' | 'duplicate' | 'glass_not_under_bottle';

export interface CheckFinding {
  kind: CheckKind;
  /** The line the person is sent to. */
  lineId: string;
  words: string;
}

/** At least this many priced lines in a section before a price is called an outlier. */
const MIN_PRICED = 4;
const HIGH = 4;
const LOW = 0.25;

/** NFKC, Turkish-aware lowercase (I to ı, İ to i), then ı folded to i so Rakı, RAKI and Raki are one name. */
export function normaliseName(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLocaleLowerCase('tr')
    .replace(/̇/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sectionWords(section: string | null | undefined): string {
  const s = (section ?? '').trim();
  return s ? s : 'menu';
}

const priced = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function menuReadChecks(lines: CheckLine[], currency: string | null = null): CheckFinding[] {
  const out: CheckFinding[] = [];
  const bySection = new Map<string, CheckLine[]>();
  for (const l of lines) {
    const key = normaliseName(l.section ?? '');
    bySection.set(key, [...(bySection.get(key) ?? []), l]);
  }

  for (const group of bySection.values()) {
    const where = sectionWords(group[0].section);

    for (const kind of ['bottle', 'glass'] as const) {
      const have = group.filter((l) => priced(l[kind]));
      if (have.length < MIN_PRICED) continue;
      const mid = median(have.map((l) => l[kind] as number));
      for (const l of have) {
        const price = l[kind] as number;
        const high = price > HIGH * mid;
        const low = price < LOW * mid;
        if (!high && !low) continue;
        const others = have.filter((o) => o !== l).map((o) => o[kind] as number);
        const lo = Math.min(...others);
        const hi = Math.max(...others);
        const shifted = high ? [100, 1000].map((d) => price / d).find((p) => p >= lo && p <= hi) : undefined;
        const ratio = high ? `about ${Math.round(price / mid)} times` : `about 1/${Math.round(mid / price)} of`;
        out.push({
          kind: 'outlier',
          lineId: l.id,
          words:
            `${l.name}: the ${kind} price ${formatMoney(price, currency)} is ${ratio} the other ${where} prices` +
            (shifted !== undefined ? `; it may be ${formatMoney(shifted, currency)}.` : '.'),
        });
      }
    }

    const seen = new Map<string, CheckLine>();
    const said = new Set<string>();
    for (const l of group) {
      const n = normaliseName(l.name);
      if (!n) continue;
      const first = seen.get(n);
      if (!first) {
        seen.set(n, l);
      } else if (!said.has(n)) {
        said.add(n);
        out.push({ kind: 'duplicate', lineId: l.id, words: `${l.name} is on this menu twice under ${where}.` });
      }
    }
  }

  for (const l of lines) {
    if (priced(l.glass) && priced(l.bottle) && l.glass >= l.bottle) {
      out.push({
        kind: 'glass_not_under_bottle',
        lineId: l.id,
        words: `${l.name}: the glass ${formatMoney(l.glass, currency)} costs as much as or more than the bottle ${formatMoney(l.bottle, currency)}.`,
      });
    }
  }
  return out;
}

export function checkLinesFromPlan(lines: PlanLine[]): CheckLine[] {
  return lines.map((l) => ({
    id: l.menuItemId,
    name: l.name,
    section: l.category,
    glass: l.glass.menuPrice,
    bottle: l.bottle.menuPrice,
  }));
}

export function checkLinesFromReview(items: MenuImportReviewItem[]): CheckLine[] {
  return items.map((i) => ({
    id: i.menuItemId,
    name: i.name,
    section: i.category,
    glass: i.byGlassPrice,
    bottle: i.bottlePrice,
  }));
}

/**
 * Brings a line into view and focuses it, at once: no glide, for anyone.
 * 'instant', not 'auto': globals.css puts `scroll-smooth` on <html>, so 'auto'
 * would still animate. A closed fold around the line is opened first.
 */
export function showLineById(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) {
    if (p instanceof HTMLDetailsElement) p.open = true;
  }
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
  el.focus({ preventScroll: true });
}
