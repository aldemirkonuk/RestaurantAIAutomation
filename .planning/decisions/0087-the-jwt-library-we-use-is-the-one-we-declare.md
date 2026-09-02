# 0087 — The JWT library we use is the one we declare

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** python-jose, PyJWT, CVE-2024-33663, CVE-2025-61152, ecdsa, undeclared dependency, transitive, requirements.prod.txt, agent-orchestrator, absence reported as health
- **Links:** [[0074-a-read-names-columns-that-exist]], [[0085-a-fixture-tests-the-guard-not-the-checkout]], OD-56 (the Dependabot backlog row that lists `python-jose ×2` among the criticals)

## Context

`services/agent-orchestrator` pinned `python-jose[cryptography]==3.3.0` in **both**
`requirements.txt:124` and `requirements.prod.txt:45` — the second being the file
the `Dockerfile` installs. It carries **CVE-2024-33663** (critical, algorithm
confusion with OpenSSH ECDSA keys) and **CVE-2024-33664**, both fixed in 3.4.0.

The founder asked for a bump to 3.4.0, **conditional on it being a bulletproof
fix that raises no new issue**. It is not, and the condition is what surfaced
everything below.

**Nothing imports it.** `jose` appears in no Python source in this repository —
the only textual matches are "San Jose" and "Saint-Joseph", in a city list and a
wine-appellation list. There is no dynamic import of it either. It has been a
dead pin.

**What the code actually uses is PyJWT, and PyJWT was declared nowhere.**
`api/studio_routes.py:769` and `services/override_service.py:46` both
`import jwt as pyjwt` — the second with the comment `# PyJWT>=2.8.0`, so the
constraint was known and never written down. It arrived only transitively
through `supabase>=2.10.0`, an **unpinned range**. Both imports are lazy (inside
functions) and, unlike `core/observability.py`'s optional `opentelemetry` import,
**not guarded by `try/except ImportError`** — so a resolver shift that dropped or
majored PyJWT would surface as a **request-time 500 on studio auth**, not as a
boot failure. The real dependency was unpinned; the fake one was pinned to a
vulnerable version.

## Options considered

**A. Bump to 3.4.0, as asked.** Rejected on four counts, in ascending order of
how badly they undercut it:

1. **It is already superseded.** 3.5.0 shipped 2025-05-28; 3.4.0 on 2025-02-18.
   Landing on 3.4.0 means doing this again.
2. **A newer advisory exists that 3.4.0 cannot be cleared of.**
   `GHSA-28pv-f4g7-364j` (published 2025-10-10) reports `alg=none` tokens
   decoded and accepted without verification. It is **unreviewed**, its affected
   range reads "Unknown", and **no patched version is declared**. Its text says
   "through 3.3.0", but with no fixed version there is nothing to assert 3.4.0
   against. This is the repository's own recorded trap: *a patched version is
   only patched against the CVE you looked up* — bumping `cryptography` to
   49.0.0 once closed two advisories and landed inside a third already published.
3. **No version escapes `ecdsa`.** python-jose declares `ecdsa!=0.15` as a core
   dependency, and `ecdsa` carries `GHSA-wj6h-64fc-37mp`, which upstream has
   said it **does not plan to fix** (mpdavis/python-jose#341).
4. **It fixes nothing real.** With no importer, the CVE is not reachable from
   this codebase at all; the bump would only quiet a scanner.

**B. Remove it.** Deletes CVE-2024-33663, CVE-2024-33664, the unreviewed
`alg=none` advisory and the unfixable `ecdsa` transitive outright, at zero
functional cost.

**C. Remove it and pin PyJWT.** B, plus writing down the dependency the code
actually has. Chosen — B alone would leave the more dangerous half standing.

## Decision

**Remove `python-jose` from both requirements files, and pin `PyJWT>=2.8.0` in
both, with the reasoning recorded beside the pin so it is not silently
reintroduced.**

`>=2.8.0` rather than `==`: 2.8.0 is the floor the calling code already
documents, and pinning `==` against a library that `supabase` also resolves
invites a conflict the range avoids. The comment beside the pin names the two
importing files, so the next person to see an unused-looking JWT dependency can
check in one step rather than deleting it.

## Consequences

- **Four advisories leave the image**, including one critical, and none of them
  by trusting a version number.
- **The orchestrator's real JWT dependency is now declared**, so a `supabase`
  resolution change can no longer silently remove it.
- **`requirements.txt` and `requirements.prod.txt` stay in step.** Both carried
  the dead pin; both now carry the real one. Only `requirements.prod.txt` reaches
  the container, so fixing one and not the other would have been invisible.
- **The sibling sweep found nothing else.** Every third-party import in non-test
  orchestrator code was checked against both requirements files. Five candidates
  came back; four were not real — `google-genai`/`google-generativeai`,
  `python-json-logger` and `postgrest` are declared and differ only in
  distribution-vs-import name, and `surya-ocr` is deliberately absent from the
  production file (the `Dockerfile` excludes the ~2GB ML/OCR stack by design).
  The fifth, `opentelemetry`, is a **guarded** optional import with a no-op
  fallback. PyJWT was the only unguarded, undeclared production import.
- **No guard is added here, and that is a gap.** "Every third-party import in
  production code is declared" is exactly the shape that should be mechanical —
  it is the same class as [[0074-a-read-names-columns-that-exist]], one layer
  out. Writing it properly needs a distribution-name map (the four false
  positives above are precisely why), and that is its own piece of work rather
  than a rider on a security fix.

## Verification

| What | Result |
|---|---|
| `jose` referenced anywhere in Python source | **zero** — only "San Jose" and "Saint-Joseph" in data lists |
| `pip install -r requirements.prod.txt` in a clean venv (the file the Dockerfile installs) | **exit 0** |
| `import jwt` in that venv | **PyJWT 2.13.0**, HS256 encode→decode round-trip returns the payload |
| `jose` installed in that venv afterwards | **False** — nothing pulled it transitively, confirming it was a leaf |
| `ecdsa` installed afterwards | **False** — the won't-fix transitive is gone with it |
| `pip check` | **No broken requirements found** — removing it orphaned nothing |
| Every third-party import in non-test orchestrator code vs both requirements files | 1 real gap (PyJWT, fixed), 4 name-mapping artifacts, 1 deliberate prod exclusion, 1 guarded optional |
| All 46 script invocations extracted from `ci.yml` | every one exit 0 |

The one `pip` warning — a yanked `email-validator==2.1.0` — pre-dates this change
and is not touched by it. Reported rather than folded in.

## Consequences for the register

No `OPEN-DECISIONS.md` row ([[0025-citations-must-disagree-loudly]]). One
`CLAIMS.jsonl` entry, which asserts both halves: python-jose absent, PyJWT
present, in **both** files.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Founder | Asked for a 3.4.0 bump *if bulletproof*; on the evidence above, directed removal plus the PyJWT pin instead |
