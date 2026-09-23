import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { RequestUser } from '@/core/auth/auth.types';

import { PermissionsGuard } from '../access/permissions.guard';
import { RbacConfigService } from '../services/rbac-config.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;

  const reflectorMock = {
    getAllAndOverride: vi.fn(),
  };
  const rbacConfigServiceMock = {
    hasPermission: vi.fn(),
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
    expect(rbacConfigServiceMock.hasPermission).not.toHaveBeenCalled();
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

  it('allows the request when RbacConfigService.hasPermission grants it', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'rbac',
      action: 'read',
    });
    rbacConfigServiceMock.hasPermission.mockReturnValue(true);

    const result = guard.canActivate(
      buildContext({ userId: 'user-1', email: 'u@test.com', roles: ['admin'] }),
    );

    expect(result).toBe(true);
    expect(rbacConfigServiceMock.hasPermission).toHaveBeenCalledWith(
      ['admin'],
      'rbac',
      'read',
    );
  });

  it('throws ForbiddenException when RbacConfigService.hasPermission denies it', () => {
    reflectorMock.getAllAndOverride.mockReturnValue({
      resource: 'articles',
      action: 'delete',
    });
    rbacConfigServiceMock.hasPermission.mockReturnValue(false);

    expect(() =>
      guard.canActivate(
        buildContext({
          userId: 'user-1',
          email: 'u@test.com',
          roles: ['editor'],
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
