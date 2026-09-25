/**
 * HelpNext — the two grafts ADR 0160 §111's Decision requires regardless of
 * base (`0160-the-founders-sketch-review-*.md` §111): B's "What to do next"
 * rail, separate from Section I, and the centred "Write to support with
 * these readings?" panel in place of the bare `mailto:` link.
 *
 * `useHelpNextData` is mocked wholesale — every other test in this
 * directory tests the pure `hp-*.ts` modules it composes, so this file's
 * job is only the wiring: does the rail render, separately, always; does
 * "Write to support" open the panel instead of navigating.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Fetched } from './hp-readiness';
import type { ServiceState } from './hp-service';

vi.mock('./useHelpNextData', () => ({ useHelpNextData: vi.fn() }));
import { useHelpNextData } from './useHelpNextData';
import HelpNext from './HelpNext';

const NOW_ISO = '2026-09-19T12:00:00.000Z';
const ok = <T,>(data: T): Fetched<T> => ({ status: 'ok', data });

const READY_SERVICE: ServiceState = {
  kind: 'answered',
  ready: true,
  httpStatus: 200,
  commit: 'abc1234',
  bootedAt: null,
  checkedAt: null,
  database: 'ok',
  supabaseClient: 'ok',
  reason: null,
  latencyMs: 40,
  readAt: new Date(NOW_ISO),
};

function clearData(over: Record<string, unknown> = {}) {
  return {
    role: 'owner',
    houseName: 'Sim Meyhouse',
    restaurantId: 'r-1',
    mcp: ok([]),
    oauth: ok({ scope: 'own', rows: [] }),
    pos: ok({ sources: [] }),
    mail: ok({ reader: { granted: true, enabled: true, lastReadAt: NOW_ISO, lastError: null } }),
    oneTap: ok([]),
    ordersPending: ok({ count: 0 }),
    askAi: ok([]),
    producers: ok({ served: true, producers: [] }),
    reminders: ok({ served: true, ledgerReadable: true, lastRun: null }),
    service: READY_SERVICE,
    refetchAll: vi.fn(),
    ...over,
  };
}

function renderHelp(over: Record<string, unknown> = {}) {
  vi.mocked(useHelpNextData).mockReturnValue(clearData(over) as ReturnType<typeof useHelpNextData>);
  render(
    <MemoryRouter>
      <HelpNext />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPPORT_EMAIL', 'support@mudavym.com');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** The rail's own eyebrow ("What to do next") is a `<p>`, not a heading — its
 * `<h2>` is the status line ("Everything reads clear right now." / "N things
 * worth a look."), which is deliberately status-dependent text, not a fixed
 * title. The eyebrow is the stable anchor to the section from a test. */
function railSection(): HTMLElement {
  return screen.getByText('What to do next').closest('section')!;
}

describe('the "What to do next" rail — ADR 0160 §111, separate from Section I', () => {
  it('is its own section, present even when everything reads clear, not folded into "Waiting on you"', () => {
    renderHelp();
    const rail = railSection();
    expect(rail).toBeInTheDocument();
    expect(within(rail).getByText('Everything reads clear right now.')).toBeInTheDocument();
    // It is not Section I — Section I keeps its own heading, outside the rail.
    const sectionIHeading = screen.getByRole('heading', { name: 'This house, right now' });
    expect(rail).not.toContainElement(sectionIHeading);
  });

  it('names a real fault when one exists — a revoked mail grant — with its Reconnect link, in the rail itself', () => {
    renderHelp({
      mail: ok({ reader: { granted: false, enabled: true, lastReadAt: null, lastError: null } }),
    });
    // hp-readiness.ts's mailItem detail for this exact case. It legitimately
    // appears twice — once in the rail, once in Section I's own row, the
    // SAME reading shown both places — so this asserts it exists at all
    // (getAllByText, not getByText) and specifically inside the rail.
    expect(screen.getAllByText(/no live grant backs it/i).length).toBeGreaterThan(0);
    const rail = railSection();
    expect(within(rail).getByText(/no live grant backs it/i)).toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('carries its own "Write to support" shortcut', () => {
    renderHelp();
    // Two triggers exist on the page once this graft lands: the rail's and
    // "Reach a person"'s. Both must open the same panel (asserted below).
    const triggers = screen.getAllByRole('button', { name: 'Write to support' });
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });
});

describe('"Write to support" opens the centred panel — never a bare mailto navigation', () => {
  it('has no plain mailto link left anywhere on the page', () => {
    renderHelp();
    const mailtoLinks = screen
      .queryAllByRole('link')
      .filter((el) => el.getAttribute('href')?.startsWith('mailto:'));
    expect(mailtoLinks).toEqual([]);
  });

  it('clicking "Write to support" in Reach a person opens "Write to support with these readings?"', () => {
    renderHelp();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const contactSection = screen.getByRole('heading', { name: 'Reach a person' }).closest('section')!;
    fireEvent.click(within(contactSection).getByRole('button', { name: 'Write to support' }));
    expect(
      screen.getByRole('dialog', { name: 'Write to support with these readings' }),
    ).toBeInTheDocument();
  });

  it('clicking the rail\'s own "Write to support" opens the same panel', () => {
    renderHelp();
    fireEvent.click(within(railSection()).getByRole('button', { name: 'Write to support' }));
    expect(
      screen.getByRole('dialog', { name: 'Write to support with these readings' }),
    ).toBeInTheDocument();
  });

  it('"Not now" — a word, never an X — closes it', () => {
    renderHelp();
    fireEvent.click(screen.getAllByRole('button', { name: 'Write to support' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens and states the unconfigured address honestly when no VITE_SUPPORT_EMAIL is set', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '');
    renderHelp();
    fireEvent.click(screen.getAllByRole('button', { name: 'Write to support' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Write to support with these readings' });
    expect(dialog).toHaveTextContent('No support address was configured for this build.');
  });
});
