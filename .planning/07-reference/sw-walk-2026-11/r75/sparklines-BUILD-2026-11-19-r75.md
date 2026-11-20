# r75 sparklines build (2026-11-19)
PR: #1891 (draft), branch feat/r73-c3-p2-spark-timing, head 2791aebc7 (f91c30081 fix + test typing).
Finding: source and the built CSS already carried cubic-bezier(.16,1,.3,1) and the 40 ms delay; a static Chromium fixture of the old CSS also computed correctly, so the walk's "ease / delay 0" could not be reproduced. Made it robust anyway: longhands, no var() in the `animation:` shorthand, dot on the house ease. Second series absent in the walk seed (no week data), not a code fault.
Tests: vitest src/pages/reports 20 files 348 passed; tsc --noEmit clean; vite build ok, dist/assets 7,715,616 -> 7,715,804 bytes (+188).
Mutation: timing-function ease and delay 0ms each fail the timing test.
Browser checks owed: with week data, /reports: .rp-spark__line computed timing-function cubic-bezier(0.16,1,0.3,1), delays 0s/0.04s, dots 0.52s/0.56s; reduced motion shows figures whole; .rp-skel::after 1.4s ease-in-out.
Left: no live browser walk (forbidden this round); root cause of the walk's "ease" not reproduced.
