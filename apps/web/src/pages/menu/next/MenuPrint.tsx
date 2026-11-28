/**
 * `/menu/print` — the current menu laid out for the guests, to print (r110 menu-g3).
 *
 * Once a price changes, a printed menu is wrong; this prints the menu as it is now. It reads
 * the active house's current menu through the same read `/menu` uses (`getMenu`; the gateway
 * pages its lines by keyset past 1000 rows), in printed order (`line_no` when the line has
 * one, else the order received), under its own sections, kitchen lines included. Money is
 * the house's, through the same formatter `/menu` uses; a line with no price prints none,
 * never 0. The house comes from the signed-in member's active house, never from the URL.
 * Any member may print (the menu is public); no raw line is drawn.
 *
 * It refuses, in words, while the current menu has prices still to carry to the house (the
 * plan's `change` + `new_wine`, the count `/menu` calls "Finish carrying N prices"), or when
 * that could not be checked: the printed price must be the till's.
 *
 * A static page: no motion. It prints itself once the fonts are ready (`document.fonts.ready`).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { getMenu, getMenuPlan, listMenuVersions, type MenuLine } from '../../../services/api/menus';
import { formatMoney } from '@/lib/currency';
import { useHouseCurrencyRead } from './house-currency';
import { houseDay } from './menu-clock';
import './menu-print.css';

type PrintSize = { label: string; ml?: number | null; price: number | string };
/** The fields a line may carry from a newer gateway (printed place, printed sizes). */
type PrintLine = MenuLine & { line_no?: number | null; printed_sizes?: PrintSize[] | null };

export interface PrintSection {
  heading: string | null;
  lines: PrintLine[];
}

/**
 * The lines in printed order, grouped under their sections in the order each section is
 * first printed. A line with no section joins an untitled one. Exported for the spec.
 */
export function printedSections(lines: PrintLine[]): PrintSection[] {
  const placed = lines
    .map((line, at) => ({ line, at }))
    .sort((a, b) => {
      const pa = typeof a.line.line_no === 'number' ? a.line.line_no : null;
      const pb = typeof b.line.line_no === 'number' ? b.line.line_no : null;
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
      if (pa !== null && pb === null) return -1;
      if (pa === null && pb !== null) return 1;
      return a.at - b.at;
    });
  const out: PrintSection[] = [];
  const index = new Map<string, PrintSection>();
  for (const { line } of placed) {
    const heading = (line.category ?? '').trim() || null;
    const key = heading?.toLocaleLowerCase('tr') ?? '';
    let section = index.get(key);
    if (!section) {
      section = { heading, lines: [] };
      index.set(key, section);
      out.push(section);
    }
    section.lines.push(line);
  }
  return out;
}

/**
 * The prices a line prints: the till's glass and bottle prices, always. Its other printed sizes
 * go with them only when every glass and bottle price the line has appears among them unchanged;
 * a correction or a "Raise prices" leaves `printed_sizes` as the import wrote it, so a size that
 * no longer agrees with the till is left off the paper (r110 review R3). Never 0 for none.
 */
export function printedPrices(line: PrintLine, currency: string | null): string[] {
  const glass = line.by_glass_price;
  const bottle = line.bottle_price;
  const till = [glass, bottle].filter((p) => p !== null && p !== undefined).map(Number);
  const sizes = (line.printed_sizes ?? []).filter((s) => s && s.label && Number.isFinite(Number(s.price)));
  const agree = till.length > 0 && till.every((t) => sizes.some((s) => Math.abs(Number(s.price) - t) < 0.005));
  if (sizes.length >= 2 && agree) return sizes.map((s) => `${s.label} ${formatMoney(Number(s.price), currency)}`);
  const out: string[] = [];
  if (glass !== null && glass !== undefined) out.push(`Glass ${formatMoney(glass, currency)}`);
  if (bottle !== null && bottle !== undefined) out.push(glass !== null && glass !== undefined ? `Bottle ${formatMoney(bottle, currency)}` : formatMoney(bottle, currency));
  return out;
}

function said(err: unknown): string {
  const e = err as { response?: { data?: { message?: unknown } }; message?: string };
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m.trim()) return m;
  return 'no answer came back';
}

export default function MenuPrint() {
  const { activeRestaurantId, availableRestaurants } = useAuth();
  const house = activeRestaurantId ?? null;
  const menu = useQuery({
    queryKey: ['menu', 'active', house],
    enabled: Boolean(house),
    queryFn: () => getMenu(house as string),
  });
  const menuId = menu.data?.menuId ?? null;
  const plan = useQuery({
    queryKey: ['menu', 'plan', menuId],
    enabled: Boolean(menuId),
    queryFn: () => getMenuPlan(menuId as string),
    retry: false,
  });
  const versions = useQuery({
    queryKey: ['menu', 'versions', house],
    enabled: Boolean(house),
    queryFn: listMenuVersions,
    retry: false,
  });
  const money = useHouseCurrencyRead(house);
  const currency = money.code;

  const toCarry = plan.data ? (plan.data.counts.change ?? 0) + (plan.data.counts.new_wine ?? 0) : null;
  const lines = (menu.data?.items ?? []) as PrintLine[];
  const sections = useMemo(() => printedSections(lines), [lines]);
  const houseName = availableRestaurants?.find((r) => r.id === house)?.name ?? null;
  const since = versions.data?.current?.madeCurrentAt
    ? houseDay(versions.data.current.madeCurrentAt, versions.data.timezone ?? null)
    : null;
  // The page prints itself once ready, so money is drawn only when the house's currency is known: without it
  // formatMoney writes "(currency not recorded)" beside every price, and that must not reach the paper.
  const ready = menu.isSuccess && lines.length > 0 && toCarry === 0 && money.settled && currency !== null;

  // Only this page prints: the app around it is hidden from the printer.
  useEffect(() => {
    document.body.classList.add('mdv-print-menu');
    return () => document.body.classList.remove('mdv-print-menu');
  }, []);
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current) return;
    let live = true;
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    void fonts.then(() => {
      if (!live || printed.current) return;
      printed.current = true;
      window.print();
    });
    return () => {
      live = false;
    };
  }, [ready]);

  let refusal: string | null = null;
  if (!house) refusal = 'This session is not attached to a house, so there is no menu to print.';
  else if (menu.isError) refusal = `The current menu could not be read (${said(menu.error)}). Nothing was printed.`;
  else if (menu.isSuccess && !menuId) refusal = 'This house has no current menu yet, so there is nothing to print.';
  else if (menu.isSuccess && lines.length === 0) refusal = 'The current menu has no lines, so there is nothing to print.';
  else if (plan.isError)
    refusal = `Whether every price has reached the house could not be checked (${said(plan.error)}). Print once it can, so the printed price is the till's.`;
  else if (menu.isSuccess && money.failed)
    refusal = `The house's currency could not be read (${said(money.error)}). Nothing was printed, so no price goes on paper without its currency.`;
  else if (menu.isSuccess && money.settled && currency === null)
    refusal = "This house has no currency set, so a price would print without one. Set the house's currency first, then print.";
  else if (toCarry !== null && toCarry > 0)
    refusal = `${toCarry} ${toCarry === 1 ? 'price is' : 'prices are'} still being carried to the house; print once they are, so the printed price is the till's.`;

  return (
    <div className="mdv-menu-print-page">
      <div className="mdv-menu-print-bar">
        <a className="cl-btn cl-focus" href="/menu">Back to the menu</a>
        {ready ? (
          <button type="button" className="cl-btn cl-focus" onClick={() => window.print()}>
            Print again
          </button>
        ) : null}
      </div>
      {refusal ? (
        <p role="alert" className="cl-said" data-testid="menu-print-refused">
          {refusal}
        </p>
      ) : !ready ? (
        <p role="status" className="cl-said">
          Getting the current menu ready to print…
        </p>
      ) : (
        <article className="mdv-menu-print" aria-label="The menu, to print">
          {sections.map((section, si) => (
            <section key={si} className="mdv-menu-print__section">
              {section.heading ? <h2 className="mdv-menu-print__heading">{section.heading}</h2> : null}
              <ul className="mdv-menu-print__lines">
                {section.lines.map((line) => {
                  const prices = printedPrices(line, currency);
                  const marks = (line.printed_marks ?? []).filter(Boolean);
                  return (
                    <li key={line.id} className="mdv-menu-print__line" data-testid="menu-print-line">
                      <div className="mdv-menu-print__row">
                        <span className="mdv-menu-print__name">
                          {line.name}
                          {marks.length > 0 ? <span className="mdv-menu-print__marks"> {marks.join(' ')}</span> : null}
                        </span>
                        {prices.length > 0 ? (
                          <span className="mdv-menu-print__price" data-testid="menu-print-price">
                            {prices.join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      {line.description ? <p className="mdv-menu-print__desc">{line.description}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <footer className="mdv-menu-print__foot" data-testid="menu-print-foot">
            {`Menu of ${houseName ?? 'this house'}${since ? `, current since ${since}` : ''}.`}
          </footer>
        </article>
      )}
    </div>
  );
}
