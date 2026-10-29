## A visitor with a dead stored session is sent from `/` to `/login` instead of seeing the landing — OPEN — 2026-10-29

Filed by `feat/retire-register-chooser` (#699), seen on production right after #697 merged (27069116d), in the browser pane, which held an old session.

**What happens.** `RootDoor` (`apps/web/src/pages/landing/RootDoor.tsx`) shows the house loader while a stored session is read. `AuthContext` loads the user, the gateway answers 401, and the axios interceptor tries a refresh. When the refresh route refuses it with a 401, the interceptor clears both tokens and sets `window.location.href = '/login'` (`apps/web/src/services/api/client.ts:123`). So someone whose session has died sees `/login` ("Welcome back.") at `/`, never the landing. A stranger with nothing stored sees the landing, as verified on production the same day.

**Why it is not fixed here.** On every protected page, that redirect is the intended end of a session (ADR 0164), and for a returning person with an account, `/login` is arguably the right door. Changing it means picking between keeping today's `/login`, or not navigating when the current path is a public page (`/`, `/register`, `/story`, `/privacy`) and letting `RootDoor` draw the landing. That choice is the founder's, so this entry only records the behaviour.

**Re-check.** Store any expired `accessToken` plus a refused `refreshToken` on mudavym.com, then open `/`. Today it ends on `/login`.
