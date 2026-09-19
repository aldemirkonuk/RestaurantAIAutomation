/**
 * The verdict-ledger route, resolved from Nest's own decorators — not
 * transcribed by hand.
 *
 * Found by the fixer review (2026-09-18): the web client called
 * `/procurement/orders/:id/verdicts`, but `ReceivingController` is mounted at
 * `@Controller('procurement/receiving')`, so the real route is
 * `/procurement/receiving/orders/:id/verdicts`. Every ledger read and append
 * 404'd in a real run, and `RcVerdictLedger.test.tsx`'s own assertion pinned
 * the wrong path, so nothing caught it. This test resolves BOTH sides —
 * Nest's `PATH_METADATA` for the controller, and the literal template string
 * in the web client's source — so a future drift in either file fails here
 * instead of only in production.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATH_METADATA } from "@nestjs/common/constants";
import { ReceivingController } from "./receiving.controller";

const controllerPrefix: string = Reflect.getMetadata(
  PATH_METADATA,
  ReceivingController,
);

const methodPath = (method: keyof ReceivingController) =>
  Reflect.getMetadata(PATH_METADATA, ReceivingController.prototype[method]);

const fullPath = (method: keyof ReceivingController) =>
  `/${controllerPrefix}/${methodPath(method)}`.replace(/\/+/g, "/");

// The web client lives in a different workspace package (apps/web), so this
// reads its source as text rather than importing it — the same
// cross-file-assertion shape `gateway-honesty.spec.ts` already uses for
// `sms.service.ts`.
const WEB_CLIENT_PATH = join(
  __dirname,
  "../../../../apps/web/src/services/api/receiving.ts",
);
const WEB_CLIENT_SOURCE = readFileSync(WEB_CLIENT_PATH, "utf8");

describe("ReceivingController verdict-ledger route", () => {
  it("mounts GET orders/:id/verdicts under procurement/receiving", () => {
    expect(controllerPrefix).toBe("procurement/receiving");
    expect(methodPath("lineVerdicts")).toBe("orders/:id/verdicts");
    expect(fullPath("lineVerdicts")).toBe("/procurement/receiving/orders/:id/verdicts");
  });

  it("mounts POST orders/:id/verdicts under procurement/receiving", () => {
    expect(methodPath("appendLineVerdict")).toBe("orders/:id/verdicts");
    expect(fullPath("appendLineVerdict")).toBe(
      "/procurement/receiving/orders/:id/verdicts",
    );
  });

  it("the web client's listLineVerdicts/appendLineVerdict templates resolve to the real route", () => {
    // Extract the literal template from apiClient.get/post(...) calls and
    // substitute the same placeholder Nest uses (`:id`) for `${orderId}`, so
    // the two sides are compared as the same shape rather than eyeballed.
    const templates = Array.from(
      WEB_CLIENT_SOURCE.matchAll(
        /apiClient\.(?:get|post)\(\s*\n?\s*`([^`]+)`/g,
      ),
    ).map((m) => m[1].replace(/\$\{orderId\}/g, ":id"));

    const verdictTemplates = templates.filter((t) => t.endsWith("/verdicts"));
    expect(verdictTemplates.length).toBeGreaterThan(0);
    for (const t of verdictTemplates) {
      expect(t).toBe(fullPath("lineVerdicts"));
    }
  });

  it("regression: fails on the exact defect this test was written for", () => {
    // The bug the review found, reproduced literally: a client calling the
    // procurement-level path (no `receiving/` segment) does NOT match the
    // controller's real route.
    const buggyClientPath = "/procurement/orders/:id/verdicts";
    expect(buggyClientPath).not.toBe(fullPath("lineVerdicts"));
  });
});
