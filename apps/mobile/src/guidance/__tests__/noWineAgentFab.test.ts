import fs from "fs";
import path from "path";

/**
 * The floating "Wine Agent" button stays removed on mobile.
 *
 * ADR 0145 (as amended by ADR 0149 row 33) retired it: `/ask` and the palette
 * panel are the two doors, not a circle floating over every screen. Mobile has
 * no ask-ai surface yet, so its one remaining entry is the Help card and the
 * `/wine-agent` route — both stay, and both are plain links, not a persistent
 * overlay. Nothing here stops a *link*; it stops the overlay, and the
 * visibility state that only ever existed to drive it, from coming back.
 *
 * Static on purpose: rendering the root layout needs the whole Metro stack
 * (see jest.config.js). A text scan of the app source is what can run here.
 */

const MOBILE = path.resolve(__dirname, "../../..");
const SELF = path.resolve(__filename);

/**
 * `WineAgentFab` also matches `setShowWineAgentFab` / `unlockWineAgentFab`;
 * `wine_agent_fab` matches `show_wine_agent_fab`, `wine_agent_fab_unlocked`
 * and the old `wine_agent_fab_clicked` event name.
 */
const BANNED = /WineAgentFab|wine_agent_fab/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("no floating Wine Agent button on mobile", () => {
  it("has no WineAgentFab component file", () => {
    expect(fs.existsSync(path.join(MOBILE, "src/guidance/WineAgentFab.tsx"))).toBe(false);
  });

  it("names no FAB component, state field, setter or event anywhere in app/ or src/", () => {
    const files = [...walk(path.join(MOBILE, "app")), ...walk(path.join(MOBILE, "src"))].filter(
      (f) => f !== SELF,
    );
    // A scan that finds no files passes trivially, which is how a moved
    // directory would silently disarm it.
    expect(files.length).toBeGreaterThan(20);

    const hits = files.flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .map((text, i) => ({ file: path.relative(MOBILE, file), line: i + 1, text }))
        .filter(({ text }) => BANNED.test(text))
        .map(({ file: f, line, text }) => `${f}:${line}  ${text.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});
