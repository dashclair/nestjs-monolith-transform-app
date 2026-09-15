import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { RequestUser } from '@/core/auth/auth.types';

import { PermissionsGuard } from '../guards/permissions.guard';
import { RbacConfigService } from '../services/rbac-config.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;

  const reflectorMock = {
    getAllAndOverride: vi.fn(),
  };
  const rbacConfigServiceMock = {
    getGrantsForRole: vi.fn(),
  };

  const buildContext = (user: RequestUser | undefined): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflectorMock },
        { provide: RbacConfigService, useValue: rbacConfigServiceMock },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
  });

  it('allows the request through when the route has no @RequirePermission metadata', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);

    const result = guard.canActivate(buildContext(undefined));

    expect(result).toBe(true);
    expect(rbacConfigServiceMock.getGrantsForRole).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the route requires a permission but request.user is missing', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'rbac',
      action: 'read',
    });

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows any action when the grant has no actions restriction', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'rbac',
      action: 'delete',
    });
    rbacConfigServiceMock.getGrantsForRole.mockReturnValue([
      { permissionName: 'rbac', actions: null },
    ]);

    const result = guard.canActivate(
      buildContext({ userId: 'user-1', email: 'u@test.com', roles: ['admin'] }),
    );

    expect(result).toBe(true);
  });

  it('allows the request only when the requested action is in the grant’s actions list', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'articles',
      action: 'create',
    });
    rbacConfigServiceMock.getGrantsForRole.mockReturnValue([
      { permissionName: 'articles', actions: ['create', 'update'] },
    ]);

    const result = guard.canActivate(
      buildContext({ userId: 'user-1', email: 'u@test.com', roles: ['editor'] }),
    );

    expect(result).toBe(true);
  });

  it('throws ForbiddenException when the action is not in the grant’s actions list', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'articles',
      action: 'delete',
    });
    rbacConfigServiceMock.getGrantsForRole.mockReturnValue([
      { permissionName: 'articles', actions: ['create', 'update'] },
    ]);

    expect(() =>
      guard.canActivate(
        buildContext({ userId: 'user-1', email: 'u@test.com', roles: ['editor'] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when none of the user’s roles have a grant for the resource', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'rbac',
      action: 'read',
    });
    rbacConfigServiceMock.getGrantsForRole.mockReturnValue([
      { permissionName: 'articles', actions: null },
    ]);

    expect(() =>
      guard.canActivate(
        buildContext({ userId: 'user-1', email: 'u@test.com', roles: ['user'] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException (not a 500) when the user’s role is not present in the cached config at all', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'rbac',
      action: 'read',
    });
    rbacConfigServiceMock.getGrantsForRole.mockReturnValue([]);

    expect(() =>
      guard.canActivate(
        buildContext({
          userId: 'user-1',
          email: 'u@test.com',
          roles: ['role-not-in-cache'],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows access when at least one of several roles grants it (union, not intersection)', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'rbac',
      action: 'read',
    });
    rbacConfigServiceMock.getGrantsForRole.mockImplementation(
      (roleName: string) =>
        roleName === 'admin' ? [{ permissionName: 'rbac', actions: null }] : [],
    );

    const result = guard.canActivate(
      buildContext({
        userId: 'user-1',
        email: 'u@test.com',
        roles: ['user', 'admin'],
      }),
    );

    expect(result).toBe(true);
  });
});
