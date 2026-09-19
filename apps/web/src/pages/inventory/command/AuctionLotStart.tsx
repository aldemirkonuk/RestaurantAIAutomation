/**
 * "Carry this bottle · an auction lot" — the owed act on `/inventory`, and the
 * fourth START the founder ruled for on 2026-09-05.
 *
 * WHAT WAS OWED, AND WHAT THE LEGACY ACTUALLY WAS. `AuctionPurchaseModal.tsx:133`
 * is unreachable — nothing imports it, and the gateway's own flag registry says
 * so in as many words (`feature-flag-registry.ts:308`). Worse, when it WAS
 * reachable it could not have worked: it posts to `POST /wines/research` and
 * `POST /wines/auction-purchase`, and **neither route exists in this gateway**
 * (grepped 2026-09-06: zero matches for either path outside that file). It also
 * used raw `axios` against `VITE_API_GATEWAY_URL`, so it carried no token.
 *
 * So this is not a migration of a working act. It is the act, built.
 *
 * A BOTTLE FROM AN AUCTION IS STILL A BOTTLE ENTERING THE BOOK. The census makes
 * it a START of the carry sheet rather than a surface of its own, and everything
 * below follows from that: the bottle is chosen from the house register the way
 * every other start chooses one, and it enters through the SAME
 * `POST /inventory` (`useCreateInventoryItem`) the carry sheet uses. There is no
 * auction pipeline, and inventing one would be a second way for stock to appear.
 *
 * WHAT THE AUCTION ADDS IS A COST WITH ITS WORKING SHOWN.
 *
 *     (hammer + buyer's premium) ÷ bottles = cost per bottle
 *
 * and that figure goes in as `costPerBottle` with provenance `manual`, because a
 * person typed the hammer price. `manual` is not a shrug: `inventory_lots`'
 * own CHECK allows exactly `invoice · estimated · manual · sample`
 * (`20260805000000_baseline_from_production.sql:3188`), and of those four,
 * manual is what a figure a person typed IS.
 *
 * WHAT CANNOT BE KEPT, SAID ON THE SHEET. The auction house, the lot number and
 * the sale date have NO COLUMN anywhere in this schema. This sheet does not
 * offer to save them and then drop them; it takes them, uses them to work out
 * the cost, prints them back so they can be copied somewhere that does keep
 * them, and says plainly that the book keeps the figure and not the lot. ADR
 * 0083 — a control may not claim a write it never makes. The gap is filed in
 * `inventory.md` §9.
 *
 * MERGE POINT WITH PACKET 1. Packet 1 is moving the carry sheet
 * (`components/inventory/AddWineToInventoryModal.tsx`) onto the primitive. This
 * file deliberately touches none of theirs: it is a Sheet of its own with a
 * clean `onCarried` callback, and at their merge it folds into that sheet as its
 * fourth tab beside "search" and "photo" — the body below becomes the tab's
 * panel and this file's own `Sheet` wrapper is what goes.
 */

import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/mudavym';
import { getErrorMessage } from '@/services/api/client';
import { searchWines } from '@/services/api/wines';

export interface AuctionLot {
  house: string;
  lotNumber: string;
  saleDate: string;
  hammer: string;
  premium: string;
  bottles: string;
}

export const EMPTY_LOT: AuctionLot = {
  house: '',
  lotNumber: '',
  saleDate: '',
  hammer: '',
  premium: '',
  bottles: '1',
};

/** A wine as the register hands it over. Only what this start needs. */
export interface RegisterWine {
  id: string;
  name: string;
  producer?: string | null;
  vintage?: number | null;
}

function num(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export type LotCost =
  | { ok: true; total: number; bottles: number; perBottle: number; working: string }
  | { ok: false; why: string };

/**
 * What the lot cost each bottle, and the sentence that shows the working.
 *
 * A premium that was not stated is NOT zero — an auction with no premium and an
 * auction whose premium nobody typed are different facts, and the second one
 * cannot produce a cost. That is the whole reason this returns a discriminated
 * result rather than a number: a fallback of 0 here would put a wrong unit cost
 * into the WAC rollup, silently, for the life of the lot.
 */
export function lotCost(lot: AuctionLot): LotCost {
  const hammer = num(lot.hammer);
  const premium = num(lot.premium);
  const bottles = num(lot.bottles);

  if (hammer === null) return { ok: false, why: 'The hammer price has not been stated.' };
  if (hammer < 0) return { ok: false, why: 'A hammer price cannot be negative.' };
  if (premium === null)
    return {
      ok: false,
      why: "The buyer's premium has not been stated. If there was none, type 0 — an unstated premium and a premium of nothing are different facts.",
    };
  if (premium < 0) return { ok: false, why: "A buyer's premium cannot be negative." };
  if (bottles === null || !Number.isInteger(bottles) || bottles < 1)
    return { ok: false, why: 'Say how many bottles were in the lot, as a whole number.' };

  const total = hammer + premium;
  const perBottle = Math.round((total / bottles) * 100) / 100;
  return {
    ok: true,
    total,
    bottles,
    perBottle,
    working: `${hammer} hammer + ${premium} premium = ${total}, over ${bottles} ${
      bottles === 1 ? 'bottle' : 'bottles'
    } = ${perBottle} each.`,
  };
}

/** How the lot reads back, for copying somewhere that can keep it. */
export function lotWords(lot: AuctionLot): string {
  const bits = [
    lot.house.trim() || null,
    lot.lotNumber.trim() ? `lot ${lot.lotNumber.trim()}` : null,
    lot.saleDate.trim() || null,
  ].filter(Boolean);
  return bits.length === 0 ? 'no auction details were typed' : bits.join(' · ');
}

export interface AuctionLotStartProps {
  open: boolean;
  onClose: () => void;
  /**
   * Carry it in. The page owns the write, exactly as it owns the carry sheet's:
   * one path into the book, not two.
   */
  onCarry: (input: {
    wine: RegisterWine;
    quantity: number;
    costPerBottle: number;
  }) => Promise<void>;
}

export function AuctionLotStart({ open, onClose, onCarry }: AuctionLotStartProps) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RegisterWine[] | null | undefined>(undefined);
  const [wine, setWine] = useState<RegisterWine | null>(null);
  const [lot, setLot] = useState<AuctionLot>(EMPTY_LOT);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /* The register, searched. `undefined` is "nothing asked yet", `null` is a read
     that FAILED — an empty list drawn for a thrown request would tell a person
     the house does not stock a wine nobody looked for. */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setRows(undefined);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      searchWines({ search: q, limit: 8 } as never)
        .then((found) => {
          if (!cancelled) setRows(found as unknown as RegisterWine[]);
        })
        .catch(() => {
          if (!cancelled) setRows(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, open]);

  const cost = useMemo(() => lotCost(lot), [lot]);
  const canCarry = !!wine && cost.ok && !busy;

  const carry = async () => {
    if (!wine || !cost.ok || busy) return;
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      await onCarry({ wine, quantity: cost.bottles, costPerBottle: cost.perBottle });
      setDone(
        `${wine.name} carried in — ${cost.bottles} ${cost.bottles === 1 ? 'bottle' : 'bottles'} at ${cost.perBottle} each. The lot's own details (${lotWords(lot)}) were NOT saved: the book has no column for them.`,
      );
      setWine(null);
      setLot(EMPTY_LOT);
      setQuery('');
    } catch (e) {
      setFailure(
        `The bottles were not carried in (${getErrorMessage(e)}). Nothing was written to the book and your figures are still here.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    width: '100%',
    fontSize: 12.5,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--paper-2, #EAE4D8)',
    background: 'var(--paper-0, #FAF7F1)',
    color: 'var(--ink-1, #211C16)',
  };
  const legend: React.CSSProperties = {
    display: 'block',
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.11em',
    textTransform: 'uppercase',
    color: 'var(--ink-3, #7C7365)',
    marginBottom: 3,
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      /* The contract, as the accessible name. */
      label="This carries bottles bought at auction into the book. Carrying them writes stock and a unit cost worked out from the lot; the auction's own details are not saved, because the book has no column for them. Leaving writes nothing."
      eyebrow="The register"
      title="Carry this bottle · an auction lot"
      closeLabel="Put it down"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            An auction bottle is still one bottle entering the book.
          </span>
          <button
            type="button"
            onClick={() => void carry()}
            disabled={!canCarry}
            data-testid="auction-carry"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: '7px 14px',
              borderRadius: 3,
              border: '1px solid var(--seal, #1A5E6B)',
              background: canCarry ? 'var(--seal, #1A5E6B)' : 'transparent',
              color: canCarry ? 'var(--paper-0, #FBF8F1)' : 'var(--ink-3, #7C7365)',
              cursor: canCarry ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Carrying it in…' : 'Carry it in'}
          </button>
        </div>
      }
    >
      <label style={legend} htmlFor="auction-search">
        Which bottle
      </label>
      <input
        id="auction-search"
        style={field}
        value={query}
        data-testid="auction-search"
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Öküzgözü, Chablis, Barolo…"
      />

      {rows === null && (
        <p role="status" data-testid="auction-register-unreadable" style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
          The register could not be read. Nothing is listed because nothing could be read — this
          is not a register without this bottle in it.
        </p>
      )}
      {Array.isArray(rows) && rows.length === 0 && (
        <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          Nothing in the register matches “{query.trim()}”. A bottle has to be in the register
          before it can be carried in.
        </p>
      )}
      {Array.isArray(rows) && rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {rows.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                data-testid="auction-pick"
                onClick={() => {
                  setWine(w);
                  setRows(undefined);
                  setQuery('');
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  fontSize: 12.5,
                  padding: '5px 7px',
                  marginTop: 4,
                  borderRadius: 5,
                  border: '1px solid var(--paper-2, #EAE4D8)',
                  background: 'transparent',
                  color: 'var(--ink-1, #211C16)',
                  cursor: 'pointer',
                }}
              >
                {w.name}
                {w.vintage ? ` ${w.vintage}` : ''}
                {w.producer ? ` · ${w.producer}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {wine && (
        <p data-testid="auction-chosen" style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-1, #211C16)' }}>
          {wine.name}
          {wine.vintage ? ` ${wine.vintage}` : ''}
        </p>
      )}

      {/* ── the lot ───────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label style={legend} htmlFor="auction-house">
            Auction house
          </label>
          <input
            id="auction-house"
            style={field}
            value={lot.house}
            data-testid="auction-house"
            onChange={(e) => setLot({ ...lot, house: e.target.value })}
          />
        </div>
        <div>
          <label style={legend} htmlFor="auction-lot">
            Lot number
          </label>
          <input
            id="auction-lot"
            style={field}
            value={lot.lotNumber}
            data-testid="auction-lot"
            onChange={(e) => setLot({ ...lot, lotNumber: e.target.value })}
          />
        </div>
        <div>
          <label style={legend} htmlFor="auction-date">
            Sale date
          </label>
          <input
            id="auction-date"
            type="date"
            style={field}
            value={lot.saleDate}
            data-testid="auction-date"
            onChange={(e) => setLot({ ...lot, saleDate: e.target.value })}
          />
        </div>
        <div>
          <label style={legend} htmlFor="auction-hammer">
            Hammer price
          </label>
          <input
            id="auction-hammer"
            inputMode="decimal"
            style={field}
            value={lot.hammer}
            data-testid="auction-hammer"
            onChange={(e) => setLot({ ...lot, hammer: e.target.value })}
          />
        </div>
        <div>
          <label style={legend} htmlFor="auction-premium">
            Buyer’s premium
          </label>
          <input
            id="auction-premium"
            inputMode="decimal"
            style={field}
            value={lot.premium}
            data-testid="auction-premium"
            onChange={(e) => setLot({ ...lot, premium: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label style={legend} htmlFor="auction-bottles">
            Bottles in the lot
          </label>
          <input
            id="auction-bottles"
            inputMode="numeric"
            style={field}
            value={lot.bottles}
            data-testid="auction-bottles"
            onChange={(e) => setLot({ ...lot, bottles: e.target.value })}
          />
        </div>
      </div>

      {/* ── the working, always shown ─────────────────────────────────── */}
      <p
        className="mt-3"
        data-testid="auction-working"
        style={{
          borderLeft: '2px solid var(--seal-ring, rgba(26,94,107,.32))',
          paddingLeft: 8,
          fontSize: 11.5,
          color: 'var(--ink-2, #4F473C)',
        }}
      >
        {cost.ok ? cost.working : cost.why}
      </p>

      <p className="mt-2" data-testid="auction-not-kept" style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
        The book keeps the cost per bottle and records it as typed by a person. It does NOT keep
        the auction house, the lot number or the sale date — there is no column for any of them.
        Copy them somewhere that keeps them: {lotWords(lot)}.
      </p>

      {done && (
        <p role="status" className="mt-3" data-testid="auction-done" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
          {done}
        </p>
      )}
      {failure && (
        <p role="status" className="mt-3" data-testid="auction-failure" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
          {failure}
        </p>
      )}
    </Sheet>
  );
}

export default AuctionLotStart;
