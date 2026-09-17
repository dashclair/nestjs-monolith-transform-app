import { Logger, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { SelfOrPermissionAccess } from '@/core/self-or-permission/self-or-permission.types';
import { Role } from '@/modules/rbac/entities/role.entity';

import { User } from '../entities/user.entity';
import { UserProfileFieldsPolicy } from '../services/user-profile-policy.service';
import { UsersService } from '../services/users.service';

// `recordFailedLoginAttempt` is decorated with `@Transactional()`, which needs
// `initializeTransactionalContext()` to have run first (only happens in
// `main.ts`'s `bootstrap()`, never in a unit test). Replacing the decorator
// with a no-op keeps these tests focused on `getUserProfile`. See
// `auth.service.spec.ts` for the same pattern.
vi.mock('typeorm-transactional', () => ({
  Transactional:
    () =>
    (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
      descriptor,
  Propagation: { REQUIRES_NEW: 'REQUIRES_NEW' },
}));

describe('UsersService', () => {
  let service: UsersService;

  const usersRepoMock = {
    findOne: vi.fn<Repository<User>['findOne']>(),
  };
  const rolesRepoMock = {
    findOneBy: vi.fn<Repository<Role>['findOneBy']>(),
  };

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'user@example.com',
      photo: 'https://example.com/photo.jpg',
      passwordHash: 'hashed-password',
      isEmailVerified: true,
      createdAt: new Date('2026-09-09T10:00:00.000Z'),
      updatedAt: new Date('2026-09-09T10:00:00.000Z'),
      failedLoginAttempts: 3,
      lockedUntil: new Date('2026-09-10T10:00:00.000Z'),
      tokenVersion: 7,
      roles: [],
      ...overrides,
    }) as User;

  const selfAccess = (userId: string): SelfOrPermissionAccess => ({
    type: 'self',
    actorUserId: userId,
    resource: 'users',
    action: 'read',
  });

  const grantAccess = (actorUserId: string): SelfOrPermissionAccess => ({
    type: 'permission',
    actorUserId,
    resource: 'users',
    action: 'read',
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        UserProfileFieldsPolicy,
        { provide: getRepositoryToken(User), useValue: usersRepoMock },
        { provide: getRepositoryToken(Role), useValue: rolesRepoMock },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('getUserProfile', () => {
    it('returns the full profile (including isEmailVerified) when viewing your own profile', async () => {
      const user = buildUser();
      usersRepoMock.findOne.mockResolvedValue(user);

      const result = await service.getUserProfile(
        'user-1',
        selfAccess('user-1'),
      );

      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.com',
        photo: 'https://example.com/photo.jpg',
        isEmailVerified: true,
        createdAt: user.createdAt,
      });
    });

    it('never leaks passwordHash/tokenVersion/failedLoginAttempts/lockedUntil/roles, even though they exist on the entity', async () => {
      usersRepoMock.findOne.mockResolvedValue(buildUser());

      const result = await service.getUserProfile(
        'user-1',
        selfAccess('user-1'),
      );

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('tokenVersion');
      expect(result).not.toHaveProperty('failedLoginAttempts');
      expect(result).not.toHaveProperty('lockedUntil');
      expect(result).not.toHaveProperty('roles');
    });

    it('selects only the fields the self policy allows', async () => {
      usersRepoMock.findOne.mockResolvedValue(buildUser());

      await service.getUserProfile('user-1', selfAccess('user-1'));

      expect(usersRepoMock.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          email: true,
          photo: true,
          isEmailVerified: true,
          createdAt: true,
        },
      });
    });

    it('omits isEmailVerified for a users:read grant on someone else’s profile', async () => {
      usersRepoMock.findOne.mockResolvedValue(buildUser({ id: 'user-2' }));

      const result = await service.getUserProfile(
        'user-2',
        grantAccess('admin-1'),
      );

      expect(result.isEmailVerified).toBeUndefined();
      expect(usersRepoMock.findOne).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        select: {
          id: true,
          email: true,
          photo: true,
          isEmailVerified: false,
          createdAt: true,
        },
      });
    });

    it('defaults photo to null when the entity has none', async () => {
      usersRepoMock.findOne.mockResolvedValue(buildUser({ photo: null }));

      const result = await service.getUserProfile(
        'user-1',
        selfAccess('user-1'),
      );

      expect(result.photo).toBeNull();
    });

    it('throws NotFoundException and logs a 404 result when the user does not exist', async () => {
      usersRepoMock.findOne.mockResolvedValue(null);
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      await expect(
        service.getUserProfile('missing-id', selfAccess('missing-id')),
      ).rejects.toThrow(NotFoundException);

      expect(logSpy).toHaveBeenCalledWith({
        event: 'users.profile.viewed',
        viewerUserId: 'missing-id',
        targetUserId: 'missing-id',
        result: 404,
      });
    });

    it('logs the same event shape on success for both self and foreign views', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log');
      usersRepoMock.findOne.mockResolvedValue(buildUser());

      await service.getUserProfile('user-1', selfAccess('user-1'));

      expect(logSpy).toHaveBeenCalledWith({
        event: 'users.profile.viewed',
        viewerUserId: 'user-1',
        targetUserId: 'user-1',
        result: 200,
      });

      logSpy.mockClear();
      usersRepoMock.findOne.mockResolvedValue(buildUser({ id: 'user-2' }));

      await service.getUserProfile('user-2', grantAccess('admin-1'));

      expect(logSpy).toHaveBeenCalledWith({
        event: 'users.profile.viewed',
        viewerUserId: 'admin-1',
        targetUserId: 'user-2',
        result: 200,
      });
    });
  });
});
