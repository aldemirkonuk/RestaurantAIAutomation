/**
 * r29 walk, finding 1 (2026-11-13): about ten callers toast through
 * `useNotificationStore()` (vendors create/update/offline, the calendar
 * hooks, the reminder scheduler, three /inventory screens), and the store's
 * `toasts` list is drawn by no component. These mount the REAL toaster the
 * app mounts (`AppToaster`, sonner, not mocked) and call the store the way
 * those callers do, so a toast that is only appended to the list fails here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { AppToaster } from '../components/mudavym/AppToaster'
import { clearMudavymDesignCache } from '../lib/mudavym/useMudavymDesign'
import { useNotificationStore } from './notificationStore'

beforeEach(() => {
  clearMudavymDesignCache()
  window.localStorage.clear()
  useNotificationStore.setState({ toasts: [] })
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('a store toast is drawn on the mounted toaster', () => {
  it('success: its title and its sentence are on the page', async () => {
    render(<AppToaster />)
    act(() => {
      // The shape every hook caller uses: `const toast = useNotificationStore()`.
      useNotificationStore.getState().success('Entry saved', 'Monday, 16 November.')
    })
    expect(await screen.findByText('Entry saved')).toBeTruthy()
    expect(screen.getByText('Monday, 16 November.')).toBeTruthy()
  })

  it('error is drawn too (a refusal must not be silent)', async () => {
    render(<AppToaster />)
    act(() => {
      useNotificationStore.getState().error('Could not save the entry', 'The server did not answer.')
    })
    expect(await screen.findByText('Could not save the entry')).toBeTruthy()
  })

  it('legacy shell (override 0) draws it as well', async () => {
    window.localStorage.setItem('mudavym.design.shell', '0')
    render(<AppToaster />)
    act(() => {
      useNotificationStore.getState().info('Reminder: Wine tasting', 'Wine tasting starts at 18:00')
    })
    expect(await screen.findByText('Reminder: Wine tasting')).toBeTruthy()
  })
})
