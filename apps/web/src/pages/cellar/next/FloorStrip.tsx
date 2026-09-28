/**
 * THE CELLAR FLOOR — built, over confirmed zones only.
 *
 * Direction A's contribution, and the only answer on this page to *where*.
 * Sketch 092's floor and 095's strip are the design; this is that strip, with
 * the one clause that lets it exist at all: **a zone is drawn once somebody in
 * this house has confirmed its name, and never before.**
 *
 * WHY THE GATE. `public.storage_locations` cannot tell a zone somebody walked
 * from a zone a seeder invented, and a floor plan is the one surface where that
 * difference IS the content — a drawn room asserts a room. Measured on
 * production 2026-09-04: **4 rows across 2 tenants, and all four carry one of
 * the four names the seeded-defaults sweep named**. (87 across 7 tenants was
 * the 2026-09-02 figure; 83 have since been deleted, so the proportion went
 * from 84-of-87 to 4-of-4.) Two of the demo tenant's three also report a
 * `current_occupancy` disagreeing with the inventory rows actually assigned to
 * them — 180/32/45 against 17/17/16 — which is why what is IN a zone is counted
 * from those rows and `current_occupancy` never reaches this component.
 *
 * THE SHAPE IS THE CELLAR'S OWN: infer, then confirm. The register set already
 * works this way (`CellarRegistersStep`), and the founder asked for the same
 * here. The house's zones are listed with the names they currently carry, a
 * manager confirms or renames each once, and the strip fills in behind them.
 *
 * THE THREE STATES, EACH A DIFFERENT SENTENCE.
 *   unread      — the read failed, or the confirm columns are not on this
 *                 database yet. Words naming the migration. NEVER a drawn zone.
 *   none yet    — the zones are read and none is confirmed. "N zones not yet
 *                 confirmed", with the control. NEVER a drawn zone, and never
 *                 "no zones", which would be a claim about the building.
 *   some        — the confirmed ones are drawn; the rest stay in the sentence.
 */

import { useState } from 'react';
import { AlertTriangle, Check, MapPin, Pencil } from 'lucide-react';
import { EM, count } from './cellar-format';
import { useConfirmZone, useZones, type ZoneVM } from './useCellarNextData';

function Zone({ z }: { z: ZoneVM }) {
  return (
    <div className="cl-zone" data-testid={`zone-${z.id}`}>
      <b>{z.name}</b>
      <span className="cl-zone-n">
        {z.itemsAssigned === null ? EM : count(z.itemsAssigned)}
      </span>
      <span className="cl-dim" style={{ fontSize: 10.5 }}>
        {z.itemsAssigned === null
          ? 'contents could not be counted'
          : `${z.itemsAssigned === 1 ? 'title' : 'titles'} assigned${
              z.capacityBottles === null ? '' : ` · holds ${z.capacityBottles}`
            }`}
      </span>
      {z.provenance === 'renamed' ? (
        <span className="cl-dim" style={{ fontSize: 10 }}>renamed by the house</span>
      ) : null}
    </div>
  );
}

export default function FloorStrip() {
  const zones = useZones();
  const write = useConfirmZone();
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const data = zones.data;

  return (
    <section style={{ marginTop: 26 }} data-testid="floor-strip">
      <h2 className="cl-sec">On the floor</h2>

      {zones.loading ? (
        <p className="cl-said" role="status" data-testid="floor-loading">
          Reading this house’s zones…
        </p>
      ) : zones.error !== null || data === null || !data.readable ? (
        <p className="cl-said" role="alert" data-testid="floor-unread">
          <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
          {data?.reason ?? zones.error ?? 'The zones could not be read.'} Nothing
          is drawn: a floor plan asserts a room, and this page will not draw one
          it could not read.
        </p>
      ) : (
        <>
          {data.confirmed.length > 0 ? (
            <div className="cl-floor">
              {data.confirmed.map((z) => (
                <Zone key={z.id} z={z} />
              ))}
            </div>
          ) : null}

          {data.counts.unconfirmed > 0 ? (
            <p className="cl-said" data-testid="floor-unconfirmed">
              <MapPin size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {count(data.counts.unconfirmed)}{' '}
              {data.counts.unconfirmed === 1 ? 'zone is' : 'zones are'} not yet
              confirmed
              {data.confirmed.length === 0
                ? ', so the floor is not drawn at all yet'
                : ' and are not drawn'}
              . Every zone here was written by a seeder or an import until
              somebody in this house says otherwise.{' '}
              <button
                type="button"
                className="cl-btn cl-focus"
                onClick={() => setAsking((v) => !v)}
                data-testid="floor-confirm-open"
              >
                {asking ? 'Later' : 'Confirm your zones'}
              </button>
            </p>
          ) : data.counts.total === 0 ? (
            <p className="cl-said cl-dim" data-testid="floor-none">
              This house has no storage zones on record. That is a fact about the
              book, not about the building — add one from Settings and it will
              appear here once it is named.
            </p>
          ) : null}

          {asking ? (
            <div className="cl-confirmzones" data-testid="floor-confirm">
              <p className="cl-note" style={{ marginTop: 0 }}>
                Confirm the name as it stands, or type the name this room
                actually goes by. Either way it is recorded against you and the
                zone joins the floor.
              </p>
              {write.error !== null ? (
                <p className="cl-said" role="alert" data-testid="floor-confirm-error">
                  <AlertTriangle size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
                  That zone was not written ({write.error}). Nothing was
                  confirmed.
                </p>
              ) : null}
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
                {data.unconfirmed.map((z) => (
                  <li key={z.id} className="cl-zonerow">
                    <label className="cl-sr" htmlFor={`cl-zone-${z.id}`}>
                      Name for {z.name}
                    </label>
                    <input
                      id={`cl-zone-${z.id}`}
                      className="cl-field cl-focus"
                      value={draft[z.id] ?? z.name}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [z.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="cl-btn cl-focus"
                      disabled={write.saving}
                      onClick={() => {
                        const next = (draft[z.id] ?? z.name).trim();
                        void write.confirm(
                          next === z.name
                            ? { zoneId: z.id }
                            : { zoneId: z.id, name: next },
                        );
                      }}
                      data-testid={`zone-confirm-${z.id}`}
                    >
                      {(draft[z.id] ?? z.name).trim() === z.name ? (
                        <>
                          <Check size={12} aria-hidden /> It is called that
                        </>
                      ) : (
                        <>
                          <Pencil size={12} aria-hidden /> Rename it
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="cl-note">{data.scopeNote}</p>
        </>
      )}
    </section>
  );
}
