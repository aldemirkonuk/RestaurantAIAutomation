/**
 * Test harness for the passkey and sign-in-code specs (ADR 0222 / ADR 0229).
 * Not imported by any production code.
 *
 *   * `FakeDb` -- an in-memory stand-in for the supabase query builder, enough
 *     of it for the tables these services touch.
 *   * `SoftAuthenticator` -- a software WebAuthn authenticator built from
 *     node's own crypto (an ES256 key, a CBOR attestation object with fmt
 *     "none", a DER signature), so the specs drive the REAL
 *     `@simplewebauthn/server` verification end to end, not a mocked
 *     `verified: true`.
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "crypto";

// The helpers subpath is resolved through the package's `exports`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isoCBOR } = require("@simplewebauthn/server/helpers");

/* ── an in-memory stand-in for the supabase query builder ─────────────── */

export type Row = Record<string, any>;

export class FakeDb {
  tables: Record<string, Row[]> = {
    user_passkeys: [],
    webauthn_challenges: [],
    sign_in_codes: [],
    users: [],
    system_audit_log: [],
    notifications: [],
  };
  failInsertOn: string | null = null;
  failReadOn: string | null = null;
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
  gt(k: string, v: string) {
    this.filters.push((r) => r[k] > v);
    return this;
  }
  gte(k: string, v: string) {
    this.filters.push((r) => r[k] >= v);
    return this;
  }
  order() {
    return this;
  }
  limit() {
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
    ok?:
      | ((v: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>)
      | null,
    bad?: ((e: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(ok, bad);
  }

  private run(): { data: any; error: any } {
    const rows =
      this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === "select" && this.db.failReadOn === this.table)
      return { data: null, error: { message: "read refused" } };
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

export const b64u = (b: Uint8Array | Buffer) =>
  Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | Buffer | string) =>
  createHash("sha256").update(b).digest();
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private counter = 0;
  uv = true;
  /** The user handle the relying party gave at registration (base64url). */
  userHandle: string | null = null;
  /** Set to replay an old counter (a cloned authenticator). */
  setCounter(n: number) {
    this.counter = n;
  }

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

  register(
    options: { challenge: string; rp: { id?: string }; user?: { id: string } },
    origin: string,
  ) {
    this.userHandle = options.user?.id ?? null;
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
    withHandle = false,
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
        ...(withHandle && this.userHandle
          ? { userHandle: this.userHandle }
          : {}),
      },
      clientExtensionResults: {},
    };
  }
}
