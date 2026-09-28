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

import { ContactsSection } from './ContactsSection';

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
    expect(await screen.findByText(/still holds what it held/)).toBeInTheDocument();
  });
});
