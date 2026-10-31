#!/usr/bin/env python3
"""Render `.planning/foundation/ENDPOINTS.md` from routes.json + trace.json.

INPUTS  (both under .planning/foundation/endpoints/, both committed)
  routes.json        the mechanical layer, written by extract_routes.mjs
  trace.json         what each route does (service, role check, house scope,
                     tables) — written by reading code; format in README.md.
                     One file, keys sorted (`--merge` writes it canonically).
  Nothing else is read, so a render depends only on committed files.

OUTPUT  ENDPOINTS.md — one table row per route, each carrying an explicit
        `<a id="<route id>"></a>` so `ENDPOINTS.md#<route id>` resolves and
        `grep -n 'id="<route id>"'` finds the row. A route with no trace entry
        renders `untraced` in every trace column — never a blank cell, because a
        blank reads as "nothing to say" and that is the absence-as-health fault.

USAGE
  python3 scripts/endpoints/render_endpoints.py                    write ENDPOINTS.md
  python3 scripts/endpoints/render_endpoints.py --check            exit 1 if stale or any route untraced
  python3 scripts/endpoints/render_endpoints.py --check --allow-untraced
  python3 scripts/endpoints/render_endpoints.py --validate         only validate trace.json
  python3 scripts/endpoints/render_endpoints.py --merge [FILE...]  fold shard-shaped trace files
                 ({"traced_at_commit", "routes"}) into trace.json by route id and rewrite it
                 canonically; with no FILE, only rewrite it canonically. A route id in two
                 places with different entries is refused (exit 1), never silently overwritten.
  --out <file>   write (or --check) another path instead of ENDPOINTS.md, e.g. a scratch render

LINES ARE SOFT (founder ruling 2026-09-29): --check compares with every
`file:line` number and the extraction commit masked, so line drift alone never
fails it; a regeneration refreshes them. Anything else that differs does fail.

ANCHORS  every route id, plus the section anchors in SECTION_ANCHORS, one
`module-<dir>` per feature directory and one `controller-<name>` per controller
class (`anchors()`). A citation `ENDPOINTS.md#<anchor>` must name one of these;
the guard that enforces it lands with the re-cite PR (ADR 0245, ruling 2).

EXIT CODES  0 ok · 1 a verified finding (ENDPOINTS.md differs from a fresh
render, an untraced route under --check without --allow-untraced, a trace
entry that breaks the schema or names a route that no longer exists, a
trace.json not in canonical form) · 2 cannot check (routes.json / trace.json /
ENDPOINTS.md missing or not JSON).
"""

from __future__ import annotations

import collections
import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DIR = ROOT / ".planning/foundation/endpoints"
OUT = ROOT / ".planning/foundation/ENDPOINTS.md"
SRC = "apps/api-gateway/src/"

VERDICTS = ["scoped", "user-scoped", "public", "global-by-design", "unscoped", "n/a-read-only-global", "uncertain"]
EVIDENCE_REQUIRED = {"scoped", "user-scoped", "unscoped", "global-by-design"}
ROLE_KINDS = ["none", "owner-manager", "role-list", "custom"]
ROUTE_KEYS = {"service", "role_check", "house_scope", "tables", "rpcs", "external", "writes", "notes"}
ROUTE_REQUIRED = {"service", "role_check", "house_scope", "tables", "rpcs", "external", "writes"}
CITE = re.compile(r"^[\w.@/+-]+\.\w+:\d+(-\d+)?$")
SERVICE = re.compile(r"^(inline|[\w.@/+-]+\.\w+:\d+ [\w$.]+)$")

# Section anchors the renderer always emits. Citations may target these (and
# module-<dir>, controller-<name>) besides route ids.
SECTION_ANCHORS = {
    "verification": "the verification table: counts, prefix, global guards",
    "global-guards": "global guards and what they imply for an unguarded route",
    "trace-progress": "trace coverage: routes traced, and the commit the trace was read at",
    "needs-attention": "computed findings: unguarded, inert @Roles, public-under-JWT, unscoped",
    "legend": "symbols and columns",
    "modules": "the module index",
}
LINE_NUM = re.compile(r"(\.(?:ts|tsx|js|mjs|cjs|py|sql|md|json|ya?ml)):\d+(?:[-–]\d+)?")
BASE_COMMIT = re.compile(r"on top of `[^`]*`")

ACCESS_MARK = {"jwt": "✅", "credential": "🔑", "public": "🌐", "none": "⚠️"}
HTTP_STATUS = {"HttpStatus.OK": "200", "HttpStatus.CREATED": "201", "HttpStatus.ACCEPTED": "202",
               "HttpStatus.NO_CONTENT": "204", "HttpStatus.FOUND": "302", "HttpStatus.BAD_REQUEST": "400"}


class Cannot(Exception):
    pass


def module_of(at: str) -> str:
    parts = short(at).split("/")
    return parts[0] if len(parts) > 1 else "(root)"


def controller_anchor(cls: str) -> str:
    """`HouseMailArchiveController` -> `controller-house-mail-archive`."""
    base = re.sub(r"Controller$", "", cls)
    return "controller-" + re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])", "-", base).lower()


def anchors(data: dict) -> dict[str, str]:
    """Every anchor ENDPOINTS.md carries -> what it names. Raises Cannot on a duplicate."""
    out: dict[str, str] = {}

    def add(a: str, what: str) -> None:
        if a in out:
            raise Cannot(f"anchor {a!r} would name two things: {out[a]} and {what}")
        out[a] = what

    for a, what in SECTION_ANCHORS.items():
        add(a, f"section: {what}")
    for m in sorted({module_of(c["file"]) for c in data["controllers"]}):
        add(f"module-{m}", f"module {m}")
    for c in data["controllers"]:
        add(controller_anchor(c["class"]), f"controller {c['class']} ({short(c['at'])})")
    for r in data["routes"]:
        add(r["id"], f"route {r['method']} {r['path']}")
    return out


def soft(text: str) -> str:
    """The text with line numbers and the extraction commit masked (lines are soft)."""
    return BASE_COMMIT.sub("on top of `<commit>`", LINE_NUM.sub(r"\1:<n>", text))


def load_json(path: Path, label: str) -> dict:
    if not path.exists():
        raise Cannot(f"{label} missing: {path.relative_to(ROOT)}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise Cannot(f"{label} is not valid JSON ({path.relative_to(ROOT)}): {e}") from e


# --------------------------------------------------------------------------
# Trace validation
# --------------------------------------------------------------------------


def validate_entry(rid: str, e: object) -> list[str]:
    errs: list[str] = []
    if not isinstance(e, dict):
        return [f"{rid}: entry is not an object"]
    extra = set(e) - ROUTE_KEYS
    missing = ROUTE_REQUIRED - set(e)
    if extra:
        errs.append(f"{rid}: unknown keys {sorted(extra)}")
    if missing:
        errs.append(f"{rid}: missing keys {sorted(missing)}")
    svc = e.get("service")
    if "service" in e and not (isinstance(svc, str) and SERVICE.match(svc)):
        errs.append(f"{rid}: service must be 'path:line Class.method' or 'inline', got {svc!r}")
    rc = e.get("role_check")
    if "role_check" in e:
        if not isinstance(rc, dict) or rc.get("kind") not in ROLE_KINDS:
            errs.append(f"{rid}: role_check.kind must be one of {ROLE_KINDS}")
        else:
            if set(rc) - {"kind", "evidence", "roles"}:
                errs.append(f"{rid}: role_check has unknown keys {sorted(set(rc) - {'kind', 'evidence', 'roles'})}")
            ev = rc.get("evidence")
            if rc["kind"] != "none" and not (isinstance(ev, str) and CITE.match(ev)):
                errs.append(f"{rid}: role_check.evidence must be 'path:line' when kind is {rc['kind']}")
            if rc["kind"] == "none" and ev is not None and not (isinstance(ev, str) and CITE.match(ev)):
                errs.append(f"{rid}: role_check.evidence must be null or 'path:line'")
            if rc["kind"] == "role-list" and not (isinstance(rc.get("roles"), list) and rc["roles"]):
                errs.append(f"{rid}: role_check.roles (non-empty list) is required for kind role-list")
    hs = e.get("house_scope")
    if "house_scope" in e:
        if not isinstance(hs, dict) or hs.get("verdict") not in VERDICTS:
            errs.append(f"{rid}: house_scope.verdict must be one of {VERDICTS}")
        else:
            if set(hs) - {"verdict", "evidence", "note"}:
                errs.append(f"{rid}: house_scope has unknown keys {sorted(set(hs) - {'verdict', 'evidence', 'note'})}")
            ev = hs.get("evidence", [])
            if not isinstance(ev, list) or not all(isinstance(x, str) and CITE.match(x) for x in ev):
                errs.append(f"{rid}: house_scope.evidence must be a list of 'path:line'")
            elif hs["verdict"] in EVIDENCE_REQUIRED and not ev:
                errs.append(f"{rid}: house_scope.evidence may not be empty for verdict {hs['verdict']}")
            if hs["verdict"] == "uncertain" and not (isinstance(hs.get("note"), str) and hs["note"].strip()):
                errs.append(f"{rid}: house_scope.note must say what is uncertain")
            if "note" in hs and not isinstance(hs["note"], str):
                errs.append(f"{rid}: house_scope.note must be a string")
    for k in ("tables", "rpcs", "external"):
        if k in e and not (isinstance(e[k], list) and all(isinstance(x, str) and x.strip() for x in e[k])):
            errs.append(f"{rid}: {k} must be a list of non-empty strings")
    if "writes" in e and not isinstance(e["writes"], bool):
        errs.append(f"{rid}: writes must be true or false")
    if "notes" in e and not isinstance(e["notes"], str):
        errs.append(f"{rid}: notes must be a string")
    return errs


TRACE = DIR / "trace.json"
TRACE_KEYS = {"schema", "traced_at_commit", "routes"}


def canonical(doc: dict) -> str:
    """The one byte form trace.json is kept in: every object's keys sorted."""
    return json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=True) + "\n"


def check_top(doc: object, name: str) -> list[str]:
    errs: list[str] = []
    if not isinstance(doc, dict) or not isinstance(doc.get("routes"), dict):
        return [f"{name}: top level must be an object with a 'routes' object"]
    for k in sorted(TRACE_KEYS - set(doc)):
        errs.append(f"{name}: missing top-level '{k}'")
    for k in sorted(set(doc) - TRACE_KEYS - {"shard"}):
        errs.append(f"{name}: unknown top-level key '{k}'")
    if doc.get("schema") not in (None, 1):
        errs.append(f"{name}: schema {doc.get('schema')!r} is not 1")
    commit = doc.get("traced_at_commit")
    if commit is not None and not (isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{7,40}", commit)):
        errs.append(f"{name}: traced_at_commit must be a git sha")
    return errs


def load_traces(route_ids: set[str]) -> tuple[dict[str, dict], dict, list[str]]:
    """(route id -> entry, {"commit", "count"}, errors). trace.json is required."""
    doc = load_json(TRACE, "trace.json")
    name = TRACE.relative_to(ROOT)
    errs = check_top(doc, str(name))
    if not isinstance(doc, dict) or not isinstance(doc.get("routes"), dict):
        return {}, {}, errs
    if "shard" in doc:
        errs.append(f"{name}: 'shard' belongs to a shard fragment; fold fragments in with --merge")
    if TRACE.read_text() != canonical(doc):
        errs.append(f"{name}: not in canonical form (keys sorted, indent 1); run render_endpoints.py --merge")
    traces: dict[str, dict] = {}
    for rid, entry in sorted(doc["routes"].items()):
        if rid not in route_ids:
            errs.append(f"{name}: {rid} is not a route in routes.json (renamed or removed?)")
            continue
        e = validate_entry(rid, entry)
        if e:
            errs.extend(f"{name}: {x}" for x in e)
            continue
        traces[rid] = entry
    return traces, {"commit": doc.get("traced_at_commit"), "count": len(doc["routes"])}, errs


def merge(files: list[Path]) -> int:
    """Fold shard-shaped trace files into trace.json; write it canonically."""
    try:
        doc = load_json(TRACE, "trace.json") if TRACE.exists() else {"schema": 1, "traced_at_commit": None, "routes": {}}
        frags = [(f, load_json(f, "trace fragment")) for f in files]
    except Cannot as e:
        print(f"CANNOT CHECK: {e}", file=sys.stderr)
        return 2
    errs = check_top(doc, "trace.json") if TRACE.exists() else []
    routes = dict(doc.get("routes") or {})
    commits = {doc.get("traced_at_commit")} - {None}
    origin = {rid: "trace.json" for rid in routes}
    for f, frag in frags:
        errs += check_top(frag, str(f))
        if not isinstance(frag, dict) or not isinstance(frag.get("routes"), dict):
            continue
        if frag.get("traced_at_commit"):
            commits.add(frag["traced_at_commit"])
        for rid, entry in frag["routes"].items():
            if rid in routes and routes[rid] != entry:
                errs.append(f"{f}: {rid} is already traced differently in {origin[rid]}")
                continue
            routes[rid] = entry
            origin.setdefault(rid, str(f))
    if len(commits) > 1:
        errs.append(f"traced_at_commit differs between inputs ({', '.join(sorted(commits))}); "
                    "re-read the older entries at one commit before merging")
    if errs:
        print(f"FAIL: {len(errs)} merge error(s):", file=sys.stderr)
        for e in errs[:50]:
            print(f"  {e}", file=sys.stderr)
        return 1
    out = {"schema": 1, "traced_at_commit": next(iter(commits), None), "routes": routes}
    TRACE.write_text(canonical(out))
    print(f"wrote {TRACE.relative_to(ROOT)}: {len(routes)} route entries from {len(frags)} fragment(s) + the existing file")
    return 0


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------


def cell(s: str) -> str:
    return s.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def short(at: str) -> str:
    return at[len(SRC):] if at.startswith(SRC) else at


def code(s: str) -> str:
    return f"`{s}`"


def guards_cell(r: dict) -> str:
    parts = []
    for g in r.get("guards", []):
        name, level = g.rsplit("@", 1)
        parts.append(f"{name.removesuffix('Guard')}({level[0]})")
    for fl in r.get("flags", []):
        name, level = fl.rsplit("@", 1)
        parts.append(f"@{name}({level[0]})")
    for rl in r.get("rate_limit", []):
        if not rl.endswith("Guard@class") and not rl.endswith("Guard@method"):
            name, level = rl.rsplit("@", 1)
            parts.append(f"{name}({level[0]})" if "(" not in name else f"{name} ({level[0]})")
    if r.get("env_gate"):
        parts.append("non-prod only")
    return " ".join(parts) if parts else "—"


def role_cell(r: dict, t: dict | None) -> str:
    decl = ""
    if r.get("roles"):
        ro = r["roles"]
        decl = f"@Roles({', '.join(ro['roles'])})" + ("" if ro["enforced"] else " INERT: no RolesGuard")
    if t is None:
        return f"{decl} · untraced" if decl else "untraced"
    rc = t["role_check"]
    kind = rc["kind"]
    if kind == "role-list":
        kind = f"role-list({', '.join(rc['roles'])})"
    ev = f" {code(short(rc['evidence']))}" if rc.get("evidence") else ""
    return f"{kind}{ev}"


def scope_cell(r: dict, t: dict | None) -> str:
    if t is None:
        return "untraced"
    hs = t["house_scope"]
    out = f"**{hs['verdict']}**" if hs["verdict"] in ("unscoped", "uncertain") else hs["verdict"]
    if hs.get("evidence"):
        out += " " + " ".join(code(short(x)) for x in hs["evidence"])
    if hs.get("note"):
        out += f" — {hs['note']}"
    return out


def data_cell(t: dict | None) -> str:
    if t is None:
        return "untraced"
    bits = ["writes" if t["writes"] else "read-only"]
    if t["tables"]:
        bits.append("tables " + ", ".join(t["tables"]))
    if t["rpcs"]:
        bits.append("rpc " + ", ".join(t["rpcs"]))
    if t["external"]:
        bits.append("ext " + ", ".join(t["external"]))
    return " · ".join(bits)


def inputs_cell(r: dict) -> str:
    bits = []
    if r.get("params"):
        bits.append("param " + ", ".join(r["params"]))
    if r.get("query"):
        bits.append("query " + ", ".join(r["query"]))
    if r.get("query_dto"):
        bits.append("query " + code(r["query_dto"]["type"]))
    if r.get("body"):
        bits.append("body " + code(r["body"]["type"]))
    if r.get("body_fields"):
        bits.append("body." + ", body.".join(r["body_fields"]))
    return "; ".join(bits) if bits else "—"


def notes_cell(r: dict, t: dict | None) -> str:
    bits = []
    if r["mount"] == "unmounted":
        bits.append("🚫 unmounted")
    elif r["mount"] == "conditional":
        bits.append(f"mounted only when {r.get('mount_condition')}")
    if r.get("http_code"):
        bits.append("→ " + HTTP_STATUS.get(r["http_code"], r["http_code"]))
    if r.get("access_note"):
        bits.append(r["access_note"])
    if t and t.get("notes"):
        bits.append(t["notes"])
    return "; ".join(bits) if bits else "—"


def render(data: dict, traces: dict[str, dict], meta: dict) -> str:
    routes = data["routes"]
    ctrls = data["controllers"]
    prefix = data["global_prefix"]["value"] if data.get("global_prefix") else ""
    n = len(routes)
    acc = collections.Counter(r["access"] for r in routes)
    mnt = collections.Counter(r["mount"] for r in routes)
    verdicts = collections.Counter(traces[r["id"]]["house_scope"]["verdict"] if r["id"] in traces else "untraced" for r in routes)
    roles_decl = [r for r in routes if r.get("roles")]
    inert = [r for r in roles_decl if not r["roles"]["enforced"]]
    env_gated = [r for r in routes if r.get("env_gate")]
    stood_aside = [r for r in routes if r["access"] == "public" and r.get("access_note")]
    unguarded = [r for r in routes if r["access"] == "none"]
    methods = collections.Counter(r["method"] for r in routes)

    def link(r: dict) -> str:
        return f"[`{r['method']} {r['path']}`](#{r['id']})"

    def ctrl_list(status: str) -> str:
        cs = [c for c in ctrls if c["mount"] == status]
        if not cs:
            return ""
        out = []
        for c in cs:
            why = c.get("mount_condition") or c.get("mount_reason") or ""
            out.append(f"`{c['class']}` ({c.get('route_count', 0)} routes; {why}; `{short(c['at'])}`)")
        return " — " + "; ".join(out)

    globals_guards = ", ".join(f"`{g['name']}` (`{short(g['at'])}`{'' if g['status'] == 'mounted' else ', ' + g['status']})"
                               for g in data.get("global_guards", [])) or "none"
    globals_other = ", ".join(f"`{g['name'].split('(')[0]}` {g['token']} (`{short(g['at'])}`)" for g in data.get("global_other", [])) or "none"
    base = (data.get("base_commit") or "unknown")[:9]
    traced_n = sum(1 for r in routes if r["id"] in traces)

    L: list[str] = []
    L += [
        "# API Endpoint Reference — Mudavym",
        "",
        "> **Grep target** — do not read whole (CLAUDE.md §2). **Generated — never hand-edit.** "
        "Source: `.planning/foundation/endpoints/routes.json` (from `scripts/endpoints/extract_routes.mjs`) "
        "+ `endpoints/trace.json`, rendered by `scripts/endpoints/render_endpoints.py`. "
        "Format and trace schema: [`endpoints/README.md`](endpoints/README.md).",
        ">",
        "> **Cite a route by its anchor, never by line:** `ENDPOINTS.md#post-auth-me-leave-restaurant`. "
        "Find it with `grep -n 'id=\"<anchor>\"' .planning/foundation/ENDPOINTS.md`.",
        "",
        '<a id="verification"></a>',
        "",
        "## Verification",
        "",
        "| | |",
        "|---|---|",
        f"| **Routes extracted** | on top of `{base}` by `extract_routes.mjs` — TypeScript AST over every `*.controller.ts`, "
        f"module graph walked from `AppModule`. `extract_routes.mjs --check` proves `routes.json` still matches the code |",
        f"| **Traced** | **{traced_n} of {n}** routes carry a trace entry"
        + " (coverage below)" + "; the rest render `untraced` |",
        f"| **Total routes** | **{n}** in {len(ctrls)} controller classes, {len({c['file'] for c in ctrls})} files · "
        + " · ".join(f"{m} {methods[m]}" for m in sorted(methods)) + " |",
        f"| **Mounted** | **{mnt['mounted']}** mounted · **{mnt['conditional']}** conditional{ctrl_list('conditional')} · "
        f"**{mnt['unmounted']}** unmounted{ctrl_list('unmounted')} |",
        f"| **Access** | ✅ JWT **{acc['jwt']}** · 🔑 other credential **{acc['credential']}** · "
        f"🌐 public **{acc['public']}** · ⚠️ UNGUARDED **{acc['none']}** |",
        f"| **Production-gated** | {len(env_gated)} routes answer 404 in production (`NonProductionGuard`) |",
        f"| **`@Roles`** | {len(roles_decl)} routes declare roles; {len(roles_decl) - len(inert)} enforced by `RolesGuard`, "
        f"**{len(inert)} inert** (declared with no `RolesGuard`) |",
        "| **House scope (traced)** | " + " · ".join(f"{v} **{verdicts[v]}**" for v in VERDICTS + ["untraced"]) + " |",
        f"| **Global prefix** | `/{prefix}` (`{short(data['global_prefix']['at'])}`) — every path below is under it |"
        if data.get("global_prefix") else "| **Global prefix** | none |",
        f"| **Global guards** | {globals_guards} |",
        f"| **Other globals** | {globals_other} |",
        "",
    ]
    gnames = {g["name"] for g in data.get("global_guards", []) if g["status"] == "mounted"}
    L += ['<a id="global-guards"></a>', ""]
    if "JwtAuthGuard" not in gnames:
        L += [
            "**Load-bearing fact:** there is **no global `JwtAuthGuard`** (global guards above). A route is authenticated "
            "only by an authenticating guard on its own method or class; one with neither that nor `@Public()` is reachable "
            "without a credential and is counted ⚠️ UNGUARDED.",
            "",
        ]
    else:
        L += ["**Load-bearing fact:** `JwtAuthGuard` is a global guard (above); per-route access classes are computed as "
              "if it were not — teach `extract_routes.mjs` before trusting ⚠️.", ""]

    L += ['<a id="trace-progress"></a>', "", "### Trace coverage", ""]
    at = f"`{meta['commit'][:9]}`" if meta.get("commit") else "an unrecorded commit"
    L.append(f"`endpoints/trace.json` traces **{traced_n} of {n}** routes; every `file:line` in it was read at {at}"
             + (f". **{n - traced_n} untraced:** " + ", ".join(link(r) for r in routes if r["id"] not in traces)
                if traced_n < n else "; none untraced") + ".")
    L.append("")

    L += ['<a id="needs-attention"></a>', "", "### Needs attention (computed)", ""]
    L.append("- **UNGUARDED:** " + (", ".join(link(r) for r in unguarded) if unguarded else "none."))
    L.append("- **`@Roles` with no `RolesGuard` (inert):** " + (", ".join(link(r) for r in inert) if inert else "none."))
    L.append("- **`@Public()` under a `JwtAuthGuard` (the guard stands aside for these):** "
             + (", ".join(link(r) for r in stood_aside) if stood_aside else "none."))
    bad = [r for r in routes if r["id"] in traces and traces[r["id"]]["house_scope"]["verdict"] in ("unscoped", "uncertain")]
    L.append("- **House scope unscoped or uncertain (traced):** "
             + (", ".join(link(r) + f" ({traces[r['id']]['house_scope']['verdict']})" for r in bad) if bad else "none among traced routes.")
             + (f" **{n - traced_n} routes are untraced** and not yet graded." if traced_n < n else ""))
    if data.get("edge_cases"):
        L.append("- **Extraction edge cases:** " + "; ".join(data["edge_cases"]))
    L.append("")

    L += [
        '<a id="legend"></a>',
        "",
        "## Legend",
        "",
        "| Symbol | Meaning |",
        "|---|---|",
        "| ✅ | `JwtAuthGuard` on the method or its class, and no `@Public()` |",
        "| 🔑 | a non-JWT credential guard decides — service key (`ServiceKeyGuard`), MCP house key (`McpCredentialAuthGuard`), "
        "or the relay door (`RelayDoorGuard`, JWT or service key). These ignore `@Public()`, so the route is **not** open |",
        "| 🌐 | **public** — explicit `@Public()` and no guard that ignores it. Deliberate, not a defect; the trace says why |",
        "| ⚠️ | **UNGUARDED** — no authenticating guard and no `@Public()`. Reachable without a credential |",
        "| `(c)` / `(m)` | declared on the class / on the method |",
        "| `untraced` | no trace entry yet: the column is unknown, **not** empty |",
        "",
        "Columns: **Auth** · **Method** · **Path** (under the global prefix) · **Guards · flags** (guards without the `Guard` "
        "suffix; `@AllowsNoHouse` etc.; rate limits) · **Role** (trace `role_check`, else the `@Roles` declaration) · "
        "**House scope** (trace verdict + evidence) · "
        "**Service** · **Data** · **Inputs** (`@Param` / `@Query` / `@Body` DTO) · **Handler** (`file:line` of the verb "
        "decorator, relative to `apps/api-gateway/src/`) · **Notes**. Sections are per feature directory, then per controller "
        "class; rows sorted by path, then method.",
        "",
    ]

    # Module index
    by_module: dict[str, list[dict]] = collections.defaultdict(list)
    for c in ctrls:
        by_module[module_of(c["file"])].append(c)
    rcount = collections.Counter(module_of(r["at"]) for r in routes)
    L += ['<a id="modules"></a>', "", "## Modules", "",
          " · ".join(f"[{m}](#module-{m}) ({rcount[m]})" for m in sorted(by_module)), "", "---", ""]

    routes_by_ctrl: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for r in routes:
        routes_by_ctrl[(r["controller_at"], r["class"])].append(r)

    header = ("| Auth | Method | Path | Guards · flags | Role | House scope | Service | Data | Inputs | Handler | Notes |\n"
              "|---|---|---|---|---|---|---|---|---|---|---|")
    for m in sorted(by_module):
        L += [f'<a id="module-{m}"></a>', "", f"## `{m}` ({rcount[m]})", ""]
        for c in sorted(by_module[m], key=lambda c: (c["file"], c["at"])):
            rs = sorted(routes_by_ctrl.get((c["at"], c["class"]), []), key=lambda r: (r["path"], r["method"]))
            mount = ""
            if c["mount"] == "conditional":
                mount = f" — mounted only when `{c.get('mount_condition')}`"
            elif c["mount"] == "unmounted":
                mount = f" — 🚫 **unmounted**: {c.get('mount_reason')}"
            paths = ", ".join(json.dumps(p) for p in c.get("paths", [""]) if p)
            L += [f'<a id="{controller_anchor(c["class"])}"></a>', "",
                  f"### `{c['class']}` ({len(rs)}) — `{short(c['at'])}` `@Controller({paths})`{mount}", ""]
            if not rs:
                L += ["_No routes declared._", ""]
                continue
            L.append(header)
            for r in rs:
                t = traces.get(r["id"])
                row = [
                    f'<a id="{r["id"]}"></a>{ACCESS_MARK[r["access"]]}',
                    code(r["method"]),
                    code(r["path"]),
                    cell(guards_cell(r)),
                    cell(role_cell(r, t)),
                    cell(scope_cell(r, t)),
                    cell(code(short(t["service"].split(" ")[0])) + " " + t["service"].split(" ", 1)[1]
                         if t and t["service"] != "inline" else ("inline (handler)" if t else "untraced")),
                    cell(data_cell(t)),
                    cell(inputs_cell(r)),
                    cell(f"`{short(r['at'])}` {r['handler']}"),
                    cell(notes_cell(r, t)),
                ]
                L.append("| " + " | ".join(row) + " |")
            L.append("")
    return "\n".join(L).rstrip("\n") + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    allow_untraced = "--allow-untraced" in argv
    validate_only = "--validate" in argv
    if "--merge" in argv:
        return merge([Path(a).resolve() for a in argv[argv.index("--merge") + 1:] if not a.startswith("--")])
    out = OUT
    if "--out" in argv:
        out = Path(argv[argv.index("--out") + 1]).resolve()
    try:
        data = load_json(DIR / "routes.json", "routes.json")
        if data.get("schema") != 1 or not isinstance(data.get("routes"), list) or not data["routes"]:
            raise Cannot("routes.json has no routes or an unknown schema")
        ids = {r["id"] for r in data["routes"]}
        traces, meta, errs = load_traces(ids)
        anchors(data)  # refuses a duplicate anchor before anything is written
    except Cannot as e:
        print(f"CANNOT CHECK: {e}", file=sys.stderr)
        return 2

    if errs:
        print(f"FAIL: {len(errs)} trace error(s):", file=sys.stderr)
        for e in errs[:50]:
            print(f"  {e}", file=sys.stderr)
        if len(errs) > 50:
            print(f"  ... {len(errs) - 50} more", file=sys.stderr)
        return 1
    untraced = sorted(ids - set(traces))
    if validate_only:
        print(f"OK: trace.json valid; {len(traces)} of {len(ids)} routes traced, {len(untraced)} untraced.")
        return 0

    text = render(data, traces, meta)
    label = out.relative_to(ROOT) if out.is_relative_to(ROOT) else out
    if check:
        if not out.exists():
            print(f"CANNOT CHECK: {label} does not exist", file=sys.stderr)
            return 2
        current = out.read_text()
        rc = 0
        if soft(current) != soft(text):
            diff = list(difflib.unified_diff(soft(current).splitlines(), soft(text).splitlines(),
                                             "ENDPOINTS.md (committed, lines masked)",
                                             "ENDPOINTS.md (fresh render, lines masked)", lineterm="", n=0))
            print(f"STALE: {label} differs from a fresh render beyond line numbers ({len(diff)} diff lines). First lines:",
                  file=sys.stderr)
            for line in diff[:20]:
                print(f"  {line[:200]}", file=sys.stderr)
            print("  Fix: python3 scripts/endpoints/render_endpoints.py (never hand-edit ENDPOINTS.md)", file=sys.stderr)
            rc = 1
        if untraced and not allow_untraced:
            print(f"FAIL: {len(untraced)} route(s) have no trace entry, e.g. {', '.join(untraced[:5])}", file=sys.stderr)
            rc = 1
        if rc == 0:
            drift = " (line numbers or commit drifted; a regeneration refreshes them)" if current != text else ""
            print(f"OK: {label} matches a fresh render{drift}; {len(traces)}/{len(ids)} traced"
                  + (f" ({len(untraced)} untraced, allowed)" if untraced else "") + ".")
        return rc
    out.write_text(text)
    print(f"wrote {label}: {len(ids)} routes, {len(traces)} traced, {len(untraced)} untraced, "
          f"{len(text.encode())} bytes, {text.count(chr(10))} lines")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
