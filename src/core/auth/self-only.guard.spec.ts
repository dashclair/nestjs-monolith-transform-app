import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { RequestUser } from '@/core/auth/auth.types';

import { SelfOnlyGuard } from './self-only.guard';

describe('SelfOnlyGuard', () => {
  let guard: SelfOnlyGuard;

  const reflectorMock = {
    getAllAndOverride: vi.fn(),
  };

  const buildContext = (
    user: RequestUser | undefined,
    params: Record<string, string> = {},
  ): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user, params }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SelfOnlyGuard, { provide: Reflector, useValue: reflectorMock }],
    }).compile();

    guard = module.get(SelfOnlyGuard);
  });

  it('allows the request through when the route has no @SelfOnly metadata', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(buildContext(undefined));

    expect(result).toBe(true);
  });

  it('allows a user to act on their own resource', () => {
    reflectorMock.getAllAndOverride.mockReturnValue('userId');

    const result = guard.canActivate(
      buildContext(
        { userId: 'user-1', email: 'u@test.com', roles: [] },
        { userId: 'user-1' },
      ),
    );

    expect(result).toBe(true);
  });

  it('throws ForbiddenException when acting on a different user’s resource', () => {
    reflectorMock.getAllAndOverride.mockReturnValue('userId');

    expect(() =>
      guard.canActivate(
        buildContext(
          { userId: 'user-1', email: 'u@test.com', roles: [] },
          { userId: 'user-2' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException even for an admin acting on someone else’s resource', () => {
    reflectorMock.getAllAndOverride.mockReturnValue('userId');

    expect(() =>
      guard.canActivate(
        buildContext(
          { userId: 'admin-1', email: 'admin@test.com', roles: ['admin'] },
          { userId: 'user-2' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });
});
