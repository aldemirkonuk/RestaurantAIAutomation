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
 * measurement about a tenant. The house's own live state has its own section
 * above this one (`hp-readiness.ts`), read from the gateway; this module
 * never composes a sentence about THIS house.
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
    // Settings.tsx:73 keeps `team` in SECTION_IDS; TeamSection mounts
    // InviteTeamDialog. `/team` itself (TeamCommandPage) also invites.
    slug: 'invite-team',
    question: 'How do I invite my team?',
    answer:
      'Owners and managers invite from Team, or from Settings under Team: share the invite code or the link, and the person joins with it. Staff can join with a code; they cannot send one.',
    goes: { to: '/team', label: 'Open Team' },
  },
  {
    // Profile.tsx (Security, Linked accounts); ProfileNext Register II
    // (Security) and Register III (Connected accounts); AuthContext.loginWithGoogle/Microsoft.
    slug: 'password-or-login',
    question: 'Where do I change my password, or the account I sign in with?',
    answer:
      'In your profile. Security holds the password; Connected accounts holds Google and Microsoft sign-in. Both belong to you, not to the restaurant, so neither appears in Settings.',
    goes: { to: '/profile', label: 'Open your profile' },
  },
  {
    // SettingsNext refuses `staff` in words; each register's gateway route
    // refuses independently with a 403 the page prints (ADR 0147 role gates).
    slug: 'who-edits-settings',
    question: 'Who can change restaurant settings?',
    answer:
      'Owners and managers. A staff account is refused on the page and again by the gateway; it can still change its own profile.',
  },
  {
    // This page, "Reach a person" — the only support channel, and it is
    // read from a build variable with no fallback (hp-support.ts).
    slug: 'reach-the-team',
    question: 'How do I reach the Mudavym team?',
    answer:
      'By email, in "Reach a person" below on this page. If that section says no address was configured, none was set for this build; there is no default one and no other channel.',
  },
  {
    // guidance/components/LearnPanel.tsx (startPageTour/resetTips);
    // components/layout/Sidebar.tsx — "Learn & Help" entry at the bottom.
    slug: 'page-tours',
    question: 'Where are the page tours and the tips?',
    answer:
      'Learn & Help, at the bottom of the sidebar. From there you can replay any page’s tour or bring back the tips you dismissed.',
  },
  {
    // settings/next/st-format.ts SECTION_IDS/COLLAPSED_SECTIONS: `services`
    // still opens on /settings, and redirects to /connections#grants once
    // that house's Connections redesign is on. Both are stated, since which
    // is live varies by house and this page cannot read another page's flag.
    slug: 'services-permissions',
    question: 'Where do I control email, web and privacy access?',
    answer:
      'Settings, under Services & permissions. Once Connections is turned on for your house, that section forwards there instead — the register itself does not move, only where it is opened from.',
    goes: { to: '/settings?tab=services', label: 'Open Services & permissions' },
  },
  {
    // App.tsx mounts `/privacy` outside the protected tree (public by design,
    // ADR 0133).
    slug: 'privacy',
    question: 'Where is the privacy statement?',
    answer: 'On its own page, public, readable before you have an account.',
    goes: { to: '/privacy', label: 'Read the privacy page' },
  },
  {
    // The state section above reads the same gateway facts this page's own
    // readiness line composes (hp-readiness.ts) — connections, what is
    // waiting, what last failed — rather than a synthetic health probe.
    slug: 'is-it-down',
    question: 'A page is not loading. Is it me, the house, or the service?',
    answer:
      'The state above this list answers three questions this house can ask about itself, and the line under the page title says whether this deployment answered at all. If the deployment is up and a page still fails, the fault is in that page — name it when you write.',
  },
  {
    // hp-readiness.ts composes GET /mcp-connections, /integrations/oauth/*,
    // /pos-hub/status, /communications/letters/sender for the "Connections"
    // group above.
    slug: 'connections-meaning',
    question: 'What does "Connections" in the state above actually check?',
    answer:
      'Whether this house’s mail reading, its model-context servers, its till and its personal Google/Microsoft grants were last found working — each dated, not a live ping. A grant "recorded" is not the same claim as a grant "working": a token can go stale between uses without anything here noticing until the next real read.',
    goes: { to: '/connections', label: 'Open Connections' },
  },
];

export function findFaq(slug: string | null | undefined): FaqEntry | null {
  if (!slug) return null;
  const s = slug.replace(/^#/, '').trim();
  return FAQ_ENTRIES.find((e) => e.slug === s) ?? null;
}
