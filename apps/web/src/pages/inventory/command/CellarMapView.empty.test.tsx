/** A house with no storage zones gets the house's empty state and its one action. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CellarMapView } from './CellarMapView'

describe('cellar map with no zones', () => {
  it('says so once, draws the cellar plan and offers Manage locations', () => {
    const onManage = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <CellarMapView items={[]} locations={[]} onOpenInTable={() => {}} onManageLocations={onManage} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/No storage locations yet/)).toBeTruthy()
    expect(container.querySelector('svg[data-art="cellar"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage locations' }))
    expect(onManage).toHaveBeenCalledTimes(1)
  })
})
