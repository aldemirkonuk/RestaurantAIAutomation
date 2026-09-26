/**
 * Log sales — the sales register's own surface on `/team` (page note §13.8,
 * "move sales ingest off the schedule"; founder, 2026-09-26, round 8, item 51:
 * the legacy-only acts are built into the new page before cutover).
 *
 * WHAT IT CARRIES OVER. The legacy `PerformancePanel` had two ways in: "Log
 * sales" for one person's service, and a CSV import. Both are here, writing the
 * same row through the same two routes:
 *
 *   POST /restaurants/:rid/team/sales        one service     source 'manual'
 *   POST /restaurants/:rid/team/sales/batch  several         'manual' typed, 'csv' from a file
 *
 * The house is the path's; the gateway admits a manager of THAT house
 * (`performance.service.ts`, `assertAccess(…, "manager")`) and writes only
 * rows naming people on its own roster.
 *
 * WHAT IS NEW. "Several at once" is first a night typed in for the whole
 * floor — one row per active person, blank rows left out — because that is
 * what a manager actually has at close: the day's figures by server. A file
 * can fill the same list instead, and every row it read is shown before
 * anything is sent, with the reason beside any row that cannot go. Nothing is
 * guessed: a figure that is not a plain number refuses its row (the legacy
 * panel wrote a 0 for it). After saving, the sheet says what was written AND
 * what the gateway declined, by name — a batch that saved 10 of 12 no longer
 * reads as a batch that saved everything.
 *
 * A SECOND WRITE REPLACES THE FIRST. `server_sales` is unique on
 * (house, person, day), and both routes upsert. The sheet says so above the
 * save, because "log" suggests adding.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { getErrorMessage } from '@/services/api/client';
import {
  ingestSales,
  ingestSalesBatch,
  type SalesBatchResult,
  type TeamMember,
} from '../../../services/api/team';
import { fmtDayShort, resolveName, todayIso } from './tm-format';
import { MutationError } from './tm-bits';
import {
  FIGURES,
  checkRow,
  duplicateKeys,
  isBlank,
  readSalesCsv,
  type FigureField,
  type SalesDraft,
} from './sales-entry';

type Mode = 'one' | 'several';

const emptyFigures = { covers: '', checks: '', netSales: '', wineSales: '' };

function floorRows(members: ReadonlyArray<TeamMember>, day: string): SalesDraft[] {
  return members
    .filter((m) => m.status === 'active')
    .map((m) => ({
      key: `floor-${m.id}`,
      memberId: m.id,
      serviceDate: day,
      ...emptyFigures,
      source: 'manual' as const,
    }));
}

export function SalesSheet({
  members,
  rosterFailed = false,
  restaurantId,
  initialMemberId,
  onClose,
}: {
  /** `null` until the roster answers — the sheet then cannot name anyone. */
  members: TeamMember[] | null;
  /** The roster read FAILED (as against: not answered yet). */
  rosterFailed?: boolean;
  restaurantId: string | null;
  initialMemberId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const today = todayIso();
  const [mode, setMode] = useState<Mode>('one');
  const roster = useMemo(() => members ?? [], [members]);
  const memberIds = useMemo(() => new Set(roster.map((m) => m.id)), [roster]);
  const nameOf = (id: string) => {
    const m = roster.find((x) => x.id === id);
    return m ? resolveName(m).text : 'someone not on this roster';
  };

  // ── one service ──────────────────────────────────────────────────────────
  const [one, setOne] = useState<SalesDraft>({
    key: 'one',
    memberId: initialMemberId ?? '',
    serviceDate: today,
    ...emptyFigures,
    source: 'manual',
  });
  const [oneTouched, setOneTouched] = useState(false);
  const oneVerdict = checkRow(one, today, memberIds);

  // ── several ──────────────────────────────────────────────────────────────
  const [floorDay, setFloorDay] = useState(today);
  const [typed, setTyped] = useState<SalesDraft[]>(() => floorRows(roster, today));
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fallback, setFallback] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  // The roster may answer after the sheet opens; give the floor its lines then.
  useEffect(() => {
    if (typed.length === 0 && members && members.length > 0) {
      setTyped(floorRows(members, floorDay));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  const csv = useMemo(
    () => (file ? readSalesCsv(file.text, roster, fallback) : null),
    [file, roster, fallback],
  );
  const severalRows: SalesDraft[] = file ? (csv?.ok ? csv.rows : []) : typed.filter((r) => !isBlank(r));
  const dup = duplicateKeys(severalRows);
  const verdicts = severalRows.map((r) => ({
    row: r,
    verdict: dup.has(r.key)
      ? ({ ok: false, why: 'the same person appears twice for this day' } as const)
      : checkRow(r, today, memberIds),
  }));
  const ready = verdicts.flatMap((v) => (v.verdict.ok ? [v.verdict.entry] : []));
  const refusedRows = verdicts.filter((v) => !v.verdict.ok);

  const [result, setResult] = useState<string | null>(null);

  const afterSave = () => {
    void qc.invalidateQueries({ queryKey: ['team-next-performance', restaurantId] });
  };

  const saveOne = useMutation({
    mutationFn: () => {
      if (!oneVerdict.ok) throw new Error(oneVerdict.why);
      return ingestSales(oneVerdict.entry, restaurantId ?? undefined);
    },
    onSuccess: () => {
      setResult(
        `Saved ${nameOf(one.memberId)}’s ${fmtDayShort(one.serviceDate)} service. Their performance card now reads it.`,
      );
      setOne({ ...one, ...emptyFigures });
      setOneTouched(false);
      afterSave();
    },
  });

  const saveSeveral = useMutation({
    mutationFn: () => ingestSalesBatch(ready, restaurantId ?? undefined),
    onSuccess: (r: SalesBatchResult) => {
      const skipped = r?.skippedRows ?? [];
      setResult(
        `Saved ${r?.inserted ?? 0} service${r?.inserted === 1 ? '' : 's'}.` +
          (skipped.length
            ? ` ${skipped.length} ${skipped.length === 1 ? 'row was' : 'rows were'} not saved because the person is not on this house’s roster: ${skipped
                .map((s) => `${nameOf(s.memberId)} on ${fmtDayShort(s.serviceDate)}`)
                .join('; ')}.`
            : ''),
      );
      if (file) {
        setFile(null);
      } else {
        setTyped(floorRows(roster, floorDay));
      }
      afterSave();
    },
  });

  const setTypedFigure = (key: string, field: FigureField, value: string) =>
    setTyped((rows) => rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const changeFloorDay = (day: string) => {
    setFloorDay(day);
    setTyped((rows) => rows.map((r) => ({ ...r, serviceDate: day })));
  };

  const readFile = async (f: File) => {
    setResult(null);
    setFile({ name: f.name, text: await f.text() });
  };

  const rosterUnknown = members === null;

  return (
    <Sheet
      open
      onClose={onClose}
      label="This is where a service’s sales are written down by hand. Saving writes the figures to this house’s sales register at once, and a day already on file for that person is replaced. Leaving writes nothing."
      eyebrow="Sales register"
      title="Log sales"
      closeLabel="Close"
      footer={
        <span className="tm-hint">
          These are the figures the performance card measures. Nothing is estimated: a
          person with no service logged shows no figure, not a zero.
        </span>
      }
    >
      <div className="tm-in tm-form">
        <div className="tm-actions" role="group" aria-label="How many services">
          <button
            type="button"
            className="tm-ctl tm-ctl--sm"
            aria-pressed={mode === 'one'}
            onClick={() => {
              setMode('one');
              setResult(null);
            }}
          >
            One service
          </button>
          <button
            type="button"
            className="tm-ctl tm-ctl--sm"
            aria-pressed={mode === 'several'}
            onClick={() => {
              setMode('several');
              setResult(null);
            }}
          >
            Several at once
          </button>
        </div>

        {rosterUnknown &&
          (rosterFailed ? (
            <p className="tm-alert" role="alert">
              The roster could not be read, so nobody can be named and nothing can be saved.
              That is a failed read, not an empty team — close this and try again.
            </p>
          ) : (
            <p className="tm-quiet">Reading the roster…</p>
          ))}

        {result && (
          <p className="tm-note" role="status" data-testid="sales-result">
            {result}
          </p>
        )}

        {mode === 'one' ? (
          <>
            <label>
              <span className="tm-label">Who</span>
              <select
                className="tm-select"
                value={one.memberId}
                disabled={rosterUnknown}
                onChange={(e) => setOne({ ...one, memberId: e.target.value })}
              >
                <option value="">Choose a person</option>
                {roster.map((m) => (
                  <option key={m.id} value={m.id}>
                    {resolveName(m).text}
                    {m.position ? ` · ${m.position}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="tm-label">Service day</span>
              <input
                type="date"
                className="tm-input"
                max={today}
                value={one.serviceDate}
                onChange={(e) => setOne({ ...one, serviceDate: e.target.value })}
              />
            </label>
            <div className="tm-two">
              {FIGURES.slice(0, 2).map(({ field, label }) => (
                <label key={field}>
                  <span className="tm-label">{label}</span>
                  <input
                    className="tm-input"
                    inputMode="numeric"
                    value={one[field]}
                    placeholder="0"
                    onChange={(e) => setOne({ ...one, [field]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="tm-two">
              {FIGURES.slice(2).map(({ field, label }) => (
                <label key={field}>
                  <span className="tm-label">{label}</span>
                  <input
                    className="tm-input"
                    inputMode="decimal"
                    value={one[field]}
                    placeholder="0.00"
                    onChange={(e) => setOne({ ...one, [field]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <p className="tm-hint">
              A blank figure is saved as 0. If this person already has figures for this day,
              these replace them.
            </p>
            {oneTouched && !oneVerdict.ok && (
              <p className="tm-quiet" role="status" data-testid="sales-refusal">
                Not saved: {oneVerdict.why}.
              </p>
            )}
            <MutationError when={saveOne.isError}>
              The service was not saved ({getErrorMessage(saveOne.error)}). Your figures are
              still here — try again.
            </MutationError>
            <div className="tm-actions" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="tm-ctl tm-ctl--seal"
                disabled={saveOne.isPending || rosterUnknown}
                onClick={() => {
                  setOneTouched(true);
                  setResult(null);
                  if (oneVerdict.ok) saveOne.mutate();
                }}
              >
                {saveOne.isPending ? 'Saving…' : 'Save the service'}
              </button>
            </div>
          </>
        ) : (
          <>
            {!file ? (
              <>
                <label>
                  <span className="tm-label">Service day</span>
                  <input
                    type="date"
                    className="tm-input"
                    max={today}
                    value={floorDay}
                    onChange={(e) => changeFloorDay(e.target.value)}
                  />
                </label>
                <p className="tm-hint">
                  One line per person working. Fill in whoever served that day; a line left
                  blank is not saved.
                </p>
                {typed.length === 0 && !rosterUnknown ? (
                  <p className="tm-quiet">
                    Nobody on the roster is active, so there is no line to fill in.
                  </p>
                ) : (
                  <div className="tm-salesgrid-wrap">
                  <table className="tm-salesgrid" data-testid="sales-grid">
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        {FIGURES.map((f) => (
                          <th key={f.field} scope="col">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {typed.map((r) => {
                        const who = nameOf(r.memberId);
                        return (
                          <tr key={r.key}>
                            <th scope="row">{who}</th>
                            {FIGURES.map(({ field, label, whole }) => (
                              <td key={field}>
                                <input
                                  className="tm-input"
                                  inputMode={whole ? 'numeric' : 'decimal'}
                                  aria-label={`${label} for ${who}`}
                                  value={r[field]}
                                  onChange={(e) => setTypedFigure(r.key, field, e.target.value)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
                <div className="tm-actions">
                  <button
                    type="button"
                    className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                    disabled={rosterUnknown}
                    onClick={() => fileInput.current?.click()}
                  >
                    Fill from a file instead
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="tm-note" data-testid="sales-file">
                  From {file.name}
                  {csv && csv.ok
                    ? `: ${csv.rows.length} row${csv.rows.length === 1 ? '' : 's'} read, each on its own day.`
                    : '.'}
                </p>
                {csv && !csv.ok && (
                  <p className="tm-alert" role="alert">
                    {csv.why}
                  </p>
                )}
                {csv && csv.ok && csv.unnamed > 0 && (
                  <label>
                    <span className="tm-label">The file names nobody — these rows are for</span>
                    <select
                      className="tm-select"
                      value={fallback}
                      onChange={(e) => setFallback(e.target.value)}
                    >
                      <option value="">Choose a person</option>
                      {roster.map((m) => (
                        <option key={m.id} value={m.id}>
                          {resolveName(m).text}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {csv && csv.ok && csv.refused.length > 0 && (
                  <ul className="tm-quiet" data-testid="sales-file-refused" style={{ margin: 0 }}>
                    {csv.refused.map((r) => (
                      <li key={r.line}>
                        Line {r.line} not read: {r.why}.
                      </li>
                    ))}
                  </ul>
                )}
                {verdicts.length > 0 && (
                  <div className="tm-salesgrid-wrap">
                  <table className="tm-salesgrid" data-testid="sales-preview">
                    <thead>
                      <tr>
                        <th scope="col">Person</th>
                        <th scope="col">Day</th>
                        {FIGURES.map((f) => (
                          <th key={f.field} scope="col">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {verdicts.map(({ row, verdict }) => (
                        <tr key={row.key} data-refused={verdict.ok ? undefined : 'true'}>
                          <th scope="row">{row.memberId ? nameOf(row.memberId) : '—'}</th>
                          <td>{row.serviceDate ? fmtDayShort(row.serviceDate) : '—'}</td>
                          {verdict.ok ? (
                            FIGURES.map((f) => <td key={f.field}>{verdict.entry[f.field]}</td>)
                          ) : (
                            <td colSpan={FIGURES.length}>Will not be saved: {verdict.why}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
                <div className="tm-actions">
                  <button
                    type="button"
                    className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                    onClick={() => {
                      setFile(null);
                      setFallback('');
                    }}
                  >
                    Back to typing
                  </button>
                  <button
                    type="button"
                    className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose another file
                  </button>
                </div>
              </>
            )}

            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              aria-label="Choose a CSV file of sales"
              data-testid="sales-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = '';
              }}
            />
            <p className="tm-hint">
              A file needs a service_date column, and names each row by member_id or by the
              person’s name. Covers, checks, net_sales and wine_sales are read when present.
            </p>

            <p className="tm-quiet" role="status" data-testid="sales-count">
              {ready.length} ready to save
              {refusedRows.length > 0 ? ` · ${refusedRows.length} will not be saved` : ''}
              {!file && typed.length > 0
                ? ` · ${typed.length - severalRows.length} left blank`
                : ''}
              . A day already on file for a person is replaced.
            </p>
            {!file && refusedRows.length > 0 && (
              <ul className="tm-quiet" style={{ margin: 0 }}>
                {refusedRows.map(({ row, verdict }) => (
                  <li key={row.key}>
                    {nameOf(row.memberId)}: {verdict.ok ? '' : verdict.why}.
                  </li>
                ))}
              </ul>
            )}
            <MutationError when={saveSeveral.isError}>
              Nothing was saved ({getErrorMessage(saveSeveral.error)}). The figures are still
              here — try again.
            </MutationError>
            <div className="tm-actions" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="tm-ctl tm-ctl--seal"
                disabled={saveSeveral.isPending || ready.length === 0 || rosterUnknown}
                onClick={() => {
                  setResult(null);
                  saveSeveral.mutate();
                }}
              >
                {saveSeveral.isPending
                  ? 'Saving…'
                  : ready.length === 0
                    ? 'Nothing to save yet'
                    : `Save ${ready.length} service${ready.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

export default SalesSheet;
