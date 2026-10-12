/**
 * ADR 0340 lane 6: the web's calls for one live menu per kind. The one-menu
 * make-current body must stay exactly what it was (the gateway takes its
 * batch path on any batch field), a batch sends only the fields it holds,
 * and a batch plan names its other menus in `?menuIds=`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getMenuPlan,
  isMenuKind,
  keepGoneLine,
  kindName,
  listMenuSections,
  makeCurrentBody,
  makeMenuCurrent,
  moveMenuSection,
} from './menus'
import { apiClient } from './client'

vi.mock('../../hooks/useHouseGroupMark', () => ({ houseGroupMark: vi.fn() }))
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return { ...actual, apiClient: { post: vi.fn(), get: vi.fn(), patch: vi.fn() } }
})

const post = vi.mocked(apiClient.post)
const get = vi.mocked(apiClient.get)

beforeEach(() => {
  vi.clearAllMocks()
  post.mockResolvedValue({ data: {} } as never)
  get.mockResolvedValue({ data: {} } as never)
})

describe('the make-current body', () => {
  it('one menu sends what it always sent', () => {
    expect(makeCurrentBody('fp', false)).toEqual({ fingerprint: 'fp' })
    expect(makeCurrentBody('fp', true)).toEqual({ fingerprint: 'fp', partReadAccepted: true })
    // Empty batch fields are not sent: any of them takes the batch path.
    expect(makeCurrentBody('fp', false, { menuIds: [], picks: [], partReadAcceptedKinds: [] })).toEqual({
      fingerprint: 'fp',
    })
  })

  it('a batch sends its other menus, its picks and the kinds whose part-read was accepted', () => {
    expect(
      makeCurrentBody('fp', false, {
        menuIds: ['m-food'],
        picks: [{ wineLibraryId: 'w1', kind: 'bottle', price: 950 }],
        partReadAcceptedKinds: ['food'],
      }),
    ).toEqual({
      fingerprint: 'fp',
      menuIds: ['m-food'],
      picks: [{ wineLibraryId: 'w1', kind: 'bottle', price: 950 }],
      partReadAcceptedKinds: ['food'],
    })
  })

  it('makeMenuCurrent posts that body to the URL menu', async () => {
    await makeMenuCurrent('m-drinks', 'fp', false, { menuIds: ['m-desserts'] })
    expect(post).toHaveBeenCalledWith('/menu-versions/m-drinks/make-current', {
      fingerprint: 'fp',
      menuIds: ['m-desserts'],
    })
    await makeMenuCurrent('m-drinks', 'fp')
    expect(post).toHaveBeenLastCalledWith('/menu-versions/m-drinks/make-current', { fingerprint: 'fp' })
  })
})

describe('the plan of a batch', () => {
  it('names the other menus in menuIds, and none for one menu', async () => {
    await getMenuPlan('m-drinks', ['m-food', 'm-desserts'])
    expect(get).toHaveBeenCalledWith('/menu-versions/m-drinks/plan', { params: { menuIds: 'm-food,m-desserts' } })
    await getMenuPlan('m-drinks')
    expect(get).toHaveBeenLastCalledWith('/menu-versions/m-drinks/plan', undefined)
  })
})

describe('sections', () => {
  it('reads a draft\'s sections, and a gateway reply with none is an empty list', async () => {
    get.mockResolvedValueOnce({ data: { menuId: 'm1', sections: [{ id: 's1' }] } } as never)
    expect(await listMenuSections('m1')).toEqual([{ id: 's1' }])
    get.mockResolvedValueOnce({ data: {} } as never)
    expect(await listMenuSections('m1')).toEqual([])
  })

  it('moves a section by kind, and keeps a gone line onto the draft', async () => {
    await moveMenuSection('m1', 's1', 'food')
    expect(post).toHaveBeenCalledWith('/menu-versions/m1/sections/s1/move', { kind: 'food' })
    await keepGoneLine('draft-1', 'live-line-1')
    expect(post).toHaveBeenLastCalledWith('/menu-versions/draft-1/lines/live-line-1/keep', {})
  })
})

describe('kinds in the house\'s words', () => {
  it('names the three kinds and no legacy type', () => {
    expect(['beverage', 'food', 'desserts'].map(kindName)).toEqual(['Drinks', 'Food', 'Desserts'])
    expect(kindName('full')).toBeNull()
    expect(kindName(null)).toBeNull()
    expect(isMenuKind('bar')).toBe(false)
    expect(isMenuKind('desserts')).toBe(true)
  })
})
