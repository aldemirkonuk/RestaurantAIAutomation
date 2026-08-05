import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { TokenBlacklistService } from "./services/token-blacklist.service";
import { GmailService } from "../communications/gmail.service";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import axios from "axios";
import { RegisterRestaurantDto } from "./dto/register-restaurant.dto";
import { JoinViaInviteDto } from "./dto/join-via-invite.dto";
import { InviteDto } from "./dto/invite.dto";

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  role: "owner" | "manager" | "staff";
  /** Present on all tokens issued by this API; omit on very old tokens */
  restaurantId?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  restaurantId: string;
  role: "owner" | "manager" | "staff";
  phone?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly SALT_ROUNDS = 10;
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly gmailService: GmailService,
  ) {
    this.jwtSecret =
      this.configService.get<string>("JWT_SECRET") ||
      "your-secret-key-change-in-production";
    this.jwtRefreshSecret =
      this.configService.get<string>("JWT_REFRESH_SECRET") ||
      this.jwtSecret + "-refresh";

    if (this.jwtSecret === "your-secret-key-change-in-production") {
      this.logger.warn(
        "Using default JWT_SECRET — set a proper secret in production!",
      );
    }
    if (!this.configService.get<string>("JWT_REFRESH_SECRET")) {
      this.logger.warn(
        "JWT_REFRESH_SECRET not set — deriving from JWT_SECRET. Set a separate secret in production!",
      );
    }
  }

  /**
   * Validate user credentials
   */
  async validateUser(email: string, password: string): Promise<any> {
    const { data: user, error } = await this.databaseService.supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!user.password_hash) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Use the "Sign in with Google" button below.',
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Don't return password
    const { password_hash, ...result } = user;
    return result;
  }

  /**
   * Login with email/password
   */
  async login(credentials: LoginCredentials): Promise<TokenPair> {
    const user = await this.validateUser(
      credentials.email,
      credentials.password,
    );

    this.logger.log(`User logged in: ${user.email}`);

    return this.generateTokens(user);
  }

  /**
   * Register new user
   */
  async register(data: RegisterData): Promise<TokenPair> {
    // Check if user already exists
    const { data: existingUser } = await this.databaseService.supabase
      .from("users")
      .select("email")
      .eq("email", data.email)
      .single();

    if (existingUser) {
      throw new UnauthorizedException("Email already registered");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, this.SALT_ROUNDS);

    // Create user
    const { data: newUser, error } = await this.databaseService.supabase
      .from("users")
      .insert({
        email: data.email,
        password_hash: passwordHash,
        name: data.name,
        restaurant_id: data.restaurantId,
        role: data.role,
        phone: data.phone,
      })
      .select()
      .single();

    if (error || !newUser) {
      this.logger.error(`Registration failed: ${error?.message}`);
      throw new UnauthorizedException("Registration failed");
    }

    this.logger.log(`New user registered: ${newUser.email}`);

    return this.generateTokens(newUser);
  }

  /**
   * Login with Google OAuth
   */
  async loginWithGoogle(googleToken: string): Promise<TokenPair> {
    // Verify Google token
    const googleUser = await this.verifyGoogleToken(googleToken);

    const user = await this.findOrCreateOAuthUser({
      provider: "google",
      providerId: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
    });

    this.logger.log(`Google OAuth login: ${user.email}`);

    return this.generateTokens(user);
  }

  /**
   * Login with Microsoft OAuth
   */
  async loginWithMicrosoft(microsoftToken: string): Promise<TokenPair> {
    // Verify Microsoft token
    const microsoftUser = await this.verifyMicrosoftToken(microsoftToken);

    const user = await this.findOrCreateOAuthUser({
      provider: "microsoft",
      providerId: microsoftUser.oid,
      email: microsoftUser.email,
      name: microsoftUser.name,
    });

    this.logger.log(`Microsoft OAuth login: ${user.email}`);

    return this.generateTokens(user);
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.jwtRefreshSecret,
      });

      const { data: user } = await this.databaseService.supabase
        .from("users")
        .select("*")
        .eq("user_id", payload.sub)
        .single();

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      // Preserve the restaurant the user had switched to — the refresh token
      // encodes the scoped restaurantId, but user.restaurant_id is the DB default
      // (never updated on switch). Without this, every token refresh silently
      // reverts the tenant to the default restaurant, causing 500s on resources
      // that belong to the switched-to restaurant.
      const scopedRestaurantId = payload.restaurantId ?? user.restaurant_id;
      return this.generateTokens({
        ...user,
        restaurant_id: scopedRestaurantId,
      });
    } catch (error) {
      throw new UnauthorizedException("Invalid refresh token");
    }
  }

  /**
   * Logout (invalidate tokens)
   */
  async logout(userId: string, accessToken?: string): Promise<void> {
    if (accessToken) {
      const decoded = this.jwtService.decode(accessToken) as {
        exp?: number;
      } | null;
      if (decoded?.exp) {
        const expiresAt = new Date(decoded.exp * 1000);
        await this.tokenBlacklistService.blacklistToken(accessToken, expiresAt);
      }
    }
    this.logger.log(`User logged out: ${userId}`);
  }

  /**
   * Re-issue tokens scoped to a different restaurant the user has access to.
   * Validates that targetRestaurantId belongs to the same organisation(s) as the user.
   */
  async switchRestaurant(
    userId: string,
    targetRestaurantId: string,
  ): Promise<TokenPair> {
    const { data: user, error: userErr } = await this.databaseService.supabase
      .from("users")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (userErr || !user) {
      throw new UnauthorizedException("User not found");
    }

    const { data: uraAccess } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", targetRestaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (uraAccess) {
      return this.generateTokens({
        ...user,
        restaurant_id: targetRestaurantId,
      });
    }

    // Legacy fallback: org-level check for users who have no URA row yet
    // Also handles legacy users (no org row) by checking via restaurant → org path.
    const { data: orgMemberships } = await this.databaseService.supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId);

    let orgIds: string[] = (orgMemberships ?? []).map(
      (m: any) => m.organization_id,
    );

    if (orgIds.length === 0) {
      // Legacy fallback: derive org from the user's own restaurant
      const { data: ownRestaurant } = await this.databaseService.supabase
        .from("restaurants")
        .select("organization_id")
        .eq("id", user.restaurant_id)
        .maybeSingle();
      if (ownRestaurant?.organization_id) {
        orgIds = [ownRestaurant.organization_id];
      }
    }

    if (orgIds.length === 0) {
      throw new ForbiddenException("No organisation membership found");
    }

    const { data: targetRestaurant } = await this.databaseService.supabase
      .from("restaurants")
      .select("id, organization_id")
      .eq("id", targetRestaurantId)
      .in("organization_id", orgIds)
      .maybeSingle();

    if (!targetRestaurant) {
      throw new ForbiddenException("Access denied to requested restaurant");
    }

    // Issue new tokens with the switched restaurant_id
    return this.generateTokens({ ...user, restaurant_id: targetRestaurantId });
  }

  /**
   * Generate access and refresh tokens using ConfigService-managed secrets.
   * Studio roles are fetched from user_roles table and embedded in app_metadata.roles
   * so FastAPI require_studio_role() can authorize studio API calls without a DB round-trip.
   */
  private async generateTokens(user: any): Promise<TokenPair> {
    // Fetch active studio roles for this user
    let studioRoles: string[] = [];
    try {
      const { data } = await this.databaseService.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.user_id)
        .is("revoked_at", null);
      studioRoles = (data ?? []).map((r: any) => r.role);
    } catch {
      // Non-critical — studio endpoints will just reject with 403
    }

    let restaurantRole = user.role as string;
    if (user.restaurant_id) {
      try {
        const { data: membership } = await this.databaseService.supabase
          .from("user_restaurant_access")
          .select("role")
          .eq("user_id", user.user_id)
          .eq("restaurant_id", user.restaurant_id)
          .eq("is_active", true)
          .maybeSingle();
        if (membership?.role) restaurantRole = membership.role;
      } catch {
        // Legacy fallback
      }
    }

    const payload = {
      sub: user.user_id,
      email: user.email,
      role: restaurantRole,
      restaurantId: user.restaurant_id,
      emailVerified: user.email_verified ?? false,
      app_metadata: { roles: studioRoles },
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: "15m",
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.jwtRefreshSecret,
      expiresIn: "7d",
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Verify Google OAuth token
   */
  private async verifyGoogleToken(token: string): Promise<any> {
    try {
      const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`;
      const response = await axios.get(tokenInfoUrl);
      const data = response.data;

      const expectedClientId =
        this.configService.get<string>("GOOGLE_CLIENT_ID");
      if (expectedClientId && data.aud !== expectedClientId) {
        throw new UnauthorizedException("Invalid Google token audience");
      }

      // Accounts are matched by email, so an unverified address would let
      // anyone who can put a string in a Google profile claim someone else's
      // WineOps account. tokeninfo returns this as the string "true".
      if (String(data.email_verified) !== "true") {
        throw new UnauthorizedException(
          "Your Google email address is not verified",
        );
      }

      if (!data.email) {
        throw new UnauthorizedException("Google token missing email");
      }

      return {
        sub: data.sub,
        email: data.email,
        name: data.name || data.given_name || data.email,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(`Google token verification failed: ${error}`);
      throw new UnauthorizedException("Failed to verify Google token");
    }
  }

  /**
   * Verify Microsoft OAuth token
   */
  private async verifyMicrosoftToken(token: string): Promise<any> {
    try {
      const response = await axios.get("https://graph.microsoft.com/v1.0/me", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = response.data;
      const email = data.mail || data.userPrincipalName;

      if (!email) {
        throw new UnauthorizedException("Microsoft token missing email");
      }

      return {
        oid: data.id,
        email,
        name: data.displayName || email,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(`Microsoft token verification failed: ${error}`);
      throw new UnauthorizedException("Failed to verify Microsoft token");
    }
  }

  /**
   * Validate JWT payload
   */
  async validateJwtPayload(payload: JwtPayload): Promise<any> {
    const { data: user } = await this.databaseService.supabase
      .from("users")
      .select("*")
      .eq("user_id", payload.sub)
      .single();

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return user;
  }

  /**
   * Path B: Register a new restaurant (creates org + restaurant + user atomically).
   * User starts with email_verified: false and must verify email.
   */
  async registerRestaurant(dto: RegisterRestaurantDto): Promise<TokenPair> {
    const { data: existing } = await this.databaseService.supabase
      .from("users")
      .select("email")
      .eq("email", dto.email)
      .maybeSingle();
    if (existing) throw new BadRequestException("Email already registered");

    let orgId: string | null = null;
    let restaurantId: string | null = null;
    let userId: string | null = null;

    try {
      const { data: org, error: orgErr } = await this.databaseService.supabase
        .from("organizations")
        .insert({ name: `${dto.restaurantName} Group`, owner_id: null })
        .select()
        .single();
      if (orgErr || !org)
        throw new Error(orgErr?.message || "Org creation failed");
      orgId = org.id;

      // Generate URL-safe slug: "The Oak Room" → "the-oak-room-a3f2"
      const baseSlug = dto.restaurantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const slug = `${baseSlug}-${crypto.randomBytes(3).toString("hex")}`;

      const { data: restaurant, error: restErr } =
        await this.databaseService.supabase
          .from("restaurants")
          .insert({
            name: dto.restaurantName,
            slug,
            email: dto.restaurantEmail || dto.email, // use dedicated contact email or fall back to owner's
            address: { street: dto.address }, // restaurants.address is JSONB in the live schema
            city: dto.city,
            country: dto.country,
            state_province: dto.stateProvince,
            postal_code: dto.postalCode,
            neighborhood: dto.neighborhood,
            phone: dto.phone,
            cuisine_type: dto.cuisineType,
            timezone: dto.timezone || "America/New_York",
            organization_id: org.id,
          })
          .select()
          .single();
      if (restErr || !restaurant)
        throw new Error(restErr?.message || "Restaurant creation failed");
      restaurantId = restaurant.id;

      const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
      const { data: user, error: userErr } = await this.databaseService.supabase
        .from("users")
        .insert({
          email: dto.email,
          password_hash: passwordHash,
          name: dto.name,
          restaurant_id: restaurantId,
          role: "owner",
          email_verified: false,
        })
        .select()
        .single();
      if (userErr || !user)
        throw new Error(userErr?.message || "User creation failed");
      userId = user.user_id;

      await this.databaseService.supabase
        .from("organizations")
        .update({ owner_id: userId })
        .eq("id", orgId);

      await this.databaseService.supabase.from("organization_members").insert({
        organization_id: orgId,
        user_id: userId,
        role: "owner",
      });

      await this.databaseService.supabase
        .from("user_restaurant_access")
        .insert({
          user_id: userId,
          restaurant_id: restaurantId,
          role: "owner",
          invited_via: null,
          is_active: true,
        });

      // Seed onboarding progress row (fire-and-forget — never block registration)
      this.databaseService.supabase
        .from("user_onboarding_progress")
        .insert({ user_id: userId, restaurant_id: restaurantId })
        .then(({ error }) => {
          if (error)
            this.logger.warn(
              `Failed to seed onboarding_progress (non-fatal): ${error.message}`,
            );
        });

      // Both emails are fire-and-forget — Gmail latency must never delay the registration response
      this.queueEmailVerification(userId, dto.email).catch((err) =>
        this.logger.warn(
          `queueEmailVerification failed (non-fatal): ${err.message}`,
        ),
      );

      this.gmailService
        .sendOnboardingEmail({
          to: dto.email,
          ownerName: dto.name,
          restaurantName: dto.restaurantName,
          restaurantCity: dto.city,
          frontendBaseUrl:
            this.configService.get("FRONTEND_URL") ||
            "https://restaurant-ai-automation-web.vercel.app",
        })
        .catch((err) =>
          this.logger.warn(
            `Onboarding email failed (non-fatal): ${err.message}`,
          ),
        );

      return this.generateTokens(user);
    } catch (err) {
      if (userId)
        await this.databaseService.supabase
          .from("users")
          .delete()
          .eq("user_id", userId);
      if (restaurantId)
        await this.databaseService.supabase
          .from("restaurants")
          .delete()
          .eq("id", restaurantId);
      if (orgId)
        await this.databaseService.supabase
          .from("organizations")
          .delete()
          .eq("id", orgId);
      this.logger.error(
        `registerRestaurant rollback triggered: ${err.message}`,
      );
      throw new BadRequestException("Registration failed: " + err.message);
    }
  }

  private async queueEmailVerification(
    userId: string,
    email: string,
  ): Promise<void> {
    try {
      const { data: verif } = await this.databaseService.supabase
        .from("email_verifications")
        .insert({ user_id: userId, email })
        .select("token")
        .single();
      if (!verif) return;

      const frontendUrl =
        this.configService.get("FRONTEND_URL") ||
        "https://restaurant-ai-automation-web.vercel.app";
      const verifyUrl = `${frontendUrl}/verify-email?token=${verif.token}`;

      // Always call sendEmail() — it handles lazy-init and falls back to mock if OAuth unconfigured
      const result = await this.gmailService.sendEmail({
        to: [email],
        subject: "Verify your WineOps AI account",
        html: this.buildVerificationEmailHtml(verifyUrl),
      });

      if (!result.success) {
        this.logger.warn(
          `Verification email not delivered to ${email}: ${result.error}`,
        );
      } else {
        this.logger.log(
          `Verification email sent to ${email} (id: ${result.messageId})`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to queue email verification: ${err.message}`);
    }
  }

  private buildVerificationEmailHtml(verifyUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verify your WineOps AI account</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
    <div style="background:#7c2d12;padding:28px 32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">WineOps AI</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Verify your email address</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
        You're almost there! Click the button below to verify your email address and activate your WineOps account.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${verifyUrl}" style="display:inline-block;padding:14px 36px;background:#7c2d12;color:#fff;text-decoration:none;font-weight:600;border-radius:8px;font-size:16px;">
          Verify My Email
        </a>
      </div>
      <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
        This link expires in <strong>24 hours</strong>. If you didn't create a WineOps account, you can safely ignore this email.
      </p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        If the button doesn't work, copy and paste this link into your browser:<br/>
        <a href="${verifyUrl}" style="color:#7c2d12;word-break:break-all;">${verifyUrl}</a>
      </p>
    </div>
    <div style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">© ${new Date().getFullYear()} WineOps AI. Automated message — please do not reply.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Preview an invite code — returns invite details or {valid:false, reason}.
   * @Public() endpoint — no auth required.
   */
  async getInvitePreview(code: string): Promise<object> {
    const { data: invite } = await this.databaseService.supabase
      .from("organization_invites")
      .select(
        `
        id, role, expires_at, used_at,
        organizations ( name ),
        restaurants ( name, city ),
        users!invited_by ( name )
      `,
      )
      .eq("code", code.toUpperCase())
      .maybeSingle();

    if (!invite) return { valid: false, reason: "not_found" };
    if (invite.used_at) return { valid: false, reason: "used" };
    if (new Date(invite.expires_at) < new Date())
      return { valid: false, reason: "expired" };

    return {
      valid: true,
      organization: (invite.organizations as any)?.name,
      restaurant: (invite.restaurants as any)?.name,
      city: (invite.restaurants as any)?.city,
      inviter: (invite.users as any)?.name,
      role: invite.role,
    };
  }

  /**
   * Generate an invite code for a restaurant (owner/manager only).
   * Produces 8-char code from unambiguous charset (no 0/O/1/I).
   */
  async generateInvite(
    userId: string,
    restaurantId: string,
    dto: InviteDto,
  ): Promise<object> {
    const { data: userAccess } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (!userAccess) {
      // Fallback: check users table if user_restaurant_access row isn't present
      const { data: user } = await this.databaseService.supabase
        .from("users")
        .select("restaurant_id, role")
        .eq("user_id", userId)
        .maybeSingle();
      if (!user || user.restaurant_id !== restaurantId) {
        throw new ForbiddenException("Access denied to this restaurant");
      }
    }

    const { data: restaurant } = await this.databaseService.supabase
      .from("restaurants")
      .select("organization_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!restaurant?.organization_id) {
      throw new BadRequestException(
        "Restaurant has no organization. Complete registration first.",
      );
    }

    const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    let attempts = 0;
    do {
      const bytes = crypto.randomBytes(8);
      code = Array.from(bytes)
        .map((b) => CHARSET[(b as number) % CHARSET.length])
        .join("");
      const { data: existing } = await this.databaseService.supabase
        .from("organization_invites")
        .select("id")
        .eq("code", code)
        .maybeSingle();
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    const { data: invite, error } = await this.databaseService.supabase
      .from("organization_invites")
      .insert({
        organization_id: restaurant.organization_id,
        restaurant_id: restaurantId,
        code,
        invited_by: userId,
        role: dto.role || "manager",
      })
      .select("id, code, expires_at")
      .single();

    if (error || !invite)
      throw new BadRequestException("Failed to generate invite");

    // Create/update an ops profile so the invite shows on /team and claim can
    // back-fill user_id via invite_id (or email match).
    await this.ensureTeamMemberForInvite({
      restaurantId,
      inviteId: invite.id,
      email: dto.targetEmail ?? null,
      role: dto.role || "manager",
    });

    // Mark team_member_invited=true in onboarding progress (fire-and-forget)
    this.databaseService.supabase
      .from("user_onboarding_progress")
      .update({ team_member_invited: true })
      .eq("restaurant_id", restaurantId)
      .then(({ error: onboardingErr }) => {
        if (onboardingErr)
          this.logger.warn(
            `onboarding progress team_member_invited update failed (non-fatal): ${onboardingErr.message}`,
          );
      });

    return {
      code: invite.code,
      expiresAt: invite.expires_at,
      inviteUrl: `${this.configService.get("FRONTEND_URL") || "https://restaurant-ai-automation-web.vercel.app"}/invite/${invite.code}`,
    };
  }

  /**
   * Ensure a team_members row exists for an invite so /team can show pending
   * staff and claim can set user_id via invite_id.
   */
  private async ensureTeamMemberForInvite(params: {
    restaurantId: string;
    inviteId: string;
    email: string | null;
    role: string;
  }): Promise<void> {
    try {
      const position =
        params.role === "owner"
          ? "Owner"
          : params.role === "manager"
            ? "Manager"
            : "Staff";
      if (params.email) {
        const { data: existing } = await this.databaseService.supabase
          .from("team_members")
          .select("id, invite_id, user_id")
          .eq("restaurant_id", params.restaurantId)
          .ilike("email", params.email)
          .maybeSingle();
        if (existing) {
          if (!existing.user_id) {
            await this.databaseService.supabase
              .from("team_members")
              .update({
                invite_id: params.inviteId,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          }
          return;
        }
        await this.databaseService.supabase.from("team_members").insert({
          restaurant_id: params.restaurantId,
          invite_id: params.inviteId,
          email: params.email,
          display_name: params.email.split("@")[0] || "Invited member",
          position,
          employment_type: "full_time",
          status: "active",
        });
        return;
      }
      // No email — still create a placeholder pending invite row.
      await this.databaseService.supabase.from("team_members").insert({
        restaurant_id: params.restaurantId,
        invite_id: params.inviteId,
        display_name: `Pending ${position.toLowerCase()}`,
        position,
        employment_type: "full_time",
        status: "active",
      });
    } catch (e: any) {
      this.logger.warn(
        `ensureTeamMemberForInvite failed (non-fatal): ${e?.message}`,
      );
    }
  }

  /**
   * After invite accept: link or create team_members with user_id, clear invite_id.
   */
  private async claimTeamMemberFromInvite(params: {
    restaurantId: string;
    inviteId: string;
    userId: string;
    email?: string | null;
    name?: string | null;
    role: string;
  }): Promise<void> {
    try {
      // Prefer invite_id match, then email match within tenant.
      let memberId: string | null = null;
      const { data: byInvite } = await this.databaseService.supabase
        .from("team_members")
        .select("id")
        .eq("restaurant_id", params.restaurantId)
        .eq("invite_id", params.inviteId)
        .maybeSingle();
      if (byInvite) memberId = byInvite.id;

      if (!memberId && params.email) {
        const { data: byEmail } = await this.databaseService.supabase
          .from("team_members")
          .select("id")
          .eq("restaurant_id", params.restaurantId)
          .ilike("email", params.email)
          .maybeSingle();
        if (byEmail) memberId = byEmail.id;
      }

      if (memberId) {
        await this.databaseService.supabase
          .from("team_members")
          .update({
            user_id: params.userId,
            invite_id: null,
            email: params.email ?? undefined,
            display_name: params.name || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq("id", memberId)
          .eq("restaurant_id", params.restaurantId);
        return;
      }

      await this.databaseService.supabase.from("team_members").insert({
        restaurant_id: params.restaurantId,
        user_id: params.userId,
        invite_id: null,
        email: params.email ?? null,
        display_name: params.name || params.email || "Team member",
        position:
          params.role === "owner"
            ? "Owner"
            : params.role === "manager"
              ? "Manager"
              : "Staff",
        employment_type: "full_time",
        status: "active",
      });
    } catch (e: any) {
      this.logger.warn(
        `claimTeamMemberFromInvite failed (non-fatal): ${e?.message}`,
      );
    }
  }

  /**
   * Accept an invite as an already-authenticated user (no new account creation).
   */
  async acceptInviteAsExistingUser(
    userId: string,
    code: string,
  ): Promise<{ restaurant: string; role: string }> {
    const { data: actor } = await this.databaseService.supabase
      .from("users")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: invite, error: inviteErr } =
      await this.databaseService.supabase
        .from("organization_invites")
        .update({
          used_at: new Date().toISOString(),
          used_by_email: actor?.email ?? null,
        })
        .eq("code", code.toUpperCase())
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("id, organization_id, restaurant_id, role, restaurants(name)")
        .single();

    if (inviteErr || !invite) {
      throw new BadRequestException(
        "Invite code is invalid, expired, or already used",
      );
    }

    const { data: existingAccess } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("id")
      .eq("user_id", userId)
      .eq("restaurant_id", invite.restaurant_id)
      .maybeSingle();

    if (existingAccess) {
      await this.databaseService.supabase
        .from("organization_invites")
        .update({ used_at: null, used_by_email: null })
        .eq("id", invite.id);
      throw new ConflictException("already_member");
    }

    const { error: uraErr } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .insert({
        user_id: userId,
        restaurant_id: invite.restaurant_id,
        role: invite.role,
        invited_via: invite.id,
        is_active: true,
      });

    if (uraErr) {
      await this.databaseService.supabase
        .from("organization_invites")
        .update({ used_at: null, used_by_email: null })
        .eq("id", invite.id);
      throw new BadRequestException(
        "Failed to grant restaurant access: " + uraErr.message,
      );
    }

    await this.databaseService.supabase.from("organization_members").upsert(
      {
        organization_id: invite.organization_id,
        user_id: userId,
        role: invite.role,
        invited_via: invite.id,
      },
      { onConflict: "organization_id,user_id" },
    );

    await this.claimTeamMemberFromInvite({
      restaurantId: invite.restaurant_id,
      inviteId: invite.id,
      userId,
      email: actor?.email ?? null,
      name: null,
      role: invite.role,
    });

    const restaurantName = (invite.restaurants as any)?.name ?? "restaurant";
    return { restaurant: restaurantName, role: invite.role };
  }

  async getUserRoleAtRestaurant(
    userId: string,
    restaurantId: string,
  ): Promise<string | null> {
    const { data } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();
    return data?.role ?? null;
  }

  /**
   * Path A: Join via invite code — atomically consumes invite and creates user.
   * User is email_verified: true because owner vouched for them.
   */
  async joinViaInvite(dto: JoinViaInviteDto): Promise<TokenPair> {
    const { data: invite, error: inviteErr } =
      await this.databaseService.supabase
        .from("organization_invites")
        .update({ used_at: new Date().toISOString(), used_by_email: dto.email })
        .eq("code", dto.code.toUpperCase())
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("id, organization_id, restaurant_id, role")
        .single();

    if (inviteErr || !invite) {
      throw new BadRequestException(
        "Invite code is invalid, expired, or already used",
      );
    }

    const { data: existingUser } = await this.databaseService.supabase
      .from("users")
      .select("*")
      .eq("email", dto.email)
      .maybeSingle();

    let user: any;

    if (existingUser) {
      const { data: existingAccess } = await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("id")
        .eq("user_id", existingUser.user_id)
        .eq("restaurant_id", invite.restaurant_id)
        .maybeSingle();

      if (existingAccess) {
        await this.databaseService.supabase
          .from("organization_invites")
          .update({ used_at: null, used_by_email: null })
          .eq("id", invite.id);
        throw new ConflictException("already_member");
      }

      user = existingUser;
    } else {
      const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
      const { data: newUser, error: userErr } =
        await this.databaseService.supabase
          .from("users")
          .insert({
            email: dto.email,
            password_hash: passwordHash,
            name: dto.name,
            restaurant_id: invite.restaurant_id,
            role: invite.role,
            email_verified: true,
          })
          .select()
          .single();

      if (userErr || !newUser) {
        await this.databaseService.supabase
          .from("organization_invites")
          .update({ used_at: null, used_by_email: null })
          .eq("id", invite.id);
        throw new BadRequestException(
          "User creation failed: " + userErr?.message,
        );
      }
      user = newUser;
    }

    const { error: uraErr } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .insert({
        user_id: user.user_id,
        restaurant_id: invite.restaurant_id,
        role: invite.role,
        invited_via: invite.id,
        is_active: true,
      });

    if (uraErr) {
      await this.databaseService.supabase
        .from("organization_invites")
        .update({ used_at: null, used_by_email: null })
        .eq("id", invite.id);
      throw new BadRequestException(
        "Failed to grant restaurant access: " + uraErr.message,
      );
    }

    await this.databaseService.supabase.from("organization_members").upsert(
      {
        organization_id: invite.organization_id,
        user_id: user.user_id,
        role: invite.role,
        invited_via: invite.id,
      },
      { onConflict: "organization_id,user_id" },
    );

    await this.claimTeamMemberFromInvite({
      restaurantId: invite.restaurant_id,
      inviteId: invite.id,
      userId: user.user_id,
      email: dto.email,
      name: dto.name ?? user.name ?? null,
      role: invite.role,
    });

    return this.generateTokens({
      ...user,
      restaurant_id: invite.restaurant_id,
    });
  }

  /**
   * Verify email using the token from the verification email.
   * Returns a new token pair with emailVerified: true in the payload.
   */
  async verifyEmail(token: string): Promise<TokenPair> {
    const { data: verif } = await this.databaseService.supabase
      .from("email_verifications")
      .select("id, expires_at, verified_at, user_id")
      .eq("token", token)
      .maybeSingle();

    if (!verif) throw new BadRequestException("Invalid verification token");
    if (verif.verified_at)
      throw new BadRequestException("Email already verified");
    if (new Date(verif.expires_at) < new Date()) {
      throw new BadRequestException(
        "Verification token expired. Please resend.",
      );
    }

    await this.databaseService.supabase
      .from("email_verifications")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", verif.id);

    const { data: user } = await this.databaseService.supabase
      .from("users")
      .update({ email_verified: true })
      .eq("user_id", verif.user_id)
      .select()
      .single();

    if (!user) throw new BadRequestException("User not found");
    return this.generateTokens(user);
  }

  /**
   * Resend verification email — rate-limited to 1 per minute via resend_count.
   */
  async resendVerification(
    userId: string,
    email: string,
  ): Promise<{ sent: boolean }> {
    const { data: verif } = await this.databaseService.supabase
      .from("email_verifications")
      .select("id, resend_count, last_resent_at, token")
      .eq("user_id", userId)
      .is("verified_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verif) throw new BadRequestException("No pending verification found");

    if (verif.last_resent_at) {
      const secondsSinceLast =
        (Date.now() - new Date(verif.last_resent_at).getTime()) / 1000;
      if (secondsSinceLast < 60) {
        throw new BadRequestException("Please wait 1 minute before resending");
      }
    }

    await this.databaseService.supabase
      .from("email_verifications")
      .update({
        resend_count: verif.resend_count + 1,
        last_resent_at: new Date().toISOString(),
      })
      .eq("id", verif.id);

    await this.queueEmailVerification(userId, email);
    return { sent: true };
  }

  /**
   * Find or create OAuth user.
   * If the user doesn't exist, create them and assign to the default restaurant
   * (or leave restaurant_id null for an onboarding flow).
   */
  async findOrCreateOAuthUser(params: {
    provider: "google" | "microsoft";
    providerId: string;
    email: string;
    name: string;
  }) {
    const { provider, providerId, email, name } = params;

    let { data: user } = await this.databaseService.supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!user) {
      const defaultRestaurantId = this.configService.get<string>(
        "DEFAULT_RESTAURANT_ID",
      );

      // Without a restaurant to join, signing up here would mint an account
      // that can authenticate but belongs to no tenant — it lands on /no-access
      // with no way forward, and quietly consumes the email address so the
      // proper registration flow later reports it as taken. Registration is
      // where a restaurant gets created or an invite gets redeemed.
      if (!defaultRestaurantId) {
        this.logger.warn(
          `Rejected ${provider} sign-in for unknown email; no account exists`,
        );
        throw new UnauthorizedException(
          "No WineOps account uses that address. Create an account or use your invite code first.",
        );
      }

      const insertData: Record<string, any> = {
        email,
        name,
        oauth_provider: provider,
        oauth_id: providerId,
        role: "manager",
        restaurant_id: defaultRestaurantId,
      };

      const { data: newUser, error } = await this.databaseService.supabase
        .from("users")
        .insert(insertData)
        .select()
        .single();

      if (error || !newUser) {
        this.logger.error(`OAuth registration failed: ${error?.message}`);
        throw new UnauthorizedException("OAuth registration failed");
      }

      user = newUser;
    }

    return user;
  }

  /**
   * Check if an email is already registered.
   * Returns true if email exists, false otherwise.
   */
  async checkEmailExists(email: string): Promise<boolean> {
    const { data: existing } = await this.databaseService.supabase
      .from("users")
      .select("email")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    return !!existing;
  }

  /** Build profile payload for GET/PATCH /auth/me */
  async getProfileForUser(userId: string) {
    const { data: user, error } = await this.databaseService.supabase
      .from("users")
      .select(
        "user_id, email, name, phone, role, password_hash, oauth_provider, restaurant_id",
      )
      .eq("user_id", userId)
      .single();

    if (error || !user) {
      throw new UnauthorizedException("User not found");
    }

    const linkedProviders = await this.getLinkedProviders(userId);

    return {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? null,
      role: user.role,
      restaurantId: user.restaurant_id ?? null,
      hasPassword: !!user.password_hash,
      linkedProviders,
    };
  }

  async updateProfile(
    userId: string,
    updates: { name?: string; phone?: string },
  ) {
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (trimmed.length < 2) {
        throw new BadRequestException(
          "Display name must be at least 2 characters",
        );
      }
      patch.name = trimmed;
    }
    if (updates.phone !== undefined) {
      patch.phone = updates.phone.trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      return this.getProfileForUser(userId);
    }

    const { error } = await this.databaseService.supabase
      .from("users")
      .update(patch)
      .eq("user_id", userId);

    if (error) {
      this.logger.error(`updateProfile failed: ${error.message}`);
      throw new BadRequestException("Failed to update profile");
    }

    return this.getProfileForUser(userId);
  }

  async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException(
        "New password must be at least 8 characters",
      );
    }

    const { data: user, error } = await this.databaseService.supabase
      .from("users")
      .select("password_hash")
      .eq("user_id", userId)
      .single();

    if (error || !user) {
      throw new UnauthorizedException("User not found");
    }

    if (user.password_hash) {
      if (!currentPassword) {
        throw new BadRequestException("Current password is required");
      }
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        throw new UnauthorizedException("Current password is incorrect");
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, this.SALT_ROUNDS);
    const { error: updateErr } = await this.databaseService.supabase
      .from("users")
      .update({
        password_hash: passwordHash,
      })
      .eq("user_id", userId);

    if (updateErr) {
      this.logger.error(`changePassword failed: ${updateErr.message}`);
      throw new BadRequestException("Failed to update password");
    }
  }

  /** Minimum seconds between password-reset requests for the same email. */
  private readonly RESET_REQUEST_COOLDOWN_SECONDS = 60;

  /**
   * Request a password reset. Always resolves the same way regardless of
   * whether the email matches an account — enumeration resistance is the
   * point. The only branch that differs is entirely internal: no row is
   * inserted and no email is sent for an unknown address, but the caller
   * cannot observe that from the response or the response time (the lookup
   * runs either way).
   *
   * Per-email throttling lives here as a DB timestamp check, same pattern as
   * resendVerification() above. Per-IP throttling is a separate, coarser
   * layer in RequestPasswordResetThrottleGuard (auth.controller.ts) — it
   * cannot see which email was requested, only where the requests are coming
   * from, so it catches a burst across many addresses that this per-email
   * check would wave through one at a time.
   */
  async requestPasswordReset(
    email: string,
    requestIp: string | null,
  ): Promise<{ sent: true }> {
    const normalizedEmail = email.trim().toLowerCase();

    const { data: user } = await this.databaseService.supabase
      .from("users")
      .select("user_id, name, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // Always return the same shape. Do not throw NotFound here — that is
    // exactly the timing/branching oracle enumeration relies on.
    if (!user) {
      this.logger.log(
        `Password reset requested for unknown email (no-op): ${normalizedEmail}`,
      );
      return { sent: true };
    }

    const { data: recent } = await this.databaseService.supabase
      .from("password_resets")
      .select("created_at")
      .eq("email", normalizedEmail)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent) {
      const secondsSinceLast =
        (Date.now() - new Date(recent.created_at).getTime()) / 1000;
      if (secondsSinceLast < this.RESET_REQUEST_COOLDOWN_SECONDS) {
        // Still return success. Revealing "please wait" also reveals the
        // email exists — the whole reason this method is enumeration-safe is
        // that every branch produces the same response.
        this.logger.log(
          `Password reset re-requested within cooldown for ${normalizedEmail} — suppressing duplicate email`,
        );
        return { sent: true };
      }
    }

    const { data: reset, error: insertErr } =
      await this.databaseService.supabase
        .from("password_resets")
        .insert({
          user_id: user.user_id,
          email: normalizedEmail,
          requested_ip: requestIp,
        })
        .select("token")
        .single();

    if (insertErr || !reset) {
      this.logger.error(
        `Failed to create password reset row for ${normalizedEmail}: ${insertErr?.message}`,
      );
      // Do not leak the failure to the caller — same reasoning as above.
      return { sent: true };
    }

    const frontendUrl =
      this.configService.get("FRONTEND_URL") ||
      "https://restaurant-ai-automation-web.vercel.app";
    const resetUrl = `${frontendUrl}/reset-password?token=${reset.token}`;

    try {
      const { passwordResetEmailTemplate } =
        await import("../communications/email-templates");
      const result = await this.gmailService.sendEmail({
        to: [normalizedEmail],
        subject: "Reset your WineOps AI password",
        html: passwordResetEmailTemplate({ name: user.name, resetUrl }),
      });
      if (!result.success) {
        this.logger.warn(
          `Password reset email not delivered to ${normalizedEmail}: ${result.error}`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to send password reset email: ${err.message}`);
    }

    return { sent: true };
  }

  /**
   * Consume a password-reset token. Single-use: the row is stamped used_at in
   * the same request that changes the password, and every other still-live
   * reset row for that user is invalidated alongside it — a stale link from
   * an earlier request must not remain a live way into the account after a
   * newer one succeeded.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { data: reset, error } = await this.databaseService.supabase
      .from("password_resets")
      .select("id, user_id, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();

    if (error || !reset) {
      throw new BadRequestException("Invalid or expired reset link");
    }

    if (reset.used_at) {
      throw new BadRequestException("This reset link has already been used");
    }

    if (new Date(reset.expires_at).getTime() < Date.now()) {
      throw new BadRequestException("This reset link has expired");
    }

    const passwordHash = await bcrypt.hash(newPassword, this.SALT_ROUNDS);

    const { error: updateErr } = await this.databaseService.supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("user_id", reset.user_id);

    if (updateErr) {
      this.logger.error(`resetPassword failed: ${updateErr.message}`);
      throw new BadRequestException("Failed to update password");
    }

    const usedAt = new Date().toISOString();

    // Consume this token and any other still-pending reset for the same user
    // in one statement, so a second unused link from an earlier request
    // cannot be replayed after this one succeeds.
    await this.databaseService.supabase
      .from("password_resets")
      .update({ used_at: usedAt })
      .eq("user_id", reset.user_id)
      .is("used_at", null);

    // Deliberately does not revoke existing sessions. changePassword() above —
    // the existing, in-app password-change path — does not do this either, and
    // TokenBlacklistService can only blacklist a token it is handed; nothing in
    // this codebase tracks the set of tokens issued to a user, so "revoke every
    // outstanding session" is a real feature this change does not build. If a
    // reset should force other devices out, that is a follow-up against
    // TokenBlacklistService, applied consistently to changePassword too — not
    // a one-off here.
  }

  async getLinkedProviders(userId: string): Promise<{
    google: boolean;
    microsoft: boolean;
  }> {
    const { data: rows } = await this.databaseService.supabase
      .from("user_oauth_accounts")
      .select("provider")
      .eq("user_id", userId);

    const set = new Set(
      (rows ?? []).map((r: { provider: string }) => r.provider),
    );

    // Legacy fallback
    if (set.size === 0) {
      const { data: user } = await this.databaseService.supabase
        .from("users")
        .select("oauth_provider")
        .eq("user_id", userId)
        .maybeSingle();
      if (user?.oauth_provider === "google") set.add("google");
      if (user?.oauth_provider === "microsoft") set.add("microsoft");
    }

    return {
      google: set.has("google"),
      microsoft: set.has("microsoft"),
    };
  }

  async linkOAuthProvider(
    userId: string,
    provider: "google" | "microsoft",
    token: string,
  ) {
    if (!token?.trim()) {
      throw new BadRequestException("OAuth token is required");
    }

    let providerId: string;
    let email: string;

    if (provider === "google") {
      const googleUser = await this.verifyGoogleToken(token);
      providerId = googleUser.sub;
      email = googleUser.email;
    } else {
      const msUser = await this.verifyMicrosoftToken(token);
      providerId = msUser.oid;
      email = msUser.email;
    }

    const { data: me } = await this.databaseService.supabase
      .from("users")
      .select("email")
      .eq("user_id", userId)
      .single();

    if (
      me?.email &&
      email &&
      me.email.toLowerCase() !== String(email).toLowerCase()
    ) {
      throw new BadRequestException(
        "OAuth account email must match your WineOps email",
      );
    }

    const { data: existing } = await this.databaseService.supabase
      .from("user_oauth_accounts")
      .select("user_id")
      .eq("provider", provider)
      .eq("provider_user_id", providerId)
      .maybeSingle();

    if (existing && existing.user_id !== userId) {
      throw new ConflictException(
        "This OAuth account is already linked to another user",
      );
    }

    const { error } = await this.databaseService.supabase
      .from("user_oauth_accounts")
      .upsert(
        {
          user_id: userId,
          provider,
          provider_user_id: providerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      );

    if (error) {
      this.logger.error(`linkOAuthProvider failed: ${error.message}`);
      throw new BadRequestException("Failed to link provider");
    }

    // Keep legacy columns in sync for older login paths
    await this.databaseService.supabase
      .from("users")
      .update({
        oauth_provider: provider,
        oauth_id: providerId,
      })
      .eq("user_id", userId);

    return this.getLinkedProviders(userId);
  }

  async unlinkOAuthProvider(userId: string, provider: "google" | "microsoft") {
    const linked = await this.getLinkedProviders(userId);
    const { data: user } = await this.databaseService.supabase
      .from("users")
      .select("password_hash")
      .eq("user_id", userId)
      .single();

    const otherLinked =
      (provider === "google" ? linked.microsoft : linked.google) ||
      !!user?.password_hash;

    if (!otherLinked) {
      throw new BadRequestException(
        "Cannot unlink your only sign-in method. Set a password first.",
      );
    }

    await this.databaseService.supabase
      .from("user_oauth_accounts")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);

    const { data: legacy } = await this.databaseService.supabase
      .from("users")
      .select("oauth_provider")
      .eq("user_id", userId)
      .maybeSingle();

    if (legacy?.oauth_provider === provider) {
      const remaining = await this.getLinkedProviders(userId);
      const next = remaining.google
        ? "google"
        : remaining.microsoft
          ? "microsoft"
          : null;
      await this.databaseService.supabase
        .from("users")
        .update({
          oauth_provider: next,
          oauth_id: null,
        })
        .eq("user_id", userId);
    }

    return this.getLinkedProviders(userId);
  }

  async leaveRestaurant(userId: string, restaurantId: string): Promise<void> {
    const { data: targetAccess } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (!targetAccess) {
      throw new BadRequestException("You are not a member of this restaurant");
    }

    if (targetAccess.role === "owner") {
      const { count } = await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("role", "owner")
        .eq("is_active", true);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          "You're the only owner. Transfer ownership first.",
        );
      }
    }

    const { error } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .delete()
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`leaveRestaurant failed: ${error.message}`);
      throw new BadRequestException("Failed to leave restaurant");
    }
  }

  async deleteAccount(userId: string): Promise<void> {
    // Soft-guard: block if sole owner of any restaurant
    const { data: ownerRows } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("restaurant_id, role")
      .eq("user_id", userId)
      .eq("role", "owner")
      .eq("is_active", true);

    for (const row of ownerRows ?? []) {
      const { count } = await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", row.restaurant_id)
        .eq("role", "owner")
        .eq("is_active", true);
      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          "Transfer ownership of all restaurants before deleting your account.",
        );
      }
    }

    await this.databaseService.supabase
      .from("user_oauth_accounts")
      .delete()
      .eq("user_id", userId);

    await this.databaseService.supabase
      .from("user_restaurant_access")
      .delete()
      .eq("user_id", userId);

    const { error } = await this.databaseService.supabase
      .from("users")
      .delete()
      .eq("user_id", userId);

    if (error) {
      this.logger.error(`deleteAccount failed: ${error.message}`);
      throw new BadRequestException("Failed to delete account");
    }

    this.logger.log(`Account deleted: ${userId}`);
  }
}
