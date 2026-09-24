import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { ConfigService } from '@/core/config/config.service';
import { JwtPayload, TokenSubject } from '@/core/auth/auth.types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async issueTokens(
    user: TokenSubject,
    refreshJti: string,
  ): Promise<TokenPair> {
    const basePayload: Omit<JwtPayload, 'type' | 'jti'> = {
      sub: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.name),
      tokenVersion: user.tokenVersion,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...basePayload, type: 'access', jti: randomUUID() },
        {
          expiresIn: this.configService.get('JWT_ACCESS_TTL') as StringValue,
        },
      ),
      this.jwtService.signAsync(
        { ...basePayload, type: 'refresh', jti: refreshJti },
        {
          expiresIn: this.configService.get('JWT_REFRESH_TTL') as StringValue,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return payload;
  }

  async verifyAccessToken(token: string): Promise<JwtPayload | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      return payload.type === 'access' ? payload : null;
    } catch {
      return null;
    }
  }
}
