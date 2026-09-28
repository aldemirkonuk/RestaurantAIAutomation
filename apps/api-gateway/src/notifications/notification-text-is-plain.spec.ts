/**
 * NO PRODUCER WRITES AN EMOJI INTO A NOTIFICATION.
 *
 * THE DEFECT THIS FILE EXISTS FOR. Until 2026-09-03 the gateway and the
 * orchestrator prefixed emoji onto the `title` (and sometimes the `message`)
 * of rows they insert into `public.notifications` — a siren in front of "50
 * wines dropped below par", a bar chart in front of "Weekly report ready", a
 * warning triangle in front of "Low-stock digest: …". That is a picture
 * written into a database row, and it is worse than it looks:
 *
 *   1. It is PERMANENT. A row keeps the emoji forever; no restyle, no
 *      rebrand and no accessibility fix reaches it. The rebuilt
 *      `/notifications` has to strip it at render time
 *      (`apps/web/src/pages/notifications/next/nt-format.ts` `plainText`)
 *      precisely because the data cannot be fixed retroactively.
 *   2. It is UNSTYLABLE. It renders in whatever colour font the reader's OS
 *      ships, which breaks the one-chromatic-colour rule (ADR 0042: the İznik
 *      seal is the only colour) on a page that has no way to override it.
 *   3. It CARRIED NO FACT. Every emoji removed was a restatement of something
 *      the row already holds structurally — `priority`, `metadata.severity`,
 *      `metadata.criticalCount`, `type`. The register's mark is now drawn by
 *      the reader from `type`, in ink, where it can be sized and themed.
 *
 * WHY A SCAN AND NOT ONLY BEHAVIOURAL TESTS. There are five write paths into
 * the table across two runtimes (NestJS and the Python orchestrator), and new
 * producers get added regularly. A behavioural test pins the producers that
 * exist today; this scan pins the RULE, and names the file and line of any
 * producer that breaks it — including one written next year.
 *
 * WHY IT DOES NOT SANITISE IN THE FUNNEL INSTEAD. `persistForRestaurant` also
 * carries human-authored text (a manager's team broadcast, a custom reminder
 * the user typed). Silently deleting characters out of a person's own message
 * is a house editing its records; the rule is for the house's own voice. So
 * the producers are cleaned at source, this file keeps them clean, and the
 * page normalises what is already stored.
 *
 * THE TRAP THIS FILE IS BUILT AGAINST: a scan that finds no files passes
 * vacuously. Every discovery step below therefore asserts a non-zero count
 * first — if the layout moves and the scan can no longer see the producers,
 * this file FAILS rather than reporting a clean tree it never read. Proven
 * against the pre-fix tree: each of the twelve call sites listed in
 * `.planning/06-pages/notifications.md` §1b was re-introduced one at a time
 * and observed failing here.
 */

import * as fs from "fs";
import * as path from "path";

/** The house-wide emoji range — identical to the repo's own emoji grep. */
// VS16 and the keycap are alternated, not placed in the class: eslint's
// no-misleading-character-class reads a combining mark inside [...] as an accident.
const EMOJI =
  /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;

const GATEWAY_SRC = path.resolve(__dirname, "..");
const ORCHESTRATOR = path.resolve(
  __dirname,
  "../../../../services/agent-orchestrator",
);

/**
 * The funnels. A gateway file that names one of these writes rows the
 * `/notifications` inbox renders, so its notification text is in scope.
 */
const FUNNELS = [
  "persistForRestaurant",
  "createNotification",
  "persistManagerNotification",
  'from("notifications")',
  // The six pass-4 producers write through ProducerLedgerService.emit, so
  // none of them contained a funnel above and the scan never opened them;
  // the vacuity check below still passed on the older set. Round-two audit,
  // 2026-09-03.
  "this.ledger.emit(",
];

function walk(dir: string, ext: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(p, ext, out);
    } else if (ext.some((e) => entry.name.endsWith(e))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Every line of a producer that could reach a reader, ignoring comments and
 * log calls.
 *
 * WHY NOT JUST `title:` / `message:` LINES. The original defect's worst shape
 * was indirect: `const emoji = { info: "…", error: "…" }[severity]` on one
 * line and `title: \`${emoji} ${data.title}\`` on another. A scanner that only
 * looked at the `title:` line would have passed that code — the emoji is not
 * on it. So the rule is: NO emoji anywhere in a file that writes notifications,
 * except in a log line (operator output, never a reader's) and except in a
 * comment (which is how a defect gets described so it is not re-introduced).
 */
const LOGGING = /(logger|console)\s*\.\s*\w+\s*\(|this\.log\s*\(/;

/**
 * True when line `i` is INSIDE a logging call that opened on an earlier line.
 * A NestJS logger call is routinely wrapped across three lines by the
 * formatter, so a naive same-line test would flag the string argument of a log
 * as a notification title. The balance walk is deliberately cheap: it looks
 * back at most six lines and only needs to know whether the logger call's
 * parenthesis is still open.
 */
function insideLoggingCall(lines: string[], i: number): boolean {
  for (let start = i - 1; start >= 0 && start >= i - 6; start--) {
    if (!LOGGING.test(lines[start])) continue;
    let depth = 0;
    for (let k = start; k < i; k++) {
      for (const ch of lines[k]) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
    }
    if (depth > 0) return true;
  }
  return false;
}

function textLines(source: string): Array<{ line: number; text: string }> {
  const lines = source.split("\n");
  return lines
    .map((text, i) => ({ line: i + 1, text, i }))
    .filter(({ text, i }) => {
      const t = text.trim();
      // A comment is how a defect gets described so it is not re-introduced.
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("#")) {
        return false;
      }
      // Operator output, never a reader's — logs are out of scope by design.
      if (LOGGING.test(t) || insideLoggingCall(lines, i)) return false;
      return true;
    })
    .map(({ line, text }) => ({ line, text }));
}

function offences(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const { line, text } of textLines(source)) {
      if (EMOJI.test(text)) {
        found.push(`${path.relative(GATEWAY_SRC, file)}:${line} — ${text.trim()}`);
      }
    }
  }
  return found;
}

describe("no notification producer writes an emoji into a stored title", () => {
  const gatewayFiles = walk(GATEWAY_SRC, [".ts"]).filter(
    (f) => !f.endsWith(".spec.ts") && !f.includes("/__tests__/"),
  );

  const producers = gatewayFiles.filter((f) => {
    const s = fs.readFileSync(f, "utf8");
    return FUNNELS.some((fn) => s.includes(fn));
  });

  it("[REVERT-FAILS] can actually see the gateway producers it claims to check", () => {
    // The vacuity guard: if this drops to zero the scan below proves nothing.
    expect(gatewayFiles.length).toBeGreaterThan(100);
    expect(producers.length).toBeGreaterThanOrEqual(6);
    // and the ones we know about by name are among them
    const names = producers.map((f) => path.basename(f));
    for (const expected of [
      "notifications.service.ts",
      "low-stock-alerts.service.ts",
      "scheduled-tasks.service.ts",
      "schedule.service.ts",
      "team.controller.ts",
      "inbound-responder.service.ts",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("[REVERT-FAILS] no gateway producer carries an emoji in a title or message", () => {
    expect(offences(producers)).toEqual([]);
  });

  it("[REVERT-FAILS] no orchestrator producer carries an emoji in a title or message", () => {
    // The Python agents INSERT into `notifications` directly (D-03), bypassing
    // the gateway entirely, so cleaning only the NestJS side would leave half
    // the producers writing pictures.
    const py = walk(path.join(ORCHESTRATOR, "agents"), [".py"]).filter((f) =>
      // The INSERT itself, not a method whose name starts with `_notify` —
      // `procurement_agent._notify_voice_negotiation_success` publishes a bus
      // event and writes no row, and sweeping it in would have made this file
      // fail over text no reader of /notifications ever sees.
      fs.readFileSync(f, "utf8").includes('table("notifications")'),
    );
    expect(py.length).toBeGreaterThanOrEqual(1);
    expect(offences(py)).toEqual([]);
  });

  it("[REVERT-FAILS] the scanner detects an emoji when one is present", () => {
    // Proves the regex and the line filter are load-bearing rather than a
    // pair of predicates that happen to be true of every line.
    const tmp = path.join(__dirname, "__emoji_probe.tmp.ts");
    fs.writeFileSync(tmp, 'const x = { title: "\u{1F6A8} 50 wines dropped below par" };\n');
    try {
      expect(offences([tmp])).toHaveLength(1);
    } finally {
      fs.unlinkSync(tmp);
    }
    // …and that a comment mentioning the rule is not an offence
    const tmp2 = path.join(__dirname, "__emoji_probe2.tmp.ts");
    fs.writeFileSync(tmp2, '// title: "\u{1F6A8} was here" — the defect, described\n');
    try {
      expect(offences([tmp2])).toEqual([]);
    } finally {
      fs.unlinkSync(tmp2);
    }
  });
});
