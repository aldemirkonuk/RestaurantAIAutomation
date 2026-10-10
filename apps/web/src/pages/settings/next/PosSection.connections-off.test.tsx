/**
 * F-996: with the Connections page off for the house, Settings › Point of sale
 * is the only place a till shows. It says connections are off and what that
 * means, and names a till a refusal made earlier still turns away, so
 * "Checks received" is never read as a feed that is still taken. The flag is
 * not changed here; with it on this section folds into /connections
 * (SettingsNext.test.tsx), which carries Disconnect and Reconnect.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TillFeedsWhileConnectionsOff } from './PosSection';
import type { PosRegister, TillFeed } from './useSettingsNextData';

function draw(feeds: TillFeed[] | null, feedsError: string | null = null) {
  const reg = {
    providers: { summary: { total: 0, byTier: {}, byStatus: {} }, providers: [] },
    status: null,
    statusError: null,
    feeds,
    feedsError,
  } as unknown as PosRegister;
  render(<TillFeedsWhileConnectionsOff reg={reg} />);
}

beforeEach(() => cleanup());

describe('Settings › Point of sale while Connections is off (F-996)', () => {
  it('says connections are off, and that a till cannot be connected or disconnected here', () => {
    draw([]);
    expect(screen.getByText('Connections are off')).toBeInTheDocument();
    expect(screen.getByText(/cannot be connected, disconnected or\s+reconnected from here/)).toBeInTheDocument();
    expect(screen.getByText(/No till is disconnected/)).toBeInTheDocument();
  });

  it('names a till whose checks are turned away, and leaves out the ones still taken', () => {
    draw([
      { provider: 'square', providerName: 'Square', enabled: false, changedAt: null },
      { provider: 'toast', providerName: 'Toast', enabled: true, changedAt: null },
    ]);
    expect(screen.getByText('Square')).toBeInTheDocument();
    expect(screen.getByText(/Its checks are turned away until it is/)).toBeInTheDocument();
    expect(screen.queryByText('Toast')).not.toBeInTheDocument();
    expect(screen.queryByText(/No till is disconnected/)).not.toBeInTheDocument();
  });

  it('a failed read is an alert, never "every till is taken"', () => {
    draw(null, 'the gateway did not answer');
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read — the gateway did not answer/);
    expect(screen.queryByText(/No till is disconnected/)).not.toBeInTheDocument();
  });
});
