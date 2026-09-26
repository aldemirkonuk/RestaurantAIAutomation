import "reflect-metadata";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService, JwtPayload } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SESSION_ENDED, sessionIsCurrent } from "./session-version";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * A password reset or change signs out every other session of that person
 * (ADR 0225; the founder, 2026-09-25, round 4, item 17: "Password
 * reset/change signs out every other session").
 *
 * The real AuthService, a real JwtService (tokens are signed and decoded as in
 * production), the real JwtStrategy, the real controller route and the real
 * WebsocketGateway, over the filter-honouring stub.
 */

const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRETS: Record<string, string> = {
  JWT_SECRET: "test-secret-for-password-sessions-spec",
  JWT_REFRESH_SECRET: "test-refresh-secret-for-password-sessions-spec",
};
const config = { get: (k: string) => SECRETS[k] } as any;
const OLD = "old-password-1";
const NEW = "new-password-2";
const HASH = bcrypt.hashSync(OLD, 4);

type Row = Record<string, any>;

function world(user: Row = {}): StubDb {
  return makeStubDb({
    users: [
      {
        user_id: U,
        email: "p@house.test",
        name: "P",
        password_hash: HASH,
        role: "manager",
        restaurant_id: A,
        email_verified: true,
        session_version: 0,
        ...user,
      },
      {
        user_id: OTHER,
        email: "o@house.test",
        name: "O",
        password_hash: HASH,
        role: "manager",
        restaurant_id: A,
        email_verified: true,
        session_version: 0,
      },
    ],
    user_restaurant_access: [
      { user_id: U, restaurant_id: A, role: "manager", is_active: true },
      { user_id: OTHER, restaurant_id: A, role: "manager", is_active: true },
    ],
    restaurants: [{ id: A, name: "Moda", city: "Istanbul" }],
    user_roles: [],
    password_resets: [
      {
        id: "r1",
        token: "reset-token",
        user_id: U,
        email: "p@house.test",
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        used_at: null,
      },
    ],
  });
}

const jwt = new JwtService({});

function service(db: StubDb, gateway?: WebsocketGateway): AuthService {
  const svc = new AuthService(
    jwt,
    config,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => undefined } as any,
  );
  if (gateway) (svc as any).websocketGateway = gateway;
  return svc;
}

const claims = (token: string) => jwt.decode(token) as JwtPayload;

async function signIn(db: StubDb, email = "p@house.test", password = OLD) {
  return service(db).login({ email, password });
}

/** What JwtAuthGuard does with a bearer token, past the signature check. */
function guard(db: StubDb, accessToken: string) {
  return new JwtStrategy(service(db)).validate(claims(accessToken));
}

async function refusedAsEnded(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(UnauthorizedException);
  expect((err as UnauthorizedException).getResponse()).toMatchObject({
    code: SESSION_ENDED,
  });
}

describe("every token carries the version it was minted under", () => {
  it("a sign-in mints sv = the person's current version", async () => {
    const db = world({ session_version: 3 });
    const pair = await signIn(db);
    expect(claims(pair.accessToken).sv).toBe(3);
    expect(claims(pair.refreshToken).sv).toBe(3);
  });

  it("before the column exists, sv is 0 and the session works", async () => {
    const db = world();
    for (const r of db.tables.users) delete r.session_version;
    const pair = await signIn(db);
    expect(claims(pair.accessToken).sv).toBe(0);
    await expect(guard(db, pair.accessToken)).resolves.toMatchObject({
      userId: U,
    });
  });

  it("a caller's hand-built user object is minted under the version read from the database", async () => {
    const db = world({ session_version: 2 });
    const pair = await (service(db) as any).generateTokens({
      user_id: U,
      email: "p@house.test",
      role: "manager",
      restaurant_id: A,
    });
    expect(claims(pair.accessToken).sv).toBe(2);
  });
});

describe("a password reset signs out every session", () => {
  it("both devices' access tokens are refused on their next request, with SESSION_ENDED", async () => {
    const db = world();
    const laptop = await signIn(db);
    const phone = await signIn(db);
    await expect(guard(db, laptop.accessToken)).resolves.toBeTruthy();

    await service(db).resetPassword("reset-token", NEW);

    expect(db.tables.users.find((r: Row) => r.user_id === U)).toMatchObject({
      session_version: 1,
    });
    await refusedAsEnded(guard(db, laptop.accessToken));
    await refusedAsEnded(guard(db, phone.accessToken));
  });

  it("their refresh tokens mint nothing (web and phone refresh the same way)", async () => {
    const db = world();
    const phone = await signIn(db);

    await service(db).resetPassword("reset-token", NEW);

    await refusedAsEnded(service(db).refreshAccessToken(phone.refreshToken));
  });

  it("a sign-in with the new password works; the old password no longer does", async () => {
    const db = world();
    await service(db).resetPassword("reset-token", NEW);

    const fresh = await signIn(db, "p@house.test", NEW);
    expect(claims(fresh.accessToken).sv).toBe(1);
    await expect(guard(db, fresh.accessToken)).resolves.toMatchObject({
      userId: U,
    });
    await expect(signIn(db)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("another person's sessions are untouched", async () => {
    const db = world();
    const theirs = await signIn(db, "o@house.test");

    await service(db).resetPassword("reset-token", NEW);

    await expect(guard(db, theirs.accessToken)).resolves.toMatchObject({
      userId: OTHER,
    });
  });

  it("a token minted before this shipped (no sv) lives only until the first reset", async () => {
    const db = world();
    const pair = await signIn(db);
    const { sv: _sv, iat: _iat, exp: _exp, ...rest } = claims(pair.accessToken);
    const legacy = jwt.sign(rest, {
      secret: SECRETS.JWT_SECRET,
      expiresIn: "15m",
    });
    await expect(guard(db, legacy)).resolves.toBeTruthy();

    await service(db).resetPassword("reset-token", NEW);

    await refusedAsEnded(guard(db, legacy));
  });

  it("a failed password write ends nothing and changes nothing", async () => {
    const db = world();
    const laptop = await signIn(db);
    db.errors["users:update"] = { message: "connection reset" };

    await expect(
      service(db).resetPassword("reset-token", NEW),
    ).rejects.toBeInstanceOf(BadRequestException);

    const row = db.tables.users.find((r: Row) => r.user_id === U) as Row;
    expect(row.session_version).toBe(0);
    expect(row.password_hash).toBe(HASH);
    await expect(guard(db, laptop.accessToken)).resolves.toBeTruthy();
  });
});

describe("a password change keeps the session that made it and signs out the others", () => {
  async function change(db: StubDb, session: { accessToken: string }) {
    const req = { user: await guard(db, session.accessToken) } as any;
    return new AuthController(service(db)).changePassword(req, {
      currentPassword: OLD,
      newPassword: NEW,
    } as any);
  }

  it("the changing session gets a new pair that works, in the same house; its old tokens and every other session's are refused", async () => {
    const db = world();
    const laptop = await signIn(db);
    const phone = await signIn(db);

    const answer = await change(db, laptop);

    expect(answer).toMatchObject({ success: true });
    expect(claims(answer.accessToken)).toMatchObject({
      sub: U,
      restaurantId: A,
      sv: 1,
    });
    await expect(guard(db, answer.accessToken)).resolves.toMatchObject({
      userId: U,
      restaurantId: A,
    });
    await expect(
      service(db).refreshAccessToken(answer.refreshToken),
    ).resolves.toBeTruthy();

    await refusedAsEnded(guard(db, phone.accessToken));
    await refusedAsEnded(service(db).refreshAccessToken(phone.refreshToken));
    await refusedAsEnded(guard(db, laptop.accessToken));
  });

  it("a wrong current password changes nothing and signs nobody out", async () => {
    const db = world();
    const laptop = await signIn(db);
    const phone = await signIn(db);
    const req = { user: await guard(db, laptop.accessToken) } as any;

    await expect(
      new AuthController(service(db)).changePassword(req, {
        currentPassword: "wrong-password",
        newPassword: NEW,
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await expect(guard(db, phone.accessToken)).resolves.toBeTruthy();
  });

  it("two changes back to back: the second ends the first's kept session", async () => {
    const db = world();
    const laptop = await signIn(db);
    const phone = await signIn(db);

    const kept = await change(db, laptop);
    // The phone was signed out; it signs in again with the new password and
    // changes it back.
    const phoneAgain = await signIn(db, "p@house.test", NEW);
    const req = { user: await guard(db, phoneAgain.accessToken) } as any;
    const keptByPhone = await new AuthController(service(db)).changePassword(
      req,
      { currentPassword: NEW, newPassword: OLD } as any,
    );

    expect(claims(keptByPhone.accessToken).sv).toBe(2);
    await refusedAsEnded(guard(db, kept.accessToken));
    await refusedAsEnded(guard(db, phone.accessToken));
  });

  it("writes the hash and the version in ONE compare-and-set update", async () => {
    const db = world();
    const laptop = await signIn(db);
    await change(db, laptop);

    const updates = db
      .opsOn("users", "update")
      .filter((op: any) => "password_hash" in (op.payload ?? {}));
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({ session_version: 1 });
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: "session_version", value: 0 }),
      ]),
    );
  });

  it("when another change moves the version between the read and the write, it writes on top of it", async () => {
    const db = world();
    const laptop = await signIn(db);
    const req = { user: await guard(db, laptop.accessToken) } as any;
    // A concurrent change lands between this change's read and its write.
    const realFrom = db.supabase.from.bind(db.supabase);
    let moved = false;
    (db.supabase as any).from = (table: string) => {
      const q = realFrom(table);
      if (table !== "users") return q;
      const realUpdate = q.update.bind(q);
      q.update = (payload: any) => {
        if (!moved && "password_hash" in payload) {
          moved = true;
          const row = db.tables.users.find((r: Row) => r.user_id === U) as Row;
          row.session_version += 1;
        }
        return realUpdate(payload);
      };
      return q;
    };

    const answer = await new AuthController(service(db)).changePassword(req, {
      currentPassword: OLD,
      newPassword: NEW,
    } as any);

    expect(claims(answer.accessToken).sv).toBe(2);
    expect(
      (db.tables.users.find((r: Row) => r.user_id === U) as Row)
        .session_version,
    ).toBe(2);
  });
});

describe("the websocket: a signed-out session's sockets close and cannot reopen", () => {
  function fakeSocket(id: string, token: string) {
    return {
      id,
      handshake: { auth: { token }, headers: {}, query: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
      join: jest.fn(),
    };
  }

  function gatewayOver(db: StubDb) {
    const gateway = new WebsocketGateway(jwt, config, asDatabaseService(db));
    const sockets = new Map<string, any>();
    (gateway as any).server = { sockets: { sockets } };
    const connect = async (id: string, token: string) => {
      const s = fakeSocket(id, token);
      sockets.set(id, s);
      await gateway.handleConnection(s as any);
      return s;
    };
    return { gateway, connect };
  }

  it("a change closes the other session's socket and the changing session's old one, and no one else's", async () => {
    const db = world();
    const { gateway, connect } = gatewayOver(db);
    const laptop = await signIn(db);
    const phone = await signIn(db);
    const theirs = await signIn(db, "o@house.test");
    const laptopSocket = await connect("s-laptop", laptop.accessToken);
    const phoneSocket = await connect("s-phone", phone.accessToken);
    const theirSocket = await connect("s-theirs", theirs.accessToken);
    expect(phoneSocket.disconnect).not.toHaveBeenCalled();

    const req = { user: await guard(db, laptop.accessToken) } as any;
    const kept = await new AuthController(service(db, gateway)).changePassword(
      req,
      { currentPassword: OLD, newPassword: NEW } as any,
    );

    expect(phoneSocket.emit).toHaveBeenCalledWith("session:ended", {
      reason: "password_changed",
    });
    expect(phoneSocket.disconnect).toHaveBeenCalledWith(true);
    expect(laptopSocket.disconnect).toHaveBeenCalledWith(true);
    expect(theirSocket.disconnect).not.toHaveBeenCalled();

    // The kept session reconnects with its new pair; the old token cannot.
    const again = await connect("s-laptop-2", kept.accessToken);
    expect(again.disconnect).not.toHaveBeenCalled();
    const stale = await connect("s-phone-2", phone.accessToken);
    expect(stale.disconnect).toHaveBeenCalledWith(true);
  });

  it("a reset closes every socket of that person", async () => {
    const db = world();
    const { gateway, connect } = gatewayOver(db);
    const one = await connect("s1", (await signIn(db)).accessToken);
    const two = await connect("s2", (await signIn(db)).accessToken);

    await service(db, gateway).resetPassword("reset-token", NEW);

    expect(one.disconnect).toHaveBeenCalledWith(true);
    expect(two.disconnect).toHaveBeenCalledWith(true);
  });

  it("refuses the handshake when the version cannot be read", async () => {
    const db = world();
    const { connect } = gatewayOver(db);
    const pair = await signIn(db);
    db.errors["users:select"] = { message: "connection reset" };

    const s = await connect("s1", pair.accessToken);

    expect(s.disconnect).toHaveBeenCalledWith(true);
  });
});

describe("the rule itself (session-version.ts)", () => {
  it("a token is current at or above the person's version, and malformed values read as 0", () => {
    expect(sessionIsCurrent({ sv: 2 }, { session_version: 2 })).toBe(true);
    expect(sessionIsCurrent({ sv: 3 }, { session_version: 2 })).toBe(true);
    expect(sessionIsCurrent({ sv: 1 }, { session_version: 2 })).toBe(false);
    expect(sessionIsCurrent({}, { session_version: 0 })).toBe(true);
    expect(sessionIsCurrent({}, { session_version: 1 })).toBe(false);
    expect(sessionIsCurrent({ sv: "9" as any }, { session_version: 1 })).toBe(
      false,
    );
    expect(sessionIsCurrent({ sv: 1.5 }, { session_version: 1 })).toBe(false);
    expect(sessionIsCurrent({ sv: 0 }, {})).toBe(true);
  });
});
