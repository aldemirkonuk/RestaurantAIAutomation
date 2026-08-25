"""
Static import-resolution scanning
================================
Shared helper for tests that check a `from X import Y` actually resolves.

This exists because of a bug class that is invisible at runtime: a call site
imports a name its target module never defined, the ImportError is caught by
a broad `except Exception`, and the code silently takes a degraded path. See
tests/test_supabase_client_wiring.py and tests/test_first_party_imports.py.

The scan is static (AST) rather than import-based on purpose: some modules
cannot be imported in a test process at all, and those are exactly the ones
most likely to be rotting unnoticed.

Not collected by pytest — pytest.ini sets `python_files = test_*.py`.
"""

import ast
import os

ORCHESTRATOR_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIRST_PARTY = ("core", "services", "agents", "api", "jobs", "config", "utils")
SKIP_DIRS = {"__pycache__", "tests", ".venv", "venv", "node_modules"}


def module_to_path(module: str):
    """Resolve a dotted first-party module name to a file, or None."""
    base = os.path.join(ORCHESTRATOR_ROOT, *module.split("."))
    if os.path.isfile(base + ".py"):
        return base + ".py"
    init = os.path.join(base, "__init__.py")
    return init if os.path.isfile(init) else None


def top_level_names(path: str) -> set:
    """Names a module defines at import time, including inside if/try/with."""
    names: set = set()
    try:
        tree = ast.parse(open(path, encoding="utf-8").read())
    except (OSError, SyntaxError):
        return names

    def walk(body):
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        names.add(target.id)
                    elif isinstance(target, (ast.Tuple, ast.List)):
                        names.update(
                            e.id for e in target.elts if isinstance(e, ast.Name)
                        )
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                names.add(node.target.id)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    if alias.name == "*":
                        # Star re-export: pull in the source module's names.
                        if isinstance(node, ast.ImportFrom) and node.module:
                            sub = module_to_path(node.module)
                            if sub:
                                names.update(top_level_names(sub))
                    else:
                        names.add(alias.asname or alias.name.split(".")[0])
            elif isinstance(node, (ast.If, ast.Try, ast.With)):
                walk(node.body)
                walk(getattr(node, "orelse", []) or [])
                walk(getattr(node, "finalbody", []) or [])
                for handler in getattr(node, "handlers", []):
                    walk(handler.body)

    walk(tree.body)
    return names


def iter_source_files():
    for dirpath, dirnames, filenames in os.walk(ORCHESTRATOR_ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name.endswith(".py"):
                yield os.path.join(dirpath, name)


def unresolved_first_party_imports() -> set:
    """Every `from <first-party> import <name>` whose name the target lacks.

    Returns a set of (relative_source_path, module, name) tuples.
    """
    found = set()
    for path in iter_source_files():
        try:
            tree = ast.parse(open(path, encoding="utf-8").read())
        except (OSError, SyntaxError):
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            if node.level or not node.module:
                continue
            if node.module.split(".")[0] not in FIRST_PARTY:
                continue
            target = module_to_path(node.module)
            if target is None:
                continue
            exported = top_level_names(target)
            for alias in node.names:
                if alias.name != "*" and alias.name not in exported:
                    found.add(
                        (
                            os.path.relpath(path, ORCHESTRATOR_ROOT),
                            node.module,
                            alias.name,
                        )
                    )
    return found
