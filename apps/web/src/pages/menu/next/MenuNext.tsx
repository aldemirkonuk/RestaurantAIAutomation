/**
 * `/menu` — ADR 0160 sec110 item 7: "a person can add and discard items."
 *
 * A new route, not a redesign of a shipping page, so it carries no
 * `mudavym_design_*` flag (App.tsx wires it directly — see that file's
 * comment on this route) and no `legacy` branch to preserve.
 *
 * WHAT THIS READS AND WRITES, both real, both wired in this build:
 *   GET   /menus/:restaurantId               the active menu and its lines
 *   PATCH /menus/:restaurantId/items/:id/discard   soft-remove one line
 *   PATCH /menus/items/:id                    change one line's glass or bottle
 *                                              price (owner or manager); on the
 *                                              current menu it moves the house's
 *                                              own price too, and the page says
 *                                              what happened (priceChangeNote)
 *   POST  /menus/items                        add one line (existing route;
 *                                              its tenant check was a real
 *                                              gap — see menus.service.ts —
 *                                              closed alongside this page).
 *                                              ADR 0193: a priced line also
 *                                              sets the linked wine's own
 *                                              price; the page says what
 *                                              happened (housePriceNote)
 *
 * MENUS KEPT (ADR 0193, menu versions, founder 2026-09-21): below the current
 * menu, every menu the house has read -- its source, its lines, when and by
 * whom -- with the current one and the last one used named, a form to read a
 * new one (optional cadence tag and date), and the owner's or manager's act
 * of making one current (`MenuVersions.tsx`). A blank price on a current
 * menu's line keeps the last known price and the line says so.
 *
 * LOCKED PRICES (ADR 0193 round 3, `LockedPrices.tsx`): every price the house
 * holds, grouped by whether its wine is on the current menu; choosing a menu
 * shows its plan first (`MenuPlan.tsx`), with a Keep switch on each price it
 * would change.
 *
 * WHAT THIS DOES NOT DO. `addMenuItem`'s DTO is the review-step shape
 * (name/producer/category/vintage/region/grape_variety/by_glass_price/
 * bottle_price) — the same fields the onboarding scanner's review screen
 * edits, so this form asks for exactly those and nothing invented. A house
 * with no active menu row (`menuId: null`) is told so, plainly, rather than
 * shown an empty add form that would 404 on submit.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { addMenuItem, discardMenuItem, getMenu, reviewMenuItem, type ActiveMenu, type MenuLine } from '../../../services/api/menus';
import { housePriceNote, priceChangeNote, type PriceChange } from './menu-price-note';
import { MenuSheetButton } from './MenuSheetButton';
import { MenuVersions, useKeptMenuName } from './MenuVersions';
import { LockedPrices } from './LockedPrices';
import { settingsApi } from '../../../services/api/settings';
import { formatMoney } from '@/lib/currency';
import { housePriceHint } from '@/lib/house-number';
import { Wordmark } from '@/components/mudavym';
import { isKitchenLine } from '../../../lib/firstProof';
import { lineStatusWords } from './menu-line-status';
import { CorrectBox, CorrectNote, correctDraftOf, planCorrection, type CorrectDraft } from './MenuLineCorrect';
import '../../cellar/next/cellar-next.css';
import './menu-rows.css';

const EM = '—';

/**
 * Whether a line on the current menu is a dish (a kitchen line): the gateway's
 * own word when it sends one (menu-line-view.ts isKitchenLine), else the same
 * test here. A kitchen line stays on the menu and is carried nowhere (#1085);
 * the page sets it apart from the drinks instead of listing a dessert among
 * the wines (menu walk 2026-11-11).
 */
export function isKitchenMenuLine(line: MenuLine): boolean {
  if (typeof line.kitchen_line === 'boolean') return line.kitchen_line;
  return isKitchenLine({
    category: line.category,
    rawText: null,
    name: line.name,
    producer: line.producer,
    vintage: line.vintage,
    region: line.region,
    grapeVariety: line.grape_variety,
  });
}

/**
 * Money, in the HOUSE's own reporting currency — never a hardcoded `$`.
 *
 * Three production houses (Meyhouse, Kadikoy) bill in TRY, not dollars
 * (`check_money_states_its_currency.py`). `formatMoney` (lib/currency.ts) is
 * the same refusal-shaped formatter `rc2-format.ts`'s `fmtMoney` wraps for
 * receipts: a null/unrecorded currency prints the number with "(currency not
 * recorded)" rather than assuming one.
 */
function money(v: number | null, currency: string | null): string {
  if (v === null) return EM;
  return formatMoney(v, currency);
}

/**
 * The house's reporting currency, read the same way `ReceivingWorkspace`
 * reads it (`GET /settings/currency`, 5-minute staleTime) — a failed or
 * unanswered read resolves to `null`, which `formatMoney` renders as
 * "currency not recorded" rather than a silent dollar-sign default.
 */
function useHouseCurrency(restaurantId: string | null): string | null {
  const { data } = useQuery({
    // The house is in the key: one house's currency never prices another's
    // menu (MENU-01).
    queryKey: ['settings', 'currency', restaurantId],
    queryFn: () => settingsApi.houseCurrency(),
    staleTime: 5 * 60_000,
  });
  return data?.readable ? (data.code ?? null) : null;
}

/**
 * The gateway's own sentence for a failed call (it throws typed errors that
 * carry words), or null when it sent none: a dropped connection or a bare 500
 * has no sentence of the gateway's, and the caller then says it its own way.
 */
function gatewaySaid(e: unknown): string | null {
  const said = (e as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  if (typeof said !== 'string' || !said.trim() || said.trim() === 'Internal server error') return null;
  return said.trim();
}

/** A failed call's words for a sentence: the gateway's, or "could not be reached" for a dropped connection, never the transport's "Network Error". */
function failWords(e: unknown, none: string): string {
  const sent = e as { code?: unknown; response?: unknown; message?: unknown } | null;
  if (sent?.code === 'ERR_NETWORK' && !sent.response) return 'Mudavym could not be reached just now.';
  return e instanceof Error ? e.message : none;
}

/**
 * The room the current menu's table takes, from the walk: 4 lines were 287 px
 * (a 63 px head and 56 px a line). The count is the house's last, kept on this
 * device; with none it is 4. A house with no current menu reserves nothing.
 */
const HEAD_PX = 63;
const LINE_PX = 56;
export function reservedFor(lines: number): number {
  return lines > 0 ? HEAD_PX + lines * LINE_PX : 0;
}
const countKey = (house: string | null) => `mdv.menu.lines.${house ?? ''}`;
function lastLineCount(house: string | null): number {
  try {
    const n = Number(window.localStorage.getItem(countKey(house)));
    return Number.isInteger(n) && n >= 0 && window.localStorage.getItem(countKey(house)) !== null ? n : 4;
  } catch {
    return 4;
  }
}

function useActiveMenu(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const key = ['menu', 'active', restaurantId] as const;

  const q = useQuery({
    queryKey: key,
    enabled: Boolean(restaurantId),
    queryFn: () => getMenu(restaurantId as string),
  });

  // A discarded line leaves at once: on success the page's own copy drops it
  // (no wait on the refetch, no exit hold), then the read confirms. While the
  // discard is pending the row is dimmed; a failure puts it back (DD-r103-7).
  const discard = useMutation({
    mutationFn: (itemId: string) => discardMenuItem(restaurantId as string, itemId),
    onSuccess: async (_done, itemId) => {
      queryClient.setQueryData(key, (old: ActiveMenu | undefined) =>
        old ? { ...old, items: old.items.filter((l) => l.id !== itemId) } : old,
      );
      // The kept list counts this menu's lines too: it reads again, or it keeps saying the old count (r104 walk).
      void queryClient.invalidateQueries({ queryKey: ['menu', 'versions'] });
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const add = useMutation({
    mutationFn: (fields: {
      name: string
      producer?: string
      category?: string
      vintage?: string
      region?: string
      grape_variety?: string
      by_glass_price?: number
      bottle_price?: number
    }) => {
      if (!q.data?.menuId) throw new Error('No active menu to add to');
      return addMenuItem(q.data.menuId, fields);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  return { q, discard, add };
}

function AddItemForm({ onAdd, adding, error, canPrice }: {
  // The reset callback fires only on a SUCCESSFUL add. Clearing the form at
  // submit time (the prior behaviour) threw the person's typed entry away on
  // a failed POST, with no way to recover it — "a draft is not sent" cuts
  // both ways: a failure must not erase it either.
  onAdd: (
    fields: { name: string; category?: string; by_glass_price?: number; bottle_price?: number },
    opts: { onSuccess: () => void },
  ) => void
  adding: boolean
  error: string | null
  /**
   * Whether this person may put a price on the menu. The gateway refuses a
   * priced add from staff ("Only managers and owners can put a price on the
   * current menu"), so staff are not handed boxes that can only be refused
   * (r21 production-build walk).
   */
  canPrice: boolean
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [byGlass, setByGlass] = useState('');
  const [bottle, setBottle] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(
      {
        name: name.trim(),
        category: category.trim() || undefined,
        by_glass_price: canPrice && byGlass ? Number(byGlass) : undefined,
        bottle_price: canPrice && bottle ? Number(bottle) : undefined,
      },
      {
        onSuccess: () => {
          setName('');
          setCategory('');
          setByGlass('');
          setBottle('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="cl-row-controls" data-testid="menu-add-form">
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-name">
        Name
      </label>
      <input
        id="menu-add-name"
        className="cl-field cl-focus"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="What's on the menu"
        style={{ minWidth: 180 }}
      />
      <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-category">
        Section
      </label>
      <input
        id="menu-add-category"
        className="cl-field cl-focus"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="e.g. Reds"
        style={{ width: 120 }}
      />
      {canPrice ? (
        <>
          <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-glass">
            Glass
          </label>
          <input
            id="menu-add-glass"
            className="cl-field cl-focus cl-num"
            type="number"
            min={0}
            step="0.01"
            value={byGlass}
            onChange={(e) => setByGlass(e.target.value)}
            style={{ width: 80 }}
          />
          <label className="cl-dim" style={{ fontSize: 12 }} htmlFor="menu-add-bottle">
            Bottle
          </label>
          <input
            id="menu-add-bottle"
            className="cl-field cl-focus cl-num"
            type="number"
            min={0}
            step="0.01"
            value={bottle}
            onChange={(e) => setBottle(e.target.value)}
            style={{ width: 80 }}
          />
        </>
      ) : null}
      <button type="submit" className="cl-btn cl-focus" disabled={adding || !name.trim()}>
        {adding ? 'Adding…' : 'Add to menu'}
      </button>
      {error ? (
        <span role="alert" className="cl-said" style={{ fontSize: 12 }}>
          {error}
        </span>
      ) : null}
      {canPrice ? null : (
        <span className="cl-said" data-testid="menu-add-unpriced" style={{ fontSize: 12 }}>
          A line added here stands on the menu with no price; an owner or a manager sets it.
        </span>
      )}
    </form>
  );
}

/**
 * A price as the edit box starts it: the number the line holds, in the house's
 * form ("45,50" in a lira house, which the gateway's parseMenuPrice reads), or
 * empty. It was `String(v)`, so a lira owner opened "45.5" (r23 walk).
 */
function priceText(v: number | null, currency: string | null): string {
  return v === null || v === undefined ? '' : housePriceHint(v, currency);
}

/**
 * Why an add was refused, in the gateway's words ("Only managers and owners
 * can put a price on the current menu…"), never "Request failed with status
 * code 403". Not refusalOf: its 403 line is about changing a price.
 */
function addRefusal(err: unknown): string {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return failWords(err, 'no reason given');
}

/** The gateway's own words for a refusal, never a bare status. */
function refusalOf(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown } }; message?: string };
  if (e?.response?.status === 403) return 'only an owner or a manager can change a price';
  const m = e?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  if (Array.isArray(m) && m.length) return String(m[0]);
  return e?.message || 'no reason was given';
}

/** The glass and bottle boxes of a line being re-priced. Empty keeps the price. */
interface PriceDraft {
  glass: string
  bottle: string
}

function MenuRow({ line, currency, onDiscard, discarding, isNew = false, testId = 'menu-row', edit, correct }: {
  line: MenuLine
  /** The line was discarded and is fading out before it is removed. */
  /** The line arrived after the list was first shown: it inks in (160 ms, no wash). */
  isNew?: boolean
  currency: string | null
  testId?: string
  /** Absent for a member who may not discard (ADR 0358 D2: owner or manager only). */
  onDiscard?: () => void
  discarding: boolean
  /** Absent for a member who may not change a price (owner or manager only, as the gateway checks). */
  edit?: {
    open: boolean
    saving: boolean
    onOpen: () => void
    onCancel: () => void
    onSave: (draft: PriceDraft) => void
  }
  /** Absent for a member who may not correct a line (owner or manager only). Name and section, in the row. */
  correct?: {
    open: boolean
    saving: boolean
    onOpen: () => void
    onCancel: () => void
    onSave: (draft: CorrectDraft) => void
  }
}) {
  const [draft, setDraft] = useState<PriceDraft>({ glass: priceText(line.by_glass_price, currency), bottle: priceText(line.bottle_price, currency) });
  const editing = !!edit?.open;
  const [cdraft, setCdraft] = useState<CorrectDraft>(correctDraftOf(line));
  const correcting = !!correct?.open;
  const firstCorrect = useRef<HTMLInputElement>(null);
  const correctButton = useRef<HTMLButtonElement>(null);
  const wasCorrecting = useRef(correcting);
  // The same hand-back as the price boxes: the cursor goes in on open and returns to "Correct" on close.
  useEffect(() => {
    if (correcting && !wasCorrecting.current) firstCorrect.current?.focus();
    if (!correcting && wasCorrecting.current) {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) correctButton.current?.focus();
    }
    wasCorrecting.current = correcting;
  }, [correcting]);
  const cancelCorrect = () => {
    setCdraft(correctDraftOf(line));
    correct?.onCancel();
  };
  const onCorrectKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (correct && !correct.saving) correct.onSave(cdraft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!correct?.saving) cancelCorrect();
    }
  };
  const cplan = correcting ? planCorrection(line, cdraft, isKitchenMenuLine(line)) : null;
  const firstBox = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  // r26: the boxes are not a <form> (they sit in two table cells), so Enter did
  // nothing (r24 walk). Opening puts the cursor in the first box; closing (saved,
  // cancelled, Escape) gives it back to "Change price" instead of dropping it on
  // the page, so a keyboard user stays on the line they were changing.
  useEffect(() => {
    if (editing && !wasEditing.current) firstBox.current?.focus();
    if (!editing && wasEditing.current) {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) changeButton.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);
  const cancel = () => {
    setDraft({ glass: priceText(line.by_glass_price, currency), bottle: priceText(line.bottle_price, currency) });
    edit?.onCancel();
  };
  // Enter saves what both boxes hold, Escape puts both back and closes: the
  // same two keys as every other price box on /menu (the add form and the lock
  // forms submit on Enter; the lock forms close on Escape). A key pressed while
  // an input method is composing belongs to that method, not to the page.
  const onBoxKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (edit && !edit.saving) edit.onSave(draft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!edit?.saving) cancel();
    }
  };
  const box = (kind: 'glass' | 'bottle') => (
    <input
      ref={kind === 'glass' ? firstBox : undefined}
      className="cl-field cl-focus cl-num"
      inputMode="decimal"
      enterKeyHint="done"
      aria-label={`${kind === 'glass' ? 'Glass' : 'Bottle'} price of ${line.name}`}
      data-testid={`menu-price-${kind}`}
      value={draft[kind]}
      placeholder="keep"
      onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value }))}
      onKeyDown={onBoxKey}
      style={{ width: 80 }}
    />
  );
  return (
    <tr
      data-testid={testId}
      className="mdv-row"
      data-state={discarding ? 'pending' : undefined}
      data-new={isNew ? 'true' : undefined}
    >
      <td>
        {correcting ? (
          <>
            <CorrectBox line={line} field="name" value={cdraft.name} onChange={(v) => setCdraft((d) => ({ ...d, name: v }))} onKeyDown={onCorrectKey} inputRef={firstCorrect} />
            {cplan ? <CorrectNote plan={cplan} /> : null}
          </>
        ) : (
          line.name
        )}
      </td>
      <td className="cl-dim">
        {correcting ? (
          <CorrectBox line={line} field="category" value={cdraft.category} onChange={(v) => setCdraft((d) => ({ ...d, category: v }))} onKeyDown={onCorrectKey} />
        ) : (
          (line.category ?? EM)
        )}
      </td>
      <td className="cl-dim">{[line.producer, line.region].filter(Boolean).join(', ') || EM}</td>
      <td className="cl-num" data-label="Glass">{editing ? box('glass') : money(line.by_glass_price, currency)}</td>
      <td className="cl-num" data-label="Bottle">{editing ? box('bottle') : money(line.bottle_price, currency)}</td>
      <td>
        {(() => {
          const s = lineStatusWords(line);
          return (
            <>
              <span className="cl-chip" data-seal={s.sealed ? 'true' : 'false'} title={s.why ?? undefined} data-testid="menu-line-status">
                {s.words}
              </span>
              {s.noteShown && s.why ? (
                <span className="cl-note" style={{ display: 'block' }} data-testid="menu-line-status-why">
                  {s.why}
                </span>
              ) : null}
            </>
          );
        })()}
        {line.price_flag ? (
          <span className="cl-note" style={{ display: 'block' }} data-testid="menu-price-flag" title={line.price_flag_note ?? undefined}>
            {line.price_flag_note ?? 'A blank price kept the last known one.'}
          </span>
        ) : null}
      </td>
      <td className="mdv-acts" style={{ whiteSpace: 'nowrap' }}>
        {correct && correcting ? (
          <>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={correct.saving}
              onClick={() => correct.onSave(cdraft)}
              data-testid="menu-correct-save"
            >
              {correct.saving ? 'Saving…' : 'Save'}
            </button>{' '}
            <button type="button" className="cl-btn cl-focus" disabled={correct.saving} onClick={cancelCorrect}>
              Cancel
            </button>
          </>
        ) : edit && editing ? (
          <>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={edit.saving}
              onClick={() => edit.onSave(draft)}
              data-testid="menu-price-save"
            >
              {edit.saving ? 'Saving…' : 'Save price'}
            </button>{' '}
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={edit.saving}
              onClick={cancel}
            >
              Cancel
            </button>
          </>
        ) : edit ? (
          <>
            <button
              ref={changeButton}
              type="button"
              className="cl-btn cl-focus"
              onClick={() => {
                setDraft({ glass: priceText(line.by_glass_price, currency), bottle: priceText(line.bottle_price, currency) });
                edit.onOpen();
              }}
              aria-label={`Change the price of ${line.name}`}
              data-testid="menu-price-edit"
            >
              Change price
            </button>{' '}
          </>
        ) : null}
        {correct && !correcting && !editing ? (
          <>
            <button
              ref={correctButton}
              type="button"
              className="cl-btn cl-focus"
              onClick={() => {
                setCdraft(correctDraftOf(line));
                correct.onOpen();
              }}
              aria-label={`Correct the name or section of ${line.name}`}
              data-testid="menu-correct-open"
            >
              Correct
            </button>{' '}
          </>
        ) : null}
        {onDiscard && !editing && !correcting ? (
        <button
          type="button"
          className="cl-btn cl-focus"
          disabled={discarding}
          onClick={onDiscard}
          aria-label={`Discard ${line.name}`}
          data-testid="menu-discard-button"
        >
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
        ) : null}
      </td>
    </tr>
  );
}

export default function MenuNext() {
  const { activeRestaurantId, loading: authLoading, activeRole, user } = useAuth();
  // Choosing the current menu is an owner's or a manager's (ADR 0193); the
  // gateway refuses anyone else regardless of what this page offers.
  const role = (activeRole ?? user?.role ?? null) as string | null;
  const canManage = role === 'owner' || role === 'manager';
  const { q, discard, add } = useActiveMenu(activeRestaurantId);
  // Read once for the house: the count this page stores below must not take the room away at the next render.
  const lastCount = useMemo(() => lastLineCount(activeRestaurantId), [activeRestaurantId]);
  // Remember how many lines the current menu had, to hold their room next time.
  const shown = q.data ? (q.data.menuId ? q.data.items.length : 0) : null;
  useEffect(() => {
    if (shown === null) return;
    try {
      window.localStorage.setItem(countKey(activeRestaurantId), String(shown));
    } catch {
      /* a device that keeps nothing keeps nothing */
    }
  }, [shown, activeRestaurantId]);
  const queryClient = useQueryClient();
  // Lines already shown. A line that turns up later is new: it enters and
  // inks in, and stays marked so a later render does not cancel the animation.
  // The first list, and a change of house, animate nothing.
  const seen = useRef<{ house: string | null; ids: Set<string>; fresh: Set<string> } | null>(null);
  if (q.data) {
    if (!seen.current || seen.current.house !== activeRestaurantId) {
      seen.current = { house: activeRestaurantId, ids: new Set(q.data.items.map((l) => l.id)), fresh: new Set() };
    } else {
      for (const l of q.data.items) {
        if (!seen.current.ids.has(l.id)) {
          seen.current.ids.add(l.id);
          seen.current.fresh.add(l.id);
        }
      }
    }
  }
  const fresh = seen.current?.fresh ?? null;
  const currency = useHouseCurrency(activeRestaurantId);
  // The menu is named the way the kept list names it, not by the name the gateway stored (r104 menu-7, F4).
  const kept = useKeptMenuName(q.data?.menuId ?? null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [pricing, setPricing] = useState<{ id: string; saving: boolean } | null>(null);
  const [correcting, setCorrecting] = useState<{ id: string; saving: boolean } | null>(null);
  const [correctNote, setCorrectNote] = useState<{ lineId: string; tone: 'alert' | 'said'; text: string } | null>(null);
  const [priceNote, setPriceNote] = useState<{ lineId: string; tone: 'alert' | 'said'; text: string } | null>(null);
  const lines = q.data?.items ?? [];
  // One price changed at a time, field by field (the gateway corrects one field
  // per call), and the menu is read again after, so the row shows what was stored.
  const savePrices = async (line: MenuLine, draft: PriceDraft) => {
    setPricing({ id: line.id, saving: true });
    const changes: PriceChange[] = [];
    const fields = [
      { kind: 'bottle' as const, field: 'bottle_price' as const, typed: draft.bottle.trim(), had: priceText(line.bottle_price, currency) },
      { kind: 'glass' as const, field: 'by_glass_price' as const, typed: draft.glass.trim(), had: priceText(line.by_glass_price, currency) },
    ];
    for (const f of fields) {
      if (f.typed === '' || f.typed === f.had) continue;
      try {
        const r = await reviewMenuItem(line.id, f.field, f.typed);
        const stored = Number(r.newValue);
        changes.push({ kind: f.kind, shown: Number.isFinite(stored) ? money(stored, currency) : r.newValue, result: r });
      } catch (err) {
        changes.push({ kind: f.kind, shown: f.typed, result: { refused: refusalOf(err) } });
      }
    }
    const dish = isKitchenMenuLine(line);
    const note =
      changes.length === 0
        ? { tone: 'said' as const, text: `${line.name}: no price was changed.` }
        : priceChangeNote(line.name, dish, changes, (n) => money(n, currency));
    setPriceNote(note ? { lineId: line.id, ...note } : null);
    const refused = changes.some((c) => 'refused' in c.result);
    setPricing(refused ? { id: line.id, saving: false } : null);
    if (changes.some((c) => !('refused' in c.result))) {
      await queryClient.invalidateQueries({ queryKey: ['menu', 'active', activeRestaurantId] });
    }
  };
  // Name and section go through the same PATCH, one field per call, and the menu is read again after.
  // A refusal stops the rest and says the gateway's own words; the row then shows what is stored.
  const saveCorrection = async (line: MenuLine, draft: CorrectDraft) => {
    const plan = planCorrection(line, draft, isKitchenMenuLine(line));
    if (plan.refused) {
      setCorrectNote({ lineId: line.id, tone: 'alert', text: plan.refused });
      return;
    }
    if (plan.changes.length === 0) {
      setCorrecting(null);
      return;
    }
    setCorrecting({ id: line.id, saving: true });
    let failed: string | null = null;
    let saved = 0;
    for (const c of plan.changes) {
      try {
        await reviewMenuItem(line.id, c.field, c.value);
        saved += 1;
      } catch (err) {
        failed = addRefusal(err);
        break;
      }
    }
    setCorrecting(null);
    setCorrectNote(
      failed
        ? { lineId: line.id, tone: 'alert', text: `${line.name}: not saved. ${failed}` }
        : { lineId: line.id, tone: 'said', text: `${line.name} was corrected${plan.renamesGood ? ` (and renamed on Inventory)` : ''}.` },
    );
    if (saved > 0) await queryClient.invalidateQueries({ queryKey: ['menu', 'active', activeRestaurantId] });
  };
  const drinks = lines.filter((l) => !isKitchenMenuLine(l));
  const kitchen = lines.filter(isKitchenMenuLine);
  // The answer to a price change sits right under its line, where the person clicked.
  const row = (line: MenuLine, testId?: string) => (
    <Fragment key={line.id}>
    <MenuRow
      line={line}
      currency={currency}
      testId={testId}
      discarding={discard.isPending && discardingId === line.id}
      isNew={fresh?.has(line.id) ?? false}
      onDiscard={!canManage ? undefined : () => {
        setDiscardingId(line.id);
        discard.mutate(line.id, { onSettled: () => setDiscardingId(null) });
      }}
      edit={
        !canManage
          ? undefined
          : {
              open: pricing?.id === line.id,
              saving: pricing?.id === line.id && pricing.saving,
              onOpen: () => {
                setPriceNote(null);
                setPricing({ id: line.id, saving: false });
              },
              onCancel: () => setPricing(null),
              onSave: (draft) => void savePrices(line, draft),
            }
      }
      correct={
        !canManage
          ? undefined
          : {
              open: correcting?.id === line.id,
              saving: correcting?.id === line.id && correcting.saving,
              onOpen: () => {
                setCorrectNote(null);
                setCorrecting({ id: line.id, saving: false });
              },
              onCancel: () => {
                setCorrectNote(null);
                setCorrecting(null);
              },
              onSave: (draft) => void saveCorrection(line, draft),
            }
      }
    />
    {correctNote?.lineId === line.id ? (
      <tr>
        <td colSpan={7} style={{ paddingTop: 0 }}>
          <p
            role={correctNote.tone === 'alert' ? 'alert' : 'status'}
            className="cl-said"
            style={{ fontSize: 12, margin: 0 }}
            data-testid="menu-correct-note"
          >
            {correctNote.text}
          </p>
        </td>
      </tr>
    ) : null}
    {priceNote?.lineId === line.id ? (
      <tr>
        <td colSpan={7} style={{ paddingTop: 0 }}>
          <p
            role={priceNote.tone === 'alert' ? 'alert' : 'status'}
            className="cl-said"
            style={{ fontSize: 12, margin: 0 }}
            data-testid="menu-price-note"
          >
            {priceNote.text}
          </p>
        </td>
      </tr>
    ) : null}
    </Fragment>
  );
  const head = (
    <thead>
      <tr>
        <th>Name</th>
        <th>Section</th>
        <th>Producer / region</th>
        <th>Glass</th>
        <th>Bottle</th>
        <th>Status</th>
        <th />
      </tr>
    </thead>
  );

  return (
    <div
      className="mudavym min-h-full"
      style={{ background: 'var(--paper-0)', color: 'var(--ink-1)' }}
    >
      <div style={{ margin: '0 auto', maxWidth: 1100, padding: '22px 16px 40px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Wordmark size={13} />
        </header>

        <p className="cl-crumb" style={{ marginTop: 20 }}>
          What the house lists
        </p>
        <h1 className="cl-h1" data-testid="menu-headline">
          Menu.
        </h1>

        {authLoading || q.isLoading ? (
          // The table that lands is about 287 px for 4 lines at desktop width: the room is held while it is read, so the
          // sections below do not jump when it arrives (r103 menu-7, walk F2).
          <div className="mdv-reserve" style={{ ['--mdv-reserve' as string]: `${reservedFor(lastCount)}px` }} data-testid="menu-reserve">
            <p className="cl-said" role="status">
              Reading the menu…
            </p>
          </div>
        ) : q.isError ? (
          <div role="alert" data-testid="menu-error" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
            <p className="cl-said">
              {gatewaySaid(q.error) ??
                `The menu could not be read${q.error instanceof Error ? ` (${failWords(q.error, '')})` : ''}.`}{' '}
              Nothing below is a real count of what this house lists.
            </p>
            <button type="button" className="cl-btn cl-focus" disabled={q.isFetching} onClick={() => {
                void q.refetch();
                // The kept-menus panel below reads from the same gateway: when
                // it too could not be read, its sentence clears with this one.
                void queryClient.invalidateQueries({ queryKey: ['menu', 'versions'] });
              }}>
              {q.isFetching ? 'Reading…' : 'Retry'}
            </button>
          </div>
        ) : !q.data?.menuId ? (
          // The room held while reading is held here too, so the sections below do not jump up
          // when the read ends with no current menu (r103 F8: CLS 0.125 at 1440 px; a reserve, not
          // an ease). The house's stored count decides it; a stored 0 holds nothing.
          <div className="mdv-reserve" style={{ ['--mdv-reserve' as string]: `${reservedFor(lastCount)}px` }} data-testid="menu-no-active-reserve">
            <p className="cl-said" data-testid="menu-no-active">
              No current menu yet. Read one below and make it current — Add to menu has nothing to
              add to until a menu is current.
            </p>
          </div>
        ) : (
          <>
            {/* Every kept menu is stored as "Wine List" (the column's default), so
                that name is never said: the kept list's own name, else "the current menu". */}
            <p className="cl-standing" style={{ fontSize: 15.5 }} data-testid="menu-standing">
              {drinks.length} {drinks.length === 1 ? 'drink' : 'drinks'} on{' '}
              {kept.name ?? 'the current menu'}
              {kitchen.length > 0
                ? `, and ${kitchen.length} ${kitchen.length === 1 ? 'line' : 'lines'} from the kitchen, set apart below`
                : ''}
              .{' '}
              {canManage ? (
                <MenuSheetButton kind="export" label="Download this menu as a sheet" filename="menu.csv" testId="menu-export" />
              ) : null}
            </p>

            <div style={{ marginTop: 16 }}>
              <AddItemForm
                adding={add.isPending}
                error={add.isError ? addRefusal(add.error) : null}
                canPrice={canManage}
                onAdd={(fields, opts) => add.mutate(fields, opts)}
              />
              {(() => {
                const note = add.isSuccess ? housePriceNote(add.data, currency) : null;
                return note ? (
                  <p
                    role={note.tone === 'alert' ? 'alert' : 'status'}
                    className="cl-said"
                    style={{ fontSize: 12, marginTop: 6 }}
                    data-testid="menu-add-price-note"
                  >
                    {note.text}
                  </p>
                ) : null;
              })()}
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 16 }}>
              <table className="cl-table mdv-cards" style={{ width: '100%' }} aria-label="Drinks on the current menu">
                {head}
                <tbody>
                  {drinks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="cl-said" style={{ padding: 14 }}>
                        {kitchen.length === 0
                          ? 'Nothing on the menu yet — add the first line above.'
                          : 'No drink on the menu yet — only the kitchen lines below.'}
                      </td>
                    </tr>
                  ) : (
                    drinks.map((line) => row(line))
                  )}
                </tbody>
              </table>
            </div>
            {kitchen.length > 0 ? (
              <section aria-labelledby="menu-kitchen-h" style={{ marginTop: 20 }} data-testid="menu-kitchen">
                <h2 id="menu-kitchen-h" className="cl-crumb">
                  From the kitchen
                </h2>
                <p className="cl-note" style={{ marginTop: 4, fontSize: 12 }}>
                  On the menu, and carried nowhere: no wine, no house price, no stock.
                </p>
                <div style={{ overflowX: 'auto', border: '1px solid var(--paper-2)', borderRadius: 10, marginTop: 8 }}>
                  <table className="cl-table mdv-cards" style={{ width: '100%' }} aria-label="Kitchen lines on the current menu">
                    {head}
                    <tbody>{kitchen.map((line) => row(line, 'menu-kitchen-row'))}</tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {discard.isError ? (
              <div role="alert" data-testid="menu-discard-error" style={{ marginTop: 8, display: 'grid', gap: 8, justifyItems: 'start' }}>
                <p className="cl-said">
                  {gatewaySaid(discard.error) ??
                    `That line was not discarded (${failWords(discard.error, 'no reason given')}).`}
                </p>
                <button
                  type="button"
                  className="cl-btn cl-focus"
                  disabled={discard.isPending}
                  onClick={() => {
                    const id = discard.variables;
                    if (!id) return;
                    setDiscardingId(id);
                    discard.mutate(id, { onSettled: () => setDiscardingId(null) });
                  }}
                >
                  Retry
                </button>
              </div>
            ) : null}
          </>
        )}

        {/* ADR 0193 round 3: every price this house holds, kept when its wine
            leaves the menu (the founder, 2026-09-21: "add a section to that
            where you can lock price, but wha f that menu item disappears?"). */}
        {activeRestaurantId ? <LockedPrices canManage={canManage} /> : null}

        {activeRestaurantId ? <MenuVersions canManage={canManage} retryAbove={q.isError} /> : null}

        <footer
          style={{
            marginTop: 40,
            paddingTop: 12,
            borderTop: '1px solid var(--paper-2)',
          }}
        >
          <p className="cl-note" style={{ margin: 0, fontSize: 11 }}>
            Discard removes a line from what guests see. What it cost and who added it is kept —
            nothing here is a delete. Change price sets the line's glass or bottle price; on the
            current menu the house's own price follows unless it is locked. An empty box keeps its price.
          </p>
        </footer>
      </div>
    </div>
  );
}
