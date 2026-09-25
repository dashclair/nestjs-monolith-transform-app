import { createHash } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ms, { type StringValue } from 'ms';
import { IsNull, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';

import { RefreshSession } from '../entities/refresh-session.entity';

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class RefreshSessionService {
  private readonly logger = new Logger(RefreshSessionService.name);

  constructor(
    @InjectRepository(RefreshSession)
    private readonly sessions: Repository<RefreshSession>,
    private readonly configService: ConfigService,
  ) {}

  async create(
    userId: string,
    jti: string,
    token: string,
    meta: SessionMeta = {},
  ): Promise<RefreshSession> {
    const ttl = this.configService.get('JWT_REFRESH_TTL') as StringValue;

    return this.sessions.save(
      this.sessions.create({
        id: jti,
        userId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + ms(ttl)),
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      }),
    );
  }

  /**
   * Swaps the session `oldJti` for a new one. Presenting a session that was
   * already rotated means someone replayed an old refresh token, so every
   * session of that user is revoked.
   */
  async rotate(
    oldJti: string,
    oldToken: string,
    newJti: string,
    newToken: string,
    meta: SessionMeta = {},
  ): Promise<void> {
    const session = await this.sessions.findOneBy({ id: oldJti });

    if (!session || session.tokenHash !== this.hash(oldToken)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      if (session.replacedById) {
        this.logger.warn({
          event: 'auth.refresh.reuse_detected',
          userId: session.userId,
          sessionId: session.id,
        });
        await this.revokeAllForUser(session.userId);
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.replace(session, newJti, newToken, meta);
  }

  async revoke(jti: string): Promise<void> {
    await this.sessions.update(
      { id: jti, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  // Own transaction so a lost race rolls back the new session, while the
  // revocation in `rotate()` above stays committed even though it throws.
  @Transactional()
  private async replace(
    old: RefreshSession,
    newJti: string,
    newToken: string,
    meta: SessionMeta,
  ): Promise<void> {
    await this.create(old.userId, newJti, newToken, meta);

    // `revokedAt IS NULL` makes this atomic: of two concurrent refreshes
    // with the same token, only one updates the row.
    const { affected } = await this.sessions.update(
      { id: old.id, revokedAt: IsNull() },
      { revokedAt: new Date(), replacedById: newJti },
    );
    if (!affected) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
