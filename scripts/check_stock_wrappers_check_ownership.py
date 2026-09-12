#!/usr/bin/env python3
"""Every gateway call site that can move stock without the database refusing on
the caller's behalf has been REVIEWED, and says how it proves ownership.

WHY (ADR 0141 and its two corrections, PR #361)
-----------------------------------------------
`apply_stock_movement` refuses a mismatched house only when the caller passes
`p_restaurant_id`. Four SQL wrappers call it WITHOUT one and derive the house
from the item they are handed -- `record_stock_count`, `record_glass_pour`,
`transfer_stock`, `set_stock_absolute` -- so for those the gateway's own check is
the only check there is. The first adversarial pass found four routes that had
none. The second found two more, and found that this guard could not have seen
them: it hard-coded five method names, so a sixth route was invisible by design.
`updateInventoryItem` was exactly that sixth route.

WHAT IT CHECKS
--------------
1. Every string literal in `apps/api-gateway/src` (excluding `*.spec.ts`) that
   is exactly one of the four wrapper names is a call site. Matching the LITERAL,
   not `.rpc(`, means `client["rp" + "c"]("record_glass_pour", ...)` and a call
   spelled across lines are both found. Each site's enclosing method must be on
   ALLOWLIST, keyed (file, method), with a one-line reason. A site anywhere else
   fails: a new stock-moving call site must be reviewed and added.
2. Every `"apply_stock_movement"` literal must be followed by an inline argument
   object that passes `p_restaurant_id` at its top level. A site whose arguments
   are not an inline object cannot be checked and fails.
3. Every `.from("pos_item_mappings")` immediately followed by `.insert(`,
   `.upsert(` or `.update(` must be on MAPPING_WRITERS: a mapping's inventory id
   is what the POS depletion paths later pour from.
4. For entries whose kind is "assert", mechanically, per site:
     - the file imports `assertInventoryBelongsToRestaurant` from
       common/tenant and declares nothing else by that name;
     - an `await assertInventoryBelongsToRestaurant(` appears BEFORE the site,
       as a statement of its own (preceded by `{`, `}` or `;` -- so `void`,
       a braceless `if (false)`, `else`, `&&` and `?` do not count);
     - every block between the method body and that statement is a `try` or a
       `for` loop, and the statement's innermost block also contains the site --
       so `if (false) { ... }`, a callback, or a `try` whose `catch` swallows the
       refusal before the RPC do not count;
     - for wrapper sites, the item it asserts is textually the same expression
       the RPC passes as `p_inventory_id`.
   Comments are stripped by a lexer before any of this, so a comment naming the
   check is not the check.

WHAT IT DOES NOT CHECK -- the specs are the backstop, and are named per entry
------------------------------------------------------------------------------
- Entries whose kind is "scoped" (the ids come from a read filtered by the
  house, or a scoped read refuses) are REVIEWED, not proven. Nothing here can
  tell a `.eq("restaurant_id", ...)` that filters from one that does not reach
  the id. Their specs pair a refusal with a control on a mock that honours
  `.eq` / `.in`, and fail if the filter or the refusal is removed.
- The VALUE passed as `p_restaurant_id` -- only that one is passed.
- A wrapper name assembled at runtime ("record_" + "glass_pour"), or an RPC
  reached through a helper in another file. The allowlist is only as good as the
  literal search that feeds it.
- Class members are recognised at prettier's two-space indentation and
  functions at column 0; a call site inside anything else has no recognised
  method and FAILS as unreviewed, never passes.

Exit 0 pass, 1 fail, 2 COULD NOT CHECK (a missing tree, no call sites found at
all, or an allowlisted method that no longer exists or no longer makes the call
-- the guard then no longer describes the tree, which is not a pass).

Usage: check_stock_wrappers_check_ownership.py [--root REPO_ROOT]
"""
import os
import re
import sys

WRAPPERS = ("record_stock_count", "record_glass_pour", "transfer_stock", "set_stock_absolute")
PRIMITIVE = "apply_stock_movement"
ASSERT = "assertInventoryBelongsToRestaurant"
ASSERT_MODULE = "common/tenant/assert-inventory-belongs-to-restaurant"

# (file relative to apps/api-gateway/src, method, the call it makes) -> (kind, reason)
# kind "assert": proven mechanically (check 4). kind "scoped": reviewed, spec-backed.
ALLOWLIST = {
    ("inventory/inventory.service.ts", "recordPour", "record_glass_pour"): (
        "assert", "asserts the URL's item belongs to the caller before the RPC"),
    ("inventory/inventory.service.ts", "transferStock", "transfer_stock"): (
        "assert", "asserts the URL's item belongs to the caller before the RPC"),
    ("inventory/inventory.service.ts", "recordSpotCount", "record_stock_count"): (
        "assert", "asserts the URL's item belongs to the caller before the RPC"),
    ("inventory/inventory.service.ts", "updateInventoryItem", "set_stock_absolute"): (
        "assert", "asserts the URL's item first, before the UPDATE and the RPC (second correction)"),
    ("inventory-ledger/inventory-ledger.service.ts", "reconcileInventory", "record_stock_count"): (
        "assert", "asserts the URL's item belongs to the caller before the RPC"),
    ("pos-hub/pos-hub.service.ts", "applyStockEffects", "record_glass_pour"): (
        "scoped", "pours only an id the house-scoped loadInventoryVolumes returned; anything else is queued "
                  "(mapping-inventory-ids-belong-to-the-house.spec.ts)"),
    ("toast/toast.service.ts", "applyOrderSaleEffects", "record_glass_pour"): (
        "scoped", "a read scoped to the house must return the mapping's item or the line is queued "
                  "(mapping-inventory-ids-belong-to-the-house.spec.ts)"),
    # apply_stock_movement sites need only p_restaurant_id (check 2); this one
    # also carries a gateway assert, which is checked because it is listed.
    ("inventory-ledger/inventory-ledger.service.ts", "createTransaction", "apply_stock_movement"): (
        "assert", "asserts the DTO's item belongs to the caller before the RPC"),
}

MAPPING_WRITERS = {
    ("pos-hub/pos-hub.service.ts", "upsertItemMapping", "pos_item_mappings"): (
        "assert", "the ONE writer of pos_item_mappings.inventory_id: asserts a named item before the upsert"),
}

KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try",
            "new", "typeof", "await", "yield", "with", "super", "import", "export"}


class CannotCheck(Exception):
    pass


def lex(src):
    """Return (code, strings): `code` is src with comments, strings, template
    text and regex literals blanked to spaces (newlines kept, so offsets hold);
    `strings` is a list of (start, end, value) for every quoted or template
    literal with no `${`. Comments are dropped entirely."""
    n = len(src)
    out = list(src)
    strings = []

    def blank(a, b):
        for k in range(a, b):
            if out[k] != "\n":
                out[k] = " "

    i = 0
    prev_sig = ""  # last significant code character, for regex detection
    prev_word = ""
    stack = []  # template-expression brace depths
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            blank(i, j)
            i = j
            continue
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            if j < 0:
                raise CannotCheck("unterminated block comment")
            blank(i, j + 2)
            i = j + 2
            continue
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == "\\":
                    j += 1
                elif src[j] == "\n":
                    raise CannotCheck("unterminated string literal")
                j += 1
            strings.append((i, j + 1, src[i + 1:j]))
            blank(i, j + 1)
            i = j + 1
            prev_sig, prev_word = "a", ""
            continue
        if c == "`":
            j = i + 1
            plain = True
            depth = 0
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if depth == 0 and src[j] == "`":
                    break
                if src[j:j + 2] == "${":
                    plain = False
                    depth += 1
                    j += 2
                    continue
                if depth > 0 and src[j] == "{":
                    depth += 1
                elif depth > 0 and src[j] == "}":
                    depth -= 1
                j += 1
            if j >= n:
                raise CannotCheck("unterminated template literal")
            if plain:
                strings.append((i, j + 1, src[i + 1:j]))
            blank(i, j + 1)
            i = j + 1
            prev_sig, prev_word = "a", ""
            continue
        if c == "/" and (prev_sig == "" or prev_sig in "(,=:[!&|?{};+-*%<>~^" or prev_word in ("return", "typeof")):
            j = i + 1
            in_class = False
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "\n":
                    raise CannotCheck("unterminated regex literal")
                if src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                elif src[j] == "/" and not in_class:
                    break
                j += 1
            j += 1
            while j < n and src[j].isalpha():
                j += 1
            blank(i, j)
            i = j
            prev_sig, prev_word = "a", ""
            continue
        if not c.isspace():
            if c.isalnum() or c in "_$":
                m = re.match(r"[A-Za-z0-9_$]+", src[i:])
                prev_word = m.group(0)
                prev_sig = "a"
                i += len(prev_word)
                continue
            prev_sig, prev_word = c, ""
        i += 1
    return "".join(out), strings


def match_forward(code, i, open_ch, close_ch):
    depth = 0
    for j in range(i, len(code)):
        if code[j] == open_ch:
            depth += 1
        elif code[j] == close_ch:
            depth -= 1
            if depth == 0:
                return j
    raise CannotCheck("unbalanced %s%s" % (open_ch, close_ch))


def match_backward(code, i, open_ch, close_ch):
    depth = 0
    for j in range(i, -1, -1):
        if code[j] == close_ch:
            depth += 1
        elif code[j] == open_ch:
            depth -= 1
            if depth == 0:
                return j
    raise CannotCheck("unbalanced %s%s" % (open_ch, close_ch))


def prev_nonspace(code, i):
    j = i - 1
    while j >= 0 and code[j].isspace():
        j -= 1
    return j


def body_after_params(code, close_paren):
    """Find the `{` that opens a function body after its parameter list."""
    j = close_paren + 1
    depth = 0
    while j < len(code):
        ch = code[j]
        if ch in "<([":
            depth += 1
        elif ch in ">)]":
            if ch == ">" and code[j - 1] == "=":  # `=>`
                pass
            else:
                depth -= 1
        elif ch == "{":
            p = prev_nonspace(code, j)
            is_type = depth > 0 or (p >= 0 and code[p] in ":|&<,(")
            if not is_type:
                return j
            j = match_forward(code, j, "{", "}")
        elif ch == ";" and depth <= 0:
            return None  # an overload signature or abstract member
        j += 1
    return None


def scopes(code):
    found = []
    member = re.compile(
        r"^  (?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^\n()]*>)?\s*\(",
        re.M)
    func = re.compile(
        r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^\n()]*>)?\s*\(",
        re.M)
    arrow = re.compile(
        r"^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?\(",
        re.M)
    for rx in (member, func, arrow):
        for m in rx.finditer(code):
            name = m.group(1)
            if name in KEYWORDS:
                continue
            open_paren = m.end() - 1
            close_paren = match_forward(code, open_paren, "(", ")")
            b = body_after_params(code, close_paren)
            if b is None:
                continue
            found.append((name, m.start(), b, match_forward(code, b, "{", "}")))
    return found


def enclosing(scope_list, pos):
    best = None
    for s in scope_list:
        if s[2] < pos < s[3] and (best is None or s[3] - s[2] < best[3] - best[2]):
            best = s
    return best


def top_level_args(code, open_paren):
    close = match_forward(code, open_paren, "(", ")")
    args, depth, start = [], 0, open_paren + 1
    for j in range(open_paren + 1, close):
        ch = code[j]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            args.append((start, j))
            start = j + 1
    args.append((start, close))
    return args


def object_after(code, token_end):
    """The inline object literal passed right after an RPC-name literal."""
    j = token_end
    while j < len(code) and code[j].isspace():
        j += 1
    if j >= len(code) or code[j] != ",":
        return None
    j += 1
    while j < len(code) and code[j].isspace():
        j += 1
    if j >= len(code) or code[j] != "{":
        return None
    return j, match_forward(code, j, "{", "}")


def top_level_key(code, src, obj, key):
    """Return the source text of `key`'s value at the top level of an object."""
    a, b = obj
    depth = 0
    j = a + 1
    while j < b:
        ch = code[j]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0 and code.startswith(key, j) and not (code[j - 1].isalnum() or code[j - 1] in "_$"):
            k = j + len(key)
            while k < b and code[k].isspace():
                k += 1
            if k < b and code[k] in ",}":
                return key  # shorthand
            if k < b and code[k] == ":":
                v, d = k + 1, 0
                while v < b:
                    if code[v] in "([{":
                        d += 1
                    elif code[v] in ")]}":
                        if d == 0:
                            break
                        d -= 1
                    elif code[v] == "," and d == 0:
                        break
                    v += 1
                return src[k + 1:v].strip()
        j += 1
    return None


def blocks_containing(code, lo, hi, pos):
    """(open, close) of every block in [lo, hi] that contains pos, innermost
    first; the method body itself (opening at lo) is the last one."""
    out = []
    stack = []
    for j in range(lo, hi + 1):
        if code[j] == "{":
            stack.append(j)
        elif code[j] == "}":
            a = stack.pop() if stack else None
            if a is not None and a < pos < j:
                out.append((a, j))
    return sorted(out, key=lambda ab: -ab[0])


def block_kind(code, brace):
    p = prev_nonspace(code, brace)
    if p < 0:
        return "other"
    if code[p] == ")":
        o = match_backward(code, p, "(", ")")
        q = prev_nonspace(code, o)
        m = re.search(r"([A-Za-z_$][\w$]*)$", code[:q + 1])
        return m.group(1) if m else "other"
    m = re.search(r"([A-Za-z_$][\w$]*)$", code[:p + 1])
    return m.group(1) if m else "other"


def norm(text):
    return re.sub(r"\s+", "", text)


def if_condition(code, brace):
    p = prev_nonspace(code, brace)
    if p < 0 or code[p] != ")":
        return None
    return norm(code[match_backward(code, p, "(", ")") + 1:p])


def assert_precedes(code, src, scope, site, rpc_item, item_suffix=None):
    """True when a qualifying `await assert...(` statement guards `site`.

    One conditional is admitted, because it proves nothing false: the assert
    may sit directly inside `if (<the asserted item>) { ... }` -- no item, no
    stock named, nothing to check. Any other `if`, `else`, `catch`, `while`,
    callback or `switch` between the method body and the assert disqualifies it.
    """
    _, _, lo, hi = scope
    for m in re.finditer(r"\bawait\s+%s\s*\(" % ASSERT, code[lo:hi]):
        a = lo + m.start()
        if a > site:
            break
        p = prev_nonspace(code, a)
        if p < 0 or code[p] not in "{};":
            continue
        args = top_level_args(code, lo + m.end() - 1)
        if len(args) < 3:
            continue
        asserted = norm(code[args[2][0]:args[2][1]])
        if rpc_item is not None and asserted != norm(rpc_item):
            continue
        if item_suffix is not None and not asserted.endswith(item_suffix):
            continue
        blocks = blocks_containing(code, lo, hi, a)
        effective, ok, guard_prefix = [], True, True
        for b, e in blocks:
            kind = block_kind(code, b)
            if b == lo:
                effective.append((b, e))
            elif guard_prefix and kind == "if" and if_condition(code, b) == asserted:
                continue
            elif kind in ("try", "for"):
                guard_prefix = False
                effective.append((b, e))
            else:
                ok = False
                break
        if not ok or not effective or not (effective[0][0] < site < effective[0][1]):
            continue
        return True
    return False


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if len(sys.argv) == 3 and sys.argv[1] == "--root":
        root = os.path.abspath(sys.argv[2])
    gw = os.path.join(root, "apps", "api-gateway", "src")
    if not os.path.isdir(gw):
        print("CANNOT CHECK: %s is missing -- not a pass" % gw)
        sys.exit(2)

    bad, seen = [], set()
    wrapper_sites = primitive_sites = 0
    parsed = {}
    for dirpath, dirnames, filenames in os.walk(gw):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", "dist")]
        for f in sorted(filenames):
            if not f.endswith(".ts") or f.endswith(".spec.ts") or f.endswith(".d.ts"):
                continue
            path = os.path.join(dirpath, f)
            rel = os.path.relpath(path, gw).replace(os.sep, "/")
            src = open(path, encoding="utf-8").read()
            names = WRAPPERS + (PRIMITIVE, "pos_item_mappings")
            if not any(nm in src for nm in names):
                continue
            try:
                code, strings = lex(src)
                scope_list = scopes(code)
            except CannotCheck as e:
                print("CANNOT CHECK: %s: %s -- not a pass" % (rel, e))
                sys.exit(2)
            parsed[rel] = (src, code, scope_list)

            def line(pos):
                return src.count("\n", 0, pos) + 1

            def check_listed(entry_map, key, site, what, rpc_item, item_suffix=None):
                kind, _ = entry_map[key]
                if kind != "assert":
                    return
                imported = re.search(
                    r"import\s*\{[^}]*\b%s\b[^}]*\}\s*from\s*[\"'][./]*%s[\"']" % (ASSERT, re.escape(ASSERT_MODULE)), src)
                shadow = re.search(r"\b(?:const|let|var|function|class)\s+%s\b" % ASSERT, code)
                if not imported or shadow:
                    bad.append("%s:%d %s: %s is not the shared check imported from %s"
                               % (rel, line(site), key[1], ASSERT, ASSERT_MODULE))
                elif not assert_precedes(code, src, scope, site, rpc_item, item_suffix):
                    bad.append("%s:%d %s: %s -- no awaited, unconditional ownership check on the same item runs before it"
                               % (rel, line(site), key[1], what))

            for start, end, value in strings:
                if value in WRAPPERS or value == PRIMITIVE:
                    scope = enclosing(scope_list, start)
                    method = scope[0] if scope else "<no recognised method>"
                    key = (rel, method)
                    if value == PRIMITIVE:
                        primitive_sites += 1
                        obj = object_after(code, end)
                        if obj is None:
                            bad.append("%s:%d %s: %s is not called with an inline argument object, so p_restaurant_id cannot be checked"
                                       % (rel, line(start), method, PRIMITIVE))
                            continue
                        if top_level_key(code, src, obj, "p_restaurant_id") is None:
                            bad.append("%s:%d %s: %s does not pass p_restaurant_id" % (rel, line(start), method, PRIMITIVE))
                        k3 = (rel, method, PRIMITIVE)
                        if k3 in ALLOWLIST:
                            seen.add(k3)
                            item = top_level_key(code, src, obj, "p_inventory_id")
                            check_listed(ALLOWLIST, k3, start, PRIMITIVE, item)
                        continue
                    wrapper_sites += 1
                    key = (rel, method, value)
                    if key not in ALLOWLIST:
                        bad.append("%s:%d %s: calls %s and is not on the allowlist -- a new stock-moving call site must be reviewed and added"
                                   % (rel, line(start), method, value))
                        continue
                    seen.add(key)
                    obj = object_after(code, end)
                    item = top_level_key(code, src, obj, "p_inventory_id") if obj else None
                    if ALLOWLIST[key][0] == "assert" and item is None:
                        bad.append("%s:%d %s: %s has no inline p_inventory_id to match the check against"
                                   % (rel, line(start), method, value))
                        continue
                    check_listed(ALLOWLIST, key, start, value, item)
                elif value == "pos_item_mappings":
                    tail = code[end:]
                    m = re.match(r"\s*\)\s*\.\s*(insert|upsert|update)\s*\(", tail)
                    if not m:
                        continue
                    scope = enclosing(scope_list, start)
                    method = scope[0] if scope else "<no recognised method>"
                    key = (rel, method, "pos_item_mappings")
                    if key not in MAPPING_WRITERS:
                        bad.append("%s:%d %s: writes pos_item_mappings (.%s) and is not on the mapping-writer allowlist -- "
                                   "a new writer of a mapping's inventory id must be reviewed and added"
                                   % (rel, line(start), method, m.group(1)))
                        continue
                    seen.add(key)
                    check_listed(MAPPING_WRITERS, key, start, "the pos_item_mappings write", None, "inventory_id")

    if wrapper_sites == 0 or primitive_sites == 0:
        print("CANNOT CHECK: found %d wrapper and %d apply_stock_movement call sites -- a guard that finds nothing proves nothing"
              % (wrapper_sites, primitive_sites))
        sys.exit(2)
    stale = []
    for key in list(ALLOWLIST) + list(MAPPING_WRITERS):
        if key in seen:
            continue
        rel, method, call = key
        if rel not in parsed or not any(s[0] == method for s in parsed[rel][2]):
            stale.append("CANNOT CHECK: %s no longer defines %s -- the guard no longer describes the tree" % (rel, method))
        else:
            stale.append("CANNOT CHECK: %s.%s is allowlisted for %s but no longer makes that call -- remove or correct the entry"
                         % (rel, method, call))
    if stale:
        # Exit 2 wins -- the allowlist no longer describes the tree -- but any
        # failure found on the way is printed too, never hidden behind it.
        for line_ in stale:
            print(line_)
        for b in bad:
            print("  also FAIL -> " + b)
        sys.exit(2)

    if bad:
        print("FAIL -- a stock path may move another house's stock (ADR 0141):")
        for b in bad:
            print("  -> " + b)
        sys.exit(1)
    print("PASS -- %d wrapper call sites in %d reviewed (method, wrapper) entries, %d apply_stock_movement call sites all naming a house, "
          "%d mapping writer(s) checked." % (wrapper_sites, len([k for k in seen if k[2] in WRAPPERS]), primitive_sites,
                                            len([k for k in seen if k in MAPPING_WRITERS])))
    sys.exit(0)


if __name__ == "__main__":
    main()
