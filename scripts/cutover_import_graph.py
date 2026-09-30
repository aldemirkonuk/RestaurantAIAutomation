#!/usr/bin/env python3
"""The ADR 0149 cutover manifest's import-graph proof, re-runnable.

WHY: `.planning/07-reference/deploy/CUTOVER-MANIFEST-2026-09-28.md` lists the
legacy web pages as file groups the founder approves one by one. A group is
safe to delete only if nothing but App.tsx's `legacy` slot reaches it. That is
a fact about the import graph on a given commit, and it rots the day a live
page imports a legacy file — so it is a command, not a sentence (CLAUDE.md §5b).

WHAT: builds the static + dynamic import graph of apps/web/src from
`src/main.tsx` (plus `middleware.ts` and `.storybook/`), removes App.tsx's
edges to each group's legacy root, and prints, per group, the files only that
group reaches, their line counts, and every NON-App importer of each root
(which must be empty for the group to be deletable). Files reached by several
groups are listed as `shared`; files already unreachable from main.tsx are
counted but not assigned (they are dead code today, legacy or not).

Usage:  python3 scripts/cutover_import_graph.py [--json]
Exit 1 if any group root has an importer outside App.tsx and tests.

It does NOT run tsc or vitest — the manifest's trial deletes did that, per
group, on the commit the manifest names.
"""
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'apps', 'web')
SRC = os.path.join(WEB, 'src')

# Each group's legacy root(s): the component App.tsx mounts in a live page's
# `legacy` slot — or, for `arrival_book`, the `next` slot ADR 0213 inverts.
GROUPS = {
    'dashboard': ['src/pages/Dashboard.tsx'],
    'orders': ['src/pages/Orders.tsx'],
    'receiving_desk': ['src/pages/receiving/ReceivingHome.tsx'],
    'receiving_door': ['src/pages/receiving/DoorReceipt.tsx'],
    'vendors': ['src/pages/Providers.tsx'],
    'communications': ['src/pages/Communications.tsx'],
    'team': ['src/pages/team/command/TeamCommandPage.tsx'],
    'receipts': ['src/pages/ReceiptsPage.tsx'],
    'documents': ['src/pages/DocumentsPage.tsx'],
    'reports': ['src/pages/Reports.tsx'],
    'notifications': ['src/pages/Notifications.tsx'],
    'recommendations': ['src/pages/Recommendations.tsx', 'src/pages/InsightCatalog.tsx'],
    'calendar': ['src/pages/CalendarModular.tsx'],
    'settings': ['src/pages/Settings.tsx'],
    'profile': ['src/pages/Profile.tsx'],
    'logs': ['src/pages/LogsTimelinePage.tsx'],
    'help': ['src/pages/Help.tsx'],
    'cellar': ['src/pages/wine-library/index.tsx'],
    'admin': ['src/pages/AdminPanel.tsx', 'src/pages/AdminHealth.tsx'],
    'authorize': ['src/pages/AuthorizeIntegration.tsx'],
    'ask': ['src/pages/SommelierAI.tsx'],
    'promotions': ['src/pages/Promotions.tsx'],
    'vendor_prices': ['src/pages/VendorPriceCompare.tsx'],
    'arrival_book': ['src/pages/arrival/Arrival.tsx'],
}
EXTS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json']
IMP = re.compile(r"""(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)""", re.S)


def is_aux(p):
    return bool(re.search(r'\.(test|spec|stories)\.[tj]sx?$', os.path.basename(p))) or '/__tests__/' in p or '/__mocks__/' in p


def resolve(frm, spec):
    if spec.startswith('@/'):
        base = os.path.join(SRC, spec[2:])
    elif spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else:
        return None
    for c in [base] + [base + e for e in EXTS] + [os.path.join(base, 'index' + e) for e in EXTS]:
        if os.path.isfile(c):
            return os.path.relpath(c, WEB)
    return None


def main():
    files = []
    for d, _, fs in os.walk(SRC):
        files += [os.path.relpath(os.path.join(d, f), WEB) for f in fs if f.endswith(('.ts', '.tsx', '.js', '.jsx'))]
    if os.path.isfile(os.path.join(WEB, 'middleware.ts')):
        files.append('middleware.ts')
    sb = os.path.join(WEB, '.storybook')
    if os.path.isdir(sb):
        files += [os.path.join('.storybook', f) for f in os.listdir(sb)]
    missing = [r for rs in GROUPS.values() for r in rs if not os.path.isfile(os.path.join(WEB, r))]
    edges, rev = defaultdict(set), defaultdict(set)
    for f in files:
        t = open(os.path.join(WEB, f), encoding='utf-8', errors='ignore').read()
        for m in IMP.finditer(t):
            r = resolve(os.path.join(WEB, f), next(g for g in m.groups() if g))
            if r:
                edges[f].add(r)
                rev[r].add(f)

    def reach(roots, drop=frozenset()):
        seen, st = set(), list(roots)
        while st:
            x = st.pop()
            if x in seen:
                continue
            seen.add(x)
            st += [y for y in edges.get(x, ()) if (x, y) not in drop and not (is_aux(y) and not is_aux(x))]
        return seen

    roots = ['src/main.tsx', 'middleware.ts'] + [f for f in files if f.startswith('.storybook')]
    before = reach(roots)
    live_roots = {r for rs in GROUPS.values() for r in rs if r not in missing}
    after = reach(roots, frozenset(('src/App.tsx', r) for r in live_roots))
    dead = before - after
    owner = defaultdict(list)
    for g, rs in GROUPS.items():
        for f in reach([r for r in rs if r not in missing]) & dead:
            owner[f].append(g)
    lines = lambda f: sum(1 for _ in open(os.path.join(WEB, f), encoding='utf-8', errors='ignore'))
    out = {'groups': {}, 'shared': {}, 'already_unreachable': sorted(
        f for f in files if not is_aux(f) and f not in before and not f.startswith('.storybook') and not f.endswith('.d.ts')),
        'deleted_roots': missing}
    bad = []
    for g, rs in GROUPS.items():
        own = sorted(f for f, gs in owner.items() if gs == [g])
        # A blocker is an importer that stays live once every legacy slot is gone
        # (a group's own barrel importing its root back is not one).
        imp = {r: sorted(x for x in rev.get(r, ()) if x != 'src/App.tsx' and not is_aux(x) and x in after) for r in rs if r not in missing}
        bad += [(g, r, i) for r, i in imp.items() if i]
        out['groups'][g] = {'files': own, 'lines': sum(lines(f) for f in own), 'root_importers_outside_app': imp}
    for f, gs in owner.items():
        if len(gs) > 1:
            out['shared'][f] = {'groups': gs, 'lines': lines(f)}
    if '--json' in sys.argv:
        print(json.dumps(out, indent=1))
    else:
        for g, v in out['groups'].items():
            print('%-16s %3d files %6d lines' % (g, len(v['files']), v['lines']))
        print('%-16s %3d files %6d lines' % ('shared', len(out['shared']), sum(x['lines'] for x in out['shared'].values())))
        print('already unreachable from main.tsx: %d files' % len(out['already_unreachable']))
        if missing:
            print('roots already deleted: %s' % ', '.join(missing))
    for g, r, i in bad:
        print('NOT DELETABLE: %s root %s is imported by %s' % (g, r, ', '.join(i)), file=sys.stderr)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
