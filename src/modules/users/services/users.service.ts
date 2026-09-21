import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import { Repository } from 'typeorm';

import { DEFAULT_ROLE_NAME } from '@/modules/rbac/rbac.constants';
import { Role } from '@/modules/rbac/entities/role.entity';

import { plainToInstance } from 'class-transformer';
import { User } from '../entities/user.entity';
import { UserProfileDto } from '../dto/user-profile.dto';
import type { SelfOrPermissionAccess } from '@/core/self-or-permission/self-or-permission.types';
import { UserProfileFieldsPolicy } from './user-profile-policy.service';
import { UserProfileField } from '../types/user-profile-policy.types';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserUpdateFieldsPolicy } from './user-update-fields-policy.service';
import { EmailVerificationService } from '@/core/email-verification/email-verification.service';
import { EmailVerificationPurpose } from '@/core/email-verification/email-verification-purpose.enum';
import { EmailVerificationMethod } from '@/core/email-verification/email-verification-method.enum';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,

    private readonly userProfileFieldsPolicy: UserProfileFieldsPolicy,
    private readonly userUpdateFieldsPolicy: UserUpdateFieldsPolicy,
    private readonly emailVerificationService: EmailVerificationService,
  ) { }

  findByEmail(email: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { email }, relations });
  }

  findById(id: string, relations: string[] = []): Promise<User | null> {
    return this.repo.findOne({ where: { id }, relations });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    isEmailVerified: boolean;
    roles?: Role[];
  }): Promise<User> {
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
    const allowedFields =
      this.userProfileFieldsPolicy.getAllowedFields(access);

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
    access: SelfOrPermissionAccess) {

    const allowedFields =
      this.userUpdateFieldsPolicy.getAllowedFields(access);


    // `dto` went through the global `ValidationPipe`'s `plainToInstance()`,
    // which sets every field the DTO class declares as an own property —
    // including ones the client never sent, as `undefined` — so
    // `Object.keys(dto)` alone would always report every declared field as
    // "requested". Filtering by value here is what actually distinguishes
    // "sent" from "not sent" (same class of bug as the T-013 fix, just one
    // step upstream of the Object.assign/merge case that fix addressed).
    const requestedFields = (Object.keys(dto) as Array<keyof UpdateUserDto>).filter(
      (field) => dto[field] !== undefined,
    );

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

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.email !== undefined) {
      const existing = await this.findByEmail(dto.email);
      if (existing && existing.id !== userId) {
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

    await this.emailVerificationService.confirm(
      user.id,
      code,
      EmailVerificationPurpose.EMAIL_CHANGE,
    );

    user.email = user.pendingEmail;
    user.pendingEmail = null;
    await this.repo.save(user);

    this.logger.log({
      event: 'users.email_change.confirmed',
      userId: user.id,
    });

    return { email: user.email };
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
