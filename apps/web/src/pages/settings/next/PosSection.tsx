/**
 * Point of sale — what the till has actually sent, and a bookmark beside it.
 *
 * Two rows that look alike and are not. "Checks received" is a figure of record
 * read from `/pos-hub/status/:rid`; a failed read of it says so instead of
 * rendering "no checks", because those two states look identical and mean
 * opposite things. "Connector" is a documentation bookmark — nothing in the
 * ingest path reads `posConfig.activeProvider`, and a till starts sending when
 * its own handshake completes.
 *
 * THE DATE THIS ROW NO LONGER STAMPS (audit NIT 8)
 * -----------------------------------------------
 * The first pass wrote `updatedAt: new Date().toISOString()` into the
 * `posConfig` blob on every change and printed it back as the row's provenance.
 * It was labelled honestly as a client stamp, but a date produced by the
 * browser's own clock and then read back as a record is a record of nothing —
 * a machine two hours out, or a second tab, and the page is quoting itself.
 * The stamp is gone. The row now carries the preference record's own
 * server-side date and says out loud that it belongs to every account-kept
 * setting together, which is a smaller claim and a true one. A `posConfig.updatedAt`
 * left in an existing row by the first pass is simply never read.
 *
 * TABLES THE TILL HAS NAMED (ADR 0303, 2026-10-04)
 * ------------------------------------------------
 * Founder rulings "Learn from the POS" and, 2026-10-05, "Only words with a
 * number": a table word the till sends on a check becomes a table the owner
 * can rename or hide when it has a digit in it ('T12', '12', 'Patio 3'); a
 * word with none ('Booth', a name) stays on its check and makes no table.
 * Nothing is drawn.
 * The list reads `GET /analytics/tables/:rid` only once it is opened (the
 * ConsentPanel precedent), keeps loading, a failed read and an empty read
 * apart, and offers Rename and Hide to an owner or a manager only — the
 * PATCH route refuses anyone else (founder fork F1). A hidden table still
 * catches its checks; they stay in takings and leave the room register and
 * its export (founder fork F2; the insights' part is owed, ADR 0303 residual
 * 1, so the copy names only what leaves today). No seat count or position is
 * asked for here.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { Action, Disclosure, Micro, Note, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, MONO, SANS, fmtWhen } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

export function PosSection({ data }: { data: SettingsNextData }) {
  const { pos, prefs, savePrefs, writer } = data;
  // The connector choice lives in the account preferences, a SEPARATE read from
  // the POS register. Until it answers, "which connector" is unknown — not
  // "none chosen", which would be a claim about a record we have not read.
  const prefsReady = prefs.status === 'ok';
  const chosen = prefsReady
    ? (prefs.data?.preferences.posConfig as { activeProvider?: string } | undefined)
    : undefined;

  return (
    <>
      <Register remote={pos} name="the point-of-sale register">
        {(reg) => {
          const status = reg.status;
          const sources = status?.sources ?? null;
          const active = chosen?.activeProvider ?? null;
          const provider = reg.providers.providers.find((p) => p.key === active) ?? null;
          const chooserUnknown = prefsReady
            ? 'nothing has been chosen, so nothing has been written'
            : 'your account preferences have not answered yet';

          return (
            <>
              <div style={{ margin: '4px 0 0' }}><Micro tone="seal">What the till has sent</Micro></div>
              {reg.statusError ? (
                <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 0' }}>
                  The check register could not be read — {reg.statusError}. That is not the same as a till that has sent
                  nothing, and nothing below is claimed for it.
                </p>
              ) : status?.unavailable ? (
                <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 0' }}>
                  The gateway reached for the check register and could not read it. Whether a till is connected is unknown —
                  it is not “no checks”.
                </p>
              ) : (
                <Row
                  label="Checks received"
                  provenance={{
                    kept: 'restaurant',
                    verb: 'last check',
                    when: sources?.[0]?.latest ?? null,
                    whenUnknown: 'no check has arrived, so nothing carries a date',
                  }}
                  consequence={
                    sources && sources.length > 0 ? (
                      <>
                        {sources.map((s) => `${s.providerName ?? s.source}: ${s.checks ?? EM}`).join(' · ')}
                      </>
                    ) : (
                      <>No till has sent a check. The register answered, and it is empty — no connection has been made yet.</>
                    )
                  }
                  control={
                    <span style={{ fontFamily: MONO, fontSize: 16, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-1)' }}>
                      {status?.totalChecks ?? EM}
                    </span>
                  }
                />
              )}

              <div style={{ margin: '20px 0 0' }}><Micro>Which connector you are reading about</Micro></div>
              <Row
                label="Connector"
                provenance={{
                  kept: 'account',
                  when: prefsReady ? (prefs.data?.updatedAt ?? null) : null,
                  whenUnknown: chooserUnknown,
                  readBy: 'nothing in the ingest path — a documentation bookmark only; a till starts sending on its own handshake',
                }}
                consequence={
                  <>
                    This records which connector’s documentation you are looking at. It does <strong>not</strong> connect
                    anything and nothing in the ingest path reads it — a till starts sending when its own handshake
                    completes, not when this is set. {reg.providers.summary.total} connectors are described. The date
                    beside it is your preference record’s, shared with every other setting kept on your account; nothing
                    dates this choice on its own.
                  </>
                }
                control={
                  <select
                    aria-label="POS connector"
                    value={active ?? ''}
                    disabled={writer.busy === 'pos' || !prefsReady}
                    onChange={(e) => void savePrefs('pos', { posConfig: { activeProvider: e.target.value } })}
                    className="st-focus"
                    style={{ ...fieldStyle, maxWidth: 200 }}
                  >
                    <option value="">{EM} none chosen</option>
                    {reg.providers.providers.map((p) => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </select>
                }
              />
              {provider && (
                <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-4)', margin: '8px 0 0' }}>
                  {provider.name} — adapter {provider.status}, {provider.authModel.replace('_', ' ')} authentication.
                  {provider.docsUrl && (
                    <> <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="st-focus" style={{ color: 'var(--seal-deep)' }}>Provider documentation</a>.</>
                  )}
                </p>
              )}
              <SaveFailure
                failed={writer.failed && !writer.failed.key.startsWith('table:') ? writer.failed : null}
                what="The connector above is still the server’s."
              />
            </>
          );
        }}
      </Register>
      <TillTablesOpener data={data} />
    </>
  );
}

/* ── Tables the till has named ───────────────────────────────────────────── */

/** One restaurant_tables row as `GET /analytics/tables/:rid` returns it. */
export interface TillTable {
  id: string;
  label: string;
  pos_refs: Record<string, unknown> | null;
  learned_at: string | null;
  hidden_at: string | null;
}

async function readTillTables(restaurantId: string): Promise<TillTable[]> {
  const { data } = await apiClient.get<unknown>(`/analytics/tables/${restaurantId}`);
  if (!Array.isArray(data)) throw new Error('the answer was not a list of tables');
  return data as TillTable[];
}

/** The till's own words for a table, per till: "csv_import: T7". */
function tillWords(refs: TillTable['pos_refs']): string | null {
  if (!refs || typeof refs !== 'object') return null;
  const words = Object.entries(refs)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([source, v]) => `${source}: ${String(v)}`);
  return words.length > 0 ? words.join(' · ') : null;
}

const quiet = { fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '4px 0 0' } as const;

/** Closed until asked: nothing is read before the owner opens the list. */
export function TillTablesOpener({ data }: { data: SettingsNextData }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: '20px 0 0' }}>
      <Disclosure summary="Tables the till has named" open={open} onToggle={() => setOpen((o) => !o)}>
        <TillTables data={data} />
      </Disclosure>
    </div>
  );
}

export function TillTables({ data }: { data: SettingsNextData }) {
  const { restaurantId, canManage, writer } = data;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['till-tables', restaurantId],
    queryFn: () => readTillTables(restaurantId as string),
    enabled: Boolean(restaurantId),
    retry: false,
  });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!restaurantId) return <Note role="status">No house is open, so no table is read.</Note>;
  if (q.isPending) return <Note role="status">Opening the tables the till has named…</Note>;
  if (q.isError)
    return (
      <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 0' }}>
        The tables could not be read — {getErrorMessage(q.error)}. That is not the same as a till that has named
        none, and nothing below is claimed for them.
      </p>
    );

  const change = (t: TillTable, body: { label?: string; hidden?: boolean }) =>
    writer.run(`table:${t.id}`, async () => {
      await apiClient.patch(`/analytics/tables/${restaurantId}/${t.id}`, body);
      await qc.invalidateQueries({ queryKey: ['till-tables', restaurantId] });
    });

  const tables = q.data;
  const failed = writer.failed && writer.failed.key.startsWith('table:') ? writer.failed : null;

  return (
    <>
      <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', margin: '0 0 6px' }}>
        A table name the till sends on a check becomes a table here when it has a number in it (T12, 12, Patio 3). A
        word with no number, such as Booth or a name, stays on its check and makes no table. Past checks find a table
        again when it is
        renamed. Nothing is drawn. A hidden table still catches its checks: they stay in takings and leave the room
        register in Reports.
      </p>
      {tables.length === 0 ? (
        <Note role="status">
          This house has no table yet. One appears here the first time a check arrives naming a table with a number in
          it, such as T12, 12 or Patio 3.
        </Note>
      ) : (
        tables.map((t) => {
          const busy = writer.busy === `table:${t.id}`;
          const words = tillWords(t.pos_refs);
          return (
            <Row
              key={t.id}
              label={t.label}
              consequence={
                <>
                  {words ? <>The till calls it <span style={{ fontFamily: MONO, fontSize: 11 }}>{words}</span>.</> : 'No till word is recorded for it yet.'}
                  {t.hidden_at ? ' Hidden: its checks are in takings, not in the room register.' : ''}
                </>
              }
              control={
                canManage ? (
                  <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Action
                      tone="quiet"
                      disabled={busy}
                      onClick={() => { setRenaming(t.id); setDraft(t.label); writer.clear(); }}
                    >
                      Rename
                    </Action>
                    <Action tone="quiet" disabled={busy} onClick={() => void change(t, { hidden: !t.hidden_at })}>
                      {t.hidden_at ? 'Show' : 'Hide'}
                    </Action>
                  </span>
                ) : undefined
              }
            >
              <p style={quiet}>
                {t.learned_at ? `Learned from the till ${fmtWhen(t.learned_at)}.` : 'Added by hand.'}
                {t.hidden_at ? ` Hidden ${fmtWhen(t.hidden_at)}.` : ''}
              </p>
              {canManage && renaming === t.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void change(t, { label: draft }).then((ok) => { if (ok) setRenaming(null); });
                  }}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 0', flexWrap: 'wrap' }}
                >
                  <input
                    aria-label={`New name for ${t.label}`}
                    value={draft}
                    maxLength={60}
                    onChange={(e) => setDraft(e.target.value)}
                    className="st-focus"
                    style={{ ...fieldStyle, maxWidth: 200 }}
                  />
                  <Action type="submit" disabled={busy || draft.trim() === ''}>{busy ? 'Saving…' : 'Save'}</Action>
                  <Action tone="quiet" onClick={() => setRenaming(null)}>Cancel</Action>
                </form>
              )}
            </Row>
          );
        })
      )}
      {tables.length > 0 && !canManage && (
        <p style={quiet}>Only the owner or a manager can rename or hide a table.</p>
      )}
      <SaveFailure failed={failed} what="The tables above are still the server’s." />
    </>
  );
}

export default PosSection;
