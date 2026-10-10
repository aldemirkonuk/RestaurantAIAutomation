/**
 * The new owner's first fields, on /register and /get-started: each says what
 * goes in it and takes only what the owner meant.
 *
 * F-002: both password boxes on /register showed "••••••••" before anything
 * was typed, which reads as a password already filled in, and nothing let the
 * owner see what they typed. The boxes now say what goes in them, and one
 * control shows or hides both.
 *
 * F-243: /register's name box took any length, while /get-started (PATCH
 * /auth/me) keeps 100 characters; a longer name was accepted on one and
 * refused on the other. The box now holds the same 100 the account keeps.
 *
 * F-004: picking a street address on /get-started wrote the street ("843
 * Valencia Street") into the restaurant's name. Only a business has a name;
 * an address pick leaves the name as the owner typed it.
 *
 * F-009: a country (and a place) was chosen on mouse-down, which closed the
 * list before the button came up, so the release landed on whatever sat under
 * the list — on /get-started, "This is us". A choice is now made on click.
 */
import { createElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CountryCombobox } from '../../components/ui/CountryCombobox'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  return {
    auth: {
      login: vi.fn(),
      clearError: vi.fn(),
      resolveSignInMethods: vi.fn(),
      registerAccount: vi.fn(),
      registerAccountWithGoogle: vi.fn(),
      registerRestaurant: vi.fn(),
      joinViaInvite: vi.fn(),
      error: null as string | null,
    },
    get: vi.fn(async () => ({ data: { available: true, email: 'x' } })),
  }
})

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => h.auth,
  LoginError: class LoginError extends Error {},
}))
vi.mock('../../services/api/client', () => ({ apiClient: { get: h.get } }))

const { fetchAutocompleteSuggestions } = vi.hoisted(() => ({
  fetchAutocompleteSuggestions: vi.fn(),
}))

vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: vi.fn(),
  importLibrary: async () => ({ AutocompleteSuggestion: { fetchAutocompleteSuggestions } }),
}))

import { Register } from '../Register'

function prediction(main: string, types: string[]) {
  return {
    placePrediction: {
      placeId: `id-${main}`,
      mainText: { text: main },
      secondaryText: { text: 'San Francisco, CA, USA' },
      types,
      toPlace: () => ({
        fetchFields: async () => undefined,
        addressComponents: [
          { types: ['street_number'], longText: '843' },
          { types: ['route'], longText: 'Valencia Street' },
          { types: ['locality'], longText: 'San Francisco' },
          { types: ['country'], longText: 'United States' },
        ],
        formattedAddress: '843 Valencia Street, San Francisco, CA, USA',
        location: { lat: () => 37.7594, lng: () => -122.4211 },
      }),
    },
  }
}

async function pick(main: string, types: string[]) {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  vi.resetModules()
  const { PlacesAutocomplete } = await import('../../components/ui/PlacesAutocomplete')
  fetchAutocompleteSuggestions.mockResolvedValue({ suggestions: [prediction(main, types)] })
  const onPlaceSelect = vi.fn()
  render(<PlacesAutocomplete value="" onChange={() => {}} onPlaceSelect={onPlaceSelect} />)
  const input = screen.getByRole('textbox')
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value: main } })
  const option = await screen.findByRole('option')
  // A press alone chooses nothing; the click on the option does.
  fireEvent.mouseDown(option)
  expect(onPlaceSelect).not.toHaveBeenCalled()
  fireEvent.click(option)
  await waitFor(() => expect(onPlaceSelect).toHaveBeenCalledTimes(1))
  return onPlaceSelect.mock.calls[0][0]
}

describe('PlacesAutocomplete names only a business (F-004)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('gives no name for a street address', async () => {
    const place = await pick('843 Valencia Street', ['street_address', 'geocode'])
    expect(place.placeName).toBe('')
    expect(place.streetAddress).toBe('843 Valencia Street')
    expect(place.latitude).toBe(37.7594)
  })

  it('gives the business its name', async () => {
    const place = await pick('Foreign Cinema', ['restaurant', 'establishment'])
    expect(place.placeName).toBe('Foreign Cinema')
  })
})

describe('CountryCombobox chooses on click, never on a press (F-009)', () => {
  let onChange: ReturnType<typeof vi.fn>
  beforeEach(() => {
    onChange = vi.fn()
    render(<CountryCombobox value="" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
  })

  it('keeps the list open through the press, so the release lands on the option', () => {
    const option = screen.getByRole('button', { name: 'United States' })
    fireEvent.mouseDown(option)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'United States' })).toBe(option)
  })

  it('chooses the country on click and closes the list', () => {
    fireEvent.click(screen.getByRole('button', { name: 'United States' }))
    expect(onChange).toHaveBeenCalledWith('United States')
    expect(screen.queryByRole('button', { name: 'United States' })).not.toBeInTheDocument()
  })
})


async function createAccountForm() {
  render(createElement(MemoryRouter, { initialEntries: ['/register?type=new'] }, createElement(Register)))
  await screen.findByLabelText('Full Name *', undefined, { timeout: 3000 })
}

describe('the new owner\'s account fields', () => {
  it('say what goes in the password boxes instead of showing dots (F-002)', async () => {
    await createAccountForm()
    expect(screen.getByLabelText('Password *')).toHaveAttribute('placeholder', 'At least 8 characters')
    expect(screen.getByLabelText('Confirm Password *')).toHaveAttribute(
      'placeholder',
      'The same password again',
    )
    expect(document.body.innerHTML).not.toContain('••••')
  })

  it('show and hide both passwords from one control (F-002)', async () => {
    await createAccountForm()
    const password = screen.getByLabelText('Password *')
    const confirm = screen.getByLabelText('Confirm Password *')
    expect(password).toHaveAttribute('type', 'password')
    expect(confirm).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    expect(confirm).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
    expect(confirm).toHaveAttribute('type', 'password')
  })

  it('holds a name to the 100 characters the account keeps (F-243)', async () => {
    await createAccountForm()
    expect(screen.getByLabelText('Full Name *')).toHaveAttribute('maxLength', '100')
  })
})
