/**
 * The two surfaces the founder's decision needs, tested apart from the page
 * because they are mounted elsewhere: `CellarRegistersStep` in onboarding,
 * `CellarRegistersControl` in Settings.
 *
 * The founder's shape, asserted rather than described:
 *   infer → confirm at onboarding → switch by hand later, with an ask (never a
 *   modal) when a register is switched on that the books know nothing about.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CellarRegistersControl from './CellarRegistersControl';
import CellarRegistersStep from './CellarRegistersStep';
import RegisterNotice from './NeedsItemsNotice';
import type { RegisterId } from './cellar-format';
import type { CellarRegistersVM, RegisterReadoutVM } from './useCellarNextData';

const ALL: RegisterId[] = [
  'wines', 'beer', 'whiskey', 'cocktails', 'spirits', 'non_alcoholic', 'soft_drinks',
];

function reg(id: RegisterId, over: Partial<RegisterReadoutVM> = {}): RegisterReadoutVM {
  return {
    id,
    carried: false,
    decidedBy: 'inferred',
    confidence: 'none',
    basis: `Nothing in this cellar and nothing on this menu names ${id}.`,
    evidence: { inventoryRows: 0, menuRows: 0, catalogueRows: 0, nameOnly: false },
    needsEvidence: false,
    strandedItems: 0,
    ...over,
  };
}

const OK = { readable: true, reason: null, rows: 0 };

function readout(over: Partial<CellarRegistersVM> = {}): CellarRegistersVM {
  const registers = over.registers ?? ALL.map((id) => reg(id));
  return {
    restaurantId: 'r1',
    registers,
    carried: registers.filter((r) => r.carried === true).map((r) => r.id),
    decidedBy: 'inferred',
    awaitingConfirmation: true,
    needsEvidence: registers.filter((r) => r.needsEvidence).map((r) => r.id),
    stranded: registers
      .filter((r) => r.carried === false && (r.strandedItems ?? 0) > 0)
      .map((r) => r.id),
    sources: { answers: OK, inventory: OK, menu: OK, cocktails: OK, catalogue: OK },
    unmappedKinds: {},
    unmappedCatalogueTypes: {},
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe('CellarRegistersStep — infer, then confirm', () => {
  const proposed = readout({
    registers: [
      reg('wines', {
        carried: true,
        confidence: 'certain',
        basis: '50 bottles in this cellar are classified as wines by the library’s own classifier.',
        evidence: { inventoryRows: 50, menuRows: 0, catalogueRows: 442, nameOnly: false },
      }),
      reg('beer'),
      reg('whiskey'),
      reg('cocktails'),
      reg('spirits'),
      reg('non_alcoholic'),
      reg('soft_drinks'),
    ],
  });

  it('shows the machine’s proposal with the evidence behind every line', () => {
    render(
      <CellarRegistersStep readout={proposed} loading={false} error={null} onConfirm={vi.fn()} />,
    );
    expect(screen.getByLabelText('Wines register')).toBeChecked();
    expect(screen.getByLabelText('Beer register')).not.toBeChecked();
    expect(screen.getByText(/classified as wines by the library/)).toBeInTheDocument();
    // the evidence line: cellar / menu / catalogue, each figure labelled
    const wines = screen.getByLabelText('Wines register').closest('li')!;
    expect(wines).toHaveTextContent(/50\s*in the cellar/);
    expect(wines).toHaveTextContent(/442\s*in the shared catalogue/);
  });

  it('confirms ALL SEVEN, including the ones set to no', () => {
    // A register nobody answered is not a register answered "no". After this
    // step there are no unanswered registers left.
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CellarRegistersStep readout={proposed} loading={false} error={null} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByTestId('registers-step-confirm'));
    const sent = onConfirm.mock.calls[0][0] as { id: RegisterId; carried: boolean }[];
    expect(sent).toHaveLength(7);
    expect(sent.find((r) => r.id === 'wines')!.carried).toBe(true);
    expect(sent.find((r) => r.id === 'beer')!.carried).toBe(false);
  });

  it('marks a line the house changed, and sends the change, not the proposal', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CellarRegistersStep readout={proposed} loading={false} error={null} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByLabelText('Whiskey register'));
    expect(screen.getByText('changed from what was read')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('registers-step-confirm'));
    const sent = onConfirm.mock.calls[0][0] as { id: RegisterId; carried: boolean }[];
    expect(sent.find((r) => r.id === 'whiskey')!.carried).toBe(true);
  });

  it('asks for the rows, undismissably, when the house turns on what the books cannot see', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <CellarRegistersStep readout={proposed} loading={false} error={null} onConfirm={onConfirm} />,
    );
    expect(screen.queryByTestId('needs-items-whiskey')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Whiskey register'));
    const notice = screen.getByTestId('needs-items-whiskey');
    expect(notice).toHaveTextContent(/Put your whiskies on the menu/);
    // never a modal, and nothing to dismiss during onboarding
    expect(within(notice).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses to propose anything for a house with no books, and says so', () => {
    const empty = readout({
      registers: ALL.map((id) => reg(id, { carried: null, decidedBy: 'unknown', confidence: 'unknown' })),
      decidedBy: 'unknown',
    });
    render(<CellarRegistersStep readout={empty} loading={false} error={null} onConfirm={vi.fn()} />);
    expect(screen.getByText(/nothing to read this off/i)).toBeInTheDocument();
    // Nothing is proposed: seven boxes, none ticked. An unknown is not a "no",
    // and a tick here would become the house's own word after one click.
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(ALL.length);
    expect(boxes.every((c) => !c.checked)).toBe(true);
  });

  it('says nothing was recorded when the write fails', () => {
    render(
      <CellarRegistersStep
        readout={proposed}
        loading={false}
        error={null}
        onConfirm={vi.fn()}
        saveError="HTTP 500"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was recorded: HTTP 500/);
  });

  it('proposes nothing at all when the books could not be read', () => {
    render(
      <CellarRegistersStep readout={null} loading={false} error="ECONNREFUSED" onConfirm={vi.fn()} />,
    );
    expect(screen.getByTestId('registers-step-error')).toHaveTextContent(
      /could not be read \(ECONNREFUSED\).*Nothing was assumed and nothing was saved/s,
    );
  });
});

describe('CellarRegistersControl — the manual switch', () => {
  const confirmed = readout({
    registers: [
      reg('wines', { carried: true, decidedBy: 'confirmed', confidence: 'certain' }),
      reg('beer', { carried: false, decidedBy: 'confirmed', confidence: 'certain' }),
      reg('whiskey'), reg('cocktails'), reg('spirits'), reg('non_alcoholic'), reg('soft_drinks'),
    ],
    decidedBy: 'confirmed',
    awaitingConfirmation: false,
  });

  it('shows all seven with their evidence, whether carried or not', () => {
    render(
      <CellarRegistersControl readout={confirmed} loading={false} error={null} onChange={vi.fn()} />,
    );
    expect(screen.getAllByRole('switch')).toHaveLength(7);
    expect(screen.getByLabelText('Wines register')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Beer register')).toHaveAttribute('aria-checked', 'false');
  });

  it('writes a manual switch as `manual`, one register at a time', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(
      <CellarRegistersControl readout={confirmed} loading={false} error={null} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText('Whiskey register'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith([{ id: 'whiskey', carried: true }], 'manual');
  });

  it('shows the ask inline — not a modal — for a register on with nothing behind it', () => {
    const withManual = readout({
      registers: [
        reg('wines', { carried: true, decidedBy: 'confirmed', confidence: 'certain' }),
        reg('whiskey', { carried: true, decidedBy: 'manual', confidence: 'certain', needsEvidence: true }),
        reg('beer'), reg('cocktails'), reg('spirits'), reg('non_alcoholic'), reg('soft_drinks'),
      ],
      decidedBy: 'mixed',
    });
    render(
      <CellarRegistersControl readout={withManual} loading={false} error={null} onChange={vi.fn()} />,
    );
    const notice = screen.getByTestId('needs-items-whiskey');
    expect(notice).toHaveAttribute('data-needs-items', 'inline');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // dismissing hides the line, never the register
    fireEvent.click(within(notice).getByRole('button', { name: /Dismiss/ }));
    expect(screen.queryByTestId('needs-items-whiskey')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Whiskey register')).toHaveAttribute('aria-checked', 'true');
  });

  it('can be switched to the interrupt frame with one prop, and is still not a modal', () => {
    const withManual = readout({
      registers: [
        reg('whiskey', { carried: true, decidedBy: 'manual', confidence: 'certain', needsEvidence: true }),
        ...ALL.filter((id) => id !== 'whiskey').map((id) => reg(id)),
      ],
    });
    render(
      <CellarRegistersControl
        readout={withManual}
        loading={false}
        error={null}
        onChange={vi.fn()}
        noticeVariant="interrupt"
      />,
    );
    expect(screen.getByTestId('needs-items-whiskey')).toHaveAttribute(
      'data-needs-items',
      'interrupt',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an unreadable readout switches nothing off — it says it is unread', () => {
    render(
      <CellarRegistersControl readout={null} loading={false} error="HTTP 500" onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('registers-control-error')).toHaveTextContent(
      /could not be read \(HTTP 500\).*unread.*No register was changed/s,
    );
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('warns when the house’s own answers are unreadable but the books are not', () => {
    const noAnswers = readout({
      sources: {
        answers: { readable: false, reason: 'migration not applied', rows: null },
        inventory: OK, menu: OK, cocktails: OK, catalogue: OK,
      },
    });
    render(
      <CellarRegistersControl readout={noAnswers} loading={false} error={null} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      /could not be read \(migration not applied\).*not what anyone has said/s,
    );
  });

  it('says what did not save when the write is refused', () => {
    render(
      <CellarRegistersControl
        readout={confirmed}
        loading={false}
        error={null}
        onChange={vi.fn()}
        saveError="the restaurant_cellar_registers table is not on this database yet"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /The change was not saved.*shows what the server holds, not what was clicked/s,
    );
  });
});

/**
 * The three amendments from the founder's backtest of this notice
 * (`backtest-register-prompt-2026-09-03.md` §6). The verdict was AMEND, not
 * reject: inline stands in all four scenarios; these are the three things it
 * has to do that the first build did not.
 */
describe('the register notices — the backtest amendments', () => {
  it('1. the ask is register-aware, and does not ask for something impossible', () => {
    // Telling a house to add a keg to /inventory, which is keyed on the wine
    // library and cannot hold one, is how a notice teaches people to stop
    // reading it — the same futility that killed the legacy "Reorder" alert.
    const r = readout({
      registers: [
        reg('beer', { carried: true, decidedBy: 'manual', confidence: 'certain', needsEvidence: true }),
        ...ALL.filter((id) => id !== 'beer').map((id) => reg(id)),
      ],
    });
    render(<CellarRegistersControl readout={r} loading={false} error={null} onChange={vi.fn()} />);
    const notice = screen.getByTestId('needs-items-beer');
    expect(notice).toHaveTextContent(/Put your beers on the menu/);
    expect(notice).toHaveTextContent(/cannot hold a keg yet/);
    expect(notice).not.toHaveTextContent(/Add your beers to \/inventory/);
  });

  it('1b. cocktails say the recipes cannot be recorded at all yet', () => {
    const r = readout({
      registers: [
        reg('cocktails', { carried: true, decidedBy: 'manual', confidence: 'certain', needsEvidence: true }),
        ...ALL.filter((id) => id !== 'cocktails').map((id) => reg(id)),
      ],
    });
    render(<CellarRegistersControl readout={r} loading={false} error={null} onChange={vi.fn()} />);
    expect(screen.getByTestId('needs-items-cocktails')).toHaveTextContent(
      /cocktail_ingredients was created empty/,
    );
  });

  it('2. several registers at once collapse into ONE notice, never a stack', () => {
    // Every from-scratch onboarding produces this; N near-identical panels is
    // how the notice stops being read.
    const on = (id: RegisterId) =>
      reg(id, { carried: true, decidedBy: 'confirmed', confidence: 'certain', needsEvidence: true });
    const r = readout({
      registers: [on('beer'), on('whiskey'), on('cocktails'), ...(['wines', 'spirits', 'non_alcoholic', 'soft_drinks'] as RegisterId[]).map((id) => reg(id))],
    });
    render(
      <RegisterNotice registers={r.needsEvidence} />,
    );
    expect(screen.getByTestId('needs-items-many')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-items-beer')).not.toBeInTheDocument();
    expect(screen.getByTestId('needs-items-many')).toHaveTextContent(
      /Beer, Whiskey and Cocktails are on/,
    );
    // and each still gets its OWN sentence inside the one notice
    expect(screen.getByTestId('needs-items-many')).toHaveTextContent(/Beer: Put your beers/);
    expect(screen.getByTestId('needs-items-many')).toHaveTextContent(/Cocktails: Add the cocktail list/);
  });

  it('3. a register switched OFF with items still in it gets its own notice', () => {
    // The seasonal-menu case the founder's brief named and the first build had
    // no state for at all. Ending a season is a correct act — so this states
    // what is there and is never a confirm dialog on the toggle.
    const r = readout({
      registers: [
        reg('cocktails', { carried: false, decidedBy: 'manual', confidence: 'certain', strandedItems: 12 }),
        ...ALL.filter((id) => id !== 'cocktails').map((id) => reg(id)),
      ],
    });
    render(<CellarRegistersControl readout={r} loading={false} error={null} onChange={vi.fn()} />);
    const notice = screen.getByTestId('stranded-cocktails');
    expect(notice).toHaveTextContent(/Cocktails is off, and its items are still in the books/);
    expect(notice).toHaveTextContent(/12 cocktails are still in this house’s books/);
    expect(notice).toHaveTextContent(/Nothing was deleted/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('3b. the stranded notice aggregates too, and counts each register', () => {
    render(
      <RegisterNotice
        kind="stranded"
        registers={['whiskey', 'cocktails']}
        counts={{ whiskey: 12, cocktails: 3 }}
      />,
    );
    const notice = screen.getByTestId('stranded-many');
    expect(notice).toHaveTextContent(/Whiskey and Cocktails are off/);
    expect(notice).toHaveTextContent(/12 whiskies are still/);
    expect(notice).toHaveTextContent(/3 cocktails are still/);
  });

  it('dismissing one notice does not dismiss the other kind for the same register', () => {
    const { unmount } = render(
      <RegisterNotice registers={['whiskey']} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));
    unmount();
    render(<RegisterNotice kind="stranded" registers={['whiskey']} counts={{ whiskey: 12 }} />);
    expect(screen.getByTestId('stranded-whiskey')).toBeInTheDocument();
  });
});
