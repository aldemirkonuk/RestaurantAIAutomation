/**
 * Phone-width guard (r74, Settings at 375 scrolled sideways: scrollWidth 758).
 *
 * jsdom does no layout, so this cannot measure a page. It pins the three causes
 * instead: (1) no section may fix a width over 343 px (a 375 phone minus the
 * 16 px gutters), (2) a row's control wraps under its words rather than being
 * pushed off the edge, (3) a long `read by` path wraps inside a scrollable pill.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigestRow } from './DigestRow';
import { Row } from './SectionKit';
import type { SettingsNextData } from './useSettingsNextData';

const MAX = 343;
// A fixed width is allowed only inside its own horizontal scroller.
const SCROLLED: Record<string, string[]> = { 'VendorTermsSection.tsx': ['minWidth: 780'] };
const dir = __dirname;
const sources = readdirSync(dir)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe('settings sections fix no width over 343 px', () => {
  it.each(sources)('%s', (f, src) => {
    const bad: string[] = [];
    for (const m of src.matchAll(/\b(?:width|minWidth|min-width)\s*:\s*['"]?(\d+(?:\.\d+)?)(px|em|rem)?/g)) {
      const px = Number(m[1]) * (m[2] === 'em' || m[2] === 'rem' ? 16 : 1);
      if (px > MAX && !(SCROLLED[f] ?? []).includes(m[0])) bad.push(m[0]);
    }
    expect(bad).toEqual([]);
  });
});

describe('the row and its controls give way at phone width', () => {
  it('a Row wraps its control under the words and caps it at the row width', () => {
    const { container } = render(<Row label="L" consequence="c" control={<button>go</button>} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.flexWrap).toBe('wrap');
    const control = screen.getByRole('button', { name: 'go' }).parentElement as HTMLElement;
    expect(control.style.maxWidth).toBe('100%');
  });

  it('the digest urgency select never outgrows its row', () => {
    const data = {
      canManage: true,
      saveDigest: vi.fn(),
      writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
      digest: { status: 'ok', data: { stated: false, digestEnabled: false, digestHour: 7, digestMinUrgency: 'this_week', recipientEmail: null, lastSentAt: null }, error: null, reload: vi.fn(), set: vi.fn() },
    } as unknown as SettingsNextData;
    render(<DigestRow data={data} />);
    const select = screen.getByLabelText(/least urgency worth a mail/i) as HTMLSelectElement;
    expect(select.style.maxWidth).toBe('100%');
  });

  it('a read-by path wraps anywhere inside a scrollable pill', () => {
    render(
      <Row
        label="L"
        consequence="c"
        provenance={{ kept: 'account', when: null, whenUnknown: 'x', readBy: <code>pages/distributors/command/DistributorMapPage.tsx:36</code> }}
      />,
    );
    const code = screen.getByText(/DistributorMapPage/);
    expect(code.tagName).toBe('CODE');
    const pill = code.parentElement as HTMLElement;
    expect(pill.style.overflowWrap).toBe('anywhere');
    expect(pill.style.overflowX).toBe('auto');
  });
});
