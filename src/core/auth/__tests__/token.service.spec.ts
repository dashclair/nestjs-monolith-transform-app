import { randomUUID } from 'node:crypto';

import { UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { TokenSubject } from '@/core/auth/auth.types';
import { ConfigService } from '@/core/config/config.service';

import { TokenService } from '../services/token.service';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;

  const configValues: Record<string, string> = {
    JWT_SECRET: 'test-secret',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
  };
  const configServiceMock = {
    get: vi.fn((key: string) => configValues[key]),
  };

  const buildUser = (overrides: Partial<TokenSubject> = {}): TokenSubject => ({
    id: 'user-id',
    email: 'user@example.com',
    roles: [{ name: 'user' }],
    tokenVersion: 0,
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    configServiceMock.get.mockImplementation(
      (key: string) => configValues[key],
    );

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: configValues.JWT_SECRET })],
      providers: [
        TokenService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get(TokenService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('issueTokens', () => {
    it('signs an access token and a refresh token with distinct type claims', async () => {
      const user = buildUser();

      const { accessToken, refreshToken } = await service.issueTokens(
        user,
        randomUUID(),
      );

      expect(jwtService.decode(accessToken)).toMatchObject({
        sub: user.id,
        email: user.email,
        roles: user.roles.map((r) => r.name),
        tokenVersion: user.tokenVersion,
        type: 'access',
      });
      expect(jwtService.decode(refreshToken)).toMatchObject({
        sub: user.id,
        type: 'refresh',
      });
    });

    it('uses the given jti for the refresh token, so it matches the stored session id', async () => {
      const { refreshToken } = await service.issueTokens(
        buildUser(),
        'session-id',
      );

      expect(jwtService.decode<{ jti: string }>(refreshToken).jti).toBe(
        'session-id',
      );
    });

    it('gives the access and refresh token distinct jti claims', async () => {
      const { accessToken, refreshToken } = await service.issueTokens(
        buildUser(),
        randomUUID(),
      );

      const accessJti = jwtService.decode<{ jti: string }>(accessToken).jti;
      const refreshJti = jwtService.decode<{ jti: string }>(refreshToken).jti;

      expect(accessJti).toEqual(expect.any(String));
      expect(refreshJti).toEqual(expect.any(String));
      expect(accessJti).not.toBe(refreshJti);
    });

    it('gives every call a fresh jti, even for tokens issued in the same tick', async () => {
      const user = buildUser();

      const [first, second] = await Promise.all([
        service.issueTokens(user, randomUUID()),
        service.issueTokens(user, randomUUID()),
      ]);

      expect(first.accessToken).not.toBe(second.accessToken);
      expect(first.refreshToken).not.toBe(second.refreshToken);
    });
  });

  describe('verifyRefreshToken', () => {
    it('returns the payload for a valid refresh token', async () => {
      const user = buildUser({ tokenVersion: 3 });
      const { refreshToken } = await service.issueTokens(user, randomUUID());

      const payload = await service.verifyRefreshToken(refreshToken);

      expect(payload).toMatchObject({
        sub: user.id,
        tokenVersion: 3,
        type: 'refresh',
      });
    });

    it('rejects an access token presented as a refresh token', async () => {
      const { accessToken } = await service.issueTokens(
        buildUser(),
        randomUUID(),
      );

      await expect(service.verifyRefreshToken(accessToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with a different secret', async () => {
      const rogueJwtService = new JwtService({ secret: 'wrong-secret' });
      const forged = await rogueJwtService.signAsync({
        sub: 'user-id',
        email: 'user@example.com',
        roles: ['user'],
        tokenVersion: 0,
        type: 'refresh',
      });

      await expect(service.verifyRefreshToken(forged)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired refresh token', async () => {
      const { refreshToken } = await service.issueTokens(
        buildUser(),
        randomUUID(),
      );

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000); // past the 7d JWT_REFRESH_TTL

      await expect(service.verifyRefreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
