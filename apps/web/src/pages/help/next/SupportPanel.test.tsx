/**
 * SupportPanel — "Write to support with these readings?"
 *
 * Covers what `r4-lanes.json`'s round-2 verifier flagged as missing: a
 * centred (ADR 0112 `Panel`) dialog that shows the message before any mail
 * app opens, closes with a word, and — the part that had NO coverage at
 * all before this file — still says something honest when no support
 * address is configured, instead of the trigger just disappearing.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SupportPanel } from './SupportPanel';
import type { EmailChannel } from './hp-support';

const CONFIGURED: EmailChannel = { state: 'configured', address: 'support@mudavym.com' };
const UNCONFIGURED: EmailChannel = { state: 'unconfigured' };
const UNUSABLE: EmailChannel = { state: 'unusable', raw: 'support at mudavym dot com', why: 'not a single mail address' };

const BLOCK = 'Mudavym — what support will need\nHouse: Sim Meyhouse\nWritten: 2026-09-19T00:00:00.000Z';
const MAILTO = 'mailto:support@mudavym.com?subject=Mudavym%20support%20%E2%80%94%20Sim%20Meyhouse&body=...';

function renderPanel(over: Partial<React.ComponentProps<typeof SupportPanel>> = {}) {
  const onClose = vi.fn();
  const onCopy = vi.fn();
  render(
    <SupportPanel
      open
      onClose={onClose}
      support={CONFIGURED}
      houseName="Sim Meyhouse"
      block={BLOCK}
      mailto={MAILTO}
      copied={false}
      onCopy={onCopy}
      {...over}
    />,
  );
  return { onClose, onCopy };
}

describe('SupportPanel — closed', () => {
  it('renders nothing when open is false', () => {
    render(
      <SupportPanel
        open={false}
        onClose={vi.fn()}
        support={CONFIGURED}
        block={BLOCK}
        mailto={MAILTO}
        copied={false}
        onCopy={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('SupportPanel — configured, the shape ADR 0112 and the sketch both name', () => {
  it('is a centred dialog carrying the exact ask, the to/subject, and the diagnostics — before any mail app opens', () => {
    renderPanel();
    const dialog = screen.getByRole('dialog', { name: 'Write to support with these readings' });
    expect(dialog).toHaveTextContent('Write to support with these readings?');
    expect(dialog).toHaveTextContent('support@mudavym.com');
    expect(dialog).toHaveTextContent('Mudavym support — Sim Meyhouse');
    expect(dialog).toHaveTextContent('House: Sim Meyhouse');
  });

  it('"Open my mail" is the real mailto link, and closes the panel once clicked', () => {
    const { onClose } = renderPanel();
    const open = screen.getByRole('link', { name: 'Open my mail' });
    expect(open).toHaveAttribute('href', MAILTO);
    fireEvent.click(open);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Copy instead" calls the copy handler, and reflects the copied state the caller hands it', () => {
    const { onCopy } = renderPanel({ copied: false });
    fireEvent.click(screen.getByRole('button', { name: 'Copy instead' }));
    expect(onCopy).toHaveBeenCalledTimes(1);

    renderPanel({ copied: true });
    expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument();
  });

  it('closes with a WORD, never an X — the control literally reads "Not now"', () => {
    const { onClose } = renderPanel();
    const closeBtn = screen.getByRole('button', { name: 'Not now' });
    expect(closeBtn.textContent?.trim()).toBe('Not now');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SupportPanel — the unconfigured-address state (no coverage existed before this file)', () => {
  it('says plainly that no address was configured, instead of the panel — or its trigger — just disappearing', () => {
    renderPanel({ support: UNCONFIGURED, mailto: null });
    const dialog = screen.getByRole('dialog', { name: 'Write to support with these readings' });
    expect(dialog).toHaveTextContent('No support address was configured for this build.');
    expect(dialog).toHaveTextContent('There is no default one');
  });

  it('has no "Open my mail" control when there is no address to mail — copying is still offered', () => {
    renderPanel({ support: UNCONFIGURED, mailto: null });
    expect(screen.queryByRole('link', { name: 'Open my mail' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy instead' })).toBeInTheDocument();
  });

  it('still shows the diagnostics block, so there is something to copy even with nowhere built in to send it', () => {
    renderPanel({ support: UNCONFIGURED, mailto: null });
    expect(screen.getByRole('dialog')).toHaveTextContent('House: Sim Meyhouse');
  });
});

describe('SupportPanel — the unusable-address state', () => {
  it('prints what it read and why it cannot be mailed, rather than mailing it anyway', () => {
    renderPanel({ support: UNUSABLE, mailto: null });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('not a single mail address');
    expect(dialog).toHaveTextContent('support at mudavym dot com');
    expect(screen.queryByRole('link', { name: 'Open my mail' })).not.toBeInTheDocument();
  });
});
