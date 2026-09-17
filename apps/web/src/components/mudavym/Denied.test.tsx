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

import { Panel, Sheet } from './Sheet';
import { resetLabelWarnings, resetSheetWidth } from './overlayState';
import { Denied, Refused } from './Denied';

beforeEach(() => {
  resetLabelWarnings();
  resetSheetWidth();
});

describe('you may look, not change', () => {
  /* ADR 0112 F12 amendment 2: authority is an owner, a manager OR a person an
     owner authorised, and only an owner grants. The first cut said "only an
     owner or a manager" and asked any `who` to grant it (judge B5). */
  it('states the authority rule whole and asks an owner, never a role', () => {
    render(
      <div className="mudavym">
        <Denied owner="Aylin" grant="release payments" verb="release it" />
      </div>,
    );
    expect(
      screen.getByText(
        'You can see this. An owner, a manager, or someone an owner has authorised may release it. Ask Aylin to grant it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/only an owner or a manager/)).toBeNull();
    // F12's third amendment: a grant is a security change, and it is told.
    expect(screen.getByText(/Every owner is told when they do/)).toBeInTheDocument();
  });

  it('promises no grant nobody named, and no second route the surface does not offer', () => {
    render(
      <div className="mudavym">
        <Denied owner="Aylin" />
      </div>,
    );
    expect(screen.getByText(/Ask Aylin to grant it/)).toBeInTheDocument();
    expect(screen.queryByText(/Every owner is told/)).toBeNull();
    expect(document.querySelector('.mdv-denied__otherwise')).toBeNull();
    expect(screen.queryByText(/second approv/i)).toBeNull();
  });

  it('draws the double-approval route only when the caller supplies it', () => {
    render(
      <div className="mudavym">
        <Denied
          owner="Aylin"
          verb="release it"
          otherwise={<button type="button">Ask Selim to approve it with you</button>}
        />
      </div>,
    );
    const note = screen.getByRole('note');
    expect(within(note).getByRole('button', { name: 'Ask Selim to approve it with you' })).toBeInTheDocument();
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
          denied={{ owner: 'Aylin', grant: 'release payments' }}
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
          denied={{ owner: 'Aylin' }}
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
  it('says the thing, the verb, and that nothing moved — when the server refused', () => {
    render(
      <div className="mudavym">
        <Refused
          thing="The order"
          verb="sent"
          outcome="refused"
          because="The vendor's mailbox refused the message (550)."
          next="Check the address on the vendor's record and send it again."
        />
      </div>,
    );
    const said = screen.getByRole('alert');
    expect(said).toHaveTextContent('What did not happen');
    expect(said).toHaveTextContent('The order was not sent. It is unchanged.');
    // The server's own sentence, verbatim.
    expect(within(said).getByText(/refused the message \(550\)/)).toBeInTheDocument();
    expect(within(said).getByText(/send it again/)).toBeInTheDocument();
  });

  it('still answers the reader’s real question with nothing else to say', () => {
    render(
      <div className="mudavym">
        <Refused thing="The count" verb="written" outcome="refused" />
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The count was not written. It is unchanged.',
    );
  });

  /* ADR 0020 (judge B5): after a timeout, a dropped connection or a 5xx nobody
     knows whether the write landed, so "It is unchanged" would be invented. */
  it('never claims "unchanged" when the outcome is unknown', () => {
    render(
      <div className="mudavym">
        <Refused
          thing="The order"
          verb="sent"
          outcome="unknown"
          because="The request timed out after 30 seconds."
        />
      </div>,
    );
    const said = screen.getByRole('alert');
    expect(said).toHaveTextContent('Not confirmed');
    expect(said).toHaveTextContent(
      'The order could not be confirmed as sent. Check the record before trying again.',
    );
    expect(said).not.toHaveTextContent(/unchanged/);
    expect(said).not.toHaveTextContent(/was not sent/);
    expect(said).toHaveAttribute('data-outcome', 'unknown');
  });
});
