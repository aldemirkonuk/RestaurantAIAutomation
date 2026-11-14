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
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MENU_CADENCES,
  getMenuSourceUrl,
  importMenu,
  linkMenuLineToHouseGood,
  listMenuVersions,
  readWarningSentence,
  type MakeCurrentResult,
  type MenuCadence,
  type HouseCandidate,
  type MenuImportResult,
  type MenuImportReviewItem,
  type MenuReadWarning,
  type MenuVersion,
  type PlanLine,
} from '../../../services/api/menus';
import { oneNounFor, type KindNoun } from './menu-line-kind';
import { useAuthStore } from '../../../stores';
import { MenuPlan } from './MenuPlan';
import { deviceClockNote, houseDay, houseMoment } from './menu-clock';
import { isPhoto, pagesProblem, photoToJpegBase64, photosToPages } from '../../../lib/menuPhotos';
import { formatMoney } from '../../../lib/currency';
import { useHouseCurrencyCode } from '../../../hooks/queries/useHouseCurrencyCode';
import { MenuReadNotes } from '../../../components/onboarding/MenuReadNotes';

const EM = '—';

/**
 * What this box reads (r28 G18): photos, PDFs, CSV and .xlsx. An older .xls
 * workbook (Excel 97-2003) cannot be read (exceljs reads .xlsx only), and the
 * box offered it, so the house was told "check that each row names a wine".
 */
export const MENU_FILE_ACCEPT = 'image/*,application/pdf,.csv,.xlsx';

/** Why a chosen file cannot be read here, in the house's words; null when it can be sent. */
export function menuFileRefusal(file: { name: string; type?: string } | null): string | null {
  if (!file) return null;
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls') || file.type === 'application/vnd.ms-excel')
    return 'This is an older Excel file (.xls), which cannot be read here. Save it as .xlsx or CSV and choose that.';
  return null;
}

/** The gateway's own words for a refusal, never a bare status. */
export function reasonOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can choose the current menu';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

/** The warnings a refused read carried in its body, if any. */
function warningsOf(err: unknown): MenuReadWarning[] {
  const w = (err as { response?: { data?: { warnings?: unknown } } })?.response?.data?.warnings;
  return Array.isArray(w) ? (w as MenuReadWarning[]) : [];
}

/** One plain sentence per part of the file that was not read (ADR 0213 #17). */
export function ReadWarnings({ warnings, testId }: { warnings: MenuReadWarning[] | null | undefined; testId: string }) {
  if (!warnings?.length) return null;
  return (
    <ul data-testid={testId} style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      {warnings.map((w, i) => (
        <li key={i} className="cl-said">
          {readWarningSentence(w)}
        </li>
      ))}
    </ul>
  );
}

/**
 * The calendar day of a moment, on the house's clock (menu-clock.ts; the
 * device's when the house has no zone). Not the UTC day: a menu read at 22:05
 * in Detroit is that evening's menu, not tomorrow's.
 */
function day(iso: string | null, zone?: string | null): string {
  if (!iso) return EM;
  return houseDay(iso, zone) ?? iso.slice(0, 10);
}

/**
 * The day and the minute, so two menus read the same day are told apart; with
 * `second`, the second too, for two read in the same minute.
 */
function moment(iso: string, second = false, zone?: string | null): string {
  return houseMoment(iso, zone, second) ?? iso.slice(0, second ? 19 : 16).replace('T', ' ');
}

/**
 * Why a menu's file was not kept, without the gateway's older lead-in: rows
 * stored before 2026-11-11 say "the source file was not kept: ..." themselves,
 * and the page says it again.
 */
function keepFailure(failure: string): string {
  return failure.replace(/^the source file was not kept:\s*/i, '');
}

/**
 * How a kept menu is named in a sentence: its own date if it has one, else when
 * it was read. `sharp` names it more closely, for when another kept menu has the
 * same name: a read moment to the second, a dated menu with when it was read,
 * and a menu from before reads were dated with when it was kept.
 */
export function versionLabel(v: MenuVersion, sharp = false, zone?: string | null): string {
  const read = v.extractedAt ? moment(v.extractedAt, sharp, zone) : null;
  const date = v.menuDate
    ? `${v.menuDatePrecision === 'month' ? `the ${v.menuDate} menu` : `the menu for ${v.menuDate}`}${sharp && read ? `, read ${read}` : ''}`
    : read
      ? `the menu read ${read}`
      : `a menu read before menus were kept${sharp && v.createdAt ? ` (kept ${moment(v.createdAt, true, zone)})` : ''}`;
  return v.cadence && v.cadence !== 'none' ? `${date} (${v.cadence})` : date;
}

/**
 * A name for every kept menu that no other kept menu shares (menu walk
 * 2026-11-11: two reads in the same minute had the same name, and "Make the
 * menu read 2026-11-11 22:05 current" could mean either). A name is said as
 * plainly as it can be: the minute when that is enough, then the second (or,
 * for a dated menu, when it was read); two still alike -- the same second --
 * are counted in the order they were read, "(1 of 2)", "(2 of 2)".
 */
export function versionLabels(versions: MenuVersion[], zone?: string | null): Map<string, string> {
  const out = new Map<string, string>();
  const groups = (vs: MenuVersion[], name: (v: MenuVersion) => string) => {
    const by = new Map<string, MenuVersion[]>();
    for (const v of vs) by.set(name(v), [...(by.get(name(v)) ?? []), v]);
    return by;
  };
  const when = (v: MenuVersion) => v.extractedAt ?? v.createdAt ?? '';
  for (const [plain, alike] of groups(versions, (v) => versionLabel(v, false, zone))) {
    if (alike.length === 1) {
      out.set(alike[0].menuId, plain);
      continue;
    }
    for (const [close, still] of groups(alike, (v) => versionLabel(v, true, zone))) {
      if (still.length === 1) {
        out.set(still[0].menuId, close);
        continue;
      }
      const ordered = [...still].sort((a, b) => when(a).localeCompare(when(b)) || a.menuId.localeCompare(b.menuId));
      ordered.forEach((v, i) => out.set(v.menuId, `${close} (${i + 1} of ${ordered.length})`));
    }
  }
  return out;
}

/** What one kept menu's source is, in words. */
export function sourceWords(v: MenuVersion): string {
  // A member who may not open the file (ADR 0358 D2) is still told it was kept.
  if (v.source.kept) return v.source.mime === 'application/pdf' ? 'PDF kept' : v.source.mime?.startsWith('image/') ? 'photo kept' : 'file kept';
  if (v.source.failure) return `file not kept: ${keepFailure(v.source.failure)}`;
  if (v.sourceMethod === 'manual') return 'typed in, no file';
  return 'read before menus were kept, no file';
}

/**
 * The words for each line outcome the gateway reports. A key the page does
 * not know is still printed (ADR 0193 round 3, L15): an outcome the page
 * drops is a price change -- or a hold -- nobody hears about.
 */
const OUTCOME_WORDS: Record<string, (n: number, noun: KindNoun) => string> = {
  // Counted by line, as the gateway tallies priceSync: one wine can carry a
  // bottle and a glass price. Every count names its unit, and the plan counts
  // the same lines in the same words (MenuPlan.tsx `lineOutcome`), named by
  // menu-line-kind `oneNounFor`.
  changed: (n, k) => `${n} ${k[n === 1 ? 0 : 1]} priced from this menu`,
  unchanged: (n, k) => `${n} ${k[n === 1 ? 0 : 1]} already at the menu's price`,
  stale: (n, k) => `${n} ${k[n === 1 ? 0 : 1]} kept a price someone set after this menu was chosen`,
  locked: (n, k) => `${n} ${k[n === 1 ? 0 : 1]} at ${n === 1 ? 'its' : 'their'} locked price`,
  no_price: (n) => `${n} line${n === 1 ? '' : 's'} with no price on the menu`,
  not_linked: (n, k) =>
    `${n} line${n === 1 ? '' : 's'} not matched to ${k[0] === 'line' ? "anything on the house's list" : `a ${k[0]}`}, so no price`,
  // The page's own words for a dish (MenuNext "From the kitchen": on the menu, and carried nowhere).
  kitchen_line: (n) => `${n} kitchen line${n === 1 ? '' : 's'}, on the menu and carried nowhere`,
  failed: () => '',
};

/**
 * What making a menu current did, in one sentence -- every outcome it was told,
 * and every lock by name. `name` is the menu's name in the list; given, the
 * sentence says which menu it is about (menu walk 2026-11-12: a choice made
 * from the list was said as "This is now the current menu" with no name).
 * `currency` is the house's code: a locked price is said in the house's money.
 */
export function makeCurrentSentence(r: MakeCurrentResult, name?: string, lines?: PlanLine[], currency: string | null = null): string {
  if (r.outcome === 'already_current' && r.lines === 0) return 'That menu was already the current one. Nothing changed.';
  const noun = oneNounFor(lines);
  const parts = [`${r.lines} line${r.lines === 1 ? '' : 's'}`];
  const keys = Object.keys(r.priceSync);
  if (!keys.includes('changed')) parts.push(OUTCOME_WORDS.changed(0, noun));
  for (const k of ['changed', 'unchanged', 'stale', 'locked', 'no_price', 'not_linked', 'kitchen_line']) {
    const n = r.priceSync[k] ?? 0;
    if (n > 0) parts.push(OUTCOME_WORDS[k](n, noun));
  }
  for (const k of keys) {
    if (k in OUTCOME_WORDS) continue;
    const n = r.priceSync[k] ?? 0;
    if (n > 0) parts.push(`${n} ${k.replace(/_/g, ' ')}`);
  }
  // `flagged` counts lines whose menu price was blank: each carries a note
  // (price_flag_note) that says what the house kept and where a manager
  // changes it. Onboarding walk 2026-11-12: "flagged" was never explained.
  if (r.flagged > 0)
    parts.push(
      `${r.flagged} line${r.flagged === 1 ? '' : 's'} with a blank price, noted on the line so a manager can set ${r.flagged === 1 ? 'it' : 'them'} on Inventory`,
    );
  const held = r.held?.length
    ? ` Held by a lock, not changed: ${r.held
        .map((h) => `${h.name} (${h.kind}${h.lockedPrice === null ? '' : `, locked at ${formatMoney(h.lockedPrice, currency)}`})`)
        .join('; ')}.`
    : '';
  const returned = r.returned?.length
    ? ` Back on the menu with its lock still holding: ${r.returned.map((x) => x.name).join('; ')}.`
    : '';
  const failed = r.failed.length
    ? ` ${r.failed.length} could not be priced: ${r.failed.map((f) => `${f.name} (${f.error})`).join('; ')}.`
    : '';
  // r28 G1: choosing the current menu again carries its prices again.
  if (r.outcome === 'already_current') return `That menu was already the current one; its prices were carried again: ${parts.join(', ')}.${held}${failed}`;
  const who = name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} is` : 'This is';
  return `${who} now the current menu: ${parts.join(', ')}.${held}${returned}${failed}`;
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

/** How the chosen files go up: a sheet, one file as it is, or photos joined into one menu. */
export function uploadShapeOf(files: File[]): { kind: 'csv' | 'sheet' | 'file' | 'photos'; problem: string | null } {
  if (files.length === 0) return { kind: 'file', problem: 'Choose a photo, PDF or CSV of the menu first.' };
  const nameOf = (f: File) => f.name.toLowerCase();
  if (files.length === 1) {
    const f = files[0];
    if (nameOf(f).endsWith('.csv') || f.type === 'text/csv') return { kind: 'csv', problem: null };
    if (nameOf(f).endsWith('.xlsx') || nameOf(f).endsWith('.xls')) return { kind: 'sheet', problem: null };
    return { kind: isPhoto(f) ? 'photos' : 'file', problem: null };
  }
  const notPhoto = files.find((f) => !isPhoto(f));
  if (notPhoto) {
    return {
      kind: 'photos',
      problem: `Several files go up together only as photos of one menu; ${notPhoto.name} is not a photo. Send it on its own.`,
    };
  }
  return { kind: 'photos', problem: null };
}

/** The pages of the chosen photos, ready to send. One photo the browser cannot redraw goes as it is. */
async function pagesOf(files: File[]): Promise<{ images: string[] } | { imageBase64: string }> {
  if (files.length === 1) {
    try {
      return { imageBase64: await photoToJpegBase64(files[0]) };
    } catch {
      return { imageBase64: await fileToBase64(files[0]) };
    }
  }
  const images = await photosToPages(files);
  const problem = pagesProblem(images);
  if (problem) throw new Error(problem);
  return { images };
}

/** The read that goes on without the page (the client stopped waiting, the server did not). */
function stillReading(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 202;
}

export function ReadMenuForm({ canManage, onRead, onReadStart, onReadDone, onChosen, currentMenuId, zone }: {
  canManage: boolean
  /** The house's zone for the dates it says (menu-clock.ts); the device's clock without one. */
  zone?: string | null
  /**
   * The house's current menu as the host last read it (null: none; left out:
   * the host does not know). When it moves, the read's line follows it, so a
   * read chosen here and then replaced from the list stops saying it is the
   * current menu (browser walk 2026-11-12).
   */
  currentMenuId?: string | null
  onRead: () => void
  /** Told when a new read begins, so a host drops what it offered for the last one. */
  onReadStart?: () => void
  /** Told the finished read (used by the Scan buttons on /inventory and /cellar). */
  onReadDone?: (r: MenuImportResult) => void
  /** Told once the read was made the current menu (prices and stock lines moved). */
  onChosen?: () => void
}) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [fileRefusal, setFileRefusal] = useState<string | null>(null);
  const [cadence, setCadence] = useState<MenuCadence | ''>('');
  const [date, setDate] = useState('');
  const [result, setResult] = useState<MenuImportResult | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [readingId, setReadingId] = useState<string | null>(null);
  const currency = useHouseCurrencyCode();
  const dateRead = readMenuDate(date);
  const shape = uploadShapeOf(files);

  const read = useMutation({
    mutationFn: async ({ again }: { again: boolean }) => {
      if (shape.problem) throw new Error(shape.problem);
      setReadingId(null);
      const labels = {
        ...(cadence ? { cadence } : {}),
        ...(dateRead.value ? { menuDate: dateRead.value } : {}),
        ...(again ? { readAgain: true } : {}),
        onReading: (menuId: string) => {
          setReadingId(menuId);
          // The kept version shows in the list at once, as "being read".
          onRead();
        },
      };
      if (shape.kind === 'csv') return importMenu('csv', { csvContent: await files[0].text() }, labels);
      if (shape.kind === 'sheet') return importMenu('csv', { fileBase64: await fileToBase64(files[0]) }, labels);
      if (shape.kind === 'file') return importMenu('scan', { imageBase64: await fileToBase64(files[0]) }, labels);
      return importMenu('scan', await pagesOf(files), labels);
    },
    onMutate: () => onReadStart?.(),
    onSuccess: (r) => {
      setResult(r);
      setReplaced(false);
      setChosen(null);
      setPlanning(false);
      setReadingId(null);
      onRead();
      onReadDone?.(r);
    },
    onError: () => onRead(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dateRead.ok) return;
    setResult(null);
    read.mutate({ again: false });
  };

  useEffect(() => {
    if (currentMenuId === undefined) return;
    if (!result) return;
    const now = currentMenuId === result.menuId;
    const was = result.current === true;
    if (was === now) return;
    // Once current and now replaced, "no price has changed" is no longer true.
    setReplaced(was && !now);
    setResult({ ...result, current: now });
    // A sentence about an earlier choice no longer describes the house.
    setChosen((said) => (said && currentMenuId !== result?.menuId ? null : said));
  }, [currentMenuId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCurrent = result?.current === true;

  return (
    <div style={{ border: '1px solid var(--paper-2)', borderRadius: 10, padding: 14, marginTop: 16 }} data-testid="menu-read-form">
      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label className="cl-said" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Menu to read (several photos = one menu)
          <input
            type="file"
            multiple
            accept={MENU_FILE_ACCEPT}
            aria-label="Menu to read"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              // A file this box cannot read is said at once and never sent.
              const why = picked.map((f) => menuFileRefusal(f)).find((w) => w !== null) ?? null;
              setFileRefusal(why);
              setFiles(why ? [] : picked);
            }}
          />
          {fileRefusal ? (
            <span role="alert" className="cl-note" data-testid="menu-file-refused">
              {fileRefusal}
            </span>
          ) : null}
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
        <button type="submit" className="cl-btn cl-focus" disabled={read.isPending || files.length === 0 || !dateRead.ok || shape.problem !== null}>
          {read.isPending ? 'Reading…' : files.length > 1 ? `Read these ${files.length} pages as one menu` : 'Read this menu'}
        </button>
      </form>
      {files.length > 0 && shape.problem ? (
        <p role="alert" className="cl-note" data-testid="menu-read-shape">
          {shape.problem}
        </p>
      ) : null}
      {dateRead.error ? (
        <p role="alert" className="cl-note">
          {dateRead.error}
        </p>
      ) : null}
      {read.isPending && readingId ? (
        <p role="status" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-read-reading">
          The file is kept and the server is reading it. A long menu can take a few minutes; you can leave this page,
          and the read shows in the list below when it is done.
        </p>
      ) : null}
      {read.isError && stillReading(read.error) ? (
        <p role="status" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-read-still">
          {reasonOf(read.error)}
        </p>
      ) : read.isError ? (
        <p role="alert" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-read-error">
          The menu was not read: {reasonOf(read.error).replace(/\.$/, '')}.
        </p>
      ) : null}
      {read.isError && !stillReading(read.error) ? <ReadWarnings warnings={warningsOf(read.error)} testId="menu-read-error-warnings" /> : null}
      {result ? (
        <div style={{ marginTop: 10 }} data-testid="menu-read-result">
          <p className="cl-said">
            {result.reopened
              ? `This exact file was already read${result.reopened.readAt ? ` on ${day(result.reopened.readAt, zone)}` : ''}; this is that read, and nothing was read again. It found ${result.itemsExtracted} line${result.itemsExtracted === 1 ? '' : 's'}. `
              : `Read ${result.itemsExtracted} line${result.itemsExtracted === 1 ? '' : 's'}${result.pages && result.pages > 1 ? ` from ${result.pages} pages` : ''} and kept this menu. `}
            {result.source && !result.source.kept
              ? `Its file was not kept: ${result.source.failure ? keepFailure(result.source.failure) : 'no reason given'}. `
              : ''}
            {isCurrent
              ? 'It is the current menu.'
              : replaced
                ? 'It is no longer the current menu: another was chosen.'
                : 'It is not the current menu, and no price has changed.'}
          </p>
          <ReadWarnings warnings={result.warnings} testId="menu-read-warnings" />
          <MenuReadNotes notes={result.notes} className="cl-note" />
          {result.reopened ? (
            <button
              type="button"
              className="cl-btn cl-focus"
              style={{ marginTop: 8 }}
              disabled={read.isPending}
              onClick={() => {
                setResult(null);
                read.mutate({ again: true });
              }}
            >
              Read it again
            </button>
          ) : null}
          {/* Once the menu is current its lines were carried, and a link is refused.
              (r37 meet: "current" is the read's own flag, set when it is chosen.) */}
          {isCurrent ? null : (
            <SeveralGoods
              key={result.menuId}
              menuId={result.menuId}
              items={result.items ?? []}
              canManage={canManage}
              onLinked={() => setPlanning(false)}
            />
          )}
          {isCurrent ? null : canManage ? (
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
              onDone={(r, lines) => {
                setPlanning(false);
                setChosen(makeCurrentSentence(r, undefined, lines, currency));
                // The read's own line said "not the current menu" and offered the
                // choice again under "This is now the current menu" (browser walk
                // 2026-11-12). Once it is chosen, the read says so.
                setResult((cur) => (cur && cur.menuId === r.menuId ? { ...cur, current: true } : cur));
                void queryClient.invalidateQueries({ queryKey: ['menu'] });
                onRead();
                onChosen?.();
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

function VersionRow({ v, label, canManage, lastUsedId, planning, onPlan, zone }: {
  v: MenuVersion
  zone: string | null
  /** Its name among the house's kept menus (versionLabels): no two alike. */
  label: string
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
  const readState = v.readState ?? 'done';
  const standing = readState === 'reading'
    ? 'being read now'
    : readState === 'failed'
      ? `the read failed: ${v.readFailure ?? 'no reason was given'}`
      : v.current
    ? `current since ${day(v.madeCurrentAt, zone)}${v.madeCurrentBy?.name ? `, chosen by ${v.madeCurrentBy.name}` : ''}`
    : v.status === 'archived'
      ? `${v.menuId === lastUsedId ? 'last one used, ' : ''}used until ${day(v.retiredAt, zone)}`
      : 'kept, never current';
  return (
    <tr data-testid="menu-version-row">
      <td>{label}</td>
      <td className="cl-dim">{standing}</td>
      <td className="cl-dim">
        {v.linesExtracted === null ? EM : `${v.linesExtracted} line${v.linesExtracted === 1 ? '' : 's'}`}
        {v.extractedBy?.name ? `, read by ${v.extractedBy.name}` : ''}
        <ReadWarnings warnings={v.readWarnings} testId="menu-version-warnings" />
      </td>
      <td className="cl-dim">
        {v.source.kept && canManage ? (
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
        {canManage && readState === 'done' ? (
          <button
            type="button"
            className="cl-btn cl-focus"
            data-on={planning ? 'true' : 'false'}
            onClick={() => onPlan(v.menuId)}
            aria-label={v.current ? `Carry the prices of ${label} again` : `Make ${label} current`}
          >
            {/* r28 G1: a carry cut off part-way is finished from the current menu's own row. */}
            {planning ? 'See below' : v.current ? 'Check its prices' : 'Make current'}
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
  // The house is in the key: one house's versions never stand under
  // another's name (MENU-01).
  const house = useAuthStore((s) => s.activeRestaurantId) ?? null;
  const q = useQuery({
    queryKey: ['menu', 'versions', house],
    queryFn: listMenuVersions,
    // A read in the background finishes on the server: look again until none is left reading.
    refetchInterval: (query) => (query.state.data?.versions.some((v) => v.readState === 'reading') ? 5000 : false),
  });
  const currency = useHouseCurrencyCode();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['menu'] });
  const zone = q.data?.timezone ?? null;
  const labels = versionLabels(q.data?.versions ?? [], zone);
  const nameOf = (v: MenuVersion) => labels.get(v.menuId) ?? versionLabel(v, false, zone);

  return (
    <section style={{ marginTop: 32 }} aria-labelledby="menu-versions-h">
      <h2 id="menu-versions-h" className="cl-crumb">
        Menus kept
      </h2>
      <p className="cl-note">
        Every menu this house reads is kept: the file and the lines it found. Reading one does not change the current
        menu or any price; choosing it does.
      </p>
      <ReadMenuForm
        canManage={canManage}
        onRead={refresh}
        currentMenuId={q.data ? (q.data.current?.menuId ?? null) : undefined}
        zone={zone}
        onChosen={() => {
          // The list's own sentence was about an earlier choice.
          setSaid(null);
          setPlanFor(null);
        }}
      />
      {q.isLoading ? (
        <p className="cl-said" role="status" style={{ marginTop: 12 }}>
          Reading the menus this house has kept…
        </p>
      ) : q.isError ? (
        <>
          <p className="cl-said" role="alert" style={{ marginTop: 12 }} data-testid="menu-versions-error">
            The menus this house has kept could not be read ({reasonOf(q.error)}). This is not the same as having none.
          </p>
          {/* A choice made just before the list failed to read again is still said. */}
          {said ? (
            <p role="status" className="cl-said" style={{ marginTop: 10 }} data-testid="menu-list-choice-said">
              {said}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="cl-standing" style={{ marginTop: 12 }} data-testid="menu-versions-standing">
            {q.data?.current ? `Current: ${nameOf(q.data.current)}.` : 'No menu is current yet.'}{' '}
            {q.data?.lastUsed ? `Last one used: ${nameOf(q.data.lastUsed)}.` : 'No earlier menu has been used.'}
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
                      label={nameOf(v)}
                      canManage={canManage}
                      lastUsedId={q.data?.lastUsed?.menuId ?? null}
                      zone={zone}
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
            {(() => {
              // An older gateway sends no zone at all: its dates were never the house's, and nothing new is said.
              const clock = q.data.timezone === undefined ? null : deviceClockNote(zone, q.data.timezoneReason);
              return clock ? (
                <p className="cl-note" data-testid="menu-versions-clock">
                  {clock}
                </p>
              ) : null;
            })()}
            {q.data.namesReadable === false ? (
              <p className="cl-note">{q.data.namesReason ?? 'Who read or chose these menus could not be named.'}</p>
            ) : null}
            {planFor ? (
              <MenuPlan
                key={planFor}
                menuId={planFor}
                canManage={canManage}
                onCancel={() => setPlanFor(null)}
                onDone={(r, lines) => {
                  const chosenOne = q.data?.versions.find((v) => v.menuId === r.menuId);
                  setPlanFor(null);
                  setSaid(makeCurrentSentence(r, chosenOne ? nameOf(chosenOne) : undefined, lines, currency));
                  refresh();
                }}
              />
            ) : null}
            {/* Menu walk 2026-11-12: this sentence sat under the read form, right
                below that form's line about a different read. It is about a
                menu in this list, so it stands where its plan stood, and it
                names the menu. */}
            {said ? (
              <p role="status" className="cl-said" style={{ marginTop: 10 }} data-testid="menu-list-choice-said">
                {said}
              </p>
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

/**
 * The lines of a read that fit two or more of the house's own goods (r28
 * G21). The read guessed none, so each went to the library, and choosing the
 * menu would carry it as a good of its own beside the house's. An owner or a
 * manager links each to the good it is; anyone else is told who can. Said
 * right after the read: the goods are named in the read's reply only.
 */
export function SeveralGoods({
  menuId,
  items,
  canManage,
  onLinked,
}: {
  menuId: string
  items: MenuImportReviewItem[]
  canManage: boolean
  onLinked: () => void
}) {
  const several = items.filter((i) => (i.houseCandidates?.length ?? 0) > 1);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const link = useMutation({
    mutationFn: async (v: { item: MenuImportReviewItem; good: HouseCandidate }) =>
      linkMenuLineToHouseGood(menuId, v.item.menuItemId, v.good.inventoryItemId),
    onSuccess: (r, v) => {
      setLinked((m) => ({ ...m, [v.item.menuItemId]: r.goodName || v.good.name }));
      onLinked();
    },
  });
  // The last refusal, said on its own line until another link is tried.
  const refusedLine = link.isError ? link.variables?.item.menuItemId : undefined;
  if (several.length === 0) return null;
  const n = several.length;
  return (
    <div style={{ marginTop: 8 }} data-testid="menu-read-several-goods">
      <p className="cl-said">
        {n === 1 ? '1 line fits' : `${n} lines fit`} more than one of the house&apos;s goods, so none was linked.
        {canManage
          ? ' Choose the good each one is, before this menu is made current; otherwise it is carried as a good of its own.'
          : ' An owner or a manager chooses which good each one is; otherwise it is carried as a good of its own.'}
      </p>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {several.map((item) => (
          <li key={item.menuItemId} data-testid="menu-read-several-line" style={{ marginTop: 4 }}>
            <span>{item.name}</span>
            {linked[item.menuItemId] ? (
              <span role="status" className="cl-note" style={{ display: 'block' }} data-testid="menu-read-linked">
                Linked to {linked[item.menuItemId]}: choosing this menu carries its price there.
              </span>
            ) : (
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {(item.houseCandidates ?? []).map((good) =>
                  canManage ? (
                    <button
                      key={good.inventoryItemId}
                      type="button"
                      className="cl-btn cl-focus"
                      disabled={link.isPending}
                      onClick={() => link.mutate({ item, good })}
                      aria-label={`Link ${item.name} to ${good.name}`}
                    >
                      It is {good.name}{good.kind ? ` (${good.kind})` : ''}
                    </button>
                  ) : (
                    <span key={good.inventoryItemId} className="cl-chip">
                      {good.name}{good.kind ? ` (${good.kind})` : ''}
                    </span>
                  ),
                )}
              </span>
            )}
            {refusedLine === item.menuItemId ? (
              <span role="alert" className="cl-note" style={{ display: 'block' }} data-testid="menu-read-link-refused">
                It was not linked: {reasonOf(link.error).replace(/\.$/, '')}.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
