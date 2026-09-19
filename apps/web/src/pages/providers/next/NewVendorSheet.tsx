/**
 * "A new vendor" — the owed act on `/providers`.
 *
 * WHAT WAS OWED. The rebuilt page can READ the vendor book and open one
 * vendor's twin. It could not add one. The legacy page could, and it split the
 * act across THREE modals: search the catalogue (`VendorSearchModal.tsx:161`),
 * type a vendor of your own (`AddProviderModal.tsx:361`), and invent a business
 * type (`AddProviderModal.tsx:629`). Census 102 makes the three one sheet,
 * because the vendor being added is one object however it was found.
 *
 * TWO DOORS, ONE OBJECT
 * ---------------------
 *  1. **From the catalogue.** `searchVendorCatalogue` → `addProviderFromCatalogue`
 *     (`POST /providers { catalogue_vendor_id }`). One press, verified data,
 *     nothing typed twice.
 *  2. **A vendor of your own.** `createProvider` (`POST /providers`), then two
 *     acts that are DELIBERATELY NOT part of it, carried over verbatim in
 *     structure from `pages/Providers.tsx:518-573`:
 *       * the delivery days, written as a vendor TERM
 *         (`PUT /vendor-terms/:providerId`) — the only place in the schema that
 *         can hold them with a person's name attached;
 *       * the address, written as the vendor's primary LOCATION
 *         (`POST /providers/:id/locations`) — coordinates live there, not on the
 *         provider row, and a provider added without one is permanently
 *         unpinnable on the map.
 *     Both are decoupled from the create and REPORTED SEPARATELY: the vendor is
 *     already saved, and a terms failure must not present as "failed to add
 *     vendor". The legacy page learned that the hard way — a silent failure here
 *     is how the original delivery-days defect stayed invisible for a year.
 *
 * THE DUPLICATE QUESTION TRAVELS WITH IT. `useDuplicateVendorCheck` — the same
 * hook both legacy forms used, so the two can never disagree about what counts
 * as a duplicate — raises `VendorTwinPanel` over this sheet. Saving is refused
 * while a match is unanswered, exactly as the legacy form refused it
 * (`AddProviderModal.tsx:320`): the debounced lookup can resolve in the same
 * tick as a click.
 *
 * WHAT IS NOT DEFAULTED, ON PURPOSE. Payment terms start EMPTY. Seeding "Net
 * 30" made every vendor added assert Net 30 whether anybody chose it or not —
 * the same fabricated answer `providers.payment_terms DEFAULT 'Net 30'` used to
 * write, moved into the browser. Migration
 * `20260903170000_a_default_is_not_an_answer.sql` dropped the column default;
 * a form default would refill it.
 *
 * FOUR STATES ON THE CATALOGUE SEARCH, and the fourth is the one that matters:
 * a catalogue that could not be READ says so. `searchVendorCatalogue` throws,
 * and an empty list drawn for a thrown request would tell a person this vendor
 * is not in the catalogue when nobody looked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/mudavym';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/services/api/client';
import { useCreateProvider } from '@/hooks/queries/useProviderQueries';
import { createProviderLocation } from '@/services/api/providers';
import { setVendorTerms, weekdayNamesToIndices } from '@/services/api/vendorTerms';
import {
  addProviderFromCatalogue,
  searchVendorCatalogue,
  type VendorCatalogueEntry,
} from '@/services/api/vendors';
import { useDuplicateVendorCheck } from '@/hooks/useDuplicateVendorCheck';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { VendorTwinPanel } from './VendorTwinPanel';
import { EM, MONO, SANS, SERIF } from './pv-format';

/** The catalogue read, as three states plus its answer. Never two. */
export type CatalogueRegister =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'answered'; rows: VendorCatalogueEntry[] }
  | { state: 'unreadable'; message: string };

export const BUSINESS_TYPES = ['Distributor', 'Importer', 'Wholesaler'] as const;

export const DELIVERY_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** The legacy form's list, unchanged (`AddProviderModal.tsx:110-125`). */
export const WINE_SPECIALTIES = [
  'Red Wines',
  'White Wines',
  'Sparkling Wines',
  'Rosé Wines',
  'Dessert Wines',
  'French Wines',
  'Italian Wines',
  'Spanish Wines',
  'California Wines',
  'Oregon Wines',
  'Washington Wines',
  'Organic/Biodynamic',
  'Premium/Luxury',
  'Value Wines',
];

/** The legacy form's list, unchanged (`AddProviderModal.tsx:131-140`). */
export const PAYMENT_TERMS = [
  'Net 15',
  'Net 30',
  'Net 45',
  'Net 60',
  'Net 90',
  'COD (Cash on Delivery)',
  '2/10 Net 30',
];

export interface VendorDraft {
  name: string;
  contactFirstName: string;
  contactLastName: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  accountNumber: string;
  businessType: string;
  specialties: string[];
  paymentTerms: string;
  deliveryDays: string[];
  minimumOrder: string;
  notes: string;
}

export const EMPTY_VENDOR: VendorDraft = {
  name: '',
  contactFirstName: '',
  contactLastName: '',
  phone: '',
  email: '',
  website: '',
  address: '',
  accountNumber: '',
  businessType: 'Distributor',
  specialties: [],
  // Empty, never 'Net 30'. See the header.
  paymentTerms: '',
  deliveryDays: [],
  minimumOrder: '',
  notes: '',
};

/**
 * The legacy form's validation, restated with its citation
 * (`AddProviderModal.tsx:288-312`) and its phone rule kept at the same
 * strictness. Returns the fields that are wrong, keyed as the form keys them,
 * so each says its own refusal beside itself rather than in one heap.
 */
export function vendorRefusals(d: VendorDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d.name.trim()) out.name = 'A vendor needs a name.';
  if (!d.contactFirstName.trim()) out.contactFirstName = 'Name the person this house deals with.';
  if (!d.phone.trim()) out.phone = 'A phone number is required.';
  else if (d.phone.replace(/\D/g, '').length < 7) out.phone = 'That is not a phone number.';
  if (!d.email.trim()) out.email = 'An email address is required — the house writes to vendors.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) out.email = 'That is not an email address.';
  if (d.specialties.length === 0) out.specialties = 'Say what this vendor sells — at least one.';
  if (d.minimumOrder.trim() !== '' && !Number.isFinite(Number(d.minimumOrder))) {
    out.minimumOrder = 'A minimum order is a number, or nothing at all.';
  }
  return out;
}

const field: React.CSSProperties = {
  width: '100%',
  fontFamily: SANS,
  fontSize: 12.5,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
};

const legend: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.11em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  marginBottom: 3,
  display: 'block',
};

function chip(on: boolean): React.CSSProperties {
  return {
    fontFamily: SANS,
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 3,
    cursor: 'pointer',
    border: on
      ? '1px solid var(--seal-ring, rgba(26,94,107,.32))'
      : '1px solid var(--paper-2, #EAE4D8)',
    background: on ? 'var(--seal-tint, rgba(26,94,107,.08))' : 'transparent',
    color: on ? 'var(--seal-deep, #14515C)' : 'var(--ink-2, #4F473C)',
    fontWeight: on ? 600 : 400,
  };
}

export interface NewVendorSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called once a vendor really is in the book, so the page refetches. */
  onAdded: () => void;
}

export function NewVendorSheet({ open, onClose, onAdded }: NewVendorSheetProps) {
  const { activeRestaurantId, user } = useAuth();
  const restaurantId = activeRestaurantId || user?.restaurantId || '';
  const createProvider = useCreateProvider();
  const { preferences, updatePreferences } = useUserPreferences();

  const [query, setQuery] = useState('');
  const [catalogue, setCatalogue] = useState<CatalogueRegister>({ state: 'idle' });
  const [addingId, setAddingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VendorDraft>(EMPTY_VENDOR);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  /** What did not happen, in words. Cleared on the next attempt. */
  const [failure, setFailure] = useState<string | null>(null);
  /** What happened BESIDE the create — terms and location, each on its own. */
  const [asides, setAsides] = useState<string[]>([]);
  const [rating, setRating] = useState(0);

  const { pendingMatch, acknowledge, reset: resetMatches } = useDuplicateVendorCheck({
    enabled: open,
    name: draft.name,
    address: draft.address,
  });

  // A house switch must never leave the previous house's half-typed vendor.
  useEffect(() => {
    setDraft(EMPTY_VENDOR);
    setQuery('');
    setCatalogue({ state: 'idle' });
    setFailure(null);
    setAsides([]);
    resetMatches();
  }, [restaurantId, resetMatches]);

  /* ── the catalogue, read with its four states ─────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setCatalogue({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setCatalogue({ state: 'searching' });
    const t = window.setTimeout(() => {
      searchVendorCatalogue(q)
        .then((rows) => {
          if (!cancelled) setCatalogue({ state: 'answered', rows });
        })
        .catch((e) => {
          // NOT an empty list. Nobody looked, and the sheet says so — otherwise
          // a person types a vendor the catalogue already holds.
          if (!cancelled) setCatalogue({ state: 'unreadable', message: getErrorMessage(e) });
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, open]);

  const set = (patch: Partial<VendorDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const toggle = (key: 'specialties' | 'deliveryDays', value: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value],
    }));

  const refusals = useMemo(() => vendorRefusals(draft), [draft]);
  const clean = Object.keys(refusals).length === 0;

  const takeFromCatalogue = async (row: VendorCatalogueEntry) => {
    if (addingId) return;
    setAddingId(row.id);
    setFailure(null);
    try {
      await addProviderFromCatalogue(row.id);
      onAdded();
      onClose();
    } catch (e) {
      setFailure(
        `${row.name} was not added (${getErrorMessage(e)}). Nothing was written — the book is unchanged.`,
      );
    } finally {
      setAddingId(null);
    }
  };

  const save = useCallback(async () => {
    setTouched(true);
    if (!clean || saving) return;
    // Belt and braces, as the legacy form had it: the panel already overlays
    // this sheet whenever a match is pending, but the debounced lookup can
    // resolve in the same tick as the click.
    if (pendingMatch) return;
    if (!restaurantId) {
      setFailure('No house is selected, so there is nowhere to write this vendor. Nothing was saved.');
      return;
    }

    setSaving(true);
    setFailure(null);
    setAsides([]);
    try {
      const result = await createProvider.mutateAsync({
        name: draft.name.trim(),
        primaryBusinessType:
          (draft.businessType as 'Distributor' | 'Importer' | 'Wholesaler') || 'Distributor',
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        physicalAddress: draft.address.trim(),
        restaurantId,
        contactFirstName: draft.contactFirstName.trim(),
        contactLastName: draft.contactLastName.trim(),
        website: draft.website.trim() || undefined,
        accountNumber: draft.accountNumber.trim() || undefined,
        winePortfolio: draft.specialties.join(', '),
        // Undefined, never '' — an empty string is a payment term nobody stated
        // written down as a payment term somebody stated.
        paymentTerms: draft.paymentTerms || undefined,
        minimumOrderValue:
          draft.minimumOrder.trim() === '' ? undefined : Number(draft.minimumOrder),
        notes: draft.notes.trim() || undefined,
      });

      const id = result?.id;
      const said: string[] = [];

      // The rating is this person's own note about the vendor, stored in their
      // preferences exactly where the legacy page stored it
      // (`pages/Providers.tsx:289-292`) — it is not a fact about the vendor and
      // it never was, so it does not go on the provider row.
      if (rating > 0 && id) {
        const previous = (preferences.providerRatings ?? {}) as Record<string, number>;
        updatePreferences({ providerRatings: { ...previous, [id]: rating } });
      }

      // THE DELIVERY DAYS, as a vendor TERM. Decoupled on purpose.
      if (id && draft.deliveryDays.length > 0) {
        try {
          await setVendorTerms(id, {
            deliveryWeekdays: weekdayNamesToIndices([...draft.deliveryDays]),
          });
          said.push('The delivery days were recorded on the vendor’s terms.');
        } catch (e) {
          said.push(
            `The vendor is in the book, but the delivery days were NOT recorded (${getErrorMessage(e)}). Set them on the vendor’s row.`,
          );
        }
      }

      // THE ADDRESS, as the primary location. Coordinates live there, not on the
      // provider row; without one the vendor is unpinnable on the map.
      if (id && draft.address.trim()) {
        try {
          await createProviderLocation(id, {
            name: 'Main Office',
            type: 'office',
            address: draft.address.trim(),
            isPrimary: true,
          });
          said.push(
            'The address is on file as the main office. It has no coordinates, so it cannot be placed on the map until one is picked from an address search.',
          );
        } catch (e) {
          said.push(
            `The vendor is in the book, but its address was NOT mapped (${getErrorMessage(e)}).`,
          );
        }
      }

      setAsides(said);
      setDraft(EMPTY_VENDOR);
      setRating(0);
      setTouched(false);
      resetMatches();
      onAdded();
      // The sheet stays open only when something BESIDE the create needs saying.
      if (said.every((s) => !s.includes('NOT'))) onClose();
    } catch (e) {
      setFailure(
        `The vendor was not added (${getErrorMessage(e)}). Nothing was written and your words are still here.`,
      );
    } finally {
      setSaving(false);
    }
  }, [
    clean,
    saving,
    pendingMatch,
    restaurantId,
    createProvider,
    draft,
    rating,
    preferences.providerRatings,
    updatePreferences,
    resetMatches,
    onAdded,
    onClose,
  ]);

  const problem = (key: string) =>
    touched && refusals[key] ? (
      <p
        role="status"
        data-testid={`vendor-problem-${key}`}
        style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}
      >
        {refusals[key]}
      </p>
    ) : null;

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        /* The contract, as the accessible name (sketch 103, 1e). */
        label="Add a vendor to this house's book, from the shared catalogue or by writing one of your own. Saving writes a vendor; leaving writes nothing."
        eyebrow="The book of vendors"
        title="A new vendor"
        closeLabel="Put it down"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
              Terms are written on the vendor’s row afterwards, each with its provenance.
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              data-testid="vendor-save"
              style={{
                fontFamily: SANS,
                fontSize: 12.5,
                fontWeight: 600,
                padding: '7px 14px',
                borderRadius: 3,
                border: '1px solid var(--seal, #1A5E6B)',
                background: saving ? 'transparent' : 'var(--seal, #1A5E6B)',
                color: saving ? 'var(--ink-3, #7C7365)' : 'var(--paper-0, #FBF8F1)',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Writing it down…' : 'Add to the book'}
            </button>
          </div>
        }
      >
        <div style={{ fontFamily: SANS, fontSize: 12.5 }}>
          {/* ── door one: the catalogue ──────────────────────────────── */}
          <label style={legend} htmlFor="nv-catalogue">
            Search the catalogue
          </label>
          <input
            id="nv-catalogue"
            style={field}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sevilen, Kavaklıdere, Breakthru…"
            data-testid="vendor-catalogue-search"
          />

          {catalogue.state === 'searching' && (
            <p className="mt-1.5" style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
              Reading the catalogue…
            </p>
          )}
          {catalogue.state === 'unreadable' && (
            <p
              role="status"
              data-testid="vendor-catalogue-unreadable"
              className="mt-1.5"
              style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}
            >
              The catalogue could not be read ({catalogue.message}). Nothing is listed because
              nothing could be read — this vendor may well be in it.
            </p>
          )}
          {catalogue.state === 'answered' && catalogue.rows.length === 0 && (
            <p
              data-testid="vendor-catalogue-empty"
              className="mt-1.5"
              style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}
            >
              Nothing in the catalogue matches “{query.trim()}”. Write the vendor yourself below.
            </p>
          )}
          {catalogue.state === 'answered' && catalogue.rows.length > 0 && (
            <ul className="mt-1.5" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {catalogue.rows.slice(0, 6).map((row) => (
                <li
                  key={row.id}
                  data-testid="vendor-catalogue-row"
                  className="mt-1.5"
                  style={{
                    border: '1px solid var(--paper-2, #EAE4D8)',
                    borderRadius: 6,
                    padding: '7px 9px',
                  }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span style={{ fontFamily: SERIF, fontSize: 13.5, color: 'var(--ink-1, #211C16)' }}>
                      {row.name}
                    </span>
                    <button
                      type="button"
                      disabled={addingId !== null}
                      data-testid="vendor-catalogue-take"
                      onClick={() => void takeFromCatalogue(row)}
                      style={{
                        fontFamily: SANS,
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 3,
                        border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                        background: 'transparent',
                        color: 'var(--seal-deep, #14515C)',
                        cursor: addingId === null ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {addingId === row.id ? 'Adding…' : 'Add this one'}
                    </button>
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    {[row.city, row.state, row.country].filter(Boolean).join(' · ') || EM}
                    {row.type ? ` · ${row.type.replace('_', ' ')}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* ── door two: a vendor of your own ───────────────────────── */}
          <h3
            className="mt-5"
            style={{
              fontFamily: MONO,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-3, #7C7365)',
            }}
          >
            Or a vendor of your own
          </h3>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label style={legend} htmlFor="nv-name">
                Name
              </label>
              <input
                id="nv-name"
                style={field}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                data-testid="vendor-name"
              />
              {problem('name')}
            </div>

            <div>
              <label style={legend} htmlFor="nv-first">
                Contact — first name
              </label>
              <input
                id="nv-first"
                style={field}
                value={draft.contactFirstName}
                onChange={(e) => set({ contactFirstName: e.target.value })}
                data-testid="vendor-first"
              />
              {problem('contactFirstName')}
            </div>
            <div>
              <label style={legend} htmlFor="nv-last">
                Contact — last name
              </label>
              <input
                id="nv-last"
                style={field}
                value={draft.contactLastName}
                onChange={(e) => set({ contactLastName: e.target.value })}
              />
            </div>

            <div>
              <label style={legend} htmlFor="nv-phone">
                Phone
              </label>
              <input
                id="nv-phone"
                style={field}
                value={draft.phone}
                onChange={(e) => set({ phone: e.target.value })}
                data-testid="vendor-phone"
              />
              {problem('phone')}
            </div>
            <div>
              <label style={legend} htmlFor="nv-email">
                Email
              </label>
              <input
                id="nv-email"
                style={field}
                value={draft.email}
                onChange={(e) => set({ email: e.target.value })}
                data-testid="vendor-email"
              />
              {problem('email')}
            </div>

            <div className="col-span-2">
              <label style={legend} htmlFor="nv-address">
                Address
              </label>
              <input
                id="nv-address"
                style={field}
                value={draft.address}
                onChange={(e) => set({ address: e.target.value })}
                data-testid="vendor-address"
              />
            </div>

            <div>
              <label style={legend} htmlFor="nv-website">
                Website
              </label>
              <input
                id="nv-website"
                style={field}
                value={draft.website}
                onChange={(e) => set({ website: e.target.value })}
              />
            </div>
            <div>
              <label style={legend} htmlFor="nv-account">
                Account number
              </label>
              <input
                id="nv-account"
                style={field}
                value={draft.accountNumber}
                onChange={(e) => set({ accountNumber: e.target.value })}
              />
            </div>

            <div>
              <label style={legend} htmlFor="nv-type">
                What they are
              </label>
              <select
                id="nv-type"
                style={field}
                value={draft.businessType}
                onChange={(e) => set({ businessType: e.target.value })}
                data-testid="vendor-type"
              >
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={legend} htmlFor="nv-min">
                Minimum order
              </label>
              <input
                id="nv-min"
                style={field}
                inputMode="decimal"
                value={draft.minimumOrder}
                onChange={(e) => set({ minimumOrder: e.target.value })}
              />
              {problem('minimumOrder')}
            </div>
          </div>

          <fieldset className="mt-3 border-0 p-0">
            <legend style={legend}>What they sell</legend>
            <div className="flex flex-wrap gap-1.5">
              {WINE_SPECIALTIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={draft.specialties.includes(s)}
                  onClick={() => toggle('specialties', s)}
                  style={chip(draft.specialties.includes(s))}
                >
                  {s}
                </button>
              ))}
            </div>
            {problem('specialties')}
          </fieldset>

          <fieldset className="mt-3 border-0 p-0">
            <legend style={legend}>Days they deliver</legend>
            <div className="flex flex-wrap gap-1.5">
              {DELIVERY_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.deliveryDays.includes(d)}
                  onClick={() => toggle('deliveryDays', d)}
                  style={chip(draft.deliveryDays.includes(d))}
                >
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
              Recorded as a vendor term, with your name on it — not on the vendor’s row.
            </p>
          </fieldset>

          <div className="mt-3">
            <label style={legend} htmlFor="nv-terms">
              Payment terms
            </label>
            <select
              id="nv-terms"
              style={field}
              value={draft.paymentTerms}
              onChange={(e) => set({ paymentTerms: e.target.value })}
              data-testid="vendor-payment-terms"
            >
              <option value="">Not stated</option>
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
              Left unstated unless somebody states it. A default here would write a term nobody
              agreed.
            </p>
          </div>

          <div className="mt-3">
            <label style={legend} htmlFor="nv-notes">
              Notes
            </label>
            <textarea
              id="nv-notes"
              style={{ ...field, minHeight: 54 }}
              value={draft.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          <fieldset className="mt-3 border-0 p-0">
            <legend style={legend}>Your own mark out of five</legend>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={rating === n}
                  aria-label={`${n} out of five`}
                  onClick={() => setRating(rating === n ? 0 : n)}
                  style={chip(rating === n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
              Kept with your own preferences, not on the vendor’s row — it is your opinion, not a
              fact about them.
            </p>
          </fieldset>

          {asides.length > 0 && (
            <ul
              role="status"
              data-testid="vendor-asides"
              className="mt-3"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {asides.map((a) => (
                <li key={a} style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', marginTop: 3 }}>
                  {a}
                </li>
              ))}
            </ul>
          )}

          {failure && (
            <p
              role="status"
              data-testid="vendor-failure"
              className="mt-3"
              style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}
            >
              {failure}
            </p>
          )}
        </div>
      </Sheet>

      {/* The question, over the sheet it interrupts. */}
      <VendorTwinPanel
        open={!!pendingMatch}
        match={pendingMatch}
        context="add"
        onUsedCatalogue={() => {
          setDraft(EMPTY_VENDOR);
          resetMatches();
          onAdded();
          onClose();
        }}
        onKeepBoth={() => {
          if (pendingMatch) acknowledge(pendingMatch.id);
        }}
      />
    </>
  );
}

export default NewVendorSheet;
