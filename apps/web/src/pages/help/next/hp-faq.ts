/**
 * hp-faq — the questions people ask, as data.
 *
 * A small module rather than an array inside the page so it can grow without
 * the page growing (help.md §13.5). Every answer is a claim about the product
 * and was checked against the code the day it was written — the citation sits
 * beside each entry, and `hp-faq.test.ts` re-checks the mechanical half: each
 * `goes.to` names a route `App.tsx` actually mounts, no answer names the old
 * brand, and no slug repeats (a slug is a deep link: `/help#invite-team`).
 *
 * This is prose that describes, not rows that assert — nothing here is a
 * measurement about a tenant.
 */

export interface FaqEntry {
  /** Anchor: `/help#<slug>` opens this entry. */
  slug: string;
  question: string;
  answer: string;
  /** Where the answer sends you, when it sends you somewhere. */
  goes?: { to: string; label: string };
}

export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    // Settings.tsx:853 deep-links `?tab=team`; settings/next/st-format.ts:107 keeps
    // `team` in SECTION_IDS; TeamSection mounts InviteTeamDialog.
    slug: 'invite-team',
    question: 'How do I invite my team?',
    answer:
      'Owners and managers invite from Settings, under Team: share the invite code or the link, and the person joins with it. Staff can join; they cannot invite.',
    goes: { to: '/settings?tab=team', label: 'Open Team' },
  },
  {
    // Profile.tsx:39-40 (Security, Linked accounts); profile/next Register II
    // (Security) and Register III (Connected accounts); AuthContext.loginWithGoogle/Microsoft.
    slug: 'password-or-login',
    question: 'Where do I change my password, or the account I sign in with?',
    answer:
      'In your profile. Security holds the password; Connected accounts holds Google and Microsoft sign-in. Both belong to you, not to the restaurant, so neither appears in Settings.',
    goes: { to: '/profile', label: 'Open your profile' },
  },
  {
    // settings/next/SettingsNext.tsx:194 refuses `staff` in words; each register's
    // gateway route refuses independently with a 403 the page prints.
    slug: 'who-edits-settings',
    question: 'Who can change restaurant settings?',
    answer:
      'Owners and managers. A staff account is refused on the page and again by the gateway; it can still change its own profile.',
  },
  {
    // This page, section II. No fallback address exists in the rebuilt page.
    slug: 'reach-the-team',
    question: 'How do I reach the Mudavym team?',
    answer:
      'Through the channels in "Reach a person" above, when this deployment has them configured. If that section says none is configured, no address was set for this build; there is no default one.',
  },
  {
    // guidance/components/LearnPanel.tsx:197 (startPageTour), :256 (resetTips);
    // components/layout/Sidebar.tsx:743 (the entry).
    slug: 'page-tours',
    question: 'Where are the page tours and the tips?',
    answer:
      'Learn & Help, at the bottom of the sidebar. From there you can replay any page’s tour or bring back the tips you dismissed.',
  },
  {
    // st-format.ts:140 — `services`, titled "Services & permissions"; when the
    // `connections` flag is on SettingsNext forwards the tab to /connections.
    slug: 'services-permissions',
    question: 'Where do I control email, web and privacy access?',
    answer:
      'Settings, under Services & permissions. It is separate from the tours, and nothing the sommelier desk does grants email access.',
    goes: { to: '/settings?tab=services', label: 'Open Services & permissions' },
  },
  {
    // App.tsx mounts `/privacy` outside the protected tree (public by design).
    slug: 'privacy',
    question: 'Where is the privacy statement?',
    answer: 'On its own page, public, readable before you have an account.',
    goes: { to: '/privacy', label: 'Read the privacy page' },
  },
  {
    // Section I of this page reads GET /api/v1/health/ready and prints the answer.
    slug: 'is-it-down',
    question: 'A page is not loading. Is the service down?',
    answer:
      'The first section of this page asks the gateway directly and prints what it said. If the service is ready and a page still fails, the fault is in that page; name it when you write.',
  },
];

export function findFaq(slug: string | null | undefined): FaqEntry | null {
  if (!slug) return null;
  const s = slug.replace(/^#/, '').trim();
  return FAQ_ENTRIES.find((e) => e.slug === s) ?? null;
}
