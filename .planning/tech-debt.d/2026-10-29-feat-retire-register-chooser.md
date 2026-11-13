## A visitor with a dead stored session is sent from `/` to `/login` instead of seeing the landing — ~~OPEN~~ CLOSED on `fix/register-door-followups` — 2026-10-29

Filed by `feat/retire-register-chooser` (#699), seen on production right after #697 merged (27069116d), in the browser pane, which held an old session.

**What happens.** `RootDoor` (`apps/web/src/pages/landing/RootDoor.tsx`) shows the house loader while a stored session is read. `AuthContext` loads the user, the gateway answers 401, and the axios interceptor tries a refresh. When the refresh route refuses it with a 401, the interceptor clears both tokens and sets `window.location.href = '/login'` (`apps/web/src/services/api/client.ts:123`). So someone whose session has died sees `/login` ("Welcome back.") at `/`, never the landing. A stranger with nothing stored sees the landing, as verified on production the same day.

**Why it was not fixed on #699.** On every protected page, that redirect is the intended end of a session (ADR 0164), and for a returning person with an account, `/login` was arguably the right door. Changing it meant picking between keeping today's `/login`, or not navigating when the current path is a public page (`/`, `/register`, `/story`, `/privacy`, `/terms`) and letting `RootDoor` draw the landing. That choice was the founder's, so the entry recorded the behaviour until he picked.

**Re-check.** Store any expired `accessToken` plus a refused `refreshToken` on mudavym.com, then open `/`. Before the fix it ended on `/login`; after it, the page reloads and draws the landing, and stays there: the reloaded page holds no tokens, so nothing refreshes again.

**Closed.** The founder picked "Public pages stay put (Recommended)" on 2026-10-29. On a public page the refused refresh now clears the tokens and keeps the person there (`client.ts` and `authStore.ts` both call `leaveDeadSession` in `apps/web/src/lib/deadSession.ts`, which clears the tokens and the auth store's persisted copy and reloads the page so it boots with no session); private pages still go to `/login`. Recorded in ADR 0344.
