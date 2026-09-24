import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';

import { JwtPayload, RequestUser } from '@/core/auth/auth.types';
import { jwtFromRequestExtractor } from '@/core/auth/jwt-extractors';
import { ConfigService } from '@/core/config/config.service';
import { UsersService } from '@/modules/users/services/users.service';

/**
 * Registers the `'jwt'` passport strategy used by the global `JwtAuthGuard`
 * (`core/auth`). Lives here rather than in `core/auth` because validating a
 * token means checking the user's current state (soft-deleted, revoked
 * `tokenVersion`), which is users-domain knowledge.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: jwtFromRequestExtractor,
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.usersService.findById(payload.sub, ['roles']);
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }

    if (payload.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return {
      userId: user.id,
      email: user.email,
      roles: user.roles.map((role) => role.name),
    };
  }
}
