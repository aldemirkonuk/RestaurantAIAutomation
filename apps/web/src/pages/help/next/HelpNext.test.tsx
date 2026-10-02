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
 *
 * The "Page tips" switch is tested inside the real GuidanceProvider and the
 * real `useUserPreferences` query, with the preferences request itself
 * (`apiClient.get` / `.patch`) and the signed-in person stood in. So the test
 * sees what TanStack really hands the provider while the read is loading,
 * after it fails (the read and its one retry), and once it answers. The
 * real setup-nudge banner is drawn beside the page, as the house shell
 * draws it, because showing it saves.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Fetched } from './hp-readiness';
import type { ServiceState } from './hp-service';

vi.mock('./useHelpNextData', () => ({ useHelpNextData: vi.fn() }));
vi.mock('../../../stores', () => ({
  useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: 'u-1' } }),
}));
vi.mock('driver.js', () => ({ driver: () => ({ drive: vi.fn(), destroy: vi.fn() }) }));
// What the setup-nudge banner asks before it shows: an owner, not yet set up.
vi.mock('../../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ progress: { activated: false } }),
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner' } }) }));
import { useHelpNextData } from './useHelpNextData';
import HelpNext from './HelpNext';
import { GuidanceProvider } from '../../../guidance/GuidanceProvider';
import { SetupNudgeBanner } from '../../../guidance/components/SetupNudgeBanner';
import { apiClient } from '../../../services/api/client';

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

describe('"Page tips" waits for the account\'s copy of the setting', () => {
  const PREFS_URL = '/users/u-1/preferences';
  let get: MockInstance<typeof apiClient.get>;
  let patch: MockInstance<typeof apiClient.patch>;

  function renderWithGuidance() {
    vi.mocked(useHelpNextData).mockReturnValue(clearData() as ReturnType<typeof useHelpNextData>);
    // No wait before the hook's one retry, so a failed read settles at once.
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/help']}>
          <GuidanceProvider>
            <SetupNudgeBanner />
            <HelpNext />
          </GuidanceProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return screen.getByTestId('hp-page-tips');
  }
  const nudge = () => screen.queryByText('Finish setting up Mudavym.');

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    get = vi.spyOn(apiClient, 'get');
    patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { preferences: {} } });
  });
  afterEach(() => {
    get.mockRestore();
    patch.mockRestore();
  });

  it('while it loads, says it is checking, with no on/off, no button, and no nudge', () => {
    get.mockReturnValue(new Promise(() => {}));
    const card = renderWithGuidance();
    expect(card).toHaveTextContent('Checking your tip setting…');
    expect(card).not.toHaveTextContent(/Page tips are (on|off)/);
    expect(within(card).queryByRole('button')).toBeNull();
    expect(nudge()).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it('when the read and its retry both fail, says so, and nothing is shown or saved from the stand-in', async () => {
    get.mockRejectedValue(new Error('read failed'));
    renderWithGuidance();
    const card = await screen.findByText("Couldn't load your tip setting.");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(2, PREFS_URL);
    const tips = screen.getByTestId('hp-page-tips');
    expect(tips).toContainElement(card);
    expect(tips).not.toHaveTextContent(/Page tips are (on|off)|Checking/);
    expect(within(tips).queryByRole('button')).toBeNull();
    // The setup nudge would save the whole stand-in copy just by showing.
    expect(nudge()).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('wineops_guidance_v1')).toBeNull();
  });

  it('once it answers, shows the setting and a button that saves it, and the nudge may show', async () => {
    get.mockResolvedValue({ data: { preferences: {} } });
    renderWithGuidance();
    await screen.findByText('Page tips are on');
    const card = screen.getByTestId('hp-page-tips');
    expect(card).toHaveTextContent(
      'Some pages open with a short tip. "Not now" puts it off for four hours; "Don\'t show tips again" turns them all off.',
    );
    // Showing the nudge saves (`markSetupNudgeShown`): the gate is open.
    expect(nudge()).toBeTruthy();
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(PREFS_URL, {
        preferences: { guidance: expect.objectContaining({ setup_nudge: expect.objectContaining({ session_count: 1 }) }) },
      }),
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Turn tips off' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(PREFS_URL, {
        preferences: { guidance: expect.objectContaining({ global: expect.objectContaining({ hide_all_tips: true }) }) },
      }),
    );
  });
});
