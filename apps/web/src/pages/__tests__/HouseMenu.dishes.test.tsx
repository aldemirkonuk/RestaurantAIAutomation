/**
 * r28 onboarding gap 1 (slice 2) and gap 6 (this page's half): a dish read
 * from the menu was counted, then hidden behind "set aside — not Mudavym's
 * job yet", and a menu of only dishes was headed "Your menu, set by
 * Mudavym." over sections with no drink in them. Each dish is now listed
 * with its figure, and an all-dish proof says what it is.
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ reviewMenuItem: vi.fn(), addMenuItem: vi.fn() }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseMenu, { dishPrice } from '../HouseMenu'
import { FIRST_PROOF_KEY } from '../../lib/firstProof'

const proof = (items: unknown[]) =>
  sessionStorage.setItem(
    FIRST_PROOF_KEY,
    JSON.stringify({ menuId: 'm1', itemsExtracted: items.length, submissionsCreated: 0, items }),
  )
const dish = (id: string, name: string, bottlePrice: number | null, byGlassPrice: number | null = null) => ({
  menuItemId: id,
  name,
  category: 'food',
  matched: false,
  needsReview: false,
  byGlassPrice,
  bottlePrice,
  rawText: `${name} ${bottlePrice ?? ''}`,
})
const wine = {
  menuItemId: 'w',
  name: 'Yakut',
  category: 'red',
  matched: true,
  needsReview: false,
  byGlassPrice: 9,
  bottlePrice: 40,
}
const page = () => render(<MemoryRouter><HouseMenu /></MemoryRouter>)
const dishes = () => screen.getByRole('region', { name: 'Dishes' })

beforeEach(() => sessionStorage.clear())

describe('HouseMenu lists the dishes it read', () => {
  it('lists every dish with its figure, beside the drinks, and says what is done with it', () => {
    proof([wine, dish('k1', 'Adana kebap', 420), dish('k2', 'Mercimek çorbası', 160)])
    page()
    const list = within(dishes())
    expect(list.getByText('Adana kebap')).toBeInTheDocument()
    expect(list.getByText('420')).toBeInTheDocument()
    expect(list.getByText('Mercimek çorbası')).toBeInTheDocument()
    expect(list.getByText('160')).toBeInTheDocument()
    expect(
      list.getByText('2 dishes kept on your menu as read, apart from the drinks. A dish is not carried to stock or prices yet.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/not Mudavym/)).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your menu, set by Mudavym.')
    expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent('3read1in ink0in pencil2dishes')
  })

  it('a dish never says "bottle": one figure, from either price box', () => {
    proof([dish('k1', 'Künefe', null, 180)])
    page()
    expect(within(dishes()).getByText('180')).toBeInTheDocument()
    expect(within(dishes()).queryByText(/bottle|glass/)).toBeNull()
  })

  it('a menu of only dishes says so, and never "set by Mudavym" over empty sections', () => {
    proof([dish('k1', 'Lahmacun', 120)])
    page()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your dishes, read by Mudavym.')
    expect(
      screen.getByText('Every line read is a dish. They are kept on your menu as read. This page sets out drinks, and no drink was read.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 dish kept on your menu as read/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'The reading count' })).toHaveTextContent('1read0in ink0in pencil1dish')
  })

  it('a menu with no dish shows no Dishes section', () => {
    proof([wine])
    page()
    expect(screen.queryByRole('region', { name: 'Dishes' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your menu, set by Mudavym.')
  })
})

describe('dishPrice', () => {
  it('says the one figure a dish has, bottle box first', () => {
    expect(dishPrice({ bottlePrice: 24, byGlassPrice: null })).toBe('24')
    expect(dishPrice({ bottlePrice: null, byGlassPrice: 7.5 })).toBe('7.5')
    expect(dishPrice({ bottlePrice: 24, byGlassPrice: 7 })).toBe('24')
    expect(dishPrice({ bottlePrice: null, byGlassPrice: null })).toBe('')
    expect(dishPrice({ bottlePrice: 0, byGlassPrice: 7 })).toBe('0')
  })
})
