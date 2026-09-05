/**
 * The house's own archive of its mail — proved at the seams that matter
 * (ADR 0118 D16, decided 2026-09-05).
 *
 * Ten things, each of which would be a silent falsehood if it broke:
 *
 *   1. NO ROW IS NOT A CHOICE. A house nobody asked reads `chosen: false`, and
 *      the sentence says so. Reporting it as a recorded `none` would turn
 *      "we never asked" into "they said no".
 *   2. THE PAID TIER IS RECORDED AND NEVER ARMED. OD-23 is open, so choosing
 *      `mudavym_archive` writes the ask, refuses the arming, and names the
 *      decision in the refusal. It is never a silent free tier and never a
 *      silent no-op.
 *   3. `own_cloud` IS ARMED ONLY AFTER THE FOLDER EXISTS. Arming on an
 *      intention would make the sweep hold mail for an export with nowhere to
 *      go.
 *   4. A FOLDER THAT COULD NOT BE CREATED IS RECORDED UNARMED, WITH THE REASON.
 *   5. THE EXPORT VERIFIES ITSELF BY READING BACK. A 200 is the provider's
 *      claim; the hash of the bytes that come back is the evidence.
 *   6. A MISMATCH IS A FAILURE, NOT A SUCCESS. Mudavym's copy is deleted on the
 *      strength of this hash, so a differing read-back must not pass.
 *   7. A FAILED EXPORT IS A FAILURE WITH A REASON, PER CONVERSATION. Never
 *      "nothing to export".
 *   8. A COUNT IS RECORDED ON EVERY PATH OUT, including the refusal and the
 *      run that found nothing (ADR 0078).
 *   9. AN ATTACHMENT WHOSE BYTES ARE MISSING IS NAMED. `attachments_exported <
 *      attachments_considered` on the row, and the missing one is listed inside
 *      the document — a short copy must be legible as a short copy.
 *  10. THE RAW MAIL GOES OUT VERBATIM. The document holds `message_text`,
 *      `content` and `email_headers` exactly as stored: this file IS the
 *      house's copy, so nothing in it is normalised or trimmed.
 *
 * No test here reaches a network, a mailbox, a bucket or a live database.
 */

import { createHash } from "node:crypto";
import { HouseMailArchiveService } from "./house-mail-archive.service";
import { DriveArchiveWriter } from "./drive-archive.writer";
import {
  ARCHIVE_PAID_TIER_REFUSAL,
  archiveMonth,
  archiveSegment,
} from "./house-mail-archive.constants";
import type { DatabaseService } from "../../database/database.service";
import type { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PERSON = "cccccccc-0000-4000-8000-cccccccccccc";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const CONV = "11111111-0000-4000-8000-111111111111";
const PROVIDER = "99999999-0000-4000-8000-999999999999";
const SEAL = "5ea15ea1-0000-4000-8000-5ea15ea15ea1";

type Rows = Record<string, unknown>[] | { error: { message: string } };

interface Recorded {
  tables: string[];
  inserts: Array<{ table: string; body: Record<string, unknown> }>;
  upserts: Array<{ table: string; body: Record<string, unknown> }>;
  downloaded: string[];
}

/** The supabase-shaped stub, addressed by table. Same shape as the sibling specs. */
function build(rows: Record<string, Rows>, downloads: Record<string, string> = {}) {
  const rec: Recorded = { tables: [], inserts: [], upserts: [], downloaded: [] };

  const chain = (table: string, payload: Rows) => {
    const failed = !Array.isArray(payload);
    const data = Array.isArray(payload) ? payload : null;
    const error = failed
      ? (payload as { error: { message: string } }).error
      : null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.in = pass;
    self.is = pass;
    self.not = pass;
    self.order = pass;
    self.limit = pass;
    self.insert = (body: Record<string, unknown>) => {
      rec.inserts.push({ table, body });
      return self;
    };
    self.upsert = (body: Record<string, unknown>) => {
      rec.upserts.push({ table, body });
      return self;
    };
    self.update = pass;
    self.single = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.maybeSingle = () => Promise.resolve({ data: data?.[0] ?? null, error });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve);
    return self;
  };

  const db = {
    supabase: {
      from: (table: string) => {
        rec.tables.push(table);
        return chain(table, rows[table] ?? []);
      },
      storage: {
        from: () => ({
          download: (path: string) => {
            rec.downloaded.push(path);
            const bytes = downloads[path];
            if (bytes === undefined) {
              return Promise.resolve({
                data: null,
                error: { message: "Object not found" },
              });
            }
            return Promise.resolve({
              data: {
                arrayBuffer: async () => Buffer.from(bytes, "utf8"),
              },
              error: null,
            });
          },
        }),
      },
    },
  } as unknown as DatabaseService;

  return { rec, db };
}

function oauth(token = "tok"): IntegrationsOauthService {
  return {
    getAccessToken: jest.fn(async () => token),
  } as unknown as IntegrationsOauthService;
}

function failingOauth(message: string): IntegrationsOauthService {
  return {
    getAccessToken: jest.fn(async () => {
      throw new Error(message);
    }),
  } as unknown as IntegrationsOauthService;
}

/** A writer whose four calls are scripted, so no fetch and no Google. */
function writer(script: {
  folder?: { id: string };
  upload?: { id: string; size: number | null };
  /** What Drive hands back. Defaults to the exact bytes it was given. */
  readBack?: (uploaded: string) => string;
  throwOn?: "folder" | "upload" | "readBack";
  message?: string;
}) {
  const w = new DriveArchiveWriter();
  let lastBody = "";
  w.ensureFolderPath = jest.fn(async () => {
    if (script.throwOn === "folder") throw new Error(script.message ?? "no");
    return script.folder ?? { id: "folder-1", name: "folder" };
  });
  w.uploadJson = jest.fn(async (_t: string, p: { body: string }) => {
    if (script.throwOn === "upload") throw new Error(script.message ?? "no");
    lastBody = p.body;
    return {
      id: script.upload?.id ?? "file-1",
      name: "x.json",
      size: script.upload?.size ?? null,
    };
  });
  w.readBack = jest.fn(async () => {
    if (script.throwOn === "readBack") throw new Error(script.message ?? "no");
    return script.readBack ? script.readBack(lastBody) : lastBody;
  });
  return { w, uploaded: () => lastBody };
}

const HOUSE_ROW = { id: HOUSE, name: "Sim Meyhouse", country: "Türkiye", state_province: null };
const GRANT_ROW = {
  id: GRANT,
  user_id: PERSON,
  restaurant_id: HOUSE,
  integration_id: "google_drive",
  revoked_at: null,
};
const ARMED_SETTINGS = [
  {
    restaurant_id: HOUSE,
    mode: "own_cloud",
    chosen_by: PERSON,
    chosen_at: "2026-09-05T00:00:00.000Z",
    armed_at: "2026-09-05T00:00:00.000Z",
    refused_because: null,
    connection_id: GRANT,
    drive_folder_id: "folder-house",
    drive_folder_path: "Mudavym mail archive/Sim Meyhouse (abc)",
    price_minor_units: null,
    price_currency: null,
    price_unit: null,
    price_decision: null,
  },
];
const CONVERSATION = {
  id: CONV,
  order_id: null,
  provider_id: PROVIDER,
  direction: "inbound",
  channel: "email",
  message_text: "Subject: Re: order\n\n14.50 per case, firm to Friday.",
  content: null,
  email_headers: { from: "sales@acme.test", subject: "Re: order" },
  received_at: "2026-07-01T09:00:00.000Z",
  created_at: "2026-07-01T09:00:01.000Z",
  gmail_message_id: "g1",
  gmail_thread_id: "t1",
  message_id: "<m1@acme.test>",
  mirrored_by_grant_id: "grant-x",
};

describe("the path segments", () => {
  it("never produces an empty segment, so no path has a hole in it", () => {
    expect(archiveSegment("")).toBe("unnamed");
    expect(archiveSegment(null)).toBe("unnamed");
    expect(archiveSegment("   ")).toBe("unnamed");
    expect(archiveSegment("Acme / Wines: Ltd")).toBe("Acme - Wines- Ltd");
  });

  it("dates a reply by when it ARRIVED, and says so when it cannot", () => {
    expect(archiveMonth("2026-07-01T09:00:00.000Z")).toBe("2026-07");
    expect(archiveMonth(null)).toBe("undated");
    expect(archiveMonth("not a date")).toBe("undated");
  });
});

describe("the choice", () => {
  it("says NOBODY WAS ASKED rather than reporting a recorded 'none'", async () => {
    const { db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const settings = await service.settingsFor(HOUSE);

    expect(settings.chosen).toBe(false);
    expect(settings.mode).toBe("none");
    expect(settings.says).toMatch(/Nobody has chosen for this restaurant yet/);
    expect(settings.says).toMatch(/a default, not a decision/);
  });

  it("REFUSES to read a failed read as 'this house keeps nothing'", async () => {
    const { db } = build({
      house_mail_archive_settings: { error: { message: "connection reset" } },
    });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    await expect(service.settingsFor(HOUSE)).rejects.toThrow(
      /must not delete mail on the strength of a failed read/,
    );
  });

  it("records the paid archive and REFUSES to arm it, naming OD-23", async () => {
    const { rec, db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    await service.choose({
      restaurantId: HOUSE,
      actorUserId: PERSON,
      mode: "mudavym_archive",
      sealId: SEAL,
    });

    const written = rec.upserts.find(
      (u) => u.table === "house_mail_archive_settings",
    );
    expect(written).toBeDefined();
    expect(written!.body.mode).toBe("mudavym_archive");
    // Recorded: the house asked, and the ask is on the row for the founder.
    expect(written!.body.chosen_by).toBe(PERSON);
    expect(written!.body.chosen_seal_id).toBe(SEAL);
    // NOT armed, and the reason names the open decision.
    expect(written!.body.armed_at).toBeNull();
    expect(String(written!.body.refused_because)).toContain("OD-23");
    expect(String(written!.body.refused_because)).toContain("NOT armed");
    // And no price is invented on the way past.
    expect(written!.body.price_minor_units).toBeNull();
    expect(written!.body.price_currency).toBeNull();
  });

  it("arms 'none' immediately, because doing nothing IS what it means", async () => {
    const { rec, db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    await service.choose({
      restaurantId: HOUSE,
      actorUserId: PERSON,
      mode: "none",
      sealId: SEAL,
    });

    const written = rec.upserts[0].body;
    expect(written.mode).toBe("none");
    expect(written.armed_at).toBeTruthy();
    expect(written.refused_because).toBeNull();
  });

  it("refuses own_cloud with no Drive connection named", async () => {
    const { db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    await expect(
      service.choose({
        restaurantId: HOUSE,
        actorUserId: PERSON,
        mode: "own_cloud",
        sealId: SEAL,
      }),
    ).rejects.toThrow(/Connect Google Drive on \/connections first/);
  });

  it("arms own_cloud only AFTER the folder exists in the house's Drive", async () => {
    const { rec, db } = build({
      house_mail_archive_settings: [],
      integration_oauth_connections: [GRANT_ROW],
      restaurants: [HOUSE_ROW],
    });
    const scripted = writer({ folder: { id: "folder-house" } });
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    await service.choose({
      restaurantId: HOUSE,
      actorUserId: PERSON,
      mode: "own_cloud",
      connectionId: GRANT,
      sealId: SEAL,
    });

    expect(scripted.w.ensureFolderPath).toHaveBeenCalled();
    const written = rec.upserts[0].body;
    expect(written.mode).toBe("own_cloud");
    expect(written.armed_at).toBeTruthy();
    expect(written.drive_folder_id).toBe("folder-house");
    expect(String(written.drive_folder_path)).toContain("Mudavym mail archive");
    expect(String(written.drive_folder_path)).toContain(HOUSE);
  });

  it("records own_cloud UNARMED, with the reason, when the folder cannot be made", async () => {
    const { rec, db } = build({
      house_mail_archive_settings: [],
      integration_oauth_connections: [GRANT_ROW],
      restaurants: [HOUSE_ROW],
    });
    const scripted = writer({
      throwOn: "folder",
      message: "Google refused the attempt to create the archive folder (403).",
    });
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    await service.choose({
      restaurantId: HOUSE,
      actorUserId: PERSON,
      mode: "own_cloud",
      connectionId: GRANT,
      sealId: SEAL,
    });

    const written = rec.upserts[0].body;
    expect(written.armed_at).toBeNull();
    expect(String(written.refused_because)).toContain("403");
    expect(String(written.refused_because)).toContain("NOT armed");
    expect(written.drive_folder_id).toBeNull();
  });

  it("refuses a grant that is not Drive, and one that was disconnected", async () => {
    const notDrive = build({
      house_mail_archive_settings: [],
      integration_oauth_connections: [
        { ...GRANT_ROW, integration_id: "gmail_read" },
      ],
    });
    await expect(
      new HouseMailArchiveService(notDrive.db, oauth(), writer({}).w).choose({
        restaurantId: HOUSE,
        actorUserId: PERSON,
        mode: "own_cloud",
        connectionId: GRANT,
        sealId: SEAL,
      }),
    ).rejects.toThrow(/is a gmail_read grant, not Google Drive/);

    const revoked = build({
      house_mail_archive_settings: [],
      integration_oauth_connections: [
        { ...GRANT_ROW, revoked_at: "2026-09-01T00:00:00.000Z" },
      ],
    });
    await expect(
      new HouseMailArchiveService(revoked.db, oauth(), writer({}).w).choose({
        restaurantId: HOUSE,
        actorUserId: PERSON,
        mode: "own_cloud",
        connectionId: GRANT,
        sealId: SEAL,
      }),
    ).rejects.toThrow(/has been disconnected/);
  });
});

describe("the export", () => {
  const armedTables = (extra: Record<string, Rows> = {}) => ({
    house_mail_archive_settings: ARMED_SETTINGS,
    integration_oauth_connections: [GRANT_ROW],
    restaurants: [HOUSE_ROW],
    providers: [{ id: PROVIDER, name: "Acme Wines" }],
    house_mail_retention_windows: [{ figure_days: 92 }],
    house_mail_exports: [],
    procurement_conversations: [CONVERSATION],
    conversation_attachments: [],
    ...extra,
  });

  it("writes the raw mail VERBATIM, and verifies it by reading it back", async () => {
    const { rec, db } = build(armedTables());
    const scripted = writer({ upload: { id: "file-1", size: 512 } });
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "requested",
      sealId: SEAL,
    });

    expect(run.considered).toBe(1);
    expect(run.exported).toBe(1);
    expect(run.failed).toBe(0);

    // The document is the house's own copy: nothing is normalised.
    const document = JSON.parse(scripted.uploaded());
    expect(document.messageText).toBe(CONVERSATION.message_text);
    expect(document.emailHeaders).toEqual(CONVERSATION.email_headers);
    expect(document.content).toBeNull();
    expect(document.conversationId).toBe(CONV);
    expect(document.vendor).toBe("Acme Wines");
    expect(document.retention.jurisdiction).toBe("TR");
    expect(document.retention.factsFloorYears).toBe(10);
    expect(document.retention.rawMailWindowDays).toBe(92);

    // The receipt carries the hash of exactly those bytes.
    const receipt = rec.inserts.find((i) => i.table === "house_mail_exports");
    expect(receipt).toBeDefined();
    expect(receipt!.body.status).toBe("exported");
    expect(receipt!.body.content_sha256).toBe(
      createHash("sha256").update(scripted.uploaded(), "utf8").digest("hex"),
    );
    expect(receipt!.body.drive_file_id).toBe("file-1");
    expect(String(receipt!.body.file_path)).toContain("Acme Wines/2026-07/");
    expect(String(receipt!.body.file_path)).toContain(`${CONV}.json`);
    expect(receipt!.body.jurisdiction).toBe("TR");
  });

  it("treats a read-back that DIFFERS as a failure, not a success", async () => {
    const { rec, db } = build(armedTables());
    const scripted = writer({
      readBack: () => '{"tampered":true}',
    });
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "scheduled",
    });

    expect(run.exported).toBe(0);
    expect(run.failed).toBe(1);
    const receipt = rec.inserts.find((i) => i.table === "house_mail_exports");
    expect(receipt!.body.status).toBe("failed");
    expect(receipt!.body.content_sha256).toBeNull();
    expect(String(receipt!.body.failure_reason)).toMatch(
      /does not match what was sent/,
    );
    expect(String(receipt!.body.failure_reason)).toMatch(
      /the hash is the evidence/,
    );
  });

  it("records a FAILURE with a reason per conversation when Drive refuses", async () => {
    const { rec, db } = build(armedTables());
    const scripted = writer({
      throwOn: "upload",
      message: "Google rate-limited the attempt to upload (429).",
    });
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "scheduled",
    });

    expect(run.failed).toBe(1);
    expect(run.outcomes[0].status).toBe("failed");
    expect(run.outcomes[0].failureReason).toContain("429");
    const receipt = rec.inserts.find((i) => i.table === "house_mail_exports");
    expect(receipt!.body.status).toBe("failed");
    expect(receipt!.body.conversation_id).toBe(CONV);
    // And the run says failures, never "nothing to export".
    expect(run.says).toMatch(/1 failed with a reason recorded against it/);
    expect(run.says).not.toMatch(/nothing to export/i);
  });

  it("records a FAILURE per conversation when the grant itself cannot be used", async () => {
    const { rec, db } = build(armedTables());
    const service = new HouseMailArchiveService(
      db,
      failingOauth("Google Drive needs to be reconnected."),
      writer({}).w,
    );

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "scheduled",
    });

    expect(run.considered).toBe(1);
    expect(run.failed).toBe(1);
    const receipt = rec.inserts.find((i) => i.table === "house_mail_exports");
    expect(receipt!.body.status).toBe("failed");
    expect(String(receipt!.body.failure_reason)).toContain("reconnected");
    expect(run.says).toMatch(/retention sweep will hold them/);
  });

  it("names an attachment whose bytes are gone rather than shipping a short copy", async () => {
    const { rec, db } = build(
      armedTables({
        conversation_attachments: [
          {
            id: "a1",
            filename: "invoice.pdf",
            mime_type: "application/pdf",
            size_bytes: 5,
            storage_path: `${HOUSE}/${CONV}/aaaa-invoice.pdf`,
            sha256: "deadbeef",
          },
          {
            id: "a2",
            filename: "gone.pdf",
            mime_type: "application/pdf",
            size_bytes: 9,
            storage_path: `${HOUSE}/${CONV}/bbbb-gone.pdf`,
            sha256: "cafebabe",
          },
        ],
      }),
      { [`${HOUSE}/${CONV}/aaaa-invoice.pdf`]: "PDF-1" },
    );
    const scripted = writer({});
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "requested",
      sealId: SEAL,
    });

    expect(run.exported).toBe(1);
    const document = JSON.parse(scripted.uploaded());
    expect(document.attachments).toHaveLength(1);
    expect(document.attachments[0].filename).toBe("invoice.pdf");
    expect(document.attachments[0].base64).toBe(
      Buffer.from("PDF-1", "utf8").toString("base64"),
    );
    expect(document.attachmentsMissing).toHaveLength(1);
    expect(document.attachmentsMissing[0].filename).toBe("gone.pdf");
    expect(document.attachmentsMissing[0].why).toMatch(/could not be read/);

    const receipt = rec.inserts.find((i) => i.table === "house_mail_exports");
    expect(receipt!.body.attachments_considered).toBe(2);
    expect(receipt!.body.attachments_exported).toBe(1);
  });

  it("REFUSES the paid archive and records the refusal as a run", async () => {
    const { rec, db } = build({
      house_mail_archive_settings: [
        {
          restaurant_id: HOUSE,
          mode: "mudavym_archive",
          chosen_by: PERSON,
          chosen_at: "2026-09-05T00:00:00.000Z",
          armed_at: null,
          refused_because: ARCHIVE_PAID_TIER_REFUSAL,
          connection_id: null,
          drive_folder_id: null,
          drive_folder_path: null,
          price_minor_units: null,
          price_currency: null,
          price_unit: null,
          price_decision: null,
        },
      ],
    });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "scheduled",
    });

    expect(run.exported).toBe(0);
    expect(run.error).toContain("OD-23");
    const recorded = rec.inserts.find(
      (i) => i.table === "house_mail_export_runs",
    );
    expect(recorded).toBeDefined();
    expect(recorded!.body.mode).toBe("mudavym_archive");
    expect(recorded!.body.armed).toBe(false);
    expect(String(recorded!.body.error)).toContain("OD-23");
    expect(String(recorded!.body.says)).toContain("OD-23");
  });

  it("records a count on a run that exported nothing", async () => {
    const { rec, db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "scheduled",
    });

    const recorded = rec.inserts.find(
      (i) => i.table === "house_mail_export_runs",
    );
    expect(recorded).toBeDefined();
    expect(recorded!.body.considered).toBe(0);
    expect(recorded!.body.exported).toBe(0);
    expect(recorded!.body.failed).toBe(0);
    // Every count is present as a number, so an omitted one cannot reach the
    // NOT NULL column and read as zero.
    expect(typeof recorded!.body.considered).toBe("number");
    expect(String(recorded!.body.says)).toMatch(
      /correct outcome rather than a skipped run/,
    );
    expect(run.says).toBeTruthy();
  });

  it("skips a conversation that already has a verified copy", async () => {
    const { rec, db } = build(
      armedTables({
        house_mail_exports: [{ conversation_id: CONV }],
      }),
    );
    const scripted = writer({});
    const service = new HouseMailArchiveService(db, oauth(), scripted.w);

    const run = await service.runExport({
      restaurantId: HOUSE,
      trigger: "scheduled",
    });

    expect(scripted.w.uploadJson).not.toHaveBeenCalled();
    expect(run.considered).toBe(0);
    expect(run.says).toMatch(/already has a verified copy/);
    // And the run is still recorded: a run that found nothing is not a run that
    // did not happen.
    expect(
      rec.inserts.some((i) => i.table === "house_mail_export_runs"),
    ).toBe(true);
  });
});

describe("what the sweep reads", () => {
  it("REFUSES rather than returning an empty set when the record cannot be read", async () => {
    const { db } = build({
      house_mail_exports: { error: { message: "statement timeout" } },
    });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    await expect(service.exportedAmong([CONV])).rejects.toThrow(
      /a sweep that cannot tell which replies were exported must not guess/,
    );
  });

  it("returns nothing for an empty ask without touching the database", async () => {
    const { rec, db } = build({});
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    await expect(service.exportedAmong([])).resolves.toEqual(new Set());
    expect(rec.tables).toEqual([]);
  });
});

describe("the disclosure the consent screen reads", () => {
  it("tells a Turkish house WITHOUT an archive that the duty is its own", async () => {
    const { db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const block = await service.disclosureFor(HOUSE, "TR");

    expect(block.jurisdictionNote).toMatch(/TTK 6102 Art\. 82/);
    expect(block.jurisdictionNote).toMatch(
      /this restaurant's own responsibility/,
    );
    // The paid tier is offered and its refusal travels with it.
    expect(block.paidTierRefusal).toContain("OD-23");
    expect(block.chosen).toBe(false);
  });

  it("tells a Turkish house WITH an armed archive that the export is the copy", async () => {
    const { db } = build({ house_mail_archive_settings: ARMED_SETTINGS });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const block = await service.disclosureFor(HOUSE, "TR");

    expect(block.armed).toBe(true);
    expect(block.jurisdictionNote).toMatch(/that exported file is the one/);
  });

  it("does NOT tell a British house a Turkish sentence", async () => {
    const { db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const block = await service.disclosureFor(HOUSE, "GB");

    expect(block.jurisdictionNote).toBeNull();
  });

  it("gives the UNKNOWN default the strict sentence it inherits", async () => {
    const { db } = build({ house_mail_archive_settings: [] });
    const service = new HouseMailArchiveService(db, oauth(), writer({}).w);

    const block = await service.disclosureFor(HOUSE, "UNKNOWN");

    expect(block.jurisdictionNote).toMatch(/TTK 6102/);
  });
});
