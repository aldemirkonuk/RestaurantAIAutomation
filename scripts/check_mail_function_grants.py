#!/usr/bin/env python3
"""Every Postgres function the Mail read path creates is callable by the service role only.

WHY: the /mail reads take the house from the verified token and pass it to
these functions as an argument. A function the browser's own key (anon or
authenticated) could call would let a caller name any house. CREATE FUNCTION
grants EXECUTE to PUBLIC by default, so a function added in a later migration
without its own REVOKE is a tenancy hole. MAIL-READ-FUNCTIONS-SERVICE-ROLE-ONLY
used to read one migration's text; the Mail list has since been re-created by
six more, and a new overload (a changed argument list) is a new function.

The check is static. For every function whose name holds 'mail' created in a
migration at or after the Mail list's first (20270421143700): its latest
argument-type list must be named by a REVOKE ... FROM PUBLIC, anon,
authenticated and by a GRANT ... TO service_role in that migration or a later
one; no SECURITY DEFINER; no GRANT to anon, authenticated or PUBLIC.

Prints PASS -- or FAIL -- and exits 0 or 1. Reads only supabase/migrations/.
Pass a directory to check a copy (the mutation test does).
"""
import glob
import os
import re
import sys

FIRST = "20270421143700"
root = sys.argv[1] if len(sys.argv) > 1 else "supabase/migrations"


def strip(t):
    return re.sub(r"--[^\n]*", "", t)


def types(args):
    # A CREATE names each argument (`p_house uuid DEFAULT NULL`); a GRANT or DROP
    # lists bare types. Both come out as the same tuple of lowercase types.
    out = []
    for p in re.split(r",\s*(?=p_\w+\s)" if re.search(r"\bp_\w+\s", args) else r",", re.sub(r"\s+", " ", args).strip()):
        p = re.sub(r"\s+DEFAULT\b.*$", "", p.strip(), flags=re.I)
        p = re.sub(r"^(?:IN\s+)?p_\w+\s+", "", p, flags=re.I)
        out.append(p.strip().lower())
    return tuple(out)


def sig_list(blob):
    # `public.a(uuid, boolean), public.b(text)` -> [(a, (uuid, boolean)), ...]
    return [
        (m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ())
        for m in re.finditer(r"public\.(\w+)\s*\(([^)]*)\)", blob)
    ]


files = sorted(f for f in glob.glob(os.path.join(root, "*.sql")) if os.path.basename(f)[:14] >= FIRST)
if not files:
    print("FAIL -- no migrations found to check")
    sys.exit(1)

created = {}  # (name, sig) -> migration that last created it
revoked = {}  # (name, sig) -> migration
granted = {}
problems = []
for f in files:
    v = os.path.basename(f)[:14]
    t = strip(open(f).read())
    # Events run in the order they stand in the file. Postgres runs a migration
    # top to bottom, and `DROP FUNCTION x; CREATE FUNCTION x` is the pattern that
    # resets the function's ACL to the default (EXECUTE for PUBLIC and for
    # Supabase's anon and authenticated roles): the REVOKE and GRANT an EARLIER
    # migration made died with the old function. Walking one statement kind at a
    # time (all CREATEs, then all DROPs) popped a function that the same file
    # re-created, and let the new one go unchecked.
    events = []
    for m in re.finditer(r"CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.(\w*mail\w*)\s*\((.*?)\)\s*RETURNS\s+(\w+)", t, re.S | re.I):
        events.append((m.start(), "create", m))
    for m in re.finditer(r"DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?\s+public\.(\w+)\s*\(([^)]*)\)", t, re.I):
        events.append((m.start(), "drop", m))
    for m in re.finditer(r"ALTER\s+FUNCTION\s+public\.(\w+)\s*\(([^)]*)\)\s*RENAME\s+TO\s+(\w+)", t, re.I):
        events.append((m.start(), "rename", m))
    for m in re.finditer(r"REVOKE\s+ALL\s+ON\s+FUNCTION\s+(.*?)\s+FROM\s+([^;]*);", t, re.S | re.I):
        events.append((m.start(), "revoke", m))
    for m in re.finditer(r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(.*?)\s+TO\s+([^;]*);", t, re.S | re.I):
        events.append((m.start(), "grant", m))
    for _, kind, m in sorted(events, key=lambda e: e[0]):
        if kind == "create":
            if m.group(3).lower() == "trigger":
                continue  # a trigger function is not callable as a query; it needs no grant
            if "SECURITY DEFINER" in t[m.end(): m.end() + 1500].split("$$")[0].upper():
                problems.append(f"{v}: {m.group(1)} is SECURITY DEFINER")
            created[(m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ())] = v
        elif kind == "drop":
            key = (m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ())
            # the function and the ACL it carried are gone; a re-CREATE starts from the default
            for d in (created, revoked, granted):
                d.pop(key, None)
        elif kind == "rename":
            key = (m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ())
            if key in created:
                # a rename keeps the grants it had; it is the same function under a new name
                created[(m.group(3).lower(), key[1])] = created.pop(key)
                for d in (revoked, granted):
                    if key in d:
                        d[(m.group(3).lower(), key[1])] = d.pop(key)
        elif kind == "revoke":
            who = m.group(2).lower()
            if all(w in who for w in ("public", "anon", "authenticated")):
                for k in sig_list(m.group(1)):
                    revoked[k] = v
        else:
            who = m.group(2).lower()
            if re.search(r"\b(anon|authenticated|public)\b", who):
                problems.append(f"{v}: EXECUTE granted to {who.strip()}")
            elif "service_role" in who:
                for k in sig_list(m.group(1)):
                    granted[k] = v

for k, v in sorted(created.items()):
    if k not in revoked:
        problems.append(f"{k[0]}({', '.join(k[1])}) created in {v} and never revoked from PUBLIC, anon, authenticated")
    if k not in granted:
        problems.append(f"{k[0]}({', '.join(k[1])}) created in {v} and never granted to service_role")

if len(created) < 9:
    problems.append(f"only {len(created)} mail functions found; the check is not reading what it says")
if problems:
    print("FAIL -- " + "; ".join(problems))
    sys.exit(1)
print(f"PASS -- {len(created)} Mail functions, each revoked from PUBLIC, anon, authenticated and granted to service_role only")
