import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import * as path from "path";
import {
  maybeExportOpenApi,
  shouldExportOpenApi,
  OPENAPI_EXPORT_PATH,
} from "./openapi-export";

/**
 * ADR 0123 / OD-89 — the OpenAPI export is a command, not a commit.
 *
 * WHAT THIS SPEC PROVES, AND WHAT IT DOES NOT
 * -------------------------------------------
 * It does NOT boot Nest. `bootstrap()` in main.ts opens a real Supabase client
 * and a listening socket, and this repo's rules forbid pointing a test at the
 * production project. So the boot-time behaviour is covered in two halves that
 * together leave no gap:
 *
 *   1. the decision itself — `maybeExportOpenApi` with a spy writer, which is
 *      the exact function both `main.ts` and `openapi.ts` now call; and
 *   2. the call site — a source-shape assertion that `main.ts` routes its
 *      write through that function and no longer writes on a bare
 *      `NODE_ENV !== "production"` boot.
 *
 * The second half is what fails against pre-fix code, and the last test proves
 * that by running the same predicate over `git show <PRE_FIX_SHA>:...` — a
 * read-only copy, never a checkout.
 */

const PRE_FIX_SHA = "3ab6302a8e38e1ae8742092c3bd422e6bd8cb28d";
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MAIN_TS = "apps/api-gateway/src/main.ts";

/**
 * The property under test, expressed once so the current tree and the pre-fix
 * copy are judged by identical rules. Throws with the reason when the source
 * would write the spec as a side effect of booting.
 */
function assertBootDoesNotWriteTheSpec(source: string): void {
  const gated = /NODE_ENV\s*!==\s*"production"\s*\)\s*\{[\s\S]{0,200}?writeFileSync/.test(
    source,
  );
  if (gated) {
    throw new Error(
      "main.ts writes openapi.json on any non-production boot (NODE_ENV-gated writeFileSync)",
    );
  }
  if (!source.includes("maybeExportOpenApi(document")) {
    throw new Error("main.ts does not route its export through maybeExportOpenApi");
  }
}

function readFromGit(sha: string, file: string): string {
  return execFileSync("git", ["show", `${sha}:${file}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("shouldExportOpenApi", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    [" 1 ", true],
    ["0", false],
    ["false", false],
    ["", false],
    ["yes", false],
  ])("EXPORT_OPENAPI=%j -> %s", (value, expected) => {
    expect(shouldExportOpenApi({ EXPORT_OPENAPI: value } as NodeJS.ProcessEnv)).toBe(
      expected,
    );
  });

  it("is false when the variable is absent — absence is not consent", () => {
    expect(shouldExportOpenApi({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("maybeExportOpenApi", () => {
  it("writes nothing when the flag is unset (the boot case)", () => {
    const write = jest.fn();
    const log = jest.fn();

    const wrote = maybeExportOpenApi(
      { openapi: "3.0.0" },
      { env: {} as NodeJS.ProcessEnv, write, log },
    );

    expect(wrote).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("writes nothing when the flag is set to a non-opt-in value", () => {
    const write = jest.fn();

    expect(
      maybeExportOpenApi(
        {},
        { env: { EXPORT_OPENAPI: "0" } as NodeJS.ProcessEnv, write },
      ),
    ).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes the pretty-printed spec when the flag is set (the command case)", () => {
    const write = jest.fn();
    const log = jest.fn();
    const document = { openapi: "3.0.0", paths: {} };

    const wrote = maybeExportOpenApi(document, {
      env: { EXPORT_OPENAPI: "1" } as NodeJS.ProcessEnv,
      write,
      log,
    });

    expect(wrote).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      OPENAPI_EXPORT_PATH,
      JSON.stringify(document, null, 2),
    );
    expect(log).toHaveBeenCalledWith(
      `OpenAPI spec exported to ${OPENAPI_EXPORT_PATH}`,
    );
  });
});

describe("the gateway's boot path", () => {
  it("does not write the spec as a side effect of booting", () => {
    const source = readFileSync(path.join(REPO_ROOT, MAIN_TS), "utf8");
    expect(() => assertBootDoesNotWriteTheSpec(source)).not.toThrow();
  });

  it("fails against the pre-fix source at " + PRE_FIX_SHA.slice(0, 8), () => {
    let preFix: string;
    try {
      preFix = readFromGit(PRE_FIX_SHA, MAIN_TS);
    } catch (cause) {
      // The commit is unreachable from this checkout (squash-merged, or a
      // shallow clone). A guard that cannot see its pre-fix shape must FAIL,
      // not pass: a quiet skip would be the guard certifying itself against
      // nothing (the absence-reported-as-health fault). CI's Test TypeScript
      // job fetches origin/main for the provenance tests; if this commit is
      // ever squashed away, re-pin PRE_FIX_SHA rather than soften this.
      throw new Error(
        `${PRE_FIX_SHA} is not reachable from this checkout, so the pre-fix comparison could not run: ${String(cause)}`,
      );
    }

    expect(preFix).toContain('NODE_ENV !== "production"');
    expect(() => assertBootDoesNotWriteTheSpec(preFix)).toThrow(
      /writes openapi\.json on any non-production boot/,
    );
  });
});
