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
 * ledger, and it is shown apart rather than merged, because merging them would
 * need a name match this page is not entitled to make in the browser.
 *
 * NO SEAL HERE. The house ceremony is rationed to one act on this page: the
 * hold that sends a real purchase order to a vendor. Retiring a cocktail is
 * deliberate and reversible-by-re-adding, so it gets the same die pressed dry —
 * a two-step confirm, no wax (MOTIONS.md, "Deliberate non-motions").
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  BOOK_LABEL,
  BOOK_ORDER,
  EM,
  count,
  shortDate,
  type HouseBookId,
} from './cellar-format';
import RecipeSheet from './recipe/RecipeSheet';
import { PRICE_UNREAD, priceText, readPrice } from './recipe/price-text';
import { useHouseMoney } from './recipe/useRecipe';
import {
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
  const { create, amend, retire } = useCocktailWrites();
  // The house's money, as the drink's own cards print it: the cellar's
  // `money()` wrote $ for every house, so a lira list read "$14.00" beside
  // cards that read "₺14.00" (r7 browser check, 2026-11-12).
  const money = useHouseMoney();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
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
  const [query, setQuery] = useState('');

  // Opened from a link: bring the drink into view once the list has it. A
  // link to a drink this house's list does not hold is said, not ignored.
  const linkedRow = openParam ? (data?.rows ?? []).find((c) => c.id === openParam) ?? null : null;
  const linkedMissing = Boolean(openParam && data && !linkedRow);
  useEffect(() => {
    if (linkedRow && openId === linkedRow.id) leafRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [linkedRow, openId]);

  const rows = (data?.rows ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.display_name, c.menu_section, c.method, c.glass]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  const openShown = Boolean(openId && rows.some((x) => x.id === openId));

  const priceRead = readPrice(draft?.priceText ?? '');

  const submit = async () => {
    if (!draft?.name?.trim() || priceRead.bad) return;
    const { priceText: _typed, ...fields } = draft;
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
    <div data-testid="cocktail-register">
      <div className="cl-row-controls">
        <label htmlFor="cl-ck-search" className="cl-sr">Search this house’s cocktails</label>
        <input
          id="cl-ck-search"
          className="cl-field cl-focus"
          type="search"
          placeholder="Search cocktail, section, method…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 220, flex: '1 1 220px' }}
        />
        <button
          type="button"
          className="cl-btn cl-focus"
          data-on={draft !== null && editId === null}
          onClick={() => {
            setDraft(draft && editId === null ? null : {});
            setEditId(null);
          }}
          style={{ marginLeft: 'auto' }}
        >
          <Plus size={13} aria-hidden />
          Add a cocktail
        </button>
      </div>

      {said ? <p className="cl-note" role="status" data-testid="cocktail-said">{said}</p> : null}

      {draft ? (
        <div className="cl-panel" style={{ marginTop: 12 }} data-testid="cocktail-draft">
          <h3 className="cl-h2" style={{ fontSize: 19 }}>
            {editId ? 'Amend this cocktail' : 'A cocktail on this house’s list'}
          </h3>
          <div
            style={{
              display: 'grid', gap: 10, marginTop: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            <Field id="ck-name" label="Name" value={draft.name ?? ''} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Negroni" />
            <Field id="ck-section" label="Section" value={draft.menuSection ?? ''} onChange={(v) => setDraft({ ...draft, menuSection: v })} placeholder="Aperitivo" />
            <Field id="ck-method" label="Method" value={draft.method ?? ''} onChange={(v) => setDraft({ ...draft, method: v })} placeholder="Stirred" />
            <Field id="ck-glass" label="Glass" value={draft.glass ?? ''} onChange={(v) => setDraft({ ...draft, glass: v })} placeholder="Rocks" />
            <Field id="ck-garnish" label="Garnish" value={draft.garnish ?? ''} onChange={(v) => setDraft({ ...draft, garnish: v })} placeholder="Orange peel" />
            <Field
              id="ck-price" label="Price" inputMode="decimal"
              value={draft.priceText ?? ''}
              onChange={(v) => setDraft({ ...draft, priceText: v })}
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
              disabled={!draft.name?.trim() || priceRead.bad || create.isPending || amend.isPending}
            >
              <Check size={13} aria-hidden />
              {create.isPending || amend.isPending
                ? 'Recording…'
                : editId ? 'Record the amendment' : 'Put it on the list'}
            </button>
            <button
              type="button"
              className="cl-btn cl-focus"
              onClick={() => { setDraft(null); setEditId(null); }}
            >
              <X size={13} aria-hidden />
              Leave it
            </button>
          </span>
        </div>
      ) : null}

      {loading ? (
        <p className="cl-said" role="status" style={{ marginTop: 12 }}>
          Reading this house’s cocktails…
        </p>
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

          {rows.length === 0 ? (
            <p className="cl-said" style={{ marginTop: 12 }} data-testid="cocktails-empty">
              {data.rows.length === 0
                ? 'This house has recorded no cocktails. That read succeeded — the list is empty, not unread. Add one above and it becomes this house’s own row, with a recipe if you want one.'
                : 'No cocktail matches this reading.'}
            </p>
          ) : (
            <div style={{ marginTop: 12, overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10 }}>
              <table className="cl-table">
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
                  {rows.map((c) => (
                    <tr
                      key={c.id}
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
                      <td className="cl-num cl-dim" style={{ textAlign: 'right' }}>
                        {shortDate((c as { created_at?: string }).created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* the leaf: recipe + the two acts a house can take on its own row */}
          {/* Only a drink the list shows opens: an id from a link or a filtered-out row leaves no empty panel. */}
          <div className="cl-stand" data-open={openShown ? 'true' : 'false'} style={{ marginTop: openShown ? 14 : 0 }}>
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
                          <span style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              type="button"
                              className="cl-btn cl-focus"
                              onClick={() => {
                                setEditId(c.id);
                                setDraft({
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
                        </div>
                        {/* The sheet keys its own draft by drink (RecipeSheet's default export), so typed lines never cross drinks. */}
                        <RecipeSheet cocktailId={c.id} />
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
      <section style={{ marginTop: 26 }} data-testid="cocktail-ledger">
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
              house’s menu and till outside the list above. They are shown apart
              rather than merged: joining them to a row of the list would need a
              name match this page is not entitled to make.
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
