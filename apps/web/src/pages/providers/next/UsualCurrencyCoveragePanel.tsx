/**
 * "Usual currencies stated" — the providers page's prompt panel.
 *
 * THE FOUNDER, 2026-09-06, batch 66, verbatim: *"Add the prompt panel"* — "One
 * panel on the providers page (and the orders sheet's empty field) saying how
 * many vendors have stated a usual currency and linking to the ones that have
 * not. No provenance lie."
 *
 * WHAT IT IS FOR. Batch 65 stopped pre-filling an order's currency from
 * anything but the vendor's own stated one, which is right — a house-derived
 * value submitted untouched would be recorded as `currency_source = 'typed'`,
 * a lie in the one column built to tell a decision from a default. The cost,
 * named in that batch's own report, is that with no vendor profile filled in
 * every new order records no currency, so `procurement_orders.currency` stays
 * NULL, the order rung of `filingCurrency` never fires, and the chain falls
 * back to the house exactly as before. This panel is the thing that asks.
 *
 * IT PRE-FILLS NOTHING AND WRITES NOTHING. It counts, it names, it links. The
 * repair is a person stating a currency on a vendor's profile.
 *
 * NEVER AN EMPTY PANEL. Zero stated is a sentence ("None of your 14 vendors has
 * stated a usual currency"), because a panel that renders nothing when the
 * answer is "none of them" is indistinguishable from one that failed to load.
 * A FAILED READ prints the failure and says it is not a coverage of zero.
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '../../../services/api/client';
import { MONO, SANS } from './pv-format';

export interface UsualCurrencyCoverage {
  stated: number;
  total: number;
  unstated: { id: string; name: string; recorded: string | null }[];
  sentence: string;
}

function serverMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data
    ?.message;
  return typeof msg === 'string' && msg.trim() ? msg : fallback;
}

const shell: React.CSSProperties = {
  fontFamily: SANS,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-1, #F3EFE6)',
  borderRadius: 12,
  padding: '12px 14px',
  margin: '0 0 12px',
};

const heading = (
  <h2
    style={{
      fontFamily: MONO,
      fontSize: 9.5,
      fontWeight: 600,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'var(--ink-3, #7C7365)',
      margin: '0 0 6px',
    }}
  >
    Usual currencies stated
  </h2>
);

export function UsualCurrencyCoveragePanel({
  knownIds,
  onOpenVendor,
}: {
  /** The vendors the grid actually holds — the ones a click here can open. */
  knownIds: Set<string>;
  onOpenVendor: (providerId: string) => void;
}) {
  const coverage = useQuery({
    queryKey: ['vendor-usual-currency-coverage'],
    queryFn: async () => {
      const { data } = await apiClient.get<UsualCurrencyCoverage>(
        '/providers/usual-currency/coverage',
      );
      return data;
    },
  });

  if (coverage.isError)
    return (
      <section data-testid="usual-currency-coverage" style={shell}>
        {heading}
        <p
          role="alert"
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: 'var(--alarm, #A33A2B)',
            display: 'flex',
            gap: 6,
            alignItems: 'flex-start',
            margin: 0,
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
          <span>
            {serverMessage(
              coverage.error,
              'How many vendors have stated a usual currency could not be read.',
            )}{' '}
            That is a failed read, not a house whose vendors have stated none —
            nothing here says how many have.
          </span>
        </p>
      </section>
    );

  if (coverage.isLoading)
    return (
      <section data-testid="usual-currency-coverage" style={shell}>
        {heading}
        <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
          Counting how many vendors have stated a usual currency…
        </p>
      </section>
    );

  const data = coverage.data;
  const unstated = data?.unstated ?? [];

  return (
    <section data-testid="usual-currency-coverage" style={shell}>
      {heading}
      <p
        data-testid="usual-currency-coverage-sentence"
        style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}
      >
        {data?.sentence ?? ''}
      </p>

      {unstated.length > 0 && (
        <ul
          data-testid="usual-currency-unstated"
          style={{
            listStyle: 'none',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            padding: 0,
            margin: '8px 0 0',
          }}
        >
          {unstated.map((v) => {
            const label = v.recorded
              ? `${v.name} — recorded as ${v.recorded}, which is not a currency`
              : v.name;
            // A vendor the grid does not hold cannot be opened from here, and a
            // button that silently does nothing is worse than plain text that
            // says why.
            if (!knownIds.has(v.id))
              return (
                <li
                  key={v.id}
                  style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}
                >
                  {label} (not in the list below)
                </li>
              );
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => onOpenVendor(v.id)}
                  style={{
                    fontFamily: SANS,
                    fontSize: 11.5,
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                    background: 'transparent',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default UsualCurrencyCoveragePanel;
