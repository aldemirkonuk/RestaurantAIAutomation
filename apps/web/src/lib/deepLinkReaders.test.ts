/**
 * Every deep link a bell or a day-line tick carries must be READ by the page it
 * opens (F-217, F-1143). Twice a sim found links whose words no page read —
 * `/orders?highlight=`, `/orders?invoice_match=`, `&deal=1&urgent=1`,
 * `/reports?type=weekly` — so the person landed on the whole page with
 * nothing opened. This guard reads the producers' source (gateway and
 * orchestrator) and the pages' source, and fails on a word with no reader.
 *
 * Static on purpose: it reads files, never runs a service.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..');
const REPO = join(WEB_SRC, '..', '..', '..');

/** Where each route's query words are read, relative to apps/web/src. */
const READERS: Record<string, string[]> = {
  orders: ['pages/orders'],
  reports: ['pages/reports'],
  inventory: ['pages/inventory', 'components/mudavym/DeliveriesToName.tsx'],
  team: ['pages/team'],
  'vendor-prices': ['pages/vendor-prices'],
  calendar: ['pages/calendar'],
};

/**
 * Known words with no reader yet, each a filed gap. Listed so the guard can
 * run today; an entry that gains a reader fails below and must be struck.
 */
const KNOWN_UNREAD = new Set([
  'team?schedule', // schedule.service.ts — the page reads `week`, which the same link carries
  'calendar?event', // house-day.service.ts — CalendarNext opens no single event from the address
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', '__tests__', '__pycache__', '.venv', 'venv']);

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(name)) out.push(p);
  }
  return out;
}

const PRODUCER = /(?:action_url|actionUrl|href)["']?\s*[:=]\s*f?[`"']\/([a-z-]+)\?([^"'`\s]*)/g;

function producedLinks(): { route: string; key: string; at: string }[] {
  const files = [
    ...walk(join(REPO, 'apps/api-gateway/src'), (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')),
    ...walk(join(REPO, 'services/agent-orchestrator'), (f) => f.endsWith('.py') && !f.startsWith('test_')),
  ];
  const links: { route: string; key: string; at: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(PRODUCER)) {
      for (const part of m[2].split('&')) {
        const key = /^([a-z_-]+)=/.exec(part)?.[1];
        if (key) links.push({ route: m[1], key, at: relative(REPO, file) });
      }
    }
  }
  return links;
}

function readerText(route: string): string {
  return (READERS[route] ?? [])
    .flatMap((p) => {
      const abs = join(WEB_SRC, p);
      return statSync(abs).isDirectory()
        ? walk(abs, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        : [abs];
    })
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

const isRead = (text: string, key: string) =>
  new RegExp(`\\.(?:get|has)\\(\\s*['"]${key}['"]\\s*\\)`).test(text);

describe('deep links a page opens are read by that page (F-217, F-1143)', () => {
  const links = producedLinks();

  it('finds the producers it guards — an empty scan proves nothing', () => {
    const seen = new Set(links.map((l) => `${l.route}?${l.key}`));
    for (const known of ['orders?order', 'orders?tab', 'reports?type', 'inventory?verify']) {
      expect(seen, known).toContain(known);
    }
  });

  it('every produced word has a reader on its page', () => {
    const unread = links
      .filter((l) => !KNOWN_UNREAD.has(`${l.route}?${l.key}`))
      .filter((l) => !(l.route in READERS) || !isRead(readerText(l.route), l.key))
      .map((l) => `${l.at}: /${l.route}?${l.key}=`);
    expect(unread).toEqual([]);
  });

  it('a known gap that gained a reader is struck from the list', () => {
    for (const gap of KNOWN_UNREAD) {
      const [route, key] = gap.split('?');
      expect(isRead(readerText(route), key), gap).toBe(false);
    }
  });
});
