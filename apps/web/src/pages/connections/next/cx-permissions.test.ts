/**
 * The bullets belong to the integration, not to the page.
 *
 * The defect these tests exist for: Register III printed Drive's promise
 * ("Create and edit files it made", "Never mail, never other documents") under
 * EVERY integration, including `gmail_send`, which asks for `gmail.send` alone.
 * Every assertion below is a way of asking "can one integration print another's
 * promise?" and requiring the answer to be no.
 */

import { describe, expect, it } from 'vitest';
import { grantHolds, wouldAskFor, type PermissionSource } from './cx-permissions';

/** The two definitions as `GET /integrations/oauth/catalog` publishes them. */
const drive: PermissionSource = {
  id: 'google_drive',
  scopes: [
    {
      scope: 'https://www.googleapis.com/auth/drive.file',
      label: 'Create and manage files WineOps puts in your Drive',
    },
    { scope: 'openid', label: 'Confirm which Google account you connected' },
  ],
  notRequested: ['Reading files you did not create with WineOps', 'Your Gmail messages'],
};

const gmailSend: PermissionSource = {
  id: 'gmail_send',
  scopes: [
    {
      scope: 'https://www.googleapis.com/auth/gmail.send',
      label: 'Send mail as you — and nothing else',
    },
  ],
  notRequested: [
    'Reading, searching or listing any message in your mailbox',
    'Your drafts, labels, filters, settings or contacts',
  ],
};

describe('what an integration would ask for', () => {
  it('draws Drive’s bullets from Drive', () => {
    expect(wouldAskFor(drive)).toEqual([
      { text: 'Create and manage files WineOps puts in your Drive', can: true },
      { text: 'Confirm which Google account you connected', can: true },
      { text: 'Reading files you did not create with WineOps', can: false },
      { text: 'Your Gmail messages', can: false },
    ]);
  });

  it('never prints Drive’s promise under the send-only mailbox', () => {
    const bullets = wouldAskFor(gmailSend);
    const text = bullets.map((b) => b.text).join(' | ');

    expect(text).not.toMatch(/files/i);
    expect(text).not.toMatch(/never mail/i);
    expect(text).not.toMatch(/other documents/i);
    expect(bullets.filter((b) => b.can)).toEqual([
      { text: 'Send mail as you — and nothing else', can: true },
    ]);
    expect(bullets.filter((b) => !b.can).map((b) => b.text)).toEqual(gmailSend.notRequested);
  });

  it('says nothing at all rather than guessing, when the definition carries no scopes', () => {
    expect(wouldAskFor({ id: 'excel' })).toEqual([]);
    expect(wouldAskFor({ id: 'excel', scopes: [], notRequested: ['Reading your Outlook mail'] })).toEqual([]);
    expect(wouldAskFor(null)).toEqual([]);
  });
});

describe('what one grant holds', () => {
  it('reads the grant’s own scopes, through the definition’s words', () => {
    expect(grantHolds(['https://www.googleapis.com/auth/gmail.send'], gmailSend)).toEqual([
      { text: 'Send mail as you — and nothing else', can: true },
      { text: 'Reading, searching or listing any message in your mailbox', can: false },
      { text: 'Your drafts, labels, filters, settings or contacts', can: false },
    ]);
  });

  it('matches a stored scope tail against the definition’s full scope URL', () => {
    expect(grantHolds(['drive.file'], drive)[0]).toEqual({
      text: 'Create and manage files WineOps puts in your Drive',
      can: true,
    });
  });

  it('prints an unrecognised scope as itself rather than dropping it', () => {
    const bullets = grantHolds(['https://www.googleapis.com/auth/drive'], drive);
    expect(bullets).toEqual([
      { text: 'https://www.googleapis.com/auth/drive', can: true },
    ]);
  });

  it('withholds the definition’s promises when the grant is wider than the definition', () => {
    // The grant holds something the definition never declared, so the
    // definition's "never asked for" list is not this grant's promise.
    const bullets = grantHolds(
      ['https://www.googleapis.com/auth/gmail.send', 'https://mail.google.com/'],
      gmailSend,
    );
    expect(bullets.some((b) => !b.can)).toBe(false);
    expect(bullets.map((b) => b.text)).toContain('https://mail.google.com/');
  });

  it('is empty when the grant records no scope, and when the catalogue is unread', () => {
    expect(grantHolds([], drive)).toEqual([]);
    expect(grantHolds(['drive.file'], null)).toEqual([
      { text: 'drive.file', can: true },
    ]);
  });
});
