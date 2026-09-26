import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { SignInCodesService } from "./sign-in-codes.service";
import {
  RP_REFUSAL,
  resolveRelyingParty,
  type RelyingParty,
} from "./relying-party";

/**
 * Passkeys on /profile (ADR 0222, Proposed; ADR 0134 §7).
 *
 * THE FOUNDER, 2026-09-21, round 6r, his pick verbatim: **"Passkey + paste
 * (Recommended)"**. What ADR 0134 recorded that pick to mean, and where each
 * part is enforced here:
 *
 *   1. **WebAuthn, per user.** One row per credential in `user_passkeys`, keyed
 *      on `public.users.user_id` from the signed token -- never a house, never
 *      a device, never an id from the body.
 *   2. **Owner and manager only.** Enrolling and checking resolve the caller's
 *      role IN THIS HOUSE (`OrganizationsService.resolveRestaurantRole`) and
 *      refuse anything else. Listing and revoking your own passkeys are not
 *      gated: someone who stopped being a manager must still be able to see and
 *      remove what they enrolled.
 *   3. **Enrolment and revocation on /profile, audited.** Every enrolment,
 *      revocation and check files a `system_audit_log` row
 *      (`passkey_enrolled` / `passkey_revoked` / `passkey_checked`), and the
 *      person gets an in-app notice when one is added or removed. The receipt
 *      comes back as `audited` / `notified`, so a failed record is visible.
 *   4. **A peer path, not built as one yet.** The manager passcode it sits
 *      beside (ADR 0112 F11) does not exist, so nothing in the product accepts
 *      a passkey as approval today. `check` proves an enrolled passkey still
 *      answers -- the same verification a point of action will call -- and
 *      grants nothing.
 *
 * HOW (ADR 0222, Proposed -- the founder answered WHAT, not HOW):
 *   * `@simplewebauthn/server` verifies; nothing here parses CBOR or checks a
 *     signature by hand.
 *   * Attestation `none`, user verification `required`, resident key
 *     `preferred`, ES256 and RS256.
 *   * The challenge lives in `webauthn_challenges`, is deleted as it is read
 *     (single use), expires after five minutes, and is bound to the exact
 *     origin and RP ID the ceremony started on.
 *   * **Proving it is you before a passkey is added** (the founder, 2026-09-25,
 *     item 29, which closed ADR 0222 fork 1): "signed in within last 10 min =
 *     direct, else email code first." The token's `auth_time` (stamped at an
 *     interactive sign-in, carried unchanged by refresh and house switch) is
 *     read; older than ten minutes, or absent, and the ceremony starts only
 *     with an emailed code (`SignInCodesService`, purpose `step_up`). It
 *     replaced "type your current password", so a Google-only account can add
 *     one too. A stolen fifteen-minute token alone still cannot plant a
 *     lasting credential unless it is itself a sign-in from the last ten
 *     minutes.
 *   * **A passkey signs you in** (same answer): `startSignIn` / `finishSignIn`
 *     run a discoverable-credential ceremony with no one named in advance; the
 *     passkey's user handle names the account, and the gateway mints the
 *     session through `AuthService`, the one place every session is minted.
 */

export const PASSKEY_AUDIT_ACTIONS = {
  enrolled: "passkey_enrolled",
  revoked: "passkey_revoked",
  checked: "passkey_checked",
  signedIn: "passkey_signed_in",
} as const;

/** How recent a sign-in must be to add a passkey without an emailed code. */
export const FRESH_SIGN_IN_SECONDS = 10 * 60;

/** The refusal that tells the web to ask for an emailed code. 403, never 401. */
export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

/**
 * Whether a token's `auth_time` is recent enough. Absent (a token minted before
 * this field existed, or by a path that is not an interactive sign-in) is NOT
 * fresh: the missing value fails closed. A time in the future beyond a minute of
 * clock slack is refused too -- it is not a time this gateway stamped.
 */
export function isFreshSignIn(
  authTime: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (typeof authTime !== "number" || !Number.isFinite(authTime)) return false;
  const nowSec = Math.floor(nowMs / 1000);
  if (authTime > nowSec + 60) return false;
  return nowSec - authTime <= FRESH_SIGN_IN_SECONDS;
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = "Mudavym";

/** One sentence for every refused passkey sign-in. */
export const SIGN_IN_REFUSAL =
  "That passkey did not sign you in. Try again, or sign in with your email instead.";
export const RP_SIGN_IN_REFUSAL =
  "Passkeys sign in only on mudavym.com. Use your email or password on this address.";
const MAX_NICKNAME = 60;

export interface PasskeyView {
  id: string;
  nickname: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  rpId: string;
  revokedAt: string | null;
}

export interface PasskeyReadout {
  /** False when the credentials could not be READ: never "you have none". */
  readable: boolean;
  reason: string | null;
  passkeys: PasskeyView[];
  /** Whether this caller may enrol or check one in this house. */
  eligible: boolean;
  /** Why not, in words. Null exactly when `eligible`. */
  eligibilityReason: string | null;
}

export interface PasskeyReceipt {
  passkey: PasskeyView;
  audited: boolean;
  auditReason: string | null;
  notified: boolean;
}

interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number | string;
  transports: string[] | null;
  device_type: "singleDevice" | "multiDevice";
  backed_up: boolean;
  aaguid: string | null;
  rp_id: string;
  nickname: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface ChallengeRow {
  challenge: string;
  rp_id: string;
  origin: string;
  expires_at: string;
}

const ROW_COLUMNS =
  "id, user_id, credential_id, public_key, sign_count, transports, device_type, backed_up, aaguid, rp_id, nickname, created_at, last_used_at, revoked_at";

export function toView(row: PasskeyRow): PasskeyView {
  return {
    id: row.id,
    nickname: row.nickname,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceType: row.device_type,
    backedUp: row.backed_up,
    transports: row.transports ?? [],
    rpId: row.rp_id,
    revokedAt: row.revoked_at,
  };
}

function cleanNickname(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new BadRequestException(
      "A passkey's name must be text. Nothing was saved.",
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_NICKNAME) {
    throw new BadRequestException(
      `A passkey's name can be at most ${MAX_NICKNAME} characters. Nothing was saved.`,
    );
  }
  return trimmed;
}

@Injectable()
export class PasskeysService {
  private readonly logger = new Logger(PasskeysService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly organizations: OrganizationsService,
    private readonly codes: SignInCodesService,
  ) {}

  private get db() {
    return this.databaseService.client;
  }

  /* ── reading ─────────────────────────────────────────────────────────── */

  async list(
    userId: string,
    restaurantId: string | null,
  ): Promise<PasskeyReadout> {
    const eligibility = await this.eligibility(userId, restaurantId);
    const { data, error } = await this.db
      .from("user_passkeys")
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      this.logger.error(
        `Could not read passkeys for ${userId}: ${error.message}`,
      );
      return {
        readable: false,
        reason: error.message,
        passkeys: [],
        ...eligibility,
      };
    }
    return {
      readable: true,
      reason: null,
      passkeys: ((data as PasskeyRow[] | null) ?? []).map(toView),
      ...eligibility,
    };
  }

  /* ── enrolment ───────────────────────────────────────────────────────── */

  async startRegistration(
    userId: string,
    restaurantId: string | null,
    origin: string | undefined,
    authTime: number | null,
    emailCode: unknown,
  ): Promise<{
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }> {
    await this.assertEligible(userId, restaurantId);
    const rp = this.relyingParty(origin);
    const user = await this.readUser(userId);
    await this.assertProvedItIsYou(userId, authTime, emailCode);

    const live = await this.liveCredentials(userId, rp.rpId);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rp.rpId,
      userName: user.email ?? userId,
      userDisplayName: user.name ?? user.email ?? "",
      // The WebAuthn user handle is the opaque public.users id, never an email.
      userID: new TextEncoder().encode(userId),
      attestationType: "none",
      excludeCredentials: live.map((c) => ({
        id: c.credential_id,
        transports: c.transports ?? undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      supportedAlgorithmIDs: [-7, -257],
      timeout: CHALLENGE_TTL_MS,
    });
    const challengeId = await this.storeChallenge(
      userId,
      "registration",
      options.challenge,
      rp,
    );
    return { challengeId, options };
  }

  async finishRegistration(
    userId: string,
    restaurantId: string | null,
    origin: string | undefined,
    challengeId: unknown,
    response: unknown,
    nicknameRaw: unknown,
  ): Promise<PasskeyReceipt> {
    await this.assertEligible(userId, restaurantId);
    const nickname = cleanNickname(nicknameRaw);
    const challenge = await this.consumeChallenge(
      userId,
      "registration",
      challengeId,
      origin,
    );

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch (e) {
      throw new BadRequestException(
        `The passkey could not be verified, so it was not added: ${(e as Error).message}`,
      );
    }
    if (!verification.verified) {
      throw new BadRequestException(
        "The passkey could not be verified, so it was not added.",
      );
    }
    const info = verification.registrationInfo;

    const { data, error } = await this.db
      .from("user_passkeys")
      .insert({
        user_id: userId,
        credential_id: info.credential.id,
        public_key: Buffer.from(info.credential.publicKey).toString(
          "base64url",
        ),
        sign_count: info.credential.counter,
        transports: info.credential.transports ?? [],
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
        aaguid: info.aaguid,
        rp_id: challenge.rp_id,
        nickname,
      })
      .select(ROW_COLUMNS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException(
          "That passkey is already on an account. Nothing was added.",
        );
      }
      this.logger.error(
        `Could not store a passkey for ${userId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "The passkey was verified but could not be saved. Nothing was added.",
      );
    }
    const view = toView(data as PasskeyRow);
    const receipt = await this.record(
      restaurantId,
      userId,
      PASSKEY_AUDIT_ACTIONS.enrolled,
      view,
      {
        title: "A passkey was added to your account",
        message: `${view.nickname ?? "A passkey"} was added on ${challenge.origin}. If this was not you, remove it on your profile and change your password.`,
      },
    );
    return { passkey: view, ...receipt };
  }

  /* ── revocation ──────────────────────────────────────────────────────── */

  async revoke(
    userId: string,
    restaurantId: string | null,
    passkeyId: string,
  ): Promise<PasskeyReceipt> {
    const { data: found, error: readError } = await this.db
      .from("user_passkeys")
      .select(ROW_COLUMNS)
      .eq("id", passkeyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) {
      throw new InternalServerErrorException(
        "Your passkeys could not be read, so nothing was removed.",
      );
    }
    // Another person's passkey answers exactly like a missing one.
    if (!found)
      throw new NotFoundException(
        "No passkey of yours has that id. Nothing was removed.",
      );
    const row = found as PasskeyRow;
    if (row.revoked_at) {
      return {
        passkey: toView(row),
        audited: true,
        auditReason: null,
        notified: false,
      };
    }
    const { data, error } = await this.db
      .from("user_passkeys")
      .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
      .eq("id", passkeyId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .select(ROW_COLUMNS)
      .single();
    if (error) {
      this.logger.error(
        `Could not revoke passkey ${passkeyId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "The passkey could not be removed. It still works.",
      );
    }
    const view = toView(data as PasskeyRow);
    const receipt = await this.record(
      restaurantId,
      userId,
      PASSKEY_AUDIT_ACTIONS.revoked,
      view,
      {
        title: "A passkey was removed from your account",
        message: `${view.nickname ?? "A passkey"} was removed and can no longer be used.`,
      },
    );
    return { passkey: view, ...receipt };
  }

  /* ── checking one still answers ──────────────────────────────────────── */

  async startCheck(
    userId: string,
    restaurantId: string | null,
    origin: string | undefined,
  ): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    await this.assertEligible(userId, restaurantId);
    const rp = this.relyingParty(origin);
    const live = await this.liveCredentials(userId, rp.rpId);
    if (live.length === 0) {
      throw new BadRequestException(
        "You have no passkey on this address to check.",
      );
    }
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      allowCredentials: live.map((c) => ({
        id: c.credential_id,
        transports: c.transports ?? undefined,
      })),
      userVerification: "required",
      timeout: CHALLENGE_TTL_MS,
    });
    const challengeId = await this.storeChallenge(
      userId,
      "authentication",
      options.challenge,
      rp,
    );
    return { challengeId, options };
  }

  /**
   * Verify an assertion against one of the caller's live passkeys. This is the
   * verification a point of action will call once ADR 0112 F11 exists; today it
   * only proves the passkey still answers, and grants nothing.
   */
  async finishCheck(
    userId: string,
    restaurantId: string | null,
    origin: string | undefined,
    challengeId: unknown,
    response: unknown,
  ): Promise<PasskeyReceipt> {
    await this.assertEligible(userId, restaurantId);
    const challenge = await this.consumeChallenge(
      userId,
      "authentication",
      challengeId,
      origin,
    );
    const assertion = response as AuthenticationResponseJSON;
    if (!assertion || typeof assertion.id !== "string") {
      throw new BadRequestException(
        "The passkey's answer was missing. Nothing was checked.",
      );
    }
    const { data: found, error: readError } = await this.db
      .from("user_passkeys")
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .eq("credential_id", assertion.id)
      .eq("rp_id", challenge.rp_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (readError) {
      throw new InternalServerErrorException(
        "Your passkeys could not be read, so nothing was checked.",
      );
    }
    if (!found) {
      throw new BadRequestException(
        "That passkey is not one of yours, or it was removed.",
      );
    }
    const row = found as PasskeyRow;

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        credential: {
          id: row.credential_id,
          publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")),
          counter: Number(row.sign_count),
          transports: (row.transports ?? undefined) as never,
        },
        requireUserVerification: true,
      });
    } catch (e) {
      throw new BadRequestException(
        `The passkey did not verify: ${(e as Error).message}`,
      );
    }
    if (!verification.verified) {
      throw new BadRequestException("The passkey did not verify.");
    }
    const { data, error } = await this.db
      .from("user_passkeys")
      .update({
        sign_count: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
        backed_up: verification.authenticationInfo.credentialBackedUp,
      })
      .eq("id", row.id)
      .select(ROW_COLUMNS)
      .single();
    if (error) {
      this.logger.error(
        `Passkey ${row.id} verified but its counter was not saved: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "The passkey verified, but its use could not be saved.",
      );
    }
    const view = toView(data as PasskeyRow);
    const receipt = await this.record(
      restaurantId,
      userId,
      PASSKEY_AUDIT_ACTIONS.checked,
      view,
      null,
    );
    return { passkey: view, ...receipt };
  }

  /* ── signing in with a passkey ─────────────────────────────────────────── */

  /**
   * Signed out: start a ceremony that names nobody. `allowCredentials` is
   * empty, so the browser offers whatever passkey this device holds for
   * mudavym.com (a discoverable credential), and the passkey's user handle
   * says whose it is. User verification is required: Face ID, Touch ID or the
   * device PIN, never a bare tap.
   */
  async startSignIn(origin: string | undefined): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const rp = this.relyingParty(origin, RP_SIGN_IN_REFUSAL);
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      userVerification: "required",
      timeout: CHALLENGE_TTL_MS,
    });
    const challengeId = await this.storeChallenge(
      null,
      "sign_in",
      options.challenge,
      rp,
    );
    return { challengeId, options };
  }

  /**
   * Verify a sign-in assertion and say whose account it opens. Mints nothing:
   * the controller hands the id to `AuthService`, the one place a session is
   * minted, so membership (ADR 0164) and session-version (ADR 0225) rules
   * apply to a passkey exactly as to a password.
   *
   * Every refusal is the same 400 sentence whether the credential is unknown,
   * removed, or signed wrongly: a stranger learns nothing about which
   * credentials exist.
   */
  async finishSignIn(
    origin: string | undefined,
    challengeId: unknown,
    response: unknown,
  ): Promise<{ userId: string; passkey: PasskeyView; audited: boolean }> {
    const challenge = await this.consumeChallenge(
      null,
      "sign_in",
      challengeId,
      origin,
    );
    const assertion = response as AuthenticationResponseJSON;
    if (
      !assertion ||
      typeof assertion.id !== "string" ||
      typeof assertion.response !== "object" ||
      assertion.response === null
    ) {
      throw new BadRequestException(SIGN_IN_REFUSAL);
    }
    const { data: found, error: readError } = await this.db
      .from("user_passkeys")
      .select(ROW_COLUMNS)
      .eq("credential_id", assertion.id)
      .eq("rp_id", challenge.rp_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (readError) {
      throw new InternalServerErrorException(
        "Passkeys could not be read just now, so nobody was signed in. Try again.",
      );
    }
    if (!found) throw new BadRequestException(SIGN_IN_REFUSAL);
    const row = found as PasskeyRow;

    // A discoverable credential returns the user handle it was made with --
    // the opaque public.users id. It must name the account the credential row
    // belongs to; a mismatch is a credential answering for someone else.
    const expectedHandle = Buffer.from(
      new TextEncoder().encode(row.user_id),
    ).toString("base64url");
    if (assertion.response.userHandle !== expectedHandle) {
      throw new BadRequestException(SIGN_IN_REFUSAL);
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rp_id,
        credential: {
          id: row.credential_id,
          publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")),
          counter: Number(row.sign_count),
          transports: (row.transports ?? undefined) as never,
        },
        requireUserVerification: true,
      });
    } catch (e) {
      this.logger.warn(
        `Passkey sign-in refused for credential ${row.id}: ${(e as Error).message}`,
      );
      throw new BadRequestException(SIGN_IN_REFUSAL);
    }
    if (
      !verification.verified ||
      !verification.authenticationInfo.userVerified
    ) {
      throw new BadRequestException(SIGN_IN_REFUSAL);
    }
    const { data, error } = await this.db
      .from("user_passkeys")
      .update({
        sign_count: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
        backed_up: verification.authenticationInfo.credentialBackedUp,
      })
      .eq("id", row.id)
      .is("revoked_at", null)
      .select(ROW_COLUMNS)
      .maybeSingle();
    if (error || !data) {
      // Either the counter could not be saved (a replayed counter would then
      // go unnoticed) or the passkey was removed a moment ago. Neither signs in.
      throw new BadRequestException(SIGN_IN_REFUSAL);
    }
    const view = toView(data as PasskeyRow);
    const { audited } = await this.record(
      null,
      row.user_id,
      PASSKEY_AUDIT_ACTIONS.signedIn,
      view,
      null,
    );
    return { userId: row.user_id, passkey: view, audited };
  }

  /** Signed in, before adding a passkey: email the account's own address a code. */
  async sendStepUpCode(
    userId: string,
    restaurantId: string | null,
    source: string | null,
  ) {
    await this.assertEligible(userId, restaurantId);
    return this.codes.issueForStepUp(userId, source);
  }

  /* ── the rules ───────────────────────────────────────────────────────── */

  private async eligibility(
    userId: string,
    restaurantId: string | null,
  ): Promise<{ eligible: boolean; eligibilityReason: string | null }> {
    if (!restaurantId) {
      return {
        eligible: false,
        eligibilityReason:
          "This session is not attached to a house, so a passkey cannot be added.",
      };
    }
    let role: string | null = null;
    try {
      role = await this.organizations.resolveRestaurantRole(
        userId,
        restaurantId,
      );
    } catch {
      role = null;
    }
    if (role === "owner" || role === "manager")
      return { eligible: true, eligibilityReason: null };
    if (role === null) {
      return {
        eligible: false,
        eligibilityReason:
          "Your role in this house could not be read, so a passkey cannot be added right now.",
      };
    }
    return {
      eligible: false,
      eligibilityReason: "Passkeys are for the house's owners and managers.",
    };
  }

  private async assertEligible(
    userId: string,
    restaurantId: string | null,
  ): Promise<void> {
    const e = await this.eligibility(userId, restaurantId);
    if (!e.eligible)
      throw new ForbiddenException(
        `${e.eligibilityReason} Nothing was changed.`,
      );
  }

  private relyingParty(
    origin: string | undefined,
    refusal: string = RP_REFUSAL,
  ): RelyingParty {
    const rp = resolveRelyingParty(origin);
    if (!rp) throw new BadRequestException(refusal);
    return rp;
  }

  private async readUser(
    userId: string,
  ): Promise<{ email: string | null; name: string | null }> {
    const { data, error } = await this.db
      .from("users")
      .select("email, name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) {
      throw new InternalServerErrorException(
        "Your account could not be read, so nothing was started.",
      );
    }
    return data as { email: string | null; name: string | null };
  }

  /**
   * The founder's rule (2026-09-25, item 29): a sign-in in the last ten
   * minutes proceeds; otherwise an emailed code, typed now. Refusals are 403,
   * never 401 -- a 401 makes the web client refresh the session and retry,
   * which would turn a missing proof into a silent second attempt. A code is
   * checked only when the sign-in is stale, so a fresh session never burns one.
   */
  private async assertProvedItIsYou(
    userId: string,
    authTime: number | null,
    emailCode: unknown,
  ): Promise<void> {
    if (isFreshSignIn(authTime)) return;
    if (emailCode === undefined || emailCode === null || emailCode === "") {
      throw new ForbiddenException({
        code: STEP_UP_REQUIRED,
        message:
          "You signed in more than ten minutes ago. We will email you a code to confirm it is you, then the passkey can be added. Nothing was started.",
      });
    }
    await this.codes.verifyStepUp(userId, emailCode);
  }

  private async liveCredentials(
    userId: string,
    rpId: string,
  ): Promise<PasskeyRow[]> {
    const { data, error } = await this.db
      .from("user_passkeys")
      .select(ROW_COLUMNS)
      .eq("user_id", userId)
      .eq("rp_id", rpId)
      .is("revoked_at", null);
    if (error) {
      throw new InternalServerErrorException(
        "Your passkeys could not be read, so nothing was started.",
      );
    }
    return (data as PasskeyRow[] | null) ?? [];
  }

  private async storeChallenge(
    userId: string | null,
    purpose: "registration" | "authentication" | "sign_in",
    challenge: string,
    rp: RelyingParty,
  ): Promise<string> {
    const now = new Date();
    // Housekeeping, best effort: expired rows anywhere, and this person's own
    // earlier ceremony of the same kind -- one ceremony in flight at a time.
    await this.db
      .from("webauthn_challenges")
      .delete()
      .lt("expires_at", now.toISOString());
    if (userId !== null) {
      await this.db
        .from("webauthn_challenges")
        .delete()
        .eq("user_id", userId)
        .eq("purpose", purpose);
    }
    const { data, error } = await this.db
      .from("webauthn_challenges")
      .insert({
        user_id: userId,
        purpose,
        challenge,
        rp_id: rp.rpId,
        origin: rp.origin,
        expires_at: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) {
      this.logger.error(
        `Could not store a ${purpose} challenge: ${error?.message}`,
      );
      throw new InternalServerErrorException(
        "The passkey ceremony could not be started. Nothing was changed.",
      );
    }
    return (data as { id: string }).id;
  }

  /** Read and delete in one statement: a challenge answers once. */
  private async consumeChallenge(
    userId: string | null,
    purpose: "registration" | "authentication" | "sign_in",
    challengeId: unknown,
    origin: string | undefined,
  ): Promise<ChallengeRow> {
    if (typeof challengeId !== "string" || challengeId.length === 0) {
      throw new BadRequestException(
        "The ceremony's id was missing. Start again.",
      );
    }
    const owner = this.db
      .from("webauthn_challenges")
      .delete()
      .eq("id", challengeId)
      .eq("purpose", purpose);
    const { data, error } = await (
      userId === null ? owner.is("user_id", null) : owner.eq("user_id", userId)
    )
      .select("challenge, rp_id, origin, expires_at")
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        "The ceremony could not be read. Start again.",
      );
    }
    const row = data as ChallengeRow | null;
    if (!row)
      throw new BadRequestException(
        "That ceremony is unknown or was already used. Start again.",
      );
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new BadRequestException(
        "That ceremony took longer than five minutes and expired. Start again.",
      );
    }
    const rp = resolveRelyingParty(origin);
    if (!rp || rp.origin !== row.origin) {
      throw new BadRequestException(
        "That ceremony was started on another address. Start again here.",
      );
    }
    return row;
  }

  /**
   * One `system_audit_log` row, and an in-app notice for enrolments and
   * removals. Never throws: the credential change has already happened, so a
   * failed record is reported back, not raised.
   */
  private async record(
    restaurantId: string | null,
    userId: string,
    action: (typeof PASSKEY_AUDIT_ACTIONS)[keyof typeof PASSKEY_AUDIT_ACTIONS],
    passkey: PasskeyView,
    notice: { title: string; message: string } | null,
  ): Promise<{
    audited: boolean;
    auditReason: string | null;
    notified: boolean;
  }> {
    let audited = false;
    let auditReason: string | null = null;
    try {
      const { error } = await this.db.from("system_audit_log").insert({
        actor_type: "user",
        actor_id: userId,
        action,
        entity_type: "user_passkey",
        entity_id: passkey.id,
        changes: {
          nickname: passkey.nickname,
          device_type: passkey.deviceType,
          backed_up: passkey.backedUp,
          rp_id: passkey.rpId,
          ...(action === PASSKEY_AUDIT_ACTIONS.revoked
            ? { revoked_at: passkey.revokedAt }
            : {}),
        },
        restaurant_id: restaurantId,
        reason: null,
      });
      if (error) {
        auditReason = error.message;
        this.logger.error(
          `${action} happened but the audit row failed to write: ${error.message}`,
        );
      } else {
        audited = true;
      }
    } catch (e) {
      auditReason = (e as Error).message;
      this.logger.error(
        `${action} happened but the audit row threw: ${auditReason}`,
      );
    }

    let notified = false;
    if (notice) {
      try {
        const { error } = await this.db.from("notifications").insert({
          user_id: userId,
          // Legacy NOT-NULL columns still on the live notifications table.
          recipient_id: userId,
          notification_type: "system",
          channels: ["in_app"],
          restaurant_id: restaurantId,
          type: "system",
          title: notice.title,
          message: notice.message,
          priority: "high",
          status: "unread",
          action_url: "/profile#pf-security",
          action_label: "Open your passkeys",
          metadata: { action, passkey_id: passkey.id },
          created_at: new Date().toISOString(),
        });
        if (error) {
          this.logger.error(
            `${action}: the person was not told -- ${error.message}`,
          );
        } else {
          notified = true;
        }
      } catch (e) {
        this.logger.error(
          `${action}: the notice threw -- ${(e as Error).message}`,
        );
      }
    }
    return { audited, auditReason, notified };
  }
}
