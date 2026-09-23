import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { RequestUser } from '@/core/auth/auth.types';

import { SelfOrPermissionGuard } from '../access/self-or-permission.guard';
import { RbacConfigService } from '../services/rbac-config.service';

describe('SelfOrPermissionGuard', () => {
  let guard: SelfOrPermissionGuard;

  const reflectorMock = {
    getAllAndOverride: vi.fn(),
  };
  const rbacConfigServiceMock = {
    hasPermission: vi.fn(),
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
      providers: [
        SelfOrPermissionGuard,
        { provide: Reflector, useValue: reflectorMock },
        { provide: RbacConfigService, useValue: rbacConfigServiceMock },
      ],
    }).compile();

    guard = module.get(SelfOrPermissionGuard);
  });

  it('allows the request through when the route has no @SelfOrPermission metadata', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(buildContext(undefined));

    expect(result).toBe(true);
    expect(rbacConfigServiceMock.hasPermission).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the route is guarded but request.user is missing', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      paramName: 'id',
      resource: 'users',
      action: 'read',
    });

    expect(() =>
      guard.canActivate(buildContext(undefined, { id: 'user-1' })),
    ).toThrow(UnauthorizedException);
  });

  it('allows a user to access their own resource regardless of roles/grants', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      paramName: 'id',
      resource: 'users',
      action: 'read',
    });

    const result = guard.canActivate(
      buildContext(
        { userId: 'user-1', email: 'u@test.com', roles: [] },
        { id: 'user-1' },
      ),
    );

    expect(result).toBe(true);
    expect(rbacConfigServiceMock.hasPermission).not.toHaveBeenCalled();
  });

  it('allows access to another user’s resource when RbacConfigService.hasPermission grants it', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      paramName: 'id',
      resource: 'users',
      action: 'read',
    });
    rbacConfigServiceMock.hasPermission.mockReturnValue(true);

    const result = guard.canActivate(
      buildContext(
        { userId: 'user-1', email: 'u@test.com', roles: ['admin'] },
        { id: 'user-2' },
      ),
    );

    expect(result).toBe(true);
    expect(rbacConfigServiceMock.hasPermission).toHaveBeenCalledWith(
      ['admin'],
      'users',
      'read',
    );
  });

  it('throws ForbiddenException when accessing another user’s resource without a grant', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      paramName: 'id',
      resource: 'users',
      action: 'delete',
    });
    rbacConfigServiceMock.hasPermission.mockReturnValue(false);

    expect(() =>
      guard.canActivate(
        buildContext(
          { userId: 'user-1', email: 'u@test.com', roles: ['user'] },
          { id: 'user-2' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });
});
