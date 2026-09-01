import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
  Param,
  Query,
  Patch,
  Delete,
  BadRequestException,
} from "@nestjs/common";
import { AuthService, LoginCredentials, RegisterData } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { Roles } from "./decorators/roles.decorator";
import { Public } from "./decorators/public.decorator";
import { AllowsTenantChange } from "../common/tenant/allows-tenant-change.decorator";
import { AllowUnverified } from "./decorators/allow-unverified.decorator";
import { CheckEmailDto } from "./dto/check-email.dto";
import { RegisterRestaurantDto } from "./dto/register-restaurant.dto";
import { JoinViaInviteDto } from "./dto/join-via-invite.dto";
import { InviteDto } from "./dto/invite.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LinkProviderDto } from "./dto/link-provider.dto";
import { LeaveRestaurantDto } from "./dto/leave-restaurant.dto";
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from "./dto/password-reset.dto";
import { PasswordResetThrottleGuard } from "./guards/password-reset-throttle.guard";
import { SignInMethodsDto } from "./dto/sign-in-methods.dto";
import { RateLimit } from "../common/rate-limit";
import { Request } from "express";
import { devBypassAllowed } from "./dev-bypass.util";

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * Login with email/password
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() credentials: LoginCredentials) {
    this.logger.log(`Login attempt: ${credentials.email}`);
    const tokens = await this.authService.login(credentials);
    return {
      success: true,
      ...tokens,
      message: "Login successful",
    };
  }

  /**
   * Mints a real login session for DEV_AUTH_BYPASS_EMAIL, no password.
   *
   * Exists purely so localhost testing (manual, or an automated browser tool)
   * never has to hold or type a real password. Off unless every condition in
   * `devBypassAllowed` holds — see that function and .env.local for the
   * switches — and the resulting session is a normal, fully-signed JWT with
   * no special handling anywhere else: refresh, /me, /me/role, tenant scoping
   * all work exactly as they do for a password login.
   */
  @Public()
  @Post("dev-bypass-login")
  @HttpCode(HttpStatus.OK)
  async devBypassLogin(@Req() req: Request) {
    if (!devBypassAllowed(req)) {
      throw new BadRequestException("Dev auth bypass is not available");
    }
    const tokens = await this.authService.devBypassLogin();
    return {
      success: true,
      ...tokens,
      message: "Dev bypass session issued",
    };
  }

  /**
   * Register new user
   */
  @Post("register")
  async register(@Body() data: RegisterData) {
    this.logger.log(`Registration attempt: ${data.email}`);
    const tokens = await this.authService.register(data);

    return {
      success: true,
      ...tokens,
      message: "Registration successful",
    };
  }

  /**
   * Login with Google OAuth
   */
  @Post("oauth/google")
  async loginWithGoogle(@Body() body: { token: string }) {
    this.logger.log("Google OAuth login attempt");
    const tokens = await this.authService.loginWithGoogle(body.token);

    return {
      success: true,
      ...tokens,
      message: "Google login successful",
    };
  }

  /**
   * Login with Microsoft OAuth
   */
  @Post("oauth/microsoft")
  async loginWithMicrosoft(@Body() body: { token: string }) {
    this.logger.log("Microsoft OAuth login attempt");
    const tokens = await this.authService.loginWithMicrosoft(body.token);

    return {
      success: true,
      ...tokens,
      message: "Microsoft login successful",
    };
  }

  /**
   * Refresh access token
   */
  @Post("refresh")
  async refresh(@Body() body: { refreshToken: string }) {
    const tokens = await this.authService.refreshAccessToken(body.refreshToken);

    return {
      success: true,
      ...tokens,
    };
  }

  /**
   * Logout
   */
  @Post("logout")
  @UseGuards(JwtAuthGuard)
  @AllowUnverified() // leaving must never require verifying first
  async logout(
    @Req() req: Request & { user: any },
    @Headers("authorization") authorization?: string,
  ) {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.substring("Bearer ".length)
      : undefined;
    await this.authService.logout(req.user.userId, token);

    return {
      success: true,
      message: "Logout successful",
    };
  }

  /**
   * Get current user profile
   */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  // The web client populates `user` from here and nowhere else. Gate this and
  // an unverified session cannot discover that it is unverified — it just
  // fails to load, which is indistinguishable from a broken login.
  @AllowUnverified()
  async getProfile(@Req() req: Request & { user: any }) {
    const user = await this.authService.getProfileForUser(req.user.userId);
    // Prefer JWT-scoped restaurant over users.restaurant_id (branch switch)
    const restaurantId = req.user.restaurantId ?? user.restaurantId ?? null;
    return {
      success: true,
      user: { ...user, restaurantId },
    };
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Req() req: Request & { user: any },
    @Body() body: UpdateProfileDto,
  ) {
    const user = await this.authService.updateProfile(req.user.userId, body);
    return { success: true, user };
  }

  @Post("me/password")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: Request & { user: any },
    @Body() body: ChangePasswordDto,
  ) {
    await this.authService.changePassword(
      req.user.userId,
      body.currentPassword,
      body.newPassword,
    );
    return { success: true, message: "Password updated" };
  }

  /**
   * Request a password reset email. Public — the caller is, by definition,
   * someone who cannot authenticate right now.
   *
   * Always returns the same generic response whether or not the email
   * matches an account (enumeration resistance — see
   * AuthService#requestPasswordReset for the reasoning). Per-IP rate limiting
   * via PasswordResetThrottleGuard; per-email cooldown is enforced inside the
   * service, where it can see the row history.
   */
  @Post("request-password-reset")
  @Public()
  @UseGuards(PasswordResetThrottleGuard)
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() body: RequestPasswordResetDto,
    @Req() req: Request,
  ) {
    await this.authService.requestPasswordReset(body.email, req.ip || null);
    return {
      success: true,
      message:
        "If an account exists for that email, a password reset link has been sent.",
    };
  }

  /**
   * Consume a password-reset token and set a new password. Public, same
   * reasoning as request-password-reset — this is how someone regains access
   * without being logged in. Token validity, expiry and single-use are
   * enforced in AuthService#resetPassword.
   */
  @Post("reset-password")
  @Public()
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() body: ResetPasswordDto) {
    await this.authService.resetPassword(body.token, body.newPassword);
    return { success: true, message: "Password has been reset" };
  }

  @Get("me/linked-providers")
  @UseGuards(JwtAuthGuard)
  async getLinkedProviders(@Req() req: Request & { user: any }) {
    const linkedProviders = await this.authService.getLinkedProviders(
      req.user.userId,
    );
    return { success: true, linkedProviders };
  }

  @Post("me/link/:provider")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async linkProvider(
    @Req() req: Request & { user: any },
    @Param("provider") provider: string,
    @Body() body: LinkProviderDto,
  ) {
    if (provider !== "google" && provider !== "microsoft") {
      throw new BadRequestException("Unsupported provider");
    }
    const linkedProviders = await this.authService.linkOAuthProvider(
      req.user.userId,
      provider,
      body.token,
    );
    return { success: true, linkedProviders };
  }

  @Delete("me/link/:provider")
  @UseGuards(JwtAuthGuard)
  async unlinkProvider(
    @Req() req: Request & { user: any },
    @Param("provider") provider: string,
  ) {
    if (provider !== "google" && provider !== "microsoft") {
      throw new BadRequestException("Unsupported provider");
    }
    const linkedProviders = await this.authService.unlinkOAuthProvider(
      req.user.userId,
      provider,
    );
    return { success: true, linkedProviders };
  }

  @Post("me/leave-restaurant")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async leaveRestaurant(
    @Req() req: Request & { user: any },
    @Body() body: LeaveRestaurantDto,
  ) {
    await this.authService.leaveRestaurant(req.user.userId, body.restaurantId);
    return { success: true, message: "Left restaurant" };
  }

  @Delete("me")
  @UseGuards(JwtAuthGuard)
  @AllowUnverified() // deleting an account you cannot verify must stay possible
  async deleteAccount(@Req() req: Request & { user: any }) {
    await this.authService.deleteAccount(req.user.userId);
    return { success: true, message: "Account deleted" };
  }

  @Get("me/role")
  @UseGuards(JwtAuthGuard)
  @AllowUnverified() // AuthContext fetches this alongside /auth/me on boot
  async getMyRole(
    @Req() req: Request & { user: any },
    @Query("restaurantId") restaurantId?: string,
  ) {
    if (!restaurantId) {
      return { success: true, role: null };
    }
    const role = await this.authService.getUserRoleAtRestaurant(
      req.user.userId,
      restaurantId,
    );
    return { success: true, role };
  }

  @Post("invite/:code/accept")
  @UseGuards(JwtAuthGuard)
  async acceptInviteAsAuthed(
    @Req() req: Request & { user: any },
    @Param("code") code: string,
  ) {
    this.logger.log(
      `Invite accept by authenticated user ${req.user.userId}, code: ${code}`,
    );
    const result = await this.authService.acceptInviteAsExistingUser(
      req.user.userId,
      code,
    );
    return { success: true, ...result };
  }

  /**
   * Verify token (health check for auth)
   */
  @Get("verify")
  @UseGuards(JwtAuthGuard)
  @AllowUnverified() // answers "is this token live?", not "may you use the app?"
  async verifyToken() {
    return {
      success: true,
      message: "Token is valid",
    };
  }

  /**
   * Path B: Register a new restaurant (creates org + restaurant + owner user atomically).
   * Requires email verification after registration.
   */
  @Post("register/restaurant")
  @Public()
  async registerRestaurant(@Body() dto: RegisterRestaurantDto) {
    this.logger.log(`Path B registration attempt: ${dto.email}`);
    const tokens = await this.authService.registerRestaurant(dto);
    return {
      success: true,
      ...tokens,
      message: "Registration successful. Please verify your email.",
    };
  }

  /**
   * Preview an invite code — returns org/restaurant info or {valid:false, reason}.
   */
  @Get("invite/:code")
  @Public()
  async getInvitePreview(@Param("code") code: string) {
    return this.authService.getInvitePreview(code);
  }

  /**
   * Generate an invite code for a restaurant (owner/manager only).
   */
  @Post("invite")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("owner", "manager")
  async generateInvite(
    @Req() req: Request & { user: any },
    @Body() dto: InviteDto,
  ) {
    this.logger.log(
      `Invite generation by user ${req.user.userId} for restaurant ${dto.restaurantId}`,
    );
    const result = await this.authService.generateInvite(
      req.user.userId,
      dto.restaurantId,
      dto,
    );
    return { success: true, ...result };
  }

  /**
   * Path A: Join via invite code — creates user linked to restaurant.
   */
  @Post("join")
  @Public()
  async joinViaInvite(@Body() dto: JoinViaInviteDto) {
    this.logger.log(`Path A join attempt with code: ${dto.code}`);
    const tokens = await this.authService.joinViaInvite(dto);
    return { success: true, ...tokens, message: "Joined successfully" };
  }

  /**
   * Verify email with the token from the verification email.
   */
  @Post("verify-email")
  async verifyEmail(@Body() body: { token: string }) {
    const tokens = await this.authService.verifyEmail(body.token);
    return { success: true, ...tokens, message: "Email verified" };
  }

  /**
   * Resend verification email — rate-limited to 1 per minute.
   */
  @Post("resend-verification")
  @UseGuards(JwtAuthGuard)
  @AllowUnverified() // the escape hatch itself; gating it would be a trap
  async resendVerification(@Req() req: Request & { user: any }) {
    const result = await this.authService.resendVerification(
      req.user.userId,
      req.user.email,
    );
    return { success: true, ...result };
  }

  /**
   * Switch active restaurant context — re-issues JWT with the new restaurantId.
   * Validates the requesting user belongs to the target restaurant's organisation.
   */
  @Post("switch-restaurant")
  @UseGuards(JwtAuthGuard)
  @AllowsTenantChange()
  async switchRestaurant(
    @Req() req: Request & { user: any },
    @Body() body: { restaurantId: string },
  ) {
    const tokens = await this.authService.switchRestaurant(
      req.user.userId,
      body.restaurantId,
    );
    return { success: true, ...tokens };
  }

  /**
   * Check if an email is already registered.
   * Public endpoint for registration form validation.
   */
  @Get("check-email")
  @Public()
  async checkEmail(@Query() query: CheckEmailDto) {
    const exists = await this.authService.checkEmailExists(query.email);
    return {
      available: !exists,
      email: query.email,
    };
  }

  /**
   * Identity-first sign-in: which methods does this identity actually have?
   *
   * Public by necessity — the caller has not signed in yet, that being the
   * point. POST rather than GET so the address stays out of URLs, access logs
   * and proxy caches (`check-email` above predates that rule).
   *
   * Rate-limited to 10 per 10 minutes per IP via the existing `@RateLimit`
   * decorator on the global `RateLimitGuard` (app.module.ts). That is tighter
   * than the 10-per-60s default every `/auth/` route already gets, because
   * this endpoint answers a question about an address a stranger supplied.
   * Enumeration-revealing here is deliberate and argued in ADR 0024; it does
   * not extend to `request-password-reset`, which stays enumeration-safe.
   */
  @Post("sign-in-methods")
  @Public()
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "sign-in-methods" })
  @HttpCode(HttpStatus.OK)
  async signInMethods(@Body() body: SignInMethodsDto) {
    const result = await this.authService.resolveSignInMethods(body.email);
    return { success: true, ...result };
  }
}
