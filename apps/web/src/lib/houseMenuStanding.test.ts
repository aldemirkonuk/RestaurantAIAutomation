/** r28 onboarding gap 14: where a house's menu stands, read from its menu history. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMenuVersions } = vi.hoisted(() => ({ listMenuVersions: vi.fn() }))
vi.mock('../services/api/menus', () => ({ listMenuVersions }))

import { readHouseMenuStanding, standingOf } from './houseMenuStanding'
import type { MenuVersion, MenuVersions } from '../services/api/menus'

const version = (over: Partial<MenuVersion> = {}): MenuVersion => ({
  menuId: 'm1',
  name: null,
  status: 'draft',
  current: false,
  cadence: null,
  menuDate: null,
  menuDatePrecision: null,
  sourceMethod: 'scan',
  source: { kept: true, mime: 'image/jpeg', bytes: 10, failure: null },
  linesExtracted: 12,
  extractedAt: '2026-11-13T10:00:00Z',
  extractedBy: null,
  madeCurrentAt: null,
  madeCurrentBy: null,
  retiredAt: null,
  retiredBy: null,
  createdAt: '2026-11-13T10:00:00Z',
  ...over,
})
const history = (over: Partial<MenuVersions> = {}): MenuVersions => ({
  current: null,
  lastUsed: null,
  versions: [],
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('standingOf', () => {
  it('a house with a current menu is current', () => {
    const current = version({ current: true, status: 'active' })
    expect(standingOf(history({ current, versions: [current] }))).toBe('current')
  })

  it('a read menu with lines, kept as a draft, is a draft', () => {
    expect(standingOf(history({ versions: [version()] }))).toBe('draft')
  })

  it('an empty read is not a draft to choose', () => {
    expect(standingOf(history({ versions: [version({ linesExtracted: 0 })] }))).toBe('none')
    expect(standingOf(history({ versions: [version({ linesExtracted: null })] }))).toBe('none')
  })

  it('a retired or archived menu is not a draft to choose', () => {
    expect(standingOf(history({ versions: [version({ retiredAt: '2026-11-12T00:00:00Z' })] }))).toBe('none')
    expect(standingOf(history({ versions: [version({ status: 'archived' })] }))).toBe('none')
  })

  it('no menus at all is none', () => {
    expect(standingOf(history())).toBe('none')
  })

  it('a reply with no history is unread, never none', () => {
    expect(standingOf(null)).toBe('unread')
    expect(standingOf({ current: null } as unknown as MenuVersions)).toBe('unread')
  })
})

describe('readHouseMenuStanding', () => {
  it('reads the house menus once', async () => {
    listMenuVersions.mockResolvedValue(history({ versions: [version()] }))
    await expect(readHouseMenuStanding()).resolves.toBe('draft')
    expect(listMenuVersions).toHaveBeenCalledTimes(1)
  })

  it('a failed read is unread and never throws', async () => {
    listMenuVersions.mockRejectedValue(new Error('500'))
    await expect(readHouseMenuStanding()).resolves.toBe('unread')
  })
})
