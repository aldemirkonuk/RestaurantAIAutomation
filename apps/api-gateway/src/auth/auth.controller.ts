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
} from '@nestjs/common';
import { AuthService, LoginCredentials, RegisterData } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
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
}

