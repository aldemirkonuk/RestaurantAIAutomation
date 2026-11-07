/**
 * The drink's recipe sheet (proposal §2a, gaps G5, G8, G24): a people page.
 *
 * Every role reads the drink's current version: what goes in it, linked to
 * the house's shelf. An owner or manager also sees what it costs a serve.
 * Staff read it with no price and no cost: the gateway nulls money for a role
 * that does not see it, and the sheet shows money only to a role that edits.
 *
 * What it says is what the server said. The cost line is the gateway's sum at
 * today's prices (F7) and appears only when every counted line is priced;
 * otherwise it says how many are, never a partial total dressed as the cost.
 * There is no pour-cost percentage yet: it waits for the house's tax basis
 * (F8), and a percentage of a price that includes KDV would mislead.
 *
 * A drink with lines in the old recipe box and nothing saved here yet shows
 * those lines to everyone, as they were written: the recipe exists, and a
 * bartender mixes from it.
 */
import { AlertTriangle, History } from 'lucide-react';
import { useState } from 'react';
import type { CocktailRecipe, RecipeLine } from '../../../../services/api/recipes';
import { LineRowRead, type DraftRow } from './LineRow';
import { qtyText } from './units';
import { useCanEditRecipe, useHouseMoney, useRecipe, useRecipeVersions } from './useRecipe';

export const LEGACY_NOTE = 'Lines from the old recipe box, not saved here yet.';

function fromServer(l: RecipeLine): DraftRow {
  return {
    key: l.id,
    role: l.role,
    inventoryId: l.inventoryId,
    itemName: l.itemName,
    itemKind: l.itemKind,
    label: l.label,
    qtyText: qtyText(l.qtyEntered),
    unit: (l.unitCode as DraftRow['unit']) ?? '',
    saved: { status: l.status, costPerServe: l.costPerServe, costBasis: l.costBasis },
  };
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

export default function RecipeSheet({ cocktailId }: { cocktailId: string }) {
  const recipe = useRecipe(cocktailId);
  const canEdit = useCanEditRecipe();
  const sayMoney = useHouseMoney();
  const [showVersions, setShowVersions] = useState(false);
  const data = recipe.data;

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
  const versionId = data.current?.versionId ?? null;
  const lines = (data.current?.lines ?? []).map(fromServer);
  const glass = data.current?.glass ?? c.glass;
  const garnish = data.current?.garnish ?? c.garnish;
  const hasLegacy = !data.current && data.legacyLines.length > 0;

  // Money only where the server sent it, and never to a role that cannot edit.
  const money = Boolean(canEdit && (data.cost !== null || c.price !== null));
  const say = money ? (n: number) => sayMoney(n) : null;

  const footer = (() => {
    if (!data.current && lines.length === 0) return hasLegacy ? null : 'No recipe yet.';
    if (!money || !data.cost || !data.current) return null;
    if (data.cost.complete && data.cost.perServe != null) {
      return `Costs ${sayMoney(data.cost.perServe)} a serve at today's prices`;
    }
    if (data.cost.of === 0) return 'Nothing in it is counted from the shelf.';
    return `${data.cost.priced} of ${count(data.cost.of, 'ingredient', 'ingredients')} priced`;
  })();

  const earlier = Math.max(0, data.versionCount - 1);

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
          {lines.map((r) => <LineRowRead key={r.key} row={r} say={say} />)}
        </ol>
      ) : null}

      {hasLegacy ? <LegacyLines data={data} /> : null}

      {footer ? (
        <p className="cl-rcp-foot" data-testid="recipe-footer" data-complete={data.cost?.complete ? 'true' : 'false'}>
          {footer}
        </p>
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
