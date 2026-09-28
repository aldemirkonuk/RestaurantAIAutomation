/**
 * Permission-denied and "what did not happen".
 *
 * Finder B, D24 (measured from `census.json`): four of sixty live rows draw a
 * failure state and NONE draws permission-denied — the largest single gap in
 * the census. D25: three vocabularies for "why not" already exist. These two
 * components are the one shape, so a page never has to invent it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { Panel, Sheet, resetLabelWarnings, resetSheetWidth } from './Sheet';
import { Denied, Refused } from './Denied';

beforeEach(() => {
  resetLabelWarnings();
  resetSheetWidth();
});

describe('you may look, not change', () => {
  it('names the authority and the person to ask, and never hides the record', () => {
    render(
      <div className="mudavym">
        <Denied who="Aylin" grant="release payments" verb="release it" />
      </div>,
    );
    expect(
      screen.getByText(
        'You can see this, but only an owner or a manager may release it. Ask Aylin to grant it.',
      ),
    ).toBeInTheDocument();
    // F12's third amendment: a grant is a security change, and it is told.
    expect(screen.getByText(/Every owner is told when they do/)).toBeInTheDocument();
  });

  it('promises no grant nobody named', () => {
    render(
      <div className="mudavym">
        <Denied who="Aylin" />
      </div>,
    );
    expect(screen.getByText(/Ask Aylin to grant it/)).toBeInTheDocument();
    expect(screen.queryByText(/Every owner is told/)).toBeNull();
  });

  it('replaces the action row on a Panel — never a dead control beside a refusal', () => {
    render(
      <div className="mudavym">
        <Panel
          open
          onClose={() => {}}
          title="Release the payment"
          label="This asks for the amount to release. Sealing moves the money; leaving writes nothing."
          footer={<button type="button">Hold to release</button>}
          denied={{ who: 'Aylin', grant: 'release payments' }}
        >
          <p>₺4,280 to Selim Şarap</p>
        </Panel>
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    // Every `data-*` hook lives on the portalled root, never on the dialog node.
    expect(document.querySelector('.mdv-ovl')).toHaveAttribute('data-denied', 'true');
    expect(within(dialog).queryByRole('button', { name: 'Hold to release' })).toBeNull();
    expect(within(dialog).getByText(/Ask Aylin to grant it/)).toBeInTheDocument();
    // Looking is exactly what is still allowed.
    expect(within(dialog).getByText('₺4,280 to Selim Şarap')).toBeInTheDocument();
  });

  it('does the same on a Sheet, and leaves an undenied surface alone', () => {
    const { rerender } = render(
      <div className="mudavym">
        <Sheet
          open
          onClose={() => {}}
          title="Vendor answers"
          label="This shows what the vendor said. Nothing here writes; leaving costs nothing."
          footer={<button type="button">Accept</button>}
          denied={{ who: 'Aylin' }}
        >
          <p>body</p>
        </Sheet>
      </div>,
    );
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();

    rerender(
      <div className="mudavym">
        <Sheet
          open
          onClose={() => {}}
          title="Vendor answers"
          label="This shows what the vendor said. Nothing here writes; leaving costs nothing."
          footer={<button type="button">Accept</button>}
        >
          <p>body</p>
        </Sheet>
      </div>,
    );
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(document.querySelector('.mdv-ovl')).not.toHaveAttribute('data-denied');
  });
});

describe('what did not happen', () => {
  it('says the thing, the verb, and that nothing moved', () => {
    render(
      <div className="mudavym">
        <Refused
          thing="The order"
          verb="sent"
          because="The vendor's mailbox refused the message (550)."
          next="Check the address on the vendor's record and send it again."
        />
      </div>,
    );
    const said = screen.getByRole('alert');
    expect(said).toHaveTextContent('The order was not sent. It is unchanged.');
    // The server's own sentence, verbatim.
    expect(within(said).getByText(/refused the message \(550\)/)).toBeInTheDocument();
    expect(within(said).getByText(/send it again/)).toBeInTheDocument();
  });

  it('still answers the reader’s real question with nothing else to say', () => {
    render(
      <div className="mudavym">
        <Refused thing="The count" verb="written" />
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The count was not written. It is unchanged.',
    );
  });
});
