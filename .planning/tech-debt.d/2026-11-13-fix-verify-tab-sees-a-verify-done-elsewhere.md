# fix/verify-tab-sees-a-verify-done-elsewhere (r36 onboarding gaps 4 and 3, 2026-11-13)

An owner who signs up on the laptop and opens the verification link on the
phone left the laptop tab on "Check your email" for good: it never asked
again. After a reload `/auth/me` read the address as verified, so the code
box hid itself, nothing offered a way on, and "Resend verification email"
drew a 409 "already verified".

- A tab with no link whose session reads verified (after a reload, or a
  re-read) moves on by itself through the same finish as the link and the
  code: `signInWithSession` with the pair this tab already holds, the
  sign-up mail note cleared, then the router. A failed session read says so
  with "Try again", as the link does.
- While it waits (signed in, no link, not verified) the tab asks
  `/auth/me` again when it is focused or shown, and every 30 s while shown.
  A hidden tab does not ask; a failed read says nothing new.
- Where a verified house goes (`lib/afterVerifyIn.ts`): a current menu to
  the desk, a draft menu to /menu (it was sent to the desk as if done), no
  menu to /get-started; a gateway that names no current menu as before.

The session's call (2026-11-07 /goal): re-read on focus, visibility and a
slow 30 s poll, with only this tab's own stored session. Rejected: a
"Continue" button on the reloaded page (one more press for a page with
nothing else to do); a broadcast between tabs (the link is usually opened
on another device, which no tab channel reaches); a server push (no
channel exists for an unverified session).

Left open: not seen in a browser; the phone-then-laptop path needs a walk.
