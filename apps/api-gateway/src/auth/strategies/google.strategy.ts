import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/v1/auth/oauth/google/callback',
      scope: ['profile', 'email'],
    });
  }

  async validate(
    accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ) {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return null;
    }

    const user = await this.authService.findOrCreateOAuthUser({
      provider: 'google',
      providerId: profile.id,
      email,
      name: profile.displayName || email,
    });

    return {
      userId: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantId: user.restaurant_id,
      accessToken,
    };
  }
}
