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
} from '@nestjs/common';
import { AuthService, LoginCredentials, RegisterData } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Public } from './decorators/public.decorator';
import { RegisterRestaurantDto } from './dto/register-restaurant.dto';
import { JoinViaInviteDto } from './dto/join-via-invite.dto';
import { InviteDto } from './dto/invite.dto';
import { Request } from 'express';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * Login with email/password
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() credentials: LoginCredentials) {
    this.logger.log(`Login attempt: ${credentials.email}`);
    try {
      const tokens = await this.authService.login(credentials);
      return {
        success: true,
        ...tokens,
        message: 'Login successful',
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Register new user
   */
  @Post('register')
  async register(@Body() data: RegisterData) {
    this.logger.log(`Registration attempt: ${data.email}`);
    const tokens = await this.authService.register(data);
    
    return {
      success: true,
      ...tokens,
      message: 'Registration successful',
    };
  }

  /**
   * Login with Google OAuth
   */
  @Post('oauth/google')
  async loginWithGoogle(@Body() body: { token: string }) {
    this.logger.log('Google OAuth login attempt');
    const tokens = await this.authService.loginWithGoogle(body.token);
    
    return {
      success: true,
      ...tokens,
      message: 'Google login successful',
    };
  }

  /**
   * Login with Microsoft OAuth
   */
  @Post('oauth/microsoft')
  async loginWithMicrosoft(@Body() body: { token: string }) {
    this.logger.log('Microsoft OAuth login attempt');
    const tokens = await this.authService.loginWithMicrosoft(body.token);
    
    return {
      success: true,
      ...tokens,
      message: 'Microsoft login successful',
    };
  }

  /**
   * Refresh access token
   */
  @Post('refresh')
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
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request & { user: any },
    @Headers('authorization') authorization?: string,
  ) {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.substring('Bearer '.length)
      : undefined;
    await this.authService.logout(req.user.userId, token);
    
    return {
      success: true,
      message: 'Logout successful',
    };
  }

  /**
   * Get current user profile
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: Request & { user: any }) {
    return {
      success: true,
      user: req.user,
    };
  }

  /**
   * Verify token (health check for auth)
   */
  @Get('verify')
  @UseGuards(JwtAuthGuard)
  async verifyToken() {
    return {
      success: true,
      message: 'Token is valid',
    };
  }

  /**
   * Path B: Register a new restaurant (creates org + restaurant + owner user atomically).
   * Requires email verification after registration.
   */
  @Post('register/restaurant')
  @Public()
  async registerRestaurant(@Body() dto: RegisterRestaurantDto) {
    this.logger.log(`Path B registration attempt: ${dto.email}`);
    const tokens = await this.authService.registerRestaurant(dto);
    return { success: true, ...tokens, message: 'Registration successful. Please verify your email.' };
  }

  /**
   * Preview an invite code — returns org/restaurant info or {valid:false, reason}.
   */
  @Get('invite/:code')
  @Public()
  async getInvitePreview(@Param('code') code: string) {
    return this.authService.getInvitePreview(code);
  }

  /**
   * Generate an invite code for a restaurant (owner/manager only).
   */
  @Post('invite')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'manager')
  async generateInvite(@Req() req: Request & { user: any }, @Body() dto: InviteDto) {
    this.logger.log(`Invite generation by user ${req.user.userId} for restaurant ${dto.restaurantId}`);
    const result = await this.authService.generateInvite(req.user.userId, dto.restaurantId, dto);
    return { success: true, ...result };
  }

  /**
   * Path A: Join via invite code — creates user linked to restaurant.
   */
  @Post('join')
  @Public()
  async joinViaInvite(@Body() dto: JoinViaInviteDto) {
    this.logger.log(`Path A join attempt with code: ${dto.code}`);
    const tokens = await this.authService.joinViaInvite(dto);
    return { success: true, ...tokens, message: 'Joined successfully' };
  }

  /**
   * Verify email with the token from the verification email.
   */
  @Post('verify-email')
  @UseGuards(JwtAuthGuard)
  async verifyEmail(@Req() req: Request & { user: any }, @Body() body: { token: string }) {
    const tokens = await this.authService.verifyEmail(req.user.userId, body.token);
    return { success: true, ...tokens, message: 'Email verified' };
  }

  /**
   * Resend verification email — rate-limited to 1 per minute.
   */
  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  async resendVerification(@Req() req: Request & { user: any }) {
    const result = await this.authService.resendVerification(req.user.userId, req.user.email);
    return { success: true, ...result };
  }
}

