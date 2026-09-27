/**
 * "Add a price you were quoted" — the register's one reliable producer
 * (page note §10: three writers exist in the whole repo, and this is the
 * only one that runs today).
 *
 * Currency is fork 2(c) (ADR 0160 §112, README `354-383`, accepted by the
 * founder's blanket "I agree… in the other things"): "the vendor's usual
 * currency where stated, else required." Typing a vendor name that matches
 * an existing provider (the datalist below) reads that provider's own
 * `GET /providers/:id/usual-currency`; a stated one fills the field as a
 * DEFAULT the moment it arrives, never overwriting a value the person has
 * already typed. A vendor with no matching provider, or a provider with no
 * stated currency, falls back to the honest floor this form always had:
 * required, no default, never a guess.
 *
 * The vendor field itself stays free text on purpose (`ManualObservationDto`:
 * "the vendor who quoted a price is frequently one we have no row for yet,
 * and refusing the observation until the vendor is onboarded loses the
 * information entirely") — the datalist is a convenience over that, not a
 * replacement for it.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Panel } from '../../../components/mudavym/Sheet'
import { useAuth } from '../../../contexts/AuthContext'
import { useProviders } from '../../../hooks/queries/useProviderQueries'
import { apiErrorMessage, type ManualObservationInput } from '../../../services/api/vendorIntel'
import { COMMON_CURRENCIES, HAND_SOURCES, MONO, SANS } from './vp-format'
import { useProviderUsualCurrency, useRecordPrice } from './useVendorPricesNextData'

const inputStyle: CSSProperties = {
  width: '100%',
  fontFamily: SANS,
  fontSize: 13,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FFFDF8)',
  color: 'var(--ink-1, #211C16)',
}

const labelStyle: CSSProperties = {
  display: 'block',
  fontFamily: MONO,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-4, #665D50)',
  marginBottom: 4,
}

export function RecordPriceForm({
  open,
  onClose,
  wineId,
  productName,
}: {
  open: boolean
  onClose: () => void
  wineId: string
  productName: string | null
}) {
  const [sourceType, setSourceType] = useState<ManualObservationInput['sourceType']>('quote')
  const [vendorName, setVendorName] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('')
  // True once the PERSON has typed into the currency field — from then on,
  // an arriving usual-currency default must never overwrite it (fork 2c is
  // a default, not a correction).
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [packSize, setPackSize] = useState('1')
  const [unitVolumeMl, setUnitVolumeMl] = useState('750')
  const [note, setNote] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  const { activeRestaurantId } = useAuth()
  const providersQuery = useProviders(activeRestaurantId ?? '')
  const providers = providersQuery.data ?? []
  const matchedProvider = useMemo(() => {
    const typed = vendorName.trim().toLowerCase()
    if (!typed) return null
    return providers.find((p) => p.name.trim().toLowerCase() === typed) ?? null
  }, [providers, vendorName])
  const usualCurrency = useProviderUsualCurrency(matchedProvider?.id ?? null)

  useEffect(() => {
    if (currencyTouched) return
    // Tracks the CURRENT match, not just the first one — switching from a
    // provider with a stated currency to one with none (or to an unmatched
    // name) clears the field rather than leaving the earlier provider's
    // default behind it, orphaned from the vendor that is actually typed.
    setCurrency(usualCurrency.data?.code ?? '')
  }, [usualCurrency.data?.code, currencyTouched])

  const mutation = useRecordPrice({ kind: 'wine', id: wineId })

  const priceNum = Number(price)
  const packNum = Number(packSize)
  const volNum = Number(unitVolumeMl)
  const canSubmit =
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    currency.trim().length > 0 &&
    Number.isFinite(packNum) &&
    packNum > 0 &&
    vendorName.trim().length > 0

  const reset = () => {
    setVendorName('')
    setPrice('')
    setCurrency('')
    setCurrencyTouched(false)
    setPackSize('1')
    setUnitVolumeMl('750')
    setNote('')
    setSourceUrl('')
    mutation.reset()
  }

  return (
    <Panel open={open} onClose={onClose} label="Record a price you were quoted" eyebrow="New sighting" title="Add a price">
      <form
        className="px-4 py-4"
        style={{ display: 'grid', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          if (!canSubmit) return
          mutation.mutate(
            {
              masterWineId: wineId,
              providerId: matchedProvider?.id,
              vendorName: vendorName.trim(),
              price: priceNum,
              currency: currency.trim().toUpperCase(),
              packSize: packNum,
              unitVolumeMl: Number.isFinite(volNum) && volNum > 0 ? volNum : undefined,
              sourceType,
              sourceUrl: sourceUrl.trim() || undefined,
              note: note.trim() || undefined,
            },
            { onSuccess: () => { reset(); onClose() } },
          )
        }}
      >
        <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)', margin: 0 }}>
          {productName ?? 'This bottle'} — every field here becomes a rung on the ladder, with the source you pick.
        </p>

        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend style={{ ...labelStyle, padding: 0 }}>Where this came from</legend>
          <div style={{ display: 'grid', gap: 6 }}>
            {HAND_SOURCES.map((s) => (
              <label
                key={s.value}
                htmlFor={`vp-source-${s.value}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${sourceType === s.value ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                <input
                  id={`vp-source-${s.value}`}
                  type="radio"
                  name="sourceType"
                  value={s.value}
                  checked={sourceType === s.value}
                  onChange={() => setSourceType(s.value)}
                />
                <strong>{s.label}</strong>
                <span style={{ color: 'var(--ink-4, #665D50)' }}> — {s.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label style={labelStyle} htmlFor="vp-vendor-name">Vendor</label>
          <input
            id="vp-vendor-name"
            style={inputStyle}
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="Who quoted it"
            list="vp-vendor-list"
            required
          />
          {/* A convenience over the free-text field above, not a
              replacement for it — picking (or exactly typing) a known
              provider's name is what lets the currency below default from
              that provider's own stated usual currency (fork 2c). */}
          <datalist id="vp-vendor-list">
            {providers.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label style={labelStyle} htmlFor="vp-price">Price</label>
            <input
              id="vp-price"
              style={{ ...inputStyle, fontFamily: MONO }}
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="vp-currency">
              Currency{' '}
              <span style={{ color: 'var(--seal-deep, #14515C)' }}>
                {usualCurrency.data?.code && !currencyTouched
                  ? `— defaulted from ${matchedProvider?.name}’s stated currency`
                  : '— required, no default'}
              </span>
            </label>
            <input
              id="vp-currency"
              style={{ ...inputStyle, fontFamily: MONO, textTransform: 'uppercase' }}
              value={currency}
              onChange={(e) => {
                setCurrencyTouched(true)
                setCurrency(e.target.value.toUpperCase())
              }}
              placeholder="e.g. USD"
              maxLength={3}
              list="vp-currency-list"
              required
            />
            <datalist id="vp-currency-list">
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label style={labelStyle} htmlFor="vp-pack">Pack (bottles)</label>
            <input
              id="vp-pack"
              style={{ ...inputStyle, fontFamily: MONO }}
              type="number"
              min="1"
              value={packSize}
              onChange={(e) => setPackSize(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="vp-vol">Bottle size (ml)</label>
            <input
              id="vp-vol"
              style={{ ...inputStyle, fontFamily: MONO }}
              type="number"
              min="1"
              value={unitVolumeMl}
              onChange={(e) => setUnitVolumeMl(e.target.value)}
            />
          </div>
        </div>

        <div>
          {/* NOT fork 6(a)'s "attach-a-paper step" (ADR 0160 §112; sketch 112
              README:400-401 defines that as an upload plus `document_id` on
              `POST /vendor-intel/observations` — neither exists yet, and this
              field sets no `document_id`). [Corrected 2026-09-19, must-fix
              closure pass, wt-pg-vprices: an earlier version of this comment
              called this field that attach step, which an independent
              verifier's must-fix finding named as wrong.] This is a plain
              optional link to wherever the price came from — useful on its
              own, and the honest "No paper attached" state (the sighting
              sheet) is not a bug for a price that truly has no document
              behind it, only for one that does and was not asked. */}
          <label style={labelStyle} htmlFor="vp-url">Source document, if there is one (a link to the invoice, quote, or listing)</label>
          <input
            id="vp-url"
            style={inputStyle}
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div>
          <label style={labelStyle} htmlFor="vp-note">Note</label>
          <textarea
            id="vp-note"
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {mutation.isError && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1, #211C16)', background: 'var(--paper-1, #F3EFE6)', padding: '8px 10px', borderRadius: 8, margin: 0 }}>
            {apiErrorMessage(mutation.error, 'The price was not recorded.')}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 600,
            padding: '10px 14px',
            borderRadius: 10,
            border: 'none',
            background: canSubmit ? 'var(--seal, #1A5E6B)' : 'var(--paper-2, #EAE4D8)',
            color: canSubmit ? '#fff' : 'var(--ink-4, #665D50)',
            cursor: canSubmit && !mutation.isPending ? 'pointer' : 'default',
          }}
        >
          {mutation.isPending ? 'Recording…' : 'Record this price'}
        </button>
      </form>
    </Panel>
  )
}
