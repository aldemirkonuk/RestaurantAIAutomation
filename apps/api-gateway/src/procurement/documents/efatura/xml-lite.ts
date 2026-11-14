/**
 * A small, strict XML reader for e-invoice files (UBL-TR).
 *
 * WHY NOT A LIBRARY: the gateway carries no XML parser, and the e-invoice is
 * the one XML it reads. Adding one means a dependency in the gateway image
 * (`apps/api-gateway/Dockerfile` installs only the gateway's own manifest).
 * UBL is plain, namespaced, well-formed XML, which this reads in ~150 lines.
 *
 * SAFE BY REFUSAL. A `<!DOCTYPE` (and so any `<!ENTITY`) is refused outright:
 * no entity is ever expanded, so neither an external entity (XXE) nor a
 * billion-laughs expansion can happen. Only the five predefined entities and
 * numeric character references are decoded. Size is capped by the caller.
 *
 * Namespaces are reduced to LOCAL names (`cbc:ID` → `ID`): UBL-TR documents
 * use the standard UBL namespaces and no two elements a reader asks for share
 * a local name in a way the path below cannot tell apart.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export class XmlRefused extends Error {}

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, e) => {
    switch (e) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const code =
      e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : "";
  });
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parse a whole document; throws `XmlRefused` with a sentence on bad input. */
export function parseXml(xml: string): XmlElement {
  const src = xml.replace(/^﻿/, "");
  if (/<!DOCTYPE/i.test(src))
    throw new XmlRefused(
      "The file declares a DOCTYPE, which an e-invoice never needs; it was not read.",
    );
  const root: XmlElement = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) throw new XmlRefused("A comment in the file is never closed.");
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) throw new XmlRefused("A CDATA section in the file is never closed.");
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end < 0) throw new XmlRefused("A processing instruction is never closed.");
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!", lt))
      throw new XmlRefused("The file carries a declaration an e-invoice never needs.");
    const gt = findTagEnd(src, lt + 1);
    if (gt < 0) throw new XmlRefused("A tag in the file is never closed.");
    const body = src.slice(lt + 1, gt);
    i = gt + 1;
    if (body.startsWith("/")) {
      const name = localName(body.slice(1).trim());
      const open = stack.pop();
      if (!open || open === root || open.name !== name)
        throw new XmlRefused(
          `The file closes <${name}> where <${open?.name ?? "nothing"}> is open; it is not well-formed.`,
        );
      continue;
    }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const m = /^([^\s/>]+)/.exec(inner);
    if (!m) throw new XmlRefused("A tag in the file has no name.");
    const el: XmlElement = {
      name: localName(m[1]),
      attrs: {},
      children: [],
      text: "",
    };
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    const rest = inner.slice(m[1].length);
    while ((a = ATTR_RE.exec(rest)))
      el.attrs[localName(a[1])] = decodeEntities(a[3] ?? a[4] ?? "");
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length !== 1)
    throw new XmlRefused(
      `The file ends with <${stack[stack.length - 1].name}> still open; it is cut short or not well-formed.`,
    );
  const top = root.children;
  if (top.length !== 1)
    throw new XmlRefused("The file does not hold exactly one top element.");
  return top[0];
}

/** The `>` that ends a tag, skipping quoted attribute values. */
function findTagEnd(src: string, from: number): number {
  let q: string | null = null;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return j;
  }
  return -1;
}

/** The first child at a `/`-separated path of local names, or null. */
export function at(el: XmlElement | null | undefined, path: string): XmlElement | null {
  let cur: XmlElement | null = el ?? null;
  for (const part of path.split("/")) {
    if (!cur) return null;
    cur = cur.children.find((c) => c.name === part) ?? null;
  }
  return cur;
}

/** Every child at the LAST step of a path. */
export function all(el: XmlElement | null | undefined, path: string): XmlElement[] {
  const parts = path.split("/");
  const last = parts.pop() as string;
  const parent = parts.length ? at(el, parts.join("/")) : (el ?? null);
  return parent ? parent.children.filter((c) => c.name === last) : [];
}

/** Trimmed text at a path, or null when absent or blank. */
export function textAt(el: XmlElement | null | undefined, path: string): string | null {
  const t = at(el, path)?.text.trim();
  return t ? t : null;
}
