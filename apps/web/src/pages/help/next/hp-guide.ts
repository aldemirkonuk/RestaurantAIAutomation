/**
 * hp-guide — the guide collection ADR 0160 §111 owes.
 *
 * The founder's words (quoted in full in `.planning/decisions/0160-...md`
 * §111): *"make sure that we have a collection of great how to use the AI
 * agent ... how to go between tasks, configure tasks, goals, and the general
 * overview, readme type of thing, document."* And separately: *"just mimic
 * how the big companies are doing. Such as Anthropic, and other fintech
 * startup companies."*
 *
 * So this is written as PRODUCT DOCUMENTATION — what a real feature does and
 * where it lives — never as marketing copy ("supercharge your workflow").
 * Every claim below is a citation to code that exists today, checked the day
 * this was written; `hp-guide.test.ts` re-checks the mechanical half the same
 * way `hp-faq.test.ts` does for the FAQ: every `goes.to` is a route App.tsx
 * actually mounts, and no entry names the old brand.
 *
 * A guide article is not a measurement about a tenant — it carries no live
 * number, so it never needs an unknown/em-dash state the way `hp-readiness.ts`
 * does. What it must not do is claim a capability that is not built: the
 * "Ask AI" bar this page's first article documents is mounted unconditionally
 * in `DashboardLayout.tsx` (not behind `mudavym_design_ask`, which has no
 * registry entry — see the build note this page's dossier left on that
 * point), so describing it here is describing what ships, not what is coming.
 */

export interface GuideStep {
  /** A single instruction or fact, kept to one sentence where it can be. */
  text: string;
}

export interface GuideEntry {
  /** Anchor: `/help#<slug>` opens this entry. */
  slug: string;
  title: string;
  /** One line under the title, said the way a doc's dek is said. */
  dek: string;
  steps: readonly GuideStep[];
  goes?: { to: string; label: string };
}

export const GUIDE_ENTRIES: readonly GuideEntry[] = [
  {
    slug: 'using-the-assistant',
    title: 'Using the assistant',
    dek: 'One panel, two modes: ask the books, or propose an action you seal.',
    steps: [
      // CommandProvider.tsx: ⌘K/Ctrl+K opens the palette in capture phase;
      // ⌘⇧K opens the Ask panel via ASK_AI_OPEN_EVENT (ADR 0145, "One panel,
      // two modes", founder, 2026-09-26). The header's Ask and the rail's
      // first row open the same panel.
      {
        text: 'Press Cmd+Shift+K (Ctrl+Shift+K on Windows) anywhere in the app, or choose Ask in the header, to open the Ask panel. Two modes sit at its top: Ask the books, and Propose an action. Enter runs the one that is selected; if your words read like the other one, the panel says so and leaves the choice to you.',
      },
      // [2026-09-25] ADR 0145: the bound ask answers out of a reading of the
      // house's books; /sommelier now redirects to /ask (App.tsx).
      {
        text: 'Ask the books answers a question about the house itself — stock, orders, receipts, the calendar. Every figure comes from a reading of the house’s own books, and each answer opens on the Ask page, where your past questions stay in your book.',
      },
      // askAi.ts module doc: only the sealed apply executes, and only against
      // an action id a human has held for. Allowlist: reorder, vendor_draft.
      {
        text: 'Propose an action drafts one action — today a reorder or a vendor message; everything else it declines to invent. Nothing sends, orders or changes stock until an owner or a manager holds to seal the proposal.',
      },
    ],
    goes: { to: '/ask', label: 'Open Ask' },
  },
  {
    slug: 'moving-between-tasks',
    title: 'Moving between tasks',
    dek: 'The keyboard moves faster than the sidebar once you know four keys.',
    steps: [
      {
        text: 'Cmd+K opens the command palette: search any page, any person, any recent order, and jump straight there.',
      },
      // CommandProvider.tsx GOTO_MAP: "g" then a key.
      {
        text: 'Press "g" then a letter to jump to a page without leaving the keyboard — the same pattern Gmail and Linear use. Press "?" any time to see the full list for this build.',
      },
      {
        text: 'Cmd+Shift+O reopens whatever you had open recently, in the order you looked at it — useful after Ask or a search sends you somewhere new.',
      },
      {
        text: 'The bell in the header is the one place every waiting item across the house collects, regardless of which page raised it.',
      },
    ],
    goes: { to: '/notifications', label: 'Open Notifications' },
  },
  {
    slug: 'configuring-tasks-and-goals',
    title: 'Configuring tasks and goals',
    dek: 'Where a target is set, and where a standing job is turned on or off.',
    steps: [
      // rp-registers-goals.tsx header: owner/manager decide, edit via
      // PATCH /analytics/goals/:rid/:goalId; measure list server-side.
      {
        text: 'Goals — a measure, a target and a deadline — are set and edited on Reports, by an owner or manager. "Ask the book" can suggest which of the house’s own analyses fits a goal you describe; it never writes the number itself.',
      },
      // one-tap-actions raised by the house (dashboard/next/OneTapPanel.tsx
      // header, "system" rows with no user_id); shown promoted on /help's
      // own state section above.
      {
        text: 'Standing to-dos the house itself raises — a delivery to confirm, a note to close — collect on the Dashboard, directly under what is waiting on you. This page’s own state above lists what is pending right now.',
      },
      // calendar/next/ReminderRegister.tsx; settings/next/NotifySection.tsx
      {
        text: 'Reminder timing and quiet hours are set on Calendar; which events notify you at all is set on Settings, under Notifications.',
      },
    ],
    goes: { to: '/reports', label: 'Open Reports' },
  },
  {
    slug: 'general-overview',
    title: 'General overview',
    dek: 'What Mudavym is, in the order a new manager would actually touch it.',
    steps: [
      {
        text: 'Inventory is the house’s own count — lots, not a single running number — and it is what Orders, Receiving and the Cellar all read and write against.',
      },
      {
        text: 'Orders and Receiving are the two sides of one exchange with a vendor: what was asked for, and what actually arrived. A receipt is where a discrepancy is recorded, not guessed at.',
      },
      {
        text: 'Providers is the house’s vendor book — terms, contacts and the price history Recommendations and the state section above both read.',
      },
      {
        text: 'Reports and Recommendations are where the numbers become a decision: goals, digests, and the analyses the house has actually earned enough history to compute.',
      },
      {
        text: 'Team, Profile and Connections hold who has access to what — the house’s roster, your own account, and every outside grant (mail, model-context servers, POS, payment) this house depends on.',
      },
    ],
    goes: { to: '/get-started', label: 'Open the getting-started guide' },
  },
];

export function findGuide(slug: string | null | undefined): GuideEntry | null {
  if (!slug) return null;
  const s = slug.replace(/^#/, '').trim();
  return GUIDE_ENTRIES.find((e) => e.slug === s) ?? null;
}
