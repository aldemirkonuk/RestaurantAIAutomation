import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { TokenBlacklistService } from './services/token-blacklist.service';
import * as bcrypt from 'bcrypt';
import axios from 'axios';

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
