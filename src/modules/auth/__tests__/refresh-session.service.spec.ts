import { createHash } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';

import { RefreshSession } from '../entities/refresh-session.entity';
import { RefreshSessionService } from '../services/refresh-session.service';

// See auth.service.spec.ts: @Transactional() needs a CLS context that only
// main.ts sets up, so it's replaced with a no-op here.
vi.mock('typeorm-transactional', () => ({
  Transactional:
    () =>
    (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('RefreshSessionService', () => {
  let service: RefreshSessionService;

  const repoMock = {
    create: vi.fn((data: Partial<RefreshSession>) => data as RefreshSession),
    save: vi.fn((entity: RefreshSession) => Promise.resolve(entity)),
    findOneBy: vi.fn(),
    update: vi.fn(),
  };
  const configServiceMock = {
    get: vi.fn((key: string) => (key === 'JWT_REFRESH_TTL' ? '30d' : '')),
  };

  const buildSession = (
    overrides: Partial<RefreshSession> = {},
  ): RefreshSession =>
    ({
      id: 'old-jti',
      userId: 'user-1',
      tokenHash: sha256('old-token'),
      revokedAt: null,
      replacedById: null,
      ...overrides,
    }) as RefreshSession;

  beforeEach(async () => {
    vi.clearAllMocks();
    repoMock.update.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshSessionService,
        { provide: getRepositoryToken(RefreshSession), useValue: repoMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get(RefreshSessionService);
  });

  describe('create', () => {
    it('stores the jti as id and only a SHA-256 hash of the token', async () => {
      await service.create('user-1', 'jti-1', 'raw-token', {
        userAgent: 'test-agent',
        ip: '127.0.0.1',
      });

      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'jti-1',
          userId: 'user-1',
          tokenHash: sha256('raw-token'),
          userAgent: 'test-agent',
          ip: '127.0.0.1',
          expiresAt: expect.any(Date) as Date,
        }),
      );
    });
  });

  describe('rotate', () => {
    it('creates the new session and marks the old one as revoked and replaced', async () => {
      repoMock.findOneBy.mockResolvedValue(buildSession());

      await service.rotate('old-jti', 'old-token', 'new-jti', 'new-token');

      expect(repoMock.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'new-jti', userId: 'user-1' }),
      );
      expect(repoMock.update).toHaveBeenCalledWith(
        { id: 'old-jti', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) as Date, replacedById: 'new-jti' },
      );
    });

    it('rejects an unknown session', async () => {
      repoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.rotate('old-jti', 'old-token', 'new-jti', 'new-token'),
      ).rejects.toThrow(UnauthorizedException);
      expect(repoMock.save).not.toHaveBeenCalled();
    });

    it('rejects a token whose hash does not match the stored one', async () => {
      repoMock.findOneBy.mockResolvedValue(buildSession());

      await expect(
        service.rotate('old-jti', 'other-token', 'new-jti', 'new-token'),
      ).rejects.toThrow(UnauthorizedException);
      expect(repoMock.save).not.toHaveBeenCalled();
    });

    it('revokes every session of the user when an already-rotated token is reused', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildSession({ revokedAt: new Date(), replacedById: 'next-jti' }),
      );

      await expect(
        service.rotate('old-jti', 'old-token', 'new-jti', 'new-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(repoMock.update).toHaveBeenCalledWith(
        { userId: 'user-1', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) as Date },
      );
      expect(repoMock.save).not.toHaveBeenCalled();
    });

    it('rejects a logged-out session without revoking the other sessions', async () => {
      repoMock.findOneBy.mockResolvedValue(
        buildSession({ revokedAt: new Date(), replacedById: null }),
      );

      await expect(
        service.rotate('old-jti', 'old-token', 'new-jti', 'new-token'),
      ).rejects.toThrow(UnauthorizedException);

      expect(repoMock.update).not.toHaveBeenCalled();
    });

    it('rejects when a concurrent refresh already rotated the session', async () => {
      repoMock.findOneBy.mockResolvedValue(buildSession());
      repoMock.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.rotate('old-jti', 'old-token', 'new-jti', 'new-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revoke', () => {
    it('revokes only the given session, if still active', async () => {
      await service.revoke('jti-1');

      expect(repoMock.update).toHaveBeenCalledWith(
        { id: 'jti-1', revokedAt: IsNull() },
        { revokedAt: expect.any(Date) as Date },
      );
    });
  });
});
