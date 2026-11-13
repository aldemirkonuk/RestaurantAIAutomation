/**
 * The drink's recipe sheet (proposal §2a, gaps G5, G8, G24): a people page.
 *
 * Every role reads the drink's current version: what goes in it, linked to
 * the house's shelf. An owner or manager also sees what it costs a serve,
 * links each ingredient to something on the shelf, and saves a new version.
 * Staff read it with no price and no cost: the gateway nulls money for a role
 * that does not see it, and the sheet shows money and controls only to a
 * role that edits.
 *
 * What it says is what the server said. The cost a serve is the gateway's sum
 * at today's prices (F7), said once, on the drink's cost card (DrinkCards.tsx):
 * a figure only when every counted line is priced, otherwise how many are,
 * never a partial total dressed as the cost.
 * There is no pour-cost percentage yet: it waits for the house's tax basis
 * (F8), and a percentage of a price that includes KDV would mislead.
 *
 * Typed lines are never replaced behind the editor's back. The app refetches
 * on focus and on mount (App.tsx: staleTime 5s, refetchOnWindowFocus), so a
 * colleague's save can arrive mid-edit. Once a line is touched the draft is
 * the editor's: a newer server version is announced, not loaded, and the
 * save stays pinned to the version the editor opened, so the gateway's 409
 * guard is what decides. The editor loads the saved recipe with a button on
 * the sheet, never by reloading the page and losing the draft.
 *
 * A drink with lines in the old recipe box and nothing saved here yet shows
 * those lines to everyone, as they were written: the recipe exists, and a
 * bartender mixes from it. An editor also gets them read through the paste
 * parser as proposed rows, which become lines only when they are used.
 *
 * A pasted spec is only ever proposed (F17): nothing becomes a line until
 * "Use these lines", and nothing is saved until Save. A pasted line whose name
 * is exactly one shelf item's (case and spaces folded) proposes that item as
 * its link, shown on the line before it is used (ADR 0366 item 7); two items
 * of one name propose neither and say so.
 *
 * A failed save says it failed, and that sentence is true: the gateway saves a
 * version in one transaction, so a refused save left the recipe as it was.
 * Only a request that never got an answer is said as unknown. A save the
 * gateway refused with a sentence of its own (an amount past what a line
 * holds) shows that sentence.
 *
 * The sheet belongs to one drink. Its draft lives inside a component keyed by
 * the drink, so opening another drink starts a fresh sheet and an unsaved draft
 * can never be saved into a different drink (round-17 HARM). Loading the saved
 * recipe over a draft sets the typed lines aside instead of dropping them, and
 * "Put my lines back" restores them on top of what was loaded.
 *
 * An unsaved draft outlives the sheet for the session (`drafts.ts`): opening
 * another drink and coming back finds the typed lines again, said as unsaved,
 * still pinned to the version they were typed over. Leaving the page while a
 * draft is unsaved asks the browser to warn first.
 *
 * Earlier versions open to their lines (round 17 D8). An editor can start
 * from one: its lines, serves, glass, garnish and method go onto the sheet as
 * an unsaved draft, and saving makes them a new current version. History is
 * never rewritten, and the save is still pinned to the version that was
 * current, so a colleague's save in between is a 409, not an overwrite.
 *
 * An editor sets the whole drink here, not only its lines: how many serves
 * the recipe makes (a batch of 20 costs per serve), the glass, the garnish
 * and the method. A proposed row can be left out one at a time, so a paste or
 * an old recipe box past 40 lines is never stuck; text in the paste box is
 * kept for the session like the lines.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardPaste, History, Plus, RotateCcw, Save } from 'lucide-react';
import { useAuth } from '../../../../contexts/AuthContext';
import { getErrorStatus } from '../../../../services/api/client';
import {
  recipesApi,
  type CocktailRecipe,
  type PreviewCostBody,
  type RecipeLine,
  type RecipeOwner,
  type RecipeVersion,
  type SaveRecipeBody,
  type ShelfItem,
} from '../../../../services/api/recipes';
import LineRow, { LineRowRead, rowName, rowQty, type DraftRow } from './LineRow';
import { draftId, draftKey, dropDraft, dropDraftsForDrink, keepDraft, takeDraft, type DraftMeta } from './drafts';
import { parseLine, parseSpec, type ProposedLine } from './parseSpec';
import { amountWithUnit, qtyText, readsAsThousandAmbiguous } from './units';
import DrinkCards, { type DraftCost } from './DrinkCards';
import { useHousePercent } from './useHousePercent';
import WhatIsInAServe from './WhatIsInAServe';
import { recipeWords, type RecipeWords } from './recipeWords';
import {
  useCanEditRecipe,
  useCostPreview,
  useHouseMoney,
  useRecipe,
  useRecipeVersion,
  useRecipeVersions,
  useSaveRecipe,
} from './useRecipe';

export const STALE_SENTENCE =
  'Someone saved this recipe after you opened it. Nothing was changed. Your lines stay here until you load the saved recipe.';
export const NOT_SAVED_SENTENCE = 'Not saved. Your recipe is as it was.';
export const UNKNOWN_SENTENCE =
  'No answer came back, so this may or may not have saved. Your lines stay here until you load the saved recipe.';
export const NEWER_SENTENCE =
  'Someone saved a newer version while you were editing. Your lines stay here; saving them will be refused until you load the saved recipe.';
export const LEGACY_NOTE = 'Lines from the old recipe box, not saved here yet.';
export const PASTE_NOTE =
  "Check these before you use them. A line links to a shelf item only where the name is exactly that item's. Nothing is saved yet.";
const LOAD_FAILED = 'The saved recipe could not be read just now. Your lines stay here.';
export const SET_ASIDE_SENTENCE =
  'Your lines are set aside. Put them back to work on them again; saving them then replaces the version shown.';
export const RESTORED_SENTENCE =
  'Your unsaved lines from earlier are back. They are not saved yet: save them, or load the saved recipe to set them aside.';
/** The most one line holds, in the unit typed. Matches the gateway (recipes.service.ts MAX_LINE_QTY). */
export const MAX_LINE_QTY = 100_000;
/** The most lines one recipe holds. Matches the gateway (dto/recipes.dto.ts ArrayMaxSize(40)). */
export const MAX_LINES = 40;
const tooMany = (n: number) =>
  `That is ${n} lines; a recipe holds at most ${MAX_LINES}. Remove ${n - MAX_LINES} before saving.`;

let seq = 0;
const nextKey = () => `r${++seq}`;

function fromServer(l: RecipeLine): DraftRow {
  return {
    key: l.id || nextKey(),
    role: l.role,
    inventoryId: l.inventoryId,
    itemName: l.itemName,
    itemKind: l.itemKind,
    itemUom: l.itemUom ?? null,
    itemGone: l.itemGone ?? null,
    label: l.label,
    qtyText: qtyText(l.qtyEntered),
    storedQty: l.qtyEntered,
    unit: (l.unitCode as DraftRow['unit']) ?? '',
    saved: { status: l.status, costPerServe: l.costPerServe, costPerServeExact: l.costPerServeExact ?? null, costBasis: l.costBasis },
  };
}

/**
 * The shelf item a pasted line would link to. Only `linked` carries an item;
 * it becomes the line's link on "Use these lines" and is saved only by Save.
 */
export type ProposedLink =
  | { status: 'looking' }
  | { status: 'linked'; item: ShelfItem }
  | { status: 'same-name'; n: number }
  | { status: 'none' }
  | { status: 'unread' };
type ProposedRow = ProposedLine & { link?: ProposedLink };

/** Labels sent in one shelf match; matches the gateway (ShelfMatchDto ArrayMaxSize(60), MaxLength(200)). */
const MATCH_MAX = 60;
const MATCH_LABEL_MAX = 200;
const askShelf = (l: ProposedLine) => l.role === 'stocked' && l.label.trim().length > 0 && l.label.trim().length <= MATCH_LABEL_MAX;

export function fromProposal(p: ProposedRow): DraftRow {
  const item = p.link?.status === 'linked' ? p.link.item : null;
  return {
    key: nextKey(),
    role: p.role,
    inventoryId: item?.id ?? null,
    itemName: item?.name ?? null,
    itemKind: item?.kind ?? null,
    itemUom: item?.uom ?? null,
    label: p.label,
    qtyText: qtyText(p.qty),
    unit: p.unit ?? '',
    saved: null,
  };
}

/** Serves, glass, garnish and method of a saved version, as a draft holds them. */
function metaOf(v: Pick<RecipeVersion, 'yieldServes' | 'glass' | 'garnish' | 'method'> | null | undefined): DraftMeta {
  return {
    yieldServes: v?.yieldServes ?? 1,
    glass: v?.glass ?? '',
    garnish: v?.garnish ?? '',
    method: v?.method ?? '',
  };
}

type Proposed = { from: 'legacy' | 'paste'; lines: ProposedRow[]; note: string; token?: number };

/** What a proposed line says about its shelf link. */
function LinkSaid({ link, label, onUnlink }: { link: ProposedLink; label: string; onUnlink: () => void }) {
  if (link.status === 'looking') return <span className="cl-dim" data-testid="recipe-proposed-looking"> · looking on your shelf…</span>;
  if (link.status === 'unread')
    return <span className="cl-dim" data-testid="recipe-proposed-unread"> · your shelf could not be read, so it is not linked</span>;
  if (link.status === 'same-name')
    return (
      <span className="cl-rcp-flag" data-testid="recipe-proposed-same-name">
        {' '}
        · {link.n} shelf items have this name, so none is linked; link one after you use it
      </span>
    );
  if (link.status !== 'linked') return null;
  return (
    <span data-testid="recipe-proposed-link">
      {' '}
      · links to <b>{link.item.name}</b>{' '}
      <button
        type="button"
        className="cl-linkish cl-focus"
        aria-label={`Do not link ${label || 'this line'} to ${link.item.name}`}
        onClick={onUnlink}
      >
        Do not link
      </button>
    </span>
  );
}

/** The old recipe box's rows, read through the same parser as a paste. */
function legacyProposal(d: CocktailRecipe): Proposed | null {
  if (d.current || !d.legacyLines.length) return null;
  const lines = d.legacyLines
    .map((l) => parseLine([l.quantity ?? '', l.unit ?? '', l.label ?? ''].join(' ').trim()))
    .filter((x): x is ProposedLine => x !== null);
  return lines.length ? { from: 'legacy', lines, note: LEGACY_NOTE } : null;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'at a time that was not recorded';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

/** The old recipe box's rows exactly as they were written, for anyone to read. */
function LegacyLines({ data }: { data: CocktailRecipe }) {
  return (
    <div className="cl-rcp-legacy" data-testid="recipe-legacy">
      <p className="cl-note" style={{ marginTop: 0 }}>{LEGACY_NOTE}</p>
      <ol className="cl-rcp-lines">
        {data.legacyLines.map((l, i) => (
          <li key={i} className="cl-rcp-line">
            <div className="cl-rcp-read">
              <span className="cl-num cl-rcp-amt">{[l.quantity ?? '', l.unit ?? ''].join(' ').trim()}</span>
              <span>{l.label ?? ''}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One earlier version, opened: its lines as written and, for an editor, a way to start from it. */
function PastVersion({
  cocktailId,
  versionId,
  onStartFrom,
  say,
}: {
  cocktailId: string | RecipeOwner;
  versionId: string;
  onStartFrom: ((v: RecipeVersion) => void) | null;
  say: ((n: number) => string) | null;
}) {
  const v = useRecipeVersion(cocktailId, versionId, true);
  if (v.loading) return <p className="cl-note" role="status">Reading this version…</p>;
  if (v.error || !v.data) {
    return (
      <p className="cl-note" role="alert">
        This version could not be read{v.error ? ` (${v.error})` : ''}. It is unread, not gone.
      </p>
    );
  }
  const { version, cost } = v.data;
  return (
    <div className="cl-rcp-past" data-testid="recipe-past-version">
      <ol className="cl-rcp-lines">
        {version.lines.map((l) => (
          <LineRowRead key={l.id} row={fromServer(l)} />
        ))}
      </ol>
      {say && cost?.complete && cost.perServe != null ? (
        <p className="cl-note">Would cost {say(cost.perServe)} a serve at today's prices.</p>
      ) : null}
      {onStartFrom ? (
        <button type="button" className="cl-btn cl-focus" style={{ marginTop: 6 }} onClick={() => onStartFrom(version)}>
          <RotateCcw size={13} aria-hidden />
          Start from version {version.version}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The versions before the one on the sheet. The gateway lists every version,
 * the current one included, so the current one is left out here. Each one
 * opens to its lines; who saved it is said by name when the gateway knows it.
 */
function Versions({
  cocktailId,
  currentId,
  onStartFrom,
  say,
}: {
  cocktailId: string | RecipeOwner;
  currentId: string | null;
  onStartFrom: ((v: RecipeVersion) => void) | null;
  say: ((n: number) => string) | null;
}) {
  const v = useRecipeVersions(cocktailId, true);
  const [open, setOpen] = useState<string | null>(null);
  if (v.loading) return <p className="cl-note" role="status">Reading the earlier versions…</p>;
  if (v.error || !v.data) {
    return (
      <p className="cl-note" role="alert">
        The earlier versions could not be read{v.error ? ` (${v.error})` : ''}. They are unread, not gone.
      </p>
    );
  }
  const earlier = v.data.filter((x) => x.versionId !== currentId);
  if (earlier.length === 0) return <p className="cl-note">No earlier versions.</p>;
  return (
    <ol className="cl-rcp-versions" data-testid="recipe-versions">
      {earlier.map((x) => (
        <li key={x.versionId}>
          <button
            type="button"
            className="cl-linkish cl-focus"
            aria-expanded={open === x.versionId}
            onClick={() => setOpen((o) => (o === x.versionId ? null : x.versionId))}
          >
            <span className="cl-num">Version {x.version}</span>
            <span className="cl-dim"> · {when(x.createdAt)}</span>
            {x.authorName ? (
              <span className="cl-dim"> · {x.authorName}</span>
            ) : x.author && !UUIDISH.test(x.author) ? (
              <span className="cl-dim"> · {x.author}</span>
            ) : null}
            <span className="cl-dim"> · {count(x.lineCount, 'ingredient', 'ingredients')}</span>
          </button>
          {open === x.versionId ? (
            <PastVersion cocktailId={cocktailId} versionId={x.versionId} onStartFrom={onStartFrom} say={say} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

type Said = { tone: 'ok' | 'alarm'; text: string; offerLoad?: boolean };

/** The gateway's own sentence on a refused save, when it sent one. */
function refusal(e: unknown): string | null {
  const m = (e as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  return typeof m === 'string' && m.trim() ? m.trim() : null;
}

/** The most serves one recipe makes. Matches the gateway (recipes.service.ts MAX_YIELD_SERVES). */
export const MAX_SERVES = 1000;

/**
 * The unsaved lines as the gateway prices them, with each line's label, or
 * null when the draft is not whole enough to price: a stocked line with no
 * amount, no unit or no linked item is never priced by guessing, so nothing
 * is asked and the saved figures stay. Untracked lines cost nothing and are
 * sent only when complete.
 */
export function costPreviewBody(rows: DraftRow[], serves: number): { body: PreviewCostBody; labels: string[] } | null {
  if (!Number.isInteger(serves) || serves < 1 || serves > MAX_SERVES) return null;
  if (rows.length > MAX_LINES) return null;
  const lines: PreviewCostBody['lines'] = [];
  const labels: string[] = [];
  for (const r of rows) {
    const q = rowQty(r);
    const whole = q !== null && q <= MAX_LINE_QTY && r.unit !== '';
    if (r.role === 'stocked') {
      if (!whole || !r.inventoryId) return null;
      lines.push({ role: 'stocked', inventoryId: r.inventoryId, qtyEntered: q, unitCode: r.unit });
      labels.push(rowName(r));
    } else if (whole) {
      lines.push({ role: 'untracked', inventoryId: null, qtyEntered: q, unitCode: r.unit });
      labels.push(rowName(r));
    }
  }
  return { body: { yieldServes: serves, lines }, labels };
}

/** Why Save is off, naming the first line that stops it. */
export function whyBlocked(rows: DraftRow[], serves: number = 1, words: RecipeWords = recipeWords('cocktail')): string | null {
  if (rows.length === 0) return 'Add at least one ingredient.';
  if (!Number.isInteger(serves) || serves < 1 || serves > MAX_SERVES) {
    return `Say how many ${words.unit}s it makes: a whole number from 1 to ${MAX_SERVES.toLocaleString('en-US')}.`;
  }
  if (rows.length > MAX_LINES) return tooMany(rows.length);
  const named = (i: number) => {
    const n = rowName(rows[i]);
    return n === 'this line' ? `Line ${i + 1}` : `Line ${i + 1} (${n})`;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const q = rowQty(r);
    if (q === null && readsAsThousandAmbiguous(r.qtyText, r.unit)) {
      const t = r.qtyText.trim();
      return `${named(i)}: ${t} could be ${t.replace(/[.,]/, '')} or ${t.replace(',', '.').replace(/0+$/, '').replace(/\.$/, '')}. Type it without the separator.`;
    }
    if (q === null) return `${named(i)} needs an amount above zero.`;
    if (q > MAX_LINE_QTY) {
      return `${named(i)} is more than one line can hold. The most is ${MAX_LINE_QTY.toLocaleString('en-US')} ${r.unit || 'of its unit'}.`;
    }
    if (r.unit === '') return `${named(i)} needs a unit.`;
    if (r.role === 'stocked' && r.inventoryId && r.itemGone) {
      return `${named(i)} is linked to something ${r.itemGone} from your shelf. Link it again, or mark it not counted.`;
    }
    if (rowName(r) === 'this line') return `${named(i)} needs a name.`;
  }
  return null;
}

/**
 * One sheet per drink. The key is what keeps a draft typed for one drink out
 * of another: React drops the inner sheet's state when the drink changes.
 */
export default function RecipeSheet(props: { cocktailId: string } | { dishId: string }) {
  const owner: RecipeOwner = 'dishId' in props ? { kind: 'dish', id: props.dishId } : { kind: 'cocktail', id: props.cocktailId };
  return <Sheet key={owner.id} owner={owner} />;
}

function Sheet({ owner }: { owner: RecipeOwner }) {
  const cocktailId = owner.id;
  const dId = draftId(owner);
  const isDish = owner.kind === 'dish';
  const words = recipeWords(owner.kind);
  const recipe = useRecipe(owner);
  const canEdit = useCanEditRecipe();
  const sayMoney = useHouseMoney();
  const sayPct = useHousePercent();
  const save = useSaveRecipe(owner);
  const { user, activeRestaurantId } = useAuth();
  const storeKey = draftKey(user?.userId, activeRestaurantId, dId);
  // An unsaved draft this person left on this drink earlier in the session.
  const [kept] = useState(() => (canEdit ? takeDraft(storeKey) : null));

  const [rows, setRows] = useState<DraftRow[] | null>(kept?.rows ?? null);
  // The version the draft was seeded from. A save names it, so a colleague's
  // later save is refused (409) rather than quietly overwritten.
  const [openedFrom, setOpenedFrom] = useState<string | null>(kept?.openedFrom ?? null);
  // Set by the first edit; cleared by a seed. While set, a newer server
  // version never replaces the draft.
  const [dirty, setDirty] = useState(kept?.dirty ?? false);
  const [said, setSaid] = useState<Said | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [proposed, setProposed] = useState<Proposed | null>(null);
  // Each "Read it" gets a token, so a shelf answer for an older paste is dropped.
  const pasteToken = useRef(0);
  const [pasteOpen, setPasteOpen] = useState(Boolean(kept?.paste));
  const [pasteText, setPasteText] = useState(kept?.paste ?? '');
  // The typed lines a "Load the saved recipe" replaced, kept until put back, thrown away or saved over.
  const [setAside, setSetAside] = useState<DraftRow[] | null>(kept?.setAside ?? null);
  const [restored, setRestored] = useState(Boolean(kept?.dirty));
  // Serves, glass, garnish and method as this draft has them; null while they are the saved version's.
  const [meta, setMeta] = useState<DraftMeta | null>(kept?.meta ?? null);
  const seededFrom = useRef<string | null | undefined>(kept ? kept.openedFrom : undefined);

  // Write the unsaved draft through to the session store, and drop it once
  // nothing typed is left unsaved.
  useEffect(() => {
    if (!canEdit) return;
    const paste = pasteText.trim() ? pasteText : undefined;
    if ((dirty && rows) || setAside || paste) keepDraft(storeKey, { rows: rows ?? [], openedFrom, dirty, setAside, meta, paste });
    else dropDraft(storeKey);
  }, [canEdit, storeKey, rows, openedFrom, dirty, setAside, meta, pasteText]);

  // The drink is gone from this house: no draft of it, for anyone, can ever be
  // saved, so none may keep the leave-page warning alive.
  useEffect(() => {
    if (recipe.status === 404) dropDraftsForDrink(dId);
  }, [recipe.status, dId]);

  // Read a paste into proposed lines, then ask the shelf once which of them
  // have an exact-name item. Nothing is linked or saved until it is used and saved.
  const readPaste = () => {
    const token = ++pasteToken.current;
    const parsed = parseSpec(pasteText);
    const ask = [...new Set(parsed.filter(askShelf).map((l) => l.label.trim()))].slice(0, MATCH_MAX);
    const lines: ProposedRow[] = parsed.map((l) => (ask.includes(l.label.trim()) && askShelf(l) ? { ...l, link: { status: 'looking' } } : l));
    setProposed({ from: 'paste', lines, note: PASTE_NOTE, token });
    if (!ask.length || !activeRestaurantId) return;
    const settle = (answer: (l: ProposedRow) => ProposedLink) =>
      setProposed((p) =>
        p && p.token === token ? { ...p, lines: p.lines.map((l) => (l.link?.status === 'looking' ? { ...l, link: answer(l) } : l)) } : p,
      );
    recipesApi.matchShelf(activeRestaurantId, ask).then(
      (matches) => {
        const byLabel = new Map(matches.map((m) => [m.label, m]));
        settle((l) => {
          const m = byLabel.get(l.label.trim());
          if (m?.item) return { status: 'linked', item: m.item };
          if (m && m.sameName > 1) return { status: 'same-name', n: m.sameName };
          return { status: 'none' };
        });
      },
      () => settle(() => ({ status: 'unread' })),
    );
  };

  const data = recipe.data;
  const versionId = data?.current?.versionId ?? null;

  const seed = useCallback((d: CocktailRecipe) => {
    const v = d.current?.versionId ?? null;
    seededFrom.current = v;
    setOpenedFrom(v);
    setRows((d.current?.lines ?? []).map(fromServer));
    setMeta(null);
    setDirty(false);
    // A pasted spec still being looked at survives a re-seed; the old box's
    // rows are re-read from what the server now says.
    setProposed((p) => (p?.from === 'paste' ? p : legacyProposal(d)));
    setRestored(false);
  }, []);

  // Seed from the server on first read, and again when a new version arrives
  // while the draft is clean (after this sheet's own save, or a colleague's
  // save before anything was typed). A dirty draft is never re-seeded.
  useEffect(() => {
    if (!data) return;
    if (seededFrom.current === versionId) return;
    if (seededFrom.current !== undefined && dirty) return;
    seed(data);
  }, [data, versionId, dirty, seed]);

  const shownMeta = meta ?? metaOf(data?.current);
  const blocked = useMemo(() => whyBlocked(rows ?? [], shownMeta.yieldServes, words), [rows, shownMeta.yieldServes, words]);

  // Money only where the server sent it, and never to a role that cannot edit.
  const money = Boolean(canEdit && data && (data.cost !== null || data.cocktail.price !== null));
  // An unsaved draft is priced by the gateway at today's prices, live, once it
  // is whole. A drink never saved is priced too: the preview needs only the
  // drink, not a saved version (#1165, `previewCost`). Its server figures
  // cannot say whether this role sees money (no version, so no cost), so there
  // the gate is the one the route itself keeps: owners and managers, who are
  // the ones who edit. A refusal answers null and no draft card is shown.
  const draftMoney = canEdit && (money || Boolean(data && !data.current));
  const draftBody = useMemo(
    () => (draftMoney && dirty && data && rows ? costPreviewBody(rows, shownMeta.yieldServes) : null),
    [draftMoney, dirty, data, rows, shownMeta.yieldServes],
  );
  const preview = useCostPreview(owner, draftBody?.body ?? null);
  const draftCost: DraftCost | null = preview && draftBody ? { cost: preview, labels: draftBody.labels } : null;

  if (recipe.loading) return <p className="cl-note" role="status">Reading the recipe…</p>;
  if (!data) {
    return (
      <p className="cl-note" role="alert" data-testid="recipe-unread">
        <AlertTriangle size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        The recipe could not be read{recipe.error ? ` (${recipe.error})` : ''}. It is unread, not absent.
      </p>
    );
  }

  const c = data.cocktail;
  const lines = rows ?? [];
  // A draft started from an earlier version shows that version's glass and garnish.
  const glass = (meta ? meta.glass || null : data.current?.glass) ?? c.glass;
  const garnish = (meta ? meta.garnish || null : data.current?.garnish) ?? c.garnish;
  const hasLegacy = !data.current && data.legacyLines.length > 0;
  const behind = canEdit && dirty && versionId !== openedFrom;

  const say = money || draftCost ? (n: number) => sayMoney(n) : null;

  const edit = (next: (rs: DraftRow[]) => DraftRow[]) => {
    setDirty(true);
    setRows((rs) => next(rs ?? []));
  };
  const setField = (p: Partial<DraftMeta>) => {
    setDirty(true);
    setMeta((m) => ({ ...(m ?? metaOf(data.current)), ...p }));
  };
  const patch = (key: string, p: Partial<DraftRow>) =>
    edit((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const putBack = () => {
    if (!setAside) return;
    const back = setAside;
    setSetAside(null);
    setSaid(null);
    // Seeded from the loaded version, so a save now replaces it on purpose.
    edit(() => back);
  };

  const loadSaved = async () => {
    const r = await recipe.refetch();
    if (!r.isError && r.data) {
      if (dirty && rows && rows.length > 0) setSetAside(rows);
      seed(r.data);
      setSaid(null);
    } else {
      setSaid({ tone: 'alarm', text: LOAD_FAILED, offerLoad: true });
    }
  };

  // Round 17 D8: an earlier version's lines and settings become the draft; a
  // draft already typed is set aside, never dropped.
  const startFrom = (v: RecipeVersion) => {
    if (dirty && rows && rows.length > 0) setSetAside(rows);
    setMeta(metaOf(v));
    edit(() => v.lines.map(fromServer));
    setShowVersions(false);
    setSaid({
      tone: 'ok',
      text: `Version ${v.version} is on the sheet. Nothing is saved yet: saving makes it the current recipe as a new version.`,
    });
  };

  const doSave = async () => {
    if (blocked || save.isPending) return;
    const m = meta ?? metaOf(data.current);
    const body: SaveRecipeBody = {
      expectedVersionId: openedFrom,
      yieldServes: m.yieldServes,
      lines: lines.map((r) => ({
        role: r.role,
        inventoryId: r.role === 'stocked' ? r.inventoryId : null,
        label: rowName(r),
        qty: rowQty(r) as number,
        unit: r.unit as string,
      })),
    };
    if (m.method.trim()) body.method = m.method.trim();
    if (!isDish && m.glass.trim()) body.glass = m.glass.trim();
    if (m.garnish.trim()) body.garnish = m.garnish.trim();
    setSaid(null);
    try {
      const out = await save.mutateAsync(body);
      // The draft is now what the server holds: the re-read that the save
      // invalidates will seed the saved lines and their costs.
      setOpenedFrom(out.versionId);
      setDirty(false);
      setRestored(false);
      setSetAside(null);
      setMeta(null);
      setSaid({
        tone: 'ok',
        text: `Saved. ${count(body.lines.length, 'ingredient', 'ingredients')}, version ${out.version}.`,
      });
    } catch (e) {
      const status = getErrorStatus(e);
      const theirs = status === 400 ? refusal(e) : null;
      if (status === 409) setSaid({ tone: 'alarm', text: STALE_SENTENCE, offerLoad: true });
      else if (theirs) setSaid({ tone: 'alarm', text: `${theirs} ${NOT_SAVED_SENTENCE}` });
      else if (status === null && (e as { request?: unknown })?.request) {
        setSaid({ tone: 'alarm', text: UNKNOWN_SENTENCE, offerLoad: true });
      } else setSaid({ tone: 'alarm', text: NOT_SAVED_SENTENCE });
    }
  };

  // Only the empty recipe has a footer. The cost a serve is the cost card's
  // (DrinkCards.tsx) alone: a second sentence built apart from it could say
  // something else (it once read "₺0.00" where the card said "Under ₺0.01").
  const footer =
    !data.current && lines.length === 0 && !hasLegacy
      ? canEdit ? `No recipe yet. Add what goes in it, or paste a ${words.pasteWord}.` : 'No recipe yet.'
      : null;

  // The same good on more than one counted line: said, not merged; a split pour is real.
  const repeated = (() => {
    const byItem = new Map<string, { name: string; n: number }>();
    for (const r of lines) {
      if (r.role !== 'stocked' || !r.inventoryId) continue;
      const e = byItem.get(r.inventoryId) ?? { name: r.itemName ?? rowName(r), n: 0 };
      e.n += 1;
      byItem.set(r.inventoryId, e);
    }
    return [...byItem.values()].filter((e) => e.n > 1).map((e) => [e.name, e.n] as const);
  })();

  const earlier = Math.max(0, data.versionCount - 1);
  const offerLoad = canEdit && (behind || said?.offerLoad || (restored && dirty));

  return (
    <section className="cl-rcp" data-testid="recipe-sheet" aria-label={`Recipe for ${c.name}`}>
      {recipe.error ? (
        <p className="cl-note" role="alert" data-testid="recipe-reread-failed">
          <AlertTriangle size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          The recipe could not be read again just now ({recipe.error}). What is shown is the last read.
        </p>
      ) : null}
      {/* The drink opens on its cards, then what is in a serve, then its lines
          (founder ask: a drink shows its KPI cards, then a nutrition card). */}
      <DrinkCards data={data} sayMoney={say} sayPct={sayPct} unsaved={canEdit && dirty} draftCost={draftCost} />
      <WhatIsInAServe data={data} unsaved={canEdit && dirty} />

      <header className="cl-rcp-head">
        <h4 className="cl-sec" style={{ margin: 0 }}>Recipe</h4>
        <dl className="cl-rcp-facts">
          {!isDish && glass ? <div><dt>Glass</dt><dd>{glass}</dd></div> : null}
          {garnish ? <div><dt>Garnish</dt><dd>{garnish}</dd></div> : null}
        </dl>
      </header>

      {lines.length > 0 ? (
        <ol className="cl-rcp-lines">
          {lines.map((r) =>
            canEdit ? (
              <LineRow
                key={r.key}
                row={r}
                say={say}
                onChange={(p) => patch(r.key, p)}
                onRemove={() => edit((rs) => rs.filter((x) => x.key !== r.key))}
                kind={owner.kind}
              />
            ) : (
              <LineRowRead key={r.key} row={r} />
            ),
          )}
        </ol>
      ) : null}

      {canEdit && repeated.length > 0 ? (
        <p className="cl-note" data-testid="recipe-repeated">
          {repeated.map(([name, n]) => `${name} is on ${n} lines; a ${words.unit} takes all of them.`).join(' ')}
        </p>
      ) : null}

      {canEdit && (lines.length > 0 || data.current) ? (
        <div className="cl-rcp-meta" data-testid="recipe-meta">
          <label>
            {isDish ? 'Makes (plates)' : 'Makes (serves)'}
            <input
              className="cl-field cl-focus cl-num"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SERVES}
              step={1}
              value={Number.isFinite(shownMeta.yieldServes) ? String(shownMeta.yieldServes) : ''}
              aria-invalid={!Number.isInteger(shownMeta.yieldServes) || shownMeta.yieldServes < 1 || shownMeta.yieldServes > MAX_SERVES}
              onChange={(e) => setField({ yieldServes: e.target.value.trim() === '' ? NaN : Number(e.target.value) })}
            />
          </label>
          {isDish ? null : (
            <label>
              Glass
              <input className="cl-field cl-focus" value={shownMeta.glass} maxLength={200} placeholder={c.glass ?? 'Rocks'} onChange={(e) => setField({ glass: e.target.value })} />
            </label>
          )}
          <label>
            Garnish
            <input className="cl-field cl-focus" value={shownMeta.garnish} maxLength={200} placeholder={c.garnish ?? words.garnishPlaceholder} onChange={(e) => setField({ garnish: e.target.value })} />
          </label>
          <label className="cl-rcp-method">
            Method
            <textarea className="cl-field cl-focus" rows={2} value={shownMeta.method} maxLength={4000} placeholder={words.methodPlaceholder} onChange={(e) => setField({ method: e.target.value })} />
          </label>
        </div>
      ) : !canEdit && data.current?.method ? (
        <p className="cl-note" data-testid="recipe-method">{data.current.method}</p>
      ) : null}

      {hasLegacy && !(canEdit && proposed?.from === 'legacy') ? <LegacyLines data={data} /> : null}

      {footer ? (
        <p className="cl-rcp-foot" data-testid="recipe-footer">
          {footer}
        </p>
      ) : null}

      {canEdit && proposed ? (
        <div className="cl-rcp-proposed" data-testid="recipe-proposed">
          <p className="cl-note" style={{ marginTop: 0 }}>{proposed.note}</p>
          {lines.length + proposed.lines.length > MAX_LINES ? (
            <p className="cl-note" role="alert" data-testid="recipe-too-many">
              {tooMany(lines.length + proposed.lines.length)} Leave some out below, or change the paste.
            </p>
          ) : null}
          <ol className="cl-rcp-lines">
            {proposed.lines.map((p, i) => (
              <li key={i} className="cl-rcp-line" data-role={p.role} data-testid="recipe-proposed-line">
                <div className="cl-rcp-read">
                  <span className="cl-num cl-rcp-amt">{p.qty != null ? amountWithUnit(p.qty, p.unit) : ''}</span>
                  <span>
                    {p.label}
                    {p.role === 'untracked' ? <span className="cl-dim"> · not counted</span> : null}
                    {p.flag ? <span className="cl-rcp-flag" data-testid="recipe-proposed-flag"> · {p.flag}</span> : null}
                    {p.link ? (
                      <LinkSaid
                        link={p.link}
                        label={p.label}
                        onUnlink={() =>
                          setProposed((pr) =>
                            pr ? { ...pr, lines: pr.lines.map((l, j) => (j === i ? { ...l, link: { status: 'none' } } : l)) } : pr,
                          )
                        }
                      />
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="cl-btn cl-focus cl-rcp-leave"
                    aria-label={`Leave out ${p.label || `line ${i + 1}`}`}
                    onClick={() =>
                      setProposed((pr) => {
                        if (!pr) return pr;
                        const left = pr.lines.filter((_, j) => j !== i);
                        return left.length ? { ...pr, lines: left } : null;
                      })
                    }
                  >
                    Leave out
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={lines.length + proposed.lines.length > MAX_LINES}
              onClick={() => {
                edit((rs) => [...rs, ...proposed.lines.map(fromProposal)]);
                setProposed(null);
                setPasteText('');
                setPasteOpen(false);
              }}
            >
              Use these lines
            </button>
            {proposed.from === 'paste' ? (
              <button type="button" className="cl-btn cl-focus" onClick={() => setProposed(null)}>
                Change the paste
              </button>
            ) : null}
            <button
              type="button"
              className="cl-btn cl-focus"
              onClick={() => {
                if (proposed.from === 'paste') {
                  setPasteText('');
                  setPasteOpen(false);
                }
                setProposed(null);
              }}
            >
              Discard
            </button>
          </span>
        </div>
      ) : null}

      {canEdit && pasteOpen && !proposed ? (
        <div className="cl-rcp-paste">
          <label htmlFor={`rcp-paste-${cocktailId}`} className="cl-note" style={{ display: 'block', marginTop: 0 }}>
            Paste a {words.pasteWord}, one ingredient per line
          </label>
          <textarea
            id={`rcp-paste-${cocktailId}`}
            className="cl-field cl-focus"
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={words.pastePlaceholder}
            style={{ width: '100%', height: 'auto', padding: 8, lineHeight: 1.5 }}
          />
          <span style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={parseSpec(pasteText).length === 0}
              onClick={readPaste}
            >
              Read it
            </button>
            <button type="button" className="cl-btn cl-focus" onClick={() => { setPasteOpen(false); setPasteText(''); }}>
              Close
            </button>
          </span>
        </div>
      ) : null}

      {canEdit ? (
        <div className="cl-rcp-actions">
          <button
            type="button"
            className="cl-btn cl-focus"
            onClick={() =>
              edit((rs) => [
                ...rs,
                { key: nextKey(), role: 'stocked', inventoryId: null, itemName: null, itemKind: null, label: '', qtyText: '', unit: words.newLineUnit, saved: null },
              ])
            }
          >
            <Plus size={13} aria-hidden />
            Add an ingredient
          </button>
          {!pasteOpen && !proposed ? (
            <button type="button" className="cl-btn cl-focus" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={13} aria-hidden />
              Paste a {words.pasteWord}
            </button>
          ) : null}
          <button
            type="button"
            className="cl-btn cl-focus cl-rcp-save"
            onClick={() => void doSave()}
            disabled={Boolean(blocked) || save.isPending}
            title={blocked ?? undefined}
          >
            <Save size={13} aria-hidden />
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : null}
      {canEdit && blocked && lines.length > 0 ? <p className="cl-note">{blocked}</p> : null}

      {canEdit && restored && dirty && !said ? (
        <p className="cl-rcp-said" role="status" data-testid="recipe-restored">
          {RESTORED_SENTENCE}
        </p>
      ) : null}
      {behind && said?.tone !== 'alarm' ? (
        <p className="cl-rcp-said cl-rcp-said-alarm" role="status" data-testid="recipe-newer">
          {NEWER_SENTENCE}
        </p>
      ) : null}
      {said ? (
        <p
          className={`cl-rcp-said${said.tone === 'alarm' ? ' cl-rcp-said-alarm' : ''}`}
          role={said.tone === 'alarm' ? 'alert' : 'status'}
          data-testid="recipe-said"
        >
          {said.text}
        </p>
      ) : null}
      {offerLoad ? (
        <button
          type="button"
          className="cl-btn cl-focus"
          style={{ marginTop: 6 }}
          onClick={() => void loadSaved()}
          disabled={recipe.fetching}
        >
          <RotateCcw size={13} aria-hidden />
          {recipe.fetching ? 'Reading…' : 'Load the saved recipe'}
        </button>
      ) : null}
      {canEdit && setAside ? (
        <div data-testid="recipe-set-aside" style={{ marginTop: 6 }}>
          <p className="cl-note" style={{ margin: 0 }}>{SET_ASIDE_SENTENCE}</p>
          <button type="button" className="cl-btn cl-focus" style={{ marginTop: 6 }} onClick={putBack}>
            <RotateCcw size={13} aria-hidden />
            Put my lines back
          </button>{' '}
          <button type="button" className="cl-btn cl-focus" style={{ marginTop: 6 }} onClick={() => setSetAside(null)}>
            Throw them away
          </button>
        </div>
      ) : null}

      {earlier >= 1 ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="cl-linkish cl-focus"
            onClick={() => setShowVersions((s) => !s)}
            aria-expanded={showVersions}
          >
            <History size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Earlier versions ({earlier})
          </button>
          {showVersions ? (
            <Versions cocktailId={owner} currentId={versionId} onStartFrom={canEdit ? startFrom : null} say={say} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
