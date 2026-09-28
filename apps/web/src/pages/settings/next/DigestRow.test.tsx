/**
 * DigestRow render contract — sketch 109A §IV, ADR 0149 row 26.
 *
 * Mounted directly against a `SettingsNextData` fixture (the same pattern as
 * `CarryingCostSection.test.tsx`). The one thing this row exists to prevent —
 * a never-written house reading the service's own stored defaults
 * (`digestHour ?? 7`, `digestMinUrgency ?? "this_week"`) as if a person had
 * chosen them — is exactly what `stated: false` guards against, so that is
 * where these tests start.
 *
 * Found untested by the settings-review audit (2026-09-18): 155 lines with no
 * dedicated test file.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DigestRow } from './DigestRow';
import type { SettingsNextData } from './useSettingsNextData';

function remote(data: unknown, status = 'ok') {
  return {
    status,
    data,
    error: status === 'error' ? 'gateway unreachable' : null,
    reload: vi.fn(),
    set: vi.fn(),
  };
}

function digestData(over: Record<string, unknown> = {}) {
  return {
    stated: false,
    digestEnabled: false,
    digestHour: 7,
    digestMinUrgency: 'this_week',
    recipientEmail: null,
    lastSentAt: null,
    ...over,
  };
}

function mount(over: Record<string, unknown> = {}) {
  const saveDigest = (over.saveDigest as ReturnType<typeof vi.fn>) ?? vi.fn(() => Promise.resolve(true));
  const data = {
    canManage: true,
    saveDigest,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    digest: remote(digestData()),
    ...over,
  } as unknown as SettingsNextData;
  render(<DigestRow data={data} />);
  return { saveDigest };
}

const record = () => screen.getByRole('button', { name: /^record$/i });

describe('a never-written house is unstated, not the service default dressed as an answer', () => {
  it('does not print the stored defaults as if they were chosen', () => {
    mount();
    expect(screen.getByText(/The sender exists as of this pass/i)).toBeInTheDocument();
    expect(screen.queryByText(/07:00/)).not.toBeInTheDocument();
    // The urgency <select> always lists "this week or sooner" as a CHOICE —
    // that is not the bug. The bug would be it arriving pre-selected, as if
    // the service's own stored default (`digestMinUrgency ?? "this_week"`)
    // were an answer a person had already given.
    expect(screen.getByLabelText(/least urgency worth a mail/i)).toHaveValue('');
  });

  it('Record is inert until the hour, urgency and recipient are all filled', () => {
    const { saveDigest } = mount();
    expect(record()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/digest hour/i), { target: { value: '9' } });
    expect(record()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/least urgency worth a mail/i), {
      target: { value: 'now' },
    });
    expect(record()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/recipient email/i), {
      target: { value: 'owner@example.com' },
    });
    expect(record()).toBeEnabled();
    fireEvent.click(record());
    expect(saveDigest).toHaveBeenCalledWith({
      digestEnabled: true,
      digestHour: 9,
      digestMinUrgency: 'now',
      recipientEmail: 'owner@example.com',
    });
  });

  it('the hour field discards anything that is not a digit', () => {
    mount();
    const hour = screen.getByLabelText(/digest hour/i) as HTMLInputElement;
    fireEvent.change(hour, { target: { value: '9pm!' } });
    expect(hour).toHaveValue('9');
  });
});

describe('an answered house gets a plain on/off toggle, not the recording form', () => {
  it('states what was recorded and toggles it off', () => {
    const { saveDigest } = mount({
      digest: remote(
        digestData({
          stated: true,
          digestEnabled: true,
          digestHour: 9,
          digestMinUrgency: 'now',
          recipientEmail: 'owner@x.com',
          lastSentAt: '2026-09-06T09:00:00.000Z',
        }),
      ),
    });
    expect(
      screen.getByText(/Yes · 09:00 · only what is due now · to owner@x\.com/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/digest hour/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /turn off/i }));
    expect(saveDigest).toHaveBeenCalledWith({ digestEnabled: false });
  });

  it('a reader without manage rights gets no control at all', () => {
    mount({
      canManage: false,
      digest: remote(digestData({ stated: true, digestEnabled: true, recipientEmail: 'a@b.com' })),
    });
    expect(screen.queryByRole('button', { name: /turn/i })).not.toBeInTheDocument();
  });
});

describe('denied and failed reads are their own state, never unstated', () => {
  it('a denied read says the role may not see it', () => {
    mount({ digest: remote(null, 'denied') });
    expect(
      screen.getByText(/Your role may not read this house's digest preference/i),
    ).toBeInTheDocument();
  });

  it('a failed read says so, and is explicit that it is not the same as unstated', () => {
    mount({ digest: remote(null, 'error') });
    expect(screen.getByText(/Could not be read — gateway unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/Not the same as unstated/i)).toBeInTheDocument();
  });
});

describe('a failed write is visible, not swallowed', () => {
  it('shows the writer failure inline on this row', () => {
    mount({
      writer: {
        busy: null,
        failed: { key: 'digest', message: 'network down' },
        run: vi.fn(),
        clear: vi.fn(),
      },
    });
    expect(screen.getByText(/That did not go through — network down/i)).toBeInTheDocument();
  });
});
