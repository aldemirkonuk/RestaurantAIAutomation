/**
 * x12-envelope — tokenizer for ANSI X12 interchanges.
 *
 * Everything here is about not guessing. The three ways an X12 parser silently
 * produces wrong numbers:
 *
 *  1. ASSUMING DELIMITERS. `*` and `~` are conventional, not required. The ISA
 *     segment declares them positionally and is the only trustworthy source:
 *     element separator at index 3, component separator at index 104, segment
 *     terminator at index 105. A partner using `|` would otherwise parse as one
 *     enormous element and produce an invoice with no lines rather than an error.
 *
 *  2. IMPLIED DECIMALS. Several money fields (TDS01 totals, SAC05 charges) are
 *     N2 — "52800" means $528.00, not $52,800. Getting this wrong inflates an
 *     invoice a hundredfold, and it will tie out against nothing, which is
 *     exactly why the tie-out check exists. See n2() vs real().
 *
 *  3. POSITIONAL DRIFT. X12 elements are 1-based in every spec, table and
 *     conversation ("BIG02 is the invoice number"). Reading them 0-based off a
 *     JS array is a silent off-by-one that yields plausible garbage — a date
 *     where an invoice number belongs. el() takes the number from the spec.
 *
 * Scope: parsing only. No VAN, no AS2, no 997 generation — connectivity in
 * beverage is a commercial problem, not a technical one, and files arrive here
 * by email attachment, SFTP drop or upload.
 */

export interface X12Delimiters {
  element: string;
  component: string;
  segment: string;
  /** 5010 only; null in 4010 where ISA11 carries the standards identifier. */
  repetition: string | null;
}

export interface X12Segment {
  tag: string;
  /** Raw element strings. Index 0 is element 01 — always read via el(). */
  elements: string[];
}

export interface X12Transaction {
  /** "810", "856", "812", ... */
  setType: string;
  controlNumber: string;
  /** Implementation convention from GS08, e.g. "004010" or "005010". */
  version: string | null;
  segments: X12Segment[];
}

export interface X12Interchange {
  senderId: string;
  receiverId: string;
  controlNumber: string;
  /** "P" production, "T" test. A test file must never post real money. */
  usageIndicator: string;
  delimiters: X12Delimiters;
  transactions: X12Transaction[];
  warnings: string[];
}

const DEFAULT_DELIMITERS: X12Delimiters = {
  element: "*",
  component: ":",
  segment: "~",
  repetition: null,
};

/**
 * Read delimiters from the ISA segment's fixed positions.
 *
 * Returns the conventional defaults when there is no ISA — some partners send a
 * bare ST/SE fragment, and refusing those outright would reject readable files.
 */
export function detectDelimiters(raw: string): {
  delimiters: X12Delimiters;
  hasIsa: boolean;
} {
  const isaAt = raw.indexOf("ISA");
  if (isaAt === -1 || raw.length < isaAt + 106) {
    return { delimiters: { ...DEFAULT_DELIMITERS }, hasIsa: false };
  }
  const element = raw[isaAt + 3];
  const component = raw[isaAt + 104];
  const segment = raw[isaAt + 105];

  // ISA11 is the repetition separator only in 5010. Reading it in a 4010 file
  // would treat the letter "U" as a delimiter and shred every element.
  const version = raw.slice(isaAt + 84, isaAt + 89);
  const isa11 = raw[isaAt + 82];
  const repetition =
    version >= "00501" && isa11 && isa11 !== element ? isa11 : null;

  return {
    delimiters: { element, component, segment, repetition },
    hasIsa: true,
  };
}

/** Split a raw interchange into segments, preserving element order. */
export function tokenize(raw: string, d: X12Delimiters): X12Segment[] {
  return (
    raw
      .split(d.segment)
      // Segment terminators are frequently followed by CRLF for readability; the
      // newline is formatting, not data, and left in place it becomes part of the
      // next segment's tag ("\nBIG" never matches "BIG").
      .map((s) => s.replace(/[\r\n]+/g, "").trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const parts = s.split(d.element);
        return {
          tag: (parts[0] || "").trim().toUpperCase(),
          elements: parts.slice(1),
        };
      })
      .filter((s) => s.tag.length > 0)
  );
}

/**
 * Element by its X12 position, 1-based as every spec states it.
 * BIG02 is el(seg, 2). Returns null for absent or empty, never "".
 */
export function el(seg: X12Segment | undefined, n: number): string | null {
  if (!seg) return null;
  const v = seg.elements[n - 1];
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Sub-element of a composite, 1-based (e.g. "AB:CD" -> sub(x,1)="AB"). */
export function sub(
  value: string | null,
  n: number,
  d: X12Delimiters,
): string | null {
  if (!value) return null;
  const parts = value.split(d.component);
  const v = parts[n - 1];
  return v && v.trim().length ? v.trim() : null;
}

/**
 * Decimal number as written (X12 type R). Use for unit prices — IT104 carries
 * an explicit decimal point.
 */
export function real(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Implied-decimal number (X12 type Nn). "52800" with n=2 is 528.00.
 *
 * Applies ONLY to fields the spec types Nn — TDS01, SAC05, AMT in some
 * contexts. Applying it to an explicit-decimal field divides a real invoice by a
 * hundred; not applying it to an implied one multiplies by a hundred. Both are
 * silent, so each caller names the field it is reading.
 *
 * A value that already contains a decimal point is taken as written: partners do
 * send "528.00" in N2 fields despite the spec, and re-scaling it would turn a
 * correct number into a wrong one.
 */
export function n2(value: string | null, places = 2): number | null {
  if (value == null) return null;
  if (value.includes(".")) {
    const asWritten = Number(value);
    return Number.isFinite(asWritten) ? asWritten : null;
  }
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits) / Math.pow(10, places);
  return negative ? -n : n;
}

/** CCYYMMDD (or YYMMDD) to ISO date. Returns null rather than an invalid Date. */
export function x12Date(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  let y: number, m: number, d: number;
  if (/^\d{8}$/.test(v)) {
    y = Number(v.slice(0, 4));
    m = Number(v.slice(4, 6));
    d = Number(v.slice(6, 8));
  } else if (/^\d{6}$/.test(v)) {
    const yy = Number(v.slice(0, 2));
    // X12 6-digit years pivot at 30: 29 -> 2029, 30 -> 1930. Getting this
    // backwards dates every invoice a century out and breaks aging silently.
    y = yy <= 29 ? 2000 + yy : 1900 + yy;
    m = Number(v.slice(2, 4));
    d = Number(v.slice(4, 6));
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return iso;
}

/**
 * Parse a full interchange into its transaction sets.
 *
 * Tolerant by design: a malformed envelope still yields whatever ST/SE pairs are
 * readable, with the problem recorded in `warnings`. A vendor document that
 * arrives slightly wrong is worth reading — refusing it outright just means a
 * human retypes the invoice, which is the cost this whole system exists to remove.
 */
export function parseInterchange(raw: string): X12Interchange {
  const warnings: string[] = [];
  const { delimiters, hasIsa } = detectDelimiters(raw);
  if (!hasIsa)
    warnings.push(
      "No ISA envelope found; assumed conventional delimiters (* : ~).",
    );

  const segments = tokenize(raw, delimiters);
  const isa = segments.find((s) => s.tag === "ISA");
  const gs = segments.find((s) => s.tag === "GS");

  const transactions: X12Transaction[] = [];
  let current: X12Transaction | null = null;

  for (const seg of segments) {
    if (seg.tag === "ST") {
      current = {
        setType: el(seg, 1) ?? "",
        controlNumber: el(seg, 2) ?? "",
        version: el(gs, 8) ?? el(seg, 3),
        segments: [],
      };
      continue;
    }
    if (seg.tag === "SE") {
      if (current) {
        transactions.push(current);
        current = null;
      } else {
        warnings.push("SE encountered with no open ST.");
      }
      continue;
    }
    if (current) current.segments.push(seg);
  }

  if (current) {
    // Truncated file: keep what we have and say so, rather than dropping a
    // readable invoice on the floor.
    warnings.push(
      `Transaction ${current.setType} was not closed by an SE; parsed as far as the file goes.`,
    );
    transactions.push(current);
  }

  const usageIndicator = el(isa, 15) ?? "P";
  if (usageIndicator === "T")
    warnings.push(
      "ISA15 marks this interchange as TEST data — it must not post against real money.",
    );

  return {
    senderId: el(isa, 6) ?? "",
    receiverId: el(isa, 8) ?? "",
    controlNumber: el(isa, 13) ?? "",
    usageIndicator,
    delimiters,
    transactions,
    warnings,
  };
}
