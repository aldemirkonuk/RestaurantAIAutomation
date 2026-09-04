/**
 * Who says a tool is a write — and what happens when that answer changes.
 *
 * THE RULE (founder, 2026-09-04; ADR 0107 addendum)
 * ------------------------------------------------
 *     "Server-declared, manager-confirmed, re-consent on change."
 *
 * Three sentences, and every function in this file is one of them:
 *
 *   1. The SERVER's own annotation is the DEFAULT classification. `tools/list`
 *      may carry `annotations.readOnlyHint` / `destructiveHint`; the spec calls
 *      them "optional properties describing tool behavior"
 *      (https://modelcontextprotocol.io/specification/2025-06-18/server/tools,
 *      §Data Types → Tool).
 *   2. The granting MANAGER confirms each grant while seeing that default. A
 *      manager may turn a declared read into a write. Never the reverse — see
 *      `confirmClassification`.
 *   3. A CHANGED declaration suspends the grant until a manager consents to the
 *      new one. `fingerprintTool` is what "changed" is measured against and
 *      `describeAnnotationChange` is what the refusal says out loud.
 *
 * WHY AN UNKNOWN ANNOTATION IS A WRITE
 * ------------------------------------
 * Two independent reasons, and either alone would be enough.
 *
 * The spec's own default says so. `readOnlyHint` defaults to `false` and
 * `destructiveHint` defaults to `true`
 * (schema/2025-06-18/schema.ts:881-923 — "If true, the tool does not modify its
 * environment. Default: false"). A tool with no annotations is therefore, by
 * the protocol's own reading, a possibly-destructive tool. Treating silence as
 * a read would be inventing a permission the server never granted.
 *
 * And the same spec section warns that a client "MUST consider tool
 * annotations to be untrusted unless they come from trusted servers". An
 * annotation is evidence about a tool, not authority over it — which is
 * exactly why it is the default a person confirms, and not the decision
 * itself. This is the absence-reported-as-health fault in its most expensive
 * form: a tool nobody classified is the one that spends money.
 */

import { createHash } from "crypto";
import type { McpToolAnnotations, McpToolSummary } from "./mcp-runtime.types";

/** What the SERVER said, before any person looked at it. */
export interface DeclaredClassification {
  /** TRUE only when the server explicitly declared `readOnlyHint: true`. */
  declaredRead: boolean;
  /** The default classification: the inverse of `declaredRead`. */
  writes: boolean;
  /** Why, in words a manager reads on the grant control. */
  basis: string;
}

/**
 * The server's declaration for one tool.
 *
 * `tool === null` means the tool is not in the last probe's list at all —
 * either the server never listed it, or it has never been probed. Both are
 * "nothing was declared", which is a write.
 */
export function declaredClassification(
  tool: McpToolSummary | null,
): DeclaredClassification {
  if (!tool) {
    return {
      declaredRead: false,
      writes: true,
      basis:
        "This server has not listed that tool, so it has declared nothing about it. An undeclared tool is classified as a write.",
    };
  }

  const a = tool.annotations;
  if (!a) {
    return {
      declaredRead: false,
      writes: true,
      basis:
        "The server lists this tool with no annotations, so it did not say whether it is read-only. The protocol's own default for an absent readOnlyHint is false, so it is classified as a write.",
    };
  }
  if (a.readOnlyHint === true) {
    return {
      declaredRead: true,
      writes: false,
      basis:
        "The server declares this tool readOnlyHint: true — it says the tool does not modify its environment.",
    };
  }
  if (a.readOnlyHint === false) {
    return {
      declaredRead: false,
      writes: true,
      basis:
        a.destructiveHint === false
          ? "The server declares readOnlyHint: false with destructiveHint: false — it changes its environment, additively. It is classified as a write."
          : "The server declares readOnlyHint: false — it changes its environment. It is classified as a write.",
    };
  }
  return {
    declaredRead: false,
    writes: true,
    basis:
      "The server sent annotations without a readOnlyHint, so it did not answer the question. An unanswered declaration is classified as a write.",
  };
}

/** The outcome of a manager confirming — or refusing — the default. */
export type ConfirmedClassification =
  | {
      ok: true;
      writes: boolean;
      /** 'declared' when the manager accepted the default. */
      source: "declared" | "manager_override";
      basis: string;
    }
  | { ok: false; refusal: string };

/**
 * Apply the manager's answer to the server's declaration.
 *
 * The one asymmetry is the point of the whole design: a manager may tighten
 * (a declared read becomes a write, and then needs the seal) and may never
 * loosen (a declared write becomes a read, and then runs unattended). A
 * loosening would let one careless grant undo every guard behind it, and it is
 * refused here rather than warned about.
 */
export function confirmClassification(
  declared: DeclaredClassification,
  managerSaysWrites: boolean,
): ConfirmedClassification {
  if (managerSaysWrites) {
    return {
      ok: true,
      writes: true,
      source: declared.declaredRead ? "manager_override" : "declared",
      basis: declared.declaredRead
        ? `${declared.basis} The granting manager classified it as a write anyway, which is the only direction an override may go.`
        : declared.basis,
    };
  }
  if (!declared.declaredRead) {
    return {
      ok: false,
      refusal: `${declared.basis} A grant cannot classify it as a read: a manager may make a declared read a write, never a declared write a read.`,
    };
  }
  return { ok: true, writes: false, source: "declared", basis: declared.basis };
}

/**
 * A stable fingerprint of ONE tool's declaration.
 *
 * Name plus the four hints, and deliberately not the description: a server
 * rewording its own help text has not changed what the tool does, and
 * suspending a grant for a typo fix would train people to click through the
 * re-consent that matters. The name is folded to lower case because the grant
 * is matched case-insensitively.
 */
export function fingerprintTool(tool: McpToolSummary): string {
  const a: McpToolAnnotations | null = tool.annotations;
  const canonical = JSON.stringify([
    tool.name.trim().toLowerCase(),
    a ? a.readOnlyHint : "no-annotations",
    a ? a.destructiveHint : "no-annotations",
    a ? a.idempotentHint : "no-annotations",
    a ? a.openWorldHint : "no-annotations",
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * A fingerprint of the WHOLE list as it stood at grant time.
 *
 * Recorded on every grant so that "what did this server offer when we agreed
 * to this?" is answerable after the fact. It is NOT what the gate compares —
 * the gate compares per-tool fingerprints, because a server adding an
 * unrelated tool must not suspend a grant nobody touched. Sorted, so the order
 * a server happens to return its tools in is not mistaken for a change.
 */
export function fingerprintToolList(tools: McpToolSummary[]): string {
  const parts = tools
    .map((t) => `${t.name.trim().toLowerCase()}:${fingerprintTool(t)}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
}

/**
 * What changed between the declaration a grant was made against and the one
 * the server offers now — in words, because "fingerprint mismatch" is not
 * something a manager can consent to.
 *
 * Returns null when the two declarations say the same thing.
 */
export function describeAnnotationChange(
  granted: McpToolAnnotations | null,
  now: McpToolAnnotations | null,
): string | null {
  const word = (v: boolean | null): string =>
    v === null ? "unstated" : String(v);

  if (!granted && !now) return null;
  if (!granted && now) {
    return `the server now sends annotations for it (readOnlyHint ${word(now.readOnlyHint)}), and sent none when the grant was made`;
  }
  if (granted && !now) {
    return "the server no longer sends any annotations for it, so it has stopped declaring whether it is read-only";
  }

  const g = granted as McpToolAnnotations;
  const n = now as McpToolAnnotations;
  const changes: string[] = [];
  const fields: Array<[keyof McpToolAnnotations, string]> = [
    ["readOnlyHint", "readOnlyHint"],
    ["destructiveHint", "destructiveHint"],
    ["idempotentHint", "idempotentHint"],
    ["openWorldHint", "openWorldHint"],
  ];
  for (const [key, label] of fields) {
    if (g[key] !== n[key]) {
      changes.push(`${label} ${word(g[key])} to ${word(n[key])}`);
    }
  }
  return changes.length ? `the server changed ${changes.join(", ")}` : null;
}
