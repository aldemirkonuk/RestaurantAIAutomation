import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DraftKeptNote } from './DraftKeptNote'

describe('DraftKeptNote', () => {
  it('says the sentence, offers a 44 px Start over, and calls it on a press', () => {
    const onStartOver = vi.fn()
    render(<DraftKeptNote onStartOver={onStartOver} />)
    expect(screen.getByText('We kept what you typed.')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Start over' })
    expect(button.className).toContain('min-h-11')
    fireEvent.click(button)
    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  it('has no motion classes in either mode', () => {
    const { container } = render(<DraftKeptNote onStartOver={() => {}} />)
    expect(container.innerHTML).not.toMatch(/animate|transition|motion-/)
  })
})
