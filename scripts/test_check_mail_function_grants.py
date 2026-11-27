#!/usr/bin/env python3
"""Mutation test for check_mail_function_grants.py: the check must FAIL on a Mail function
whose grants did not survive a DROP and re-CREATE (Postgres resets the ACL to the default,
EXECUTE for PUBLIC, anon and authenticated), and PASS on the real migrations.

Run: python3 scripts/test_check_mail_function_grants.py
"""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = os.path.join(HERE, "check_mail_function_grants.py")
MIGRATIONS = os.path.join(HERE, "..", "supabase", "migrations")
RECREATE = "20271206100000"  # DROPs and re-CREATEs mail_other_rows(uuid, boolean, text, text)


def run(directory):
    p = subprocess.run([sys.executable, CHECK, directory], capture_output=True, text=True)
    return p.returncode, p.stdout.strip()


def copy_tree(dst):
    for f in glob.glob(os.path.join(MIGRATIONS, "*.sql")):
        if os.path.basename(f)[:14] >= "20270421143700":
            shutil.copy(f, dst)


failures = []
with tempfile.TemporaryDirectory() as tmp:
    copy_tree(tmp)
    code, out = run(tmp)
    if code != 0 or not out.startswith("PASS -- "):
        failures.append(f"real migrations should PASS, got rc={code}: {out[:200]}")

    # mutant 1: the re-created function is dropped from the REVOKE list
    # mutant 2: ... and from the GRANT list
    for label, pattern in (
        ("REVOKE", r"(REVOKE ALL ON FUNCTION )public\.mail_other_rows\(uuid, boolean, text, text\),\s*"),
        ("GRANT", r"(GRANT EXECUTE ON FUNCTION )public\.mail_other_rows\(uuid, boolean, text, text\),\s*"),
    ):
        with tempfile.TemporaryDirectory() as mut:
            copy_tree(mut)
            (path,) = glob.glob(os.path.join(mut, RECREATE + "_*.sql"))
            text = open(path).read()
            mutated = re.sub(pattern, r"\1", text)
            if mutated == text:
                failures.append(f"{label} mutant changed nothing; the test is not testing")
                continue
            open(path, "w").write(mutated)
            code, out = run(mut)
            if code == 0 or "mail_other_rows" not in out:
                failures.append(f"a re-created function missing from the {label} must FAIL naming it, got rc={code}: {out[:200]}")

if failures:
    print("FAIL -- " + "; ".join(failures))
    sys.exit(1)
print("PASS -- the check fails a DROP-and-re-CREATE with no REVOKE, and with no GRANT, and passes the real migrations")
