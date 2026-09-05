/**
 * `note_close_control` — the note's closing control, tried both ways.
 *
 * The founder, 2026-09-05: "lets try both, 80 percent simple 20 percent
 * signature". What these cases pin is not that a button renders — it is every
 * way this could produce numbers that look fine and are wrong:
 *
 *  - the arm is the GATEWAY'S, per house, and is never chosen in the browser;
 *  - an unread experiment falls back to PLAIN and SAYS it is a fallback, and
 *    records nothing at all — filing a plain exposure under a stored die arm is
 *    worse than not counting it;
 *  - both arms run the SAME write and record the SAME three events, so neither
 *    can quietly come to mean something different from the other;
 *  - the die on a note is a GESTURE, NOT A SEAL: no challenge is minted, and
 *    the card says so;
 *  - the report line is counts, never a verdict, and names what it cannot show.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => api.get(...args),
    post: (...args: unknown[]) => api.post(...args),
  },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import OneTapPanel from './OneTapPanel';
import {
  NOTE_CLOSE_DECIDED_ON,
  NOTE_CLOSE_FALLBACK_ARM,
  NOTE_CLOSE_FOUNDER_WORDS,
  NOTE_CLOSE_KEY,
  NOTE_CLOSE_RATIO,
  armToDraw,
  noteCloseReportLine,
} from './note-close-experiment';

const note = {
  id: 'a-note',
  restaurantId: 'rest-A',
  userId: 'user-1',
  actionType: 'custom',
  title: 'Call the cellar about Thursday',
  priority: 'low',
  status: 'pending',
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
};

type ArmAnswer = { arm?: unknown; recorded?: boolean } | Error;

function serve(rows: unknown[], armAnswer: ArmAnswer = { arm: 'plain', recorded: true }) {
  api.get.mockImplementation(async (path: string) => {
    if (String(path).startsWith('/ux/experiments')) {
      if (armAnswer instanceof Error) throw armAnswer;
      return { data: armAnswer };
    }
    return { data: { actions: rows } };
  });
}

function draw(restaurantId: string | null = 'rest-A') {
  return render(
    <MemoryRouter>
      <OneTapPanel restaurantId={restaurantId} />
    </MemoryRouter>,
  );
}

const eventsPosted = () =>
  api.post.mock.calls.filter((c: unknown[]) => String(c[0]).includes('/ux/experiments'));

/**
 * Complete the die by its keyboard path: Enter arms it, Enter again approves.
 * jsdom implements no `setPointerCapture`, which is why `HoldToApprove.test.tsx`
 * drives it this way too.
 */
async function holdTheDie(container: HTMLElement) {
  const die = container.querySelector('[data-note-arm="die"] [role="button"], [data-note-arm="die"] button');
  expect(die).not.toBeNull();
  fireEvent.keyDown(die!, { key: 'Enter' });
  fireEvent.keyDown(die!, { key: 'Enter' });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset().mockResolvedValue({ data: {} });
});

/* ── the constants are the gateway's ─────────────────────────────────────── */

describe('the browser copy matches the gateway', () => {
  // The header of `note-close-experiment.ts` claims this file pins the copy
  // against the source of truth. It has to actually do it, or the claim is the
  // kind of comment that gets believed.
  const gateway = readFileSync(
    join(__dirname, '../../../../../api-gateway/src/ux-optimizer/experiments.ts'),
    'utf8',
  );

  it('uses the same experiment key', () => {
    expect(NOTE_CLOSE_KEY).toBe('note_close_control');
    expect(gateway).toContain('key: "note_close_control"');
  });

  it('uses the same 80/20 split', () => {
    expect(NOTE_CLOSE_RATIO).toEqual({ plain: 80, die: 20 });
    expect(gateway).toContain('ratio: { plain: 80, die: 20 }');
  });

  it('carries the founder’s words and the date verbatim', () => {
    expect(gateway).toContain(NOTE_CLOSE_FOUNDER_WORDS);
    expect(gateway).toContain(NOTE_CLOSE_DECIDED_ON);
  });

  it('falls back to the arm that is the product as built', () => {
    // arms[0] on the gateway is the fallback there too. If the die were first,
    // an unreadable experiment would put a hold on a record everywhere.
    expect(NOTE_CLOSE_FALLBACK_ARM).toBe('plain');
    expect(gateway).toContain('arms: ["plain", "die"]');
  });
});

describe('armToDraw', () => {
  it('draws nothing while the arm is still being read', () => {
    expect(armToDraw({ state: 'reading' })).toBeNull();
  });

  it('draws the assigned arm', () => {
    expect(armToDraw({ state: 'assigned', arm: 'die', recorded: true })).toBe('die');
    expect(armToDraw({ state: 'assigned', arm: 'plain', recorded: true })).toBe('plain');
  });

  it('falls back to plain when the arm could not be read', () => {
    expect(armToDraw({ state: 'unreadable', message: 'boom' })).toBe('plain');
  });
});

/* ── the card ────────────────────────────────────────────────────────────── */

describe('the note card draws the arm the gateway gave it', () => {
  it('draws the plain button on the plain arm, and no hold', async () => {
    serve([note], { arm: 'plain', recorded: true });
    draw();
    expect(await screen.findByRole('button', { name: /mark it done/i })).toBeInTheDocument();
    expect(screen.queryByText(/hold to write it down/i)).not.toBeInTheDocument();
    expect(screen.getByText(/the plain button says so/i)).toBeInTheDocument();
  });

  it('draws the hold on the die arm, and no plain button', async () => {
    serve([note], { arm: 'die', recorded: true });
    draw();
    expect(await screen.findByText(/hold to write it down/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark it done/i })).not.toBeInTheDocument();
  });

  it('says the die is a GESTURE and not a seal', async () => {
    // ADR 0116's addendum made an order approval a REDEEMED seal. A wax
    // impression that looked the same on a row that only records a decision
    // would empty the word, which is the whole objection the experiment is
    // testing. The card has to carry the distinction in words.
    serve([note], { arm: 'die', recorded: true });
    draw();
    expect(
      await screen.findByText(/a gesture rather than a seal — nothing is minted and nothing is redeemed/i),
    ).toBeInTheDocument();
  });

  it('NEVER mints a seal on the die arm, and still writes the note down', async () => {
    // Driven by the keyboard path — Enter arms, Enter approves — because that is
    // the path `HoldToApprove.test.tsx` uses: jsdom has no setPointerCapture.
    serve([note], { arm: 'die', recorded: true });
    const { container } = draw();
    await screen.findByText(/hold to write it down/i);
    await holdTheDie(container);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/one-tap-actions/a-note/execute', {}, undefined),
    );
    // The delivery card above it mints. This one must not: there is no seal for
    // a row that only records a decision, and a mint here would make the two
    // ceremonies indistinguishable.
    expect(
      api.post.mock.calls.filter((c: unknown[]) => String(c[0]).includes('seal-challenge')),
    ).toHaveLength(0);
    // And nothing was sent with a seal header either.
    for (const call of api.post.mock.calls) expect(call[2]).toBeUndefined();
  });

  it('draws NO control while the arm is still unread', async () => {
    // Rendering the plain button here and swapping to the die a moment later
    // would be a guess wearing an assignment's clothes.
    api.get.mockImplementation(async (path: string) => {
      if (String(path).startsWith('/ux/experiments')) return new Promise(() => undefined);
      return { data: { actions: [note] } };
    });
    draw();
    expect(
      await screen.findByText(/reading which closing control this house is on/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark it done/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/hold to write it down/i)).not.toBeInTheDocument();
  });

  it('falls back to plain on a failed read AND says it is a fallback', async () => {
    serve([note], new Error('no route'));
    draw();
    expect(await screen.findByRole('button', { name: /mark it done/i })).toBeInTheDocument();
    expect(
      screen.getByText(/could not be read \(no route\), so this is the plain one — a fallback, not an assignment/i),
    ).toBeInTheDocument();
  });

  it('treats an arm it does not know as unreadable, not as plain', async () => {
    serve([note], { arm: 'wax', recorded: true });
    draw();
    expect(await screen.findByText(/a fallback, not an assignment/i)).toBeInTheDocument();
  });
});

/* ── what is recorded ────────────────────────────────────────────────────── */

describe('both arms record the same three events', () => {
  for (const arm of ['plain', 'die'] as const) {
    it(`records one exposure on the ${arm} arm, with no arm in the body`, async () => {
      serve([note], { arm, recorded: true });
      draw();
      await screen.findByText(note.title);
      await waitFor(() => expect(eventsPosted().length).toBeGreaterThan(0));
      const [path, body] = eventsPosted()[0] as [string, Record<string, unknown>];
      expect(path).toBe('/ux/experiments/note_close_control/events');
      expect(body.event).toBe('exposed');
      expect(body.actionId).toBe('a-note');
      // The gateway stamps the arm from the stored assignment. A browser that
      // could name its own arm could file its outcome against the other one.
      expect(body).not.toHaveProperty('arm');
      expect(eventsPosted()).toHaveLength(1);
    });
  }

  it('records a completion with a duration when the plain button is pressed', async () => {
    serve([note], { arm: 'plain', recorded: true });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /mark it done/i }));
    await waitFor(() =>
      expect(eventsPosted().map((c: unknown[]) => (c[1] as { event: string }).event)).toContain(
        'completed',
      ),
    );
    const done = eventsPosted().find(
      (c: unknown[]) => (c[1] as { event: string }).event === 'completed',
    ) as [string, Record<string, unknown>];
    expect(typeof done[1].durationMs).toBe('number');
    // And the note itself was actually written down, through the same route the
    // other arm uses.
    expect(api.post).toHaveBeenCalledWith('/one-tap-actions/a-note/execute', {}, undefined);
  });

  it('records a completion with a duration on the DIE arm too', async () => {
    // The point of "both arms record the same events": if the die completed
    // through a different path it could stop recording, and the die arm would
    // then look like an arm nobody ever finishes.
    serve([note], { arm: 'die', recorded: true });
    const { container } = draw();
    await screen.findByText(/hold to write it down/i);
    await holdTheDie(container);
    await waitFor(() =>
      expect(eventsPosted().map((c: unknown[]) => (c[1] as { event: string }).event)).toContain(
        'completed',
      ),
    );
    const done = eventsPosted().find(
      (c: unknown[]) => (c[1] as { event: string }).event === 'completed',
    ) as [string, Record<string, unknown>];
    expect(typeof done[1].durationMs).toBe('number');
    expect(done[1]).not.toHaveProperty('arm');
  });

  it('records an abandon when the card is left still open', async () => {
    serve([note], { arm: 'die', recorded: true });
    const { unmount } = draw();
    await screen.findByText(note.title);
    await waitFor(() => expect(eventsPosted().length).toBe(1));
    act(() => unmount());
    const events = eventsPosted().map((c: unknown[]) => (c[1] as { event: string }).event);
    expect(events).toEqual(['exposed', 'abandoned']);
  });

  it('does NOT record an abandon after the note was closed', async () => {
    serve([note], { arm: 'plain', recorded: true });
    const { unmount } = draw();
    fireEvent.click(await screen.findByRole('button', { name: /mark it done/i }));
    await waitFor(() =>
      expect(eventsPosted().map((c: unknown[]) => (c[1] as { event: string }).event)).toContain(
        'completed',
      ),
    );
    act(() => unmount());
    const events = eventsPosted().map((c: unknown[]) => (c[1] as { event: string }).event);
    expect(events).toEqual(['exposed', 'completed']);
  });

  it('RECORDS NOTHING when the arm could not be read', async () => {
    // The card shows plain; the gateway would stamp this house's STORED arm,
    // which may be the die. Filing a plain exposure under the die is worse than
    // not counting it, so a failed read counts nothing and the report line says
    // the counts are a floor.
    serve([note], new Error('no route'));
    const { unmount } = draw();
    fireEvent.click(await screen.findByRole('button', { name: /mark it done/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/one-tap-actions/a-note/execute', {}, undefined),
    );
    act(() => unmount());
    expect(eventsPosted()).toHaveLength(0);
  });

  it('records nothing for a delivery card — the experiment is about NOTES', async () => {
    serve(
      [{ ...note, id: 'a-del', actionType: 'delivery_confirm', relatedOrderId: 'ord-9' }],
      { arm: 'die', recorded: true },
    );
    draw();
    await screen.findByText(note.title);
    expect(eventsPosted()).toHaveLength(0);
  });
});

/* ── the report line ─────────────────────────────────────────────────────── */

describe('noteCloseReportLine — counts, never a verdict', () => {
  it('says nothing at all while the counts are still being read', () => {
    expect(noteCloseReportLine({ state: 'reading' })).toBeNull();
  });

  it('names the ratio and the founder’s date in every state', () => {
    const line = noteCloseReportLine({ state: 'unreadable', message: 'timeout' })!;
    expect(line).toContain('plain 80% / die 20%');
    expect(line).toMatch(/set by the founder on .*2026/);
  });

  it('A FAILED READ IS NOT A ZERO', () => {
    const line = noteCloseReportLine({ state: 'unreadable', message: 'timeout' })!;
    expect(line).toContain('could not be read (timeout)');
    expect(line).toContain('this is not a zero');
    expect(line).not.toMatch(/\b0 shown\b/);
  });

  it('tells an unassigned house apart from an empty one', () => {
    const line = noteCloseReportLine({
      state: 'ready',
      counts: { arm: null, exposures: 0, completed: 0, abandoned: 0, since: null },
    })!;
    expect(line).toContain('has not been assigned an arm yet');
  });

  it('says a real empty in words rather than in zeroes', () => {
    const line = noteCloseReportLine({
      state: 'ready',
      counts: { arm: 'die', exposures: 0, completed: 0, abandoned: 0, since: null },
    })!;
    expect(line).toContain('no note has been put in front of anyone here yet');
  });

  it('reports counts, and no comparison of one arm against the other', () => {
    const line = noteCloseReportLine({
      state: 'ready',
      counts: {
        arm: 'die',
        exposures: 12,
        completed: 9,
        abandoned: 2,
        since: '2026-09-05T12:00:00.000Z',
      },
    })!;
    expect(line).toContain('12 shown, 9 closed, 2 left standing');
    expect(line).toContain('Counts, not a verdict');
    // No percentage, no better/worse, no winner. If one of these ever appears
    // the line has started reading a result nobody has decided.
    expect(line).not.toMatch(/\b(better|worse|wins|winning|beats|%\s*completion)\b/i);
  });

  it('names what it cannot show, rather than printing a silent zero for it', () => {
    // A house sees ONE arm, so the other arm's rows belong to other houses and
    // are out of this read's tenancy. Printing "plain: 0" beside a die house's
    // real numbers would read as a verdict against an arm nobody here was shown.
    const line = noteCloseReportLine({
      state: 'ready',
      counts: { arm: 'die', exposures: 3, completed: 3, abandoned: 0, since: null },
    })!;
    expect(line).toContain("the other arm's figures belong to other houses");
    expect(line).toContain('not counted, in either arm');
  });
});
