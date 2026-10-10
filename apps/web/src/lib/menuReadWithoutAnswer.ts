import { isUnconfirmedWrite } from '../services/api/client'

/**
 * Said when a read went out and no answer came back. The gateway keeps (and
 * pays for) the read whether or not the page is still waiting, so this is
 * never "not read", and sending the page again would read and keep it twice
 * (F-567, F-793, F-803). Same words as Menus kept on /menu.
 */
export const READ_WITHOUT_ANSWER =
  'No answer came back from the menu read. It may still be reading and keeping this menu: give it a few minutes and look for it under Menus kept before reading it again.'

/**
 * A timeout, a dropped line, or a server failure with no words of its own.
 * Mirrors readWithoutAnswer in MenuVersions (F-567).
 */
export function readWithoutAnswer(err: unknown): boolean {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message
  return isUnconfirmedWrite(err) && !(typeof m === 'string' && m)
}
