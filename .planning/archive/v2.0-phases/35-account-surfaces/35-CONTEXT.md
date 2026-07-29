# Phase 35 — Account Surfaces CONTEXT

## Locked decisions

### Profile vs Settings
| Surface | Owns |
|---------|------|
| `/profile` | Person: display name, email (read-only + support to change), phone, password, linked Google/Microsoft, theme, role (read-only), active restaurant switcher, danger zone, owner Upgrade stub |
| `/settings` | Restaurant: team, locations, features, notifications (restaurant channels), email sender, measurement, calendar, labor, services |

### Role matrix
| Capability | Owner | Manager | Staff |
|------------|-------|---------|-------|
| Edit own Profile | yes | yes | yes |
| Password / OAuth link | yes | yes | yes |
| Switch restaurant | yes | yes | yes (memberships) |
| Settings ops sections | full | full (locations owner-only) | staff shell only |
| Leave restaurant | yes | yes | yes |
| Delete account | yes | yes | yes |
| Upgrade CTA | yes (stub) | hide | hide |

### Support channels
- **P0 (shipped):** Email (`VITE_SUPPORT_EMAIL`), Slack (`VITE_SUPPORT_SLACK_URL`), FAQ stubs
- **P1:** In-app docs / Notion KB
- **P2:** Ticket form / Intercom
- **P3:** Discord, status page, WhatsApp

### Sketch winner
**C — Left rail** (Account / Security / Linked / Preferences / Danger). Highest purity×effectiveness for multi-section growth; light theme first; restrained motion.

### Manager-only rail sections (added)
Visible when `activeRole` is `owner` or `manager` (hidden for staff):
- **Restaurant** — rename active location + city (`PATCH /organizations/locations/:id`)
- **Payment** — billing email/phone on restaurant; plan badge Free; card checkout later
- **Memberships** — list branches, switch active, link to Settings → Team for invites/roles

Backend enforces manager|owner on location name/city/email/phone updates.

### Email change
v1: email read-only; contact support to change (verification mailer deferred).
