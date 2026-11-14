/**
 * StockReturnNotice (r30, the web half of r28 invoices G2). All data SYNTHETIC.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const postMock = vi.fn()
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: (...a: unknown[]) => postMock(...a) },
}))

import { StockReturnNotice } from '../StockReturnNotice'
import { deliveriesApi } from '../../../services/api/deliveries'

describe('StockReturnNotice', () => {
  it('a failed return shows the gateway sentence as an alert and, for a holder, the retry', () => {
    const onReturn = vi.fn(async () => {})
    render(
      <StockReturnNotice
        state="REJECTED"
        stockReturn={{ returned: false, error: 'SYNTHETIC: stock would go negative.' }}
        settlesMoney
        onReturn={onReturn}
      />,
    )
    const alert = screen.getByTestId('stock-return-failed')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toBe('SYNTHETIC: stock would go negative.')
    fireEvent.click(screen.getByTestId('stock-return-retry'))
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('a failed return for staff names who can give it back, with no button', () => {
    render(
      <StockReturnNotice
        state="REJECTED"
        stockReturn={{ returned: false, error: 'SYNTHETIC failure.' }}
        settlesMoney={false}
        onReturn={async () => {}}
      />,
    )
    expect(screen.queryByTestId('stock-return-retry')).toBeNull()
    expect(screen.getByText(/An owner or a manager can give it back/)).toBeTruthy()
  })

  it('the retry waits while a write is running', () => {
    render(
      <StockReturnNotice
        state="REJECTED"
        stockReturn={{ returned: false, error: 'x' }}
        settlesMoney
        busy
        onReturn={async () => {}}
      />,
    )
    const b = screen.getByTestId('stock-return-retry') as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.textContent).toBe('Giving it back…')
  })

  it('a return that went prints no count, because the sum mixes units', () => {
    render(
      <StockReturnNotice
        state="REJECTED"
        stockReturn={{ returned: true, bottlesReturned: 1500 }}
        settlesMoney
      />,
    )
    const done = screen.getByTestId('stock-return-done')
    expect(done.textContent).toMatch(/went back off it/)
    expect(done.textContent).not.toMatch(/1500|1,500/)
  })

  it('a return of nothing says nothing moved', () => {
    render(
      <StockReturnNotice state="CANCELLED" stockReturn={{ returned: true, bottlesReturned: 0 }} settlesMoney />,
    )
    expect(screen.getByTestId('stock-return-done').textContent).toMatch(/nothing moved/)
  })

  it('an open delivery with no answer renders nothing', () => {
    const { container } = render(
      <StockReturnNotice state="RECONCILING" stockReturn={null} settlesMoney onReturn={async () => {}} />,
    )
    expect(container.textContent).toBe('')
  })

  it('a rejected delivery with no answer offers to make sure', () => {
    render(<StockReturnNotice state="REJECTED" stockReturn={null} settlesMoney onReturn={async () => {}} />)
    expect(screen.getByTestId('stock-return-unknown').textContent).toMatch(/rejected/)
    expect(screen.getByTestId('stock-return-retry').textContent).toBe('Make sure its stock went back')
    expect(screen.queryByTestId('stock-return-who')).toBeNull()
  })

  it('staff on a rejected delivery with no answer are told who can give it back, with no button', () => {
    render(<StockReturnNotice state="REJECTED" stockReturn={null} settlesMoney={false} onReturn={async () => {}} />)
    expect(screen.getByTestId('stock-return-unknown')).toBeTruthy()
    expect(screen.getByTestId('stock-return-who').textContent).toBe('An owner or a manager can give it back from this page.')
    expect(screen.queryByTestId('stock-return-retry')).toBeNull()
  })

  it('staff on a cancelled delivery read the same', () => {
    render(<StockReturnNotice state="CANCELLED" stockReturn={null} settlesMoney={false} />)
    expect(screen.getByTestId('stock-return-unknown').textContent).toMatch(/cancelled/)
    expect(screen.getByTestId('stock-return-who')).toBeTruthy()
  })
})

describe('deliveriesApi.returnStock', () => {
  it('posts to the delivery\'s return-stock route', async () => {
    postMock.mockResolvedValueOnce({
      data: { deliveryId: 'del-syn', stockReturn: { returned: true, bottlesReturned: 2 } },
    })
    const out = await deliveriesApi.returnStock('del-syn')
    expect(postMock).toHaveBeenCalledWith('/procurement/deliveries/del-syn/return-stock', {})
    expect(out.stockReturn).toEqual({ returned: true, bottlesReturned: 2 })
  })
})
