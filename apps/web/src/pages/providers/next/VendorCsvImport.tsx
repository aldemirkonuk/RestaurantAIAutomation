/**
 * Import a vendor list from a spreadsheet (F-685, S195). The file is read the
 * house's way and sorted before anything is sent: new vendors, vendors already
 * in the book (by name or email; left as they are), and lines that cannot be
 * used, each with its reason. Only the new ones go to
 * `POST /providers/bulk-import`, which an owner or a manager may call
 * (VEN-W30); the page offers this to them only.
 */

import { useRef, useState } from 'react';
import { useBulkImportProviders } from '../../../hooks/queries/useProviderQueries';
import { parseCsvRows, planVendorImport, readCsvFile, type VendorImportPlan } from '../../../lib/csvImport';
import { getErrorMessage } from '../../../services/api/client';
import { SANS } from './pv-format';

const line = { fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #3A332A)', margin: '4px 0' } as const;
const quiet = { ...line, color: 'var(--ink-4, #665D50)' } as const;

export function VendorCsvImport({
  house,
  existing,
  onClose,
}: {
  house: string;
  existing: { name: string; email?: string | null }[];
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<VendorImportPlan | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ imported: number; errors: string[] } | null>(null);
  const importer = useBulkImportProviders();

  const choose = async (file: File | undefined) => {
    setPlan(null);
    setOutcome(null);
    setReadProblem(null);
    if (!file) return;
    try {
      setPlan(planVendorImport(parseCsvRows(await readCsvFile(file)), existing));
    } catch (e) {
      setReadProblem(e instanceof Error ? e.message : 'The file could not be read, so nothing was sent.');
    }
  };

  const send = () => {
    if (!plan || plan.fresh.length === 0) return;
    importer.mutate(
      { restaurantId: house, providers: plan.fresh.map(({ line: _line, ...v }) => ({ ...v, restaurantId: house })) },
      {
        onSuccess: (r) => {
          setOutcome({ imported: r.imported, errors: r.errors });
          setPlan(null);
        },
        onError: (e) => setReadProblem(`No vendor was added — ${getErrorMessage(e)}`),
      },
    );
  };

  return (
    <section
      data-testid="vendor-csv-import"
      className="mb-4 rounded-xl px-4 py-3"
      style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)', maxWidth: 640 }}
    >
      <h2 style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, margin: 0 }}>Import vendors from a spreadsheet</h2>
      <p style={quiet}>
        A CSV with a Name column; Email, Phone, Address, Contact, Payment terms and Notes are read when present. Nothing
        is added until you confirm below.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="Vendor list (CSV)"
        onChange={(e) => void choose(e.target.files?.[0])}
        style={{ fontFamily: SANS, fontSize: 12.5, margin: '6px 0' }}
      />
      {readProblem && (
        <p role="alert" style={line}>
          {readProblem}
        </p>
      )}
      {plan?.fileProblem && (
        <p role="alert" style={line}>
          {plan.fileProblem}
        </p>
      )}
      {plan && !plan.fileProblem && (
        <div data-testid="vendor-import-preview">
          <p style={line}>
            <strong>{plan.fresh.length}</strong> new · <strong>{plan.duplicate.length}</strong> already in your vendors ·{' '}
            <strong>{plan.refused.length}</strong> cannot be used
          </p>
          <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
            {plan.fresh.map((v) => (
              <li key={`n${v.line}`} style={line}>
                {v.name}
                {v.email ? ` · ${v.email}` : ''}
              </li>
            ))}
            {[...plan.duplicate, ...plan.refused]
              .sort((a, b) => a.line - b.line)
              .map((r) => (
                <li key={`x${r.line}`} style={quiet}>
                  Line {r.line}, {r.label}: {r.reason}
                </li>
              ))}
          </ul>
        </div>
      )}
      {outcome && (
        <div role="status">
          <p style={line}>
            {outcome.imported} {outcome.imported === 1 ? 'vendor was' : 'vendors were'} added.
          </p>
          {outcome.errors.map((e) => (
            <p key={e} style={quiet}>
              Not added: {e}
            </p>
          ))}
        </div>
      )}
      <div className="flex gap-2" style={{ marginTop: 6 }}>
        <button
          type="button"
          onClick={send}
          disabled={!plan || plan.fresh.length === 0 || importer.isPending}
          style={{
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 600,
            padding: '7px 13px',
            borderRadius: 9,
            border: '1px solid var(--seal, #1A5E6B)',
            background: 'var(--seal, #1A5E6B)',
            color: 'var(--paper-0, #FBF8F1)',
            opacity: !plan || plan.fresh.length === 0 ? 0.5 : 1,
          }}
        >
          {importer.isPending
            ? 'Adding…'
            : `Add ${plan?.fresh.length ?? 0} ${plan?.fresh.length === 1 ? 'vendor' : 'vendors'}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ fontFamily: SANS, fontSize: 12.5, padding: '7px 13px', borderRadius: 9, border: '1px solid var(--paper-2, #EAE4D8)' }}
        >
          Close
        </button>
      </div>
    </section>
  );
}
