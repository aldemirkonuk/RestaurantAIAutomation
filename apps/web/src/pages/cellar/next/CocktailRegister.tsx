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
 * THE RECIPE HALF, WHICH HAS NEVER EXISTED. `cocktail_ingredients` was created
 * empty and stayed empty because the extraction pass over the scanned cocktail
 * sections never ran (20260817090000_cocktails.sql:20-25). Every version of
 * this page has repeated that as though it were a permanent property of the
 * product: *"this register can list names and never a recipe."* It was a fact
 * about the EXTRACTOR. It was never a reason a bartender could not type one.
 * The recipe editor below is the first writer that table has ever had.
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

import { useState } from 'react';
import { AlertTriangle, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  BOOK_LABEL,
  BOOK_ORDER,
  EM,
  count,
  money,
  shortDate,
  type HouseBookId,
} from './cellar-format';
import {
  useCocktailRecipe,
  useCocktailRegister,
  useCocktailWrites,
  type CocktailInput,
  type RegisterVM,
} from './useCellarNextData';

interface Draft extends CocktailInput {
  name?: string;
}

function Field({
  id, label, value, onChange, placeholder, type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
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
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/* ── the recipe: the first writer cocktail_ingredients has ever had ──────── */

function Recipe({ cocktailId }: { cocktailId: string }) {
  const recipe = useCocktailRecipe(cocktailId);
  const { setRecipe } = useCocktailWrites();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [said, setSaid] = useState<string | null>(null);

  const start = () => {
    setText(
      (recipe.data?.rows ?? [])
        .map((l) =>
          [l.quantity ?? '', l.unit ?? '', l.free_text ?? '']
            .filter((v) => String(v).trim() !== '')
            .join(' '),
        )
        .join('\n'),
    );
    setEditing(true);
    setSaid(null);
  };

  const save = async () => {
    // One line of free text per row, with a leading quantity and unit when the
    // bartender wrote one. Nothing is parsed beyond that: a recipe line is a
    // sentence a human wrote, and guessing structure out of it would put words
    // in their mouth.
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l, i) => {
        const m = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{1,10})?\s+(.*)$/.exec(l);
        return m
          ? {
              quantity: Number(m[1].replace(',', '.')),
              unit: m[2] || undefined,
              freeText: m[3],
              sortOrder: i,
            }
          : { freeText: l, sortOrder: i };
      });
    try {
      const out = await setRecipe.mutateAsync({ id: cocktailId, lines });
      setEditing(false);
      setSaid(
        `${out.lines} ${out.lines === 1 ? 'line' : 'lines'} recorded. This is the first recipe data this house has ever had — cocktail_ingredients was created empty in August and no extraction pass ever filled it.`,
      );
    } catch (e) {
      setSaid(
        `The recipe was NOT recorded${e instanceof Error ? ` — ${e.message}` : ''}. Nothing was changed.`,
      );
    }
  };

  if (recipe.loading) {
    return <p className="cl-note" role="status">Reading the recipe…</p>;
  }
  if (recipe.error) {
    return (
      <p className="cl-note" role="alert">
        <AlertTriangle size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        The recipe could not be read ({recipe.error}). It is unread, not absent.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <h4 className="cl-sec" style={{ margin: '0 0 6px' }}>Recipe</h4>
      {editing ? (
        <>
          <label htmlFor={`cl-recipe-${cocktailId}`} className="cl-sr">Recipe lines</label>
          <textarea
            id={`cl-recipe-${cocktailId}`}
            className="cl-field cl-focus"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'30 ml gin\n30 ml Campari\n30 ml sweet vermouth\norange peel'}
            style={{ width: '100%', height: 'auto', padding: 8, lineHeight: 1.5 }}
          />
          <p className="cl-note" style={{ marginTop: 4 }}>
            One ingredient per line. A leading number and unit are read as the
            measure; everything else is kept as the bartender wrote it.
          </p>
          <span style={{ display: 'inline-flex', gap: 6, marginTop: 8 }}>
            <button type="button" className="cl-btn cl-focus" onClick={save} disabled={setRecipe.isPending}>
              <Check size={13} aria-hidden />
              {setRecipe.isPending ? 'Recording…' : 'Record the recipe'}
            </button>
            <button type="button" className="cl-btn cl-focus" onClick={() => setEditing(false)}>
              <X size={13} aria-hidden />
              Leave it
            </button>
          </span>
        </>
      ) : (recipe.data?.rows.length ?? 0) === 0 ? (
        <>
          <p className="cl-said" data-testid="recipe-empty">
            No recipe has been recorded for this cocktail. The table has been
            writable since this pass — it was empty because the extraction pass
            over the scanned menus never ran, not because a recipe cannot be kept.
          </p>
          <button type="button" className="cl-btn cl-focus" onClick={start} style={{ marginTop: 8 }}>
            <Plus size={13} aria-hidden />
            Write the recipe
          </button>
        </>
      ) : (
        <>
          <ol style={{ margin: '0 0 0 18px', padding: 0, fontSize: 12.5, lineHeight: 1.7 }}>
            {recipe.data!.rows.map((l, i) => (
              <li key={l.id ?? i}>
                {l.quantity !== null && l.quantity !== undefined ? (
                  <span className="cl-num">{l.quantity}{l.unit ? ` ${l.unit}` : ''} </span>
                ) : null}
                {l.free_text ?? EM}
              </li>
            ))}
          </ol>
          <button type="button" className="cl-btn cl-focus" onClick={start} style={{ marginTop: 8 }}>
            <Pencil size={13} aria-hidden />
            Amend the recipe
          </button>
        </>
      )}
      {said ? <p className="cl-note" role="status">{said}</p> : null}
    </div>
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const rows = (data?.rows ?? []).filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.display_name, c.menu_section, c.method, c.glass]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const submit = async () => {
    if (!draft?.name?.trim()) return;
    try {
      if (editId) {
        await amend.mutateAsync({ id: editId, input: draft });
        setSaid(`“${draft.name.trim()}” was amended on this house’s list.`);
      } else {
        await create.mutateAsync(draft);
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
              id="ck-price" label="Price" type="number"
              value={draft.price === undefined ? '' : String(draft.price)}
              onChange={(v) => setDraft({ ...draft, price: v === '' ? undefined : Number(v) })}
              placeholder="leave blank if unpriced"
            />
          </div>
          <p className="cl-note">
            A blank price is unpriced — it is never recorded as zero, which on a
            list reads as “free”.
          </p>
          <span style={{ display: 'inline-flex', gap: 6, marginTop: 10 }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              onClick={submit}
              disabled={!draft.name?.trim() || create.isPending || amend.isPending}
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
                      onClick={() => setOpenId((k) => (k === c.id ? null : c.id))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpenId((k) => (k === c.id ? null : c.id));
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
          <div className="cl-stand" data-open={openId ? 'true' : 'false'} style={{ marginTop: openId ? 14 : 0 }}>
            <div>
              {openId ? (
                <div className="cl-panel" data-testid="cocktail-leaf">
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
                                  price: c.price ?? undefined,
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
                        <Recipe cocktailId={c.id} />
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
