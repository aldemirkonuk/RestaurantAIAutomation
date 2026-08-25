import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  COMMITMENT_PATTERNS,
  COMMITMENT_PATTERN_SOURCES,
  containsCommitmentLanguage,
} from "./commitment-patterns";

/**
 * Anti-divergence guard for the UCC contract-formation guardrail (OD-44).
 *
 * The Python orchestrator carries the same guardrail and is the runtime that can
 * auto-send. The two lists had already drifted — 19 patterns here, 8 there, under
 * a comment claiming they were "ported verbatim". The mirror of this test lives at
 * services/agent-orchestrator/tests/test_commitment_patterns_sync.py; both suites
 * fail on drift so neither runtime can move alone.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const PY_GENERATED = join(
  REPO_ROOT,
  "services",
  "agent-orchestrator",
  "core",
  "commitment_patterns.py",
);

/**
 * Pull the pattern list out of the generated Python module.
 *
 * The generator emits one `json.dumps`-formatted literal per line, so each line is
 * a valid JSON string and parsing is exact rather than heuristic.
 */
function readPythonPatterns(): string[] {
  const source = readFileSync(PY_GENERATED, "utf8");
  const match = source.match(
    /COMMITMENT_PATTERNS:\s*List\[str\]\s*=\s*\[([\s\S]*?)\]/,
  );
  if (!match) {
    throw new Error(
      `Could not find COMMITMENT_PATTERNS in ${PY_GENERATED}. ` +
        "Regenerate it with: python3 scripts/sync_commitment_patterns.py",
    );
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((literal) => JSON.parse(literal) as string);
}

describe("commitment-language guardrail (OD-44)", () => {
  it("is the single source of truth for the Python runtime", () => {
    // Guards the mirror test itself: if the generated module is missing, the
    // Python runtime is running an unknown list and this must not pass quietly.
    expect(existsSync(PY_GENERATED)).toBe(true);
  });

  it("matches the Python runtime exactly, in order", () => {
    const python = readPythonPatterns();
    const typescript = [...COMMITMENT_PATTERN_SOURCES];

    const onlyInTs = typescript.filter((p) => !python.includes(p));
    const onlyInPy = python.filter((p) => !typescript.includes(p));

    expect({ onlyInTs, onlyInPy }).toEqual({ onlyInTs: [], onlyInPy: [] });
    expect(python).toEqual(typescript);
  });

  it("compiles every source with the case-insensitive flag", () => {
    expect(COMMITMENT_PATTERNS).toHaveLength(COMMITMENT_PATTERN_SOURCES.length);
    for (const pattern of COMMITMENT_PATTERNS) {
      expect(pattern.flags).toContain("i");
    }
  });

  it("keeps every pattern inside the JS/Python portable subset", () => {
    // Constructs that exist in only one engine would make byte-identical lists
    // behave differently, which is divergence that a diff cannot see.
    const unportable = ["(?<", "(?P<", "(?i)", "\\A", "\\Z", "\\p{", "\\h"];
    for (const source of COMMITMENT_PATTERN_SOURCES) {
      for (const token of unportable) {
        expect(source).not.toContain(token);
      }
    }
  });

  describe("detection", () => {
    it.each([
      "Great — we accept the offered price.",
      "Please place the order for 6 cases.",
      "You can go ahead and ship them this week.",
      "We'll proceed with the 2019 Barolo.",
      "Nous acceptons votre offre.",
      "Confermiamo l'ordine di 12 bottiglie.",
      "WE ACCEPT THE TERMS",
    ])("flags commitment language: %s", (text) => {
      expect(containsCommitmentLanguage(text)).toBe(true);
    });

    it.each([
      "Could you please hold those for us? I'll get back to you very soon.",
      "What is your price on the 2019 Barolo?",
      "Thanks for the heads up — let me check with my manager.",
    ])("does not flag non-commitment language: %s", (text) => {
      expect(containsCommitmentLanguage(text)).toBe(false);
    });
  });
});
