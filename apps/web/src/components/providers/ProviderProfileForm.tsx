import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '../../services/api/client'
import { queryKeys } from '../../lib/query-keys'

interface ProviderProfileFormProps {
  providerId: string
  initialValues?: Record<string, unknown>
  onSaved?: () => void
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'

const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

export function ProviderProfileForm({
  providerId,
  initialValues = {},
  onSaved,
}: ProviderProfileFormProps) {
  const queryClient = useQueryClient()
  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues)
  const [isSaving, setIsSaving] = useState(false)

  const set = (key: string, value: unknown) =>
    setFormValues((prev) => ({ ...prev, [key]: value }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await apiClient.patch(`/providers/${providerId}/intelligence`, {
        profile_foundational: formValues,
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.all })
      toast.success('Intelligence profile saved')
      onSaved?.()
    } catch {
      toast.error('Failed to save profile')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Intelligence Profile
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* specialty_categories — full width */}
        <div className="col-span-2">
          <label htmlFor="specialty_categories" className={labelClass}>
            Specialty Categories
          </label>
          <input
            id="specialty_categories"
            type="text"
            placeholder="e.g. Burgundy, Champagne"
            value={(formValues.specialty_categories as string) ?? ''}
            onChange={(e) => set('specialty_categories', e.target.value)}
            className={inputClass}
          />
        </div>

        {/* primary_region */}
        <div>
          <label htmlFor="primary_region" className={labelClass}>
            Primary Region
          </label>
          <input
            id="primary_region"
            type="text"
            value={(formValues.primary_region as string) ?? ''}
            onChange={(e) => set('primary_region', e.target.value)}
            className={inputClass}
          />
        </div>

        {/* distribution_channel */}
        <div>
          <label htmlFor="distribution_channel" className={labelClass}>
            Distribution Channel
          </label>
          <select
            id="distribution_channel"
            value={(formValues.distribution_channel as string) ?? ''}
            onChange={(e) => set('distribution_channel', e.target.value)}
            className={inputClass}
          >
            <option value="">— Select —</option>
            <option value="Distributor">Distributor</option>
            <option value="Direct Importer">Direct Importer</option>
            <option value="Broker">Broker</option>
            <option value="Producer">Producer</option>
          </select>
        </div>

        {/* business_type */}
        <div>
          <label htmlFor="business_type" className={labelClass}>
            Business Type
          </label>
          <select
            id="business_type"
            value={(formValues.business_type as string) ?? ''}
            onChange={(e) => set('business_type', e.target.value)}
            className={inputClass}
          >
            <option value="">— Select —</option>
            <option value="Large Distributor">Large Distributor</option>
            <option value="Small Portfolio">Small Portfolio</option>
            <option value="Boutique Importer">Boutique Importer</option>
            <option value="Winery Direct">Winery Direct</option>
          </select>
        </div>

        {/* decision_maker_name */}
        <div>
          <label htmlFor="decision_maker_name" className={labelClass}>
            Key Decision Maker
          </label>
          <input
            id="decision_maker_name"
            type="text"
            value={(formValues.decision_maker_name as string) ?? ''}
            onChange={(e) => set('decision_maker_name', e.target.value)}
            className={inputClass}
          />
        </div>

        {/* preferred_communication_style */}
        <div>
          <label htmlFor="preferred_communication_style" className={labelClass}>
            Communication Style
          </label>
          <select
            id="preferred_communication_style"
            value={(formValues.preferred_communication_style as string) ?? ''}
            onChange={(e) => set('preferred_communication_style', e.target.value)}
            className={inputClass}
          >
            <option value="">— Select —</option>
            <option value="Formal">Formal</option>
            <option value="Casual">Casual</option>
            <option value="Terse">Terse</option>
            <option value="Detailed">Detailed</option>
          </select>
        </div>

        {/* typical_response_days */}
        <div>
          <label htmlFor="typical_response_days" className={labelClass}>
            Typical Response (days)
          </label>
          <input
            id="typical_response_days"
            type="number"
            min={1}
            max={14}
            value={(formValues.typical_response_days as number) ?? ''}
            onChange={(e) =>
              set(
                'typical_response_days',
                e.target.value ? parseInt(e.target.value, 10) : undefined,
              )
            }
            className={inputClass}
          />
        </div>

        {/* net_payment_terms */}
        <div>
          <label htmlFor="net_payment_terms" className={labelClass}>
            Net Payment Terms
          </label>
          <select
            id="net_payment_terms"
            value={(formValues.net_payment_terms as string) ?? ''}
            onChange={(e) => set('net_payment_terms', e.target.value)}
            className={inputClass}
          >
            <option value="">— Select —</option>
            <option value="Net-7">Net-7</option>
            <option value="Net-14">Net-14</option>
            <option value="Net-30">Net-30</option>
            <option value="Net-45">Net-45</option>
            <option value="COD">COD</option>
          </select>
        </div>

        {/* ships_on_days — full width multi-checkbox */}
        <div className="col-span-2">
          <label className={labelClass}>Ships On</label>
          <div className="flex gap-3 flex-wrap">
            {DAYS.map((day) => (
              <label
                key={day}
                htmlFor={`ships_on_days_${day}`}
                className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer"
              >
                <input
                  id={`ships_on_days_${day}`}
                  type="checkbox"
                  checked={((formValues.ships_on_days as string[]) ?? []).includes(day)}
                  onChange={(e) => {
                    const current: string[] = (formValues.ships_on_days as string[]) ?? []
                    const updated = e.target.checked
                      ? [...current, day]
                      : current.filter((d) => d !== day)
                    set('ships_on_days', updated)
                  }}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                {day}
              </label>
            ))}
          </div>
        </div>

        {/* notes — full width textarea */}
        <div className="col-span-2">
          <label htmlFor="notes" className={labelClass}>
            Additional Notes
          </label>
          <textarea
            id="notes"
            maxLength={500}
            rows={3}
            value={(formValues.notes as string) ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Action row */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={() => onSaved?.()}
          className="text-gray-600 hover:text-gray-800 font-medium px-4 py-2 rounded-lg border border-gray-300"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg"
        >
          {isSaving ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </div>
  )
}
