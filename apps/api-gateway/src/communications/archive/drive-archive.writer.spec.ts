/**
 * The four Google Drive calls an export makes, proved against FIXTURED request
 * and response shapes (ADR 0118 D16).
 *
 * NO REAL GOOGLE CALL IS MADE HERE OR ANYWHERE IN THIS MODULE'S SPECS. The
 * shapes below are a transcript of `drive-archive.writer.ts`'s own header, which
 * is where the request/response contract is recorded, and `fetchImpl` is the
 * seam — the same one `house-inbox.spec.ts` uses on the Gmail side, for the same
 * reason: a test that needs a live account is a test nobody runs.
 *
 * What is asserted is what would silently break:
 *
 *   1. AN EXISTING FOLDER IS REUSED, NOT RECREATED. An export that made a
 *      second "Mudavym mail archive" every night would scatter one house's mail
 *      across a folder per run.
 *   2. THE FOLDER SEARCH IS ESCAPED. A vendor called `O'Brien Wines` is
 *      ordinary, and an unescaped apostrophe makes the query a syntax error.
 *   3. THE UPLOAD IS `multipart/related` WITH THE METADATA FIRST. Drive rejects
 *      any other order, and `FormData` cannot produce it.
 *   4. A REFUSAL NAMES ITS CAUSE. "Request failed" is the message that makes an
 *      operator retry the same broken thing, and 403 here means a scope this
 *      build refuses to widen behind the account holder's back.
 */

import { DriveArchiveWriter, driveQueryLiteral } from "./drive-archive.writer";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function fixture(
  responses: Array<{ status?: number; json?: unknown; text?: string }>,
) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = responses[i++] ?? { status: 500, text: "no fixture" };
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => next.json,
      text: async () => next.text ?? JSON.stringify(next.json ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const writer = new DriveArchiveWriter();
  writer.fetchImpl = fetchImpl;
  return { writer, calls };
}

describe("the folder search", () => {
  it("escapes a name Drive's own query language would choke on", () => {
    expect(driveQueryLiteral("O'Brien Wines")).toBe("'O\\'Brien Wines'");
    expect(driveQueryLiteral("back\\slash")).toBe("'back\\\\slash'");
  });

  it("REUSES a folder that already exists rather than creating a second one", async () => {
    const { writer, calls } = fixture([
      { json: { files: [{ id: "folder-1", name: "Mudavym mail archive" }] } },
    ]);

    const folder = await writer.ensureFolder(
      "tok",
      "Mudavym mail archive",
      null,
    );

    expect(folder).toEqual({ id: "folder-1", name: "Mudavym mail archive" });
    // ONE call: the search. No create.
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
    const q = new URL(calls[0].url).searchParams.get("q") ?? "";
    expect(q).toContain("'Mudavym mail archive'");
    expect(q).toContain("'application/vnd.google-apps.folder'");
    expect(q).toContain("trashed = false");
    expect(q).toContain("'root' in parents");
  });

  it("creates the folder under its parent when the search finds nothing", async () => {
    const { writer, calls } = fixture([
      { json: { files: [] } },
      { json: { id: "folder-2", name: "2026-09" } },
    ]);

    const folder = await writer.ensureFolder("tok", "2026-09", "folder-1");

    expect(folder.id).toBe("folder-2");
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe("POST");
    const body = JSON.parse(calls[1].body ?? "{}");
    expect(body).toEqual({
      name: "2026-09",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["folder-1"],
    });
    expect(new URL(calls[0].url).searchParams.get("q")).toContain(
      "'folder-1' in parents",
    );
  });

  it("walks a path, threading each folder's id into the next", async () => {
    const { writer, calls } = fixture([
      { json: { files: [] } },
      { json: { id: "root-archive", name: "Mudavym mail archive" } },
      { json: { files: [] } },
      { json: { id: "house-folder", name: "Sim Meyhouse (abc)" } },
    ]);

    const folder = await writer.ensureFolderPath("tok", [
      "Mudavym mail archive",
      "Sim Meyhouse (abc)",
    ]);

    expect(folder.id).toBe("house-folder");
    expect(JSON.parse(calls[3].body ?? "{}").parents).toEqual(["root-archive"]);
  });

  it("refuses a path with no segments rather than returning a folder nobody named", async () => {
    const { writer } = fixture([]);
    await expect(writer.ensureFolderPath("tok", [])).rejects.toThrow(
      /nowhere to write is a failure, not an empty run/,
    );
  });
});

describe("the upload", () => {
  it("sends multipart/related with the metadata part FIRST", async () => {
    const { writer, calls } = fixture([
      { json: { id: "file-9", name: "c1.json", size: "4096" } },
    ]);

    const result = await writer.uploadJson("tok", {
      name: "c1.json",
      parentId: "month-folder",
      body: '{"hello":"world"}',
    });

    expect(result).toEqual({ id: "file-9", name: "c1.json", size: 4096 });
    expect(calls[0].url).toContain("/upload/drive/v3/files?uploadType=multipart");
    const contentType = calls[0].headers["Content-Type"];
    expect(contentType).toMatch(/^multipart\/related; boundary=mudavym-/);
    const boundary = contentType.split("boundary=")[1];
    const payload = calls[0].body ?? "";
    const parts = payload.split(`--${boundary}`);
    // parts[0] is empty, parts[1] is the metadata, parts[2] is the document.
    expect(parts[1]).toContain('"name":"c1.json"');
    expect(parts[1]).toContain('"parents":["month-folder"]');
    expect(parts[2]).toContain('{"hello":"world"}');
    expect(payload.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("treats a 200 with no file id as a FAILURE, not a success", async () => {
    const { writer } = fixture([{ json: { name: "c1.json" } }]);
    await expect(
      writer.uploadJson("tok", {
        name: "c1.json",
        parentId: "p",
        body: "{}",
      }),
    ).rejects.toThrow(/nothing to read back and nothing to prove was written/);
  });
});

describe("the read-back", () => {
  it("returns the bytes the house's Drive actually holds", async () => {
    const { writer, calls } = fixture([{ text: '{"hello":"world"}' }]);
    await expect(writer.readBack("tok", "file-9")).resolves.toBe(
      '{"hello":"world"}',
    );
    expect(calls[0].url).toBe(
      "https://www.googleapis.com/drive/v3/files/file-9?alt=media",
    );
  });
});

describe("a refusal names its cause", () => {
  it("says a 403 is the SCOPE, and does not offer to widen it", async () => {
    const { writer } = fixture([
      { status: 403, text: '{"error":{"message":"Insufficient Permission"}}' },
    ]);
    await expect(
      writer.ensureFolder("tok", "Mudavym mail archive", null),
    ).rejects.toThrow(
      /403[\s\S]*drive\.file[\s\S]*never widened behind the account holder's back/,
    );
  });

  it("says a 429 stopped the run rather than retrying in a loop", async () => {
    const { writer } = fixture([{ status: 429, text: "slow down" }]);
    await expect(writer.readBack("tok", "file-9")).rejects.toThrow(
      /429[\s\S]*recorded as not exported/,
    );
  });

  it("says a 401 needs the person to reconnect", async () => {
    const { writer } = fixture([{ status: 401, text: "bad token" }]);
    await expect(
      writer.uploadJson("tok", { name: "c.json", parentId: "p", body: "{}" }),
    ).rejects.toThrow(/401[\s\S]*made again by the person who owns it/);
  });
});
