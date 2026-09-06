/**
 * The delivery-days race: a Save that lands before `GET /vendor-terms` does.
 *
 * `Providers.tsx` tells `null` (unread) from `{}` (read, empty) only on the
 * ERROR path. While the read is in flight there is no error, so the dialog was
 * handed `deliveryWeekdays === undefined` with `deliveryWeekdaysError === null`,
 * seeded `deliveryDays: []`, rendered the picker as live, and Save wrote `[]` —
 * "no fixed days" — over whatever the register actually held.
 *
 * Every test here is written against the DIALOG because that is where the
 * refusal lives. Run against `git show HEAD:` copy of the component, all four
 * tests in the pending block fail (measured 4 failed / 3 passed against the
 * `git show 3b4cf88c^:` copy): Save fires and `onSave` is called with an empty
 * selection.
 */
import { render, screen, cleanup } from '@testing-library/react'
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

const provider = {
  id: 'prov-1',
  name: 'Kavaklıdere',
  email: 'sales@kavaklidere.example',
  phone: '+15551234567',
  rating: 4,
} as unknown as Provider

function open(props: Partial<React.ComponentProps<typeof EditProviderModal>> = {}) {
  const onSave = vi.fn()
  render(
    <EditProviderModal
      isOpen
      onClose={vi.fn()}
      onSave={onSave}
      provider={provider}
      {...props}
    />,
  )
  return { onSave }
}

const saveButton = () => screen.getByRole('button', { name: /save changes/i })
const weekdayButton = (label: string) => screen.getByRole('button', { name: label })

afterEach(cleanup)

describe('EditProviderModal — delivery days, while the register is being read', () => {
  it('a Save during the pending state writes nothing', async () => {
    const user = userEvent.setup()
    // Exactly the props Providers.tsx passes in flight: no days, no error.
    const { onSave } = open({
      deliveryWeekdays: undefined,
      deliveryWeekdaysError: null,
      deliveryWeekdaysPending: true,
    })

    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('says why, in words, rather than showing an empty picker as a choice', () => {
    open({ deliveryWeekdaysPending: true })

    const said = screen
      .getAllByRole('status')
      .map(n => n.textContent ?? '')
      .join(' ')
    expect(said).toMatch(/delivery days have not been read yet/i)
    // Not a zero and not an empty list: the word "no fixed days" must not be
    // the thing the dialog is claiming while it does not know.
    expect(said).not.toMatch(/no fixed days/i)
  })

  it('holds the weekday picker too, so nothing can be ticked into the gap', () => {
    open({ deliveryWeekdaysPending: true })
    expect(weekdayButton('Mon')).toBeDisabled()
    expect(weekdayButton('Sat')).toBeDisabled()
  })

  it('the pending line names the hold on Save as well as on the picker', () => {
    open({ deliveryWeekdaysPending: true })
    expect(saveButton()).toHaveAttribute('title', 'Delivery days have not been read yet')
  })
})

describe('EditProviderModal — delivery days, once the register has answered', () => {
  it('a read that came back empty is a statement, and Save is live', async () => {
    const user = userEvent.setup()
    const { onSave } = open({
      deliveryWeekdays: [],
      deliveryWeekdaysError: null,
      deliveryWeekdaysPending: false,
    })

    expect(saveButton()).toBeEnabled()
    expect(weekdayButton('Mon')).toBeEnabled()
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'prov-1', deliveryDays: [] })
  })

  it('the days the register holds are the days the picker shows, and Save carries them', async () => {
    const user = userEvent.setup()
    const { onSave } = open({
      deliveryWeekdays: ['Tuesday', 'Friday'],
      deliveryWeekdaysPending: false,
    })

    await user.click(saveButton())
    expect(onSave.mock.calls[0][0].deliveryDays).toEqual(['Tuesday', 'Friday'])
  })

  it('a FAILED read still disables the picker and still names the register', () => {
    open({ deliveryWeekdaysError: 'Network Error', deliveryWeekdaysPending: false })

    expect(weekdayButton('Mon')).toBeDisabled()
    const said = screen.getAllByRole('status').map(n => n.textContent ?? '').join(' ')
    expect(said).toMatch(/vendor-terms register could not be read \(Network Error\)/i)
    // A failed read does not hold Save: the rest of the form is still savable,
    // and Providers.tsx refuses the terms write on its own side.
    expect(saveButton()).toBeEnabled()
  })
})
