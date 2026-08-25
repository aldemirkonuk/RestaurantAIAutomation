#!/usr/bin/env python3
"""CI gate: the guest merge policy must never merge two known-different people.

The direct analogue of scripts/eval_merge_policies.py, and it exists for the
same reason that one does. What makes the beverage identity key trustworthy is
not its construction -- it is that it was falsified against 732,874 pairs that
were known-distinct for free ("two entries on one menu are different
products"), a test that killed three earlier designs including a fuzzy
threshold that committed 212 false merges. Register A6 records what happens
without that: a policy self-graded against probes its own author imagined.

The guest equivalent of the free negative label is co-presence:

    two guests linked to the SAME CHECK are different people

That falls out of guest_check_links with no extra storage -- every check with
n>=2 links emits C(n,2) negative pairs -- and it grows with every service.
`guest_copresence_negatives` is the view.

WHY THE GATE SHIPS BEFORE THE DATA
It reports zero pairs today, because guest capture has not started. That is
deliberate and is the whole point: a gate added after the data is a gate
written by someone who already knows what the data looks like. This one was
written before anyone could tune it.

WHY THE PASS CONDITION IS ZERO AND NOT "LOW"
arch §3.9 prices a false bottle merge at roughly 100:1 against a false split.
The guest ratio is not merely larger, it is a different quantity: a false
bottle merge is a data-quality error with a bounded monetary cost, whereas a
false guest merge is a DISCLOSURE -- one person's dining history, spend,
allergies and companions become readable as another's. No un-merge reverses a
disclosure. So there is no acceptable non-zero count, and no threshold policy
is admissible at all.

    python3 scripts/eval_guest_merge_policies.py

Exit 0 = gate passed. Exit 1 = a policy defect; do not merge the branch.
"""
from __future__ import annotations

import os
import pathlib
import sys

import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent.parent


def dsn() -> str:
    d = os.environ.get("SUPABASE_DB_URL")
    if d:
        return d
    return next(
        line.split("=", 1)[1].strip()
        for line in (ROOT / ".env").read_text().splitlines()
        if line.startswith("SUPABASE_DB_URL=")
    )


def main() -> int:
    conn = psycopg2.connect(dsn())
    conn.autocommit = True
    cur = conn.cursor()

    failures: list[str] = []

    cur.execute("SELECT count(*) FROM public.guest_copresence_negatives")
    negatives = cur.fetchone()[0]

    # ---------------------------------------------------------------- 1
    # THE false merge that is actually representable: a supersede.
    #
    # Note what is NOT checked here, and why. The obvious formulation --
    # "two guests share a merge-eligible identifier" -- cannot happen at all:
    # uq_guest_identifiers_channel is unique on
    # (restaurant_id, channel_type, channel_hash), so one channel belongs to
    # at most one guest per restaurant, and guest_link_identifier()'s
    # ON CONFLICT DO NOTHING means a second claimant silently gets nothing
    # rather than a shared key. That is a false SPLIT, which is the correct
    # direction to fail, and it is enforced by the index rather than detected
    # by this script. (Two people genuinely sharing one phone therefore stay
    # two guests. Correct.)
    #
    # What remains representable is the operation that collapses two guest
    # ROWS: superseded_by. That is where a disclosure would actually come
    # from, so that is what this gate guards.
    cur.execute("""
        SELECT n.restaurant_id, n.guest_a, n.guest_b, n.shared_checks
        FROM public.guest_copresence_negatives n
        JOIN public.guests ga ON ga.id = n.guest_a
        JOIN public.guests gb ON gb.id = n.guest_b
        WHERE ga.superseded_by = gb.id
           OR gb.superseded_by = ga.id
    """)
    false_merges = cur.fetchall()

    if false_merges:
        failures.append(
            f"{len(false_merges)} pair(s) of guests proven different by "
            f"co-presence have been merged via superseded_by")
        for r in false_merges[:20]:
            failures.append(
                f"    restaurant={r[0]} {r[1]} <-> {r[2]} "
                f"({r[3]} shared check(s))")

    # Transitive form: A superseded into B, B into C, where A and C co-occurred.
    cur.execute("""
        WITH RECURSIVE chain(root, node) AS (
          SELECT id, superseded_by FROM public.guests WHERE superseded_by IS NOT NULL
          UNION
          SELECT c.root, g.superseded_by
          FROM chain c JOIN public.guests g ON g.id = c.node
          WHERE g.superseded_by IS NOT NULL
        )
        SELECT count(*) FROM public.guest_copresence_negatives n
        JOIN chain ca ON ca.root = n.guest_a
        JOIN chain cb ON cb.root = n.guest_b
        WHERE ca.node = cb.node
    """)
    if (n := cur.fetchone()[0]):
        failures.append(
            f"{n} co-present pair(s) resolve to the same guest through a "
            f"supersede CHAIN. A merge that is safe pairwise can still be "
            f"transitively wrong.")

    # ---------------------------------------------------------------- 2
    # Structural invariants that make the policy safe in the first place.
    # These hold with zero data and would be the first things to rot.
    cur.execute("""
        SELECT count(*) FROM public.guest_identifiers
        WHERE is_merge_eligible AND channel_type = 'card_fingerprint'
    """)
    if (n := cur.fetchone()[0]):
        failures.append(
            f"{n} card_fingerprint identifier(s) are merge-eligible. A card "
            f"identifies a HOUSEHOLD OR COMPANY, not a person -- a joint card "
            f"merges a marriage into one guest. It must stay quarantined as "
            f"identity_status='shared_instrument'.")

    cur.execute("""
        SELECT count(*) FROM public.guest_identifiers
        WHERE is_merge_eligible AND verified_at IS NULL
    """)
    if (n := cur.fetchone()[0]):
        failures.append(
            f"{n} unverified identifier(s) are merge-eligible. Unverified is "
            f"where 'one booker, twelve executives' lives.")

    cur.execute("""
        SELECT count(*) FROM public.guest_identifiers
        WHERE canonicaliser_version <> public.guest_canonicaliser_version()
    """)
    if (n := cur.fetchone()[0]):
        failures.append(
            f"{n} identifier(s) were hashed by a superseded canonicaliser. "
            f"Bumping guest_canonicaliser_version() requires a migration that "
            f"re-derives every hash -- otherwise two spellings of the same "
            f"channel stop matching and the same person silently splits.")

    # A guest and its identifiers must never straddle two restaurants: the
    # per-restaurant pepper makes a cross-restaurant hash match impossible,
    # but a mis-scoped row would still leak through the RLS predicate.
    cur.execute("""
        SELECT count(*) FROM public.guest_identifiers i
        JOIN public.guests g ON g.id = i.guest_id
        WHERE g.restaurant_id <> i.restaurant_id
    """)
    if (n := cur.fetchone()[0]):
        failures.append(f"{n} identifier(s) scoped to a different restaurant "
                        f"than their guest.")

    cur.execute("""
        SELECT count(*) FROM public.guest_identifiers i
        JOIN public.guests g ON g.id = i.guest_id
        WHERE g.erased_at IS NOT NULL
    """)
    if (n := cur.fetchone()[0]):
        failures.append(
            f"{n} identifier(s) survive on an ERASED guest. Erasure hard-"
            f"deletes identifiers; a tombstone that still holds a contact "
            f"hash is a deletion that did not happen.")

    if failures:
        print("GATE FAILED:\n")
        for f in failures:
            print(f"  {f}")
        print(f"\nChecked {negatives:,} known-different pair(s).")
        return 1

    print(f"GATE PASSED — 0 false merges across {negatives:,} known-different "
          f"pair(s) (co-presence), and all structural invariants hold.")
    if negatives == 0:
        print("\nNote: 0 negative pairs because guest capture has not started. "
              "The gate ships before the data on purpose — see register A6 for "
              "what happens when it does not.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
