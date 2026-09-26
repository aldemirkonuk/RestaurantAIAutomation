# 0224 — Every host the code can send to is named in the data terms, or excused in writing

- **Status:** Proposed — the guard exists on the founder's word of 2026-09-25 (*"complete the subprocessor list first"*); its rules below (what counts as a finding, the five excuse categories, the SDK table) are the builder's and wait for his review.
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** subprocessors, data terms, host literal, SDK, egress, guard, CLAIMS, EXTERNAL_CONNECTIONS
- **Links:** [[0207-a-vendor-is-scored-on-what-it-did-from-the-houses-own-records]] (round 5, question 19, the sign-in terms sheet), `.planning/foundation/EXTERNAL_CONNECTIONS.md` §2, `apps/api-gateway/src/settings/data-terms/house-data-terms.ts`, `scripts/check_data_terms_name_every_host.py`, PR #435

## Context

ADR 0207 round 5 puts the house's data terms in front of every owner at sign-in, and those terms list `SUBPROCESSORS` as "every place your data goes". The list was written from one round's research. A 2026-09-25 census found hosts it neither named nor excused, including `exp.host`, which receives each push notification's title and body (`apps/api-gateway/src/push/expo-push.service.ts:21`). The founder's answer on the merge fork was to complete the list first and add a check (web-rebuild round 4, item 15). A list held only by prose goes stale the day after it is written (CLAUDE.md §5b).

## Options considered

1. **Complete the list by hand, no check.** Cheap, but it is the state that had just failed. The next new host goes unnamed without anyone noticing.
2. **Host literals only.** This catches `exp.host` and the rest, but not an SDK that sends to a host no source line spells out: Sentry from a DSN, Supabase from `SUPABASE_URL`, RabbitMQ and Redis from env, `web-push` to the browser's own endpoint. Those are some of the largest flows.
3. **Host literals + imported SDKs + both directions (chosen).** Every host in code is named or excused. Every imported third-party package is classified. No name goes unbacked, and no excuse excuses nothing.
4. **Runtime egress logging.** This sees real traffic, but only after the data has already left, and only in environments where it runs. It could complement a pre-merge check but cannot replace one.

## Decision

`scripts/check_data_terms_name_every_host.py` blocks the build (through CLAIMS `ADR-0224-EVERY-HOST-NAMED-OR-EXCUSED`, since the claims runner is inside `CI Complete`'s `needs`) unless:

- every URL host and bare-hostname string literal in non-test code under `apps/api-gateway/src` and `services/` (comments and Python docstrings stripped) is **named** by a `SUBPROCESSORS` host (itself or a parent domain), or **excused** under one of five categories, each with a sentence:
  - `own`: our domains;
  - `local`: loopback or a placeholder that is never requested;
  - `reference`: a citation carried as data and never fetched;
  - `public`: fetched, and what leaves is independent of every house's records and not timed by them (a fixed series key, a fixed city or shop page chosen by us), and the sentence says what is sent. [Narrowed 2026-09-25, see the amendment below: a name, place or wine taken from, or typed for, a house's list is house data even when each word is public.]
  - `nothost`: shaped like a host but not one;
- every imported third-party package is classified as the subprocessor host(s) it sends to, or `LOCAL` with a reason;
- every `SUBPROCESSORS` host is reached by a finding or listed in `NAMED_WITHOUT_CODE` (hosting: Railway, Vercel), and every excuse and package row still matches something.

It exits 2 when the terms list, the scan, or the Python standard-library list cannot be read. A row in `SUBPROCESSORS` may name several hosts, comma-separated.

The reasoning that carried it: an excuse is a claim that no house data reaches a host, so each one has to be a sentence somebody wrote and a reviewer can reject. A missing classification fails. It never passes quietly.

## Consequences

- Adding an outbound host or an SDK now requires one of two edits: a new row in the owner-facing terms, or a written excuse. The pull request diff shows which.
- The first run completed the list from 11 rows to 24 (30 hosts). The pre-fix list gives 38 findings.
- It also found a real egress to a third-party domain: the orchestrator's Plivo callbacks defaulted to `https://your-domain.com`. That egress was removed, not excused.
- Given up / not caught:
  - hosts built at run time, or read from env or database rows with no literal and no SDK (a vendor's own page goes through the SSRF guard);
  - whether a `reference` link is truly never fetched, or a `public` fetch truly carries nothing of a house. Both rest on the written sentence and on review;
  - `apps/web` and `apps/mobile`;
  - tests.
- Revisit when:
  - a host is found receiving house data while excused (the category rules failed);
  - a new runtime is added outside the two scanned roots;
  - the terms move to a per-host data model (the comma-separated `host` field is then replaced).

## Amendment, 2026-09-25 — `public` narrowed: a name from a house's list is house data

**The founder's word** (web-rebuild item 33, asked again with the public-names research): *"if they accept terms and conditions then yes, we can access their menu and so on"*. A look-up built from a house's list — a wine's producer, name and vintage, a restaurant's name and city — is the house's data, allowed once an owner has accepted terms that name where it goes.

**What changed.**
- The guard's two `public` groups for look-up services are deleted, and each host is now a `SUBPROCESSORS` row: Google Maps Platform (`maps.googleapis.com`, `places.googleapis.com`), Apify, Yelp, Vivino, OpenTable, Wine-Searcher, CellarTracker. Serper was already named; its row now says what it really receives (a wine's producer, name and vintage) and when.
- The guard's `LOOKUP_DOMAINS` makes the narrowing mechanical: a host equal to or under one of those services (and `serper.dev`) may be named, or excused only as `reference` (a string matched, never fetched). Any other category fails the build. Four self-test cases cover it (look-up host as `public` fails, subdomain as `public` fails, named passes, bare domain as `reference` passes).
- The two house-triggered Serper paths now run only once an owner has accepted terms naming Serper: web verification after a menu upload (`jobs/web_verify_tasks.py:312`) and the research agent (`jobs/research_tasks.py:1504`), through `services/house_data_terms_gate.py`. The gate reads the house's latest acceptance snapshot, so the orchestrator never has to know the gateway's `TERMS_VERSION`; it fails closed on an unreadable store; a row with no house passes as `no_house`.

**Rejected.**
- *Keep the `public` excuse and tighten its sentence only.* Serper was already named for the same kind of query, so excusing the identical query when it went straight to Wine-Searcher was the inconsistency; a sentence cannot stop the next excuse.
- *Delete the scrapers and adapters instead of naming them.* The founder kept them: *"if we can use it for now, then keep it, until all legal part starts, this way we'll improve way faster"*. Their licence risk is recorded as accepted in `v3.0-TECH-DEBT.md` (2026-09-25).
- *Gate on the current terms version, like the Jev switch.* Needs the orchestrator to carry the gateway's version constant, which drifts; the accepted snapshot already says whether the owner agreed to the host.
- *The house-blind catalogue service* (one licence-aware global cache per identity, cover traffic): researched, NOT ordered now.

**Not caught / not gated (named).**
- The nightly `score.rescore_stale_wines` (`jobs/celery_app.py:120`) searches library wines on Serper, house-blind; the library can include promoted house wines. Named in the terms' statement; not gated.
- The catalogue tools (image collector, discovery, `wine_research_service`) have no live caller and no house id to gate on; named, not gated.
- `scripts/backfill_restaurant_coordinates.py:52` sends the house's own place id to `places.googleapis.com`; `scripts/` is outside the scan roots, but the host is now named.
- URLs taken from search results and fetched by the research agent are built at run time and stay outside the scan.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | W2-fix-terms-guard lane (builder) | Created with the guard. Measured: 191 hosts and 74 packages, 30 named, 170 excused. Mutation-tested on a tree copy: a removed row fails (Expo, Stripe, SDK-only CloudAMQP), a new host literal fails, a new SDK fails, a comment-only host passes, a missing list exits 2. `--self-test` covers 14 cases. |
| 2026-09-25 | W3-terms-hosts lane (builder) | `public` narrowed on the founder's item 33. Re-measured: 191 hosts and 74 packages; 38 hosts named in 31 rows; 162 excused. Mutation-tested on the real tree: dropping the Wine-Searcher or Serper row fails; re-excusing Google Maps as `public` fails (2 findings) and passes only when `LOOKUP_EXCUSABLE` is widened to admit `public`, so the rule is load-bearing. `--self-test` covers 18 cases. The two Serper gates were mutated off and the withheld-path tests failed. |
