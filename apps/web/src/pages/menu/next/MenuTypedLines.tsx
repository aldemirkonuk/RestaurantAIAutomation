/**
 * r41 R1: a menu typed on /menu. Before this, a typed menu existed only in
 * owner onboarding (GetStarted), and /menu's Add to menu needs a menu that is
 * already current, so a manager, or an owner past onboarding, could never type
 * one. The typed lines go through the same read box as a file: they are kept as
 * a menu, not current, and get the same plan and Make current.
 *
 * Prices are sent as typed. The gateway reads them with parseMenuPrice, the
 * reader of the Add form and Change price, so "45,50" is 45.5 and "1.250" is
 * refused with both readings. The page never reads a price itself.
 */
import type { TypedMenuLine } from '../../../services/api/menus';

export interface TypedRow {
  key: number;
  name: string;
  category: string;
  glass: string;
  bottle: string;
}

let nextKey = 0;
export function emptyRow(): TypedRow {
  nextKey += 1;
  return { key: nextKey, name: '', category: '', glass: '', bottle: '' };
}

const blank = (r: TypedRow) => !r.name.trim() && !r.category.trim() && !r.glass.trim() && !r.bottle.trim();
/** Whether anything is typed yet: before that, nothing is refused aloud. */
export const anyTyped = (rows: readonly TypedRow[]) => rows.some((r) => !blank(r));

/**
 * The lines to send: an empty row is left out, a row with something in it but
 * no name is refused with the line number the person sees.
 */
export function typedLines(rows: readonly TypedRow[]): { lines: TypedMenuLine[]; refusal: string | null } {
  const lines: TypedMenuLine[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (blank(r)) continue;
    const name = r.name.trim();
    if (!name) return { lines: [], refusal: `Line ${i + 1} has no name. Give it one, or leave it out.` };
    const line: TypedMenuLine = { name };
    if (r.category.trim()) line.category = r.category.trim();
    if (r.glass.trim()) line.by_glass_typed = r.glass.trim();
    if (r.bottle.trim()) line.bottle_typed = r.bottle.trim();
    lines.push(line);
  }
  if (lines.length === 0) return { lines, refusal: 'Type at least one line with a name first.' };
  return { lines, refusal: null };
}

export function MenuTypedLines({ rows, onChange, refusal }: {
  rows: TypedRow[];
  onChange: (rows: TypedRow[]) => void;
  /** Why these lines cannot be read yet, said once something is typed. */
  refusal: string | null;
}) {
  const set = (key: number, field: keyof Omit<TypedRow, 'key'>, value: string) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  return (
    <div data-testid="menu-typed-lines" style={{ width: '100%' }}>
      <table className="cl-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Section</th>
            <th>Glass</th>
            <th>Bottle</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} data-testid="menu-typed-line">
              <td>
                <input
                  className="cl-field cl-focus"
                  aria-label={`Line ${i + 1} name`}
                  placeholder={i === 0 ? "What's on the menu" : undefined}
                  value={r.name}
                  onChange={(e) => set(r.key, 'name', e.target.value)}
                  style={{ minWidth: 160 }}
                />
              </td>
              <td>
                <input
                  className="cl-field cl-focus"
                  aria-label={`Line ${i + 1} section`}
                  placeholder={i === 0 ? 'e.g. Reds' : undefined}
                  value={r.category}
                  onChange={(e) => set(r.key, 'category', e.target.value)}
                  style={{ width: 110 }}
                />
              </td>
              <td>
                <input
                  className="cl-field cl-focus cl-num"
                  aria-label={`Line ${i + 1} glass price`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={r.glass}
                  onChange={(e) => set(r.key, 'glass', e.target.value)}
                  style={{ width: 80 }}
                />
              </td>
              <td>
                <input
                  className="cl-field cl-focus cl-num"
                  aria-label={`Line ${i + 1} bottle price`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={r.bottle}
                  onChange={(e) => set(r.key, 'bottle', e.target.value)}
                  style={{ width: 80 }}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="cl-btn cl-focus"
                  aria-label={`Leave line ${i + 1} out`}
                  disabled={rows.length === 1}
                  onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                >
                  Leave out
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {refusal && anyTyped(rows) ? (
        <p role="status" className="cl-said" style={{ marginTop: 6 }} data-testid="menu-typed-refused">
          {refusal}
        </p>
      ) : null}
      <button type="button" className="cl-btn cl-focus" style={{ marginTop: 8 }} onClick={() => onChange([...rows, emptyRow()])}>
        Another line
      </button>
      <p className="cl-note" style={{ marginTop: 6 }}>
        Prices are read as you write them, in the house's money: 45,50 or 1.250,00. A dish takes one price; put it under
        Bottle.
      </p>
    </div>
  );
}
