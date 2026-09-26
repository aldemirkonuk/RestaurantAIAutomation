import { ArrivalService } from "./arrival.service";
import {
  sameValue,
  validateConfiguration,
  ConfigurationBatch,
  ConfigurationRow,
} from "./arrival-contract";
import { MenusService } from "../menus/menus.service";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  restaurantId: "22222222-2222-4222-8222-222222222222",
};
function row(id = "r1"): ConfigurationRow {
  return {
    id,
    target: "cellar",
    field: "wines",
    value: true,
    before: null,
    beforeValue: null,
    provenance: "spoken",
    status: "pending",
    reason: null,
  };
}
function batch(rows = [row()]): ConfigurationBatch {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    restaurant_id: actor.restaurantId,
    user_id: actor.userId,
    revision: 0,
    status: "draft",
    rows,
    created_at: new Date().toISOString(),
    sealed_at: null,
    undo_until: null,
  };
}
function harness(rows = [row()]) {
  let stored = batch(rows);
  const service: any = Object.create(ArrivalService.prototype);
  service.manage = jest.fn().mockResolvedValue(undefined);
  service.batch = jest.fn(async () => structuredClone(stored));
  service.saveBatch = jest.fn(
    async (_: unknown, prior: ConfigurationBatch, patch: object) => {
      if (prior.revision !== stored.revision) throw Error("revision conflict");
      stored = {
        ...stored,
        ...structuredClone(patch),
        revision: stored.revision + 1,
      };
      return structuredClone(stored);
    },
  );
  service.current = jest
    .fn()
    .mockResolvedValue({ value: null, stated: false, snapshot: null });
  service.write = jest.fn().mockResolvedValue({ written: true });
  service.recordFolio = jest.fn().mockResolvedValue(undefined);
  service.sealChallenges = {
    issue: jest
      .fn()
      .mockResolvedValue({ challenge: "tok", expiresAt: "later", action: "apply" }),
    redeem: jest.fn().mockResolvedValue({ sealId: "seal-1" }),
  };
  return { service, read: () => stored };
}
describe("Arrival's configuration boundary", () => {
  it.each([
    { target: "currency", field: "code", value: "ZZZ" },
    { target: "features", field: "notification_producers", value: true },
    { target: "threshold", field: "thresholdMin", value: -1 },
    { target: "threshold", field: "thresholdMin", value: 1000 },
    { target: "notifications", field: "userId", value: actor.userId },
    { target: "notifications", field: "quietHours.startTime", value: "25:99" },
    {
      target: "vendor_terms",
      field: "leadTimeDays",
      value: 2,
      subjectId: "other",
    },
    {
      target: "menu_item",
      field: "one",
      value: { name: "Wine", raw_text: "private raw material" },
    },
  ])("refuses an unsupported value %#", (input) =>
    expect(() => validateConfiguration(input as any)).toThrow(),
  );
  it("preserves sibling categories when one personal answer is typed", async () => {
    const service: any = Object.create(ArrivalService.prototype);
    service.notifications = {
      getPreferences: jest
        .fn()
        .mockResolvedValue({ categories: { inventory: true, orders: false } }),
      updatePreferences: jest.fn().mockResolvedValue({}),
    };
    await service.write(
      actor,
      { target: "notifications", field: "categories.inventory", value: false },
      false,
    );
    expect(service.notifications.getPreferences).toHaveBeenCalledWith(
      actor.userId,
      actor.restaurantId,
    );
    expect(service.notifications.updatePreferences).toHaveBeenCalledWith({
      userId: actor.userId,
      restaurantId: actor.restaurantId,
      categories: { inventory: false, orders: false },
    });
  });
  it("refuses sealing an empty or entirely refused draft", async () => {
    for (const rows of [[], [{ ...row(), status: "refused" as const }]]) {
      const { service } = harness(rows);
      await expect(service.apply(actor, batch().id, 0)).rejects.toThrow(
        "no pending",
      );
      expect(service.saveBatch).not.toHaveBeenCalled();
    }
  });
  it("does not claim to discard a missing row", async () => {
    const { service } = harness();
    await expect(
      service.discard(actor, batch().id, "missing", 0),
    ).rejects.toThrow("no longer");
    expect(service.saveBatch).not.toHaveBeenCalled();
  });
  it("retains false and zero as answers", () => {
    expect(
      validateConfiguration({ target: "cellar", field: "wines", value: false })
        .value,
    ).toBe(false);
    expect(
      validateConfiguration({
        target: "threshold",
        field: "thresholdMin",
        value: 0,
      }).value,
    ).toBe(0);
  });
  it("compares database JSONB snapshots independent of key order", () => {
    expect(
      sameValue({ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 }),
    ).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });
  it("writes typed answers immediately without creating or applying a batch", async () => {
    const { service } = harness();
    const result = await service.typed(actor, {
      target: "cellar",
      field: "wines",
      value: false,
    });
    expect(service.write).toHaveBeenCalledWith(
      actor,
      { target: "cellar", field: "wines", value: false },
      false,
    );
    expect(service.batch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ written: true, recorded: true });
  });
  it("reports a typed write whose folio audit failed", async () => {
    const { service } = harness();
    service.recordFolio.mockRejectedValue(Error("db down"));
    expect(
      await service.typed(actor, {
        target: "cellar",
        field: "wines",
        value: true,
      }),
    ).toMatchObject({ written: true, recorded: false });
  });
  it("refuses a stated field that changed while the draft was closed", async () => {
    const { service, read } = harness();
    service.current.mockResolvedValue({
      value: false,
      stated: true,
      snapshot: { carried: false },
    });
    await service.apply(actor, read().id, 0);
    expect(service.write).not.toHaveBeenCalled();
    expect(read().rows[0].status).toBe("refused");
  });
  it("records a per-entry outcome and never replays a sealed batch", async () => {
    const { service, read } = harness();
    await service.apply(actor, read().id, 0);
    expect(read().rows[0].status).toBe("written");
    expect(read().status).toBe("applied");
    expect(read().undo_until).not.toBeNull();
    expect(service.recordFolio.mock.calls[0][4]).toBe(read().id);
    await expect(
      service.apply(actor, read().id, read().revision),
    ).rejects.toThrow();
    expect(service.write).toHaveBeenCalledTimes(1);
  });
  it("does not claim a failed writer left the setting untouched", async () => {
    const { service, read } = harness();
    service.write.mockRejectedValue(Error("connection lost"));
    await service.apply(actor, read().id, 0);
    expect(read().rows[0].status).toBe("unconfirmed");
    expect(read().rows[0].reason).toContain(
      "did not return a confirmed receipt",
    );
    // codex-audit/C2-adopt.md #4: the header must not claim 'applied' when
    // every row it covers was refused or unconfirmed.
    expect(read().status).toBe("applied_with_issues");
  });
  it("redeems a seal, over the batch's own id and revision, before sealing", async () => {
    const { service, read } = harness();
    const batchId = read().id;
    await service.apply(actor, batchId, 0, "the-challenge");
    expect(service.sealChallenges.redeem).toHaveBeenCalledWith({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "configuration_batch",
      subjectId: batchId,
      action: "apply",
      args: { batchId, revision: 0 },
      challenge: "the-challenge",
    });
  });
  it("refuses to apply when the seal is not redeemed (codex-audit/C2-adopt.md #2)", async () => {
    const { service } = harness();
    service.sealChallenges.redeem.mockRejectedValue(
      new Error("That seal is not one this house issued, so nothing was changed."),
    );
    await expect(service.apply(actor, batch().id, 0)).rejects.toThrow(
      "not one this house issued",
    );
    expect(service.write).not.toHaveBeenCalled();
    expect(service.saveBatch).not.toHaveBeenCalled();
  });
  it("fails closed rather than silently skipping the seal when it is not wired in", async () => {
    const { service, read } = harness();
    service.sealChallenges = undefined;
    await expect(service.apply(actor, read().id, 0)).rejects.toThrow(
      "seal service is not wired in",
    );
    expect(service.write).not.toHaveBeenCalled();
  });
  it("resumes a batch a crash stranded at 'applying' without re-sealing (codex-audit/C2-adopt.md #3)", async () => {
    const twoRows = [row("done"), row("crashed")];
    const { service, read } = harness(twoRows);
    // Simulate a prior attempt: sealed, first row written, then the process
    // died before the second row (still 'pending') was reached.
    await service.saveBatch(actor, read(), {
      status: "applying",
      sealed_at: new Date().toISOString(),
      undo_until: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    await service.saveBatch(actor, read(), {
      rows: [{ ...twoRows[0], status: "written" }, twoRows[1]],
    });
    service.sealChallenges.redeem.mockClear();
    await service.apply(actor, read().id, read().revision);
    expect(service.sealChallenges.redeem).not.toHaveBeenCalled();
    expect(service.write).toHaveBeenCalledTimes(1); // only the stranded row
    expect(read().rows.map((r: ConfigurationRow) => r.status)).toEqual([
      "written",
      "written",
    ]);
    expect(read().status).toBe("applied");
  });
  it("relabels a row a crash stranded mid-write as 'unconfirmed' instead of leaving it 'applying' forever", async () => {
    const twoRows = [row("crashed-mid-write"), row("never-started")];
    const { service, read } = harness(twoRows);
    // A different crash point from the test above: there the stranded row
    // was still 'pending' (the crash landed between rows). Here the process
    // died WHILE writing the first row -- the per-row loop had already
    // marked it 'applying' before its writer returned.
    await service.saveBatch(actor, read(), {
      status: "applying",
      sealed_at: new Date().toISOString(),
      undo_until: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    await service.saveBatch(actor, read(), {
      rows: [{ ...twoRows[0], status: "applying" }, twoRows[1]],
    });
    await service.apply(actor, read().id, read().revision);
    // The loop only ever re-enters a 'pending' row, so a stranded 'applying'
    // row must be relabelled BEFORE the loop runs, or it is skipped forever
    // and the finished receipt still reads 'applying'.
    expect(service.write).toHaveBeenCalledTimes(1); // only the untouched row
    expect(read().rows.map((r: ConfigurationRow) => r.status)).toEqual([
      "unconfirmed",
      "written",
    ]);
    expect(read().rows[0].reason).toContain(
      "did not return a confirmed receipt",
    );
    expect(read().status).toBe("applied_with_issues");
  });
  it("allows two new fields of one preferences row in one seal", async () => {
    const first = {
      ...row("first"),
      target: "notifications" as const,
      field: "email",
      value: false,
      beforeValue: true,
    };
    const second = {
      ...row("second"),
      target: "notifications" as const,
      field: "push",
      value: false,
      beforeValue: true,
    };
    const { service, read } = harness([first, second]);
    const firstAfter = { email_enabled: false, user_id: actor.userId };
    const secondAfter = { ...firstAfter, push_enabled: false };
    service.current
      .mockReset()
      .mockResolvedValueOnce({ value: true, stated: false, snapshot: null })
      .mockResolvedValueOnce({
        value: false,
        stated: true,
        snapshot: firstAfter,
      })
      .mockResolvedValueOnce({
        value: true,
        stated: true,
        snapshot: firstAfter,
      })
      .mockResolvedValueOnce({
        value: false,
        stated: true,
        snapshot: secondAfter,
      });
    await service.apply(actor, read().id, 0);
    expect(read().rows.map((row) => row.status)).toEqual([
      "written",
      "written",
    ]);
    expect(read().rows[1].before).toEqual(firstAfter);
  });
  it("records a skip without invoking any setting writer", async () => {
    const { service } = harness();
    await service.skip(actor, "evidence");
    expect(service.recordFolio).toHaveBeenCalledWith(
      actor,
      "evidence",
      "skipped",
      { offered: ["evidence"], answered: [], provenance: "skipped" },
    );
    expect(service.write).not.toHaveBeenCalled();
  });
  it("tenantless sessions cannot create even a skip receipt", async () => {
    const service: any = Object.create(ArrivalService.prototype);
    await expect(
      service.recordFolio({ userId: actor.userId }, "assistant", "skipped", {}),
    ).rejects.toThrow("Open a house");
  });
  it("preview extracts without touching menu, inventory or library writers", async () => {
    const scan = {
      parse: jest
        .fn()
        .mockResolvedValue([{ name: "House red", raw_text: "raw" }]),
    };
    const service: any = new MenusService(
      { supabase: { from: jest.fn() } } as any,
      {} as any,
      scan as any,
      {} as any,
    );
    service.upsertMenu = jest.fn();
    service.resolveAndPersistItems = jest.fn();
    expect(
      await service.previewArrivalMenu("scan", "encoded", actor.restaurantId),
    ).toEqual([{ name: "House red" }]);
    expect(scan.parse).toHaveBeenCalledWith(
      "encoded",
      actor.restaurantId,
      true,
    );
    expect(service.upsertMenu).not.toHaveBeenCalled();
    expect(service.resolveAndPersistItems).not.toHaveBeenCalled();
  });
  it("undo restores in reverse order and keeps refused entries legible", async () => {
    const { service, read } = harness([
      row("one"),
      { ...row("two"), field: "beer" },
    ]);
    await service.apply(actor, read().id, 0);
    service.cellar = {
      restoreArrival: jest
        .fn()
        .mockRejectedValueOnce(Error("newer use"))
        .mockResolvedValueOnce({
          restored: true,
          sharedCatalogueRetained: false,
        }),
    };
    await service.undo(actor, read().id, read().revision);
    expect(
      service.cellar.restoreArrival.mock.calls.map((args: any[]) => args[3]),
    ).toEqual(["two", "one"]);
    expect(read().rows.map((r) => r.status)).toEqual(["undone", "written"]);
    expect(read().rows[1].reason).toBe("newer use");
    // codex-audit/C2-adopt.md #4: one row's restore threw and is still
    // 'written' — the header must say so rather than claim a clean 'undone'.
    expect(read().status).toBe("undone_with_issues");
  });
  it("lets undo resume a batch that ended 'applied_with_issues', not only a clean 'applied'", async () => {
    const { service, read } = harness([
      row("kept"),
      { ...row("lost"), field: "beer" },
    ]);
    service.write
      .mockReset()
      .mockResolvedValueOnce({ written: true })
      .mockRejectedValueOnce(Error("connection lost"));
    await service.apply(actor, read().id, 0);
    expect(read().rows.map((r: ConfigurationRow) => r.status)).toEqual([
      "written",
      "unconfirmed",
    ]);
    expect(read().status).toBe("applied_with_issues");
    service.cellar = {
      restoreArrival: jest
        .fn()
        .mockResolvedValue({ restored: true, sharedCatalogueRetained: false }),
    };
    // Before the fix, undo() rejected anything but a clean 'applied' with
    // "outside its undo window, changed, or already reversed" — even though
    // the window was open and the one written row was fully restorable.
    await service.undo(actor, read().id, read().revision);
    expect(service.cellar.restoreArrival).toHaveBeenCalledTimes(1);
    expect(read().rows.map((r: ConfigurationRow) => r.status)).toEqual([
      "undone",
      "unconfirmed",
    ]);
    expect(read().status).toBe("undone");
  });
  it("resumes a batch a crash stranded at 'undoing' by retrying only what did not come back", async () => {
    const { service, read } = harness([row("one"), row("two")]);
    await service.apply(actor, read().id, 0);
    await service.saveBatch(actor, read(), { status: "undoing" });
    // One row already came back on a prior attempt; the other is still
    // 'written' because the process died before its restore ran.
    await service.saveBatch(actor, read(), {
      rows: [{ ...read().rows[0], status: "undone" }, read().rows[1]],
    });
    service.cellar = {
      restoreArrival: jest
        .fn()
        .mockResolvedValue({ restored: true, sharedCatalogueRetained: false }),
    };
    await service.undo(actor, read().id, read().revision);
    expect(service.cellar.restoreArrival).toHaveBeenCalledTimes(1);
    expect(read().rows.map((r: ConfigurationRow) => r.status)).toEqual([
      "undone",
      "undone",
    ]);
    expect(read().status).toBe("undone");
  });
  it("issues an apply seal only over a draft with pending entries, never a sealed or empty one", async () => {
    const { service, read } = harness();
    const issued = await service.issueApplySeal(actor, read().id);
    expect(issued).toEqual({ challenge: "tok", expiresAt: "later", action: "apply" });
    expect(service.sealChallenges.issue).toHaveBeenCalledWith({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      subjectKind: "configuration_batch",
      subjectId: read().id,
      action: "apply",
      args: { batchId: read().id, revision: 0 },
    });
    await service.saveBatch(actor, read(), { status: "applied" });
    await expect(service.issueApplySeal(actor, read().id)).rejects.toThrow(
      "already been sealed",
    );
  });
});
