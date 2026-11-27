/** r109 g2: how much of the till's drinks cost is exact, one strip above the lanes. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SaleCostCoverage } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ coverage: vi.fn() }));
vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return { ...mod, documentsApi: { ...mod.documentsApi, saleCostCoverage: api.coverage } };
});
import { COVERAGE_ROW, ReceiptsCoverage, coverageSentence } from './ReceiptsCoverage';
import { canSeeCreditLedger } from './ReceiptsNext';

const cov = (over: Partial<SaleCostCoverage> = {}): SaleCostCoverage => ({
  days: 7, currency: 'USD', food: 'Food costs are not drawn yet.',
  total: '1240.5', checked: '1010.2', partial: '0.00', estimate: '230.3', other: '0.00',
  sales: 120, notKept: 0, voided: 0,
  estimateDeliveries: [
    { orderId: 'o1', vendor: 'Vinoteca', deliveredAt: '2026-11-24T09:00:00Z', cost: '150.3', sales: 40, paper: { state: 'in_review', documentId: 'd1' } },
    { orderId: 'o2', vendor: 'Anfora', deliveredAt: null, cost: '60', sales: 20, paper: { state: 'none', documentId: null } },
    { orderId: null, vendor: null, deliveredAt: null, cost: '20', sales: 5, paper: { state: 'none', documentId: null } },
  ],
  ...over,
});
const show = (onOpen = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReceiptsCoverage onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
};

describe('ReceiptsCoverage (r109 g2)', () => {
  it('says the week in one sentence: checked papers, then the estimate and its deliveries', async () => {
    api.coverage.mockResolvedValueOnce(cov());
    show();
    expect(
      await screen.findByText(
        "Last 7 days the till's drinks cost $1,240.50: $1,010.20 from checked papers, $230.30 on an estimate from 3 deliveries.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Food costs are not drawn yet.')).toBeTruthy();
  });

  it('keeps partly checked as its own figure and says a cost not kept is not in it', () => {
    expect(coverageSentence(cov({ partial: '120', notKept: 3, estimate: '0', estimateDeliveries: [] }))).toBe(
      "Last 7 days the till's drinks cost $1,240.50: $1,010.20 from checked papers, $120.00 on papers partly checked. 3 sales kept no cost and are not in it.",
    );
  });

  it('opens a delivery that has a paper, and says when there is none yet', async () => {
    api.coverage.mockResolvedValueOnce(cov());
    const onOpen = show();
    const toggle = await screen.findByRole('button', { name: 'See the 3 deliveries on an estimate' });
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Vinoteca · .* · \$150\.30 · paper in review, open it$/ }));
    expect(onOpen).toHaveBeenCalledWith('d1');
    expect(screen.getByText('Anfora · $60.00 · no paper yet')).toBeTruthy();
    expect(screen.getByText('No delivery named · $20.00 · no paper yet')).toBeTruthy();
    for (const li of screen.getByRole('list').querySelectorAll('li > *'))
      expect((li as HTMLElement).style.minHeight).toBe(`${COVERAGE_ROW}px`);
  });

  it('holds its rows while it reads, and its figures never tween', () => {
    api.coverage.mockReturnValueOnce(new Promise(() => {}));
    show();
    const box = screen.getByTestId('sale-cost-coverage');
    expect(box.getAttribute('aria-busy')).toBe('true');
    const [sentence, controls] = Array.from(box.children) as HTMLElement[];
    expect(sentence.style.minHeight).toBe(`${COVERAGE_ROW}px`);
    expect(controls.style.minHeight).toBe(`${COVERAGE_ROW}px`);
    expect(screen.getByText('Food costs are not drawn yet.')).toBeTruthy();
    for (const el of box.querySelectorAll('*')) {
      expect((el as HTMLElement).style.transition).toBe('');
      expect((el as HTMLElement).style.animation).toBe('');
    }
  });

  it("says the server's two-currency refusal in its words", async () => {
    api.coverage.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        response: { status: 409, data: { message: "The till's drinks cost for the last 7 days was read from deliveries in USD and TRY, and nothing here converts one into the other, so no total is shown." } },
      }),
    );
    show();
    expect(await screen.findByText(/USD and TRY, and nothing here converts one into the other/)).toBeTruthy();
  });

  it('asks for 30 days when asked', async () => {
    api.coverage.mockResolvedValue(cov());
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Last 30 days' }));
    expect(api.coverage).toHaveBeenLastCalledWith(30);
    api.coverage.mockReset();
  });

  it('is mounted for owners and managers only: staff send no request', () => {
    expect(canSeeCreditLedger('owner', null)).toBe(true);
    expect(canSeeCreditLedger('manager', null)).toBe(true);
    expect(canSeeCreditLedger('staff', 'owner')).toBe(false);
  });
});
