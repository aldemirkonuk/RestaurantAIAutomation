> **Answered 2026-09-22 — ADR 0149 row 53 / PR #413.** Founder chose the persistent routine-tone `/connections` banner **in addition to** the phone push. This document remains the research record; the decision lives in ADR 0149.

---
type: research
title: Revoked mail-access alerting — industry research for the /help Q8 hold
status: research record, informs an open decision
updated: 2026-09-22
links: ["[[../decisions/OPEN-DECISIONS.md]]", "[[PAGE-GAP-QUESTIONS-2026-09-22]]", "[[PAGE-GAP-REPORT-2026-09-22]]"]
---

# Revoked mail-access alerting — industry research

## Why this exists

PR #413 rebuilds `/help` and ships on merge (`ALWAYS_ON_PAGES`, no flag). One corner
is unresolved: when a staff/manager's connected mail integration (Gmail OAuth —
the same integration that feeds `/communications` and `/connections`, see
`.planning/06-pages/communications.md:31-46`) loses access — token revoked, OAuth
deauthorized, password-triggered revocation, etc. — the phone is already decided
to get a push notification. Whether the **web app should also show something**
was asked as Q8 in `.planning/07-reference/deploy/PAGE-GAP-QUESTIONS-2026-09-22.md:141-153`
and left open: the founder said "maybe not" three times and "I'm not sure," then
on 2026-09-22 asked directly for industry case studies before deciding. This
document is that research. It does not close Q8 — it informs it (CLAUDE.md §0.1).

Scope: this is specifically about a **connected mail/OAuth integration losing
access** (a routine, recoverable, self-service-fixable state), not a generic
account-security alert (compromised login, new-device sign-in). That distinction
turned out to be one of the research's own findings — see Q3 below.

---

## Case studies

| Product / doc | Pattern observed | Source |
|---|---|---|
| **Plaid** (`ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `PENDING_DISCONNECT`, `USER_PERMISSION_REVOKED` webhooks) | Plaid itself sends no banner/push/email — it hands the app a webhook and tells the integrator: "tell your user (using in-app messaging **and/or** notifications such as email or text message) to return to your app to fix their Item." The state is not dismissed until a `LOGIN_REPAIRED`/successful re-auth event fires — i.e. persistent, not one-shot. | [plaid.com/docs/link/update-mode](https://plaid.com/docs/link/update-mode/), [plaid.com/docs/errors/item](https://plaid.com/docs/errors/item/) |
| **Nylas** (`grant.expired` webhook — the closest analog to Mudavym's exact case: a revoked mail-provider OAuth grant) | Explicit, documented rationale: "Surface the paused state in your UI as a 'Reconnect account' banner rather than a silent failure. A visible prompt tied directly to the OAuth link turns a dead integration into a one-click fix, **and it stops users from assuming your product is broken** when the real issue is an expired provider token." Also: email the user immediately because the fix has a clock — Nylas only backfills missed mail data for 72 hours after the grant breaks. | [developer.nylas.com — fix-invalid-grant-errors](https://developer.nylas.com/docs/cookbook/use-cases/build/fix-invalid-grant-errors/), [handle-grant-expiry](https://developer.nylas.com/docs/cookbook/use-cases/build/handle-grant-expiry/), [grant-lifecycle](https://developer.nylas.com/docs/dev-guide/best-practices/grant-lifecycle/) |
| **Zapier** (OAuth-connected app authentication failure → Zap auto-disabled) | Notification is opt-in **email** (Settings → Notifications), not push. Documented failure mode from Zapier's own community: without notifications on, a broken connection "fails silently" — the automation just stops and nobody finds out until someone notices missing work. That silent-failure complaint is the recurring one across Zapier's own support forum. | [community.zapier.com — GitHub auth failure thread](https://community.zapier.com/troubleshooting-99/is-there-a-way-for-zapier-to-let-the-user-know-that-the-github-authentication-failed-16757), [community.zapier.com — reconnect expired account](https://community.zapier.com/how-do-i-3/reconnect-an-expired-account-with-zapier-manager-24165), [zapier.com/blog — custom error notifications](https://zapier.com/blog/new-product-features-april-2023/) |
| **QuickBooks Online / Xero** (bank-feed OAuth connection breaks — the SMB-back-office analog closest to a restaurant manager's context) | In-product **persistent banner/alert on the exact account row** ("Fix your bank connection... disconnect and reconnect") plus, for provider-initiated changes, an **email from Intuit** as a secondary channel. Xero's own guidance: "you'll see an in-app message prompting you to refresh your bank feed" that stays until fixed. Framed as routine maintenance ("your bank updated its security settings"), never as a security incident. | [quickbooks.intuit.com — bank connection errors](https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/fix-bank-error-390-1000-quickbooks-online/L8t6KpfdI_US_en_US), [central.xero.com — fix bank connection](https://central.xero.com/0/article/Fix-issues-when-connecting-your-bank-to-Xero-NZ-AU-US-CA-SG-SA) |
| **Finary** (PSD2-driven bank re-auth, 90–180 day forced expiry) | Same status surfaced identically on **both** web and mobile: "Action required" in the status bar on web, in the Overview tab on mobile — explicitly documented as reachable from either surface, not one exclusively. | [help.finary.com — update a synchronized account](https://help.finary.com/en/articles/6519325-update-a-synchronized-account) |
| **Google** (Google Account → third-party app OAuth revocation vs. real security alerts) | Google draws a hard line the other products imply: **account-security alerts** (new-device sign-in, suspicious activity, blocked sensitive action) are a distinct, higher-urgency category with their own dedicated alerting; **routine third-party access changes** (linked-app review, access expiring) are surfaced only in the Account settings UI, with no push/urgent-email treatment. This is direct evidence for the tone question: mature products do **not** treat "an OAuth grant lost access" as a security event by default. | [support.google.com — respond to security alerts](https://support.google.com/accounts/answer/2590353?hl=en), [support.google.com — manage linked apps](https://support.google.com/accounts/answer/13533235) |
| **Slack** (`tokens_revoked` / `app_uninstalled` events) | Purely a developer-facing webhook mechanism — Slack does not prescribe end-user notification UX, leaving it to the integrating app. Useful negative case: shows the revocation *signal* is standardized industry-wide, but the *end-user notification channel* is explicitly left to product judgment, which is exactly Mudavym's fork. | [docs.slack.dev — tokens_revoked](https://docs.slack.dev/reference/events/tokens_revoked), [docs.slack.dev — app_uninstalled](https://docs.slack.dev/reference/events/app_uninstalled) |
| **Nielsen Norman Group** — "Indicators, Validations, and Notifications" (general UX doctrine, not integration-specific, but directly answers the persistent-vs-one-time question) | Documented field failure as rationale: a toast (transient, auto-dismissing) is the *wrong* pattern whenever "the information provided by the notification is key to the understanding of the system" — NN/g cites a real usability-test case of a user who missed a toast error and "spent 5 minutes waiting for content to load" because the message had already faded. A state that blocks a feature and needs a user action belongs in a persistent banner or alert, never a toast. | [nngroup.com — indicators, validations, notifications](https://www.nngroup.com/articles/indicators-validations-notifications/) |

---

## Synthesis, against the four questions asked

**(1) Web, mobile push, both, or in-app-only?**
No mature product researched relies on mobile push *alone*, and none treats web
and mobile as substitutes for each other. The consistent pattern is **channel
redundancy, routed to wherever the affected surface actually is**: Plaid tells
integrators to use in-app messaging *and/or* email/SMS; Nylas recommends email
*plus* an in-app banner; Zapier's own users complain when only one channel
(silent, no email) is active; Finary explicitly surfaces the identical "Action
required" status on both web and mobile rather than choosing one. The
underlying reason recurs everywhere: a revoked/expired OAuth grant is not
self-healing, and you do not know which surface the user is looking at when it
happens — so the channels are complementary, not either/or (SashiDo, Suprsend,
Duskolicanin — general push/email/in-app routing literature, converge on the
same rule: push is real-time but easy to miss or dismiss; a durable channel —
email or a persistent in-app surface — is what actually recovers the broken
state).

**(2) One-time alert, persistent banner, or both?**
Persistent, until fixed — unanimously. Plaid dismisses the messaging only on a
`LOGIN_REPAIRED`/successful-reauth event. Nylas's own stated reason for a banner
over a toast/one-time push is that a transient notification lets the user
"assume your product is broken" once it's gone and the feature is still dead.
QuickBooks/Xero keep the alert on the account row until the feed is reconnected.
This is also general UX doctrine, not integration-specific: NN/g's toast-vs-banner
rule is explicit that a toast is the wrong pattern for anything the user still
needs to act on, precisely because it disappears before the fix happens. A
one-time push notification for a state that persists until someone reconnects
is the pattern every source above argues against.

**(3) Tone — security-urgent, or a routine "please reconnect" nudge?**
Routine, not alarming — with one sharp exception that matters here. Google
explicitly separates **security alerts** (new sign-in, suspicious activity —
its own higher-urgency, dedicated-alerting category) from **routine third-party
access changes** (expiring/revoked linked-app grants — surfaced quietly in
account settings, no push, no urgent email). QuickBooks/Xero frame bank-feed
reconnection as expected maintenance ("your bank updated its security
settings... this is expected behavior"). LogicLeap's integration-UX writeup
gives the explicit good/bad copy contrast: bad = "Sync failed. Please reconnect
your account." (alarming, no context); good = "Sync paused: Google Calendar
connection expired. This happens every 90 days for security. Click here to
reconnect (takes 10 seconds)." — reassuring, specific, low-drama. **The
exception**: if the revocation is a *symptom* of a compromised account (staff
member fired and locked out, credential-stuffing, admin-forced revoke for
cause) rather than an expired token or a user's own deliberate disconnect, that
is Google's other category, and the mature-product answer would flip to
urgent/security-framed. Nothing in the codebase context read for this task
(`communications.md`, `PAGE-GAP-QUESTIONS`) suggests Mudavym's revocation event
distinguishes "expired/self-revoked" from "revoked for cause" — that
distinction is not yet made in the current design and is worth flagging back
if it isn't already (see Open item below).

**(4) Documented rationale (blog posts, support-ticket-driven, changelog)?**
Yes, and it converges on one root cause across every source that gave a
reason: **silent failure is the actual failure mode being defended against**,
not over-alerting. Nylas's dev docs state it as design rationale, not just a
recommendation: a banner "stops users from assuming your product is broken."
AppMaster's integration-status-page writeup makes the support-ticket
consequence explicit — an unclear or missing status message is what causes
users to "retry actions, re-connect accounts, or change settings that were
never the problem," i.e. it generates support load on the wrong fix.
LogicLeap's own metric framework flags "high support ticket rate" as the
signal that error-handling copy/placement failed. Zapier's own community
threads are, in effect, a public support-ticket record of exactly the failure
being asked about here: users whose one active channel (in-app-only, no email)
meant a dead automation went unnoticed for days.

---

## Recommendation for Mudavym

**Yes — the web app should also show a persistent banner, in addition to the
already-decided phone push, and it should be routine-toned, not
security-alarming, unless the revocation is later distinguished as
for-cause.**

Reasoning, tied to the research above and to Mudavym's own context:

- **No researched product substitutes push for a durable, persistent surface,
 and for good reason.** Push is real-time but is exactly the channel every
 source (Plaid's own docs, SashiDo, Suprsend) describes as easy to miss,
 swipe away, or lose — and a revoked mail grant is not self-healing. If the
 push is dismissed unread during a lunch rush, the mail integration (which,
 per `communications.md`, feeds vendor-thread classification and drafted
 procurement replies on `/communications`) silently stays broken with no
 second chance to notice, which is precisely the "assume it's fixed / assume
 the product is broken" failure Nylas's docs name directly.
- **The OAuth reconnect flow itself favors web.** Every case study above that
 actually completes a reconnect (Plaid's update-mode Link, Nylas's re-auth
 link, QuickBooks/Xero's reconnect flow) routes the user into a browser-based
 OAuth consent screen — the same shape as Mudavym's own
 `/authorize/:integrationId` (`.planning/06-pages/authorize-integration.md`).
 A phone push that opens straight into that flow is a heavier mobile-OAuth
 build; a web banner that links directly to `/connections` or
 `/authorize/:integrationId` is the natural, already-existing fix path and
 costs less to ship correctly.
- **This has a natural home, so it doesn't need to be a global interruption.**
 Every persistent-banner case study places the message *on the broken
 feature's own surface* (QuickBooks/Xero: the specific bank-account row;
 Nylas: tied to the OAuth link) rather than as a site-wide takeover. Mudavym
 already has that surface — `/connections` and the channel-state line on
 `/communications` (`communications.md:46`, "honest channel-state line (Gmail
 inbound watch queried, never asserted)") — so the banner is a small,
 contextual addition to an existing pattern, not new UI surface area.
- **Tone should match the routine-nudge framing, not a security klaxon** —
 Google's own split and LogicLeap's copy contrast both argue against
 borrowing the vocabulary of a breach alert for what is, in the common case,
 an expired or self-revoked token. Recommended framing: "Mail connection
 needs to be reconnected" with a direct action, not "Security alert."
- **One open item this research surfaces, not resolved by it:** whether
 Mudavym's revocation event can currently distinguish "token expired /
 self-revoked" from "revoked for cause" (e.g., an owner deliberately cutting
 off a departing manager's mail access). If it can't yet, that's worth a
 line in `OPEN-DECISIONS.md` — Google's research shows mature products treat
 those two cases with different urgency, and Mudavym's restaurant-team
 context (managers who can be terminated) makes that distinction plausible
 to eventually need.

This is a recommendation, not a resolution of Q8 — the founder's
"maybe not... but I disagree with myself" instinct was reasonable given how
close mature-product behavior sits to "no push-only," but the research comes
down against the "no web alert" default in `PAGE-GAP-QUESTIONS-2026-09-22.md:150`.
Q8 stays open for the founder's word per CLAUDE.md §0.1.

---

## Sources

- Plaid — [Updating Items via Link (update mode)](https://plaid.com/docs/link/update-mode/); [Item errors](https://plaid.com/docs/errors/item/); [Items API webhooks](https://plaid.com/docs/api/items/)
- Nylas — [Grant lifecycle best practices](https://developer.nylas.com/docs/dev-guide/best-practices/grant-lifecycle/); [Handle grant expiry](https://developer.nylas.com/docs/cookbook/use-cases/build/handle-grant-expiry/); [Fix invalid grant errors](https://developer.nylas.com/docs/cookbook/use-cases/build/fix-invalid-grant-errors/); [Manage grants](https://developer.nylas.com/docs/dev-guide/best-practices/manage-grants/); [Webhook notifications reference](https://developer.nylas.com/docs/reference/api/webhook-notifications/)
- Zapier — [Community: GitHub auth failure notice](https://community.zapier.com/troubleshooting-99/is-there-a-way-for-zapier-to-let-the-user-know-that-the-github-authentication-failed-16757); [Community: reconnect expired account](https://community.zapier.com/how-do-i-3/reconnect-an-expired-account-with-zapier-manager-24165); [Custom error notifications (blog)](https://zapier.com/blog/new-product-features-april-2023/); [Office 365 common problems](https://help.zapier.com/hc/en-us/articles/8496006544397-Common-problems-with-Microsoft-Office-365-on-Zapier)
- Google — [Respond to security alerts](https://support.google.com/accounts/answer/2590353?hl=en); [Manage links between your Google Account and apps](https://support.google.com/accounts/answer/13533235); [Share account access with third-party apps](https://support.google.com/accounts/answer/3466521?hl=en); [Automatic OAuth revocation on password change](https://support.google.com/a/answer/6328616); [Account Linking — unlinking](https://developers.google.com/identity/account-linking/unlinking)
- Slack — [tokens_revoked event](https://docs.slack.dev/reference/events/tokens_revoked); [app_uninstalled event](https://docs.slack.dev/reference/events/app_uninstalled); [auth.revoke method](https://docs.slack.dev/reference/methods/auth.revoke.md)
- QuickBooks Online — [Fix bank connection errors](https://quickbooks.intuit.com/learn-support/en-uk/help-article/bank-feeds/open-banking-connection-errors-quickbooks-online/L39sZN1lJ_GB_en_GB); [How bank connectivity works](https://quickbooks.intuit.com/community/getting-the-most-out-of-quickbooks-11/how-does-bank-connectivity-work-in-quickbooks-a-complete-guide-to-direct-connect-open-banking-and-webconnect-375878); [Fix bank error 390/1000](https://quickbooks.intuit.com/learn-support/en-us/help-article/banking/fix-bank-error-390-1000-quickbooks-online/L8t6KpfdI_US_en_US)
- Xero — [Fix issues with your bank connection](https://central.xero.com/0/article/Fix-issues-when-connecting-your-bank-to-Xero-NZ-AU-US-CA-SG-SA)
- Finary — [Update a synchronized account](https://help.finary.com/en/articles/6519325-update-a-synchronized-account)
- Superhuman — [Managing Accounts](https://help.superhuman.com/hc/en-us/articles/46005777934733-Managing-Accounts); [Troubleshooting login issues](https://help.superhuman.com/hc/en-us/articles/44999410406029-Troubleshooting-Login-Issues) (used only to confirm no distinct mobile-vs-web alerting pattern is documented; not a strong case study on its own)
- Nielsen Norman Group — [Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/)
- Baymard — [What is a Banner UI Element?](https://baymard.com/learn/banner-ui)
- LogicLeap — [Integrations That Actually Stick](https://www.logic-leap.co.uk/blog/integrations-that-actually-stick)
- AppMaster — [Integration status page: show sync health and next steps](https://appmaster.io/blog/integration-status-page-sync-health)
- SashiDo — [Stop messaging twice: coordinate push and email](https://www.sashido.io/en/blog/push-notification-email-cross-channel-journeys)
- Suprsend — [Push notification vs email: when to use each](https://www.suprsend.com/post/push-notification-vs-email)
- Dusko Licanin — [SaaS notification system architecture](https://www.duskolicanin.com/blog/saas-notification-system-in-app-email-push-2026)

## What this research did not cover

- No source was found that is a direct, named case study of a **restaurant** or
 hospitality-vertical SaaS product's revoked-mail-access handling; the SMB
 back-office analogs (QuickBooks/Xero bank feeds) are the closest proxy, not
 an exact match.
- Superhuman/Front were the two email-integration-tool targets named in the
 task brief; only Superhuman's help center surfaced usable detail, and even
 that documents *how to fix* a disconnected account, not the alerting
 channel/urgency choice — it is cited above for completeness, but carries the
 least evidential weight of the case studies in this document.
- This is desk research (WebSearch/WebFetch against public docs, help
 centers, and blogs on 2026-09-22); no interviews, no access to any vendor's
 internal support-ticket data. Where "documented rationale" is claimed above,
 it is the vendor's own published explanation, not independently audited.
