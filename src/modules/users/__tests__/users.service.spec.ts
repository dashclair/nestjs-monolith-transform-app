import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { FindOneOptions, Repository } from 'typeorm';

import { SelfOrPermissionAccess } from '@/core/self-or-permission/self-or-permission.types';
import { Role } from '@/modules/rbac/entities/role.entity';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';
import { EmailVerificationPurpose } from '@/core/email-verification/email-verification-purpose.enum';
import { EmailVerificationService } from '@/core/email-verification/email-verification.service';

import { User } from '../entities/user.entity';
import { UserProfileFieldsPolicy } from '../services/user-profile-policy.service';
import { UserUpdateFieldsPolicy } from '../services/user-update-fields-policy.service';
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
    findOneBy: vi.fn<Repository<User>['findOneBy']>(),
    merge: vi.fn<Repository<User>['merge']>(),
    save: vi.fn<Repository<User>['save']>(),
  };
  const rolesRepoMock = {
    findOneBy: vi.fn<Repository<Role>['findOneBy']>(),
  };
  const emailVerificationServiceMock = {
    issueAndSend: vi.fn<EmailVerificationService['issueAndSend']>(),
    confirm: vi.fn<EmailVerificationService['confirm']>(),
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
    usersRepoMock.merge.mockImplementation((entity: User, dto: Partial<User>) =>
      Object.assign(entity, dto),
    );
    usersRepoMock.save.mockImplementation((entity: User) =>
      Promise.resolve(entity),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        UserProfileFieldsPolicy,
        UserUpdateFieldsPolicy,
        { provide: getRepositoryToken(User), useValue: usersRepoMock },
        { provide: getRepositoryToken(Role), useValue: rolesRepoMock },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
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

  describe('updateUser', () => {
    const selfUpdateAccess = (userId: string): SelfOrPermissionAccess => ({
      type: 'self',
      actorUserId: userId,
      resource: 'users',
      action: 'update',
    });

    const adminUpdateAccess = (actorUserId: string): SelfOrPermissionAccess => ({
      type: 'permission',
      actorUserId,
      resource: 'users',
      action: 'update',
    });

    it('rejects self passing email with a specific 403 hinting at /email-change, before touching the database', async () => {
      await expect(
        service.updateUser(
          'user-1',
          { email: 'new@example.com' },
          selfUpdateAccess('user-1'),
        ),
      ).rejects.toThrow(
        new ForbiddenException(
          'Cannot change email via this endpoint — use /email-change',
        ),
      );

      expect(usersRepoMock.findOneBy).not.toHaveBeenCalled();
    });

    it('lets self update photo without touching email', async () => {
      const user = buildUser();
      usersRepoMock.findOneBy.mockResolvedValue(user);

      const result = await service.updateUser(
        'user-1',
        { photo: 'https://example.com/new.jpg' },
        selfUpdateAccess('user-1'),
      );

      expect(result.photo).toBe('https://example.com/new.jpg');
      expect(result.email).toBe('user@example.com');
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      usersRepoMock.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateUser(
          'missing-id',
          { photo: 'https://example.com/new.jpg' },
          selfUpdateAccess('missing-id'),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets an admin (via grant, not self) change email directly, without a confirmation flow', async () => {
      const user = buildUser();
      usersRepoMock.findOneBy.mockResolvedValue(user);
      usersRepoMock.findOne.mockResolvedValue(null); // no other user has that email

      const result = await service.updateUser(
        'user-1',
        { email: 'new@example.com' },
        adminUpdateAccess('admin-1'),
      );

      expect(result.email).toBe('new@example.com');
      expect(emailVerificationServiceMock.issueAndSend).not.toHaveBeenCalled();
    });

    it('rejects an admin email change with 409 when the email is already taken by someone else', async () => {
      const user = buildUser();
      usersRepoMock.findOneBy.mockResolvedValue(user);
      usersRepoMock.findOne.mockResolvedValue(buildUser({ id: 'other-user' }));

      await expect(
        service.updateUser(
          'user-1',
          { email: 'taken@example.com' },
          adminUpdateAccess('admin-1'),
        ),
      ).rejects.toThrow(ConflictException);

      expect(usersRepoMock.save).not.toHaveBeenCalled();
    });

    it('does not treat the user’s own current email as a conflict', async () => {
      const user = buildUser();
      usersRepoMock.findOneBy.mockResolvedValue(user);
      usersRepoMock.findOne.mockResolvedValue(user); // findByEmail resolves to the same user

      const result = await service.updateUser(
        'user-1',
        { email: user.email },
        adminUpdateAccess('admin-1'),
      );

      expect(result.email).toBe(user.email);
    });

    it('does not clobber untouched fields on a partial patch (regression, T-013-style bug)', async () => {
      const user = buildUser({ photo: 'https://example.com/old.jpg' });
      usersRepoMock.findOneBy.mockResolvedValue(user);

      const result = await service.updateUser(
        'user-1',
        { photo: 'https://example.com/new.jpg' },
        selfUpdateAccess('user-1'),
      );

      expect(result.email).toBe('user@example.com');
      expect(result.isEmailVerified).toBe(true);
    });

    it('logs users.profile.updated with only field names, not values', async () => {
      const user = buildUser();
      usersRepoMock.findOneBy.mockResolvedValue(user);
      const logSpy = vi.spyOn(Logger.prototype, 'log');

      await service.updateUser(
        'user-1',
        { photo: 'https://example.com/new.jpg' },
        selfUpdateAccess('user-1'),
      );

      expect(logSpy).toHaveBeenCalledWith({
        event: 'users.profile.updated',
        actorUserId: 'user-1',
        targetUserId: 'user-1',
        fields: ['photo'],
        result: 200,
      });
    });
  });

  describe('initiateEmailChange', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      usersRepoMock.findOne.mockResolvedValue(null);

      await expect(
        service.initiateEmailChange('missing-id', 'new@example.com'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with 400 when newEmail matches the current email', async () => {
      usersRepoMock.findOne.mockResolvedValue(buildUser());

      await expect(
        service.initiateEmailChange('user-1', 'user@example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with 409 when newEmail is already registered, without setting pendingEmail', async () => {
      const user = buildUser();
      usersRepoMock.findOne.mockImplementation(
        ({ where }: FindOneOptions<User>) =>
          Promise.resolve(
            'id' in (where as object) ? user : buildUser({ id: 'other-user' }),
          ),
      );

      await expect(
        service.initiateEmailChange('user-1', 'taken@example.com'),
      ).rejects.toThrow(ConflictException);

      expect(usersRepoMock.save).not.toHaveBeenCalled();
    });

    it('sets pendingEmail, issues a code for EMAIL_CHANGE and sends it to the new address', async () => {
      const user = buildUser();
      usersRepoMock.findOne.mockImplementation(({ where }: FindOneOptions<User>) =>
        Promise.resolve('id' in (where as object) ? user : null),
      );
      emailVerificationServiceMock.issueAndSend.mockResolvedValue({
        method: EmailVerificationMethod.OTP,
      });

      const result = await service.initiateEmailChange(
        'user-1',
        'new@example.com',
      );

      expect(result).toEqual({
        requiresConfirmation: true,
        method: EmailVerificationMethod.OTP,
      });
      expect(user.pendingEmail).toBe('new@example.com');
      expect(emailVerificationServiceMock.issueAndSend).toHaveBeenCalledWith(
        'user-1',
        EmailVerificationPurpose.EMAIL_CHANGE,
        'new@example.com',
      );
    });
  });

  describe('confirmEmailChange', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      usersRepoMock.findOne.mockResolvedValue(null);

      await expect(
        service.confirmEmailChange('missing-id', '123456'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when there is no pending email change', async () => {
      usersRepoMock.findOne.mockResolvedValue(buildUser({ pendingEmail: null }));

      await expect(
        service.confirmEmailChange('user-1', '123456'),
      ).rejects.toThrow(NotFoundException);
      expect(emailVerificationServiceMock.confirm).not.toHaveBeenCalled();
    });

    it('promotes pendingEmail to email and clears pendingEmail on a valid code', async () => {
      const user = buildUser({ pendingEmail: 'new@example.com' });
      usersRepoMock.findOne.mockResolvedValue(user);
      emailVerificationServiceMock.confirm.mockResolvedValue(undefined);

      const result = await service.confirmEmailChange('user-1', '123456');

      expect(emailVerificationServiceMock.confirm).toHaveBeenCalledWith(
        'user-1',
        '123456',
        EmailVerificationPurpose.EMAIL_CHANGE,
      );
      expect(user.email).toBe('new@example.com');
      expect(user.pendingEmail).toBeNull();
      expect(result).toEqual({ email: 'new@example.com' });
    });

    it('does not change the email when the code is rejected', async () => {
      const user = buildUser({ pendingEmail: 'new@example.com' });
      usersRepoMock.findOne.mockResolvedValue(user);
      emailVerificationServiceMock.confirm.mockRejectedValue(
        new BadRequestException('Invalid confirmation code'),
      );

      await expect(
        service.confirmEmailChange('user-1', 'wrong-code'),
      ).rejects.toThrow(BadRequestException);

      expect(user.email).toBe('user@example.com');
      expect(user.pendingEmail).toBe('new@example.com');
      expect(usersRepoMock.save).not.toHaveBeenCalled();
    });
  });
});
