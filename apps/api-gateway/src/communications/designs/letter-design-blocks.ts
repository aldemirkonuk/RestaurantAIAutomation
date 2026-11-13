/**
 * The block catalogue a letter design is made of, and the one place a block is
 * checked (ADR 0357, ADR 0180).
 *
 * A block is `{ id, t, p }`: a stable id, one of twelve types, and a props bag.
 * The server accepts only the props each type declares, with the values each
 * declares. Anything else is refused, not trimmed, so a design on disk is
 * exactly what the editor sent.
 *
 * What is deliberately absent:
 *   - Event and RSVP blocks. Event-prep mail is off until the founder arms it
 *     (ADR 0264), and ADR 0083 forbids a control with no write behind it.
 *   - Invitation merge fields (first_name, invite_code, event_*, team_role) for
 *     the same reason.
 *   - Free URLs and raw markup. A button names a destination from a closed set,
 *     never an address (ADR 0173 D5, ADR 0180 item 4), and text is plain text
 *     (ADR 0170).
 */

export const BLOCK_TYPES = [
  "logo",
  "heading",
  "text",
  "ai",
  "items",
  "numbers",
  "chart",
  "button",
  "callout",
  "divider",
  "signoff",
  "footer",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Merge fields a design may use. Each is filled from a real order at preview. */
export const MERGE_FIELDS = [
  "house_name",
  "contact_name",
  "order_number",
  "order_total",
  "delivery_date",
  "delivery_issue",
  "item",
  "last_price",
  "invoice_number",
  "invoice_total",
  "promotion_title",
] as const;

export const DESIGN_LOOKS = ["paper"] as const;

export const MAX_BLOCKS = 60;
const MAX_TEXT = 2000;

type PropRule =
  | { kind: "text"; max: number; mergeFields?: boolean }
  | { kind: "bool" }
  | { kind: "enum"; values: readonly string[] };

interface BlockSpec {
  label: string;
  hint: string;
  props: Record<string, PropRule>;
  /** The props a new block of this type starts with. */
  make: Record<string, string | boolean>;
}

const TEXT: PropRule = { kind: "text", max: MAX_TEXT, mergeFields: true };

export const BLOCK_SPECS: Record<BlockType, BlockSpec> = {
  logo: {
    label: "Logo",
    hint: "Your mark at the top.",
    props: {
      mark: { kind: "enum", values: ["wave"] },
      align: { kind: "enum", values: ["left", "center"] },
      name: { kind: "bool" },
    },
    make: { mark: "wave", align: "left", name: true },
  },
  heading: {
    label: "Heading",
    hint: "One short, big line.",
    props: { text: { kind: "text", max: 200, mergeFields: true } },
    make: { text: "A short headline" },
  },
  text: {
    label: "Text",
    hint: "Type straight onto the letter.",
    props: { text: TEXT },
    make: { text: "Hello {{contact_name}}," },
  },
  ai: {
    label: "Mudavym line",
    hint: "One friendly line Mudavym writes.",
    props: { tone: { kind: "enum", values: ["warm", "brief", "formal"] } },
    make: { tone: "warm" },
  },
  items: {
    label: "Order items",
    hint: "The order, as a neat table.",
    props: { prices: { kind: "bool" }, total: { kind: "bool" } },
    make: { prices: true, total: true },
  },
  numbers: {
    label: "Key numbers",
    hint: "Three figures, big and clear.",
    props: { set: { kind: "enum", values: ["order", "invoice"] } },
    make: { set: "order" },
  },
  chart: {
    label: "Chart",
    hint: "Bars, a line or a donut.",
    props: {
      kind: { kind: "enum", values: ["bars", "line", "donut"] },
      src: { kind: "enum", values: ["order", "history", "price", "invoice"] },
      title: { kind: "text", max: 120 },
    },
    make: { kind: "bars", src: "order", title: "" },
  },
  button: {
    label: "Button",
    hint: "One clear thing for the vendor to do.",
    props: {
      label: { kind: "text", max: 60 },
      style: { kind: "enum", values: ["solid", "outline", "link"] },
      act: { kind: "enum", values: ["reply", "confirm", "call"] },
    },
    make: { label: "Reply to us", style: "solid", act: "reply" },
  },
  callout: {
    label: "Highlight",
    hint: "A box that stands out.",
    props: {
      text: { kind: "text", max: 600, mergeFields: true },
      tone: { kind: "enum", values: ["info", "good", "warn"] },
    },
    make: { text: "Deliveries are taken 09:00 to 12:00.", tone: "info" },
  },
  divider: {
    label: "Divider",
    hint: "A pause between parts.",
    props: { style: { kind: "enum", values: ["line", "dots", "space"] } },
    make: { style: "line" },
  },
  signoff: {
    label: "Sign-off",
    hint: "How the letter ends.",
    props: { text: { kind: "text", max: 300, mergeFields: true } },
    make: { text: "Thank you,\n{{house_name}}" },
  },
  footer: {
    label: "Footer",
    hint: "Who wrote it, and where you are.",
    props: { address: { kind: "bool" }, note: { kind: "bool" } },
    make: { address: true, note: true },
  },
};

/** What GET /communications/designs/blocks returns. */
export function blockCatalogue() {
  return {
    blocks: BLOCK_TYPES.map((t) => ({
      type: t,
      label: BLOCK_SPECS[t].label,
      hint: BLOCK_SPECS[t].hint,
      defaults: BLOCK_SPECS[t].make,
    })),
    mergeFields: [...MERGE_FIELDS],
    looks: [...DESIGN_LOOKS],
    maxBlocks: MAX_BLOCKS,
  };
}

export interface DesignBlock {
  id: string;
  t: BlockType;
  p: Record<string, string | boolean>;
}

/**
 * Returns the problems with `input`, one sentence each. Empty means valid.
 * Never throws and never edits: the caller decides how to refuse.
 */
export function blockProblems(input: unknown): string[] {
  if (!Array.isArray(input)) return ["blocks must be a list."];
  if (input.length > MAX_BLOCKS) {
    return [`A design holds at most ${MAX_BLOCKS} blocks; this one has ${input.length}.`];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const at = `Block ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${at} is not a block.`);
      return;
    }
    const b = raw as Record<string, unknown>;
    const extra = Object.keys(b).filter((k) => !["id", "t", "p"].includes(k));
    if (extra.length) problems.push(`${at} carries unknown keys (${extra.join(", ")}).`);
    if (typeof b.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id)) {
      problems.push(`${at} needs an id of letters, digits, dash or underscore (up to 64).`);
    } else if (seen.has(b.id)) {
      problems.push(`${at} repeats the id "${b.id}".`);
    } else {
      seen.add(b.id);
    }
    if (typeof b.t !== "string" || !(BLOCK_TYPES as readonly string[]).includes(b.t)) {
      problems.push(`${at} has type "${String(b.t)}", which is not a block type.`);
      return;
    }
    const spec = BLOCK_SPECS[b.t as BlockType];
    const p = b.p;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      problems.push(`${at} (${b.t}) needs its props.`);
      return;
    }
    const props = p as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      if (!(key in spec.props)) problems.push(`${at} (${b.t}) has no "${key}" prop.`);
    }
    for (const [key, rule] of Object.entries(spec.props)) {
      const v = props[key];
      if (v === undefined) continue;
      if (rule.kind === "bool" && typeof v !== "boolean") {
        problems.push(`${at} (${b.t}) "${key}" must be true or false.`);
      } else if (rule.kind === "enum" && !(typeof v === "string" && rule.values.includes(v))) {
        problems.push(`${at} (${b.t}) "${key}" must be one of ${rule.values.join(", ")}.`);
      } else if (rule.kind === "text") {
        if (typeof v !== "string") {
          problems.push(`${at} (${b.t}) "${key}" must be text.`);
        } else if (v.length > rule.max) {
          problems.push(`${at} (${b.t}) "${key}" is over ${rule.max} characters.`);
        } else if (/<\/?[a-z][^>]*>|https?:\/\/|javascript:/i.test(v)) {
          problems.push(`${at} (${b.t}) "${key}" holds markup or an address; letters are plain words.`);
        } else if (rule.mergeFields) {
          for (const m of v.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
            if (!(MERGE_FIELDS as readonly string[]).includes(m[1])) {
              problems.push(`${at} (${b.t}) uses {{${m[1]}}}, which is not a merge field.`);
            }
          }
        }
      }
    }
  });
  return problems;
}
