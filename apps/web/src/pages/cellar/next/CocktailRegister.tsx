/**
 * Cocktails — the one register of this cellar a house can actually write.
 *
 * WHY THIS ONE AND NOT THE OTHERS. `public.cocktails` carries a `restaurant_id`
 * (20260817090000_cocktails.sql:28). `public.beverages` does not
 * (20260817070000_beverages_table.sql:217). So a house can own a cocktail and
 * cannot own a catalogue row, and this is the only register with an add button
 * — everywhere else the absence of one is the honest answer rather than an
 * oversight.
 *
 * THE RECIPE. A drink's recipe is its own sheet (`recipe/RecipeSheet.tsx`,
 * ADR 0360): each ingredient linked to something on the house's shelf, a cost
 * a serve at today's prices, and every save a new version. It replaced a text
 * box whose lines a regex split into words that linked to nothing and cost
 * nothing.
 *
 * TWO BOOKS, NOT ONE. The house's cocktail list is `public.cocktails`. What the
 * house's OTHER books say about cocktails — menu lines, till lines — is the
 * ledger, and it is shown apart rather than merged. The menu reaches the list
 * in two ways, both matched by name on the server: the Menu column gives a
 * listed drink its menu price, and MenuDrinksOffer puts a menu cocktail not
 * listed yet onto the list (r36 recipes audit, gap 3).
 *
 * NO SEAL HERE. The house ceremony is rationed to one act on this page: the
 * hold that sends a real purchase order to a vendor. Retiring a cocktail is
 * deliberate and reversible-by-re-adding, so it gets the same die pressed dry —
 * a two-step confirm, no wax (MOTIONS.md, "Deliberate non-motions").
 */

import { useEffect, useRef, useState } from 'react';
import { useSortFlip } from './useSortFlip';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  BOOK_LABEL,
  BOOK_ORDER,
  EM,
  count,
  shortDate,
  type HouseBookId,
} from './cellar-format';
import RecipeSheet from './recipe/RecipeSheet';
import RecipeBook from './recipe/RecipeBook';
import { COPY_CANNOT_CARRY, COPY_RECIPE_FAILED, copyFields, copyRefused, copySaid, type CopySource } from './recipe/copyDrink';
import MenuDrinksOffer from './MenuDrinksOffer';
import LooseLines from './recipe/LooseLines';
import SwapGood from './recipe/SwapGood';
import { readingRowCount } from './readingRows';
import { PRICE_UNREAD, priceText, readPrice } from './recipe/price-text';
import { ShareBasisCaption, ShareFigure, marginPerServe, pourCostShare } from './recipe/DrinkCards';
import { ExportMenu } from '../../../components/ui/ExportMenu';
import { exportTable, type TableExportFormat } from '../../../lib/tableExport';
import { FIRST_DIR, drinkNumbers, exportColumns, sortDrinks, stripFor, stripSaid, type SortDir, type SortKey } from './registerFigures';
import { useListTax } from './recipe/useListTax';
import type { ListTax } from './recipe/listTax';
import { useCanEditRecipe, useDrinkFigures, useHouseMoney, useMenuPrices } from './recipe/useRecipe';
import { AllergenCell, AllergenCheck, keptFor } from './recipe/ListAllergens';
import { CostWaits, NoCostYet, NoRecipeYet, costNotKnown } from './recipe/ListCostWaits';
import { MENU_PRICES_UNREAD, MenuPriceCell } from './recipe/MenuPriceCell';
import UseMenuPrice from './recipe/UseMenuPrice';
import { useHousePercent, type SayPercent } from './recipe/useHousePercent';
import type { DrinkFigureRow } from '../../../services/api/recipes';
import { SHEET_HOLD_ROOM } from './recipe/holdRoom';
import {
  useCocktailManages,
  useCocktailRegister,
  useCocktailWrites,
  type CocktailInput,
  type RegisterVM,
} from './useCellarNextData';

interface Draft extends Omit<CocktailInput, 'price'> {
  name?: string;
  /**
   * The price box as typed. A number field read "12,50" as empty and saved the
   * drink unpriced without a word; the text is read by `readPrice` on save.
   */
  priceText?: string;
}

function Field({
  id, label, value, onChange, placeholder, type = 'text', inputMode, invalid, describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'decimal';
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <label htmlFor={id} className="cl-dim" style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <input
        id={id}
        className="cl-field cl-focus"
        type={type}
        inputMode={inputMode}
        autoComplete={inputMode ? 'off' : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/** Said under a cost some of whose lines are priced from part of the stock only. */
const PARTLY_INVOICED = 'partly invoiced';

/** Said above the list when its costs could not be read. */
const DRINK_COSTS_UNREAD = 'The drinks’ costs could not be read just now, so none is shown.';

/** Said above the list, to every role, when the figures that carry the allergens could not be read. */
export const DRINK_ALLERGENS_UNREAD = 'The drinks’ allergens could not be read just now, so none is shown.';

/**
 * A drink's cost a serve and pour cost cells (r28 recipes audit, gap 9), as
 * the dish list writes a dish's: an incomplete cost is "Not known", never a
 * smaller figure; a cost priced from part of the stock says so under it.
 * Unread figures are said once above the list, and the cells stay blank.
 */
function drinkCells(
  id: string,
  price: number | null,
  f: DrinkFigureRow | undefined,
  read: boolean,
  say: (n: number | null | undefined) => string,
  sayPct: SayPercent,
  tax: ListTax,
) {
  const dim = <span className="cl-dim">{EM}</span>;
  if (!read || !f || !f.hasRecipe) return { cost: dim, share: dim, margin: dim };
  const per = f.cost?.complete ? f.cost.perServe : null;
  const part = f.cost?.partial ?? 0;
  const share = pourCostShare(f.cost, price, tax);
  const m = marginPerServe(f.cost, price, tax);
  return {
    cost:
      per == null ? (
        <>
          Not known
          <CostWaits id={id} cost={f.cost} />
        </>
      ) : part > 0 ? (
        <>
          {say(per)}
          <span className="cl-dim" style={{ display: 'block', fontSize: 11 }} data-testid={`drink-partly-${id}`}>
            {PARTLY_INVOICED}
          </span>
        </>
      ) : (
        say(per)
      ),
    share: 'pct' in share ? <ShareFigure text={sayPct(share.pct)} tax={tax} /> : 'Not known',
    margin: 'margin' in m ? (m.margin < 0 ? `\u2212${say(-m.margin)}` : say(m.margin)) : 'Not known',
  };
}

/** Room below an opened recipe's top edge for its heading and first line, in px. */
export const LEAF_HEAD_ROOM = 160;

/**
 * Scrolls an opened recipe to the top of the screen when its heading would
 * not be seen: above the screen, or below `innerHeight - LEAF_HEAD_ROOM`. A
 * recipe already in view does not move the page. Measured on its top edge,
 * not its height: it is still opening (0 tall) when this runs.
 */
export function bringIntoView(el: HTMLElement | null) {
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top <= window.innerHeight - LEAF_HEAD_ROOM) return;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
}

/* ── the register ───────────────────────────────────────────────────────── */

export default function CocktailRegister({
  register,
  registerLoading,
}: {
  /** The ledger side: what this house's OTHER books say about cocktails. */
  register: RegisterVM | null;
  registerLoading: boolean;
}) {
  const { data, loading, error } = useCocktailRegister(true);
  const { create, amend, retire, copy } = useCocktailWrites();
  // Recording, amending and retiring a cocktail are an owner's or a manager's;
  // the gateway refuses them to staff with 403, so staff are not offered them.
  const manages = useCocktailManages();
  // The house's money, as the drink's own cards print it: the cellar's
  // `money()` wrote $ for every house, so a lira list read "$14.00" beside
  // cards that read "₺14.00" (r7 browser check, 2026-11-12).
  const money = useHouseMoney();
  // Cost and pour cost are the house's money: shown, and read, only for a
  // role that may change a recipe (the same rule as the dish list).
  const seesCost = useCanEditRecipe();
  // Read for every role: the figures carry each drink's allergens, which are
  // not money (the gateway sends staff no price and no cost).
  const figures = useDrinkFigures(true);
  // The current menu's price beside the drink's own (r28 recipes audit, gap 2).
  const menu = useMenuPrices('drink', seesCost);
  const showMenu = Boolean(seesCost && menu.byId && (menu.currentMenus ?? 0) > 0);
  const sayPct = useHousePercent();
  const tax = useListTax();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // The drink the open form is a copy of: nothing is written until Save.
  const [copyOf, setCopyOf] = useState<CopySource | null>(null);
  // /cocktails?open=<id> opens that drink: the inventory drawer's "used in"
  // lines link here, so a good leads to the drink that uses it, and the drink
  // opens on its cards and its nutrition card.
  const [params, setParams] = useSearchParams();
  const openParam = params.get('open');
  const [openId, setOpenId] = useState<string | null>(openParam);
  // A second link followed while already on /cocktails changes only the search:
  // the page stays mounted, so the drink it names is opened here, not at mount alone.
  useEffect(() => {
    if (openParam) setOpenId(openParam);
  }, [openParam]);
  // Closing the linked drink, or opening another, takes `open` out of the
  // address. Left in, the address would name a drink that is not open, and the
  // same link followed again would change nothing and open nothing.
  const toggleOpen = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (openParam && next !== openParam) {
      setParams((prev) => {
        const kept = new URLSearchParams(prev);
        kept.delete('open');
        return kept;
      }, { replace: true });
    }
  };
  const leafRef = useRef<HTMLDivElement | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // A line about the last save or refusal is about the form as it was; opening,
  // typing in or leaving the form again takes it away (as /dishes does).
  const changeDraft = (next: Draft | null) => {
    setSaid(null);
    setDraft(next);
  };
  const [query, setQuery] = useState('');
  const [allergen, setAllergen] = useState('');
  const [onlyBare, setOnlyBare] = useState(false);
  const [onlyUncosted, setOnlyUncosted] = useState(false);

  // A link to a drink this house's list does not hold is said, not ignored.
  const linkedRow = openParam ? (data?.rows ?? []).find((c) => c.id === openParam) ?? null : null;
  const linkedMissing = Boolean(openParam && data && !linkedRow);

  const searched = (data?.rows ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.display_name, c.menu_section, c.method, c.glass]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  const byAllergen = searched.filter((c) => keptFor(figures.byId?.get(c.id)?.allergens, allergen));
  // Which drinks have no recipe: known only once the figures are read.
  const bareIds = figures.byId ? (data?.rows ?? []).filter((c) => !figures.byId?.get(c.id)?.hasRecipe).map((c) => c.id) : [];
  // Drinks with a recipe whose cost is not known (a line has no price). Said only once the figures are read.
  const uncostedIds =
    figures.byId && !figures.costsUnread
      ? (data?.rows ?? []).filter((c) => {
          const f = figures.byId?.get(c.id);
          return Boolean(f?.hasRecipe) && costNotKnown(f?.cost);
        }).map((c) => c.id)
      : [];
  // A switch narrows the list only while what it narrows by is read: unread, the list stays whole and the switch says so.
  const figuresRead = Boolean(figures.byId);
  const costsRead = figuresRead && !figures.costsUnread;
  const rows = !seesCost
    ? byAllergen
    : onlyBare && figuresRead
      ? byAllergen.filter((c) => bareIds.includes(c.id))
      : onlyUncosted && !onlyBare && costsRead
        ? byAllergen.filter((c) => uncostedIds.includes(c.id))
        : byAllergen;
  const figuresRead = Boolean(figures.byId) && !figures.costsUnread;
  const numbersOf = (c: (typeof rows)[number]) => drinkNumbers(c.price ?? null, figures.byId?.get(c.id), figuresRead, tax);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);
  // Rows that stay slide when a filter or the search changes the row set, as they do for a sort (r108 DD-r108-33):
  // `before()` runs in the change, and the set's ids join the key so the layout effect runs once the new rows are drawn.
  const flip = useSortFlip(bodyRef, `${sort?.key ?? ''}:${sort?.dir ?? ''}:${rows.map((c) => c.id).join(',')}`);
  const slid = <T,>(set: (v: T) => void) => (v: T) => { flip.before(); set(v); };
  const pressSort = (key: SortKey) => {
    flip.before();
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: FIRST_DIR[key] };
      if (cur.dir === FIRST_DIR[key]) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return null;
    });
  };
  const shown = sortDrinks(rows, sort?.key ?? null, sort?.dir ?? 'asc', numbersOf);
  const strip = stripFor(rows.map(numbersOf), tax);
  const sortHead = (key: SortKey, label: string) => (
    <th scope="col" style={{ textAlign: 'right' }} aria-sort={sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="cl-sort cl-focus" onClick={() => pressSort(key)} data-testid={`sort-${key}`}>
        {label}
        <span aria-hidden className="cl-sort-mark">{sort?.key === key ? (sort.dir === 'asc' ? '\u2191' : '\u2193') : ''}</span>
      </button>
    </th>
  );
  const exportList = (format: TableExportFormat) =>
    exportTable({
      format,
      rows: shown.map((c) => ({ ...c, numbers: numbersOf(c) })),
      columns: exportColumns(seesCost),
      filename: 'cocktails',
      title: 'Cocktails',
    });
  const openShown = Boolean(openId && rows.some((x) => x.id === openId));
  // A drink a link named opens only once the table under it has laid out: the
  // stand first draws closed, then (after a forced style flush, so the change is
  // seen as a change) opens with its own settle. The page then reads as one
  // entrance, table then leaf, not a table and a leaf in the same frame. A click
  // is the person's own act and opens at once. `steady` is the settle done; the
  // books below the leaf stay unseen until then, so they are not seen to move.
  const [linked] = useState(Boolean(openParam));
  const [laid, setLaid] = useState(!linked);
  const [steady, setSteady] = useState(!linked);
  const standRef = useRef<HTMLDivElement | null>(null);
  const listed = !loading && Boolean(data);
  useEffect(() => {
    if (laid || !listed) return;
    standRef.current?.getBoundingClientRect();
    setLaid(true);
  }, [laid, listed]);
  useEffect(() => {
    if (!laid || steady) return;
    const t = setTimeout(() => setSteady(true), 300);
    return () => clearTimeout(t);
  }, [laid, steady]);
  // The books below the list (and, by data-settling, the signature) also wait
  // for the menu-and-till read: it lands after the list, and the ledger grows
  // from its one-line "Reading..." to the sentence and table, which pushed the
  // signature down as a shift (CLS 0.235 at 375, perf-p8-4). Unseen they hold
  // their room, so the growth is out of sight; a failed read is not "loading",
  // so it still says it failed.
  const settling = loading || registerLoading || (linked && listed && !steady);
  // The recipe opens below the whole list, so a drink opened by a click (or a
  // link) is brought into view whenever its heading would land off the screen;
  // otherwise a click on a top row of a long list seemed to do nothing
  // (r41 recipes audit, gap 7). Once per drink opened, not on every render.
  const shownId = openShown ? openId : null;
  useEffect(() => {
    if (shownId) bringIntoView(leafRef.current);
  }, [shownId]);

  const priceRead = readPrice(draft?.priceText ?? '');

  const submit = async () => {
    if (!draft?.name?.trim() || priceRead.bad) return;
    const { priceText: _typed, ...fields } = draft;
    if (copyOf) return saveCopy(copyOf, priceRead.price == null ? fields : { ...fields, price: priceRead.price });
    try {
      if (editId) {
        // An amend sends the price it reads, null included: a cleared box
        // takes the price off (undefined was dropped from the body, so the
        // old price stayed while the form said it was amended).
        await amend.mutateAsync({ id: editId, input: { ...fields, price: priceRead.price } });
        setSaid(`“${draft.name.trim()}” was amended on this house’s list.`);
      } else {
        // A new drink with no price sends none: unpriced, never 0.
        await create.mutateAsync(priceRead.price == null ? fields : { ...fields, price: priceRead.price });
        setSaid(`“${draft.name.trim()}” is on this house’s list.`);
      }
      setDraft(null);
      setEditId(null);
    } catch (e) {
      setSaid(
        `Nothing was written${e instanceof Error ? ` — ${e.message}` : ''}. The list is unchanged.`,
      );
    }
  };

  // Copy: the form opens first, on the copy's own name ("Gimlet copy") with the
  // source's section, glass, method and garnish and no price. Nothing is written
  // until Save; Leave it writes nothing (r107 drinks walk F6: writing first left
  // a stray "Gimlet copy" behind a Leave it).
  const doCopy = (c: (typeof rows)[number]) => {
    setEditId(null);
    setCopyOf(c);
    changeDraft({ ...copyFields(c), priceText: '' });
  };

  // Save on a copy: the new drink, then its recipe (two writes). A refused
  // first write leaves the form open and the list unchanged; a refused recipe
  // keeps the drink and says so.
  const saveCopy = async (src: CopySource, input: CocktailInput) => {
    const from = src.display_name ?? src.name;
    try {
      const out = await copy.mutateAsync({ src, input });
      setDraft(null);
      setCopyOf(null);
      if (out.state === 'cannot') return setSaid(COPY_CANNOT_CARRY);
      setSaid(out.state === 'recipe_failed' ? COPY_RECIPE_FAILED : copySaid((input.name ?? '').trim(), from));
      setOpenId(out.id);
    } catch (e) {
      setSaid(copyRefused(e instanceof Error ? e.message : null));
    }
  };

  const doRetire = async (id: string, name: string) => {
    try {
      await retire.mutateAsync(id);
      setSaid(
        `“${name}” is off the list. The row was dated, not deleted — a cocktail that came off in September is a fact about the season.`,
      );
    } catch (e) {
      setSaid(`“${name}” was NOT retired${e instanceof Error ? ` — ${e.message}` : ''}.`);
    } finally {
      setConfirmRetire(null);
    }
  };

  return (
    <div className="cl-cocktails" data-testid="cocktail-register" data-settling={settling ? 'true' : undefined}>
      <div className="cl-row-controls">
        <label htmlFor="cl-ck-search" className="cl-sr">Search this house’s cocktails</label>
        <input
          id="cl-ck-search"
          className="cl-field cl-focus"
          type="search"
          placeholder="Search cocktail, section, method…"
          value={query}
          onChange={(e) => { flip.before(); setQuery(e.target.value); }}
          style={{ minWidth: 220, flex: '1 1 220px' }}
        />
        {manages ? (
          <button
            type="button"
            className="cl-btn cl-focus"
            data-on={draft !== null && editId === null && copyOf === null}
            onClick={() => {
              changeDraft(draft && editId === null && copyOf === null ? null : {});
              setEditId(null);
              setCopyOf(null);
            }}
            style={{ marginLeft: 'auto' }}
          >
            <Plus size={13} aria-hidden />
            Add a cocktail
          </button>
        ) : null}
      </div>
      {manages ? null : (
        <p className="cl-note" data-testid="cocktail-who-writes">
          An owner or a manager keeps this list: adding, amending or taking a
          cocktail off, and writing its recipe, are theirs.
        </p>
      )}

      {said ? <p className="cl-note" role="status" data-testid="cocktail-said">{said}</p> : null}

      {seesCost ? <MenuDrinksOffer /> : null}
      {/* Every drink's lines with no shelf good, in one queue (r108 drinks-g9); owners and managers. */}
      <LooseLines manages={manages} />
      {/* Swap one good for another in every drink (r108 drinks-g10); owners and managers. */}
      <SwapGood manages={manages} />

      {draft && manages ? (
        <div className="cl-panel" style={{ marginTop: 12 }} data-testid="cocktail-draft">
          <h3 className="cl-h2" style={{ fontSize: 19 }}>
            {editId
              ? 'Amend this cocktail'
              : copyOf
                ? `A copy of “${copyOf.display_name ?? copyOf.name}”`
                : 'A cocktail on this house’s list'}
          </h3>
          <div
            style={{
              display: 'grid', gap: 10, marginTop: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            <Field id="ck-name" label="Name" value={draft.name ?? ''} onChange={(v) => changeDraft({ ...draft, name: v })} placeholder="Negroni" />
            <Field id="ck-section" label="Section" value={draft.menuSection ?? ''} onChange={(v) => changeDraft({ ...draft, menuSection: v })} placeholder="Aperitivo" />
            <Field id="ck-method" label="Method" value={draft.method ?? ''} onChange={(v) => changeDraft({ ...draft, method: v })} placeholder="Stirred" />
            <Field id="ck-glass" label="Glass" value={draft.glass ?? ''} onChange={(v) => changeDraft({ ...draft, glass: v })} placeholder="Rocks" />
            <Field id="ck-garnish" label="Garnish" value={draft.garnish ?? ''} onChange={(v) => changeDraft({ ...draft, garnish: v })} placeholder="Orange peel" />
            <Field
              id="ck-price" label="Price" inputMode="decimal"
              value={draft.priceText ?? ''}
              onChange={(v) => changeDraft({ ...draft, priceText: v })}
              placeholder="leave blank if unpriced"
              invalid={priceRead.bad}
              describedBy={priceRead.bad ? 'ck-price-said' : undefined}
            />
          </div>
          {priceRead.bad ? (
            <p id="ck-price-said" className="cl-note" role="alert">{PRICE_UNREAD}</p>
          ) : null}
          <p className="cl-note">
            A blank price is unpriced — it is never recorded as zero, which on a
            list reads as “free”.
          </p>
          <span style={{ display: 'inline-flex', gap: 6, marginTop: 10 }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              onClick={submit}
              disabled={!draft.name?.trim() || priceRead.bad || create.isPending || amend.isPending || copy?.isPending}
            >
              <Check size={13} aria-hidden />
              {create.isPending || amend.isPending || copy?.isPending
                ? 'Recording…'
                : editId ? 'Record the amendment' : copyOf ? 'Make the copy' : 'Put it on the list'}
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              onClick={() => { changeDraft(null); setEditId(null); setCopyOf(null); }}
            >
              <X size={13} aria-hidden />
              Leave it
            </button>
          </span>
        </div>
      ) : null}

      {loading ? (
        <>
          {/* The loaded page opens with the scope note (two lines) over the
              table, so the read in flight holds that same room: the note's own
              class and height, then the table's head and as many empty rows as the
              page already knows the list to have (one when it knows nothing;
              readingRows.ts). First paint is the loaded
              layout, so the books below it do not move when the list lands. */}
          <p className="cl-note" role="status" style={{ minHeight: '2lh' }}>
            Reading this house’s cocktails…
          </p>
          <div aria-hidden="true" className="cl-strip" data-testid="cocktails-strip-room" />
          <div
            aria-hidden="true"
            data-testid="cocktails-reading-room"
            style={{ marginTop: 12, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}
          >
            <table className="cl-table cl-table--drinks">
              <thead>
                <tr>
                  <th scope="col">Cocktail</th>
                  <th scope="col">Section</th>
                  <th scope="col">Method</th>
                  <th scope="col">Glass</th>
                  <th scope="col">Garnish</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Price</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Kept</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: readingRowCount(figures.byId?.size) }, (_, i) => i).map((i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td>
                      <span className="cl-serif" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                        &nbsp;
                      </span>
                    </td>
                    <td colSpan={6} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openParam ? (
            // A link names a drink: its panel opens under the list the moment
            // the list lands, so its room is held from the first paint too.
            <div aria-hidden="true" style={{ marginTop: 14, minHeight: SHEET_HOLD_ROOM }} />
          ) : null}
        </>
      ) : error || !data ? (
        <p className="cl-said" role="alert" style={{ marginTop: 12 }} data-testid="cocktails-unread">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          The cocktail list could not be read{error ? ` (${error})` : ''}. This is
          unread, not empty.
        </p>
      ) : (
        <>
          <p className="cl-note">
            {data.scopeNote}{' '}
            {data.referenceRows === null
              ? 'The count of unattributed reference cocktails could not be read.'
              : `${count(data.referenceRows)} unattributed reference cocktails from the demo corpus exist and are deliberately not listed as this house’s.`}
          </p>

          {linkedMissing ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="cocktails-link-missing">
              The drink that link names is not on this house’s list. It may have been taken off it.
            </p>
          ) : null}

          {seesCost && menu.error ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="cocktails-menu-unread">
              {MENU_PRICES_UNREAD}
            </p>
          ) : null}

          {seesCost && (figures.error || figures.costsUnread) ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="cocktails-costs-unread">
              {DRINK_COSTS_UNREAD}
            </p>
          ) : null}

          {figures.error ? (
            <p className="cl-said" role="status" style={{ marginTop: 12 }} data-testid="cocktails-allergens-unread">
              {DRINK_ALLERGENS_UNREAD}
            </p>
          ) : null}

          {data.rows.length > 0 ? (
            <>
              {seesCost ? (
                // The line lands when the figures do (about 225 ms in), so its room is held from the first paint:
                // empty while they load and for a house where every drink has a recipe, never given back (r104 FAIL 14).
                <div className="cl-said cl-norecipe-room" data-testid="no-recipe-room">
                  <NoRecipeYet bare={bareIds.length} of={data.rows.length} noun="drinks" only={onlyBare} read={figuresRead} onOnly={(v) => { flip.before(); setOnlyBare(v); if (v) setOnlyUncosted(false); }} />
                </div>
              ) : null}
              {seesCost ? (
                // Lands with the figures like the no-recipe line, so its room is held the same way (r107 walk F2: 31 px table shift at 1440).
                <div className="cl-norecipe-room" data-testid="no-cost-room">
                  <NoCostYet unknown={uncostedIds.length} of={data.rows.length} noun="drinks" only={onlyUncosted} read={costsRead} onOnly={(v) => { flip.before(); setOnlyUncosted(v); if (v) setOnlyBare(false); }} />
                </div>
              ) : null}
              <AllergenCheck value={allergen} onChange={slid(setAllergen)} hidden={searched.length - byAllergen.length} noun="drinks" />
            </>
          ) : null}

          {rows.length === 0 ? (
            <p className="cl-said" style={{ marginTop: 12 }} data-testid="cocktails-empty">
              {data.rows.length === 0
                ? manages
                  ? 'This house has recorded no cocktails. That read succeeded — the list is empty, not unread. Add one above and it becomes this house’s own row, with a recipe if you want one.'
                  : 'This house has recorded no cocktails. That read succeeded — the list is empty, not unread.'
                : 'No cocktail matches this reading.'}
            </p>
          ) : (
            <>
            <div className="cl-strip" data-testid="cocktails-strip">
              <p className="cl-note" style={{ margin: 0, flex: '1 1 240px' }}>
                {seesCost ? (
                  !figuresRead
                    ? 'Pour cost: not read just now.'
                    : stripSaid(strip, sayPct)
                ) : (
                  `${rows.length} ${rows.length === 1 ? 'drink' : 'drinks'}`
                )}
              </p>
              <ExportMenu variant="soft" size="sm" label="Export" count={rows.length} onExport={exportList} title="Export the drinks shown, in the order shown" />
              <RecipeBook />
            </div>
            <div style={{ marginTop: 12, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
              <table className="cl-table cl-table--drinks">
                <thead>
                  <tr>
                    <th scope="col">Cocktail</th>
                    <th scope="col">Section</th>
                    <th scope="col">Method</th>
                    <th scope="col">Glass</th>
                    <th scope="col">Garnish</th>
                    {sortHead('price', 'Price')}
                    {showMenu ? <th scope="col" style={{ textAlign: 'right' }}>Menu</th> : null}
                    {seesCost ? sortHead('cost', 'Cost per serve') : null}
                    {seesCost ? sortHead('share', 'Pour cost') : null}
                    {seesCost ? sortHead('margin', 'Margin') : null}
                    <th scope="col" className="cl-col-allergens">Allergens</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Kept</th>
                  </tr>
                </thead>
                <tbody ref={bodyRef}>
                  {shown.map((c) => {
                    const fc = seesCost
                      ? drinkCells(c.id, c.price ?? null, figures.byId?.get(c.id), figuresRead, money, sayPct, tax)
                      : null;
                    return (
                    <tr
                      key={c.id}
                      data-row={c.id}
                      data-selected={c.id === openId}
                      tabIndex={0}
                      onClick={() => toggleOpen(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleOpen(c.id);
                        }
                      }}
                    >
                      <td>
                        <span className="cl-serif" style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>
                          {c.display_name ?? c.name}
                        </span>
                      </td>
                      <td>{c.menu_section ?? <span className="cl-dim">{EM}</span>}</td>
                      <td>{c.method ?? <span className="cl-dim">{EM}</span>}</td>
                      <td>{c.glass ?? <span className="cl-dim">{EM}</span>}</td>
                      <td>{c.garnish ?? <span className="cl-dim">{EM}</span>}</td>
                      <td className="cl-num" style={{ textAlign: 'right' }}>{money(c.price)}</td>
                      {showMenu ? (
                        <td className="cl-num" style={{ textAlign: 'right' }} data-testid={`drink-menu-${c.id}`}>
                          <MenuPriceCell id={c.id} menu={menu.byId?.get(c.id)} say={money} />
                        </td>
                      ) : null}
                      {fc ? (
                        <td className="cl-num" style={{ textAlign: 'right' }} data-testid={`drink-cost-${c.id}`}>{fc.cost}</td>
                      ) : null}
                      {fc ? (
                        <td className="cl-num" style={{ textAlign: 'right' }} data-testid={`drink-share-${c.id}`}>{fc.share}</td>
                      ) : null}
                      {fc ? (
                        <td className="cl-num" style={{ textAlign: 'right' }} data-testid={`drink-margin-${c.id}`}>{fc.margin}</td>
                      ) : null}
                      <AllergenCell id={c.id} a={figures.byId?.get(c.id)?.allergens} />
                      <td className="cl-num cl-dim" style={{ textAlign: 'right' }}>
                        {shortDate((c as { created_at?: string }).created_at)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {seesCost ? <ShareBasisCaption tax={tax} /> : null}
            </>
          )}

          {/* the leaf: recipe + the two acts a house can take on its own row */}
          {/* Only a drink the list shows opens: an id from a link or a filtered-out row leaves no empty panel. */}
          <div ref={standRef} className="cl-stand" data-open={openShown && laid ? 'true' : 'false'} style={{ marginTop: openShown && laid ? 14 : 0 }}>
            <div>
              {openShown ? (
                <div className="cl-panel" data-testid="cocktail-leaf" ref={leafRef}>
                  {(() => {
                    const c = rows.find((x) => x.id === openId);
                    if (!c) return null;
                    return (
                      <>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 className="cl-h2" style={{ fontSize: 21 }}>{c.display_name ?? c.name}</h3>
                            {c.description ? (
                              <p className="cl-said" style={{ marginTop: 4 }}>{c.description}</p>
                            ) : null}
                          </div>
                          {manages ? (
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              type="button"
                              className="cl-btn cl-focus"
                              onClick={() => {
                                setEditId(c.id);
                                setCopyOf(null);
                                changeDraft({
                                  name: c.name,
                                  displayName: c.display_name ?? undefined,
                                  menuSection: c.menu_section ?? undefined,
                                  method: c.method ?? undefined,
                                  glass: c.glass ?? undefined,
                                  garnish: c.garnish ?? undefined,
                                  priceText: priceText(c.price),
                                });
                              }}
                            >
                              <Pencil size={13} aria-hidden />
                              Amend
                            </button>
                            {seesCost ? (
                              <button
                                type="button"
                                className="cl-btn cl-focus"
                                data-testid="cocktail-copy"
                                disabled={copy?.isPending}
                                onClick={() => doCopy(c)}
                              >
                                <Copy size={13} aria-hidden />
                                Copy
                              </button>
                            ) : null}
                            {/* Two-step, not a seal: the house ceremony is
                                rationed to the one act that spends money. */}
                            <button
                              type="button"
                              className="cl-btn cl-focus"
                              data-on={confirmRetire === c.id}
                              onClick={() =>
                                confirmRetire === c.id
                                  ? void doRetire(c.id, c.display_name ?? c.name)
                                  : setConfirmRetire(c.id)
                              }
                              onBlur={() => setConfirmRetire(null)}
                            >
                              <Trash2 size={13} aria-hidden />
                              {confirmRetire === c.id ? 'Take it off — confirm' : 'Take it off the list'}
                            </button>
                          </span>
                          ) : null}
                        </div>
                        {/* The menu's price, offered while the drink differs from it (gap 2,
                            slice 2). Not while the drink's own form is open: a price taken
                            here would leave the form's box saying the old one. */}
                        {showMenu && editId !== c.id ? (
                          <div style={{ marginTop: 10 }}>
                            <UseMenuPrice
                              key={c.id}
                              name={c.display_name ?? c.name}
                              own={c.price ?? null}
                              menu={menu.byId?.get(c.id)}
                              say={money}
                              share="pour cost"
                              onUse={async (p) => {
                                await amend.mutateAsync({ id: c.id, input: { price: p } });
                              }}
                            />
                          </div>
                        ) : null}
                        {/* The sheet keys its own draft by drink (RecipeSheet's default export), so typed lines never cross drinks. */}
                        <RecipeSheet cocktailId={c.id} holdRoom={c.id === openParam} />
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* ── the other books ──────────────────────────────────────────────── */}
      <section style={{ marginTop: 26, visibility: settling ? 'hidden' : undefined }} data-testid="cocktail-ledger">
        <h2 className="cl-sec">What the rest of this house’s books say</h2>
        {registerLoading ? (
          <p className="cl-said" role="status">Reading the menu and the till…</p>
        ) : !register ? (
          <p className="cl-said" role="alert">
            The menu and till record could not be read. It is unread, not empty.
          </p>
        ) : !register.house.readable ? (
          <p className="cl-said" role="alert" data-testid="cocktail-ledger-unread">
            <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
            {register.house.reason}
          </p>
        ) : register.counts.houseRows === 0 ? (
          <p className="cl-said">
            No menu line and no till line in this house names a cocktail. The list
            above is the whole of what this house records.
          </p>
        ) : (
          <>
            <p className="cl-said">
              {count(register.counts.houseRows)} cocktail{' '}
              {register.counts.houseRows === 1 ? 'line' : 'lines'} appear in this
              house’s menu and till. They are shown as those books name them,
              beside the list above rather than joined to a row of it.
            </p>
            <div style={{ marginTop: 10, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
              <table className="cl-table">
                <thead>
                  <tr>
                    <th scope="col">Named</th>
                    <th scope="col">In</th>
                    <th scope="col" style={{ textAlign: 'right' }}>On the list at</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Sold</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Taken</th>
                  </tr>
                </thead>
                <tbody>
                  {register.rows
                    .filter((r) => r.house !== null)
                    .map((r) => (
                      <tr key={r.key}>
                        <td>{r.name}</td>
                        <td className="cl-dim" style={{ fontSize: 11 }}>
                          {(r.house?.books ?? [])
                            .map((b) => BOOK_LABEL[b as HouseBookId])
                            .join(', ') || EM}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {money(r.house?.onMenu?.bottlePrice ?? r.house?.onMenu?.glassPrice)}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {count(r.house?.poured?.qty ?? null)}
                        </td>
                        <td className="cl-num" style={{ textAlign: 'right' }}>
                          {money(r.house?.poured?.revenue)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="cl-note">
              Read from {BOOK_ORDER.map((b) => BOOK_LABEL[b]).join(' · ')}.{' '}
              {register.stocking.reason}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
