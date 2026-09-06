/**
 * The classification rule, on its own, with no database and no Nest.
 *
 * It is a pure function because the rule is the valuable part: "server-declared,
 * manager-confirmed, re-consent on change" is one decision, and a decision
 * spread across a controller, a service and a table is a decision nobody can
 * read. Everything here is the founder's rule of 2026-09-04 stated as an
 * assertion.
 */

import {
  confirmClassification,
  declaredClassification,
  describeAnnotationChange,
  fingerprintTool,
  fingerprintToolList,
} from "./tool-classification";
import type { McpToolAnnotations, McpToolSummary } from "./mcp-runtime.types";

function tool(
  name: string,
  annotations: Partial<McpToolAnnotations> | null,
): McpToolSummary {
  return {
    name,
    title: null,
    description: null,
    annotations: annotations
      ? {
          readOnlyHint: null,
          destructiveHint: null,
          idempotentHint: null,
          openWorldHint: null,
          ...annotations,
        }
      : null,
  };
}

describe("what the server declared", () => {
  it("reads readOnlyHint: true as a read, and says so in the server's terms", () => {
    const d = declaredClassification(tool("list_orders", { readOnlyHint: true }));
    expect(d.declaredRead).toBe(true);
    expect(d.writes).toBe(false);
    expect(d.basis).toContain("readOnlyHint: true");
  });

  it("reads readOnlyHint: false as a write", () => {
    const d = declaredClassification(tool("send_po", { readOnlyHint: false }));
    expect(d.declaredRead).toBe(false);
    expect(d.writes).toBe(true);
  });

  it("treats a tool with NO annotations as a write, citing the protocol default", () => {
    const d = declaredClassification(tool("mystery", null));
    expect(d.writes).toBe(true);
    expect(d.declaredRead).toBe(false);
    expect(d.basis).toContain("default");
  });

  it("treats annotations WITHOUT a readOnlyHint as a write", () => {
    const d = declaredClassification(tool("half_said", { openWorldHint: true }));
    expect(d.writes).toBe(true);
  });

  it("treats a tool the server never listed as a write", () => {
    const d = declaredClassification(null);
    expect(d.writes).toBe(true);
    expect(d.basis).toContain("has not listed");
  });

  it("does not coerce a non-boolean hint into a permission", () => {
    // The runtime parser is what drops a `readOnlyHint: "true"`; this asserts
    // the classifier never sees a truthy string as an affirmation.
    const malformed = {
      name: "x",
      title: null,
      description: null,
      annotations: {
        readOnlyHint: "true",
        destructiveHint: null,
        idempotentHint: null,
        openWorldHint: null,
      },
    } as unknown as McpToolSummary;
    expect(declaredClassification(malformed).writes).toBe(true);
  });
});

describe("what the manager may confirm", () => {
  it("lets a manager accept a declared read as a read", () => {
    const d = declaredClassification(tool("list", { readOnlyHint: true }));
    const c = confirmClassification(d, false);
    expect(c).toMatchObject({ ok: true, writes: false, source: "declared" });
  });

  it("lets a manager TIGHTEN a declared read into a write, and records it", () => {
    const d = declaredClassification(tool("list", { readOnlyHint: true }));
    const c = confirmClassification(d, true);
    expect(c).toMatchObject({
      ok: true,
      writes: true,
      source: "manager_override",
    });
  });

  it("REFUSES a manager loosening a declared write into a read", () => {
    const d = declaredClassification(tool("send_po", { readOnlyHint: false }));
    const c = confirmClassification(d, false);
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.refusal).toContain("never a declared write a read");
    }
  });

  it("REFUSES a read classification for an unannotated tool", () => {
    const c = confirmClassification(declaredClassification(tool("x", null)), false);
    expect(c.ok).toBe(false);
  });

  it("REFUSES a read classification for a tool the server never listed", () => {
    const c = confirmClassification(declaredClassification(null), false);
    expect(c.ok).toBe(false);
  });
});

describe("what counts as a change", () => {
  it("moves when an annotation moves", () => {
    const before = fingerprintTool(tool("t", { readOnlyHint: true }));
    const after = fingerprintTool(tool("t", { readOnlyHint: false }));
    expect(before).not.toEqual(after);
  });

  it("does NOT move when only the description changes", () => {
    const a = tool("t", { readOnlyHint: true });
    const b = { ...tool("t", { readOnlyHint: true }), description: "reworded" };
    expect(fingerprintTool(a)).toEqual(fingerprintTool(b));
  });

  it("distinguishes 'no annotations' from 'annotations with nothing set'", () => {
    expect(fingerprintTool(tool("t", null))).not.toEqual(
      fingerprintTool(tool("t", {})),
    );
  });

  it("does not move the list hash when the server reorders the same tools", () => {
    const a = [tool("a", { readOnlyHint: true }), tool("b", null)];
    const b = [tool("b", null), tool("a", { readOnlyHint: true })];
    expect(fingerprintToolList(a)).toEqual(fingerprintToolList(b));
  });

  it("moves the list hash when a tool is added", () => {
    const a = [tool("a", { readOnlyHint: true })];
    const b = [tool("a", { readOnlyHint: true }), tool("b", null)];
    expect(fingerprintToolList(a)).not.toEqual(fingerprintToolList(b));
  });
});

describe("what the refusal says", () => {
  const ro = (v: boolean | null): McpToolAnnotations => ({
    readOnlyHint: v,
    destructiveHint: null,
    idempotentHint: null,
    openWorldHint: null,
  });

  it("says nothing when nothing changed", () => {
    expect(describeAnnotationChange(ro(true), ro(true))).toBeNull();
    expect(describeAnnotationChange(null, null)).toBeNull();
  });

  it("names the hint and both values", () => {
    expect(describeAnnotationChange(ro(true), ro(false))).toBe(
      "the server changed readOnlyHint true to false",
    );
  });

  it("says when a hint has been withdrawn rather than flipped", () => {
    expect(describeAnnotationChange(ro(true), ro(null))).toBe(
      "the server changed readOnlyHint true to unstated",
    );
  });

  it("says when annotations appeared or disappeared entirely", () => {
    expect(describeAnnotationChange(null, ro(false))).toContain(
      "sent none when the grant was made",
    );
    expect(describeAnnotationChange(ro(true), null)).toContain(
      "no longer sends any annotations",
    );
  });
});
