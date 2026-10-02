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
    // Founder item 93 (2026-09-28), ADR 0215 items 26 and 27. The picker is
    // RosterSheet.tsx ReplaceWithPicker ("Their upcoming shifts go to") →
    // TeamService.deleteMember with a hand-over (handoverChecks: overlap
    // refused unless the owner's "Allow double booking" is on; time off,
    // role and the 45-hour week warn). Shifts not handed over open
    // (release_leaving_shifts); the past is kept.
    slug: 'replace-team-member',
    question: 'Someone is leaving and a new person is taking their shifts. What do I do?',
    answer:
      'Add the new person first, if they are not on Team yet. Then open the leaving person, press Remove, and under “Their upcoming shifts go to” choose who takes them; untick any shift you would rather leave open. A shift that overlaps one the new person already has cannot go to them unless the owner allows double booking in Settings under Team; time off, a different role and a week over 45 hours are shown as warnings for you to confirm. Remove the leaving person last. Anything you did not hand over goes back to the open pool, for anyone to take; their past shifts stay in the owner’s former-staff history.',
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
    // components/mudavym/HouseShell.tsx mounts PageTipStrip above the page.
    // guidance/components/PageTipStrip.tsx offers "Show me" only when the
    // tour's own stepsOnPage (tours/TourEngine.tsx) finds a step on the page.
    // "Turn tips back on" is PageTipsSwitch in this page's "Ways back in"; it
    // calls GuidanceProvider's resetTips, which sets every page's tip back to
    // unseen. The legacy sidebar's "Learn & Help" (LearnPanel) is drawn only
    // when a browser override turns the house shell off, so it is not named.
    // "Not now" is snoozeTip: four hours. "In this tab": resetTips drops each
    // page's snooze_until and resets this tab's session count, but the
    // gateway deep-merges the save, so the account keeps a "Not now" snooze
    // and another browser that loads it hides that tip until the snooze runs
    // out (OPEN in .planning/tech-debt.d/2026-10-02-feat-tips-margin-note-and-tour-card.md).
    // "Two in one tab": tipVisibleFor stops at sessionRef skips >= 2, counted
    // in sessionStorage by snoozeTip, dismissTip and a tour's onSkipped.
    slug: 'page-tours',
    question: 'Where are the page tours and the tips?',
    answer:
      'Some pages open with a one-line tip at the top. Its "Show me" walks you through that page step by step, and is offered only when the page has steps to show. "Not now" puts that tip off for four hours. "Don\'t show tips again" turns every page’s tip off. To bring them back, use "Turn tips back on" under Ways back in, on this page. Every page’s tip then comes back in this tab, including ones you closed, so you can take a tour again from its tip. In another browser, a tip you put off with "Not now" can stay hidden for up to four hours. Once you put off or stop two tips or tours in one tab, that tab shows no more tips until it is closed or you press "Turn tips back on" in it.',
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
