/**
 * The consent screen offers what the SERVER offers.
 *
 * WHY THIS FILE EXISTS — a defect measured on this branch, 2026-09-04
 * ------------------------------------------------------------------
 * `gmail_send` was declared on the gateway earlier the same day and appeared as
 * a Connect row on `/connections` and `/profile` for free, because those
 * registers map `GET /integrations/oauth/catalog` rather than a hand-written
 * list. Every one of those rows links to `/authorize/:id`, and this page held
 * `const VALID_IDS = ['google_drive', 'excel']` and checked the route parameter
 * against it BEFORE looking at the catalogue. So the only route to consenting
 * to a sending grant ended at "Unknown integration. That integration doesn't
 * exist." The grant was unreachable, and nothing anywhere failed.
 *
 * That is the same fault as a hard-coded scope list, one layer out: a copy of a
 * server's answer, correct on the day it was typed. The fix is to have no copy,
 * and these tests are what stops one growing back — the second one fails if any
 * future id is validated against a literal instead of the catalogue.
 *
 * The privacy block is asserted here too, because the founder's rule for the
 * reading grant is that no person's privacy is touched by surprise, and a
 * disclosure the page does not render is not a disclosure.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AuthorizeIntegration from './AuthorizeIntegration'
import { integrationsApi } from '../services/api/integrations'

vi.mock('../services/api/integrations', () => ({
  integrationsApi: {
    getCatalog: vi.fn(),
    authorize: vi.fn(),
    // ADR 0118 (retention) — the page now also asks the gateway how long this
    // house keeps mirrored mail. Mocked here so these tests keep testing the
    // catalogue; the retention rendering has its own file.
    getRetentionDisclosure: vi.fn(),
  },
}))

const READ_ENTRY = {
  id: 'gmail_read',
  provider: 'google',
  label: 'Gmail — reading vendor replies only',
  providerLabel: 'Google',
  description:
    "Lets a vendor's reply to this house land in the house's own conversation book.",
  scopes: [
    {
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      label: 'Read mail in your mailbox — used only for the vendors in this house’s book',
      reason: 'Every request carries a from: filter built from the vendor book.',
    },
  ],
  notRequested: ["Mail from anyone who is not a vendor in this house's book"],
  dataHandling: {
    reads: 'Mail from the vendor addresses in this restaurant’s book, and nothing else.',
    doesNotRead: 'Every other message in your mailbox; it is discarded on arrival.',
    landsIn: "This restaurant's conversation book — procurement_conversations.",
    visibleTo: 'Everyone who works in this restaurant. Nobody outside it.',
  },
  available: true,
  unavailableReason: null,
}

const SEND_ENTRY = {
  ...READ_ENTRY,
  id: 'gmail_send',
  label: 'Gmail — sending only',
  scopes: [
    {
      scope: 'https://www.googleapis.com/auth/gmail.send',
      label: 'Send mail as you — and nothing else',
      reason: 'A letter written on /communications leaves from your mailbox.',
    },
  ],
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/authorize/${id}`]}>
      <Routes>
        <Route path="/authorize/:integrationId" element={<AuthorizeIntegration />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the consent screen offers what the server offers', () => {
  beforeEach(() => {
    vi.mocked(integrationsApi.getCatalog).mockResolvedValue([
      SEND_ENTRY,
      READ_ENTRY,
    ] as never)
    // These entries carry no `mirrorsMail`, which is the shape an older gateway
    // sends: the page shows no retention section and does not block Continue.
    vi.mocked(integrationsApi.getRetentionDisclosure).mockRejectedValue(
      new Error('not asked for in these cases'),
    )
  })

  it('renders the sending grant, which HEAD refused as an unknown integration', async () => {
    renderAt('gmail_send')
    expect(await screen.findByText(/Connect Gmail — sending only to Mudavym/)).toBeTruthy()
    expect(screen.getByText(/Send mail as you/)).toBeTruthy()
  })

  it('renders the reading grant, and its one scope', async () => {
    renderAt('gmail_read')
    expect(
      await screen.findByText(/Connect Gmail — reading vendor replies only to Mudavym/),
    ).toBeTruthy()
    expect(screen.getByText(/from: filter built from the vendor book/)).toBeTruthy()
    expect(
      screen.getByText(/not a vendor in this house’s book|not a vendor in this house's book/),
    ).toBeTruthy()
  })

  it('states where what is read lands and who can see it', async () => {
    renderAt('gmail_read')
    expect(await screen.findByText('Where it goes, and who can see it')).toBeTruthy()
    expect(screen.getByText('What we read')).toBeTruthy()
    expect(screen.getByText('What we never read')).toBeTruthy()
    expect(screen.getByText('Where it lands')).toBeTruthy()
    expect(screen.getByText('Who can see it')).toBeTruthy()
    expect(screen.getByText(/procurement_conversations/)).toBeTruthy()
    expect(screen.getByText(/Everyone who works in this restaurant/)).toBeTruthy()
  })

  it('renders nothing where a gateway sent no privacy block, rather than a reassurance', async () => {
    const { dataHandling, ...withoutBlock } = READ_ENTRY
    vi.mocked(integrationsApi.getCatalog).mockResolvedValue([withoutBlock] as never)
    renderAt('gmail_read')
    expect(
      await screen.findByText(/Connect Gmail — reading vendor replies only to Mudavym/),
    ).toBeTruthy()
    expect(screen.queryByText('Where it goes, and who can see it')).toBeNull()
  })

  it('says the DEPLOYMENT does not offer an id, not that it does not exist', async () => {
    renderAt('some_future_integration')
    // The claim is about the catalogue the server returned, which is a fact we
    // hold — not about what exists, which is not.
    expect(await screen.findByText(/does not include "some_future_integration"/)).toBeTruthy()
  })
})

/**
 * The Drive grant's consent screen says the house's vendor mail may be written
 * to that Drive (ADR 0118 D16; the founder's answer to question 2, 2026-09-05:
 * "Amend the copy; the sealed choice is the consent" — no re-authorisation loop).
 *
 * The gateway owns the sentence and `drive-says-it-may-hold-the-mail.spec.ts`
 * guards its wording. What is proved HERE is the other half: that the page
 * actually renders it to the person deciding. A disclosure that exists in a
 * constants file and never reaches a screen is the same silence as no
 * disclosure, and these two tests are on either side of that seam.
 */
describe('the Drive consent screen discloses the mail archive', () => {
  const DRIVE_ENTRY = {
    ...READ_ENTRY,
    id: 'google_drive',
    label: 'Google Drive',
    description:
      "Save exports, menu scans, and this restaurant's own archived copy of its vendor mail to a folder in your Drive.",
    scopes: [
      {
        scope: 'https://www.googleapis.com/auth/drive.file',
        label: 'Create and manage files WineOps puts in your Drive',
        reason:
          'Lets us write inventory exports and scanned menus to Drive, and — if this restaurant turns it on — its own archived copy of the vendor mail it receives.',
      },
    ],
    notRequested: ['Reading files you did not create with WineOps'],
    dataHandling: {
      reads: 'Only files this app itself created in your Drive.',
      doesNotRead:
        'Anything else in your Drive. `drive.file` cannot see a document this app did not create.',
      landsIn:
        "Nothing from Drive is copied into Mudavym. If this restaurant chooses to keep its own copy of its vendor mail, THAT is written out through this same grant: every vendor reply mirrored into the restaurant's conversation book is written into a `Mudavym mail archive` folder in this Drive. It is off unless a manager or owner turns it on for the restaurant, and the restaurant's own /connections page names whose Drive it goes to.",
      visibleTo: 'You, on /profile.',
      keptFor:
        'The exported copies outlive the grant, and Mudavym can never read, change or delete them.',
    },
    mirrorsMail: false,
    available: true,
    unavailableReason: null,
  }

  beforeEach(() => {
    vi.mocked(integrationsApi.getCatalog).mockResolvedValue([DRIVE_ENTRY] as never)
    vi.mocked(integrationsApi.getRetentionDisclosure).mockRejectedValue(
      new Error('not asked for a grant that mirrors no mail'),
    )
  })

  it('prints that the house’s vendor mail may be written to this Drive', async () => {
    renderAt('google_drive')
    expect(await screen.findByText(/Connect Google Drive to Mudavym/)).toBeTruthy()
    expect(screen.getByText(/Mudavym mail archive/)).toBeTruthy()
    expect(screen.getByText(/every vendor reply mirrored/)).toBeTruthy()
  })

  it('says the archive is OFF until the restaurant turns it on, and who to ask', async () => {
    renderAt('google_drive')
    await screen.findByText(/Connect Google Drive to Mudavym/)
    expect(
      screen.getByText(/off unless a manager or owner turns it on/),
    ).toBeTruthy()
    expect(screen.getByText(/names whose Drive it goes to/)).toBeTruthy()
  })

  it('does NOT gate the Drive grant on a retention figure it never needs', async () => {
    // `mirrorsMail: false` — Drive reads no mailbox, so there is no window to
    // print and the failed retention read must not disable Continue. The
    // founder's answer was "no re-authorisation loop"; a blocked button here
    // would be a loop by another name.
    renderAt('google_drive')
    await screen.findByText(/Connect Google Drive to Mudavym/)
    expect(screen.queryByTestId('retention-disclosure')).toBeNull()
    const button = screen.getByRole('button', { name: /Continue to Google/ })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })
})
