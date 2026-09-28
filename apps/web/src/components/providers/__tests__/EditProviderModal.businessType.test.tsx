/**
 * A vendor's business type on the EDIT dialog — founder, 2026-09-21: "a vendor
 * added without a business type gets a new 'Not stated' choice instead of
 * silently becoming 'Distributor' - nothing assumed, settable later".
 *
 * "Settable later" is this dialog. Two faults it had once the create sheets
 * stopped defaulting to 'Distributor':
 *  - the inline Type select offered only the three types, so a vendor nobody
 *    typed opened it showing 'Distributor' (React selects the first option
 *    when the value matches none) and picking Distributor fired no change;
 *  - there was no way to go back to "Not stated" once a type was set.
 */
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditProviderModal } from '../EditProviderModal'
import type { Provider } from '../../../services/api/providers'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Ada', email: 'ada@example.com' } }),
}))
vi.mock('../../../hooks/queries/useOrderQueries', () => ({
  useOrderHistory: () => ({ data: [], isLoading: false }),
}))
vi.mock('../../../hooks/useDuplicateVendorCheck', () => ({
  // The real hook's four-key contract (useDuplicateVendorCheck.ts:148); a
  // partial mock here throws inside handleClose and turns a real assertion
  // into an unhandled rejection.
  useDuplicateVendorCheck: () => ({
    match: null,
    pendingMatch: null,
    acknowledge: vi.fn(),
    reset: vi.fn(),
  }),
}))
vi.mock('../../../services/api/providers', () => ({
  fetchProviderContacts: vi.fn().mockResolvedValue([]),
  getProviderLocations: vi.fn().mockResolvedValue([]),
}))
vi.mock('../SendMessageSlideOver', () => ({ SendMessageSlideOver: () => null }))
vi.mock('../VendorMatchModal', () => ({ VendorMatchModal: () => null }))
vi.mock('../../ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: (p: { value?: string }) => <input readOnly value={p.value ?? ''} />,
}))
vi.mock('../../ui/PhoneNumberInput', () => ({
  PhoneNumberInput: (p: { value?: string }) => <input readOnly value={p.value ?? ''} />,
}))
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as never}</div> }),
  AnimatePresence: ({ children }: { children?: unknown }) => <>{children as never}</>,
}))


const base = {
  id: 'prov-1',
  name: 'Kavaklıdere',
  email: 'sales@kavaklidere.example',
  phone: '+15551234567',
  rating: 4,
}

function open(type: string | undefined) {
  const onSave = vi.fn()
  render(
    <EditProviderModal
      isOpen
      onClose={vi.fn()}
      onSave={onSave}
      provider={{ ...base, primaryBusinessType: type } as unknown as Provider}
      deliveryWeekdays={[]}
      deliveryWeekdaysError={null}
      deliveryWeekdaysPending={false}
    />,
  )
  return { onSave }
}

const saveButton = () => screen.getByRole('button', { name: /save changes/i })

async function openTypeSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('edit-provider-type'))
  // The inline row swaps its label for a <select> while it is being edited.
  return screen
    .getAllByRole('combobox')
    .find(el => Array.from((el as HTMLSelectElement).options).some(o => o.value === 'Importer')) as HTMLSelectElement
}

afterEach(cleanup)

describe('EditProviderModal — business type', () => {
  it('a vendor nobody typed reads "Not stated", and its select says so too — never Distributor', async () => {
    const user = userEvent.setup()
    open(undefined)
    expect(screen.getByTestId('edit-provider-type')).toHaveTextContent('Not stated')
    const select = await openTypeSelect(user)
    expect(select.value).toBe('')
    expect(select.selectedOptions[0].textContent).toBe('Not stated')
  })

  it('a type chosen for a vendor nobody typed is what Save carries', async () => {
    const user = userEvent.setup()
    const { onSave } = open(undefined)
    const select = await openTypeSelect(user)
    // A change event on the select itself: a pointer click would bubble to
    // the row, whose own click toggles the editor shut.
    fireEvent.change(select, { target: { value: 'Distributor' } })
    await user.click(saveButton())
    expect(onSave.mock.calls[0][0].primaryBusinessType).toBe('Distributor')
  })

  it('"Not stated" can be chosen again after a type was set — Save carries the empty answer', async () => {
    const user = userEvent.setup()
    const { onSave } = open('Importer')
    await user.click(screen.getByRole('button', { name: 'Not stated' }))
    await user.click(saveButton())
    expect(onSave.mock.calls[0][0].primaryBusinessType).toBe('')
  })

  it('a type outside the three (a catalogue one) is shown as itself, not as the first option', async () => {
    const user = userEvent.setup()
    open('winery_direct')
    const select = await openTypeSelect(user)
    expect(select.value).toBe('winery_direct')
    expect(select.selectedOptions[0].textContent).toBe('winery_direct')
  })
})
