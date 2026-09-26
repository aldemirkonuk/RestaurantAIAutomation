/**
 * The rebuilt /providers sheet's edit path — the founder's answer (12) of
 * 2026-09-21: *"the rebuilt /providers vendor sheet gets an edit path (type
 * first) and cards show 'Not stated' when unset."* The gateway's own handling
 * of the type is proved in providers/business-type-not-stated.spec.ts; here:
 * the page offers "Not stated" as a real choice, never coerces a type, and
 * sends only what changed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../../../services/api/providers', () => ({
  updateProvider: (...a: unknown[]) => api.update(...a),
}));
vi.mock('../../../services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));
vi.mock('./NewVendorSheet', () => ({ BUSINESS_TYPES: ['Distributor', 'Importer', 'Wholesaler'] }));

import { VendorRecordEdit, businessTypeLabel } from './VendorRecordEdit';

const provider = (over: Record<string, unknown> = {}) =>
  ({ id: 'p1', name: 'Fikri Tarım', primaryBusinessType: undefined, ...over }) as never;

beforeEach(() => {
  api.update.mockReset();
});

describe('the vendor record, edited in the rebuilt sheet', () => {
  it('says "Not stated" for a vendor nobody typed — never blank, never a guessed type', () => {
    expect(businessTypeLabel(undefined)).toBe('Not stated');
    expect(businessTypeLabel('  ')).toBe('Not stated');
    expect(businessTypeLabel('Importer')).toBe('Importer');
    render(<VendorRecordEdit provider={provider()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('vendor-record')).toHaveTextContent('Not stated');
  });

  it('the type comes first, and choosing one sends only the type', async () => {
    api.update.mockResolvedValue({ id: 'p1', primaryBusinessType: 'Importer' });
    const onSaved = vi.fn();
    render(<VendorRecordEdit provider={provider()} onSaved={onSaved} />);
    fireEvent.click(screen.getByTestId('vendor-record-edit'));
    const legends = screen.getByTestId('vendor-record-form').querySelectorAll('legend, label[for]');
    expect(legends[0]).toHaveTextContent('Business type');
    fireEvent.click(screen.getByLabelText('Importer'));
    fireEvent.click(screen.getByTestId('vendor-record-save'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ id: 'p1', primaryBusinessType: 'Importer' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ primaryBusinessType: 'Importer' }));
  });

  it('choosing "Not stated" clears a type set earlier (sent as an empty string)', async () => {
    api.update.mockResolvedValue({ id: 'p1', primaryBusinessType: null });
    render(<VendorRecordEdit provider={provider({ primaryBusinessType: 'Distributor' })} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId('vendor-record-edit'));
    fireEvent.click(screen.getByLabelText('Not stated'));
    fireEvent.click(screen.getByTestId('vendor-record-save'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ id: 'p1', primaryBusinessType: '' }));
  });

  it("a type outside the three is listed as itself, and editing the name alone does not touch it", async () => {
    api.update.mockResolvedValue({ id: 'p1', name: 'Fikri Tarım Gıda' });
    render(<VendorRecordEdit provider={provider({ primaryBusinessType: 'winery_direct' })} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId('vendor-record-edit'));
    expect((screen.getByLabelText('winery_direct') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fikri Tarım Gıda' } });
    fireEvent.click(screen.getByTestId('vendor-record-save'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith({ id: 'p1', name: 'Fikri Tarım Gıda' }));
  });

  it('nothing to save until something changed; a failed save says nothing changed and keeps the choice', async () => {
    api.update.mockRejectedValue(new Error('forbidden'));
    render(<VendorRecordEdit provider={provider()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId('vendor-record-edit'));
    expect(screen.getByTestId('vendor-record-save')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Wholesaler'));
    fireEvent.click(screen.getByTestId('vendor-record-save'));
    await waitFor(() => expect(screen.getByTestId('vendor-record-problem')).toHaveTextContent(/Nothing was changed \(forbidden\)/));
    expect((screen.getByLabelText('Wholesaler') as HTMLInputElement).checked).toBe(true);
  });
});
