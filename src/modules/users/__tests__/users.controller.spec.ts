import { Test, TestingModule } from '@nestjs/testing';

import { SelfOrPermissionGuard } from '@/core/self-or-permission/self-or-permission.guard';
import { SelfOrPermissionAccess } from '@/core/self-or-permission/self-or-permission.types';

import { UserProfileDto } from '../dto/user-profile.dto';
import { UsersController } from '../users.controller';
import { UsersService } from '../services/users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersServiceMock = {
    getUserProfile: vi.fn<UsersService['getUserProfile']>(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersServiceMock }],
    })
      // `@UseGuards(SelfOrPermissionGuard)` on the controller makes Nest
      // resolve the guard's own dependencies (RbacConfigService) while
      // compiling the testing module. Guard behavior itself is already
      // covered by `self-or-permission.guard.spec.ts` — here we only want to
      // verify the controller delegates correctly, so the guard is stubbed.
      .overrideGuard(SelfOrPermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
});
