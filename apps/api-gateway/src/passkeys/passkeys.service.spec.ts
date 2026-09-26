/**
 * ADR 0222 (Proposed): passkeys on /profile.
 *
 * These tests drive the REAL `@simplewebauthn/server` verification with a
 * software authenticator built from node's own crypto (an ES256 key, a CBOR
 * attestation object with fmt "none", a DER signature), so what they prove is
 * the ceremony end to end -- not a mocked `verified: true`. The database is an
 * in-memory stand-in for the three tables the service touches.
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "crypto";
import * as bcrypt from "bcrypt";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PASSKEY_AUDIT_ACTIONS, PasskeysService } from "./passkeys.service";
import { resolveRelyingParty } from "./relying-party";

// The helpers subpath is resolved by jest through the package's `exports`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isoCBOR } = require("@simplewebauthn/server/helpers");

/* ── an in-memory stand-in for the supabase query builder ─────────────── */

type Row = Record<string, any>;

class FakeDb {
  tables: Record<string, Row[]> = {
    user_passkeys: [],
    webauthn_challenges: [],
    users: [],
    system_audit_log: [],
    notifications: [],
  };
  failInsertOn: string | null = null;
  seq = 0;

  from(table: string) {
    return new Query(this, table);
  }
}

class Query implements PromiseLike<{ data: any; error: any }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | null = null;
  private filters: Array<(r: Row) => boolean> = [];
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols?: string) {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.payload = row;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  is(k: string, v: unknown) {
    this.filters.push((r) => (r[k] ?? null) === v);
    return this;
  }
  lt(k: string, v: string) {
    this.filters.push((r) => r[k] < v);
    return this;
  }
  order() {
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    ok?: ((v: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    bad?: ((e: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(ok, bad);
  }


  private run(): { data: any; error: any } {
    const rows =
      this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];
    if (this.op === "insert") {
      if (this.db.failInsertOn === this.table)
        return { data: null, error: { message: "insert refused" } };
      const row: Row = {
        id: `00000000-0000-4000-8000-${String(++this.db.seq).padStart(12, "0")}`,
        created_at: new Date().toISOString(),
        last_used_at: null,
        revoked_at: null,
        ...this.payload,
      };
      if (
        this.table === "user_passkeys" &&
        rows.some((r) => r.credential_id === row.credential_id)
      ) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key" },
        };
      }
      rows.push(row);
      out = [row];
    } else if (this.op === "update") {
      out = rows.filter(match);
      out.forEach((r) => Object.assign(r, this.payload));
    } else if (this.op === "delete") {
      out = rows.filter(match);
      this.db.tables[this.table] = rows.filter((r) => !match(r));
    } else {
      out = rows.filter(match);
    }
    const data = out.map((r) => ({ ...r }));
    if (this.mode === "single")
      return data.length === 1
        ? { data: data[0], error: null }
        : {
            data: null,
            error: { message: `expected 1 row, got ${data.length}` },
          };
    if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
}

/* ── a software authenticator ─────────────────────────────────────────── */

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | Buffer | string) =>
  createHash("sha256").update(b).digest();
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private counter = 0;
  uv = true;

  private cosePublicKey(): Uint8Array {
    const jwk = (this.keys.publicKey as KeyObject).export({
      format: "jwk",
    }) as { x: string; y: string };
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
      ]),
    );
  }

  private flags(attested: boolean) {
    return 0x01 | (this.uv ? 0x04 : 0) | (attested ? 0x40 : 0);
  }

  register(options: { challenge: string; rp: { id?: string } }, origin: string) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(options.rp.id ?? ""),
      Buffer.from([this.flags(true)]),
      u32(this.counter),
      Buffer.alloc(16),
      idLen,
      this.credentialId,
      Buffer.from(this.cosePublicKey()),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", new Uint8Array(authData)],
      ]),
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  assert(
    options: { challenge: string; rpId?: string },
    origin: string,
    rpId: string,
  ) {
    this.counter += 1;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([this.flags(false)]),
      u32(this.counter),
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.keys.privateKey,
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
      clientExtensionResults: {},
    };
  }
}

/* ── the service under test ───────────────────────────────────────────── */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HOUSE = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://mudavym.com";
const PASSWORD = "correct horse battery staple";

async function setup(
  role: string | null = "manager",
  passwordHash: string | null | undefined = undefined,
) {
  const db = new FakeDb();
  const hash =
    passwordHash === undefined ? await bcrypt.hash(PASSWORD, 4) : passwordHash;
  db.tables.users.push({
    user_id: USER,
    email: "m@example.com",
    name: "Mira",
    password_hash: hash,
  });
  db.tables.users.push({
    user_id: OTHER,
    email: "o@example.com",
    name: "Onur",
    password_hash: hash,
  });
  const organizations = { resolveRestaurantRole: jest.fn(async () => role) };
  const service = new PasskeysService(
    { client: db } as any,
    organizations as any,
  );
  return { db, service, organizations };
}

async function enrol(
  service: PasskeysService,
  auth: SoftAuthenticator,
  origin = ORIGIN,
  nickname: string | undefined = "Work laptop",
) {
  const { challengeId, options } = await service.startRegistration(
    USER,
    HOUSE,
    origin,
    PASSWORD,
  );
  return service.finishRegistration(
    USER,
    HOUSE,
    origin,
    challengeId,
    auth.register(options, origin),
    nickname,
  );
}

describe("relying party", () => {
  it("binds every mudavym.com origin to one RP ID, and refuses previews", () => {
    expect(resolveRelyingParty("https://mudavym.com", {} as any)).toEqual({
      rpId: "mudavym.com",
      origin: "https://mudavym.com",
    });
    expect(
      resolveRelyingParty("https://www.mudavym.com", {} as any)?.rpId,
    ).toBe("mudavym.com");
    expect(resolveRelyingParty("http://mudavym.com", {} as any)).toBeNull();
    expect(
      resolveRelyingParty("https://mudavym.com.evil.io", {} as any),
    ).toBeNull();
    expect(
      resolveRelyingParty("https://web-abc.vercel.app", {} as any),
    ).toBeNull();
    expect(resolveRelyingParty(undefined, {} as any)).toBeNull();
  });

  it("allows localhost only outside production", () => {
    expect(
      resolveRelyingParty("http://localhost:5173", {
        NODE_ENV: "development",
      } as any)?.rpId,
    ).toBe("localhost");
    expect(
      resolveRelyingParty("http://localhost:5173", {
        NODE_ENV: "production",
      } as any),
    ).toBeNull();
  });

  it("honours an override only when both halves are set and the origin is listed", () => {
    const env = {
      NODE_ENV: "production",
      WEBAUTHN_RP_ID: "example.org",
      WEBAUTHN_ORIGINS: "https://app.example.org",
    } as any;
    expect(resolveRelyingParty("https://app.example.org", env)?.rpId).toBe(
      "example.org",
    );
    expect(resolveRelyingParty("https://other.example.org", env)).toBeNull();
    expect(
      resolveRelyingParty("https://app.example.org", {
        WEBAUTHN_RP_ID: "example.org",
      } as any),
    ).toBeNull();
  });
});

describe("PasskeysService — enrolment", () => {
  it("verifies a real attestation, stores the credential per user, audits it and tells the person", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const receipt = await enrol(service, auth);

    expect(receipt.passkey.nickname).toBe("Work laptop");
    expect(receipt.passkey.rpId).toBe("mudavym.com");
    expect(receipt.audited).toBe(true);
    expect(receipt.notified).toBe(true);
    expect(db.tables.user_passkeys).toHaveLength(1);
    expect(db.tables.user_passkeys[0]).toMatchObject({
      user_id: USER,
      credential_id: b64u(auth.credentialId),
      rp_id: "mudavym.com",
    });
    expect(db.tables.system_audit_log[0]).toMatchObject({
      action: PASSKEY_AUDIT_ACTIONS.enrolled,
      actor_id: USER,
      restaurant_id: HOUSE,
      entity_type: "user_passkey",
    });
    expect(db.tables.notifications[0]).toMatchObject({
      user_id: USER,
      title: "A passkey was added to your account",
    });
    // the ceremony is gone: single use
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("asks for user verification and no attestation, and excludes what is already enrolled", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    const { options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      PASSWORD,
    );
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection?.userVerification).toBe("required");
    expect(options.rp.id).toBe("mudavym.com");
    expect(options.user.id).toBe(b64u(new TextEncoder().encode(USER)));
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual([
      b64u(auth.credentialId),
    ]);
  });

  it.each([["staff"], ["admin"], [null]])(
    "refuses a %s in this house before anything starts",
    async (role) => {
      const { db, service } = await setup(role as string | null);
      await expect(
        service.startRegistration(USER, HOUSE, ORIGIN, PASSWORD),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.tables.webauthn_challenges).toHaveLength(0);
    },
  );

  it("lets an owner enrol", async () => {
    const { service } = await setup("owner");
    await expect(
      enrol(service, new SoftAuthenticator()),
    ).resolves.toMatchObject({ audited: true });
  });

  it("refuses a session with no house", async () => {
    const { service } = await setup();
    await expect(
      service.startRegistration(USER, null, ORIGIN, PASSWORD),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("wants the password typed now, and refuses a wrong one with 403, never 401", async () => {
    const { service } = await setup();
    await expect(
      service.startRegistration(USER, HOUSE, ORIGIN, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.startRegistration(USER, HOUSE, ORIGIN, "nope"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses an account with no password until it sets one (ADR 0222 fork 1, as built)", async () => {
    const { service } = await setup("manager", null);
    await expect(
      service.startRegistration(USER, HOUSE, ORIGIN, PASSWORD),
    ).rejects.toThrow(/Set a password first/);
  });

  it("refuses a preview origin before anything starts", async () => {
    const { db, service } = await setup();
    await expect(
      service.startRegistration(
        USER,
        HOUSE,
        "https://web-abc.vercel.app",
        PASSWORD,
      ),
    ).rejects.toThrow(/only on mudavym.com/);
    expect(db.tables.webauthn_challenges).toHaveLength(0);
  });

  it("refuses a replayed ceremony", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      PASSWORD,
    );
    const response = auth.register(options, ORIGIN);
    await service.finishRegistration(
      USER,
      HOUSE,
      ORIGIN,
      challengeId,
      response,
      undefined,
    );
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        response,
        undefined,
      ),
    ).rejects.toThrow(/already used/);
  });

  it("refuses an expired ceremony", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      PASSWORD,
    );
    db.tables.webauthn_challenges[0].expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.register(options, ORIGIN),
        undefined,
      ),
    ).rejects.toThrow(/expired/);
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("refuses a ceremony finished on another address than it started on", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      PASSWORD,
    );
    const other = "https://www.mudavym.com";
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        other,
        challengeId,
        auth.register(options, other),
        undefined,
      ),
    ).rejects.toThrow(/another address/);
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("refuses a response signed for another origin or challenge (the library's check, really run)", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      PASSWORD,
    );
    const forged = auth.register(
      { ...options, challenge: b64u(randomBytes(32)) },
      ORIGIN,
    );
    await expect(
      service.finishRegistration(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        forged,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("refuses an authenticator that did not verify the user", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    auth.uv = false;
    await expect(enrol(service, auth)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.tables.user_passkeys).toHaveLength(0);
  });

  it("will not take another person's ceremony", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    const { challengeId, options } = await service.startRegistration(
      USER,
      HOUSE,
      ORIGIN,
      PASSWORD,
    );
    await expect(
      service.finishRegistration(
        OTHER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.register(options, ORIGIN),
        undefined,
      ),
    ).rejects.toThrow(/unknown/);
  });

  it("says a duplicate credential is a conflict, not a server fault", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    // the same authenticator credential, presented again past excludeCredentials
    db.tables.user_passkeys[0].rp_id = "elsewhere";
    await expect(enrol(service, auth)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("reports an audit row that failed instead of hiding it", async () => {
    const { db, service } = await setup();
    db.failInsertOn = "system_audit_log";
    const receipt = await enrol(service, new SoftAuthenticator());
    expect(receipt.audited).toBe(false);
    expect(receipt.auditReason).toBe("insert refused");
    expect(db.tables.user_passkeys).toHaveLength(1);
  });

  it("refuses a name over sixty characters", async () => {
    const { service } = await setup();
    await expect(
      enrol(service, new SoftAuthenticator(), ORIGIN, "x".repeat(61)),
    ).rejects.toThrow(/at most 60/);
  });
});

describe("PasskeysService — list and revoke", () => {
  it("lists only the caller's own passkeys, with eligibility in words", async () => {
    const { db, service } = await setup();
    await enrol(service, new SoftAuthenticator());
    db.tables.user_passkeys.push({
      ...db.tables.user_passkeys[0],
      id: "x",
      user_id: OTHER,
      credential_id: "other",
    });
    const mine = await service.list(USER, HOUSE);
    expect(mine.readable).toBe(true);
    expect(mine.eligible).toBe(true);
    expect(mine.passkeys).toHaveLength(1);
  });

  it("still lists a former manager's passkeys, and says why they cannot add one", async () => {
    const { service, organizations } = await setup();
    await enrol(service, new SoftAuthenticator());
    organizations.resolveRestaurantRole.mockResolvedValue("staff");
    const readout = await service.list(USER, HOUSE);
    expect(readout.passkeys).toHaveLength(1);
    expect(readout.eligible).toBe(false);
    expect(readout.eligibilityReason).toMatch(/owners and managers/);
  });

  it("revokes, keeps the row marked, audits, tells the person — and a revoked passkey no longer checks", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    const { passkey } = await enrol(service, auth);
    const receipt = await service.revoke(USER, HOUSE, passkey.id);
    expect(receipt.passkey.revokedAt).not.toBeNull();
    expect(receipt.audited).toBe(true);
    expect(db.tables.user_passkeys).toHaveLength(1);
    expect(db.tables.system_audit_log.map((r) => r.action)).toEqual([
      PASSKEY_AUDIT_ACTIONS.enrolled,
      PASSKEY_AUDIT_ACTIONS.revoked,
    ]);
    expect(db.tables.notifications.map((r) => r.title)).toContain(
      "A passkey was removed from your account",
    );
    await expect(service.startCheck(USER, HOUSE, ORIGIN)).rejects.toThrow(
      /no passkey/,
    );
  });

  it("lets a former manager remove what they enrolled", async () => {
    const { service, organizations } = await setup();
    const { passkey } = await enrol(service, new SoftAuthenticator());
    organizations.resolveRestaurantRole.mockResolvedValue("staff");
    await expect(
      service.revoke(USER, HOUSE, passkey.id),
    ).resolves.toMatchObject({ audited: true });
  });

  it("answers another person's passkey exactly like a missing one", async () => {
    const { service } = await setup();
    const { passkey } = await enrol(service, new SoftAuthenticator());
    await expect(
      service.revoke(OTHER, HOUSE, passkey.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("PasskeysService — check", () => {
  it("verifies a real assertion, advances the counter, stamps the use and audits it", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    expect(options.userVerification).toBe("required");
    const receipt = await service.finishCheck(
      USER,
      HOUSE,
      ORIGIN,
      challengeId,
      auth.assert(options, ORIGIN, "mudavym.com"),
    );
    expect(receipt.passkey.lastUsedAt).not.toBeNull();
    expect(Number(db.tables.user_passkeys[0].sign_count)).toBe(1);
    expect(db.tables.system_audit_log.at(-1)).toMatchObject({
      action: PASSKEY_AUDIT_ACTIONS.checked,
    });
  });

  it("refuses an assertion signed for another RP ID", async () => {
    const { service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    await expect(
      service.finishCheck(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.assert(options, ORIGIN, "evil.example"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a counter that went backwards (a cloned authenticator)", async () => {
    const { db, service } = await setup();
    const auth = new SoftAuthenticator();
    await enrol(service, auth);
    db.tables.user_passkeys[0].sign_count = 50;
    const { challengeId, options } = await service.startCheck(
      USER,
      HOUSE,
      ORIGIN,
    );
    await expect(
      service.finishCheck(
        USER,
        HOUSE,
        ORIGIN,
        challengeId,
        auth.assert(options, ORIGIN, "mudavym.com"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
