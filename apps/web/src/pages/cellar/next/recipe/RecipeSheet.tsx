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
 * What it says is what the server said. The cost line is the gateway's sum at
 * today's prices (F7) and appears only when every counted line is priced;
 * otherwise it says how many are, never a partial total dressed as the cost.
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
 * "Use these lines", and nothing is saved until Save.
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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardPaste, History, Plus, RotateCcw, Save } from 'lucide-react';
import { useAuth } from '../../../../contexts/AuthContext';
import { getErrorStatus } from '../../../../services/api/client';
import type { CocktailRecipe, RecipeLine, SaveRecipeBody } from '../../../../services/api/recipes';
import LineRow, { LineRowRead, rowName, rowQty, type DraftRow } from './LineRow';
import { draftKey, dropDraft, keepDraft, takeDraft } from './drafts';
import { parseLine, parseSpec, type ProposedLine } from './parseSpec';
import { AMBIGUOUS_AMOUNT, qtyText } from './units';
import {
  useCanEditRecipe,
  useHouseMoney,
  useRecipe,
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
    label: l.label,
    qtyText: qtyText(l.qtyEntered),
    storedQty: l.qtyEntered,
    unit: (l.unitCode as DraftRow['unit']) ?? '',
    saved: { status: l.status, costPerServe: l.costPerServe, costBasis: l.costBasis },
  };
}

function fromProposal(p: ProposedLine): DraftRow {
  return {
    key: nextKey(),
    role: p.role,
    inventoryId: null,
    itemName: null,
    itemKind: null,
    label: p.label,
    qtyText: qtyText(p.qty),
    unit: p.unit ?? '',
    saved: null,
  };
}

type Proposed = { from: 'legacy' | 'paste'; lines: ProposedLine[]; note: string };

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

/**
 * The versions before the one on the sheet. The gateway lists every version,
 * the current one included, so the current one is left out here. It sends
 * the author as an account id and each version as a line count, so the list
 * says when and how many lines, not who or which.
 */
function Versions({ cocktailId, currentId }: { cocktailId: string; currentId: string | null }) {
  const v = useRecipeVersions(cocktailId, true);
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
          <span className="cl-num">Version {x.version}</span>
          <span className="cl-dim"> · {when(x.createdAt)}</span>
          {x.author && !UUIDISH.test(x.author) ? <span className="cl-dim"> · {x.author}</span> : null}
          <span className="cl-dim"> · {count(x.lineCount, 'ingredient', 'ingredients')}</span>
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

/** Why Save is off, naming the first line that stops it. */
export function whyBlocked(rows: DraftRow[]): string | null {
  if (rows.length === 0) return 'Add at least one ingredient.';
  if (rows.length > MAX_LINES) return tooMany(rows.length);
  const named = (i: number) => {
    const n = rowName(rows[i]);
    return n === 'this line' ? `Line ${i + 1}` : `Line ${i + 1} (${n})`;
  };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const q = rowQty(r);
    if (q === null && AMBIGUOUS_AMOUNT.test(r.qtyText.trim())) {
      const t = r.qtyText.trim();
      return `${named(i)}: ${t} could be ${t.replace(/[.,]/, '')} or ${t.replace(',', '.').replace(/0+$/, '').replace(/\.$/, '')}. Type it without the separator.`;
    }
    if (q === null) return `${named(i)} needs an amount above zero.`;
    if (q > MAX_LINE_QTY) {
      return `${named(i)} is more than one line can hold. The most is ${MAX_LINE_QTY.toLocaleString('en-US')} ${r.unit || 'of its unit'}.`;
    }
    if (r.unit === '') return `${named(i)} needs a unit.`;
    if (rowName(r) === 'this line') return `${named(i)} needs a name.`;
  }
  return null;
}

/**
 * One sheet per drink. The key is what keeps a draft typed for one drink out
 * of another: React drops the inner sheet's state when the drink changes.
 */
export default function RecipeSheet({ cocktailId }: { cocktailId: string }) {
  return <Sheet key={cocktailId} cocktailId={cocktailId} />;
}

function Sheet({ cocktailId }: { cocktailId: string }) {
  const recipe = useRecipe(cocktailId);
  const canEdit = useCanEditRecipe();
  const sayMoney = useHouseMoney();
  const save = useSaveRecipe(cocktailId);
  const { user, activeRestaurantId } = useAuth();
  const storeKey = draftKey(user?.userId, activeRestaurantId, cocktailId);
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  // The typed lines a "Load the saved recipe" replaced, kept until put back, thrown away or saved over.
  const [setAside, setSetAside] = useState<DraftRow[] | null>(kept?.setAside ?? null);
  const [restored, setRestored] = useState(Boolean(kept?.dirty));
  const seededFrom = useRef<string | null | undefined>(kept ? kept.openedFrom : undefined);

  // Write the unsaved draft through to the session store, and drop it once
  // nothing typed is left unsaved.
  useEffect(() => {
    if (!canEdit) return;
    if ((dirty && rows) || setAside) keepDraft(storeKey, { rows: rows ?? [], openedFrom, dirty, setAside });
    else dropDraft(storeKey);
  }, [canEdit, storeKey, rows, openedFrom, dirty, setAside]);

  const data = recipe.data;
  const versionId = data?.current?.versionId ?? null;

  const seed = useCallback((d: CocktailRecipe) => {
    const v = d.current?.versionId ?? null;
    seededFrom.current = v;
    setOpenedFrom(v);
    setRows((d.current?.lines ?? []).map(fromServer));
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

  const blocked = useMemo(() => whyBlocked(rows ?? []), [rows]);

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
  const glass = data.current?.glass ?? c.glass;
  const garnish = data.current?.garnish ?? c.garnish;
  const hasLegacy = !data.current && data.legacyLines.length > 0;
  const behind = canEdit && dirty && versionId !== openedFrom;

  // Money only where the server sent it, and never to a role that cannot edit.
  const money = Boolean(canEdit && (data.cost !== null || c.price !== null));
  const say = money ? (n: number) => sayMoney(n) : null;

  const edit = (next: (rs: DraftRow[]) => DraftRow[]) => {
    setDirty(true);
    setRows((rs) => next(rs ?? []));
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

  const doSave = async () => {
    if (blocked || save.isPending) return;
    const body: SaveRecipeBody = {
      expectedVersionId: openedFrom,
      yieldServes: data.current?.yieldServes ?? 1,
      lines: lines.map((r) => ({
        role: r.role,
        inventoryId: r.role === 'stocked' ? r.inventoryId : null,
        label: rowName(r),
        qty: rowQty(r) as number,
        unit: r.unit as string,
      })),
    };
    if (data.current?.method) body.method = data.current.method;
    if (data.current?.glass) body.glass = data.current.glass;
    if (data.current?.garnish) body.garnish = data.current.garnish;
    setSaid(null);
    try {
      const out = await save.mutateAsync(body);
      // The draft is now what the server holds: the re-read that the save
      // invalidates will seed the saved lines and their costs.
      setOpenedFrom(out.versionId);
      setDirty(false);
      setRestored(false);
      setSetAside(null);
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

  const footer = (() => {
    if (!data.current && lines.length === 0) {
      if (hasLegacy) return null;
      return canEdit ? 'No recipe yet. Add what goes in it, or paste a spec.' : 'No recipe yet.';
    }
    if (!money || !data.cost || !data.current) return null;
    if (data.cost.complete && data.cost.perServe != null) {
      return `Costs ${sayMoney(data.cost.perServe)} a serve at today's prices`;
    }
    if (data.cost.of === 0) return 'Nothing in it is counted from the shelf.';
    return `${data.cost.priced} of ${count(data.cost.of, 'ingredient', 'ingredients')} priced`;
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
      <header className="cl-rcp-head">
        <h4 className="cl-sec" style={{ margin: 0 }}>Recipe</h4>
        <dl className="cl-rcp-facts">
          {money && c.price != null ? (
            <div><dt>Price</dt><dd className="cl-num">{sayMoney(c.price)} a serve</dd></div>
          ) : null}
          {glass ? <div><dt>Glass</dt><dd>{glass}</dd></div> : null}
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
              />
            ) : (
              <LineRowRead key={r.key} row={r} say={null} />
            ),
          )}
        </ol>
      ) : null}

      {hasLegacy && !(canEdit && proposed?.from === 'legacy') ? <LegacyLines data={data} /> : null}

      {footer ? (
        <p className="cl-rcp-foot" data-testid="recipe-footer" data-complete={data.cost?.complete ? 'true' : 'false'}>
          {footer}
        </p>
      ) : null}

      {canEdit && proposed ? (
        <div className="cl-rcp-proposed" data-testid="recipe-proposed">
          <p className="cl-note" style={{ marginTop: 0 }}>{proposed.note}</p>
          {lines.length + proposed.lines.length > MAX_LINES ? (
            <p className="cl-note" role="alert" data-testid="recipe-too-many">
              {tooMany(lines.length + proposed.lines.length)} Shorten the paste first.
            </p>
          ) : null}
          <ol className="cl-rcp-lines">
            {proposed.lines.slice(0, MAX_LINES).map((p, i) => (
              <li key={i} className="cl-rcp-line" data-role={p.role}>
                <div className="cl-rcp-read">
                  <span className="cl-num cl-rcp-amt">{p.qty != null ? `${qtyText(p.qty)} ${p.unit ?? ''}`.trim() : ''}</span>
                  <span>
                    {p.label}
                    {p.role === 'untracked' ? <span className="cl-dim"> · not counted</span> : null}
                    {p.flag ? <span className="cl-rcp-flag" data-testid="recipe-proposed-flag"> · {p.flag}</span> : null}
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {proposed.lines.length > MAX_LINES ? <p className="cl-note">…and {proposed.lines.length - MAX_LINES} more not shown.</p> : null}
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
            <button type="button" className="cl-btn cl-focus" onClick={() => setProposed(null)}>
              Discard
            </button>
          </span>
        </div>
      ) : null}

      {canEdit && pasteOpen && !proposed ? (
        <div className="cl-rcp-paste">
          <label htmlFor={`rcp-paste-${cocktailId}`} className="cl-note" style={{ display: 'block', marginTop: 0 }}>
            Paste a spec, one ingredient per line
          </label>
          <textarea
            id={`rcp-paste-${cocktailId}`}
            className="cl-field cl-focus"
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'1½ oz gin\n2 dashes Angostura\n1 egg white\nOrange twist garnish'}
            style={{ width: '100%', height: 'auto', padding: 8, lineHeight: 1.5 }}
          />
          <span style={{ display: 'inline-flex', gap: 6, marginTop: 6 }}>
            <button
              type="button"
              className="cl-btn cl-focus"
              disabled={parseSpec(pasteText).length === 0}
              onClick={() =>
                setProposed({ from: 'paste', lines: parseSpec(pasteText), note: 'Check these before you use them. Nothing is saved yet.' })
              }
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
                { key: nextKey(), role: 'stocked', inventoryId: null, itemName: null, itemKind: null, label: '', qtyText: '', unit: 'ml', saved: null },
              ])
            }
          >
            <Plus size={13} aria-hidden />
            Add an ingredient
          </button>
          {!pasteOpen && !proposed ? (
            <button type="button" className="cl-btn cl-focus" onClick={() => setPasteOpen(true)}>
              <ClipboardPaste size={13} aria-hidden />
              Paste a spec
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
          {showVersions ? <Versions cocktailId={cocktailId} currentId={versionId} /> : null}
        </div>
      ) : null}
    </section>
  );
}
