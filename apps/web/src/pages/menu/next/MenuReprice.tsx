/**
 * "Raise prices" on /menu (r108 menu-g9). A fold under the current menu's
 * table: a percent, a step to round to, the sections it moves, and a live
 * "before -> after" of the first five lines it moves, worked out by the same
 * arithmetic the gateway uses (menu-reprice.ts). Submitting makes a NEW draft
 * menu and opens its plan (MenuPlan), so the house's prices move only at
 * Make current, line by line, and the current menu stays as it was.
 *
 * The fold is the page's `.mdv-fold` (drop-zone.css): grid rows 0fr to 1fr,
 * and under reduced motion it opens with no transition at all (ADR 0112).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { repriceMenu, type MenuLine, type RepriceResult } from '../../../services/api/menus';
import { MenuPlan } from './MenuPlan';
import { REPRICE_STEPS, percentWords, repriceLine, repriceRefusal, sectionOf } from './menu-reprice';
import '../../../components/mudavym/drop-zone.css';

const PREVIEW_LINES = 5;

/** The sections of the menu in the order they first appear. */
export function sectionsOf(lines: Array<Pick<MenuLine, 'category'>>): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const s = sectionOf(l);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** The typed percent as a number: "7,5" and "+10" read as 7.5 and 10; anything else is NaN. */
export function typedPercent(text: string): number {
  const t = text.trim().replace(',', '.').replace(/^\+/, '');
  return t === '' || !/^-?\d+(\.\d+)?$/.test(t) ? Number.NaN : Number(t);
}

/** What the reply says, in one sentence. */
export function repriceSentence(r: RepriceResult): string {
  const parts = [`${r.changed} ${r.changed === 1 ? 'line' : 'lines'} with a new price`, `${r.unchanged} as they were`];
  if (r.heldOtherMoney > 0) parts.push(`${r.heldOtherMoney} priced in another money, left as printed`);
  return `Made the draft "${r.name}": ${parts.join(', ')}. No price has changed yet; the plan below shows what Make current would do.`;
}

function refusalWords(err: unknown): string {
  const d = (err as { response?: { data?: { message?: unknown; detail?: unknown } } })?.response?.data;
  const said = d?.detail ?? d?.message;
  if (typeof said === 'string' && said) return said;
  if (Array.isArray(said) && typeof said[0] === 'string') return said[0];
  return `The draft was not made (${err instanceof Error ? err.message : 'no reason given'}).`;
}

export function MenuReprice({
  menuId,
  lines,
  money,
}: {
  menuId: string;
  lines: MenuLine[];
  money: (v: number | null) => string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [percentText, setPercentText] = useState('');
  const [roundTo, setRoundTo] = useState<number>(0.5);
  const sections = useMemo(() => sectionsOf(lines), [lines]);
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [made, setMade] = useState<RepriceResult | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const percent = typedPercent(percentText);
  const chosen = sections.filter((s) => !off.has(s));
  const problem =
    percentText.trim() === ''
      ? null
      : repriceRefusal(percent, roundTo) ?? (chosen.length === 0 ? 'Choose at least one section.' : null);
  const preview = useMemo(() => {
    if (percentText.trim() === '' || repriceRefusal(percent, roundTo)) return [];
    return lines
      .filter((l) => chosen.includes(sectionOf(l)) && (l.bottle_price !== null || l.by_glass_price !== null))
      .slice(0, PREVIEW_LINES)
      .map((l) => ({ line: l, after: repriceLine(l, percent, roundTo, chosen) }));
  }, [lines, percent, percentText, roundTo, chosen]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || percentText.trim() === '' || problem) return;
    setBusy(true);
    setRefused(null);
    try {
      const r = await repriceMenu(menuId, {
        percent,
        roundTo,
        ...(chosen.length === sections.length ? {} : { sections: chosen }),
      });
      setMade(r);
      setSaid(repriceSentence(r));
      void queryClient.invalidateQueries({ queryKey: ['menu', 'versions'] });
    } catch (err) {
      setRefused(refusalWords(err));
    } finally {
      setBusy(false);
    }
  };

  const priceCell = (before: number | null, after: number | null) =>
    before === null ? null : `${money(before)} → ${money(after)}`;

  return (
    <section className="mdv-fold" style={{ marginTop: 12 }} data-testid="menu-reprice">
      <button
        type="button"
        className="mdv-link mdv-fold__cue"
        aria-expanded={open}
        aria-controls="menu-reprice-body"
        data-testid="menu-reprice-cue"
        onClick={() => setOpen((o) => !o)}
      >
        Raise prices
        <span className="mdv-fold__chev" aria-hidden />
      </button>
      <div id="menu-reprice-body" className="mdv-fold__body" data-open={open ? 'true' : 'false'}>
        <div className="mdv-fold__inner">
          <form onSubmit={submit} style={{ display: 'grid', gap: 10, paddingTop: 6 }} aria-label="Raise prices by a percent">
            <p className="cl-note" style={{ margin: 0 }}>
              Makes a new draft of this menu with its prices moved. Nothing changes until you make that draft current.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
              <label className="cl-note" style={{ display: 'grid', gap: 4 }}>
                Percent (−50 to +100)
                <input
                  className="cl-input cl-focus"
                  inputMode="decimal"
                  value={percentText}
                  onChange={(e) => setPercentText(e.target.value)}
                  placeholder="10"
                  style={{ width: 96, minHeight: 44 }}
                  data-testid="menu-reprice-percent"
                />
              </label>
              <label className="cl-note" style={{ display: 'grid', gap: 4 }}>
                Round to
                <select
                  className="cl-input cl-focus"
                  value={String(roundTo)}
                  onChange={(e) => setRoundTo(Number(e.target.value))}
                  style={{ minHeight: 44 }}
                  data-testid="menu-reprice-round"
                >
                  {REPRICE_STEPS.map((s) => (
                    <option key={s} value={String(s)}>
                      {s < 1 ? s.toFixed(2) : String(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {sections.length > 1 ? (
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <legend className="cl-note" style={{ marginBottom: 4 }}>
                  Sections it moves
                </legend>
                {sections.map((s) => (
                  <label key={s || '(none)'} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
                    <input
                      type="checkbox"
                      checked={!off.has(s)}
                      onChange={() =>
                        setOff((prev) => {
                          const next = new Set(prev);
                          if (next.has(s)) next.delete(s);
                          else next.add(s);
                          return next;
                        })
                      }
                      data-testid="menu-reprice-section"
                    />
                    {s || 'No section'}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {problem ? (
              <p role="alert" className="cl-said" style={{ margin: 0 }} data-testid="menu-reprice-problem">
                {problem}
              </p>
            ) : null}
            {preview.length > 0 ? (
              <table className="cl-table" style={{ width: '100%' }} aria-label={`Prices ${percentWords(percent)}, first lines`} data-testid="menu-reprice-preview">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Bottle</th>
                    <th scope="col">Glass</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map(({ line, after }) => (
                    <tr key={line.id} data-testid="menu-reprice-preview-row">
                      <td>{line.name}</td>
                      <td>{priceCell(line.bottle_price, after.bottle_price) ?? '—'}</td>
                      <td>{priceCell(line.by_glass_price, after.by_glass_price) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <div>
              <button
                type="submit"
                className="cl-btn cl-focus"
                style={{ minHeight: 44 }}
                disabled={busy || percentText.trim() === '' || problem !== null}
                data-testid="menu-reprice-go"
              >
                {busy ? 'Making the draft…' : 'Make a draft with these prices'}
              </button>
            </div>
            {refused ? (
              <p role="alert" className="cl-said" style={{ margin: 0 }} data-testid="menu-reprice-refused">
                {refused}
              </p>
            ) : null}
          </form>
        </div>
      </div>
      {said ? (
        <p role="status" className="cl-said" style={{ marginTop: 8 }} data-testid="menu-reprice-said">
          {said}
        </p>
      ) : null}
      {made ? (
        <MenuPlan
          key={made.menuId}
          menuId={made.menuId}
          canManage
          onCancel={() => {
            setMade(null);
            setSaid(`The draft "${made.name}" is kept under Menus kept; no price changed.`);
          }}
          onDone={() => {
            setMade(null);
            setOpen(false);
            setPercentText('');
            setSaid(`"${made.name}" is the current menu now.`);
            void queryClient.invalidateQueries({ queryKey: ['menu'] });
          }}
        />
      ) : null}
    </section>
  );
}
