/**
 * QuickGmailModal no longer sends (PR #410 closed POST
 * /notifications/send-email). Its send button hands the writer to the
 * house's composer at /communications, and no request leaves the modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import axios from 'axios'
import { QuickGmailModal } from './QuickGmailModal'
import { defaultTemplates } from '../../data/emailTemplateCategories'

const original = window.location
let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, assign },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: original })
  vi.restoreAllMocks()
})

describe('QuickGmailModal', () => {
  it('hands the writer to the composer and sends nothing', () => {
    const post = vi.spyOn(axios, 'post')
    render(
      <QuickGmailModal onClose={() => {}} prefilledRecipient="orders@vendor.example" />,
    )
    fireEvent.click(screen.getByText(defaultTemplates[0].name))

    expect(screen.getByTestId('quick-gmail-moved')).toHaveTextContent(
      /written in Communications now/,
    )
    expect(screen.queryByText('Send Email')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /write it in communications/i }))

    expect(assign).toHaveBeenCalledWith('/communications')
    expect(post).not.toHaveBeenCalled()
  })
})
