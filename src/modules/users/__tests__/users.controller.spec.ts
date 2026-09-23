import { Test, TestingModule } from '@nestjs/testing';

import {
  PermissionsGuard,
  SelfOrPermissionAccess,
  SelfOrPermissionGuard,
} from '@/modules/rbac';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';

import { UserProfileDto } from '../dto/user-profile.dto';
import { ListUsersQueryDto, ListUsersResponseDto } from '../dto/list-users.dto';
import { UsersController } from '../users.controller';
import { UsersService } from '../services/users.service';
import { UsersListService } from '../services/users-list.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersServiceMock = {
    getUserProfile: vi.fn<UsersService['getUserProfile']>(),
    updateUser: vi.fn<UsersService['updateUser']>(),
    initiateEmailChange: vi.fn<UsersService['initiateEmailChange']>(),
    confirmEmailChange: vi.fn<UsersService['confirmEmailChange']>(),
  };
  const usersListServiceMock = {
    getUsersList: vi.fn<UsersListService['getUsersList']>(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersServiceMock },
        { provide: UsersListService, useValue: usersListServiceMock },
      ],
    })
      // `@UseGuards(SelfOrPermissionGuard)` on the controller makes Nest
      // resolve the guard's own dependencies (RbacConfigService) while
      // compiling the testing module. Guard behavior itself is already
      // covered by `self-or-permission.guard.spec.ts` — here we only want to
      // verify the controller delegates correctly, so the guard is stubbed.
      .overrideGuard(SelfOrPermissionGuard)
      .useValue({ canActivate: () => true })
      // Same reason for the class-level `PermissionsGuard` (added for
      // `GET /users`) — covered by its own spec and the rbac e2e suite.
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getUsersList', () => {
    it('delegates to UsersListService.getUsersList with the validated query and the actor id', async () => {
      const query = Object.assign(new ListUsersQueryDto(), { q: 'ivan' });
      const serviceResult: ListUsersResponseDto = { items: [], nextCursor: null };
      usersListServiceMock.getUsersList.mockResolvedValue(serviceResult);
      const request = { user: { userId: 'admin-1' } } as Parameters<
        UsersController['getUsersList']
      >[1];

      const result = await controller.getUsersList(query, request);

      expect(usersListServiceMock.getUsersList).toHaveBeenCalledWith(query, 'admin-1');
      expect(result).toBe(serviceResult);
    });
  });

  describe('getUser', () => {
    it('delegates to UsersService.getUserProfile with the param and the guard-resolved access context', async () => {
      const access: SelfOrPermissionAccess = {
        type: 'self',
        actorUserId: 'user-1',
        resource: 'users',
        action: 'read',
      };
      const profile = {
        id: 'user-1',
        email: 'user@example.com',
      } as UserProfileDto;
      usersServiceMock.getUserProfile.mockResolvedValue(profile);

      const result = await controller.getUser('user-1', access);

      expect(usersServiceMock.getUserProfile).toHaveBeenCalledWith(
        'user-1',
        access,
      );
      expect(result).toBe(profile);
    });

    it('propagates a permission-based access context untouched', async () => {
      const access: SelfOrPermissionAccess = {
        type: 'permission',
        actorUserId: 'admin-1',
        resource: 'users',
        action: 'read',
      };
      usersServiceMock.getUserProfile.mockResolvedValue({} as UserProfileDto);

      await controller.getUser('user-2', access);

      expect(usersServiceMock.getUserProfile).toHaveBeenCalledWith(
        'user-2',
        access,
      );
    });
  });

  describe('updateUser', () => {
    it('delegates to UsersService.updateUser with the param, body and access context', async () => {
      const access: SelfOrPermissionAccess = {
        type: 'self',
        actorUserId: 'user-1',
        resource: 'users',
        action: 'update',
      };
      const profile = { id: 'user-1', photo: 'x' } as UserProfileDto;
      usersServiceMock.updateUser.mockResolvedValue(profile);

      const result = await controller.updateUser(
        'user-1',
        { photo: 'x' },
        access,
      );

      expect(usersServiceMock.updateUser).toHaveBeenCalledWith(
        'user-1',
        { photo: 'x' },
        access,
      );
      expect(result).toBe(profile);
    });
  });

  describe('initiateEmailChange', () => {
    it('delegates to UsersService.initiateEmailChange with the param and newEmail', async () => {
      const serviceResult = {
        requiresConfirmation: true as const,
        method: EmailVerificationMethod.OTP,
      };
      usersServiceMock.initiateEmailChange.mockResolvedValue(serviceResult);

      const result = await controller.initiateEmailChange('user-1', {
        newEmail: 'new@example.com',
      });

      expect(usersServiceMock.initiateEmailChange).toHaveBeenCalledWith(
        'user-1',
        'new@example.com',
      );
      expect(result).toBe(serviceResult);
    });
  });

  describe('confirmEmailChange', () => {
    it('delegates to UsersService.confirmEmailChange with the param and code', async () => {
      const serviceResult = { email: 'new@example.com' };
      usersServiceMock.confirmEmailChange.mockResolvedValue(serviceResult);

      const result = await controller.confirmEmailChange('user-1', {
        code: '123456',
      });

      expect(usersServiceMock.confirmEmailChange).toHaveBeenCalledWith(
        'user-1',
        '123456',
      );
      expect(result).toBe(serviceResult);
    });
  });

  describe('confirmEmailChangeLink', () => {
    it('delegates to UsersService.confirmEmailChange with the param and token', async () => {
      const serviceResult = { email: 'new@example.com' };
      usersServiceMock.confirmEmailChange.mockResolvedValue(serviceResult);

      const result = await controller.confirmEmailChangeLink('user-1', {
        token: 'magic-link-token',
      });

      expect(usersServiceMock.confirmEmailChange).toHaveBeenCalledWith(
        'user-1',
        'magic-link-token',
      );
      expect(result).toBe(serviceResult);
    });
  });
});
