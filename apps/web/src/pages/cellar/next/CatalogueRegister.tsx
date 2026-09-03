/**
 * A register that is now served, and the honest scope of what it serves.
 *
 * This replaces `UnwiredRegister`. That component existed to say "the table
 * exists and nothing serves it" — true when it was written, and false since
 * this pass shipped `apps/api-gateway/src/beverages/`. What has NOT changed is
 * the thing that actually matters, so it is stated on every screen here:
 *
 *  - `public.beverages` has no `restaurant_id`. These rows are the shared
 *    reference catalogue; they are not this house's stock and are never
 *    counted as such.
 *  - `restaurant_inventory` is keyed on `master_wine_id →
 *    master_wine_library`, so a keg cannot be stocked, counted, ordered or
 *    received. Browsable is the whole of what this register is today, and it
 *    says so rather than showing an "On hand" column full of dashes.
 *  - `cocktail_ingredients` is empty by design, so the cocktails register can
 *    list names and never a recipe.
 *  - Soft drinks have no `beverage_type` at all, so that register has nothing
 *    to ask for — a state with no rows AND no query, which is different again
 *    from an empty result.
 */

import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen } from 'lucide-react';
import RegisterNotice from './NeedsItemsNotice';
import RegisterEvidenceLine from './RegisterEvidenceLine';
import { EM, REGISTER_TITLE, money, volume, type RegisterId } from './cellar-format';
import { REGISTER_SOURCE } from './registerShapes';
import {
  useBeverageRegister,
  useCocktailRegister,
  type CellarData,
} from './useCellarNextData';

function Head({ id, readout }: { id: RegisterId; readout: CellarData['registers'] }) {
  const r = readout?.registers.find((x) => x.id === id);
  const source = REGISTER_SOURCE[id];
  return (
    <>
      <p className="cl-crumb">
        <Link to="/cellar" className="cl-focus">
          The Cellar
        </Link>{' '}
        · register
      </p>
      <h1 className="cl-h1">{REGISTER_TITLE[id]}</h1>
      <p className="cl-standing">{source.oneLine}</p>
      {r ? (
        <>
          <p className="cl-said" style={{ marginTop: 6 }}>
            {r.basis}
          </p>
          <RegisterEvidenceLine evidence={r.evidence} confidence={r.confidence} />
        </>
      ) : null}
      {r?.needsEvidence ? <RegisterNotice registers={[id]} /> : null}
      {r?.carried === false && (r?.strandedItems ?? 0) > 0 ? (
        <RegisterNotice kind="stranded" registers={[id]} counts={{ [id]: r.strandedItems }} />
      ) : null}
      <hr className="cl-rule" style={{ margin: '16px 0 18px' }} />
    </>
  );
}

function ScopeLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="cl-note" role="note" data-testid="register-scope">
      {text}
    </p>
  );
}

/* ── the two registers that have no source ─────────────────────────────── */

function NoSource({ id }: { id: RegisterId }) {
  const source = REGISTER_SOURCE[id];
  return (
    <div role="status" className="cl-panel" data-unwired="true" data-testid={`no-source-${id}`}>
      <p className="cl-said" style={{ color: 'var(--ink-1)' }}>
        {source.missing}
      </p>
      <dl style={{ margin: '14px 0 0', display: 'grid', gap: 6, fontSize: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <dt className="cl-dim" style={{ minWidth: 116 }}>
            Rows here today
          </dt>
          <dd style={{ margin: 0 }}>
            <span className="cl-num">{EM}</span> (nothing to ask — no column separates them)
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ── cocktails ─────────────────────────────────────────────────────────── */

function CocktailRows() {
  const { data, loading, error } = useCocktailRegister(true);

  if (loading) {
    return (
      <p className="cl-said" role="status">
        Reading this house’s cocktails…
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="cl-said" role="alert">
        <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        The cocktail list could not be read{error ? ` (${error})` : ''}. This is
        unread, not empty.
      </p>
    );
  }

  return (
    <>
      <ScopeLine text={data.scopeNote} />
      <p className="cl-note">
        Recipes were never extracted, so no row below carries its ingredients —
        `cocktail_ingredients` was created empty on purpose and is still empty.
        {data.referenceRows === null
          ? ' The count of unattributed reference cocktails could not be read.'
          : ` ${data.referenceRows} unattributed reference cocktails exist from the demo corpus and are deliberately not listed here.`}
      </p>
      {data.rows.length === 0 ? (
        <p className="cl-said" style={{ marginTop: 12 }} data-testid="cocktails-empty">
          This restaurant owns no cocktail rows. That read succeeded — this is an
          empty list, not a failed one.
        </p>
      ) : (
        <table className="cl-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th scope="col">Cocktail</th>
              <th scope="col">Section</th>
              <th scope="col">Method</th>
              <th scope="col">Glass</th>
              <th scope="col" style={{ textAlign: 'right' }}>Price</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((c) => (
              <tr key={c.id}>
                <td>{c.display_name ?? c.name}</td>
                <td>{c.menu_section ?? EM}</td>
                <td>{c.method ?? EM}</td>
                <td>{c.glass ?? EM}</td>
                <td className="cl-num" style={{ textAlign: 'right' }}>{money(c.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ── beer / whiskey / spirits / non-alcoholic ──────────────────────────── */

function BeverageRows({ id }: { id: RegisterId }) {
  const { data, loading, error } = useBeverageRegister(id);

  if (loading) {
    return (
      <p className="cl-said" role="status">
        Reading the {REGISTER_TITLE[id].toLowerCase()} catalogue…
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="cl-said" role="alert">
        <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        The {REGISTER_TITLE[id].toLowerCase()} catalogue could not be read
        {error ? ` (${error})` : ''}. This is unread, not empty.
      </p>
    );
  }

  return (
    <>
      <ScopeLine text={data.scopeNote} />
      <p className="cl-note">
        <BookOpen size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        Counted from `beverage_type` in ({data.matchedTypes.join(', ') || 'nothing'}).{' '}
        {data.truncated
          ? `This read is capped at ${data.limit} rows and came back full, so ${data.count} is a floor, not the size of the catalogue.`
          : `${data.count} rows.`}{' '}
        There is no “on hand” column because this house cannot hold stock of this
        kind yet — `restaurant_inventory` is keyed on the wine library.
      </p>
      {data.rows.length === 0 ? (
        <p className="cl-said" style={{ marginTop: 12 }} data-testid={`beverages-empty-${id}`}>
          The shared catalogue holds nothing of this kind. That read succeeded —
          this is an empty catalogue, not a failed read.
        </p>
      ) : (
        <table className="cl-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th scope="col">Bottle</th>
              <th scope="col">Type</th>
              <th scope="col">Origin</th>
              <th scope="col" style={{ textAlign: 'right' }}>ABV</th>
              <th scope="col" style={{ textAlign: 'right' }}>Format</th>
              <th scope="col" style={{ textAlign: 'right' }}>Reference</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.display_name ?? b.name}
                  {b.producer ? <span className="cl-dim"> · {b.producer}</span> : null}
                </td>
                <td>{b.beverage_type ?? EM}</td>
                <td>
                  {[b.region, b.country].filter((v) => v && v !== 'Unknown').join(', ') || EM}
                </td>
                <td className="cl-num" style={{ textAlign: 'right' }}>
                  {b.abv_pct === null || b.abv_pct === undefined ? EM : `${b.abv_pct}%`}
                </td>
                <td className="cl-num" style={{ textAlign: 'right' }}>{volume(b.volume_ml)}</td>
                <td className="cl-num" style={{ textAlign: 'right' }}>{money(b.price_reference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export default function CatalogueRegister({
  id,
  data,
}: {
  id: RegisterId;
  data: CellarData;
}) {
  const source = REGISTER_SOURCE[id];
  return (
    <div data-testid={`catalogue-${id}`}>
      <Head id={id} readout={data.registers} />
      {!source.wired ? (
        <NoSource id={id} />
      ) : id === 'cocktails' ? (
        <CocktailRows />
      ) : (
        <BeverageRows id={id} />
      )}
      <p className="cl-note" style={{ marginTop: 18 }}>
        Served by {source.served}.
      </p>
    </div>
  );
}
