import type { TourDefinition } from '../tours/registry'

// Steps follow the job, not the screen (ADR 0251 D3). Each element must exist
// on the live page; a step whose element is missing is left out by TourEngine.

export const communicationsTip = {
  pageId: 'communications' as const,
  title: 'Communications',
  body: 'Your mail with vendors, and the letters drafted for you.',
}

export const communicationsTour: TourDefinition = {
  pageId: 'communications',
  // r23 walk (2026-11-13): the page has two tabs, and Letters' two steps are
  // not drawn on Mail. Started from Mail (where the notices and ?tab=mail land),
  // the tour shrank to "1/1" and the tip was then marked done, so the reader
  // never saw the rest. Each tab now has its own steps after the shared first
  // one; TourEngine leaves out the other tab's, because their elements are not
  // on the page. Mail's list shows 4 steps, a person, a thread or the setup 2,
  // Letters 3.
  steps: [
    {
      // 2026-11-07: the conversation book became the Mail tab; the step
      // points at the two tabs, which are always drawn.
      element: 'nav[aria-label="Mail and letters"]',
      title: 'Mail and letters',
      description:
        'Mail is every letter between you and your vendors, by person and by thread. Letters is what waits to be sent and what you write.',
    },
    // Mail: drawn only while the Mail tab is open.
    {
      // The status line is drawn on every Mail view: the list, a person, a
      // thread and the setup.
      element: '[data-tour="mail-status"]',
      title: 'Whether mail reaches the house',
      description:
        'This line says whether the house\'s mail is connected and when a letter last came. "How mail reaches the house" shows each way a letter comes in.',
    },
    {
      element: 'section[aria-label="People"]',
      title: 'Mail by person',
      // r40: one tour for every role, and the chip says "Waiting on you" only
      // to those who can answer (owner, manager); staff see "Waiting on the
      // house" (mail-format.ts waitingChipWords). The step names both so it
      // never tells staff a vendor waits on them.
      description:
        'Everyone the house has mail with. Open a person to read their threads; "Waiting on you" (or "Waiting on the house", if you cannot answer vendors) keeps only the vendors waiting on a reply.',
    },
    {
      element: 'section[aria-label="Who is writing"]',
      title: 'Who is writing',
      description:
        'Strangers, and letters held because their sender could not be confirmed, wait here, with the senders the house trusts.',
    },
    // Letters: drawn only while the Letters tab is open.
    {
      // COMMS-W38 (founder: "#571's order, step 2 widened"): the whole waiting
      // region, which is always drawn; "Drafts waiting" is drawn only while a
      // drafted reply waits, and letters staff asked a manager to send sit
      // beside it.
      element: 'section[aria-label="To send"]',
      title: 'Answer what waits',
      description:
        'Letters your staff asked you to send and replies drafted for you. Read one, change it if you need to, then hold to send it, or to ask a manager to send it.',
    },
    {
      element: '[data-tour="comms-write"]',
      title: 'Write a letter',
      description:
        "Write to a vendor from scratch, or start from one of the house's templates.",
    },
  ],
}
