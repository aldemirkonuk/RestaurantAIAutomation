#!/usr/bin/env python3
"""Every Postgres function the Mail read path creates is callable by the service role only.

WHY: the /mail reads take the house from the verified token and pass it to
these functions as an argument. A function the browser's own key (anon or
authenticated) could call would let a caller name any house. CREATE FUNCTION
grants EXECUTE to PUBLIC by default, so a function added in a later migration
without its own REVOKE is a tenancy hole. MAIL-READ-FUNCTIONS-SERVICE-ROLE-ONLY
used to read one migration's text; the Mail list has since been re-created by
six more, and a new overload (a changed argument list) is a new function.

The check is static. For every function whose name holds 'mail' or starts
with 'house_inbox' (the mailbox reader's lease, r109: its name holds no 'mail',
so this check passed without reading it) created in a migration at or after
the Mail list's first (20270421143700): its latest argument-type list must be
revoked from each of PUBLIC, anon and authenticated (in one REVOKE or several)
and named by a GRANT ... TO service_role in that migration or a later one; no
SECURITY DEFINER; no GRANT to anon, authenticated or PUBLIC.

Prints PASS -- or FAIL -- and exits 0 or 1. Reads only supabase/migrations/.
Pass a directory to check a copy. `--self-test` copies the migrations, breaks
the mailbox lease five ways and asserts each copy FAILs.
"""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

FIRST = "20270421143700"
ROLES = {"public", "anon", "authenticated"}
LEASE_SLUG = "_check_now_reads_the_house_mailbox_once_a_minute_at_most.sql"  # by slug: versions change at merge
SIG = "public.house_inbox_claim_read(UUID, UUID, INTEGER, INTEGER)"


def self_test():
    breaks = {
        "PUBLIC revoke dropped": (f"REVOKE ALL ON FUNCTION {SIG} FROM PUBLIC;", ""),
        "anon, authenticated revoke dropped": (f"REVOKE ALL ON FUNCTION {SIG} FROM anon, authenticated;", ""),
        "service_role grant dropped": (f"GRANT EXECUTE ON FUNCTION {SIG} TO service_role;", ""),
        "also granted to authenticated": (f"{SIG} TO service_role;", f"{SIG} TO service_role, authenticated;"),
        "made SECURITY DEFINER": ("SECURITY INVOKER\nSET search_path = public, pg_temp", "SECURITY DEFINER\nSET search_path = public, pg_temp"),
    }
    run = lambda d: subprocess.run([sys.executable, __file__, d], capture_output=True, text=True).stdout
    bad = [] if run("supabase/migrations").startswith("PASS -- ") else ["the real migrations do not PASS"]
    for label, (a, b) in breaks.items():
        d = tempfile.mkdtemp()
        try:
            for f in glob.glob("supabase/migrations/*.sql"):
                shutil.copy(f, d)
            found = glob.glob(os.path.join(d, "*" + LEASE_SLUG))
            if len(found) != 1:
                bad.append(f"{label}: no single migration ends in {LEASE_SLUG}")
                continue
            q = found[0]
            s = open(q).read()
            if s.count(a) != 1:
                bad.append(f"{label}: the line to break is not in {os.path.basename(q)} exactly once")
                continue
            open(q, "w").write(s.replace(a, b))
            if not run(d).startswith("FAIL -- "):
                bad.append(f"{label}: still PASSes")
        finally:
            shutil.rmtree(d)
    print(("SELF-TEST FAIL -- " + "; ".join(bad)) if bad else f"SELF-TEST PASS -- {len(breaks)} broken copies of the mailbox lease each FAIL")
    sys.exit(1 if bad else 0)


if "--self-test" in sys.argv:
    self_test()
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
revoked = {}  # (name, sig) -> the roles revoked so far
granted = {}
problems = []
renamed = {}
for f in files:
    v = os.path.basename(f)[:14]
    t = strip(open(f).read())
    for m in re.finditer(r"CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.(\w*mail\w*|house_inbox\w*)\s*\((.*?)\)\s*RETURNS\s+(\w+)", t, re.S | re.I):
        if m.group(3).lower() == "trigger":
            continue  # a trigger function is not callable as a query; it needs no grant
        if "SECURITY DEFINER" in t[m.end(): m.end() + 1500].split("$$")[0].upper():
            problems.append(f"{v}: {m.group(1)} is SECURITY DEFINER")
        created[(m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ())] = v
    for m in re.finditer(r"DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?\s+public\.(\w+)\s*\(([^)]*)\)", t, re.I):
        created.pop((m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ()), None)
    for m in re.finditer(r"ALTER\s+FUNCTION\s+public\.(\w+)\s*\(([^)]*)\)\s*RENAME\s+TO\s+(\w+)", t, re.I):
        key = (m.group(1).lower(), types(m.group(2)) if m.group(2).strip() else ())
        if key in created:
            # a rename keeps the grants it had; it is the same function under a new name
            created[(m.group(3).lower(), key[1])] = created.pop(key)
            for d in (revoked, granted):
                if key in d:
                    d[(m.group(3).lower(), key[1])] = d.pop(key)
    for m in re.finditer(r"REVOKE\s+ALL\s+ON\s+FUNCTION\s+(.*?)\s+FROM\s+([^;]*);", t, re.S | re.I):
        who = set(re.findall(r"\w+", m.group(2).lower())) & ROLES
        for k in sig_list(m.group(1)):
            revoked.setdefault(k, set()).update(who)
    for m in re.finditer(r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(.*?)\s+TO\s+([^;]*);", t, re.S | re.I):
        who = m.group(2).lower()
        if re.search(r"\b(anon|authenticated|public)\b", who):
            problems.append(f"{v}: EXECUTE granted to {who.strip()}")
        elif "service_role" in who:
            for k in sig_list(m.group(1)):
                granted[k] = v

for k, v in sorted(created.items()):
    if not ROLES <= revoked.get(k, set()):
        problems.append(f"{k[0]}({', '.join(k[1])}) created in {v} and never revoked from PUBLIC, anon, authenticated")
    if k not in granted:
        problems.append(f"{k[0]}({', '.join(k[1])}) created in {v} and never granted to service_role")

if len(created) < 9:
    problems.append(f"only {len(created)} mail functions found; the check is not reading what it says")
if not any(k[0] == "house_inbox_claim_read" for k in created):
    problems.append("house_inbox_claim_read not found; the check is not reading the mailbox lease")
if problems:
    print("FAIL -- " + "; ".join(problems))
    sys.exit(1)
print(f"PASS -- {len(created)} Mail functions, each revoked from PUBLIC, anon, authenticated and granted to service_role only")
