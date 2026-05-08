import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { TokenBlacklistService } from './services/token-blacklist.service';
import { GmailService } from '../communications/gmail.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import axios from 'axios';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto';
import { JoinViaInviteDto } from './dto/join-via-invite.dto';
import { InviteDto } from './dto/invite.dto';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  role: 'owner' | 'manager' | 'staff';
  restaurantId: string;
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
  role: 'owner' | 'manager' | 'staff';
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
      this.configService.get<string>('JWT_SECRET') ||
      'your-secret-key-change-in-production';
    this.jwtRefreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ||
      this.jwtSecret + '-refresh';

    if (this.jwtSecret === 'your-secret-key-change-in-production') {
      this.logger.warn(
        'Using default JWT_SECRET — set a proper secret in production!',
      );
    }
    if (!this.configService.get<string>('JWT_REFRESH_SECRET')) {
      this.logger.warn(
        'JWT_REFRESH_SECRET not set — deriving from JWT_SECRET. Set a separate secret in production!',
      );
    }
  }

  /**
   * Validate user credentials
   */
  async validateUser(email: string, password: string): Promise<any> {
    const { data: user, error } = await this.databaseService.supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(
      password,
      user.password_hash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
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
      .from('users')
      .select('email')
      .eq('email', data.email)
      .single();

    if (existingUser) {
      throw new UnauthorizedException('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, this.SALT_ROUNDS);

    // Create user
    const { data: newUser, error } = await this.databaseService.supabase
      .from('users')
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
      throw new UnauthorizedException('Registration failed');
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
      provider: 'google',
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
      provider: 'microsoft',
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
        .from('users')
        .select('*')
        .eq('user_id', payload.sub)
        .single();

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return this.generateTokens(user);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
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
        await this.tokenBlacklistService.blacklistToken(
          accessToken,
          expiresAt,
        );
      }
    }
    this.logger.log(`User logged out: ${userId}`);
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
        .from('user_roles')
        .select('role')
        .eq('user_id', user.user_id)
        .is('revoked_at', null);
      studioRoles = (data ?? []).map((r: any) => r.role);
    } catch {
      // Non-critical — studio endpoints will just reject with 403
    }

    const payload = {
      sub: user.user_id,
      email: user.email,
      role: user.role,
      restaurantId: user.restaurant_id,
      emailVerified: user.email_verified ?? false,
      app_metadata: { roles: studioRoles },
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.jwtSecret,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.jwtRefreshSecret,
      expiresIn: '7d',
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

      const expectedClientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
      if (expectedClientId && data.aud !== expectedClientId) {
        throw new UnauthorizedException('Invalid Google token audience');
      }

      return {
        sub: data.sub,
        email: data.email,
        name: data.name || data.given_name || data.email,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(`Google token verification failed: ${error}`);
      throw new UnauthorizedException('Failed to verify Google token');
    }
  }

  /**
   * Verify Microsoft OAuth token
   */
  private async verifyMicrosoftToken(token: string): Promise<any> {
    try {
      const response = await axios.get('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = response.data;
      const email = data.mail || data.userPrincipalName;

      if (!email) {
        throw new UnauthorizedException('Microsoft token missing email');
      }

      return {
        oid: data.id,
        email,
        name: data.displayName || email,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(`Microsoft token verification failed: ${error}`);
      throw new UnauthorizedException('Failed to verify Microsoft token');
    }
  }

  /**
   * Validate JWT payload
   */
  async validateJwtPayload(payload: JwtPayload): Promise<any> {
    const { data: user } = await this.databaseService.supabase
      .from('users')
      .select('*')
      .eq('user_id', payload.sub)
      .single();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  /**
   * Path B: Register a new restaurant (creates org + restaurant + user atomically).
   * User starts with email_verified: false and must verify email.
   */
  async registerRestaurant(dto: RegisterRestaurantDto): Promise<TokenPair> {
    const { data: existing } = await this.databaseService.supabase
      .from('users')
      .select('email')
      .eq('email', dto.email)
      .maybeSingle();
    if (existing) throw new BadRequestException('Email already registered');

    let orgId: string | null = null;
    let restaurantId: string | null = null;
    let userId: string | null = null;

    try {
      const { data: org, error: orgErr } = await this.databaseService.supabase
        .from('organizations')
        .insert({ name: `${dto.restaurantName} Group`, owner_id: null })
        .select()
        .single();
      if (orgErr || !org) throw new Error(orgErr?.message || 'Org creation failed');
      orgId = org.id;

      const { data: restaurant, error: restErr } = await this.databaseService.supabase
        .from('restaurants')
        .insert({
          name: dto.restaurantName,
          address: dto.address,
          city: dto.city,
          country: dto.country,
          phone: dto.phone,
          cuisine_type: dto.cuisineType,
          timezone: dto.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
          organization_id: org.id,
        })
        .select()
        .single();
      if (restErr || !restaurant) throw new Error(restErr?.message || 'Restaurant creation failed');
      restaurantId = restaurant.id;

      const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
      const { data: user, error: userErr } = await this.databaseService.supabase
        .from('users')
        .insert({
          email: dto.email,
          password_hash: passwordHash,
          name: dto.name,
          restaurant_id: restaurantId,
          role: 'owner',
          email_verified: false,
        })
        .select()
        .single();
      if (userErr || !user) throw new Error(userErr?.message || 'User creation failed');
      userId = user.user_id;

      await this.databaseService.supabase
        .from('organizations')
        .update({ owner_id: userId })
        .eq('id', orgId);

      await this.databaseService.supabase.from('organization_members').insert({
        organization_id: orgId,
        user_id: userId,
        role: 'owner',
      });

      await this.queueEmailVerification(userId, dto.email);

      return this.generateTokens(user);
    } catch (err) {
      if (userId) await this.databaseService.supabase.from('users').delete().eq('user_id', userId);
      if (restaurantId) await this.databaseService.supabase.from('restaurants').delete().eq('id', restaurantId);
      if (orgId) await this.databaseService.supabase.from('organizations').delete().eq('id', orgId);
      this.logger.error(`registerRestaurant rollback triggered: ${err.message}`);
      throw new BadRequestException('Registration failed: ' + err.message);
    }
  }

  private async queueEmailVerification(userId: string, email: string): Promise<void> {
    try {
      const { data: verif } = await this.databaseService.supabase
        .from('email_verifications')
        .insert({ user_id: userId, email })
        .select('token')
        .single();
      if (!verif) return;

      const verifyUrl = `${this.configService.get('FRONTEND_URL') || 'http://localhost:5173'}/verify-email?token=${verif.token}`;

      if (this.gmailService.isReady()) {
        await this.gmailService.sendEmail({
          to: [email],
          subject: 'Verify your WineOps account',
          html: `<p>Click to verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
        });
      } else {
        this.logger.warn(`[DEV] Email verification URL for ${email}: ${verifyUrl}`);
      }
    } catch (err) {
      this.logger.error(`Failed to queue email verification: ${err.message}`);
    }
  }

  /**
   * Preview an invite code — returns invite details or {valid:false, reason}.
   * @Public() endpoint — no auth required.
   */
  async getInvitePreview(code: string): Promise<object> {
    const { data: invite } = await this.databaseService.supabase
      .from('organization_invites')
      .select(`
        id, role, expires_at, used_at,
        organizations ( name ),
        restaurants ( name, city ),
        users!invited_by ( name )
      `)
      .eq('code', code.toUpperCase())
      .maybeSingle();

    if (!invite) return { valid: false, reason: 'not_found' };
    if (invite.used_at) return { valid: false, reason: 'used' };
    if (new Date(invite.expires_at) < new Date()) return { valid: false, reason: 'expired' };

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
  async generateInvite(userId: string, restaurantId: string, dto: InviteDto): Promise<object> {
    const { data: user } = await this.databaseService.supabase
      .from('users')
      .select('restaurant_id, role')
      .eq('user_id', userId)
      .maybeSingle();
    if (!user || user.restaurant_id !== restaurantId) {
      throw new ForbiddenException('Access denied to this restaurant');
    }

    const { data: restaurant } = await this.databaseService.supabase
      .from('restaurants')
      .select('organization_id')
      .eq('id', restaurantId)
      .maybeSingle();
    if (!restaurant?.organization_id) {
      throw new BadRequestException('Restaurant has no organization. Complete registration first.');
    }

    const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    let attempts = 0;
    do {
      const bytes = crypto.randomBytes(8);
      code = Array.from(bytes).map((b) => CHARSET[(b as number) % CHARSET.length]).join('');
      const { data: existing } = await this.databaseService.supabase
        .from('organization_invites')
        .select('id')
        .eq('code', code)
        .maybeSingle();
      if (!existing) break;
      attempts++;
    } while (attempts < 5);

    const { data: invite, error } = await this.databaseService.supabase
      .from('organization_invites')
      .insert({
        organization_id: restaurant.organization_id,
        restaurant_id: restaurantId,
        code,
        invited_by: userId,
        role: dto.role || 'manager',
      })
      .select('id, code, expires_at')
      .single();

    if (error || !invite) throw new BadRequestException('Failed to generate invite');

    return {
      code: invite.code,
      expiresAt: invite.expires_at,
      inviteUrl: `${this.configService.get('FRONTEND_URL') || 'http://localhost:5173'}/register?invite=${invite.code}`,
    };
  }

  /**
   * Path A: Join via invite code — atomically consumes invite and creates user.
   * User is email_verified: true because owner vouched for them.
   */
  async joinViaInvite(dto: JoinViaInviteDto): Promise<TokenPair> {
    const { data: existing } = await this.databaseService.supabase
      .from('users')
      .select('email')
      .eq('email', dto.email)
      .maybeSingle();
    if (existing) throw new BadRequestException('Email already registered');

    // Atomic UPDATE WHERE used_at IS NULL — prevents TOCTOU race (RESEARCH.md Pitfall 3)
    const { data: invite, error: inviteErr } = await this.databaseService.supabase
      .from('organization_invites')
      .update({ used_at: new Date().toISOString(), used_by_email: dto.email })
      .eq('code', dto.code.toUpperCase())
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id, organization_id, restaurant_id, role')
      .single();

    if (inviteErr || !invite) {
      throw new BadRequestException('Invite code is invalid, expired, or already used');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
    const { data: user, error: userErr } = await this.databaseService.supabase
      .from('users')
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

    if (userErr || !user) {
      await this.databaseService.supabase
        .from('organization_invites')
        .update({ used_at: null, used_by_email: null })
        .eq('id', invite.id);
      throw new BadRequestException('User creation failed: ' + userErr?.message);
    }

    await this.databaseService.supabase.from('organization_members').insert({
      organization_id: invite.organization_id,
      user_id: user.user_id,
      role: invite.role,
      invited_via: invite.id,
    });

    return this.generateTokens(user);
  }

  /**
   * Verify email using the token from the verification email.
   * Returns a new token pair with emailVerified: true in the payload.
   */
  async verifyEmail(userId: string, token: string): Promise<TokenPair> {
    const { data: verif } = await this.databaseService.supabase
      .from('email_verifications')
      .select('id, expires_at, verified_at, user_id')
      .eq('token', token)
      .eq('user_id', userId)
      .maybeSingle();

    if (!verif) throw new BadRequestException('Invalid verification token');
    if (verif.verified_at) throw new BadRequestException('Email already verified');
    if (new Date(verif.expires_at) < new Date()) {
      throw new BadRequestException('Verification token expired. Please resend.');
    }

    await this.databaseService.supabase
      .from('email_verifications')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', verif.id);

    const { data: user } = await this.databaseService.supabase
      .from('users')
      .update({ email_verified: true })
      .eq('user_id', userId)
      .select()
      .single();

    if (!user) throw new BadRequestException('User not found');
    return this.generateTokens(user);
  }

  /**
   * Resend verification email — rate-limited to 1 per minute via resend_count.
   */
  async resendVerification(userId: string, email: string): Promise<{ sent: boolean }> {
    const { data: verif } = await this.databaseService.supabase
      .from('email_verifications')
      .select('id, resend_count, last_resent_at, token')
      .eq('user_id', userId)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verif) throw new BadRequestException('No pending verification found');

    if (verif.last_resent_at) {
      const secondsSinceLast = (Date.now() - new Date(verif.last_resent_at).getTime()) / 1000;
      if (secondsSinceLast < 60) {
        throw new BadRequestException('Please wait 1 minute before resending');
      }
    }

    await this.databaseService.supabase
      .from('email_verifications')
      .update({
        resend_count: verif.resend_count + 1,
        last_resent_at: new Date().toISOString(),
      })
      .eq('id', verif.id);

    await this.queueEmailVerification(userId, email);
    return { sent: true };
  }

  /**
   * Find or create OAuth user.
   * If the user doesn't exist, create them and assign to the default restaurant
   * (or leave restaurant_id null for an onboarding flow).
   */
  async findOrCreateOAuthUser(params: {
    provider: 'google' | 'microsoft';
    providerId: string;
    email: string;
    name: string;
  }) {
    const { provider, providerId, email, name } = params;

    let { data: user } = await this.databaseService.supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      // Try to assign to default restaurant so the JWT has a valid restaurantId.
      // If DEFAULT_RESTAURANT_ID is not set, the user will need to complete onboarding.
      const defaultRestaurantId = this.configService.get<string>(
        'DEFAULT_RESTAURANT_ID',
      );

      const insertData: Record<string, any> = {
        email,
        name,
        oauth_provider: provider,
        oauth_id: providerId,
        role: 'manager',
      };

      if (defaultRestaurantId) {
        insertData.restaurant_id = defaultRestaurantId;
      }

      const { data: newUser, error } = await this.databaseService.supabase
        .from('users')
        .insert(insertData)
        .select()
        .single();

      if (error || !newUser) {
        this.logger.error(`OAuth registration failed: ${error?.message}`);
        throw new UnauthorizedException('OAuth registration failed');
      }

      user = newUser;
    }

    return user;
  }
}
