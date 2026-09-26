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
  - `public`: fetched, but only public data leaves, and the sentence says what is sent;
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

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | W2-fix-terms-guard lane (builder) | Created with the guard. Measured: 191 hosts and 74 packages, 30 named, 170 excused. Mutation-tested on a tree copy: a removed row fails (Expo, Stripe, SDK-only CloudAMQP), a new host literal fails, a new SDK fails, a comment-only host passes, a missing list exits 2. `--self-test` covers 14 cases. |
