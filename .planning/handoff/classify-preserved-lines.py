#!/usr/bin/env python3
"""Second pass over wip/preserve-<stamp>/* snapshots: for every file whose content is not
on origin/main (classify-preserved.sh's UNIQUE), measure how much of what that tree ADDED
(the + lines of base->snapshot, ignoring blank and trivially short lines) already appears
in main's current copy of the file. And for every snapshot whose base commit is not on
main, count the base's commits that no origin branch other than wip/preserve-* holds —
committed-but-unpushed work that exists only because the snapshot pushed it.

Read-only. Usage: python3 classify-preserved-lines.py <stamp> > out.json
Buckets per file: LANDED (>=95% of added lines on main), PARTIAL (50-95%), NEW (<50%),
GONE (path absent on main), DELETED-ON-TREE. The numbers are evidence for a judgement,
never a judgement: a LANDED file can still carry a meaningful one-line change.
"""
import json, subprocess, sys

def git(*a, check=True):
    r = subprocess.run(['git', *a], capture_output=True, text=True, errors='replace')
    if check and r.returncode:
        raise RuntimeError(' '.join(a) + ': ' + r.stderr.strip())
    return r.stdout

stamp = sys.argv[1]
pre = f'refs/remotes/origin/wip/preserve-{stamp}/'
refs = git('for-each-ref', '--format=%(refname)', pre).split()
other_heads = [r for r in git('for-each-ref', '--format=%(refname)', 'refs/remotes/origin/').split()
               if '/wip/preserve-' not in r and not r.endswith('/HEAD')]
out = []
for ref in refs:
    name = ref[len(pre):]
    base = git('rev-parse', ref + '^').strip()
    on_main = subprocess.run(['git', 'merge-base', '--is-ancestor', base, 'origin/main']).returncode == 0
    local_only = []
    if not on_main:
        excl = ['^' + h for h in other_heads]
        # commits in the base's history that no non-preserve origin branch contains
        local_only = git('rev-list', base, *excl).split()
    files = []
    raw = git('diff', '--raw', '--no-abbrev', '-z', base, ref)
    parts = raw.split('\0')
    i = 0
    while i < len(parts) - 1:
        meta = parts[i].split()
        status = meta[4] if len(meta) > 4 else ''
        path = parts[i + 1]
        i += 2
        if status.startswith(('R', 'C')):
            path = parts[i]; i += 1
        blob = meta[3] if len(meta) > 3 else ''
        if status.startswith('D'):
            files.append({'path': path, 'bucket': 'DELETED-ON-TREE'}); continue
        main_blob = subprocess.run(['git', 'rev-parse', '-q', '--verify', f'origin/main:{path}'],
                                   capture_output=True, text=True).stdout.strip()
        if main_blob == blob:
            continue  # identical: not interesting here
        diff = git('diff', '--no-color', '-U0', base, ref, '--', path, check=False)
        added = [l[1:].strip() for l in diff.splitlines() if l.startswith('+') and not l.startswith('+++')]
        added = [l for l in added if len(l) >= 12]
        if not main_blob:
            files.append({'path': path, 'bucket': 'GONE', 'added': len(added)}); continue
        main_text = set(x.strip() for x in git('show', f'origin/main:{path}', check=False).splitlines())
        if not added:
            files.append({'path': path, 'bucket': 'LANDED', 'added': 0, 'on_main_pct': 100}); continue
        hit = sum(1 for l in added if l in main_text)
        pct = round(100 * hit / len(added))
        b = 'LANDED' if pct >= 95 else 'PARTIAL' if pct >= 50 else 'NEW'
        files.append({'path': path, 'bucket': b, 'added': len(added), 'on_main_pct': pct})
    counts = {}
    for f in files:
        counts[f['bucket']] = counts.get(f['bucket'], 0) + 1
    out.append({'snapshot': name, 'base': base[:9], 'base_on_main': on_main,
                'local_only_commits': len(local_only),
                'local_only_subjects': [git('log', '-1', '--format=%h %s', c).strip() for c in local_only[:15]],
                'counts': counts, 'files': files})
json.dump(out, sys.stdout, indent=1)
