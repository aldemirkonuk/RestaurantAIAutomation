#!/usr/bin/env python3
"""Generate the Mudavym Design Atlas: one committed graph of every function's chain
(feature -> page -> endpoint -> service/agent -> table/model-task), plus the
zoomable viewer that renders it.

Outputs (committed, regenerate rather than hand-edit):
  .planning/00-index/atlas-graph.json   the generated graph — the source of truth
  .planning/00-index/DESIGN-MAP.html    self-contained zoomable viewer (F, ADR 0033)

Input (curated, hand-edited):
  .planning/00-index/atlas-overlay.json additive-only overlay: domains, badges,
                                        notes, extra nodes/edges. The overlay may
                                        ADD, never redefine — a collision with a
                                        generated node id, or an unknown key,
                                        exits 2 (never vacuous, CLAUDE.md rules).

Every edge carries a `basis` naming its derivation, so the viewer can be honest
about what is measured vs curated.
"""
from __future__ import annotations

import collections
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = ROOT / "apps/api-gateway/src"
WEB = ROOT / "apps/web/src"
AGENTS = ROOT / "services/agent-orchestrator/agents"
PAGES = ROOT / ".planning/06-pages"
OUT_DIR = ROOT / ".planning/00-index"
OVERLAY = OUT_DIR / "atlas-overlay.json"

PRUNE = {"node_modules", "dist", "build", ".turbo", "venv", ".venv",
         "__pycache__", ".git", "coverage", ".next", "__tests__"}


def walk(base: pathlib.Path, *exts: str) -> list[pathlib.Path]:
    out = []
    if not base.is_dir():
        return out
    for p in sorted(base.rglob("*")):
        if any(part in PRUNE for part in p.parts):
            continue
        if p.is_file() and p.suffix in exts:
            out.append(p)
    return out


def die(msg: str) -> None:
    print(f"FATAL: {msg}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# 1. Endpoints from controllers (same extraction the system atlas proved out)
# ---------------------------------------------------------------------------
METHODS = ("Get", "Post", "Put", "Patch", "Delete", "Head", "Options")
VERB_RE = re.compile(r'@(%s)\(\s*(?:["\']([^"\']*)["\'])?\s*\)' % "|".join(METHODS))


def scan_endpoints() -> list[dict]:
    endpoints = []
    for f in walk(API, ".ts"):
        if not f.name.endswith(".controller.ts") or f.name.endswith(".spec.ts"):
            continue
        src = f.read_text(errors="replace")
        m = re.search(r'@Controller\(\s*["\']?([^"\')]*)["\']?\s*\)', src)
        base = (m.group(1) if m else "").strip("/")
        cls_auth = bool(re.search(r'@UseGuards\([^)]*JwtAuthGuard', src))
        module = f.relative_to(API).parts[0]
        for mm in VERB_RE.finditer(src):
            verb, sub = mm.group(1).upper(), (mm.group(2) or "").strip("/")
            seg = src[max(0, mm.start() - 400):mm.end() + 300]
            endpoints.append({
                "method": verb,
                "path": "/" + "/".join(x for x in (base, sub) if x),
                "module": module,
                "file": str(f.relative_to(ROOT)),
                "auth": cls_auth or bool(re.search(r'@UseGuards\([^)]*JwtAuthGuard', seg)),
                "public": bool(re.search(r'@Public\(\)', seg)),
            })
    endpoints.sort(key=lambda e: (e["path"], e["method"]))
    return endpoints


# ---------------------------------------------------------------------------
# 2. Pages + features from the 06-pages contract docs (frontmatter + §1a)
# ---------------------------------------------------------------------------
def scan_pages() -> list[dict]:
    pages = []
    for f in sorted(PAGES.glob("*.md")):
        text = f.read_text(errors="replace")
        if not text.startswith("---"):
            continue
        fm_end = text.find("\n---", 3)
        if fm_end < 0:
            continue
        fm = text[3:fm_end]

        def field(name: str) -> str | None:
            m = re.search(rf'^{name}:\s*"?([^"\n#]+)"?\s*(#.*)?$', fm, re.M)
            return m.group(1).strip() if m else None

        if field("type") != "page":
            continue
        route = field("route")
        if not route:
            continue
        body = text[fm_end:]
        features = []
        m = re.search(r'^##+\s*1a\.?\s*Features\s*$(.*?)(?=^##)', body, re.M | re.S)
        if m:
            for line in m.group(1).split("\n"):
                line = line.strip()
                if line.startswith("- "):
                    label = re.sub(r"\s*\(🚧[^)]*\)", "", line[2:]).strip()
                    label = label.replace("**", "")
                    features.append(label)
        pages.append({
            "route": route,
            "doc": str(f.relative_to(ROOT)),
            "component": field("component") or "",
            "archetype": (field("archetype") or "").split()[0] if field("archetype") else "",
            "audience": field("audience") or "",
            "tier": field("tier") or "",
            "maturity": field("maturity") or "",
            "features": features,
        })
    pages.sort(key=lambda p: p["route"])
    return pages


# ---------------------------------------------------------------------------
# 3. Web api layer: services/api/<mod>.ts -> endpoint paths; index re-exports
# ---------------------------------------------------------------------------
CALL_RE = re.compile(r'\b(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([`"\'])(/[^`"\']*)\2')


def norm_path(p: str) -> str:
    p = re.sub(r"\$\{[^}]*\}", ":x", p)
    p = p.split("?")[0].rstrip("/")
    return p or "/"


def path_key(p: str) -> tuple:
    return tuple(":" if seg.startswith(":") else seg for seg in norm_path(p).split("/"))


def scan_api_layer() -> tuple[dict[str, list[dict]], dict[str, str]]:
    """api module -> [{method, path}], and exported-name -> api module."""
    api_dir = WEB / "services/api"
    calls: dict[str, list[dict]] = collections.defaultdict(list)
    exports: dict[str, str] = {}
    for f in sorted(api_dir.glob("*.ts")):
        mod = f.stem
        src = f.read_text(errors="replace")
        if mod == "index":
            for mm in re.finditer(r'export\s*\{([^}]*)\}\s*from\s*["\']\./([a-z-]+)["\']', src):
                for name in mm.group(1).split(","):
                    name = name.strip().split(" as ")[-1].strip()
                    if name:
                        exports[name] = mm.group(2)
            for mm in re.finditer(r'export\s*\*\s*from\s*["\']\./([a-z-]+)["\']', src):
                exports.setdefault("*" + mm.group(1), mm.group(1))
            continue
        for mm in CALL_RE.finditer(src):
            calls[mod].append({"method": mm.group(1).upper(), "path": norm_path(mm.group(3))})
        for mm in re.finditer(r'export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)', src):
            exports[mm.group(1)] = mod
    return calls, exports


def page_component_files(page: dict) -> list[pathlib.Path]:
    comp = page.get("component", "")
    if not comp:
        return []
    f = ROOT / comp
    if not f.exists():
        return []
    scan = [f]
    if f.parent != WEB / "pages":
        scan += [x for x in walk(f.parent, ".tsx", ".ts") if x != f][:40]
    return scan


def page_api_modules(page: dict, exports: dict[str, str]) -> set[str]:
    mods: set[str] = set()
    for f in page_component_files(page):
        src = f.read_text(errors="replace")
        for mm in re.finditer(r'import\s*(?:\{([^}]*)\})?[^;]*?from\s*["\']([^"\']*services/api(?:/([a-z-]+))?)["\']', src):
            if mm.group(3):
                mods.add(mm.group(3))
            elif mm.group(1):
                for name in mm.group(1).split(","):
                    name = name.strip().split(" as ")[-1].strip()
                    if name in exports:
                        mods.add(exports[name])
    return mods


# ---------------------------------------------------------------------------
# 4. Tables/rpcs per file via the proven extractor (ADR 0026's guard machinery)
# ---------------------------------------------------------------------------
def load_extractor():
    spec = importlib.util.spec_from_file_location(
        "cqte", ROOT / "scripts/check_queried_tables_exist.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["cqte"] = mod  # dataclasses need the module registered
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ---------------------------------------------------------------------------
# 5. Model tasks
# ---------------------------------------------------------------------------
def scan_model_tasks() -> list[dict]:
    tasks: dict[str, set[str]] = collections.defaultdict(set)
    for f in walk(API, ".ts"):
        if f.name.endswith(".spec.ts"):
            continue
        src = f.read_text(errors="replace")
        for mm in re.finditer(r'taskType:\s*["\']([a-z0-9_\-]+)["\']', src):
            tasks[mm.group(1)].add(f.relative_to(API).parts[0])
    py_root = ROOT / "services/agent-orchestrator"
    for f in walk(py_root, ".py"):
        src = f.read_text(errors="replace")
        for mm in re.finditer(r'task_type\s*=\s*["\']([a-z0-9_\-]+)["\']', src):
            rel = f.relative_to(py_root)
            owner = rel.parts[0] if len(rel.parts) > 1 else rel.stem
            tasks[mm.group(1)].add("py:" + owner)
    return [{"task": t, "owners": sorted(o)} for t, o in sorted(tasks.items())]


# ---------------------------------------------------------------------------
# Build graph
# ---------------------------------------------------------------------------
def build() -> dict:
    endpoints = scan_endpoints()
    pages = scan_pages()
    api_calls, api_exports = scan_api_layer()
    tasks = scan_model_tasks()

    ex = load_extractor().extract(ROOT)
    tables_by_prefix: dict[str, set[str]] = collections.defaultdict(set)
    rpcs_by_prefix: dict[str, set[str]] = collections.defaultdict(set)
    for s in ex.sites:
        if not s.resolved:
            continue
        p = s.path
        bucket = None
        if p.startswith("apps/api-gateway/src/"):
            bucket = "svc:" + p.split("/")[3]
        elif p.startswith("services/agent-orchestrator/agents/"):
            bucket = "agent:" + pathlib.Path(p).stem
        elif p.startswith("services/agent-orchestrator/"):
            bucket = "agent:_shared"
        if bucket:
            (tables_by_prefix if s.kind == "table" else rpcs_by_prefix)[bucket].add(s.resolved)

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add_node(nid: str, kind: str, label: str, **extra):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "kind": kind, "label": label, **extra}
        return nid

    def add_edge(a: str, b: str, kind: str, basis: str):
        edges.append({"from": a, "to": b, "kind": kind, "basis": basis})

    ep_by_key: dict[tuple, str] = {}
    for e in endpoints:
        nid = f'ep:{e["method"]} {e["path"]}'
        add_node(nid, "endpoint", f'{e["method"]} {e["path"]}',
                 module=e["module"], file=e["file"], auth=e["auth"], public=e["public"])
        ep_by_key[(e["method"],) + path_key(e["path"])] = nid
        svc = add_node("svc:" + e["module"], "service", e["module"], runtime="gateway")
        add_edge(nid, svc, "handled_by", "derived:controller-module")

    for svc_id, tbls in sorted(tables_by_prefix.items()):
        if svc_id.startswith("svc:") and svc_id not in nodes:
            add_node(svc_id, "service", svc_id[4:], runtime="gateway")
        if svc_id.startswith("agent:") and svc_id not in nodes:
            add_node(svc_id, "agent", svc_id[6:], runtime="python")
        for t in sorted(tbls):
            tid = add_node("table:" + t, "table", t)
            add_edge(svc_id, tid, "queries", "derived:table-scan")
    for svc_id, fns in sorted(rpcs_by_prefix.items()):
        if svc_id not in nodes:
            kind = "service" if svc_id.startswith("svc:") else "agent"
            add_node(svc_id, kind, svc_id.split(":", 1)[1],
                     runtime="gateway" if kind == "service" else "python")
        for fn in sorted(fns):
            fid = add_node("rpc:" + fn, "rpc", fn + "()")
            add_edge(svc_id, fid, "calls_rpc", "derived:table-scan")

    for f in sorted(AGENTS.glob("*.py")):
        if f.stem == "__init__":
            continue
        add_node("agent:" + f.stem, "agent", f.stem, runtime="python",
                 file=str(f.relative_to(ROOT)))

    api_mod_eps: dict[str, list[str]] = collections.defaultdict(list)
    for mod, calls in api_calls.items():
        for c in calls:
            k = (c["method"],) + path_key(c["path"])
            hit = ep_by_key.get(k)
            if hit:
                api_mod_eps[mod].append(hit)

    for p in pages:
        pid = add_node("page:" + p["route"], "page", p["route"],
                       doc=p["doc"], component=p["component"], archetype=p["archetype"],
                       audience=p["audience"], tier=p["tier"], maturity=p["maturity"])
        for i, feat in enumerate(p["features"]):
            fid = add_node(f'feature:{p["route"]}#{i}', "feature", feat, page=pid)
            add_edge(fid, pid, "belongs_to", "derived:06-pages-1a")
        mods = page_api_modules(p, api_exports)
        for mod in sorted(mods):
            for ep in sorted(set(api_mod_eps.get(mod, []))):
                add_edge(pid, ep, "calls", f"derived:api-layer:{mod}")

    for t in tasks:
        tid = add_node("task:" + t["task"], "model_task", t["task"], owners=t["owners"])
        for o in t["owners"]:
            oid = ("agent:" + o[3:]) if o.startswith("py:") else ("svc:" + o)
            if oid in nodes:
                add_edge(oid, tid, "emits", "derived:tasktype-scan")

    return {
        "generator": "scripts/generate_design_atlas.py",
        "counts": {
            "endpoints": len(endpoints), "pages": len(pages),
            "features": sum(len(p["features"]) for p in pages),
            "services": sum(1 for n in nodes.values() if n["kind"] == "service"),
            "agents": sum(1 for n in nodes.values() if n["kind"] == "agent"),
            "tables": sum(1 for n in nodes.values() if n["kind"] == "table"),
            "model_tasks": len(tasks),
        },
        "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
        "edges": sorted(edges, key=lambda e: (e["from"], e["to"], e["kind"])),
    }


# ---------------------------------------------------------------------------
# Overlay: additive-only, enforced
# ---------------------------------------------------------------------------
ALLOWED_OVERLAY_KEYS = {"contract", "domains", "badges", "notes", "extra_nodes", "extra_edges"}


def load_overlay(graph: dict) -> dict:
    if not OVERLAY.exists():
        die(f"{OVERLAY} missing — the overlay file is part of the contract (ADR 0033)")
    ov = json.loads(OVERLAY.read_text())
    unknown = set(ov) - ALLOWED_OVERLAY_KEYS
    if unknown:
        die(f"overlay carries unknown keys {sorted(unknown)} — the overlay may only add "
            f"{sorted(ALLOWED_OVERLAY_KEYS - {'contract'})}")
    gen_ids = {n["id"] for n in graph["nodes"]}
    for n in ov.get("extra_nodes", []):
        if n["id"] in gen_ids:
            die(f"overlay extra_node '{n['id']}' collides with a generated node — "
                "the overlay may add, never redefine")
    known = gen_ids | {n["id"] for n in ov.get("extra_nodes", [])}
    for b in ov.get("badges", []):
        if b["node"] not in known:
            die(f"overlay badge references unknown node '{b['node']}'")
    for e in ov.get("extra_edges", []):
        for end in (e["from"], e["to"]):
            if end not in known:
                die(f"overlay extra_edge references unknown node '{end}'")
    return ov


# ---------------------------------------------------------------------------
# Emit
# ---------------------------------------------------------------------------
def main() -> int:
    graph = build()
    overlay = load_overlay(graph)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "atlas-graph.json").write_text(
        json.dumps(graph, indent=1, ensure_ascii=False) + "\n")
    template = (ROOT / "scripts/design_map_template.html").read_text()
    payload = json.dumps({"graph": graph, "overlay": overlay},
                         ensure_ascii=False).replace("</", "<\\/")
    marker = "/*__ATLAS_DATA__*/null"
    if marker not in template:
        die("template marker missing — design_map_template.html rotted")
    html = template.replace(marker, payload)
    (OUT_DIR / "DESIGN-MAP.html").write_text(html)
    c = graph["counts"]
    print(f"atlas-graph.json: {c['features']} features · {c['pages']} pages · "
          f"{c['endpoints']} endpoints · {c['services']} services · {c['agents']} agents · "
          f"{c['tables']} tables · {c['model_tasks']} model tasks · "
          f"{len(graph['edges'])} edges")
    print("DESIGN-MAP.html written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
