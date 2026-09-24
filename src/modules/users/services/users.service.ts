import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import { Repository } from 'typeorm';

import { isUniqueViolation } from '@/common/database/is-unique-violation';
import { isSameId } from '@/common/utils/is-same-id';
import { isReservedEmail } from '@/common/validation/is-reserved-email';
import { DEFAULT_ROLE_NAME } from '@/modules/rbac/rbac.constants';
import { Role } from '@/modules/rbac/entities/role.entity';

import { plainToInstance } from 'class-transformer';
import { User } from '../entities/user.entity';
import { UserProfileDto } from '../dto/user-profile.dto';
import type { SelfOrPermissionAccess } from '@/modules/rbac';
import { UserProfileFieldsPolicy } from './user-profile-policy.service';
import { UserProfileField } from '../types/user-profile-policy.types';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserUpdateFieldsPolicy } from './user-update-fields-policy.service';
import { EmailVerificationService } from '@/core/email-verification/email-verification.service';
import { EmailVerificationPurpose } from '@/core/email-verification/email-verification-purpose.enum';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,

    private readonly userProfileFieldsPolicy: UserProfileFieldsPolicy,
    private readonly userUpdateFieldsPolicy: UserUpdateFieldsPolicy,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  findByEmail(email: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { email }, relations });
  }

  findById(id: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { id }, relations });
  }

  private generateDeletedEmail(userId: string): string {
    return `deleted-${userId}@deleted.local`;
  }

  /**
   * `roles` is intentionally left alone (deletedAt already blocks access via
   * JwtStrategy; revoking roles separately buys nothing), and `id`/`createdAt`
   * are never touched (referential integrity for future Epic 2 entities).
   */
  private async anonymizeUser(user: User): Promise<void> {
    user.email = this.generateDeletedEmail(user.id);
    user.photo = null;
    user.passwordHash = '';
    user.pendingEmail = null;
    user.isEmailVerified = false;
    user.deletedAt = new Date();
    user.tokenVersion += 1;

    await this.repo.save(user);
  }

  async create(data: {
    email: string;
    passwordHash: string;
    isEmailVerified: boolean;
    roles?: Role[];
  }): Promise<User> {
    if (isReservedEmail(data.email)) {
      throw new BadRequestException('Email domain is reserved');
    }

    const roles = data.roles ?? (await this.findDefaultRole());
    return this.repo.save(this.repo.create({ ...data, roles }));
  }

  private async findDefaultRole(): Promise<Role[]> {
    const role = await this.roleRepo.findOneBy({ name: DEFAULT_ROLE_NAME });
    if (!role) {
      throw new Error(
        `Default role "${DEFAULT_ROLE_NAME}" not found — has the RBAC seed migration run?`,
      );
    }
    return [role];
  }

  save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  async getUserProfile(
    userId: string,
    access: SelfOrPermissionAccess,
  ): Promise<UserProfileDto> {
    const allowedFields = this.userProfileFieldsPolicy.getAllowedFields(access);

    const isAllowed = (field: UserProfileField) =>
      allowedFields.includes(field);

    const user = await this.repo.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: isAllowed(UserProfileField.Email),
        photo: isAllowed(UserProfileField.Photo),
        isEmailVerified: isAllowed(UserProfileField.IsEmailVerified),
        createdAt: isAllowed(UserProfileField.CreatedAt),
      },
    });

    if (!user) {
      this.logger.log({
        event: 'users.profile.viewed',
        viewerUserId: access.actorUserId,
        targetUserId: userId,
        result: 404,
      });
      throw new NotFoundException('User not found');
    }

    const profile: Partial<UserProfileDto> = {};

    if (isAllowed(UserProfileField.Id)) {
      profile.id = user.id;
    }

    if (isAllowed(UserProfileField.Email)) {
      profile.email = user.email;
    }

    if (isAllowed(UserProfileField.Photo)) {
      profile.photo = user.photo ?? null;
    }

    if (isAllowed(UserProfileField.IsEmailVerified)) {
      profile.isEmailVerified = user.isEmailVerified;
    }

    if (isAllowed(UserProfileField.CreatedAt)) {
      profile.createdAt = user.createdAt;
    }

    this.logger.log({
      event: 'users.profile.viewed',
      viewerUserId: access.actorUserId,
      targetUserId: userId,
      result: 200,
    });

    return plainToInstance(UserProfileDto, profile, {
      excludeExtraneousValues: true,
    });
  }

  @Transactional()
  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    access: SelfOrPermissionAccess,
  ) {
    const allowedFields = this.userUpdateFieldsPolicy.getAllowedFields(access);

    const requestedFields = (
      Object.keys(dto) as Array<keyof UpdateUserDto>
    ).filter((field) => dto[field] !== undefined);

    const forbiddenFields = requestedFields.filter(
      (field) => !allowedFields.includes(field),
    );

    if (forbiddenFields.includes('email')) {
      throw new ForbiddenException(
        'Cannot change email via this endpoint — use /email-change',
      );
    }

    if (forbiddenFields.length) {
      throw new ForbiddenException(
        `You are not allowed to update: ${forbiddenFields.join(', ')}`,
      );
    }

    const user = await this.repo.findOneBy({ id: userId });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    if (dto.email !== undefined) {
      if (isReservedEmail(dto.email)) {
        throw new BadRequestException('Email domain is reserved');
      }

      const existing = await this.findByEmail(dto.email);
      if (existing && !isSameId(existing.id, userId)) {
        throw new ConflictException('Email already registered');
      }
    }

    this.repo.merge(user, dto);

    const updatedUser = await this.repo.save(user);

    this.logger.log({
      event: 'users.profile.updated',
      actorUserId: access.actorUserId,
      targetUserId: userId,
      fields: requestedFields,
      result: 200,
    });

    return plainToInstance(UserProfileDto, updatedUser, {
      excludeExtraneousValues: true,
    });
  }

  @Transactional()
  async initiateEmailChange(
    userId: string,
    newEmail: string,
  ): Promise<{ requiresConfirmation: true; method: EmailVerificationMethod }> {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (isReservedEmail(newEmail)) {
      throw new BadRequestException('Email domain is reserved');
    }

    if (user.email === newEmail) {
      throw new BadRequestException('New email must be different');
    }

    const existing = await this.findByEmail(newEmail);
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    user.pendingEmail = newEmail;
    await this.repo.save(user);

    const { method } = await this.emailVerificationService.issueAndSend(
      user.id,
      EmailVerificationPurpose.EMAIL_CHANGE,
      newEmail,
    );

    this.logger.log({
      event: 'users.email_change.initiated',
      userId: user.id,
    });

    return { requiresConfirmation: true, method };
  }

  @Transactional()
  async confirmEmailChange(
    userId: string,
    code: string,
  ): Promise<{ email: string }> {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.pendingEmail) {
      throw new NotFoundException('No pending email change');
    }

    // Also reject pending addresses stored before the domain was reserved.
    if (isReservedEmail(user.pendingEmail)) {
      throw new BadRequestException('Email domain is reserved');
    }

    // The address was free at initiateEmailChange(), but someone may have
    // registered it (or an admin assigned it) since. Checked before confirm()
    // so the code isn't consumed on a request that can't succeed.
    const existing = await this.findByEmail(user.pendingEmail);
    if (existing && !isSameId(existing.id, user.id)) {
      throw new ConflictException('Email already registered');
    }

    await this.emailVerificationService.confirm(
      user.id,
      code,
      EmailVerificationPurpose.EMAIL_CHANGE,
    );

    user.email = user.pendingEmail;
    user.pendingEmail = null;
    try {
      await this.repo.save(user);
    } catch (error) {
      // Lost the race between the check above and this write.
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }

    this.logger.log({
      event: 'users.email_change.confirmed',
      userId: user.id,
    });

    return { email: user.email };
  }

  @Transactional()
  async requestDelete(
    userId: string,
    reason?: string,
  ): Promise<{ requiresConfirmation: true; method: EmailVerificationMethod }> {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new ConflictException('User already deleted');
    }

    const { method } = await this.emailVerificationService.issueAndSend(
      user.id,
      EmailVerificationPurpose.DELETE_ACCOUNT,
      user.email,
    );

    this.logger.log({
      event: 'users.delete.requested',
      userId: user.id,
      reason,
    });

    return { requiresConfirmation: true, method };
  }

  @Transactional()
  async confirmDelete(
    userId: string,
    code: string,
  ): Promise<{ deleted: true }> {
    const user = await this.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new ConflictException('User already deleted');
    }

    try {
      await this.emailVerificationService.confirm(
        user.id,
        code,
        EmailVerificationPurpose.DELETE_ACCOUNT,
      );
    } catch (error) {
      this.logger.warn({
        event: 'users.delete.failed',
        userId: user.id,
      });
      throw error;
    }

    await this.anonymizeUser(user);

    this.logger.log({
      event: 'users.delete.confirmed',
      userId: user.id,
    });

    return { deleted: true };
  }

  @Transactional()
  async deleteUserByPermission(
    targetUserId: string,
    actorUserId: string,
  ): Promise<{ deleted: true }> {
    if (isSameId(actorUserId, targetUserId)) {
      throw new ForbiddenException(
        'Use POST /users/:id/delete-request to delete your own account',
      );
    }

    const user = await this.findById(targetUserId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new ConflictException('User already deleted');
    }

    await this.anonymizeUser(user);

    this.logger.log({
      event: 'users.delete.admin_executed',
      actorUserId,
      targetUserId: user.id,
    });

    return { deleted: true };
  }

  /**
   * Recorded in its own transaction (REQUIRES_NEW) so the attempt count and
   * lockout survive even when the caller (AuthService.login()) throws right
   * after this resolves — a throw there would otherwise roll back the
   * enclosing @Transactional() call, silently discarding the increment and
   * making AUTH_LOGIN_MAX_FAILED_ATTEMPTS never actually trigger.
   */
  @Transactional({ propagation: Propagation.REQUIRES_NEW })
  async recordFailedLoginAttempt(
    user: User,
    {
      maxAttempts,
      lockoutMinutes,
    }: { maxAttempts: number; lockoutMinutes: number },
  ): Promise<boolean> {
    user.failedLoginAttempts += 1;
    const locked = user.failedLoginAttempts >= maxAttempts;
    if (locked) {
      user.lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000);
    }
    await this.repo.save(user);
    return locked;
  }
}
