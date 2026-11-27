/**
 * AGAINST YOUR PAPERS (r109 g5). A vendor's statement, row by row, against the
 * house's own papers of the same number. Fixed 44px rows, no motion: the list
 * arrives as a text swap in the space its first row reserved (MOTIONS.md).
 * Information only: payments are not read and nothing is marked paid.
 */
import { useQuery } from '@tanstack/react-query';
import { documentsApi, type StatementTieoutRow } from '../../../services/api/documents';
import { EM, fmtDate, fmtMoney, serverMessage } from './rc2-format';

const ROW = { minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--paper-2, #EAE4D8)', fontSize: 12.5 } as const;

const KIND = { invoice: 'Invoice', credit: 'Credit' } as const;

export function verdictWords(r: StatementTieoutRow, currency: string | null): string {
  switch (r.verdict) {
    case 'checked_same':
      return 'Checked, same amount';
    case 'on_file_not_checked':
      return 'On file, not checked yet';
    case 'amount_differs': {
      const d = Number(r.differsBy ?? 0);
      return `Amount differs by ${fmtMoney(Math.abs(d), currency)}; the statement says ${d > 0 ? 'more' : 'less'}`;
    }
    case 'never_received':
      return 'Never received. Its goods may sit on an estimate cost';
    default:
      return `Not compared: ${r.reason ?? 'no reason was given'}`;
  }
}

export function ReceiptsStatementTieout({ docId }: { docId: string }) {
  const q = useQuery({
    queryKey: ['receipts-next', 'statement-tieout', docId],
    queryFn: () => documentsApi.statementTieout(docId),
    staleTime: 30_000,
    retry: false,
  });
  if (q.isPending)
    return (
      <p role="status" style={{ ...ROW, borderTop: 'none', margin: 0 }}>
        Reading this statement against your papers.
      </p>
    );
  if (q.isError)
    return (
      <p role="status" style={{ ...ROW, borderTop: 'none', margin: 0 }}>
        {serverMessage(q.error, 'This statement could not be tied out against your papers.')}
      </p>
    );
  const t = q.data;
  const head = (n: string | null, d: string | null, k: 'invoice' | 'credit') =>
    `${KIND[k]} ${n ?? EM}${d ? `, ${fmtDate(d)}` : ''}`;
  return (
    <div data-testid="statement-tieout">
      {t.rows.length === 0 ? (
        <p style={{ ...ROW, borderTop: 'none', margin: 0 }}>This statement listed no invoice or credit that could be read.</p>
      ) : (
        <ul aria-label="Against your papers" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {t.rows.map((r, i) => (
            <li key={`${r.kind}-${r.docNumber ?? ''}-${i}`} data-verdict={r.verdict} style={ROW}>
              <span style={{ flex: '1 1 auto' }}>
                {head(r.docNumber, r.docDate, r.kind)}
                {r.amount != null ? ` · ${fmtMoney(Number(r.amount), t.currency)}` : ''}
              </span>
              <span style={{ flex: '0 1 60%', textAlign: 'right' }}>{verdictWords(r, t.currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {t.notOnStatement.length > 0 && (
        <ul aria-label="On file, not on this statement" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {t.notOnStatement.map((p) => (
            <li key={p.id} style={ROW}>
              <span style={{ flex: '1 1 auto' }}>
                {head(p.docNumber, p.docDate, p.kind)}
                {p.total != null ? ` · ${fmtMoney(Number(p.total), t.currency)}` : ''}
              </span>
              <span style={{ flex: '0 1 60%', textAlign: 'right' }}>On file, not on this statement</span>
            </li>
          ))}
        </ul>
      )}
      {t.paymentsIgnored > 0 && (
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
          {t.paymentsIgnored === 1 ? 'One payment' : `${t.paymentsIgnored} payments`} on the statement {t.paymentsIgnored === 1 ? 'is' : 'are'} not
          read here, and nothing is marked paid.
        </p>
      )}
    </div>
  );
}
