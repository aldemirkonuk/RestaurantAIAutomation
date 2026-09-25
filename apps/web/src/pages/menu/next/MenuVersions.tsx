/**
 * The menus a house has read and kept (ADR 0193, menu versions).
 *
 * THE FOUNDER, 2026-09-21 (answer 7, the gist of his words, relayed): newest
 * scan wins; an optional cadence tag (weekly / monthly / quarterly / yearly /
 * none) and an optional date (a day, or just a month); keep ALL menu
 * extractions (the source and the extracted lines) accessible over time; a
 * "current menu" and the "last one used"; after a photo and an extraction the
 * person chooses whether it becomes the current menu or not; either way it is
 * kept.
 *
 * WHAT THIS READS AND WRITES (all real, all house-scoped by the token):
 *   GET  /menu-versions                       every kept menu, current, last used
 *   GET  /menu-versions/:id/source            a five-minute link to the source
 *   GET  /menu-versions/:id/plan              what choosing it would do (round 3)
 *   POST /menu-versions/:id/make-current      owner or manager only, naming the plan
 *   POST /menus/import                        read a new menu, kept as a draft
 *
 * Choosing the current menu is offered to owners and managers; the gateway
 * refuses anyone else regardless of this page. Since ADR 0193 round 3 the
 * choice goes through the plan (`MenuPlan.tsx`): what it would change, with a
 * Keep switch on each price (the founder, 2026-09-21: "add a section to that
 * where you can lock price"), then "Make it current".
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MENU_CADENCES,
  getMenuSourceUrl,
  importMenu,
  listMenuVersions,
  type MakeCurrentResult,
  type MenuCadence,
  type MenuImportResult,
  type MenuVersion,
} from '../../../services/api/menus';
import { MenuPlan } from './MenuPlan';

const EM = '—';

/** The gateway's own words for a refusal, never a bare status. */
export function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can choose the current menu';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : EM;
}

/** How a kept menu is named in a sentence: its own date if it has one, else when it was read. */
export function versionLabel(v: MenuVersion): string {
  const date = v.menuDate
    ? v.menuDatePrecision === 'month'
      ? `the ${v.menuDate} menu`
      : `the menu for ${v.menuDate}`
    : v.extractedAt
      ? `the menu read ${day(v.extractedAt)}`
      : 'a menu read before menus were kept';
  return v.cadence && v.cadence !== 'none' ? `${date} (${v.cadence})` : date;
}

/** What one kept menu's source is, in words. */
export function sourceWords(v: MenuVersion): string {
  if (v.source.kept) return v.source.mime === 'application/pdf' ? 'PDF kept' : v.source.mime?.startsWith('image/') ? 'photo kept' : 'file kept';
  if (v.source.failure) return `source not kept: ${v.source.failure}`;
  if (v.sourceMethod === 'manual') return 'typed in, no file';
  return 'read before menus were kept, no file';
}

/**
 * The words for each line outcome the gateway reports. A key the page does
 * not know is still printed (ADR 0193 round 3, L15): an outcome the page
 * drops is a price change -- or a hold -- nobody hears about.
 */
const OUTCOME_WORDS: Record<string, (n: number) => string> = {
  changed: (n) => `${n} price${n === 1 ? '' : 's'} set from this menu`,
  unchanged: (n) => `${n} already at the menu's price`,
  stale: (n) => `${n} kept a price someone set after this menu was chosen`,
  locked: (n) => `${n} held by a lock`,
  no_price: (n) => `${n} with no price on the line`,
  not_linked: (n) => `${n} not matched to a wine, so no price`,
  failed: () => '',
};

/** What making a menu current did, in one sentence -- every outcome it was told, and every lock by name. */
export function makeCurrentSentence(r: MakeCurrentResult): string {
  if (r.outcome === 'already_current') return 'That menu was already the current one. Nothing changed.';
  const parts = [`${r.lines} line${r.lines === 1 ? '' : 's'}`];
  const keys = Object.keys(r.priceSync);
  if (!keys.includes('changed')) parts.push(OUTCOME_WORDS.changed(0));
  for (const k of ['changed', 'unchanged', 'stale', 'locked', 'no_price', 'not_linked']) {
    const n = r.priceSync[k] ?? 0;
    if (n > 0) parts.push(OUTCOME_WORDS[k](n));
  }
  for (const k of keys) {
    if (k in OUTCOME_WORDS) continue;
    const n = r.priceSync[k] ?? 0;
    if (n > 0) parts.push(`${n} ${k.replace(/_/g, ' ')}`);
  }
  if (r.flagged > 0) parts.push(`${r.flagged} flagged for a blank price`);
  const held = r.held?.length
    ? ` Held by a lock, not changed: ${r.held
        .map((h) => `${h.name} (${h.kind}${h.lockedPrice === null ? '' : `, locked at ${h.lockedPrice.toFixed(2)}`})`)
        .join('; ')}.`
    : '';
  const returned = r.returned?.length
    ? ` Back on the menu with its lock still holding: ${r.returned.map((x) => x.name).join('; ')}.`
    : '';
  const failed = r.failed.length
    ? ` ${r.failed.length} could not be priced: ${r.failed.map((f) => `${f.name} (${f.error})`).join('; ')}.`
    : '';
  return `This is now the current menu: ${parts.join(', ')}.${held}${returned}${failed}`;
}

/** A menu date the gateway accepts: a day or just a month. Empty = none. */
export function readMenuDate(raw: string): { ok: boolean; value: string | undefined; error: string | null } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: undefined, error: null };
  if (/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/.test(t)) return { ok: true, value: t, error: null };
  return { ok: false, value: undefined, error: 'A date is a day (2026-10-15) or just a month (2026-10).' };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('the file could not be read'));
    r.readAsDataURL(file);
  });
}

function ReadMenuForm({ canManage, onRead }: { canManage: boolean; onRead: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [cadence, setCadence] = useState<MenuCadence | ''>('');
  const [date, setDate] = useState('');
  const [result, setResult] = useState<MenuImportResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const dateRead = readMenuDate(date);

  const read = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a photo, PDF or CSV of the menu first.');
      const labels = { ...(cadence ? { cadence } : {}), ...(dateRead.value ? { menuDate: dateRead.value } : {}) };
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv') || file.type === 'text/csv') {
        return importMenu('csv', { csvContent: await file.text() }, labels);
      }
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        return importMenu('csv', { fileBase64: await fileToBase64(file) }, labels);
      }
      return importMenu('scan', { imageBase64: await fileToBase64(file) }, labels);
    },
    onSuccess: (r) => {
      setResult(r);
      setChosen(null);
      setPlanning(false);
      onRead();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dateRead.ok) return;
    read.mutate();
  };

  return (
    <div style={{ border: '1px solid var(--paper-2)', borderRadius: 10, padding: 14, marginTop: 16 }} data-testid="menu-read-form">
      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label className="cl-said" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Menu to read
          <input
            type="file"
            accept="image/*,application/pdf,.csv,.xlsx,.xls"
            aria-label="Menu to read"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="cl-said" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          How often it changes (optional)
          <select aria-label="How often it changes" value={cadence} onChange={(e) => setCadence(e.target.value as MenuCadence | '')}>
            <option value="">Not tagged</option>
            {MENU_CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="cl-said" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Date (optional: a day or a month)
          <input aria-label="Menu date" placeholder="2026-10 or 2026-10-15" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="submit" className="cl-btn cl-focus" disabled={read.isPending || !file || !dateRead.ok}>
          {read.isPending ? 'Reading…' : 'Read this menu'}
        </button>
      </form>
      {dateRead.error ? (
        <p role="alert" className="cl-note">
          {dateRead.error}
        </p>
      ) : null}
      {read.isError ? (
        <p role="alert" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-read-error">
          The menu was not read: {reasonOf(read.error)}.
        </p>
      ) : null}
      {result ? (
        <div style={{ marginTop: 10 }} data-testid="menu-read-result">
          <p className="cl-said">
            Read {result.itemsExtracted} line{result.itemsExtracted === 1 ? '' : 's'} and kept this menu.{' '}
            {result.source && !result.source.kept
              ? `Its file was not kept: ${result.source.failure ?? 'no reason given'}. `
              : ''}
            It is not the current menu, and no price has changed.
          </p>
          {canManage ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="cl-btn cl-ink cl-focus"
                disabled={planning || chosen !== null}
                onClick={() => setPlanning(true)}
              >
                Make this the current menu
              </button>
              <button type="button" className="cl-btn cl-focus" disabled={chosen !== null} onClick={() => { setPlanning(false); setChosen('Kept, not current. It stays in the list below.'); }}>
                Keep it, not current
              </button>
            </div>
          ) : (
            <p className="cl-note">An owner or a manager chooses whether it becomes the current menu. It is kept either way.</p>
          )}
          {planning && chosen === null ? (
            <MenuPlan
              menuId={result.menuId}
              canManage={canManage}
              onCancel={() => setPlanning(false)}
              onDone={(r) => {
                setPlanning(false);
                setChosen(makeCurrentSentence(r));
                void queryClient.invalidateQueries({ queryKey: ['menu'] });
                onRead();
              }}
            />
          ) : null}
          {chosen ? (
            <p role="status" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-choice-said">
              {chosen}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VersionRow({ v, canManage, lastUsedId, planning, onPlan }: {
  v: MenuVersion
  canManage: boolean
  lastUsedId: string | null
  planning: boolean
  onPlan: (menuId: string) => void
}) {
  const [linkError, setLinkError] = useState<string | null>(null);
  const openSource = async () => {
    setLinkError(null);
    try {
      const { url } = await getMenuSourceUrl(v.menuId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setLinkError(reasonOf(err));
    }
  };
  const standing = v.current
    ? `current since ${day(v.madeCurrentAt)}${v.madeCurrentBy?.name ? `, chosen by ${v.madeCurrentBy.name}` : ''}`
    : v.status === 'archived'
      ? `${v.menuId === lastUsedId ? 'last one used, ' : ''}used until ${day(v.retiredAt)}`
      : 'kept, never current';
  return (
    <tr data-testid="menu-version-row">
      <td>{versionLabel(v)}</td>
      <td className="cl-dim">{standing}</td>
      <td className="cl-dim">
        {v.linesExtracted === null ? EM : `${v.linesExtracted} line${v.linesExtracted === 1 ? '' : 's'}`}
        {v.extractedBy?.name ? `, read by ${v.extractedBy.name}` : ''}
      </td>
      <td className="cl-dim">
        {v.source.kept ? (
          <button type="button" className="cl-btn cl-focus" onClick={() => void openSource()}>
            Open {v.source.mime === 'application/pdf' ? 'PDF' : v.source.mime?.startsWith('image/') ? 'photo' : 'file'}
          </button>
        ) : (
          sourceWords(v)
        )}
        {linkError ? (
          <span role="alert" style={{ display: 'block' }}>
            {linkError}
          </span>
        ) : null}
      </td>
      <td>
        {!v.current && canManage ? (
          <button
            type="button"
            className="cl-btn cl-focus"
            data-on={planning ? 'true' : 'false'}
            onClick={() => onPlan(v.menuId)}
            aria-label={`Make ${versionLabel(v)} current`}
          >
            {planning ? 'See below' : 'Make current'}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export function MenuVersions({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['menu', 'versions'], queryFn: listMenuVersions });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['menu'] });

  return (
    <section style={{ marginTop: 32 }} aria-labelledby="menu-versions-h">
      <h2 id="menu-versions-h" className="cl-crumb">
        Menus kept
      </h2>
      <p className="cl-note">
        Every menu this house reads is kept: the file and the lines it found. Reading one does not change the current
        menu or any price; choosing it does.
      </p>
      <ReadMenuForm canManage={canManage} onRead={refresh} />
      {said ? (
        <p role="status" className="cl-said" style={{ marginTop: 10 }}>
          {said}
        </p>
      ) : null}
      {q.isLoading ? (
        <p className="cl-said" role="status" style={{ marginTop: 12 }}>
          Reading the menus this house has kept…
        </p>
      ) : q.isError ? (
        <p className="cl-said" role="alert" style={{ marginTop: 12 }} data-testid="menu-versions-error">
          The menus this house has kept could not be read ({reasonOf(q.error)}). This is not the same as having none.
        </p>
      ) : (
        <>
          <p className="cl-standing" style={{ marginTop: 12 }} data-testid="menu-versions-standing">
            {q.data?.current ? `Current: ${versionLabel(q.data.current)}.` : 'No menu is current yet.'}{' '}
            {q.data?.lastUsed ? `Last one used: ${versionLabel(q.data.lastUsed)}.` : 'No earlier menu has been used.'}
          </p>
          {q.data && q.data.versions.length > 0 ? (
            <>
            <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 10 }}>
              <table className="cl-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Menu</th>
                    <th>Standing</th>
                    <th>Lines</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data.versions.map((v) => (
                    <VersionRow
                      key={v.menuId}
                      v={v}
                      canManage={canManage}
                      lastUsedId={q.data?.lastUsed?.menuId ?? null}
                      planning={planFor === v.menuId}
                      onPlan={(id) => {
                        setSaid(null);
                        setPlanFor(id);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {q.data.namesReadable === false ? (
              <p className="cl-note">{q.data.namesReason ?? 'Who read or chose these menus could not be named.'}</p>
            ) : null}
            {planFor ? (
              <MenuPlan
                key={planFor}
                menuId={planFor}
                canManage={canManage}
                onCancel={() => setPlanFor(null)}
                onDone={(r) => {
                  setPlanFor(null);
                  setSaid(makeCurrentSentence(r));
                  refresh();
                }}
              />
            ) : null}
            </>
          ) : (
            <p className="cl-said" style={{ marginTop: 10 }}>
              No menu has been read yet.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default MenuVersions;
