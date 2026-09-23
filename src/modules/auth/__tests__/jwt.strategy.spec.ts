import { UnauthorizedException } from '@nestjs/common';

import { JwtPayload } from '@/core/auth/auth.types';
import { ConfigService } from '@/core/config/config.service';
import { UsersService } from '@/modules/users/services/users.service';
import { User } from '@/modules/users/entities/user.entity';

import { JwtStrategy } from '../strategies/jwt.strategy';

describe('JwtStrategy.validate', () => {
  const usersServiceMock = {
    findById: vi.fn<UsersService['findById']>(),
  };
  const configServiceMock = {
    get: vi.fn<ConfigService['get']>(() => 'test-secret'),
  };
  let strategy: JwtStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new JwtStrategy(
      configServiceMock as unknown as ConfigService,
      usersServiceMock as unknown as UsersService,
    );
  });

  function buildPayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
    return {
      sub: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      tokenVersion: 0,
      type: 'access',
      jti: 'jti-1',
      ...overrides,
    };
  }

  it('rejects a refresh token used where an access token is expected', async () => {
    await expect(
      strategy.validate(buildPayload({ type: 'refresh' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(usersServiceMock.findById).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists', async () => {
    usersServiceMock.findById.mockResolvedValue(null);

    await expect(strategy.validate(buildPayload())).rejects.toThrow(
      'User not found',
    );
  });

  it('rejects when the tokenVersion in the payload is stale (revoked)', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      tokenVersion: 1,
    } as User);

    await expect(
      strategy.validate(buildPayload({ tokenVersion: 0 })),
    ).rejects.toThrow('Token has been revoked');
  });

  it('rejects a soft-deleted user even when tokenVersion still matches (regression: tokenVersion alone is not enough)', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      tokenVersion: 0,
      deletedAt: new Date('2026-09-20T00:00:00.000Z'),
    } as User);

    await expect(
      strategy.validate(buildPayload({ tokenVersion: 0 })),
    ).rejects.toThrow('User not found');
  });

  it('returns the RequestUser shape for a valid, current access token', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'user-1',
      tokenVersion: 0,
    } as User);

    const result = await strategy.validate(
      buildPayload({ roles: ['user', 'admin'] }),
    );

    expect(result).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      roles: ['user', 'admin'],
    });
  });
});
