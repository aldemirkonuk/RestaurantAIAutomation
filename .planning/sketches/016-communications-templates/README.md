# 016 · Communications Templates

**Design question:** Should the templates page be a browsable library, a split-panel editor, or an activity-first feed?

## Context

The current `/communications` page has several UX friction points:
- Two massive "hero" marketing cards dominate the screen, burying the actual templates
- Email and SMS templates are split into completely separate lists with no unified search
- The category filter state exists in code but is never rendered in the UI
- No template preview on hover; users must open the full builder to see content
- The "Quick Templates" dropdown pops awkwardly *above* the button
- Communication History has no relationship to which template was used
- Page title says "Documents & Templates" but the route is `/communications`

## Variants

### A — Library Grid (Recommended)
**Left sidebar nav + unified search + filter chips + responsive card grid**

- Left rail organizes by channel (All / Email / SMS) and use case (Orders / Providers / Alerts / General)
- Cards show a channel-colored visual preview thumbnail on hover with Edit/Preview actions
- Quick-start chips at the top for the 5 most common templates + AI Generate
- AI Suggestions strip appears contextually (dismissible) with personalized recommendations
- Search + filter chips in a sticky top bar
- "New Template" CTA is always visible in sidebar footer

**Why it wins:** Template management is a *library* mental model. Users scan, find, act — not configure. The grid makes all templates discoverable at once without deep navigation.

### B — Split Panel
**Compact list on the left, live preview/editor on the right**

- Grouped list (Orders / Providers / General) with channel icon badges
- Selected item loads a full HTML/SMS preview with variable substitution test data
- Toggle between Preview and Edit modes in the right pane
- Use Template CTA always in the header

**Best for:** Power users who work with templates daily and want to inspect content quickly without modal hops.

### C — Activity Feed
**Quick-access template strip at top, communication history as the primary view**

- Pinned templates as horizontal scrollable chips for 1-click reuse
- Stats sidebar: emails/SMS sent this month, top templates, scheduled sends
- Main feed: chronological communication history with template attribution, delivery status, and auto-trigger labels
- Groups by date (Today / Yesterday / This Week)

**Best for:** Managers who primarily want to *monitor* communications, not *author* templates.

## Recommendation

**Variant A** for the templates tab, with **Variant C's feed layout** for the Communication History tab. This gives authors a proper library and managers a proper audit feed — matching the two very different jobs to be done on this page.

## Next Steps
- Pick a winner and note it in MANIFEST.md
- Feed into the Phase 28 Onboarding Reform work (template library is used for activation checklist messaging)
- Build a `/communications` page redesign plan under Phase 29 or as a quick task
