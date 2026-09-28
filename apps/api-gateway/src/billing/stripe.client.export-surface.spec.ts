/**
 * THE ONE DOOR STAYS ONE DOOR — asserted, not reasoned about.
 *
 * `stripe.client.ts` cuts a single exemption through `FORBIDDEN_PATHS` for
 * `chargeCardOnFile`, and the whole guarantee rests on one property: the key to
 * that door, `CHARGE_INTENT`, is a `unique symbol` that is NOT exported, so no
 * second caller can be written anywhere else in the codebase. The commit that
 * built it (b145bf48) treated `grep CHARGE_INTENT` as the complete census, and
 * it is — but its audit found that nothing would fail if a future edit typed
 * `export` in front of that symbol. Every existing test in
 * `stripe.client.spec.ts` and `billing.service.spec.ts` would still pass while
 * the "a second caller always fails" guarantee quietly reopened.
 *
 * So the export surface itself is the assertion, named member by member. A new
 * export is then a deliberate edit to this file rather than an accident: adding
 * one turns this suite red and the person adding it has to say why in the diff.
 *
 * Two things are checked, because the symbol could leak either way:
 *   1. the module's own runtime exports, listed exactly;
 *   2. that nothing under `src/billing` re-exports this module at all — a
 *      barrel would make `CHARGE_INTENT` reachable under another name without
 *      the word `export` ever appearing beside its declaration.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import * as stripeClientModule from "./stripe.client";

/**
 * Every RUNTIME export of `stripe.client.ts`, exactly.
 *
 * The four `Stripe*` interfaces are types and have no runtime presence, which is
 * why they are absent here. If this list needs changing, the change is the
 * point: read the new export and decide whether it is a door.
 */
const EXPECTED_EXPORTS = ["FORBIDDEN_PATHS", "StripeClient"];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("CHARGE_INTENT is not exported, and cannot become exported by accident", () => {
  it("the module exports exactly two runtime members, and CHARGE_INTENT is neither", () => {
    const exported = Object.keys(stripeClientModule).sort();
    expect(exported).toEqual([...EXPECTED_EXPORTS].sort());
    expect(exported).not.toContain("CHARGE_INTENT");
  });

  it("no exported value IS the symbol under another name", () => {
    // An `export const KEY = CHARGE_INTENT` would satisfy the name check above
    // and still hand out the key, so the VALUES are checked too.
    for (const value of Object.values(stripeClientModule as Record<string, unknown>)) {
      expect(typeof value).not.toBe("symbol");
    }
  });

  it("the source declares the symbol without the word export in front of it", () => {
    const src = readFileSync(join(__dirname, "stripe.client.ts"), "utf8");
    expect(src).toContain("const CHARGE_INTENT: unique symbol");
    expect(src).not.toContain("export const CHARGE_INTENT");
    expect(src).not.toMatch(/export\s*\{[^}]*CHARGE_INTENT/);
  });

  it("nothing under src/billing is a barrel, and nothing re-exports this module", () => {
    const files = filesUnder(__dirname);
    // A barrel is the ordinary way a symbol escapes a module without anyone
    // editing the line that declares it.
    expect(files.filter((f) => f.endsWith("/index.ts"))).toEqual([]);

    const reExporters: string[] = [];
    for (const file of files) {
      if (file.endsWith("stripe.client.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/export\s+(\*|\{)[^;]*from\s+["'][^"']*stripe\.client["']/.test(src)) {
        reExporters.push(file);
      }
      if (/export\s+\*\s+from/.test(src)) reExporters.push(file);
    }
    expect(reExporters).toEqual([]);
  });

  it("chargeCardOnFile lives on the class and is reachable no other way", () => {
    // The method exists (so this spec is about the real door, not a typo) and
    // the only handle on it is the exported class.
    expect(typeof stripeClientModule.StripeClient.prototype.chargeCardOnFile).toBe("function");
    expect(Object.keys(stripeClientModule)).not.toContain("chargeCardOnFile");
  });
});
