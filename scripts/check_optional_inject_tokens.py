#!/usr/bin/env python3
"""
Guard: an @Optional() constructor parameter must carry a runtime DI token.

NestJS resolves a constructor parameter from the type TypeScript emits as metadata. Pick<>,
Partial<>, Omit<>, an interface, a type alias or an `import type` emit `Object`, so Nest has
no token to look up. For a required parameter that is a loud boot error. For @Optional() it
is silence: Nest injects `undefined`, the code path guarded by `if (this.dep)` never runs, and
nothing says so. The live instance (PR 1560, found in the r39 walk) was a service whose
"optional" dependency was never present in production.

The fix is `@Optional() @Inject(TheClass) dep?: Pick<TheClass, 'method'>` - narrow the type
all you like, but hand Nest the class.

Flagged: an @Optional() constructor parameter with no @Inject(...) whose type is
  * a utility type (Pick/Partial/Omit/Required/Readonly/Record/Exclude/Extract/NonNullable/
    ReturnType/Parameters/InstanceType),
  * an inline object, function or union type,
  * a name that this file declares as `interface`/`type` or imports with `import type`, or that
    another file under apps/api-gateway/src declares as `interface`/`type` and never as `class`
    (a value import from a package, such as ConfigService, is taken as a class).

Not flagged: a plain class name (it carries its own token), or anything with @Inject.

Stdlib only. Exit 0 = clean. Exit 1 = offending parameters (printed).
Exit 2 = the guard could not run (no files found), which is a failure, not a skip.
`--self-test` proves the guard still fires on the shapes it exists to catch.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "api-gateway" / "src"

UTILITY = re.compile(
    r"^(Pick|Partial|Omit|Required|Readonly|Record|Exclude|Extract|NonNullable|"
    r"ReturnType|Parameters|InstanceType)\s*<"
)


def _strip_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), src, flags=re.S)
    return re.sub(r"//[^\n]*", lambda m: " " * len(m.group(0)), src)


def _match_close(s: str, i: int) -> int:
    """s[i] is '('; return the index of its matching ')', or -1. Strings are skipped."""
    depth, quote = 0, None
    while i < len(s):
        c = s[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _split_top(s: str):
    parts, depth, cur, quote, prev = [], 0, [], None, ""
    for c in s:
        if quote:
            cur.append(c)
            if c == quote and prev != "\\":
                quote = None
        elif c in "'\"`":
            quote = c
            cur.append(c)
        else:
            if c in "([{<":
                depth += 1
            elif c in ")]}":
                depth -= 1
            elif c == ">" and prev != "=":
                depth -= 1
            if c == "," and depth == 0:
                parts.append("".join(cur))
                cur = []
            else:
                cur.append(c)
        prev = c
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


def declared_kinds(sources):
    """name -> set of 'class' | 'interface' | 'type' | 'import-type' across all files."""
    kinds = {}
    for src in sources:
        for m in re.finditer(r"\b(?:abstract\s+)?class\s+(\w+)", src):
            kinds.setdefault(m.group(1), set()).add("class")
        for m in re.finditer(r"\binterface\s+(\w+)", src):
            kinds.setdefault(m.group(1), set()).add("interface")
        for m in re.finditer(r"\btype\s+(\w+)\s*(?:<[^=]*>)?\s*=", src):
            kinds.setdefault(m.group(1), set()).add("type")
    return kinds


def _file_kinds(text: str, kinds):
    """Names as THIS file sees them: its own imports and declarations beat the global map."""
    local = {}
    for m in re.finditer(r"\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", text):
        is_type, names, mod = m.group(1), m.group(2), m.group(3)
        for name in names.split(","):
            name = name.strip()
            is_type_name = is_type or name.startswith("type ")
            name = name.removeprefix("type ").split(" as ")[-1].strip()
            if not name:
                continue
            if is_type_name:
                local[name] = {"import-type"}
            elif not mod.startswith("."):
                local[name] = {"class"}  # a value import from a package carries its own token
    merged = {k: set(v) for k, v in kinds.items()}
    for k, v in local.items():
        merged[k] = v
    for m in re.finditer(r"\binterface\s+(\w+)", text):
        merged[m.group(1)] = {"interface"}
    for m in re.finditer(r"\btype\s+(\w+)\s*(?:<[^=]*>)?\s*=", text):
        merged[m.group(1)] = {"type"}
    for m in re.finditer(r"\b(?:abstract\s+)?class\s+(\w+)", text):
        merged[m.group(1)] = {"class"}
    return merged


def offences_in(src: str, kinds, label: str):
    text = _strip_comments(src)
    kinds = _file_kinds(text, kinds)
    found = []
    for cm in re.finditer(r"\bconstructor\s*\(", text):
        open_i = cm.end() - 1
        close_i = _match_close(text, open_i)
        if close_i < 0:
            continue
        for param in _split_top(text[open_i + 1 : close_i]):
            if "@Optional" not in param or re.search(r"@Inject\s*\(", param):
                continue
            body = re.sub(r"@\w+\s*\([^)]*\)", " ", param)
            body = re.sub(r"\b(private|public|protected|readonly)\b", " ", body)
            tm = re.match(r"\s*(\w+)\s*\??\s*:\s*(.+?)\s*(?:=.*)?$", body, re.S)
            if not tm:
                continue
            name, typ = tm.group(1), tm.group(2).strip()
            why = None
            # `T | null` / `T | undefined` still emit T as metadata; only a real union loses it.
            typ = re.sub(r"\s*\|\s*(null|undefined)\b", "", typ).strip()
            if UTILITY.match(typ):
                why = "utility type"
            elif typ.startswith(("{", "(")) or "|" in typ or "=>" in typ:
                why = "inline/union type"
            else:
                ident = re.match(r"^(\w+)", typ)
                k = kinds.get(ident.group(1), set()) if ident else set()
                if "class" not in k and k & {"interface", "type", "import-type"}:
                    why = "interface/type alias"
            if why:
                line = text[: cm.start()].count("\n") + 1
                found.append((label, line, name, typ.replace("\n", " ")[:60], why))
    return found


def run():
    files = [p for p in SRC.rglob("*.ts") if "node_modules" not in p.parts]
    if not files:
        print("optional-inject guard: no files under apps/api-gateway/src", file=sys.stderr)
        return 2
    sources = {p: p.read_text(encoding="utf-8", errors="replace") for p in files}
    kinds = declared_kinds(_strip_comments(s) for s in sources.values())
    bad = []
    for p, s in sources.items():
        if p.name.endswith(".spec.ts"):
            continue
        bad += offences_in(s, kinds, str(p.relative_to(ROOT)))
    for label, line, name, typ, why in sorted(bad):
        print(f"NO-TOKEN {label}:{line} @Optional() {name}: {typ}  ({why}; add @Inject(TheClass))")
    if bad:
        print(f"{len(bad)} @Optional() parameter(s) would be injected as undefined.")
        return 1
    print(f"optional-inject guard: clean ({len(files)} files scanned).")
    return 0


def self_test():
    kinds = {"Svc": {"class"}, "IFace": {"interface"}, "Alias": {"type"}}
    cases = [
        ("@Optional() a?: Pick<Svc, 'x'>", True),
        ("@Optional() a?: Partial<Svc>", True),
        ("@Optional() a?: Omit<Svc, 'x'>", True),
        ("@Optional() a?: IFace", True),
        ("@Optional() a: Alias", True),
        ("@Optional() a?: { x(): void }", True),
        ("@Optional() a?: Svc | null", False),
        ("@Optional() a?: Svc | Other", True),
        ("@Optional() a?: Pick<Svc, 'x'> | null", True),
        ("@Optional() @Inject(Svc) a?: Pick<Svc, 'x'>", False),
        ("@Optional() a?: Svc", False),
        ("private readonly b: Pick<Svc, 'x'>", False),
        ("@Optional() @Inject('T') a?: IFace", False),
    ]
    bad = 0
    for params, expect in cases:
        got = bool(offences_in(f"class C {{ constructor({params}) {{}} }}", kinds, "t"))
        if got != expect:
            print(f"SELF-TEST FAIL: {params!r} expected {'flag' if expect else 'clean'}")
            bad += 1
    multi = "class C { constructor(private readonly s: Svc,\n @Optional() a?: Pick<Svc, 'x' | 'y'>,\n @Optional() b?: Svc) {} }"
    if len(offences_in(multi, kinds, "t")) != 1:
        print("SELF-TEST FAIL: multi-parameter constructor")
        bad += 1
    print("self-test " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else run())
