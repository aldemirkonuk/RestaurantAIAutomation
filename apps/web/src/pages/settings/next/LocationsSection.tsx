/**
 * Locations & chains — the branches on this account and how they group.
 *
 * BOTH DATES ARE REAL NOW (audit BLOCKERs 2 and 3)
 * -----------------------------------------------
 * The first pass printed "the chains table records no last-changed date" and
 * "the branch record carries no last-changed date". Neither was true of the
 * database; both were true only of the wire, and a page cannot show a date it
 * was never handed. The gateway now hands them over:
 *
 *   chains   `organizations.service.ts` — `getChainsForUser` selects
 *            `updated_at`, and `renameChain` STAMPS it, because
 *            `restaurant_chains` has no `BEFORE UPDATE` trigger and the column
 *            would otherwise have held the creation time for ever. Returning it
 *            without that stamp would have been worse than the em dash: a
 *            creation date printed under the word "changed".
 *   branches `getBranchesForUser` selects `updated_at` on all three paths
 *            (organisation, legacy access, single-restaurant fallback).
 *            `restaurants.updated_at` is maintained by
 *            `update_restaurants_updated_at BEFORE UPDATE`
 *            (baseline_from_production.sql:12300), so it is a genuine
 *            last-changed date rather than a disguised creation date.
 *
 * The branch list is the session's, so a branch cached by a browser that has not
 * re-fetched since the gateway change arrives without the field. That case gets
 * an em dash naming itself, never a substituted date.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AddLocationDialog } from '@/components/locations/AddLocationDialog';
import { CreateChainDialog } from '@/components/locations/CreateChainDialog';
import { AssignToChainDialog } from '@/components/locations/AssignToChainDialog';
import { EditLocationChainDialog } from '@/components/locations/EditLocationChainDialog';
import type { RestaurantBranch } from '@/contexts/AuthContext';
import { Action, Micro, Note, Register, Row } from './SectionKit';
import { EM, SANS } from './st-format';
import { branchUpdatedAt, type SettingsNextData } from './useSettingsNextData';

const NO_BRANCH_DATE =
  'this branch reached your session without one — reload to fetch it again';

/**
 * What a chain row says about its size. The gateway's count covers every branch
 * in the chain and is sent only to an owner of it; anyone else is told how many
 * of THEIR branches are in it, never a number that reads as the whole (F-659).
 */
function chainSizeLine(total: number | null | undefined, mine: number): string {
  if (typeof total === 'number') return total === 1 ? '1 branch in this chain.' : `${total} branches in this chain.`;
  return mine === 1 ? '1 of your branches is in this chain.' : `${mine} of your branches are in this chain.`;
}

export function LocationsSection({ data }: { data: SettingsNextData }) {
  const { chains, locations, restaurantId, isOwner, refreshBranches } = data;
  const [adding, setAdding] = useState(false);
  const [creatingChain, setCreatingChain] = useState(false);
  const [assigning, setAssigning] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<RestaurantBranch | null>(null);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // F-913: the house switcher's "Add location" lands here with `action=add`.
  // It opens the form for an owner, once; the param is dropped so a reload or
  // a back step does not reopen it.
  const addAsked = searchParams.get('action') === 'add';
  useEffect(() => {
    if (!addAsked) return;
    if (isOwner) setAdding(true);
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [addAsked, isOwner, searchParams, setSearchParams]);

  const standalone = locations.filter((b) => !b.chain_id);
  const asLite = (b: RestaurantBranch) => ({ id: b.id, name: b.name, city: b.city ?? null });

  return (
    <>
      <Note>
        The branches below come from your own session — the same list the header switches between. Chains are read
        separately, and only an owner may add a location or create or rename a chain. Both records carry their own last-changed date, kept by
        the database: a branch’s moves on any edit to it, a chain’s on a rename.
      </Note>

      {/* Only an owner may open a new location (the gateway refuses anyone else,
          F-242), so the button is not offered to a role that would be refused. */}
      {isOwner && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 8px' }}>
          <button ref={addAnchor} type="button" onClick={() => setAdding(true)} className="st-ink st-focus"
            style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 8,
              border: '1px solid var(--seal-ring)', background: 'var(--seal-tint)', color: 'var(--seal-deep)', cursor: 'pointer' }}>
            Add a location
          </button>
          <Action onClick={() => setCreatingChain(true)}>Create a chain</Action>
        </div>
      )}

      <Register remote={chains} name="the chain register"
        deniedNote="Chains were not opened for your role — an owner keeps them. The branches below are still yours.">
        {(rows) => (
          <>
            {rows.length === 0 && <Note role="status">No chain exists. Every branch below stands on its own.</Note>}
            {rows.map((c) => {
              const mine = locations.filter((b) => b.chain_id === c.id).length;
              return (
                <Row
                  key={c.id}
                  label={c.name}
                  consequence={chainSizeLine(c.location_count, mine)}
                  provenance={{
                    kept: 'restaurant',
                    when: c.updated_at ?? null,
                    whenUnknown: 'the gateway returned no date for this chain',
                  }}
                  control={isOwner ? <Action onClick={() => setAssigning({ id: c.id, name: c.name })}>Assign a branch</Action> : undefined}
                />
              );
            })}
          </>
        )}
      </Register>

      <div style={{ margin: '18px 0 0' }}><Micro tone="seal">Branches · {locations.length}</Micro></div>
      {locations.length === 0 && <Note role="status">Your session carries no branches.</Note>}
      {locations.map((b) => (
        <Row
          key={b.id}
          label={b.name}
          consequence={
            <>
              {b.city ?? <span>{EM} no city on the record</span>}
              <span aria-hidden> · </span>
              {b.chain_name ? `in ${b.chain_name}` : 'standalone'}
              {b.id === restaurantId ? ' · the branch you are working in now' : ''}
            </>
          }
          provenance={{ kept: 'restaurant', when: branchUpdatedAt(b), whenUnknown: NO_BRANCH_DATE }}
          control={<Action onClick={() => setEditing(b)}>Edit</Action>}
        />
      ))}

      <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '14px 0 0' }}>
        A branch’s date moves for <em>any</em> change to it — a rename, a city, a chain assignment, and also a new
        calendar feed token, which is a column on the same row. It says when the row was last written, not what was
        written. Of the edits made here, only an owner’s change to the state or country is recorded with a name, in
        the settings log (ADR 0289); nothing records who renamed a branch, moved its city or changed its chain.
      </p>

      <AddLocationDialog
        open={adding}
        onClose={() => setAdding(false)}
        anchorRef={addAnchor}
        onLocationAdded={async () => { await refreshBranches(); setAdding(false); }}
      />
      <CreateChainDialog
        open={creatingChain}
        onClose={() => setCreatingChain(false)}
        onCreated={() => { chains.reload(); void refreshBranches(); }}
        standaloneLocations={standalone.map(asLite)}
      />
      {assigning && (
        <AssignToChainDialog
          open
          chainId={assigning.id}
          chainName={assigning.name}
          standaloneLocations={standalone.map(asLite)}
          onClose={() => setAssigning(null)}
          onSaved={async () => { await refreshBranches(); setAssigning(null); }}
          onCreateNew={() => { setAssigning(null); setAdding(true); }}
        />
      )}
      {editing && (
        <EditLocationChainDialog
          open
          branch={editing}
          canMoveChain={isOwner}
          chains={(chains.data ?? []).map((c) => ({ ...c, locationCount: c.location_count ?? undefined }))}
          onClose={() => setEditing(null)}
          onSaved={async () => { await refreshBranches(); setEditing(null); }}
        />
      )}
    </>
  );
}

export default LocationsSection;
