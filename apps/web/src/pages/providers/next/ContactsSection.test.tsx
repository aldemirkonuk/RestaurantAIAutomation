/**
 * The numbers section: three states, and the write that turns one into another.
 * ADR 0121 P0 item 2.
 *
 * The four things that have to be true:
 *   1. A number recorded as a mobile reads as textable.
 *   2. A number carrying the column's own `main_line` default reads as NOT
 *      TEXTABLE and as nobody-has-said — the select shows the empty option, not
 *      "Main line", because the row is not evidence a manager chose it.
 *   3. A failed read is words, never an empty book.
 *   4. Choosing a type PATCHes the contact and the SERVER's answer replaces the
 *      row — the verdict is never computed here.
 *
 * `apiClient` is mocked, so these assert what this component does with the
 * gateway's answers, never that the gateway gives them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));

import { ContactsList, ContactsSection } from './ContactsSection';

const MOBILE = {
  id: 'c1',
  providerId: 'p1',
  name: 'Sheena Nelson',
  role: 'Sales',
  email: 's@example.com',
  phone: '+16505551234',
  isPrimary: true,
  phoneType: 'cell',
  reach: 'mobile' as const,
  phoneTypeStated: true,
  reachSays: 'Recorded as a mobile, so a text can reach it.',
};

const DEFAULTED = {
  ...MOBILE,
  id: 'c2',
  name: 'Front Desk',
  phone: '+16505559999',
  phoneType: 'main_line',
  reach: 'landline' as const,
  phoneTypeStated: false,
  reachSays:
    'This number is recorded as a main line, which is also what the book writes when nobody has said. Nothing is texted to it until somebody confirms the type on the vendor’s contact sheet.',
};

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
});

describe('ContactsSection', () => {
  it('shows a mobile as textable', async () => {
    api.get.mockResolvedValue({ data: [MOBILE] });
    render(<ContactsSection providerId="p1" providerName="Sheena Wines" />);
    expect(await screen.findByText('Textable')).toBeInTheDocument();
    expect(screen.getByText(/a text can reach it/)).toBeInTheDocument();
  });

  it('shows a row carrying the column default as NOT STATED, not as an answer', async () => {
    api.get.mockResolvedValue({ data: [DEFAULTED] });
    render(<ContactsSection providerId="p1" providerName="Sheena Wines" />);
    expect(await screen.findByText('Not stated')).toBeInTheDocument();

    // The select shows the empty option rather than "Main line": the stored
    // value is not evidence a person chose it, and pre-selecting it would make
    // the question look answered.
    const select = screen.getByLabelText('Type of line for Front Desk') as HTMLSelectElement;
    expect(select.value).toBe('');
  });

  it('a failed read is words, never an empty book', async () => {
    api.get.mockRejectedValue(new Error('timeout'));
    render(<ContactsSection providerId="p1" providerName="Sheena Wines" />);
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    // And it must NOT say the vendor has no contacts.
    expect(screen.queryByText(/No contacts are recorded/)).not.toBeInTheDocument();
  });

  it('an empty list says so, and is a different sentence', async () => {
    api.get.mockResolvedValue({ data: [] });
    render(<ContactsSection providerId="p1" providerName="Sheena Wines" />);
    expect(await screen.findByText(/No contacts are recorded/)).toBeInTheDocument();
  });

  it('choosing a type PATCHes the contact and takes the server’s verdict', async () => {
    api.get.mockResolvedValue({ data: [DEFAULTED] });
    api.patch.mockResolvedValue({
      data: {
        ...DEFAULTED,
        phoneType: 'cell',
        reach: 'mobile',
        phoneTypeStated: true,
        reachSays: 'Recorded as a mobile, so a text can reach it.',
      },
    });

    render(<ContactsSection providerId="p1" providerName="Sheena Wines" />);
    const select = await screen.findByLabelText('Type of line for Front Desk');
    fireEvent.change(select, { target: { value: 'cell' } });

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/providers/p1/contacts/c2', {
        phoneType: 'cell',
      }),
    );
    // The chip flips because the SERVER said so — the component computes no
    // verdict of its own.
    expect(await screen.findByText('Textable')).toBeInTheDocument();
  });

  it('a failed write says the book is unchanged', async () => {
    api.get.mockResolvedValue({ data: [DEFAULTED] });
    api.patch.mockRejectedValue(new Error('403'));
    render(<ContactsSection providerId="p1" providerName="Sheena Wines" />);
    const select = await screen.findByLabelText('Type of line for Front Desk');
    fireEvent.change(select, { target: { value: 'cell' } });
    const refusal = await screen.findByText(/still holds what it held/);
    // Announced, not only painted: a refused write is an alert.
    expect(refusal.getAttribute('role')).toBe('alert');
  });

  it('says a save is in flight, and disables only the row being written', () => {
    render(
      <ContactsList
        providerName="Sheena Wines"
        contacts={[MOBILE, DEFAULTED]}
        loading={false}
        error={null}
        saving="c2"
        saveError={null}
        onSetPhoneType={() => undefined}
        onReload={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(
      /Saving the type of line for Front Desk/,
    );
    expect(
      (screen.getByLabelText('Type of line for Front Desk') as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Type of line for Sheena Nelson') as HTMLSelectElement).disabled,
    ).toBe(false);
  });
});

/**
 * THE GROUND. This section renders inside a `.mudavym` Sheet, which is Warm
 * Charcoal (ADR 0138). Its first cut used four custom properties that no
 * stylesheet defines, so their PAPER fallbacks painted light pills and
 * 2.77:1 sentences on the dark sheet. This reads the component's own source
 * and the SHIPPED token file off disk: every `var(--…)` the component names
 * must be a token `styles/mudavym.css` declares. A green here proves the names
 * resolve; the pixels were checked in a browser (see the fix report).
 */
describe('ContactsSection draws only with house tokens', () => {
  const src = readFileSync(join(__dirname, 'ContactsSection.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, '../../../styles/mudavym.css'), 'utf8');

  it('names at least one token (never a vacuous pass)', () => {
    expect(src.match(/var\(--[a-z0-9-]+/g)?.length ?? 0).toBeGreaterThan(5);
  });

  it('every custom property it uses is declared by mudavym.css', () => {
    const used = new Set(
      [...src.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    const undeclared = [...used].filter(
      (name) => !new RegExp(`^\\s*${name}\\s*:`, 'm').test(css),
    );
    expect(undeclared).toEqual([]);
  });
});
